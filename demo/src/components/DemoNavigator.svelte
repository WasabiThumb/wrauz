<script lang="ts">
    import {getDemoContext} from "../lib/demoContext.svelte.ts";

    //

    const ctx = getDemoContext();
    let input: HTMLInputElement;
    let loading: boolean = $derived(ctx.loading);
    let rawPath: string = $state(ctx.path);
    let freeTruth: boolean = false;

    function coerceToValidPath(p: string): string | null {
        if (p.length === 0) return "";
        const { file } = ctx;
        if (!file) return null;
        const normalized = p.endsWith("/") ? p : `${p}/`;
        if (!file.entry(normalized)) return null;
        return normalized;
    }

    function upPath(): void {
        const path = ctx.path;
        const len = path.length;
        if (len < 2) return;
        const idx = path.lastIndexOf("/", len - 2);
        ctx.path = idx <= 0 ? "" : path.substring(0, idx + 1);
    }

    // Apply path to rawPath
    $effect(() => {
        if (freeTruth) return;
        freeTruth = true;
        try {
            rawPath = ctx.path;
        } finally {
            freeTruth = false;
        }
    });

    // Apply rawPath to path
    $effect(() => {
        if (freeTruth) return;
        freeTruth = true;
        try {
            const coerced = coerceToValidPath(rawPath);
            if (null === coerced) {
                input.setAttribute("data-invalid", "");
                return;
            }
            input.removeAttribute("data-invalid");
            ctx.path = coerced;
        } finally {
            freeTruth = false;
        }
    });
</script>

<div class="flex flex-row gap-2
            data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed
            data-[disabled=true]:*:pointer-events-none
            transition-opacity duration-200" data-disabled={loading}>
    <button class="bg-mauve-500 hover:bg-mauve-600 text-mauve-900
            dark:text-white dark:bg-mauve-700 dark:hover:bg-mauve-500
            transition-colors duration-200 ease-in-out select-none
            p-2 pl-3 pr-3 rounded-lg text-sm font-bold" title="Up" aria-label="Up" onclick={upPath}>
        ↥
    </button>
    <input bind:this={input} type="text" bind:value={rawPath}
            class="grow data-invalid:text-rose-500 pl-2 pr-2 bg-mauve-300 dark:bg-mauve-900 rounded-lg">
</div>
