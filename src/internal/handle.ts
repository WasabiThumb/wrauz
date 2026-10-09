import type {ZipFileSource} from "../struct";

//

/** Vends access to a URL representing a resource */
export type UrlHandle = <R>(use: (url: string) => R) => R;

//

function newSimpleHandle(url: string): UrlHandle {
    return ((use) => {
        return use(url);
    });
}

function newBlobHandle(blob: Blob): UrlHandle {
    return ((use) => {
        const url = URL.createObjectURL(blob);
        let value;
        try {
            value = use(url);
        } catch (e) {
            URL.revokeObjectURL(url);
            throw e;
        }
        Promise.resolve(value)
            .catch(() => {})
            .finally(() => URL.revokeObjectURL(url));
        return value;
    });
}

//

export function urlHandle(source: ZipFileSource): UrlHandle {
    switch (typeof source) {
        case "string":
            return newSimpleHandle(source);
        case "object":
            if (source === null) throw new Error("source must not be null");
            if (source instanceof URL) return newSimpleHandle(source.href);
            const blob = source instanceof Blob ? source : new Blob([ source ]);
            return newBlobHandle(blob);
        default:
            throw new Error(`source must be string or object, got ${typeof source}`);
    }
}
