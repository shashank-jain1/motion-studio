/**
 * Shape morphing, precomputed once per (from, to) pair and evaluated per frame as a cheap number lerp.
 *
 *  prepMorph(fromD, toD)            one path → one path (multi-subpath + holes aware)
 *  prepMultiMorph(fromDs, toDs)     part lists with explicit pairing (Hungarian on centroid / log-area),
 *                                   one→many separation, many→one combination, grow-from / collapse-to point.
 *
 * Engine: svg-path-commander `equalizePaths` (MIT) with these guards (see docs/research/02 §3.2):
 *   - a FULL config object on every call (the lib Object.assign()s into its module defaults);
 *   - containment pre-pass: outers/holes are re-wound by nesting depth, so evenodd logos with
 *     same-direction holes are classified correctly;
 *   - the source is pre-aligned onto the target bbox before equalizing (so subpaths overlap and pair
 *     instead of all falling back to placeholders), then mapped back with the inverse affine — exact,
 *     because affine maps keep cubic control points exact.
 * Fallback chain: equalizePaths → flubber.interpolate (first subpaths) → shrink/grow swap.
 * Everything is cached at module level by string keys; nothing heavy runs per frame.
 */
import { equalizePaths } from "svg-path-commander/util";
import * as FlubberNs from "flubber";
import {
  type Affine, type BBox, type GPath, applyAffine, areaCentroid, fitAffine, invertAffine, mapPath, orientPath, parsePath, pathBBox,
  rotateAffine, splitSubpaths, toD, transformD,
} from "./geom";

export type MorphFn = ((t: number) => string) & { kind: "equalize" | "lerp" | "flubber" | "swap" };

// flubber ships UMD for Node and ESM for bundlers: accept both shapes of the namespace.
const flubber = ((FlubberNs as unknown as { default?: typeof FlubberNs }).default ?? FlubberNs) as typeof FlubberNs;

const eqConfig = () => ({ mode: "auto", sampleSize: 10, roundValues: 4, close: false, reverse: true, target: undefined });

const morphCache = new Map<string, MorphFn>();
const remember = <T>(cache: Map<string, T>, key: string, v: T) => {
  if (cache.size > 600) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
  return v;
};

/** timing per subpath: 0 = normal, 1 = appears from a point (grows late), 2 = vanishes to a point (early) */
type Flat = { cmds: { c: string; n: number; sub: boolean; timing: 0 | 1 | 2 }[]; a: Float64Array; b: Float64Array };

const subT = (timing: 0 | 1 | 2, t: number) =>
  timing === 1 ? (t <= 0.35 ? 0 : t >= 1 ? t : 1 - Math.pow(1 - (t - 0.35) / 0.65, 2)) : timing === 2 ? (t >= 0.65 ? 1 : 1 - Math.pow(1 - t / 0.65, 2)) : t;

const buildString = (f: Flat, t: number) => {
  const { cmds, a, b } = f;
  let k = 0, d = "", tt = t;
  for (let i = 0; i < cmds.length; i++) {
    const { c, n, timing } = cmds[i];
    if (c === "M") {
      if (i > 0) d += "Z";
      tt = subT(timing, t);
    }
    d += c;
    for (let j = 0; j < n; j++, k++) {
      const v = a[k] + (b[k] - a[k]) * tt;
      d += (j ? " " : "") + (Math.round(v * 100) / 100);
    }
  }
  return d + "Z";
};

/** Mark subpath blocks whose start or end is (nearly) a point: equalizePaths' placeholder pairs. */
const markTimings = (f: Flat) => {
  const { cmds, a, b } = f;
  const span = (arr: Float64Array, from: number, to: number) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = from; k < to; k += 2) {
      x0 = Math.min(x0, arr[k]); x1 = Math.max(x1, arr[k]);
      y0 = Math.min(y0, arr[k + 1]); y1 = Math.max(y1, arr[k + 1]);
    }
    return Math.max(x1 - x0, y1 - y0);
  };
  const total = Math.max(span(a, 0, a.length), span(b, 0, b.length), 1e-6);
  let k = 0;
  for (let i = 0; i < cmds.length; ) {
    let j = i + 1, len = cmds[i].n;
    while (j < cmds.length && cmds[j].c !== "M") len += cmds[j++].n;
    const sa = span(a, k, k + len), sb = span(b, k, k + len);
    const timing: 0 | 1 | 2 = sa < total * 0.004 && sb >= total * 0.004 ? 1 : sb < total * 0.004 && sa >= total * 0.004 ? 2 : 0;
    cmds[i].timing = timing;
    k += len;
    i = j;
  }
  return f;
};

