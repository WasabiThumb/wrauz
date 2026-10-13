import type {ZipEntry, ZipFile, ZipFileConstructor, ZipFileConstructorOptions, ZipFileSource} from "./struct";
import {type CentralDirectory, type CentralDirectoryRecord, readCentralDirectory} from "./internal/cdfh";
import {type UrlHandle, urlHandle} from "./internal/handle";
import {type Reader, LimitedReader, StreamReader, readerToWebStream} from "./internal/reader";
import {ParsedConstructorOptions} from "./internal/options";

//r

const stringCompare = ((a: string, b: string): number => {
    const al = a.length;
    const bl = b.length;
    let ml: number;
    let lc: number;

    if (al <= bl) {
        ml = al;
        lc = al === bl ? 0 : -1;
    } else {
        ml = bl;
        lc = 1;
    }

    for (let i = 0; i < ml; i++) {
        const ac = a.charCodeAt(i);
        const bc = b.charCodeAt(i);
        if (ac === bc) continue;
        return ac - bc;
    }

    return lc;
});

const search = (<R>(
    entries: readonly ZipEntry[],
    limit: number,
    name: string,
    hit: (index: number) => R,
    miss: (index: number) => R
): R => {
    let off: number = 0;
    let len: number = limit;
    while (len > 0) {
        const hl = len >>> 1;
        const s = off + hl;
        const c = stringCompare(name, entries[s]!.name);
        if (c === 0) return hit(s);
        if (c < 0) {
            len = hl;
        } else {
            off += hl + 1;
            len -= hl + 1;
        }
    }
    return miss(off);
});

class ZipEntryImpl implements ZipEntry {

    constructor(
        readonly parent: ZipFileImpl,
        readonly record: CentralDirectoryRecord
    ) { }

    //

    get name(): string {
        return this.record.name;
    }

    get size(): number {
        return Number(this.record.uncompressedSize);
    }

    get crc(): number {
        return this.record.crc;
    }

    get lastModified(): number {
        return ((this.record.modDate << 16) | this.record.modTime) >>> 0;
    }

    toString() {
        return this.name;
    }

    [Symbol.toStringTag]() {
        return "ZipEntry";
    }

}

class ZipFileImpl implements ZipFile {

    readonly entries: readonly ZipEntryImpl[];
    readonly originalEntries: readonly ZipEntryImpl[];
    private readonly _handle: UrlHandle;
    private readonly _supportsRange: boolean;
    private readonly _opts: ParsedConstructorOptions;

    constructor(handle: UrlHandle, cd: CentralDirectory, opts: ParsedConstructorOptions) {
        const { supportsRange } = cd;
        const [ entries, originalEntries ] = ((records) => {
            const entries: ZipEntryImpl[] = new Array(records.length);
            const originalEntries: ZipEntryImpl[] = new Array(records.length);
            for (let i = 0; i < records.length; i++) {
                const entry = new ZipEntryImpl(this, records[i]!);
                originalEntries[i] = entry;
                search(
                    entries, i,
                    entry.record.name,
                    (_) => {
                        throw new Error("Malformed ZIP (duplicate entry)")
                    },
                    (k) => {
                        if (k !== i) entries.copyWithin(k + 1, k, i);
                        entries[k] = entry;
                    }
                );
            }
            return [
                Object.freeze(entries),
                Object.freeze(originalEntries)
            ];
        })(cd.records);
        this.entries = entries;
        this.originalEntries = originalEntries;
        this._handle = handle;
        this._supportsRange = supportsRange;
        this._opts = opts;
    }

    //

    entry(name: string): ZipEntryImpl | null {
        return search(
            this.entries,
            this.entries.length,
            name,
            (i) => this.entries[i]!,
            () => null
        );
    }

    read<E extends ZipFile.EncodingArgument>(entry: string | ZipEntry, ...encoding: E): Promise<ZipFile.Encoded<E>> {
        const resolvedEntry = this._normalizeEntry(entry);
        const resolvedEncoding = this._normalizeEncoding(encoding);
        const { method, offset, compressedSize } = resolvedEntry.record;
        const deflate = this._normalizeMethod(method);
        return this._useReader(offset, async (r): Promise<ZipFile.Encoded> => {
            await this._consumeLocalFileHeader(r);
            const src: Reader = new LimitedReader(r, compressedSize);
            const final: ReadableStream<Uint8Array> = deflate ? this._deflate(src) : readerToWebStream(src);
            switch (resolvedEncoding) {
                case "stream":
                    return final;
                case "bytes":
                    return this._collectWebStreamAsBytes(final);
                case "utf8":
                    return this._collectWebStreamAsString(final);
                default:
                    return this._neverError(resolvedEncoding);
            }
        }) as Promise<ZipFile.Encoded<E>>;
    }

    list(path: string, full?: boolean): Iterable<ZipEntry> {
        if (path.length === 0) return this.entries;
        const prefix = path.endsWith("/") ? path : `${path}/`;
        return this._inPrefix(prefix, full);
    }

    [Symbol.iterator](): Iterator<ZipEntry> {
        return this.entries[Symbol.iterator]();
    }

    [Symbol.toStringTag]() {
        return "ZipFile";
    }

    private _neverError(x: never): never {
        throw new Error(`Unhandled case: ${x}`);
    }

    private _deflate(reader: Reader): ReadableStream<Uint8Array> {
        const stream = readerToWebStream(reader);
        const decompressionStream = new DecompressionStream("deflate-raw");
        return stream.pipeThrough(decompressionStream as TransformStream<Uint8Array, Uint8Array>);
    }

