/** Pure, seek-safe interaction state. Interrupted moves start at their current value, without jumping. */
import { springOmega, springStep } from "./animate";
export type ToggleState = { at: number; on: boolean };
export const interactionFrame = (at: number, fps: number) => Math.ceil(at * fps - 1e-8) / fps;
export const toggleAt = (states: ToggleState[], t: number, initial = false, duration = 0.28): number => {
  const d = Math.max(0.001, duration);
  let from = initial ? 1 : 0, target = from, start = -Infinity;
  const value = (time: number) => {
    const u = Math.max(0, Math.min(1, (time - start) / d));
    return from + (target - from) * (u * u * (3 - 2 * u));
  };
  for (const state of [...states].sort((a, b) => a.at - b.at)) {
    if (state.at > t) break;
    from = value(state.at); target = state.on ? 1 : 0; start = state.at;
  }
  return value(t);
};

export const clickAt = (clicks: number[], t: number) => {
  const elapsed = clicks.filter((at) => at <= t).map((at) => t - at);
  const dt = elapsed.length ? Math.min(...elapsed) : Infinity;
  return { press: Math.max(0, 1 - dt / 0.16), ripple: dt < 0.45 ? dt / 0.45 : null };
};

// --- Direct manipulation: glide indicators and dragged sliders (closed-form springs, pure functions of time) ----------
const Z = 0.82;
const settleTo = (dt: number, settle: number) => springStep(dt, springOmega(settle, Z), Z);

/** The pointer is held at t inside one of these press intervals. */
export const heldAt = (drags: { at: number; until: number }[] | undefined, t: number) =>
  (drags ?? []).find((d) => t >= d.at && t <= d.until) ?? null;

export type GlideStop = { at: number; x?: number; y?: number; width?: number; height?: number };
/**
 * Box of a gliding indicator at t. Each edge is a sum of springs (one per stop); every edge is evaluated twice, with a
 * fast and a slow spring, and the box takes the outermost pair — so whichever edge leads in the direction of travel
 * rides the fast spring and the trailing edge the slow one. The shape stretches while it moves and settles to the stop.
 */
export const glideBox = (stops: GlideStop[], t: number, base: { w: number; h: number }, lead = 0.32, trail = 0.6) => {
  const full: { at: number; x: number; y: number; w: number; h: number }[] = [];
  let cur = { x: 0, y: 0, w: base.w, h: base.h };
  for (const s of [...stops].sort((a, b) => a.at - b.at)) {
    cur = { x: s.x ?? cur.x, y: s.y ?? cur.y, w: s.width ?? cur.w, h: s.height ?? cur.h };
    full.push({ at: s.at, ...cur });
  }
  if (!full.length) full.push({ at: 0, ...cur });
  const edge = (val: (s: (typeof full)[number]) => number, settle: number) => {
    let v = val(full[0]);
    for (let i = 1; i < full.length; i++) if (t > full[i].at) v += (val(full[i]) - val(full[i - 1])) * settleTo(t - full[i].at, settle);
    return v;
  };
  const pair = (lo: (s: (typeof full)[number]) => number, hi: (s: (typeof full)[number]) => number) =>
    [Math.min(edge(lo, lead), edge(lo, trail)), Math.max(edge(hi, lead), edge(hi, trail))];
  const [left, right] = pair((s) => s.x - s.w / 2, (s) => s.x + s.w / 2);
  const [top, bottom] = pair((s) => s.y - s.h / 2, (s) => s.y + s.h / 2);
  return { left, right, top, bottom };
};

/** Rubber band past the ends: the first track-length of overdrag gives at most +0.3. */
export const rubber = (v: number) => (v > 1 ? 1 + (0.3 * (v - 1)) / (1 + (v - 1)) : v < 0 ? (-0.3 * -v) / (1 + -v) : v);

/**
 * Slider value at t. `values` retarget a spring (velocity carried); while a drag holds, the value IS the pointer's
 * projection on the track (`raw`), rubber-banded past the ends; on release it springs from where it was let go back
 * inside 0..1. Returns the displayed value (may overshoot) and whether the pointer holds it.
 */
export const sliderAt = (o: {
  t: number; initial?: number; values?: { at: number; value: number }[]; drags?: { at: number; until: number }[];
  raw?: (t: number) => number | null; settle?: number; stretch?: boolean;
}) => {
  const settle = o.settle ?? 0.45, band = o.stretch === false ? (v: number) => Math.min(1, Math.max(0, v)) : rubber;
  type Ev = { at: number; value?: number; until?: number };
  const evs: Ev[] = [...(o.values ?? []).map((v) => ({ at: v.at, value: v.value })), ...(o.raw ? (o.drags ?? []).map((d) => ({ at: d.at, until: d.until })) : [])]
    .sort((a, b) => a.at - b.at);
  let target = o.initial ?? 0;
  let terms: { t0: number; d: number }[] = [];
  for (const e of evs) {
    if (e.at > o.t) break;
    if (e.value !== undefined) { terms.push({ t0: e.at, d: target - e.value }); target = e.value; continue; }
    const raw = o.raw!(Math.min(o.t, e.until!));
    if (raw === null) continue;
    if (o.t <= e.until!) return { value: band(raw), held: true };
    target = Math.min(1, Math.max(0, raw));
    terms = [{ t0: e.until!, d: band(raw) - target }];
  }
  let v = target;
  for (const k of terms) v += k.d * (1 - settleTo(o.t - k.t0, settle));
  return { value: v, held: false };
};
