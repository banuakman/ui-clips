// Auto-zoom camera (spec §10.3, appendix D): click clusters and dwells → shots → critically damped spring →
// per-frame crop windows rendered from the 2× source at export. Pure functions; rendering is in export.mjs.

export const CAMERA = Object.freeze({
  maxScale: { gentle: 1.6, pronounced: 2.2 },
  clusterWindowMs: 3000,   // actions closer than this belong to one cluster
  dwellMs: 1500,           // a single hover/hold at least this long is a shot on its own
  releaseMs: 1000,         // the camera lets go this long after a shot's last action
  minShotMs: 1200,         // no hunting between close clusters
  leadMs: 300,             // the camera starts moving slightly before the first action
  padding: 0.15,           // around the cluster's bounding box
  minPadPx: 24,
  stiffness: 120,
  damping: 22,
  restMarginMs: 1200,      // the camera must be back at 1× this long before the end
});

const TARGET_KINDS = new Set(["click", "hover", "type", "press", "select", "scroll"]);

function boxOfAction(a) {
  if (a.w > 0 && a.h > 0) return { x: a.x, y: a.y, w: a.w, h: a.h };
  return { x: a.x - 8, y: a.y - 8, w: 16, h: 16 };
}
function union(a, b) {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function padBox(box, vw, vh, { padding = CAMERA.padding, minPadPx = CAMERA.minPadPx } = {}) {
  const px = Math.max(minPadPx, box.w * padding), py = Math.max(minPadPx, box.h * padding);
  const x = Math.max(0, box.x - px), y = Math.max(0, box.y - py);
  return { x, y, w: Math.min(vw, box.x + box.w + px) - x, h: Math.min(vh, box.y + box.h + py) - y };
}

/** Scale that fits a box, capped by the mode and by the source resolution at the export width. */
export function scaleFor(box, { vw, vh, maxScale, sourceCap }) {
  const fit = Math.min(vw / box.w, vh / box.h);
  return Math.max(1, Math.min(fit, maxScale, sourceCap));
}

/**
 * Shots from the action log. Each shot: { startMs, endMs, targets: [{ t, box, scale }], source }.
 * `targets` lets the camera re-frame as a cluster grows (follow); the shot releases at endMs.
 */
export function detectShots(actions, { mode, viewport, durationMs, explicit = [], exportWidth, deviceScaleFactor = 2 }) {
  const vw = viewport.width, vh = viewport.height;
  const maxScale = CAMERA.maxScale[mode] ?? 0;
  const sourceCap = (deviceScaleFactor * vw) / (exportWidth || vw);
  const shots = [];
  const warnings = [];
  if (maxScale > 1) {
    const acts = actions.filter((a) => TARGET_KINDS.has(a.kind)).sort((a, b) => a.t - b.t);
    // cluster by gaps
    const clusters = [];
    for (const a of acts) {
      const last = clusters[clusters.length - 1];
      if (last && a.t - last[last.length - 1].t <= CAMERA.clusterWindowMs) last.push(a); else clusters.push([a]);
    }
    clusters.forEach((c, i) => {
      const next = clusters[i + 1]?.[0]?.t ?? durationMs;
      const dwell = c.length === 1 && (
        (c[0].kind === "hover" && (c[0].holdMs ?? 0) >= CAMERA.dwellMs) ||
        next - c[0].t >= CAMERA.dwellMs);
      if (c.length < 2 && !dwell) return;
      let acc = null;
      const targets = c.map((a) => {
        acc = union(acc, boxOfAction(a));
        const box = padBox(acc, vw, vh);
        return { t: a.t, box, scale: scaleFor(box, { vw, vh, maxScale, sourceCap }) };
      });
      shots.push({ startMs: Math.max(0, c[0].t - CAMERA.leadMs), endMs: c[c.length - 1].t + CAMERA.releaseMs, targets, source: "auto" });
    });
  }
  // explicit zoomTo/zoomOut keys override auto shots in their window
  const keys = [...explicit].sort((a, b) => a.t - b.t);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.kind !== "zoomTo") continue;
    const end = keys.slice(i + 1).find((x) => x.kind === "zoomOut" || x.kind === "zoomTo")?.t ?? durationMs;
    const box = padBox({ x: k.box.x, y: k.box.y, w: k.box.width ?? k.box.w, h: k.box.height ?? k.box.h }, vw, vh);
    const scale = Math.max(1, Math.min(k.scale ?? 1.6, sourceCap, scaleFor(box, { vw, vh, maxScale: Infinity, sourceCap })));
    const shot = { startMs: k.t, endMs: end, targets: [{ t: k.t, box, scale }], source: "explicit" };
    for (let j = shots.length - 1; j >= 0; j--) if (shots[j].source === "auto" && shots[j].startMs < shot.endMs && shots[j].endMs > shot.startMs) shots.splice(j, 1);
    shots.push(shot);
  }
  shots.sort((a, b) => a.startMs - b.startMs);
  // minimum shot length, merge shots that would make the camera hunt, rest before the end
  for (const s of shots) if (s.endMs - s.startMs < CAMERA.minShotMs) s.endMs = s.startMs + CAMERA.minShotMs;
  const merged = [];
  for (const s of shots) {
    const last = merged[merged.length - 1];
    if (last && s.startMs - last.endMs < CAMERA.releaseMs && last.source === s.source) { last.endMs = Math.max(last.endMs, s.endMs); last.targets.push(...s.targets); }
    else merged.push(s);
  }
  const restBy = durationMs - CAMERA.restMarginMs;
  for (const s of merged) {
    if (s.endMs > restBy) {
      if (s.startMs >= restBy - CAMERA.minShotMs) { s.drop = true; warnings.push(`camera: a shot at ${s.startMs} ms was dropped so the clip ends at rest`); }
      else { s.endMs = restBy; warnings.push(`camera: a shot was released early at ${restBy} ms so the clip ends at rest`); }
    }
  }
  return { shots: merged.filter((s) => !s.drop), warnings };
}

