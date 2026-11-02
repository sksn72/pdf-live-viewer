import assert from "node:assert/strict";
import test from "node:test";

import { brushCursor, matchShortcut, wheelZoomFactor } from "../client/ui.ts";

test("brushCursor はブラシ径の円と中心ホットスポットを返す", () => {
    const cursor = brushCursor(10, "#e11d48", false);
    const svg = decodeURIComponent(cursor);
    assert.match(cursor, /^url\("data:image\/svg\+xml,/);
    assert.match(cursor, /\) 5 5, crosshair$/);
    assert.match(svg, /width="10" height="10"/);
    assert.match(svg, /stroke="#e11d48"/);
});

test("brushCursor は消しゴムを灰色の破線にする", () => {
    const svg = decodeURIComponent(brushCursor(10, "#e11d48", true));
    assert.match(svg, /stroke="#64748b"/);
    assert.match(svg, /stroke-dasharray="2 2"/);
    assert.doesNotMatch(svg, /#e11d48/);
});

test("brushCursor は極小でも最低2px", () => {
    const cursor = brushCursor(0.1, "#000000", false);
    assert.match(decodeURIComponent(cursor), /width="2" height="2"/);
});

test("matchShortcut は undo/redo を返す", () => {
    assert.equal(matchShortcut("z", true, false, false), "undo");
    assert.equal(matchShortcut("Z", true, true, false), "redo");
    assert.equal(matchShortcut("y", true, false, false), "redo");
    assert.equal(matchShortcut("z", false, false, false), null);
});

test("matchShortcut はツールとズームを返す", () => {
    assert.equal(matchShortcut("b", false, false, false), "pen");
    assert.equal(matchShortcut("E", false, false, false), "eraser");
    assert.equal(matchShortcut("+", false, true, false), "zoomIn");
    assert.equal(matchShortcut("=", false, false, false), "zoomIn");
    assert.equal(matchShortcut("-", false, false, false), "zoomOut");
    assert.equal(matchShortcut("_", false, true, false), "zoomOut");
});

test("matchShortcut は修飾キー付きのツール操作を無視する", () => {
    assert.equal(matchShortcut("b", true, false, false), null);
    assert.equal(matchShortcut("b", false, false, true), null);
});

test("wheelZoomFactor は上方向で拡大、下方向で縮小する", () => {
    assert.ok(wheelZoomFactor(-100) > 1);
    assert.ok(wheelZoomFactor(100) < 1);
    assert.equal(wheelZoomFactor(0), 1);
});

test("wheelZoomFactor は 0.5〜2 に収める", () => {
    assert.equal(wheelZoomFactor(-10000), 2);
    assert.equal(wheelZoomFactor(10000), 0.5);
});
