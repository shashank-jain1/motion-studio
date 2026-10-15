/**
 * Tiny, dependency-light path geometry used by the shape library, the morph engine and the logo kit.
 *
 * Internal representation: a path is a list of closed subpaths, each a start point + cubic segments
 * ([c1x, c1y, c2x, c2y, x, y]). Everything is absolute and in one coordinate space.
 *
 * Winding convention (matches svg-path-commander's `classifyPaths`, whose polygonArea is -shoelace):
 *   outer contours: shoelace < 0 (counter-clockwise on screen), holes: shoelace > 0.
 * With that orientation, fill-rule nonzero and evenodd render identically.
 */
import { pathToCurve } from "svg-path-commander/util";

export type Pt = [number, number];
export type Cubic = [number, number, number, number, number, number];
/** `open`: the source subpath was not closed; its last curve is the synthetic closing chord. */
export type Sub = { start: Pt; curves: Cubic[]; open?: boolean };
export type GPath = Sub[];
export type BBox = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------------------------------------
// parse / serialize

const parseCache = new Map<string, GPath>();

/** Parse any SVG path data (arcs, relative, shorthand, lines…) into absolute closed cubic subpaths. */
export const parsePath = (d: string): GPath => {
  const hit = parseCache.get(d);
  if (hit) return clonePath(hit);
  const out: GPath = [];
  let cur: Sub | null = null;
  try {
    const arr = pathToCurve(d) as unknown as (string | number)[][];
    for (const seg of arr) {
      if (seg[0] === "M") {
        cur = { start: [seg[1] as number, seg[2] as number], curves: [] };
        out.push(cur);
      } else if (seg[0] === "C" && cur) {
        cur.curves.push(seg.slice(1, 7) as Cubic);
      }
    }
  } catch {
    // invalid path → empty
  }
  // drop degenerate subpaths and zero-length closing curves
  const clean = out
    .map((s) => ({ start: s.start, curves: s.curves.filter((c, i) => i < s.curves.length - 1 || !isZeroCurve(prevEnd(s, i), c)) }))
    .filter((s) => s.curves.length > 0);
  // ensure each subpath is closed (remember which ones were open in the source)
  for (const s of clean as Sub[]) {
    const end = s.curves[s.curves.length - 1];
    if (Math.hypot(end[4] - s.start[0], end[5] - s.start[1]) > 1e-6) {
      s.curves.push(lineCubic([end[4], end[5]], s.start));
      s.open = true;
    }
  }
  if (parseCache.size > 4000) parseCache.clear();
  parseCache.set(d, clean);
  return clonePath(clean);
};

const prevEnd = (s: Sub, i: number): Pt => (i === 0 ? s.start : [s.curves[i - 1][4], s.curves[i - 1][5]]);
const isZeroCurve = (p: Pt, c: Cubic) =>
  Math.hypot(c[4] - p[0], c[5] - p[1]) < 1e-6 && Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6 && Math.hypot(c[2] - p[0], c[3] - p[1]) < 1e-6;

export const lineCubic = (a: Pt, b: Pt): Cubic => [
  a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3,
  a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3,
  b[0], b[1],
];

export const clonePath = (p: GPath): GPath =>
  p.map((s) => ({ start: [s.start[0], s.start[1]], curves: s.curves.map((c) => c.slice() as Cubic), ...(s.open ? { open: true } : {}) }));

const fmt = (v: number, prec: number) => {
  const r = Number(v.toFixed(prec));
  return Object.is(r, -0) ? "0" : String(r);
};

/** keepOpen: emit source-open subpaths without their synthetic closing chord (for strokes). */
export const subToD = (s: Sub, prec = 2, keepOpen = false): string => {
  let d = `M${fmt(s.start[0], prec)} ${fmt(s.start[1], prec)}`;
  const open = keepOpen && s.open;
  const curves = open ? s.curves.slice(0, -1) : s.curves;
  for (const c of curves) d += `C${fmt(c[0], prec)} ${fmt(c[1], prec)} ${fmt(c[2], prec)} ${fmt(c[3], prec)} ${fmt(c[4], prec)} ${fmt(c[5], prec)}`;
  return open ? d : d + "Z";
};

export const toD = (p: GPath, prec = 2, keepOpen = false): string => p.map((s) => subToD(s, prec, keepOpen)).join("");

// ---------------------------------------------------------------------------------------------
// transforms

