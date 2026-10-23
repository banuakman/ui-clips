// Step runner shared by dry-run and record: open a page, run the clip's steps with `h`, finish the take.
import path from "node:path";
import { openContext, gotoStart } from "./browser.mjs";
import { createHelpers, ExpectError, StepError } from "./helpers.mjs";
import { DryTake, RecordTake, StopAtMark } from "./capture.mjs";
import { rmSync, writeFileSync } from "node:fs";
import { buildRehearsal } from "./rehearsal.mjs";

export function takeDirFor(config, clip, takeId = "latest") {
  return path.join(config.cacheDir, clip.id, takeId);
}

/**
 * @returns {{ok:boolean, clipId:string, mode:string, durationMs:number, take?:object, error?:{step:string,message:string}}}
 */
export async function runClip({ browser, baseUrl, config, clip, mode = "dry", takeId = "latest", stopAt = null, log = () => {} }) {
  const record = mode === "record";
  if (clip.isSubclip) return { ok: true, clipId: clip.id, mode, durationMs: 0, warnings: [], skipped: `sub-clip of ${clip.take}; nothing to ${record ? "record" : "rehearse"}` };
  const context = await openContext(browser, config, { cursor: record });
  const page = await context.newPage();
  const result = { ok: false, clipId: clip.id, mode, durationMs: 0, warnings: [] };
  let take;
  try {
    // A clip-level freezeTime applies before navigation so relative dates render against the fixed clock.
    if (clip.freezeTime) await page.clock.setFixedTime(new Date(clip.freezeTime));
    log(`${clip.id}: opening ${clip.start}`);
    const nav = await gotoStart(page, config, baseUrl, clip.start);
    result.url = nav.url; result.status = nav.status;
    const rehearsalDir = path.join(config.cacheDir, clip.id, "rehearsal");
    if (!record) rmSync(rehearsalDir, { recursive: true, force: true });
    take = record
      ? new RecordTake({ clip, config, page, takeDir: takeDirFor(config, clip, takeId) })
      : new DryTake({ clip, config, page, rehearsalDir, stopAt });
    const runConfig = { ...config, crops: { ...(config.crops || {}), ...(config.sizes || {}), ...(clip.crops || {}) } };
    const h = createHelpers({ page, config: runConfig, take, fast: !record });
    // Stage exclusions (§10.3): measure selectors once the page is ready; rects pass through.
    if (config.stage?.exclude?.length) {
      const boxes = [];
      for (const ex of config.stage.exclude) {
        if (typeof ex === "string") {
          const b = await page.locator(ex).first().boundingBox({ timeout: 2000 }).catch(() => null);
          if (b) {
            boxes.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), selector: ex, track: `__stage:${ex}` });
            h.track(`__stage:${ex}`, page.locator(ex));      // the region follows the element if it moves
          } else take.warn(`stage.exclude "${ex}" matched nothing`);
        } else if (ex && ex.w > 0 && ex.h > 0) boxes.push({ ...ex });
      }
      take.stage = { exclude: boxes, fill: config.stage.fill || "#FFFFFF" };
    }
    await h._cursor.park();
    await h._cursor.hide();
    if (record) await page.waitForTimeout(250);
    if (clip.poster === "start") await take.takePoster("start");
    await take.start();
    log(`${clip.id}: ${record ? "recording" : "rehearsing"} steps`);
    await clip.steps({ page, h });
    await h._measureCropFocus("end");
    // Target length: pad the final hold, or warn when the steps already overshoot.
    if (typeof clip.length === "number") {
      const { buildTakeTimeMap } = await import("./timemap.mjs");
      const elapsed = take.t();
      const outElapsed = Math.round(buildTakeTimeMap(take).toOutput(elapsed));   // trims and speed ramps shorten the export
      const fade = clip.loop === "crossfade" ? 400 : 0;                                             // the crossfade trims the head
      const target = clip.length + fade;
      if (outElapsed < target) await h.hold(target - outElapsed);
      else if (outElapsed > target + 200) take.warn(`steps ran ${outElapsed} ms (after trims and speed ramps), longer than the ${target} ms needed for a ${clip.length} ms clip`);
    }
    const posterAtEnd = !take.poster.taken && clip.poster !== "start";
    if (posterAtEnd && clip.poster !== "end") take.warn(`poster "${clip.poster}" was never reached; using the end frame`);
    const finished = await take.finish({ posterAtEnd });
    result.ok = true;
    result.durationMs = finished.durationMs ?? take.t();
    result.warnings = take.warnings;
    result.actions = take.actions.length;
    if (!record) {
      const rehearsal = buildRehearsal({ config, clip, take: { shots: take.shots, actions: take.actions, marks: take.marks, holds: take.holds || [], stage: take.stage, beatShots: take.beatShots } });
      writeFileSync(path.join(rehearsalDir, "rehearsal.json"), JSON.stringify(rehearsal, null, 2));
      result.rehearsal = rehearsal;
      if (!rehearsal.ok) result.ok = false;
    }
    if (record) {
      result.take = finished; result.takeDir = take.takeDir; result.frames = finished.frames.length; result.frameSize = finished.frameSize;
      const want = { width: Math.round(config.viewport.width * config.deviceScaleFactor), height: Math.round(config.viewport.height * config.deviceScaleFactor) };
      if (finished.frameSize && (finished.frameSize.width !== want.width || finished.frameSize.height !== want.height)) {
        throw new Error(`frames are ${finished.frameSize.width}×${finished.frameSize.height}, expected ${want.width}×${want.height}; capture is not at the configured scale`);
      }
    }
  } catch (e) {
    if (e instanceof StopAtMark) {
      // inspect --at <mark>: the page in the state the steps reach at that mark
      const { inspectPage } = await import("./inspect.mjs");
      result.ok = true; result.stoppedAt = e.mark; result.inspect = await inspectPage(page);
    } else if (e instanceof ExpectError || e instanceof StepError) {
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
