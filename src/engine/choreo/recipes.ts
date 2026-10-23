/** Original shot recipes built from Motion Studio primitives. Each returns editable Scene Spec, not opaque code. */
import { SceneSchema, type Layer, type Scene, type Gesture } from "../spec/schema";
import { gestureTiming } from "../core/choreography";

export const MOTION_RECIPES = [
  { id: "magnetic-deck", title: "Magnetic deck", use: "Product cards converge into a single hero", energy: 0.65, cost: "2D" },
  { id: "orbit-hero", title: "Orbit hero", use: "An image or product card arcs into a perspective landing", energy: 0.55, cost: "2.5D" },
  { id: "type-impact", title: "Type impact", use: "Oversized type compresses on contact and releases", energy: 0.9, cost: "2D" },
  { id: "vortex-tunnel", title: "Vortex tunnel", use: "Concentric outline geometry contracts around a typographic hero", energy: 0.85, cost: "2D" },
  { id: "hinge-editorial", title: "Hinge editorial", use: "Folded panels open into clean editorial typography", energy: 0.5, cost: "2.5D" },
  { id: "ribbon-flight", title: "Ribbon flight", use: "An object follows a curved path with delayed echoes", energy: 0.7, cost: "2D" },
  { id: "particle-forge", title: "Particle forge", use: "Seeded 3D particles form extruded type or an SVG logo", energy: 1, cost: "WebGL" },
  { id: "chrome-echo", title: "Chrome echo", use: "Extruded type with depth echoes, a camera orbit and controlled bloom", energy: 0.8, cost: "WebGL" },
] as const;
export type MotionRecipeId = typeof MOTION_RECIPES[number]["id"];
export type RecipeOptions = {
  recipe: MotionRecipeId; id?: string; text?: string; subtitle?: string; src?: string;
  width?: number; height?: number; duration?: number; accent?: string; background?: string; foreground?: string;
};

