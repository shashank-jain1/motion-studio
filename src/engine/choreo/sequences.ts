/** A film built around one evolving object and motion language, rather than a montage of unrelated shot presets. */
import { FORMATS, SpecSchema, type Layer, type Spec } from "../spec/schema";

export type SequenceOptions = {
  treatment?: "sculpture-flow" | "metamorphosis"; title?: string; seconds?: number; format?: keyof typeof FORMATS;
  accent?: string; background?: string; foreground?: string; headlines?: string[]; source?: string;
};
export const buildMotionSequence = (o: SequenceOptions = {}): Spec => {
  const seconds = o.seconds ?? 14, format = o.format ?? "16:9";
  if (!Number.isFinite(seconds) || seconds < 10 || seconds > 30) throw new Error("Continuous sequences need 10–30 seconds for their transformation and reading holds.");
  const [w, h] = FORMATS[format], vertical = w < h, k = Math.min(w / 1920, h / 1080);
  const fps = 30, frames = Math.round(seconds * fps / 4), d = frames / fps, total = d * 4;
  const accent = o.accent ?? "#c6e8d5", bg = o.background ?? "#101613", fg = o.foreground ?? "#f0f5ed";
  const headlines = o.headlines ?? ["A single\nimpulse.", "Becomes\na rhythm.", "Finds\nits form.", "Everything\nconnects."];
  const ids = ["impulse", "rhythm", "form", "resolve"];
  const cueTimes = [0.85, d + 0.75, d * 2 + 0.8, d * 3 + 0.85];
  const accents = cueTimes.map((at, i) => ({ at, role: i === 3 ? "logoHit" as const : i === 1 && o.treatment === "metamorphosis" ? "morph" as const : "move" as const,
    importance: i === 3 ? "hero" as const : "structural" as const, material: "glass" }));
  const size = Math.min(w * 0.68, h * 0.86);
  const hero: Layer = o.treatment === "metamorphosis" ? {
    type: "morph", id: "living-form", width: size, height: size, fill: accent, goo: 0.3,
    shapes: [{ at: 0, shape: "circle" }, { at: d + 0.75, shape: "rounded-square", morph: d * 0.6, twist: 45 },
      { at: d * 2 + 0.8, shape: "ring", morph: d * 0.6, twist: -45 }, { at: d * 3 + 0.85, shape: "star", morph: d * 0.6, twist: 72 }], accents,
  } : {
    type: "three", id: "living-sculpture", source: o.source ?? "primitive:knot", width: size * 1.3, height: size * 1.3,
    material: "pearl", lighting: "studio", color: accent, animation: "turntable", shadow3d: true, exposure: 0.55,
    orbit: [{ t: 0, yaw: -35, pitch: 18, distance: 1.15 }, { t: total, yaw: 18, pitch: -8, distance: 0.94, ease: "linear" }],
    post: { bloom: { strength: 0.08, threshold: 1.1 } },
    deform: [{ type: "twist", keys: [{ t: 0, amount: 0 }, { t: d + 0.75, amount: 0.18 }, { t: d * 2 + 0.8, amount: -0.08 }, { t: d * 3 + 0.85, amount: 0.06 }] }], accents,
  };
  const x = vertical ? 0 : w * 0.24, y = vertical ? h * 0.05 : -h * 0.02;
  return SpecSchema.parse({ title: o.title ?? "One continuous idea", format, fps, style: "minimal-dark",
    theme: { fonts: { display: "Inter", body: "Inter" }, colors: { bg, fg, accent, accent2: accent, muted: "#93a69b" } },
    sound: { volume: 0.78, brief: { voice: "luxury", realism: "mixed", materials: ["glass", "air"], space: "plate", key: "D minor" },
      restraint: 0.55, variation: 0.3, continuity: { cohesion: 0.9, bridgeVolume: 0.3, maxGap: 6 } },
    concept: { truth: "A system feels coherent when each action grows from the previous one.", metaphor: "One impulse takes form.", verb: "connect", motif: "One evolving sculpture", arc: ["hook", "build", "transform", "resolve"] },
    scenes: ids.map((id, i) => ({ id, duration: d, background: { type: "solid", color: bg },
      transition: i ? { type: "cut", sound: false } : undefined,
      layers: [
        { type: "text", id: "chapter", text: `0${i + 1} / CONTINUOUS BY DESIGN`, preset: "mask-up", by: "line", start: 0.1,
          fontSize: 20 * k, weight: 500, letterSpacing: 0.13, x: vertical ? 0 : -w * 0.235, y: vertical ? -h * 0.33 : -h * 0.3, color: accent, sound: false },
        { type: "text", id: "headline", text: headlines[i] ?? headlines[headlines.length - 1] ?? "Connect.", preset: "mask-up", by: "line", stagger: 0.12,
          unitDuration: 0.75, fontSize: (vertical ? 125 : 154) * k, weight: 750, letterSpacing: -0.045, lineHeight: 1.03,
          maxWidth: vertical ? w * 0.82 : w * 0.43, x: vertical ? 0 : -w * 0.24, y: vertical ? -h * 0.21 : 0, align: vertical ? "center" : "left", color: fg, sound: false },
        { type: "shape", shape: "line", width: w * 0.8, height: 1, y: h * 0.36, color: accent, opacity: 0.2, sound: false },
        { type: "text", text: "ONE FORM / ONE MOTION LANGUAGE / ONE SONIC THREAD", preset: "none", fontSize: 17 * k, weight: 500,
          letterSpacing: 0.09, y: h * 0.4, color: accent, maxWidth: w * 0.88, sound: false },
      ], notes: "Preserve the hero's global clock and velocity. These are chapters of one object, not four separate reveals." })),
    actors: [{ id: "continuous-hero", motion: "flow", layer: hero,
      poses: [
        { scene: 0, t: 0, x: x + w * 0.18, y: y + h * 0.12, scale: 0.55, rotate: -25 },
        { scene: 0, t: 0.85, x, y, scale: 0.86, rotate: -10 },
        { scene: 1, t: 0.75, x: x + w * 0.025, y: y - h * 0.08, scale: 1.05, rotate: 12 },
        { scene: 2, t: 0.8, x: x - w * 0.035, y: y + h * 0.045, scale: 0.78, rotate: -8 },
        { scene: 3, t: 0.85, x, y, scale: 0.92, rotate: 0 },
        { scene: 3, t: d - 0.3, x, y, scale: 0.92, rotate: 0 },
      ] }],
  });
};
