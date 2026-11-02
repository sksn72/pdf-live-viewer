import * as pdfjs from "pdfjs-dist";

import type { SketchLayer } from "./sketch.js";
import type { StrokeMap } from "./sketch-model.js";
import { wheelZoomFactor } from "./ui.js";

pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/build/pdf.worker.mjs";

const CMAP_URL = "/vendor/pdfjs/cmaps/";
const FONT_URL = "/vendor/pdfjs/standard_fonts/";

type LoadingTask = ReturnType<typeof pdfjs.getDocument>;
type Anchor = { page: number; frac: number };

export type Viewer = ReturnType<typeof createViewer>;

export function createViewer({
    root,
    sketch,
    onState,
}: {
    root: HTMLElement;
    sketch: SketchLayer;
    onState: () => void;
}) {
    let doc: pdfjs.PDFDocumentProxy | null = null;
    let loadingTask: LoadingTask | null = null;
    let scale = 0;
    const wrappers: HTMLElement[] = [];
    let pdfId: string | null = null;
    let version: number | null = null;
    let wheelTimer = 0;
    let wheelDelta = 0;

    function anchor(): Anchor {
        const y = root.scrollTop + 2;
        let idx = 0;
        for (let i = 0; i < wrappers.length; i++)
            if (wrappers[i].offsetTop <= y) idx = i;
        const w = wrappers[idx];
        return { page: idx, frac: w ? (y - w.offsetTop) / w.offsetHeight : 0 };
    }

    function restore(a: Anchor) {
        // 版が変わるとページ数が減りうるので index は clamp する
        const w = wrappers[Math.min(a.page, wrappers.length - 1)];
        if (w) root.scrollTop = w.offsetTop + a.frac * w.offsetHeight;
    }

    async function fitScale() {
        const page = await doc?.getPage(1);
        if (!page) return 1;
        const w = page.getViewport({ scale: 1 }).width;
        // 余白と縦スクロールバー分を引いて、はみ出さない幅に収める
        const style = getComputedStyle(root);
        const pad =
            parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        return Math.min(3, Math.max(0.25, (root.clientWidth - pad - 16) / w));
    }

    async function layout(seed?: StrokeMap) {
        if (!doc) return;
        const a = anchor();
        const strokes = seed ?? sketch.snapshot();
        const dpr = window.devicePixelRatio || 1;
        root.textContent = "";
        wrappers.length = 0;
        sketch.reset();
        // shortcut: 全ページ一括描画、200ページ超で重ければ IntersectionObserver で遅延描画に変える
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const vp = page.getViewport({ scale });
            const wrap = document.createElement("div");
            wrap.className = "page";
            wrap.style.width = `${vp.width}px`;
            wrap.style.height = `${vp.height}px`;
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(vp.width * dpr);
            canvas.height = Math.floor(vp.height * dpr);
            canvas.style.width = `${vp.width}px`;
            canvas.style.height = `${vp.height}px`;
            await page.render({
                canvas,
                viewport: vp,
                transform: [dpr, 0, 0, dpr, 0, 0],
            }).promise;
            wrap.append(canvas);
            root.append(wrap);
            wrappers.push(wrap);
            sketch.attach(i, wrap, vp.width, vp.height);
        }
        sketch.setData(strokes);
        restore(a);
        onState();
    }

    async function open(id: string, v: number) {
        window.clearTimeout(wheelTimer);
        wheelTimer = 0;
        wheelDelta = 0;
        const task = pdfjs.getDocument({
            url: `/api/pdfs/${id}/versions/${v}`,
            cMapUrl: CMAP_URL,
            cMapPacked: true,
            standardFontDataUrl: FONT_URL,
        });
        const next = await task.promise;
        // v6 の PDFDocumentProxy に destroy() は無い。読み込みタスク側で解放する
        if (loadingTask) loadingTask.destroy();
        loadingTask = task;
        doc = next;
        pdfId = id;
        version = v;
        if (!scale) scale = await fitScale();
        const data = (await fetch(
            `/api/pdfs/${id}/versions/${v}/sketches`,
        ).then((r) => r.json())) as {
            pages?: StrokeMap;
        };
        await layout(data.pages ?? {});
    }

    async function zoom(factor: number) {
        if (!doc) return;
        scale = Math.min(4, Math.max(0.25, scale * factor));
        await layout();
    }

    let raf = 0;
    root.addEventListener("scroll", () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            onState();
        });
    });

    // 連続するホイールで全ページ再描画が重ならないよう、停止後にまとめて倍率を適用する
    root.addEventListener(
        "wheel",
        (e) => {
            if (!e.ctrlKey || !doc) return;
            e.preventDefault();
            const unit =
                e.deltaMode === 1
                    ? 16
                    : e.deltaMode === 2
                      ? root.clientHeight
                      : 1;
            wheelDelta += e.deltaY * unit;
            window.clearTimeout(wheelTimer);
            wheelTimer = window.setTimeout(() => {
                const delta = wheelDelta;
                wheelDelta = 0;
                wheelTimer = 0;
                if (delta !== 0) void zoom(wheelZoomFactor(delta));
            }, 80);
        },
        { passive: false },
    );

    return {
        open,
        zoom,
        close() {
            window.clearTimeout(wheelTimer);
            wheelTimer = 0;
            wheelDelta = 0;
            if (loadingTask) loadingTask.destroy();
            loadingTask = null;
            doc = null;
            pdfId = null;
            version = null;
            scale = 0;
            root.textContent = "";
            wrappers.length = 0;
        },
        currentPage: () => anchor().page + 1,
        pageCount: () => doc?.numPages ?? 0,
        scale: () => scale,
        get version() {
            return version;
        },
        get pdfId() {
            return pdfId;
        },
        hasDoc: () => doc !== null,
    };
}
