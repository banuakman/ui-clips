import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeMap } from "../engine/timemap.mjs";
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

test("stage: edge-spanning exclusions are cut, interior ones masked; filter has crop, drawbox and pad", () => {
  const vp = { width: 1440, height: 1000 };
  const s = stageRect(vp, [{ x: 0, y: 0, w: 250, h: 1000 }, { x: 700, y: 900, w: 300, h: 40 }]);
  assert.deepEqual([s.x, s.y, s.w, s.h], [250, 0, 1190, 1000]);
  assert.equal(s.masks.length, 1);
  assert.deepEqual(s.masks[0], { x: 450, y: 900, w: 300, h: 40 });
  const f = stageFilter(s, { dsf: 2, fill: "#FFFFFF", padBelowCss: 100 });
  assert.equal(f, "crop=2380:2000:500:0,drawbox@m0=x=900:y=1800:w=600:h=80:color=#FFFFFF:t=fill,pad=iw:ih+200:0:0:color=#FFFFFF");
});
