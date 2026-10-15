// "Brew" — concept-driven 9:16 brand film. One coffee bean (the motif) survives every cut,
// becomes a cup, and finally becomes the logo. Exercises actors, morphs, expand transitions,
// physics, slot text and logo analysis.
import fs from "node:fs";
import path from "node:path";
import { addAsset, createProject, listProjects, projectDir, writeSpec } from "../src/core/projects";

const name = "Brew film";
const existing = (await listProjects()).find((p: any) => p.name === name);
const id = existing?.id ?? (await createProject({ name, format: "9:16" })).id;
if (!fs.existsSync(path.join(projectDir(id), "assets", "brew-logo.svg"))) {
  await addAsset(id, { path: path.resolve("projects/test-logo-morph/assets/brew-logo.svg") });
}

const CREAM = "#fff4e6", BROWN = "#2b1a12", ORANGE = "#e8743b", GREY = "#d8d4cf";

const beans = Array.from({ length: 9 }, (_, i) => {
  const cols = [-300, -150, 0, 150, 300];
  const x = cols[i % 5] + (i >= 5 ? 75 : 0) + ((i * 37) % 40) - 20;
  const y = i >= 5 ? 20 : 130;
  return {
    type: "morph", width: 130, height: 130, x, y: y - 40, rotate: ((i * 53) % 90) - 45,
    shapes: [{ at: 0, shape: "bean", fill: "#6b4a3a" }],
    start: 0.15 + i * 0.07, enter: { type: "drop-in-3d", duration: 0.5 }, inertia: true,
  };
});

const res = await writeSpec(id, {
  title: "Brew — wake up to great coffee",
  format: "9:16", fps: 30, style: "editorial", bpm: 120,
  theme: {
    fonts: { display: "Bricolage Grotesque", body: "Inter" },
    colors: { bg: GREY, fg: BROWN, muted: "#6d6862", accent: ORANGE, accent2: "#f2b25c", card: CREAM },
  },
  fx: { grain: 0.12, vignette: 0.3 },
  concept: {
    truth: "Brew helps busy people wake up with great coffee, feeling warm.",
    metaphor: "fusion — the coffee bean becomes the cup, the cup becomes the logo",
    motif: "one coffee bean (actor) that survives every cut",
    verb: "wake → a spark ignites warmth (grey → orange → brown)",
    hook: "a single bean drops into a grey frame + 'Mornings are hard.'",
    arc: ["hook: bean drops", "tension: bean lost in a grey pile", "transformation: bean ignites, becomes a cup, steam rises",
      "payoff: cup becomes the Brew logo", "lockup: logo + tagline + CTA"],
    colorScript: ["cool grey", "grey", "orange", "espresso brown"],
  },
  actors: [{
    id: "bean", from: "hook", until: "lockup",
    layer: {
      type: "morph", width: 620, height: 300, enter: { type: "drop-in-3d", duration: 0.7 }, inertia: true,
      shapes: [
        { at: 0, shape: "bean", fill: BROWN },
        { at: 4.9, shape: "cup", fill: CREAM, morph: 0.8, twist: 12, scale: 1.1 },
        { at: 7.7, shape: "svg:assets/brew-logo.svg", fill: CREAM, morph: 1.0, twist: -8 },
      ],
    },
    poses: [
      { scene: "hook", t: 0, x: 0, y: -260, scale: 1 },
      { scene: "hook", t: 1.9, x: 0, y: -260, scale: 1 },
      { scene: "pile", t: 0.5, x: 0, y: -560, scale: 0.55, ease: "expoOut" },
      { scene: "pile", t: 2.3, x: 0, y: -560, scale: 0.55 },
      { scene: "spark", t: 0.6, x: 0, y: -120, scale: 1.35, ease: "expoOut" },
      { scene: "spark", t: 2.9, x: 0, y: -120, scale: 1.35 },
      { scene: "lockup", t: 0.5, x: 0, y: -170, scale: 1, ease: "expoOut" },
    ],
  }],
  scenes: [
    {
      id: "hook", duration: 2.0,
      background: { type: "solid", color: GREY },
      camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 2, zoom: 1.05, ease: "inOut" }], punch: [0.55] },
      layers: [
        { type: "text", text: "Mornings\nare hard.", preset: "physics", fontSize: 190, weight: 800, color: "#3d3a37", y: 180, start: 0.35 },
      ],
    },
    {
      id: "pile", duration: 2.5, transition: { type: "match" },
      background: { type: "solid", color: GREY },
      camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 2.5, zoom: 1, ease: "inOut" }], shake: { amount: 4, start: 0.3, duration: 0.6 } },
      layers: [
        ...beans,
        { type: "text", text: "Same bitter\nroutine.", preset: "mask-up", fontSize: 120, weight: 700, color: "$muted", y: 330, start: 0.6 },
      ],
    },
    {
      id: "spark", duration: 3.0, transition: { type: "expand", from: "bean", color: ORANGE, duration: 0.6 },
      background: [{ type: "solid", color: ORANGE }, { type: "spotlight", base: "transparent", color: "#ffb37a", y: -200, size: 0.9 }],
      camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 3, zoom: 1.06, ease: "inOut" }] },
      layers: [
        { type: "path", d: "M 500 1000 C 300 820 700 640 500 460 S 320 140 500 0", width: 120, height: 300, x: -100, y: -470,
          color: CREAM, strokeWidth: 14, drawStart: 1.0, drawDuration: 1.3, trail: 0.55, ease: "inOut",
          repeat: { count: 3, delay: 0.18, x: 60, opacity: 0.85 } },
        { type: "text", text: "Coffee that\nshows up fresh.", preset: "slot", swap: { words: ["fresh.", "on time.", "every week."], every: 0.7 },
          fontSize: 104, weight: 800, color: CREAM, y: 300, start: 0.5 },
        { type: "particles", preset: "dust", colors: [CREAM], count: 40 },
      ],
    },
    {
      id: "lockup", duration: 4.5, transition: { type: "expand", from: "bean", color: BROWN, duration: 0.6 },
      background: [{ type: "solid", color: BROWN }, { type: "spotlight", base: "transparent", color: "#4a2e20", y: -170, size: 1 }],
      camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 4.5, zoom: 1, ease: "outQuint" }] },
      layers: [
        { type: "text", text: "Fresh beans. Every Monday.", preset: "blur-rise", fontSize: 54, weight: 500, font: "$body", color: "#e9d8c4", y: 110, start: 1.9 },
        { type: "card", variant: "button", title: "Start your first bag →", accent: ORANGE, color: CREAM, fontSize: 54, y: 290, start: 2.3,
          press: 3.4, enter: { type: "grow", duration: 0.5 }, inertia: true },
        { type: "particles", preset: "embers", count: 24, colors: [ORANGE, "#f2b25c"], start: 1.6 },
      ],
    },
  ],
});
console.log(id, JSON.stringify(res, null, 1));
