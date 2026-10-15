/**
 * Motion physics core: every layer's full transform as a PURE function of its local time.
 *
 *   computeLayerTransform(layer, t, duration, ctx) -> Transform
 *
 * Because it is pure we can evaluate it at several times per frame:
 *   - t and t - 1/fps        -> per-frame velocity (directional motion blur, squash/stretch)
 *   - parent at t - lag      -> follow-through parenting
 *   - t - i * delay          -> repeat / echo copies
 *
 * Craft references: docs/research/01-motion-craft.md §3 (Ebberts inertia, anticipation, arcs, 180° shutter).
 */
import type { Keyframe, Layer } from "../spec/schema";
import {
  type EaseName, type KfProp, type KfTrack, type Stretch, type Transform,
  EASING, addInto, clamp01, identity, keyframeTracks, loopTransform, presetTransform,
} from "./animate";

// ---------------------------------------------------------------------------------------------------------------
// Defaults (tuned visually on projects/test-physics)
// ---------------------------------------------------------------------------------------------------------------

/** Ebberts inertial bounce defaults: amplitude (s), frequency (Hz), decay (1/s). */
export const INERTIA_DEFAULTS = { amplitude: 0.05, frequency: 4, decay: 8 } as const;
/**
 * Eased moves arrive at ~zero velocity, which would make a pure finite-difference bounce invisible. The arrival
 * velocity used for the bounce is max(finite difference, FLOOR * mean segment velocity): fast moves still wobble
 * more than slow ones, linear/accelerating arrivals wobble the most.
 */
export const INERTIA_VELOCITY_FLOOR = 0.6;
/** Anticipation wind-up: at most this fraction of the move, and at most this many seconds. */
export const ANTICIPATION_WINDOW = { fraction: 0.3, maxSeconds: 0.24 } as const;
/** Keyframe segments get anticipation only when the move is at least this big (per property units). */
const ANTIC_THRESHOLD: Partial<Record<KfProp, number>> = {
  x: 150, y: 150, z: 300, scale: 0.3, scaleX: 0.3, scaleY: 0.3, rotate: 30, rotateX: 30, rotateY: 30, skewX: 15,
};
/** Properties that physically move (get inertia/anticipation). Opacity and blur never bounce. */
const MOTION_PROPS = new Set<KfProp>(["x", "y", "z", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "skewX"]);

/** Velocity FX: directional blur sigma = BLUR_K * (speed - THRESHOLD) px, speed in px/frame (≈180° shutter look). */
export const VELOCITY_FX = {
  blurK: 0.16, blurThreshold: 4, blurMax: 28,
  stretchK: 0.0022, stretchThreshold: 2, stretchMax: 0.08,
} as const;

/** Default arrival curves per enter preset (otherwise outQuint). */
export const ENTER_DEFAULT_EASE: Record<string, EaseName> = {
  pop: "outBack", "drop-bounce": "outBounce", swing: "spring", "spin-in": "outBack",
  "reveal-up": "expoOut", "reveal-down": "expoOut", "reveal-left": "expoOut", "reveal-right": "expoOut",
  grow: "quintOut", "unfold-x": "expoOut", "unfold-y": "expoOut", "drop-in-3d": "expoOut",
};
/** Exit default duration factor relative to the enter duration (research: exits ≈ 60–70% of enters). */
export const EXIT_DURATION_FACTOR = 0.65;

// ---------------------------------------------------------------------------------------------------------------
// Inertia + anticipation primitives
// ---------------------------------------------------------------------------------------------------------------

export type InertiaCfg = { amplitude: number; frequency: number; decay: number };

export const resolveInertia = (v: Layer["inertia"]): InertiaCfg | null => {
  if (!v) return null;
  if (v === true) return INERTIA_DEFAULTS;
  return {
    amplitude: v.amplitude ?? INERTIA_DEFAULTS.amplitude,
    frequency: v.frequency ?? INERTIA_DEFAULTS.frequency,
    decay: v.decay ?? INERTIA_DEFAULTS.decay,
  };
};

/** Dan Ebberts inertial bounce: v·amp·sin(2πfτ)/e^(dτ), τ = seconds after the key, v = arrival velocity (units/s). */
export const inertialBounce = (v: number, tau: number, c: InertiaCfg) => {
  if (tau <= 0 || tau > 1.5) return 0;
  return (v * c.amplitude * Math.sin(2 * Math.PI * c.frequency * tau)) / Math.exp(c.decay * tau);
};

