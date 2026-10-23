// Scaffold a clip project (§6.1): clips.config.mjs from the interview answers, an empty clips/ folder, a .gitignore.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILE } from "./config.mjs";

export const LAYOUTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 1080 },
});

export const THEMES = Object.freeze({ light: "light", dark: "dark", auto: "no-preference", site: "no-preference" });
export const CURSORS = Object.freeze(["arrow", "dot", "none"]);
export const OUTPUTS = Object.freeze(["mp4", "webm", "poster", "gif"]);
export const ZOOMS = Object.freeze(["gentle", "pronounced", "off"]);
export const FEELS = Object.freeze(["brisk", "calm", "lazy"]);

/** "1440x900" | "1440×900" | "desktop" | "wide" → { width, height } */
export function parseViewport(s) {
  if (!s) return { ...LAYOUTS.desktop };
  if (LAYOUTS[s]) return { ...LAYOUTS[s] };
  const m = String(s).match(/^(\d{3,5})\s*[x×]\s*(\d{3,5})$/i);
  if (!m) throw new Error(`viewport "${s}" is not WIDTHxHEIGHT (e.g. 1440x900), "desktop" or "wide"`);
  return { width: +m[1], height: +m[2] };
}

/** The capture scale: 2× unless the frames would exceed ~10 MP, where Chromium's screencast drops below 20 fps. */
export function captureScale(viewport) {
  return viewport.width * viewport.height * 4 > 10_000_000 ? 1.5 : 2;
}

/**
 * A size spec → [name, source line]. "full", "card", "landscape", "name=WxH[@scale]" or "name=W:H" (an aspect).
 */
export function parseSize(spec) {
  const s = String(spec).trim();
  if (s === "full") return ["full", "full: true,"];
  if (s === "card") return ["card", 'card: { width: 480, height: 600, scale: 2, focus: "auto" },'];
  if (s === "landscape") return ["landscape", 'landscape: { aspect: "16:9", focus: "auto" },'];
  const m = s.match(/^([a-z][\w-]*)=(?:(\d+)[x×](\d+)(?:@(\d(?:\.\d+)?))?|(\d+):(\d+))$/i);
  if (!m) throw new Error(`size "${s}" is not full | card | landscape | name=WxH[@scale] | name=W:H`);
  const name = m[1];
  if (m[2]) return [name, `${name}: { width: ${+m[2]}, height: ${+m[3]}, scale: ${m[4] ? +m[4] : 2}, focus: "auto" },`];
  return [name, `${name}: { aspect: "${+m[5]}:${+m[6]}", focus: "auto" },`];
}

const SIZE_NOTES = {
  full: "the stage at the export width (checks, manifest)",
  card: "4:5 portfolio card at 960×1200, framed by the camera",
  landscape: "16:9 crop for a stacked mobile card, framed by the camera",
};

/** The config source for a set of answers (every key annotated, as examples/_template is). */
export function renderConfig(a = {}) {
  const viewport = a.viewport || { ...LAYOUTS.desktop };
  const dsf = a.deviceScaleFactor || captureScale(viewport);
  const theme = THEMES[a.theme || "light"] || "light";
  const cursor = CURSORS.includes(a.cursor) ? a.cursor : "arrow";
  const outputs = (a.outputs?.length ? a.outputs : ["mp4", "webm", "poster"]).filter((o) => OUTPUTS.includes(o));
  if (!outputs.includes("poster")) outputs.push("poster");
  const sizes = (a.sizes?.length ? a.sizes : ["full"]).map(parseSize);
  if (!sizes.some(([n]) => n === "full")) sizes.unshift(parseSize("full"));
  const zoom = ZOOMS.includes(a.zoom) ? a.zoom : "gentle";
  const feel = FEELS.includes(a.feel) ? a.feel : "calm";
  const exclude = (a.stageExclude || []).filter(Boolean);
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
  const lines = [
    `// ui-clips project (spec §7.1). Created ${new Date().toISOString().slice(0, 10)}. Every key is optional; these are the answers from the interview.`,
    `export default {`,
    a.serve
      ? `  serve: ${JSON.stringify(a.serve)},${" ".repeat(Math.max(1, 44 - JSON.stringify(a.serve).length))}// a local static site; the engine serves it on 127.0.0.1`
      : `  baseUrl: ${JSON.stringify(a.url || "https://example.com")},`,
    a.passwordEnv
      ? `  password: process.env.UI_CLIPS_PASSWORD,      // the published prototype's gate; set it in the shell, never in a clip file`
      : `  password: process.env.UI_CLIPS_PASSWORD,      // only read if the page shows a password gate`,
    `  // The viewport is the layout the page is recorded in, not the clip size: the camera frames each output size from it.`,
    `  // Pick a width where nothing wraps, and a height that holds whatever the camera will pan over (a drawer, a long form).`,
    `  viewport: { width: ${viewport.width}, height: ${viewport.height} },`,
    `  deviceScaleFactor: ${dsf},${dsf === 2 ? "                         // 2× capture for retina-sharp text" : "                       // 1.5×: at this viewport 2× frames exceed ~10 MP and the screencast drops below 20 fps"}`,
    `  colorScheme: ${JSON.stringify(theme)},${" ".repeat(Math.max(1, 28 - JSON.stringify(theme).length))}// "light" | "dark" | "no-preference" (as the site is)`,
    `  fps: 30,`,
    `  cursor: { style: ${JSON.stringify(cursor)}, color: ${JSON.stringify(a.cursorColor || "#1f2937")}, size: 22, ripple: true },${cursor === "none" ? "   // hidden" : "   // \"arrow\" (default) | \"dot\" | \"none\""}`,
    `  zoom: { mode: ${JSON.stringify(zoom)} },${" ".repeat(Math.max(1, 23 - JSON.stringify(zoom).length))}// "off" | "gentle" | "pronounced"; each clip may override`,
    `  camera: { feel: ${JSON.stringify(feel)} },${" ".repeat(Math.max(1, 22 - JSON.stringify(feel).length))}// "brisk" | "calm" | "lazy" (§10.3)`,
    exclude.length
      ? `  stage: { exclude: ${JSON.stringify(exclude)}, fill: "#FFFFFF" },   // regions that never appear in any frame`
      : `  stage: null,                                  // { exclude: ["aside"], fill: "#FFFFFF" }: regions that never appear in any frame`,
    `  outputs: ${JSON.stringify(outputs)},${" ".repeat(Math.max(1, 20 - JSON.stringify(outputs).length))}// mp4 + webm + poster; add "gif" for a GIF`,
    `  sizes: {                                      // output sizes every clip gets (§10.2); clips add crops`,
    ...sizes.map(([n, src]) => `    ${pad(src, 62)}// ${SIZE_NOTES[n] || "framed by the camera"}`),
    `  },`,
    `  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },   // raise crf to 22 if text-dense frames overshoot the §13 size bar`,
    `  hideSelectors: [],                            // e.g. ['[class*="made-with"]'] for a "Made with Figma" badge`,
    `  cssOverrides: "",                             // CSS injected before every page; the UI itself is never changed for a clip`,
    `  waitForFonts: true,`,
    `};`,
    ``,
  ];
  return lines.join("\n");
}

