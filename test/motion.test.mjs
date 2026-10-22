import { test } from "node:test";
import assert from "node:assert/strict";
import { bezierPath, moveDuration, easeOutQuart, seededRandom, scrollSteps } from "../engine/motion.mjs";

test("move duration scales with distance within 400–1200 ms", () => {
  assert.equal(moveDuration(0), 400);
  assert.equal(moveDuration(500), 700);
  assert.equal(moveDuration(5000), 1200);
});

test("bezier path ends exactly on the target and bows away from the straight line", () => {
  const pts = bezierPath({ x: 0, y: 0 }, { x: 400, y: 0 }, { steps: 40 });
  assert.equal(pts.length, 40);
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.x - 400) < 1e-9 && Math.abs(last.y) < 1e-9);
  assert.ok(Math.max(...pts.map((p) => Math.abs(p.y))) > 10, "path should arc, not run straight");
});

test("overshoot passes the target and settles back on it", () => {
  const pts = bezierPath({ x: 0, y: 0 }, { x: 600, y: 0 }, { steps: 60, overshootPx: 3 });
  assert.ok(Math.max(...pts.map((p) => p.x)) > 600);
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.x - 600) < 1e-9);
});

test("easeOutQuart is monotonic from 0 to 1", () => {
  let prev = -1;
  for (let i = 0; i <= 10; i++) { const v = easeOutQuart(i / 10); assert.ok(v > prev); prev = v; }
  assert.equal(easeOutQuart(1), 1);
});

test("seeded random is deterministic", () => {
  const a = seededRandom(7), b = seededRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("scroll steps sum to the total", () => {
  assert.equal(scrollSteps(333, 500).reduce((s, v) => s + v, 0), 333);
  assert.equal(scrollSteps(-120, 300).reduce((s, v) => s + v, 0), -120);
});