export const mapPath = (p: GPath, f: (x: number, y: number) => Pt): GPath =>
  p.map((s) => ({
    ...(s.open ? { open: true } : {}),
    start: f(s.start[0], s.start[1]),
    curves: s.curves.map((c) => {
      const a = f(c[0], c[1]), b = f(c[2], c[3]), e = f(c[4], c[5]);
      return [a[0], a[1], b[0], b[1], e[0], e[1]] as Cubic;
    }),
  }));

/** Affine transform: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Affine = [number, number, number, number, number, number];
export const applyAffine = (m: Affine) => (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const invertAffine = (m: Affine): Affine => {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1e-12;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
/** Affine-transform path data; open subpaths stay open. */
export const transformD = (d: string, m: Affine, prec = 2) => toD(mapPath(parsePath(d), applyAffine(m)), prec, true);

/** Map bbox `from` onto bbox `to` (uniform "contain" fit when `uniform`, else stretch). */
export const fitAffine = (from: BBox, to: BBox, uniform = true): Affine => {
  const sx = to.w / Math.max(from.w, 1e-9), sy = to.h / Math.max(from.h, 1e-9);
  const kx = uniform ? Math.min(sx, sy) : sx, ky = uniform ? Math.min(sx, sy) : sy;
  const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2, tcx = to.x + to.w / 2, tcy = to.y + to.h / 2;
  return [kx, 0, 0, ky, tcx - fcx * kx, tcy - fcy * ky];
};

export const rotateAffine = (deg: number, cx: number, cy: number): Affine => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};

export const reverseSub = (s: Sub): Sub => {
  // (a reversed subpath is treated as closed geometry)
  const n = s.curves.length;
  const pts: Pt[] = [s.start, ...s.curves.map((c) => [c[4], c[5]] as Pt)];
  const curves: Cubic[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const c = s.curves[i];
    const from = pts[i];
    curves.push([c[2], c[3], c[0], c[1], from[0], from[1]]);
  }
  return { start: [pts[n][0], pts[n][1]], curves };
};

// ---------------------------------------------------------------------------------------------
// measurement

const cubicPt = (p0: Pt, c: Cubic, t: number): Pt => {
  const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
  return [a * p0[0] + b * c[0] + cc * c[2] + d * c[4], a * p0[1] + b * c[1] + cc * c[3] + d * c[5]];
};

/** Polygon approximation of a subpath (n samples per cubic). */
export const sampleSub = (s: Sub, per = 8): Pt[] => {
  const out: Pt[] = [s.start];
  let p0 = s.start;
  for (const c of s.curves) {
    for (let i = 1; i <= per; i++) out.push(cubicPt(p0, c, i / per));
    p0 = [c[4], c[5]];
  }
  return out;
};

