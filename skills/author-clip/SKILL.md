---
name: author-clip
description: Turn a moment in a web UI, described in plain words, into a ui-clips clip file. Inspects the page for real locators, writes clips/<id>.clip.mjs with expectations and a camera plan, rehearses it (dry-run) and shows the framing sheet before anything is recorded.
argument-hint: "[clip-id] [the moment in plain words]"
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Bash(ui-clips *), Bash(ls *), Bash(mkdir *)
---

# author-clip

One clip file per moment. The file is small and readable; it states the scenario, the visual change every step must produce, the alt text and the camera plan. Nothing is recorded here: the result is a rehearsed clip and a framing sheet, then `/ui-clips:record-clips` records it.

Read [reference/clip-file.md](reference/clip-file.md) before writing a file, [reference/locators.md](reference/locators.md) before choosing a locator, and [reference/camera.md](reference/camera.md) before planning shots. They hold the rules; this file holds the loop.

## 0. Project

The project is the folder with `clips.config.mjs` (the current folder, or `--project <dir>` on every command). If there is none, run `/ui-clips:new-clip-project` first. Read the config once: the viewport, the output sizes (`sizes`), the stage exclusions and the zoom default decide the camera plan.

## 1. Scenario: agreed before anything is written

First question, and the only one at this stage: **describe the moment in your own words**: the start screen, the actions in order, where to hold, how it ends. Skip it when the request already says it.

If the description is empty, propose one: run `inspect` on the start route (step 2), read what is on the page, and write **one** scenario in the same plain shape (start screen → actions → holds → ending), three to six beats, 6 to 12 seconds. Offer it; iterate until the user says it reads right. In a non-interactive session the request is the scenario.

## 2. Inspect: locators come from the page, never from memory

```bash
mkdir -p <dir>/.cache/inspect
ui-clips inspect <route-or-url> --project <dir> > <dir>/.cache/inspect/<slug>.json
```

The JSON lists every visible text with its element path, count, clickability, implicit role, and ranked locator candidates (text → structure relative to text → role/name), plus the ARIA snapshot (often thin on Figma-published pages). It can be long: Grep it for each text the scenario names, then Read around the hits. Pick locators only from `locators[]`; scope any text whose `count` is above one (see locators.md).

For a state that exists only after an action (a drawer's contents, a dialog, the next step of a flow), write the steps up to that point with a mark, then inspect the page in that state:

```bash
ui-clips inspect <clip-id> --at <mark> --project <dir> > <dir>/.cache/inspect/<clip-id>@<mark>.json
```

## 3. Ask: two or three questions at most, each with a proposal

Only what the scenario leaves open, in one `AskUserQuestion` call: **how long** (a target in seconds, or "as long as it takes"), **loop** (none, return to the start state, crossfade), and a **zoom override** only when the project default does not fit (a clip with no clicks worth closing on → off). One extra question only when the scenario itself is ambiguous (which row, which item). Skip every question the request already answers.

## 4. Write `clips/<id>.clip.mjs`

Per clip-file.md: kebab-case id, `title`, the `scenario` sentence, `alt` text that describes what a viewer sees, `start` route, `length`, `loop`, `poster` (a mark name, chosen for the still that stands in for the clip), and `steps`:

- Locators declared at the top of `steps`, each from the inspection; `h.track(name, locator)` for anything the camera will follow.
- One `h.mark("b<n>-<beat>")` per beat, in order, before the beat's actions. Marks name the framing sheet's rows, posters and sub-clip boundaries.
- Every action with an `expect` that names its visual change; `h.waitForMotion()` after anything that animates; `h.hold(ms)` where the scenario says to hold.
- The camera plan per camera.md: an opening shot first, focus shots on an anchor, and `h.shot("opening")` at the end followed by the rest hold.
- Dates and clocks: `freezeTime` on the clip when the UI shows a date, so re-records match.

## 5. Rehearse until clean

```bash
ui-clips dry-run <id> --project <dir>
```

Every locator must resolve, every action run, every `expect` pass, and the per-beat camera report must show no problems. Read the output, not just the exit code:

| Report says | Fix |
|---|---|
| a step failed, a locator matched nothing or several | back to the inspection (or `inspect --at` the mark before it); never try selectors blind |
| an `expect` failed | the change the step produces is different from what was written: look at the beat screenshot in `.cache/<id>/rehearsal/`, then fix the expectation or the step |
| target absent or off-screen at a beat | the anchor is not on the page at that moment: move the shot, scroll first, or track an element that exists |
| a frame cannot fit the aspect without fill | a smaller anchor, `align: "top"` or `"bottom"` on a tall one, or a taller viewport (camera.md) |
| a click lands outside the planned frame | widen the shot with an `extras` target, or move the shot before the click |
| closing framing differs from the opening | end with `h.shot("opening")` and a hold of at least 1.2 s (1.6 s with a crossfade loop) |

## 6. Preview the framing before any recording

```bash
ui-clips sheet <id> --framing --size card --project <dir>
```

(`--size` names one of the config's camera sizes; `full` when there is no card.) The sheet shows, per beat, the stage frame with the planned camera window drawn on it beside the crop that window gives. Read it and check each row shows what the scenario says for that beat. Give the user the path (send the file where a file-sending tool exists) and ask whether the framing is right. Change the shot list, not the UI, until it is.

Then record with `/ui-clips:record-clips <id>`, which also builds the beats contact sheet from the real frames.

## 7. Report

The clip file path, the scenario sentence, the beats with their marks, what the rehearsal reported, the framing sheet path, and the one command to record.
