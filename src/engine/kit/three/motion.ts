/**
 * 3D motion presets + camera orbit — pure functions of layer time `t` (seconds). No clocks, no randomness.
 */
import { EASING, clamp01, ease } from "../../core/animate";
import type { EaseName } from "../../core/animate";

export const ANIMATIONS_3D = [
  "none", "turntable", "spin-in", "flip-in", "float", "assemble", "explode", "rise",
  // 3D kinetic type (per glyph / per part; see kinetic.ts)
  "rail", "extrude-grow", "cascade-flip", "stack-echo", "orbit-ring", "drop", "wave",
] as const;
export const KINETIC_3D = ["rail", "extrude-grow", "cascade-flip", "stack-echo", "orbit-ring", "drop", "wave"] as const;
export type Animation3D = (typeof ANIMATIONS_3D)[number];

const D2R = Math.PI / 180;

/** Damped spring that settles exactly at u = 1 (decay/osc tune the overshoot). */
export const spring = (u: number, decay = 5.5, osc = 1.1) => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 1 - Math.cos(2 * Math.PI * osc * u) * Math.exp(-decay * u) * (1 - u);
};
const smooth = (e0: number, e1: number, x: number) => {
  const k = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return k * k * (3 - 2 * k);
};
const expoOut = (u: number) => ease("expoOut", u);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const TAU = Math.PI * 2;

export type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number; /** extra per-axis scales (kinetic type) */ sy?: number; sz?: number };
export const IDLE: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 };

/** Seconds each entrance takes (exposed for docs / timing) */
export const ANIM_T = { "spin-in": 2.0, "flip-in": 1.4, assemble: 1.5, explode: 1.8, rise: 1.8 } as const;
/** object-level hold for kinetic type: the glyphs do the work, the word just breathes once they land */
const KINETIC_SETTLE: Record<string, number> = { rail: 2.7, "extrude-grow": 1.8, "cascade-flip": 1.8, "stack-echo": 1.6, "orbit-ring": 3.4, drop: 2.0, wave: 99 };

/** Gentle "alive" hold after an entrance settles: a few degrees of drift, never a frozen frame. */
export const holdDrift = (t: number, from: number): Pose => {
  const k = smooth(from, from + 1.2, t);
  const u = t - from;
  return { ...IDLE, ry: k * 3.2 * D2R * Math.sin((TAU * u) / 7), rx: k * 1.4 * D2R * Math.sin((TAU * u) / 9 + 1.3), y: k * 0.008 * Math.sin((TAU * u) / 5) };
};

/** Whole-object pose. `h` = model height (units). */
export const objectPose = (anim: Animation3D, t: number): Pose => {
  switch (anim) {
    case "turntable":
      return { ...IDLE, ry: (-32 + 30 * t) * D2R };
    case "spin-in": {
      const T = ANIM_T["spin-in"];
      const u = clamp01(t / T);
      // edge-on → front on a long expressive glide (the reflections sweep across the faces while it turns),
      // cresting ~4% past front and settling exactly on it
      const e = ease("carbonExpressive", u) + 0.045 * Math.sin(Math.PI * smooth(0.45, 1, u));
      const d = holdDrift(t, T);
      return { ...d, ry: (-90 * (1 - e)) * D2R + d.ry, s: lerp(0.86, 1, expoOut(u)), z: lerp(-0.35, 0, expoOut(u)) };
    }
    case "flip-in": {
      const T = ANIM_T["flip-in"];
      const u = clamp01(t / T);
      const e = spring(u, 5.0, 1.1);
      const d = holdDrift(t, T);
      return { ...d, rx: (-95 * (1 - e)) * D2R + d.rx, y: lerp(0.18, 0, expoOut(u)) + d.y, s: lerp(0.9, 1, expoOut(u)) };
    }
    case "float":
      return {
        ...IDLE,
        y: 0.035 * Math.sin((TAU * t) / 3.6),
        rx: 4 * D2R * Math.sin((TAU * t) / 4.3 + 1.1),
        ry: 9 * D2R * Math.sin((TAU * t) / 6.1),
        rz: 1.6 * D2R * Math.sin((TAU * t) / 5.2 + 0.4),
      };
    case "assemble": {
      const T = ANIM_T.assemble;
      const u = clamp01(t / (T + 0.4));
      const d = holdDrift(t, T + 0.4);
      return { ...d, ry: lerp(-24, 0, EASING.inOutQuint(u)) * D2R + d.ry };
    }
    case "explode": {
      const T = ANIM_T.explode;
      const u = clamp01((t - 0.5) / T);
      const e = EASING.inOutQuint(u);
      return { ...IDLE, ry: (lerp(0, -38, e) + 2 * Math.sin((TAU * t) / 8)) * D2R, rx: lerp(0, 10, e) * D2R };
    }
    case "rise": {
      const T = ANIM_T.rise;
      const u = clamp01(t / T);
      const e = expoOut(u);
      const d = holdDrift(t, T);
      return { ...d, y: lerp(-0.75, 0, e) + d.y, ry: lerp(28, 0, e) * D2R + d.ry, rx: lerp(-12, 0, e) * D2R };
    }
    default:
      if (anim in KINETIC_SETTLE) return holdDrift(t, KINETIC_SETTLE[anim]);
      return IDLE;
  }
};

