import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { comparePngs, decideReturn, crossfadeFilter, LOOP } from "../engine/loop.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "ui-clips-loop-"));
function png(name, paint) {
  const p = new PNG({ width: 40, height: 30 });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = 240; p.data[i + 1] = 240; p.data[i + 2] = 240; p.data[i + 3] = 255; }
  if (paint) paint(p);
  const f = path.join(dir, name);
  writeFileSync(f, PNG.sync.write(p));
  return f;
}
const blot = (n) => (p) => { for (let i = 0; i < n; i++) { const o = i * 4; p.data[o] = 20; p.data[o + 1] = 20; p.data[o + 2] = 20; } };

test("comparePngs reports the fraction of differing pixels", () => {
  const a = png("a.png"), b = png("b.png", blot(12));
  assert.equal(comparePngs(a, a).ratio, 0);
  assert.equal(comparePngs(a, b).diffPixels, 12);
  assert.ok(Math.abs(comparePngs(a, b).ratio - 12 / 1200) < 1e-12);
});

test("decideReturn: last frame matching needs no trim; otherwise trim to the last matching tail frame", () => {
  const first = png("first.png");
  const same = png("same.png"), off = png("off.png", blot(30)), tiny = png("tiny.png", blot(2));
  assert.deepEqual(decideReturn(first, [off, same]).endFrame, null);
  const trimmed = decideReturn(first, [off, same, off]);
  assert.equal(trimmed.ok, true); assert.equal(trimmed.endFrame, 1);
  assert.equal(decideReturn(first, [off, off]).ok, false);
  assert.equal(decideReturn(first, [tiny]).ok, true, `${2 / 1200} is under the ${LOOP.tolerance} tolerance`);
});

test("crossfade filter trims to D−F so the last frame equals the first", () => {
  assert.equal(crossfadeFilter(5.6), "[0:v][1:v]xfade=transition=fade:duration=0.400:offset=5.200[x];[x]trim=start=0.400:end=5.600,setpts=PTS-STARTPTS[v]");
});
