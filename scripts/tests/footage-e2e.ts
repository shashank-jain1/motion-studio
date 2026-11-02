/**
 * Footage editing end to end (slow: first run builds whisper.cpp and downloads the "base" model into .cache/whisper).
 * Run: npx tsx scripts/tests/footage-e2e.ts        (macOS: uses `say` to synthesize a raw take)
 *
 * A synthetic talking-head take with a filler, a stutter, a retake and dead air goes through transcribe_media →
 * edit_footage (plan) → edit_footage (apply), and the resulting spec must validate, drop the bad material, keep the
 * good take, and carry word-timed captions. Uses a throwaway projects dir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") { console.log("footage e2e: skipped (needs macOS `say` to synthesize speech)"); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-footage-"));
process.env.MOTION_STUDIO_PROJECTS = path.join(tmp, "projects");
const { createProject, addAsset, readSpec, listSpecVersions } = await import("../../src/core/projects");
const { callTool } = await import("../../src/core/tools");
const { runMediaTool } = await import("../../src/core/mediaTool");

const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");
const t0 = Date.now();
try {
  // 1. a raw take: good line, "um", stutter, abandoned take + restart, 2.5s of dead air, closing line
  const aiff = path.join(tmp, "take.aiff");
  const script = "Coffee should taste like morning. [[slnc 400]] Um, [[slnc 300]] the the beans are roasted every Tuesday. [[slnc 900]] And the best part is. [[slnc 900]] And the best part is the price. [[slnc 2500]] Try it today.";
  execFileSync("say", ["-v", "Samantha", "-r", "170", "-o", aiff, script]);
  const mp4 = path.join(tmp, "raw-take.mp4");
  // a still "camera" frame (PNG) under the speech: only inputs Remotion's minimal bundled FFmpeg can decode
  const still = path.join(tmp, "frame.png");
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 64 }, () => [200, 120, 60]).flat())]);
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([l, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64, 0); ihdr.writeUInt32BE(36, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(still, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: 36 }, () => row)))), chunk("IEND", Buffer.alloc(0))]));
  await runMediaTool("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", still, "-i", aiff, "-shortest", "-vf", "format=yuv420p", "-c:v", "libx264", "-c:a", "aac", mp4]);

  const p = createProject({ name: "footage e2e", format: "9:16" });
  await addAsset(p.id, { path: mp4, name: "raw-take.mp4" });

  // 2. transcribe
  const tr = await callTool("transcribe_media", { projectId: p.id, asset: "assets/raw-take.mp4", model: "base.en" }, { onProgress: (x) => x.message && process.stdout.write(`\r  … ${x.message} ${Math.round(x.progress * 100)}%   `) });
  console.log(`\n  transcript (${((Date.now() - t0) / 1000).toFixed(0)}s): ${textOf(tr).split("\n").slice(-1)[0]}`);
  assert.ok(!tr.isError, textOf(tr));
  assert.match(textOf(tr), /morning/i);

  // 3. plan only: nothing written
  const plan = await callTool("edit_footage", { projectId: p.id, asset: "assets/raw-take.mp4", model: "base.en" });
  console.log(textOf(plan).split("\n").map((l) => `  │ ${l}`).join("\n"));
  assert.ok(!plan.isError);
  assert.equal(readSpec(p.id), null, "plan must not write a spec");
  assert.match(textOf(plan), /FILLER|filler/);
  assert.match(textOf(plan), /RETAKE/);

  // 4. apply
  const ap = await callTool("edit_footage", { projectId: p.id, asset: "assets/raw-take.mp4", model: "base.en", apply: true, captions: { style: "karaoke", wordsPerPage: 3 } }, { author: { kind: "director" } });
  assert.ok(!ap.isError, textOf(ap));
  const spec = readSpec(p.id) as unknown as { scenes: { duration: number; layers: { type: string; trimStart?: number; words?: { text: string }[] }[] }[] };
  const said = spec.scenes.flatMap((s) => s.layers.filter((l) => l.type === "captions").flatMap((l) => l.words!.map((w) => w.text))).join(" ").toLowerCase();
  console.log(`  kept captions: ${said}`);
  assert.ok(!/\bum\b/.test(said), "filler removed");
  assert.ok(!/the the/.test(said), "stutter removed");
  assert.equal((said.match(/best part is/g) ?? []).length, 1, "only one take of the retake kept");
  assert.match(said, /best part is the price/);
  assert.match(said, /try it today/);
  const total = spec.scenes.reduce((s, x) => s + x.duration, 0);
  const src = Number((await runMediaTool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4])).stdout);
  console.log(`  ${src.toFixed(2)}s → ${total.toFixed(2)}s in ${spec.scenes.length} cuts`);
  assert.ok(total < src - 3, "dead air and the abandoned take are gone");
  assert.ok(spec.scenes.every((s) => s.layers[0].type === "media" && typeof s.layers[0].trimStart === "number"));
  assert.equal(listSpecVersions(p.id)[0].author.kind, "director");
  console.log(`footage e2e: OK (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} catch (e) {
  console.error("footage e2e FAILED", e);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