/** Per-part offsets for assemble/explode (i = rank by x, n parts, part center cx/cy, model width w). */
export const partPose = (anim: Animation3D, t: number, i: number, n: number, cx: number, cy: number, w: number): Pose | null => {
  if (anim !== "assemble" && anim !== "explode") return null;
  const side = cx / Math.max(0.5, w / 2); // -1..1
  const alt = i % 2 === 0 ? 1 : -1;
  if (anim === "assemble") {
    const spread = n > 1 ? Math.min(0.55, 0.09 * (n - 1)) : 0;
    const delay = n > 1 ? spread * EASING.out(i / (n - 1)) : 0;
    const u = clamp01((t - delay) / 1.05);
    const e = spring(u, 5.5, 1.0);
    const p = expoOut(u);
    return {
      x: (1 - p) * (side * 0.9 + alt * 0.15),
      y: (1 - p) * (alt * 0.55) + Math.sin(Math.PI * p) * 0.18 * alt,
      z: (1 - e) * -3.2,
      rx: (1 - e) * alt * 70 * D2R,
      ry: (1 - e) * (side >= 0 ? 1 : -1) * 120 * D2R,
      rz: (1 - e) * alt * 25 * D2R,
      s: lerp(0.5, 1, p),
    };
  }
  // explode: exploded-view layering in depth + a little lateral spread, then a slow drift
  const u = clamp01((t - 0.5) / ANIM_T.explode);
  const e = EASING.inOutQuint(u);
  const k = n > 1 ? i / (n - 1) - 0.5 : 0;
  const drift = Math.max(0, t - 0.5 - ANIM_T.explode) * 0.025;
  return {
    x: e * side * 0.22 + drift * side,
    y: e * (cy * 0.25 + alt * 0.05),
    z: e * k * 1.1 + drift * k * 2,
    rx: e * alt * 8 * D2R,
    ry: e * k * 30 * D2R,
    rz: e * alt * 6 * D2R,
    s: 1,
  };
};

// ---------------------------------------------------------------------------------------------
// camera

export type OrbitKf = { t: number; yaw?: number; pitch?: number; distance?: number; ease?: EaseName };
export type Cam = { yaw: number; pitch: number; distance: number };

/** Default three-quarter product angle (degrees). */
export const DEFAULT_CAM: Cam = { yaw: -14, pitch: 7, distance: 1 };

const track = (kfs: OrbitKf[], prop: "yaw" | "pitch" | "distance", t: number, base: number) => {
  const ks = kfs.filter((k) => typeof k[prop] === "number").sort((a, b) => a.t - b.t);
  if (!ks.length) return base;
  if (t <= ks[0].t) return ks[0][prop] as number;
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i].t) {
      const a = ks[i - 1], b = ks[i];
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return lerp(a[prop] as number, b[prop] as number, ease(b.ease, u, "inOutQuint"));
    }
  }
  return ks[ks.length - 1][prop] as number;
};

export const cameraAt = (orbit: OrbitKf[] | undefined, anim: Animation3D, t: number): Cam => {
  const kfs = orbit ?? [];
  const c: Cam = {
    yaw: track(kfs, "yaw", t, DEFAULT_CAM.yaw),
    pitch: track(kfs, "pitch", t, DEFAULT_CAM.pitch),
    distance: track(kfs, "distance", t, DEFAULT_CAM.distance),
  };
  if (anim === "rise") {
    // camera starts low (looking up at the hero) and tilts to eye level as it lands
    const e = expoOut(clamp01(t / (ANIM_T.rise + 0.4)));
    c.pitch += lerp(-14, 0, e);
    c.distance *= lerp(1.12, 1, e);
  }
  if (anim === "spin-in") c.distance *= lerp(1.06, 1, expoOut(clamp01(t / 2.4)));
  if (anim === "explode") c.distance *= lerp(1, 1.18, EASING.inOutQuint(clamp01((t - 0.5) / ANIM_T.explode)));
  return c;
};
