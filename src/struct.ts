
export namespace ZipFile {

    type EncodingMap = {
        stream: ReadableStream<Uint8Array>,
        bytes: Uint8Array,
        utf8: string
    };
    type Encoding = keyof EncodingMap;

    /** @internal */
    export type EncodingArgument = readonly [ Encoding ] | readonly [];

    /** @internal */
    export type Encoded<E extends EncodingArgument = EncodingArgument> = E["length"] extends 0 ? ReadableStream<Uint8Array> :
        (E extends [ infer X ] ? (X extends Encoding ? EncodingMap[X] : EncodingMap[Encoding]) : EncodingMap[Encoding]);

    export type RangeStrategy = "auto" | "never";

    export type DuplicateStrategy = "keep" | "merge" | "ignore" | "fail";

}

//

/** An entry in a ZIP file */
export type ZipEntry = {
    /** Name of the entry. If the entry ends with a slash (/), it is a directory. */
    readonly name: string,

    /** Uncompressed size in bytes of the entry. */
    readonly size: number,

    /** CRC32 checksum of the uncompressed bytes of this entry. */
    readonly crc: number,

    /** Last modified time of this entry as a FAT timestamp. */
    readonly lastModified: number,
};

/** A parsed ZIP file */
export interface ZipFile extends Iterable<ZipEntry> {

    /**
     * Provides an array of entries in this ZIP file,
     * sorted lexicographically for fast lookups.
     * To view the entries in the order which they
     * exist in the file, use "originalEntries".
     */
    readonly entries: readonly ZipEntry[];

    /**
     * Provides an array of entries in this ZIP file
     * in the order they occur. For a lexicographically
     * sorted array, use "entries".
     */
    readonly originalEntries: readonly ZipEntry[];

    /** Gets the entry with the specified name, or null if no such entry exists */
    entry(name: string): ZipEntry | null;

    /** Reports all entries within the given path */
    list(path: string, full?: boolean): Iterable<ZipEntry>;

    /**
     * Reads the given entry with the specified encoding.
     * If the entry is a ZipEntry, this method may fail if the object
     * did not come from this ZIP file. If the entry is a string, this
     * method may fail if the ZIP file has no entry with that name.
     */
    read<E extends ZipFile.EncodingArgument>(entry: string | ZipEntry, ...encoding: E): Promise<ZipFile.Encoded<E>>;

    /**
     * Iterate over all entries in this file
     * as reported by "entries"
     */
    [Symbol.iterator](): Iterator<ZipEntry>;

}

/** An object which may be used to construct a ZipFile */
export type ZipFileSource = ArrayBuffer | ArrayBufferView<ArrayBuffer> | Blob | URL | string;

/** Options for the zip file creation function */
export type ZipFileConstructorOptions = {
    /**
     * Determines which entries should be
     * extracted by their name. Parsing
     * stops at the first entry that does
     * not match, so it is not guaranteed
     * that the resultant ZIP file will
     * contain *all* matching entries
     * depending on the order of entries
     * within the ZIP file.
     */
    filter?: (name: string) => boolean,

    /**
     * Determines when wrauz will attempt
     * to make range requests. The default
     * behavior (`auto`) is to always make
     * a range request and continue if the
     * server responds with a well-formed
     * `Content-Range` header, otherwise
     * reopen the connection and never make
     * another range request. When set to
     * `never`, the initial
     * request is not made and wrauz
     * instead proceeds directly to the
     * rangeless code path.
     */
    range?: ZipFile.RangeStrategy,

    /**
     * The action to take when a duplicate
     * ZIP entry is found. The default behavior
     * (`merge`) is to throw an error only when
     * the duplicate entry is distinct from the
     * existing entry. When set to
     * `keep`, duplicate entries are kept
     * and reported by the `ZipFile`
     * iterator(s), though still reporting
     * the "earliest" entry when accessing
     * an entry by name. When set
     * to `ignore`, only the "earliest" entry
     * with a given name is kept. When set to
     * `fail`, duplicate entries are disallowed
     * and will always throw an error.
     */
    duplicates?: ZipFile.DuplicateStrategy,

    /**
     * Maximum amount of times to retry
     * a range request when corruption is
     * detected. Retries are disallowed for
     * non-range requests.
     */
    maxRetries?: number | bigint,

    /**
     * Abort signal to use. Aborting will cause
     * wrauz to exit early with an error.
     */
    signal?: AbortSignal,

    /**
     * Additional headers to use for all requests.
     * This includes requests made by the `ZipFile`
     * after construction.
     */
    headers?: HeadersInit
};

/** A function which takes a source and parses it as a zip file */
export type ZipFileConstructor = (source: ZipFileSource, options?: ZipFileConstructorOptions) => Promise<ZipFile>;
