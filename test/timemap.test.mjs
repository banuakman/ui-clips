import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeMap, buildTakeTimeMap, trimMap, normaliseTrims } from "../engine/timemap.mjs";
import { retime } from "../engine/retime.mjs";
import { stageRect, stageFilter } from "../engine/stage.mjs";

test("time map compresses sped-up stretches and inverts exactly", () => {
  const m = buildTimeMap([{ from: 2000, to: 5000, factor: 3 }], 8000);
  assert.equal(m.outputDurationMs, 6000);
  assert.equal(m.toOutput(1000), 1000);
  assert.equal(m.toOutput(3500), 2500);
  assert.equal(m.toOutput(5000), 3000);
  assert.equal(m.toOutput(8000), 6000);
  for (const t of [0, 1999, 2000, 2500, 4999, 5000, 7000]) assert.ok(Math.abs(m.toSource(m.toOutput(t)) - t) < 1e-9, `round trip ${t}`);
  assert.ok(buildTimeMap([], 1000).identity);
});

test("trim map: a time inside a trim lands on its start, a time after moves back by its length", () => {
  const cut = trimMap([[5584, 6579]]);
  assert.equal(cut(1000), 1000);
  assert.equal(cut(5584), 5584);
  assert.equal(cut(6000), 5584);
  assert.equal(cut(6579), 5584);
  assert.equal(cut(6770), 5775, "the tx-home wide shot");
  const two = trimMap([[3000, 2000 + 2000], [1000, 1500]]);   // unsorted
  assert.equal(two(1200), 1000);
  assert.equal(two(2000), 1500);
  assert.equal(two(5000), 3500);
  assert.deepEqual(normaliseTrims([[100, 300], [200, 400], [-50, 20], [900, 800]]), [[0, 20], [100, 400]], "clamped, merged, empty dropped");
});

test("take time map: trims then speed ramps (whose ranges are take time), consistent with the retimed frames", () => {
  const take = { trims: [[2000, 3000]], speeds: [{ from: 4000, to: 6000, factor: 2 }], frames: [0, 1000, 2500, 4000].map((r, i) => ({ file: `f${i}`, ts: r })), t0: 0, tEnd: 8000 };
  const { durationMs } = retime(take);
  assert.equal(durationMs, 7000);
  const m = buildTakeTimeMap(take, durationMs);
  assert.equal(m.outputDurationMs, 6000);
  assert.equal(m.trimmedOutMs, 1000);
  assert.equal(m.toOutput(1500), 1500);
  assert.equal(m.toOutput(2500), 2000);
  assert.equal(m.toOutput(4000), 3000, "the ramp starts where it was logged, after the cut");
  assert.equal(m.toOutput(6000), 4000);
  assert.equal(m.toOutput(8000), m.outputDurationMs);
  assert.equal(m.toSource(3000), 3000, "toSource gives the retimed (post-trim) timeline");
  assert.ok(!m.identity && buildTakeTimeMap({}, 1000).identity);
});

test("stage: edge-spanning exclusions are cut, interior ones masked; filter has crop, drawbox and pad", () => {
  const vp = { width: 1440, height: 1000 };
  const s = stageRect(vp, [{ x: 0, y: 0, w: 250, h: 1000 }, { x: 700, y: 900, w: 300, h: 40 }]);
  assert.deepEqual([s.x, s.y, s.w, s.h], [250, 0, 1190, 1000]);
  assert.equal(s.masks.length, 1);
  assert.deepEqual(s.masks[0], { x: 450, y: 900, w: 300, h: 40 });
  const f = stageFilter(s, { dsf: 2, fill: "#FFFFFF", padBelowCss: 100 });
  assert.equal(f, "crop=2380:2000:500:0,drawbox@m0=x=900:y=1800:w=600:h=80:color=#FFFFFF:t=fill,pad=iw:ih+200:0:0:color=#FFFFFF");
});
