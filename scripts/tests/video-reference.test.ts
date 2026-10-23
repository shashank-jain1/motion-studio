import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMediaTool } from "../../src/core/mediaTool";
import { inspectVideoReference } from "../../src/core/videoReference";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-reference-"));
try {
  const png = path.join(dir, "source.png"), video = path.join(dir, "reference.mp4");
  fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  await runMediaTool("ffmpeg", ["-y", "-v", "error", "-loop", "1", "-i", png, "-t", "1", "-r", "24", "-vf", "scale=320:180", "-pix_fmt", "yuv420p", "-c:v", "libx264", video]);
  const report = await inspectVideoReference(video, dir, { times: [0.7, 0, 0.7, 0.999] });
  assert.equal(report.width, 320); assert.equal(report.height, 180); assert.equal(report.fps, 24);
  assert.equal(report.hasAudio, false);
  assert.equal(report.frames.length, 3, "sort/deduplicate frame requests, clamp the final partial frame");
  assert.deepEqual(report.frames.map((f) => f.frame), [0, 17, 23]);
  assert.ok(report.frames.every((f) => fs.readFileSync(f.path).subarray(0, 2).toString("hex") === "ffd8"), "decode usable JPEG samples with the installed media runtime");
  assert.deepEqual(await inspectVideoReference(video, dir, { times: [0, 0.7, 0.999] }), report, "cached samples retain the same source/time identity");
  await assert.rejects(inspectVideoReference(video, dir, { times: [1] }), /inside/);
  await assert.rejects(inspectVideoReference(video, dir, { count: 25 }), /2–24/);
  console.log("Reference inspection: native decode/probe fallback, timestamped JPEGs, final-frame clamping, caching and bounded input passed.");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
