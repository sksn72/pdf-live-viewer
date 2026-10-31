// 座標はページ幅・高さで正規化した 0..1。w はページ幅に対する比率。
export type Point = [number, number, number];
export type Stroke = { c: string; w: number; e: boolean; pts: Point[] };
export type StrokeMap = Record<string, Stroke[]>;
export type Entry<T> = { strokes: T[]; undone: T[] };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createStroke({
    color,
    width,
    erase = false,
}: {
    color: string;
    width: number;
    erase?: boolean;
}): Stroke {
    return { c: color, w: width, e: erase, pts: [] };
}

export function appendPoint(
    stroke: Stroke,
    x: number,
    y: number,
    pressure: number,
) {
    stroke.pts.push([clamp01(x), clamp01(y), clamp01(pressure)]);
}

// 筆圧は 0.5 で等倍、1.0 で 1.6 倍、0 で 0.4 倍
export function widthFor(
    stroke: Stroke,
    pageWidthPx: number,
    pressure: number,
) {
    return Math.max(0.5, stroke.w * pageWidthPx * (0.4 + 1.2 * pressure));
}

export function drawStrokeSegment(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    i: number,
    pageW: number,
    pageH: number,
) {
    const a = stroke.pts[i - 1];
    const b = stroke.pts[i];
    if (!a || !b) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.e ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.c;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = widthFor(stroke, pageW, (a[2] + b[2]) / 2);
    ctx.beginPath();
    ctx.moveTo(a[0] * pageW, a[1] * pageH);
    ctx.lineTo(b[0] * pageW, b[1] * pageH);
    ctx.stroke();
    ctx.restore();
}

export function renderStrokes(
    ctx: CanvasRenderingContext2D,
    strokes: Stroke[],
    pageW: number,
    pageH: number,
) {
    for (const s of strokes) {
        for (let i = 1; i < s.pts.length; i++)
            drawStrokeSegment(ctx, s, i, pageW, pageH);
    }
}

export function undoEntry<T>(entry: Entry<T>) {
    const s = entry.strokes.pop();
    if (s) entry.undone.push(s);
    return entry.strokes;
}

export function redoEntry<T>(entry: Entry<T>) {
    const s = entry.undone.pop();
    if (s) entry.strokes.push(s);
    return entry.strokes;
}

const isPoint = (p: unknown): p is Point =>
    Array.isArray(p) &&
    p.length === 3 &&
    p.every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
    );

export function validateStrokes(value: unknown): value is Stroke[] {
    if (!Array.isArray(value) || value.length > 2000) return false;
    return value.every((s: unknown) => {
        if (typeof s !== "object" || s === null) return false;
        const o = s as Record<string, unknown>;
        return (
            typeof o.c === "string" &&
            /^#[0-9a-f]{6}$/i.test(o.c) &&
            typeof o.w === "number" &&
            Number.isFinite(o.w) &&
            o.w > 0 &&
            o.w <= 0.05 &&
            typeof o.e === "boolean" &&
            Array.isArray(o.pts) &&
            o.pts.length > 0 &&
            o.pts.length <= 20000 &&
            o.pts.every(isPoint)
        );
    });
}