/** Target (centre + scale) at time t, given the shots; rest is the full frame at 1×. */
export function targetAt(shots, t, vw, vh) {
  for (const s of shots) {
    if (t < s.startMs || t >= s.endMs) continue;
    let tg = s.targets[0];
    for (const x of s.targets) if (x.t <= t + CAMERA.leadMs) tg = x;
    return { cx: tg.box.x + tg.box.w / 2, cy: tg.box.y + tg.box.h / 2, scale: tg.scale };
  }
  return { cx: vw / 2, cy: vh / 2, scale: 1 };
}

/**
 * Simulate the spring at the clip's frame rate. Returns per-frame windows in CSS px:
 * [{ t, x, y, w, h, scale }], always inside the viewport, scale ≥ 1.
 */
export function simulateCamera(shots, { viewport, durationMs, fps }) {
  const vw = viewport.width, vh = viewport.height;
  const n = Math.max(1, Math.round((durationMs * fps) / 1000));
  const dt = 1 / fps;
  const k = CAMERA.stiffness, c = CAMERA.damping;
  const st = { cx: vw / 2, cy: vh / 2, s: 1, vx: 0, vy: 0, vs: 0 };
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = (i * 1000) / fps;
    const tg = targetAt(shots, t, vw, vh);
    // critically damped spring, semi-implicit Euler; scale springs in log space so zoom in/out feel alike
    const ls = Math.log(st.s), lt = Math.log(tg.scale);
    st.vx += (k * (tg.cx - st.cx) - c * st.vx) * dt; st.cx += st.vx * dt;
    st.vy += (k * (tg.cy - st.cy) - c * st.vy) * dt; st.cy += st.vy * dt;
    st.vs += (k * (lt - ls) - c * st.vs) * dt; st.s = Math.exp(ls + st.vs * dt);
    const s = Math.max(1, st.s);
    const w = vw / s, h = vh / s;
    const x = Math.min(Math.max(0, st.cx - w / 2), vw - w), y = Math.min(Math.max(0, st.cy - h / 2), vh - h);
    frames.push({ t, x, y, w, h, scale: s });
  }
  return frames;
}

/** True when the camera is effectively at 1× (rest). */
export const atRest = (f) => f.scale < 1.002;

/** ffmpeg sendcmd text driving a `crop` filter on the 2× source; windows snapped to even device pixels. */
export function sendcmdText(frames, { deviceScaleFactor: dsf, viewport, fps }) {
  const W = Math.round(viewport.width * dsf), H = Math.round(viewport.height * dsf);
  const even = (v) => Math.round(v / 2) * 2;
  const lines = [];
  for (const f of frames) {
    let w = Math.min(W, Math.max(2, even(f.w * dsf))), h = Math.min(H, Math.max(2, even(f.h * dsf)));
    let x = Math.min(W - w, Math.max(0, even(f.x * dsf))), y = Math.min(H - h, Math.max(0, even(f.y * dsf)));
    lines.push(`${(f.t / 1000).toFixed(4)} crop w ${w}, crop h ${h}, crop x ${x}, crop y ${y};`);
  }
  return lines.join("\n") + "\n";
}

/** The window the camera shows at time t (for posters and crop focus), from the simulated frames. */
export function windowAt(frames, t) {
  let f = frames[0];
  for (const x of frames) { if (x.t <= t) f = x; else break; }
  return f;
}
