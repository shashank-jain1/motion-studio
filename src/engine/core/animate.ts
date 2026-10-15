/** Frame-deterministic animation math: easing, keyframes, enter/exit presets, loops. */
import { Easing, interpolate } from "remotion";
import type { Keyframe } from "../spec/schema";

export type EaseName = NonNullable<Keyframe["ease"]>;

const springLike = (decay: number, oscillations: number) => (t: number) => {
  // Analytic damped spring, forced to settle exactly at t=1 (no frame-rate dependence).
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.cos(2 * Math.PI * oscillations * t) * Math.exp(-decay * t) * (1 - t);
};

export const EASING: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  in: Easing.in(Easing.cubic),
  out: Easing.out(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  outBack: Easing.out(Easing.back(1.7)),
  inBack: Easing.in(Easing.back(1.7)),
  inOutBack: Easing.inOut(Easing.back(1.4)),
  outExpo: Easing.out(Easing.exp),
  inExpo: Easing.in(Easing.exp),
  inOutExpo: Easing.inOut(Easing.exp),
  outQuint: Easing.out(Easing.poly(5)),
  inOutQuint: Easing.inOut(Easing.poly(5)),
  outCirc: Easing.out(Easing.circle),
  outElastic: Easing.elastic(1.1),
  outBounce: Easing.bounce,
  spring: springLike(5, 1.25),
  snappy: Easing.bezier(0.2, 0.9, 0.1, 1),
  bouncy: springLike(3, 2),
  smooth: Easing.bezier(0.45, 0, 0.15, 1),
  // --- pro curves (research §3.2): asymmetric, long settles ---
  /** Penner expo-out as a bezier: very fast departure, long glide */
  expoOut: Easing.bezier(0.19, 1, 0.22, 1),
  quintOut: Easing.bezier(0.23, 1, 0.32, 1),
  /** AE "short out-influence, long in-influence": leaves fast, settles long */
  snap: Easing.bezier(0.15, 0, 0.1, 1),
  /** Material 3 emphasized decelerate (entrances) */
  m3Enter: Easing.bezier(0.05, 0.7, 0.1, 1),
  /** Material 3 emphasized accelerate (exits) */
  m3Exit: Easing.bezier(0.3, 0, 0.8, 0.15),
  /** IBM Carbon expressive standard (hero moments) */
  carbonExpressive: Easing.bezier(0.4, 0.14, 0.3, 1),
};

export const ease = (name: EaseName | undefined, t: number, fallback: EaseName = "outQuint") => {
  // Pin the endpoints: some curves (exp) only approach 0/1 asymptotically.
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return (EASING[name ?? fallback] ?? EASING[fallback])(t);
};

/** Progress 0..1 between two times (seconds), eased. */
export const progress = (time: number, start: number, duration: number, e?: EaseName, fallback: EaseName = "outQuint") =>
  duration <= 0 ? (time >= start ? 1 : 0) : ease(e, (time - start) / duration, fallback);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Transform = {
  x: number; y: number; z: number;
  scale: number; scaleX: number; scaleY: number;
  rotate: number; rotateX: number; rotateY: number; skewX: number;
  opacity: number; blur: number;
  /** directional (motion) blur in px, element-local axes (whip presets) */
  dirBlurX: number; dirBlurY: number;
  /** translate in % of the element's own box, applied in local space before scale (edge-pinned unfolds) */
  pctX?: number; pctY?: number;
  clip?: string;
};

export const identity = (): Transform => ({
  x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0,
  opacity: 1, blur: 0, dirBlurX: 0, dirBlurY: 0, pctX: 0, pctY: 0,
});

export const KF_PROPS = ["x", "y", "z", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "skewX", "opacity", "blur"] as const;
export type KfProp = (typeof KF_PROPS)[number];

/** One property's keyframes, pre-sorted: times, values, arrival eases. */
export type KfTrack = { prop: KfProp; t: number[]; v: number[]; e: (EaseName | undefined)[] };

const trackCache = new WeakMap<Keyframe[], KfTrack[]>();

/** Sorted per-property tracks for a keyframe array (cached by array identity; pure). */
export const keyframeTracks = (kfs: Keyframe[]): KfTrack[] => {
  let tracks = trackCache.get(kfs);
  if (tracks) return tracks;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  tracks = [];
  for (const prop of KF_PROPS) {
    const pts = sorted.filter((k) => k[prop] !== undefined);
    if (pts.length === 0) continue;
    tracks.push({ prop, t: pts.map((k) => k.t), v: pts.map((k) => k[prop]!), e: pts.map((k) => k.ease) });
  }
  trackCache.set(kfs, tracks);
  return tracks;
};

