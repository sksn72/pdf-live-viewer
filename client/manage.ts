type PdfItem = {
    id: string;
    name: string;
    currentVersion: number;
    updatedAt: string;
    purgeAt: string | null;
};
type FolderItem = {
    id: string;
    name: string;
    folders: FolderItem[];
    pdfs: PdfItem[];
};
type TreeData = { folders: FolderItem[]; pdfs: PdfItem[] };

export type SearchHit = { pdf: PdfItem; path: string[] };

export function searchPdfs(tree: TreeData, query: string): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    const walk = (node: TreeData | FolderItem, path: string[]) => {
        for (const pdf of node.pdfs)
            if (pdf.name.toLowerCase().includes(q)) hits.push({ pdf, path });
        for (const folder of node.folders) walk(folder, [...path, folder.name]);
    };
    walk(tree, []);
    return hits;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;

const JSON_HEADERS = { "Content-Type": "application/json" };

export type ManagePage = ReturnType<typeof createManage>;

export function createManage({ root }: { root: HTMLElement }) {
    let tree: TreeData = { folders: [], pdfs: [] };
    let current: string | null = null;
    let query = "";

    function setStatus(text: string) {
        $("status").textContent = text;
    }

    function find(
        id: string,
        node: TreeData | FolderItem = tree,
    ): FolderItem | null {
        for (const f of node.folders) {
            if (f.id === id) return f;
            const hit = find(id, f);
            if (hit) return hit;
        }
        return null;
    }

    function parents() {
        const map = new Map<string, string | null>();
        const walk = (node: TreeData | FolderItem, parent: string | null) => {
            for (const f of node.folders) {
                map.set(f.id, parent);
                walk(f, f.id);
            }
        };
        walk(tree, null);
        return map;
    }

    function itemRow(
        label: string,
        meta: string,
        active: boolean,
        onClick: () => void,
        actions: [string, () => void, string?][],
    ) {
        const row = document.createElement("div");
        row.className = `item${active ? " active" : ""}`;
        const name = document.createElement("span");
        name.textContent = label;
        if (meta) {
            const small = document.createElement("small");
            small.textContent = meta;
            name.append(small);
        }
        name.onclick = onClick;
        row.append(name);
        for (const [text, fn, cls] of actions) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = text;
            if (cls) b.className = cls;
            b.onclick = fn;
            row.append(b);
        }
        return row;
    }

    function emptyItem(text: string) {
        const li = document.createElement("li");
        li.className = "item muted";
        li.textContent = text;
        return li;
    }

    function pdfItem(p: PdfItem, meta: string) {
        const li = document.createElement("li");
        li.append(
            itemRow(
                p.name,
                meta,
                false,
                () => {
                    location.hash = `#/p/${p.id}`;
                },
                [
                    ["移動", () => void move(p)],
                    ["削除", () => void removePdf(p), "danger"],
                ],
            ),
        );
        return li;
    }

    // カレントディレクトリ直下だけを並べる（階層はパンくずで辿る）
    function renderList(ul: HTMLUListElement, node: TreeData | FolderItem) {
        for (const f of node.folders) {
            const li = document.createElement("li");
            li.append(
                itemRow(
                    `📁 ${f.name}`,
                    `${f.folders.length + f.pdfs.length} 件`,
                    false,
                    () => {
                        location.hash = `#/f/${f.id}`;
                    },
                    [
                        ["リネーム", () => void renameFolder(f)],
                        ["削除", () => void removeFolder(f), "danger"],
                    ],
                ),
            );
            ul.append(li);
        }
        for (const p of node.pdfs)
            ul.append(
                pdfItem(
                    p,
                    `v${p.currentVersion} · ${new Date(p.updatedAt).toLocaleString()}`,
                ),
            );
    }

    function renderCrumbs() {
        const nav = $("crumbs");
        nav.textContent = "";
        const chain: FolderItem[] = [];
        const up = parents();
        for (let id = current; id; id = up.get(id) ?? null) {
            const f = find(id);
            if (f) chain.unshift(f);
        }
        const rootLink = document.createElement("a");
        rootLink.href = "#/";
        rootLink.textContent = "ルート";
        nav.append(rootLink);
        for (const f of chain) {
            nav.append(document.createTextNode(" / "));
            const a = document.createElement("a");
            a.href = `#/f/${f.id}`;
            a.textContent = f.name;
            nav.append(a);
        }
    }

    function render() {
        const list = $<HTMLUListElement>("tree");
        list.textContent = "";
        if (query.trim()) {
            for (const hit of searchPdfs(tree, query))
                list.append(
                    pdfItem(
                        hit.pdf,
                        hit.path.length ? hit.path.join(" / ") : "ルート",
                    ),
                );
            if (!list.childElementCount)
                list.append(emptyItem("該当するPDFはありません"));
        } else {
            renderList(list, (current && find(current)) || tree);
            if (!list.childElementCount)
                list.append(emptyItem("このフォルダは空です"));
        }
        renderCrumbs();
    }

    async function refresh() {
        tree = (await fetch("/api/tree").then((r) => r.json())) as TreeData;
        if (current && !find(current)) current = null;
        render();
    }

    function pickFolder(title: string) {
        const modal = $("modal");
        const body = modal.querySelector(".modal-body") as HTMLElement;
        body.textContent = "";
        const p = document.createElement("p");
        p.textContent = `「${title}」の移動先`;
        const sel = document.createElement("select");
        const rootOpt = document.createElement("option");
        rootOpt.value = "";
        rootOpt.textContent = "ルート";
        sel.append(rootOpt);
        const walk = (node: TreeData | FolderItem, depth: number) => {
            for (const f of node.folders) {
                const o = document.createElement("option");
                o.value = f.id;
                o.textContent = `${"　".repeat(depth)}${f.name}`;
                sel.append(o);
                walk(f, depth + 1);
            }
        };
        walk(tree, 0);
        const ok = document.createElement("button");
        ok.type = "button";
        ok.textContent = "移動";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "キャンセル";
        body.append(p, sel, document.createElement("hr"), ok, cancel);
        modal.hidden = false;
        return new Promise<string | null | undefined>((resolve) => {
            ok.onclick = () => {
                modal.hidden = true;
                resolve(sel.value || null);
            };
            cancel.onclick = () => {
                modal.hidden = true;
                resolve(undefined);
            };
        });
    }

    async function renameFolder(f: FolderItem) {
        const name = prompt("フォルダ名", f.name);
        if (!name?.trim()) return;
        const res = await fetch(`/api/folders/${f.id}`, {
            method: "PATCH",
            headers: JSON_HEADERS,
            body: JSON.stringify({ name }),
        });
        if (!res.ok) setStatus(`名前の変更に失敗しました (${res.status})`);
        await refresh();
    }

    async function removeFolder(f: FolderItem) {
        if (!confirm(`フォルダ「${f.name}」を削除します。よろしいですか？`))
            return;
        const res = await fetch(`/api/folders/${f.id}`, { method: "DELETE" });
        if (res.status === 409) setStatus("空ではないフォルダは削除できません");
        else if (!res.ok) setStatus(`削除に失敗しました (${res.status})`);
        await refresh();
    }

    async function move(p: PdfItem) {
        const picked = await pickFolder(p.name);
        if (picked === undefined) return;
        const res = await fetch(`/api/pdfs/${p.id}`, {
            method: "PATCH",
            headers: JSON_HEADERS,
            body: JSON.stringify({ folderId: picked }),
        });
        if (!res.ok) setStatus(`移動に失敗しました (${res.status})`);
        await refresh();
    }

    async function removePdf(p: PdfItem) {
        if (!confirm(`「${p.name}」をゴミ箱に移動します。よろしいですか？`))
            return;
        await fetch(`/api/pdfs/${p.id}`, { method: "DELETE" });
        await refresh();
    }

    async function upload(file: File) {
        const url = `/api/pdfs?name=${encodeURIComponent(file.name)}&folder=${current ?? ""}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: file,
        });
        if (!res.ok) setStatus(`アップロード失敗 (${res.status})`);
    }

    $("newFolder").onclick = async () => {
        const name = prompt("新しいフォルダ名");
        if (!name?.trim()) return;
        const res = await fetch(
            `/api/folders?name=${encodeURIComponent(name)}&parent=${current ?? ""}`,
            {
                method: "POST",
            },
        );
        if (!res.ok) setStatus(`フォルダ作成に失敗しました (${res.status})`);
        await refresh();
    };

    $<HTMLInputElement>("file").onchange = async (e) => {
        const input = e.target as HTMLInputElement;
        for (const file of input.files ?? []) await upload(file);
        input.value = "";
        await refresh();
    };

    for (const type of ["dragover", "drop"])
        document.addEventListener(type, (e) => e.preventDefault());
    document.addEventListener("drop", async (e) => {
        if (root.hidden) return;
        const files = [...(e.dataTransfer?.files ?? [])].filter(
            (f) => f.type === "application/pdf" || f.name.endsWith(".pdf"),
        );
        for (const file of files) await upload(file);
        await refresh();
    });

    $<HTMLInputElement>("search").oninput = (e) => {
        query = (e.target as HTMLInputElement).value;
        render();
    };

    $("trashToggle").onclick = async () => {
        const rows = (await fetch("/api/trash").then((r) =>
            r.json(),
        )) as PdfItem[];
        const modal = $("modal");
        const body = modal.querySelector(".modal-body") as HTMLElement;
        body.textContent = "";
        const title = document.createElement("p");
        title.textContent = rows.length ? "ゴミ箱" : "ゴミ箱は空です";
        body.append(title);
        for (const row of rows) {
            const line = document.createElement("div");
            line.className = "row";
            const label = document.createElement("span");
            label.textContent = `${row.name} (v${row.currentVersion}) 期限 ${new Date(row.purgeAt ?? row.updatedAt).toLocaleString()}`;
            const restoreButton = document.createElement("button");
            restoreButton.type = "button";
            restoreButton.textContent = "復元";
            restoreButton.onclick = async () => {
                await fetch(`/api/pdfs/${row.id}/restore`, { method: "POST" });
                modal.hidden = true;
                await refresh();
            };
            const purge = document.createElement("button");
            purge.type = "button";
            purge.className = "danger";
            purge.textContent = "完全削除";
            purge.onclick = async () => {
                if (
                    !confirm(
                        `「${row.name}」の全版を完全に削除します。取り消せません。`,
                    )
                )
                    return;
                await fetch(`/api/pdfs/${row.id}/purge`, { method: "DELETE" });
                modal.hidden = true;
                await refresh();
            };
            line.append(label, restoreButton, purge);
            body.append(line);
        }
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "閉じる";
        close.onclick = () => {
            modal.hidden = true;
        };
        body.append(close);
        modal.hidden = false;
    };

    return {
        root,
        async show(folderId: string | null) {
            current = folderId;
            await refresh();
        },
        onRemoteChange() {
            if (!root.hidden) void refresh();
        },
    };
}
