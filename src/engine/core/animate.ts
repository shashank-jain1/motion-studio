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
};

export const ease = (name: EaseName | undefined, t: number, fallback: EaseName = "outQuint") => {
  // Pin the endpoints: some curves (exp) only approach 0/1 asymptotically.
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return EASING[name ?? fallback](t);
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
  /** directional (motion) blur in px */
  dirBlurX: number; dirBlurY: number;
  clip?: string;
};

export const identity = (): Transform => ({
  x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0,
  opacity: 1, blur: 0, dirBlurX: 0, dirBlurY: 0,
});

const KF_PROPS = ["x", "y", "z", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "skewX", "opacity", "blur"] as const;

/** Evaluate keyframes at time t (seconds). Each property interpolates only between keyframes that define it. */
export const evalKeyframes = (kfs: Keyframe[] | undefined, t: number): Partial<Transform> => {
  if (!kfs || kfs.length === 0) return {};
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const out: Partial<Transform> = {};
  for (const prop of KF_PROPS) {
    const pts = sorted.filter((k) => k[prop] !== undefined);
    if (pts.length === 0) continue;
    if (t <= pts[0].t) { out[prop] = pts[0][prop]!; continue; }
    const last = pts[pts.length - 1];
    if (t >= last.t) { out[prop] = last[prop]!; continue; }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (t >= a.t && t <= b.t) {
        const p = ease(b.ease, (t - a.t) / Math.max(1e-6, b.t - a.t), "inOutQuint");
        out[prop] = lerp(a[prop]!, b[prop]!, p);
        break;
      }
    }
  }
  return out;
};

/**
 * Enter/exit preset as a function of "hidden-ness" h: 1 = fully hidden, 0 = at rest.
 * `dir` = +1 for enter (comes from), -1 for exit (goes to) so whips continue in the same direction.
 */
export const presetTransform = (type: string, h: number, distance: number | undefined, dir: 1 | -1): Partial<Transform> => {
  if (h <= 0.0001) return {};
  const d = distance;
  switch (type) {
    case "none": return {};
    case "fade": return { opacity: 1 - h };
    case "rise": return { y: (d ?? 80) * h, opacity: 1 - h, blur: 8 * h };
    case "drop": return { y: -(d ?? 80) * h, opacity: 1 - h, blur: 8 * h };
    case "slide-left": return { x: (d ?? 300) * h * dir, opacity: 1 - h };
    case "slide-right": return { x: -(d ?? 300) * h * dir, opacity: 1 - h };
    case "slide-up": return { y: (d ?? 300) * h * dir, opacity: 1 - h };
    case "slide-down": return { y: -(d ?? 300) * h * dir, opacity: 1 - h };
    case "zoom-in": return { scale: 1 - 0.6 * h, opacity: 1 - h, blur: 10 * h };
    case "zoom-out": return { scale: 1 + 1.5 * h, opacity: 1 - h, blur: 16 * h };
    case "blur-in": return { opacity: 1 - h, blur: 30 * h, scale: 1 + 0.08 * h };
    case "pop": return { scale: 1 - h, opacity: Math.min(1, (1 - h) * 3) };
    case "flip-up": return { rotateX: 90 * h, opacity: 1 - h, y: 30 * h };
    case "flip-side": return { rotateY: -90 * h * dir, opacity: 1 - h };
    case "swing": return { rotate: -18 * h * dir, y: 60 * h, opacity: 1 - h };
    case "spin-in": return { rotate: -180 * h * dir, scale: 1 - 0.8 * h, opacity: 1 - h };
    case "whip-left": return { x: (d ?? 1400) * h * dir, dirBlurX: 60 * h, opacity: 1 - h * 0.3 };
    case "whip-right": return { x: -(d ?? 1400) * h * dir, dirBlurX: 60 * h, opacity: 1 - h * 0.3 };
    case "whip-up": return { y: (d ?? 1000) * h * dir, dirBlurY: 60 * h, opacity: 1 - h * 0.3 };
    case "whip-down": return { y: -(d ?? 1000) * h * dir, dirBlurY: 60 * h, opacity: 1 - h * 0.3 };
    case "clip-up": return { clip: `inset(${100 * h}% 0 0 0)` };
    case "clip-down": return { clip: `inset(0 0 ${100 * h}% 0)` };
    case "clip-left": return { clip: `inset(0 0 0 ${100 * h}%)` };
    case "clip-right": return { clip: `inset(0 ${100 * h}% 0 0)` };
    case "iris": return { clip: `circle(${75 * (1 - h)}% at 50% 50%)` };
    case "stretch": return { scaleY: 1 + 1.5 * h, scaleX: 1 - 0.5 * h, opacity: 1 - h, blur: 6 * h };
    case "fly-in-3d": return { z: -1200 * h, rotateX: 50 * h, rotateY: -25 * h * dir, opacity: 1 - h, y: 200 * h };
    case "drop-bounce": return { y: -(d ?? 700) * h, opacity: h > 0.98 ? 0 : 1 };
    default: return { opacity: 1 - h };
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

/** Combine transforms: additive positions/rotations, multiplicative scale/opacity, max blur. */
export const combine = (...parts: Partial<Transform>[]): Transform => {
  const t = identity();
  for (const p of parts) {
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
    if (p.clip !== undefined) t.clip = p.clip;
  }
  return t;
};

export const toCssTransform = (t: Transform) => {
  const parts = [`translate3d(${t.x}px, ${t.y}px, ${t.z}px)`];
  if (t.rotateX) parts.push(`rotateX(${t.rotateX}deg)`);
  if (t.rotateY) parts.push(`rotateY(${t.rotateY}deg)`);
  if (t.rotate) parts.push(`rotate(${t.rotate}deg)`);
  if (t.skewX) parts.push(`skewX(${t.skewX}deg)`);
  const sx = t.scale * t.scaleX, sy = t.scale * t.scaleY;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.join(" ");
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const remap = (v: number, inRange: [number, number], outRange: [number, number], e?: EaseName) =>
  interpolate(v, inRange, outRange, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e ? EASING[e] : undefined });