const makeFn = (fn: (t: number) => string, kind: MorphFn["kind"]): MorphFn => Object.assign(fn, { kind });

/** Pre-alignment affine: source bbox → target bbox (stretch, but never wildly anisotropic). */
const alignAffine = (from: BBox, to: BBox): Affine => {
  const degenerate = from.w < 1e-6 || from.h < 1e-6 || to.w < 1e-6 || to.h < 1e-6;
  if (degenerate) return fitAffine(from, to, true);
  const sx = to.w / from.w, sy = to.h / from.h;
  const r = sx / sy;
  if (r > 3 || r < 1 / 3) {
    const g = Math.sqrt(sx * sy);
    const kx = g * Math.min(3, Math.max(1 / 3, Math.sqrt(r))), ky = (g * g) / kx;
    const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2, tcx = to.x + to.w / 2, tcy = to.y + to.h / 2;
    return [kx, 0, 0, ky, tcx - fcx * kx, tcy - fcy * ky];
  }
  return fitAffine(from, to, false);
};

const equalized = (A: GPath, B: GPath): Flat => {
  const m = alignAffine(pathBBox(A), pathBBox(B));
  const inv = applyAffine(invertAffine(m));
  const [ea, eb] = equalizePaths(toD(mapPath(A, applyAffine(m)), 3), toD(B, 3), eqConfig()) as unknown as (string | number)[][][];
  if (!ea || !eb || ea.length !== eb.length || ea.length < 2) throw new Error("equalize: length mismatch");
  const cmds: Flat["cmds"] = [];
  const av: number[] = [], bv: number[] = [];
  for (let i = 0; i < ea.length; i++) {
    const sa = ea[i], sb = eb[i];
    const c = String(sa[0]).toUpperCase();
    if (c !== String(sb[0]).toUpperCase() || sa.length !== sb.length) throw new Error("equalize: structure mismatch");
    if (c === "Z") continue;
    const nums = sa.slice(1) as number[];
    if (nums.length % 2 !== 0) throw new Error("equalize: odd args");
    for (let j = 0; j < nums.length; j += 2) {
      const p = inv(nums[j], nums[j + 1]);
      av.push(p[0], p[1]);
    }
    for (const v of sb.slice(1) as number[]) bv.push(v);
    cmds.push({ c, n: nums.length, sub: c === "M", timing: 0 });
  }
  if (av.some((v) => !Number.isFinite(v)) || bv.some((v) => !Number.isFinite(v))) throw new Error("equalize: NaN");
  return markTimings({ cmds, a: Float64Array.from(av), b: Float64Array.from(bv) });
};

/** Same-structure lerp (no equalization) for paths built from each other (grow/collapse dummies). */
const sameStructure = (A: GPath, B: GPath): Flat | null => {
  if (A.length !== B.length || A.some((s, i) => s.curves.length !== B[i].curves.length)) return null;
  const cmds: Flat["cmds"] = [], av: number[] = [], bv: number[] = [];
  A.forEach((s, i) => {
    cmds.push({ c: "M", n: 2, sub: true, timing: 0 });
    av.push(...s.start);
    bv.push(...B[i].start);
    s.curves.forEach((c, j) => {
      cmds.push({ c: "C", n: 6, sub: false, timing: 0 });
      av.push(...c);
      bv.push(...B[i].curves[j]);
    });
  });
  return { cmds, a: Float64Array.from(av), b: Float64Array.from(bv) };
};

const swapFallback = (fromD: string, toD: string): MorphFn => {
  const fa = areaCentroid(parsePath(fromD)), tb = areaCentroid(parsePath(toD));
  return makeFn((t) => {
    if (t <= 0) return fromD;
    if (t >= 1) return toD;
    const u = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2;
    const k = Math.max(0.001, u * u * (3 - 2 * u));
    const c = t < 0.5 ? fa : tb;
    return transformD(t < 0.5 ? fromD : toD, [k, 0, 0, k, c.cx * (1 - k), c.cy * (1 - k)]);
  }, "swap");
};

