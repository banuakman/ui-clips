// Export (§10): retimed frames (speed ramps applied) → lossless 2× intermediate → per output size: stage canvas,
// camera track (auto or explicit), loop, presets, posters; GIF; sub-clips; manifest and embed snippet.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync, readdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { retime, frameAt } from "./retime.mjs";
import { buildTimeMap } from "./timemap.mjs";
import { stageRect, stageFilter, toStage, maskCmdText } from "./stage.mjs";
import { buildTrack, atRest, sendcmdText, windowAt, settledWindowAt, frameGeometry, frameAround, padBox, FEEL } from "./camera.mjs";
import { decideReturn, crossfadeFilter, LOOP } from "./loop.mjs";
import { loadClips } from "./config.mjs";

export const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobeBin = () => process.env.FFPROBE_PATH || "ffprobe";

export function run(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${bin} ${args.slice(0, 10).join(" ")}… exited ${code}\n${err.slice(-2000)}`))));
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

let webpTool;
/** "ffmpeg" (libwebp) | "cwebp" | null — WebP is a soft dependency (§10.1). */
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

const even = (v) => Math.round(v / 2) * 2;
const lanczos = (w, h) => `scale=${w}:${h}:flags=lanczos`;
const x264 = (crf, fps) => ["-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(crf), "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", String(fps * 2), "-movflags", "+faststart"];
const vp9 = (crf, fast) => ["-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", fast ? "4" : "1", "-pix_fmt", "yuv420p"];
const lossless = ["-c:v", "ffv1", "-level", "3"];

/** Normalise the output sizes (§10.2): project sizes + legacy crops + clip crops. */
export function normaliseSizes(config, clip, stage) {
  const raw = { ...(config.sizes || { full: true }), ...(config.crops || {}), ...(clip.crops || {}) };
  const W = config.quality.maxWidth;
  const out = [];
  for (const [name, spec] of Object.entries(raw)) {
    if (spec === false || spec == null) continue;
    if (name === "full" && (spec === true || spec.width == null)) {
      const aspect = stage.w / stage.h;
      out.push({ name: "full", aspect, outW: W, outH: even(Math.round(W / aspect)), scale: 1, mode: "camera", focus: "auto", full: true });
      continue;
    }
    const s = typeof spec === "object" ? spec : {};
    let cssW = s.width, cssH = s.height, aspect = null;
    if (s.aspect) { const [a, b] = String(s.aspect).split(":").map(Number); aspect = a / b; }
    if (s.x != null && s.y != null && cssW && cssH) { out.push({ name, aspect: cssW / cssH, outW: even(cssW * (s.scale || 1)), outH: even(cssH * (s.scale || 1)), scale: s.scale || 1, mode: "static", rect: { x: s.x, y: s.y, w: cssW, h: cssH } }); continue; }
    if (aspect && !cssW && !cssH) { cssW = Math.min(stage.w, stage.h * aspect); cssH = cssW / aspect; }
    else if (aspect && cssW && !cssH) cssH = cssW / aspect;
    else if (aspect && cssH && !cssW) cssW = cssH * aspect;
    if (!cssW || !cssH) continue;
    aspect = cssW / cssH;
    const scale = s.scale || (s.aspect && !s.width ? W / cssW : 1);
    const focus = s.focus ?? "auto";
    out.push({ name, aspect, outW: even(Math.round(cssW * scale)), outH: even(Math.round(cssH * scale)), scale, explicitScale: !!s.scale, cssW, cssH, mode: focus === "auto" ? "camera" : "static", focus });
  }
  return out;
}

function resolveFocus(take, cropName, focus, stage) {
  if (!focus || focus === "auto") return null;
  const mark = (take.marks || []).filter((m) => m.name === focus && m.box).pop();
  if (mark) return { box: toStage(mark.box, stage), at: `mark ${mark.name}`, t: mark.t };
  const last = (take.focusBoxes || []).filter((f) => f.crop === cropName && f.box).pop();
  return last ? { box: toStage(last.box, stage), at: `selector at ${last.at}`, t: last.t } : null;
}

/** Resolve a sub-clip boundary ("start" | "end" | mark | ms) to output time. */
function boundary(v, marks, durationMs) {
  if (v == null || v === "start") return 0;
  if (v === "end") return durationMs;
  if (typeof v === "number") return Math.min(durationMs, Math.max(0, v));
  const m = marks.find((x) => x.name === v);
  if (!m) throw new Error(`sub-clip boundary "${v}" is not a mark of the take (marks: ${marks.map((x) => x.name).join(", ") || "none"})`);
  return m.t;
}

/**
 * @param {{config, clip, takeDir, outDir, log?, zoom?, feel?, fast?}} opts
 */
export async function exportClip({ config, clip, takeDir, outDir, log = () => {}, zoom, feel, fast = false }) {
  // Sub-clips export from their parent's take.
  let parent = clip;
  if (clip.isSubclip) {
    const [p] = await loadClips(config, clip.take);
    parent = p;
    takeDir = path.join(config.cacheDir, p.id, "latest");
  }
  const takeFile = path.join(takeDir, "take.json");
  if (!existsSync(takeFile)) throw new Error(`No recording for ${parent.id}. Run: ui-clips record ${parent.id}`);
  const take = JSON.parse(readFileSync(takeFile, "utf8"));
  mkdirSync(outDir, { recursive: true });
  const W = config.quality.maxWidth;
  const fps = take.fps || config.fps;
  const dsf = take.deviceScaleFactor || config.deviceScaleFactor;
  const viewport = take.viewport;
  const outputs = new Set(config.outputs);
  if (fast) outputs.delete("gif");
  const result = { clipId: clip.id, files: {}, poster: {}, sizes: {}, checks: [], warnings: [...(take.warnings || [])] };
  const check = (name, ok, detail) => result.checks.push({ name, ok, detail });
  const workDir = path.join(takeDir, clip.isSubclip ? `sub-${clip.id}` : "export");
  mkdirSync(workDir, { recursive: true });

  // 1. Retime in source time, map through speed ramps, sample at constant fps in output time.
  const { entries, durationMs: rawMs, dropped } = retime({ frames: take.frames, t0: take.t0, tEnd: take.tEnd, trims: take.trims });
  if (!entries.length) throw new Error("The take has no frames.");
  const tm = buildTimeMap(take.speeds || [], rawMs);
  const fullMs = Math.round(tm.outputDurationMs);
  const nFull = Math.max(1, Math.round((fullMs * fps) / 1000));
  const cfr = [];
  for (let k = 0; k < nFull; k++) cfr.push(entries[frameAt(entries, tm.toSource((k * 1000) / fps))].file);
  const d = (1 / fps).toFixed(6);
  writeFileSync(path.join(takeDir, "frames.txt"), cfr.map((f) => `file '${f}'\nduration ${d}`).join("\n") + `\nfile '${cfr[cfr.length - 1]}'\n`);
  const intermediate = path.join(takeDir, "intermediate.mkv");
  log(`${parent.id}: ${take.frames.length} source frames → ${(fullMs / 1000).toFixed(2)} s at ${fps} fps${tm.identity ? "" : ` (speed ramps: ${rawMs} ms → ${fullMs} ms)`}`);
  await ff(["-f", "concat", "-safe", "0", "-i", "frames.txt", "-fps_mode", "cfr", "-r", String(fps), "-frames:v", String(nFull), "-pix_fmt", "yuv444p", ...lossless, intermediate], { cwd: takeDir });
  result.sourceFrames = take.frames.length; result.droppedFrames = dropped;

  // 2. Stage, and the take's events in output time and stage coordinates.
  const stage = stageRect(viewport, take.stage?.exclude || []);
  const fill = take.stage?.fill || config.stage?.fill || "#FFFFFF";
  const O = (t) => tm.toOutput(t);
  const marks = (take.marks || []).map((m) => ({ ...m, t: O(m.t) }));
  const actions = (take.actions || []).map((a) => ({ ...a, t: O(a.t), ...toStage(a, stage) }));
  const explicitShots = (take.shots || []).map((s) => ({ ...s, t: O(s.t), targets: (s.targets || []).map((tg) => (tg.box ? { ...tg, box: toStage(tg.box, stage) } : tg)), anchorBox: s.anchorBox ? toStage(s.anchorBox, stage) : undefined }));
  const tracks = Object.fromEntries(Object.entries(take.tracks || {}).map(([k, v]) => [k, v.map(([t, x, y, w, h]) => [O(t), x - stage.x, y - stage.y, w, h])]));
  const posterAtFull = take.poster?.at != null ? O(take.poster.at) : fullMs;

  // Sub-clip range in output time → frame indices.
  let T0 = 0, T1 = fullMs;
  if (clip.isSubclip) { T0 = boundary(clip.from, marks, fullMs); T1 = boundary(clip.to, marks, fullMs); if (T1 <= T0) throw new Error(`sub-clip range is empty (${T0}–${T1} ms)`); }
  const fa = Math.round((T0 * fps) / 1000), fb = Math.min(nFull, Math.round((T1 * fps) / 1000));
  let durationMs = Math.round(((fb - fa) * 1000) / fps);
  let keepFrames = fb - fa;

  // 3. Sizes and camera tracks (one per output aspect).
  const mode = zoom || clip.zoom || config.zoom?.mode || "off";
  const feelName = feel || clip.camera?.feel || config.camera?.feel || "calm";
  const sizes = normaliseSizes(config, clip, stage);
  if (!sizes.length) throw new Error("no output sizes configured (sizes.full is false and no crops)");
  const full = sizes.find((s) => s.full);
  const renderFullAt2x = !fast && (outputs.has("mp4@2x") || true) && full && W * dsf <= stage.w * dsf;   // keep 2× for sharp posters/@2x; fast → export width
  const plans = [];
  for (const sz of sizes) {
    const info = { name: sz.name, outW: sz.outW, outH: sz.outH, scale: sz.scale, explicitScale: sz.explicitScale, mode: sz.mode };
    const renderW = sz.full ? (fast ? W : Math.min(W * dsf, even(stage.w * dsf))) : sz.outW;
    const renderH = even(Math.round(renderW / sz.aspect));
    let frames = null, geo = frameGeometry(stage, { aspect: sz.aspect, outWidthPx: sz.outW, deviceScaleFactor: dsf }), padBelow = geo.padBelow, staticWin = null;
    if (sz.mode === "camera") {
      const track = buildTrack({ actions, explicitShots, tracks, stage, aspect: sz.aspect, outWidthPx: sz.outW, deviceScaleFactor: dsf, mode, feel: feelName, durationMs: fullMs, fps });
      geo = track.geo;
      frames = track.frames.slice(fa, fb).map((f) => ({ ...f, t: f.t - track.frames[fa].t }));
      for (const w of track.warnings) if (!result.warnings.includes(w)) result.warnings.push(w);
      info.shots = track.shots; info.feel = feelName; info.zoom = mode; info.opening = track.opening;
      info.localShots = track.shots.filter((x) => x.source === "explicit").map((x) => ({ ...x, startMs: x.startMs - T0 }));
      padBelow = Math.max(padBelow, ...frames.map((f) => f.y + f.h - stage.h));
    } else {
      const focus = sz.rect ? { box: sz.rect } : resolveFocus(take, sz.name, sz.focus, stage);
      if (!focus && sz.focus) { result.warnings.push(`size "${sz.name}": focus "${sz.focus}" was never measured; size skipped`); continue; }
      const cw = sz.cssW ?? Math.min(stage.w, stage.h * sz.aspect), ch = cw / sz.aspect;
      const g = { aspect: sz.aspect, wide: { x: 0, y: 0, w: cw, h: ch }, floorW: cw, canvasH: Math.max(stage.h, ch) };
      staticWin = sz.rect ? { ...sz.rect } : frameAround(focus.box, g, stage, { align: focus.box.h > ch ? "top" : "center" });
      if (!sz.rect && (focus.box.w > cw + 1 || focus.box.h > ch + 1)) info.note = `focus is ${Math.round(focus.box.w)}×${Math.round(focus.box.h)} CSS px; the ${Math.round(cw)}×${Math.round(ch)} window does not contain it`;
      info.window = staticWin; info.focusAt = focus.at;
      padBelow = Math.max(0, staticWin.y + staticWin.h - stage.h);
    }
    padBelow = Math.max(0, Math.ceil(padBelow));
    info.render = { w: renderW, h: renderH, padBelow, frames, geo, staticWin };
    plans.push({ sz, info });
  }
  // One stage canvas per export (crop, masks, pad for the tallest window), then each size's camera pass reads it
  // straight from the decoder: a crop whose size changes per frame must be the first filter (anything in front of it
  // segfaults ffmpeg 9), and the sub-clip range is cut by input seeking, which is frame-exact on the all-intra file.
  const padMax = Math.max(0, ...plans.map((p) => p.info.render.padBelow));
  const canvasW = stage.w, canvasH = stage.h + padMax;
  const maskSamples = stage.masks.map((m) => (m.track && tracks[m.track]?.length ? tracks[m.track] : null));
  const maskCmd = maskCmdText(stage, maskSamples, { dsf, fps, durationMs: fullMs });
  const maskCmdFile = maskCmd ? path.join(workDir, "masks.cmd") : null;
  if (maskCmd) writeFileSync(maskCmdFile, maskCmd);
  const canvasFilter = stageFilter(stage, { dsf, fill, padBelowCss: padMax, maskCmdFile });
  const canvasFile = path.join(workDir, "canvas.mkv");
  log(`${clip.id}: stage canvas ${canvasW}×${canvasH} (${stage.cuts.length} cut, ${stage.masks.length} masked, ${padMax} px fill below)`);
  await ff(["-i", intermediate, "-vf", canvasFilter, ...lossless, canvasFile]);
  const seek = ["-ss", (fa / fps).toFixed(6), "-to", (fb / fps).toFixed(6)];
  for (const { sz, info } of plans) {
    const { frames, staticWin, w: renderW, h: renderH, geo } = info.render;
    const file = path.join(workDir, `size-${sz.name}.mkv`);
    let vf;
    if (frames) {
      const cmd = path.join(workDir, `camera-${sz.name}.cmd`);
      writeFileSync(cmd, sendcmdText(frames, { deviceScaleFactor: dsf, canvasW, canvasH }));
      vf = `sendcmd=f=${cmd.replace(/([\\':,\[\]])/g, "\\$1")},crop=${even(canvasW * dsf)}:${even(canvasH * dsf)}:0:0,${lanczos(renderW, renderH)}`;
      log(`${clip.id}: rendering ${sz.name} (${renderW}×${renderH}, ${mode} camera, ${feelName}${info.shots.some((s) => s.source === "explicit") ? ", explicit track" : ""})`);
    } else {
      vf = `crop=${even(staticWin.w * dsf)}:${even(staticWin.h * dsf)}:${even(staticWin.x * dsf)}:${even(staticWin.y * dsf)},${lanczos(renderW, renderH)}`;
      log(`${clip.id}: rendering ${sz.name} (${renderW}×${renderH}, static window)`);
    }
    await ff([...seek, "-i", canvasFile, "-vf", vf, "-frames:v", String(fb - fa), ...lossless, file]);
    info.render.file = file; info.render.canvasH = canvasH;
    if (frames) {
      // §13: the camera is at rest (the opening framing) at both ends; with a crossfade loop it rests for at least
      // 0.4 s before the fade so frame matches frame.
      const opening = info.opening;
      const restStart = atRest(frames[0], opening), restEnd = atRest(frames[frames.length - 1], opening);
      const label = (f, ok) => ok ? "opening framing" : `${f.scale.toFixed(2)}× at (${Math.round(f.x)}, ${Math.round(f.y)})`;
      const detail = `${label(frames[0], restStart)} at start, ${label(frames[frames.length - 1], restEnd)} at end`;
      if (!clip.isSubclip && mode !== "off") check(`camera rest (${sz.name})`, restStart && restEnd, detail);
      // Every click must land inside the frame the viewer sees at that moment (what the clip is about).
      const clicks = actions.filter((a) => a.kind === "click" && a.t >= T0 && a.t < T1);
      const outside = clicks.filter((a) => { const f = windowAt(frames, a.t - T0); const cx = a.x + a.w / 2, cy = a.y + a.h / 2; return !(cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + Math.min(f.h, stage.h - f.y)); });
      if (clicks.length) check(`clicks in frame (${sz.name})`, outside.length === 0, outside.length ? `${outside.length} of ${clicks.length} click(s) land outside the frame: ${outside.map((a) => `${(a.locator || "").slice(0, 40)} at ${Math.round(a.t - T0)} ms`).join("; ")}` : `${clicks.length} click(s), all inside the frame`);
      if (!clip.isSubclip && (clip.loop || "none") === "crossfade") {
        const need = LOOP.crossfadeMs + 400;
        const tail = frames.filter((f) => f.t >= frames[frames.length - 1].t - need + 1);
        const ok = tail.every((f) => atRest(f, opening));
        check(`loop camera rest (${sz.name})`, ok, ok ? `at the opening framing for the last ${need} ms (0.4 s rest + 0.4 s fade)` : `the camera is still moving inside the last ${need} ms; end the track with h.shot("opening") then hold 0.4 s before the fade`);
      }
      const minW = Math.min(...frames.map((f) => f.w));
      check(`camera floor (${sz.name})`, minW >= geo.floorW - 0.5, `narrowest window ${Math.round(minW)} CSS px, floor ${Math.round(geo.floorW)} (half of ${sz.outW} px)`);
    }
    result.sizes[sz.name] = info;
  }
  const fullInfo = result.sizes.full;
  if (!fullInfo) throw new Error('an output needs the "full" size for loop checks and the manifest');
  if (take.stage?.exclude?.length) check("stage", true, `${stage.cuts.length} region(s) cut, ${stage.masks.length} masked; stage ${stage.w}×${stage.h} at (${stage.x}, ${stage.y})`);

  // 4. Loop (§10.4): decided on the full size, applied to every size.
  const loopMode = clip.loop || "none";
  let loopInfo = { mode: loopMode };
  if (loopMode === "return") {
    const tailDir = path.join(workDir, "loopcheck");
    rmSync(tailDir, { recursive: true, force: true }); mkdirSync(tailDir);
    const lastAction = Math.max(0, ...actions.filter((a) => a.t >= T0 && a.t <= T1).map((a) => a.t - T0));
    const tailStart = Math.min(keepFrames - 1, Math.max(0, Math.round(((lastAction + 300) * fps) / 1000)));
    await ff(["-i", fullInfo.render.file, "-vf", `select='eq(n\\,0)+gte(n\\,${tailStart})',scale=${W}:-2`, "-fps_mode", "passthrough", path.join(tailDir, "f%04d.png")]);
    const pngs = readdirSync(tailDir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(tailDir, f));
    const verdict = decideReturn(pngs[0], pngs.slice(1));
    if (verdict.ok && verdict.endFrame != null) {
      const keep = tailStart + verdict.endFrame + 1;
      result.warnings.push(`loop: the last frame differed from the first (${(verdict.lastRatio * 100).toFixed(2)}% of pixels); trimmed ${keepFrames - keep} frame(s) to the matching frame`);
      keepFrames = keep;
    }
    check("loop return", verdict.ok, verdict.ok ? `first and last frames match (${(verdict.lastRatio * 100).toFixed(3)}% differing pixels)` : `last frame differs by ${(verdict.lastRatio * 100).toFixed(2)}% and no tail frame matches; try loop: "crossfade"`);
    loopInfo = { mode: "return", lastRatio: verdict.lastRatio, trimmedFrames: fb - fa - keepFrames };
  }
  durationMs = Math.round((keepFrames * 1000) / fps);
  for (const sz of Object.values(result.sizes)) {
    let src = sz.render.file;
    if (keepFrames < fb - fa) { const cut = path.join(workDir, `size-${sz.name}-cut.mkv`); await ff(["-i", src, "-frames:v", String(keepFrames), ...lossless, cut]); src = cut; }
    if (loopMode === "crossfade") {
      const faded = path.join(workDir, `size-${sz.name}-loop.mkv`);
      const D = keepFrames / fps;
      if (D <= (LOOP.crossfadeMs / 1000) * 2) throw new Error("clip too short to crossfade");
      await ff(["-i", src, "-i", src, "-filter_complex", crossfadeFilter(D), "-map", "[v]", ...lossless, faded]);
      src = faded;
    }
    sz.render.source = src;
  }
  if (loopMode === "crossfade") { durationMs -= LOOP.crossfadeMs; check("loop crossfade", true, `tail blended into the head over ${LOOP.crossfadeMs} ms; clip now ${durationMs} ms`); loopInfo = { mode: "crossfade", fadeMs: LOOP.crossfadeMs }; }
  result.loop = loopInfo;
  result.durationMs = durationMs;
  const outFrames = Math.round((durationMs * fps) / 1000);

  // 5. Presets per size.
  const fileName = (szName, variant, ext) => szName === "full" ? `${clip.id}${variant}.${ext}` : `${clip.id}.${szName}${variant}.${ext}`;
  for (const sz of Object.values(result.sizes)) {
    const src = sz.render.source;
    const variants = !sz.explicitScale || sz.scale === 1 || sz.name === "full" ? [{ suffix: "", w: sz.outW, h: sz.outH }] : [{ suffix: "", w: sz.outW, h: sz.outH }, { suffix: "@1x", w: even(sz.outW / sz.scale), h: even(sz.outH / sz.scale) }];
    for (const v of variants) {
      const scaleF = v.w === sz.render.w && v.h === sz.render.h ? null : lanczos(v.w, v.h);
      const vfArgs = scaleF ? ["-vf", scaleF] : [];
      if (outputs.has("mp4")) {
        const f = path.join(outDir, fileName(sz.name, v.suffix, "mp4"));
        log(`${clip.id}: encoding ${path.basename(f)}`);
        await ff(["-i", src, "-an", ...vfArgs, ...x264(config.quality.crf, fps), f]);
        result.files[`${sz.name}${v.suffix}.mp4`] = { path: f, ...(await probe(f)) };
      }
      if (outputs.has("webm")) {
        const f = path.join(outDir, fileName(sz.name, v.suffix, "webm"));
        await ff(["-i", src, "-an", ...vfArgs, ...vp9(config.quality.webmCrf, fast), f]);
        result.files[`${sz.name}${v.suffix}.webm`] = { path: f, ...(await probe(f)) };
      }
    }
    if (sz.name === "full" && outputs.has("mp4@2x") && !fast && sz.render.w >= W * 2) {
      const f = path.join(outDir, `${clip.id}@2x.mp4`);
      await ff(["-i", src, "-an", ...x264(config.quality.crf, fps), f]);
      result.files["full@2x.mp4"] = { path: f, ...(await probe(f)) };
    }
    if (sz.name === "full" && outputs.has("gif")) {
      const f = path.join(outDir, `${clip.id}.gif`);
      const palette = path.join(workDir, "palette.png");
      const gw = Math.min(960, W), gfps = 12;
      log(`${clip.id}: encoding gif`);
      await ff(["-i", src, "-vf", `fps=${gfps},scale=${gw}:-2:flags=lanczos,palettegen=max_colors=256:stats_mode=diff`, palette]);
      await ff(["-i", src, "-i", palette, "-lavfi", `fps=${gfps},scale=${gw}:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, f]);
      result.files["full.gif"] = { path: f, bytes: statSync(f).size, width: gw, fps: gfps };
    }
  }

  // 6. Posters per size: lossless screenshot (the take's poster, or a mark screenshot for sub-clips) through the stage
  //    canvas and the size's window at the poster moment.
  let posterSrc = null, posterT = posterAtFull, posterNote = null;
  if (clip.isSubclip) {
    const pm = clip.poster;
    if (pm && take.markShots?.[pm]) { posterSrc = path.join(takeDir, take.markShots[pm]); posterT = boundary(pm, marks, fullMs); }
    else if (pm === "start" || pm === "end" || pm == null) { posterT = pm === "start" ? T0 : T1 - 1000 / fps; posterNote = "poster taken from the video frame (no lossless screenshot at that moment)"; }
    else if (marks.some((m) => m.name === pm)) { posterT = boundary(pm, marks, fullMs); posterNote = `no lossless screenshot at mark "${pm}" (no hold followed it); poster taken from the video frame`; }
    else posterNote = `poster "${pm}" is not a mark of the take; poster skipped`;
  } else if (take.poster?.file) posterSrc = path.join(takeDir, take.poster.file);
  if (outputs.has("poster") && (posterSrc || posterNote)) {
    if (posterNote) result.warnings.push(posterNote);
    const posterLocalT = posterT - T0;
    for (const sz of Object.values(result.sizes)) {
      const win = sz.render.frames ? settledWindowAt(sz.render.frames, sz.localShots, posterLocalT) : sz.render.staticWin;
      const stageAtPoster = { ...stage, masks: stage.masks.map((m, i) => { const sm = maskSamples[i]; if (!sm) return m; let s = sm[0]; for (const x of sm) { if (x[0] <= posterT) s = x; else break; } return { ...m, x: s[1], y: s[2], w: s[3], h: s[4] }; }) };
      const canvas = stageFilter(stageAtPoster, { dsf, fill, padBelowCss: Math.max(sz.render.padBelow, Math.ceil(win.y + win.h - stage.h)) });
      const cropF = `crop=${even(win.w * dsf)}:${even(win.h * dsf)}:${even(win.x * dsf)}:${even(win.y * dsf)}`;
      const outs = sz.name === "full"
        ? [{ suffix: "@2x", w: even(win.w * dsf), h: even(win.h * dsf) }, { suffix: "", w: sz.outW, h: sz.outH }]
        : (!sz.explicitScale || sz.scale === 1 ? [{ suffix: "", w: sz.outW, h: sz.outH }] : [{ suffix: "", w: sz.outW, h: sz.outH }, { suffix: "@1x", w: even(sz.outW / sz.scale), h: even(sz.outH / sz.scale) }]);
      for (const o of outs) {
        const f = path.join(outDir, sz.name === "full" ? `${clip.id}.poster${o.suffix}.png` : `${clip.id}.${sz.name}${o.suffix}.poster.png`);
        if (posterSrc && existsSync(posterSrc)) await ff(["-i", posterSrc, "-vf", `${canvas},${cropF},${lanczos(o.w, o.h)}`, f]);
        else { const n = Math.min(keepFrames - 1, Math.max(0, Math.round((posterLocalT * fps) / 1000))); await ff(["-i", sz.render.source, "-vf", `select='eq(n\\,${n})',${lanczos(o.w, o.h)}`, "-frames:v", "1", f]); }
        const entry = { path: f, bytes: statSync(f).size, width: o.w, height: o.h };
        const webp = f.replace(/\.png$/, ".webp");
        if (await toWebp(f, webp)) entry.webp = webp;
        result.poster[`${sz.name}${o.suffix}`] = entry;
      }
    }
    if (!webpEncoder()) result.warnings.push("no WebP encoder (ffmpeg libwebp or cwebp); poster .webp skipped — brew install webp");
    result.poster.at = posterT; result.poster.source = posterSrc ? "screenshot" : "frame";
  } else if (outputs.has("poster")) result.warnings.push("no poster screenshot in the take; poster skipped");

  // 7. Checks (§13).
  if (typeof clip.length === "number") { const diff = Math.abs(durationMs - clip.length); check("length", diff <= 200, `${durationMs} ms vs target ${clip.length} ms`); }
  const mp4 = result.files["full.mp4"];
  if (mp4) {
    // §13: under 2 MB for 8 s at 1440×900; prorated by length and by frame area for other stages.
    const budget = 2 * 1024 * 1024 * (durationMs / 8000) * ((mp4.width * mp4.height) / (1440 * 900));
    check("mp4 size", mp4.bytes <= budget, `${(mp4.bytes / 1024).toFixed(0)} KB, budget ${(budget / 1024).toFixed(0)} KB for ${mp4.width}×${mp4.height}`);
    check("mp4 timing", mp4.frames === outFrames && Math.abs(mp4.durationMs - durationMs) <= 1000 / fps + 1, `${mp4.frames} frames / ${mp4.durationMs} ms encoded vs ${outFrames} frames / ${durationMs} ms timeline`);
  }
  if (result.files["full.gif"]) check("gif size", result.files["full.gif"].bytes <= 5 * 1024 * 1024, `${(result.files["full.gif"].bytes / 1024).toFixed(0)} KB, limit 5120 KB`);
  if (outputs.has("poster")) check("poster", !!result.poster.full, result.poster.full ? "written" : "missing");

  // 8. Manifest and snippet.
  const manifestFile = path.join(outDir, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { clips: {} };
  const base = (p) => path.basename(p);
  manifest.clips[clip.id] = {
    id: clip.id, title: clip.title, scenario: clip.scenario, alt: clip.alt, length: durationMs, loop: loopMode, zoom: mode, feel: feelName,
    subclipOf: clip.isSubclip ? { take: parent.id, from: clip.from, to: clip.to, fromMs: T0, toMs: T1 } : undefined,
    width: W, height: fullInfo.outH, sourceSize: take.frameSize, viewport, stage: { x: stage.x, y: stage.y, w: stage.w, h: stage.h, fill }, fps,
    files: Object.fromEntries(Object.entries(result.files).map(([k, v]) => [k, base(v.path)])),
    poster: Object.fromEntries(Object.entries(result.poster).filter(([, v]) => v && v.path).map(([k, v]) => [k, { png: base(v.path), webp: v.webp ? base(v.webp) : null }])),
    posterAt: result.poster.at,
    sizes: Object.fromEntries(Object.entries(result.sizes).map(([k, v]) => [k, { outW: v.outW, outH: v.outH, mode: v.mode, window: v.window, note: v.note, shots: v.shots,
      frames: v.render.frames ? v.render.frames.map((f) => [Math.round(f.t), +f.x.toFixed(1), +f.y.toFixed(1), +f.w.toFixed(1), +f.h.toFixed(1), +f.scale.toFixed(4)]) : null }])),
    loopInfo, speeds: take.speeds || [], steps: actions, marks, recordedAt: take.recordedAt, exportedAt: new Date().toISOString(),
    clipFileMtime: statSync(clip.file).mtimeMs, warnings: result.warnings,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  result.manifest = manifestFile;
  const embedDir = path.join(outDir, "embed");
  mkdirSync(embedDir, { recursive: true });
  const pf = result.poster.full;
  const posterRef = pf ? base(pf.webp || pf.path) : null;
  const sources = [result.files["full.webm"] && `  <source src="${base(result.files["full.webm"].path)}" type="video/webm">`, mp4 && `  <source src="${base(mp4.path)}" type="video/mp4">`].filter(Boolean);
  const attrs = ["autoplay", "muted", loopMode !== "none" ? "loop" : null, "playsinline", 'preload="metadata"', posterRef ? `poster="${posterRef}"` : null, `aria-label="${String(clip.alt || clip.title || "").replace(/"/g, "&quot;")}"`].filter(Boolean);
  writeFileSync(path.join(embedDir, `${clip.id}.html`), `<video ${attrs.join(" ")}>\n${sources.join("\n")}\n</video>\n`);
  result.embed = path.join(embedDir, `${clip.id}.html`);
  result.ok = result.checks.every((c) => c.ok);
  return result;
}
