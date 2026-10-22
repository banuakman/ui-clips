// Takes: the action log shared by dry runs and recordings, and the screencast recorder.
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** A dry take logs actions and marks but captures nothing. */
export class DryTake {
  constructor({ clip, config }) {
    this.clip = clip;
    this.config = config;
    this.t0 = null;
    this.actions = [];
    this.marks = [];
    this.trims = [];
    this.camera = [];
    this.warnings = [];
    this.poster = { mode: clip.poster ?? "end", pending: false, taken: false, at: null };
    this._trimOpen = null;
  }
  get recording() { return false; }
  start() { this.t0 = Date.now(); }
  t() { return this.t0 == null ? 0 : Date.now() - this.t0; }
  log(entry) { this.actions.push({ t: this.t(), ...entry }); }
  mark(name, { box } = {}) {
    this.marks.push({ name, t: this.t(), ...(box ? { box } : {}) });
    if (name === this.poster.mode && !this.poster.taken) this.poster.pending = true;
  }
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
  constructor({ clip, config, page, takeDir }) {
    super({ clip, config });
    this.page = page;
    this.takeDir = takeDir;
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

  async finish({ posterAtEnd = false } = {}) {
    this.tEnd = Date.now();
    if (posterAtEnd) await this.takePoster("end");
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
      focusBoxes: this.focusBoxes || [],
      poster: this.poster,
      warnings: this.warnings,
    };
    writeFileSync(path.join(this.takeDir, "take.json"), JSON.stringify(take, null, 2));
    return take;
  }
}