/** Evaluate keyframes at time t (seconds). Each property interpolates only between keyframes that define it. */
export const evalKeyframes = (kfs: Keyframe[] | undefined, t: number): Partial<Transform> => {
  if (!kfs || kfs.length === 0) return {};
  const out: Partial<Transform> = {};
  for (const tr of keyframeTracks(kfs)) {
    const n = tr.t.length;
    if (t <= tr.t[0]) { out[tr.prop] = tr.v[0]; continue; }
    if (t >= tr.t[n - 1]) { out[tr.prop] = tr.v[n - 1]; continue; }
    let i = 0;
    while (i < n - 2 && t > tr.t[i + 1]) i++;
    const p = ease(tr.e[i + 1], (t - tr.t[i]) / Math.max(1e-6, tr.t[i + 1] - tr.t[i]), "inOutQuint");
    out[tr.prop] = lerp(tr.v[i], tr.v[i + 1], p);
  }
  return out;
};

const pct = (v: number) => `${(100 * v).toFixed(3)}%`;

/**
 * Enter/exit preset as a function of "hidden-ness" h: 1 = fully hidden, 0 = at rest.
 * `dir` = +1 for enter (comes from), -1 for exit (goes to) so whips continue in the same direction.
 * `hVis` (optional) drives visibility (opacity / clip / blur) separately from the spatial part, so physics can
 * push the spatial h outside 0..1 (anticipation > 1, inertia overshoot < 0) while visibility stays clamped.
 */
export const presetTransform = (type: string, h: number, distance: number | undefined, dir: 1 | -1, hVis?: number): Partial<Transform> => {
  const v = Math.min(1, Math.max(0, hVis ?? h));
  if (Math.abs(h) <= 0.0001 && v <= 0.0001) return {};
  const d = distance;
  const pos = (n: number) => Math.max(0, n);
  switch (type) {
    case "none": return {};
    case "fade": return { opacity: 1 - v };
    case "rise": return { y: (d ?? 80) * h, opacity: 1 - v, blur: 8 * v };
    case "drop": return { y: -(d ?? 80) * h, opacity: 1 - v, blur: 8 * v };
    case "slide-left": return { x: (d ?? 300) * h * dir, opacity: 1 - v };
    case "slide-right": return { x: -(d ?? 300) * h * dir, opacity: 1 - v };
    case "slide-up": return { y: (d ?? 300) * h * dir, opacity: 1 - v };
    case "slide-down": return { y: -(d ?? 300) * h * dir, opacity: 1 - v };
    case "zoom-in": return { scale: pos(1 - 0.6 * h), opacity: 1 - v, blur: 10 * v };
    case "zoom-out": return { scale: pos(1 + 1.5 * h), opacity: 1 - v, blur: 16 * v };
    case "blur-in": return { opacity: 1 - v, blur: 30 * v, scale: 1 + 0.08 * h };
    case "pop": return { scale: pos(1 - h), opacity: Math.min(1, (1 - v) * 3) };
    case "flip-up": return { rotateX: 90 * h, opacity: 1 - v, y: 30 * h };
    case "flip-side": return { rotateY: -90 * h * dir, opacity: 1 - v };
    case "swing": return { rotate: -18 * h * dir, y: 60 * h, opacity: 1 - v };
    case "spin-in": return { rotate: -180 * h * dir, scale: pos(1 - 0.8 * h), opacity: 1 - v };
    case "whip-left": return { x: (d ?? 1400) * h * dir, dirBlurX: 60 * v, opacity: 1 - v * 0.3 };
    case "whip-right": return { x: -(d ?? 1400) * h * dir, dirBlurX: 60 * v, opacity: 1 - v * 0.3 };
    case "whip-up": return { y: (d ?? 1000) * h * dir, dirBlurY: 60 * v, opacity: 1 - v * 0.3 };
    case "whip-down": return { y: -(d ?? 1000) * h * dir, dirBlurY: 60 * v, opacity: 1 - v * 0.3 };
    case "clip-up": return { clip: `inset(${pct(v)} 0 0 0)` };
    case "clip-down": return { clip: `inset(0 0 ${pct(v)} 0)` };
    case "clip-left": return { clip: `inset(0 0 0 ${pct(v)})` };
    case "clip-right": return { clip: `inset(0 ${pct(v)} 0 0)` };
    case "iris": return { clip: `circle(${75 * (1 - v)}% at 50% 50%)` };
    case "stretch": return { scaleY: pos(1 + 1.5 * h), scaleX: pos(1 - 0.5 * h), opacity: 1 - v, blur: 6 * v };
    case "fly-in-3d": return { z: -1200 * h, rotateX: 50 * h, rotateY: -25 * h * dir, opacity: 1 - v, y: 200 * h };
    case "drop-bounce": return { y: -(d ?? 700) * h, opacity: v > 0.98 ? 0 : 1 };
    // --- premium reveals: uncovered by a moving edge + small travel, never faded ---
    case "reveal-up": return { y: (d ?? 48) * h * dir, clip: dir > 0 ? `inset(${pct(v)} 0 0 0)` : `inset(0 0 ${pct(v)} 0)` };
    case "reveal-down": return { y: -(d ?? 48) * h * dir, clip: dir > 0 ? `inset(0 0 ${pct(v)} 0)` : `inset(${pct(v)} 0 0 0)` };
    case "reveal-left": return { x: (d ?? 48) * h * dir, clip: dir > 0 ? `inset(0 0 0 ${pct(v)})` : `inset(0 ${pct(v)} 0 0)` };
    case "reveal-right": return { x: -(d ?? 48) * h * dir, clip: dir > 0 ? `inset(0 ${pct(v)} 0 0)` : `inset(0 0 0 ${pct(v)})` };
    case "grow": return { scale: pos(1 - h) };
    case "unfold-x": { const s = pos(1 - h); return { scaleX: s, pctX: -50 * (1 - s) }; }
    case "unfold-y": { const s = pos(1 - h); return { scaleY: s, pctY: -50 * (1 - s) }; }
    case "drop-in-3d": return { rotateX: -70 * h, y: -(d ?? 160) * h, opacity: Math.min(1, (1 - v) * 2.5) };
    default: return { opacity: 1 - v };
  }
};

