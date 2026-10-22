// Project configuration: defaults, clips.config.mjs loading, clip file loading.
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONFIG_FILE = "clips.config.mjs";

export const DEFAULTS = Object.freeze({
  baseUrl: "",
  password: undefined,
  serve: undefined,                      // directory of a static site to serve on localhost
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",                  // "light" | "dark" | "no-preference" (as the site is)
  fps: 30,
  cursor: { style: "arrow", color: "#1f2937", size: 22, ripple: true },
  zoom: { mode: "off" },                 // M2 flips the default to "gentle" when the camera lands
  outputs: ["mp4", "webm", "poster"],
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440, jpeg: 92 },
  crops: {},                             // named fixed-window crops: { width, height, scale, focus }
  hideSelectors: [],
  cssOverrides: "",
  waitForFonts: true,
  headless: true,
});

export const CLIP_DEFAULTS = Object.freeze({
  title: "",
  scenario: "",
  alt: "",
  start: "/",
  length: "natural",
  loop: "none",
  poster: "end",
  zoom: undefined,
  crops: {},
  freezeTime: null,               // ISO date or Date: fixes the page clock before navigation
  narration: null,
});

export class ConfigError extends Error {}

/** Resolve the project directory from --project or the current folder. */
export function resolveProjectDir(arg) {
  const dir = path.resolve(arg || process.cwd());
  if (!existsSync(path.join(dir, CONFIG_FILE))) {
    throw new ConfigError(`No ${CONFIG_FILE} in ${dir}. Pass --project <dir> or run from a clip project.`);
  }
  return dir;
}

/** Where the engine keeps machine-wide state (nothing in M1 needs it yet). */
export function dataDir() {
  return process.env.UI_CLIPS_HOME
    || process.env.CLAUDE_PLUGIN_DATA
    || path.join(homedir(), ".claude", "ui-clips");
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export async function loadConfig(projectDir) {
  const file = path.join(projectDir, CONFIG_FILE);
  const mod = await import(pathToFileURL(file).href);
  const user = mod.default || {};
  const config = merge(DEFAULTS, user);
  config.projectDir = projectDir;
  config.clipsDir = path.join(projectDir, "clips");
  config.outDir = path.join(projectDir, "out");
  config.cacheDir = path.join(projectDir, ".cache");
  if (config.serve) config.serve = path.resolve(projectDir, config.serve);
  if (!config.baseUrl && !config.serve) {
    throw new ConfigError(`${CONFIG_FILE} needs a baseUrl (or serve: "<dir>" for a local static site).`);
  }
  if (config.password === undefined && process.env.UI_CLIPS_PASSWORD) config.password = process.env.UI_CLIPS_PASSWORD;
  return config;
}

export function listClipFiles(config) {
  if (!existsSync(config.clipsDir)) return [];
  return readdirSync(config.clipsDir)
    .filter((f) => f.endsWith(".clip.mjs"))
    .sort()
    .map((f) => path.join(config.clipsDir, f));
}

export async function loadClip(file) {
  const mod = await import(pathToFileURL(file).href + `?t=${statSync(file).mtimeMs}`);
  const clip = { ...CLIP_DEFAULTS, ...(mod.default || {}) };
  clip.id = clip.id || path.basename(file).replace(/\.clip\.mjs$/, "");
  clip.file = file;
  if (typeof clip.steps !== "function") throw new ConfigError(`${file}: export default must have a steps({ page, h }) function.`);
  return clip;
}

/**
 * selector: undefined | "all" | "id" | "id1,id2" | ["id", ...]
 */
export async function loadClips(config, selector) {
  const files = listClipFiles(config);
  const all = await Promise.all(files.map(loadClip));
  if (!selector || selector === "all") return all;
  const wanted = Array.isArray(selector) ? selector : String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  const byId = new Map(all.map((c) => [c.id, c]));
  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length) throw new ConfigError(`Unknown clip id(s): ${missing.join(", ")}. Known: ${[...byId.keys()].join(", ") || "(none)"}`);
  return wanted.map((id) => byId.get(id));
}
