import assert from "node:assert/strict";
import test from "node:test";
import type { Entry, Stroke } from "../client/sketch-model.ts";
import {
    appendPoint,
    createStroke,
    drawStrokeSegment,
    redoEntry,
    renderStrokes,
    undoEntry,
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
        set strokeStyle(v: string) {
            rec.push(["style", v]);
        },
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
    const entry: Entry<Stroke> = {
        strokes: [
            { c: "#e11d48", w: 0.003, e: false, pts: [[0.1, 0.2, 0.5]] },
            { c: "#e11d48", w: 0.003, e: false, pts: [[0.3, 0.4, 0.5]] },
        ],
        undone: [],
    };
    undoEntry(entry);
    assert.equal(entry.strokes.length, 1);
    assert.equal(entry.undone.length, 1);
    redoEntry(entry);
    assert.equal(entry.strokes.length, 2);
    assert.equal(entry.undone.length, 0);
});
