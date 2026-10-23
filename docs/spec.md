# ui-clips: Claude Code plugin spec

**Date:** 2026-10-21, last revised 2026-10-23 · **Owner:** Banu Akman (github.com/banuakman) · **Status:** describes the plugin through M3 (main at a70f2d9); M4 next
**Working name:** `ui-clips` (rename before the first public release if you prefer)
**Companions:** `2026-10-21-ui-clips-plugin-spec-appendix.md` holds the research behind the decisions, exact ffmpeg presets, cursor and camera parameters, the Claude Code plugin reference, and the next iteration's pipeline; read the appendix section a spec section points to before building that part. `2026-10-23-ui-clips-pilot-log.md` holds the history of every clip project made with the plugin.

This document is the single source of truth for the plugin. Where it names folders or file names, treat them as suggestions unless a section says otherwise; where it names formats, commands and quality checks, treat them as the contract. It changes when a contract changes, not with every learning: lessons go to the pilot log, fixes to the changelog, and a feature comes here when a user can see it. One spec carries the plugin across versions; a new spec is written only for a new surface (the narration and walkthrough iteration, §17). Once §16 holds no client-specific content (from 2026-10-23), this file can live in the repo as `docs/spec.md` and version with the code.

---

## 1. What it is

A Claude Code plugin that records **short, silent clips and stills of any web UI** from a written scenario, so they can be re-recorded in one command whenever the design changes.

You describe the moment in your own words: "the VAT Compliance Monitor feed → click the Critical row → the drawer slides in → hold on 'What happened · AI-generated insight' → loop." Or you leave it empty and let Claude look at the UI and propose one. The plugin asks the few things it cannot infer (how long, loop or not, which size, cursor or no cursor, zoom), Claude turns the scenario into a small script against the live page, and the engine drives Chromium, captures sharp 2× frames, and exports web-ready video with a gentle camera move onto the action, posters and crops, plus a manifest with alt text.

**Who it is for:** designers and developers alike. Anyone who can say what should happen on screen can make the clip; nobody has to know what a selector is. Typical uses: portfolio and case-study clips, design reviews, stakeholder updates, PR and release-note clips, README GIFs, docs, regression snapshots of interaction states.

**What a clip is:** one scenario, one small file, one set of outputs. There are no chapters, no title cards and no final cut; every clip starts on the UI and stands on its own.

**Targets:** any reachable URL, including published prototypes (Figma Make / Figma Sites, Framer, Webflow), preview deploys (Vercel, Netlify), and `localhost`.

## 2. Target reality (appendix A and G)

- **Figma Sites and published Figma Make apps are real DOM pages**, so Playwright can drive them. But Figma emits layers as `div`, text as `p` and click interactions as `button`; audits found aria-labels on role-less divs and images without alt. Role/name locators mostly do not exist there. Plan for text and structure.
- **Published figma.site URLs can be password-protected** (a server-side gate). The project config takes an optional `password`; the engine fills the gate before the first clip.
- **Some plans show a "Made with Figma" badge.** `hideSelectors` covers it; the scaffold adds a candidate rule and the inspect step confirms whether the badge is present.
- **figma.site blocks automated fetchers** (robots). Claude cannot read the page with a fetch tool; inspection goes through the engine's own browser (`inspect`, §11).
- **A Figma Make "download code" export is not runnable as-is** (source only, no `package.json`, versioned import specifiers). Treat localhost-from-Make as best effort; prefer the published URL. Running a repo on `localhost` is fully supported when the repo runs on its own.
- **Classic `figma.com/proto` prototypes are canvas-rendered.** No DOM, no locators. The only programmatic route is Figma's Embed API from a local wrapper page; that is a later feature (§17), not v1.
- **Figma's MCP `export_video`** renders keyframe timelines on a frame, not interactive flows. Not a shortcut for this.

## 3. Non-goals (v1)

- Narration, voiceover, title cards or long walkthroughs. Narration is the next iteration (§17).
- A timeline editor, music, or hosting.
- Logging into real accounts or handling credentials. Targets are public, password-gated prototypes, or local.
- How the clip behaves on the site that embeds it: `prefers-reduced-motion`, play controls, lazy loading. That is the portfolio site's design, not the plugin's. The plugin delivers files, alt text and a bare snippet.
- Changing the recorded UI for the video. The one exception is a **layout fix that makes the real UI filmable** (a panel whose height hangs below the viewport, a sticky element covering content), applied as a `cssOverrides` line with the user's approval and a comment saying why, and removed once the source is fixed. Copy, colours, spacing and transitions are never changed by the plugin.

## 4. Principles

1. **Scripted, not performed.** A hand-made screen recording is a performance: the mouse hesitates, no two takes match, and a design change means recording everything again. Here the clip is a short recipe in a small text file (open this page, click "View", wait for the drawer, hold, close). The computer performs the recipe identically every time, a change to the clip is a change to one line, and when the prototype changes one command re-records every clip.
2. **Crisp by default.** 2× pixel density with high-quality capture. UI text must be sharp on a retina screen at 100%.
3. **Small and web-ready.** Silent, fast-start MP4 plus WebM, poster images, and sensible sizes (guide: under 2 MB for an 8s clip at 1440 wide).
4. **Loops cleanly when asked.** Loop and length are per-clip choices. When a clip loops, there is no cursor jump and no visible seam; when it doesn't, it ends on a deliberate frame.
5. **Ask, don't assume.** The plugin asks short questions for what it cannot infer (scenario, length, loop, size, cursor, outputs, zoom) and proposes sensible answers. It never asks for a selector.
6. **Described, not guessed.** Every clip carries alt text and a poster, and every step states the visual change it should produce, so rehearsal can prove the clip shows what the scenario claims.
7. **App-agnostic.** Nothing about a specific product lives in the plugin. Clip projects and their outputs live next to the user's work, never inside the plugin folder.
8. **Readable by anyone.** One small file per clip, plain-language step names, and Claude does the selector work.

