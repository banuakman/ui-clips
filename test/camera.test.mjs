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

import { wideWindow, settledWindowAt } from "../engine/camera.mjs";

test("wide: contain is the stage at output width; cover fills the frame at full stage height with an anchor", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const card = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  assert.deepEqual(wideWindow(card, st, { mode: "contain" }), { x: 0, y: 0, w: 1190, h: 1487.5 });
  assert.deepEqual(wideWindow(card, st, { mode: "cover", anchor: "right" }), { x: 390, y: 0, w: 800, h: 1000 });
  assert.deepEqual(wideWindow(card, st, { mode: "cover", anchor: "left" }), { x: 0, y: 0, w: 800, h: 1000 });
  assert.deepEqual(wideWindow(card, st, { mode: "cover" }), { x: 195, y: 0, w: 800, h: 1000 });
  assert.deepEqual(wideWindow(card, st, { mode: "cover", anchorBox: { x: 1000, y: 0, w: 100, h: 50 } }), { x: 390, y: 0, w: 800, h: 1000 }, "a target anchor is clamped inside the stage");
  const wide169 = frameGeometry(st, { aspect: 16 / 9, outWidthPx: 1440, deviceScaleFactor: 2 });
  assert.deepEqual(wideWindow(wide169, st, { mode: "cover" }), { x: 0, y: 0, w: 1190, h: 669.375 }, "a frame wider than the stage keeps full width, top-aligned");
});

test("explicit: only the opening may be contain; a later wide is cover; opening returns to the first framing; rest is the opening", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const shots = [
    { t: 0, kind: "wide", ms: 0 },
    { t: 1000, kind: "wide", anchor: "right", ms: 600 },
    { t: 3000, kind: "wide", mode: "contain", ms: 600 },
    { t: 5000, kind: "opening", ms: 600 },
  ];
  const track = buildTrack({ explicitShots: shots, stage: st, aspect: 0.8, outWidthPx: 960, mode: "gentle", feel: "calm", durationMs: 7000, fps: 30 });
  const kinds = track.shots.filter((s) => s.source === "explicit").map((s) => `${s.kind}:${s.mode || ""}`);
  assert.deepEqual(kinds, ["wide:contain", "wide:cover", "opening:", "opening:"]);
  assert.ok(track.warnings.some((w) => /contain"\) after the opening/.test(w)));
  assert.deepEqual(track.opening, { x: 0, y: 0, w: 1190, h: 1487.5 });
  assert.ok(atRest(track.frames[0], track.opening));
  const covered = windowAt(track.frames, 1700);
  assert.ok(Math.abs(covered.w - 800) < 1e-6 && Math.abs(covered.x - 390) < 1e-6, "cover anchored right at 1.6 s");
  assert.ok(atRest(track.frames[track.frames.length - 1], track.opening), "ends at the opening framing");
  assert.ok(!atRest(covered, track.opening));
});

test("settledWindowAt returns the window where an active move lands", () => {
  const frames = [{ t: 0, x: 0, y: 0, w: 1190, h: 1487.5 }, { t: 300, x: 195, y: 0, w: 995, h: 1243 }, { t: 600, x: 390, y: 0, w: 800, h: 1000 }, { t: 900, x: 390, y: 0, w: 800, h: 1000 }];
  const shots = [{ startMs: 0, moveMs: 600 }];
  assert.deepEqual(settledWindowAt(frames, shots, 150), frames[2]);
  assert.deepEqual(settledWindowAt(frames, shots, 900), frames[3]);
});

import { trackBoxAt } from "../engine/camera.mjs";

test("tracked boxes interpolate between samples so a follow is a ramp", () => {
  const samples = [[1000, 100, 600, 400, 300], [1200, 100, 500, 400, 300], [1400, 100, 440, 400, 300]];
  assert.deepEqual(trackBoxAt(samples, 900), { x: 100, y: 600, w: 400, h: 300 });
  assert.deepEqual(trackBoxAt(samples, 1100), { x: 100, y: 550, w: 400, h: 300 });
  assert.deepEqual(trackBoxAt(samples, 1300), { x: 100, y: 470, w: 400, h: 300 });
  assert.deepEqual(trackBoxAt(samples, 2000), { x: 100, y: 440, w: 400, h: 300 });
});

test("a focus frame that fits the stage never reaches into the fill below", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const card = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  const f = frameAround({ x: 779, y: 450, w: 637, h: 610 }, card, st);
  assert.ok(f.y + f.h <= 1000 + 1e-9, `bottom ${f.y + f.h} stays inside the stage`);
  assert.ok(f.h <= 1000);
});

