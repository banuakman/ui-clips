import { test } from "node:test";
import assert from "node:assert/strict";
import { detectShots, simulateCamera, atRest, padBox, scaleFor, sendcmdText, windowAt, CAMERA } from "../engine/camera.mjs";

const vp = { width: 1440, height: 900 };
const click = (t, x, y, w = 100, h = 40) => ({ t, kind: "click", x, y, w, h });

test("two clicks within 3 s form a cluster; a lone click with no dwell does not", () => {
  const a = detectShots([click(1000, 600, 400), click(2500, 700, 450), click(9000, 100, 100)], { mode: "gentle", viewport: vp, durationMs: 9400, exportWidth: 1440 });
  assert.equal(a.shots.length, 1);
  assert.equal(a.shots[0].startMs, 1000 - CAMERA.leadMs);
  assert.equal(a.shots[0].endMs, 2500 + CAMERA.releaseMs);
  assert.equal(a.shots[0].targets.length, 2);
});

test("a hover dwell or a hold after a click opens a shot on its own", () => {
  const h = detectShots([{ t: 1000, kind: "hover", x: 600, y: 400, w: 100, h: 40, holdMs: 1600 }], { mode: "gentle", viewport: vp, durationMs: 6000, exportWidth: 1440 });
  assert.equal(h.shots.length, 1);
  const c = detectShots([click(1000, 600, 400)], { mode: "gentle", viewport: vp, durationMs: 6000, exportWidth: 1440 });
  assert.equal(c.shots.length, 1, "the clip ends 5 s after the click, which is a dwell");
});

test("scale is capped by mode and by the source resolution at export width", () => {
  const box = padBox({ x: 700, y: 440, w: 40, h: 20 }, vp.width, vp.height);
  assert.equal(scaleFor(box, { vw: 1440, vh: 900, maxScale: 1.6, sourceCap: 2 }), 1.6);
  assert.equal(scaleFor(box, { vw: 1440, vh: 900, maxScale: 2.2, sourceCap: 2 }), 2, "2× source at 1440 export → at most 2×");
  assert.equal(scaleFor({ x: 0, y: 0, w: 1440, h: 900 }, { vw: 1440, vh: 900, maxScale: 2.2, sourceCap: 2 }), 1);
});

test("off mode yields no shots; the camera stays at rest", () => {
  const { shots } = detectShots([click(1000, 600, 400), click(1500, 700, 450)], { mode: "off", viewport: vp, durationMs: 5000, exportWidth: 1440 });
  assert.equal(shots.length, 0);
  const frames = simulateCamera(shots, { viewport: vp, durationMs: 5000, fps: 30 });
  assert.equal(frames.length, 150);
  assert.ok(frames.every(atRest));
});

test("the spring reaches the target smoothly and returns to rest before the end", () => {
  const { shots, warnings } = detectShots([click(1000, 600, 400), click(1800, 700, 450)], { mode: "gentle", viewport: vp, durationMs: 6000, exportWidth: 1440 });
  const frames = simulateCamera(shots, { viewport: vp, durationMs: 6000, fps: 30 });
  assert.ok(atRest(frames[0]));
  const peak = Math.max(...frames.map((f) => f.scale));
  assert.ok(peak > 1.55 && peak <= 1.6, `peak ${peak}`);
  // continuous motion (critically damped: no overshoot), no window outside the viewport
  let rising = true;
  for (let i = 1; i < frames.length; i++) {
    const step = frames[i].scale - frames[i - 1].scale;
    assert.ok(Math.abs(step) < 0.15, `scale step at ${i}`);
    if (rising && step < -1e-6 && frames[i - 1].scale > 1.5) rising = false;
    if (!rising) assert.ok(step <= 1e-6, `scale rose again at ${i}`);
    assert.ok(frames[i].x >= 0 && frames[i].y >= 0 && frames[i].x + frames[i].w <= vp.width + 1e-6 && frames[i].y + frames[i].h <= vp.height + 1e-6);
  }
  assert.ok(atRest(frames[frames.length - 1]), "ends at rest");
  assert.equal(warnings.length, 0);
});

test("explicit zoomTo overrides auto shots in its window and ends at zoomOut", () => {
  const explicit = [{ t: 900, kind: "zoomTo", box: { x: 100, y: 100, width: 200, height: 100 }, scale: 1.4 }, { t: 3000, kind: "zoomOut" }];
  const { shots } = detectShots([click(1000, 600, 400), click(1500, 700, 450)], { mode: "gentle", viewport: vp, durationMs: 6000, exportWidth: 1440, explicit });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].source, "explicit");
  assert.equal(shots[0].endMs, 3000);
  assert.ok(Math.abs(shots[0].targets[0].scale - 1.4) < 1e-9);
});

test("a shot that runs into the end is released early with a warning", () => {
  const { shots, warnings } = detectShots([click(3400, 600, 400), click(4000, 700, 450)], { mode: "gentle", viewport: vp, durationMs: 6000, exportWidth: 1440 });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].endMs, 6000 - CAMERA.restMarginMs);
  assert.equal(warnings.length, 1);
  const late = detectShots([click(4300, 600, 400), click(4600, 700, 450)], { mode: "gentle", viewport: vp, durationMs: 6000, exportWidth: 1440 });
  assert.equal(late.shots.length, 0, "too late to zoom and return to rest: dropped");
  assert.equal(late.warnings.length, 1);
});

test("sendcmd lines use even device pixels inside the source frame", () => {
  const text = sendcmdText([{ t: 0, x: 0, y: 0, w: 1440, h: 900, scale: 1 }, { t: 33.33, x: 500.3, y: 300.7, w: 900, h: 562.5, scale: 1.6 }], { deviceScaleFactor: 2, viewport: vp, fps: 30 });
  assert.equal(text.split("\n")[0], "0.0000 crop w 2880, crop h 1800, crop x 0, crop y 0;");
  assert.equal(text.split("\n")[1], "0.0333 crop w 1800, crop h 1126, crop x 1000, crop y 602;");
  assert.deepEqual(windowAt([{ t: 0, scale: 1 }, { t: 100, scale: 1.2 }], 150), { t: 100, scale: 1.2 });
});
