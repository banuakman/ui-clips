# ui-clips

Record short, silent, retina-sharp clips and stills of any web UI from a written scenario, so they can be re-recorded in one command whenever the design changes.

**Status: milestones 1 to 3 (engine and skills).** The engine records and exports clips with loops, crops, posters, GIFs and a directed camera; three Claude Code skills take you from a URL to the files without writing code. Milestone 4 (docs, evals, v0.1.0) is next.

## What it does

You describe the moment: "the Today list → type a task → press Enter → the row slides in → tick it". That becomes a small clip file. The engine drives Chromium, captures 2× frames with Playwright's screencast, rebuilds a constant frame rate from the frame timestamps, and exports a fast-start MP4, a WebM, an optional GIF, posters as PNG and WebP at 1× and 2×, named crops, an auto-zoom camera pass, clean loops, a manifest with alt text, and a bare `<video>` snippet.

- **Scripted, not performed.** One small file per clip; identical every take.
- **Crisp by default.** 2× capture, lanczos downscale, H.264 tuned for flat UI.
- **Described, not guessed.** Every step states the visual change it must produce (`expect`); the dry run proves it before anything is recorded.

## With Claude Code

Install the plugin (`claude plugin marketplace add banuakman/ui-clips` then `claude plugin install ui-clips@ui-clips`, or `claude --plugin-dir .` from a checkout) and ask:

| Skill | Does |
|---|---|
| `/ui-clips:new-clip-project` | one round of questions (page layout, output sizes, outputs, auto-zoom, theme, cursor), writes `clips.config.mjs`, runs `doctor` |
| `/ui-clips:author-clip` | your moment in plain words → `clips/<id>.clip.mjs`: locators read from `inspect`, an `expect` per step, a camera plan; rehearsed with `dry-run`; the framing sheet shown before anything is recorded |
| `/ui-clips:record-clips` | `dry-run` → `record` → `export`, every output verified against the quality bar, a beats contact sheet, the file list; `--changed` re-records what changed |

The loop is always rehearse → framing sheet → record → export → beats sheet, so framing is judged on a drawing before a recording and on real frames after. `@agent-ui-clips:clip-explorer` is a stub for the next iteration: it inspects an app's routes and drafts a storyboard.

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
| `camera` | `{ feel: "brisk" \| "calm" \| "lazy" }` override of the project's spring |
| `crops` | extra output sizes for this clip, same shapes as the project's `sizes` |
| `freezeTime` | ISO date; the page clock is fixed before navigation |
| `take`, `from`, `to` | a **sub-clip**: cut from another clip's take between two marks (or `"start"`/`"end"`/ms), with its own id, poster and manifest entry; never recorded itself |

### Output sizes, stage and fill

`sizes` in the project config lists what every clip exports: `full: true` is the stage at the export width; `card: { width: 480, height: 600, scale: 2, focus: "auto" }` is a 4:5 card at 960×1200 framed by the camera; `{ aspect: "16:9", focus: "list" }` is a static window on a mark or selector. A `focus` on something taller than the window aligns to its top. `stage.exclude` lists elements or rects that never appear in any frame: regions along an edge (a sidebar) are cut away, interior ones are masked with `stage.fill` and follow the element if it moves. A wide shot fits the stage to the output width, top-aligned, with the fill below, so a portrait card of a landscape page reads as the page continuing.

### The camera

Two ways to direct it, which can mix; explicit wins in its window.

**Auto** (`zoom` on): the action log drives the camera at export time. Two or more actions within 3 s, or a dwell over 1.5 s, open a shot on the cluster's padded box; the box grows while actions land inside or near it; an action further out than a quarter of the shot's width starts a new shot, so the camera moves; a box wider than 65% of the stage stays wide. The shot releases a second after the last action, with a 1.2 s minimum and a rest before the end. Position and scale follow a critically damped spring whose `camera.feel` is `brisk` (about half a second), `calm` (just under a second, default) or `lazy`.

