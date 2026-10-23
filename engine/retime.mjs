// Rebuild a constant-frame-rate timeline from damage-driven screencast frames.
// Frames hold until the next frame; trims cut time out; the last frame holds to tEnd.
import { normaliseTrims } from "./timemap.mjs";

/**
 * @param {{frames:{file:string,ts:number}[], t0:number, tEnd:number, trims?:[number,number][]}} take
 *   ts and t0/tEnd are absolute ms; trims are [start,end] relative to t0.
 * @returns {{entries:{file:string,durationMs:number,startMs:number}[], durationMs:number, dropped:number}}
 */
export function retime({ frames, t0, tEnd, trims = [] }) {
  const total = tEnd - t0;
  const sorted = [...frames].map((f) => ({ file: f.file, rel: f.ts - t0 })).sort((a, b) => a.rel - b.rel);
  const kept = sorted.filter((f) => f.rel <= total);
  let dropped = sorted.length - kept.length;
  if (kept.length === 0) return { entries: [], durationMs: 0, dropped };
  // The first frame covers the timeline from 0 even if it was presented slightly before or after t0.
  kept[0].rel = Math.min(kept[0].rel, 0);
  const cuts = normaliseTrims(trims, total);
  const entries = [];
  let cursor = 0;
  for (let i = 0; i < kept.length; i++) {
    const start = Math.max(kept[i].rel, 0);
    const end = i + 1 < kept.length ? Math.max(kept[i + 1].rel, start) : total;
    let dur = end - start;
    for (const [a, b] of cuts) dur -= Math.max(0, Math.min(end, b) - Math.max(start, a));
    if (dur <= 0) { dropped++; continue; }
    entries.push({ file: kept[i].file, durationMs: dur, startMs: cursor });
    cursor += dur;
  }
  return { entries, durationMs: cursor, dropped };
}

/**
 * Sample the variable-duration entries at a constant frame rate: output frame k shows the source frame
 * on screen at time k/fps. Returns one file per output frame, so the encoded length is exactly
 * round(durationMs * fps / 1000) frames and identical between takes of the same length.
 */
export function sampleCfr(entries, durationMs, fps) {
  const n = Math.max(1, Math.round((durationMs * fps) / 1000));
  const files = new Array(n);
  let i = 0;
  for (let k = 0; k < n; k++) {
    const t = (k * 1000) / fps;
    while (i + 1 < entries.length && entries[i + 1].startMs <= t) i++;
    files[k] = entries[i].file;
  }
  return files;
}

/** ffmpeg concat-demuxer text for a constant-rate file list; the last file is repeated so its duration counts. */
export function concatText(files, fps) {
  const d = (1 / fps).toFixed(6);
  const lines = [];
  for (const f of files) { lines.push(`file '${f}'`); lines.push(`duration ${d}`); }
  if (files.length) lines.push(`file '${files[files.length - 1]}'`);
  return lines.join("\n") + "\n";
}

/** Index of the frame showing at relative time ms (nearest previous). */
export function frameAt(entries, ms) {
  let idx = 0;
  for (let i = 0; i < entries.length; i++) if (entries[i].startMs <= ms) idx = i; else break;
  return idx;
}
