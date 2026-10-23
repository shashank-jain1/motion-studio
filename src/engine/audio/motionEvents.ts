/** Measure the SAME transform function used for picture; no preset-name timing guesses for authored motion. */
import type { Layer } from "../spec/schema";
import { motionWindows } from "../core/choreography";
import { computeLayerTransform, type PhysicsCtx } from "../core/physics";
import type { Transform } from "../core/animate";

export type MotionLandmark = {
  start: number; rush: number; contact: number; settle: number;
  speed: number; travel: number; x: number; direction: number;
  kind: "gesture" | "path" | "keyframe";
};
const distance = (a: Transform, b: Transform) => Math.hypot(
  b.x - a.x, b.y - a.y, (b.z - a.z) * 0.3,
  Math.log(Math.max(0.001, Math.abs(b.scale)) / Math.max(0.001, Math.abs(a.scale))) * 240,
  (b.rotate - a.rotate) * 2, (b.rotateX - a.rotateX) * 2, (b.rotateY - a.rotateY) * 2,
  (b.scaleX - a.scaleX) * 120, (b.scaleY - a.scaleY) * 120,
);

export const analyseLayerMotion = (layer: Layer, duration: number, fps: number, ctx: PhysicsCtx = { fps }): MotionLandmark[] => {
  const frameTime = (t: number) => Math.round(t * fps) / fps;
  return motionWindows(layer, duration).flatMap((w) => {
    if (w.end <= w.start || (w.kind === "gesture" && w.contact >= duration)) return [];
    let prev = computeLayerTransform(layer, w.start, duration, ctx);
    const first = prev;
    let speed = 0, rush = w.start, travel = 0;
    // A bounded sample budget even for unusually long imported keyframe segments.
    const steps = Math.max(1, Math.min(480, Math.ceil((w.end - w.start) * fps)));
    const dt = (w.end - w.start) / steps;
    for (let i = 1; i <= steps; i++) {
      const t = w.start + i * dt;
      const next = computeLayerTransform(layer, t, duration, ctx);
      const d = distance(prev, next);
      travel += d;
      if (d / dt > speed) { speed = d / dt; rush = t; }
      prev = next;
    }
    if (w.kind !== "gesture" && (travel < 70 || speed < 120)) return [];
    const contact = computeLayerTransform(layer, w.contact, duration, ctx);
    return [{ start: frameTime(w.start), rush: frameTime(rush), contact: frameTime(w.contact), settle: frameTime(w.end), speed, travel, x: contact.x, direction: Math.sign(contact.x - first.x), kind: w.kind }];
  });
};
