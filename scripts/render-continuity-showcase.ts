import fs from "node:fs";
import path from "node:path";
import { buildMotionSequence } from "../src/engine/choreo/sequences";
import { createProject, writeSpec, loadSpec } from "../src/core/projects";
import { renderFrames, renderVideo } from "../src/core/render";
import { inspectSound } from "../src/engine/audio/inspect";
import { planSoundV2 } from "../src/engine/audio/autoSound";
import { sceneTimeline } from "../src/engine/spec/preprocess";
import { decodeWav, encodeWav, makeBuf, truePeak } from "../src/engine/audio/dsp";
import { bakeRecipe } from "./sfx-bake";
import { reviewExportAudio } from "../src/core/renderAudioReview";

const args = process.argv.slice(2), existing = args.find((x) => x.startsWith("--project="))?.slice(10);
const project = existing ? { id: existing } : createProject({ name: "Continuous Motion — One Sonic World", format: "16:9" });
if (!existing || args.includes("--refresh")) {
  const spec = buildMotionSequence({ treatment: args.includes("--2d") ? "metamorphosis" : "sculpture-flow" });
  const result = await writeSpec(project.id, spec);
  if (!result.ok) throw new Error(result.errors.join("\n"));
}
const spec = loadSpec(project.id), tl = sceneTimeline(spec.scenes, spec.fps), total = tl.totalFrames / spec.fps;
const out = path.resolve("showcase"), report = inspectSound(spec);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "continuity-cues.json"), JSON.stringify({ projectId: project.id, ...report }, null, 2));
const plan = planSoundV2(spec, tl, { fps: spec.fps, total });
// Same foreground cues and same gain for both files: the A/B isolates continuity bridges, not loudness changes.
const stems = [makeBuf(total), makeBuf(total)];
for (let which = 0; which < 2; which++) for (const cue of [...plan.cues, ...(which ? plan.bridges : [])]) {
  if (!cue.src.startsWith("bake:")) continue;
  const audio = decodeWav(new Uint8Array(fs.readFileSync(bakeRecipe(cue.src.slice(5)))));
  const offset = Math.round(cue.at * spec.fps) / spec.fps * 48000;
  for (let j = 0; j < audio.n; j++) {
    const k = Math.round(offset) + j;
    if (k < 0 || k >= stems[which].n) continue;
    stems[which].L[k] += audio.L[j] * cue.volume * (spec.sound?.volume ?? 0.8);
    stems[which].R[k] += audio.R[j] * cue.volume * (spec.sound?.volume ?? 0.8);
  }
}
const gain = Math.min(2, 0.88 / Math.max(...stems.map(truePeak)));
stems.forEach((b, i) => {
  for (let j = 0; j < b.n; j++) { b.L[j] *= gain; b.R[j] *= gain; }
  fs.writeFileSync(path.join(out, i ? "continuity-connected.wav" : "continuity-isolated.wav"), encodeWav(b, 17));
});
console.log(`Project ${project.id}; ${plan.cues.length} accents; ${plan.bridges.length} connections; ${plan.phrases.length} sonic phrase(s)`);
if (!args.includes("--video-only")) {
  const preview = await renderFrames(project.id, tl.scenes.flatMap((s) => [s.start + 0.9, s.end - 0.2]), { scale: 0.4, sheet: false });
  fs.writeFileSync(path.join(out, "continuity-frames.json"), JSON.stringify(preview, null, 2));
  console.log(`Frames: ${preview.frames.map((f) => f.path).join("\n")}`);
}
if (!args.includes("--preview-only")) {
  let last = -1;
  const video = await renderVideo(project.id, { quality: args.includes("--draft") ? "draft" : "final", onProgress: (p) => {
    const bucket = Math.floor(p.progress * 5); if (bucket !== last) { last = bucket; console.log(`Render ${bucket * 20}%`); }
  } });
  const file = path.join(out, "continuity-film.mp4"); fs.copyFileSync(video.path, file);
  const review = await reviewExportAudio(spec, file);
  fs.writeFileSync(path.join(out, "continuity-export-review.json"), JSON.stringify({ projectId: project.id, ...review }, null, 2));
  console.log(`Video ${file}; exported cue sync: ${review.syncPassed ? "passed" : "needs review"}`);
}
process.exit(0);
