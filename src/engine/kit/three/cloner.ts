/**
 * MoGraph-style cloner + fields (C4D grammar: clone layout × field sweep × per-clone spring).
 *
 * Layout (built once, cached): grid | grid3d | honeycomb (optionally masked by the logo silhouette, or a full
 * rectangle around it with inside/outside colors) | radial | linear | surface (even points inside the logo) |
 * outline | volume (surface × depth). Every clone gets rest position, part (logo color), normalized coords,
 * rank and a seeded hash.
 *
 * Fields (evaluated per clone per frame on the CPU into ONE InstancedMesh; ~1–3 ms for 10k clones):
 *   linear | spherical | radial | time | step | random | noise | wave | beat | mask, each with
 *   start/end (time window), ease, width, invert, strength, pulse, and `spring` (seconds of delay-effector
 *   follow-through: each clone springs to the field's value from the moment the field reaches it).
 * Effects: x/y/z, rotateX/Y/Z (deg), scale/scaleX/Y/Z — a number (applied × weight) or [from, to] (lerped by
 * weight; scale ranges are absolute factors) — and color: "reveal" (switch A→B at 0.5: tile flips), "blend"
 * (A→B lerp) or any CSS color (lerp toward it).
 *
 * Presets expand to layout + fields (+ a preset-specific motion for split-flap / cube-shuffle / burst-collapse).
 */
import * as THREE from "three";
import { clamp01, ease } from "../../core/animate";
import type { EaseName } from "../../core/animate";
import type { Model3D } from "./geometry";
import { spring } from "./motion";
import { cellCenter, isEdge, mulberry32, rasterize, samplePoints, silhouette } from "./sampler";

