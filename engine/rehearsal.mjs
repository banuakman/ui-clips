// Rehearsal report (§6.2 / §13 before recording): per beat, which camera targets are absent or off-screen, whether the
// planned window fits the aspect, which clicks fall outside the planned frame, and whether the opening and closing
// framings match. Built from what the dry run measured at each shot; no frames are needed.
import { stageRect, toStage } from "./stage.mjs";
import { frameGeometry, plannedWindow, clipToStage, edgeBox, focusFrame } from "./camera.mjs";
import { normaliseSizes } from "./export.mjs";

export function buildRehearsal({ config, clip, take }) {
  const viewport = config.viewport;
  const stage = stageRect(viewport, take.stage?.exclude || []);
  const dsf = config.deviceScaleFactor;
  const sizes = normaliseSizes(config, clip, stage).filter((s) => s.mode === "camera");
  const tgStage = (tg) => (tg && tg.box ? { ...tg, box: toStage(tg.box, stage) } : tg);
  const shots = (take.shots || []).map((s, i) => ({
    ...s, index: i + 1, seq: s.seq ?? i + 1,
    anchor: s.kind === "focus" ? tgStage(s.anchor) : s.anchor,
    extras: (s.extras || []).map(tgStage),
    anchorBox: s.anchorBox ? toStage(s.anchorBox, stage) : undefined,
    boxes: Object.fromEntries(Object.entries(s.boxesNow || {}).map(([k, b]) => [k, b ? toStage(b, stage) : null])),
  }));
  const problems = [];
  const notes = [];
  const perSize = {};
  for (const sz of sizes) {
    const geo = frameGeometry(stage, { aspect: sz.aspect, outWidthPx: sz.outW, deviceScaleFactor: dsf });
    let opening = null;
    const windows = [];
    shots.forEach((s, i) => {
      const spec = i === 0 && s.kind === "wide" ? { ...s, mode: s.mode || "contain" } : s.kind === "wide" ? { ...s, mode: s.mode || "cover" } : s;
      const { window, problems: ps } = plannedWindow(spec, s.boxes || {}, { geo, stage, opening });
      if (i === 0) opening = window;
      windows.push({ shot: s.index, t: s.t, kind: s.kind, window });
      // off-screen anchors hug the edge and follow in, and extras that do not exist yet join when they appear: notes, not failures
      for (const p of ps) ((/is off-screen/.test(p) || /^extra .* is absent/.test(p)) ? notes : problems).push({ size: sz.name, shot: s.index, t: s.t, kind: s.kind, problem: p });
    });
    // clicks against the shot active at that moment
    for (const a of take.actions || []) {
      if (a.kind !== "click") continue;
      let cur = null;
      for (const w of windows) if (w.t <= a.t) cur = w; else break;
      if (!cur || !cur.window) continue;
      const b = toStage(a, stage);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, f = cur.window;
      if (!(cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + Math.min(f.h, stage.h - f.y))) {
        problems.push({ size: sz.name, shot: cur.shot, t: a.t, kind: "click", problem: `click on ${(a.locator || "").slice(0, 40)} at ${a.t} ms lands outside the planned frame of shot ${cur.shot}` });
      }
    }
    // opening and closing framings
    const last = windows[windows.length - 1];
    if (windows.length > 1 && opening && last.window) {
      const same = Math.abs(last.window.w - opening.w) < 1 && Math.abs(last.window.x - opening.x) < 1 && Math.abs(last.window.y - opening.y) < 1;
      if (!same) problems.push({ size: sz.name, shot: last.shot, t: last.t, kind: last.kind, problem: `the closing framing (shot ${last.shot}, ${last.kind}) does not match the opening; end with h.shot("opening")` });
    }
    perSize[sz.name] = { outW: sz.outW, outH: sz.outH, windows, opening };
  }
  // beats: the shot active at each mark
  // beats: a beat shows the shot issued right after its mark (before any hold); otherwise the last shot before it.
  const marks = take.marks || [];
  const holdSeqs = (take.holds || []).map((h) => h.seq);
  const beats = marks.map((m) => {
    const entry = { name: m.name, t: m.t, screenshot: take.beatShots?.[m.name] || null, windows: {} };
    const nextHold = holdSeqs.find((q) => q > m.seq) ?? Infinity;
    let chosen = null;
    for (const s of shots) { if (s.seq > m.seq && s.seq < nextHold) { chosen = s.index; break; } }
    if (chosen == null) for (const s of shots) if (s.seq < m.seq) chosen = s.index;
    const shot = chosen != null ? shots[chosen - 1] : null;
    for (const [name, info] of Object.entries(perSize)) {
      const w = chosen != null ? info.windows.find((x) => x.shot === chosen) : null;
      let window = w?.window || null;
      // follow: a focus window moves with its anchor between the shot and this beat (edge-hugging when it started off-stage)
      if (window && shot && shot.kind === "focus" && shot.anchor?.track && m.boxesNow) {
        const geo = frameGeometry(stage, { aspect: sizes.find((z) => z.name === name).aspect, outWidthPx: info.outW, deviceScaleFactor: dsf });
        const atMark = m.boxesNow[shot.anchor.track] ? clipToStage(toStage(m.boxesNow[shot.anchor.track], stage), stage) : null;
        if (atMark) {
          const extras = (shot.extras || []).map((e) => e.track && m.boxesNow[e.track] ? clipToStage(toStage(m.boxesNow[e.track], stage), stage) : null).filter(Boolean);
          window = focusFrame(atMark, extras, { padding: shot.padding, align: shot.align, minSize: { w: window.w, h: window.h } }, geo, stage);
        }
      }
      entry.windows[name] = w ? { shot: w.shot, kind: w.kind, window } : null;
    }
    return entry;
  });
  return { clipId: clip.id, stage: { x: stage.x, y: stage.y, w: stage.w, h: stage.h }, viewport, sizes: perSize, shots: shots.map((s) => ({ index: s.index, t: s.t, kind: s.kind, mode: s.mode, anchor: s.anchor?.track || s.anchor?.locator || s.anchor, extras: (s.extras || []).map((e) => e.track || e.locator) })), beats, problems, notes, ok: problems.length === 0 };
}

export function formatRehearsal(r) {
  const lines = [];
  for (const b of r.beats) {
    const w = Object.entries(b.windows).map(([k, v]) => v ? `${k}: shot ${v.shot} ${v.kind}${v.window ? ` ${Math.round(v.window.w)}×${Math.round(v.window.h)}@${Math.round(v.window.x)},${Math.round(v.window.y)}` : " (no window)"}` : `${k}: no shot yet`).join(" · ");
    lines.push(`  beat ${b.name.padEnd(14)} ${String(Math.round(b.t)).padStart(6)} ms  ${w}`);
  }
  for (const n of r.notes || []) if (n.size === Object.keys(r.sizes)[0] || Object.keys(r.sizes).length === 1) lines.push(`  · shot ${n.shot} (${n.kind}, ${Math.round(n.t)} ms): ${n.problem}${/off-screen/.test(n.problem) ? "; the window waits at the edge and follows it in" : "; it widens the frame once it appears"}`);
  if (!r.problems.length) lines.push("  framing: no problems found");
  for (const p of r.problems) lines.push(`  ✗ [${p.size}] shot ${p.shot} (${p.kind}, ${Math.round(p.t)} ms): ${p.problem}`);
  return lines.join("\n");
}
