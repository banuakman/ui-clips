import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseViewport, parseSize, captureScale, renderConfig, scaffoldProject } from "../engine/scaffold.mjs";
import { loadConfig } from "../engine/config.mjs";

test("viewports: presets and WxH", () => {
  assert.deepEqual(parseViewport("desktop"), { width: 1440, height: 900 });
  assert.deepEqual(parseViewport("1680×1920"), { width: 1680, height: 1920 });
  assert.throws(() => parseViewport("big"));
});

test("capture scale drops to 1.5× above ~10 MP frames", () => {
  assert.equal(captureScale({ width: 1440, height: 900 }), 2);
  assert.equal(captureScale({ width: 1920, height: 1080 }), 2);
  assert.equal(captureScale({ width: 2560, height: 1800 }), 1.5);
});

test("sizes: presets, WxH@scale and aspects", () => {
  assert.equal(parseSize("card")[0], "card");
  assert.match(parseSize("story=1080x1920@2")[1], /width: 1080, height: 1920, scale: 2/);
  assert.match(parseSize("wide=16:9")[1], /aspect: "16:9"/);
  assert.throws(() => parseSize("nope"));
});

test("a scaffolded project loads with the answers applied", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ui-clips-scaffold-"));
  try {
    const r = scaffoldProject(dir, { url: "https://example.test", viewport: { width: 1920, height: 1080 }, sizes: ["card"], theme: "dark", cursor: "dot", outputs: ["mp4", "gif"], zoom: "off", stageExclude: ["aside"] });
    assert.ok(existsSync(r.configFile) && existsSync(r.clipsDir));
    const c = await loadConfig(dir);
    assert.equal(c.baseUrl, "https://example.test");
    assert.deepEqual(c.viewport, { width: 1920, height: 1080 });
    assert.equal(c.colorScheme, "dark");
    assert.equal(c.cursor.style, "dot");
    assert.deepEqual(c.outputs, ["mp4", "gif", "poster"]);        // a poster always comes out
    assert.equal(c.zoom.mode, "off");
    assert.ok(c.sizes.full === true && c.sizes.card.width === 480); // full is always present
    assert.deepEqual(c.stage.exclude, ["aside"]);
    assert.throws(() => scaffoldProject(dir, { url: "https://example.test" }), /exists/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("renderConfig refuses nothing it is given but annotates every key", () => {
  const src = renderConfig({ serve: "./site" });
  assert.match(src, /serve: "\.\/site"/);
  assert.match(src, /viewport: \{ width: 1440, height: 900 \}/);
  assert.ok(src.split("\n").filter((l) => /^\s{2}\w+:/.test(l)).every((l) => l.includes("//") || /^\s{2}(fps|sizes|viewport|waitForFonts|password|serve|baseUrl)/.test(l)));
});
