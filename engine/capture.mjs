// Takes: the action log shared by dry runs and recordings, and the screencast recorder.
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** A dry take logs actions and marks but captures nothing. */
/** Thrown by a dry run when it reaches the mark it was asked to stop at (inspect --at). */
export class StopAtMark extends Error {
  constructor(mark) { super(`stopped at mark "${mark}"`); this.name = "StopAtMark"; this.mark = mark; }
}

export class DryTake {
  constructor({ clip, config, page = null, rehearsalDir = null, stopAt = null }) {
    this.clip = clip;
    this.stopAt = stopAt;     // mark name at which a dry run stops so the page can be inspected in that state
    this.config = config;
    this.page = page;
    this.rehearsalDir = rehearsalDir;
    this.beatShots = {};      // mark name → 1× PNG taken while rehearsing (framing sheet)
    this.t0 = null;
    this.actions = [];
    this.marks = [];
    this.trims = [];
    this.camera = [];
    this.warnings = [];
    this.poster = { mode: clip.poster ?? "end", pending: false, taken: false, at: null };
    this._trimOpen = null;
    this.shots = [];          // explicit camera shots (h.shot / zoomTo / zoomOut)
    this.speeds = [];         // h.speed ranges in take time
    this.tracks = {};         // name → [[t, x, y, w, h]]
    this.markShots = {};      // mark name → png file (lossless screenshot at the next hold)
    this.pendingMarks = [];
    this.stage = null;
  }
  get recording() { return false; }
  start() { this.t0 = Date.now(); }
  t() { return this.t0 == null ? 0 : Date.now() - this.t0; }
  log(entry) { this.actions.push({ t: this.t(), ...entry }); }
  mark(name, { box, boxesNow } = {}) {
    this.marks.push({ name, t: this.t(), ...(box ? { box } : {}), ...(boxesNow ? { boxesNow } : {}), seq: this.markSeq() });
    if (this.stopAt && name === this.stopAt) throw new StopAtMark(name);
    if (name === this.poster.mode && !this.poster.taken) this.poster.pending = true;
    this.pendingMarks.push(name);
  }
  /** Rehearsal only: a 1× screenshot of the viewport at a beat, for the framing sheet. */
  async beatShot(name) {
    if (!this.rehearsalDir || !this.page || this.recording) return;
    const file = `beat-${name.replace(/[^\w.-]+/g, "_")}.png`;
    const png = await this.page.screenshot({ type: "png", animations: "allow", caret: "hide", scale: "css" });
    mkdirSync(this.rehearsalDir, { recursive: true });
    writeFileSync(path.join(this.rehearsalDir, file), png);
    this.beatShots[name] = file;
  }
  shot(entry) { this.shots.push({ t: this.t(), ...entry, seq: this._seq = (this._seq || 0) + 1 }); }
  holdEvent(ms) { (this.holds ||= []).push({ t: this.t(), ms, seq: this._seq = (this._seq || 0) + 1 }); }
  markSeq() { return (this._seq = (this._seq || 0) + 1); }
  speedStart() { return this.t(); }
  speedEnd(from, factor) { this.speeds.push({ from, to: this.t(), factor }); }
  trackSample(name, box) { (this.tracks[name] ||= []).push([this.t(), box.x, box.y, box.w, box.h]); }
  /** Screenshots for every mark reached since the last hold (sub-clip posters); no-op for a dry take. */
  async takeMarkShots() { this.pendingMarks = []; return 0; }
  /** Record where a crop's focus element is at a given moment (last visible measurement wins at export). */
  focus(crop, box, at) { (this.focusBoxes ||= []).push({ crop, at, t: this.t(), box }); }
  trimStart() { this._trimOpen = this.t(); }
  trimEnd() { if (this._trimOpen != null) { this.trims.push([this._trimOpen, this.t()]); this._trimOpen = null; } }
  cameraKey(entry) { this.camera.push({ t: this.t(), ...entry }); }
  warn(msg) { this.warnings.push(msg); }
  /** Should the poster be taken at the start of this hold? */
  posterDue() {
    const p = this.poster;
    if (p.taken) return false;
    if (p.pending) return true;
    if (typeof p.mode === "number" && this.t() >= p.mode) return true;
    return false;
  }
  /** Returns wall-clock ms spent (0 for a dry take). */
  async takePoster(reason = "hold") {
    this.poster.taken = true; this.poster.pending = false; this.poster.at = this.t(); this.poster.reason = reason;
    return 0;
  }
  async finish() { return { durationMs: this.t() }; }
  startTracking() {}
  stopTracking() {}
}

/** Pixel size from a JPEG buffer's SOF marker (the screencast metadata reports CSS pixels, not the bitmap). */
export function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** A recording take: screencast frames at 2×, a lossless poster, and take.json. */
export class RecordTake extends DryTake {
  /** `markShotNames`: the marks a sub-clip uses as its poster; only those get a lossless mark screenshot (null = all). */
  constructor({ clip, config, page, takeDir, markShotNames = null }) {
    super({ clip, config });
    this.page = page;
    this.takeDir = takeDir;
    this.markShotNames = markShotNames;
    this.frames = [];
    this._chain = Promise.resolve();
    this._error = null;
    this.tEnd = null;
    mkdirSync(takeDir, { recursive: true });
  }
  get recording() { return true; }