/** Shoelace area (positive = clockwise on screen, y-down). */
export const shoelace = (poly: Pt[]) => {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

export const polyBBox = (pts: Pt[]): BBox => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const pathBBox = (p: GPath): BBox => polyBBox(p.flatMap((s) => sampleSub(s, 12)));
export const dBBox = (d: string): BBox => pathBBox(parsePath(d));
export const unionBBox = (bs: BBox[]): BBox => {
  const v = bs.filter((b) => b.w > 0 || b.h > 0);
  if (!v.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...v.map((b) => b.x)), y0 = Math.min(...v.map((b) => b.y));
  const x1 = Math.max(...v.map((b) => b.x + b.w)), y1 = Math.max(...v.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const pointInPoly = (pt: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
};

/** Points spread along the contour, for majority-vote containment (robust to overlapping outers / touching holes). */
const probePoints = (poly: Pt[], k = 9): Pt[] => {
  const n = poly.length;
  const out: Pt[] = [];
  for (let j = 0; j < k; j++) {
    const i = Math.floor(((j + 0.5) * (n - 1)) / k);
    const a = poly[i], b = poly[Math.min(n - 1, i + 1)];
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
};

export type SubInfo = { sub: Sub; poly: Pt[]; area: number; depth: number; parent: number; bbox: BBox };

/** Containment analysis: nesting depth (even = filled outer, odd = hole) and immediate parent. */
export const analyzeSubs = (p: GPath): SubInfo[] => {
  const info = p.map((sub) => {
    const poly = sampleSub(sub, 8);
    return { sub, poly, area: shoelace(poly), depth: 0, parent: -1, bbox: polyBBox(poly) };
  });
  for (let i = 0; i < info.length; i++) {
    const probes = probePoints(info[i].poly);
    const bi = info[i].bbox;
    let best = -1, bestArea = Infinity;
    for (let j = 0; j < info.length; j++) {
      if (i === j) continue;
      const a = Math.abs(info[j].area);
      if (a <= Math.abs(info[i].area)) continue;
      const bj = info[j].bbox;
      if (bi.x > bj.x + bj.w || bi.x + bi.w < bj.x || bi.y > bj.y + bj.h || bi.y + bi.h < bj.y) continue;
      let hits = 0;
      for (const pt of probes) if (pointInPoly(pt, info[j].poly)) hits++;
      if (hits * 2 > probes.length) {
        info[i].depth++;
        if (a < bestArea) {
          bestArea = a;
          best = j;
        }
      }
    }
    info[i].parent = best;
  }
  return info;
};

/** Containment pre-pass: outers counter-clockwise (shoelace<0), holes clockwise, whatever the source winding/fill-rule. */
export const orientPath = (p: GPath): GPath =>
  analyzeSubs(p).map(({ sub, area, depth }) => {
    const wantNeg = depth % 2 === 0;
    return (area < 0) === wantNeg ? sub : reverseSub(sub);
  });

export const orientD = (d: string, prec = 2) => toD(orientPath(parsePath(d)), prec);

/** Split into islands: each filled outer contour with its holes. */
export const islands = (p: GPath): GPath[] => {
  const info = analyzeSubs(p);
  const out: GPath[] = [];
  const index = new Map<number, number>();
  info.forEach((s, i) => {
    if (s.depth % 2 === 0) {
      index.set(i, out.length);
      out.push([s.sub]);
    }
  });
  info.forEach((s, i) => {
    if (s.depth % 2 === 1 && s.parent >= 0 && index.has(s.parent)) out[index.get(s.parent)!].push(s.sub);
  });
  return out.map(orientPath);
};

/** Filled area + area-weighted centroid (outer minus holes). */
export const areaCentroid = (p: GPath): { area: number; cx: number; cy: number } => {
  const info = analyzeSubs(p);
  let A = 0, X = 0, Y = 0;
  for (const s of info) {
    const sign = s.depth % 2 === 0 ? 1 : -1;
    const poly = s.poly;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % n];
      const cr = p0[0] * p1[1] - p1[0] * p0[1];
      a += cr;
      cx += (p0[0] + p1[0]) * cr;
      cy += (p0[1] + p1[1]) * cr;
    }
    a /= 2;
    if (Math.abs(a) < 1e-9) continue;
    cx /= 6 * a;
    cy /= 6 * a;
    const w = sign * Math.abs(a);
    A += w;
    X += cx * w;
    Y += cy * w;
  }
  if (Math.abs(A) < 1e-9) {
    const b = pathBBox(p);
    return { area: 0, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
  }
  return { area: A, cx: X / A, cy: Y / A };
};

export const subLength = (s: Sub) => {
  const poly = sampleSub(s, 16);
  let L = 0;
  for (let i = 1; i < poly.length; i++) L += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  return L;
};

/** Arc-length lookup table for a subpath: evaluate points by fraction 0..1 cheaply per frame. */
export const lengthTable = (s: Sub, samples = 24) => lengthTableFromPts(sampleSub(s, samples));

export const lengthTableFromPts = (pts: Pt[]) => {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1] || 1;
  const at = (f: number): { x: number; y: number; angle: number } => {
    const target = Math.min(1, Math.max(0, f)) * total;
    let lo = 0, hi = acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (acc[mid] < target) lo = mid;
      else hi = mid;
    }
    const seg = acc[hi] - acc[lo] || 1;
    const k = (target - acc[lo]) / seg;
    const a = pts[lo], b = pts[hi];
    return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  return { total, at };
};

/** Pole of inaccessibility (coarse): an interior point far from every edge. Good zoom/scale pivot. */
export const interiorPoint = (p: GPath): Pt => {
  const info = analyzeSubs(p);
  const b = pathBBox(p);
  const edges = info.flatMap((s) => s.poly.map((pt, i) => [pt, s.poly[(i + 1) % s.poly.length]] as [Pt, Pt]));
  const inside = (pt: Pt) => {
    let w = 0;
    for (const s of info) if (pointInPoly(pt, s.poly)) w += s.depth % 2 === 0 ? 1 : -1;
    return w > 0;
  };
  const dist = (pt: Pt) => {
    let m = Infinity;
    for (const [a, c] of edges) {
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const l2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2));
      const d = Math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dy);
      if (d < m) m = d;
    }
    return m;
  };
  let best: Pt = [b.x + b.w / 2, b.y + b.h / 2], bestD = -1;
  const N = 18;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const pt: Pt = [b.x + (b.w * i) / N, b.y + (b.h * j) / N];
      if (!inside(pt)) continue;
      const d = dist(pt);
      if (d > bestD) {
        bestD = d;
        best = pt;
      }
    }
  }
  return best;
};

