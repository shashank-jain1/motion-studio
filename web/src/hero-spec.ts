/**
 * The product's own showreel, written in the Scene Spec and played live by the engine (no video file).
 * Leader countdown → kinetic "MOTION / studio" → library shapes morph into a play glyph → slate lockup.
 * Palette is the UI's: Ink / Bone / Tally. Two layouts: "16:9" (home hero) and "4:5" (auth screens).
 */
import type { SpecInput } from "../../src/engine/spec/schema";

const INK = "#0D0D0B";
const BONE = "#ECE8DF";
const TALLY = "#FF3D1F";
const LINE = "#2A2925";
const ASH = "#8E897D";
const SMOKE = "#56534B";
const MONO = "Geist Mono";

export type HeroFormat = "16:9" | "4:5";

export const makeHeroSpec = (format: HeroFormat = "16:9"): SpecInput => {
  const wide = format === "16:9";
  const W = wide ? 1920 : 1080;
  const H = wide ? 1080 : 1350;
  const edgeX = W / 2 - (wide ? 96 : 72);
  const edgeY = H / 2 - (wide ? 80 : 72);
  const label = (text: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    type: "text" as const, text, font: MONO, fontSize: wide ? 22 : 24, weight: 500, letterSpacing: 0.14, color: ASH,
    x, y, align: "left" as const, preset: "none" as const, fit: false, ...extra,
  });
  // corner registration marks (L shapes) built from hairline rects
  const crop = (sx: 1 | -1, sy: 1 | -1) => [
    { type: "shape" as const, shape: "rect" as const, width: 44, height: 2, color: SMOKE, x: sx * (edgeX + 40 - 22), y: sy * (edgeY + 40), depth: 0 },
    { type: "shape" as const, shape: "rect" as const, width: 2, height: 44, color: SMOKE, x: sx * (edgeX + 40), y: sy * (edgeY + 40 - 22), depth: 0 },
  ];
  const chrome = [...crop(-1, -1), ...crop(1, -1), ...crop(-1, 1), ...crop(1, 1)];

  return {
    title: "Motion Studio — showreel",
    format,
    fps: 30,
    theme: {
      fonts: { display: "Geist", body: "Geist", mono: MONO },
      colors: { bg: INK, fg: BONE, accent: TALLY, muted: ASH, card: "#151512" },
    },
    fx: { grain: 0.08, vignette: 0.25 },
    scenes: [
      // 1 — film leader: hairline crosshair, a ring that sweeps on, 3·2·1 on hard cuts
      {
        id: "leader",
        duration: 1.9,
        background: { type: "solid", color: INK },
        layers: [
          { type: "shape", shape: "rect", width: W, height: 2, color: LINE },
          { type: "shape", shape: "rect", width: 2, height: H, color: LINE },
          { type: "shape", shape: "ring", width: wide ? 560 : 620, height: wide ? 560 : 620, stroke: BONE, strokeWidth: 3, draw: true, drawDuration: 1.8, color: BONE },
          { type: "shape", shape: "ring", width: wide ? 700 : 780, height: wide ? 700 : 780, stroke: LINE, strokeWidth: 2, color: LINE },
          { type: "text", text: "3", font: "Geist", weight: 600, fontSize: wide ? 360 : 400, color: BONE, start: 0, duration: 0.6, preset: "none" },
          { type: "text", text: "2", font: "Geist", weight: 600, fontSize: wide ? 360 : 400, color: BONE, start: 0.6, duration: 0.6, preset: "none" },
          { type: "text", text: "1", font: "Geist", weight: 600, fontSize: wide ? 360 : 400, color: TALLY, start: 1.2, duration: 0.7, preset: "none" },
          label("SC 01 / TK 01", -edgeX + 140, -edgeY),
          label("30 FPS", edgeX - 70, -edgeY),
          label(wide ? "MOTION STUDIO — REEL 00" : "REEL 00", -edgeX + (wide ? 210 : 70), edgeY),
          { type: "shape", shape: "circle", width: 18, height: 18, color: TALLY, x: edgeX - 160, y: -edgeY, loop: { type: "pulse", amplitude: 0.25, speed: 2 } },
          ...chrome,
        ],
      },
      // 2 — kinetic type: MOTION slices together, "studio" rises in Instrument Serif, Tally
      {
        id: "type",
        duration: 2.7,
        transition: { type: "match" },
        background: { type: "solid", color: INK },
        camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 2.7, zoom: 1, ease: "expoOut" }] },
        layers: [
          { type: "shape", shape: "rect", width: wide ? 1500 : 900, height: 2, color: LINE, y: wide ? 40 : 10, enter: { type: "unfold-x", duration: 0.7, ease: "expoOut", delay: 0.1 } },
          { type: "text", text: "MOTION", preset: "slice", font: "Geist", weight: 700, fontSize: wide ? 330 : 250, letterSpacing: -0.05, color: BONE, y: wide ? -110 : -150 },
          { type: "text", text: "studio", preset: "mask-up", font: "Instrument Serif", italic: true, fontSize: wide ? 250 : 230, color: TALLY, start: 0.45, y: wide ? 170 : 150, by: "char", stagger: 0.04 },
          label("EASE  expoOut  0.19 1 0.22 1", wide ? -edgeX + 250 : -edgeX + 250, edgeY, { preset: "typewriter", start: 0.6, color: SMOKE }),
          ...chrome,
        ],
      },
      // 3 — the paper test card: shapes become other shapes (the product's whole idea)
      {
        id: "become",
        duration: 3.3,
        transition: { type: "slice", slices: 6, direction: "up", duration: 0.55, ease: "inOutQuint" },
        background: { type: "solid", color: BONE },
        layers: [
          { type: "shape", shape: "rect", width: W, height: 2, color: "#D6D1C6", y: wide ? 0 : 230 },
          {
            type: "morph", id: "glyph", width: wide ? 420 : 400, height: wide ? 420 : 400, x: wide ? 430 : 0, y: wide ? 0 : -170,
            fill: INK,
            shapes: [
              { at: 0, shape: "circle" },
              { at: 0.75, shape: "square", twist: 20 },
              { at: 1.45, shape: "triangle", twist: -16 },
              { at: 2.15, shape: "star", twist: 24 },
              { at: 2.9, shape: "play", fill: TALLY, twist: -12 },
            ],
            enter: { type: "grow", duration: 0.5, ease: "expoOut" }, inertia: true,
          },
          {
            type: "text", text: "Brief it.\nWatch it become.", preset: "mask-up", by: "line", font: "Geist", weight: 600,
            fontSize: wide ? 104 : 92, letterSpacing: -0.035, lineHeight: 1.02, color: INK, align: "left",
            x: wide ? -360 : 0, y: wide ? -10 : 330, start: 0.2, highlight: { words: ["become."], color: TALLY, style: "color", at: 2.3 }, fit: false,
          },
          label("CIRCLE  SQUARE  TRIANGLE  STAR  PLAY", wide ? -edgeX + 330 : -edgeX + 330, edgeY, { color: "#8E897D", preset: "typewriter", start: 0.3 }),
        ],
      },
      // 4 — slate lockup: clapper stripes close on the beat, the take is marked
      {
        id: "slate",
        duration: 3.1,
        transition: { type: "expand", from: "glyph", shape: "circle", color: TALLY, duration: 0.6, ease: "inOutQuint" },
        background: { type: "solid", color: INK },
        layers: [
          {
            type: "group", id: "clapper", y: wide ? -170 : -260,
            layers: [
              { type: "shape", shape: "rect", width: wide ? 1100 : 860, height: 86, color: "transparent", css: { background: `repeating-linear-gradient(120deg, ${BONE} 0 56px, ${INK} 56px 112px)`, outline: `2px solid ${BONE}` },
                animate: [{ t: 0, rotate: -9, y: -30 }, { t: 0.55, rotate: 0, y: 0, ease: "snap" }], origin: "0% 100%" },
            ],
          },
          { type: "shape", shape: "rect", width: wide ? 1100 : 860, height: 2, color: BONE, y: wide ? -125 : -215, enter: { type: "unfold-x", duration: 0.4, ease: "expoOut" } },
          { type: "text", text: "MOTION STUDIO", preset: "tracking", font: "Geist", weight: 700, fontSize: wide ? 120 : 96, letterSpacing: -0.02, color: BONE, y: wide ? 0 : -90, start: 0.5 },
          { type: "text", text: "directed by you. cut by the engine.", preset: "blur-rise", font: "Instrument Serif", italic: true, fontSize: wide ? 64 : 60, color: ASH, y: wide ? 110 : 20, start: 0.9 },
          label("SCENE", wide ? -470 : -360, wide ? 230 : 170, { start: 1.1, preset: "typewriter" }),
          label("TAKE", wide ? -110 : -40, wide ? 230 : 170, { start: 1.2, preset: "typewriter" }),
          label("ROLL", wide ? 250 : 260, wide ? 230 : 170, { start: 1.3, preset: "typewriter" }),
          { type: "text", text: "04", font: MONO, weight: 500, fontSize: 64, color: BONE, x: wide ? -510 : -385, y: wide ? 290 : 235, start: 1.15, preset: "scramble", fit: false },
          { type: "text", text: "01", font: MONO, weight: 500, fontSize: 64, color: BONE, x: wide ? -158 : -75, y: wide ? 290 : 235, start: 1.25, preset: "scramble", fit: false },
          { type: "text", text: "A", font: MONO, weight: 500, fontSize: 64, color: TALLY, x: wide ? 230 : 240, y: wide ? 290 : 235, start: 1.35, preset: "scramble", fit: false },
          ...chrome,
        ],
      },
    ],
  };
};