/**
 * One path → one path. Returns a pure (t)=>d. t=0 / t=1 return the exact input strings;
 * values outside [0,1] extrapolate (used for overshoot).
 */
export const prepMorph = (fromD: string, toD: string, direct = false): MorphFn => {
  const key = (direct ? "direct:" : "") + fromD + "→" + toD;
  const hit = morphCache.get(key);
  if (hit) return hit;
  let fn: MorphFn;
  try {
    const A = orientPath(parsePath(fromD)), B = orientPath(parsePath(toD));
    if (!A.length || !B.length) throw new Error("empty path");
    const flat = (direct ? sameStructure(A, B) : null) ?? equalized(A, B);
    fn = makeFn((t) => (t === 0 ? fromD : t === 1 ? toD : buildString(flat, t)), "equalize");
  } catch {
    try {
      const a = splitSubpaths(fromD)[0], b = splitSubpaths(toD)[0];
      const bb = pathBBox(parsePath(toD));
      const seg = Math.max(1, Math.hypot(bb.w, bb.h) / 120);
      const f = flubber.interpolate(a, b, { maxSegmentLength: seg, string: true });
      fn = makeFn((t) => (t <= 0 ? fromD : t >= 1 ? toD : f(Math.min(1, Math.max(0, t)))), "flubber");
    } catch {
      fn = swapFallback(fromD, toD);
    }
  }
  return remember(morphCache, key, fn);
};

/** Rotate path data around a point (degrees). */
export const rotateD = (d: string, deg: number, cx: number, cy: number) => (deg ? transformD(d, rotateAffine(deg, cx, cy)) : d);

/** Path collapsed to (almost) a point at (x,y): same structure as `d`, so it lerps cleanly. */
export const pointLike = (d: string, x: number, y: number, k = 0.002) => {
  const c = areaCentroid(parsePath(d));
  return transformD(d, [k, 0, 0, k, x - c.cx * k, y - c.cy * k], 3);
};

// ---------------------------------------------------------------------------------------------
// many ↔ many

export type MorphPair = { from: number; to: number; fn: MorphFn };
export type MultiMorph = { pairs: MorphPair[]; mode: "single" | "separate" | "duplicate" | "combine" | "assign" };

const multiCache = new Map<string, MultiMorph>();

type Feat = { cx: number; cy: number; area: number };
const feats = (ds: string[]): { f: Feat[]; box: BBox } => {
  const paths = ds.map((d) => parsePath(d));
  const f = paths.map((p) => {
    const a = areaCentroid(p);
    return { cx: a.cx, cy: a.cy, area: Math.max(1e-6, Math.abs(a.area)) };
  });
  return { f, box: pathBBox(paths.flat()) };
};

/** Min-cost assignment (Hungarian / Kuhn-Munkres with potentials), square matrix. Returns col for each row. */
export const hungarian = (cost: number[][]): number[] => {
  const n = cost.length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
};

const hasHoles = (d: string) => parsePath(d).length > 1;

const separatePairs = (fromD: string, toDs: string[]): MorphPair[] => {
  const outer = splitSubpaths(fromD)[0];
  const bb = pathBBox(parsePath(fromD));
  const seg = Math.max(0.5, Math.hypot(bb.w, bb.h) / 160);
  const targets = toDs.map((d) => splitSubpaths(d)[0]);
  const interps = flubber.separate(outer, targets, { maxSegmentLength: seg, string: true }) as unknown as ((t: number) => string)[];
  if (!Array.isArray(interps) || interps.length !== toDs.length) throw new Error("separate failed");
  return toDs.map((d, j) => ({ from: 0, to: j, fn: prepMorph(interps[j](0), d) }));
};

/**
 * Part lists → paired morphs. `mode`:
 *  - "auto": 1→1 single, 1→N separate (duplicate when the source has holes), N→1 combine, N→M assignment
 *  - "separate" / "duplicate": force the one→many strategy
 */
