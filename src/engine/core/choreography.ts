/** Shared motion/contact clock. Pure; safe in Node and out-of-order rendering. */
import type { Gesture, Keyframe, Layer } from "../spec/schema";
import { evalKeyframes, type Transform } from "./animate";

const CONTACT = 0.64;
export const gestureTiming = (g: Gesture) => {
  const start = g.delay ?? 0, duration = g.duration ?? 1.2;
  return { start, duration, contact: start + duration * CONTACT, settle: start + duration };
};

/** A stepped layer cannot display a contact until its next content tick and next rendered frame. */
export const motionFrameTime = (layer: Layer, time: number, fps: number) => {
  if (!layer.stepRate || layer.stepRate <= 0) return Math.round(time * fps) / fps;
  const tick = Math.ceil(time * layer.stepRate - 1e-9) / layer.stepRate;
  return Math.ceil(tick * fps - 1e-9) / fps;
};

const tracks = new WeakMap<Gesture, Keyframe[]>();
export const gestureKeyframes = (g: Gesture): Keyframe[] => {
  const hit = tracks.get(g);
  if (hit) return hit;
  const { start, duration } = gestureTiming(g);
  const d = g.distance ?? 480, s = g.strength ?? 1;
  const sign = g.direction === "right" || g.direction === "down" ? 1 : -1;
  const vertical = g.direction === "up" || g.direction === "down";
  const pos = (v: number) => vertical ? { x: 0, y: v * sign } : { x: v * sign, y: 0 };
  const rest = { x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0 };
  const key = (u: number, v: Partial<Transform>, ease: Keyframe["ease"] = "inOutQuint"): Keyframe => ({ ...rest, ...v, t: start + u * duration, ease });
  let k: Keyframe[];
  switch (g.preset) {
    case "magnetic": k = [
      key(0, { ...pos(d), scale: 0.65, rotate: -12 * sign * s }),
      key(0.16, { ...pos(d * 1.08), scale: 0.6, rotate: -17 * sign * s }),
      key(CONTACT, {}, "inOutExpo"),
      key(0.77, { ...pos(-d * 0.035 * s), scale: 1 + 0.025 * s }, "outQuint"), key(1, {}),
    ]; break;
    case "orbit-land": k = [
      key(0, { ...pos(d), y: vertical ? d * sign : -d * 0.4, scale: 0.4, rotateY: -65 * s, rotate: -18 * s }),
      key(0.32, { ...pos(d * 0.58), y: vertical ? d * 0.58 * sign : -d * 0.55, scale: 0.8, rotateY: -38 * s }),
      key(CONTACT, {}, "outQuint"), key(0.8, { y: -10 * s, rotateY: 4 * s }), key(1, {}),
    ]; break;
    case "elastic-slam": k = [
      key(0, { y: -d, scale: 0.8, scaleY: 1.2, scaleX: 0.84 }),
      key(0.16, { y: -d * 1.08, scale: 0.76, scaleY: 0.9, scaleX: 1.1 }),
      key(CONTACT, { scaleX: 1 + 0.24 * s, scaleY: 1 / (1 + 0.24 * s) }, "inExpo"),
      key(0.78, { y: -d * 0.06 * s, scaleY: 1 + 0.1 * s, scaleX: 1 / (1 + 0.1 * s) }, "outQuint"), key(1, {}),
    ]; break;
    case "vortex": k = [
      key(0, { scale: 0.001, rotate: -260 * s, z: -d }),
      key(0.24, { scale: 0.12, rotate: -210 * s, z: -d * 0.8 }),
      key(CONTACT, {}, "inOutExpo"), key(0.8, { scale: 1 + 0.045 * s, rotate: 5 * s }), key(1, {}),
    ]; break;
    case "hinge": k = [
      key(0, { rotateX: -88 * s, scaleY: 0.05, y: -d * 0.12 }),
      key(0.16, { rotateX: -94 * s, scaleY: 0.05, y: -d * 0.15 }),
      key(CONTACT, {}, "inOutExpo"), key(0.78, { rotateX: 9 * s }), key(1, {}),
    ]; break;
    case "rubber-stamp": k = [
      key(0, { scale: 2.8, rotate: -18 * s, z: d }),
      key(0.2, { scale: 3, rotate: -22 * s, z: d * 1.1 }),
      key(CONTACT, { scaleX: 1 + 0.15 * s, scaleY: 1 / (1 + 0.15 * s) }, "inExpo"),
      key(0.77, { scale: 1 + 0.06 * s, rotate: 2 * s }), key(1, {}),
    ]; break;
  }
  tracks.set(g, k);
  return k;
};

export const gestureTransform = (g: Gesture, t: number) => evalKeyframes(gestureKeyframes(g), t);

/** Candidate segments; idle holds are filtered by the sound analyser. */
export const motionWindows = (l: Layer, duration: number): { start: number; end: number; contact: number; kind: "gesture" | "path" | "keyframe" }[] => {
  if (l.gesture) {
    const g = gestureTiming(l.gesture);
    return [{ start: g.start, end: Math.min(duration, g.settle), contact: g.contact, kind: "gesture" }];
  }
  if (l.path) {
    const start = Math.max(0, l.path.start ?? 0), end = Math.min(duration, start + (l.path.duration ?? 1));
    return [{ start, end, contact: end, kind: "path" }];
  }
  const times = [...new Set((l.animate ?? []).map((k) => k.t))].sort((a, b) => a - b);
  return times.slice(1).map((end, i) => ({ start: times[i], end: Math.min(duration, end), contact: end, kind: "keyframe" as const }));
};
