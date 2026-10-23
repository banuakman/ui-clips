import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { intermediateArgs, ffmpegBin } from "../engine/export.mjs";
import { concatText } from "../engine/retime.mjs";

const hasFfmpeg = (() => { try { execFileSync(ffmpegBin(), ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("intermediate frame k is frames.txt entry k across the whole list", { skip: !hasFfmpeg && "ffmpeg not found" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ui-clips-intermediate-"));
  try {
    // 60 solid grey frames shown for 1–4 output frames each, like a screencast held between damage events
    const sources = Array.from({ length: 60 }, (_, i) => {
      const file = `f${String(i).padStart(3, "0")}.pgm`;
      writeFileSync(path.join(dir, file), Buffer.concat([Buffer.from("P5 8 8 255\n"), Buffer.alloc(64, 20 + i * 3)]));
      return file;
    });
    const list = sources.flatMap((f, i) => Array((i * 7) % 4 + 1).fill(f));
    const fps = 30;
    writeFileSync(path.join(dir, "frames.txt"), concatText(list, fps));
    execFileSync(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...intermediateArgs({ fps, frames: list.length, out: "intermediate.mkv" })], { cwd: dir });
    const grey = execFileSync(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-i", "intermediate.mkv", "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", "-"], { cwd: dir, maxBuffer: 1 << 20 });
    assert.equal(grey.length, list.length, "one frame per entry");
    const got = [...grey].map((v) => sources[Math.round((v - 20) / 3)]);
    const wrong = list.map((f, k) => (got[k] === f ? -1 : k)).filter((k) => k >= 0);
    assert.deepEqual(wrong, [], `frames off their entry at ${wrong.slice(0, 10).join(", ")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
