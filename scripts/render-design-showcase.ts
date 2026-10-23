import fs from "node:fs";
import path from "node:path";
import { buildDesignFilm } from "../src/engine/choreo/designFilm";
import { createProject, loadSpec, writeSpec } from "../src/core/projects";
import { renderFrames, renderVideo } from "../src/core/render";
import { inspectSound } from "../src/engine/audio/inspect";
import { reviewExportAudio } from "../src/core/renderAudioReview";

const args = process.argv.slice(2), existing = args.find((s) => s.startsWith("--project="))?.slice(10);
const cinematic = args.includes("--cinematic"), base = cinematic ? "design-film-cinematic" : "design-film";
const project = existing ? { id: existing } : createProject({ name: cinematic ? "Motion With Meaning — Cinematic Type" : "Motion With Meaning — Editorial Film", format: "16:9" });
if (!existing || args.includes("--refresh")) {
  const result = await writeSpec(project.id, buildDesignFilm({ typography: cinematic ? "cinematic" : "graphic" }));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  console.log(`Saved ${project.id}; ${result.warnings.length} craft notes`);
}
const spec = loadSpec(project.id), out = path.resolve("showcase");
fs.mkdirSync(out, { recursive: true });
const report = inspectSound(spec);
fs.writeFileSync(path.join(out, `${base}-cues.json`), JSON.stringify({ projectId: project.id, ...report }, null, 2));
console.log(`${project.id}: ${report.cues.length} accents, ${report.bridges.length} connections`);
if (!args.includes("--video-only") && !args.includes("--review-only")) {
  const frames = await renderFrames(project.id, [0.2, 1.6, 2.6, 3.7, 4.7, 5.7, 6.7, 7.6, 8.4, 9.6, 10.8, 12, 13, 14.2, 15.45, 15.8, 16.7, 18.5, 19.8], { scale: 0.5, sheet: false });
  fs.writeFileSync(path.join(out, `${base}-frames.json`), JSON.stringify(frames, null, 2));
  console.log(`${frames.frames.length} frames previewed`);
}
if (!args.includes("--preview-only")) {
  const file = path.join(out, `${base}.mp4`);
  if (!args.includes("--review-only")) {
    let previous = -1;
    const video = await renderVideo(project.id, { quality: args.includes("--draft") ? "draft" : "final", onProgress: (p) => {
      const bucket = Math.floor(p.progress * 5); if (bucket !== previous) { previous = bucket; console.log(`Render ${bucket * 20}%`); }
    } });
    fs.copyFileSync(video.path, file);
  }
  const review = await reviewExportAudio(spec, file);
  fs.writeFileSync(path.join(out, `${base}-export-review.json`), JSON.stringify({ projectId: project.id, ...review }, null, 2));
  console.log(`Exported audio ${review.syncPassed ? "passed" : "needs review"}: ${review.checkedCues} accents`);
}
process.exit(0);
