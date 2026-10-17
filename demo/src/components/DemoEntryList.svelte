<script lang="ts">
    import type {ZipEntry} from "wrauz";
    import {getDemoContext} from "../lib/demoContext.svelte.ts";
    import {FileType} from "../lib/fileType.ts";

    //

    const ctx = getDemoContext();
    const collator = new Intl.Collator([ "en" ]);
    let selectionToken: symbol | null = $state(null);

    // Entries

    interface ListEntry {
        readonly token: symbol;
        readonly name: string;
        readonly directory: boolean;
        readonly handle: ZipEntry;
    }

    const entries = $derived.by((): ListEntry[] => {
        const file = ctx.file;
        if (!file) return [];
        const path = ctx.path;
        const ret: ListEntry[] = [];
        for (const entry of file.list(path, false)) {
            const fullName = entry.name;
            const idx = fullName.indexOf('/', path.length);
            let name: string;
            let directory: boolean;
            if (idx === -1) {
                directory = false;
                name = fullName.substring(path.length);
            } else if (idx === fullName.length - 1) {
                directory = true;
                name = fullName.substring(path.length, idx);
            } else {
                continue;
            }
            ret.push({
                token: Symbol(`${fullName}`),
                name,
                directory,
                handle: entry,
            } as ListEntry);
        }
        ret.sort((a, b) => {
            const ad = a.directory;
            const bd = b.directory;
            if (ad !== bd) return Number(bd) - Number(ad);
            return collator.compare(a.name, b.name);
        });
        return ret;
    });

    function clickEntry(entry: ListEntry): void {
        if (entry.directory) {
            ctx.path = entry.handle.name;
            return;
        }
        const { token } = entry;
        selectionToken = token === selectionToken ? null : token;
    }

    function resolveEntryIcon(entry: ListEntry): string {
        if (entry.directory) return "icon/folder.svg";
        return FileType.match(entry.name).icon;
    }

    $effect(() => {
        let value: ZipEntry | null = null;
        const token = selectionToken;
        if (token) {
            const entry = entries.find((e) => e.token === token);
            if (entry) value = entry.handle;
        }
        ctx.selection = value;
    });
</script>

<div class="h-64 md:h-128 mt-2 overflow-x-hidden overflow-y-auto">
    <div class="flex flex-col">
        {#each entries as entry}
            <button onclick={() => clickEntry(entry)}
                    title={entry.name} data-selected={entry.token === selectionToken}
                    class="min-w-64 text-xs md:text-sm text-left cursor-pointer p-1 pl-2 pr-8 rounded-xl
                            flex flex-row justify-start content-center items-center gap-1.5 select-none
                            hover:bg-mauve-800/40 dark:hover:bg-mauve-600/40 group
                         data-[selected=true]:bg-mauve-800 data-[selected=true]:text-mauve-100
                           dark:data-[selected=true]:bg-mauve-600">
                <img alt="file" src={resolveEntryIcon(entry)} class="h-4 dark:invert group-data-[selected=true]:invert">
                <span class="grow">{entry.name}</span>
            </button>
        {/each}
    </div>
</div>
