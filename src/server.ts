import path from "node:path";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const { server } = createApp({ dataDir });

server.listen(port, "0.0.0.0", () => {
    console.log(`pdf-live-viewer: http://0.0.0.0:${port}  (data: ${dataDir})`);
});
