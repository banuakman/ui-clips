// Contact sheet: key frames (start, after each action, each mark, end) tiled into one PNG, plus a JSON legend.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { run, ffmpegBin, ffprobeBin } from "./export.mjs";
import { retime } from "./retime.mjs";
import { buildTimeMap } from "./timemap.mjs";

export async function contactSheet({ config, clip, takeDir, outDir, columns = 4, thumbWidth = 480, max = 12, beats = false, size = "full" }) {
  const takeFile = path.join(takeDir, "take.json");
  // The exported render of the requested size (camera and stage applied, before any loop trim); else the raw take.
  const rendered = path.join(takeDir, "export", `size-${size}.mkv`);
  const intermediate = existsSync(rendered) ? rendered : path.join(takeDir, "intermediate.mkv");
  if (!existsSync(takeFile)) throw new Error(`No recording for ${clip.id}. Run: ui-clips record ${clip.id}`);
  if (!existsSync(intermediate)) throw new Error(`No render for ${clip.id}. Run: ui-clips export ${clip.id}`);
  if (!existsSync(rendered) && size !== "full") throw new Error(`No "${size}" render for ${clip.id}. Run: ui-clips export ${clip.id}`);
  const take = JSON.parse(readFileSync(takeFile, "utf8"));
  // Cells show the framing a moment is about: inside an explicit camera move, the window where the move settles.
  const manifestFile = path.join(outDir, "manifest.json");
  const shots = existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, "utf8")).clips?.[clip.id]?.sizes?.[size]?.shots || []).filter((x) => x.source === "explicit") : [];
  const settle = (T) => { let cur = null; for (const x of shots) { if (x.startMs <= T) cur = x; else break; } return cur && T < cur.startMs + (cur.moveMs || 0) ? cur.startMs + cur.moveMs : T; };
  const fps = take.fps || config.fps;
  const { durationMs: rawMs } = retime({ frames: take.frames, t0: take.t0, tEnd: take.tEnd, trims: take.trims });
  const tm = buildTimeMap(take.speeds || [], rawMs);
  const durationMs = Math.round(tm.outputDurationMs);
  const O = (t) => tm.toOutput(t);
  const moments = [];
  if (beats) {
    for (const m of take.marks) moments.push({ t: settle(O(m.t)), label: m.name });
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
  const out = path.join(outDir, size === "full" ? `${clip.id}.sheet.png` : `${clip.id}.${size}.sheet.png`);
  await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", intermediate, "-vf",
    `select='${select}',scale=${thumbWidth}:-2:flags=lanczos,tile=${columns}x${rows}:padding=8:margin=8:color=#e5e7eb`, "-frames:v", "1", out]);
  const legend = { clipId: clip.id, size, source: existsSync(rendered) ? `${size} render (camera applied)` : "raw take", columns, rows, thumbWidth, frames: keys.map((k, i) => ({ cell: i + 1, frame: k.frame, t: Math.round((k.frame * 1000) / fps), label: k.label })) };
  writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify(legend, null, 2));
  return { path: out, legend };
}


/**
 * Framing sheet (from the dry run, before any recording): for each beat, the rehearsal screenshot cropped to the
 * stage with the planned camera window drawn on it, beside the crop that window gives for one output size.
 */
export async function framingSheet({ config, clip, takeDir, outDir, size = "card", rowHeight = 360 }) {
  const rehearsalDir = path.join(path.dirname(takeDir), "rehearsal");   // written by dry-run beside the takes
  const rehearsalFile = path.join(rehearsalDir, "rehearsal.json");
  if (!existsSync(rehearsalFile)) throw new Error(`No rehearsal for ${clip.id}. Run: ui-clips dry-run ${clip.id}`);
  const r = JSON.parse(readFileSync(rehearsalFile, "utf8"));
  const info = r.sizes[size];
  if (!info) throw new Error(`size "${size}" is not a camera size (have: ${Object.keys(r.sizes).join(", ")})`);
  const st = r.stage;
  const rows = [];
  const rowFiles = [];
  const tmp = path.join(rehearsalDir, "framing");
  mkdirSync(tmp, { recursive: true });
  let i = 0;
  for (const b of r.beats) {
    if (!b.screenshot) continue;
    i++;
    const shotPng = path.join(rehearsalDir, b.screenshot);
    const w = b.windows[size]?.window || null;
    const stageF = `crop=${st.w}:${st.h}:${st.x}:${st.y}`;
    const box = w ? `,drawbox=x=${Math.round(w.x)}:y=${Math.round(w.y)}:w=${Math.round(w.w)}:h=${Math.round(Math.min(w.h, st.h - w.y))}:color=#ff2d55@0.95:t=4` : "";
    const left = path.join(tmp, `row-${i}-stage.png`), right = path.join(tmp, `row-${i}-crop.png`), row = path.join(tmp, `row-${i}.png`);
    await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", shotPng, "-vf", `${stageF}${box},scale=-2:${rowHeight}`, left]);
    if (w) {
      const ch = Math.min(w.h, st.h - w.y);
      await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", shotPng, "-vf", `${stageF},crop=${Math.round(w.w)}:${Math.round(ch)}:${Math.round(w.x)}:${Math.round(w.y)},pad=iw:${Math.round(w.h)}:0:0:color=white,scale=-2:${rowHeight}`, right]);
      await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", left, "-i", right, "-filter_complex", `[0][1]hstack=2,pad=iw+16:ih+16:8:8:color=#e5e7eb`, row]);
    } else {
      await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-i", left, "-vf", `pad=iw+16:ih+16:8:8:color=#e5e7eb`, row]);
    }
    rowFiles.push(row);
    const problems = r.problems.filter((p) => p.size === size && b.windows[size] && p.shot === b.windows[size].shot).map((p) => p.problem);
    rows.push({ row: i, beat: b.name, t: Math.round(b.t), size, window: w ? { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h) } : null, shot: b.windows[size]?.shot ?? null, kind: b.windows[size]?.kind ?? null, problems });
  }
  if (!rowFiles.length) throw new Error("the rehearsal has no beat screenshots (add h.mark calls)");
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${clip.id}.framing.png`);
  const inputs = rowFiles.flatMap((f) => ["-i", f]);
  let widest = 0;
  for (const f of rowFiles) { const { out: o } = await run(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", f]); widest = Math.max(widest, Number(o.trim()) || 0); }
  await run(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex",
    rowFiles.map((_, k) => `[${k}]pad=${widest}:ih:0:0:color=#e5e7eb[r${k}]`).join(";") + ";" + rowFiles.map((_, k) => `[r${k}]`).join("") + `vstack=${rowFiles.length}`, out]);
  const legend = { clipId: clip.id, size, stage: st, rows };
  writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify(legend, null, 2));
  return { path: out, legend };
}
