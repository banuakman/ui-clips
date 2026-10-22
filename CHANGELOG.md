# Changelog

## Unreleased (milestone 1: capture)

- Engine: `doctor`, `inspect`, `dry-run`, `record`, `export`, `list`
- 2× screencast capture via Playwright `page.screencast` with `--force-device-scale-factor`, timestamp retiming to constant fps
- Helper API: bezier cursor, click/hover/type/press/select/scroll with `expect`, hold, waitForMotion, marks, trims
- Lossless PNG poster taken during a hold
- Export presets: H.264 MP4 (fast-start), VP9 WebM, poster PNG at 1× and 2×, `out/manifest.json`
- Example project `examples/todo-demo` against a local static page
