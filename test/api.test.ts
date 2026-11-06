import assert from "node:assert/strict";
import test from "node:test";
import type { PdfRow, Tree } from "../src/db.ts";
import { nextEvent, PDF_BYTES, startServer } from "./helpers.ts";

const STROKES = [
    {
        c: "#e11d48",
        w: 0.0036,
        e: false,
        pts: [
            [0.1, 0.2, 0.5],
            [0.2, 0.3, 0.5],
        ],
    },
];

async function upload(base: string, name = "a.pdf", folder = "") {
    const res = await fetch(
        `${base}/api/pdfs?name=${encodeURIComponent(name)}&folder=${folder}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: PDF_BYTES,
        },
    );
    return (await res.json()) as PdfRow;
}

async function mkFolder(base: string, name: string, parent = "") {
    const res = await fetch(
        `${base}/api/folders?name=${encodeURIComponent(name)}&parent=${parent}`,
        {
            method: "POST",
        },
    );
    return (await res.json()) as {
        id: string;
        name: string;
        parentId: string | null;
    };
}

test("GET /api/health は 200 と {ok:true}", async () => {
    const s = await startServer();
    try {
        const res = await fetch(`${s.base}/api/health`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
    } finally {
        await s.stop();
    }
});

test("アップロードすると一覧に載り、版1になる", async () => {
    const s = await startServer();
    try {
        const up = await fetch(
            `${s.base}/api/pdfs?name=${encodeURIComponent("図面 A.pdf")}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/pdf" },
                body: PDF_BYTES,
            },
        );
        assert.equal(up.status, 201);
        const created = (await up.json()) as PdfRow;
        assert.equal(created.currentVersion, 1);
        assert.equal(created.name, "図面 A.pdf");
        assert.equal(created.folderId, null);

        const list = (await (
            await fetch(`${s.base}/api/pdfs`)
        ).json()) as PdfRow[];
        assert.equal(list.length, 1);
        assert.equal(list[0].id, created.id);
    } finally {
        await s.stop();
    }
});

