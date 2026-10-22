// The `h` helper API (§8): cursor motion, human-paced actions, expectations, marks.
import { makePath, dist, moveDuration, seededRandom, scrollSteps, clamp } from "./motion.mjs";

export class ExpectError extends Error {
  constructor(step, cause) {
    super(`Expectation failed after "${step}": ${cause?.message || cause}`);
    this.name = "ExpectError";
    this.step = step;
    this.cause = cause;
  }
}
export class StepError extends Error {
  constructor(step, cause) {
    super(`Step "${step}" failed: ${cause?.message || cause}`);
    this.name = "StepError";
    this.step = step;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function describe(target) {
  if (!target) return "?";
  if (typeof target === "string") return target;
  if (typeof target.x === "number") return `(${Math.round(target.x)}, ${Math.round(target.y)})`;
  const s = String(target);
  return s.replace(/^Locator@/, "").replace(/internal:/g, "").slice(0, 120);
}

/**
 * @param {{page: import('playwright').Page, config: object, take: object, fast?: boolean}} opts
 * fast: dry-run mode — no cursor motion, no holds, instant typing.
 */
export function createHelpers({ page, config, take, fast = false }) {
  const vw = config.viewport.width, vh = config.viewport.height;
  const park = { x: vw - 1, y: vh - 1 };
  const cur = { ...park };
  const rand = seededRandom(7);
  let stepNo = 0;

  async function cursorHide() { await page.evaluate(() => window.__uiclips?.hide()).catch(() => {}); }
  async function cursorShow() { await page.evaluate(() => window.__uiclips?.show()).catch(() => {}); }

  async function boxOf(target, { scrollIntoView = true } = {}) {
    if (target && typeof target.x === "number") return { x: target.x, y: target.y, width: 0, height: 0 };
    const loc = target.first ? target.first() : target;
    let box = await loc.boundingBox({ timeout: 5000 }).catch(() => null);
    if (!box && scrollIntoView) {
      await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
      box = await loc.boundingBox({ timeout: 5000 }).catch(() => null);
    }
    if (!box) throw new Error(`Target has no bounding box (not visible?): ${describe(target)}`);
    // The cursor can only reach points inside the viewport. If the target's centre is outside it, bring it in
    // (instant scroll, so a scripted h.scrollTo beforehand is the smooth way; this is the safety net).
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (scrollIntoView && (cx < 0 || cy < 0 || cx > vw || cy > vh)) {
      await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
      await sleep(50);
      box = (await loc.boundingBox({ timeout: 5000 })) || box;
      take.warn(`${describe(target)} was outside the viewport and was scrolled into view instantly; add h.scrollTo before it for a smooth scroll`);
    }
    return box;
  }

  const roundBox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });

  /** For every configured crop whose focus is a selector, record its box now if it is visible. */
  async function measureCropFocus(at) {
    for (const [name, crop] of Object.entries(config.crops || {})) {
      if (typeof crop.focus !== "string" || !crop.focus.trim()) continue;
      let loc;
      try { loc = page.locator(crop.focus).first(); if ((await loc.count()) === 0) continue; } catch { continue; } // mark names and bad selectors: skip
      const box = await loc.boundingBox({ timeout: 200 }).catch(() => null);
      if (box && box.width > 0 && box.height > 0) take.focus(name, roundBox(box), at);
    }
  }

  /** Wheel scrolling is smooth and asynchronous: wait until the scroll position stops changing. */
  async function settleScroll(within, { timeout = 1500 } = {}) {
    const read = () => within
      ? (within.first ? within.first() : within).evaluate((el) => el.scrollTop + el.scrollLeft).catch(() => 0)
      : page.evaluate(() => scrollY + scrollX);
    const until = Date.now() + timeout;
    let prev = await read();
    while (Date.now() < until) {
      await sleep(60);
      const now = await read();
      if (now === prev) return;
      prev = now;
    }
  }

