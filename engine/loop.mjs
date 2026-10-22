// Loop modes (§10.4): `return` compares the first frame with the tail and trims to a matching frame;
// `crossfade` blends the tail into the head and trims the head so the seam is invisible.
import { readFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export const LOOP = Object.freeze({ threshold: 0.1, tolerance: 0.002, crossfadeMs: 400 });

/** Fraction of differing pixels between two PNG files of the same size. */
export function comparePngs(fileA, fileB, { threshold = LOOP.threshold } = {}) {
  const a = PNG.sync.read(readFileSync(fileA));
  const b = PNG.sync.read(readFileSync(fileB));
  if (a.width !== b.width || a.height !== b.height) throw new Error(`frame sizes differ: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold });
  return { diffPixels: diff, total: a.width * a.height, ratio: diff / (a.width * a.height) };
}

/**
 * Given the first frame and the tail frames (in order, ending with the last frame), decide where the loop ends.
 * Returns { ok, endFrame (index into tail, or null), ratios, lastRatio }.
 */
export function decideReturn(firstPng, tailPngs, { tolerance = LOOP.tolerance } = {}) {
  const ratios = tailPngs.map((f) => comparePngs(firstPng, f).ratio);
  const lastRatio = ratios[ratios.length - 1];
  if (lastRatio <= tolerance) return { ok: true, endFrame: null, ratios, lastRatio };
  // the last frame does not match: trim back to the last tail frame that does
  for (let i = ratios.length - 1; i >= 0; i--) if (ratios[i] <= tolerance) return { ok: true, endFrame: i, ratios, lastRatio };
  return { ok: false, endFrame: null, ratios, lastRatio };
}

/**
 * ffmpeg filter for a crossfade loop of a clip of D seconds. xfade plays the first input to D−F, blends F seconds
 * into the second input's head, then continues with the rest of the second input; keeping [F, D] of that output
 * gives a clip of D−F seconds whose last frame equals its first.
 */
export function crossfadeFilter(durationSec, fadeSec = LOOP.crossfadeMs / 1000) {
  const f = fadeSec.toFixed(3), d = durationSec.toFixed(3);
  return `[0:v][1:v]xfade=transition=fade:duration=${f}:offset=${(durationSec - fadeSec).toFixed(3)}[x];[x]trim=start=${f}:end=${d},setpts=PTS-STARTPTS[v]`;
}
