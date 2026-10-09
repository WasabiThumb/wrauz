
/** Abstraction for a byte source */
export interface Reader {
    readonly position: bigint;
    next(): Promise<number>;
    read(dest: Uint8Array, offset?: number, length?: number): Promise<number>;
    readUint16LE(): Promise<number>;
    readUint32LE(): Promise<number>;
    readUint64LE(): Promise<bigint>;
    skipExact(n: number | bigint): Promise<void>;
    close(): Promise<void>;
}

abstract class AbstractReader implements Reader {

    /** Scratch buffer for reading values */
    private static readonly _SCRATCH = (() => {
        const buffer = new ArrayBuffer(8);
        const u8 = new Uint8Array(buffer);
        const u16 = new Uint16Array(buffer);
        const u32 = new Uint32Array(buffer);
        const u64 = new BigUint64Array(buffer);
        u8[0] = 0xAA;
        u8[1] = 0xBB;
        const nativeEndianIsBig = u16[0] === 0xAABB;
        return { u8, u16, u32, u64, nativeEndianIsBig };
    })();

    //

    private _open: boolean = true;

    //

    abstract position: bigint;

    abstract next(): Promise<number>;

    abstract read(dest: Uint8Array, offset?: number, length?: number): Promise<number>;

    abstract skipExact(n: number | bigint): Promise<void>;

    async readUint16LE(): Promise<number> {
        const { u8, u16, nativeEndianIsBig } = AbstractReader._SCRATCH;
        await this._into(u8, 2, "uint16");
        if (nativeEndianIsBig) this._bswap(u8, 2);
        return u16[0]!;
    }

    async readUint32LE(): Promise<number> {
        const { u8, u32, nativeEndianIsBig } = AbstractReader._SCRATCH;
        await this._into(u8, 4, "uint32");
        if (nativeEndianIsBig) this._bswap(u8, 4);
        return u32[0]!;
    }

    async readUint64LE(): Promise<bigint> {
        const { u8, u64, nativeEndianIsBig } = AbstractReader._SCRATCH;
        await this._into(u8, 8, "uint64");
        if (nativeEndianIsBig) this._bswap(u8, 8);
        return u64[0]!;
    }

    async close(): Promise<void> {
        if (!this._open) return;
        try {
            await this.onClose();
        } finally {
            this._open = false;
        }
    }

    protected onClose(): Promise<void> {
        return Promise.resolve();
    }

    protected checkOpen(): void {
        if (!this._open) throw new Error("reader has been closed");
    }

    private async _into(u8: Uint8Array, count: number, descriptor: string): Promise<void> {
        let head: number = 0;
        let read: number;
        while (head < count) {
            read = await this.read(u8, head, count - head);
            if (read === -1) throw new Error(`Failed to read ${descriptor} (encountered EOF after ${head} bytes)`);
            head += read;
        }
    }

    private _bswap(u8: Uint8Array, count: number): void {
        const hc = count >>> 1;
        let q: number = count;
        for (let i = 0; i < hc; i++) {
            const tmp = u8[--q]!;
            u8[q] = u8[0]!;
            u8[0] = tmp;
        }
    }

}

export class BytesReader extends AbstractReader {

    private readonly _data: Uint8Array;
    private _off: number;

    constructor(data: Uint8Array) {
        super();
        this._data = data;
        this._off = 0;
    }

    //

    get position(): bigint {
        return BigInt(this._off);
    }

    override async next(): Promise<number> {
        this.checkOpen();
        const head = this._off;
        if (head >= this._data.length) return -1;
        const ret = this._data[head]!;
        this._off = head + 1;
        return ret;
    }

    override async read(dest: Uint8Array, offset?: number, length?: number): Promise<number> {
        this.checkOpen();
        if (0 === length) return 0;
        offset = offset || 0;
        length = length || (dest.length - offset);
        const head = this._off;
        const rem = this._data.length - head;
        if (rem === 0) return -1;
        const count = Math.min(length, rem);
        const end = head + count;
        dest.set(this._data.subarray(head, end), offset);
        this._off = end;
        return count;
    }

    override async skipExact(n: number | bigint): Promise<void> {
        let v: number = Number(n);
        if (!Number.isFinite(v) || v > Number.MAX_SAFE_INTEGER) throw new Error(`cannot skip ${n} bytes`);
        v = Math.trunc(v);
        if (v <= 0) return;
        const head = this._off;
        const rem = this._data.length - head;
        if (rem < v) throw new Error(`cannot skip ${n} bytes (${rem} bytes remain)`);
        this._off = head + v;
    }

}

export class StreamReader extends AbstractReader {

    private readonly _stream: ReadableStream<Uint8Array>;
    private readonly _handle: ReadableStreamDefaultReader<Uint8Array>;
    private _chunk: { data: Uint8Array, head: number } | null;
    private _position: bigint;

