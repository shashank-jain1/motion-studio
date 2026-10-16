// 3D layer showcase / visual test (projects/test-3d): every material × lighting presets × every animation,
// "svg:" logos (Loopa, Brew), "text:" wordmarks, primitives, camera orbit, plus a hero sequence.
//   node_modules/.bin/tsx scripts/tests/seed-3d.ts
//   flock /tmp/claude-1000/ms-render.lock node_modules/.bin/tsx src/cli.ts preview test-3d <times> --scale=0.5
import fs from "node:fs";
import path from "node:path";
import { addAsset, computeTimeline, projectDir, writeSpec } from "../../src/core/projects";

const id = "test-3d";
const dir = projectDir(id);
if (!fs.existsSync(path.join(dir, "project.json"))) {
  for (const sub of ["assets", "renders", "previews"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id, name: "3D showcase", createdAt: new Date().toISOString(), format: "16:9" }, null, 2) + "\n");
}
for (const f of ["projects/loopa-reel-049c/assets/loopa-logo.svg", "projects/brew-film-f96a/assets/brew-logo.svg"]) {
  if (!fs.existsSync(path.join(dir, "assets", path.basename(f)))) await addAsset(id, { path: path.resolve(f) });
}

const LOOPA = "svg:assets/loopa-logo.svg";
const BREW = "svg:assets/brew-logo.svg";
const MATS = ["chrome", "glass", "clay", "matte", "gold", "plastic", "neon", "brushed", "pearl"] as const;

const DARK = { type: "gradient", colors: ["#1b1d24", "#07080b"], angle: 180, radial: true };
const LIGHT = { type: "gradient", colors: ["#f4f1ec", "#d9d4cc"], angle: 180, radial: true };

/** 3×3 grid of cells (1920×1080) */
const grid = (make: (i: number) => Record<string, unknown>, n = 9) =>
  Array.from({ length: n }, (_, i) => ({
    width: 600, height: 330, x: ((i % 3) - 1) * 620, y: (Math.floor(i / 3) - 1) * 345,
    ...make(i),
  }));
const label = (text: string, x: number, y: number, color = "#9aa0aa") =>
  ({ type: "text", text, fontSize: 22, weight: 600, color, x, y, font: "$body" });

const matGrid = (source: string, lighting: string, extra: Record<string, unknown> = {}, labelColor?: string) => [
  ...grid((i) => ({ type: "three", source, material: MATS[i], lighting, animation: "none", ...extra })),
  ...MATS.map((m, i) => label(m, ((i % 3) - 1) * 620, (Math.floor(i / 3) - 1) * 345 + 150, labelColor)),
];

