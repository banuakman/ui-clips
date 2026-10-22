#!/usr/bin/env node
// ui-clips CLI: doctor | inspect | dry-run | record | export | list
import { parseArgs } from "node:util";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = `ui-clips <command> [args] [--project <dir>] [--json]

  doctor                    environment, URL reachability, password gate
  inspect  <url|clip>       visible text, ARIA snapshot, candidate locators (JSON)
  dry-run  [clip|all]       resolve locators, run actions, check expectations; no capture
  record   [clip|all]       capture 2x frames (+ action log)
  export   [clip|all]       retime, encode presets, poster, manifest
  list                      clips, last recorded, outputs, changed since export

Options: --project <dir>  --json  --changed  --no-url (doctor: skip the URL check)`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string", short: "p" },
    json: { type: "boolean", default: false },
    changed: { type: "boolean", default: false },
    "no-url": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const [command, arg] = positionals;
const log = (msg) => { if (!opts.json) process.stderr.write(`· ${msg}\n`); };
const emit = (obj, human) => { if (opts.json) process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); else process.stdout.write(human + "\n"); };
const fail = (msg, code = 1) => { if (opts.json) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n"); else process.stderr.write(`✗ ${msg}\n`); process.exit(code); };

if (!command || opts.help) { console.log(USAGE); process.exit(command ? 0 : 1); }

const { resolveProjectDir, loadConfig, loadClips, ConfigError } = await import("./config.mjs");

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

const fmtResult = (r) => r.ok
  ? `✓ ${r.clipId}: ${r.mode === "record" ? `${r.frames} frames (${r.frameSize?.width}×${r.frameSize?.height})` : `${r.actions} actions`} in ${(r.durationMs / 1000).toFixed(2)} s${r.warnings?.length ? "\n  ⚠ " + r.warnings.join("\n  ⚠ ") : ""}`
  : `✗ ${r.clipId}: ${r.error.kind}${r.error.step ? ` at step "${r.error.step}"` : ""}: ${r.error.message}`;

try {
  switch (command) {
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
        if (clip) start = clip.start; else fail(`"${arg}" is neither a URL, a path, nor a known clip id`);
      }
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
        try { results.push(await exportClip({ config, clip, takeDir: takeDirFor(config, clip), outDir: config.outDir, log })); }
        catch (e) { results.push({ clipId: clip.id, ok: false, error: e.message }); }
      }
      const ok = results.every((r) => r.ok);
      emit({ ok, results }, results.map((r) => r.error
        ? `✗ ${r.clipId}: ${r.error}`
        : `${r.ok ? "✓" : "⚠"} ${r.clipId}: ${(r.durationMs / 1000).toFixed(2)} s · ` +
          Object.entries(r.files).map(([k, v]) => `${k} ${v.width}×${v.height} ${(v.bytes / 1024).toFixed(0)} KB`).join(" · ") +
          (r.poster["@2x"] ? ` · poster ${path.basename(r.poster["@2x"].path)}` : "") +
          "\n  " + r.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n  ") +
          (r.warnings.length ? "\n  ⚠ " + r.warnings.join("\n  ⚠ ") : "")
      ).join("\n"));
      process.exit(ok ? 0 : 1);
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
