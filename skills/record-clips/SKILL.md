---
name: record-clips
description: Record and export one ui-clip, a list, all, or the clips changed since the last export, in the current clip project. Rehearses first, verifies every output against the quality bar, builds the beats contact sheet and reports the files. Use for re-records after a design change.
argument-hint: "[clip-id | id1,id2 | all | --changed]"
allowed-tools: Read, Glob, Bash(ui-clips *), Bash(ls *)
---

# record-clips

Records and exports clips that already exist in `clips/`. Authoring (writing or fixing a clip file) is `/ui-clips:author-clip`; this skill never edits clip files.

## 0. Project and selection

The project is the folder with `clips.config.mjs`: the current folder, or `--project <dir>` on every command below. `ui-clips list --project <dir>` shows the clips, when each was recorded and exported, and a `•` for clips changed since their last export.

Selection from the argument: a clip id, a comma-separated list, `all`, or `--changed` (clips whose file or the config changed since the last export). No argument: ask which, or take `--changed` when the user said "re-record what changed". Sub-clips (clip files with `take:`) are cut from another clip's take at export; they are never recorded themselves, so select the parent clip to re-record them.

Recording and export take minutes for long clips (an export renders every output size through the camera). Give each command a 10-minute timeout and run them one after the other; never two recordings at once.

## 1. Rehearse

```bash
ui-clips dry-run <selection> --project <dir>
```

Every locator must resolve, every action run, every `expect` pass, and the camera plan must have no problems (absent or off-screen targets, frames that cannot fit the aspect, clicks outside the planned frame, a closing framing that differs from the opening). A failure names the step. Stop here, quote the failing step and the message, and hand the fix to `/ui-clips:author-clip`; do not retry selectors blind.

## 2. Record, then export

```bash
ui-clips record <selection> --project <dir>
ui-clips export <selection> --project <dir>
```

Each clip records in a fresh browser context, so single-clip re-records are safe. `export` re-renders from the stored take; the camera can be re-rendered without re-recording (`--zoom gentle|pronounced|off`, `--feel brisk|calm|lazy`), and `--fast` is for iteration only (faster VP9, no GIF).

## 3. Verify every output before reporting

Read the export output (or `--json`) per clip. Every check must be ✓:

| Check | Means |
|---|---|
| `length` | within ±0.2 s of the target when the clip sets one |
| `loop return` / `loop crossfade` | first and last frames match within threshold, or the crossfade seam was built after a 0.4 s rest |
| `camera rest`, `loop camera rest` | every output size starts and ends at the opening framing |
| `clicks in frame` | every click lands inside the frame the viewer sees at that moment |
| `camera floor`, `stage` | no frame narrower than half the output width; nothing from `stage.exclude` appears |
| `mp4 size`, `gif size` | under the preset budgets (2 MB per 8 s at 1440 wide; GIF under 5 MB) |
| `mp4 timing` | the encoded frame count matches the timeline |
| `poster` | written (a lossless screenshot taken during a hold, rendered through the camera per size) |

A ✗ is reported as a failure, with the usual fix: size over budget → `quality.crf: 22` in the config; a loop that does not return → the steps must end in the start state, or use `loop: "crossfade"`; camera rest or clicks-in-frame → the shot list, back to `author-clip`.

## 4. Contact sheet

For each recorded clip, one frame per beat from the card size when the project has one, else the full size:

```bash
ui-clips sheet <id> --beats --size card --project <dir>
```

Read the sheet and check each cell shows what the clip's scenario says for that beat. Give the user its path (and send the file where a file-sending tool exists).

## 5. Report

`ui-clips list --project <dir>` for the state, then per clip: duration, the files in `out/` with sizes (MP4, WebM, posters, crops, GIF), the sheet, and anything that was ⚠ in the export output. `out/manifest.json` holds every file with its alt text, and `out/embed/<id>.html` the bare `<video>` snippet.
