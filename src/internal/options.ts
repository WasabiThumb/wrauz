import type {ZipFileConstructorOptions} from "../struct";

//

type OpenRange = { readonly start: number | bigint };
type ClosedRange = { readonly start: number | bigint, readonly end: number | bigint };
type TailRange = { readonly suffix: number | bigint };
type Range = OpenRange | ClosedRange | TailRange;

type OptionValue<K extends keyof ZipFileConstructorOptions> =
    Required<ZipFileConstructorOptions>[K];

type Store = {
    filter: ((name: string) => any) | null,
    range: OptionValue<"range">,
    signal: OptionValue<"signal"> | null,
    headers: Headers | null,
    maxRetries: bigint,
};

const DEFAULT_STORE: Store = {
    filter: null,
    range: "auto",
    signal: null,
    headers: null,
    maxRetries: 3n,
} as const;

//

export class ParsedConstructorOptions {

    private static _parseStore(src?: ZipFileConstructorOptions | undefined): Store {
         let store: Store = {...DEFAULT_STORE};
         if (!src) return store;
         if (typeof src !== "object") throw new Error(`options must be an object`);
         const { signal, filter, range, headers, maxRetries } = src;
         if (signal) {
             if (typeof signal !== "object" || !(signal instanceof AbortSignal)) {
                 throw new Error(`\"signal\" must be an AbortSignal`);
             }
             store.signal = signal;
         }
         if (filter) {
             if (typeof filter !== "function") {
                 throw new Error(`\"filter\" must be a function`);
             }
             store.filter = filter;
         }
         if (range) {
             if (typeof range !== "string") {
                 throw new Error(`\"range\" must be a string`);
             }
             const v = range.toLowerCase();
             if (["auto", "never"].indexOf(v) === -1) {
                 throw new Error(`illegal value for \"range\": ${range}`);
             }
             store.range = v as OptionValue<"range">;
         }
         if (headers) {
             store.headers = new Headers(headers);
         }
         if (maxRetries) {
             switch (typeof maxRetries) {
                 case "number":
                     if (!Number.isFinite(maxRetries)) throw new Error(`\"maxRetries\" must be finite`);
                     if (maxRetries < 0) throw new Error(`\"maxRetries\" must be positive`);
                     store.maxRetries = BigInt(Math.trunc(maxRetries));
                     break;
                 case "bigint":
                     if (maxRetries < 0n) throw new Error(`\"maxRetries\" must be positive`);
                     store.maxRetries = maxRetries;
                     break;
                 default:
                     throw new Error(`\"maxRetries\" must be a number or bigint`);
             }
         }
         return store;
    }

    //

    private readonly _store: Store;

    constructor(src?: ZipFileConstructorOptions | undefined) {
        this._store = ParsedConstructorOptions._parseStore(src);
    }

    //

    get range(): OptionValue<"range"> {
        return this._store.range;
    }

    get maxRetries(): bigint {
        return this._store.maxRetries;
    }

    entryPassesFilter(name: string): boolean {
        const { filter } = this._store;
        if (!filter) return true;
        return !!filter(name);
    }

    makeRequestInit(cache?: boolean, range?: Range): RequestInit {
        const { signal } = this._store;
        let ret: RequestInit = { headers: this.makeHeaders(range) };
        if (cache) ret.cache = "force-cache";
        if (signal) ret.signal = signal;
        return ret;
    }

    makeHeaders(range?: Range): Headers {
        const base = this._store.headers;
        const ret = base ? new Headers(base) : new Headers();
        if (range) {
            let v: string;
            if ("start" in range) {
                if ("end" in range) {
                    v = `bytes=${range.start}-${range.end}`;
                } else {
                    v = `bytes=${range.start}-`;
                }
            } else if ("suffix" in range) {
                v = `bytes=-${range.suffix}`;
            } else {
                throw new Error(`invalid range`);
            }
            ret.set("Range", v);
        }
        return ret;
    }

}
