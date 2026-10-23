// Speed ramps (§10.2): stretches of the take play faster at export. Source time (ms in the take) ↔ output time.
// Trims (h.trim) cut windows of take time out first; buildTakeTimeMap composes both.

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

/** Trim windows clamped to [0, durationMs], sorted and merged where they overlap. */
export function normaliseTrims(trims = [], durationMs = Infinity) {
  const cuts = (trims || []).map(([a, b]) => [Math.max(0, a), Math.min(durationMs, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const c of cuts) { const last = out[out.length - 1]; if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]); else out.push([...c]); }
  return out;
}

/** Take time → trimmed time: a time inside a trim lands on its start, a time after it moves back by its length. */
export function trimMap(trims = []) {
  const cuts = normaliseTrims(trims);
  return (t) => { let cut = 0; for (const [a, b] of cuts) { if (t <= a) break; cut += Math.min(t, b) - a; } return t - cut; };
}

/**
 * Take time → output time for everything the take logs in take time (shots, tracks, marks, actions, poster, speed
 * ranges): trims first, then speed ramps. toSource maps output time back to trimmed time (the retimed frame timeline).
 * @param {{trims?:[number,number][], speeds?:{from:number,to:number,factor:number}[]}} take
 * @param {number} trimmedMs  the retimed (post-trim) duration
 */
export function buildTakeTimeMap({ trims = [], speeds = [] } = {}, trimmedMs = Infinity) {
  const cut = trimMap(trims);
  const tm = buildTimeMap((speeds || []).map((s) => ({ ...s, from: cut(s.from), to: cut(s.to) })), trimmedMs);
  const trimmedOut = normaliseTrims(trims).reduce((n, [a, b]) => n + b - a, 0);
  return { ...tm, toOutput: (t) => tm.toOutput(cut(t)), toTrimmed: cut, trimmedOutMs: trimmedOut, identity: tm.identity && trimmedOut === 0 };
}