test("PDFでないバイト列は 400", async () => {
    const s = await startServer();
    try {
        const res = await fetch(`${s.base}/api/pdfs?name=x.pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: Buffer.from("hello"),
        });
        assert.equal(res.status, 400);
    } finally {
        await s.stop();
    }
});

test("版を追加すると version 2 になり、SSE で changed が飛ぶ", async () => {
    const s = await startServer();
    try {
        const created = await upload(s.base);

        const events = await fetch(`${s.base}/api/events`);
        const reader = (events.body as ReadableStream<Uint8Array>).getReader();

        const res = await fetch(`${s.base}/api/pdfs/${created.id}/versions`, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: PDF_BYTES,
        });
        assert.equal(res.status, 201);
        assert.deepEqual(await res.json(), { id: created.id, version: 2 });

        const msg = await nextEvent(reader);
        assert.deepEqual(msg, { type: "changed", id: created.id });
        await reader.cancel();
    } finally {
        await s.stop();
    }
});

test("版のバイト列と版一覧が取れる", async () => {
    const s = await startServer();
    try {
        const created = await upload(s.base);

        const file = await fetch(`${s.base}/api/pdfs/${created.id}/versions/1`);
        assert.equal(file.status, 200);
        assert.equal(file.headers.get("content-type"), "application/pdf");
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF_BYTES);

        const one = (await (
            await fetch(`${s.base}/api/pdfs/${created.id}`)
        ).json()) as PdfRow & {
            versions: { version: number }[];
        };
        assert.equal(one.currentVersion, 1);
        assert.deepEqual(
            one.versions.map((v) => v.version),
            [1],
        );
    } finally {
        await s.stop();
    }
});

test("未知の版は 404", async () => {
    const s = await startServer();
    try {
        const created = await upload(s.base);
        assert.equal(
            (await fetch(`${s.base}/api/pdfs/${created.id}/versions/9`)).status,
            404,
        );
    } finally {
        await s.stop();
    }
});

test("ゴミ箱 → 復元 → 完全削除", async () => {
    const s = await startServer();
    try {
        const created = await upload(s.base);

        assert.equal(
            (
                await fetch(`${s.base}/api/pdfs/${created.id}`, {
                    method: "DELETE",
                })
            ).status,
            200,
        );
        assert.deepEqual(await (await fetch(`${s.base}/api/pdfs`)).json(), []);
        assert.equal(
            (await fetch(`${s.base}/api/pdfs/${created.id}`)).status,
            404,
        );
        assert.equal(
            ((await (await fetch(`${s.base}/api/trash`)).json()) as PdfRow[])
                .length,
            1,
        );

        assert.equal(
            (
                await fetch(`${s.base}/api/pdfs/${created.id}/restore`, {
                    method: "POST",
                })
            ).status,
            200,
        );
        assert.equal(
            ((await (await fetch(`${s.base}/api/pdfs`)).json()) as PdfRow[])
                .length,
            1,
        );

        assert.equal(
            (
                await fetch(`${s.base}/api/pdfs/${created.id}/purge`, {
                    method: "DELETE",
                })
            ).status,
            200,
        );
        assert.deepEqual(await (await fetch(`${s.base}/api/trash`)).json(), []);
        assert.equal(
            (await fetch(`${s.base}/api/pdfs/${created.id}`)).status,
            404,
        );
    } finally {
        await s.stop();
    }
});

test("スケッチを PUT して GET できる", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);

        const put = await fetch(
            `${s.base}/api/pdfs/${c.id}/versions/1/sketches/2`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ strokes: STROKES }),
            },
        );
        assert.equal(put.status, 204);

        const got = (await (
            await fetch(`${s.base}/api/pdfs/${c.id}/versions/1/sketches`)
        ).json()) as {
            pages: Record<string, unknown>;
        };
        assert.deepEqual(got.pages, { 2: STROKES });
    } finally {
        await s.stop();
    }
});

test("不正なスケッチは 400", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);
        const res = await fetch(
            `${s.base}/api/pdfs/${c.id}/versions/1/sketches/1`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ strokes: [{ c: "red" }] }),
            },
        );
        assert.equal(res.status, 400);
    } finally {
        await s.stop();
    }
});

test("テキスト混在スケッチを PUT して GET できる", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);
        const annotations = [
            {
                c: "#e11d48",
                w: 0.0036,
                e: false,
                pts: [
                    [0.1, 0.2, 0.5],
                    [0.2, 0.3, 0.5],
                ],
            },
            {
                t: "text",
                id: "a1",
                x: 0.1,
                y: 0.1,
                s: 0.02,
                c: "#1f2937",
                text: "混在",
            },
        ];
        const put = await fetch(
            `${s.base}/api/pdfs/${c.id}/versions/1/sketches/1`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ strokes: annotations }),
            },
        );
        assert.equal(put.status, 204);
        const got = (await (
            await fetch(`${s.base}/api/pdfs/${c.id}/versions/1/sketches`)
        ).json()) as { pages: Record<string, unknown> };
        assert.deepEqual(got.pages, { 1: annotations });
    } finally {
        await s.stop();
    }
});

test("s が範囲外のテキストは 400", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);
        const res = await fetch(
            `${s.base}/api/pdfs/${c.id}/versions/1/sketches/1`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    strokes: [
                        {
                            t: "text",
                            id: "a",
                            x: 0.1,
                            y: 0.1,
                            s: 0.07 + 0.06,
                            c: "#1f2937",
                            text: "x",
                        },
                    ],
                }),
            },
        );
        assert.equal(res.status, 400);
    } finally {
        await s.stop();
    }
});

test("前版からページ指定でコピーできる", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);
        await fetch(`${s.base}/api/pdfs/${c.id}/versions/1/sketches/1`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ strokes: STROKES }),
        });
        await fetch(`${s.base}/api/pdfs/${c.id}/versions`, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: PDF_BYTES,
        });
        const res = await fetch(
            `${s.base}/api/pdfs/${c.id}/versions/2/sketches/copy`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ from: 1, pages: [1] }),
            },
        );
        assert.equal(res.status, 204);
        const got = (await (
            await fetch(`${s.base}/api/pdfs/${c.id}/versions/2/sketches`)
        ).json()) as {
            pages: Record<string, unknown>;
        };
        assert.deepEqual(Object.keys(got.pages), ["1"]);
    } finally {
        await s.stop();
    }
});

test("フォルダを作ってPDFを入れると /api/tree に載る", async () => {
    const s = await startServer();
    try {
        const parent = await mkFolder(s.base, "図面");
        const child = await mkFolder(s.base, "2026", parent.id);
        const created = await upload(s.base, "a.pdf", child.id);
        assert.equal(created.folderId, child.id);

        const tree = (await (await fetch(`${s.base}/api/tree`)).json()) as Tree;
        assert.equal(tree.folders.length, 1);
        assert.equal(tree.folders[0].id, parent.id);
        assert.equal(tree.folders[0].folders[0].id, child.id);
        assert.equal(tree.folders[0].folders[0].pdfs[0].id, created.id);
        assert.deepEqual(tree.pdfs, []);
    } finally {
        await s.stop();
    }
});

test("中身のあるフォルダは削除できず、空にすれば消える", async () => {
    const s = await startServer();
    try {
        const folder = await mkFolder(s.base, "図面");
        const created = await upload(s.base, "a.pdf", folder.id);

        assert.equal(
            (
                await fetch(`${s.base}/api/folders/${folder.id}`, {
                    method: "DELETE",
                })
            ).status,
            409,
        );

        const moved = await fetch(`${s.base}/api/pdfs/${created.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: null }),
        });
        assert.equal(moved.status, 200);

        assert.equal(
            (
                await fetch(`${s.base}/api/folders/${folder.id}`, {
                    method: "DELETE",
                })
            ).status,
            200,
        );
        const tree = (await (await fetch(`${s.base}/api/tree`)).json()) as Tree;
        assert.deepEqual(tree.folders, []);
        assert.equal(tree.pdfs[0].id, created.id);
    } finally {
        await s.stop();
    }
});

