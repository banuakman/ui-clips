import { test } from "node:test";
import assert from "node:assert/strict";
import { arrowGeometry, cursorInitScript, ARROW_PATH, CLICK } from "../engine/cursor.mjs";

test("arrow geometry scales the 14×20 viewBox and keeps the hotspot on the tip", () => {
  const g = arrowGeometry(22);
  assert.equal(g.height, 22);
  assert.ok(Math.abs(g.width - 15.4) < 1e-9);
  assert.ok(Math.abs(g.hotspot.x - 1.1) < 1e-9 && Math.abs(g.hotspot.y - 1.1) < 1e-9);
  assert.deepEqual(arrowGeometry(20).hotspot, { x: 1, y: 1 });
});

test("arrow is the default style with the appendix D path, outline, shadow and colour", () => {
  const js = cursorInitScript({ color: "#1f2937" });
  assert.ok(js.includes(ARROW_PATH));
  assert.ok(js.includes('viewBox=\\"0 0 14 20\\"'));
  assert.ok(js.includes('fill=\\"#1f2937\\"'));
  assert.ok(js.includes('stroke=\\"#fff\\" stroke-width=\\"1.4\\" stroke-linejoin=\\"round\\"'));
  assert.ok(js.includes("vector-effect=\\\"non-scaling-stroke\\\""));
  assert.ok(js.includes("drop-shadow(0 1px 1px rgba(0,0,0,.35)) drop-shadow(0 2px 4px rgba(0,0,0,.18))"));
  assert.ok(js.includes("transform-origin:1.1px 1.1px"), "dip scales around the tip");
});

test("click feedback follows the spec: 92% dip for 80 ms, ring 28→48 px over 350 ms at 28%/8%", () => {
  assert.deepEqual({ ...CLICK }, { dipScale: 0.92, dipMs: 80, ringFrom: 28, ringTo: 48, ringMs: 350, ringStrokeAlpha: 0.28, ringFillAlpha: 0.08 });
  const js = cursorInitScript({ style: "arrow", color: "#1f2937" });
  assert.ok(js.includes('scale(0.92)'));
  assert.ok(js.includes("width:28px;height:28px"));
  assert.ok(js.includes(`scale(${(48 / 28).toFixed(4)})`));
  assert.ok(js.includes("duration: 350"));
  assert.ok(js.includes("28%, transparent") && js.includes("8%, transparent"));
});

test("dot and none remain available", () => {
  assert.ok(cursorInitScript({ style: "dot", size: 16 }).includes("<circle"));
  assert.equal(cursorInitScript({ style: "none" }), "");
  assert.ok(!cursorInitScript({ style: "arrow", ripple: false }).includes("if (!true) return;"));
});
