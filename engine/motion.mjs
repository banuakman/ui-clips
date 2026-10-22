// Pure motion maths for the cursor: bezier paths, easing, distance-scaled timing, seeded jitter.

export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** 400–1200 ms scaled by distance (appendix D). */
export function moveDuration(d) {
  return Math.round(clamp(400 + d * 0.6, 400, 1200));
}

/**
 * A cursor path as a function of normalised time u ∈ [0, 1]: quadratic bezier with a perpendicular
 * control-point offset of up to 60 px (less for short moves), easeOutQuart, and an optional overshoot
 * that settles back onto the target in the last 15% of the move. Time-driven so latency never stretches a move.
 */
export function makePath(from, to, { overshootPx = 0 } = {}) {
  const d = dist(from, to);
  if (d < 0.5) return () => ({ ...to });
  const ux = (to.x - from.x) / d, uy = (to.y - from.y) / d;
  const px = -uy, py = ux;                                     // perpendicular
  const offset = clamp(d * 0.12, 0, 60);
  const sign = (Math.round(from.x + from.y) % 2 === 0) ? 1 : -1; // deterministic side
  const end = overshootPx ? { x: to.x + ux * overshootPx, y: to.y + uy * overshootPx } : to;
  const c = { x: (from.x + end.x) / 2 + px * offset * sign, y: (from.y + end.y) / 2 + py * offset * sign };
  const settle = overshootPx ? 0.15 : 0;
  return (u) => {
    u = clamp(u, 0, 1);
    if (u <= 1 - settle) {
      const t = easeOutQuart(settle ? u / (1 - settle) : u);
      return {
        x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * c.x + t * t * end.x,
        y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * c.y + t * t * end.y,
      };
    }
    const t = easeInOutCubic((u - (1 - settle)) / settle);
    return { x: end.x + (to.x - end.x) * t, y: end.y + (to.y - end.y) * t };
  };
}

/** Sampled path (n points, ending on the target); used by tests and previews. */
export function bezierPath(from, to, { steps, overshootPx = 0 } = {}) {
  const n = steps || Math.max(2, Math.round(moveDuration(dist(from, to)) / 16));
  const f = makePath(from, to, { overshootPx });
  return Array.from({ length: n }, (_, i) => f((i + 1) / n));
}

/** Small deterministic PRNG so typing jitter is identical between takes. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Cumulative eased scroll deltas for a smooth wheel scroll. */
export function scrollSteps(totalPx, ms) {
  const n = Math.max(2, Math.round(ms / 16));
  const out = [];
  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const cum = Math.round(totalPx * easeInOutCubic(i / n));
    out.push(cum - prev);
    prev = cum;
  }
  return out;
}
