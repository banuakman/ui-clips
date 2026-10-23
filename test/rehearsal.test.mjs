import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRehearsal } from "../engine/rehearsal.mjs";

const config = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, sizes: { full: true }, quality: { maxWidth: 1440 }, crops: {} };
const clip = { id: "t", crops: {} };
const box = (x, y, w, h) => ({ x, y, w, h });

test("beats: a shot issued after the next mark is not pulled back to a beat that only hovered (no hold event)", () => {
  const take = {
    shots: [{ t: 0, seq: 1, kind: "wide", mode: "contain" }, { t: 600, seq: 4, kind: "focus", anchor: { box: box(600, 400, 200, 100) }, extras: [], padding: 24, boxesNow: {} }],
    marks: [{ name: "b1", t: 10, seq: 2 }, { name: "b2", t: 500, seq: 3 }],
    holds: [],
    actions: [],
  };
  const r = buildRehearsal({ config, clip, take });
  assert.equal(r.beats[0].windows.full.shot, 1, "b1 keeps the wide: the focus was issued after b2");
  assert.equal(r.beats[1].windows.full.shot, 2);
});

test("beats: a focus following its tracked anchor keeps the box of a locator extra measured at the shot", () => {
  const drawer0 = box(600, 100, 400, 200), drawer1 = box(500, 100, 400, 200), count = box(100, 100, 200, 50);
  const take = {
    shots: [{ t: 0, seq: 1, kind: "focus", anchor: { track: "drawer" }, extras: [{ box: count }], padding: 24, boxesNow: { drawer: drawer0 } }],
    marks: [{ name: "b1", t: 0, seq: 2, boxesNow: { drawer: drawer0 } }, { name: "b2", t: 1000, seq: 4, boxesNow: { drawer: drawer1 } }],
    holds: [{ t: 5, ms: 500, seq: 3 }],
    actions: [],
  };
  const r = buildRehearsal({ config, clip, take });
  const w = r.beats[1].windows.full.window;
  assert.ok(w.x <= count.x, `the window at b2 still reaches the count at x ${count.x} (got x ${Math.round(w.x)})`);
  assert.ok(w.x + w.w >= drawer1.x + drawer1.w, "and contains the moved anchor");
});
