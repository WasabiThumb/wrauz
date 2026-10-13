import type {UrlHandle} from "./handle";
import {BytesReader, type Reader, StreamReader} from "./reader";
import type {ParsedConstructorOptions} from "./options";

//

/** A truncated CDFH entry in a ZIP file */
export type CentralDirectoryRecord = {
    readonly method: number,
    readonly modTime: number,
    readonly modDate: number,
    readonly crc: number,
    readonly compressedSize: bigint,
    readonly uncompressedSize: bigint,
    readonly name: string,
    readonly offset: bigint
};

/** Content of a ZIP file's central directory, plus discovered flags */
export type CentralDirectory = {
    readonly records: readonly CentralDirectoryRecord[],
    readonly zip64: boolean,
    readonly supportsRange: boolean
};

//

async function readRecord(reader: Reader, zip64: boolean): Promise<CentralDirectoryRecord | null> {
    // Read the header
    const header = await reader.readUint32LE();
    if (0x06054B50 === header) return null; // reached the EOCD somehow
    if (0x02014B50 !== header)
        throw new Error(`Malformed ZIP file (mismatched CDFH header, got ${header})`);

    // Skip stuff we don't care about
    await reader.skipExact(6);

    // Read the method, modTime and modDate
    const method = await reader.readUint16LE();
    const modTime = await reader.readUint16LE();
    const modDate = await reader.readUint16LE();

    // Read the CRC
    const crc = await reader.readUint32LE();

    // Read the (original) compressed & uncompressed size
    let compressedSize = BigInt(await reader.readUint32LE());
    let uncompressedSize = BigInt(await reader.readUint32LE());

    // Read the file name length, extra field length, and file comment length
    const fileNameLength = await reader.readUint16LE();
    const extraFieldLength = await reader.readUint16LE();
    const fileCommentLength = await reader.readUint16LE();

    // Skip stuff we don't care about
    await reader.skipExact(8);

    // Read the (original) offset
    let offset = BigInt(await reader.readUint32LE());

    // Read the file name
    const name = await (async (len: number) => {
        const buf = new Uint8Array(len);
        let head = 0;
        let read: number;
        while (head < len) {
            read = await reader.read(buf, head, len - head);
            if (read === -1) throw new Error(`Malformed ZIP file (reached EOF while reading entry name)`);
            head += read;
        }
        return (new TextDecoder()).decode(buf);
    })(fileNameLength);

    // Skip/read the extra fields
    let extraSkip: number = extraFieldLength;
    if (extraSkip > 0) {
        if (zip64) {
            do {
                const id = await reader.readUint16LE();
                const size = await reader.readUint16LE();
                extraSkip -= 4 + size;
                if (id !== 0x0001) {
                    await reader.skipExact(size);
                    continue;
                }
                let readOffset: boolean = false;
                let skipNumber: boolean = false;
                if (size === 28) {
                    readOffset = true;
                    skipNumber = true;
                } else if (size === 24) {
                    readOffset = true;
                } else if (size !== 16) {
                    throw new Error(`Invalid size for ZIP64 extra field (${size})`);
                }
                uncompressedSize = await reader.readUint64LE();
                compressedSize = await reader.readUint64LE();
                if (readOffset) offset = await reader.readUint64LE();
                if (skipNumber) await reader.skipExact(4);
                break;
            } while (extraSkip > 0);
        }
        await reader.skipExact(extraSkip);
    }

    // Skip the comment
    await reader.skipExact(fileCommentLength);

    // Final object
    return {
        method,
        modDate,
        modTime,
        crc,
        compressedSize,
        uncompressedSize,
        name,
        offset
    };
}

function findEOCD(tail: Uint8Array): number {
    let eocd: number = tail.length - 21;
    while (true) {
        // 50 4B 05 06 (little endian)
        eocd = tail.lastIndexOf(0x50, eocd - 1);
        if (eocd === -1) throw new Error("Malformed ZIP file (no EOCD record)");
        if (tail[eocd + 1] === 0x4B &&
            tail[eocd + 2] === 0x05 &&
            tail[eocd + 3] === 0x06) break;
    }
    return eocd;
}