## 5. Suggested layout

A starting point, not a requirement. Claude Code may organise the code differently as long as the contracts hold: the config and clip file formats (§7), the helper API (§8), the commands (§11), and the quality bar (§13).

```
ui-clips/
├── .claude-plugin/
│   ├── plugin.json            # name, version, description, author, license, keywords, homepage, repository
│   └── marketplace.json       # repo doubles as its own single-plugin marketplace
├── package.json               # engine deps (playwright, pixelmatch, pngjs); Claude Code runs `npm ci` from the lockfile
├── package-lock.json
├── bin/
│   └── ui-clips               # thin launcher → engine/cli.mjs (lands on the Bash PATH)
├── skills/
│   ├── new-clip-project/SKILL.md
│   ├── author-clip/SKILL.md
│   └── record-clips/SKILL.md
├── agents/
│   └── clip-explorer.md       # stub for the next iteration: explores an unfamiliar app, drafts a storyboard
├── engine/                    # as built through M3
│   ├── cli.mjs                # init | doctor | inspect | dry-run | sheet | record | export | list
│   ├── config.mjs             # defaults + project config and clip loading
│   ├── scaffold.mjs           # `init`: an annotated clips.config.mjs, clips/, CLAUDE.md
│   ├── browser.mjs            # launch (forced device scale), context, init CSS, password gate
│   ├── serve.mjs              # static server for local sites (the demo)
│   ├── inspect.mjs            # visible text, ARIA snapshot, candidate locators as JSON (§6.2)
│   ├── run.mjs                # runs a clip's steps in dry or record mode
│   ├── helpers.mjs            # the `h` API (§8)
│   ├── cursor.mjs             # injected arrow cursor
│   ├── motion.mjs             # bezier moves, easing
│   ├── capture.mjs            # screencast frames, action log, marks, tracks, lossless poster (§9)
│   ├── rehearsal.mjs          # per-beat camera report, beat screenshots, measured target boxes
│   ├── retime.mjs             # damage-driven frames → constant fps timeline; trims
│   ├── timemap.mjs            # take time → output time (trims, then speed ramps)
│   ├── stage.mjs              # stage exclusions, masks, fill
│   ├── camera.mjs             # auto clusters, explicit shots, spring, per-frame windows (§10.3)
│   ├── loop.mjs               # return check (pixelmatch) and crossfade
│   ├── export.mjs             # intermediate encode, camera render, crops, presets, posters, manifest (§10)
│   └── sheet.mjs              # framing sheet (from the rehearsal) and beats sheet (from the take)
├── evals/                     # `claude plugin eval` cases: scaffold, author, record on examples/todo-demo
├── examples/
│   ├── _template/             # clips.config.mjs + clips/example.clip.mjs
│   └── todo-demo/             # a public demo page clip, used by evals and the README
├── docs/
│   ├── designers.md           # "ask Claude" quickstart, no code required
│   └── developers.md          # API reference, config, CLI, evals
├── .github/CODEOWNERS         # * @banuakman
├── README.md                  # opens with a looping clip the plugin made of itself
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE                    # Apache 2.0
└── NOTICE
```

**Why there is no `hooks/` folder.** A hook is a script that runs automatically at a set moment, such as every session start. The only job one would do here, installing the engine's dependencies, is something Claude Code now does itself when a plugin is installed from a marketplace (it reads `package-lock.json` and runs the install). A hook would repeat that work on every start and hide its failures. If a later feature needs a hook, add it then.

The plugin root is replaced on every version, so nothing is written there: takes and caches live in the clip project's `.cache/`, browsers in Playwright's cache (§12). The public demo (`examples/todo-demo`) is a static site the engine serves locally, so evals need no network. `.gitignore` keeps `node_modules/`, `.cache/` and every `out/` out of the repo. (Appendix F has the manifest, marketplace and skill-frontmatter examples.)

Install:
```bash
claude plugin marketplace add banuakman/ui-clips
claude plugin install ui-clips@ui-clips
```

## 6. Skills

### 6.1 `new-clip-project`
Creates a clip project in the user's folder (default `./clips-project/` or a named folder).

- **Interview** (AskUserQuestion, one round, every option with a proposed default):
  - Target URL (and a password if the published prototype has one).
  - Page layout (the viewport the page is laid out in): Desktop 1440×900 (preselected), Wide 1920×1080, Custom. This is not the clip size; a narrow viewport would reflow the UI. **The viewport is chosen for the moment** (the pilot's lesson): the narrowest width at which nothing wraps, and tall enough to hold everything the camera will pan over without scrolling (a drawer's full content before and after the action that grows it). The skill proposes a size from the inspection rather than assuming the default; the rehearsal says when the viewport is too short.
  - Output sizes (what files come out; several allowed): Full frame (preselected), Portfolio card 4:5 (480×600, exported at 960×1200 for retina), Custom.
  - Theme: light, dark, or as the site is.
  - Cursor: arrow (preselected), arrow in a brand colour, dot, or hidden.
  - Outputs: MP4+WebM+poster (preselected), plus GIF, plus a landscape crop.
  - Auto-zoom: gentle (preselected), pronounced, or off (per project default; each clip can override).
- Writes `clips.config.mjs` and an empty `clips/` folder (through `ui-clips init <dir> --url … --viewport … --sizes … --outputs … --zoom … --theme … --cursor …`, so the answers map onto one deterministic command; every key in the written config is annotated), plus a `CLAUDE.md` carrying the clip-session working rule (§14): this folder makes clips and never edits the plugin; problems are filed as issues, not patched.
- Runs `doctor`: checks the URL is reachable (and the password works), that Node, ffmpeg/ffprobe and Chromium are present, and says exactly what's missing and how to install it.

### 6.2 `author-clip`
Turns a scenario into a clip file.

