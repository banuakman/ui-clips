# Changelog

## Unreleased (milestone 2, pass C: wide modes, settled posters, enforced rest)

- Wide shots: `contain` (the opening framing; opening shot only) and `cover` (frame filled at full stage height, sides cropped, anchored left/right/center or a target; default for any later wide); `h.shot("opening")` returns to the first framing
- Posters and contact-sheet cells render through the camera per output size, using the window a move settles on; `sheet --size <name>`
- §13 rest is enforced again: every camera size must start and end at the opening framing, and a crossfade loop must rest there for 0.4 s before the fade
- Spec §7.1, §8, §10.3, §10.4, §13 and appendix D updated to match (2026-10-22)
- A focus frame that fits the stage stays inside it, so no fill shows below a pushed-in shot; only the contain wide (or a frame taller than the stage) reaches into the fill
- Tracked targets: all tracks are read in parallel each tick (sample rate set by the slowest read, not their sum) and boxes are interpolated between samples at export, so a focus following a scrolling element moves as a ramp rather than a staircase

## Milestone 2, pass B: camera direction, stage, sizes, speed, sub-clips

- Camera: `camera.feel` presets brisk / calm (default) / lazy with the appendix D spring constants; re-aim (an action outside the shot by more than a quarter of its width starts a new shot) and cap (a box over 65% of the stage stays wide); the rest margin before the end scales with the feel and the camera snaps to wide within a pixel
- Explicit track: `h.shot("wide" | { focus: [targets], padding }, { ms })`, eased in-out moves, 600 ms minimum hold, click-during-move warning, half-output-width floor; explicit overrides auto in its window; `h.zoomTo`/`h.zoomOut` are shorthands
- `h.track(name, locator)`: per-frame target boxes; focus shots follow tracked targets
- Stage: `stage.exclude` (edge regions cut, interior regions masked with `stage.fill`, masks follow moving elements) and top-aligned wide shots with fill below
- Output sizes: `sizes` in the project config (`full`, `{ width, height, scale, focus: "auto" }`, `{ aspect, focus }`, explicit rect), one camera track per aspect, MP4/WebM/posters per size; tall focus aligns to the top
- Speed ramp `h.speed(factor, fn)`; sub-clips (`take`, `from`, `to`) with their own poster from lossless mark screenshots
- `export --feel`, `export --fast`; `sheet --beats`; the sheet reads the camera render when one exists
- WebP stays a soft dependency (ffmpeg libwebp, else cwebp, else skipped with a note); record fails on wrong frame size
- Rendering: one stage canvas pass per export, then each size's camera pass reads it straight from the decoder (a dynamic crop behind another filter segfaults ffmpeg 9)
- Demo: todo-add has marks, tracks, an explicit track, a sped-up typing stretch, a footer stage mask and a `todo-add-tick` sub-clip
- From the pilot: the MP4 size budget is prorated by frame area as well as length; the rest-at-both-ends check is informational for explicit tracks (a storyboard may end on a focus and let the loop carry the return); the length target counts output time after speed ramps and the crossfade trim; aspect-only sizes no longer produce an `@1x` variant; `h.scrollTo(..., { ifNeeded: true })` skips a scroll when the target is already in view, and `scrollTo` waits and retries when the container cannot scroll yet because its content is still growing

## Milestone 2: export and camera

- Loop modes: `return` compares the first frame with the tail (pixelmatch, threshold 0.1, 0.2% tolerance) and trims to the matching frame, warning when none matches; `crossfade` blends the last 400 ms into the head and trims so the last frame equals the first
- Crops: `{ aspect, focus }`, `{ width, height, focus, scale }` or an explicit rect; focus boxes mapped through the camera; MP4, WebM and poster per crop
- GIF (12 fps, 960 wide, two-pass palette) and `mp4@2x` outputs; posters as WebP next to PNG (ffmpeg libwebp or cwebp; doctor checks for one)
- Auto-zoom camera (default `gentle`): click clusters and dwells → shots → critically damped spring → per-frame crop windows rendered from the 2× source in one ffmpeg pass; explicit `h.zoomTo`/`h.zoomOut` keys override; `export --zoom` re-renders without re-recording; checks that the camera is at rest at both ends
- Contact sheet: `ui-clips sheet <clip>` tiles key frames with a JSON legend
- Manifest completed (files, posters, crops, camera shots and per-frame windows, loop info, per-step timings) and `out/embed/<id>.html` snippet
- Example clips `todo-tick` (return loop) and `todo-hover` (crossfade); the demo project exports GIF and a 16:9 crop

## Milestone 1: capture

- Engine: `doctor`, `inspect`, `dry-run`, `record`, `export`, `list`
- 2× screencast capture via Playwright `page.screencast` with `--force-device-scale-factor`, timestamp retiming to constant fps
- Helper API: bezier cursor, click/hover/type/press/select/scroll with `expect`, hold, waitForMotion, marks, trims
- Cursor: `arrow` is the default style (charcoal, white outline, soft shadow, ~22 px, hotspot at the tip; appendix D), `dot` and `none` stay available. On click the arrow dips to 92% for 80 ms and a translucent ring blooms from the tip (28 → 48 px, 350 ms). `h.type` steps the cursor 32 px right and 24 px down after the click so the caret and words stay uncovered
- Lossless PNG poster taken during a hold
- Export presets: H.264 MP4 (fast-start), VP9 WebM, poster PNG at 1× and 2×, `out/manifest.json`
- Example project `examples/todo-demo` against a local static page
- Fixed-window crops (M2 item pulled forward): project- or clip-level `crops: { name: { width, height, scale, focus } }`, focus from a mark's box (`h.mark(name, { focus })`) or a measured selector; exported as `<id>.<crop>.mp4` plus `@1x`, with matching posters and manifest entries
- `inspect` reports links and buttons whose text sits in nested elements
- `waitForMotion` ignores the injected cursor's own click animations
- Clip-level `freezeTime` fixes the page clock before navigation
- Scrolling: `scrollBy` waits for the scroll to settle, `scrollTo` clamps to the container's range, retries while layout is still growing, and contains overscroll so nothing chains to the page behind; a click target outside the viewport is scrolled into view with a warning
