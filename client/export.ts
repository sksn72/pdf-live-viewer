import { PDFDocument } from "pdf-lib";
import type { StrokeMap } from "./sketch-model.js";
import { renderStrokes } from "./sketch-model.js";

const DPR = 2;

export async function exportAnnotated({
    id,
    version,
    name,
}: {
    id: string;
    version: number;
    name: string;
}) {
    const bytes = await fetch(`/api/pdfs/${id}/versions/${version}`).then((r) =>
        r.arrayBuffer(),
    );
    const { pages } = (await fetch(
        `/api/pdfs/${id}/versions/${version}/sketches`,
    ).then((r) => r.json())) as {
        pages?: StrokeMap;
    };
    const out = await PDFDocument.load(bytes);

    for (const [key, strokes] of Object.entries(pages ?? {})) {
        if (!Array.isArray(strokes) || strokes.length === 0) continue;
        const page = out.getPage(Number(key) - 1);
        if (!page) continue;
        const { width, height } = page.getSize();
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * DPR));
        canvas.height = Math.max(1, Math.round(height * DPR));
        renderStrokes(
            canvas.getContext("2d") as CanvasRenderingContext2D,
            strokes,
            canvas.width,
            canvas.height,
        );
        const png = await out.embedPng(canvas.toDataURL("image/png"));
        // shortcut: /Rotate 付きページは合成位置がずれる。必要になったら page.getRotation() で回転させる
        page.drawImage(png, { x: 0, y: 0, width, height });
    }

    const saved = await out.save();
    const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\.pdf$/i, "")}-v${version}-annotated.pdf`;
    a.click();
    URL.revokeObjectURL(url);
}
