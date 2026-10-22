import { test } from "node:test";
import assert from "node:assert/strict";
import { FEEL, CAMERA, frameGeometry, frameAround, detectShots, buildExplicit, buildTrack, atRest, sendcmdText, windowAt } from "../engine/camera.mjs";

const stage = { x: 0, y: 0, w: 1440, h: 900, masks: [], cuts: [] };
const geo = frameGeometry(stage, { aspect: 1440 / 900, outWidthPx: 1440, deviceScaleFactor: 2 });
const click = (t, x, y, w = 100, h = 40) => ({ t, kind: "click", x, y, w, h });

test("feel presets carry the appendix D constants, critically damped", () => {
  assert.deepEqual(FEEL.brisk, { stiffness: 120, damping: 22 });
  assert.deepEqual(FEEL.calm, { stiffness: 65, damping: 16 });
  assert.deepEqual(FEEL.lazy, { stiffness: 40, damping: 12.6 });
  for (const f of Object.values(FEEL)) assert.ok(Math.abs(f.damping - 2 * Math.sqrt(f.stiffness)) < 0.6);
});

test("frame geometry: wide fits the stage width top-aligned; floor is half the output width in CSS px", () => {
  assert.deepEqual(geo.wide, { x: 0, y: 0, w: 1440, h: 900 });
  assert.equal(geo.floorW, 720);
  const card = frameGeometry(stage, { aspect: 4 / 5, outWidthPx: 960, deviceScaleFactor: 2 });
  assert.equal(card.wide.h, 1800);
  assert.equal(card.padBelow, 900, "a 4:5 wide of a landscape stage extends into the fill");
  assert.equal(card.floorW, 480);
});

test("frameAround: smallest frame of the aspect containing the box, never below the floor, top-aligned when tall", () => {
  const f = frameAround({ x: 600, y: 400, w: 100, h: 40 }, geo, stage);
  assert.equal(f.w, 720); assert.equal(f.h, 450);
  assert.equal(f.x + f.w / 2, 650);
  const tall = frameAround({ x: 100, y: 50, w: 200, h: 800 }, geo, stage);
  assert.equal(tall.y, 50, "taller than the frame → aligned to its top");
});

test("auto: cluster, re-aim on a far action, cap on a huge box, rest before the end", () => {
  const near = detectShots([click(1000, 600, 400), click(2000, 650, 420)], { mode: "gentle", stage, durationMs: 8000, geo });
  assert.equal(near.shots.length, 1);
  const far = detectShots([click(1000, 100, 100), click(1500, 150, 120), click(2500, 1300, 800), click(3000, 1250, 780)], { mode: "gentle", stage, durationMs: 9000, geo });
  assert.equal(far.shots.length, 2, "the third click is far outside the first shot → new shot (re-aim)");
  assert.ok(far.shots[1].startMs > far.shots[0].endMs - CAMERA.releaseMs, "the camera moves rather than growing the box");
  const huge = detectShots([click(1000, 50, 50, 1300, 100), click(2000, 60, 300, 1300, 100)], { mode: "gentle", stage, durationMs: 8000, geo });
  assert.equal(huge.shots.length, 0, "a box over 65% of the stage width goes wide");
  const late = detectShots([click(7000, 600, 400), click(7300, 650, 420)], { mode: "gentle", stage, durationMs: 8000, geo, feel: "brisk" });
  assert.equal(late.shots.length, 0); assert.equal(late.warnings.length, 1);
  assert.equal(detectShots([click(1000, 600, 400), click(2000, 650, 420)], { mode: "off", stage, durationMs: 8000, geo }).shots.length, 0);
});

test("explicit: eased move over the stated duration, min hold enforced, tracked focus follows", () => {
  const tracks = { row: [[0, 100, 100, 300, 40], [2000, 100, 300, 300, 40]] };
  const shots = [
    { t: 1000, kind: "focus", targets: [{ track: "row" }], padding: 24, ms: 600 },
    { t: 1300, kind: "wide", ms: 400 },     // too soon: must hold 600 ms after the move
  ];
  const ex = buildExplicit(shots, { tracks, stage, geo, actions: [click(1200, 100, 100)] });
  assert.equal(ex.shots[1].t, 1000 + 600 + CAMERA.explicitMinHoldMs);
  assert.ok(ex.warnings.some((w) => /holds 600 ms/.test(w)));
  assert.ok(ex.warnings.some((w) => /click at 1200 ms lands during the move/.test(w)));
  const wide = { ...geo.wide };
  const start = ex.windowAt(1000, () => wide), mid = ex.windowAt(1300, () => wide), end = ex.windowAt(1600, () => wide);
  assert.ok(Math.abs(start.w - 1440) < 1e-9, "move starts from wide");
  assert.ok(mid.w < 1440 && mid.w > end.w, "mid-move is between");
  assert.equal(end.w, 720, "focus on a 348 px box hits the floor of 720");
  assert.ok(ex.windowAt(1600, () => wide).y < ex.windowAt(2100, () => wide).y, "follows the tracked row down");
});

test("track: calm spring settles in under a second, explicit overrides auto, ends at rest", () => {
  const auto = buildTrack({ actions: [click(1000, 600, 400), click(1800, 650, 420)], stage, aspect: 1.6, outWidthPx: 1440, mode: "gentle", feel: "calm", durationMs: 7000, fps: 30 });
  assert.ok(atRest(auto.frames[0], auto.geo) && atRest(auto.frames[auto.frames.length - 1], auto.geo));
  const target = auto.frames.reduce((m, f) => Math.max(m, f.scale), 1);
  const at1s = windowAt(auto.frames, 700 + 1000).scale;
  assert.ok(at1s > target * 0.93, `calm reaches ${(100 * at1s / target).toFixed(0)}% of the shot within 1 s`);
  const brisk = buildTrack({ actions: [click(1000, 600, 400), click(1800, 650, 420)], stage, aspect: 1.6, outWidthPx: 1440, mode: "gentle", feel: "brisk", durationMs: 7000, fps: 30 });
  assert.ok(windowAt(brisk.frames, 1200).scale > windowAt(auto.frames, 1200).scale, "brisk is faster than calm");
  const ex = buildTrack({ actions: [click(1000, 600, 400), click(1800, 650, 420)], explicitShots: [{ t: 500, kind: "wide", ms: 0 }], stage, aspect: 1.6, outWidthPx: 1440, mode: "gentle", feel: "calm", durationMs: 7000, fps: 30 });
  assert.ok(ex.frames.every((f) => atRest(f, ex.geo)), "an explicit wide from 0.5 s suppresses the auto shot");
  assert.ok(ex.warnings.some((w) => /suppressed by the explicit track/.test(w)));
});

test("sendcmd lines are even device pixels inside the canvas", () => {
  const text = sendcmdText([{ t: 0, x: 0, y: 0, w: 1440, h: 900 }, { t: 33.33, x: 500.3, y: 300.7, w: 900, h: 562.5 }], { deviceScaleFactor: 2, canvasW: 1440, canvasH: 900 });
  assert.equal(text.split("\n")[0], "0.0000 crop w 2880, crop h 1800, crop x 0, crop y 0;");
  assert.equal(text.split("\n")[1], "0.0333 crop w 1800, crop h 1126, crop x 1000, crop y 602;");
});
