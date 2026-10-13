import wrauz from "../src";

//

test("empty", async () => {
    const empty = new Uint8Array(22);
    empty.set([ 0x50, 0x4B, 0x05, 0x06 ], 0); // EOCB

    const zf = await wrauz(empty);
    expect(zf.entries.length).toBe(0);
    expect(zf.originalEntries.length).toBe(0);
});

test("minecraft", async () => {
    // Open the Minecraft 26.3 client JAR as a ZIP
    const url = `https://piston-data.mojang.com/v1/objects/e877b6a07acd633fb3bb475002175cec036e7b87/client.jar`;
    const zf = await wrauz(url, {
        maxRetries: 10,
        filter(n: string) {
            return n.startsWith("assets/minecraft/lang/");
        }
    });

    // Get the en_us.json file
    const en = zf.entry("assets/minecraft/lang/en_us.json");
    if (!en) throw new Error(`en_us.json not found`);

    // Read the en_us.json file and parse it as JSON
    const text = await zf.read(en, "utf8");
    JSON.parse(text);
}, 120_000);
