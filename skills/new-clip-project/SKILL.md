---
name: new-clip-project
description: Create a ui-clips clip project for a URL or a local site folder. One-round interview (page layout, output sizes, outputs, auto-zoom, theme, cursor), then writes clips.config.mjs and runs doctor.
argument-hint: "[folder] [url-or-site-folder]"
allowed-tools: AskUserQuestion, Read, Glob, Bash(ui-clips *), Bash(ls *)
---

# new-clip-project

Creates a clip project: a folder with `clips.config.mjs` and an empty `clips/`. Clips are authored afterwards with `/ui-clips:author-clip` and recorded with `/ui-clips:record-clips`. The `ui-clips` command is on PATH while this plugin is installed.

## 1. Take what the request already says

- **Folder**: the first argument, or `./clips-project/`. Never write into a folder that already has a `clips.config.mjs` unless the user asks to replace it (`--force`).
- **Target**: a URL (`https://…`) or a local folder that holds a static site (an `index.html`); a folder is passed as `--serve <dir>` and the engine serves it on 127.0.0.1.
- **Password**: if the published prototype has a gate, tell the user to export `UI_CLIPS_PASSWORD` in the shell that runs the commands. Never write a password into a file, a command line or a reply.

Anything the request already answers is not asked again.

## 2. Interview: one round, every option with a proposed default

Ask before writing anything. `AskUserQuestion` takes at most four questions per call, so use two calls back to back; in a non-interactive session (no way to ask), take the defaults and say so in the report.

Call A:
1. **Page layout** (the viewport the page is laid out in, not the clip size): `Desktop 1440×900 (Recommended)`, `Wide 1920×1080`, `Custom`. Explain in one line that a narrow viewport reflows the UI.
2. **Output sizes** (multi-select): `Full frame (Recommended)`, `Portfolio card 4:5 (480×600, exported at 960×1200)`, `Landscape 16:9 crop`, `Custom`.
3. **Outputs** (multi-select): `MP4 + WebM + poster (Recommended)`, `GIF as well`.
4. **Auto-zoom**: `Gentle (Recommended)`, `Pronounced`, `Off`. One line: each clip can override it.

Call B:
1. **Theme**: `Light (Recommended)`, `Dark`, `As the site is`.
2. **Cursor**: `Arrow (Recommended)`, `Arrow in a brand colour`, `Dot`, `Hidden`.

Before the custom layout is accepted, say what the viewport is for: pick a width at which the layout does not wrap, and a height tall enough to hold whatever the camera will pan over later (a drawer, a long form). The camera pans over the page; it never scrolls it for the viewer. Above about 2560×1800 the engine captures at 1.5× instead of 2× to keep the frame rate (it says so in the config).

## 3. Write the config

Map the answers onto one `ui-clips init` call and run it:

```bash
ui-clips init <folder> --url <https://…> --viewport 1440x900 --sizes full,card --outputs mp4,webm,poster --zoom gentle --theme light --cursor arrow
```

- Custom layout: `--viewport WxH`. Custom size: `--sizes full,card,name=WxH@2` or `name=16:9`.
- Brand-colour arrow: `--cursor arrow --cursor-color #RRGGBB` (ask for the hex if it was not given). Dot: `--cursor dot`. Hidden: `--cursor none`.
- GIF as well: `--outputs mp4,webm,poster,gif`. Landscape crop: add `landscape` to `--sizes`.
- Theme: `--theme light|dark|auto`. Local folder: `--serve <dir>` instead of `--url`.
- A sidebar or logo that must never appear in a clip: `--stage-exclude "aside,nav.sidebar"` (selectors; can be added later in the config).

Then Read the written `clips.config.mjs` once: every key is annotated, and it is the file the user will edit by hand later.

## 4. Doctor

```bash
ui-clips doctor --project <folder>
```

Relay every ✗ line with its `fix:` line verbatim (it names the install command for this platform). A target that is unreachable, or a password gate that does not open, stops here: say so and what to check (the URL, the published state of the prototype, `UI_CLIPS_PASSWORD`). Do not author clips against a target doctor cannot reach.

## 5. Report

The folder, the config path, the choices in one line each, what doctor found, and the next step: `/ui-clips:author-clip` with the moment to record described in plain words.