/** The working rule every clip project carries (spec §14): this folder makes clips and never edits the plugin. */
export function renderClaudeMd() {
  return `# This folder is a ui-clips clip project

It holds \`clips.config.mjs\`, one \`clips/<id>.clip.mjs\` per clip, the takes in \`.cache/\` and the exports in \`out/\`.
Work here with the ui-clips skills: \`/ui-clips:author-clip\` to turn a moment described in plain words into a clip file,
\`/ui-clips:record-clips\` to rehearse, record, export and verify it. The \`ui-clips\` command (\`doctor\`, \`inspect\`,
\`dry-run\`, \`sheet\`, \`record\`, \`export\`, \`list\`) is on PATH while the plugin is installed.

## Working rule

**This project makes clips and never edits the plugin.** The ui-clips engine and skills live in the plugin's own
repository; a session working here does not patch them, not even to get a clip out.

When a clip hits a plugin problem (a check that fails for the wrong reason, a camera move that cannot be expressed,
a helper that misbehaves):

1. Ship the best clip the current plugin can make.
2. File the problem as \`docs/issues/<date>-<name>.md\` in this project, with: what was asked, what happened, how to
   reproduce it (the clip file and the command), what was measured (frame sizes, timings, the check's message), the
   suspected file and function, a proposed fix with a test, whether it is a bug or an enhancement, and whether the
   clip can ship without it.
3. Report it upstream as an issue on the plugin's repository, linking or pasting that file.

The UI being recorded is never changed for a clip either: copy, colours, spacing and transitions are what the design
says. The one exception is a layout fix that makes the real UI filmable, applied as a \`cssOverrides\` line with the
owner's approval and a comment saying why, and removed once the source is fixed.
`;
}

/**
 * Create the project: <dir>/clips.config.mjs, <dir>/clips/, <dir>/CLAUDE.md, <dir>/.gitignore. Refuses to overwrite
 * a config unless force; never overwrites an existing CLAUDE.md or .gitignore.
 */
export function scaffoldProject(dir, answers = {}, { force = false } = {}) {
  const configFile = path.join(dir, CONFIG_FILE);
  if (existsSync(configFile) && !force) throw new Error(`${configFile} exists; pass --force to overwrite it`);
  if (!answers.url && !answers.serve) throw new Error("a target is needed: --url <https://…> or --serve <dir>");
  mkdirSync(path.join(dir, "clips"), { recursive: true });
  const written = [];
  writeFileSync(configFile, renderConfig(answers));
  written.push(configFile);
  const gi = path.join(dir, ".gitignore");
  if (!existsSync(gi)) { writeFileSync(gi, ".cache/\nout/\n"); written.push(gi); }
  const cm = path.join(dir, "CLAUDE.md");
  if (!existsSync(cm)) { writeFileSync(cm, renderClaudeMd()); written.push(cm); }
  return { dir, configFile, clipsDir: path.join(dir, "clips"), written, viewport: answers.viewport || LAYOUTS.desktop };
}