import { clipToStage } from "../engine/camera.mjs";

test("focus targets are clipped to the stage and skipped while off-screen", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  assert.equal(clipToStage({ x: 700, y: 1469, w: 400, h: 60 }, st), null, "below the fold: not a target yet");
  assert.deepEqual(clipToStage({ x: 700, y: 980, w: 400, h: 60 }, st), { x: 700, y: 980, w: 400, h: 20 });
  const g = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  const ex = buildExplicit([{ t: 0, kind: "focus", targets: [{ box: { x: 500, y: 450, w: 150, h: 100 } }, { track: "below" }], padding: 24, ms: 0 }],
    { tracks: { below: [[0, 700, 1469, 400, 60], [1000, 700, 900, 400, 60]] }, stage: st, geo: g, actions: [] });
  const early = ex.windowAt(0, () => g.wide), late = ex.windowAt(1000, () => g.wide);
  assert.ok(early.y + early.h <= 1000 + 1e-9, "no spill while the tracked target is off-screen");
  assert.ok(late.y + late.h >= 960 - 1e-9 && late.y + late.h <= 1000 + 1e-9, "the frame grows to include the target once it is on screen");
});

test("a first shot logged within the first frame is the opening framing from t = 0, with no move", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const track = buildTrack({ explicitShots: [{ t: 4, kind: "wide", mode: "cover", anchor: "left", ms: 600 }], stage: st, aspect: 0.8, outWidthPx: 960, mode: "gentle", feel: "calm", durationMs: 2000, fps: 30 });
  assert.deepEqual(track.opening, { x: 0, y: 0, w: 800, h: 1000 });
  assert.ok(atRest(track.frames[0], track.opening), "frame 0 is already the cover framing");
});

import { edgeBox, plannedWindow } from "../engine/camera.mjs";

test("focus: the window follows the anchor, extras widen only, and a departing target never re-solves", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const g = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  // anchor scrolls up 200 px between 0 and 2 s; the extra is visible until 1 s then leaves
  const tracks = {
    head: [[0, 740, 400, 400, 36], [2000, 740, 200, 400, 36]],
    card: [[0, 740, 460, 400, 200], [1000, 740, 460, 400, 200], [1001, 740, -300, 400, 200]],
  };
  const ex = buildExplicit([{ t: 0, kind: "focus", anchor: { track: "head" }, extras: [{ track: "card" }], padding: 24, ms: 0 }], { tracks, stage: st, geo: g, actions: [] });
  const w0 = ex.windowAt(0, () => g.wide), w500 = ex.windowAt(500, () => g.wide), w1500 = ex.windowAt(1500, () => g.wide), w2000 = ex.windowAt(2000, () => g.wide);
  assert.ok(w0.y + w0.h >= 660 - 1e-6, "the visible extra is inside the opening frame");
  assert.ok(Math.abs((w500.y - w0.y) - (-50)) < 1e-6, "follows the anchor: 50 px up after 0.5 s");
  assert.ok(Math.abs(w1500.w - w0.w) < 1e-6, "the frame does not shrink when the extra leaves");
  assert.ok(Math.abs((w2000.y - w0.y) - (-200)) < 1e-6, "still following the anchor at 2 s");
  // anchor leaves the stage: hold
  const gone = { head: [[0, 740, 500, 400, 36], [1000, 740, -100, 400, 36]] };
  const ex2 = buildExplicit([{ t: 0, kind: "focus", anchor: { track: "head" }, padding: 24, ms: 0 }], { tracks: gone, stage: st, geo: g, actions: [] });
  const a = ex2.windowAt(900, () => g.wide), b = ex2.windowAt(1500, () => g.wide);
  assert.deepEqual(b, a, "window held while the anchor is off-screen");
});