export const CLONER_PRESETS = ["sweep", "ripple", "tile-flip", "split-flap", "cube-shuffle", "burst-collapse", "wave-field", "logo-of-logos"] as const;
export type ClonerPreset = (typeof CLONER_PRESETS)[number];
export const CLONER_LAYOUTS = ["grid", "grid3d", "honeycomb", "radial", "linear", "surface", "outline", "volume"] as const;
export type ClonerLayout = (typeof CLONER_LAYOUTS)[number];
export const CLONE_SHAPES = ["box", "rounded-box", "sphere", "cylinder", "tile", "logo"] as const;
export type CloneShape = (typeof CLONE_SHAPES)[number];
export const FIELD_KINDS = ["linear", "spherical", "radial", "time", "step", "random", "noise", "wave", "beat", "mask"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

type Num = number | [number, number];
export type FieldEffect = {
  x?: Num; y?: Num; z?: Num;
  rotateX?: Num; rotateY?: Num; rotateZ?: Num;
  scale?: Num; scaleX?: Num; scaleY?: Num; scaleZ?: Num;
  color?: string;
};
export type FieldSpec = {
  kind: FieldKind;
  axis?: "x" | "-x" | "y" | "-y" | "z" | "-z" | number;
  start?: number; end?: number; ease?: EaseName;
  width?: number;
  center?: [number, number, number];
  radius?: [number, number];
  speed?: number; scale?: number; freq?: number; seed?: number;
  beats?: number[]; decay?: number; spread?: number;
  stagger?: number;
  strength?: number; invert?: boolean; pulse?: boolean;
  spring?: number;
  effect: FieldEffect;
};
export type ClonerSpec = {
  preset?: ClonerPreset;
  layout?: ClonerLayout;
  mask?: "logo" | "none";
  density?: number;
  count?: number;
  cols?: number; rows?: number; layers?: number;
  radius?: number; rings?: number;
  pad?: number;
  shape?: CloneShape;
  size?: number;
  depth?: number;
  seed?: number;
  colors?: { inside?: string; outside?: string; base?: string; palette?: string[] };
  /** wall (default): clones face the camera in the XY plane · floor: the layout lies on the ground (z = height) */
  plane?: "wall" | "floor";
};

export type ClonerPlan = { cloner: ClonerSpec; fields: FieldSpec[]; special?: "split-flap" | "cube-shuffle" | "burst-collapse"; material?: string };

/** Preset → full plan; explicit layer.cloner / layer.fields override the preset's. */
export const expandPreset = (c: ClonerSpec | undefined, fields: FieldSpec[] | undefined): ClonerPlan => {
  const preset = c?.preset ?? (fields?.length || c?.layout ? undefined : "sweep");
  let base: ClonerPlan;
  switch (preset) {
    case "sweep":
      base = {
        cloner: { layout: "grid", mask: "logo", shape: "rounded-box", density: 30, size: 0.92, depth: 0.9 },
        fields: [{ kind: "linear", axis: "x", start: 0.1, end: 1.9, width: 0.3, ease: "linear", spring: 0.9, effect: { scale: [0, 1], rotateY: [-120, 0], z: [-0.7, 0] } }],
      };
      break;
    case "ripple":
      base = {
        cloner: { layout: "grid", mask: "none", pad: 5, shape: "rounded-box", density: 20, size: 0.9, depth: 0.7 },
        fields: [
          { kind: "spherical", start: 0, end: 1.2, ease: "linear", width: 0.3, spring: 0.7, effect: { scale: [0, 1], z: [-0.4, 0] } },
          { kind: "wave", freq: 3.4, speed: 0.6, start: 0.2, effect: { z: [-0.07, 0.07], rotateX: [-8, 8] } },
          { kind: "mask", start: 1.3, end: 2.3, ease: "inOut", spring: 0.7, effect: { z: 0.14, color: "reveal" } },
        ],
      };
      break;
    case "tile-flip":
      base = {
        cloner: { layout: "grid", mask: "none", pad: 2, shape: "tile", density: 14, size: 0.93, depth: 0.16 },
        fields: [
          { kind: "linear", axis: 20, start: 0.3, end: 2.2, width: 0.2, ease: "linear", spring: 0.8, effect: { rotateY: [0, 180], color: "reveal" } },
          { kind: "linear", axis: 20, start: 0.3, end: 2.2, width: 0.2, ease: "linear", spring: 0.8, pulse: true, effect: { z: 0.3 } },
        ],
      };
      break;
    case "split-flap":
      base = { cloner: { layout: "grid", mask: "none", pad: 2, shape: "tile", density: 16, size: 0.92, depth: 0.12, colors: { base: "#1b1d22" } }, fields: [], special: "split-flap" };
      break;
    case "cube-shuffle":
      base = { cloner: { layout: "grid", mask: "logo", shape: "rounded-box", density: 14, size: 0.94, depth: 1 }, fields: [], special: "cube-shuffle" };
      break;
    case "burst-collapse":
      base = { cloner: { layout: "surface", shape: "sphere", count: 2600, size: 1.05 }, fields: [], special: "burst-collapse" };
      break;
    case "wave-field":
      base = {
        cloner: { layout: "grid", mask: "none", pad: 6, shape: "box", density: 16, size: 0.86, depth: 0.5, plane: "floor" },
        fields: [
          { kind: "spherical", start: 0, end: 1.1, ease: "linear", width: 0.35, spring: 0.7, effect: { scale: [0, 1] } },
          { kind: "wave", freq: 2.2, speed: 0.5, effect: { scaleZ: [0.6, 4.5] } },
          { kind: "mask", start: 1.3, end: 2.4, ease: "inOut", spring: 0.9, effect: { scaleZ: [1, 2.6], z: 0.08, color: "reveal" } },
        ],
      };
      break;
    case "logo-of-logos":
      base = {
        cloner: { layout: "grid", mask: "logo", shape: "logo", density: 16, size: 0.82, depth: 1 },
        fields: [{ kind: "noise", scale: 2.5, speed: 0.25, effect: { rotateY: [-14, 14], rotateX: [-8, 8] } }],
      };
      break;
    default:
      base = { cloner: { layout: "grid", mask: "logo", shape: "rounded-box", density: 28 }, fields: [] };
  }
  return {
    ...base,
    cloner: { ...base.cloner, ...(c ?? {}), colors: { ...(base.cloner.colors ?? {}), ...(c?.colors ?? {}) } },
    fields: fields?.length ? fields : base.fields,
  };
};

// ---------------------------------------------------------------------------------------------
// layout

export type Clones = {
  count: number;
  /** rest positions (model units) */
  pos: Float32Array;
  /** logo part index, -1 = outside the silhouette */
  part: Int16Array;
  /** normalized coords in layout bounds [0,1]^3 */
  nrm: Float32Array;
  /** grid column / row (for split-flap / shuffle), -1 if n/a */
  col: Int32Array;
  row: Int32Array;
  hash: Float32Array;
  /** clone cell size (model units) */
  cell: number;
  bounds: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
  cols: number;
  rows: number;
};

const layoutCache = new WeakMap<Model3D, Map<string, Clones>>();
export const MAX_CLONES = 40000;

export const buildClones = (model: Model3D, c: ClonerSpec): Clones => {
  let m = layoutCache.get(model);
  if (!m) { m = new Map(); layoutCache.set(model, m); }
  const key = JSON.stringify([c.layout, c.mask, c.density, c.count, c.cols, c.rows, c.layers, c.radius, c.rings, c.pad, c.seed, c.depth, c.shape]);
  const hit = m.get(key);
  if (hit) return hit;
  const sil = silhouette(model);
  const seed = c.seed ?? 7;
  const rnd = mulberry32(seed);
  const P: number[] = [], part: number[] = [], cols: number[] = [], rows: number[] = [];
  const H = Math.max(1e-3, sil.y1 - sil.y0), W = Math.max(1e-3, sil.x1 - sil.x0);
  const layout = c.layout ?? "grid";
  let cell = H / Math.max(2, c.density ?? 28);
  let gc = 0, gr = 0;
  const masked = (c.mask ?? "logo") === "logo";
  if (layout === "grid" || layout === "grid3d" || layout === "honeycomb") {
    if (c.cols && c.rows && !masked) cell = Math.max(W / c.cols, H / c.rows);
    // keep the instance count sane
    const est = (W / cell + 2 * (c.pad ?? 0)) * (H / cell + 2 * (c.pad ?? 0)) * (layout === "grid3d" ? c.layers ?? 3 : 1);
    if (est > MAX_CLONES) cell *= Math.sqrt(est / MAX_CLONES);
    const mask = rasterize(sil, cell, masked ? 0 : c.pad ?? 0);
    gc = mask.cols; gr = mask.rows;
    const layers = layout === "grid3d" ? Math.max(1, c.layers ?? 3) : 1;
    for (let r = 0; r < mask.rows; r++) {
      for (let q = 0; q < mask.cols; q++) {
        let [x, y] = cellCenter(mask, q, r);
        let p = mask.part[r * mask.cols + q];
        if (layout === "honeycomb") {
          x += r % 2 ? mask.cell / 2 : 0;
          y = mask.y0 + (r + 0.5) * mask.cell * 0.866 + (mask.rows * mask.cell * 0.134) / 2;
          // re-test the shifted center
          const qc = Math.floor((x - mask.x0) / mask.cell), rc = Math.floor((y - mask.y0) / mask.cell);
          p = qc >= 0 && rc >= 0 && qc < mask.cols && rc < mask.rows ? mask.part[rc * mask.cols + qc] : -1;
        }
        if (masked && p < 0) continue;
        for (let l = 0; l < layers; l++) {
          const z = layers > 1 ? (l - (layers - 1) / 2) * cell : 0;
          P.push(x, y, z); part.push(p); cols.push(q); rows.push(r);
        }
      }
    }
  } else if (layout === "surface" || layout === "outline" || layout === "volume") {
    const n = Math.min(MAX_CLONES, c.count ?? 2000);
    const s = samplePoints(sil, n, seed, layout === "outline");
    cell = Math.sqrt(Math.max(sil.area, 1e-4) / Math.max(1, s.count));
    if (layout === "outline") cell = Math.max(cell, H / 60);
    const dz = (c.depth ?? 1) * 0.18;
    for (let i = 0; i < s.count; i++) {
      P.push(s.x[i], s.y[i], layout === "volume" ? (rnd() - 0.5) * dz : 0);
      part.push(s.part[i]); cols.push(-1); rows.push(-1);
    }
  } else if (layout === "radial") {
    const rings = Math.max(1, c.rings ?? 1);
    const R = c.radius ?? Math.max(W, H) * 0.6;
    const n = Math.min(MAX_CLONES, c.count ?? 24);
    for (let k = 0; k < rings; k++) {
      const rr = R * (rings > 1 ? 0.45 + (0.55 * k) / (rings - 1) : 1);
      const nk = Math.max(3, Math.round((n * rr) / R));
      for (let i = 0; i < nk; i++) {
        const a = (i / nk) * Math.PI * 2;
        P.push(Math.sin(a) * rr, Math.cos(a) * rr, 0); part.push(-1); cols.push(i); rows.push(k);
      }
    }
    cell = (2 * Math.PI * R) / Math.max(3, n) * 0.7;
  } else {
    // linear
    const n = Math.min(MAX_CLONES, c.count ?? 12);
    const span = c.radius ?? W;
    for (let i = 0; i < n; i++) {
      P.push(n > 1 ? -span / 2 + (span * i) / (n - 1) : 0, 0, 0); part.push(-1); cols.push(i); rows.push(0);
    }
    cell = n > 1 ? span / (n - 1) : span;
  }
  const count = part.length;
  const pos = new Float32Array(P);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < count; i++) {
    x0 = Math.min(x0, pos[i * 3]); x1 = Math.max(x1, pos[i * 3]);
    y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]);
    z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]);
  }
  if (!count) { x0 = y0 = z0 = -0.5; x1 = y1 = z1 = 0.5; }
  const nrm = new Float32Array(count * 3);
  const hash = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    nrm[i * 3] = (pos[i * 3] - x0) / Math.max(1e-6, x1 - x0);
    nrm[i * 3 + 1] = (pos[i * 3 + 1] - y0) / Math.max(1e-6, y1 - y0);
    nrm[i * 3 + 2] = (pos[i * 3 + 2] - z0) / Math.max(1e-6, z1 - z0);
    hash[i] = rnd();
  }
  const out: Clones = {
    count, pos, part: new Int16Array(part), nrm, col: new Int32Array(cols), row: new Int32Array(rows), hash, cell,
    bounds: { x0: x0 - cell / 2, y0: y0 - cell / 2, z0: z0 - cell / 2, x1: x1 + cell / 2, y1: y1 + cell / 2, z1: z1 + cell / 2 },
    cols: gc, rows: gr,
  };
  if (m.size > 8) m.clear();
  m.set(key, out);
  return out;
};

