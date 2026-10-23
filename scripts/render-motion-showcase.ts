/** Reproducible motion/audio lab. Creates a NEW project; existing user projects are never overwritten. */
import fs from "node:fs";
import path from "node:path";
import { createProject, writeSpec, loadSpec } from "../src/core/projects";
import { renderFrames, renderVideo } from "../src/core/render";
import { buildMotionScene, type MotionRecipeId } from "../src/engine/choreo/recipes";
import { inspectSound } from "../src/engine/audio/inspect";
import { sceneTimeline } from "../src/engine/spec/preprocess";
import type { SpecInput } from "../src/engine/spec/schema";
import { reviewExportAudio } from "../src/core/renderAudioReview";

const args = process.argv.slice(2), quality = args.includes("--final") ? "final" : "draft";
const reuse = args.find((a) => a.startsWith("--project="))?.slice("--project=".length);
const project = reuse ? { id: reuse } : createProject({ name: "Motion Lab — Choreography", format: "16:9" });
const shots: { recipe: MotionRecipeId; text: string; subtitle: string; accent: string; background: string; foreground: string }[] = [
  { recipe: "type-impact", text: "FEEL IT.", subtitle: "01 / WEIGHT HAS A SOUND", accent: "#caff4b", background: "#11120f", foreground: "#f0f0e8" },
  { recipe: "magnetic-deck", text: "PULL\nTOGETHER.", subtitle: "02 / ANTICIPATION. CONTACT. RELEASE.", accent: "#ff6147", background: "#eeede6", foreground: "#141711" },
  { recipe: "orbit-hero", text: "TAKE\nA TURN.", subtitle: "03 / AN ARC WITH INTENTION", accent: "#a9b9ff", background: "#171826", foreground: "#eeefff" },
  { recipe: "ribbon-flight", text: "FOLLOW\nTHE FLOW.", subtitle: "04 / SOUND FOLLOWS VELOCITY", accent: "#ff5a42", background: "#eeeae1", foreground: "#171915" },
  { recipe: "hinge-editorial", text: "OPEN UP.", subtitle: "05 / A MATERIAL WORLD", accent: "#ffac46", background: "#181712", foreground: "#f2e9db" },
  { recipe: "vortex-tunnel", text: "INTO\nTHE NEXT.", subtitle: "06 / DEPTH WITHOUT THE NOISE", accent: "#a6ffcf", background: "#10201a", foreground: "#e8fff3" },
  { recipe: "chrome-echo", text: "SHIFT", subtitle: "07 / LIGHT. DEPTH. MOTION.", accent: "#d9deef", background: "#111722", foreground: "#e9edf6" },
  { recipe: "particle-forge", text: "MOTION", subtitle: "08 / CHAOS BECOMES CLARITY", accent: "#caff4b", background: "#10120b", foreground: "#f4ffd9" },
];
if (!reuse) {
  const spec: SpecInput = {
    version: 1, title: "Motion Lab / One clock", format: "16:9", fps: 30, style: "minimal-dark",
    theme: { fonts: { display: "Inter", body: "Inter", mono: "Inter" }, colors: { bg: "#11120f", fg: "#f0f0e8", accent: "#caff4b", accent2: "#ff6147" } },
    sound: { volume: 0.75, brief: { voice: "precise", realism: "mixed", materials: ["metal-thin", "paper", "air"], space: "room", key: "D minor", avoid: ["cartoon", "gamey"] }, restraint: 0.65, variation: 0.45 },
    scenes: shots.map((s, i) => buildMotionScene({ ...s, id: `shot-${i + 1}-${s.recipe}`, duration: 3.2 })),
  };
  const validation = await writeSpec(project.id, spec);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
}
const spec = loadSpec(project.id), report = inspectSound(spec);
const out = path.resolve("showcase");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "motion-lab-cues.json"), JSON.stringify({ projectId: project.id, ...report }, null, 2));
console.log(`Project: ${project.id}; ${report.total}s; ${report.cues.length} cues; ${report.warnings.length} timing warnings`);
if (args.includes("--review-only")) {
  const record = JSON.parse(fs.readFileSync(path.join(out, "motion-lab-render.json"), "utf8")) as { projectId: string; showcase: string };
  if (record.projectId !== project.id) throw new Error("Use --project=<id> matching the saved showcase render.");
  const review = await reviewExportAudio(spec, record.showcase);
  fs.writeFileSync(path.join(out, "motion-lab-export-review.json"), JSON.stringify(review, null, 2));
  console.log(JSON.stringify(review, null, 2));
  process.exit(0);
}
if (!args.includes("--video-only")) {
  const tl = sceneTimeline(spec.scenes, spec.fps);
  const times = tl.scenes.flatMap((s) => [s.start + 0.55, s.end - 0.65]);
  const preview = await renderFrames(project.id, times, { scale: 0.4, sheet: !args.includes("--no-sheet") });
  fs.writeFileSync(path.join(out, "motion-lab-frames.json"), JSON.stringify(preview, null, 2));
  if (preview.sheet) fs.copyFileSync(preview.sheet, path.join(out, "motion-lab-sheet.jpg"));
  console.log(`Frames: ${preview.frames.map((f) => f.path).join("\n")}`);
}
if (!args.includes("--preview-only")) {
  let last = -1;
  const video = await renderVideo(project.id, { quality, onProgress: (p) => {
    const bucket = Math.floor(p.progress * 10);
    if (bucket !== last) { last = bucket; console.log(`Render ${bucket * 10}% · ${p.renderedFrames} frames`); }
  } });
  const dest = path.join(out, `motion-lab-${quality}.mp4`);
  fs.copyFileSync(video.path, dest);
  fs.writeFileSync(path.join(out, "motion-lab-render.json"), JSON.stringify({ projectId: project.id, ...video, showcase: dest }, null, 2));
  console.log(`Video: ${dest}`);
  const review = await reviewExportAudio(spec, dest);
  fs.writeFileSync(path.join(out, "motion-lab-export-review.json"), JSON.stringify(review, null, 2));
  console.log(`Export review: ${review.checkedCues} cues, sync ${review.syncPassed ? "passed" : "needs review"}; ${review.loudness?.lufs} LUFS / ${review.loudness?.truePeak} dBTP`);
}
// The asset server intentionally stays alive for interactive callers; a one-shot lab command exits when done.
process.exit(0);
