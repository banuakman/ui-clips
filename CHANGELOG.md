# Changelog

## Unreleased (milestone 1: capture)

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
