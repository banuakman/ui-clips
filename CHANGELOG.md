# Changelog

## Unreleased (milestone 1: capture)

- Engine: `doctor`, `inspect`, `dry-run`, `record`, `export`, `list`
- 2× screencast capture via Playwright `page.screencast` with `--force-device-scale-factor`, timestamp retiming to constant fps
- Helper API: bezier cursor, click/hover/type/press/select/scroll with `expect`, hold, waitForMotion, marks, trims
- Cursor: `arrow` is the default style (charcoal, white outline, soft shadow, ~22 px, hotspot at the tip; appendix D), `dot` and `none` stay available. On click the arrow dips to 92% for 80 ms and a translucent ring blooms from the tip (28 → 48 px, 350 ms). `h.type` steps the cursor 32 px right and 24 px down after the click so the caret and words stay uncovered
- Lossless PNG poster taken during a hold
- Export presets: H.264 MP4 (fast-start), VP9 WebM, poster PNG at 1× and 2×, `out/manifest.json`
- Example project `examples/todo-demo` against a local static page