export const buildMotionScene = (o: RecipeOptions): Scene => {
  const w = o.width ?? 1920, h = o.height ?? 1080, duration = o.duration ?? 3.6;
  if (!Number.isFinite(duration) || duration < 2.4 || duration > 20) throw new Error("Motion recipe duration must be 2.4–20 seconds (includes a reading hold).");
  if (![w, h].every((v) => Number.isFinite(v) && v >= 240 && v <= 7680)) throw new Error("Recipe dimensions must be 240–7680 px.");
  const k = Math.min(w / 1920, h / 1080), accent = o.accent ?? "$accent", bg = o.background ?? "$bg", fg = o.foreground ?? "$fg";
  const text = (o.text ?? "MAKE WAVES").slice(0, 80);
  const d = Math.min(1.65, duration - 1), inset = Math.min(w, h) * 0.07;
  const gesture = (preset: Gesture["preset"], delay = 0): Gesture => ({ preset, duration: d, delay, distance: w * 0.48 });
  const title = (extra: Record<string, unknown> = {}): Layer => ({
    type: "text", id: "hero-type", text, preset: "none", fontSize: Math.min(210 * k, w * 0.17), weight: 900,
    color: fg, maxWidth: w - inset * 2, letterSpacing: -0.055, lineHeight: 0.94, ...extra,
  } as Layer);
  const caption: Layer = {
    type: "text", id: "caption", text: o.subtitle ?? "MOTION / SOUND / ONE CLOCK", preset: "mask-up", by: "line",
    fontSize: Math.max(14, 23 * k), weight: 500, letterSpacing: 0.16, color: fg,
    y: h * 0.34, start: Math.min(1.7, duration - 0.9), unitDuration: 0.4, sound: false,
    maxWidth: w * 0.85,
  };
  const layers: Layer[] = [];
  switch (o.recipe) {
    case "magnetic-deck": {
      const cw = Math.min(w * 0.64, 1050 * k), ch = Math.min(h * 0.5, 510 * k);
      for (let i = 2; i >= 0; i--) {
        const g = gesture("magnetic", (2 - i) * 0.1);
        layers.push({ type: "group", id: `deck-${i}`, width: cw, height: ch, x: i * 28 * k, y: i * -24 * k,
          rotate: -i * 5, gesture: g, shadow: "premium", accents: i === 0 ? [{ at: "contact", role: "impact", material: "paper", importance: "structural" }] : [],
          layers: [
            { type: "shape", shape: "rect", width: cw, height: ch, radius: 30 * k, color: i ? (i === 1 ? accent : fg) : fg, sound: false },
            ...(i === 0 ? [o.src ? { type: "media", src: o.src, width: cw, height: ch, fit: "cover", radius: 30 * k, sound: false } as Layer : title({ color: bg, fontSize: 116 * k, maxWidth: cw * 0.85, sound: false })] : []),
          ] });
      }
      break;
    }
    case "orbit-hero": {
      const cw = Math.min(w * 0.7, 1120 * k), ch = Math.min(h * 0.55, 600 * k);
      layers.push({ type: "group", id: "orbit-subject", width: cw, height: ch, gesture: gesture("orbit-land"), shadow: "premium",
        accents: [{ at: "rush", role: "move", material: "air" }, { at: "contact", role: "click", material: "metal-thin", importance: "structural" }],
        layers: [
          { type: "shape", shape: "rect", width: cw, height: ch, radius: 26 * k, color: accent, sound: false },
          o.src ? { type: "media", src: o.src, width: cw, height: ch, fit: "cover", radius: 26 * k, sound: false } : title({ color: bg, fontSize: 130 * k, maxWidth: cw * 0.85, sound: false }),
        ] });
      break;
    }
    case "type-impact": {
      layers.push(title({ color: accent, gesture: { ...gesture("elastic-slam"), distance: h * 0.35 },
        accents: [{ at: "contact", role: "slam", importance: "hero", material: "metal" }] }));
      const at = gestureTiming(gesture("elastic-slam")).contact;
      layers.push({ type: "shape", id: "impact-rule", shape: "line", color: accent, width: w * 0.78, height: 3 * k,
        y: h * 0.19, start: at, enter: { type: "unfold-x", duration: 0.35 }, sound: false });
      break;
    }
    case "vortex-tunnel": {
      const g = gesture("vortex");
      layers.push({ type: "shape", id: "tunnel", shape: "rect", radius: 40 * k, color: "transparent", stroke: accent,
        strokeWidth: 2 * k, width: w * 0.55, height: h * 0.48, gesture: g,
        repeat: { count: 9, delay: 0.035, scale: 1.22, rotate: 4, opacity: 0.76 },
        accents: [{ at: "contact", role: "morph", importance: "structural", material: "air" }] });
      layers.push(title({ fontSize: 134 * k, gesture: gesture("vortex", 0.12), accents: [] }));
      break;
    }
    case "hinge-editorial": {
      for (let i = 0; i < 3; i++) layers.push({ type: "shape", id: `panel-${i}`, shape: "rect", color: i === 1 ? accent : fg,
        width: w * 0.25, height: h * 0.48, x: (i - 1) * w * 0.265, gesture: gesture("hinge", i * 0.09),
        accents: i === 0 ? [{ at: "rush", role: "move", material: "paper" }] : [] });
      layers.push(title({ color: bg, fontSize: 140 * k, start: 0.7, preset: "mask-up", by: "line", unitDuration: 0.5, sound: false }));
      break;
    }
    case "ribbon-flight": {
      const travel = d * 0.85;
      layers.push({ type: "shape", id: "flight", shape: "circle", color: accent, width: 100 * k, height: 100 * k,
        path: { points: [[-w * 0.65, h * 0.15], [-w * 0.25, -h * 0.3], [w * 0.2, -h * 0.12], [0, 0]], duration: travel, ease: "inOutQuint", orient: true },
        repeat: { count: 12, delay: 0.025, scale: 0.94, opacity: 0.8 },
        accents: [{ at: "rush", role: "move", material: "air" }, { at: "contact", role: "pop", material: "liquid", importance: "structural" }],
        animate: [{ t: travel + 0.15, scale: 1 }, { t: travel + 0.5, scale: 0, ease: "inExpo" }],
      });
      layers.push(title({ start: travel + 0.1, color: fg, preset: "split-reveal", by: "line", unitDuration: 0.5, sound: false }));
      break;
    }
    case "particle-forge": {
      const formation = Math.min(1.35, duration - 1.1), spread = 0.18;
      layers.push({ type: "three", id: "forge", source: o.src ? `svg:${o.src}` : `text:${text}`, mode: "particles", width: w, height: h,
        weight: 800, background: bg, particles: { from: "vortex", count: 16000, duration: formation, spread, trail: 2, colors: [accent, fg], seed: 71 },
        post: { bloom: { strength: 0.45, threshold: 0.8 }, vignette: 0.25 },
        accents: [{ at: formation + spread, role: "impact", importance: "hero", material: "glass" }],
      });
      break;
    }
    case "chrome-echo": {
      layers.push({ type: "three", id: "chrome", source: o.src ? `svg:${o.src}` : `text:${text}`, width: w, height: h,
        weight: 900, material: "chrome", lighting: "studio", color: accent, animation: "stack-echo", background: bg,
        echo: { count: 6, gap: 0.12, color: bg },
        orbit: [{ t: 0, yaw: -34, pitch: 16, distance: 1.16 }, { t: d, yaw: -8, pitch: 4, distance: 1, ease: "outQuint" }],
        post: { bloom: 0.25, vignette: 0.2 },
        accents: [{ at: 0.55, role: "move", material: "metal-thin" }, { at: d, role: "impact", importance: "structural", material: "metal" }],
      });
      break;
    }
    default: throw new Error(`Unknown motion recipe: ${o.recipe}`);
  }
  layers.push(caption);
  return SceneSchema.parse({ id: o.id ?? o.recipe, duration, background: { type: "solid", color: bg }, layers,
    notes: `${MOTION_RECIPES.find((r) => r.id === o.recipe)!.title}: ${MOTION_RECIPES.find((r) => r.id === o.recipe)!.use}. Contact accents share the motion clock. Keep the final reading hold.` });
};