test("an anchor below the fold starts the window at the bottom edge and the window follows it in", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const g = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  assert.deepEqual(edgeBox({ x: 700, y: 1227, w: 400, h: 28 }, st), { x: 700, y: 998, w: 400, h: 2 });
  const tracks = { heading: [[0, 740, 1227, 400, 28], [1000, 740, 200, 400, 28]] };
  const ex = buildExplicit([{ t: 0, kind: "focus", anchor: { track: "heading" }, padding: 24, ms: 0 }], { tracks, stage: st, geo: g, actions: [] });
  const w0 = ex.windowAt(0, () => g.wide), w1 = ex.windowAt(1000, () => g.wide);
  assert.ok(w0.y + w0.h <= 1000 + 1e-6 && w0.y + w0.h >= 999, "hugs the bottom edge");
  assert.equal(w1.y, 200 - 24, "followed the heading up: a short anchor sits at the top of the frame");
});

test("plannedWindow reports absent and off-screen targets and frames that cannot fit", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const g = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  const a = plannedWindow({ kind: "focus", anchor: { track: "x" }, extras: [{ track: "y" }], padding: 24 }, { x: { x: 100, y: 1200, w: 50, h: 20 }, y: null }, { geo: g, stage: st, opening: null });
  assert.ok(a.problems.some((p) => /anchor x is off-screen/.test(p)) && a.problems.some((p) => /extra y is absent/.test(p)));
  assert.ok(a.window, "still plans a window at the edge");
  const b = plannedWindow({ kind: "focus", anchor: { box: { x: 0, y: 0, w: 1190, h: 1000 } }, padding: 24 }, {}, { geo: g, stage: st, opening: null });
  assert.ok(b.problems.some((p) => /cannot|allows/.test(p)));
});

import { focusFrame } from "../engine/camera.mjs";

test("focusFrame: a short anchor sits at the top of the frame, a tall one is centred; extras widen only", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const g = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  const heading = focusFrame({ x: 739, y: 582, w: 427, h: 28 }, [], { padding: 24 }, g, st);
  assert.equal(heading.y, 400, "heading placed at the top, then the frame is clamped to the stage bottom");
  assert.ok(heading.y + heading.h > 946 && heading.y < 582, "the heading and Apply Resolution, 364 px below it, are both inside the 600 px frame");
  const card = focusFrame({ x: 739, y: 321, w: 427, h: 235 }, [], { padding: 24 }, g, st);
  assert.ok(Math.abs((card.y + card.h / 2) - (321 + 235 / 2)) < 1e-6, "a tall anchor is centred");
  const grown = focusFrame({ x: 739, y: 582, w: 427, h: 28 }, [], { padding: 24, minSize: { w: 700, h: 875 } }, g, st);
  assert.equal(grown.w, 700, "never shrinks below the size reached so far");
});

test("align top/bottom on a tall anchor: the window is as wide as the anchor and shows its top or bottom slice", () => {
  const st = { x: 0, y: 0, w: 1190, h: 1000, masks: [], cuts: [] };
  const g = frameGeometry(st, { aspect: 0.8, outWidthPx: 960, deviceScaleFactor: 2 });
  const drawer = { x: 714, y: 0, w: 476, h: 1000 };
  // the drawer touches the stage's right edge, so the padding is clipped there: 24 + 476 = 500 wide
  const top = focusFrame(drawer, [], { padding: 24, align: "top" }, g, st);
  assert.equal(top.w, 500); assert.equal(top.h, 625); assert.equal(top.y, 0); assert.equal(top.x, 1190 - 500);
  const bottom = focusFrame(drawer, [], { padding: 24, align: "bottom" }, g, st);
  assert.equal(bottom.w, 500); assert.equal(bottom.y + bottom.h, 1000);
  const auto = focusFrame(drawer, [], { padding: 24 }, g, st);
  assert.ok(auto.w >= 800, "without an explicit alignment the frame contains the whole anchor");
});