test("版を削除すると一覧から消え、最新なら current が下がる", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);
        for (let i = 0; i < 2; i++) {
            await fetch(`${s.base}/api/pdfs/${c.id}/versions`, {
                method: "POST",
                headers: { "Content-Type": "application/pdf" },
                body: PDF_BYTES,
            });
        }

        const del = await fetch(`${s.base}/api/pdfs/${c.id}/versions/3`, {
            method: "DELETE",
        });
        assert.equal(del.status, 200);
        assert.deepEqual(await del.json(), { ok: true, currentVersion: 2 });

        const one = (await (
            await fetch(`${s.base}/api/pdfs/${c.id}`)
        ).json()) as PdfRow & {
            versions: { version: number }[];
        };
        assert.deepEqual(
            one.versions.map((v) => v.version),
            [2, 1],
        );
        assert.equal(one.currentVersion, 2);
        assert.equal(
            (await fetch(`${s.base}/api/pdfs/${c.id}/versions/3`)).status,
            404,
        );

        assert.equal(
            (
                await fetch(`${s.base}/api/pdfs/${c.id}/versions/9`, {
                    method: "DELETE",
                })
            ).status,
            404,
        );
    } finally {
        await s.stop();
    }
});

test("最後の1版は削除できない", async () => {
    const s = await startServer();
    try {
        const c = await upload(s.base);
        assert.equal(
            (
                await fetch(`${s.base}/api/pdfs/${c.id}/versions/1`, {
                    method: "DELETE",
                })
            ).status,
            409,
        );
        assert.equal(
            (await fetch(`${s.base}/api/pdfs/${c.id}/versions/1`)).status,
            200,
        );
    } finally {
        await s.stop();
    }
});

test("未知のフォルダ指定は 400", async () => {
    const s = await startServer();
    try {
        const res = await fetch(`${s.base}/api/folders?name=x&parent=nope`, {
            method: "POST",
        });
        assert.equal(res.status, 400);
        const created = await upload(s.base);
        const move = await fetch(`${s.base}/api/pdfs/${created.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: "nope" }),
        });
        assert.equal(move.status, 400);
    } finally {
        await s.stop();
    }
});

test("フォルダ名の変更が反映される", async () => {
    const s = await startServer();
    try {
        const folder = await mkFolder(s.base, "旧名");
        const res = await fetch(`${s.base}/api/folders/${folder.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "新名" }),
        });
        assert.equal(res.status, 200);
        const tree = (await (await fetch(`${s.base}/api/tree`)).json()) as Tree;
        assert.equal(tree.folders[0].name, "新名");
    } finally {
        await s.stop();
    }
});