    constructor(stream: ReadableStream<Uint8Array>) {
        super();
        this._stream = stream;
        this._handle = stream.getReader();
        this._chunk = null;
        this._position = 0n;
    }

    //

    override get position(): bigint {
        return this._position;
    }

    override async next(): Promise<number> {
        this.checkOpen();
        const chunk = await this._nextChunk();
        if (!chunk) return -1;
        this._position++;
        return chunk.data[chunk.head++]!;
    }

    override async read(dest: Uint8Array, offset?: number, length?: number): Promise<number> {
        this.checkOpen();
        if (0 === length) return 0;
        offset = offset || 0;
        length = length || (dest.length - offset);

        let chunk = await this._nextChunk();
        if (!chunk) return -1;
        let read: number = 0;

        while (read < length) {
            const brem = length - read;
            const crem = chunk.data.length - chunk.head;
            let nextChunk, count;

            if (crem < brem) {
                count = crem;
                this._chunk = null;
                nextChunk = await this._nextChunk();
            } else {
                count = brem;
                nextChunk = chunk;
            }

            const cend = chunk.head + count;
            const sub = chunk.data.subarray(chunk.head, cend);
            dest.set(sub, offset + read);
            chunk.head = cend;
            read += count;

            if (!nextChunk) break;
            chunk = nextChunk;
        }

        this._position += BigInt(read);
        return read;
    }

    override async skipExact(n: number | bigint): Promise<void> {
        this.checkOpen();
        let count = BigInt(typeof n === "number" ? Math.trunc(n) : n);
        while (count > 0n) {
            const chunk = await this._nextChunk();
            if (!chunk) throw new Error(`failed to skip ${n} bytes (reached eof)`);
            const k = BigInt(chunk.data.length);
            if (count < k) {
                chunk.head += Number(count);
                break;
            }
            this._chunk = null;
            count -= k;
        }
        this._position += count;
    }

    private async _nextChunk(): Promise<{ data: Uint8Array, head: number } | null> {
        let ret = this._chunk;
        if (!!ret && ret.head < ret.data.length) return ret;

        const reader = this._handle;
        let result;
        do {
            result = await reader.read();
            if (result.done) return null;
        } while (result.value.length === 0);

        this._chunk = ret = {
            data: result.value,
            head: 0
        };
        return ret;
    }

    protected override async onClose(): Promise<void> {
        try {
            await this._handle.cancel();
        } finally {
            try {
                await this._stream.cancel();
            } catch (ignored) { }
        }
    }

}

export class LimitedReader extends AbstractReader {

    private readonly _src: Reader;
    private readonly _limit: bigint;
    private _used: bigint;

    constructor(src: Reader, limit: bigint) {
        super();
        this._src = src;
        this._limit = limit;
        this._used = 0n;
    }

    //

    override get position(): bigint {
        return this._used;
    }

    override async next(): Promise<number> {
        this.checkOpen();
        const position = this._used;
        if (position >= this._limit) return -1;
        const ret = await this._src.next();
        if (ret === -1) return -1;
        this._used = position + 1n;
        return ret;
    }

    override async read(dest: Uint8Array, offset?: number, length?: number): Promise<number> {
        this.checkOpen();
        if (0 === length) return 0;
        offset = offset || 0;
        length = length || (dest.length - offset);

        const position = this._used;
        const rem = this._limit - position;
        if (rem <= 0n) return -1;

        const read = BigInt(length) <= rem ?
            await this._src.read(dest, offset, length) :
            await this._src.read(dest, offset, Number(rem));

        if (read === -1) return -1;
        this._used = position + BigInt(read);
        return read;
    }

    override async skipExact(n: number | bigint): Promise<void> {
        this.checkOpen();
        const count = BigInt(typeof n === "number" ? Math.trunc(n) : n);
        if (count <= 0n) return;

        const position = this._used;
        const rem = this._limit - position;
        if (count > rem) throw new Error(`Cannot skip ${count} bytes (${rem} bytes remaining)`);

        await this._src.skipExact(count);
        this._used = position + count;
    }

    protected override onClose(): Promise<void> {
        return this._src.close();
    }

}

//

function readerToWebStream(reader: Reader): ReadableStream<Uint8Array> {
    const buffer = new Uint8Array(8192);
    return new ReadableStream<Uint8Array>({
        async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
            const read = await reader.read(buffer);
            if (read !== -1) {
                controller.enqueue(buffer.slice(0, read));
                return;
            }
            try {
                await reader.close();
            } finally {
                controller.close();
            }
        },
        async cancel(): Promise<void> {
            return reader.close();
        }
    });
}

export default readerToWebStream
