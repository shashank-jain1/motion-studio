// 3D v2 showcase reel (~11 s): particle formation → tile-flip reveal → burst-collapse → logo-of-logos → stack echo.
// Builds a temp project from test-3d's assets, renders final 1080p, copies to showcase/3d-v2-reel.mp4.
//   flock /tmp/claude-1000/ms-heavy.lock node_modules/.bin/tsx scripts/tests/render-3d-v2-reel.ts [draft|final]
import fs from "node:fs";
import path from "node:path";
import { deleteProject, projectDir, writeSpec } from "../../src/core/projects";
import { renderFrames, renderVideo } from "../../src/core/render";

const q = (process.argv[2] ?? "final") as "draft" | "final" | "preview";
const id = "test-3d-v2-reel";
const dir = projectDir(id);
for (const sub of ["assets", "renders", "previews"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id, name: "3D v2 reel (temp)", createdAt: new Date().toISOString(), format: "16:9" }));
for (const f of fs.readdirSync(path.join(projectDir("test-3d"), "assets"))) fs.copyFileSync(path.join(projectDir("test-3d"), "assets", f), path.join(dir, "assets", f));
fs.copyFileSync(path.join(projectDir("test-3d"), "glyphs.json"), path.join(dir, "glyphs.json"));

const LOOPA = "svg:assets/loopa-logo.svg";
const INK = "#05060a";
const full = { width: 1920, height: 1080 };
const scenes = [
  {
    id: "form", duration: 2.5, background: { type: "solid", color: INK },
    layers: [{
      type: "three", mode: "particles", source: "text:LOOPA", weight: 800, ...full, background: INK,
      particles: { from: "vortex", count: 40000, start: 0, duration: 1.55, spread: 0.45, trail: 2, colors: ["#ff5a5f", "#ffb35c", "#ffe9d6"] },
      camera: { move: "push-in", duration: 2.5 }, post: { bloom: { strength: 0.55, threshold: 0.7 }, vignette: 0.3, grain: 0.02 },
    }],
  },
  {
    id: "flip", duration: 2.3, background: { type: "solid", color: "#0d0e12" },
    layers: [{
      type: "three", mode: "cloner", source: LOOPA, material: "plastic", lighting: "studio", ...full,
      cloner: { preset: "tile-flip", density: 13, colors: { outside: "#f1eee9", base: "#22252c" } },
      fields: [
        { kind: "linear", axis: 20, start: 0.05, end: 1.45, width: 0.22, ease: "linear", spring: 0.75, effect: { rotateY: [0, 180], color: "reveal" } },
        { kind: "linear", axis: 20, start: 0.05, end: 1.45, width: 0.22, ease: "linear", spring: 0.75, pulse: true, effect: { z: 0.3 } },
      ],
      orbit: [{ t: 0, yaw: -20, pitch: 10, distance: 1.06 }, { t: 2.3, yaw: -8, pitch: 4, distance: 0.96, ease: "inOut" }],
    }],
  },
  {
    id: "burst", duration: 2.4, background: { type: "gradient", colors: ["#1b1d24", "#07080b"], angle: 180, radial: true },
    layers: [{
      type: "three", mode: "cloner", source: "text:LOOPA", weight: 800, material: "chrome", lighting: "studio", color: "#ffffff", ...full,
      cloner: { preset: "burst-collapse", colors: { inside: "#ff8a8d" } }, post: { bloom: 0.45, vignette: 0.25 },
      orbit: [{ t: 0, yaw: -26, pitch: 12, distance: 1.1 }, { t: 2.4, yaw: -10, pitch: 6, distance: 0.98, ease: "inOut" }],
    }],
  },
  {
    id: "logos", duration: 2.2, background: { type: "gradient", colors: ["#1b1d24", "#07080b"], angle: 180, radial: true },
    layers: [{
      type: "three", mode: "cloner", source: "svg:assets/loopa-logo.svg#icon", material: "plastic", lighting: "studio", ...full,
      cloner: { preset: "logo-of-logos" }, camera: { move: "macro-pull", duration: 2.0, amount: 1.25 },
    }],
  },
  {
    id: "echo", duration: 1.9, background: { type: "solid", color: "#ffd84d" },
    layers: [{
      type: "three", source: "text:LOOPA", weight: 800, material: "plastic", color: "#ff5a5f", lighting: "softbox", animation: "stack-echo", ...full,
      echo: { count: 7, color: "#7a1f3d" }, orbit: [{ t: 0, yaw: -30, pitch: 16, distance: 1.08 }, { t: 1.9, yaw: -18, pitch: 10, distance: 0.98 }], shadow3d: false,
    }],
  },
];

const res = await writeSpec(id, {
  title: "3D v2 reel", format: "16:9", fps: 30, style: "minimal-dark",
  theme: { fonts: { display: "Inter", body: "Inter" }, colors: { bg: "#0b0c10", fg: "#f4f4f6", muted: "#9aa0aa", accent: "#ff5a5f", accent2: "#2ec4b6" } },
  scenes,
});
if (res.ok === false) throw new Error(JSON.stringify(res));
if (q === "preview") {
  // contact sheet across the reel (kept in projects/test-3d-v2-reel/previews), no video
  const times = (process.argv[3] ?? "0.3,0.9,1.6,2.3,2.8,3.4,4.2,5.1,5.6,6.3,7.2,7.6,8.4,9.2,9.6,10.4,11.1").split(",").map(Number);
  const r = await renderFrames(id, times, { scale: 0.4 });
  console.log(`sheet\t${r.sheet}`);
  process.exit(0);
}
try {
  const t0 = Date.now();
  const out = await renderVideo(id, { quality: q });
  const frames = Math.round(out.seconds * out.fps);
  console.log(`${q}: ${out.width}x${out.height} ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s wall (${((Date.now() - t0) / frames).toFixed(0)} ms/frame incl. bundle/browser/encode), ${(out.sizeBytes / 1e6).toFixed(2)} MB`);
  fs.mkdirSync("showcase", { recursive: true });
  const dest = q === "final" ? "showcase/3d-v2-reel.mp4" : "showcase/3d-v2-reel-draft.mp4";
  fs.copyFileSync(out.path, dest);
  console.log(`→ ${dest}`);
} finally {
  deleteProject(id);
}
