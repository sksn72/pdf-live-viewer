import assert from "node:assert/strict";
import test from "node:test";

import { searchPdfs } from "../client/manage.ts";

const pdf = (id: string, name: string) => ({
    id,
    name,
    currentVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    purgeAt: null,
});

const tree = {
    folders: [
        {
            id: "f1",
            name: "契約",
            folders: [
                {
                    id: "f2",
                    name: "2026",
                    folders: [],
                    pdfs: [pdf("p2", "契約書_v2.pdf")],
                },
            ],
            pdfs: [pdf("p1", "見積書.PDF")],
        },
    ],
    pdfs: [pdf("p3", "ルート契約.pdf")],
};

test("searchPdfs は全フォルダを横断して部分一致で探す", () => {
    const hits = searchPdfs(tree, "契約");
    assert.deepEqual(
        hits.map((h) => [h.pdf.id, h.path]),
        [
            ["p3", []],
            ["p2", ["契約", "2026"]],
        ],
    );
});

test("searchPdfs は英字の大文字小文字を区別しない", () => {
    assert.deepEqual(
        searchPdfs(tree, "v2.pdf").map((h) => h.pdf.id),
        ["p2"],
    );
});

test("searchPdfs は空・空白のみ・該当なしで空配列", () => {
    assert.deepEqual(searchPdfs(tree, ""), []);
    assert.deepEqual(searchPdfs(tree, "  "), []);
    assert.deepEqual(searchPdfs(tree, "無い名前"), []);
});