/** The silhouette edge flag per clone (grid layouts) — exposed for outline-ish effects/tests. */
export const edgeClones = (model: Model3D, cl: Clones) => {
  const mask = rasterize(silhouette(model), cl.cell, 0);
  return Array.from({ length: cl.count }, (_, i) => (cl.col[i] >= 0 && cl.row[i] >= 0 ? isEdge(mask, cl.col[i], cl.row[i]) : false));
};

// ---------------------------------------------------------------------------------------------
// noise (CPU, seeded, smooth)

const ih = (x: number, y: number, z: number, s: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** 3D value noise in [0, 1] */
export const noise3 = (x: number, y: number, z: number, seed = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a: number, b: number, k: number) => a + (b - a) * k;
  const c = (dx: number, dy: number, dz: number) => ih(xi + dx, yi + dy, zi + dz, seed);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
};

// ---------------------------------------------------------------------------------------------
// fields

const smooth01 = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const MONOTONIC = new Set<FieldKind>(["linear", "spherical", "radial", "time", "mask"]);

export type FieldCtx = { clones: Clones; extent: number; center: [number, number, number] };

const axisCoord = (f: FieldSpec, cl: Clones, i: number) => {
  const a = f.axis ?? "x";
  if (typeof a === "number") {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const nx = cl.nrm[i * 3] - 0.5, ny = cl.nrm[i * 3 + 1] - 0.5;
    return 0.5 + (nx * c + ny * s) / (Math.abs(c) + Math.abs(s));
  }
  const k = a.endsWith("x") ? 0 : a.endsWith("y") ? 1 : 2;
  const v = cl.nrm[i * 3 + k];
  return a.startsWith("-") ? 1 - v : v;
};

