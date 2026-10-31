import crypto from "node:crypto";
import {
    createReadStream,
    existsSync,
    mkdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";

import type { DatabaseSync } from "node:sqlite";

import { validateStrokes } from "../client/sketch-model.ts";
import * as db from "./db.ts";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);
const MAX_JSON = 8 * 1024 * 1024;
const TRASH_DAYS = Number(process.env.TRASH_DAYS ?? 7);

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".wasm": "application/wasm",
    ".ttf": "font/ttf",
    ".pfb": "application/octet-stream",
    ".bcmap": "application/octet-stream",
};

class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": buf.length,
    });
    res.end(buf);
}

async function readBody(req: http.IncomingMessage, limit = MAX_UPLOAD) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > limit) throw new HttpError(413, "body too large");
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage) {
    const raw = (await readBody(req, MAX_JSON)).toString("utf8") || "{}";
    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        throw new HttpError(400, "invalid json");
    }
    if (typeof body !== "object" || body === null)
        throw new HttpError(400, "invalid json");
    return body as Record<string, unknown>;
}

function assertPdf(buf: Buffer) {
    if (buf.length < 8 || buf.subarray(0, 5).toString("latin1") !== "%PDF-")
        throw new HttpError(400, "not a PDF");
}

function serveFile(
    res: http.ServerResponse,
    base: string,
    rel: string,
    cache: string,
) {
    const file = path.resolve(base, `.${path.posix.normalize(rel)}`);
    if (!file.startsWith(base + path.sep))
        throw new HttpError(403, "forbidden");
    if (!existsSync(file) || !statSync(file).isFile())
        throw new HttpError(404, "not found");
    res.writeHead(200, {
        "Content-Type":
            MIME[path.extname(file).toLowerCase()] ??
            "application/octet-stream",
        "Cache-Control": cache,
        "Content-Length": statSync(file).size,
    });
    createReadStream(file).pipe(res);
}

