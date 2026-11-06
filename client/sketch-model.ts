// 座標はページ幅・高さで正規化した 0..1。w はページ幅に対する比率。
export type Point = [number, number, number];
export type Stroke = { c: string; w: number; e: boolean; pts: Point[] };
export type TextBox = {
    t: "text";
    id: string;
    x: number;
    y: number;
    s: number;
    c: string;
    text: string;
};
export type Annotation = Stroke | TextBox;
export type StrokeMap = Record<string, Annotation[]>;
export type Entry<T> = {
    items: T[];
    past: T[][];
    future: T[][];
    strokes: T[];
    undone: T[][];
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function fallbackUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export function newTextId(): string {
    return (
        (globalThis.crypto?.randomUUID?.() as string | undefined) ??
        fallbackUUID()
    );
}

export function createTextBox(v: {
    id?: string;
    x: number;
    y: number;
    s: number;
    color: string;
    text: string;
}): TextBox {
    return {
        t: "text",
        id: v.id ?? newTextId(),
        x: clamp01(v.x),
        y: clamp01(v.y),
        s: Math.min(0.07, Math.max(0.008, v.s)),
        c: v.color,
        text: v.text,
    };
}

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

export function renderAnnotations(
    ctx: CanvasRenderingContext2D,
    items: Annotation[],
    pageW: number,
    pageH: number,
) {
    for (const it of items) {
        if ((it as TextBox).t === "text") {
            const box = it as TextBox;
            const size = box.s * pageW;
            ctx.save();
            ctx.font = `${size}px sans-serif`;
            ctx.fillStyle = box.c;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const lines = box.text.split("\n");
            lines.forEach((line, i) => {
                ctx.fillText(
                    line,
                    box.x * pageW,
                    box.y * pageH + i * size * 1.25,
                );
            });
            ctx.restore();
        } else {
            const s = it as Stroke;
            for (let i = 1; i < s.pts.length; i++)
                drawStrokeSegment(ctx, s, i, pageW, pageH);
        }
    }
}

export function hitText(
    box: TextBox,
    x: number,
    y: number,
    pageW: number,
    pageH: number,
    ctx?: CanvasRenderingContext2D,
): boolean {
    const size = box.s * pageW;
    const lines = box.text.split("\n");
    let width: number;
    if (ctx) {
        ctx.save();
        ctx.font = `${size}px sans-serif`;
        width = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
        ctx.restore();
    } else {
        width = Math.max(0, ...lines.map((l) => l.length)) * size;
    }
    const height = lines.length * size * 1.25;
    const px = x * pageW;
    const py = y * pageH;
    const left = box.x * pageW - 4;
    const top = box.y * pageH - 4;
    return (
        px >= left &&
        px <= box.x * pageW + width + 4 &&
        py >= top &&
        py <= box.y * pageH + height + 4
    );
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createEntry<T>(items: T[] = []): Entry<T> {
    const e = {
        items,
        past: [] as T[][],
        future: [] as T[][],
    } as unknown as Entry<T>;
    e.strokes = e.items;
    e.undone = e.future;
    return e;
}

export function pushHistory<T>(entry: Entry<T>) {
    entry.past.push(clone(entry.items));
    if (entry.past.length > 50) entry.past.shift();
    entry.future.length = 0;
}

export function undoEntry<T>(entry: Entry<T>) {
    const prev = entry.past.pop();
    if (!prev) return entry.items;
    entry.future.push(clone(entry.items));
    entry.items.splice(0, entry.items.length, ...clone(prev));
    return entry.items;
}

export function redoEntry<T>(entry: Entry<T>) {
    const next = entry.future.pop();
    if (!next) return entry.items;
    entry.past.push(clone(entry.items));
    entry.items.splice(0, entry.items.length, ...clone(next));
    return entry.items;
}

const isPoint = (p: unknown): p is Point =>
    Array.isArray(p) &&
    p.length === 3 &&
    p.every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
    );

const isHex = (v: unknown): v is string =>
    typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function isStroke(v: unknown): v is Stroke {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return (
        isHex(o.c) &&
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
}

function isTextBox(v: unknown): v is TextBox {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    if (o.t !== "text") return false;
    return (
        typeof o.id === "string" &&
        o.id.length >= 1 &&
        o.id.length <= 64 &&
        typeof o.x === "number" &&
        Number.isFinite(o.x) &&
        o.x >= 0 &&
        o.x <= 1 &&
        typeof o.y === "number" &&
        Number.isFinite(o.y) &&
        o.y >= 0 &&
        o.y <= 1 &&
        typeof o.s === "number" &&
        Number.isFinite(o.s) &&
        o.s >= 0.008 &&
        o.s <= 0.07 &&
        isHex(o.c) &&
        typeof o.text === "string" &&
        o.text.length >= 1 &&
        o.text.length <= 200 &&
        o.text.trim().length > 0 &&
        !o.text.includes("\0")
    );
}

export function validateAnnotations(value: unknown): value is Annotation[] {
    if (!Array.isArray(value) || value.length > 2000) return false;
    return value.every((v: unknown) => isStroke(v) || isTextBox(v));
}

export function validateStrokes(value: unknown): value is Stroke[] {
    if (!Array.isArray(value) || value.length > 2000) return false;
    return value.every((s: unknown) => isStroke(s));
}