export const loopTransform = (loop: { type: string; amplitude?: number; speed?: number } | undefined, t: number): Partial<Transform> => {
  if (!loop) return {};
  const a = loop.amplitude;
  const w = 2 * Math.PI * (loop.speed ?? 0.5) * t;
  switch (loop.type) {
    case "float": return { y: Math.sin(w) * (a ?? 12), rotate: Math.sin(w * 0.7) * 1.2 };
    case "bob": return { y: Math.abs(Math.sin(w)) * -(a ?? 16) };
    case "pulse": return { scale: 1 + Math.sin(w) * (a ?? 0.04) };
    case "breathe": return { scale: 1 + (Math.sin(w) * 0.5 + 0.5) * (a ?? 0.06), opacity: 0.85 + 0.15 * Math.sin(w) };
    case "wiggle": return { rotate: Math.sin(w * 3) * (a ?? 4) };
    case "sway": return { rotate: Math.sin(w) * (a ?? 6), x: Math.sin(w) * 8 };
    case "spin": return { rotate: t * 360 * (loop.speed ?? 0.25) };
    case "shake": return { x: Math.sin(w * 7.3) * (a ?? 5), y: Math.cos(w * 9.1) * (a ?? 5) };
    case "orbit": return { x: Math.cos(w) * (a ?? 20), y: Math.sin(w) * (a ?? 20) };
    default: return {};
  }
};

/** Accumulate a partial transform into `t` in place: additive positions/rotations, multiplicative scale/opacity. */
export const addInto = (t: Transform, p: Partial<Transform>): Transform => {
  if (p.x !== undefined) t.x += p.x;
  if (p.y !== undefined) t.y += p.y;
  if (p.z !== undefined) t.z += p.z;
  if (p.rotate !== undefined) t.rotate += p.rotate;
  if (p.rotateX !== undefined) t.rotateX += p.rotateX;
  if (p.rotateY !== undefined) t.rotateY += p.rotateY;
  if (p.skewX !== undefined) t.skewX += p.skewX;
  if (p.scale !== undefined) t.scale *= p.scale;
  if (p.scaleX !== undefined) t.scaleX *= p.scaleX;
  if (p.scaleY !== undefined) t.scaleY *= p.scaleY;
  if (p.opacity !== undefined) t.opacity *= p.opacity;
  if (p.blur !== undefined) t.blur += p.blur;
  if (p.dirBlurX !== undefined) t.dirBlurX += p.dirBlurX;
  if (p.dirBlurY !== undefined) t.dirBlurY += p.dirBlurY;
  if (p.pctX !== undefined) t.pctX = (t.pctX ?? 0) + p.pctX;
  if (p.pctY !== undefined) t.pctY = (t.pctY ?? 0) + p.pctY;
  if (p.clip !== undefined) t.clip = p.clip;
  return t;
};

/** Combine transforms: additive positions/rotations, multiplicative scale/opacity, max blur. */
export const combine = (...parts: Partial<Transform>[]): Transform => {
  const t = identity();
  for (const p of parts) addInto(t, p);
  return t;
};

/** Volume-preserving squash/stretch along a screen-space direction (deg); amount 0.05 = +5% along, -4.8% across. */
export type Stretch = { angle: number; amount: number };

export const toCssTransform = (t: Transform, stretch?: Stretch) => {
  const parts = [`translate3d(${t.x}px, ${t.y}px, ${t.z}px)`];
  if (stretch && stretch.amount > 1e-4) {
    const s = 1 + stretch.amount;
    parts.push(`rotate(${stretch.angle}deg) scale(${s}, ${1 / s}) rotate(${-stretch.angle}deg)`);
  }
  if (t.rotateX) parts.push(`rotateX(${t.rotateX}deg)`);
  if (t.rotateY) parts.push(`rotateY(${t.rotateY}deg)`);
  if (t.rotate) parts.push(`rotate(${t.rotate}deg)`);
  if (t.skewX) parts.push(`skewX(${t.skewX}deg)`);
  if (t.pctX || t.pctY) parts.push(`translate(${t.pctX ?? 0}%, ${t.pctY ?? 0}%)`);
  const sx = t.scale * t.scaleX, sy = t.scale * t.scaleY;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.join(" ");
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const remap = (v: number, inRange: [number, number], outRange: [number, number], e?: EaseName) =>
  interpolate(v, inRange, outRange, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e ? EASING[e] : undefined });
