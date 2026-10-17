
interface NoneFileType<N extends string, E extends string> {
    readonly name: N;
    readonly extension: E;
    readonly mime: string;
    readonly icon: string;
    readonly dataMode: "none";
}

interface BufferFileType<N extends string, E extends string> {
    readonly name: N;
    readonly extension: E;
    readonly mime: string;
    readonly icon: string;
    readonly dataMode: "buffer";
    newElement(src: Uint8Array): HTMLElement;
}

interface BlobFileType<N extends string, E extends string> {
    readonly name: N;
    readonly extension: E;
    readonly mime: string;
    readonly icon: string;
    readonly dataMode: "blob";
    newElement(src: Blob): HTMLElement;
}

export type FileType<N extends string = string, E extends string = string> =
    NoneFileType<N, E> |
    BufferFileType<N, E> |
    BlobFileType<N, E>;

//

const onFinalized = ((element: HTMLElement, task: () => void): void => {
    const controller = new AbortController();
    const cb = (() => {
        controller.abort();
        task();
    });
    element.addEventListener("load", cb, { signal: controller.signal, once: true });
    element.addEventListener("error", cb, { signal: controller.signal, once: true });
});

const defineType = (<N extends string, E extends string>(
    v: FileType<N, E>
): FileType<N, E> => Object.freeze(v));

const defineAudioType = (<N extends string, E extends string>(
    name: N,
    extension: E,
    mime: string
): FileType<N, E> => {
    return defineType({
        name,
        extension,
        mime,
        icon: "icon/file_audio.svg",
        dataMode: "blob",
        newElement(src: Blob): HTMLElement {
            const element = document.createElement("audio");
            const uri = URL.createObjectURL(src);
            onFinalized(element, () => URL.revokeObjectURL(uri));
            element.src = uri;
            return element;
        }
    });
});

const defineImageType = (<N extends string, E extends string>(
    name: N,
    extension: E,
    mime: string
): FileType<N, E> => {
    return defineType({
        name,
        extension,
        mime,
        icon: "icon/file_image.svg",
        dataMode: "blob",
        newElement(src: Blob): HTMLElement {
            const element = document.createElement("img");
            const uri = URL.createObjectURL(src);
            onFinalized(element, () => URL.revokeObjectURL(uri));
            element.src = uri;
            return element;
        }
    });
});

const defineVideoType = (<N extends string, E extends string>(
    name: N,
    extension: E,
    mime: string
): FileType<N, E> => {
    return defineType({
        name,
        extension,
        mime,
        icon: "icon/file_video.svg",
        dataMode: "blob",
        newElement(src: Blob): HTMLElement {
            const element = document.createElement("video");
            const uri = URL.createObjectURL(src);
            onFinalized(element, () => URL.revokeObjectURL(uri));
            element.src = uri;
            element.controls = true;
            return element;
        }
    });
});

//

type FileTypeRegistry<A extends readonly FileType[]> = {
    readonly [I in (Exclude<Partial<A>["length"], A["length"]> & number) as A[I]["extension"]]: A[I]
};

const FILE_TYPE_REGISTRY = (<A extends readonly FileType[]>(types: A): FileTypeRegistry<A> => {
    const ret: Record<string, FileType> = {};
    for (const type of types) ret[type.extension] = type;
    return Object.freeze(ret) as FileTypeRegistry<A>;
})([
    // unknown
    defineType({
        name: "Unknown",
        extension: "",
        mime: "application/octet-stream",
        icon: "icon/file.svg",
        dataMode: "none",
    }),

    // audio
    defineAudioType("AAC Audio", ".aac", "audio/aac"),
    defineAudioType("M4A Audio", ".m4a", "audio/mp4"),
    defineAudioType("MP3 Audio", ".mp3", "audio/mp3"),
    defineAudioType("FLAC Audio", ".flac", "audio/flac"),
    defineAudioType("Ogg Audio", ".ogg", "audio/ogg"),
    defineAudioType("WAVE Audio", ".wav", "audio/wav"),
    defineAudioType("Opus Audio", ".opus", "audio/opus"),

    // image
    defineImageType("APNG Image", ".apng", "image/apng"),
    defineImageType("AVIF Image", ".avif", "image/avif"),
    defineImageType("BMP Image", ".bmp", "image/bmp"),
    defineImageType("GIF Image", ".gif", "image/gif"),
    defineImageType("HEIC Image", ".heic", "image/heic"),
    defineImageType("HEIF Image", ".heif", "image/heif"),
    defineImageType("JPEG Image", ".jpg", "image/jpeg"),
    defineImageType("JPEG Image", ".jpeg", "image/jpeg"),
    defineImageType("JPEG Image", ".jfif", "image/jpeg"),
    defineImageType("JPEG Image", ".pjpeg", "image/jpeg"),
    defineImageType("JPEG Image", ".pjp", "image/jpeg"),
    defineImageType("JPEG-XL Image", ".jxl", "image/jxl"),
    defineImageType("PNG Image", ".png", "image/png"),
    defineImageType("SVG Image", ".svg", "image/svg+xml"),
    defineImageType("TIFF Image", ".tif", "image/tiff"),
    defineImageType("TIFF Image", ".tiff", "image/tiff"),
    defineImageType("WebP Image", ".webp", "image/webp"),

    // json
    defineType({
        name: "JSON Document",
        extension: ".json",
        mime: "application/json",
        icon: "icon/file_json.svg",
        dataMode: "buffer",
        newElement(src: Uint8Array): HTMLElement {
            const text = (new TextDecoder()).decode(src);
            const formatted = JSON.stringify(JSON.parse(text), null, 2);
            const element = document.createElement("pre");
            element.innerText = formatted;
            return element;
        },
    }),

    // pdf
    defineType({
        name: "PDF Document",
        extension: ".pdf",
        mime: "application/pdf",
        icon: "icon/file_pdf.svg",
        dataMode: "blob",
        newElement(src: Blob): HTMLElement {
            const element = document.createElement("embed");
            const uri = URL.createObjectURL(src);
            onFinalized(element, () => URL.revokeObjectURL(uri));
            element.src = uri;
            return element;
        },
    }),

    // text
    defineType({
        name: "Text Document",
        extension: ".txt",
        mime: "text/plain",
        icon: "icon/file_text.svg",
        dataMode: "buffer",
        newElement(src: Uint8Array): HTMLElement {
            const text = (new TextDecoder()).decode(src);
            const element = document.createElement("span");
            element.innerText = text;
            return element;
        },
    }),

    // video
    defineVideoType("MP4 Video", ".mp4", "video/mp4"),
    defineVideoType("Matroska Video", ".mkv", "video/matroska"),
    defineVideoType("WebM Video", ".webm", "video/webm"),
    defineVideoType("Ogg Video", ".ogv", "video/ogg"),
] as const);

//

export namespace FileType {

    export function unknown(): FileType {
        return FILE_TYPE_REGISTRY[``]!;
    }

    export function match(name: string): FileType {
        const ext = name.lastIndexOf('.');
        if (ext === -1 || name.indexOf('/', ext + 1) !== -1) return unknown();
        const exact = FILE_TYPE_REGISTRY[name.substring(ext)];
        if (exact) return exact;
        return unknown();
    }

}
