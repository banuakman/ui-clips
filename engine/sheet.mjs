// Contact sheet: key frames (start, after each action, each mark, end) tiled into one PNG, plus a JSON legend.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { run, ffmpegBin } from "./export.mjs";
import { retime } from "./retime.mjs";
import { buildTimeMap } from "./timemap.mjs";

export async function contactSheet({ config, clip, takeDir, outDir, columns = 4, thumbWidth = 480, max = 12, beats = false }) {
  const takeFile = path.join(takeDir, "take.json");
  // Prefer the exported full-size render (camera and stage applied); fall back to the raw intermediate.
  const rendered = path.join(takeDir, "export", "size-full.mkv");
  const intermediate = existsSync(rendered) ? rendered : path.join(takeDir, "intermediate.mkv");
  if (!existsSync(takeFile)) throw new Error(`No recording for ${clip.id}. Run: ui-clips record ${clip.id}`);
  if (!existsSync(intermediate)) throw new Error(`No render for ${clip.id}. Run: ui-clips export ${clip.id}`);
  const take = JSON.parse(readFileSync(takeFile, "utf8"));
  const fps = take.fps || config.fps;
  const { durationMs: rawMs } = retime({ frames: take.frames, t0: take.t0, tEnd: take.tEnd, trims: take.trims });
  const tm = buildTimeMap(take.speeds || [], rawMs);
  const durationMs = Math.round(tm.outputDurationMs);
  const O = (t) => tm.toOutput(t);
  const moments = [];
  if (beats) {
    for (const m of take.marks) moments.push({ t: O(m.t), label: m.name });
    if (!moments.length) throw new Error("--beats needs marks in the take");
  } else {
    moments.push({ t: 0, label: "start" });
    for (const a of take.actions) if (a.kind !== "park" && a.kind !== "move") moments.push({ t: O(a.t) + 150, label: `${a.kind} ${a.locator || ""}`.trim().slice(0, 48) });
    for (const m of take.marks) moments.push({ t: O(m.t), label: `mark ${m.name}` });
    moments.push({ t: Math.max(0, durationMs - 1000 / fps), label: "end" });
  }
  const seen = new Set();
  const keys = moments
    .map((m) => ({ ...m, frame: Math.min(Math.round((m.t * fps) / 1000), Math.max(0, Math.round((durationMs * fps) / 1000) - 1)) }))
    .filter((m) => (seen.has(m.frame) ? false : seen.add(m.frame)))
    .sort((a, b) => a.frame - b.frame)
    .slice(0, max);
  mkdirSync(outDir, { recursive: true });
  const rows = Math.ceil(keys.length / columns);
  const select = keys.map((k) => `eq(n\\,${k.frame})`).join("+");
  const out = path.join(outDir, `${clip.id}.sheet.png`);
  await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", intermediate, "-vf",
    `select='${select}',scale=${thumbWidth}:-2:flags=lanczos,tile=${columns}x${rows}:padding=8:margin=8:color=#e5e7eb`, "-frames:v", "1", out]);
  const legend = { clipId: clip.id, source: path.basename(intermediate) === "size-full.mkv" ? "full-size render (camera applied)" : "raw take", columns, rows, thumbWidth, frames: keys.map((k, i) => ({ cell: i + 1, frame: k.frame, t: Math.round((k.frame * 1000) / fps), label: k.label })) };
  writeFileSync(path.join(outDir, `${clip.id}.sheet.json`), JSON.stringify(legend, null, 2));
  return { path: out, legend };
}
