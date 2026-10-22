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
    camera: take.camera, steps: take.actions, marks: take.marks, recordedAt: take.recordedAt, exportedAt: new Date().toISOString(),
    clipFileMtime: statSync(clip.file).mtimeMs,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  result.manifest = manifestFile;
  result.ok = result.checks.every((c) => c.ok);
  return result;
}
