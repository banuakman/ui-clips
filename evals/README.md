# Evals

Two layers, because `claude plugin eval` runs every Bash command inside Claude Code's OS sandbox, which on macOS blocks binding a local port and running a browser. The engine needs both (a local server for `serve:` projects and Playwright's Chromium), so the browser path cannot complete inside `plugin eval`; it is tested by the end-to-end script instead.

## `claude plugin eval` cases (sandbox-safe)

```bash
claude plugin eval . --trust-plugin --scaffold --allow-tools Bash Write Edit --no-publish
```

Each case's `fixture.sh` unpacks the plugin's demo page (`examples/todo-demo/site`) into the run's workspace, so no network is needed.

| Case | Guards |
|---|---|
| `new-clip-project` | the interview path with the answers in the prompt: `ui-clips init`, `doctor`, a config with the 4:5 card served from `./site`, a `CLAUDE.md`, a report of what doctor found |
| `author-clip` | scenario → clip file: `inspect` is run before the file is written, every action carries an `expect`, an inspected locator is used, the loop is as asked, `dry-run` is run, nothing is recorded |
| `record-clips` | the record path's discipline when the rehearsal cannot run: `dry-run` first, no edits to clip files, no invented outputs, and a reply that names the failing step instead of claiming files |

Each case runs once (`runs: 1`); raise it with `--runs`.

## End-to-end script (outside the sandbox)

```bash
evals/e2e.sh            # serves the demo page, runs a fresh headless Claude Code session with this plugin, checks the outputs
```

It asks the session to create a project, author `todo-hover`, rehearse, record and export, then checks that the MP4, the card and the manifest exist and that every export check passed. It needs ffmpeg, Chromium, and a logged-in `claude` CLI, and costs about one dollar per run. This is the test that fails on a regression in the record path.
