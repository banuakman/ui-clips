// Camera (§10.3, appendix D). Everything here is in stage coordinates (CSS px) and output time (ms).
// Two directors: auto (clusters/dwells → spring) and explicit (shots keyed to marks → eased moves). Explicit wins in
// its window. Every track is computed for one output aspect, so each output size gets its own render.

export const FEEL = Object.freeze({
  brisk: { stiffness: 120, damping: 22 },
  calm: { stiffness: 65, damping: 16 },
  lazy: { stiffness: 40, damping: 12.6 },
});

export const CAMERA = Object.freeze({
  maxScale: { gentle: 1.6, pronounced: 2.2 },
  clusterWindowMs: 3000, dwellMs: 1500, releaseMs: 1000, minShotMs: 1200, leadMs: 300,
  padding: 0.15, minPadPx: 24,
  reaimFraction: 0.25,     // an action further outside the shot than this × shot width starts a new shot
  capFraction: 0.65,       // a box wider than this × stage width goes wide
  restMarginMs: { brisk: 1200, calm: 1800, lazy: 2600 },   // time the spring needs to settle to the pixel before the end
  snapScale: 0.004, snapPx: 1.5,                            // within this of wide, the camera snaps to rest
  explicitMinHoldMs: 600, explicitDefaultMoveMs: 600, explicitPadding: 24,
});

