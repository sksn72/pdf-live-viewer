export type Shortcut =
    | "undo"
    | "redo"
    | "pen"
    | "eraser"
    | "text"
    | "zoomIn"
    | "zoomOut";

export function brushCursor(
    widthPx: number,
    color: string,
    erase: boolean,
): string {
    const size = Math.max(2, Math.round(widthPx));
    const radius = size / 2;
    const stroke = erase ? "#64748b" : color;
    const dash = erase ? ' stroke-dasharray="2 2"' : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${radius}" cy="${radius}" r="${Math.max(0.5, radius - 1)}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash}/><circle cx="${radius}" cy="${radius}" r="0.75" fill="${stroke}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${radius} ${radius}, crosshair`;
}

export function wheelZoomFactor(delta: number): number {
    return Math.min(2, Math.max(0.5, Math.exp(-delta * 0.002)));
}

export function matchShortcut(
    key: string,
    ctrlOrMeta: boolean,
    shift: boolean,
    alt: boolean,
): Shortcut | null {
    if (alt) return null;
    const k = key.toLowerCase();
    if (ctrlOrMeta) {
        if (k === "z") return shift ? "redo" : "undo";
        if (k === "y") return "redo";
        return null;
    }
    if (k === "b") return "pen";
    if (k === "e") return "eraser";
    if (k === "t") return "text";
    if (key === "+" || key === "=") return "zoomIn";
    if (key === "-" || key === "_") return "zoomOut";
    return null;
}
