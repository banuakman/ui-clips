# Making a clip without writing code

ui-clips turns a moment you describe into a short, silent clip of a live web page, plus a poster still and the crops a portfolio or a README needs. You say what should happen on screen; Claude writes the small recipe file; the engine performs it, identically, every time. Nobody has to know what a selector is.

This page follows one clip from start to finish on the plugin's demo page, a to-do list called Today. Everything here works the same on a published prototype or a deployed app.

## 1. One sentence is the brief

A clip is one moment: a start screen, a few actions in order, where to hold, how it ends. Say it the way you would to a colleague:

> The Today list → type "Book the studio" into Add a task → click Add → the row slides in → tick it → the label strikes through → hold.

If you have nothing yet, leave it empty: Claude looks at the page and proposes one in the same shape, and nothing is written until you say it reads right.

## 2. The first decision is the viewport

The viewport is the window the page is laid out in. It is **not** the clip size: the clip's sizes (full frame, a 4:5 card, a 16:9 crop) are all cut from this one recording by the camera. Pick it for the moment, not by habit:

- **Width:** the narrowest width at which nothing wraps. Rows on one line, no reflow when a panel opens. Wider makes the page smaller in a portrait card; narrower reflows the design.
- **Height:** tall enough to hold everything the camera will travel over. A detail panel that is taller than the window would have to scroll, and scrolling reads badly in a clip; a taller viewport lets the camera pan down the panel instead.

The default, 1440×900, suits most pages. The rehearsal (step 6) tells you when it does not.

## 3. Start a project

```
/ui-clips:new-clip-project ./clips-project http://127.0.0.1:4733/
```

One round of questions, each with a sensible default: page layout, output sizes (full frame, portfolio card 4:5, landscape 16:9), outputs (MP4 + WebM + poster, GIF as well), auto-zoom (gentle, pronounced, off), theme, cursor. Then `doctor` checks the tools and the page and prints the fix for anything missing. The folder gets a `clips.config.mjs` with every setting annotated, an empty `clips/`, and a short `CLAUDE.md` with the one working rule: this folder makes clips and never edits the plugin.

## 4. Author the clip

```
/ui-clips:author-clip todo-add The Today list → type "Book the studio" → Add → the row slides in → tick it → hold.
```

Claude inspects the page (the engine's own browser reads it, which is also how password-gated prototypes work), asks at most two or three things the sentence leaves open (how long, loop or not, zoom), and writes `clips/todo-add.clip.mjs`. The file is readable: the scenario sentence, the alt text, and one named beat per step, each with the visual change it must produce ("the row Book the studio is visible"). That expectation is what makes a re-record after a redesign fail loudly instead of recording the wrong thing.

## 5. Storyboard with screenshots, one anchor per shot

The fastest way to say how a clip should look is a screenshot per beat: the page as you want it framed at that moment, cropped the way the card should show it. Claude reads the framing off them. The camera has two kinds of shot, and a storyboard is a list of them:

- **Wide:** the whole page, or the page filling the frame from the top.
- **Focus on one thing:** the smallest frame of the output shape around one element, the **anchor**. The camera follows the anchor; other elements you name as extras only widen the frame while they are visible. One anchor per shot keeps the camera from re-aiming at something unrelated when a target scrolls away.

A tall panel is two shots: focus on its top, then focus on its bottom, and the camera pans between them. Every clip ends back at its opening framing, resting for a second, so loops close and the eye settles.

## 6. Rehearse, then look at the framing sheet before recording

The author-clip skill runs a dry run: every step is performed against the live page with no recording. The report says, per beat, which camera window the card will show and anything that would be wrong:

| It says | It means |
|---|---|
| a step failed | the page did not do what the scenario says; Claude goes back to the page, never guesses |
| target absent or off-screen | the thing the camera should frame is not on the page at that beat |
| a frame cannot fit the aspect | the anchor is too wide or too tall for the card at this viewport; a taller viewport or a top/bottom slice fixes it |
| a click lands outside the planned frame | the viewer would not see the click; the shot needs to include the button |
| closing framing differs from the opening | the clip does not end where it began |

Then the **framing sheet**: one row per beat, the page at the end of that beat with the planned camera window drawn on it, beside the crop the card will show. Judge framing here, on a drawing, before a minute of recording. Ask for changes in plain words ("get closer to the panel in beat 3", "show the button in the same frame as the status line"); the shot list changes, the page never does.

## 7. Record, export, check the real frames

```
/ui-clips:record-clips todo-add
```

Rehearsal again, then the recording (2× frames from a real Chromium), then the export: MP4 and WebM at each size, posters as PNG and WebP, a manifest with the alt text, and a bare `<video>` snippet. Every output is checked: length, loop seam, camera at rest at both ends, every click inside the frame, nothing cropped too tight, file size. The **beats sheet** shows one real frame per beat. If a check fails, the skill names it and the usual fix.

A design change later: `/ui-clips:record-clips --changed`.

## 8. Published prototypes (Figma Sites, Figma Make, Framer, Webflow)

- **Use the published URL.** A Figma Make "download code" export is not runnable as-is; the published site is a real page the engine can drive.
- **Password:** published figma.site URLs can be gated. Set `UI_CLIPS_PASSWORD` in the shell that runs the commands; the engine fills the gate once per clip. It never goes into a file.
- **Published state:** record only after the latest changes are published. A prototype that cuts instead of sliding, or re-wraps a table when a drawer opens, is a published-file issue to fix at the source, not in the clip.
- **"Made with Figma" badge:** some plans show one. `hideSelectors` in the config hides it; `inspect` confirms whether it is there.
- **Layout that fights the clip:** a panel whose bottom hangs below the window, a sticky bar over the content. The one allowed change to the recorded UI is a `cssOverrides` line that makes the real layout filmable, with your approval and a comment saying why, removed once the source is fixed. Copy, colours, spacing and transitions are never changed for a clip.
- Classic `figma.com/proto` prototypes are canvas-rendered and cannot be driven this way.

## 9. What good looks like

Text crisp at 100% on a retina screen (open the poster at full size). No camera move during a click. The clip starts and ends on the same framing. Nothing the design does not show (a sidebar, a logo) in any frame. Under about 2 MB for 8 seconds at 1440 wide. Two recordings of the same clip identical to the pixel.