/** Split path data into its subpath strings (absolute). */
export const splitSubpaths = (d: string): string[] => parsePath(d).map((s) => subToD(s));

// ---------------------------------------------------------------------------------------------
// smooth construction helpers + stroke → fill outline

/** Closed Catmull-Rom spline through points → smooth cubic subpath. */
export const catmull = (pts: Pt[]): Sub => {
  const n = pts.length;
  const curves: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    curves.push([
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    ]);
  }
  return { start: [pts[0][0], pts[0][1]], curves };
};

/** Thick ribbon around a centerline (width per point), round caps unless the width tapers to 0. */
export const ribbon = (center: Pt[], width: number | number[], caps = true): Sub => {
  const n = center.length;
  const w = (i: number) => (Array.isArray(width) ? width[i] : width) / 2;
  const tan = (i: number): Pt => {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = tan(i), nn: Pt = [-t[1], t[0]];
    left.push([center[i][0] + nn[0] * w(i), center[i][1] + nn[1] * w(i)]);
    right.push([center[i][0] - nn[0] * w(i), center[i][1] - nn[1] * w(i)]);
  }
  const loop: Pt[] = [...left];
  const cap = (i: number, back: boolean) => {
    const t = tan(i), nn: Pt = [-t[1], t[0]], r = w(i), c = center[i];
    const out: Pt[] = [];
    for (let k = 1; k < 6; k++) {
      const ph = (Math.PI * k) / 6;
      const sgn = back ? -1 : 1;
      out.push([c[0] + sgn * (nn[0] * Math.cos(ph) + t[0] * Math.sin(ph)) * r, c[1] + sgn * (nn[1] * Math.cos(ph) + t[1] * Math.sin(ph)) * r]);
    }
    return out;
  };
  if (caps && w(n - 1) > 0) loop.push(...cap(n - 1, false));
  loop.push(...right.reverse());
  if (caps && w(0) > 0) loop.push(...cap(0, true));
  // collapse coincident points (zero-width tips)
  const dedup = loop.filter((p, i) => i === 0 || Math.hypot(p[0] - loop[i - 1][0], p[1] - loop[i - 1][1]) > 1e-6);
  return catmull(dedup);
};


/** Open-aware parse: subpaths as point polylines (no auto-closing), with a closed flag. */
export const polylines = (d: string, per = 10): { pts: Pt[]; closed: boolean }[] => {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  try {
    const arr = pathToCurve(d) as unknown as (string | number)[][];
    let cur: { pts: Pt[]; closed: boolean } | null = null;
    let p0: Pt = [0, 0];
    for (const seg of arr) {
      if (seg[0] === "M") {
        p0 = [seg[1] as number, seg[2] as number];
        cur = { pts: [p0], closed: false };
        out.push(cur);
      } else if (seg[0] === "C" && cur) {
        const c = seg.slice(1, 7) as Cubic;
        for (let i = 1; i <= per; i++) cur.pts.push(cubicPt(p0, c, i / per));
        p0 = [c[4], c[5]];
      }
    }
  } catch {
    return [];
  }
  for (const o of out) {
    const a = o.pts[0], b = o.pts[o.pts.length - 1];
    o.closed = o.pts.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3;
    // drop near-duplicate consecutive points
    o.pts = o.pts.filter((p, i) => i === 0 || Math.hypot(p[0] - o.pts[i - 1][0], p[1] - o.pts[i - 1][1]) > 1e-4);
  }
  return out.filter((o) => o.pts.length > 1);
};

/** Fill outline of a stroked path (round caps/joins, approximate): open → capsule ribbon, closed → ring. */
export const strokeOutline = (d: string, width: number): string => {
  const subs: Sub[] = [];
  for (const { pts, closed } of polylines(d)) {
    if (!closed) {
      subs.push(ribbon(pts, width, true));
      continue;
    }
    const ring = pts.slice(0, -1);
    const n = ring.length;
    const off = (sgn: number) =>
      ring.map((p, i) => {
        const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [p[0] - ((b[1] - a[1]) / l) * (width / 2) * sgn, p[1] + ((b[0] - a[0]) / l) * (width / 2) * sgn] as Pt;
      });
    subs.push(catmull(off(1)), catmull(off(-1)));
  }
  return toD(orientPath(subs));
};
