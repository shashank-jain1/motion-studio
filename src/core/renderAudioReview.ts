/** Post-export evidence: compare baked cue waveforms with decoded AAC. No claim about perceived sound quality. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Spec } from "../engine/spec/schema";
import { sceneTimeline } from "../engine/spec/preprocess";
import { planSoundV2 } from "../engine/audio/autoSound";
import { decodeWav } from "../engine/audio/dsp";
import { bakeRecipe } from "../../scripts/sfx-bake";
import { runMediaTool } from "./mediaTool";
import { measureLoudness } from "./audioMaster";

export const reviewExportAudio = async (spec: Spec, file: string) => {
  const tl = sceneTimeline(spec.scenes, spec.fps), total = tl.totalFrames / spec.fps;
  if (total > 180) throw new Error("Waveform sync review currently supports renders up to 180 seconds.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-export-review-"));
  try {
    const { stdout } = await runMediaTool("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,nb_frames,r_frame_rate:format=duration", "-of", "json", file]);
    const media = JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_frames?: string; r_frame_rate?: string }[]; format: { duration: string } };
    if (!media.streams.some((s) => s.codec_type === "audio")) throw new Error("Rendered file has no audio stream.");
    const decoded = path.join(dir, "audio.wav");
    await runMediaTool("ffmpeg", ["-v", "error", "-y", "-i", file, "-map", "0:a:0", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", decoded]);
    const output = decodeWav(new Uint8Array(fs.readFileSync(decoded)));
    const plan = spec.sound && spec.sound.auto !== false ? planSoundV2(spec, tl, { fps: spec.fps, total }) : null;
    const cues = [...(plan?.cues ?? []), ...(plan?.bridges ?? [])].filter((c) => c.src.startsWith("bake:") && c.volume > 0);
    const results = cues.map((c) => {
      const reference = decodeWav(new Uint8Array(fs.readFileSync(bakeRecipe(c.src.slice(5)))));
      const apex = c.peak - c.at;
      const a = Math.max(0, Math.round((apex - 0.03) * 48000));
      const b = Math.min(reference.n - 1, Math.round((apex + 0.14) * 48000));
      const predicted = Math.round(c.at * 48000);
      let best = -1, bestShift = 0;
      const correlate = (shift: number) => {
        let dot = 0, aa = 0, bb = 0;
        for (let j = a; j < b; j += 8) {
          const k = predicted + j + shift;
          if (k < 0 || k >= output.n) continue;
          const x = (reference.L[j] + reference.R[j]) * 0.5, y = (output.L[k] + output.R[k]) * 0.5;
          dot += x * y; aa += x * x; bb += y * y;
        }
        return dot / Math.max(1e-12, Math.sqrt(aa * bb));
      };
      // Coarse search followed by sample-accurate refinement. Half a millisecond alone is too coarse for
      // noisy whooshes/clicks: their waveform decorrelates even though their envelope is correctly aligned.
      const candidates: { shift: number; score: number }[] = [];
      for (let shift = -4800; shift <= 4800; shift += 24) candidates.push({ shift, score: correlate(shift) });
      const refine = candidates.sort((a, b) => b.score - a.score).slice(0, 8).map((c) => ({ shift: c.shift, radius: 24 }));
      // SoundTrack mounts each source at the nearest video frame. Always search that expected quantization
      // window precisely, even if broadband noise produces weak/aliased peaks in the coarse search.
      refine.push({ shift: Math.round((Math.round(c.at * spec.fps) / spec.fps - c.at) * 48000), radius: 96 });
      for (const c of refine) {
        for (let shift = c.shift - c.radius; shift <= c.shift + c.radius; shift++) {
          const score = correlate(shift);
          if (score > best) { best = score; bestShift = shift; }
        }
      }
      const offsetFrames = bestShift / 48000 * spec.fps;
      return { role: c.role, reason: c.reason, expectedFrame: Math.round(c.peak * spec.fps),
        offsetMs: Math.round(bestShift / 48 * 10) / 10, offsetFrames: Math.round(offsetFrames * 100) / 100,
        correlation: Math.round(best * 1000) / 1000, passed: best >= 0.65 && Math.abs(offsetFrames) <= 2 };
    });
    const loudness = await measureLoudness(file);
    const foreground = results.filter((r) => r.role !== "bridge"), bridges = results.filter((r) => r.role === "bridge");
    return { file, seconds: Number(media.format.duration), streams: media.streams, loudness,
      checkedCues: foreground.length, syncPassed: foreground.length > 0 && foreground.every((c) => c.passed), cues: foreground,
      checkedBridges: bridges.length, bridges,
      limitations: "Compares baked cues against the CURRENT spec; imported/manual audio is not correlated. Low correlation can indicate overlap or an outdated spec. This is technical timing evidence, not a listening review.",
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