1. **Scenario.** First question: describe the moment in your own words (start screen, the actions in order, where to hold, how it ends), or leave it empty. If empty, Claude runs `inspect` on the start route, proposes one scenario in the same plain shape, and the user confirms or iterates until it reads right. Nothing is written before the scenario is agreed. Reference screenshots are welcome: a few crops of how each beat should look are the most precise storyboard a user can give (deriving shots from them directly is a next-iteration item, §17).
2. **Inspect.** Runs `inspect <url>` and reads the JSON: visible text with its element path, the ARIA snapshot (often thin on Figma-published pages), and candidate locators ranked **text → structure (CSS relative to text) → role/name**. Claude never guesses a locator it has not seen in the inspection. For a state that exists only after an action (a drawer's contents, a dialog), `inspect <clip> --at <mark>` runs the clip's steps in a dry run, stops at that mark and inspects the page there.
3. **Ask.** Two or three questions at most, with proposals: how long (a target in seconds, or "as long as it takes"), loop or not (and which kind), zoom override if the project default doesn't fit. One extra question only if the scenario itself is ambiguous (for example, which row to open).
4. **Write** `clips/<id>.clip.mjs` (§7.2) with named steps, the expected visual change for each step, alt text, and the chosen length and loop.
5. **Rehearse.** Runs `dry-run` for that clip: every locator resolves, every action runs, every `expect` passes, no capture. The dry run also reports the camera plan per beat: targets that are absent or off-screen at that moment, windows that cannot fit the aspect, clicks outside the planned frame, and opening and closing framings that do not match; it takes a 1× screenshot at the end of each beat (the beat's settled state) and stores each beat's measured target boxes. Fixes failures by going back to the inspection, not by trying selectors blind.
6. **Preview.** Renders the **framing sheet** (`sheet --framing`, from the dry run's beat screenshots: each beat's stage frame with the planned camera window drawn on it beside the card crop) and, after a recording, the **contact sheet** (`sheet --beats --size card`), so the user and Claude see the framing before a full record and the real frames after.

### 6.3 `record-clips`
Records and exports one clip, a list, or `all`.

1. Dry run, then capture (§9), then export (§10).
2. **Verifies each output** before reporting:
   - length within ±0.2 s of the target when a target was set;
   - when the clip loops: first and last frames match within threshold (`return`), or the crossfade seam was built (`crossfade`);
   - file sizes are under the preset targets;
   - a poster exists.
3. Writes `out/manifest.json` (§10.5) and prints the output paths.
- Partial runs: `record-clips rm-home`, `record-clips --changed` (clips whose file or config changed since the last export). Each clip records in a fresh browser context, so single-clip re-records are safe.

## 7. Project contract

### 7.1 `clips.config.mjs`
```js
export default {
  baseUrl: "https://example.figma.site",
  password: process.env.UI_CLIPS_PASSWORD,     // optional; published-prototype gate only
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  fps: 30,
  cursor: { style: "arrow", color: "#1f2937", size: 22, ripple: true },  // "arrow" | "dot" | "none"
  zoom: { mode: "gentle" },                     // "gentle" | "pronounced" | "off" (§10.3)
  outputs: ["mp4", "webm", "poster"],           // + "gif"
  sizes: {                                      // output sizes every clip gets; clips may add or override crops (§10.2)
    full: true,
    card: { width: 480, height: 600, scale: 2, focus: "auto" },   // 4:5, exported at 960×1200
    // square: { width: 480, height: 480, scale: 2, focus: "auto", upscale: 1.25 },  // upscale: opt-in, capped at 2 (§10.3)
  },
  camera: { feel: "calm", ease: "cubic" },      // feel: "brisk" | "calm" | "lazy"; ease: "cubic" | "smooth" (§10.3)
  stage: null,                                  // optional: { exclude: ["nav.sidebar"], fill: "#FFFFFF" } (§10.3)
  quality: { crf: 20, webmCrf: 30, maxWidth: 1440 },  // export width; capture stays at 2× (1.5× above ~10 MP per frame, §9)
  hideSelectors: [],                            // elements hidden in every clip (dev banners, badges)
  cssOverrides: "",                             // layout fixes only, with a comment saying why (§3)
  waitForFonts: true,
};
```

### 7.2 One file per clip: `clips/<id>.clip.mjs`
```js
export default {
  id: "rm-home",
  title: "A finding, explained and staged for a fix",
  scenario: "Feed → View on the Critical row → the drawer slides in → close on the drawer top → pan to the bottom → Run agent fix → Apply Resolution → the stepper runs → status reads Staged · Pending Review → back to the opening → loop.",
  alt: "An alert activity feed; opening a Critical finding slides in a detail panel with an AI-generated explanation, then an agent fix is staged and the finding's status updates.",
  start: "/activity/vat-compliance-monitor",
  length: "natural",              // target ms, or "natural" (the clip is as long as its steps)
  loop: "crossfade",              // "return" | "crossfade" | "none"
  poster: "b3-detail",            // which frame becomes the still: "start" | "end" | ms | mark name
  freezeTime: "2026-04-14T09:02:00Z",
  zoom: "gentle",                 // optional override of the project default; explicit shots below win in their window
  narration: null,                // reserved for the next iteration; ignored in v1
  steps: async ({ page, h }) => {
    // Locators come from `inspect`, never from memory; two rows share the trigger text, so the row is scoped.
    const row = page.locator("tr", { hasText: "Missing buyer VAT ID" }).first();
    const drawer = page.locator(".overflow-y-auto", { has: page.getByText("Detection Detail") });
    h.track("drawer", drawer);                                   // the camera follows this box every frame

    h.mark("b1-feed");
    h.shot("wide", { mode: "cover", anchor: "top" });            // opening framing, from t = 0
    await h.hold(1200);

    h.mark("b2-open");
    await h.click(row.getByText("View", { exact: true }), { expect: () => h.visible(page.getByText("What happened")) });
    await h.waitForMotion();                                     // the camera stays still while the drawer slides
    await h.hold(1500);

    h.mark("b3-detail");
    h.shot({ anchor: "drawer", align: "top" }, { ms: 600 });     // Detection Detail, What happened, What was detected
    await h.hold(2000);

    h.mark("b4-resolve");
    h.shot({ anchor: "drawer", align: "bottom" }, { ms: 600 });  // Resolve this anomaly through the Status line
    await h.hold(600);
    await h.click(page.getByText("Run agent fix"), { expect: () => h.visible(page.getByText("Apply Resolution")) });
    // Selection is CSS-only in this prototype, so the check reads a class (cosmetic, see §7.2 rule).
    await h.click(page.getByRole("button", { name: "Apply Resolution" }), { expect: () => h.visible(page.getByText("Resolution submitted")) });

    h.mark("b5-stepper");
    await h.speed(3, () => h.waitForMotion({ timeout: 6000 }));  // the stepper's 4.5 s shown in 1.5 s
    await h.hold(1500);                                          // status reads Staged · Pending Review

    h.mark("b6-close");
    h.shot("opening", { ms: 600 });                              // the row now reads Staged · Pending Review
    await h.hold(1600);                                          // rest ≥ 1.2 s, +0.4 s for the crossfade
  },
};
```

Marks name the beats: they label the framing-sheet rows, the poster and sub-clip boundaries. Shots are keyed to the take's clock, mapped to output time through trims and speed ramps at export (§10.2).

**Poster, in plain words:** the still image that stands in for the clip. Browsers show it before the video plays or when it cannot load, and it doubles as the case-study still. `poster` says which frame to use. The scenario text is kept in the file so a reader (or a later re-author) sees the intent, not only the code.

**Authoring rule for expectations:** prefer an accessible state (`aria-selected`, `aria-pressed`, visible text). When the UI exposes none, as prototypes often do, fall back to a visual class or style and say so in a comment next to the `expect`, so a later reader knows the check is cosmetic.

## 8. Helper API (`h`)

| Helper | Does |
|---|---|
| `h.moveTo(locator, { ms })` | Cursor move along a slight bezier arc, easeOutQuart, 400–1200 ms scaled by distance (no teleporting, no straight line) |
| `h.click(locator, { expect })` | `moveTo`, short pause, press with ripple, release; then runs `expect` and fails the step if it does not hold |
| `h.hover(locator, { holdMs })` | Move and dwell, for tooltips and hover states |
| `h.type(locator, text, { cps })` | Click into the field, ease the cursor a little down and to the right so the caret and the words stay visible, then type at a human pace (default about 12 characters per second) |
| `h.select(locator, optionText)` | Open a custom dropdown and pick an option, with visible motion |
| `h.scrollBy(px, { within })` | Smooth wheel scroll of the page or a scroll container (e.g. a drawer) |
| `h.scrollTo(locator, { within, align })` | Smooth scroll until the element is in view |
| `h.press(key, { expect })` | Press a key (Enter, Escape, Tab) and run `expect` |
| `h.track(name, locator)` | Record the target's on-screen box on every frame of the take, so a camera shot can follow it when it moves or scrolls (§10.3) |
| `h.speed(factor, fn)` | Run a step; at export that stretch of the take plays `factor`× faster with smooth motion (§10.2) |
| `h.hold(ms)` | Hold the frame |
| `h.waitForMotion({ timeout })` | Wait until running CSS animations and transitions finish (`getAnimations()`), then two animation frames |
| `h.visible(locator)` / `h.hidden(locator)` / `h.text(locator, string)` | Expectations for `expect` |
| `h.mark(name)` | Name a beat (framing-sheet row, poster, sub-clip boundary, crop focus). A lossless screenshot is taken at the next hold only when a sub-clip names the mark as its poster, since each costs about 0.9 s of hold |
| `h.trim(fn)` | Run a step but cut its wait from the video (slow loads). Everything timed after the cut (shots, marks, clicks, tracks, poster, sub-clip ranges) is shifted by the trimmed length at export through the take time map (§10.2) |
| `h.shot("wide" | "opening" | { anchor, extras, padding, align }, { ms, mode, anchor })` | Explicit camera keyframe at this point of the take, rendered at export (§10.3). `"wide"` is `contain` as the opening shot and `cover` afterwards (`anchor`: left, right, center, top, a locator or a tracked name); `"opening"` returns to the first framing; `align: "top" | "bottom"` on an anchor taller than the frame shows that slice. `h.zoomTo` / `h.zoomOut` remain as shorthands; auto mode does this on its own when no explicit track exists |
| `h.parkCursor()` | Ease the cursor off-screen (for stills and loop starts) |
| `h.freezeTime(date)` | Optional: `page.clock.setFixedTime` so prototypes show a set date |

**Robustness rules (learned on the first live prototype):** `scrollBy` and `scrollTo` wait until the scroll position has settled before the next step reads its target, and `scrollTo` re-checks the target after layout changes; scrolling inside a container never chains to the page behind it (`overscroll-behavior: contain` for the duration); a click whose target is outside the viewport scrolls it into view first and logs a warning in the take; `waitForMotion` ignores the cursor's own animations.

The cursor is an injected SVG that follows Playwright's synthetic mouse events and is re-injected after navigation. The default is a redrawn arrow: the familiar silhouette, charcoal rather than black, with a white outline and a soft shadow, slightly larger than life because clips are viewed small. On click the arrow dips briefly and a translucent ring blooms from its tip. A plain dot was tried and rejected: on any UI with circular controls it reads as one of them (parameters in appendix D).

## 9. Capture (appendix A.1 and C)

**Not Playwright's `recordVideo`.** It encodes VP9 in realtime at about 1 Mbit with its size clamped to CSS pixels, so UI text goes soft, and its timing drift is a known open issue. For portfolio use that is the difference between a clip that looks designed and one that looks recorded.

**Default: Playwright `page.screencast.start()`** (Playwright 1.59+; per-frame timestamps since 1.61; `fps` since 1.64). It is Chromium's `Page.startScreencast` with the frame acknowledgement handled.
- Launch Chromium with a forced device scale factor of 2. Measured on M1: emulating `deviceScaleFactor: 2` in the browser context alone gives 1× screencast frames, through Playwright and through raw CDP alike; the launch flag is what makes the frames 2×. The record command fails, not warns, if frames come back at the wrong size.
- Context: `viewport` from config, `colorScheme` from config, `reducedMotion: "no-preference"` (record the site's motion as designed). The clock freeze (`freezeTime`) is applied before the first navigation.
- Start with `size: { width: 2 × viewport.width, height: 2 × viewport.height }` and `quality: 90–95`; frames arrive as JPEG with a timestamp. Write each frame to the cache folder without blocking the frame callback. **Capture scale:** 2× by default; when 2× frames would exceed about 10 megapixels (a 2560×1800 viewport, say) the screencast drops below 20 fps, so `init` sets 1.5×, which still exceeds a 960-wide card. Measured 2026-10-22: 5120×3600 frames held about 15 fps, 3840×2700 about 25 fps.
- Frames arrive only when something repaints; a static screen produces none. Export rebuilds a constant-fps stream from the timestamps (nearest-previous frame held), and the engine emits a final frame on stop. Skipping the retiming is the documented way to get clips that run 2.5× too long.
- **Frame-exact timing (fixed 2026-10-23):** in the constant-fps encode each frame's time comes from its index, never from summed per-frame durations. Rounded durations (0.033333 s) drift off k/30 and ffmpeg then duplicates or drops frames, which put the video one frame behind the camera track from frame 4 onward on the first taXchain take. The invariant, tested: output frame k is frames.txt entry k across the whole take.
- If a clip needs lossless frames, `capture.mjs` can drop to a raw CDP session with the same semantics (PNG format); not the default.

**Readiness gate before the first frame:** `document.fonts.ready` → every animation from `document.getAnimations()` finished → two `requestAnimationFrame`s → start screencast → first `h.hold`.

**Determinism:**
- Fresh browser context per clip; password gate handled once per context.
- Injected CSS: caret hidden, scrollbars hidden, `hideSelectors`, `cssOverrides`.
- Optional `freezeTime`.
- Viewport, colour scheme and device scale fixed by config. Record on one OS; Linux and macOS rasterise text differently.

**Fallback for CI or a machine under load:** deterministic frame-by-frame capture through `HeadlessExperimental.beginFrame` (as in `puppeteer-capture`). Frame-perfect, but Linux/Windows only and old-headless only. A `--capture=beginframe` flag, implemented when CI needs it, not in M1.

## 10. Export (appendix B)

### 10.1 Presets
| Output | Spec |
|---|---|
| `mp4` | H.264 `libx264 -preset slow -tune animation -crf 20 -pix_fmt yuv420p -profile:v high -movflags +faststart`, **no audio track**, width = `quality.maxWidth`, lanczos downscale from the 2× frames |
| `webm` | VP9 `libvpx-vp9 -crf 30 -b:v 0 -row-mt 1 -deadline good -cpu-used 1`, no audio, same width. AV1 (`libsvtav1`) as an opt-in later; Safari still lacks a software AV1 decoder |
| `@2x` variants | Optional full-resolution MP4 for retina hero placements |
| `poster` | PNG at export width and 2×, taken as a lossless screenshot inside a hold at the `poster` moment (the screenshot time is subtracted from the hold), rendered through the camera window the output size shows at that moment. Lossless screenshots are also taken at marks a sub-clip names as its poster, and at no other marks. WebP alongside when a WebP encoder is available (ffmpeg with libwebp, else `cwebp`); otherwise skipped with a note, never a failure |
| `gif` | Opt-in, 12–15 fps, max 960 wide, two-pass palette (`stats_mode=diff`, bayer dither) for READMEs and PRs |

4:4:4 chroma is not safe for the web (Firefox and Safari hardware decoders refuse it), so the fix for soft one-pixel lines is the 2× capture plus a sharp downscale, not a different pixel format.

### 10.2 Crops, sub-clips and speed
**Crops.** A named crop is one of: `{ aspect, focus }`; `{ width, height, scale, focus }` (the file is `width×height` times `scale`, so the 4:5 card is 960×1200 from `480×600 @2`); or an explicit rect. `focus` is a selector, a mark, or `"auto"` (the camera's current window). The window is cut from the 2× frames and downscaled, never upscaled; if the focus region is larger than the window at the viewport, the engine says so rather than squeezing. A focus on a tall element aligns to its top, not its centre, so headings survive. Every crop gets the full output set (MP4, WebM, posters) and is produced from the same take, with no re-record. A size may set `upscale` (default 1, capped at 2) to accept frames enlarged up to that factor; it is opt-in per size, for a small output cut from a wide stage, and the floor check reports it (§10.3).

**Sub-clips.** A marked range of one take (`from: "b4-resolve", to: "end"`) exports as its own clip with its own id, poster, camera track and manifest entry. One storyboarded take can feed a home-page clip and a case-study clip. A sub-clip inherits its parent's camera track over its range.

**Speed ramp.** A stretch wrapped in `h.speed(factor, fn)` plays `factor`× faster at export (a 4.5 s stepper shown in 1.5 s), with frames resampled so motion stays smooth rather than stuttering. The rest of the take is untouched.

**One time map.** Everything the take logs is in take time: shots, marks, actions, tracked boxes, the poster moment, sub-clip ranges and speed-ramp ranges. At export all of them pass through one map, trims first and then speed ramps, the same map the frames are retimed with; the camera only ever sees mapped times. Added 2026-10-23 after a trim on the taXchain take left the camera firing a second late: the cut was made in the video but not in the cue sheet.

### 10.3 Camera
A core feature, on by default. The Screen Studio look, computed from the 2× frames at export, so no re-record and no upscaling blur. In plain words: when the action happens in one corner of the screen, the picture eases in on that corner, stays while the action continues, and eases back out, so the viewer never has to hunt for it. Two ways to direct it, which can mix in one clip; explicit shots override auto in their window.

**Auto mode** (`zoom: "gentle" | "pronounced" | "off"`). The take's action log records every click, hover dwell, key press and typed field with its time and target box.
- A **cluster** (two or more actions within 3 s, or a dwell over 1.5 s) opens a shot on the cluster's padded bounding box; the box grows while actions keep landing inside or near it; the shot releases about 1 s after the last action, with a 1.2 s minimum and a rest before the clip ends.
- **Re-aim:** an action that lands outside the current shot by more than a quarter of the shot's width starts a new shot (the camera moves) instead of growing the box.
- **Cap:** a box that would exceed about 65% of the stage width goes wide instead of zooming on nearly everything.
- Scale tops out at 1.6× (gentle) or 2.2× (pronounced), and never above what the 2× source allows at export width.

**Explicit mode.** A camera track keyed to marks, written in the clip file or by the author-clip skill from a storyboard:
- shots are `wide`, `opening` or `focus(anchor, { extras: [targets], padding: 24, align })`: the smallest frame of the output aspect that contains the anchor (plus any extras that are visible) with padding, kept inside the stage. The window follows the anchor; extras widen it only while they are visible; a target leaving the viewport never re-solves or re-centres the window. Within a shot, framing changes only by following the anchor or by a scripted move (rule added 2026-10-22 after a union-of-targets rule re-aimed onto unrelated regions when a target scrolled away). Placement: a short anchor such as a heading sits at the top of the frame so the section below it is what the viewer sees; a tall anchor is centred on itself plus its visible extras when they fit (so lopsided extras are not pushed to an edge), and on itself alone when they outgrow the frame; `align: "top" | "bottom"` on an anchor taller than the frame sizes the window to the anchor's width and shows that slice (a drawer's top, then its bottom: the camera pans, the drawer does not scroll); the frame never shrinks within a shot;
- `wide` has two modes. `wide("contain")` fits the whole stage to the output width, top-aligned, with `stage.fill` below; only a clip's opening shot may use it. `wide("cover")` fills the output frame at full stage height and crops the sides, anchored `left`, `right`, `center` or on a target; any later `wide` defaults to cover. `opening` returns to the opening framing (added 2026-10-22);
- posters and contact-sheet cells render through the camera: the window the output size shows at that moment, and inside a move the window where the move settles, so a poster set at a push-in is the pushed-in framing;
- a focus on tracked targets (`h.track`) follows them as they move or scroll;
- moves ease in-out over a stated duration; the first push from wide scales from the top-left so the top bar stays anchored;
- no camera move during a click or a UI animation; one motion at a time; each shot held at least 600 ms;
- never crop narrower than half the output width in CSS px, so text is never upscaled; a size's `upscale` (opt-in, capped at 2) lowers that floor by its factor and the floor check says so.

**Stage.** `stage.exclude` lists regions (by element or rect) that never appear in any frame, such as a navigation sidebar that is not part of the design being shown. A wide shot fits the stage to the output width, top-aligned, with `stage.fill` (a solid colour) below, so a 4:5 card of a landscape stage reads as the page continuing.

**Feel and ease.** Auto shots: position and scale follow a critically damped spring (no linear tweens). `camera.feel` sets it: `brisk` reaches the shot in about half a second, `calm` (default) in just under a second, `lazy` slower still. Explicit moves: `camera.ease` is `cubic` (default, ease in-out) or `smooth` (a gentler sine ease whose window size changes geometrically, so a push-in zooms at an even rate instead of rushing its first half). Keyframes never cut mid-transition.

**Rendering.** One ffmpeg pass with per-frame crop windows fed to the filter, so no intermediate frames are written; crops apply after the camera. The manifest records shots and per-frame windows, and `export --zoom` or a changed `camera` setting re-renders from the same take with no re-record.

### 10.4 Loop
- `return`: the script ends in the start state; the export compares the first and last frames (pixelmatch) and trims to the matching frame. If the match fails the threshold it warns and offers `crossfade`.
- `crossfade`: blends the last 300–500 ms into a copy of the clip's head (ffmpeg `xfade`), then trims.
- `none`: ends on the last scripted frame; the poster defaults to `end`.
- In both loop modes the cursor is parked or at the same point at both ends, and the camera is at the opening framing. With `crossfade` the camera returns to the opening framing and rests at least 0.4 s before the fade, so frame matches frame (added 2026-10-22).

### 10.5 `out/manifest.json` and snippet
For every clip: id, title, scenario, alt, length, loop mode, dimensions, files (by format and crop), poster files, camera keyframes, per-step timings (start and end of each named step, kept for the next iteration's narration alignment), and the date recorded.

`out/embed/<id>.html` holds a bare snippet, nothing more:
```html
<video autoplay muted loop playsinline preload="metadata" poster="rm-home.poster.webp" aria-label="…alt…">
  <source src="rm-home.webm" type="video/webm">
  <source src="rm-home.mp4" type="video/mp4">
</video>
```
`loop` is omitted when the clip's loop mode is `none`. Reduced-motion handling, play controls and lazy loading belong to the site that embeds the clip.

## 11. CLI (engine)

```
ui-clips inspect  <url|clip>     # visible text, ARIA snapshot, candidate locators (JSON)
ui-clips dry-run  [clip|all]     # resolve locators, run actions, check expectations; no capture
ui-clips sheet    <clip>         # contact sheet PNG of key frames
ui-clips record   [clip|all]     # capture frames (+ action log for the camera)
ui-clips export   [clip|all]     # camera, crops, loop, presets, posters, manifest
ui-clips list                    # clips, last recorded, outputs, changed since export
ui-clips doctor                  # environment, URL reachability, password, versions
ui-clips init     [dir]          # a clip project from --url or --serve plus the interview answers as flags (§6.1)
```
`--project <dir>` or the current folder; `--changed`; `--json` on every command so skills and other agents can read results; `export --zoom gentle|pronounced|off` and `--feel` re-render the camera from the same take; `export --fast` for iteration (faster VP9 preset, no GIF, camera at export width only); `--capture=beginframe` reserved for the CI fallback.

## 12. Environment

- Node 20+, ffmpeg and ffprobe on PATH (`doctor` prints the install command for the platform). Chromium comes from Playwright's standard browser cache (already present on most machines that have used Playwright; downloaded on first use otherwise), or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing one. A WebP encoder is optional (§10.1).
- Dependencies install from `package-lock.json` when the plugin is installed from a marketplace; `npm ci` by hand when running from a local checkout. The plugin variables (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`) are not exported to shell commands, so the `bin/ui-clips` launcher locates the engine from its own path; the data folder falls back to `~/.claude/ui-clips/`.
- Frame caches and takes live in each clip project's `.cache/` (gitignored), so a clip project is self-contained and portable.
- Runs on a Mac or in a Linux cloud workspace. No GPU needed.
- No API keys in v1. A password for a gated prototype comes from `UI_CLIPS_PASSWORD` or the config, never from the clip files.

## 13. Quality bar (acceptance)

A clip is done when:
- **Sharpness:** UI text is crisp at 100% on a 2× display (check the poster at full size).
- **Timing:** within ±0.2 s of the target when one was set, with no dead frames longer than the scripted holds.
- **Expectations:** every step's `expect` passed in rehearsal and in the recorded take.
- **Loop:** when looping, first and last frames match (`return`) or the seam is invisible (`crossfade`).
- **Camera:** when zoom is on, no cut lands mid-transition, the camera is at the opening framing at both ends (and, with a crossfade loop, for the 0.4 s before the fade), nothing from `stage.exclude` appears in any frame, every click lands inside the frame the viewer sees, and no frame is cropped narrower than half the output width in CSS px (divided by the size's `upscale` where one is set).
- **Timing integrity:** output frame k is source entry k across the whole take (no duplicated or dropped frames from rounding), and every shot, mark, click, track sample and poster lands at its take time mapped through trims and speed ramps.
- **Size:** the MP4 at 1440 wide is under 2 MB for 8 s, prorated by frame area for other sizes, and the GIF is under 5 MB.
- **Re-record stability:** two records of the same clip differ only in sub-pixel noise.
- **Evals:** `claude plugin validate --strict` passes, and `claude plugin eval` passes its cases on `examples/todo-demo` (scaffold a project, author a clip from a one-line scenario, record and export it).

## 14. Repo, license, credit

- Public repo `banuakman/ui-clips`, Apache License 2.0 (chosen 2026-10-23 over MIT for the explicit patent grant, so companies can adopt and contribute without legal friction). `LICENSE` is the full Apache 2.0 text; `NOTICE` carries one line, "ui-clips · Copyright 2026 Banu Akman", plus the notices of anything adapted. Source files may carry the short Apache header; it is not required. `plugin.json` and `package.json` have `"license": "Apache-2.0"`.
- Write the engine fresh. If any code is adapted from another open-source project, add that project's copyright and license notice to `NOTICE`.
- SemVer; bump `version` in `plugin.json` on every release. `CHANGELOG.md`. A tagged `v0.1.0` at the end of M4.
- **Name and spelling:** `ui-clips`, lowercase and hyphenated, in every identifier: repo, plugin name, marketplace, commands (`ui-clips record`), skill prefix (`/ui-clips:author-clip`), domain (ui-clips.com). "UI Clips" with a space is the display name only, in `plugin.json`, titles and prose. One spelling in code, so searches find one thing.
- Listing beyond your own marketplace goes through the **community marketplace** (`anthropics/claude-plugins-community`, submitted via the Console form after `validate --strict`). The official marketplace does not take submissions. The repo at github.com/banuakman/ui-clips goes public on 2026-10-23, after M3 and a licence pass (Apache 2.0 `LICENSE` and `NOTICE`, `CODEOWNERS`, `CONTRIBUTING.md`, a history scan for prototype URLs and client names) and before M4. `main` is protected by a ruleset: changes land through pull requests with the owner's approval (`.github/CODEOWNERS` names the owner for every path), force pushes and deletion are blocked, and only the repository admin bypasses it, so the owner's own session can still merge engine branches. Outside contributions arrive as pull requests from forks and never merge without the owner. The landing page at ui-clips.com follows v0.1.0.
- **Keep client and employer work out of the public repo.** The Risk Monitoring clip project stays in the portfolio folder; the public `examples/` uses a neutral demo page.
- **Working rules (added 2026-10-23 after two sessions edited one working tree):** one Claude Code session edits the `ui-clips` repo at a time; engine fixes found while making clips go on a branch and merge to main with their tests; clip sessions never edit the plugin. A clip session that hits a plugin problem files it as `docs/issues/<date>-<name>.md` in the clip project (what was asked, what happened, how to reproduce, what was measured, suspected file and function, proposed fix with a test, marked bug or enhancement, whether the clip can ship without it) and ships the best clip the current plugin can make. The `CLAUDE.md` that `init` writes into every clip project carries this rule.

## 15. Milestones (build order for Claude Code)

A milestone is one build step with a test that says it is done. Build them in order and stop after M1 to look at the first clip; capture quality decides whether the rest is worth building.

| | Scope | Done when |
|---|---|---|
| **M1 Capture** (done 2026-10-21) | config, `doctor`, `inspect`, helpers (cursor, moveTo, click with expect, hold, waitForMotion), screencast capture with retiming, plain MP4 export; then the arrow cursor and the robustness rules from the first live take | One clip of `examples/todo-demo` is sharp at 2×, its timing is correct, and a deliberately wrong `expect` fails the dry run; a full-frame take of the Risk Monitoring prototype records end to end |
| **M2 pass A: export + camera on the demo** (done 2026-10-22) | WebM, posters, crops, loop modes with the pixelmatch check, GIF, manifest, snippet, contact sheet, `--changed`, auto camera; the explicit camera track on marks, `h.track`, stage mask with fill, speed ramp, sub-clip export, re-aim and cap rules, `camera.feel`, WebP as a soft dependency, `--fast`; then the anchor rule, the rehearsal report and the framing sheet | All presets pass the §13 checks on `examples/todo-demo`; an explicit render and a calm auto render of the same take both read as smooth; the demo exercises every capability the pilot storyboard needs |
| **M2 pass B: the pilot storyboard** (done 2026-10-22) | the Risk Monitoring storyboard (pilot log, entry 1), recorded and exported as written | `rm-home` passes its checks and is placed on the portfolio site; `rm-resolve` and `rm-review` deferred |
| **M3 Skills** (done 2026-10-22) | `new-clip-project`, `author-clip` (scenario given or proposed), `record-clips`, `marketplace.json`, `agents/clip-explorer.md` stub, `ui-clips init`, `inspect --at <mark>` | A fresh Claude Code session goes from "make a clip of this URL" to outputs without manual steps. Passed 2026-10-22: a headless session with only the plugin loaded took one sentence and a URL to a verified clip in 41 turns, about 4 minutes |
| **Engine fixes from real use** (done 2026-10-23) | from the taXchain and square-card projects: the take time map, frame-exact intermediate timing, length target counting trims, `upscale`, `camera.ease`, centred extras, mark screenshots only for sub-clip posters, beat-end rehearsal screenshots | 56 tests pass; main pushed |
| **M4 Publish** | README (opening with a clip the plugin made of the demo), designers.md (the pilot's lessons in plain words), developers.md, evals, the install path (`marketplace add` → `install` → new session) exercised on a second machine or a fresh user, v0.1.0 tag | Installs from GitHub with the two commands in §5; `validate --strict` and `plugin eval` pass |
| **Pilot, continued** | further portfolio clips (taXchain, Precycle, square variants) through the skills alone, counting the rounds each takes | A new clip from a plain scenario lands in one or two rounds |

## 16. Pilots

Pilots are real portfolio clips made with the plugin as it is, and each one is expected to find something the previous ones could not. They are not part of this spec: their settings, storyboards, results and lessons live in the **pilot log**, `2026-10-23-ui-clips-pilot-log.md` in this folder (one entry per clip project; the first three are Risk Monitoring, its square variant, and taXchain), and each clip project keeps its own `STORYBOARD.md` and `docs/issues/`.

What a pilot feeds back into this document: a change to a contract (a config key, a helper, a command, a check in §13, a rule in §10.3 or §14) is written into the section it belongs to, with the date; a lesson that is not a rule stays in the log. The acceptance bar that came out of the first pilots: **a new clip from a plain scenario lands in one or two rounds** through the skills alone.

## 17. Next iteration: narration and walkthroughs (appendix E)

Narration is deliberately out of v1, but v1 is shaped so it slots in without a rewrite:
- the clip file has a reserved `narration` field;
- the manifest keeps per-step timings;
- a **beat is a clip**, so a walkthrough is a sequence of clips plus audio plus a cut, not a new engine;
- `agents/clip-explorer.md` is the seat for the exploration agent.

The walkthrough pipeline that already works in production elsewhere, and that ui-clips would adopt: **explore** (crawl routes from the entry URL, inventory interactive elements, screenshot each; accessibility-tree first, screenshots sparingly) → **storyboard** (Claude proposes 4–8 beats with the expected visual change and a sentence or two of narration each; the user approves before anything renders, which is also the guard against invented features) → **rehearse** → **shoot** (one clip per beat, audio generated first so actions are timed to it) → **cut** (concat, captions, optional keystroke overlays). Local TTS (Kokoro) or a cheap hosted voice makes narration cost negligible; secret redaction becomes mandatory once real products are involved.

Also later, in rough order of value:
- **Reference frames as storyboard input:** `author-clip` accepts a few screenshots of how each beat should look ("make the camera match this crop") and derives the viewport, stage, anchors and alignments from them, instead of asking the user to translate into shot terms. The pilot showed this is how a designer naturally storyboards.
- Classic Figma prototypes through the Embed API from a local wrapper page (navigate by node id, screencast the wrapper).
- Device frames (browser chrome, laptop or phone) as an export option.
- Keystroke and click-label overlays, and optional burned-in captions.
- Multiple themes or locales recorded from one script.
- A storyboard export: contact sheet plus step names as a single image for case studies.
- AV1 WebM once Safari decodes it in software.

## 18. Open decisions

None open.

Decided: default cursor is the redrawn arrow (2026-10-21); auto-zoom is a core feature, gentle by default (2026-10-21); the portfolio card is 4:5 at 480×600, exported at 960×1200, with the viewport chosen per project for the moment (2026-10-22); repo private at banuakman/ui-clips until further notice (2026-10-22); `upscale` is opt-in per size and capped at 2 (2026-10-23); the name is `ui-clips`, final, with ui-clips.com registered for a landing page (2026-10-23); GIF stays opt-in, offered as a choice in the `new-clip-project` interview, never a default (2026-10-23); the licence is Apache 2.0, not MIT (2026-10-23); the repo goes public on 2026-10-23 after the licence pass and before M4, with `main` protected (pull request + owner approval; admin bypass for the owner).
