import assert from "node:assert/strict";
import test from "node:test";
import {
    addVersion,
    copySketches,
    createFolder,
    createPdf,
    deleteFolder,
    deleteVersion,
    getPdf,
    getSketches,
    hardDelete,
    listActive,
    listTrash,
    listTree,
    listVersions,
    openDb,
    purgeExpired,
    putSketch,
    renameFolder,
    restore,
    setPdfFolder,
    softDelete,
} from "../src/db.ts";

const T = "2026-01-01T00:00:00.000Z";
const S = [
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
const fresh = () => openDb(":memory:");

test("createPdf は版1のPDFを作る", () => {
    const db = fresh();
    const p = createPdf(db, { id: "a1", name: "図面.pdf", now: T });
    assert.equal(p.currentVersion, 1);
    assert.equal(p.name, "図面.pdf");
    assert.equal(p.createdAt, T);
    assert.deepEqual(
        listActive(db).map((r) => r.id),
        ["a1"],
    );
});

test("存在しないIDは null", () => {
    assert.equal(getPdf(fresh(), "nope"), null);
});

test("addVersion は版番号を1つ積む", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    assert.equal(addVersion(db, "a1", "2026-01-02T00:00:00.000Z"), 2);
    assert.equal(getPdf(db, "a1")?.currentVersion, 2);
    assert.deepEqual(
        listVersions(db, "a1").map((r) => r.version),
        [2, 1],
    );
});

test("未知のIDへの addVersion は null", () => {
    assert.equal(addVersion(fresh(), "nope"), null);
});

test("softDelete は7日後の purge_at を入れ、一覧から消える", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    const purgeAt = softDelete(db, "a1", 7, T);
    assert.equal(purgeAt, "2026-01-08T00:00:00.000Z");
    assert.deepEqual(listActive(db), []);
    assert.equal(listTrash(db)[0].id, "a1");
});

test("restore で戻る", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    softDelete(db, "a1", 7, T);
    restore(db, "a1");
    assert.equal(listActive(db).length, 1);
    assert.equal(getPdf(db, "a1")?.deletedAt, null);
});

test("purgeExpired は期限到来分だけ消す", () => {
    const db = fresh();
    createPdf(db, { id: "old", name: "a.pdf", now: T });
    createPdf(db, { id: "new", name: "b.pdf", now: T });
    softDelete(db, "old", 7, "2026-01-01T00:00:00.000Z");
    softDelete(db, "new", 7, "2026-02-01T00:00:00.000Z");
    assert.deepEqual(purgeExpired(db, "2026-01-10T00:00:00.000Z"), ["old"]);
    assert.equal(getPdf(db, "old"), null);
    assert.notEqual(getPdf(db, "new"), null);
});

test("hardDelete はスケッチも消す", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    db.prepare(
        "INSERT INTO sketch (pdf_id,version,page,strokes,updated_at) VALUES (?,1,1,?,?)",
    ).run("a1", "[]", T);
    hardDelete(db, "a1");
    assert.equal(
        (db.prepare("SELECT count(*) AS c FROM sketch").get() as { c: number })
            .c,
        0,
    );
    assert.equal(getPdf(db, "a1"), null);
});

test("putSketch は同じキーを上書きする", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    putSketch(db, "a1", 1, 1, S, T);
    putSketch(db, "a1", 1, 1, [], T);
    assert.deepEqual(getSketches(db, "a1", 1), { 1: [] });
});

test("copySketches は指定ページだけ次版へ複製する", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    putSketch(db, "a1", 1, 1, S, T);
    putSketch(db, "a1", 1, 3, S, T);
    assert.equal(copySketches(db, "a1", 1, 2, [1, 2], T), 1);
    assert.deepEqual(
        Object.keys(getSketches(db, "a1", 2) as Record<string, unknown>),
        ["1"],
    );
});

test("listTree はフォルダとPDFを入れ子で返す", () => {
    const db = fresh();
    createFolder(db, { id: "f1", name: "図面", now: T });
    createFolder(db, { id: "f2", name: "2026", parentId: "f1", now: T });
    createPdf(db, { id: "p1", name: "a.pdf", folderId: "f1", now: T });
    createPdf(db, { id: "p2", name: "b.pdf", folderId: "f2", now: T });
    createPdf(db, { id: "p3", name: "c.pdf", now: T });

    const tree = listTree(db);
    assert.deepEqual(
        tree.folders.map((f) => f.id),
        ["f1"],
    );
    assert.deepEqual(
        tree.folders[0].folders.map((f) => f.id),
        ["f2"],
    );
    assert.deepEqual(
        tree.folders[0].pdfs.map((p) => p.id),
        ["p1"],
    );
    assert.deepEqual(
        tree.folders[0].folders[0].pdfs.map((p) => p.id),
        ["p2"],
    );
    assert.deepEqual(
        tree.pdfs.map((p) => p.id),
        ["p3"],
    );
});

test("削除したPDFは listTree に出ない", () => {
    const db = fresh();
    createPdf(db, { id: "p1", name: "a.pdf", now: T });
    softDelete(db, "p1", 7, T);
    assert.deepEqual(listTree(db).pdfs, []);
});

test("deleteFolder は空のときだけ消し、ゴミ箱のPDFはルートへ戻す", () => {
    const db = fresh();
    createFolder(db, { id: "f1", name: "図面", now: T });
    createFolder(db, { id: "f2", name: "2026", parentId: "f1", now: T });
    assert.equal(deleteFolder(db, "f1"), false);

    createPdf(db, { id: "p1", name: "a.pdf", folderId: "f1", now: T });
    assert.equal(deleteFolder(db, "f1"), false);

    softDelete(db, "p1", 7, T);
    setPdfFolder(db, "p1", "f1");
    assert.equal(deleteFolder(db, "f1"), false, "子フォルダが残っている");

    db.prepare("DELETE FROM folder WHERE id = ?").run("f2");
    assert.equal(deleteFolder(db, "f1"), true);
    assert.equal(getPdf(db, "p1")?.folderId, null);
});

test("deleteVersion は版を消し、最新版なら current を下げる", () => {
    const db = fresh();
    createPdf(db, { id: "a1", name: "x.pdf", now: T });
    addVersion(db, "a1");
    addVersion(db, "a1");
    putSketch(db, "a1", 3, 1, S, T);

    assert.deepEqual(deleteVersion(db, "a1", 3), {
        status: "ok",
        currentVersion: 2,
    });
    assert.equal(getPdf(db, "a1")?.currentVersion, 2);
    assert.deepEqual(
        listVersions(db, "a1").map((v) => v.version),
        [2, 1],
    );
    assert.deepEqual(getSketches(db, "a1", 3), {});

    assert.deepEqual(deleteVersion(db, "a1", 1), {
        status: "ok",
        currentVersion: 2,
    });
    assert.equal(deleteVersion(db, "a1", 2).status, "last");
    assert.equal(deleteVersion(db, "a1", 9).status, "missing");
    assert.equal(deleteVersion(db, "nope", 1).status, "missing");
});

test("renameFolder は名前を変える", () => {
    const db = fresh();
    createFolder(db, { id: "f1", name: "旧名", now: T });
    renameFolder(db, "f1", "新名");
    assert.equal(listTree(db).folders[0].name, "新名");
});
