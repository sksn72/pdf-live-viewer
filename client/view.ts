import { exportAnnotated } from "./export.js";
import { createSketchLayer } from "./sketch.js";
import type { Stroke } from "./sketch-model.js";
import { createViewer } from "./viewer.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;

type PdfDetail = {
    id: string;
    name: string;
    folderId: string | null;
    currentVersion: number;
    versions: { version: number; createdAt: string }[];
};

export type ViewPage = ReturnType<typeof createView>;

export type SseMessage = {
    type: string;
    id?: string | null;
    version?: number;
    page?: number;
    strokes?: unknown;
};

export function createView({ root }: { root: HTMLElement }) {
    // versions は欠番を許すので、版番号の一覧はサーバーの返す配列をそのまま持つ
    const state = {
        id: null as string | null,
        name: "",
        folderId: null as string | null,
        versions: [] as number[],
        version: 0,
        currentVersion: 0,
    };

    const sketch = createSketchLayer({ save: saveSketch });
    const viewer = createViewer({
        root: $("viewer"),
        sketch,
        onState: () => {
            if (!viewer.hasDoc()) return;
            $("pageinfo").textContent =
                `${viewer.currentPage()} / ${viewer.pageCount()}`;
            $("zoom").textContent = `${Math.round(viewer.scale() * 100)}%`;
        },
    });

    function setStatus(text: string) {
        $("status").textContent = text;
    }

    async function saveSketch(page: number, strokes: Stroke[]) {
        if (!state.id) return;
        const res = await fetch(
            `/api/pdfs/${state.id}/versions/${state.version}/sketches/${page}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ strokes }),
            },
        );
        if (!res.ok) setStatus("スケッチの保存に失敗しました");
    }

    function showBanner(text: string, onClick: () => void) {
        const b = $("banner");
        b.textContent = text;
        b.hidden = false;
        b.onclick = onClick;
        b.style.cursor = "pointer";
    }

    function hideBanner() {
        const b = $("banner");
        b.hidden = true;
        b.onclick = null;
    }

    function renderVersions() {
        const sel = $<HTMLSelectElement>("version");
        sel.textContent = "";
        for (const v of state.versions) {
            const opt = document.createElement("option");
            opt.value = String(v);
            opt.textContent =
                v === state.currentVersion ? `v${v} (最新)` : `v${v}`;
            sel.append(opt);
        }
        sel.value = String(state.version);
        $<HTMLButtonElement>("deleteVersion").disabled =
            state.versions.length <= 1;
    }

    function goManage() {
        location.hash = state.folderId ? `#/f/${state.folderId}` : "#/";
    }

    async function open(id: string) {
        const res = await fetch(`/api/pdfs/${id}`);
        if (!res.ok) {
            location.hash = "#/";
            return;
        }
        const pdf = (await res.json()) as PdfDetail;
        state.id = pdf.id;
        state.name = pdf.name;
        state.folderId = pdf.folderId;
        state.currentVersion = pdf.currentVersion;
        state.versions = pdf.versions.map((v) => v.version);
        state.version = pdf.currentVersion;
        $("toolbar").hidden = false;
        $("title").textContent = pdf.name;
        renderVersions();
        hideBanner();
        await viewer.open(state.id, state.version);
    }

    function close() {
        viewer.close();
        state.id = null;
        state.versions = [];
        state.version = 0;
        state.currentVersion = 0;
        $("toolbar").hidden = true;
        $("banner").hidden = true;
        $("title").textContent = "";
        $("pageinfo").textContent = "";
        $("status").textContent = "";
    }

    async function upload(file: File, id: string) {
        const res = await fetch(`/api/pdfs/${id}/versions`, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: file,
        });
        if (!res.ok) setStatus(`アップロード失敗 (${res.status})`);
    }

    $("back").onclick = goManage;
    $("zoomIn").onclick = () => viewer.zoom(1.2);
    $("zoomOut").onclick = () => viewer.zoom(1 / 1.2);

    $("sketchToggle").onclick = () => {
        const on = !sketch.tool.on;
        sketch.setTool({ on });
        $("sketchToggle").textContent = `スケッチ: ${on ? "オン" : "オフ"}`;
        $("sketchToggle").classList.toggle("active", on);
    };

    $<HTMLInputElement>("color").oninput = (e) => {
        sketch.setTool({
            color: (e.target as HTMLInputElement).value,
            erase: false,
        });
        $("eraser").textContent = "ペンモード";
        $("eraser").classList.remove("active");
    };

    $<HTMLInputElement>("width").oninput = (e) =>
        sketch.setTool({
            width: Number((e.target as HTMLInputElement).value) * 0.0012,
        });

    $("eraser").onclick = () => {
        const erase = !sketch.tool.erase;
        sketch.setTool({ erase });
        $("eraser").textContent = `${erase ? "消しゴムモード" : "ペンモード"}`;
        $("eraser").classList.toggle("active", erase);
    };

    $("undo").onclick = () => sketch.undo(viewer.currentPage());
    $("redo").onclick = () => sketch.redo(viewer.currentPage());

    $("delete").onclick = async () => {
        if (!state.id) return;
        if (!confirm(`「${state.name}」をゴミ箱に移動します。よろしいですか？`))
            return;
        await fetch(`/api/pdfs/${state.id}`, { method: "DELETE" });
        goManage();
    };

    $("export").onclick = async () => {
        if (!state.id) return;
        await exportAnnotated({
            id: state.id,
            version: state.version,
            name: state.name,
        });
    };

    $<HTMLSelectElement>("version").onchange = async (e) => {
        if (!state.id) return;
        state.version = Number((e.target as HTMLSelectElement).value);
        await viewer.open(state.id, state.version);
        hideBanner();
    };

    $<HTMLInputElement>("newVersion").onchange = async (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file || !state.id) return;
        await upload(file, state.id);
        await onRemoteChange(state.id);
    };

    function pickPages(pages: string[]) {
        const modal = $("modal");
        const body = modal.querySelector(".modal-body") as HTMLElement;
        body.textContent = "";
        const title = document.createElement("p");
        title.textContent =
            "前の版のスケッチを引き継ぐページを選んでください。";
        const warn = document.createElement("p");
        warn.className = "muted";
        warn.textContent =
            "ページサイズが変わっていると位置がずれます。同じサイズのページだけ選んでください。";
        body.append(title, warn);
        const boxes = pages.map((p) => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = p;
            label.append(input, document.createTextNode(` ページ ${p}`));
            body.append(label);
            return input;
        });
        const ok = document.createElement("button");
        ok.type = "button";
        ok.textContent = "引き継ぐ";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "キャンセル";
        body.append(document.createElement("hr"), ok, cancel);
        modal.hidden = false;
        return new Promise<number[]>((resolve) => {
            ok.onclick = () => {
                modal.hidden = true;
                resolve(
                    boxes.filter((b) => b.checked).map((b) => Number(b.value)),
                );
            };
            cancel.onclick = () => {
                modal.hidden = true;
                resolve([]);
            };
        });
    }

    $("carry").onclick = async () => {
        if (!state.id || state.version <= 1)
            return setStatus("前の版がありません");
        const from = state.version - 1;
        const prev = (await fetch(
            `/api/pdfs/${state.id}/versions/${from}/sketches`,
        ).then((r) => r.json())) as {
            pages?: Record<string, Stroke[]>;
        };
        const pages = Object.keys(prev.pages ?? {}).filter(
            (k) => (prev.pages?.[k]?.length ?? 0) > 0,
        );
        if (!pages.length) return setStatus("前の版にスケッチはありません");
        const picked = await pickPages(pages);
        if (!picked.length) return;
        await fetch(
            `/api/pdfs/${state.id}/versions/${state.version}/sketches/copy`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ from, pages: picked }),
            },
        );
        await viewer.open(state.id, state.version);
    };

    $("deleteVersion").onclick = async () => {
        if (!state.id || state.versions.length <= 1) return;
        const target = state.version;
        if (
            !confirm(
                `v${target} を削除します。この版のスケッチも消え、元に戻せません。よろしいですか？`,
            )
        )
            return;
        const res = await fetch(`/api/pdfs/${state.id}/versions/${target}`, {
            method: "DELETE",
        });
        if (!res.ok) return setStatus(`版の削除に失敗しました (${res.status})`);
        const body = (await res.json()) as { currentVersion: number };
        state.currentVersion = body.currentVersion;
        state.versions = state.versions.filter((v) => v !== target);
        state.version = state.currentVersion;
        renderVersions();
        await viewer.open(state.id, state.version);
        setStatus(`v${target} を削除しました`);
    };

    // 他の端末のスケッチ保存をそのまま反映する（描画中のページは手元を優先）
    function onEvent(msg: SseMessage) {
        if (msg.type === "sketch") {
            if (
                msg.id !== state.id ||
                msg.version !== state.version ||
                msg.page === undefined
            )
                return;
            if (sketch.busy(msg.page)) return;
            sketch.setPage(
                msg.page,
                Array.isArray(msg.strokes) ? (msg.strokes as Stroke[]) : [],
            );
            return;
        }
        void onRemoteChange(msg.id ?? null);
    }

    async function onRemoteChange(id: string | null) {
        if (!state.id || id !== state.id) return;
        const res = await fetch(`/api/pdfs/${state.id}`);
        if (res.status === 404) {
            goManage();
            return;
        }
        const pdf = (await res.json()) as PdfDetail;
        const wasLatest = state.version === state.currentVersion;
        state.currentVersion = pdf.currentVersion;
        state.versions = pdf.versions.map((v) => v.version);
        // 選択中の版が消えていたら最新に寄せる
        if (!state.versions.includes(state.version))
            state.version = pdf.currentVersion;
        renderVersions();
        if (pdf.currentVersion === state.version || !state.id) return;
        if (wasLatest) {
            state.version = pdf.currentVersion;
            renderVersions();
            await viewer.open(state.id, state.version);
            setStatus(`v${state.version} に更新しました`);
        } else {
            showBanner(
                `新しい版 v${pdf.currentVersion} があります（クリックで表示）`,
                () => {
                    if (!state.id) return;
                    state.version = pdf.currentVersion;
                    renderVersions();
                    void viewer.open(state.id, state.version);
                    hideBanner();
                },
            );
        }
    }

    return { root, open, close, onEvent };
}
