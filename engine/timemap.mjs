// Speed ramps (§10.2): stretches of the take play faster at export. Source time (ms in the take) ↔ output time.

/** @param {{from:number,to:number,factor:number}[]} speeds  source-time ranges */
export function buildTimeMap(speeds = [], durationMs = Infinity) {
  const segs = speeds
    .map((s) => ({ from: Math.max(0, s.from), to: Math.min(durationMs, s.to), factor: Math.max(0.1, s.factor || 1) }))
    .filter((s) => s.to > s.from && s.factor !== 1)
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < segs.length; i++) if (segs[i].from < segs[i - 1].to) segs[i].from = segs[i - 1].to;
  // cumulative output time at each segment boundary
  const bounds = [];
  let src = 0, out = 0;
  for (const s of segs) {
    out += s.from - src; src = s.from;
    bounds.push({ from: s.from, to: s.to, outFrom: out, outTo: out + (s.to - s.from) / s.factor, factor: s.factor });
    out += (s.to - s.from) / s.factor; src = s.to;
  }
  const toOutput = (t) => {
    let o = 0, s = 0;
    for (const b of bounds) {
      if (t <= b.from) return o + (t - s);
      o += b.from - s; s = b.from;
      if (t <= b.to) return o + (t - s) / b.factor;
      o += (b.to - b.from) / b.factor; s = b.to;
    }
    return o + (t - s);
  };
  const toSource = (T) => {
    let o = 0, s = 0;
    for (const b of bounds) {
      if (T <= o + (b.from - s)) return s + (T - o);
      o += b.from - s; s = b.from;
      if (T <= b.outTo) return s + (T - o) * b.factor;
      o = b.outTo; s = b.to;
    }
    return s + (T - o);
  };
  const outputDurationMs = Number.isFinite(durationMs) ? toOutput(durationMs) : Infinity;
  return { segments: bounds, toOutput, toSource, outputDurationMs, identity: bounds.length === 0 };
}