/** Raw field weight (before spring/remap) for clone i at time t. */
export const fieldRaw = (f: FieldSpec, ctx: FieldCtx, i: number, t: number): number => {
  const cl = ctx.clones;
  const start = f.start ?? 0;
  const end = f.end ?? start + 2;
  const tp = ease(f.ease, clamp01((t - start) / Math.max(1e-6, end - start)), "inOut");
  const cx = f.center?.[0] ?? ctx.center[0], cy = f.center?.[1] ?? ctx.center[1], cz = f.center?.[2] ?? ctx.center[2];
  const dx = cl.pos[i * 3] - cx, dy = cl.pos[i * 3 + 1] - cy, dz = cl.pos[i * 3 + 2] - cz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  switch (f.kind) {
    case "linear": {
      const wdt = Math.max(1e-3, f.width ?? 0.25);
      const front = -wdt + (1 + 2 * wdt) * tp;
      return smooth01((front - axisCoord(f, cl, i)) / wdt);
    }
    case "spherical": {
      const wdt = Math.max(1e-3, (f.width ?? 0.25) * ctx.extent);
      const r0 = f.radius?.[0] ?? -wdt;
      const r1 = f.radius?.[1] ?? ctx.extent * 0.75 + wdt;
      const r = r0 + (r1 - r0) * tp;
      return smooth01((r - dist) / wdt);
    }
    case "radial": {
      const wdt = Math.max(1e-3, f.width ?? 0.15);
      let a = Math.atan2(dx, dy) / (Math.PI * 2);
      if (a < 0) a += 1;
      const front = -wdt + (1 + 2 * wdt) * tp;
      return smooth01((front - a) / wdt);
    }
    case "time": {
      const st = f.stagger ?? 0;
      const rank = cl.count > 1 ? i / (cl.count - 1) : 0;
      return ease(f.ease, clamp01((t - start - st * rank * cl.count) / Math.max(1e-6, end - start)), "inOut");
    }
    case "mask": {
      return cl.part[i] >= 0 ? tp : 0;
    }
    case "step":
      return cl.count > 1 ? i / (cl.count - 1) : 0;
    case "random": {
      if (!f.speed) return cl.hash[i];
      return noise3(i * 0.618, 0, t * f.speed, f.seed ?? 3);
    }
    case "noise": {
      const s = (f.scale ?? 2) / Math.max(1e-3, ctx.extent);
      return noise3(cl.pos[i * 3] * s * 4, cl.pos[i * 3 + 1] * s * 4, cl.pos[i * 3 + 2] * s * 4 + t * (f.speed ?? 0.5), f.seed ?? 1);
    }
    case "wave": {
      const env = clamp01((t - start) / 0.5) * (f.end !== undefined ? clamp01((end - t) / 0.5) : 1);
      const d = f.axis !== undefined ? axisCoord(f, cl, i) * ctx.extent : dist;
      return 0.5 + 0.5 * env * Math.sin(Math.PI * 2 * ((f.freq ?? 2) * (d / Math.max(1e-3, ctx.extent)) - (f.speed ?? 0.5) * t));
    }
    case "beat": {
      let w = 0;
      const decay = f.decay ?? 6;
      const sp = (f.spread ?? 0.4) * (dist / Math.max(1e-3, ctx.extent));
      for (const b of f.beats ?? []) {
        const u = t - b - sp;
        if (u >= 0) w += Math.exp(-decay * u) * (u < 0.04 ? u / 0.04 : 1);
      }
      return Math.min(1, w);
    }
  }
  return 0;
};