const scenes = [
  // --- material sheets ----------------------------------------------------------------------
  { id: "mat-loopa-studio", duration: 1, background: DARK, layers: matGrid(LOOPA, "studio") },
  { id: "mat-text-softbox", duration: 1, background: LIGHT, layers: matGrid("text:Brew", "softbox", {}, "#6b6660") },
  { id: "mat-brew-dramatic", duration: 1, background: DARK, layers: matGrid(BREW, "dramatic") },
  { id: "mat-loopa-sunset", duration: 1, background: DARK, layers: matGrid(LOOPA, "sunset", { color: undefined }) },
  { id: "mat-text-rim", duration: 1, background: DARK, layers: matGrid("text:LOOPA", "rim", { weight: 800 }) },
  {
    id: "primitives", duration: 1, background: DARK,
    layers: [
      ...grid((i) => ({
        type: "three",
        source: `primitive:${["sphere", "box", "torus", "capsule", "cylinder", "knot"][i]}`,
        material: ["chrome", "glass", "clay", "gold", "pearl", "brushed"][i],
        lighting: ["studio", "softbox", "studio", "sunset", "rim", "neon"][i],
        animation: "none",
        orbit: [{ t: 0, yaw: -20, pitch: 14 }],
        color: i === 2 ? "#ff7a59" : undefined,
      }), 6),
    ],
  },
  // --- animations (3 s each) -----------------------------------------------------------------
  { id: "a-spin-in", duration: 3, background: DARK, layers: [{ type: "three", source: LOOPA, material: "chrome", lighting: "studio", animation: "spin-in", width: 1600, height: 900 }] },
  { id: "a-flip-in", duration: 3, background: DARK, layers: [{ type: "three", source: BREW, material: "gold", lighting: "sunset", animation: "flip-in", width: 1600, height: 900 }] },
  { id: "a-float", duration: 3, background: LIGHT, layers: [{ type: "three", source: "text:Brew", material: "glass", color: "#7fd1ff", lighting: "softbox", animation: "float", width: 1600, height: 900 }] },
  { id: "a-assemble", duration: 3, background: LIGHT, layers: [{ type: "three", source: LOOPA, material: "plastic", lighting: "softbox", animation: "assemble", width: 1600, height: 900 }] },
  { id: "a-explode", duration: 3, background: DARK, layers: [{ type: "three", source: BREW, material: "clay", lighting: "studio", animation: "explode", width: 1600, height: 900 }] },
  { id: "a-rise", duration: 3, background: { type: "solid", color: "#05040a" }, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "neon", color: "#ff3fb4", animation: "rise", width: 1600, height: 900 }] },
  { id: "a-turntable", duration: 3, background: DARK, layers: [{ type: "three", source: "primitive:knot", material: "pearl", lighting: "rim", animation: "turntable", width: 1600, height: 900 }] },
  {
    id: "a-orbit", duration: 3, background: DARK,
    layers: [{
      type: "three", source: "text:Brew", material: "brushed", lighting: "dramatic", animation: "none", width: 1600, height: 900,
      orbit: [{ t: 0, yaw: -40, pitch: 20, distance: 1.25 }, { t: 3, yaw: 25, pitch: 4, distance: 0.95, ease: "inOutQuint" }],
    }],
  },
  // --- hero (showcase/3d-logo.mp4) -------------------------------------------------------------
  {
    id: "hero", duration: 7, background: { type: "gradient", colors: ["#20232c", "#050608"], angle: 180, radial: true },
    fx: undefined,
    layers: [
      {
        type: "three", source: LOOPA, material: "chrome", lighting: "studio", animation: "spin-in", width: 1920, height: 1080,
        orbit: [{ t: 0, yaw: -34, pitch: 18, distance: 1.22 }, { t: 2.4, yaw: -12, pitch: 7, distance: 1, ease: "quintOut" }, { t: 7, yaw: 14, pitch: 3, distance: 0.92, ease: "inOut" }],
      },
      { type: "text", text: "Loop it. Love it.", preset: "blur-rise", fontSize: 44, weight: 600, color: "#c9ced8", y: 330, start: 2.4, font: "$body" },
    ],
  },
  // =================================================================================================
  // 3D v2 — cloner, particles, post, camera moves, kinetic type, deformers
  // =================================================================================================
  // --- cloner presets ---------------------------------------------------------------------------
  { id: "c-sweep", duration: 3.5, background: LIGHT, layers: [{ type: "three", mode: "cloner", source: LOOPA, material: "plastic", lighting: "softbox", cloner: { preset: "sweep" }, width: 1920, height: 1080 }] },
  { id: "c-tile-flip", duration: 3.5, background: DARK, layers: [{ type: "three", mode: "cloner", source: "text:LOOPA", weight: 800, material: "plastic", lighting: "studio", cloner: { preset: "tile-flip", colors: { inside: "#ff5a5f", outside: "#16181d", base: "#d9dce3" } }, width: 1920, height: 1080 }] },
  { id: "c-ripple", duration: 3.5, background: LIGHT, layers: [{ type: "three", mode: "cloner", source: LOOPA, material: "plastic", lighting: "softbox", cloner: { preset: "ripple", colors: { outside: "#f4f1ec", base: "#f4f1ec" } }, orbit: [{ t: 0, yaw: -18, pitch: 30, distance: 1.05 }], width: 1920, height: 1080 }] },
  { id: "c-split-flap", duration: 3.5, background: DARK, layers: [{ type: "three", mode: "cloner", source: "text:Brew", material: "plastic", lighting: "studio", cloner: { preset: "split-flap", colors: { inside: "#f2b25c", outside: "#121317", palette: ["#e8743b", "#2a2c33", "#f4f1ec", "#5b3a29", "#1b1d22"] } }, width: 1920, height: 1080 }] },
  { id: "c-cube-shuffle", duration: 3.5, background: LIGHT, layers: [{ type: "three", mode: "cloner", source: LOOPA, material: "plastic", lighting: "softbox", cloner: { preset: "cube-shuffle" }, orbit: [{ t: 0, yaw: -28, pitch: 20 }, { t: 3.5, yaw: -10, pitch: 8, ease: "inOutQuint" }], width: 1920, height: 1080 }] },
  { id: "c-burst-collapse", duration: 3.5, background: DARK, layers: [{ type: "three", mode: "cloner", source: "text:LOOPA", weight: 800, material: "chrome", lighting: "studio", color: "#ffffff", cloner: { preset: "burst-collapse", colors: { inside: "#ff8a8d" } }, post: { bloom: 0.5 }, width: 1920, height: 1080 }] },
  { id: "c-wave-field", duration: 3.5, background: { type: "solid", color: "#0b0c10" }, layers: [{ type: "three", mode: "cloner", source: BREW, material: "plastic", lighting: "studio", cloner: { preset: "wave-field", colors: { inside: "#f2b25c", outside: "#2a2e37", base: "#2a2e37" } }, orbit: [{ t: 0, yaw: -24, pitch: 52, distance: 1.0 }, { t: 3.5, yaw: -8, pitch: 40, distance: 0.92 }], width: 1920, height: 1080 }] },
  { id: "c-logo-of-logos", duration: 4, background: DARK, layers: [{ type: "three", mode: "cloner", source: "svg:assets/loopa-logo.svg#icon", material: "plastic", lighting: "studio", cloner: { preset: "logo-of-logos" }, camera: { move: "macro-pull", duration: 3.2, amount: 1.25 }, width: 1920, height: 1080 }] },
  // --- particles ---------------------------------------------------------------------------------
  { id: "p-chaos", duration: 3.5, background: { type: "solid", color: "#05060a" }, layers: [{ type: "three", mode: "particles", source: LOOPA, particles: { from: "chaos", count: 30000, trail: 2 }, post: { bloom: { strength: 0.5, threshold: 0.7 } }, background: "#05060a", width: 1920, height: 1080 }] },
  { id: "p-vortex", duration: 3.5, background: { type: "solid", color: "#05060a" }, layers: [{ type: "three", mode: "particles", source: "text:LOOPA", weight: 800, particles: { from: "vortex", count: 40000, colors: ["#ff5a5f", "#ffb35c", "#ffffff"] }, post: { bloom: 0.7 }, background: "#05060a", width: 1920, height: 1080 }] },
  { id: "p-explosion", duration: 4.5, background: { type: "solid", color: "#05060a" }, layers: [{ type: "three", mode: "particles", source: BREW, particles: { from: "explosion", count: 30000, disperseAt: 3.0 }, post: { bloom: 0.6 }, background: "#05060a", width: 1920, height: 1080 }] },
  { id: "p-galaxy-solid", duration: 4, background: DARK, layers: [{ type: "three", mode: "particles", source: LOOPA, material: "chrome", particles: { from: "galaxy", count: 30000, solidAt: 2.7 }, orbit: [{ t: 0, yaw: -30, pitch: 25, distance: 1.25 }, { t: 3.5, yaw: -12, pitch: 7, distance: 1, ease: "inOutQuint" }], post: { bloom: 0.5 }, width: 1920, height: 1080 }] },
  // --- post ----------------------------------------------------------------------------------------
  { id: "post-bloom-neon", duration: 3, background: { type: "solid", color: "#05040a" }, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "neon", color: "#ff3fb4", animation: "rise", post: { bloom: { strength: 1.0, threshold: 0.7 }, vignette: 0.35, grain: 0.03 }, background: "#05040a", width: 1920, height: 1080 }] },
  { id: "post-rack-focus", duration: 3.5, background: DARK, layers: [{ type: "three", source: "text:Brew", material: "gold", lighting: "sunset", animation: "cascade-flip", orbit: [{ t: 0, yaw: -48, pitch: 6, distance: 0.8 }], post: { dof: { aperture: 2, focus: [{ t: 0.6, z: 0.9 }, { t: 2.4, z: -0.9 }] }, bloom: 0.35, vignette: 0.3 }, background: "#0e0f13", width: 1920, height: 1080 }] },
  { id: "post-ca-grain", duration: 3, background: DARK, layers: [{ type: "three", source: LOOPA, material: "chrome", lighting: "studio", animation: "spin-in", post: { bloom: 0.4, ca: 0.006, vignette: 0.45, grain: 0.05 }, background: "#101218", width: 1920, height: 1080 }] },
  // --- camera ------------------------------------------------------------------------------------
  { id: "cam-dolly-zoom", duration: 3.5, background: { type: "solid", color: "#0b0c10" }, layers: [{ type: "three", mode: "cloner", source: BREW, material: "plastic", lighting: "studio", cloner: { preset: "wave-field", colors: { inside: "#f2b25c", outside: "#2a2e37", base: "#2a2e37" } }, orbit: [{ t: 0, yaw: -10, pitch: 34 }], camera: { move: "dolly-zoom", amount: 1.6, duration: 3.2, at: 0.2 }, width: 1920, height: 1080 }] },
  { id: "cam-god-shot", duration: 3.5, background: LIGHT, layers: [{ type: "three", mode: "cloner", source: LOOPA, material: "plastic", lighting: "softbox", cloner: { preset: "cube-shuffle", plane: "floor" }, orbit: [{ t: 0, yaw: -16, pitch: 38 }], camera: { move: "god-shot", duration: 3.2 }, width: 1920, height: 1080 }] },
  { id: "cam-macro-push", duration: 3.5, background: DARK, layers: [{ type: "three", source: LOOPA, material: "chrome", lighting: "studio", animation: "float", camera: { move: "macro-push", duration: 3.2 }, post: { dof: { aperture: 0.9 }, bloom: 0.3 }, background: "#101218", width: 1920, height: 1080 }] },
  { id: "cam-whip-pan", duration: 2.5, background: DARK, layers: [{ type: "three", source: BREW, material: "gold", lighting: "sunset", animation: "none", camera: { move: "whip-pan", at: 0.6 }, post: { bloom: 0.3 }, background: "#101218", width: 1920, height: 1080 }] },
  { id: "cam-path", duration: 4, background: DARK, layers: [{ type: "three", source: "primitive:knot", material: "pearl", lighting: "rim", animation: "turntable", camera: { path: [{ t: 0, pos: [-1.2, 0.9, 0.6] }, { t: 2, pos: [0.4, 0.2, 0.9] }, { t: 4, pos: [0.9, -0.1, 0.8] }], shake: 0.4 }, width: 1920, height: 1080 }] },
  // --- kinetic type --------------------------------------------------------------------------------
  { id: "k-rail", duration: 3.5, background: DARK, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "chrome", lighting: "studio", animation: "rail", orbit: [{ t: 0, yaw: -22, pitch: 12 }], width: 1920, height: 1080 }] },
  { id: "k-extrude-grow", duration: 3, background: LIGHT, layers: [{ type: "three", source: LOOPA, material: "plastic", lighting: "softbox", animation: "extrude-grow", depth: 0.35, orbit: [{ t: 0, yaw: 0, pitch: 0 }, { t: 2.6, yaw: -26, pitch: 12, ease: "inOutQuint" }], width: 1920, height: 1080 }] },
  { id: "k-cascade-flip", duration: 3, background: DARK, layers: [{ type: "three", source: "text:Brew", material: "gold", lighting: "sunset", animation: "cascade-flip", order: "center-out", width: 1920, height: 1080 }] },
  { id: "k-stack-echo", duration: 3.5, background: { type: "solid", color: "#ffd84d" }, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "plastic", color: "#ff5a5f", lighting: "softbox", animation: "stack-echo", echo: { count: 7, color: "#7a1f3d" }, orbit: [{ t: 0, yaw: -24, pitch: 14 }], shadow3d: false, width: 1920, height: 1080 }] },
  { id: "k-orbit-ring", duration: 4, background: DARK, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "chrome", lighting: "studio", animation: "orbit-ring", orbit: [{ t: 0, yaw: 0, pitch: 16, distance: 1.25 }, { t: 3.5, yaw: -10, pitch: 6, distance: 1 }], width: 1920, height: 1080 }] },
  { id: "k-drop", duration: 3, background: LIGHT, layers: [{ type: "three", source: "text:Brew", material: "clay", color: "#e8743b", lighting: "softbox", animation: "drop", width: 1920, height: 1080 }] },
  // --- deformers -----------------------------------------------------------------------------------
  { id: "d-twist", duration: 3, background: DARK, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "chrome", lighting: "studio", animation: "none", deform: [{ type: "twist", keys: [{ t: 0, amount: 0 }, { t: 1.2, amount: 160 }, { t: 2.6, amount: 0, ease: "outElastic" }] }], width: 1920, height: 1080 }] },
  { id: "d-bend", duration: 3, background: LIGHT, layers: [{ type: "three", source: LOOPA, material: "plastic", lighting: "softbox", animation: "none", deform: [{ type: "bend", keys: [{ t: 0, amount: 200 }, { t: 2.2, amount: 0, ease: "inOutQuint" }] }], width: 1920, height: 1080 }] },
  { id: "d-jiggle", duration: 3, background: LIGHT, layers: [{ type: "three", source: "text:Brew", material: "clay", color: "#ff7a59", lighting: "softbox", animation: "drop", deform: [{ type: "jiggle", at: 0.55, amount: 0.3 }, { type: "wave", amount: 0.0 }], width: 1920, height: 1080 }] },
  { id: "d-wave", duration: 3, background: DARK, layers: [{ type: "three", source: "text:LOOPA", weight: 800, material: "pearl", lighting: "rim", animation: "none", deform: [{ type: "wave", amount: 0.12, freq: 1.2, speed: 0.6 }, { type: "taper", keys: [{ t: 0, amount: 0 }, { t: 1.5, amount: 0.35 }, { t: 3, amount: 0 }] }], width: 1920, height: 1080 }] },
];

const res = await writeSpec(id, {
  title: "3D showcase", format: "16:9", fps: 30, style: "minimal-dark",
  theme: { fonts: { display: "Inter", body: "Inter" }, colors: { bg: "#0b0c10", fg: "#f4f4f6", muted: "#9aa0aa", accent: "#ff5a5f", accent2: "#2ec4b6" } },
  scenes,
});
console.log(id, res.ok === false ? JSON.stringify(res) : `ok (${(res.warnings ?? []).length} warnings)`);
for (const s of computeTimeline({ scenes } as never).scenes) console.log(`${String(s.id).padEnd(20)} ${s.start.toFixed(2)}–${s.end.toFixed(2)}`);
