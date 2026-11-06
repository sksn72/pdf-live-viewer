import assert from "node:assert/strict";
import test from "node:test";
import type { Entry, Stroke } from "../client/sketch-model.ts";
import {
    appendPoint,
    createEntry,
    createStroke,
    drawStrokeSegment,
    hitText,
    newTextId,
    pushHistory,
    redoEntry,
    renderAnnotations,
    renderStrokes,
    undoEntry,
    validateAnnotations,
    validateStrokes,
} from "../client/sketch-model.ts";

function fakeCtx() {
    const rec: [string, unknown][] = [];
    const ctx = {
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillText(text: string) {
            rec.push(["text", text]);
        },
        measureText(text: string) {
            return { width: text.length * 10 };
        },
        set strokeStyle(v: string) {
            rec.push(["style", v]);
        },
        set fillStyle(v: string) {
            rec.push(["fillStyle", v]);
        },
        set font(v: string) {
            rec.push(["font", v]);
        },
        set textAlign(_v: string) {},
        set textBaseline(_v: string) {},
        set lineWidth(v: number) {
            rec.push(["width", v]);
        },
        set lineCap(_v: string) {},
        set lineJoin(_v: string) {},
        set globalCompositeOperation(v: string) {
            rec.push(["op", v]);
        },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

test("appendPoint は 0..1 にクランプする", () => {
    const s = createStroke({ color: "#e11d48", width: 0.003 });
    appendPoint(s, -0.2, 1.4, 2);
    assert.deepEqual(s.pts, [[0, 1, 1]]);
});

test("renderStrokes は点の数-1 回線を引く", () => {
    const { ctx, rec } = fakeCtx();
    const s = createStroke({ color: "#e11d48", width: 0.003 });
    appendPoint(s, 0.1, 0.1, 0.5);
    appendPoint(s, 0.2, 0.2, 0.5);
    appendPoint(s, 0.3, 0.3, 0.5);
    renderStrokes(ctx, [s], 400, 600);
    assert.equal(rec.filter(([k]) => k === "width").length, 2);
    assert.equal(rec.find(([k]) => k === "width")?.[1], 0.003 * 400);
});

test("消しゴムは destination-out で描く", () => {
    const { ctx, rec } = fakeCtx();
    const s = createStroke({ color: "#000000", width: 0.003, erase: true });
    appendPoint(s, 0.1, 0.1, 0.5);
    appendPoint(s, 0.2, 0.2, 0.5);
    drawStrokeSegment(ctx, s, 1, 400, 600);
    assert.deepEqual(
        rec.find(([k]) => k === "op"),
        ["op", "destination-out"],
    );
});

test("validateStrokes", () => {
    const ok = [{ c: "#e11d48", w: 0.003, e: false, pts: [[0.1, 0.2, 0.5]] }];
    assert.equal(validateStrokes(ok), true);
    assert.equal(validateStrokes([]), true);
    assert.equal(validateStrokes("x"), false);
    assert.equal(
        validateStrokes([
            { c: "red", w: 0.003, e: false, pts: [[0.1, 0.2, 0.5]] },
        ]),
        false,
    );
    assert.equal(
        validateStrokes([
            { c: "#e11d48", w: 9, e: false, pts: [[0.1, 0.2, 0.5]] },
        ]),
        false,
    );
    assert.equal(
        validateStrokes([
            { c: "#e11d48", w: 0.003, e: "no", pts: [[0.1, 0.2, 0.5]] },
        ]),
        false,
    );
    assert.equal(
        validateStrokes([
            { c: "#e11d48", w: 0.003, e: false, pts: [[2, 0.2, 0.5]] },
        ]),
        false,
    );
});

test("undo/redo", () => {
    const entry: Entry<Stroke> = createEntry([
        { c: "#e11d48", w: 0.003, e: false, pts: [[0.1, 0.2, 0.5]] },
        { c: "#e11d48", w: 0.003, e: false, pts: [[0.3, 0.4, 0.5]] },
    ]);
    pushHistory(entry);
    undoEntry(entry);
    assert.equal(entry.items.length, 2);
    redoEntry(entry);
    assert.equal(entry.items.length, 2);
});

test("validateAnnotations は手書きのみでも通る", () => {
    assert.equal(
        validateAnnotations([
            { c: "#e11d48", w: 0.003, e: false, pts: [[0.1, 0.2, 0.5]] },
        ]),
        true,
    );
});
test("validateAnnotations は手書きと文字の混在を通す", () => {
    assert.equal(
        validateAnnotations([
            { c: "#e11d48", w: 0.003, e: false, pts: [[0.1, 0.2, 0.5]] },
            {
                t: "text",
                id: "a",
                x: 0.1,
                y: 0.1,
                s: 0.02,
                c: "#1f2937",
                text: "メモ",
            },
        ]),
        true,
    );
});
test("validateAnnotations は範囲外・空白のみ・欠けた文字を弾く", () => {
    assert.equal(
        validateAnnotations([
            {
                t: "text",
                id: "a",
                x: 0.1,
                y: 0.1,
                s: 0.007,
                c: "#1f2937",
                text: "x",
            },
        ]),
        false,
    );
    assert.equal(
        validateAnnotations([
            {
                t: "text",
                id: "a",
                x: 0.1,
                y: 0.1,
                s: 0.02,
                c: "#1f2937",
                text: "  ",
            },
        ]),
        false,
    );
    assert.equal(
        validateAnnotations([
            { t: "text", x: 0.1, y: 0.1, s: 0.02, c: "#1f2937", text: "x" },
        ]),
        false,
    );
});
test("renderAnnotations は行ごとに文字を描く", () => {
    const { ctx, rec } = fakeCtx();
    renderAnnotations(
        ctx,
        [
            {
                t: "text",
                id: "a",
                x: 0.1,
                y: 0.2,
                s: 0.02,
                c: "#1f2937",
                text: "a\nb",
            },
        ],
        400,
        600,
    );
    assert.equal(rec.filter(([k]) => k === "text").length, 2);
});
test("hitText は文字矩形の内側だけ当てる", () => {
    const box = {
        t: "text",
        id: "a",
        x: 0.1,
        y: 0.2,
        s: 0.02,
        c: "#1f2937",
        text: "あ",
    } as const;
    assert.equal(hitText(box, 0.11, 0.21, 400, 600), true);
    assert.equal(hitText(box, 0.9, 0.9, 400, 600), false);
});
test("newTextId はフォールバックでも非空文字列を返す", () => {
    assert.ok(newTextId().length > 0);
});
test("undo/redo は配列全体のスナップショットで戻す", () => {
    const e = createEntry([1, 2]);
    pushHistory(e);
    e.items.push(3);
    undoEntry(e);
    assert.deepEqual(e.items, [1, 2]);
    redoEntry(e);
    assert.deepEqual(e.items, [1, 2, 3]);
});
