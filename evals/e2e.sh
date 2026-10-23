#!/bin/bash
# End-to-end check of the three skills outside the eval sandbox (which cannot run a browser or bind a port):
# serve the demo page, run a fresh headless Claude Code session with this plugin, verify the outputs. Exit 1 on failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${E2E_WORKDIR:-$(mktemp -d "${TMPDIR:-/tmp}/ui-clips-e2e.XXXXXX")}"
PORT="${E2E_PORT:-4733}"
mkdir -p "$WORK"
node -e "
import('$ROOT/engine/serve.mjs').then(async ({ startStaticServer }) => {
  const s = await startStaticServer('$ROOT/examples/todo-demo/site', { port: $PORT });
  console.log(s.url); setInterval(() => {}, 1e6);
});" > "$WORK/serve.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
grep -q "http://127.0.0.1:$PORT" "$WORK/serve.log" || { echo "demo server did not start:"; cat "$WORK/serve.log"; exit 1; }

cd "$WORK"
PROMPT="Using the ui-clips plugin: create a clip project in ./clips-project for http://127.0.0.1:$PORT/ (defaults, full frame plus the 4:5 card, no questions), then author a clip with id todo-hover: the Today list → hover each of the three tasks in turn → crossfade loop, natural length. Rehearse it, build the framing sheet, then record and export it and list the output files."
env -u CLAUDECODE claude -p --plugin-dir "$ROOT" --permission-mode acceptEdits \
  --allowedTools "Bash(ui-clips *),Bash(ls *),Bash(mkdir *),Read,Write,Edit,Glob,Grep,Skill" \
  --max-turns 90 --output-format json "$PROMPT" > run.json 2> run.err || true

node -e "
const fs = require('node:fs');
const r = JSON.parse(fs.readFileSync('run.json', 'utf8'));
const fail = (m) => { console.error('✗ ' + m); process.exit(1); };
if (r.subtype !== 'success') fail('session did not finish: ' + r.subtype);
for (const f of ['clips-project/clips.config.mjs', 'clips-project/CLAUDE.md', 'clips-project/clips/todo-hover.clip.mjs', 'clips-project/out/todo-hover.framing.png', 'clips-project/out/todo-hover.mp4', 'clips-project/out/todo-hover.card.mp4', 'clips-project/out/todo-hover.poster.png', 'clips-project/out/manifest.json']) if (!fs.existsSync(f)) fail('missing ' + f);
const m = JSON.parse(fs.readFileSync('clips-project/out/manifest.json', 'utf8')).clips['todo-hover'];
if (!m) fail('manifest has no todo-hover');
if ((m.warnings || []).some((w) => /✗/.test(w))) fail('export warnings: ' + m.warnings.join('; '));
console.log('✓ e2e: ' + r.num_turns + ' turns, ' + Math.round(r.duration_ms / 1000) + ' s, \$' + (r.total_cost_usd || 0).toFixed(2) + '; outputs in ' + process.cwd() + '/clips-project/out');
"
# an export check that failed would have exited non-zero inside the session; confirm by re-running the checks here
"$ROOT/bin/ui-clips" export todo-hover --project clips-project --json > export.json 2>/dev/null || { echo "✗ re-export failed"; exit 1; }
node -e "const r = JSON.parse(require('node:fs').readFileSync('export.json','utf8')); const bad = r.results.flatMap((x) => (x.checks||[]).filter((c) => !c.ok).map((c) => c.name)); if (bad.length) { console.error('✗ checks failed: ' + bad.join(', ')); process.exit(1); } console.log('✓ every export check passed (' + r.results[0].checks.length + ')');"
