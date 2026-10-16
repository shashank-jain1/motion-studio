/**
 * 3D kinetic type: per-glyph (per-part) choreography, pure functions of t. Each returns offsets from the part's
 * rest pose (x/y/z additive, rotations in radians, s uniform scale, sy/sz extra axis scales).
 *
 *   rail          the word drives in along a track: from deep right, round a 90° bend, slides left into place
 *   extrude-grow  flat 2D glyphs grow their depth (front face fixed) with a springy settle, staggered
 *   cascade-flip  each glyph flips a full 360° around X while popping in, step-delayed
 *   stack-echo    glyphs rise; K echo copies stack behind in depth and breathe (rig draws the copies)
 *   orbit-ring    glyphs ride a spinning ring around the camera axis, then unroll into the flat word
 *   drop          glyphs fall and bounce (closed-form restitution chain) with squash on impact
 *   wave          a travelling wave through the word (loops)
 */
import { clamp01, ease } from "../../core/animate";
import type { Animation3D, Pose } from "./motion";
import { spring } from "./motion";

export const KINETIC_ORDERS = ["left", "right", "center-out", "edges-in", "random"] as const;
export type KineticOrder = (typeof KINETIC_ORDERS)[number];
export type KineticOpts = { stagger?: number; order?: KineticOrder; seed?: number; echo?: { count?: number; gap?: number } };

