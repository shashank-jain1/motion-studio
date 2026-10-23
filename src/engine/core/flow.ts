/** Cubic Hermite pose interpolation. Positions keep velocity across cuts; bounded properties cannot overshoot. */
import { keyframeTracks, type Transform } from "./animate";
import type { Keyframe } from "../spec/schema";

export const flowAt = (keys: Keyframe[], t: number): Partial<Transform> => {
  const result: Partial<Transform> = {};
  for (const track of keyframeTracks(keys)) {
    const { t: ts, v: vs, prop } = track, n = ts.length;
    if (t <= ts[0]) { result[prop] = vs[0]; continue; }
    if (t >= ts[n - 1]) { result[prop] = vs[n - 1]; continue; }
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = Math.max(1e-6, ts[i + 1] - ts[i]), u = (t - ts[i]) / h;
    const slope = (j: number) => {
      if (j === 0 || j === n - 1) return 0; // deliberate quiet start / resolve
      const a = (vs[j] - vs[j - 1]) / Math.max(1e-6, ts[j] - ts[j - 1]);
      const b = (vs[j + 1] - vs[j]) / Math.max(1e-6, ts[j + 1] - ts[j]);
      if (["scale", "scaleX", "scaleY", "opacity", "blur"].includes(prop)) {
        return a * b <= 0 ? 0 : 2 * a * b / (a + b);
      }
      return (vs[j + 1] - vs[j - 1]) / Math.max(1e-6, ts[j + 1] - ts[j - 1]);
    };
    const u2 = u * u, u3 = u2 * u;
    let value = (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * slope(i) +
      (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * slope(i + 1);
    if (["scale", "scaleX", "scaleY", "opacity", "blur"].includes(prop)) value = Math.min(Math.max(vs[i], vs[i + 1]), Math.max(Math.min(vs[i], vs[i + 1]), value));
    result[prop] = value;
  }
  return result;
};

export const flowKeyframes = (keys: Keyframe[], fps: number): Keyframe[] => {
  if (keys.length < 2) return keys;
  const ordered = [...keys].sort((a, b) => a.t - b.t), start = ordered[0].t, end = ordered[ordered.length - 1].t;
  const times = [...new Set([start, end, ...ordered.map((k) => k.t), ...Array.from({ length: Math.max(0, Math.ceil((end - start) * fps)) }, (_, i) => start + i / fps)])].sort((a, b) => a - b);
  return times.map((t) => ({ t, ...flowAt(ordered, t), ease: "linear" }));
};