/** Per-clone arrival times (raw weight crosses 0.5) for spring follow-through on monotonic fields. */
export const arrivalTimes = (f: FieldSpec, ctx: FieldCtx): Float32Array | null => {
  if (!f.spring || !MONOTONIC.has(f.kind)) return null;
  const n = ctx.clones.count;
  const out = new Float32Array(n);
  const start = f.start ?? 0, end = f.end ?? start + 2;
  for (let i = 0; i < n; i++) {
    if (f.kind === "mask" && ctx.clones.part[i] < 0) { out[i] = Infinity; continue; }
    let lo = start - 0.001, hi = end + 0.001;
    if (fieldRaw(f, ctx, i, hi) < 0.5) { out[i] = Infinity; continue; }
    if (fieldRaw(f, ctx, i, lo) >= 0.5) { out[i] = lo; continue; }
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (fieldRaw(f, ctx, i, mid) >= 0.5) hi = mid; else lo = mid;
    }
    out[i] = hi;
  }
  return out;
};

export const fieldWeight = (f: FieldSpec, ctx: FieldCtx, i: number, t: number, arrival: Float32Array | null): number => {
  let w: number;
  if (arrival) {
    const ta = arrival[i];
    const S = Math.max(0.05, f.spring!);
    w = ta === Infinity ? 0 : spring(clamp01((t - ta + S * 0.12) / S), 4.6, 1.0);
  } else w = fieldRaw(f, ctx, i, t);
  if (f.pulse) w = Math.sin(Math.PI * clamp01(w));
  if (f.invert) w = 1 - w;
  return w * (f.strength ?? 1);
};

