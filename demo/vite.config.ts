import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

//

export default defineConfig({
    base: !process.env["GITHUB_PAGES"] ? "/" : "/wrauz/",
    build: {
        target: "esnext",
    },
    plugins: [
        tailwindcss(),
        svelte(),
    ],
});
