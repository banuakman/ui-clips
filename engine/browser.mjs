// Browser lifecycle: launch, context with determinism settings, injected CSS,
// password gate, readiness gate, and the local static server for `serve` projects.
import { chromium } from "playwright";
import { startStaticServer } from "./serve.mjs";
import { cursorInitScript } from "./cursor.mjs";

export const BASE_CSS = `
* { caret-color: transparent !important; scrollbar-width: none !important; }
*::-webkit-scrollbar { display: none !important; }
`;

export function chromiumExecutablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return chromium.executablePath();
}

export async function launchBrowser(config) {
  return chromium.launch({
    headless: config.headless !== false,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    // --force-device-scale-factor makes the headless compositor surface a true 2x bitmap; without it the
    // screencast returns CSS-pixel frames even when the context emulates deviceScaleFactor 2 (measured on
    // Chromium 1248 / macOS). The context still sets deviceScaleFactor so the page sees devicePixelRatio 2.
    args: [
      `--force-device-scale-factor=${config.deviceScaleFactor || 1}`,
      "--hide-scrollbars", "--disable-lcd-text", "--font-render-hinting=none", "--force-color-profile=srgb",
    ],
  });
}

/** Start the static server when the project serves a local folder; returns { baseUrl, close }. */
export async function resolveBase(config) {
  if (config.serve) {
    const srv = await startStaticServer(config.serve);
    return { baseUrl: srv.url, close: srv.close };
  }
  return { baseUrl: config.baseUrl.replace(/\/+$/, ""), close: async () => {} };
}

export function injectedCss(config, { hideCursorOnly = false } = {}) {
  const hide = (config.hideSelectors || []).map((s) => `${s} { visibility: hidden !important; }`).join("\n");
  return `${BASE_CSS}\n${hide}\n${config.cssOverrides || ""}`;
}

export async function openContext(browser, config, { cursor = true } = {}) {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: config.deviceScaleFactor,
    colorScheme: config.colorScheme === "no-preference" ? undefined : config.colorScheme,
    reducedMotion: "no-preference",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const css = JSON.stringify(injectedCss(config));
  await context.addInitScript(`(() => {
    if (window.top !== window) return;
    const add = () => {
      if (!document.head) return requestAnimationFrame(add);
      const s = document.createElement("style"); s.id = "ui-clips-css"; s.textContent = ${css};
      document.head.appendChild(s);
    };
    add();
  })();`);
  if (cursor) {
    const script = cursorInitScript(config.cursor);
    if (script) await context.addInitScript(script);
  }
  context.setDefaultTimeout(10_000);
  return context;
}

export function joinUrl(baseUrl, start) {
  if (!start) return baseUrl;
  if (/^https?:\/\//.test(start)) return start;
  return baseUrl.replace(/\/+$/, "") + "/" + start.replace(/^\/+/, "");
}

/** Fill a single visible password field (published prototype gate). Never logs the value. */
export async function passPasswordGate(page, config) {
  const inputs = page.locator('input[type="password"]:visible');
  if ((await inputs.count()) !== 1) return false;
  if (!config.password) throw new Error("The page shows a password gate but no password is configured (config.password or UI_CLIPS_PASSWORD).");
  const input = inputs.first();
  await input.fill(config.password);
  await input.press("Enter");
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  if ((await page.locator('input[type="password"]:visible').count()) === 1) {
    throw new Error("The password was not accepted by the page's gate.");
  }
  return true;
}

/** Readiness gate (appendix C): fonts, running animations, two frames. */
export async function readinessGate(page, config, { timeout = 4000 } = {}) {
  await page.evaluate(async ({ fonts, timeout }) => {
    const until = (p) => Promise.race([p, new Promise((r) => setTimeout(r, timeout))]);
    if (fonts && document.fonts) await until(document.fonts.ready);
    await until(Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { fonts: config.waitForFonts !== false, timeout });
}

export async function gotoStart(page, config, baseUrl, start) {
  const url = joinUrl(baseUrl, start);
  const resp = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  const gated = await passPasswordGate(page, config);
  await readinessGate(page, config);
  return { url, status: resp ? resp.status() : null, gated };
}
