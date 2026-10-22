// Environment and target checks with concrete fixes.
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromiumExecutablePath, launchBrowser, openContext, resolveBase, joinUrl, passPasswordGate } from "./browser.mjs";
import { ffmpegBin, ffprobeBin } from "./export.mjs";

const exec = promisify(execFile);

async function version(bin, args = ["-version"]) {
  try { const { stdout } = await exec(bin, args); return stdout.split("\n")[0]; } catch { return null; }
}

const installFfmpeg = process.platform === "darwin" ? "brew install ffmpeg" : process.platform === "linux" ? "sudo apt-get install -y ffmpeg   (or your distro's package)" : "winget install Gyan.FFmpeg";

export async function doctor(config, { checkUrl = true } = {}) {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(fix && !ok ? { fix } : {}) });

  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 20, `v${process.versions.node}`, "Install Node 20 or newer");

  const ff = await version(ffmpegBin());
  add("ffmpeg", !!ff, ff || "not found on PATH", installFfmpeg);
  if (ff) {
    const { stdout } = await exec(ffmpegBin(), ["-hide_banner", "-encoders"]).catch(() => ({ stdout: "" }));
    add("ffmpeg libx264", /libx264/.test(stdout), /libx264/.test(stdout) ? "available" : "missing (H.264 export needs it)", installFfmpeg);
    add("ffmpeg libvpx-vp9", /libvpx-vp9/.test(stdout), /libvpx-vp9/.test(stdout) ? "available" : "missing (WebM export needs it)", installFfmpeg);
  }
  const fp = await version(ffprobeBin());
  add("ffprobe", !!fp, fp || "not found on PATH", installFfmpeg);

  let chromePath = null;
  try { chromePath = chromiumExecutablePath(); } catch (e) { chromePath = null; }
  const chromeOk = !!chromePath && existsSync(chromePath);
  add("chromium", chromeOk, chromeOk ? chromePath : "Playwright's Chromium is not installed", "npx --prefix <plugin root> playwright install chromium   (or set PLAYWRIGHT_CHROMIUM_EXECUTABLE)");

  if (config && checkUrl && chromeOk) {
    const base = await resolveBase(config);
    let browser;
    try {
      browser = await launchBrowser(config);
      const context = await openContext(browser, config, { cursor: false });
      const page = await context.newPage();
      const url = joinUrl(base.baseUrl, "/");
      const resp = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      const status = resp ? resp.status() : null;
      add("target reachable", !!status && status < 400, `${url} → HTTP ${status} · "${await page.title()}"`, "Check baseUrl / serve in clips.config.mjs");
      const gate = await page.locator('input[type="password"]:visible').count();
      if (gate === 1) {
        try { await passPasswordGate(page, config); add("password gate", true, "password accepted"); }
        catch (e) { add("password gate", false, e.message, "Set password in clips.config.mjs or UI_CLIPS_PASSWORD"); }
      } else {
        add("password gate", true, "none detected");
      }
      await context.close();
    } catch (e) {
      add("target reachable", false, e.message, "Check the URL and your network");
    } finally {
      await browser?.close();
      await base.close();
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
