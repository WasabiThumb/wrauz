<script lang="ts">
    import wrauz, {type ZipFileSource} from "wrauz";
    import DemoNavigator from "./DemoNavigator.svelte";
    import {initDemoContext} from "../lib/demoContext.svelte.ts";
    import DemoEntryList from "./DemoEntryList.svelte";
    import DemoEntryCard from "./DemoEntryCard.svelte";

    //

    const ctx = initDemoContext();

    const loadZipFile = (() => {
        let lastController: AbortController | null = null;
        return (async (src: ZipFileSource): Promise<void> => {
            const controller = new AbortController();
            if (lastController) lastController!.abort();
            lastController = controller;

            let ok: boolean = false;
            ctx.loading = true;
            try {
                const f = await wrauz(src, { signal: controller.signal });
                ok = true;
                ctx.path = "";
                ctx.file = f;
            } catch (e) {
                console.warn(`failed to load zip file`, e);
            } finally {
                if (!ok) ctx.file = null;
                ctx.loading = false;
            }
        });
    })();

    interface ActionSpec {
        readonly title: string;
        apply(): void;
    }

    const actions = [
        {
            title: "Load Sample",
            apply() {
                loadZipFile(`data/sample.zip`);
            }
        } as ActionSpec,
        {
            title: "Load File",
            apply() {
                const abort = new AbortController();
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".zip,.jar,application/zip,application/x-zip-compressed";
                input.style.display = "none";
                input.addEventListener("change", () => {
                    abort.abort();
                    document.body.removeChild(input);
                    const { files } = input;
                    if (!files || files.length !== 1) return;
                    const file = files.item(0);
                    if (!file) return;
                    loadZipFile(file);
                }, { signal: abort.signal, once: true });
                input.addEventListener("cancel", () => {
                    abort.abort();
                    document.body.removeChild(input);
                }, { signal: abort.signal, once: true });
                document.body.appendChild(input);
                input.click();
            }
        } as ActionSpec,
        {
            title: "Load URL",
            apply() {
                const url = prompt("Enter a URL");
                if (!url) return;
                loadZipFile(url);
            }
        } as ActionSpec,
    ] as const;
</script>

<div class="flex flex-col md:flex-row gap-4">
    <div class=" bg-mauve-400 text-mauve-800
        dark:bg-mauve-800 dark:text-white
        text-center
        p-4 rounded-lg
        md:min-w-lg xl:min-w-2xl">
        <h1>wrauz demo</h1>
        <p class="pb-4 text-xs italic opacity-80">
            (<a href="https://github.com/WasabiThumb/wrauz" target="_blank" class="underline">
                wrauz↗
            </a> is a random-access unzip library)
        </p>
        <div class="flex flex-col">
            <div class="flex flex-row justify-center pb-2 gap-4 transition-opacity duration-200 select-none
                        data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:*:pointer-events-none"
                 data-disabled={ctx.loading}>
                {#each actions as action}
                    <button onclick={() => action.apply()} class="inline-block
                bg-mauve-500 hover:bg-mauve-600 text-mauve-900
                dark:text-white dark:bg-mauve-700 dark:hover:bg-mauve-500
                transition-colors duration-200 ease-in-out
                 p-2 pl-4 pr-4 rounded-lg text-sm">
                        {action.title}
                    </button>
                {/each}
            </div>
            <DemoNavigator/>
            <DemoEntryList/>
        </div>
    </div>
    {#if ctx.selection !== null}
        <div class="bg-mauve-500 text-mauve-800
                    dark:bg-mauve-700 dark:text-white p-4 rounded-lg min-h-96 md:w-64 lg:w-96 xl:w-lg relative">
            <DemoEntryCard file={ctx.file!} entry={ctx.selection!}/>
        </div>
    {/if}
</div>