  function logAction(kind, box, target, extra = {}) {
    take.log({ kind, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), locator: describe(target), ...extra });
  }

  async function moveToPoint(to, { ms } = {}) {
    if (fast) { await page.mouse.move(to.x, to.y); Object.assign(cur, to); return; }
    const d = dist(cur, to);
    const duration = ms ?? moveDuration(d);
    const path = makePath(cur, to, { overshootPx: d > 300 ? 3 : 0 });
    const start = performance.now();
    const step = 1000 / 60;
    let tick = 1;
    while (true) {
      const elapsed = performance.now() - start;
      if (elapsed >= duration) break;
      const p = path(elapsed / duration);
      await page.mouse.move(p.x, p.y);
      const due = start + tick * step;
      tick = Math.max(tick + 1, Math.ceil((performance.now() - start) / step));
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
    }
    await page.mouse.move(to.x, to.y);
    Object.assign(cur, to);
  }

  async function moveTo(target, { ms, offset } = {}) {
    const box = await boxOf(target);
    const to = {
      x: box.x + (offset?.x ?? box.width / 2),
      y: box.y + (offset?.y ?? box.height / 2),
    };
    await moveToPoint(to, { ms });
    return box;
  }

  async function runExpect(expectFn, label) {
    if (!expectFn) return;
    let result;
    try { result = await expectFn(); } catch (e) { throw new ExpectError(label, e); }
    if (result === false) throw new ExpectError(label, new Error("expect returned false"));
  }

  async function poll(fn, what, timeout = 3000) {
    const until = Date.now() + timeout;
    let last;
    while (Date.now() < until) {
      try { if (await fn()) return true; } catch (e) { last = e; }
      await sleep(25);
    }
    throw new Error(`${what} (waited ${timeout} ms${last ? `; last error: ${last.message}` : ""})`);
  }

  const h = {
    /** Cursor move along a bezier arc. */
    async moveTo(target, opts = {}) {
      const label = `moveTo ${describe(target)}`;
      try { const box = await moveTo(target, opts); logAction("move", box, target); }
      catch (e) { throw new StepError(label, e); }
    },

    async click(target, { expect, button = "left", ms, offset } = {}) {
      const label = `click ${describe(target)}`;
      let box;
      try {
        box = await moveTo(target, { ms, offset });
        const t0 = performance.now();
        if (!fast) await sleep(120);
        await page.mouse.down({ button });
        if (!fast) await sleep(t0 + 200 - performance.now());
        await page.mouse.up({ button });
        logAction("click", box, target);
      } catch (e) { throw new StepError(label, e); }
      await runExpect(expect, label);
    },

    async hover(target, { holdMs = 900, expect, ms } = {}) {
      const label = `hover ${describe(target)}`;
      try {
        const box = await moveTo(target, { ms });
        logAction("hover", box, target, { holdMs });
        if (!fast) await sleep(holdMs);
      } catch (e) { throw new StepError(label, e); }
      await runExpect(expect, label);
    },

    async type(target, text, { cps = 12, expect, clear = false, stepAside = { x: 32, y: 24, ms: 250 } } = {}) {
      const label = `type "${text}" into ${describe(target)}`;
      try {
        await h.click(target);
        const clickPoint = { x: cur.x, y: cur.y };
        // Step aside (appendix D): ease the arrow down-right of the click point so the caret and words stay uncovered.
        let aside = null;
        if (stepAside && !fast) {
          aside = { x: clickPoint.x + stepAside.x, y: clickPoint.y + stepAside.y };
          await moveToPoint(aside, { ms: stepAside.ms });
        }
        if (clear) await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").then(() => page.keyboard.press("Backspace"));
        // Absolute schedule: round-trip latency per key does not accumulate into the clip length.
        const base = 1000 / cps;
        let due = performance.now();
        for (const ch of text) {
          await page.keyboard.type(ch);
          if (fast) continue;
          due += base * (0.7 + rand() * 0.6);
          const wait = due - performance.now();
          if (wait > 0) await sleep(wait);
        }
        take.log({ kind: "type", x: Math.round(clickPoint.x), y: Math.round(clickPoint.y), w: 0, h: 0, locator: describe(target), text,
          ...(aside ? { stepAside: { x: Math.round(aside.x), y: Math.round(aside.y) } } : {}) });
      } catch (e) { throw new StepError(label, e); }
      await runExpect(expect, label);
    },

    async press(key, { expect } = {}) {
      const label = `press ${key}`;
      try {
        await page.keyboard.press(key);
        take.log({ kind: "press", x: Math.round(cur.x), y: Math.round(cur.y), w: 0, h: 0, locator: key });
      } catch (e) { throw new StepError(label, e); }
      await runExpect(expect, label);
    },

    async select(target, optionText, { expect } = {}) {
      const label = `select "${optionText}" in ${describe(target)}`;
      try {
        const loc = target.first ? target.first() : target;
        const tag = await loc.evaluate((el) => el.tagName).catch(() => "");
        if (tag === "SELECT") {
          await h.click(target);
          await loc.selectOption({ label: optionText });
        } else {
          await h.click(target);
          await h.waitForMotion();
          const option = page.getByText(optionText, { exact: true }).filter({ visible: true }).last();
          await h.click(option);
        }
      } catch (e) { throw new StepError(label, e); }
      await runExpect(expect, label);
    },

    async scrollBy(px, { within, ms } = {}) {
      const label = `scrollBy ${px}${within ? " within " + describe(within) : ""}`;
      try {
        let box = within ? await boxOf(within) : { x: 0, y: 0, width: vw, height: vh };
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const inside = cur.x >= box.x && cur.x <= box.x + box.width && cur.y >= box.y && cur.y <= box.y + box.height;
        if (!inside) await moveToPoint(centre);
        // Keep the wheel inside the container: no scroll chaining to the page behind it while we scroll.
        const containEl = within ? (within.first ? within.first() : within) : null;
        const prevOverscroll = containEl ? await containEl.evaluate((el) => { const v = el.style.overscrollBehavior; el.style.overscrollBehavior = "contain"; return v; }).catch(() => null) : null;
        const restore = async () => { if (containEl) await containEl.evaluate((el, v) => { el.style.overscrollBehavior = v || ""; }, prevOverscroll).catch(() => {}); };
        if (fast) { await page.mouse.wheel(0, px); }
        else {
          const duration = ms ?? clamp(300 + Math.abs(px) * 0.5, 300, 1200);
          const steps = scrollSteps(px, duration);
          const start = performance.now();
          for (let i = 0; i < steps.length; i++) {
            if (steps[i]) await page.mouse.wheel(0, steps[i]);
            const wait = start + ((i + 1) / steps.length) * duration - performance.now();
            if (wait > 0) await sleep(wait);
          }
        }
        await settleScroll(within);
        await restore();
        logAction("scroll", box, within || "page", { px });
      } catch (e) { throw new StepError(label, e); }
    },

    async scrollTo(target, { within, align = "center", ms } = {}) {
      const label = `scrollTo ${describe(target)}`;
      try {
        const loc = target.first ? target.first() : target;
        const cb = within ? await boxOf(within) : { x: 0, y: 0, width: vw, height: vh };
        // Layout can still be growing (a section that just rendered): re-check and retry a few times.
        for (let attempt = 0; attempt < 4; attempt++) {
          const tb = await loc.boundingBox({ timeout: 5000 });
          if (!tb) throw new Error("target has no bounding box");
          let delta = align === "start" ? tb.y - cb.y - 16 : (tb.y + tb.height / 2) - (cb.y + cb.height / 2);
          const inView = tb.y >= cb.y && tb.y + tb.height <= Math.min(cb.y + cb.height, vh);
          if (Math.abs(delta) <= 1 || (attempt > 0 && inView)) break;
          // Clamp to what the container can still scroll, so the excess does not chain to the page behind it.
          if (within) {
            const range = await (within.first ? within.first() : within).evaluate((el) => ({ up: el.scrollTop, down: el.scrollHeight - el.clientHeight - el.scrollTop })).catch(() => null);
            if (range) delta = Math.max(-range.up, Math.min(range.down, delta));
            if (Math.abs(delta) <= 1) break;
          }
          await h.scrollBy(Math.round(delta), { within, ms });
          const after = await loc.boundingBox({ timeout: 5000 });
          if (after && after.y >= 0 && after.y + after.height <= vh && (align !== "start" || Math.abs(after.y - cb.y - 16) <= 2 || attempt > 0)) break;
          await sleep(150);
        }
      } catch (e) { throw new StepError(label, e); }
    },

    /** Hold the frame. Takes the pending poster at the start of the hold, without stretching it. */
    async hold(ms) {
      let spent = 0;
      if (take.posterDue()) spent = await take.takePoster("hold");
      if (!fast) await sleep(ms - spent);
    },

    async waitForMotion({ timeout = 3000 } = {}) {
      await page.evaluate(async (timeout) => {
        const until = (p) => Promise.race([p, new Promise((r) => setTimeout(r, timeout))]);
        // The injected cursor's own click animations must not count as page motion.
        const cursor = document.getElementById("__uiclips_cursor");
        const page = document.getAnimations().filter((a) => !(cursor && a.effect?.target && cursor.contains(a.effect.target)));
        await until(Promise.all(page.map((a) => a.finished.catch(() => {}))));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, timeout);
    },

    // Expectations
    visible: (target, { timeout = 3000 } = {}) => poll(() => (target.first ? target.first() : target).isVisible(), `expected visible: ${describe(target)}`, timeout),
    hidden: (target, { timeout = 3000 } = {}) => poll(async () => (await target.count()) === 0 || !(await target.first().isVisible()), `expected hidden: ${describe(target)}`, timeout),
    text: (target, str, { timeout = 3000 } = {}) => poll(async () => ((await (target.first ? target.first() : target).innerText()) || "").includes(str), `expected text "${str}" in ${describe(target)}`, timeout),

    /** Name a moment. `focus` records the box of a locator on the mark (crops can point at the mark by name). */
    async mark(name, { focus } = {}) {
      let box = null;
      if (focus) box = await boxOf(focus, { scrollIntoView: false }).catch(() => null);
      take.mark(name, { box: box ? roundBox(box) : undefined });
      await measureCropFocus(name);
    },

    async trim(fn) { take.trimStart(); try { await fn(); } finally { take.trimEnd(); } },

    async zoomTo(target, { scale = 1.6, ms = 600 } = {}) {
      const box = typeof target === "string" ? { x: 0, y: 0, width: vw, height: vh, mark: target } : await boxOf(target);
      take.cameraKey({ kind: "zoomTo", box, scale, ms });
    },
    async zoomOut({ ms = 600 } = {}) { take.cameraKey({ kind: "zoomOut", ms }); },

    async parkCursor({ ms = 500 } = {}) {
      await moveToPoint(park, { ms });
      await cursorHide();
      take.log({ kind: "park", x: park.x, y: park.y, w: 0, h: 0, locator: "park" });
    },

    async freezeTime(date) { await page.clock.setFixedTime(date); },

    // engine-internal
    _cursor: { hide: cursorHide, show: cursorShow, position: () => ({ ...cur }), park: () => moveToPoint(park, { ms: 0 }) },
    _measureCropFocus: measureCropFocus,
    _nextStep: () => ++stepNo,
  };
  return h;
}