export function createApp({ dataDir }: { dataDir: string }) {
    mkdirSync(dataDir, { recursive: true });
    const database = db.openDb(path.join(dataDir, "app.db"));
    const clients = new Set<http.ServerResponse>();

    const broadcast = (payload: Record<string, unknown> & { type: string }) => {
        const msg = `data: ${JSON.stringify(payload)}\n\n`;
        for (const res of clients) res.write(msg);
    };

    function sse(req: http.IncomingMessage, res: http.ServerResponse) {
        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        res.write("retry: 3000\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
    }

    function writePdf(id: string, version: number, buf: Buffer) {
        mkdirSync(path.join(dataDir, id), { recursive: true });
        writeFileSync(path.join(dataDir, id, `v${version}.pdf`), buf);
    }

    function folderOrNull(id: string | null) {
        if (!id) return null;
        if (!db.getFolder(database, id))
            throw new HttpError(400, "unknown folder");
        return id;
    }

    function cleanName(raw: unknown, max: number) {
        const name = typeof raw === "string" ? raw.trim().slice(0, max) : "";
        if (!name) throw new HttpError(400, "name required");
        return name;
    }

    async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url ?? "/", "http://localhost");
        const p = url.pathname;
        const m = req.method;

        if (p === "/api/health") return json(res, 200, { ok: true });
        if (p === "/api/events") return sse(req, res);

        if (p === "/api/tree" && m === "GET")
            return json(res, 200, db.listTree(database));

        if (p === "/api/pdfs" && m === "GET")
            return json(res, 200, db.listActive(database));

        if (p === "/api/folders" && m === "POST") {
            const id = crypto.randomUUID();
            const name = cleanName(url.searchParams.get("name"), 100);
            const row = db.createFolder(database, {
                id,
                name,
                parentId: folderOrNull(url.searchParams.get("parent")),
            });
            broadcast({ type: "changed", id });
            return json(res, 201, row);
        }

        if (p === "/api/pdfs" && m === "POST") {
            const name = (url.searchParams.get("name") ?? "untitled.pdf").slice(
                0,
                200,
            );
            const folderId = folderOrNull(url.searchParams.get("folder"));
            const buf = await readBody(req);
            assertPdf(buf);
            const id = crypto.randomUUID();
            writePdf(id, 1, buf);
            const row = db.createPdf(database, { id, name, folderId });
            broadcast({ type: "changed", id });
            return json(res, 201, row);
        }

        if (p === "/api/trash" && m === "GET")
            return json(res, 200, db.listTrash(database));

        const mFolder = p.match(/^\/api\/folders\/([\w-]+)$/);
        if (mFolder && m === "PATCH") {
            if (!db.getFolder(database, mFolder[1]))
                throw new HttpError(404, "not found");
            const name = cleanName((await readJson(req)).name, 100);
            db.renameFolder(database, mFolder[1], name);
            broadcast({ type: "changed", id: mFolder[1] });
            return json(res, 200, { ok: true });
        }

        if (mFolder && m === "DELETE") {
            if (!db.getFolder(database, mFolder[1]))
                throw new HttpError(404, "not found");
            if (!db.deleteFolder(database, mFolder[1]))
                throw new HttpError(409, "folder not empty");
            broadcast({ type: "changed", id: mFolder[1] });
            return json(res, 200, { ok: true });
        }

        const mVer = p.match(/^\/api\/pdfs\/([\w-]+)\/versions$/);
        if (mVer && m === "POST") {
            const id = mVer[1];
            const pdf = db.getPdf(database, id);
            if (!pdf || pdf.deletedAt) throw new HttpError(404, "not found");
            const buf = await readBody(req);
            assertPdf(buf);
            const next = pdf.currentVersion + 1;
            writePdf(id, next, buf);
            const version = db.addVersion(database, id);
            broadcast({ type: "changed", id });
            return json(res, 201, { id, version });
        }

        const mFile = p.match(/^\/api\/pdfs\/([\w-]+)\/versions\/(\d+)$/);
        if (mFile && m === "GET") {
            const file = path.join(dataDir, mFile[1], `v${mFile[2]}.pdf`);
            if (!existsSync(file)) throw new HttpError(404, "not found");
            res.writeHead(200, {
                "Content-Type": "application/pdf",
                "Content-Length": statSync(file).size,
                "Cache-Control": "private, max-age=31536000, immutable",
            });
            return createReadStream(file).pipe(res);
        }

        if (mFile && m === "DELETE") {
            const id = mFile[1];
            const version = Number(mFile[2]);
            const pdf = db.getPdf(database, id);
            if (!pdf || pdf.deletedAt) throw new HttpError(404, "not found");
            const result = db.deleteVersion(database, id, version);
            if (result.status === "missing")
                throw new HttpError(404, "not found");
            if (result.status === "last")
                throw new HttpError(409, "cannot delete the last version");
            rmSync(path.join(dataDir, id, `v${version}.pdf`), { force: true });
            broadcast({ type: "changed", id });
            return json(res, 200, {
                ok: true,
                currentVersion: result.currentVersion,
            });
        }

        const mCopy = p.match(
            /^\/api\/pdfs\/([\w-]+)\/versions\/(\d+)\/sketches\/copy$/,
        );
        if (mCopy && m === "POST") {
            const body = await readJson(req);
            const pages = Array.isArray(body.pages)
                ? body.pages.map(Number).filter(Number.isInteger)
                : [];
            db.copySketches(
                database,
                mCopy[1],
                Number(body.from),
                Number(mCopy[2]),
                pages,
            );
            res.writeHead(204);
            return res.end();
        }

        const mSketches = p.match(
            /^\/api\/pdfs\/([\w-]+)\/versions\/(\d+)\/sketches$/,
        );
        if (mSketches && m === "GET") {
            return json(res, 200, {
                pages: db.getSketches(
                    database,
                    mSketches[1],
                    Number(mSketches[2]),
                ),
            });
        }

        const mSketch = p.match(
            /^\/api\/pdfs\/([\w-]+)\/versions\/(\d+)\/sketches\/(\d+)$/,
        );
        if (mSketch && m === "PUT") {
            const body = await readJson(req);
            if (!validateStrokes(body.strokes))
                throw new HttpError(400, "invalid strokes");
            db.putSketch(
                database,
                mSketch[1],
                Number(mSketch[2]),
                Number(mSketch[3]),
                body.strokes,
            );
            broadcast({
                type: "sketch",
                id: mSketch[1],
                version: Number(mSketch[2]),
                page: Number(mSketch[3]),
                strokes: body.strokes,
            });
            res.writeHead(204);
            return res.end();
        }

        const mOne = p.match(/^\/api\/pdfs\/([\w-]+)$/);
        if (mOne && m === "GET") {
            const pdf = db.getPdf(database, mOne[1]);
            if (!pdf || pdf.deletedAt) throw new HttpError(404, "not found");
            return json(res, 200, {
                ...pdf,
                versions: db.listVersions(database, mOne[1]),
            });
        }

        if (mOne && m === "PATCH") {
            const pdf = db.getPdf(database, mOne[1]);
            if (!pdf || pdf.deletedAt) throw new HttpError(404, "not found");
            const body = await readJson(req);
            if (body.folderId !== null && typeof body.folderId !== "string")
                throw new HttpError(400, "folderId required");
            db.setPdfFolder(
                database,
                mOne[1],
                folderOrNull(body.folderId as string | null),
            );
            broadcast({ type: "changed", id: mOne[1] });
            return json(res, 200, { ok: true });
        }

        if (mOne && m === "DELETE") {
            if (!db.getPdf(database, mOne[1]))
                throw new HttpError(404, "not found");
            db.softDelete(database, mOne[1], TRASH_DAYS);
            broadcast({ type: "changed", id: mOne[1] });
            return json(res, 200, { ok: true });
        }

        const mRestore = p.match(/^\/api\/pdfs\/([\w-]+)\/restore$/);
        if (mRestore && m === "POST") {
            db.restore(database, mRestore[1]);
            broadcast({ type: "changed", id: mRestore[1] });
            return json(res, 200, { ok: true });
        }

        const mPurge = p.match(/^\/api\/pdfs\/([\w-]+)\/purge$/);
        if (mPurge && m === "DELETE") {
            db.hardDelete(database, mPurge[1]);
            rmSync(path.join(dataDir, mPurge[1]), {
                recursive: true,
                force: true,
            });
            broadcast({ type: "changed", id: mPurge[1] });
            return json(res, 200, { ok: true });
        }

        if (p.startsWith("/api/")) throw new HttpError(404, "no route");

        if (p.startsWith("/vendor/pdfjs/")) {
            return serveFile(
                res,
                path.join(ROOT, "node_modules/pdfjs-dist"),
                p.slice("/vendor/pdfjs".length),
                "public, max-age=3600",
            );
        }
        if (p.startsWith("/vendor/pdf-lib/")) {
            return serveFile(
                res,
                path.join(ROOT, "node_modules/pdf-lib/dist"),
                p.slice("/vendor/pdf-lib".length),
                "public, max-age=3600",
            );
        }
        return serveFile(
            res,
            PUBLIC_DIR,
            p === "/" ? "/index.html" : p,
            "no-cache",
        );
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch((err: HttpError) => {
            if (!err.status || err.status >= 500) console.error(err);
            if (res.headersSent) return res.end();
            json(res, err.status ?? 500, { error: err.message });
        });
    });

    const timer = setInterval(() => {
        for (const id of db.purgeExpired(database))
            rmSync(path.join(dataDir, id), { recursive: true, force: true });
    }, 3600_000);
    timer.unref();

    // プロキシに切られないよう、25秒ごとにコメント行を流す
    const ping = setInterval(() => {
        for (const res of clients) res.write(": ping\n\n");
    }, 25_000);
    ping.unref();

    return {
        server,
        db: database as DatabaseSync,
        dataDir,
        broadcast,
        close() {
            clearInterval(timer);
            clearInterval(ping);
            for (const res of clients) res.end();
            return new Promise<void>((resolve) =>
                server.close(() => {
                    database.close();
                    resolve();
                }),
            );
        },
    };
}
