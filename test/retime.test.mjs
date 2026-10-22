import { test } from "node:test";
import assert from "node:assert/strict";
import { retime, sampleCfr, concatText, frameAt } from "../engine/retime.mjs";

const frames = (...rel) => rel.map((r, i) => ({ file: `f${i}.jpg`, ts: 1000 + r }));

test("frames hold until the next frame and the last holds to tEnd", () => {
  const { entries, durationMs, dropped } = retime({ frames: frames(0, 100, 250), t0: 1000, tEnd: 1600 });
  assert.deepEqual(entries.map((e) => e.durationMs), [100, 150, 350]);
  assert.equal(durationMs, 600);
  assert.equal(dropped, 0);
});

test("a first frame presented before or after t0 covers the timeline from 0", () => {
  const a = retime({ frames: frames(-20, 100), t0: 1000, tEnd: 1200 });
  assert.deepEqual(a.entries.map((e) => e.durationMs), [100, 100]);
  const b = retime({ frames: frames(30, 100), t0: 1000, tEnd: 1200 });
  assert.deepEqual(b.entries.map((e) => e.durationMs), [100, 100]);
});

test("frames after tEnd are dropped", () => {
  const { entries, dropped } = retime({ frames: frames(0, 100, 900), t0: 1000, tEnd: 1500 });
  assert.equal(entries.length, 2);
  assert.equal(dropped, 1);
});

test("trims cut time out of the timeline and drop fully trimmed frames", () => {
  const { entries, durationMs, dropped } = retime({ frames: frames(0, 100, 200, 300), t0: 1000, tEnd: 1400, trims: [[150, 320]] });
  // f0: 0-100 (100), f1: 100-200 minus [150,200] = 50, f2: 200-300 fully trimmed, f3: 300-400 minus [300,320] = 80
  assert.deepEqual(entries.map((e) => e.file), ["f0.jpg", "f1.jpg", "f3.jpg"]);
  assert.deepEqual(entries.map((e) => e.durationMs), [100, 50, 80]);
  assert.equal(durationMs, 230);
  assert.equal(dropped, 1);
});

test("sampleCfr holds the previous frame and yields round(duration*fps) frames", () => {
  const { entries, durationMs } = retime({ frames: frames(0, 100, 250), t0: 1000, tEnd: 1600 });
  const files = sampleCfr(entries, durationMs, 10);          // 600 ms at 10 fps → 6 frames at 0,100,...,500
  assert.deepEqual(files, ["f0.jpg", "f1.jpg", "f1.jpg", "f2.jpg", "f2.jpg", "f2.jpg"]);
  assert.equal(sampleCfr(entries, 7893, 30).length, 237);
});

test("concat text repeats the last file and uses a constant duration", () => {
  const text = concatText(["a.jpg", "b.jpg"], 25);
  assert.equal(text, "file 'a.jpg'\nduration 0.040000\nfile 'b.jpg'\nduration 0.040000\nfile 'b.jpg'\n");
});

test("frameAt returns the nearest previous frame", () => {
  const { entries } = retime({ frames: frames(0, 100, 250), t0: 1000, tEnd: 1600 });
  assert.equal(frameAt(entries, 0), 0);
  assert.equal(frameAt(entries, 120), 1);
  assert.equal(frameAt(entries, 250), 2);
  assert.equal(frameAt(entries, 10_000), 2);
});
