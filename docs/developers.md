# Developer reference

The contract is [the spec](spec.md): §7 formats, §8 helper API, §11 commands, §13 quality bar. This page is the working summary. Section numbers refer to the spec.

## The project (§7)

A clip project is a folder:

```
my-clips/
├── clips.config.mjs       # target, viewport, cursor, outputs, sizes, camera, stage
├── clips/<id>.clip.mjs    # one scenario per file
├── CLAUDE.md              # the working rule: this folder makes clips, never edits the plugin
├── .cache/                # takes: frames, take.json, rehearsal screenshots   (gitignored)
└── out/                   # mp4, webm, gif, posters, crops, manifest.json, embed/<id>.html
```

`ui-clips init <dir> --url … [--serve <dir>] [--viewport 1440x900] [--sizes full,card,landscape] [--outputs mp4,webm,poster,gif] [--zoom gentle] [--theme light] [--cursor arrow] [--stage-exclude aside]` writes the config (every key annotated), `clips/`, `.gitignore` and `CLAUDE.md`.

### `clips.config.mjs` (§7.1)

| Key | Meaning |
|---|---|
| `baseUrl` or `serve` | the target, or a local folder of static files the engine serves on 127.0.0.1 |
| `password` | `process.env.UI_CLIPS_PASSWORD`; fills a published prototype's gate once per context |
| `viewport`, `deviceScaleFactor` | the layout the page is recorded in and the capture scale (2, or 1.5 above about 10 MP per frame) |
| `colorScheme`, `fps`, `waitForFonts` | `light`, `dark` or `no-preference`; 30 fps |
| `cursor` | `{ style: "arrow" \| "dot" \| "none", color, size, ripple }` |
| `zoom` | `{ mode: "gentle" \| "pronounced" \| "off" }`, the auto camera's default; clips override |
| `camera` | `{ feel: "brisk" \| "calm" \| "lazy", ease: "cubic" \| "smooth" }` |
| `stage` | `{ exclude: [selectors or rects], fill }`: regions that never appear in any frame |
| `outputs` | `["mp4", "webm", "poster", "gif"]` |
| `sizes` | `full: true`; `card: { width: 480, height: 600, scale: 2, focus: "auto", upscale: 1 }`; `landscape: { aspect: "16:9", focus: "auto" }` |
| `quality` | `{ crf: 20, webmCrf: 30, maxWidth: 1440 }` |
| `hideSelectors`, `cssOverrides` | injected before every page (a badge; a layout fix that makes the real UI filmable, with a comment) |

### `clips/<id>.clip.mjs` (§7.2)

```js
export default {
  id: "todo-add",
  title: "Adding a task and ticking it off",
  scenario: "Today list → type 'Book the studio' → Add → the row slides in → tick it → hold.",
  alt: "A to-do list titled Today. A new task, Book the studio, is typed and added; the row slides in, then is ticked and struck through.",
  start: "/",
  length: "natural",            // or a target in ms
  loop: "none",                 // "return" | "crossfade" | "none"
  poster: "added",              // "start" | "end" | ms | a mark name
  steps: async ({ page, h }) => {
    const input = page.getByLabel("Add a task");
    const newRow = page.locator("li", { hasText: "Book the studio" });
    h.track("newRow", newRow);
    await h.mark("b1-start");
    await h.shot("wide");
    await h.hold(800);
    await h.click(input);
    await h.shot({ anchor: input, extras: [page.getByRole("button", { name: "Add" })], padding: 24 }, { ms: 600 });
    await h.type(input, "Book the studio", { click: false });
    await h.click(page.getByRole("button", { name: "Add" }), { expect: () => h.visible(page.getByText("Book the studio")) });
    await h.waitForMotion();
    await h.mark("added");
    await h.shot({ anchor: "newRow", padding: 24 }, { ms: 700 });
    await h.hold(1400);
    await h.shot("opening", { ms: 700 });
    await h.hold(1600);
  },
};
```