type EaseFn = ((u: number) => number) & { key: string; overshoots: boolean };
/** Curves that already overshoot/bounce on their own: no extra inertial bounce on top. */
const SELF_OVERSHOOT = new Set<string>(["outBack", "inOutBack", "outElastic", "outBounce", "spring", "bouncy"]);
const easeFnCache = new Map<string, EaseFn>();
const easeFn = (name: EaseName | undefined, fallback: EaseName): EaseFn => {
  const key = name && EASING[name] ? name : fallback;
  let f = easeFnCache.get(key);
  if (!f) {
    const raw = EASING[key];
    f = Object.assign((u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : raw(u)), { key, overshoots: SELF_OVERSHOOT.has(key) });
    easeFnCache.set(key, f);
  }
  return f;
};

const anticWindow = (dur: number) => Math.min(ANTICIPATION_WINDOW.fraction, ANTICIPATION_WINDOW.maxSeconds / Math.max(dur, 1e-6));

/**
 * Shaped progress of one motion segment, u = linear 0..1. With anticipation `a` the first part of the segment is
 * a smooth counter-move to -a (zero velocity at both ends), then the main ease runs from -a to 1.
 */
export const shapedProgress = (u: number, dur: number, f: (u: number) => number, a: number): number => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (a > 0) {
    const w = anticWindow(dur);
    if (u < w) return -a * (0.5 - 0.5 * Math.cos((Math.PI * u) / w));
    return -a + (1 + a) * f((u - w) / (1 - w));
  }
  return f(u);
};

/** The move "visually lands" when eased progress reaches this; the inertial bounce starts there, not at the key. */
const LANDING = 0.98;
const landingCache = new Map<string, number>();
/** u (0..1) at which the shaped segment first reaches LANDING (bisection over the monotone main part; cached). */
const landingU = (dur: number, f: EaseFn, a: number) => {
  const w = a > 0 ? anticWindow(dur) : 0;
  const key = `${f.key}|${a}|${w.toFixed(4)}`;
  let u = landingCache.get(key);
  if (u === undefined) {
    let lo = w, hi = 1;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (shapedProgress(mid, dur, f, a) >= LANDING) hi = mid; else lo = mid; }
    u = hi;
    landingCache.set(key, u);
  }
  return u;
};

/**
 * Ebberts inertia for one segment, in progress units: 0 until the move visually lands, then a decaying wobble whose
 * amplitude is proportional to the landing velocity (one-frame finite difference, floored at FLOOR × mean speed).
 */
export const segmentBounce = (
  t: number, start: number, dur: number, f: EaseFn, antic: number, inertia: InertiaCfg | null, fps: number,
): number => {
  if (!inertia || dur <= 0 || f.overshoots) return 0;
  const uL = landingU(dur, f, antic);
  const tau = t - (start + uL * dur);
  if (tau <= 0 || tau > 1.5) return 0;
  const mean = 1 / dur;
  const du = 1 / (fps * dur);
  const fd = du >= uL ? mean : (shapedProgress(uL, dur, f, antic) - shapedProgress(uL - du, dur, f, antic)) * fps;
  const v = fd >= 0 ? Math.max(fd, INERTIA_VELOCITY_FLOOR * mean) : fd;
  // the last (1 - LANDING) of the ease is folded into the first quarter-wobble, so long moves keep their full overshoot
  const gap = 1 - shapedProgress((t - start) / dur, dur, f, antic);
  const q = Math.min(1, tau * 4 * inertia.frequency);
  return gap * q * q * (3 - 2 * q) + inertialBounce(v, tau, inertia);
};

/**
 * Progress of a segment [start, start+dur] at time t, including anticipation and inertia.
 * Returns 0 before, 1 at rest; may leave 0..1 (wind-up < 0, overshoot > 1).
 */
export const segmentProgress = (
  t: number, start: number, dur: number, f: EaseFn, antic: number, inertia: InertiaCfg | null, fps: number,
): number => {
  if (dur <= 0) return t >= start ? 1 : 0;
  return shapedProgress((t - start) / dur, dur, f, antic) + segmentBounce(t, start, dur, f, antic, inertia, fps);
};

// ---------------------------------------------------------------------------------------------------------------
// Keyframes with physics
// ---------------------------------------------------------------------------------------------------------------

