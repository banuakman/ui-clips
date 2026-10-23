#!/usr/bin/env node
// ui-clips CLI: init | doctor | inspect | dry-run | record | export | sheet | list
import { parseArgs } from "node:util";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = `ui-clips <command> [args] [--project <dir>] [--json]

  init     [dir]            create a clip project (clips.config.mjs + clips/) from --url or --serve and the options below
  doctor                    environment, URL reachability, password gate
  inspect  <url|clip>       visible text, ARIA snapshot, candidate locators (JSON); --at <mark> inspects a clip's state at that mark
  dry-run  [clip|all]       resolve locators, run actions, check expectations; no capture
  record   [clip|all]       capture 2x frames (+ action log)
  export   [clip|all]       camera, loop, presets, crops, posters, GIF, manifest, snippet
  sheet    <clip>           contact sheet PNG of key frames (needs a recording)
  list                      clips, last recorded, outputs, changed since export

Options: --project <dir>  --json  --changed
         export: --zoom off|gentle|pronounced  --feel brisk|calm|lazy  (re-render the camera from the same take)
                 --fast (faster VP9, no GIF, camera at export width)
         sheet:  --beats (one frame per mark)  --size <name> (from that output size)
                 --framing (from the dry run: each beat's stage frame with the planned camera window beside the card crop)
         doctor: --no-url
         init:   --url <https://…> | --serve <dir>  --viewport 1440x900|desktop|wide  --sizes full,card,landscape[,name=WxH[@2]|name=16:9]
                 --theme light|dark|auto  --cursor arrow|dot|none  --cursor-color #hex  --outputs mp4,webm,poster[,gif]
                 --zoom gentle|pronounced|off  --feel brisk|calm|lazy  --stage-exclude "aside,nav.sidebar"  --dsf 2|1.5  --force`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string", short: "p" },
    json: { type: "boolean", default: false },
    changed: { type: "boolean", default: false },
    zoom: { type: "string" },
    feel: { type: "string" },
    fast: { type: "boolean", default: false },
    beats: { type: "boolean", default: false },
    size: { type: "string" },
    framing: { type: "boolean", default: false },
    "no-url": { type: "boolean", default: false },
    at: { type: "string" },
    url: { type: "string" },
    serve: { type: "string" },
    viewport: { type: "string" },
    sizes: { type: "string" },
    theme: { type: "string" },
    cursor: { type: "string" },
    "cursor-color": { type: "string" },
    outputs: { type: "string" },
    "stage-exclude": { type: "string" },
    dsf: { type: "string" },
    force: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const [command, arg] = positionals;
