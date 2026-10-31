import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.ts";

// テスト用の最小PDF（マジックバイトだけ満たせばよい）
export const PDF_BYTES = Buffer.from(
    "%PDF-1.4\n%\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
);

export async function startServer() {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pdflv-"));
    const app = createApp({ dataDir });
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}`;
    return {
        base,
        dataDir,
        db: app.db,
        stop: async () => {
            await app.close();
            await rm(dataDir, { recursive: true, force: true });
        },
    };
}

export async function nextEvent(
    reader: ReadableStreamDefaultReader<Uint8Array>,
) {
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed");
        buf += dec.decode(value, { stream: true });
        let i = buf.indexOf("\n\n");
        while (i >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (line)
                return JSON.parse(line.slice(6)) as {
                    type: string;
                    id?: string | null;
                };
            i = buf.indexOf("\n\n");
        }
    }
}
