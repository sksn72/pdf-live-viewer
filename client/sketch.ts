import type { Entry, Stroke, StrokeMap } from "./sketch-model.js";
import {
    appendPoint,
    createStroke,
    drawStrokeSegment,
    redoEntry,
    renderStrokes,
    undoEntry,
} from "./sketch-model.js";

type PageEntry = Entry<Stroke> & {
    page: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    cssW: number;
    cssH: number;
};

export type SketchLayer = ReturnType<typeof createSketchLayer>;
export type SketchTool = {
    on: boolean;
    color: string;
    width: number;
    erase: boolean;
};

export function createSketchLayer({
    save,
    onChange = () => {},
}: {
    save: (page: number, strokes: Stroke[]) => void;
    onChange?: () => void;
}) {
    const pages = new Map<number, PageEntry>();
    const tool: SketchTool = {
        on: false,
        color: "#e11d48",
        width: 0.0036,
        erase: false,
    };
    let active: { entry: PageEntry; stroke: Stroke } | null = null;
    let visible = true;

    function reset() {
        pages.clear();
        active = null;
    }

    function paint(entry: PageEntry) {
        entry.ctx.clearRect(0, 0, entry.cssW, entry.cssH);
        renderStrokes(entry.ctx, entry.strokes, entry.cssW, entry.cssH);
    }

    function attach(
        pageNumber: number,
        wrap: HTMLElement,
        cssW: number,
        cssH: number,
    ) {
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.className = "sketch";
        canvas.hidden = !visible;
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.style.pointerEvents = tool.on ? "auto" : "none";
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const entry: PageEntry = {
            page: pageNumber,
            canvas,
            ctx,
            cssW,
            cssH,
            strokes: [],
            undone: [],
        };
        pages.set(pageNumber, entry);
        canvas.addEventListener("pointerdown", (e) => down(e, entry));
        canvas.addEventListener("pointermove", (e) => move(e, entry));
        canvas.addEventListener("pointerup", (e) => up(e, entry));
        canvas.addEventListener("pointercancel", (e) => up(e, entry));
        wrap.append(canvas);
    }

    function setData(map: StrokeMap | undefined) {
        for (const entry of pages.values()) {
            const strokes = map?.[entry.page];
            entry.strokes = Array.isArray(strokes) ? strokes : [];
            entry.undone = [];
            paint(entry);
        }
    }

    // 他端末の保存をそのまま反映する（描画中のページは呼び出し側で弾く）
    function setPage(pageNumber: number, strokes: Stroke[]) {
        const entry = pages.get(pageNumber);
        if (!entry) return;
        entry.strokes = Array.isArray(strokes) ? strokes : [];
        entry.undone = [];
        paint(entry);
    }

    function busy(pageNumber: number) {
        return active?.entry.page === pageNumber;
    }

    function snapshot(): StrokeMap {
        return Object.fromEntries(
            [...pages].map(([p, entry]) => [p, entry.strokes]),
        );
    }

    function down(e: PointerEvent, entry: PageEntry) {
        if (!tool.on) return;
        e.preventDefault();
        entry.canvas.setPointerCapture(e.pointerId);
        active = {
            entry,
            stroke: createStroke({
                color: tool.color,
                width: tool.width,
                erase: tool.erase,
            }),
        };
        extend(e, entry);
    }

    function move(e: PointerEvent, entry: PageEntry) {
        if (!active || active.entry !== entry) return;
        e.preventDefault();
        extend(e, entry);
    }

    function extend(e: PointerEvent, entry: PageEntry) {
        if (!active) return;
        const rect = entry.canvas.getBoundingClientRect();
        const s = active.stroke;
        const from = Math.max(1, s.pts.length);
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
            const p = ev.pointerType === "pen" ? ev.pressure || 0.5 : 0.5;
            appendPoint(
                s,
                (ev.clientX - rect.left) / rect.width,
                (ev.clientY - rect.top) / rect.height,
                p,
            );
        }
        for (let i = from; i < s.pts.length; i++)
            drawStrokeSegment(entry.ctx, s, i, entry.cssW, entry.cssH);
    }

    function up(_e: PointerEvent, entry: PageEntry) {
        if (!active || active.entry !== entry) return;
        const s = active.stroke;
        if (s.pts.length === 1) {
            // タップも点として残す（線分にするため微小にずらす）
            appendPoint(s, s.pts[0][0] + 0.0002, s.pts[0][1], s.pts[0][2]);
            drawStrokeSegment(entry.ctx, s, 1, entry.cssW, entry.cssH);
        }
        entry.strokes.push(s);
        entry.undone = [];
        active = null;
        save(entry.page, entry.strokes);
        onChange();
    }

    function undo(pageNumber: number) {
        const entry = pages.get(pageNumber);
        if (!entry) return;
        undoEntry(entry);
        paint(entry);
        save(entry.page, entry.strokes);
    }

    function redo(pageNumber: number) {
        const entry = pages.get(pageNumber);
        if (!entry) return;
        redoEntry(entry);
        paint(entry);
        save(entry.page, entry.strokes);
    }

    function setTool(patch: Partial<SketchTool>) {
        Object.assign(tool, patch);
        for (const entry of pages.values())
            entry.canvas.style.pointerEvents = tool.on ? "auto" : "none";
    }

    function setVisible(value: boolean) {
        visible = value;
        for (const entry of pages.values()) entry.canvas.hidden = !value;
    }

    return {
        reset,
        attach,
        setData,
        setPage,
        busy,
        snapshot,
        setTool,
        setVisible,
        undo,
        redo,
        tool,
    };
}
