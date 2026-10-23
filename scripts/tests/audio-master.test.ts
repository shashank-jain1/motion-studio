import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeWav, encodeWav, type Buf } from "../../src/engine/audio/dsp";
import { runMediaTool } from "../../src/core/mediaTool";
import { masterLoudness, measureLoudness } from "../../src/core/audioMaster";
import { SpecSchema } from "../../src/engine/spec/schema";
import { sceneTimeline } from "../../src/engine/spec/preprocess";
import { planSoundV2 } from "../../src/engine/audio/autoSound";
import { bakeRecipe } from "../sfx-bake";
import { reviewExportAudio } from "../../src/core/renderAudioReview";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-master-"));
try {
  const sr = 48000, n = sr * 3, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = R[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.12;
  const wav = path.join(dir, "reference.wav"), mp4 = path.join(dir, "mix.mp4");
  fs.writeFileSync(wav, encodeWav({ sr, n, L, R } as Buf, 7));
  await runMediaTool("ffmpeg", ["-v", "error", "-y", "-i", wav, "-c:a", "aac", mp4]);
  const before = await measureLoudness(mp4);
  assert.ok(before && Number.isFinite(before.lufs));
  const result = await masterLoudness(mp4);
  assert.ok(result?.applied, "mastering must not silently skip when only Remotion's binaries are available");
  const after = await measureLoudness(mp4);
  assert.ok(after && Math.abs(after.lufs + 14) < 0.5, `expected -14 LUFS, got ${after?.lufs}`);
  assert.ok(after!.truePeak < -1);
  fs.writeFileSync(wav, encodeWav({ sr, n, L: new Float32Array(n), R: new Float32Array(n) } as Buf, 7));
  assert.equal(await measureLoudness(wav), null, "silence has no finite integrated loudness");
  console.log(`Audio mastering: ${before!.lufs} → ${after!.lufs} LUFS; true peak ${after!.truePeak} dBTP. Silence handling passed.`);

  const spec = SpecSchema.parse({ fps: 30, sound: {}, scenes: [{ duration: 3, layers: [{ type: "shape", shape: "circle", accents: [{ at: 1, role: "impact", importance: "hero" }] }] }] });
  const cue = planSoundV2(spec, sceneTimeline(spec.scenes, 30), { fps: 30 }).cues[0];
  const reference = decodeWav(new Uint8Array(fs.readFileSync(bakeRecipe(cue.src.slice(5)))));
  for (const offset of [0, 0.09]) {
    const mixL = new Float32Array(n), mixR = new Float32Array(n);
    const start = Math.round((cue.at + offset) * sr);
    for (let j = 0; j < reference.n; j++) {
      const i = start + j;
      if (i >= 0 && i < n) { mixL[i] += reference.L[j] * 0.4; mixR[i] += reference.R[j] * 0.4; }
    }
    fs.writeFileSync(wav, encodeWav({ n, L: mixL, R: mixR }, 7));
    await runMediaTool("ffmpeg", ["-v", "error", "-y", "-i", wav, "-c:a", "aac", mp4]);
    const review = await reviewExportAudio(spec, mp4);
    assert.equal(review.checkedCues, 1);
    assert.ok(review.cues[0].correlation > 0.9, "AAC cue should match its baked waveform");
    assert.ok(Math.abs(review.cues[0].offsetMs - offset * 1000) < 2, "review must recover known inserted drift");
    assert.equal(review.syncPassed, offset === 0, "90 ms drift must fail the two-frame tolerance");
  }
  console.log("Export sync review: aligned AAC passed; deliberately delayed 90 ms AAC correctly failed.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