**Explicit**: a track keyed to marks, written in the clip. `h.shot("wide")`, `h.shot("opening")` or `h.shot({ focus: [targets], padding: 24 }, { ms: 600 })` sets the next frame: a focus is the smallest frame of the output aspect containing the targets, never narrower than half the output width in CSS px. A wide shot has two modes: `contain` fits the whole stage to the output width, top-aligned with the fill below, and only the opening shot may use it; `cover` fills the frame at full stage height and crops the sides, anchored `left`, `right`, `center`, a locator or a tracked name (`h.shot("wide", { mode: "cover", anchor: "right" }, { ms: 600 })`), and is the default for any later wide. `"opening"` returns to the first framing, which is where every clip must end. Moves ease in-out over the stated duration, each shot holds at least 600 ms, and a click inside a move is flagged. Targets are locators (box measured at the shot) or names from `h.track(name, locator)`, whose box is sampled every frame so the focus follows a scrolling drawer. `h.speed(factor, fn)` plays a stretch faster at export with the frames resampled. Posters and contact-sheet cells render through the camera at their moment, using the window a move settles on when the moment falls inside one.

Every output size gets its own track for its aspect, rendered from the 2× source in one ffmpeg pass per size, so nothing is upscaled. Re-render without re-recording: `ui-clips export <clip> --zoom pronounced --feel brisk`, or `--fast` while iterating (faster VP9, no GIF, camera at export width).

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
| `h.mark(name, { focus })` | Name a moment (poster, sub-clip boundary, crop focus); when a sub-clip uses the mark as its poster, a lossless screenshot is taken at the next hold |
| `h.shot("wide" \| "opening" \| { focus, padding }, { ms, mode, anchor })` | Explicit camera keyframe (see The camera) |
| `h.track(name, locator)` | Sample a target's box every frame so a focus shot can follow it |
| `h.speed(factor, fn)` | Run a step; that stretch plays `factor`× faster at export |
| `h.trim(fn)` | Run a step but cut its wait from the video |
| `h.parkCursor()` | Ease the cursor off and fade it out |
| `h.freezeTime(date)` | Fix the page clock |
| `h.zoomTo(target, { scale })` / `h.zoomOut()` | Camera keyframes (rendered from milestone 2.5) |

## CLI

```
ui-clips init    [dir]          create a clip project from --url or --serve plus --viewport, --sizes, --outputs, --zoom, --theme, --cursor
ui-clips doctor                 environment, URL reachability, password gate
ui-clips inspect <url|clip>     visible text, ARIA snapshot, candidate locators (JSON); --at <mark> inspects a clip's state at that mark
ui-clips dry-run [clip|all]     resolve locators, run actions, check expectations; no capture
ui-clips record  [clip|all]     capture 2× frames (+ action log)
ui-clips export  [clip|all]     camera, loop, presets, crops, posters, GIF, manifest, snippet
ui-clips sheet   <clip>         contact sheet PNG of key frames (+ a JSON legend); --beats for one frame per mark, --size card for that output
ui-clips list                   clips, last recorded, outputs, changed since export
```

`--project <dir>` (default: current folder), `--changed`, `--json` on every command; `export` takes `--zoom`, `--feel` and `--fast`.

## How capture works

Playwright's `recordVideo` encodes at CSS-pixel size in realtime, so text goes soft. ui-clips uses `page.screencast` instead: Chromium pushes a JPEG every time the compositor repaints, with a presentation timestamp. Chromium is launched with `--force-device-scale-factor=2`, which makes the headless compositor surface a true 2× bitmap (emulating the scale factor alone yields 1× frames). Because frames only arrive on repaint, export rebuilds a constant 30 fps timeline from the timestamps, holding each frame until the next. The poster is a separate lossless PNG screenshot taken during a hold.

## Roadmap

- **M4** docs (designers, developers), evals on `examples/todo-demo`, v0.1.0

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
