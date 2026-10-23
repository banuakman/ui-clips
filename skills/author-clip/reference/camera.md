# The camera plan

The page is recorded once at the viewport; every output size (`sizes` in the config: `full`, a 4:5 `card`, a 16:9 `landscape`…) gets its own camera track for its aspect, rendered from the 2× source. The camera moves over the page; it never scrolls it for the viewer. Explicit shots in the clip win over the auto camera in their window.

## Stage

`stage.exclude` lists what never appears in any frame: regions on an edge (a sidebar) are cut away, interior ones are masked with `stage.fill` and follow their element. The stage is what remains; all windows below are inside it.

## Shots

| Shot | Means |
|---|---|
| `h.shot("wide", { mode: "contain" })` | the whole stage fitted to the output width, top-aligned, fill below. Opening shot only. Small on a wide page in a portrait card. |
| `h.shot("wide", { mode: "cover", anchor: "left" \| "right" \| "center" \| locator \| trackName })` | the frame filled at full stage height, sides cropped, anchored. Top-aligned when the stage is taller than the frame, so a portrait card shows the top of the page. Default for any wide after the opening. |
| `h.shot({ anchor, extras: [...], padding: 24, align: "auto" \| "top" \| "bottom" }, { ms: 600 })` | a focus: the smallest frame of the output aspect around the anchor (plus visible extras), never narrower than half the output width. The window **follows the anchor**; extras widen it only while visible; nothing re-solves when a target leaves the viewport. |
| `align: "top"` / `"bottom"` on an anchor taller than its frame | a slice of it, as wide as the anchor: the top of a drawer, then its bottom. The camera pans; the drawer does not scroll. |
| `h.shot("opening", { ms: 600 })` | back to the first framing. Every clip ends here. |

Anchors and extras are locators (box measured when the shot is logged) or names from `h.track(name, locator)` (box sampled every frame). An anchor that is off-stage when the shot starts hugs the edge it will enter from and the window follows it in.

Moves ease in-out over `ms` (600 is the house pace); every shot holds at least 600 ms; a click inside a move is flagged. The first shot applies from t = 0 with no move. `camera: { ease: "smooth" }` (project config or clip) swaps the default cubic ease for a sine ease whose zoom is geometric, so a long push in or pull out reads at an even rate; leave it on `"cubic"` for short moves. A shot logged after an `h.trim` lands at the cut, as do marks and clicks.

## Rules the export checks (spec §13)

- **Rest**: every size starts and ends at the opening framing; a crossfade loop rests there 0.4 s before the fade. So: `h.shot("opening")` then `h.hold(≥ 1200)` (+ 400 for a crossfade).
- **Clicks in frame**: every click lands inside the frame the viewer sees. Plan the shot that contains the button before clicking it; widen with `extras` when a click and its result are apart.
- **Floor**: no frame narrower than half the output width in CSS px (`gentle` zoom reaches 1.6×, `pronounced` 2.2×). A size may opt out with `upscale` (1 to 2, for example `square: { width: 600, height: 600, scale: 2, upscale: 1.5 }`): the floor divides by it, so a small widget can fill a square or portrait card from a frame upscaled up to that factor. Text goes softer the further above 1; the floor check names the cap in force.
- **Stage**: nothing from `stage.exclude` in any frame; a focus frame that fits the stage stays inside it.
- **Timing**: ±0.2 s of a `length` target; no dead frames longer than the scripted holds.

The dry run reports the plan per beat and these problems before anything is recorded; `sheet --framing` draws it.

## Choosing the viewport (the pilot's lesson)

The viewport is the layout, not the clip size. Choose it for the moment:

1. **Width**: the narrowest width at which nothing wraps (table rows on one line, no reflow when a drawer opens). Wider makes the page smaller in the card; narrower reflows the UI.
2. **Height**: tall enough to hold everything the camera will pan over without scrolling: a drawer's full content before and after the action that grows it, a long form. Measure in the rehearsal: a beat whose target is off-screen or whose frame cannot fit says the viewport is too short.
3. **Opening**: on a portrait card, a top-anchored `cover` wide shows the top of the page at a readable size, with the page's own white below; `contain` shows all of it, small.
4. **Scale**: 2× by default; above about 10 MP per frame the config uses 1.5× (the screencast drops below 20 fps at 2×), which still exceeds a 960-wide card.

A drawer worth reading top to bottom: `focus(drawer, align: "top")`, hold, `focus(drawer, align: "bottom")`, then the clicks inside that bottom frame, then `opening`.

## Auto camera

With no `h.shot` calls and `zoom` on, the action log drives the camera at export: two actions within 3 s or a dwell over 1.5 s open a shot on the cluster, the shot grows while actions land near it, an action further out than a quarter of the shot's width starts a new shot, a box wider than 65% of the stage stays wide, and the camera rests before the end. Good for a clip of two or three clicks in one region; explicit shots for anything storyboarded. `camera.feel` sets the spring: `brisk` (about half a second), `calm` (just under a second, default), `lazy`.

Re-render the camera without re-recording: `ui-clips export <id> --zoom pronounced --feel brisk`.

## Posters and sheets

Posters and sheet cells render through the camera per size at their moment, using the window a move settles on. `poster` names the beat whose still should stand in for the clip (the state worth reading, not a move). `sheet --framing --size card` before recording; `sheet --beats --size card` after.