  async start() {
    const { width, height } = this.config.viewport;
    const dsf = this.config.deviceScaleFactor;
    await this.page.screencast.start({
      size: { width: Math.round(width * dsf), height: Math.round(height * dsf) },
      quality: this.config.quality?.jpeg ?? 92,
      onFrame: (frame) => this._onFrame(frame),
    });
    super.start();
  }

  _onFrame({ data, timestamp, viewportWidth, viewportHeight }) {
    let ts = typeof timestamp === "number" ? timestamp : Date.now();
    if (ts < 1e11) ts *= 1000;                      // seconds → ms, defensively
    const idx = this.frames.length;
    if (idx === 0) this.frameSize = jpegSize(data);
    const file = `f${String(idx).padStart(6, "0")}.jpg`;
    this.frames.push({ file, ts, w: viewportWidth, h: viewportHeight, bytes: data.length });
    const p = path.join(this.takeDir, file);
    this._chain = this._chain.then(() => writeFile(p, data)).catch((e) => { this._error = this._error || e; });
  }

  async takePoster(reason = "hold") {
    const started = Date.now();
    const png = await this.page.screenshot({ type: "png", animations: "allow", caret: "hide", scale: "device" });
    await writeFile(path.join(this.takeDir, "poster.png"), png);
    await super.takePoster(reason);
    this.poster.file = "poster.png";
    this.poster.wallMs = Date.now() - started;
    return this.poster.wallMs;
  }

  async takeMarkShots() {
    const names = this.pendingMarks; this.pendingMarks = [];
    let spent = 0;
    for (const name of names) {
      if (this.markShots[name]) continue;
      // A screenshot no sub-clip uses only stretches the hold (about 0.9 s at 2×), so skip it.
      if (this.markShotNames && !this.markShotNames.has(name)) continue;
      const started = Date.now();
      if (name === this.poster.mode && this.poster.file) { this.markShots[name] = this.poster.file; continue; }
      const png = await this.page.screenshot({ type: "png", animations: "allow", caret: "hide", scale: "device" });
      const file = `mark-${name.replace(/[^\w.-]+/g, "_")}.png`;
      await writeFile(path.join(this.takeDir, file), png);
      this.markShots[name] = file;
      spent += Date.now() - started;
    }
    return spent;
  }

  /** Sample tracked targets every frame (≈ fps) while recording. */
  startTracking(targets, fps = 30) {
    this._trackTargets = targets;
    this._trackTimer = setInterval(() => this._sampleTracks().catch(() => {}), Math.round(1000 / fps));
  }
  async _sampleTracks() {
    if (this._sampling) return; this._sampling = true;
    try {
      // all tracks in one round trip's worth of time, so the sample rate is set by the slowest read, not their sum
      const entries = Object.entries(this._trackTargets || {});
      const boxes = await Promise.all(entries.map(([, loc]) => loc.first().boundingBox({ timeout: 100 }).catch(() => null)));
      const t = this.t();
      entries.forEach(([name], i) => { const b = boxes[i]; if (b && b.width > 0 && b.height > 0) (this.tracks[name] ||= []).push([t, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]); });
    } finally { this._sampling = false; }
  }
  stopTracking() { if (this._trackTimer) clearInterval(this._trackTimer); this._trackTimer = null; }

  async finish({ posterAtEnd = false } = {}) {
    this.stopTracking();
    this.tEnd = Date.now();
    if (posterAtEnd) await this.takePoster("end");
    if (this.pendingMarks.length) await this.takeMarkShots();
    await this.page.screencast.stop();
    await this._chain;
    if (this._error) throw this._error;
    const take = {
      clipId: this.clip.id,
      recordedAt: new Date(this.t0).toISOString(),
      viewport: this.config.viewport,
      deviceScaleFactor: this.config.deviceScaleFactor,
      fps: this.config.fps,
      t0: this.t0,
      tEnd: this.tEnd,
      durationMs: this.tEnd - this.t0,
      frameSize: this.frameSize || null,
      cssSize: this.frames.length ? { width: this.frames[0].w, height: this.frames[0].h } : null,
      frames: this.frames.map(({ file, ts }) => ({ file, ts })),
      actions: this.actions,
      marks: this.marks,
      trims: this.trims,
      camera: this.camera,
      shots: this.shots,
      speeds: this.speeds,
      tracks: this.tracks,
      markShots: this.markShots,
      stage: this.stage,
      focusBoxes: this.focusBoxes || [],
      poster: this.poster,
      warnings: this.warnings,
    };
    writeFileSync(path.join(this.takeDir, "take.json"), JSON.stringify(take, null, 2));
    return take;
  }
}
