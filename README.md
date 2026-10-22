# ui-clips

Record short, silent, retina-sharp clips and stills of any web UI from a written scenario, so they can be re-recorded in one command whenever the design changes.

**Status: milestone 1 (capture engine).** The engine records and exports; the Claude Code skills that interview you and write clip files arrive in milestone 3. Until then, clip files are written by hand (or by asking Claude with the files below open).

## What it does

You describe the moment: "the Today list → type a task → press Enter → the row slides in → tick it". That becomes a small clip file. The engine drives Chromium, captures 2× frames with Playwright's screencast, rebuilds a constant frame rate from the frame timestamps, and exports a fast-start MP4, a WebM, and a lossless poster still, plus a manifest with alt text.

- **Scripted, not performed.** One small file per clip; identical every take.
- **Crisp by default.** 2× capture, lanczos downscale, H.264 tuned for flat UI.
- **Described, not guessed.** Every step states the visual change it must produce (`expect`); the dry run proves it before anything is recorded.

## Requirements

Node 20+, ffmpeg and ffprobe on PATH (`brew install ffmpeg` on macOS), and Playwright's Chromium (`npx playwright install chromium` from the plugin folder). `ui-clips doctor` checks all of it and prints the fix for anything missing.

## Quick start (local checkout)

```bash
npm ci
npx playwright install chromium
./bin/ui-clips doctor   --project examples/todo-demo
./bin/ui-clips dry-run  todo-add --project examples/todo-demo
./bin/ui-clips record   todo-add --project examples/todo-demo
./bin/ui-clips export   todo-add --project examples/todo-demo
open examples/todo-demo/out/todo-add.mp4
```

As a Claude Code plugin (`claude --plugin-dir .`), `ui-clips` is on the Bash PATH, so the same commands run without `./bin/`.

## A clip project

```
my-clips/
├── clips.config.mjs       # target URL (or a local folder to serve), viewport, cursor, outputs
├── clips/
│   └── rm-home.clip.mjs   # one scenario: start route, steps with expectations, alt text, poster moment
├── .cache/                # takes: 2× frames, poster.png, take.json   (gitignore)
└── out/                   # rm-home.mp4, rm-home.webm, rm-home.poster.png, rm-home.poster@2x.png, manifest.json
```

The cursor is an injected SVG: `cursor.style` is `"arrow"` by default (a charcoal arrow about 22 px tall with a white outline, hotspot at the tip), with `"dot"` and `"none"` as options; `cursor.color` recolours it for a brand variant.

See [`examples/_template/`](examples/_template/) for an annotated config and clip, and [`examples/todo-demo/`](examples/todo-demo/) for a working project against a local demo page.

### Helpers available in `steps({ page, h })`

| Helper | Does |
|---|---|
| `h.click(locator, { expect })` | Bezier cursor move, pause, press (the arrow dips and a ring blooms from its tip), release; then `expect` must hold |
| `h.hover(locator, { holdMs })` | Move and dwell |
| `h.type(locator, text, { cps })` | Click, step the cursor aside so the caret stays visible, then type at a human pace (default 12 chars/s) |
| `h.press(key, { expect })` | Press a key (Enter, Escape, Tab…) |
| `h.select(locator, optionText)` | Native `<select>` or custom dropdown |
| `h.scrollBy(px, { within })` / `h.scrollTo(locator, { within })` | Smooth wheel scroll |
| `h.hold(ms)` | Hold the frame (the poster is taken at the start of a hold, without stretching it) |
| `h.waitForMotion()` | Wait for CSS animations and transitions to finish |
| `h.visible(l)` / `h.hidden(l)` / `h.text(l, s)` | Expectations for `expect` |
| `h.mark(name)` | Name a moment (poster, crop focus, zoom target) |
| `h.trim(fn)` | Run a step but cut its wait from the video |
| `h.parkCursor()` | Ease the cursor off and fade it out |
| `h.freezeTime(date)` | Fix the page clock |
| `h.zoomTo(target, { scale })` / `h.zoomOut()` | Camera keyframes (rendered from milestone 2.5) |

## CLI

```
ui-clips doctor                 environment, URL reachability, password gate
ui-clips inspect <url|clip>     visible text, ARIA snapshot, candidate locators (JSON)
ui-clips dry-run [clip|all]     resolve locators, run actions, check expectations; no capture
ui-clips record  [clip|all]     capture 2× frames (+ action log)
ui-clips export  [clip|all]     retime, encode presets, poster, manifest
ui-clips list                   clips, last recorded, outputs, changed since export
```

`--project <dir>` (default: current folder), `--changed`, `--json` on every command.

## How capture works

Playwright's `recordVideo` encodes at CSS-pixel size in realtime, so text goes soft. ui-clips uses `page.screencast` instead: Chromium pushes a JPEG every time the compositor repaints, with a presentation timestamp. Chromium is launched with `--force-device-scale-factor=2`, which makes the headless compositor surface a true 2× bitmap (emulating the scale factor alone yields 1× frames). Because frames only arrive on repaint, export rebuilds a constant 30 fps timeline from the timestamps, holding each frame until the next. The poster is a separate lossless PNG screenshot taken during a hold.

## Roadmap

- **M2** export: posters as WebP, crops, loop modes (`return` with a pixel comparison, `crossfade`), GIF, contact sheet, `--changed`; auto-zoom camera from the action log (default on)
- **M3** skills: `new-clip-project`, `author-clip`, `record-clips`
- **M4** docs, evals, v0.1.0

## License

MIT
