// Stage (§10.3): the part of the viewport that may appear in any frame. Excluded regions that span a full edge are cut
// away; interior ones are masked with the fill colour. Wide shots can extend below the stage into the fill.

/** @returns {{x,y,w,h, masks:[{x,y,w,h}], cuts:[{x,y,w,h}]}} stage rect in viewport CSS px */
export function stageRect(viewport, excludes = []) {
  let x0 = 0, y0 = 0, x1 = viewport.width, y1 = viewport.height;
  const masks = [], cuts = [];
  for (const b of excludes) {
    if (!b || !(b.w > 0 && b.h > 0)) continue;
    const spansH = b.h >= viewport.height * 0.9, spansW = b.w >= viewport.width * 0.9;
    if (spansH && b.x <= 2) { x0 = Math.max(x0, b.x + b.w); cuts.push(b); }
    else if (spansH && b.x + b.w >= viewport.width - 2) { x1 = Math.min(x1, b.x); cuts.push(b); }
    else if (spansW && b.y <= 2) { y0 = Math.max(y0, b.y + b.h); cuts.push(b); }
    else if (spansW && b.y + b.h >= viewport.height - 2) { y1 = Math.min(y1, b.y); cuts.push(b); }
    else masks.push(b);
  }
  const stage = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  // masks in stage coordinates, clipped
  stage.masks = masks.map((m) => ({ x: Math.max(0, m.x - stage.x), y: Math.max(0, m.y - stage.y), w: Math.min(m.w, stage.w), h: Math.min(m.h, stage.h), ...(m.track ? { track: m.track } : {}) })).filter((m) => m.w > 0 && m.h > 0);
  stage.cuts = cuts;
  return stage;
}

/** Shift a viewport-space box into stage space. */
export const toStage = (box, stage) => ({ x: box.x - stage.x, y: box.y - stage.y, w: box.w, h: box.h });

/**
 * ffmpeg filter that turns a 2× viewport frame into the stage canvas: crop to the stage, mask interior exclusions,
 * pad below with the fill so tall windows have something to show.
 */
export function stageFilter(stage, { dsf, fill = "#FFFFFF", padBelowCss = 0, maskCmdFile = null }) {
  const even = (v) => Math.round(v / 2) * 2;
  const parts = [`crop=${even(stage.w * dsf)}:${even(stage.h * dsf)}:${even(stage.x * dsf)}:${even(stage.y * dsf)}`];
  if (maskCmdFile) parts.push(`sendcmd=f=${maskCmdFile.replace(/([\\':,\[\]])/g, "\\$1")}`);
  stage.masks.forEach((m, i) => parts.push(`drawbox@m${i}=x=${Math.round(m.x * dsf)}:y=${Math.round(m.y * dsf)}:w=${Math.round(m.w * dsf)}:h=${Math.round(m.h * dsf)}:color=${fill}:t=fill`));
  if (padBelowCss > 0) parts.push(`pad=iw:ih+${even(padBelowCss * dsf)}:0:0:color=${fill}`);
  return parts.join(",");
}

/**
 * sendcmd text that moves the mask boxes per frame. samplesByMask: for mask i, [[tOut, x, y, w, h]...] in stage
 * coordinates (or null when static). Returns null when every mask is static.
 */
export function maskCmdText(stage, samplesByMask, { dsf, fps, durationMs }) {
  if (!samplesByMask.some(Boolean)) return null;
  const n = Math.max(1, Math.round((durationMs * fps) / 1000));
  const lines = [];
  for (let k = 0; k < n; k++) {
    const T = (k * 1000) / fps;
    const cmds = [];
    samplesByMask.forEach((samples, i) => {
      if (!samples || !samples.length) return;
      let s = samples[0];
      for (const x of samples) { if (x[0] <= T) s = x; else break; }
      cmds.push(`drawbox@m${i} x ${Math.round(s[1] * dsf)}, drawbox@m${i} y ${Math.round(s[2] * dsf)}, drawbox@m${i} w ${Math.round(s[3] * dsf)}, drawbox@m${i} h ${Math.round(s[4] * dsf)}`);
    });
    lines.push(`${(T / 1000).toFixed(4)} ${cmds.join(", ")};`);
  }
  return lines.join("\n") + "\n";
}
