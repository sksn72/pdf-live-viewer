import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folder (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pdf (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  purge_at TEXT,
  folder_id TEXT
);
CREATE TABLE IF NOT EXISTS version (
  pdf_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pdf_id, version)
);
CREATE TABLE IF NOT EXISTS sketch (
  pdf_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  page INTEGER NOT NULL,
  strokes TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pdf_id, version, page)
);
`;

export type PdfRow = {
    id: string;
    name: string;
    currentVersion: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    purgeAt: string | null;
    folderId: string | null;
};

export type VersionRow = { version: number; createdAt: string };
export type FolderRow = {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: string;
};
export type FolderNode = FolderRow & { folders: FolderNode[]; pdfs: PdfRow[] };
export type Tree = { folders: FolderNode[]; pdfs: PdfRow[] };

const now = () => new Date().toISOString();

const PDF_COLS = `id, name, current_version AS currentVersion, created_at AS createdAt,
  updated_at AS updatedAt, deleted_at AS deletedAt, purge_at AS purgeAt, folder_id AS folderId`;
const FOLDER_COLS = "id, name, parent_id AS parentId, created_at AS createdAt";

export function openDb(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    // CREATE TABLE IF NOT EXISTS は既存テーブルに列を足さないので、旧DBは明示的に移行する
    const cols = db.prepare("PRAGMA table_info(pdf)").all() as unknown as {
        name: string;
    }[];
    if (!cols.some((c) => c.name === "folder_id"))
        db.exec("ALTER TABLE pdf ADD COLUMN folder_id TEXT");
    return db;
}

export function createPdf(
    db: DatabaseSync,
    {
        id,
        name,
        folderId = null,
        now: ts = now(),
    }: { id: string; name: string; folderId?: string | null; now?: string },
) {
    db.prepare(
        "INSERT INTO pdf (id,name,current_version,created_at,updated_at,folder_id) VALUES (?,?,1,?,?,?)",
    ).run(id, name, ts, ts, folderId);
    db.prepare(
        "INSERT INTO version (pdf_id,version,created_at) VALUES (?,1,?)",
    ).run(id, ts);
    return getPdf(db, id) as PdfRow;
}

export function getPdf(db: DatabaseSync, id: string) {
    return (
        (db.prepare(`SELECT ${PDF_COLS} FROM pdf WHERE id = ?`).get(id) as
            | PdfRow
            | undefined) ?? null
    );
}

export function listActive(db: DatabaseSync) {
    return db
        .prepare(
            `SELECT ${PDF_COLS} FROM pdf WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
        )
        .all() as unknown as PdfRow[];
}

export function listTrash(db: DatabaseSync) {
    return db
        .prepare(
            `SELECT ${PDF_COLS} FROM pdf WHERE deleted_at IS NOT NULL ORDER BY purge_at ASC`,
        )
        .all() as unknown as PdfRow[];
}

export function listVersions(db: DatabaseSync, id: string) {
    return db
        .prepare(
            "SELECT version, created_at AS createdAt FROM version WHERE pdf_id = ? ORDER BY version DESC",
        )
        .all(id) as unknown as VersionRow[];
}

export function addVersion(db: DatabaseSync, id: string, ts = now()) {
    const cur = db
        .prepare("SELECT current_version AS v FROM pdf WHERE id = ?")
        .get(id) as { v: number } | undefined;
    if (!cur) return null;
    const v = cur.v + 1;
    db.prepare(
        "INSERT INTO version (pdf_id,version,created_at) VALUES (?,?,?)",
    ).run(id, v, ts);
    db.prepare(
        "UPDATE pdf SET current_version = ?, updated_at = ? WHERE id = ?",
    ).run(v, ts, id);
    return v;
}

export type DeleteVersionResult =
    | { status: "missing" }
    | { status: "last" }
    | { status: "ok"; currentVersion: number };

// 版を1つ消す。番号は詰めない。最新版を消したときだけ current_version を残りの最大へ下げる
export function deleteVersion(
    db: DatabaseSync,
    id: string,
    version: number,
): DeleteVersionResult {
    const row = db
        .prepare("SELECT current_version AS cur FROM pdf WHERE id = ?")
        .get(id) as { cur: number } | undefined;
    if (!row) return { status: "missing" };
    const hit = db
        .prepare("SELECT 1 AS x FROM version WHERE pdf_id = ? AND version = ?")
        .get(id, version);
    if (!hit) return { status: "missing" };
    const count = (
        db
            .prepare("SELECT count(*) AS c FROM version WHERE pdf_id = ?")
            .get(id) as { c: number }
    ).c;
    if (count <= 1) return { status: "last" };

    db.prepare("DELETE FROM sketch WHERE pdf_id = ? AND version = ?").run(
        id,
        version,
    );
    db.prepare("DELETE FROM version WHERE pdf_id = ? AND version = ?").run(
        id,
        version,
    );
    if (version !== row.cur) return { status: "ok", currentVersion: row.cur };

    const max = (
        db
            .prepare("SELECT max(version) AS v FROM version WHERE pdf_id = ?")
            .get(id) as { v: number }
    ).v;
    db.prepare(
        "UPDATE pdf SET current_version = ?, updated_at = ? WHERE id = ?",
    ).run(max, now(), id);
    return { status: "ok", currentVersion: max };
}