// ---------------------------------------------------------------------------------------------
// evaluation

export type CloneState = {
  x: number; y: number; z: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number;
  /** 0 = color A (base), 1 = color B (final); extra tint toward `tint` by tintK */
  colorK: number; tint: THREE.Color | null; tintK: number;
};

const D2R = Math.PI / 180;
const add = (v: Num | undefined, w: number) => (v === undefined ? 0 : Array.isArray(v) ? v[0] + (v[1] - v[0]) * w : v * w);
const mul = (v: Num | undefined, w: number) => (v === undefined ? 1 : Array.isArray(v) ? v[0] + (v[1] - v[0]) * w : 1 + (v - 1) * w);

export const applyFields = (
  st: CloneState, fields: FieldSpec[], ctx: FieldCtx, i: number, t: number, arrivals: (Float32Array | null)[], tints: (THREE.Color | null)[],
) => {
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k];
    const w = fieldWeight(f, ctx, i, t, arrivals[k]);
    const e = f.effect;
    st.x += add(e.x, w); st.y += add(e.y, w); st.z += add(e.z, w);
    st.rx += add(e.rotateX, w) * D2R; st.ry += add(e.rotateY, w) * D2R; st.rz += add(e.rotateZ, w) * D2R;
    const s = mul(e.scale, w);
    st.sx *= s * mul(e.scaleX, w); st.sy *= s * mul(e.scaleY, w); st.sz *= s * mul(e.scaleZ, w);
    if (e.color === "reveal") st.colorK = w >= 0.5 ? 1 : 0;
    else if (e.color === "blend") st.colorK = clamp01(w);
    else if (e.color && tints[k]) { st.tint = tints[k]; st.tintK = clamp01(w); }
  }
};

/** Fields that drive color A→B: clones start on color A only if one exists. */
export const usesReveal = (fields: FieldSpec[]) => fields.some((f) => f.effect.color === "reveal" || f.effect.color === "blend");

// --- preset-specific motions ------------------------------------------------------------------------------