export type PartCtx = {
  /** rank left→right, 0..n-1 */
  rank: number;
  n: number;
  cx: number;
  cy: number;
  /** model width / height / depth */
  w: number;
  h: number;
  depth: number;
};

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const hash = (i: number, seed: number) => {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export const DEFAULT_STAGGER: Partial<Record<Animation3D, number>> = {
  rail: 0.06, "extrude-grow": 0.08, "cascade-flip": 0.07, "stack-echo": 0.06, "orbit-ring": 0, drop: 0.09, wave: 0.12,
};

/** Position of `rank` in the stagger order (0 = first to move). */
export const orderIndex = (order: KineticOrder, rank: number, n: number, seed = 1): number => {
  const mid = (n - 1) / 2;
  switch (order) {
    case "right": return n - 1 - rank;
    case "center-out": return Math.abs(rank - mid) * 2;
    case "edges-in": return (mid - Math.abs(rank - mid)) * 2;
    case "random": {
      // seeded permutation: rank by hash
      const keys = Array.from({ length: n }, (_, i) => [hash(i, seed), i] as const).sort((a, b) => a[0] - b[0]);
      return keys.findIndex(([, i]) => i === rank);
    }
    default: return rank;
  }
};

/** Closed-form bounce chain: height above rest for a drop from h0 (g units/s², restitution e). */
export const bounceY = (tau: number, h0: number, g = 9, e = 0.38): { y: number; impact: number } => {
  if (tau <= 0) return { y: h0, impact: -1 };
  const t0 = Math.sqrt((2 * h0) / g);
  if (tau < t0) return { y: h0 - 0.5 * g * tau * tau, impact: -1 };
  let t = tau - t0;
  let v = g * t0 * e;
  for (let k = 0; k < 8; k++) {
    const dur = (2 * v) / g;
    if (t < dur) return { y: v * t - 0.5 * g * t * t, impact: t }; // impact = time since the latest impact
    t -= dur;
    v *= e;
  }
  return { y: 0, impact: t };
};

export const kineticPose = (anim: Animation3D, t: number, p: PartCtx, o: KineticOpts = {}): Pose | null => {
  const st = o.stagger ?? DEFAULT_STAGGER[anim] ?? 0.07;
  const d = st * orderIndex(o.order ?? "left", p.rank, p.n, o.seed ?? 1);
  const P: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 };
  switch (anim) {
    case "rail": {
      const R = Math.max(0.55, p.h * 0.9);
      const W2 = p.w / 2;
      const L = p.w + (R * Math.PI) / 2 + 1.2 * p.h;
      const u = clamp01((t - d) / 2.1);
      const e = ease("carbonExpressive", u);
      // cars bunch up on arrival: later glyphs carry a little extra track
      const sOff = (L + 0.35 * p.h * p.rank) * (1 - e);
      const s = p.cx + sOff;
      let x: number, z: number, phi: number;
      if (s <= W2) {
        x = s; z = 0; phi = 0;
      } else if (s <= W2 + (R * Math.PI) / 2) {
        phi = (s - W2) / R;
        x = W2 + R * Math.sin(phi);
        z = -R * (1 - Math.cos(phi));
      } else {
        phi = Math.PI / 2;
        x = W2 + R;
        z = -R - (s - W2 - (R * Math.PI) / 2);
      }
      P.x = x - p.cx;
      P.z = z;
      P.ry = phi;
      P.y = 0.06 * p.h * Math.sin(Math.PI * clamp01(phi / (Math.PI / 2)));
      return P;
    }
    case "extrude-grow": {
      const u = clamp01((t - d - 0.15) / 0.95);
      const g = Math.max(0.015, spring(u, 4.2, 0.9));
      P.sz = g;
      P.z = (p.depth / 2) * (1 - g); // front face stays put: depth grows backwards
      return P;
    }
    case "cascade-flip": {
      const u = clamp01((t - d) / 0.9);
      P.rx = -TAU * (1 - spring(u, 4.6, 1.0));
      P.y = Math.sin(Math.PI * u) * 0.22 * p.h;
      P.z = Math.sin(Math.PI * u) * 0.15 * p.h;
      P.s = lerp(0, 1, ease("outExpo", clamp01(u * 1.8)));
      return P;
    }
    case "stack-echo": {
      const u = clamp01((t - d) / 0.8);
      const e = spring(u, 5, 1.0);
      P.y = -0.35 * p.h * (1 - e);
      P.rx = -0.9 * (1 - e);
      P.s = lerp(0.6, 1, ease("outExpo", u));
      if (u <= 0) P.s = 0;
      return P;
    }
    case "orbit-ring": {
      const R = Math.max(0.5, p.w * 0.3);
      const theta = (p.cx / Math.max(p.w, 1e-3)) * TAU * 0.86;
      const spin = -TAU * 1.1 * (1 - ease("expoOut", clamp01(t / 2.4)));
      const a = theta + spin;
      const tilt = 0.2;
      const rz0 = R * Math.cos(a) - R;
      const ringX = R * Math.sin(a);
      const ringY = p.cy + rz0 * Math.sin(tilt) * -1;
      const k = ease("inOutQuint", clamp01((t - 1.7) / 1.3));
      P.x = lerp(ringX, p.cx, k) - p.cx;
      P.y = lerp(ringY, p.cy, k) - p.cy;
      P.z = lerp(rz0 * Math.cos(tilt), 0, k);
      P.ry = lerp(a, 0, k);
      P.rx = lerp(tilt * 0.5, 0, k);
      return P;
    }
    case "drop": {
      const h0 = 1.3 * p.h + 0.5;
      const b = bounceY(t - d, h0);
      P.y = b.y;
      P.s = t - d <= 0 ? 0 : 1;
      // squash on each impact, decaying (volume-preserving: sy·sz·sx ≈ 1)
      if (b.impact >= 0) {
        const sq = 0.28 * Math.exp(-b.impact * 14) * Math.cos(b.impact * 30) * Math.exp(-(t - d) * 1.5);
        P.sy = 1 - sq;
        P.rz = 0.05 * Math.sin((t - d) * 9 + p.rank) * Math.exp(-(t - d) * 2);
      }
      return P;
    }
    case "wave": {
      const enter = clamp01((t - d * 0.5) / 0.6);
      const ph = TAU * (t * 0.7 - p.rank * 0.11);
      P.y = 0.09 * p.h * Math.sin(ph) * enter - (1 - ease("outExpo", enter)) * 0.3 * p.h;
      P.rx = 0.22 * Math.cos(ph) * enter;
      P.s = enter <= 0 ? 0 : lerp(0.7, 1, ease("outExpo", enter));
      return P;
    }
    default:
      return null;
  }
};

/** Stack-echo copy e (1..K): offset behind the word and a 0..1 "fade" (0 = front color, 1 = deepest). */
export const echoOffset = (e: number, K: number, t: number, depth: number, h: number, gap = 1) => {
  const extend = ease("outExpo", clamp01((t - 0.25 - e * 0.05) / 1.4));
  const breathe = 1 + 0.18 * Math.sin(TAU * (t / 2.6) - e * 0.45) * clamp01((t - 1.2) / 0.8);
  const step = Math.max(depth * 0.8, 0.06 * h) * gap * extend * breathe;
  return { x: 0.55 * step * e, y: -0.6 * step * e, z: -step * e, fade: e / K, lag: 0.05 * e };
};