const log = (msg) => { if (!opts.json) process.stderr.write(`· ${msg}\n`); };
const emit = (obj, human) => { if (opts.json) process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); else process.stdout.write(human + "\n"); };
const fail = (msg, code = 1) => { if (opts.json) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n"); else process.stderr.write(`✗ ${msg}\n`); process.exit(code); };

if (!command || opts.help) { console.log(USAGE); process.exit(command ? 0 : 1); }

const { resolveProjectDir, loadConfig, loadClips, ConfigError } = await import("./config.mjs");
const { formatRehearsal } = await import("./rehearsal.mjs");

async function project() {
  const dir = resolveProjectDir(opts.project);
  return loadConfig(dir);
}

async function withBrowser(config, fn) {
  const { launchBrowser, resolveBase } = await import("./browser.mjs");
  const base = await resolveBase(config);
  const browser = await launchBrowser(config);
  try { return await fn({ browser, baseUrl: base.baseUrl }); }
  finally { await browser.close(); await base.close(); }
}

function selectClips(config, selector) {
  return loadClips(config, selector || "all");
}

function changedOnly(config, clips) {
  const manifestFile = path.join(config.outDir, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { clips: {} };
  const cfgM = statSync(path.join(config.projectDir, "clips.config.mjs")).mtimeMs;
  return clips.filter((c) => {
    const m = manifest.clips[c.id];
    if (!m) return true;
    const exportedAt = Date.parse(m.exportedAt || 0);
    return statSync(c.file).mtimeMs > exportedAt || cfgM > exportedAt || (m.clipFileMtime && statSync(c.file).mtimeMs > m.clipFileMtime);
  });
}

const fmtRehearsal = (r) => (r.rehearsal ? "\n" + formatRehearsal(r.rehearsal) : "");
const fmtResult = (r) => r.skipped ? `· ${r.clipId}: ${r.skipped}` : r.error ? `✗ ${r.clipId}: ${r.error.kind}${r.error.step ? ` at step "${r.error.step}"` : ""}: ${r.error.message}` : (r.ok ? "✓" : "⚠") + ` ${r.clipId}: ${r.mode === "record" ? `${r.frames} frames (${r.frameSize?.width}×${r.frameSize?.height})` : `${r.actions} actions`} in ${(r.durationMs / 1000).toFixed(2)} s${r.warnings?.length ? "\n  ⚠ " + r.warnings.join("\n  ⚠ ") : ""}`
  + fmtRehearsal(r);

const list = (s) => (s ? String(s).split(",").map((x) => x.trim()).filter(Boolean) : []);

try {
  switch (command) {
    case "init": {
      const { scaffoldProject, parseViewport } = await import("./scaffold.mjs");
      const dir = path.resolve(arg || "clips-project");
      let r;
      try { r = scaffoldProject(dir, {
        url: opts.url, serve: opts.serve ? path.relative(dir, path.resolve(opts.serve)) || "." : undefined,
        viewport: parseViewport(opts.viewport), deviceScaleFactor: opts.dsf ? +opts.dsf : undefined,
        sizes: list(opts.sizes), theme: opts.theme, cursor: opts.cursor, cursorColor: opts["cursor-color"],
        outputs: list(opts.outputs), zoom: opts.zoom, feel: opts.feel, stageExclude: list(opts["stage-exclude"]),
        passwordEnv: !!process.env.UI_CLIPS_PASSWORD,
      }, { force: opts.force }); } catch (e) { fail(e.message); }
      emit({ ok: true, ...r }, `✓ ${r.configFile}\n✓ ${r.clipsDir}/ (empty)${r.written.some((f) => f.endsWith("CLAUDE.md")) ? `\n✓ ${path.join(dir, "CLAUDE.md")} (the clip-project working rule)` : ""}\nNext: ui-clips doctor --project ${JSON.stringify(dir)}, then author a clip into clips/<id>.clip.mjs.`);
      break;
    }
    case "doctor": {
      const { doctor } = await import("./doctor.mjs");
      let config = null;
      try { config = await project(); } catch (e) { if (!(e instanceof ConfigError)) throw e; log(`no clip project here (${e.message}); checking tools only`); }
      const r = await doctor(config, { checkUrl: !opts["no-url"] });
      emit(r, r.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name.padEnd(18)} ${c.detail}${c.fix ? `\n    fix: ${c.fix}` : ""}`).join("\n") + `\n${r.ok ? "All good." : "Fix the items above, then run doctor again."}`);
      process.exit(r.ok ? 0 : 1);
    }
    case "inspect": {
      if (!arg) fail("inspect needs a URL, a path, or a clip id");
      const config = await project();
      const { inspectPage } = await import("./inspect.mjs");
      const { openContext, gotoStart } = await import("./browser.mjs");
      let start = arg;
      if (!/^https?:\/\//.test(arg) && !arg.startsWith("/")) {
        const clips = await loadClips(config, "all");
        const clip = clips.find((c) => c.id === arg);
        if (!clip) fail(`"${arg}" is neither a URL, a path, nor a known clip id`);
        if (opts.at) {
          // The state the clip's steps reach at a mark (a drawer's contents, a dialog): a dry run that stops there.
          const { runClip } = await import("./run.mjs");
          const r = await withBrowser(config, ({ browser, baseUrl }) => runClip({ browser, baseUrl, config, clip, mode: "dry", stopAt: opts.at, log }));
          if (r.error) fail(`${clip.id}: ${r.error.kind}${r.error.step ? ` at step "${r.error.step}"` : ""}: ${r.error.message}`);
          if (!r.inspect) fail(`${clip.id}: mark "${opts.at}" was never reached (marks are named in h.mark calls)`);
          process.stdout.write(JSON.stringify({ stoppedAt: r.stoppedAt, ...r.inspect }, null, 2) + "\n");
          break;
        }
        start = clip.start;
      }
      if (opts.at) fail("--at needs a clip id, not a URL");
      const r = await withBrowser(config, async ({ browser, baseUrl }) => {
        const context = await openContext(browser, config, { cursor: false });
        const page = await context.newPage();
        await gotoStart(page, config, baseUrl, start);
        return inspectPage(page);
      });
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      break;
    }
    case "dry-run":
    case "record": {
      const config = await project();
      const { runClip } = await import("./run.mjs");
      let clips = await selectClips(config, arg);
      if (opts.changed) clips = changedOnly(config, clips);
      if (!clips.length) { emit({ ok: true, results: [] }, "Nothing to do."); break; }
      const results = await withBrowser(config, async ({ browser, baseUrl }) => {
        const out = [];
        for (const clip of clips) out.push(await runClip({ browser, baseUrl, config, clip, mode: command === "record" ? "record" : "dry", log }));
        return out;
      });
      const ok = results.every((r) => r.ok);
      emit({ ok, results: results.map(({ take, ...r }) => r) }, results.map(fmtResult).join("\n"));
      process.exit(ok ? 0 : 1);
    }
    case "export": {
      const config = await project();
      const { exportClip } = await import("./export.mjs");
      const { takeDirFor } = await import("./run.mjs");
      let clips = await selectClips(config, arg);
      if (opts.changed) clips = changedOnly(config, clips);
      const results = [];
      for (const clip of clips) {
        try { results.push(await exportClip({ config, clip, takeDir: takeDirFor(config, clip), outDir: config.outDir, log, zoom: opts.zoom, feel: opts.feel, fast: opts.fast })); }
        catch (e) { results.push({ clipId: clip.id, ok: false, error: e.message }); }
      }
      const ok = results.every((r) => r.ok);
      emit({ ok, results }, results.map((r) => r.error
        ? `✗ ${r.clipId}: ${r.error}`
        : `${r.ok ? "✓" : "⚠"} ${r.clipId}: ${(r.durationMs / 1000).toFixed(2)} s · ` +
          Object.entries(r.files).map(([k, v]) => `${k} ${v.width ? v.width + "×" + (v.height || "") + " " : ""}${(v.bytes / 1024).toFixed(0)} KB`).join(" · ") +
          (r.poster?.full ? ` · posters ${Object.keys(r.poster).filter((k) => r.poster[k]?.path).length}${r.poster.full.webp ? " +webp" : ""}` : "") +
          (r.sizes ? ` · sizes ${Object.values(r.sizes).map((v) => `${v.name} ${v.outW}×${v.outH} ${v.mode === "camera" ? `${v.zoom}/${v.feel}${(v.shots || []).some((s) => s.source === "explicit") ? " explicit" : ""}` : "static"}${v.note ? " (!)" : ""}`).join(", ")}` : "") +
          "\n  " + r.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n  ") +
          (r.warnings.length ? "\n  ⚠ " + r.warnings.join("\n  ⚠ ") : "")
      ).join("\n"));
      process.exit(ok ? 0 : 1);
    }
    case "sheet": {
      if (!arg) fail("sheet needs a clip id");
      const config = await project();
      const { contactSheet, framingSheet } = await import("./sheet.mjs");
      const { takeDirFor } = await import("./run.mjs");
      const [clip] = await loadClips(config, arg);
      if (opts.framing) {
        const r = await framingSheet({ config, clip, takeDir: takeDirFor(config, clip), outDir: config.outDir, size: opts.size || "card" });
        emit({ ok: true, ...r }, `✓ ${r.path}\n` + r.legend.rows.map((b) => `  ${String(b.row).padStart(2)}  ${b.beat.padEnd(14)} ${String(b.t).padStart(6)} ms  ${b.window ? `${b.size} window ${b.window.w}×${b.window.h} at ${b.window.x},${b.window.y}` : "no window"}${b.problems.length ? "  ✗ " + b.problems.join("; ") : ""}`).join("\n"));
        break;
      }
      const r = await contactSheet({ config, clip, takeDir: takeDirFor(config, clip), outDir: config.outDir, beats: opts.beats, size: opts.size || "full" });
      emit({ ok: true, ...r }, `✓ ${r.path}\n` + r.legend.frames.map((f) => `  ${String(f.cell).padStart(2)}  ${String(f.t).padStart(6)} ms  ${f.label}`).join("\n"));
      break;
    }
    case "list": {
      const config = await project();
      const clips = await loadClips(config, "all");
      const { takeDirFor } = await import("./run.mjs");
      const manifestFile = path.join(config.outDir, "manifest.json");
      const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { clips: {} };
      const changed = new Set(changedOnly(config, clips).map((c) => c.id));
      const rows = clips.map((c) => {
        const takeFile = path.join(takeDirFor(config, c), "take.json");
        const take = existsSync(takeFile) ? JSON.parse(readFileSync(takeFile, "utf8")) : null;
        const m = manifest.clips[c.id];
        return { id: c.id, title: c.title, file: path.relative(config.projectDir, c.file), length: c.length, loop: c.loop,
          recordedAt: take?.recordedAt || null, exportedAt: m?.exportedAt || null, outputs: m ? Object.values(m.files) : [], changed: changed.has(c.id) };
      });
      emit({ ok: true, project: config.projectDir, clips: rows }, rows.map((r) =>
        `${r.changed ? "•" : " "} ${r.id.padEnd(16)} ${String(r.length).padEnd(8)} ${r.loop.padEnd(10)} rec ${r.recordedAt ? r.recordedAt.slice(0, 16) : "—".padEnd(16)}  exp ${r.exportedAt ? r.exportedAt.slice(0, 16) : "—".padEnd(16)}  ${r.outputs.join(" ")}`).join("\n") + "\n(• = changed since last export)");
      break;
    }
    default:
      fail(`Unknown command "${command}".\n${USAGE}`);
  }
} catch (e) {
  fail(e instanceof ConfigError ? e.message : (e.stack || e.message));
}