A sub-clip is `{ id, take: "<parent id>", from: "<mark>", to: "end", loop, poster }`: cut from the parent's take at export, never recorded. Other per-clip keys: `zoom`, `camera`, `crops` (extra sizes), `freezeTime` (ISO date; the page clock is fixed before navigation).

**Expectations.** Every action takes `expect`, a function that must hold within 3 s. Prefer an accessible state (visible text, `aria-*`); on a prototype that exposes none, read a class or style and say so in a comment, so a later reader knows the check is cosmetic.

## Helper API (§8)

| Helper | Does |
|---|---|
| `h.moveTo(locator, { ms })` | bezier cursor move, 400–1200 ms by distance |
| `h.click(locator, { expect })` | move, pause, press (arrow dips, ring blooms), release; `expect` must hold |
| `h.hover(locator, { holdMs })` | move and dwell |
| `h.type(locator, text, { cps, click })` | click the field unless `click: false`, step the cursor aside, type at 12 chars/s |
| `h.press(key, { expect })`, `h.select(locator, optionText)` | keys; native or custom dropdowns |
| `h.scrollBy(px, { within })`, `h.scrollTo(locator, { within, align, ifNeeded })` | smooth wheel scroll; settles before the next step; contained to the container |
| `h.hold(ms)` | hold; a pending poster screenshot is taken at the start of a hold and its time subtracted |
| `h.waitForMotion({ timeout })` | wait for animations and transitions (ignores the cursor's own and looping ones) |
| `h.visible(l)`, `h.hidden(l)`, `h.text(l, s)` | expectations |
| `h.mark(name, { focus })` | name a beat: framing-sheet row, poster, sub-clip boundary, static-crop focus |
| `h.shot(spec, { ms })` | camera keyframe: `"wide"` (`{ mode: "contain" \| "cover", anchor }`), `"opening"`, or `{ anchor, extras, padding, align: "auto" \| "top" \| "bottom" }` |
| `h.track(name, locator)` | sample the box every frame so a focus shot can follow it |
| `h.speed(factor, fn)` | the stretch plays `factor`× faster at export |
| `h.trim(fn)` | cut the wait inside `fn` from the video; later events shift with it |
| `h.parkCursor()`, `h.freezeTime(date)` | ease the cursor off; fix the clock |
| `h.zoomTo(locator)`, `h.zoomOut()` | shorthands for a focus shot and a wide |

## Capture (§9)

Playwright's `page.screencast` gives damage-driven JPEG frames with timestamps; Chromium is launched with `--force-device-scale-factor` (context emulation alone yields 1× frames), and `record` fails if frames come back at the wrong size. A readiness gate (fonts, animations finished, two frames) precedes the first frame. A fresh browser context per clip; caret and scrollbars hidden; `hideSelectors` and `cssOverrides` injected. Takes live in `.cache/<id>/latest/`: `f000001.jpg…`, `take.json` (frames with timestamps, the action log, marks, shots, tracks, trims, speed ranges, poster), `poster.png`.

## Export (§10)

1. **Retime.** Frames hold until the next frame; trims cut time out; a constant-fps list is sampled from the timestamps, and the intermediate encode takes each frame's time from its index, so output frame k is list entry k (rounded per-frame durations drift and ffmpeg then duplicates or drops frames).
2. **The time map.** Everything the take logs is in take time: shots, marks, actions, tracked boxes, the poster moment, sub-clip ranges, speed ranges. `buildTakeTimeMap` maps take time to output time, trims first and then speed ramps, and `takeEvents` applies it to all of them; the camera only sees mapped times.
3. **Stage.** `stage.exclude` regions along an edge are cut, interior ones masked with the fill (masks follow their element); the wide frame is the stage fitted to the output width, top-aligned, fill below.
4. **Camera per size.** Each size gets its own track for its aspect: explicit shots from the clip (eased moves, follow-by-anchor, widen-only extras, top/bottom slices, the opening framing at both ends) and, where none, auto shots from the action log (clusters, re-aim, cap, a critically damped spring per `feel`). The track is rendered as per-frame crop windows from the stage canvas, never upscaled past the floor (half the output width in CSS px, divided by the size's `upscale`).
5. **Loop.** `return` compares first and last frames with pixelmatch and trims to the matching frame; `crossfade` blends the last 400 ms into the head after a 0.4 s rest at the opening framing.
6. **Presets.** MP4: `libx264 -preset slow -tune animation -crf 20 -pix_fmt yuv420p -profile:v high -movflags +faststart`, no audio. WebM: `libvpx-vp9 -crf 30 -b:v 0 -row-mt 1 -deadline good`. GIF: two-pass palette, 12–15 fps, max 960 wide. Posters: the lossless screenshot rendered through the camera window at the poster moment, PNG at 1× and 2× and WebP when an encoder exists.
7. **Checks (§13).** Length (±0.2 s of a target), loop, camera rest at both ends (and 0.4 s before a crossfade), clicks in frame, camera floor, stage, MP4 size (2 MB per 8 s at 1440 wide, prorated by area), GIF size, frame-count timing, poster written. A failed check fails the export.
8. **Manifest and snippet.** `out/manifest.json` per clip: id, title, scenario, alt, length, loop, sizes with their shots and per-frame windows, files, posters, marks, steps, dates. `out/embed/<id>.html` is a bare `<video>` with WebM and MP4 sources, the poster and the alt text.

## CLI (§11)

```
ui-clips init     [dir]         create a clip project from --url or --serve plus the interview flags
ui-clips doctor                 environment, URL reachability, password gate
ui-clips inspect  <url|clip>    visible text, ARIA snapshot, ranked locators (JSON); --at <mark> inspects a clip's state at that mark
ui-clips dry-run  [clip|all]    rehearse: locators, actions, expectations, and the camera plan per beat
ui-clips sheet    <clip>        --framing (from the dry run) or --beats (from a recording); --size <name>
ui-clips record   [clip|all]    capture the take
ui-clips export   [clip|all]    camera, loop, presets, crops, posters, GIF, manifest, snippet; --zoom, --feel, --fast
ui-clips list                   clips, last recorded, outputs, changed since export
```

`--project <dir>` (default: the current folder), `--changed`, `--json` on every command.

## Working rules (§14)

- One session edits the `ui-clips` repository at a time; clip projects run elsewhere and never edit the plugin.
- Engine fixes found while making clips go on a branch and merge to `main` with their tests and a changelog line.
- `ui-clips`, lowercase and hyphenated, in every identifier; "UI Clips" only as the display name.
- Nothing from a client's or employer's project goes into the repository; `examples/` is a neutral demo page.
- `main` is protected: pull requests, owner approval, no force pushes.

### Filing an issue from a clip project

When a clip hits a plugin problem, ship the best clip the current plugin can make, then write `docs/issues/<date>-<name>.md` in the clip project with: what was asked, what happened, how to reproduce it (the clip file and the command), what was measured (frame sizes, timings, the check's message), the suspected file and function, a proposed fix with a test, whether it is a bug or an enhancement, and whether the clip can ship without it. Open an issue on this repository with that file's content. Pull requests come from forks, one change each, with `npm test` and `claude plugin validate --strict .` passing ([CONTRIBUTING.md](../CONTRIBUTING.md)).

## Tests and evals

`npm test` runs the unit suite (`node --test`: camera, retime, time map, loop, motion, cursor, scaffold, rehearsal, intermediate encode). `claude plugin validate --strict .` checks the manifests and skills. `claude plugin eval . --trust-plugin` runs the eval cases in `evals/` against `examples/todo-demo`, which exercise the three skills end to end and need ffmpeg and Chromium on the machine.
