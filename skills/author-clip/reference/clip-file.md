# The clip file

One file per clip, `clips/<id>.clip.mjs`, a default export. Read by the engine with `--project <dir>`; the `ui-clips` command never needs the file's path, only the id.

```js
export default {
  id: "rm-home",
  title: "Detection opens beside the feed",
  scenario: "Feed (wide) → View on the Critical row → the drawer slides in → push to the drawer → Run agent fix → Apply → the status updates → pull out → loop.",
  alt: "An alert activity feed; opening a Critical finding slides in a detail panel with an AI-generated explanation, then an agent fix is staged and the finding's status updates.",
  start: "/activity/vat-compliance-monitor",   // route under baseUrl, or a full URL
  freezeTime: "2026-04-14T09:02:00Z",          // optional: the page clock, fixed before navigation
  length: "natural",                            // or a target in ms: the final hold is padded to hit it
  loop: "crossfade",                            // "none" | "return" | "crossfade"
  poster: "b3-drawer-top",                      // "start" | "end" | ms | a mark name
  zoom: "gentle",                               // optional override of the project default: "off" | "gentle" | "pronounced"
  camera: { feel: "calm" },                     // optional override: "brisk" | "calm" | "lazy"
  crops: {},                                    // optional extra output sizes for this clip, same shapes as the config's sizes
  steps: async ({ page, h }) => {
    const row = page.locator("tr", { hasText: "Missing buyer VAT ID" }).first();
    const drawer = page.getByRole("heading", { name: "Detection Detail" }).locator("xpath=ancestor::div[contains(@class, 'border-l')][1]");
    h.track("drawer", drawer);

    await h.mark("b1-feed");
    await h.shot("wide", { mode: "cover" });
    await h.hold(1200);
    await h.mark("b2-view");
    await h.click(row.getByText("View", { exact: true }), { expect: () => h.visible(page.getByText("What happened", { exact: true })) });
    await h.waitForMotion();
    await h.hold(1500);
    await h.mark("b3-drawer-top");
    await h.shot({ anchor: "drawer", align: "top", padding: 24 }, { ms: 600 });
    await h.hold(2000);
    // …
    await h.mark("b8-pull-out");
    await h.shot("opening", { ms: 600 });
    await h.hold(600 + 1200 + 400);               // the move, the rest, the crossfade
  },
};
```

## Fields

| Field | Values |
|---|---|
| `id` | kebab-case, unique in the project, also the output file stem |
| `title`, `scenario`, `alt` | `scenario` is the agreed sentence (start → actions → holds → ending), kept so a later reader sees the intent; `alt` describes what a viewer sees, for the manifest and the `<video>` snippet |
| `start` | route under `baseUrl` (or a full URL) |
| `length` | `"natural"` (as long as the steps) or a target in ms (±0.2 s is checked at export) |
| `loop` | `"return"`: the steps end in the start state and export trims to the matching frame; `"crossfade"`: the last 400 ms blend into the head after a 0.4 s rest; `"none"` |
| `poster` | the still that stands in for the clip: a mark name is the clear choice; the engine takes a lossless screenshot at the next hold after the mark |
| `zoom`, `camera` | per-clip overrides of the project defaults |
| `freezeTime` | ISO date; use it whenever the UI shows a date or time |
| `take`, `from`, `to` | a **sub-clip**: cut from another clip's take between two marks (or `"start"` / `"end"` / ms), with its own id, poster and manifest entry; never recorded itself. `{ id: "rm-resolve", take: "rm-home", from: "b4-drawer-bottom", to: "end", loop: "none", poster: "b7-status" }` |

## Helpers in `steps({ page, h })`

| Helper | Does |
|---|---|
| `h.click(locator, { expect })` | bezier cursor move, pause, press, release; then `expect` must hold within 3 s |
| `h.hover(locator, { holdMs })` | move and dwell (default 900 ms) |
| `h.type(locator, text, { cps, click })` | click the field (unless `click: false`), step the cursor aside, type at 12 chars/s |
| `h.press(key, { expect })` | Enter, Escape, Tab… |
| `h.select(locator, optionText)` | native `<select>` or a custom dropdown |
| `h.scrollBy(px, { within })`, `h.scrollTo(locator, { within, align, ifNeeded })` | smooth wheel scroll; `within` names the scrolling container; the camera never scrolls for the viewer, so scroll only when the scenario shows scrolling |
| `h.hold(ms)` | hold the frame; a pending poster is taken at the start of a hold without stretching it |
| `h.waitForMotion()` | wait for CSS animations and transitions to finish (ignores the cursor) |
| `h.visible(l)`, `h.hidden(l)`, `h.text(l, s)` | expectations for `expect` |
| `h.mark(name, { focus })` | name a moment: framing-sheet row, poster, sub-clip boundary; `focus` records a target box for static crops |
| `h.shot(spec, { ms })` | explicit camera keyframe (camera.md) |
| `h.track(name, locator)` | sample a target's box every frame so a focus shot can follow it |
| `h.speed(factor, fn)` | the stretch inside `fn` plays `factor`× faster at export (a long stepper, slow typing) |
| `h.trim(fn)` | run `fn` but cut its wait from the video |
| `h.parkCursor()` | ease the cursor off and fade it out (before a `return` loop's end) |

## Rules

- **Every action states its visual change.** `expect` is what the dry run proves and what makes a re-record after a redesign fail loudly instead of recording the wrong thing. Prefer an accessible state (`aria-selected`, `aria-pressed`, visible text). Prototypes often expose none: fall back to a class or style and say so in a comment next to the `expect`, so a later reader knows the check is cosmetic:
  ```js
  // selection is CSS-only in this prototype: the grey fill class is the only state
  expect: async () => { await h.visible(staging); return staging.evaluate((b) => b.className.includes("bg-gray-100")); },
  ```
- **Marks per beat, in order, named `b<n>-<what>`.** They are the rows of the framing sheet and the beats sheet, so a reviewer can say "beat 4 is wrong".
- **Holds are the rhythm.** 1.2 s on the opening, 1.5 to 2 s on a state worth reading, 0.6 s after a camera move, at least 1.2 s at rest at the end (plus 0.4 s for a crossfade loop). A `length` target pads only the final hold.
- **The UI is never changed for a clip.** `cssOverrides` and `hideSelectors` in the config are for badges and the like; a layout that fights the clip is a viewport question (camera.md), and a real defect is reported to the user, not patched.
- **Dates.** `freezeTime` whenever a date, a clock or "x minutes ago" is on screen.
- **Nothing secret in a clip file.** Passwords come from `UI_CLIPS_PASSWORD`.