const TARGET_KINDS = new Set(["click", "hover", "type", "press", "select", "scroll"]);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function union(a, b) {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
/** The visible part of a box, or null when it lies entirely outside the stage. */
export function clipToStage(box, stage) {
  if (!box) return null;
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(stage.w, box.x + box.w), y1 = Math.min(stage.h, box.y + box.h);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function padBox(box, stage, { padding = CAMERA.padding, minPadPx = CAMERA.minPadPx, absolute } = {}) {
  const px = absolute ?? Math.max(minPadPx, box.w * padding), py = absolute ?? Math.max(minPadPx, box.h * padding);
  const x = Math.max(0, box.x - px), y = Math.max(0, box.y - py);
  return { x, y, w: Math.min(stage.w, box.x + box.w + px) - x, h: Math.min(stage.h, box.y + box.h + py) - y };
}

/**
 * Geometry for one output size: aspect (w/h), the wide frame (stage fitted to the output width, top-aligned) and the
 * floor on window width (never narrower than half the output width in CSS px, i.e. never upscaled from the 2× source).
 */
export function frameGeometry(stage, { aspect, outWidthPx, deviceScaleFactor = 2 }) {
  const wide = { x: 0, y: 0, w: stage.w, h: stage.w / aspect };
  const floorW = outWidthPx / deviceScaleFactor;
  const canvasH = Math.max(stage.h, wide.h);
  return { aspect, wide, floorW, canvasH, padBelow: Math.max(0, wide.h - stage.h) };
}

/** Smallest frame of the output aspect containing a box, honouring the floor, kept inside the stage/canvas. */
export function frameAround(box, geo, stage, { align = "center" } = {}) {
  let w = Math.max(box.w, box.h * geo.aspect, geo.floorW);
  w = Math.min(w, geo.wide.w);
  const h = w / geo.aspect;
  const cx = box.x + box.w / 2;
  let x = clamp(cx - w / 2, 0, Math.max(0, stage.w - w));
  let y = align === "top" || box.h > h ? box.y : box.y + box.h / 2 - h / 2;
  // A focus frame stays inside the stage whenever it fits, so no fill shows below it; only a frame taller than the
  // stage (or the contain wide) reaches into the fill, top-aligned.
  y = h <= stage.h ? clamp(y, 0, stage.h - h) : 0;
  return { x, y, w, h };
}
const windowScale = (win, geo) => geo.wide.w / win.w;

/**
 * Wide shots (§10.3). "contain": the whole stage fitted to the output width, top-aligned, fill below (the opening
 * framing). "cover": the output frame filled at full stage height, sides cropped, anchored left | right | center or
 * on a target box. A stage narrower than the cover frame falls back to full width, top-aligned.
 */
export function wideWindow(geo, stage, { mode = "contain", anchor = "center", anchorBox = null } = {}) {
  if (mode !== "cover") return { ...geo.wide };
  let w = Math.min(stage.w, stage.h * geo.aspect);
  w = Math.max(w, Math.min(geo.floorW, stage.w));
  const h = w / geo.aspect;
  let x;
  if (anchorBox) x = anchorBox.x + anchorBox.w / 2 - w / 2;
  else if (anchor === "left") x = 0;
  else if (anchor === "right") x = stage.w - w;
  else x = (stage.w - w) / 2;
  x = clamp(x, 0, Math.max(0, stage.w - w));
  return { x, y: 0, w, h };
}

/* ----------------------------------------------------------------------------------------------------------------- */
/* Auto                                                                                                                 */

function boxOfAction(a) { return a.w > 0 && a.h > 0 ? { x: a.x, y: a.y, w: a.w, h: a.h } : { x: a.x - 8, y: a.y - 8, w: 16, h: 16 }; }

/** Clusters from the action log with the re-aim and cap rules. Shots: { startMs, endMs, targets:[{t, box}], wide? } */
export function detectShots(actions, { mode, stage, durationMs, geo, feel = "calm" }) {
  const maxScale = CAMERA.maxScale[mode] ?? 0;
  const warnings = [];
  if (!(maxScale > 1)) return { shots: [], warnings };
  const acts = actions.filter((a) => TARGET_KINDS.has(a.kind)).map((a) => ({ ...a, box: clipToStage(boxOfAction(a), stage) || boxOfAction(a) })).sort((a, b) => a.t - b.t);
  const clusters = [];
  for (const a of acts) {
    const last = clusters[clusters.length - 1];
    if (last && a.t - last.acts[last.acts.length - 1].t <= CAMERA.clusterWindowMs) {
      // re-aim: outside the current shot by more than a quarter of its width → new shot
      const shot = padBox(last.box, stage);
      const cx = a.box.x + a.box.w / 2, cy = a.box.y + a.box.h / 2;
      const tol = shot.w * CAMERA.reaimFraction;
      const outside = cx < shot.x - tol || cx > shot.x + shot.w + tol || cy < shot.y - tol || cy > shot.y + shot.h + tol;
      if (!outside) { last.acts.push(a); last.box = union(last.box, a.box); continue; }
    }
    clusters.push({ acts: [a], box: { ...a.box } });
  }
  const shots = [];
  clusters.forEach((c, i) => {
    const next = clusters[i + 1]?.acts[0]?.t ?? durationMs;
    const a0 = c.acts[0];
    const dwell = c.acts.length === 1 && ((a0.kind === "hover" && (a0.holdMs ?? 0) >= CAMERA.dwellMs) || next - a0.t >= CAMERA.dwellMs);
    if (c.acts.length < 2 && !dwell) return;
    let acc = null;
    const targets = c.acts.map((a) => { acc = union(acc, a.box); return { t: a.t, box: padBox(acc, stage) }; });
    const last = targets[targets.length - 1].box;
    const wide = last.w > stage.w * CAMERA.capFraction;          // cap: nearly everything → stay wide
    shots.push({ startMs: Math.max(0, a0.t - CAMERA.leadMs), endMs: c.acts[c.acts.length - 1].t + CAMERA.releaseMs, targets, wide, maxScale });
  });
  for (const s of shots) if (s.endMs - s.startMs < CAMERA.minShotMs) s.endMs = s.startMs + CAMERA.minShotMs;
  // Two close shots merge only when they frame the same place; a re-aimed shot stays separate so the camera moves.
  const near = (a, b) => { const tol = a.w * CAMERA.reaimFraction; const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= a.x - tol && cx <= a.x + a.w + tol && cy >= a.y - tol && cy <= a.y + a.h + tol; };
  const merged = [];
  for (const s of shots) {
    const prev = merged[merged.length - 1];
    const prevBox = prev?.targets[prev.targets.length - 1].box, firstBox = s.targets[0].box;
    if (prev && s.startMs - prev.endMs < CAMERA.releaseMs && !prev.wide && !s.wide && near(prevBox, firstBox)) { prev.endMs = Math.max(prev.endMs, s.endMs); prev.targets.push(...s.targets); }
    else merged.push(s);
  }
  const restBy = durationMs - (CAMERA.restMarginMs[feel] ?? CAMERA.restMarginMs.calm);
  const kept = [];
  for (const s of merged) {
    if (s.wide) continue;
    if (s.endMs > restBy) {
      if (s.startMs >= restBy - CAMERA.minShotMs) { warnings.push(`camera: a shot at ${s.startMs} ms was dropped so the clip ends at rest`); continue; }
      s.endMs = restBy; warnings.push(`camera: a shot was released early at ${restBy} ms so the clip ends at rest`);
    }
    kept.push(s);
  }
  return { shots: kept, warnings };
}

/** Auto target window at output time T. */
function autoTargetAt(shots, T, geo, stage) {
  for (const s of shots) {
    if (T < s.startMs || T >= s.endMs) continue;
    let tg = s.targets[0];
    for (const x of s.targets) if (x.t <= T + CAMERA.leadMs) tg = x;
    const win = frameAround(tg.box, geo, stage);
    const minW = geo.wide.w / s.maxScale;
    if (win.w < minW) { const cx = win.x + win.w / 2, cy = win.y + win.h / 2; win.w = minW; win.h = minW / geo.aspect; win.x = clamp(cx - win.w / 2, 0, stage.w - win.w); win.y = clamp(cy - win.h / 2, 0, Math.max(0, geo.canvasH - win.h)); }
    return win;
  }
  return geo.wide;
}

/* ----------------------------------------------------------------------------------------------------------------- */
/* Explicit                                                                                                             */

/**
 * Explicit shots from the take: [{ t, kind: "wide"|"focus", targets: [{box}|{track}], padding, ms }] in output time.
 * tracks: { name: [[t, x, y, w, h], ...] } in output time and stage coords. Returns { windowAt(T), shots, warnings }.
 */
export function buildExplicit(shotsIn, { tracks = {}, stage, geo, actions = [] }) {
  const warnings = [];
  const shots = [...shotsIn].sort((a, b) => a.t - b.t).map((s) => ({ ...s, ms: s.ms ?? CAMERA.explicitDefaultMoveMs, padding: s.padding ?? CAMERA.explicitPadding }));
  // A first shot logged within the first frame of the take is the opening framing from t = 0.
  if (shots.length && shots[0].t <= 40) { shots[0].t = 0; shots[0].ms = 0; }   // the opening is a framing, not a move
  // Only the opening shot may be wide("contain"); a later "wide" defaults to cover; "opening" returns to the first framing.
  shots.forEach((s, i) => {
    if (s.kind !== "wide") return;
    if (i === 0) { s.mode = s.mode || "contain"; return; }
    if (s.mode === "contain") { warnings.push(`camera: shot ${i + 1} asks for wide("contain") after the opening; treated as a return to the opening framing`); s.kind = "opening"; delete s.mode; delete s.anchor; return; }
    s.mode = "cover";
    s.anchor = s.anchor || "center";
  });
  for (let i = 1; i < shots.length; i++) {
    const minT = shots[i - 1].t + shots[i - 1].ms + CAMERA.explicitMinHoldMs;
    if (shots[i].t < minT) { warnings.push(`camera: shot ${i + 1} at ${Math.round(shots[i].t)} ms moved to ${Math.round(minT)} ms so the previous shot holds ${CAMERA.explicitMinHoldMs} ms`); shots[i].t = minT; }
  }
  for (const s of shots) for (const a of actions) if (a.kind === "click" && a.t > s.t && a.t < s.t + s.ms) { warnings.push(`camera: a click at ${a.t} ms lands during the move starting at ${Math.round(s.t)} ms`); break; }
  const trackBox = (name, T) => trackBoxAt(tracks[name], T);
  let openingWindow = null;
  const targetWindow = (s, T) => {
    if (s.kind === "opening") return openingWindow ? { ...openingWindow } : { ...geo.wide };
    if (s.kind === "wide") {
      const anchorBox = s.anchorTrack ? trackBox(s.anchorTrack, T) : s.anchorBox || null;
      return wideWindow(geo, stage, { mode: s.mode, anchor: s.anchor, anchorBox });
    }
    // Targets only count where they can be seen: boxes are clipped to the stage and skipped while fully outside it
    // (a drawer section below the fold joins the frame as it scrolls in).
    let u = null, missing = [];
    for (const tg of s.targets || []) {
      const b = clipToStage(tg.track ? trackBox(tg.track, T) : tg.box, stage);
      if (b) u = union(u, b); else missing.push(tg.track || "?");
    }
    if (!u) return { ...geo.wide };
    const padded = padBox(u, stage, { absolute: s.padding });
    return frameAround(padded, geo, stage);
  };
  if (shots.length) openingWindow = targetWindow(shots[0], shots[0].t);
  const windowAt = (T, stateAtStart) => {
    let cur = null;
    for (const s of shots) if (s.t <= T) cur = s; else break;
    if (!cur) return null;
    const target = targetWindow(cur, T);
    const u = cur.ms > 0 ? (T - cur.t) / cur.ms : 1;
    if (u >= 1) return target;
    const from = cur._from || stateAtStart?.(cur) || { ...geo.wide };
    cur._from = from;
    const e = easeInOutCubic(clamp(u, 0, 1));
    return { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
  };
  return { windowAt, shots, warnings, firstT: shots.length ? shots[0].t : Infinity, opening: openingWindow };
}

/** A tracked box at time T, interpolated between the samples around T so a follow is a ramp, not a staircase. */
export function trackBoxAt(samples, T) {
  if (!samples || !samples.length) return null;
  let i = 0;
  while (i + 1 < samples.length && samples[i + 1][0] <= T) i++;
  const a = samples[i], b = samples[i + 1];
  if (!b || T <= a[0]) return { x: a[1], y: a[2], w: a[3], h: a[4] };
  const u = Math.min(1, (T - a[0]) / Math.max(1, b[0] - a[0]));
  return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u, w: a[3] + (b[3] - a[3]) * u, h: a[4] + (b[4] - a[4]) * u };
}

/** The window a moment is really about: when T falls inside an explicit move, the window where that move settles. */
export function settledWindowAt(frames, explicitShots, T) {
  let cur = null;
  for (const s of explicitShots || []) { const t0 = s.startMs ?? s.t; if (t0 <= T) cur = { t: t0, ms: s.moveMs ?? s.ms ?? 0 }; else break; }
  const T2 = cur && T < cur.t + cur.ms ? cur.t + cur.ms : T;
  return windowAt(frames, Math.min(T2, frames[frames.length - 1].t));
}

/* ----------------------------------------------------------------------------------------------------------------- */
/* Track = per-frame windows                                                                                            */

/**
 * @returns {{frames:[{t,x,y,w,h,scale}], shots, warnings, geo}}
 */
export function buildTrack({ actions = [], explicitShots = [], tracks = {}, stage, aspect, outWidthPx, deviceScaleFactor = 2, mode = "gentle", feel = "calm", durationMs, fps }) {
  const geo = frameGeometry(stage, { aspect, outWidthPx, deviceScaleFactor });
  const warnings = [];
  const explicit = buildExplicit(explicitShots, { tracks, stage, geo, actions });
  warnings.push(...explicit.warnings);
  const auto = detectShots(actions, { mode, stage, durationMs, geo, feel });
  // explicit overrides auto in its window: drop auto shots that start at or after the first explicit shot
  const autoShots = auto.shots.filter((s) => s.endMs <= explicit.firstT);
  if (auto.shots.length !== autoShots.length && explicit.firstT > 100) warnings.push(`camera: ${auto.shots.length - autoShots.length} auto shot(s) suppressed by the explicit track`);
  warnings.push(...auto.warnings.filter(() => !explicitShots.length));
  const { stiffness: k, damping: c } = FEEL[feel] || FEEL.calm;
  const n = Math.max(1, Math.round((durationMs * fps) / 1000));
  const dt = 1 / fps;
  const st = { cx: geo.wide.w / 2, cy: geo.wide.h / 2, ls: 0, vx: 0, vy: 0, vs: 0 };
  const frames = [];
  const stateWindow = () => { const s = Math.exp(st.ls); const w = geo.wide.w / s, h = w / geo.aspect; return { x: clamp(st.cx - w / 2, 0, Math.max(0, stage.w - w)), y: clamp(st.cy - h / 2, 0, Math.max(0, geo.canvasH - h)), w, h }; };
  for (let i = 0; i < n; i++) {
    const T = (i * 1000) / fps;
    let win = explicit.windowAt(T, () => stateWindow());
    if (win) {
      // explicit governs: set the spring state to the window so a later auto stretch continues from here
      st.cx = win.x + win.w / 2; st.cy = win.y + win.h / 2; st.ls = Math.log(geo.wide.w / win.w); st.vx = st.vy = st.vs = 0;
    } else {
      const tg = autoTargetAt(autoShots, T, geo, stage);
      const tcx = tg.x + tg.w / 2, tcy = tg.y + tg.h / 2, tls = Math.log(geo.wide.w / tg.w);
      st.vx += (k * (tcx - st.cx) - c * st.vx) * dt; st.cx += st.vx * dt;
      st.vy += (k * (tcy - st.cy) - c * st.vy) * dt; st.cy += st.vy * dt;
      st.vs += (k * (tls - st.ls) - c * st.vs) * dt; st.ls = Math.max(0, st.ls + st.vs * dt);
      // snap to rest: within a pixel of wide, land exactly on it (sub-pixel drift is invisible but breaks loop checks)
      if (tg === geo.wide && st.ls < CAMERA.snapScale && Math.abs(st.cx - geo.wide.w / 2) < CAMERA.snapPx && Math.abs(st.cy - geo.wide.h / 2) < CAMERA.snapPx) {
        st.ls = 0; st.cx = geo.wide.w / 2; st.cy = geo.wide.h / 2; st.vx = st.vy = st.vs = 0;
      }
      win = stateWindow();
    }
    frames.push({ t: T, x: win.x, y: win.y, w: win.w, h: win.h, scale: windowScale(win, geo) });
  }
  const shots = [
    ...autoShots.map((s) => ({ source: "auto", startMs: s.startMs, endMs: s.endMs })),
    ...explicit.shots.map((s) => ({ source: "explicit", startMs: s.t, kind: s.kind, mode: s.mode, anchor: s.anchor, moveMs: s.ms })),
  ];
  const opening = explicit.opening && explicit.firstT <= 1000 / fps ? explicit.opening : { ...geo.wide };
  return { frames, shots, warnings, geo, opening };
}

/** Rest = the opening framing (wide for auto tracks, the first explicit shot otherwise). */
export const atRest = (f, opening) => Math.abs(f.w - (opening.wide ? opening.wide.w : opening.w)) < 1 && Math.abs(f.x - (opening.wide ? 0 : opening.x)) < 1 && Math.abs(f.y - (opening.wide ? 0 : opening.y)) < 1;

/** ffmpeg sendcmd text for a `crop` filter on the stage canvas (device px, even values). */
export function sendcmdText(frames, { deviceScaleFactor: dsf, canvasW, canvasH }) {
  const W = Math.round(canvasW * dsf / 2) * 2, H = Math.round(canvasH * dsf / 2) * 2;
  const even = (v) => Math.round(v / 2) * 2;
  const lines = [];
  for (const f of frames) {
    const w = Math.min(W, Math.max(2, even(f.w * dsf))), h = Math.min(H, Math.max(2, even(f.h * dsf)));
    const x = Math.min(W - w, Math.max(0, even(f.x * dsf))), y = Math.min(H - h, Math.max(0, even(f.y * dsf)));
    lines.push(`${(f.t / 1000).toFixed(4)} crop w ${w}, crop h ${h}, crop x ${x}, crop y ${y};`);
  }
  return lines.join("\n") + "\n";
}

export function windowAt(frames, t) {
  let f = frames[0];
  for (const x of frames) { if (x.t <= t) f = x; else break; }
  return f;
}