async function locateCentralDirectoryWithRegion(
    region: Uint8Array,
    regionOffset: bigint,
    more: (start: bigint, end: bigint) => Promise<ArrayBuffer>
): Promise<{ centralDirectoryRecords: number, centralDirectoryOffset: bigint, zip64: boolean }> {
    // Find the index within "region" of the EOCD record
    const eocd = findEOCD(region);

    // Read some values from the EOCD
    const dv = new DataView(region.buffer, region.byteOffset, region.byteLength);
    const eocdOffset = regionOffset + BigInt(eocd);
    const diskNumber = dv.getUint16(eocd + 4, true);
    const startDiskNumber = dv.getUint16(eocd + 6, true);
    const statedCentralDirectoryRecords = dv.getUint16(eocd + 10, true);
    const statedCentralDirectoryOffset = dv.getUint32(eocd + 16, true);
    if (diskNumber !== startDiskNumber) throw new Error("Unsupported ZIP file (multi-disk)");

    // Determine the central directory location & record count
    let zip64: boolean;
    let centralDirectoryRecords: number;
    let centralDirectoryOffset: bigint;
    if ((statedCentralDirectoryOffset === 0xFFFFFFFF || statedCentralDirectoryRecords === 0xFFFF) &&
        eocd >= 20 && 0x07064B50 === dv.getUint32(eocd - 20, true)
    ) {
        // ZIP64
        const diskCount = dv.getUint32(eocd - 4, true);
        if (diskCount !== 1) throw new Error("Unsupported ZIP file (multi-disk)");
        const start = dv.getBigUint64(eocd - 12, true);
        const end = start + 56n;
        if (end >= eocdOffset) throw new Error(`Malformed ZIP64 file (EOCD64 overlaps EOCD)`);
        let eocd64: DataView;
        if (start >= regionOffset) {
            eocd64 = new DataView(region.buffer, region.byteOffset + Number(start - regionOffset), 56);
        } else {
            // Will have to make another request
            eocd64 = new DataView(await more(start, end));
        }
        if (0x06064B50 !== eocd64.getUint32(0, true)) {
            throw new Error(`Malformed ZIP64 file (bad EOCD64 header)`);
        }
        const records = eocd64.getBigUint64(32, true);
        if (records > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Too many records in ZIP64 file (got ${records})`);
        zip64 = true;
        centralDirectoryRecords = Number(records);
        centralDirectoryOffset = eocd64.getBigUint64(48, true);
    } else {
        // Regular ZIP
        zip64 = false;
        centralDirectoryRecords = statedCentralDirectoryRecords;
        centralDirectoryOffset = BigInt(statedCentralDirectoryOffset);
    }

    if (centralDirectoryOffset > eocdOffset) {
        throw new Error(`Malformed ZIP file (CDFH positioned after EOCD)`);
    }

    return { centralDirectoryRecords, centralDirectoryOffset, zip64 };
}

async function readCentralDirectoryWithoutRange(
    url: string,
    opts: ParsedConstructorOptions
): Promise<CentralDirectory> {
    // Helper to make a new reader
    const newReader = (async (cache?: boolean) => {
        const r = await fetch(url, opts.makeRequestInit(cache));
        if (r.status < 200 || r.status > 299) throw new Error(`Non-2XX status code ${r.status} (${r.statusText})`);
        const { body } = r;
        if (!body) throw new Error(`Response has no body`);
        return new StreamReader(body);
    });

    // Create an initial reader
    const initialReader = await newReader();

    // Buffer the relevant region of the file
    const [ region, regionOffset ] = await (async (reader: Reader) => {
        // Find the first occurrence
        // of 50 4B 01 02 (CDFH) or 50 4B 05 06 (EOCD)
        // and track the offset of that occurrence
        let regionOffset: bigint = 0n;
        let regionCDFH: boolean;
        const preRegionStep = (async () => {
            const next = await reader.next();
            if (next === -1) throw new Error(`Malformed ZIP file (reached EOF before header)`);
            regionOffset++;
            return next;
        });
        while (true) {
            if (0x50 !== await preRegionStep()) continue;
            if (0x4B !== await preRegionStep()) continue;
            const v = await preRegionStep();
            if (v === 0x01) {
                if (0x02 !== await preRegionStep()) continue;
                regionCDFH = true;
                break;
            } else if (v === 0x05) {
                if (0x06 !== await preRegionStep()) continue;
                regionCDFH = false;
                break;
            }
        }

        // Do the buffering
        let regionBuffer = new ArrayBuffer(8192);
        let region = new Uint8Array(regionBuffer);
        let regionPosition: number = 4;
        let read: number;
        region.set(regionCDFH ? [ 0x50, 0x4B, 0x01, 0x02 ] : [ 0x50, 0x4B, 0x05, 0x06 ], 0);
        while ((read = await reader.read(region, regionPosition, region.length - regionPosition)) != -1) {
            regionPosition += read;
            let cap: number = region.length;
            if (regionPosition === cap) {
                if (cap === 0x7FFFFFFF) throw new Error(`Refusing to grow buffer past ${cap}`);
                cap = cap >= 0x40000000 ? 0x7FFFFFFF : cap << 1;
                regionBuffer = regionBuffer.transfer(cap);
                region = new Uint8Array(regionBuffer);
            }
        }
        region = new Uint8Array(regionBuffer, 0, regionPosition);
        return [ region, regionOffset - 4n ] as const;
    })(initialReader)
        .finally(() => initialReader.close());

    // Locate the central directory
    const { centralDirectoryRecords, centralDirectoryOffset, zip64 } = await locateCentralDirectoryWithRegion(
        region,
        regionOffset,
        () => Promise.reject("Tried to read ZIP data outside of buffered region")
    );

    // Read the records
    const records: CentralDirectoryRecord[] = new Array(centralDirectoryRecords);
    const recordReader = await newReader(true);
    try {
        await recordReader.skipExact(centralDirectoryOffset);
        let head: number = 0;
        for (let i = 0; i < centralDirectoryRecords; i++) {
            const next = await readRecord(recordReader, zip64);
            if (next === null) break;
            if (!opts.entryPassesFilter(next.name)) {
                if (head !== 0) break;
                continue;
            }
            records[head++] = next;
        }
        records.length = head;
    } finally {
        await recordReader.close();
    }

    // Create the final object
    return {
        records,
        zip64,
        supportsRange: false
    } as CentralDirectory;
}

async function readCentralDirectoryWithRange(
    url: string,
    tail: Uint8Array,
    tailOffset: bigint,
    opts: ParsedConstructorOptions
): Promise<CentralDirectory> {
    // Locate the central directory
    const { centralDirectoryRecords, centralDirectoryOffset, zip64 } = await locateCentralDirectoryWithRegion(
        tail,
        tailOffset,
        async (start, end) => {
            const r = await fetch(url, opts.makeRequestInit(true, { start, end }));
            if (r.status !== 206) throw new Error(`Non-206 status code ${r.status} while reading ZIP64 data (${r.statusText})`);
            return r.arrayBuffer();
        }
    );

    // Create a reader to read the records
    let reader: Reader;
    let readerOffset: bigint = centralDirectoryOffset;
    if (centralDirectoryOffset >= tailOffset) {
        // Very lucky, the tail contains the entire central directory
        const start = Number(centralDirectoryOffset - tailOffset);
        reader = new BytesReader(tail.subarray(start, tail.length));
    } else {
        // Make a request
        const r = await fetch(url, opts.makeRequestInit(true, { start: centralDirectoryOffset }));
        if (r.status !== 206) throw new Error(`Non-206 status code ${r.status} while reading ZIP data (${r.statusText})`);
        const { body } = r;
        if (!body) throw new Error(`Response for ZIP data has no body`);
        reader = new StreamReader(body);
    }

    // Read the records with retry
    const records: CentralDirectoryRecord[] = new Array(centralDirectoryRecords);
    let retryAt = 0;
    let retryAtOffset: bigint = centralDirectoryOffset;
    let readHead = 0;
    let writeHead: number = 0;
    try {
        while (true) {
            let retries: bigint = 0n;
            try {
                let queuedRetry: boolean = false;
                let queuedRetryData: [ number, bigint ] = new Array(2) as [ number, bigint ] ;
                while (readHead < centralDirectoryRecords) {
                    const index = readHead++;
                    const next = await readRecord(reader, zip64);
                    if (!next) break;
                    if (opts.entryPassesFilter(next.name)) {
                        records[writeHead++] = next;
                    } else if (writeHead !== 0) {
                        break;
                    }
                    if (queuedRetry) {
                        [ retryAt, retryAtOffset ] = queuedRetryData;
                        retries = 0n;
                    }
                    queuedRetryData[0] = index;
                    queuedRetryData[1] = readerOffset + reader.position;
                    queuedRetry = true;
                }
                break;
            } catch (e) {
                if (retries >= opts.maxRetries) throw new Error(`Failed to read ZIP records (retried x${retries})`, { cause: e });
                retries += 1n;
                // make a new reader
                const r = await fetch(url, opts.makeRequestInit(true, { start: retryAtOffset }));
                if (r.status !== 206) throw new Error(`Non-206 status code ${r.status} while resuming ZIP data (${r.statusText})`);
                const { body } = r;
                if (!body) throw new Error(`Response for resumed ZIP data has no body`);
                readHead = retryAt;
                reader = new StreamReader(body);
                readerOffset = retryAtOffset;
            }
        }
        records.length = writeHead;
    } finally {
        await reader.close();
    }

    // Create the final object
    return {
        records,
        zip64,
        supportsRange: true
    } as CentralDirectory;
}

export function readCentralDirectory(handle: UrlHandle, opts: ParsedConstructorOptions): Promise<CentralDirectory> {
    return handle(async (url) => {
        if (opts.range === "never") return readCentralDirectoryWithoutRange(url, opts);
        const r = await fetch(url, opts.makeRequestInit(false, { suffix: 65579 }));
        const { status } = r;
        if (status === 416) return readCentralDirectoryWithoutRange(url, opts);
        if (status < 200 || status > 299) throw new Error(`Non-2XX status code ${status} (${r.statusText})`);
        if (status !== 206) return readCentralDirectoryWithoutRange(url, opts);
        const range = r.headers.get("Content-Range");
        if (!range) return readCentralDirectoryWithoutRange(url, opts);
        const match = /^bytes\x20(\d+)-/i.exec(range);
        if (!match) return readCentralDirectoryWithoutRange(url, opts);
        const tail = await r.bytes();
        if (tail.length < 22) throw new Error(`Truncated ZIP file (read ${tail.length} bytes)`);
        return readCentralDirectoryWithRange(url, tail, BigInt(match[1]!), opts);
    });
}
