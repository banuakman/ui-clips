// Export (§10, appendix B): retimed frames → lossless 2× intermediate → camera → loop → presets, crops,
// posters (PNG + WebP), GIF, manifest and embed snippet.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, rmSync, readdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { retime, sampleCfr, concatText, frameAt } from "./retime.mjs";
import { detectShots, simulateCamera, atRest, sendcmdText, windowAt } from "./camera.mjs";
import { decideReturn, crossfadeFilter, LOOP } from "./loop.mjs";

export const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobeBin = () => process.env.FFPROBE_PATH || "ffprobe";

export function run(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${bin} ${args.slice(0, 8).join(" ")}… exited ${code}\n${err.slice(-2000)}`))));
  });
}
const ff = (args, opts) => run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...args], opts);

export async function probe(file) {
  const { out } = await run(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
    "stream=width,height,codec_name,pix_fmt,nb_read_frames,r_frame_rate:format=duration,size", "-of", "json", file]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] || {};
  return { width: s.width, height: s.height, codec: s.codec_name, pixFmt: s.pix_fmt, frames: Number(s.nb_read_frames) || null,
    fps: s.r_frame_rate, durationMs: Math.round(Number(j.format?.duration) * 1000), bytes: Number(j.format?.size) };
}

let webpTool;  // "ffmpeg" | "cwebp" | null
export function webpEncoder() {
  if (webpTool !== undefined) return webpTool;
  try { if (/libwebp/.test(execFileSync(ffmpegBin(), ["-hide_banner", "-encoders"], { encoding: "utf8" }))) return (webpTool = "ffmpeg"); } catch {}
  try { execFileSync(process.env.CWEBP_PATH || "cwebp", ["-version"], { stdio: "ignore" }); return (webpTool = "cwebp"); } catch {}
  return (webpTool = null);
}
async function toWebp(png, webp, quality = 90) {
  const tool = webpEncoder();
  if (tool === "ffmpeg") await ff(["-i", png, "-quality", String(quality), webp]);
  else if (tool === "cwebp") await run(process.env.CWEBP_PATH || "cwebp", ["-quiet", "-q", String(quality), png, "-o", webp]);
  else return false;
  return true;
}

const lanczos = (w, h = -2) => `scale=${w}:${h}:flags=lanczos`;
const x264 = (crf, fps) => ["-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(crf), "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", String(fps * 2), "-movflags", "+faststart"];
const vp9 = (crf) => ["-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1", "-pix_fmt", "yuv420p"];

/** Window of w×h CSS px centred on a box, clamped to the viewport. */
export function windowFor(box, w, h, vw, vh) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), Math.max(0, vw - w)));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), Math.max(0, vh - h)));
  return { x, y, w, h };
}

/** Resolve a crop spec (§10.2) to a window in CSS px: explicit rect | { width, height, focus } | { aspect, focus }. */
export function cropWindow(crop, focusBox, vw, vh) {
  if (crop.x != null && crop.y != null && crop.width && crop.height) return { x: crop.x, y: crop.y, w: crop.width, h: crop.height };
  let w = crop.width, h = crop.height;
  if (crop.aspect) {
    const [a, b] = String(crop.aspect).split(":").map(Number);
    const r = a / b;
    if (!w && !h) { w = Math.min(vw, Math.round(vh * r)); h = Math.round(w / r); }
    else if (w && !h) h = Math.round(w / r);
    else if (h && !w) w = Math.round(h * r);
  }
  if (!w || !h) return null;
  w = Math.min(w, vw); h = Math.min(h, vh);
  const box = focusBox || { x: 0, y: 0, w: vw, h: vh };
  return windowFor(box, w, h, vw, vh);
}

/** A crop's focus: a mark name whose mark carries a box, else the last visible measurement of a selector. */
function resolveFocus(take, cropName, focus) {
  if (!focus) return null;
  const mark = (take.marks || []).filter((m) => m.name === focus && m.box).pop();
  if (mark) return { box: mark.box, at: `mark ${mark.name}`, t: mark.t };
  const last = (take.focusBoxes || []).filter((f) => f.crop === cropName && f.box).pop();
  return last ? { box: last.box, at: `selector at ${last.at}`, t: last.t } : null;
}

/** Map a source-space box through the camera window shown at time t (identity at rest). */
function throughCamera(box, camFrames, t, vw, vh) {
  if (!camFrames) return box;
  const c = windowAt(camFrames, t);
  if (!c || atRest(c)) return box;
  const s = c.scale;
  return { x: (box.x - c.x) * s, y: (box.y - c.y) * s, w: box.w * s, h: box.h * s };
}

const cropArgs = (win, dsf) => `crop=${Math.round(win.w * dsf / 2) * 2}:${Math.round(win.h * dsf / 2) * 2}:${Math.round(win.x * dsf / 2) * 2}:${Math.round(win.y * dsf / 2) * 2}`;

/**
 * @param {{config, clip, takeDir, outDir, log?, zoom?: string}} opts  zoom overrides the clip/project mode (re-export, no re-record)
 */
export async function exportClip({ config, clip, takeDir, outDir, log = () => {}, zoom }) {
  const takeFile = path.join(takeDir, "take.json");
  if (!existsSync(takeFile)) throw new Error(`No recording for ${clip.id}. Run: ui-clips record ${clip.id}`);
  const take = JSON.parse(readFileSync(takeFile, "utf8"));
  mkdirSync(outDir, { recursive: true });
  const W = config.quality.maxWidth;
  const fps = take.fps || config.fps;
  const dsf = take.deviceScaleFactor || config.deviceScaleFactor;
  const vw = take.viewport.width, vh = take.viewport.height;
  const outputs = new Set(config.outputs);
  const result = { clipId: clip.id, files: {}, poster: {}, crops: {}, checks: [], warnings: [...(take.warnings || [])] };
  const check = (name, ok, detail) => result.checks.push({ name, ok, detail });

  // 1. Retime to constant fps → lossless 2× intermediate.
  const { entries, durationMs: rawMs, dropped } = retime({ frames: take.frames, t0: take.t0, tEnd: take.tEnd, trims: take.trims });
  if (!entries.length) throw new Error("The take has no frames.");
  const cfr = sampleCfr(entries, rawMs, fps);
  writeFileSync(path.join(takeDir, "frames.txt"), concatText(cfr, fps));
  const intermediate = path.join(takeDir, "intermediate.mkv");
  log(`${clip.id}: ${take.frames.length} source frames → ${(rawMs / 1000).toFixed(2)} s at ${fps} fps`);
  await ff(["-f", "concat", "-safe", "0", "-i", "frames.txt", "-fps_mode", "cfr", "-r", String(fps), "-frames:v", String(cfr.length),
    "-pix_fmt", "yuv444p", "-c:v", "ffv1", "-level", "3", intermediate], { cwd: takeDir });
  result.sourceFrames = take.frames.length; result.droppedFrames = dropped;
  let source = intermediate;
  let durationMs = Math.round((cfr.length * 1000) / fps);

  // 2. Camera (§10.3): shots from the action log, spring, per-frame crop windows rendered at 2×.
  const mode = zoom || clip.zoom || config.zoom?.mode || "off";
  let camFrames = null;
  const cam = detectShots(take.actions || [], { mode, viewport: take.viewport, durationMs, explicit: take.camera || [], exportWidth: W, deviceScaleFactor: dsf });
  result.warnings.push(...cam.warnings);
  const frames = simulateCamera(cam.shots, { viewport: take.viewport, durationMs, fps });
  if (mode !== "off" && cam.shots.length && frames.some((f) => !atRest(f))) {
    camFrames = frames;
    writeFileSync(path.join(takeDir, "camera.cmd"), sendcmdText(frames, { deviceScaleFactor: dsf, viewport: take.viewport, fps }));
    const camFile = path.join(takeDir, `camera-${mode}.mkv`);
    log(`${clip.id}: rendering ${mode} camera (${cam.shots.length} shot${cam.shots.length === 1 ? "" : "s"})`);
    await ff(["-i", intermediate, "-vf", `sendcmd=f=camera.cmd,crop=${vw * dsf}:${vh * dsf}:0:0,${lanczos(vw * dsf, vh * dsf)}`, "-c:v", "ffv1", "-level", "3", camFile], { cwd: takeDir });
    source = camFile;
    check("camera rest", atRest(frames[0]) && atRest(frames[frames.length - 1]), `at ${frames[0].scale.toFixed(2)}× at start, ${frames[frames.length - 1].scale.toFixed(2)}× at end`);
  }
  result.camera = { mode, shots: cam.shots.map((s) => ({ startMs: s.startMs, endMs: s.endMs, source: s.source, scale: Math.max(...s.targets.map((t) => t.scale)) })),
    frames: camFrames ? frames.map((f) => [Math.round(f.t), +f.x.toFixed(1), +f.y.toFixed(1), +f.w.toFixed(1), +f.h.toFixed(1), +f.scale.toFixed(4)]) : null };

  // 3. Loop (§10.4).
  const loopMode = clip.loop || "none";
  if (loopMode === "return") {
    const tailDir = path.join(takeDir, "loopcheck");
    rmSync(tailDir, { recursive: true, force: true }); mkdirSync(tailDir);
    const lastAction = Math.max(0, ...(take.actions || []).map((a) => a.t));
    const tailStart = Math.min(cfr.length - 1, Math.max(0, Math.round(((lastAction + 300) * fps) / 1000)));
    await ff(["-i", source, "-vf", `select='eq(n\\,0)+gte(n\\,${tailStart})',${lanczos(W)}`, "-fps_mode", "passthrough", path.join(tailDir, "f%04d.png")]);
    const pngs = readdirSync(tailDir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(tailDir, f));
    const verdict = decideReturn(pngs[0], pngs.slice(1));
    if (verdict.ok && verdict.endFrame != null) {
      const keep = tailStart + verdict.endFrame + 1;
      const trimmed = path.join(takeDir, "loop.mkv");
      await ff(["-i", source, "-frames:v", String(keep), "-c:v", "ffv1", "-level", "3", trimmed]);
      source = trimmed; durationMs = Math.round((keep * 1000) / fps);
      result.warnings.push(`loop: the last frame differed from the first (${(verdict.lastRatio * 100).toFixed(2)}% of pixels); trimmed ${cfr.length - keep} frame(s) to the matching frame`);
    }
    check("loop return", verdict.ok, verdict.ok ? `first and last frames match (${(verdict.lastRatio * 100).toFixed(3)}% differing pixels)` : `last frame differs from the first by ${(verdict.lastRatio * 100).toFixed(2)}% of pixels and no tail frame matches; try loop: "crossfade"`);
    result.loop = { mode: "return", lastRatio: verdict.lastRatio, trimmedFrames: verdict.endFrame != null ? cfr.length - (tailStart + verdict.endFrame + 1) : 0 };
  } else if (loopMode === "crossfade") {
    const faded = path.join(takeDir, "loop.mkv");
    const D = durationMs / 1000;
    if (D <= LOOP.crossfadeMs / 1000 * 2) throw new Error("clip too short to crossfade");
    await ff(["-i", source, "-i", source, "-filter_complex", crossfadeFilter(D), "-map", "[v]", "-c:v", "ffv1", "-level", "3", faded]);
    source = faded; durationMs -= LOOP.crossfadeMs;
    check("loop crossfade", true, `tail blended into the head over ${LOOP.crossfadeMs} ms; clip now ${durationMs} ms`);
    result.loop = { mode: "crossfade", fadeMs: LOOP.crossfadeMs };
  } else result.loop = { mode: "none" };
  result.durationMs = durationMs;
  const outFrames = Math.round((durationMs * fps) / 1000);

  // 4. Presets.
  if (outputs.has("mp4")) {
    const f = path.join(outDir, `${clip.id}.mp4`);
    log(`${clip.id}: encoding mp4`);
    await ff(["-i", source, "-an", "-vf", lanczos(W), ...x264(config.quality.crf, fps), f]);
    result.files.mp4 = { path: f, ...(await probe(f)) };
  }
  if (outputs.has("webm")) {
    const f = path.join(outDir, `${clip.id}.webm`);
    log(`${clip.id}: encoding webm`);
    await ff(["-i", source, "-an", "-vf", lanczos(W), ...vp9(config.quality.webmCrf), f]);
    result.files.webm = { path: f, ...(await probe(f)) };
  }
  if (outputs.has("mp4@2x")) {
    const f = path.join(outDir, `${clip.id}@2x.mp4`);
    await ff(["-i", source, "-an", ...x264(config.quality.crf, fps), f]);
    result.files["mp4@2x"] = { path: f, ...(await probe(f)) };
  }
  if (outputs.has("gif")) {
    const f = path.join(outDir, `${clip.id}.gif`);
    const palette = path.join(takeDir, "palette.png");
    const gw = Math.min(960, W), gfps = 12;
    log(`${clip.id}: encoding gif`);
    await ff(["-i", source, "-vf", `fps=${gfps},${lanczos(gw)},palettegen=max_colors=256:stats_mode=diff`, palette]);
    await ff(["-i", source, "-i", palette, "-lavfi", `fps=${gfps},${lanczos(gw)}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, f]);
    result.files.gif = { path: f, bytes: statSync(f).size, width: gw, fps: gfps };
  }

  // 5. Posters: the lossless screenshot, with the camera window at the poster moment applied.
  const posterSrc = take.poster?.file ? path.join(takeDir, take.poster.file) : null;
  let poster2x = null;
  if (outputs.has("poster") && posterSrc && existsSync(posterSrc)) {
    poster2x = path.join(outDir, `${clip.id}.poster@2x.png`);
    const camWin = camFrames ? windowAt(camFrames, take.poster.at ?? durationMs) : null;
    if (camWin && !atRest(camWin)) await ff(["-i", posterSrc, "-vf", `${cropArgs(camWin, dsf)},${lanczos(vw * dsf, vh * dsf)}`, poster2x]);
    else copyFileSync(posterSrc, poster2x);
    const p1x = path.join(outDir, `${clip.id}.poster.png`);
    await ff(["-i", poster2x, "-vf", lanczos(W), p1x]);
    result.poster = { source: "screenshot", at: take.poster.at, frameIndex: frameAt(entries, take.poster.at ?? durationMs),
      "@2x": { path: poster2x, bytes: statSync(poster2x).size }, "@1x": { path: p1x, bytes: statSync(p1x).size } };
    for (const [k, f] of [["@2x", poster2x], ["@1x", p1x]]) {
      const webp = f.replace(/\.png$/, ".webp");
      if (await toWebp(f, webp)) result.poster[`${k}webp`] = { path: webp, bytes: statSync(webp).size };
    }
    if (!webpEncoder()) result.warnings.push("no WebP encoder (ffmpeg libwebp or cwebp); poster .webp skipped — brew install webp");
  } else if (outputs.has("poster")) result.warnings.push("no poster screenshot in the take; poster skipped");

  // 6. Crops (§10.2): after the camera, from the loop output; focus boxes mapped through the camera.
  const crops = { ...(config.crops || {}), ...(clip.crops || {}) };
  for (const [name, crop] of Object.entries(crops)) {
    const focus = resolveFocus(take, name, crop.focus);
    if (crop.focus && !focus) { result.warnings.push(`crop "${name}": focus "${crop.focus}" was never measured; crop skipped`); continue; }
    const focusBox = focus ? throughCamera(focus.box, camFrames, focus.t, vw, vh) : null;
    const win = cropWindow(crop, focusBox, vw, vh);
    if (!win) { result.warnings.push(`crop "${name}": needs width/height, an aspect, or an explicit rect; skipped`); continue; }
    const scale = crop.scale || 1;
    const entry = { window: win, focus: focusBox, focusAt: focus?.at, files: {} };
    if (focusBox && (focusBox.w > win.w + 1 || focusBox.h > win.h + 1)) entry.note = `focus is ${Math.round(focusBox.w)}×${Math.round(focusBox.h)} CSS px; the ${win.w}×${win.h} window does not contain it`;
    const variants = scale === 1 ? [{ suffix: "", scale: 1 }] : [{ suffix: "", scale }, { suffix: "@1x", scale: 1 }];
    for (const v of variants) {
      const outW = Math.round(win.w * v.scale), outH = Math.round(win.h * v.scale);
      const vf = `${cropArgs(win, dsf)},${lanczos(outW, outH)}`;
      if (outputs.has("mp4")) {
        const f = path.join(outDir, `${clip.id}.${name}${v.suffix}.mp4`);
        log(`${clip.id}: encoding crop ${name}${v.suffix} (${outW}×${outH})`);
        await ff(["-i", source, "-an", "-vf", vf, ...x264(config.quality.crf, fps), f]);
        entry.files[`mp4${v.suffix}`] = { path: f, ...(await probe(f)) };
      }
      if (outputs.has("webm")) {
        const f = path.join(outDir, `${clip.id}.${name}${v.suffix}.webm`);
        await ff(["-i", source, "-an", "-vf", vf, ...vp9(config.quality.webmCrf), f]);
        entry.files[`webm${v.suffix}`] = { path: f, ...(await probe(f)) };
      }
      if (poster2x) {
        const f = path.join(outDir, `${clip.id}.${name}${v.suffix}.poster.png`);
        await ff(["-i", poster2x, "-vf", vf, f]);
        entry.files[`poster${v.suffix}`] = { path: f, bytes: statSync(f).size };
        const webp = f.replace(/\.png$/, ".webp");
        if (await toWebp(f, webp)) entry.files[`poster${v.suffix}webp`] = { path: webp, bytes: statSync(webp).size };
      }
    }
    result.crops[name] = entry;
  }

  // 7. Checks (§13).
  if (typeof clip.length === "number") {
    const diff = Math.abs(durationMs - clip.length);
    check("length", diff <= 200, `${durationMs} ms vs target ${clip.length} ms${loopMode === "crossfade" ? " (after the crossfade trim)" : ""}`);
  }
  if (result.files.mp4) {
    const budget = 2 * 1024 * 1024 * (durationMs / 8000) * (W / 1440);
    check("mp4 size", result.files.mp4.bytes <= budget, `${(result.files.mp4.bytes / 1024).toFixed(0)} KB, budget ${(budget / 1024).toFixed(0)} KB`);
    check("mp4 timing", result.files.mp4.frames === outFrames && Math.abs(result.files.mp4.durationMs - durationMs) <= 1000 / fps + 1,
      `${result.files.mp4.frames} frames / ${result.files.mp4.durationMs} ms encoded vs ${outFrames} frames / ${durationMs} ms timeline`);
  }
  if (result.files.gif) check("gif size", result.files.gif.bytes <= 5 * 1024 * 1024, `${(result.files.gif.bytes / 1024).toFixed(0)} KB, limit 5120 KB`);
  if (outputs.has("poster")) check("poster", !!result.poster["@2x"], result.poster["@2x"] ? "written" : "missing");

  // 8. Manifest (§10.5) and embed snippet.
  const manifestFile = path.join(outDir, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { clips: {} };
  const base = (p) => path.basename(p);
  manifest.clips[clip.id] = {
    id: clip.id, title: clip.title, scenario: clip.scenario, alt: clip.alt, length: durationMs, loop: loopMode, zoom: mode,
    width: W, height: result.files.mp4?.height ?? result.files.webm?.height ?? null, sourceSize: take.frameSize, viewport: take.viewport, fps,
    files: Object.fromEntries(Object.entries(result.files).map(([k, v]) => [k, base(v.path)])),
    poster: result.poster["@2x"] ? Object.fromEntries(Object.entries(result.poster).filter(([k]) => k.startsWith("@")).map(([k, v]) => [k, base(v.path)]).concat([["at", result.poster.at]])) : null,
    crops: Object.fromEntries(Object.entries(result.crops).map(([k, v]) => [k, { window: v.window, focus: v.focus, note: v.note, files: Object.fromEntries(Object.entries(v.files).map(([fk, fv]) => [fk, base(fv.path)])) }])),
    camera: result.camera, loopInfo: result.loop, steps: take.actions, marks: take.marks, recordedAt: take.recordedAt, exportedAt: new Date().toISOString(),
    clipFileMtime: statSync(clip.file).mtimeMs, warnings: result.warnings,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  result.manifest = manifestFile;
  const embedDir = path.join(outDir, "embed");
  mkdirSync(embedDir, { recursive: true });
  const posterRef = result.poster["@1xwebp"] ? base(result.poster["@1xwebp"].path) : result.poster["@1x"] ? base(result.poster["@1x"].path) : null;
  const sources = [result.files.webm && `  <source src="${base(result.files.webm.path)}" type="video/webm">`, result.files.mp4 && `  <source src="${base(result.files.mp4.path)}" type="video/mp4">`].filter(Boolean);
  const attrs = ["autoplay", "muted", loopMode !== "none" ? "loop" : null, "playsinline", 'preload="metadata"', posterRef ? `poster="${posterRef}"` : null, `aria-label="${String(clip.alt || clip.title || "").replace(/"/g, "&quot;")}"`].filter(Boolean);
  writeFileSync(path.join(embedDir, `${clip.id}.html`), `<video ${attrs.join(" ")}>\n${sources.join("\n")}\n</video>\n`);
  result.embed = path.join(embedDir, `${clip.id}.html`);
  result.ok = result.checks.every((c) => c.ok);
  return result;
}
