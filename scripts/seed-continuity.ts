// "test-continuity": exercises actors (shared element across scenes), the content-aware transitions
// (expand / zoom-into / slice / match), the new kinetic-text presets, text fills and beat-time strings.
// Usage: tsx scripts/seed-continuity.ts [/abs/fill-image.jpg] [/abs/fill-video.mp4]
import fs from "node:fs";
import path from "node:path";
import { addAsset, createProject, listProjects, writeSpec, projectDir } from "../src/core/projects";
import { preprocessSpecDetailed, sceneTimeline } from "../src/engine/spec/preprocess";

const name = "test-continuity";
const existing = listProjects().find((p) => p.name === name);
const id = existing?.id ?? createProject({ name, format: "16:9" }).id;

const [img, vid] = process.argv.slice(2);
const assetsDir = path.join(projectDir(id), "assets");
for (const src of [img, vid]) {
  if (src && !fs.existsSync(path.join(assetsDir, path.basename(src)))) await addAsset(id, { path: src });
}

const raw = {
  format: "16:9", style: "neon", fps: 30,
  bpm: 120, beatOffset: 0,
  theme: { colors: { bg: "#07060d", fg: "#f4f1ff", accent: "#ff3d7f", accent2: "#7a5cff" } },
  actors: [{
    id: "dot",
    layer: { type: "shape", shape: "circle", width: 90, color: "$accent", glow: true, enter: { type: "pop", duration: 0.5 } },
    poses: [
      { scene: "intro", t: 0, x: 0, y: -170, scale: 1 },
      { scene: "intro", t: "beat:6", x: 0, y: -170, scale: 1 },
      { scene: "drop", t: 0.9, x: -640, y: -300, scale: 0.6, ease: "inOutExpo" },
      { scene: "drop", t: "beat:13", x: -640, y: -300, scale: 0.6 },
      { scene: "echo", t: 0.5, x: 700, y: 330, scale: 0.35, ease: "inOutQuint" },
    ],
    until: "echo",
  }, {
    // shared-element morph: a dot in the intro, a coin in "drop", a star in "echo" (shape `at` = global beats)
    id: "seed",
    layer: { type: "morph", width: 160, height: 160, fill: "#ffd23f", shapes: [
      { at: 0, shape: "circle", scale: 0.35 },
      { at: "beat:9", shape: "coin", morph: 0.7, twist: 90 },
      { at: "beat:16", shape: "star", fill: "#ff3d7f", morph: 0.8, twist: -40 },
    ] },
    poses: [
      { scene: "intro", t: 0, x: -640, y: 300, scale: 0.8 },
      { scene: "drop", t: "beat:9", x: 620, y: -260, scale: 1, ease: "inOutExpo" },
      { scene: "echo", t: "beat:16", x: -700, y: -330, scale: 0.7, rotate: 15, ease: "inOutQuint" },
    ],
    until: "slice",
  }],
  scenes: [
    { id: "intro", duration: "beats:8", background: { type: "spotlight", base: "#07060d", color: "#2a1440" },
      camera: { punch: ["beat:4"] },
      layers: [
        { type: "text", text: "Make it faster", preset: "slot", swap: { words: ["simpler", "louder", "yours"], every: 0.6 }, fontSize: 140, y: 90, weight: 800, start: "beat:1" },
      ] },
    { id: "drop", duration: "beat:16", transition: { type: "expand", from: "dot", color: "$accent2", duration: "beats:1.5" },
      background: { type: "solid", color: "#160b2e" },
      layers: [
        { type: "text", text: "DROP IT", preset: "physics", fontSize: 200, weight: 900, y: -40, start: "beat:9" },
        { type: "text", text: "into the third dimension", preset: "cascade-3d", fontSize: 64, y: 150, start: "beat:11", weight: 600 },
        { id: "hole", type: "shape", shape: "circle", width: 70, color: "#ffd23f", x: 520, y: 260, start: "beat:12", enter: { type: "pop", delay: 0, duration: 0.4 } },
      ] },
    { id: "echo", duration: "beats:9", transition: { type: "zoom-into", from: "hole", duration: "beats:2" },
      background: { type: "gradient", colors: ["#0b2a4a", "#071423"], angle: 160 },
      layers: [
        { type: "text", text: "REPEAT", preset: "echo", fontSize: 150, weight: 900, echoCount: 7, start: "beat:17" },
      ] },
    { id: "slice", duration: "beats:8", transition: { type: "slice", duration: "beats:1.5", slices: 6 },
      background: { type: "solid", color: "#1b0710" },
      layers: [
        { type: "text", text: "CUT CLEAN", preset: "slice", fontSize: 190, weight: 900, y: -90, start: "beat:25" },
        { type: "text", text: "weight that breathes", preset: "weight-wave", fontSize: 90, y: 130, weight: 500, start: "beat:26" },
      ] },
    { id: "fill", duration: "beats:10", transition: { type: "match" },
      background: { type: "solid", color: "#07060d" },
      layers: [
        ...(img ? [{ type: "text", text: "COLOR", preset: "mask-up", fill: `assets/${path.basename(img)}`, fontSize: 300, weight: 900, y: -150 }] : []),
        ...(vid ? [{ type: "text", text: "MOTION", preset: "blur-rise", fill: `assets/${path.basename(vid)}`, fontSize: 260, weight: 900, y: 170, start: 0.3 }] : []),
        { id: "chip", type: "shape", shape: "rect", width: 260, height: 96, radius: 48, color: "#ffd23f", x: 620, y: 420, start: "beat:34", enter: { type: "pop", duration: 0.4 } },
      ] },
    { id: "outro", duration: "beats:6", transition: { type: "expand", from: "chip", shape: "rounded", duration: "beats:2" },
      background: { type: "solid", color: "#ffd23f" },
      layers: [
        { type: "text", text: "Ship it.", preset: "cascade-3d", fontSize: 220, weight: 900, color: "#07060d", start: 0.4 },
      ] },
  ],
};

// The core validator does not preprocess beat strings yet (lead wires preprocessSpec into src/core/projects.ts),
// so store the converted spec and keep the beat-authored source next to it for reference.
const pre = preprocessSpecDetailed(raw);
if (pre.errors.length) console.error(pre.errors);
fs.writeFileSync(path.join(projectDir(id), "spec.beats.json"), JSON.stringify(raw, null, 2));
const res = await writeSpec(id, pre.spec);
console.log(id, JSON.stringify(res));
const spec = pre.spec as { scenes: { id?: string; duration: number; transition?: { type: string; duration?: number } }[] };
for (const s of sceneTimeline(spec.scenes, 30).scenes) {
  const tr = spec.scenes[s.index].transition;
  const q = (f: number) => (s.start + s.overlapIn * f).toFixed(2);
  console.log(`${s.id}: ${s.start.toFixed(2)}–${s.end.toFixed(2)}${tr && s.overlapIn ? `  ${tr.type} 25/50/75% @ ${q(0.25)},${q(0.5)},${q(0.75)}` : tr ? `  ${tr.type}` : ""}`);
}