/** Split-flap: columns cascade; each tile flips n half-turns (seeded 2..5) and lands on its target color. */
export const splitFlap = (st: CloneState, cl: Clones, i: number, t: number, paletteN: number) => {
  const col = cl.col[i] >= 0 ? cl.col[i] / Math.max(1, cl.cols - 1) : cl.nrm[i * 3];
  const row = cl.row[i] >= 0 ? cl.row[i] / Math.max(1, cl.rows - 1) : cl.nrm[i * 3 + 1];
  const flips = 2 + Math.floor(cl.hash[i] * 4);
  const t0 = 0.25 + col * 1.5 + (1 - row) * 0.25 + cl.hash[i] * 0.08;
  const per = 0.16;
  const u = (t - t0) / (flips * per);
  if (u <= 0) { st.colorK = 0; return -1; }
  const e = u >= 1 ? 1 : spring(clamp01(u), 3.2, 0.6);
  const ang = e * flips * Math.PI;
  st.rx -= ang;
  // which face shows: count half turns passed (color changes every half-turn: palette cycling, then the target)
  const half = Math.floor((ang + Math.PI / 2) / Math.PI);
  if (half >= flips) { st.colorK = 1; return -1; }
  st.colorK = 0;
  return paletteN > 0 ? (half + Math.floor(cl.hash[i] * 97)) % paletteN : -1;
};

/** Cube shuffle: every cube starts at a scrambled cell and walks home in three axis-aligned legs (z → x → y). */
export const cubeShuffle = (st: CloneState, cl: Clones, i: number, t: number) => {
  const h = cl.hash[i];
  const h2 = (h * 7.31) % 1, h3 = (h * 13.7) % 1;
  const c = cl.cell;
  // scrambled but local (the mark is "almost there" and visibly sorts itself): ±6 cells x, ±4 y, 2..7 toward camera
  const sx = Math.round((h2 - 0.5) * 12) * c, sy = Math.round((h3 - 0.5) * 8) * c;
  const sz = (2 + Math.floor(h * 6)) * c;
  const beat = 0.3;
  const q = (v: number) => Math.round(v / (beat / 2)) * (beat / 2); // legs start on half-beats
  const legs = [q(0.25 + h * 0.6), q(0.95 + h2 * 0.5), q(1.55 + h3 * 0.5)];
  const dur = 0.36;
  const k = (j: number) => spring(clamp01((t - legs[j]) / dur), 5.5, 0.8);
  st.z += sz * (1 - k(0));
  st.x += sx * (1 - k(1));
  st.y += sy * (1 - k(2));
  st.rx += (1 - k(0)) * Math.PI * 0.5 * (h > 0.5 ? 1 : -1);
  st.ry += (1 - k(1)) * Math.PI * 0.5;
};

/** Burst → collapse: everything erupts from the center, hangs, then implodes onto the logo and locks. */
export const burstCollapse = (st: CloneState, cl: Clones, i: number, t: number, extent: number) => {
  const h = cl.hash[i];
  const a = h * Math.PI * 2 * 13.0, b = Math.acos(2 * ((h * 91.7) % 1) - 1);
  const dir = [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a) * 0.7, Math.cos(b) * 0.8];
  const R = extent * (0.18 + 0.5 * Math.pow((h * 37.1) % 1, 1.5));
  const burst = 1 - Math.pow(1 - clamp01(t / 1.1), 3);
  const drift = Math.max(0, t - 0.8) * 0.05 * extent;
  const delay = 1.0 + 0.45 * ((h * 5.3) % 1);
  const k = spring(clamp01((t - delay) / 0.8), 5, 0.9);
  const hx = cl.pos[i * 3], hy = cl.pos[i * 3 + 1], hz = cl.pos[i * 3 + 2];
  const bx = dir[0] * (R * burst + drift), by = dir[1] * (R * burst + drift), bz = dir[2] * R * burst;
  st.x += (bx - hx) * (1 - k);
  st.y += (by - hy) * (1 - k);
  st.z += (bz - hz) * (1 - k);
  st.rx += (1 - k) * (t * 3 + h * 10);
  st.ry += (1 - k) * (t * 2 + h * 7);
  const s = (0.6 + 0.4 * k) * clamp01(t / 0.08);
  st.sx *= s; st.sy *= s; st.sz *= s;
  st.colorK = k > 0.6 ? 1 : 0;
};