export function softDelete(db: DatabaseSync, id: string, days = 7, ts = now()) {
    const purgeAt = new Date(Date.parse(ts) + days * 86400000).toISOString();
    db.prepare("UPDATE pdf SET deleted_at = ?, purge_at = ? WHERE id = ?").run(
        ts,
        purgeAt,
        id,
    );
    return purgeAt;
}

export function restore(db: DatabaseSync, id: string) {
    db.prepare(
        "UPDATE pdf SET deleted_at = NULL, purge_at = NULL WHERE id = ?",
    ).run(id);
}

export function hardDelete(db: DatabaseSync, id: string) {
    db.prepare("DELETE FROM sketch WHERE pdf_id = ?").run(id);
    db.prepare("DELETE FROM version WHERE pdf_id = ?").run(id);
    db.prepare("DELETE FROM pdf WHERE id = ?").run(id);
}

export function purgeExpired(db: DatabaseSync, ts = now()) {
    const rows = db
        .prepare(
            "SELECT id FROM pdf WHERE purge_at IS NOT NULL AND purge_at <= ?",
        )
        .all(ts) as unknown as {
        id: string;
    }[];
    for (const r of rows) hardDelete(db, r.id);
    return rows.map((r) => r.id);
}

export function getSketches(db: DatabaseSync, id: string, version: number) {
    const rows = db
        .prepare(
            "SELECT page, strokes FROM sketch WHERE pdf_id = ? AND version = ? ORDER BY page",
        )
        .all(id, version) as unknown as { page: number; strokes: string }[];
    return Object.fromEntries(
        rows.map((r) => [String(r.page), JSON.parse(r.strokes)]),
    );
}

export function putSketch(
    db: DatabaseSync,
    id: string,
    version: number,
    page: number,
    strokes: unknown,
    ts = now(),
) {
    db.prepare(`INSERT INTO sketch (pdf_id,version,page,strokes,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(pdf_id,version,page) DO UPDATE SET strokes = excluded.strokes, updated_at = excluded.updated_at`).run(
        id,
        version,
        page,
        JSON.stringify(strokes),
        ts,
    );
}

export function copySketches(
    db: DatabaseSync,
    id: string,
    from: number,
    to: number,
    pages: number[],
    ts = now(),
) {
    const src = getSketches(db, id, from) as Record<string, unknown>;
    let copied = 0;
    for (const p of pages) {
        const strokes = src[String(p)];
        if (strokes) {
            putSketch(db, id, to, Number(p), strokes, ts);
            copied++;
        }
    }
    return copied;
}

export function createFolder(
    db: DatabaseSync,
    {
        id,
        name,
        parentId = null,
        now: ts = now(),
    }: { id: string; name: string; parentId?: string | null; now?: string },
) {
    db.prepare(
        "INSERT INTO folder (id,name,parent_id,created_at) VALUES (?,?,?,?)",
    ).run(id, name, parentId, ts);
    return getFolder(db, id) as FolderRow;
}

export function getFolder(db: DatabaseSync, id: string) {
    return (
        (db.prepare(`SELECT ${FOLDER_COLS} FROM folder WHERE id = ?`).get(id) as
            | FolderRow
            | undefined) ?? null
    );
}

export function renameFolder(db: DatabaseSync, id: string, name: string) {
    db.prepare("UPDATE folder SET name = ? WHERE id = ?").run(name, id);
}

export function setPdfFolder(
    db: DatabaseSync,
    id: string,
    folderId: string | null,
) {
    db.prepare("UPDATE pdf SET folder_id = ? WHERE id = ?").run(folderId, id);
}

// 空のフォルダだけ消す。判断と削除を1つのトランザクションにまとめる
export function deleteFolder(db: DatabaseSync, id: string) {
    const kids = db
        .prepare("SELECT count(*) AS c FROM folder WHERE parent_id = ?")
        .get(id) as { c: number };
    const pdfs = db
        .prepare(
            "SELECT count(*) AS c FROM pdf WHERE folder_id = ? AND deleted_at IS NULL",
        )
        .get(id) as {
        c: number;
    };
    if (kids.c > 0 || pdfs.c > 0) return false;
    // ゴミ箱の中のPDFだけが残っている場合は、行き場を失わないようルート直下へ戻す
    db.prepare("UPDATE pdf SET folder_id = NULL WHERE folder_id = ?").run(id);
    db.prepare("DELETE FROM folder WHERE id = ?").run(id);
    return true;
}

export function listTree(db: DatabaseSync): Tree {
    const folders = db
        .prepare(`SELECT ${FOLDER_COLS} FROM folder ORDER BY name`)
        .all() as unknown as FolderRow[];
    const pdfs = listActive(db);
    const nodes = new Map<string, FolderNode>(
        folders.map((f) => [f.id, { ...f, folders: [], pdfs: [] }]),
    );
    const root: Tree = { folders: [], pdfs: [] };
    for (const f of nodes.values())
        (nodes.get(f.parentId ?? "") ?? root).folders.push(f);
    for (const p of pdfs) (nodes.get(p.folderId ?? "") ?? root).pdfs.push(p);
    return root;
}
