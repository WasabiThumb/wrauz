<script lang="ts">
    import {fade} from "svelte/transition";
    import type {ZipFile, ZipEntry} from "wrauz";
    import {FileType} from "../lib/fileType.ts";

    const {
        file,
        entry
    }: {
        file: ZipFile,
        entry: ZipEntry
    } = $props();

    const supportsFilesystem = "showSaveFilePicker" in window;
    let fileType: FileType = $derived(FileType.match(entry.name));
    let downloadInProgress: boolean = $state(false);
    let baseName: string = $derived.by(() => {
        const { name } = entry;
        const idx = name.lastIndexOf('/');
        if (idx === -1) return name;
        return name.substring(idx + 1);
    });

    const SIZE_FORMAT_LUT = [
        { suffix: "B", divisor: 1, precision: 2 },
        { suffix: "B", divisor: 1, precision: 1 },
        { suffix: "B", divisor: 1, precision: 0 },
        { suffix: "KB", divisor: 1_000, precision: 2 },
        { suffix: "KB", divisor: 1_000, precision: 1 },
        { suffix: "KB", divisor: 1_000, precision: 0 },
        { suffix: "MB", divisor: 1_000_000, precision: 2 },
        { suffix: "MB", divisor: 1_000_000, precision: 1 },
        { suffix: "MB", divisor: 1_000_000, precision: 0 },
        { suffix: "GB", divisor: 1_000_000_000, precision: 2 },
        { suffix: "GB", divisor: 1_000_000_000, precision: 1 },
        { suffix: "GB", divisor: 1_000_000_000, precision: 0 },
        { suffix: "TB", divisor: 1_000_000_000_000, precision: 2 },
        { suffix: "TB", divisor: 1_000_000_000_000, precision: 1 },
        { suffix: "TB", divisor: 1_000_000_000_000, precision: 0 },
    ] as const;

    function formatSize(size: number): string {
        const info = size < 1000 ? SIZE_FORMAT_LUT[0] :
            SIZE_FORMAT_LUT[Math.min(SIZE_FORMAT_LUT.length - 1, Math.floor(Math.log10(size)))]!;
        let text: string = (size / info.divisor).toFixed(info.precision);
        const match = /^(\d+(?:\.\d*[1-9])?)/.exec(text); // trim unnecessary zeros
        if (match) text = match[1]!;
        return `${text} ${info.suffix}`;
    }

    async function doDownloadWithFilesystem(): Promise<void> {
        //@ts-ignore
        const handle: FileSystemFileHandle = await window.showSaveFilePicker({ suggestedName: baseName, types: [ { description: fileType.name, accept: { [fileType.mime]: [fileType.extension] } } ] });
        const rd = await file.read(entry, "stream");
        let ok: boolean = false;
        try {
            const wr = await handle.createWritable();
            ok = true;
            await rd.pipeTo(wr);
        } finally {
            if (!ok) await rd.cancel();
        }
    }

    async function readAllChunks(rd: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>[]> {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        try {
            const reader = rd.getReader();
            try {
                let next;
                while (true) {
                    next = await reader.read();
                    if (next.done) break;
                    chunks.push(next.value as Uint8Array<ArrayBuffer>);
                }
                return chunks;
            } finally {
                await reader.cancel();
            }
        } finally {
            try {
                await rd.cancel();
            } catch (ignored) { }
        }
    }

    async function doDownload(): Promise<void> {
        if (supportsFilesystem) return doDownloadWithFilesystem();

        // Collect to Blob
        const chunks = await readAllChunks(await file.read(entry) as ReadableStream<Uint8Array<ArrayBuffer>>);
        const blob = new Blob(chunks, { type: fileType.mime });

        // Vend a data URI
        const uri = URL.createObjectURL(blob);
        try {
            // Click an ephemeral anchor tag
            const a = document.createElement("a");
            a.href = uri;
            a.download = baseName;
            a.style.display = "none";
            document.body.appendChild(a);
            try {
                a.click();
            } finally {
                document.body.removeChild(a);
            }
        } finally {
            URL.revokeObjectURL(uri);
        }
    }

    function download(): void {
        if (downloadInProgress) return;
        downloadInProgress = true;
        doDownload()
            .catch((e) => console.warn("failed to download file", e))
            .finally(() => downloadInProgress = false);
    }

    // Preview
    let previewContainer: HTMLElement;
    let previewText: string = $state("");

    async function loadPreview(
        file: ZipFile,
        entry: ZipEntry,
        type: FileType,
        signal: AbortSignal
    ): Promise<HTMLElement> {
        switch (type.dataMode) {
            case "blob":
                const chunks = await readAllChunks(await file.read(entry) as ReadableStream<Uint8Array<ArrayBuffer>>);
                if (signal.aborted) throw new Error(`aborted`);
                const blob = new Blob(chunks, { type: type.mime });
                return type.newElement(blob);
            case "buffer":
                const buffer = await file.read(entry, "bytes");
                if (signal.aborted) throw new Error(`aborted`);
                return type.newElement(buffer);
            default:
                throw new Error(`Unusable data mode: ${type.dataMode}`);
        }
    }

    $effect(() => {
        const type = fileType;
        if (type.dataMode === "none") {
            previewText = "No preview available";
            return;
        }

        if (entry.size > 500_000_000) {
            previewText = "File is large (>500M), not loading preview";
            return;
        }

        const controller = new AbortController();
        let addedElement: HTMLElement | null = null;

        previewText = "Loading preview";
        loadPreview(file, entry, type, controller.signal)
            .then((e) => {
                if ("src" in e) {
                    e.style.width = `100%`;
                    e.style.height = `100%`;
                    e.style.objectFit = `contain`;
                    e.style.objectPosition = `center center`;
                    e.style.imageRendering = `pixelated`;
                }
                previewText = "";
                previewContainer.appendChild(e);
                addedElement = e;
            })
            .catch((e) => {
                console.error(e);
                previewText = "Failed to load preview";
            });

        return (() => {
            controller.abort();
            if (addedElement) addedElement.remove();
        });
    });
</script>

<div class="absolute top-0 left-0 w-full h-full p-4 flex flex-col">
    <h2 class="font-bold text-sm">
        <span class="flex flex-row justify-center content-center items-center gap-1">
            <img title={fileType.name} alt={fileType.name} src={fileType.icon} aria-hidden="true" class="h-4 dark:invert"/>
            <span>{entry.name}</span>
        </span>
    </h2>
    <p class="text-center text-xs">{formatSize(entry.size)}</p>
    <div class="grow p-4 mt-2 mb-2 flex items-center justify-center content-center relative">
        <div class="absolute top-0 left-0 w-full h-full overflow-auto p-4" bind:this={previewContainer}></div>
        {#if previewText.length !== 0}
            <span class="text-sm opacity-50 select-none">{previewText}</span>
        {/if}
    </div>
    {#if downloadInProgress}
        <p class="text-center text-xs pt-2 text-amber-300" transition:fade={{ duration: 200 }}>
            Your file is downloading, please wait...
        </p>
    {/if}
    <div class="flex flex-row justify-center items-center content-center">
        <button class="bg-mauve-400 hover:bg-mauve-600 text-mauve-900
            dark:text-white dark:bg-mauve-600 dark:hover:bg-mauve-500
            transition-colors duration-200 ease-in-out select-none cursor-pointer
            p-2 pl-4 pr-4 rounded-lg text-sm font-bold" onclick={download} title="Download">
            Download
        </button>
    </div>
    {#if !supportsFilesystem && entry.size >= 100_000_000}
        <p class="text-center text-xs pt-2 text-rose-400">
            <span class="font-bold">WARNING!</span> Your browser does not support
            the <a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker#browser_compatibility" target="_blank" class="underline">
            Filesystem API</a> for this large file, so downloading it will require
            significant memory usage. The browser may become unresponsive or crash.
        </p>
    {/if}
</div>