export const prepMultiMorph = (fromDs: string[], toDs: string[], mode: "auto" | "separate" | "duplicate" = "auto"): MultiMorph => {
  const key = JSON.stringify([fromDs, toDs, mode]);
  const hit = multiCache.get(key);
  if (hit) return hit;
  let res: MultiMorph;
  const n = fromDs.length, m = toDs.length;
  if (n === 0 || m === 0) {
    res = { pairs: [], mode: "assign" };
  } else if (n === 1 && m === 1) {
    res = { pairs: [{ from: 0, to: 0, fn: prepMorph(fromDs[0], toDs[0]) }], mode: "single" };
  } else if (n === 1) {
    const wantSep = mode === "separate" || (mode === "auto" && !hasHoles(fromDs[0]));
    let pairs: MorphPair[] | null = null;
    if (wantSep) {
      try {
        pairs = separatePairs(fromDs[0], toDs);
      } catch {
        pairs = null;
      }
    }
    res = pairs
      ? { pairs, mode: "separate" }
      : { pairs: toDs.map((d, j) => ({ from: 0, to: j, fn: prepMorph(fromDs[0], d) })), mode: "duplicate" };
  } else if (m === 1) {
    const rev = prepMultiMorph(toDs, fromDs, mode);
    res = {
      pairs: rev.pairs.map((p) => ({ from: p.to, to: p.from, fn: makeFn((t: number) => p.fn(1 - t), p.fn.kind) })),
      mode: "combine",
    };
  } else {
    const A = feats(fromDs), B = feats(toDs);
    const diagA = Math.hypot(A.box.w, A.box.h) || 1, diagB = Math.hypot(B.box.w, B.box.h) || 1;
    const totA = A.f.reduce((s, f) => s + f.area, 0), totB = B.f.reduce((s, f) => s + f.area, 0);
    const N = Math.max(n, m);
    const DUMMY = 0.9;
    const cost: number[][] = [];
    for (let i = 0; i < N; i++) {
      const row: number[] = [];
      for (let j = 0; j < N; j++) {
        if (i >= n || j >= m) {
          row.push(DUMMY);
          continue;
        }
        const a = A.f[i], b = B.f[j];
        const dx = (a.cx - A.box.x) / diagA - (b.cx - B.box.x) / diagB;
        const dy = (a.cy - A.box.y) / diagA - (b.cy - B.box.y) / diagB;
        const la = Math.log(a.area / totA), lb = Math.log(b.area / totB);
        row.push(Math.hypot(dx, dy) + 0.3 * Math.abs(la - lb));
      }
      cost.push(row);
    }
    const assign = hungarian(cost);
    const pairs: MorphPair[] = [];
    const usedTo = new Set<number>();
    // map a from-space point into to-space (for grow/collapse anchors)
    const toSpace = fitAffine(A.box, B.box, true), fromSpace = invertAffine(toSpace);
    const nearest = (x: number, y: number, list: Feat[]) => {
      let best = 0, bd = Infinity;
      list.forEach((f, k) => {
        const d = Math.hypot(f.cx - x, f.cy - y);
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      return list[best];
    };
    for (let i = 0; i < n; i++) {
      const j = assign[i];
      if (j >= 0 && j < m) {
        usedTo.add(j);
        pairs.push({ from: i, to: j, fn: prepMorph(fromDs[i], toDs[j]) });
      } else {
        const [px, py] = applyAffine(toSpace)(A.f[i].cx, A.f[i].cy);
        const anchor = nearest(px, py, B.f);
        pairs.push({ from: i, to: -1, fn: prepMorph(fromDs[i], pointLike(fromDs[i], anchor.cx, anchor.cy), true) });
      }
    }
    for (let j = 0; j < m; j++) {
      if (usedTo.has(j)) continue;
      const [px, py] = applyAffine(fromSpace)(B.f[j].cx, B.f[j].cy);
      const anchor = nearest(px, py, A.f);
      pairs.push({ from: -1, to: j, fn: prepMorph(pointLike(toDs[j], anchor.cx, anchor.cy), toDs[j], true) });
    }
    res = { pairs, mode: "assign" };
  }
  return remember(multiCache, key, res);
};
