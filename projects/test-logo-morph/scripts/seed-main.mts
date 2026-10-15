import { writeSpec, computeTimeline } from "/home/shashank/motion-studio/src/core/projects";
import { SHAPE_NAMES } from "/home/shashank/motion-studio/src/engine/shapes/library";

const CREAM = { type: "solid", color: "#f6efe6" } as const;
const INK = "#3a2218";
const label = (s: string) => ({ type: "text", text: s, fontSize: 26, color: "#9a8b7d", y: 420, letterSpacing: 0.2, uppercase: true });
const cols = 8, cell = 225;
const lib = SHAPE_NAMES.map((n, i) => ({ type: "morph", width: 170, height: 170, x: ((i % cols) - (cols - 1) / 2) * cell, y: (Math.floor(i / cols) - 2) * 205 - 10, shapes: [{ at: 0, shape: n, fill: "#f4efe6" }] }));
const libLabels = SHAPE_NAMES.map((n, i) => ({ type: "text", text: n, fontSize: 18, color: "#8a8f98", x: ((i % cols) - (cols - 1) / 2) * cell, y: (Math.floor(i / cols) - 2) * 205 + 88 }));

const LOGO = "assets/brew-logo.svg";
const modes = ["draw", "build", "assemble", "morph-from", "mask", "cascade", "glitch", "liquid", "window", "split", "trace", "pop"] as const;
const modeScenes = modes.map((m) => ({
  id: m, duration: 3.0, background: CREAM,
  layers: [
    { type: "logo", src: LOGO, mode: m, height: 300, ...(m === "morph-from" ? { from: "bean" } : {}), ...(m === "window" ? { windowSrc: "assets/window.jpg" } : {}) },
    label(m),
  ],
}));

const seqs = [["circle", "star", "heart", "drop"], ["square", "hexagon", "shield", "house"], ["sun", "moon", "sparkle", "flame"],
  ["pin", "globe", "bubble", "cloud"], ["leaf", "bean", "cup", "coin"], ["lock", "bag", "card", "phone"],
  ["play", "arrow", "check", "plus"], ["eye", "music", "wave", "spiral"], ["ring", "pill", "triangle", "bolt"]];
const hues = ["#ff7a59", "#ffc145", "#5ad1a8", "#58a6ff", "#c58cff", "#ff6fa8", "#f6efe6", "#9be15d", "#ffd27a"];
const TOUR = seqs.map((sq, i) => ({ type: "morph", width: 250, height: 250, x: ((i % 3) - 1) * 420, y: (Math.floor(i / 3) - 1) * 320,
  shapes: sq.map((sh, j) => ({ at: 0.2 + j * 1.0, shape: sh, fill: hues[(i + j) % hues.length], morph: 0.6, twist: j === 2 ? 30 : 0 })) }));
const spec = {
  format: "16:9", fps: 30, title: "Logo + morph showcase",
  theme: { colors: { accent: "#e8743b", ink: INK } },
  scenes: [
    { id: "library", duration: 1.5, background: { type: "solid", color: "#14161b" }, layers: [...lib, ...libLabels] },
    { id: "library-detail", duration: 1.0, background: { type: "solid", color: "#14161b" }, layers:
      ["heart", "cloud", "moon", "flame", "cup", "bean", "leaf", "pin", "globe", "lock", "bubble", "star"].map((n, i) => ({
        type: "morph", width: 250, height: 250, x: ((i % 6) - 2.5) * 300, y: (Math.floor(i / 6) - 0.5) * 330, shapes: [{ at: 0, shape: n, fill: "#f4efe6" }] })) },
    { id: "chain", duration: 6.6, background: CREAM, layers: [
      { type: "morph", width: 560, height: 560, goo: 0.6, shapes: [
        { at: 0.9, shape: "circle", fill: "#e8743b", morph: 0.9 },
        { at: 1.9, shape: "bean", fill: INK, twist: 25 },
        { at: 3.0, shape: "cup", fill: INK },
        { at: 4.2, shape: "text:Brew", fill: INK, morph: 0.8 },
        { at: 5.4, shape: `svg:${LOGO}`, morph: 0.8 },
      ], draw: true },
      label("morph chain"),
    ] },
    { id: "tour", duration: 3.4, background: { type: "solid", color: "#14161b" }, layers: TOUR },
    ...modeScenes,
    { id: "raster", duration: 3.0, background: CREAM, layers: [
      { type: "logo", src: "assets/brew-logo.png", mode: "mask", height: 150, y: -280 },
      { type: "logo", src: "assets/brew-logo.png", mode: "glitch", height: 150, y: -80 },
      { type: "logo", src: "assets/brew-logo.png", mode: "pop", height: 150, y: 120 },
      { type: "logo", src: "assets/brew-logo.png", mode: "draw", height: 110, y: 300 },
    ] },
    { id: "parts", duration: 3.0, background: { type: "solid", color: "#1b120d" }, layers: [
      { type: "logo", src: LOGO, mode: "build", parts: "icon", height: 280, x: -330, color: "#f6efe6" },
      { type: "logo", src: LOGO, mode: "cascade", parts: "wordmark", height: 160, x: 260, color: "#f2b25c" },
    ] },
    { id: "orbit", duration: 3.0, background: { type: "solid", color: "#101218" }, layers: [
      { type: "logo", src: "assets/orbit-logo.svg", mode: "draw", height: 240, x: -600, y: -230 },
      { type: "logo", src: "assets/orbit-logo.svg", mode: "morph-from", from: "sun", height: 240, x: -200, y: -230 },
      { type: "logo", src: "assets/orbit-logo.svg", mode: "build", height: 240, x: 200, y: -230 },
      { type: "logo", src: "assets/orbit-logo.svg", mode: "trace", height: 240, x: 600, y: -230 },
      { type: "logo", src: "assets/orbit-logo.svg", mode: "assemble", height: 240, x: -600, y: 200 },
      { type: "logo", src: "assets/orbit-logo.svg", mode: "liquid", height: 240, x: -200, y: 200 },
      { type: "morph", width: 240, height: 240, x: 200, y: 200, shapes: [{ at: 0.3, shape: "heart", fill: "#ff5fa2" }, { at: 1.3, shape: "svg:assets/orbit-logo.svg", morph: 0.9 }] },
      { type: "morph", width: 240, height: 240, x: 600, y: 200, shapes: [{ at: 0.3, shape: "svg:assets/orbit-logo.svg#0" }, { at: 1.3, shape: "text:Orbit", fill: "#f6efe6", morph: 0.9 }] },
    ] },
    ...(["explode", "collapse", "draw-out", "fade"] as const).map((e) => ({ id: `exit-${e}`, duration: 2.2, background: CREAM, layers: [
      { type: "logo", src: LOGO, mode: "pop", height: 300, exitMode: e, revealDuration: 0.6 }, label(`exit ${e}`) ] })),
  ],
};
const res = await writeSpec("test-logo-morph", spec);
console.log(JSON.stringify(res).slice(0, 800));
const tl = computeTimeline(spec as any);
console.log(tl.scenes.map((s, i) => `${spec.scenes[i].id}@${s.start.toFixed(2)}`).join("  "));
