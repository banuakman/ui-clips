# ui-clips

Record short, silent, retina-sharp clips and stills of any web UI from a written scenario, so they can be re-recorded in one command whenever the design changes.

**Status: milestones 1 and 2 (capture and export engine).** The engine records and exports clips with loops, crops, posters, GIFs and an auto-zoom camera; the Claude Code skills that interview you and write clip files arrive in milestone 3. Until then, clip files are written by hand (or by asking Claude with the files below open).

## What it does

You describe the moment: "the Today list → type a task → press Enter → the row slides in → tick it". That becomes a small clip file. The engine drives Chromium, captures 2× frames with Playwright's screencast, rebuilds a constant frame rate from the frame timestamps, and exports a fast-start MP4, a WebM, an optional GIF, posters as PNG and WebP at 1× and 2×, named crops, an auto-zoom camera pass, clean loops, a manifest with alt text, and a bare `<video>` snippet.

- **Scripted, not performed.** One small file per clip; identical every take.
- **Crisp by default.** 2× capture, lanczos downscale, H.264 tuned for flat UI.
- **Described, not guessed.** Every step states the visual change it must produce (`expect`); the dry run proves it before anything is recorded.

## Requirements

Node 20+, ffmpeg and ffprobe on PATH (`brew install ffmpeg` on macOS), a WebP encoder (`brew install webp`, or an ffmpeg built with libwebp), and Playwright's Chromium (`npx playwright install chromium` from the plugin folder). `ui-clips doctor` checks all of it and prints the fix for anything missing.

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
├── .cache/                # takes: 2× frames, poster.png, take.json, intermediates   (gitignore)
└── out/                   # rm-home.mp4 / .webm / .gif, posters (.png + .webp, 1× and 2×), crops, manifest.json, embed/rm-home.html
```

### Per-clip choices

| Field | Values |
|---|---|
| `length` | target ms (the final hold is padded to hit it) or `"natural"` |
| `loop` | `"return"` (the script ends in the start state; export compares first and last frames with pixelmatch and trims to the matching frame), `"crossfade"` (the last 400 ms blend into the head), `"none"` |
| `poster` | `"start"`, `"end"`, a millisecond, or a mark name; always a lossless PNG screenshot taken during a hold |
| `zoom` | `"off"`, `"gentle"` (up to 1.6×), `"pronounced"` (up to 2.2×, capped by the 2× source at export width); overrides the project default, which is `gentle` |
| `crops` | named windows: `{ aspect: "16:9", focus }`, `{ width, height, focus, scale }` or `{ x, y, width, height }`; `focus` is a mark name whose `h.mark(name, { focus })` recorded a box, or a selector |
| `freezeTime` | ISO date; the page clock is fixed before navigation |

### The camera

With `zoom` on, the action log drives a virtual camera at export time: two or more actions within 3 s, or a dwell over 1.5 s, open a shot on the cluster's bounding box; the camera follows while actions keep arriving and releases a second after the last one. Position and scale follow a critically damped spring, so there are no cuts and the camera is at rest at both ends. Frames are cropped from the 2× source, so nothing is upscaled. `h.zoomTo` / `h.zoomOut` add explicit keyframes that win over auto detection. Re-render with another setting without re-recording: `ui-clips export <clip> --zoom pronounced`.

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
ui-clips export  [clip|all]     camera, loop, presets, crops, posters, GIF, manifest, snippet
ui-clips sheet   <clip>         contact sheet PNG of key frames (+ a JSON legend)
ui-clips list                   clips, last recorded, outputs, changed since export
```

`--project <dir>` (default: current folder), `--changed`, `--json` on every command; `--zoom off|gentle|pronounced` on `export`.

## How capture works

Playwright's `recordVideo` encodes at CSS-pixel size in realtime, so text goes soft. ui-clips uses `page.screencast` instead: Chromium pushes a JPEG every time the compositor repaints, with a presentation timestamp. Chromium is launched with `--force-device-scale-factor=2`, which makes the headless compositor surface a true 2× bitmap (emulating the scale factor alone yields 1× frames). Because frames only arrive on repaint, export rebuilds a constant 30 fps timeline from the timestamps, holding each frame until the next. The poster is a separate lossless PNG screenshot taken during a hold.

## Roadmap

- **M3** skills: `new-clip-project`, `author-clip`, `record-clips`
- **M4** docs, evals, v0.1.0

## License

MIT