    private async _consumeLocalFileHeader(reader: Reader): Promise<void> {
        const magic = await reader.readUint32LE();
        if (0x04034B50 !== magic) throw new Error(`Malformed ZIP entry (bad local file header)`);
        await reader.skipExact(22);
        const nameLength = await reader.readUint16LE();
        const extraLength = await reader.readUint16LE();
        await reader.skipExact(nameLength);
        await reader.skipExact(extraLength);
    }

    private _useReader<R>(offset: bigint, fn: (reader: Reader) => Promise<R>): Promise<R> {
        const range = this._supportsRange;
        return this._handle(async (url): Promise<R> => {
            let r: Response;
            if (range) {
                r = await fetch(url, { cache: "force-cache", headers: this._opts.makeHeaders({ start: offset }) });
                if (r.status !== 206) {
                    throw new Error("Non-206 status code for range request while " +
                        `reading ZIP entry @ ${offset} (got HTTP ${r.status}: ${r.statusText})`);
                }
            } else {
                r = await fetch(url, { cache: "force-cache", headers: this._opts.makeHeaders() });
                if (r.status < 200 || r.status > 299) {
                    throw new Error(`Non-2XX status code while reading ZIP entry (got HTTP ${r.status}: ${r.statusText})`);
                }
            }
            const { body } = r;
            if (!body) throw new Error(`No response body while reading ZIP entry at ${offset}`);
            const reader = new StreamReader(body);
            let ok: boolean = false;
            try {
                if (!range) await reader.skipExact(offset);
                const ret = await fn(reader);
                ok = true;
                return ret;
            } finally {
                if (!ok) await reader.close();
            }
        });
    }

    private _normalizeMethod(method: number): boolean {
        if (method === 0x8) return true;
        if (method === 0x0) return false;
        throw new Error(`Unsupported ZIP compression method (${method})`);
    }

    private _normalizeEntry(entry: string | ZipEntry): ZipEntryImpl {
        switch (typeof entry) {
            case "string":
                const found = this.entry(entry);
                if (!found) throw new Error(`No entry with name \"${entry}\" in this ZIP file`);
                return found;
            case "object":
                if (entry !== null && entry instanceof ZipEntryImpl && entry.parent === this) return entry;
                throw new Error(`Object (${entry}) is not a ZIP entry owned by this ZIP file`);
            default:
                throw new Error(`Value of type \"${typeof entry}\" cannot be interpreted as ZIP entry`);
        }
    }

    private _normalizeEncoding(
        encoding: ZipFile.EncodingArgument
    ): "stream" | "bytes" | "utf8" {
        if (encoding.length === 0) return "stream";
        const e0 = encoding[0];
        // noinspection FallThroughInSwitchStatementJS
        switch (typeof e0) {
            case "undefined":
                return "stream";
            case "string":
                if (e0 === "stream" || e0 === "bytes" || e0 === "utf8") return e0;
                throw new Error(`Unrecognized encoding \"${e0}\"`);
            case "object":
                if (null === e0) return "stream";
            default:
                throw new Error(`Value of type \"${typeof e0}\" cannot be interpreted as encoding`);
        }
    }

    private async _collectWebStreamAsBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
        let capacity: number = 8192;
        let head: number = 0;
        let buffer = new ArrayBuffer(capacity);
        let view = new Uint8Array(buffer);
        const reader = stream.getReader();
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) return view.subarray(0, head);
                const { value } = chunk;
                let available: number = capacity - head;
                if (value.length > available) {
                    let nc: number = capacity;
                    do {
                        if (nc === 0x7FFFFFFF) throw new Error(`Refusing to grow buffer past ${nc}`);
                        nc = nc >= 0x40000000 ? 0x7FFFFFFF : nc << 1;
                        available = nc - head;
                    } while (value.length > available);
                    capacity = nc;
                    buffer = buffer.transfer(nc);
                    view = new Uint8Array(buffer);
                }
                view.set(value, head);
                head += value.length;
            }
        } finally {
            await reader.cancel();
        }
    }

    private async _collectWebStreamAsString(stream: ReadableStream<Uint8Array>): Promise<string> {
        const stringStream = stream.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>);
        const reader = stringStream.getReader();
        try {
            let ret: string = "";
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) return ret;
                ret += chunk.value;
            }
        } finally {
            await reader.cancel();
        }
    }

    private *_inPrefix(prefix: string, full?: boolean): Generator<ZipEntry> {
        let head: number = search(
            this.entries,
            this.entries.length,
            prefix,
            (i) => i + 1,
            (i) => i
        );
        while (head < this.entries.length) {
            const entry = this.entries[head++]!;
            if (!entry.name.startsWith(prefix)) break;
            if (!full) {
                const slash = entry.name.indexOf('/', prefix.length);
                if (slash !== -1 && slash !== entry.name.length - 1) continue;
            }
            yield entry;
        }
    }

}

//

/**
 * Entry point for wrauz.
 * Reads the specified source as a ZIP file.
 */
const wrauz: ZipFileConstructor = async function wrauz(
    source: ZipFileSource,
    options?: ZipFileConstructorOptions
): Promise<ZipFile> {
    // Parse arguments
    const o = new ParsedConstructorOptions(options);
    const handle = urlHandle(source);

    // Read central directory
    const cd = await readCentralDirectory(handle, o);

    // Collect to ZIP file
    return new ZipFileImpl(handle, cd, o);
}

export type * from "./struct";
export default wrauz;
