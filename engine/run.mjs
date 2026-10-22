// Step runner shared by dry-run and record: open a page, run the clip's steps with `h`, finish the take.
import path from "node:path";
import { openContext, gotoStart } from "./browser.mjs";
import { createHelpers, ExpectError, StepError } from "./helpers.mjs";
import { DryTake, RecordTake } from "./capture.mjs";

export function takeDirFor(config, clip, takeId = "latest") {
  return path.join(config.cacheDir, clip.id, takeId);
}

/**
 * @returns {{ok:boolean, clipId:string, mode:string, durationMs:number, take?:object, error?:{step:string,message:string}}}
 */
export async function runClip({ browser, baseUrl, config, clip, mode = "dry", takeId = "latest", log = () => {} }) {
  const record = mode === "record";
  const context = await openContext(browser, config, { cursor: record });
  const page = await context.newPage();
  const result = { ok: false, clipId: clip.id, mode, durationMs: 0, warnings: [] };
  let take;
  try {
    log(`${clip.id}: opening ${clip.start}`);
    const nav = await gotoStart(page, config, baseUrl, clip.start);
    result.url = nav.url; result.status = nav.status;
    take = record
      ? new RecordTake({ clip, config, page, takeDir: takeDirFor(config, clip, takeId) })
      : new DryTake({ clip, config });
    const h = createHelpers({ page, config, take, fast: !record });
    await h._cursor.park();
    await h._cursor.hide();
    if (record) await page.waitForTimeout(250);
    if (clip.poster === "start") await take.takePoster("start");
    await take.start();
    log(`${clip.id}: ${record ? "recording" : "rehearsing"} steps`);
    await clip.steps({ page, h });
    // Target length: pad the final hold, or warn when the steps already overshoot.
    if (typeof clip.length === "number") {
      const elapsed = take.t();
      if (elapsed < clip.length) await h.hold(clip.length - elapsed);
      else if (elapsed > clip.length + 200) take.warn(`steps ran ${elapsed} ms, longer than the ${clip.length} ms target`);
    }
    const posterAtEnd = !take.poster.taken && clip.poster !== "start";
    if (posterAtEnd && clip.poster !== "end") take.warn(`poster "${clip.poster}" was never reached; using the end frame`);
    const finished = await take.finish({ posterAtEnd });
    result.ok = true;
    result.durationMs = finished.durationMs ?? take.t();
    result.warnings = take.warnings;
    result.actions = take.actions.length;
    if (record) {
      result.take = finished; result.takeDir = take.takeDir; result.frames = finished.frames.length; result.frameSize = finished.frameSize;
      const want = { width: Math.round(config.viewport.width * config.deviceScaleFactor), height: Math.round(config.viewport.height * config.deviceScaleFactor) };
      if (finished.frameSize && (finished.frameSize.width !== want.width || finished.frameSize.height !== want.height)) {
        take.warn(`frames are ${finished.frameSize.width}×${finished.frameSize.height}, expected ${want.width}×${want.height}; capture is not at the configured scale`);
        result.warnings = take.warnings;
      }
    }
  } catch (e) {
    if (e instanceof ExpectError || e instanceof StepError) {
      result.error = { kind: e.name, step: e.step, message: e.cause?.message || e.message };
    } else {
      result.error = { kind: e.name || "Error", step: null, message: e.message };
    }
    if (record && take?.page) { try { await page.screencast.stop(); } catch {} }
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}
