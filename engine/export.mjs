// Export: retimed frames → lossless intermediate → MP4 / WebM presets, posters, manifest (appendix B).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { retime, sampleCfr, concatText, frameAt } from "./retime.mjs";

export const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobeBin = () => process.env.FFPROBE_PATH || "ffprobe";

export function run(bin, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${bin} ${args.slice(0, 6).join(" ")}… exited ${code}\n${err.slice(-2000)}`))));
  });
}

export async function probe(file) {
  const { out } = await run(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,codec_name,pix_fmt,nb_frames,r_frame_rate:format=duration,size", "-of", "json", file]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] || {};
  return { width: s.width, height: s.height, codec: s.codec_name, pixFmt: s.pix_fmt, frames: Number(s.nb_frames) || null,
    fps: s.r_frame_rate, durationMs: Math.round(Number(j.format?.duration) * 1000), bytes: Number(j.format?.size) };
}

const scaleFilter = (w) => `scale=${w}:-2:flags=lanczos`;

/** A crop's focus: a mark name whose mark carries a box, else the last visible measurement of a selector. */
function resolveFocus(take, cropName, focus) {
  if (!focus) return null;
  const mark = (take.marks || []).filter((m) => m.name === focus && m.box).pop();
  if (mark) return { box: mark.box, at: `mark ${mark.name}` };
  const last = (take.focusBoxes || []).filter((f) => f.crop === cropName && f.box).pop();
  return last ? { box: last.box, at: `selector at ${last.at}` } : null;
}

/** Window of w×h CSS px centred on a box, clamped to the viewport. */
export function windowFor(box, w, h, vw, vh) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), Math.max(0, vw - w)));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), Math.max(0, vh - h)));
  return { x, y, w, h };
}

/**
 * @returns {{clipId, files:{}, poster:{}, durationMs, checks:[], warnings:[]}}
 */
export async function exportClip({ config, clip, takeDir, outDir, log = () => {} }) {
  const takeFile = path.join(takeDir, "take.json");
  if (!existsSync(takeFile)) throw new Error(`No recording for ${clip.id}. Run: ui-clips record ${clip.id}`);
  const take = JSON.parse(readFileSync(takeFile, "utf8"));
  mkdirSync(outDir, { recursive: true });
  const W = config.quality.maxWidth;
  const fps = take.fps || config.fps;
  const outputs = new Set(config.outputs);
  const result = { clipId: clip.id, files: {}, poster: {}, checks: [], warnings: [...(take.warnings || [])] };

  // 1. Retime to constant fps.
  const { entries, durationMs, dropped } = retime({ frames: take.frames, t0: take.t0, tEnd: take.tEnd, trims: take.trims });
  if (!entries.length) throw new Error("The take has no frames.");
  const cfr = sampleCfr(entries, durationMs, fps);
  writeFileSync(path.join(takeDir, "frames.txt"), concatText(cfr, fps));
  result.durationMs = durationMs;
  result.outputFrames = cfr.length;
  result.sourceFrames = take.frames.length;
  result.droppedFrames = dropped;
  log(`${clip.id}: ${take.frames.length} source frames → ${(durationMs / 1000).toFixed(2)} s at ${fps} fps`);

  const intermediate = path.join(takeDir, "intermediate.mkv");
  await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt",
    "-fps_mode", "cfr", "-r", String(fps), "-frames:v", String(cfr.length), "-pix_fmt", "yuv444p", "-c:v", "ffv1", "-level", "3", intermediate], { cwd: takeDir });

  // 2. Presets.
  if (outputs.has("mp4")) {
    const f = path.join(outDir, `${clip.id}.mp4`);
    log(`${clip.id}: encoding mp4`);
    await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", intermediate, "-an", "-vf", scaleFilter(W),
      "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(config.quality.crf), "-pix_fmt", "yuv420p",
      "-profile:v", "high", "-g", String(fps * 2), "-movflags", "+faststart", f]);
    result.files.mp4 = { path: f, ...(await probe(f)) };
  }
  if (outputs.has("webm")) {
    const f = path.join(outDir, `${clip.id}.webm`);
    log(`${clip.id}: encoding webm`);
    await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", intermediate, "-an", "-vf", scaleFilter(W),
      "-c:v", "libvpx-vp9", "-crf", String(config.quality.webmCrf), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1",
      "-pix_fmt", "yuv420p", f]);
    result.files.webm = { path: f, ...(await probe(f)) };
  }
  if (outputs.has("mp4") && outputs.has("mp4@2x")) {
    const f = path.join(outDir, `${clip.id}@2x.mp4`);
    await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", intermediate, "-an",
      "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(config.quality.crf), "-pix_fmt", "yuv420p",
      "-profile:v", "high", "-g", String(fps * 2), "-movflags", "+faststart", f]);
    result.files["mp4@2x"] = { path: f, ...(await probe(f)) };
  }

  // 2b. Fixed-window crops (§10.2, minimal: no camera). Window in CSS px, centred on the focus box, clamped to the frame.
  const crops = { ...(config.crops || {}), ...(clip.crops || {}) };
  const dsf = take.deviceScaleFactor || config.deviceScaleFactor;
  const vw = take.viewport.width, vh = take.viewport.height;
  result.crops = {};
  for (const [name, crop] of Object.entries(crops)) {
    if (!crop.width || !crop.height) { result.warnings.push(`crop "${name}": needs width and height (fixed-window crops only in this milestone)`); continue; }
    const focus = resolveFocus(take, name, crop.focus);
    if (!focus) { result.warnings.push(`crop "${name}": focus "${crop.focus}" was never measured (no mark with a box and no visible element); crop skipped`); continue; }
    const win = windowFor(focus.box, crop.width, crop.height, vw, vh);
    const scale = crop.scale || 1;
    const cropFilter = `crop=${Math.round(crop.width * dsf)}:${Math.round(crop.height * dsf)}:${Math.round(win.x * dsf)}:${Math.round(win.y * dsf)}`;
    const variants = [{ suffix: "", scale }];
    if (scale !== 1) variants.push({ suffix: "@1x", scale: 1 });
    const entry = { window: win, focus: focus.box, focusAt: focus.at, files: {} };
    if (focus.box.w > crop.width || focus.box.h > crop.height) entry.note = `focus is ${focus.box.w}×${focus.box.h} CSS px; the ${crop.width}×${crop.height} window does not contain it`;
    for (const v of variants) {
      const outW = Math.round(crop.width * v.scale), outH = Math.round(crop.height * v.scale);
      const scaleF = v.scale === dsf ? "" : `,scale=${outW}:${outH}:flags=lanczos`;
      if (outputs.has("mp4")) {
        const f = path.join(outDir, `${clip.id}.${name}${v.suffix}.mp4`);
        log(`${clip.id}: encoding crop ${name}${v.suffix} (${outW}×${outH})`);
        await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", intermediate, "-an", "-vf", cropFilter + scaleF,
          "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(config.quality.crf), "-pix_fmt", "yuv420p",
          "-profile:v", "high", "-g", String(fps * 2), "-movflags", "+faststart", f]);
        entry.files[`mp4${v.suffix}`] = { path: f, ...(await probe(f)) };
        result.files[`${name}${v.suffix}.mp4`] = entry.files[`mp4${v.suffix}`];
      }
      if (outputs.has("poster") && take.poster?.file && existsSync(path.join(takeDir, take.poster.file))) {
        const f = path.join(outDir, `${clip.id}.${name}${v.suffix}.poster.png`);
        await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", path.join(takeDir, take.poster.file), "-vf", cropFilter + scaleF, f]);
        entry.files[`poster${v.suffix}`] = { path: f, bytes: statSync(f).size };
      }
    }
    result.crops[name] = entry;
  }

  // 3. Poster: the lossless screenshot from the take; the frame index is kept for later crops/loop work.
  if (outputs.has("poster")) {
    const src = take.poster?.file ? path.join(takeDir, take.poster.file) : null;
    if (src && existsSync(src)) {
      const p2x = path.join(outDir, `${clip.id}.poster@2x.png`);
      const p1x = path.join(outDir, `${clip.id}.poster.png`);
      copyFileSync(src, p2x);
      await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", scaleFilter(W), p1x]);
      result.poster = { source: "screenshot", at: take.poster.at, frameIndex: frameAt(entries, take.poster.at ?? durationMs),
        "@2x": { path: p2x, bytes: statSync(p2x).size }, "@1x": { path: p1x, bytes: statSync(p1x).size } };
    } else {
      result.warnings.push("no poster screenshot in the take; poster skipped");
    }
  }

  // 4. Checks (§13).
  if (typeof clip.length === "number") {
    const diff = Math.abs(durationMs - clip.length);
    result.checks.push({ name: "length", ok: diff <= 200, detail: `${durationMs} ms vs target ${clip.length} ms` });
  }
  if (result.files.mp4) {
    const budget = 2 * 1024 * 1024 * (durationMs / 8000) * (W / 1440);
    result.checks.push({ name: "mp4 size", ok: result.files.mp4.bytes <= budget, detail: `${(result.files.mp4.bytes / 1024).toFixed(0)} KB, budget ${(budget / 1024).toFixed(0)} KB` });
    const expected = Math.round((cfr.length * 1000) / fps);
    const encDiff = Math.abs(result.files.mp4.durationMs - expected);
    result.checks.push({ name: "mp4 timing", ok: encDiff <= 1000 / fps + 1 && result.files.mp4.frames === cfr.length,
      detail: `${result.files.mp4.frames} frames / ${result.files.mp4.durationMs} ms encoded vs ${cfr.length} frames / ${durationMs} ms timeline` });
  }
  if (outputs.has("poster")) result.checks.push({ name: "poster", ok: !!result.poster["@2x"], detail: result.poster["@2x"] ? "written" : "missing" });

  // 5. Manifest entry (M2 completes it).
  const manifestFile = path.join(outDir, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { clips: {} };
  manifest.clips[clip.id] = {
    id: clip.id, title: clip.title, scenario: clip.scenario, alt: clip.alt, length: durationMs, loop: clip.loop,
    width: W, height: result.files.mp4?.height ?? null, sourceSize: take.frameSize,
    files: Object.fromEntries(Object.entries(result.files).map(([k, v]) => [k, path.basename(v.path)])),
    poster: result.poster["@2x"] ? { "@2x": path.basename(result.poster["@2x"].path), "@1x": path.basename(result.poster["@1x"].path), at: result.poster.at } : null,
    crops: Object.fromEntries(Object.entries(result.crops || {}).map(([k, v]) => [k, { window: v.window, focus: v.focus, files: Object.fromEntries(Object.entries(v.files).map(([fk, fv]) => [fk, path.basename(fv.path)])) }])),
    camera: take.camera, steps: take.actions, marks: take.marks, recordedAt: take.recordedAt, exportedAt: new Date().toISOString(),
    clipFileMtime: statSync(clip.file).mtimeMs,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  result.manifest = manifestFile;
  result.ok = result.checks.every((c) => c.ok);
  return result;
}