const segAntic = (tr: KfTrack, j: number, antic: number) => {
  if (antic <= 0 || !MOTION_PROPS.has(tr.prop)) return 0;
  const startsFromRest = j === 0 || Math.abs(tr.v[j] - tr.v[j - 1]) < 1e-6;
  return startsFromRest && Math.abs(tr.v[j + 1] - tr.v[j]) >= (ANTIC_THRESHOLD[tr.prop] ?? Infinity) ? antic : 0;
};

/**
 * Keyframes with anticipation (before big moves that start from rest) and Ebberts inertia (when a move lands in a
 * hold or on the last key). Writes into `out` (combine semantics: additive x/y/rotate, multiplicative scale/opacity).
 */
export const applyKeyframes = (
  out: Transform, kfs: Keyframe[] | undefined, t: number, antic: number, inertia: InertiaCfg | null, fps: number,
) => {
  if (!kfs || kfs.length === 0) return;
  for (const tr of keyframeTracks(kfs)) {
    const n = tr.t.length;
    let val: number;
    let i: number; // segment (i -> i+1) containing t; -1 before the first key; n-1 after the last
    if (t <= tr.t[0]) { val = tr.v[0]; i = -1; } else if (t >= tr.t[n - 1]) { val = tr.v[n - 1]; i = n - 1; } else {
      i = 0;
      while (i < n - 2 && t > tr.t[i + 1]) i++;
      const dur = Math.max(1e-6, tr.t[i + 1] - tr.t[i]);
      val = tr.v[i] + (tr.v[i + 1] - tr.v[i]) * shapedProgress((t - tr.t[i]) / dur, dur, easeFn(tr.e[i + 1], "inOutQuint"), segAntic(tr, i, antic));
    }
    if (inertia && n >= 2 && MOTION_PROPS.has(tr.prop)) {
      // the latest moving segment j that has started; it bounces if it lands in a hold / on the last key
      let j = i >= n - 1 ? n - 2 : i;
      if (j >= 0 && Math.abs(tr.v[j + 1] - tr.v[j]) < 1e-6) j--;
      if (j >= 0) {
        const delta = tr.v[j + 1] - tr.v[j];
        const landsInHold = j + 1 === n - 1 || Math.abs(tr.v[j + 2] - tr.v[j + 1]) < 1e-6;
        if (landsInHold && Math.abs(delta) > 1e-6) {
          const dur = Math.max(1e-6, tr.t[j + 1] - tr.t[j]);
          val += delta * segmentBounce(t, tr.t[j], dur, easeFn(tr.e[j + 1], "inOutQuint"), segAntic(tr, j, antic), inertia, fps);
        }
      }
    }
    switch (tr.prop) {
      case "scale": case "scaleX": case "scaleY": case "opacity": out[tr.prop] *= val; break;
      default: out[tr.prop] += val;
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------
// Motion paths: centripetal Catmull-Rom through points, arc-length parametrised
// ---------------------------------------------------------------------------------------------------------------

type Pt = [number, number];
type PathLut = { pts: Pt[]; seg: Float64Array; u: Float64Array; len: Float64Array; total: number };
const LUT_STEPS = 48;
const pathCache = new WeakMap<Pt[], PathLut>();

/** Centripetal (alpha 0.5) Catmull-Rom point on segment i (between pts[i] and pts[i+1]) at u in 0..1. */
export const catmullRom = (pts: Pt[], i: number, u: number): Pt => {
  const n = pts.length;
  const p1 = pts[i], p2 = pts[i + 1];
  const p0: Pt = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
  const p3: Pt = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
  const knot = (a: Pt, b: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: number, b: number, ta: number, tb: number) => ((tb - t) * a + (t - ta) * b) / (tb - ta);
  const out: Pt = [0, 0];
  for (let k = 0; k < 2; k++) {
    const a1 = mix(p0[k], p1[k], t0, t1), a2 = mix(p1[k], p2[k], t1, t2), a3 = mix(p2[k], p3[k], t2, t3);
    const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
    out[k] = mix(b1, b2, t1, t2);
  }
  return out;
};

const pathLut = (pts: Pt[]): PathLut => {
  let lut = pathCache.get(pts);
  if (lut) return lut;
  const segs = pts.length - 1;
  const m = segs * LUT_STEPS + 1;
  const seg = new Float64Array(m), u = new Float64Array(m), len = new Float64Array(m);
  let prev = pts[0], total = 0, j = 0;
  seg[0] = 0; u[0] = 0; len[0] = 0;
  for (let s = 0; s < segs; s++) {
    for (let k = 1; k <= LUT_STEPS; k++) {
      const uu = k / LUT_STEPS;
      const p = catmullRom(pts, s, uu);
      total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      j++;
      seg[j] = s; u[j] = uu; len[j] = total;
    }
  }
  lut = { pts, seg, u, len, total };
  pathCache.set(pts, lut);
  return lut;
};

/** Point and tangent angle (deg) at arc-length fraction s (0..1, extrapolated linearly along the end tangents). */
export const pointOnPath = (pts: Pt[], s: number): { x: number; y: number; angle: number } => {
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0, angle: 0 };
  const lut = pathLut(pts);
  const at = (sc: number): Pt => {
    const target = clamp01(sc) * lut.total;
    let lo = 0, hi = lut.len.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lut.len[mid] < target) lo = mid; else hi = mid; }
    const span = lut.len[hi] - lut.len[lo];
    const f = span > 1e-9 ? (target - lut.len[lo]) / span : 0;
    // segment/u for lo and hi may straddle a segment boundary (hi.u = 1/STEPS of the next one)
    const segLo = lut.seg[lo], segHi = lut.seg[hi];
    let uu: number, si: number;
    if (segLo === segHi) { si = segHi; uu = lut.u[lo] + (lut.u[hi] - lut.u[lo]) * f; } else { si = segHi; uu = lut.u[hi] * f; }
    return catmullRom(pts, si, uu);
  };
  const eps = 0.5 / Math.max(1, lut.total); // ~half a pixel
  if (s < 0 || s > 1) {
    const end = s > 1 ? 1 : 0;
    const p = at(end), q = at(end - (s > 1 ? eps : -eps) * 2);
    const dx = (p[0] - q[0]) * (s > 1 ? 1 : -1), dy = (p[1] - q[1]) * (s > 1 ? 1 : -1);
    const dl = Math.hypot(dx, dy) || 1;
    const over = (s > 1 ? s - 1 : s) * lut.total;
    return { x: p[0] + (dx / dl) * over, y: p[1] + (dy / dl) * over, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }
  const p = at(s);
  const a = at(Math.max(0, s - eps)), b = at(Math.min(1, s + eps));
  return { x: p[0], y: p[1], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
};

// ---------------------------------------------------------------------------------------------------------------
// The pure layer transform
// ---------------------------------------------------------------------------------------------------------------

export type LayerRef = { layer: Layer; start: number; duration: number };
export type PhysicsCtx = {
  fps: number;
  /** absolute start (s) of the evaluated layer within its list (for parenting across Sequences) */
  start?: number;
  /** sibling lookup by id (same LayerList); must already be cycle-free (see buildLayerIndex) */
  resolve?: (id: string) => LayerRef | undefined;
  /** recursion guard */
  depth?: number;
};

/** stepRate: quantize time to N fps ("animate on twos"). */
export const quantizeTime = (t: number, rate: number | undefined) =>
  rate && rate > 0 ? Math.floor(t * rate + 1e-6) / rate : t;

/** Resting pose of a layer (what parenting treats as "no offset"). */
export const restPose = (layer: Layer) => {
  const last = layer.path?.points[layer.path.points.length - 1];
  return {
    x: last ? last[0] : layer.x ?? 0, y: last ? last[1] : layer.y ?? 0, z: layer.z ?? 0,
    scale: layer.scale ?? 1, rotate: layer.rotate ?? 0, rotateX: layer.rotateX ?? 0, rotateY: layer.rotateY ?? 0,
    opacity: layer.opacity ?? 1,
  };
};

/** Exit timing: explicit duration, else ≈0.65× the enter duration (accelerate curve), else 0.5 s. */
export const exitTiming = (layer: Layer): { duration: number; ease: EaseName } | null => {
  const e = layer.exit;
  if (!e || e.type === "none") return null;
  const hasEnter = !!layer.enter && layer.enter.type !== "none";
  if (e.duration !== undefined) return { duration: e.duration, ease: e.ease ?? "in" };
  if (hasEnter) return { duration: EXIT_DURATION_FACTOR * (layer.enter!.duration ?? 0.6), ease: e.ease ?? "m3Exit" };
  return { duration: 0.5, ease: e.ease ?? "in" };
};

/**
 * The full transform of a layer at its local time t (seconds since the layer's start), excluding camera parallax and
 * velocity effects. Pure and allocation-light: safe to call several times per frame.
 */
export const computeLayerTransform = (layer: Layer, t: number, duration: number, ctx: PhysicsCtx): Transform => {
  const fps = ctx.fps;
  t = quantizeTime(t, layer.stepRate);
  const inertia = resolveInertia(layer.inertia);
  const antic = Math.max(0, Math.min(0.5, layer.anticipate ?? 0));

  const out = identity();
  out.x = layer.x ?? 0; out.y = layer.y ?? 0; out.z = layer.z ?? 0;
  out.scale = layer.scale ?? 1;
  out.rotate = layer.rotate ?? 0; out.rotateX = layer.rotateX ?? 0; out.rotateY = layer.rotateY ?? 0;
  out.opacity = layer.opacity ?? 1; out.blur = layer.blur ?? 0;

  // Motion path (replaces base x/y) ----------------------------------------------------------------------------
  const path = layer.path;
  if (path && path.points.length >= 2) {
    const pts = path.points as Pt[];
    const pStart = path.start ?? 0;
    const pDur = path.duration ?? 1;
    const f = easeFn(path.ease, "smooth");
    const p0 = pts[0], pn = pts[pts.length - 1];
    const big = Math.hypot(pn[0] - p0[0], pn[1] - p0[1]) >= 150;
    const s = segmentProgress(t, pStart, pDur, f, big ? antic : 0, inertia, fps);
    const pp = pointOnPath(pts, s);
    out.x = pp.x; out.y = pp.y;
    if (path.orient) out.rotate += pp.angle;
  }

  applyKeyframes(out, layer.animate, t, antic, inertia, fps);
  if (layer.loop) addInto(out, loopTransform(layer.loop, t));

  // Enter --------------------------------------------------------------------------------------------------------
  const en = layer.enter;
  if (en && en.type !== "none") {
    const delay = en.delay ?? 0, dur = en.duration ?? 0.6;
    const f = easeFn(en.ease, ENTER_DEFAULT_EASE[en.type] ?? "outQuint");
    const pVis = dur <= 0 ? (t >= delay ? 1 : 0) : f((t - delay) / dur);
    const pSp = segmentProgress(t, delay, dur, f, antic, inertia, fps);
    if (pSp !== 1 || pVis !== 1) addInto(out, presetTransform(en.type, 1 - pSp, en.distance, 1, 1 - pVis));
  }

  // Exit ---------------------------------------------------------------------------------------------------------
  const ex = exitTiming(layer);
  if (ex) {
    const e = layer.exit!;
    const start = duration - ex.duration - (e.delay ?? 0);
    if (t > start) {
      const f = easeFn(ex.ease, "in");
      const u = ex.duration <= 0 ? 1 : (t - start) / ex.duration;
      const hVis = f(u);
      const hSp = shapedProgress(u, ex.duration, f, antic);
      addInto(out, presetTransform(e.type, hSp, e.distance, -1, hVis));
    }
  }

  // Parenting with follow-through lag -----------------------------------------------------------------------------
  const depth = ctx.depth ?? 0;
  if (layer.parent && ctx.resolve && depth < 16) {
    const p = ctx.resolve(layer.parent);
    if (p && p.layer !== layer) {
      const tp = t + (ctx.start ?? 0) - p.start - (layer.lag ?? 0);
      const pt = computeLayerTransform(p.layer, tp, p.duration, { fps, resolve: ctx.resolve, start: p.start, depth: depth + 1 });
      applyParent(out, pt, restPose(p.layer));
    }
  }
  return out;
};

/** Child inherits the parent's animated offset from its rest pose: translation, rotation about the parent, scale, opacity. */
const applyParent = (out: Transform, pt: Transform, rest: ReturnType<typeof restPose>) => {
  const dRot = pt.rotate - rest.rotate;
  const s = rest.scale !== 0 ? pt.scale / rest.scale : 1;
  const rx = out.x - rest.x, ry = out.y - rest.y;
  const rad = (dRot * Math.PI) / 180, c = Math.cos(rad), sn = Math.sin(rad);
  out.x = pt.x + s * (rx * c - ry * sn);
  out.y = pt.y + s * (rx * sn + ry * c);
  out.z += pt.z - rest.z;
  out.rotate += dRot;
  out.rotateX += pt.rotateX - rest.rotateX;
  out.rotateY += pt.rotateY - rest.rotateY;
  out.scale *= s;
  if (rest.opacity > 0) out.opacity *= Math.min(1, clamp01(pt.opacity) / rest.opacity);
};

// ---------------------------------------------------------------------------------------------------------------
// Velocity effects
// ---------------------------------------------------------------------------------------------------------------

export type VelocityFxCfg = { blur: number; stretch: number };

/** undefined → blur on, stretch off; true → both on; false → off; object → per-effect multipliers. */
export const resolveVelocityFx = (v: Layer["velocityFx"]): VelocityFxCfg | null => {
  if (v === false) return null;
  if (v === undefined) return { blur: 1, stretch: 0 };
  if (v === true) return { blur: 1, stretch: 1 };
  return { blur: v.blur ?? 1, stretch: v.stretch ?? 0 };
};

/** Screen-space displacement per rendered frame (px) at local time t. Pass the already computed `now` transform. */
export const layerVelocity = (layer: Layer, t: number, duration: number, ctx: PhysicsCtx, now: Transform) => {
  const rate = layer.stepRate && layer.stepRate > 0 ? layer.stepRate : 0;
  const dt = rate ? 1 / rate : 1 / ctx.fps;
  const tq = quantizeTime(t, rate || undefined);
  const prev = computeLayerTransform(layer, tq - dt, duration, ctx);
  const k = 1 / ctx.fps / dt;
  return { dx: (now.x - prev.x) * k, dy: (now.y - prev.y) * k };
};

export type VelocityLook = { angle: number; sigma: number; stretch: Stretch | undefined };

/** Directional blur (sigma along `angle`) and volume-preserving stretch from a per-frame displacement. */
export const velocityLook = (dx: number, dy: number, cfg: VelocityFxCfg): VelocityLook => {
  const speed = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const V = VELOCITY_FX;
  const sigma = Math.min(V.blurMax, cfg.blur * V.blurK * Math.max(0, speed - V.blurThreshold));
  const amount = Math.min(V.stretchMax, cfg.stretch * V.stretchK * Math.max(0, speed - V.stretchThreshold));
  return { angle, sigma, stretch: amount > 1e-4 ? { angle, amount } : undefined };
};

// ---------------------------------------------------------------------------------------------------------------
// Layer index (parenting) + repeat
// ---------------------------------------------------------------------------------------------------------------

/**
 * Build the id → {layer, start, duration} index for a LayerList, dropping parent links that would form a cycle
 * (or point to unknown ids). Returns a resolver usable as PhysicsCtx.resolve.
 */
export const buildLayerIndex = (layers: Layer[], durationOf: (l: Layer) => number) => {
  const byId = new Map<string, LayerRef>();
  for (const l of layers) if (l.id && !byId.has(l.id)) byId.set(l.id, { layer: l, start: l.start ?? 0, duration: durationOf(l) });
  const broken = new Set<string>();
  for (const [id] of byId) {
    // id is in a cycle iff following parents leads back to it
    const seen = new Set<string>([id]);
    let cur = byId.get(id)!.layer.parent;
    while (cur && byId.has(cur)) {
      if (cur === id) { broken.add(id); break; }
      if (seen.has(cur)) break; // leads into a cycle elsewhere; that cycle's members are stripped
      seen.add(cur);
      cur = byId.get(cur)!.layer.parent;
    }
  }
  // members of a cycle lose their parent link (once, here) so evaluation always terminates
  for (const id of broken) {
    const r = byId.get(id)!;
    byId.set(id, { ...r, layer: { ...r.layer, parent: undefined } as Layer });
  }
  const resolve = (id: string): LayerRef | undefined => byId.get(id);
  const hasCycle = (id: string | undefined) => !!id && broken.has(id);
  return { resolve, hasCycle, broken };
};

/** Repeat copy i (1..count-1): time offset and cumulative transform offsets. */
export const repeatCopy = (rep: NonNullable<Layer["repeat"]>, i: number, tr: Transform): Transform => {
  tr.x += i * (rep.x ?? 0);
  tr.y += i * (rep.y ?? 0);
  tr.rotate += i * (rep.rotate ?? 0);
  tr.scale *= Math.pow(rep.scale ?? 1, i);
  tr.opacity *= Math.pow(rep.opacity ?? 0.65, i);
  return tr;
};
export const REPEAT_DEFAULT_DELAY = 0.06;
