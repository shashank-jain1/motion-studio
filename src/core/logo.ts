/**
 * Logo analyzer (docs/research/02-logo-svg-concept.md §3.8): SVG → parts (islands with holes, transforms baked,
 * absolute viewBox coordinates), icon/wordmark groups, stagger orders, palette, geometry kit and hole list.
 *
 * Output is cached next to the asset as `<asset>.logo.json` (e.g. assets/logo.svg.logo.json); the engine reads it.
 * Pure Node (no DOM): svgson for the tree, svgpath for baking transforms/arcs, own geometry for the rest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseSync, type INode } from "svgson";
import svgpath from "svgpath";
import { LOGO_MODES } from "../engine/spec/schema";
import { runBinary } from "./probe";

// ---------------------------------------------------------------- public types (contract with the engine)

export type BBox = { x: number; y: number; w: number; h: number };

export type Part = {
  id: number;
  /** outer + holes as subpaths; outer is clockwise on screen (positive area), holes counter-clockwise, so nonzero and evenodd render the same */
  d: string;
  fill: string;
  fillRule: "nonzero" | "evenodd";
  area: number;
  bbox: BBox;
  centroid: [number, number];
  circularity: number;
  thinness: number;
  /** indices into LogoAnalysis.holes */
  holeIds: number[];
  length: number;
  kind: "shape" | "glyph";
  // ---- optional extras
  /** the part is a stroked centerline (d is open/closed centerline, fill = stroke color) */
  strokeOnly?: boolean;
  /** stroke color when the part is filled AND stroked */
  stroke?: string;
  /** stroke width in viewBox units (strokeOnly parts, or filled+stroked parts) */
  strokeWidth?: number;
  /** gradient stop colors when the fill was a gradient (fill = their average) */
  gradient?: string[];
  /** effective opacity when < 1 */
  opacity?: number;
};

export const LOGO_ORDERS = ["leftToRight", "topToBottom", "reading", "bySizeDesc", "radialOut", "angular", "document", "byColor"] as const;
export type LogoOrder = (typeof LOGO_ORDERS)[number];
export type PaletteRole = "primary" | "accent" | "dark" | "light";

export type LogoAnalysis = {
  version: 1;
  source: string;
  viewBox: [number, number, number, number];
  width: number;
  height: number;
  parts: Part[];
  groups: { icon: number[]; wordmark: number[] };
  orders: Record<LogoOrder, number[]>;
  palette: { hex: string; weight: number; role: PaletteRole }[];
  kit: { strokeWeight: number; cornerRadius: number; angles: number[]; symmetry: "x" | "y" | "radial" | null };
  holes: { partId: number; d: string; areaRatio: number }[];
  bbox: BBox;
  centroid: [number, number];
  unionD: string;
  /** optional: things the analyzer skipped or could not handle (text elements, images, …) */
  warnings?: string[];
};

// ---------------------------------------------------------------- small math

type Pt = [number, number];
type Mat = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

const mul = (A: Mat, B: Mat): Mat => [
  A[0] * B[0] + A[2] * B[1],
  A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4],
  A[1] * B[4] + A[3] * B[5] + A[5],
];
const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const isIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

const nums = (s: string): number[] => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

export const parseTransform = (str: string | undefined): Mat => {
  let m: Mat = IDENTITY;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(str))) {
    const v = nums(hit[2]);
    let t: Mat = IDENTITY;
    switch (hit[1]) {
      case "matrix":
        if (v.length >= 6) t = [v[0], v[1], v[2], v[3], v[4], v[5]];
        break;
      case "translate":
        t = translate(v[0] ?? 0, v[1] ?? 0);
        break;
      case "scale":
        t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const r: Mat = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        t = v.length >= 3 ? mul(mul(translate(v[1], v[2]), r), translate(-v[1], -v[2])) : r;
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, t);
  }
  return m;
};

const r2 = (n: number, d = 2) => {
  const f = 10 ** d;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
};

const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- colors

const NAMED: Record<string, string> = Object.fromEntries(
  ("aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 " +
    "blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 " +
    "chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b " +
    "darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f " +
    "darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f " +
    "darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 " +
    "dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff " +
    "gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 " +
    "indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd " +
    "lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 " +
    "lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 " +
    "lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 " +
    "mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee " +
    "mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 " +
    "moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 " +
    "orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 " +
    "peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f " +
    "royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 " +
    "skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c " +
    "teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 " +
    "yellow:ffff00 yellowgreen:9acd32")
    .split(" ")
    .map((kv) => kv.split(":") as [string, string]),
);

type RGBA = { r: number; g: number; b: number; a: number };

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
};

export const parseColor = (raw: string | undefined): RGBA | null => {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return null;
  if (NAMED[s]) return parseColor("#" + NAMED[s]);
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (v: string) => (v.endsWith("%") ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    const a = parts[3] !== undefined ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a };
  }
  m = /^hsla?\(([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    const a = parts[3] !== undefined ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { r, g, b, a };
  }
  return null;
};

const toHex = (c: { r: number; g: number; b: number }) =>
  "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

const srgbToLinear = (v: number) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** OKLab (L 0..1). */
export const oklab = (hex: string): [number, number, number] => {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  const r = srgbToLinear(c.r), g = srgbToLinear(c.g), b = srgbToLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const labDist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------- path geometry

type Seg = { t: "L"; p: Pt } | { t: "C"; c1: Pt; c2: Pt; p: Pt } | { t: "Q"; c: Pt; p: Pt };
type Sub = {
  start: Pt;
  segs: Seg[];
  closed: boolean;
  poly: Pt[];
  /** signed shoelace area: > 0 = clockwise on screen (same sign as svg-path-commander getPathArea) */
  area: number;
  len: number;
  min: Pt;
  max: Pt;
};

/** Parse an ABSOLUTE path containing only M L H V C Q Z (svgpath .abs().unarc().unshort() output). */
const parseAbsPath = (d: string): { start: Pt; segs: Seg[]; closed: boolean }[] => {
  const out: { start: Pt; segs: Seg[]; closed: boolean }[] = [];
  const tokens = d.match(/[MLHVCQZmlhvcqz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let cur: { start: Pt; segs: Seg[]; closed: boolean } | null = null;
  let pt: Pt = [0, 0];
  let subStart: Pt = [0, 0];
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const ensure = () => {
    if (!cur) {
      cur = { start: [...subStart] as Pt, segs: [], closed: false };
      out.push(cur);
    }
    return cur;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    else if (!cmd) {
      i++;
      continue;
    }
    switch (cmd) {
      case "M": {
        if (!isNum()) break;
        pt = [num(), num()];
        subStart = pt;
        cur = { start: [...pt] as Pt, segs: [], closed: false };
        out.push(cur);
        cmd = "L"; // implicit lineto after moveto
        break;
      }
      case "L":
        if (!isNum()) break;
        pt = [num(), num()];
        ensure().segs.push({ t: "L", p: pt });
        break;
      case "H":
        if (!isNum()) break;
        pt = [num(), pt[1]];
        ensure().segs.push({ t: "L", p: pt });
        break;
      case "V":
        if (!isNum()) break;
        pt = [pt[0], num()];
        ensure().segs.push({ t: "L", p: pt });
        break;
      case "C": {
        if (!isNum()) break;
        const c1: Pt = [num(), num()], c2: Pt = [num(), num()];
        pt = [num(), num()];
        ensure().segs.push({ t: "C", c1, c2, p: pt });
        break;
      }
      case "Q": {
        if (!isNum()) break;
        const c: Pt = [num(), num()];
        pt = [num(), num()];
        ensure().segs.push({ t: "Q", c, p: pt });
        break;
      }
      case "Z":
        if (cur) (cur as { closed: boolean }).closed = true;
        pt = subStart;
        cur = null;
        cmd = "";
        break;
      default:
        i++;
    }
  }
  return out.filter((s) => s.segs.length > 0);
};

const segEnd = (s: Seg) => s.p;

const flattenSub = (raw: { start: Pt; segs: Seg[]; closed: boolean }, tol: number): Sub => {
  const poly: Pt[] = [raw.start];
  let prev = raw.start;
  for (const s of raw.segs) {
    if (s.t === "L") poly.push(s.p);
    else if (s.t === "C") {
      const ctrl = Math.hypot(s.c1[0] - prev[0], s.c1[1] - prev[1]) + Math.hypot(s.c2[0] - s.c1[0], s.c2[1] - s.c1[1]) + Math.hypot(s.p[0] - s.c2[0], s.p[1] - s.c2[1]);
      const n = Math.max(2, Math.min(64, Math.ceil(ctrl / tol)));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        poly.push([
          u * u * u * prev[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.p[0],
          u * u * u * prev[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.p[1],
        ]);
      }
    } else {
      const ctrl = Math.hypot(s.c[0] - prev[0], s.c[1] - prev[1]) + Math.hypot(s.p[0] - s.c[0], s.p[1] - s.c[1]);
      const n = Math.max(2, Math.min(64, Math.ceil(ctrl / tol)));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        poly.push([u * u * prev[0] + 2 * u * t * s.c[0] + t * t * s.p[0], u * u * prev[1] + 2 * u * t * s.c[1] + t * t * s.p[1]]);
      }
    }
    prev = segEnd(s);
  }
  let area = 0;
  let len = 0;
  const min: Pt = [Infinity, Infinity], max: Pt = [-Infinity, -Infinity];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
    if (k + 1 < poly.length || raw.closed) len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (a[0] < min[0]) min[0] = a[0];
    if (a[1] < min[1]) min[1] = a[1];
    if (a[0] > max[0]) max[0] = a[0];
    if (a[1] > max[1]) max[1] = a[1];
  }
  return { ...raw, poly, area: area / 2, len, min, max };
};

const reverseSub = (s: Sub): Sub => {
  let segs = s.segs;
  const last = segs[segs.length - 1].p;
  if (s.closed && (Math.abs(last[0] - s.start[0]) > 1e-9 || Math.abs(last[1] - s.start[1]) > 1e-9)) segs = [...segs, { t: "L", p: s.start }];
  const newStart = segs[segs.length - 1].p;
  const out: Seg[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const prevPt = i === 0 ? s.start : segs[i - 1].p;
    const g = segs[i];
    if (g.t === "L") out.push({ t: "L", p: prevPt });
    else if (g.t === "C") out.push({ t: "C", c1: g.c2, c2: g.c1, p: prevPt });
    else out.push({ t: "Q", c: g.c, p: prevPt });
  }
  return { ...s, start: newStart, segs: out, poly: [...s.poly].reverse(), area: -s.area };
};

const fmt = (n: number, dec: number) => {
  const v = r2(n, dec);
  return String(v);
};

const subToD = (s: Sub, dec: number): string => {
  const p = (q: Pt) => `${fmt(q[0], dec)} ${fmt(q[1], dec)}`;
  let d = `M${p(s.start)}`;
  for (const g of s.segs) {
    if (g.t === "L") d += `L${p(g.p)}`;
    else if (g.t === "C") d += `C${p(g.c1)} ${p(g.c2)} ${p(g.p)}`;
    else d += `Q${p(g.c)} ${p(g.p)}`;
  }
  return s.closed ? d + "Z" : d;
};

/** Even-odd ray cast. */
const pointInPoly = (pt: Pt, poly: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Is `inner` contained in `outer`? (bbox + majority of sampled vertices inside). */
const contains = (outer: Sub, inner: Sub): boolean => {
  if (Math.abs(outer.area) <= Math.abs(inner.area)) return false;
  const eps = 1e-6;
  if (inner.min[0] < outer.min[0] - eps || inner.min[1] < outer.min[1] - eps || inner.max[0] > outer.max[0] + eps || inner.max[1] > outer.max[1] + eps) return false;
  const n = inner.poly.length;
  const k = Math.min(9, n);
  let yes = 0;
  for (let i = 0; i < k; i++) if (pointInPoly(inner.poly[Math.floor((i * n) / k)], outer.poly)) yes++;
  return yes * 2 > k;
};

const polyCentroid = (poly: Pt[]): { c: Pt; a: number } => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    const sx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const sy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return { c: [sx, sy], a: 0 };
  }
  return { c: [cx / (6 * a), cy / (6 * a)], a };
};

/** Length-weighted midpoint of a polyline (for open stroke centroids). */
const lineCentroid = (poly: Pt[], closed: boolean): Pt => {
  let L = 0, cx = 0, cy = 0;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    L += l;
    cx += ((a[0] + b[0]) / 2) * l;
    cy += ((a[1] + b[1]) / 2) * l;
  }
  return L > 0 ? [cx / L, cy / L] : poly[0];
};

// ---------------------------------------------------------------- SVG tree → drawables

type Paint = { hex: string; alpha: number; gradient?: string[] } | null;

type Drawable = {
  tag: string;
  d: string; // baked, absolute
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  fillRule: "nonzero" | "evenodd";
  opacity: number;
};

type CssRule = { tag?: string; id?: string; classes: string[]; spec: number; order: number; decls: Record<string, string> };

const parseDecls = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const decl of s.split(";")) {
    const k = decl.indexOf(":");
    if (k < 0) continue;
    const key = decl.slice(0, k).trim().toLowerCase();
    const val = decl.slice(k + 1).replace(/!important/i, "").trim();
    if (key && val) out[key] = val;
  }
  return out;
};

const parseCss = (css: string, startOrder: number): CssRule[] => {
  const rules: CssRule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{]+\{[^{}]*\}/g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = startOrder;
  while ((m = re.exec(clean))) {
    const decls = parseDecls(m[2]);
    for (const selRaw of m[1].split(",")) {
      const sel = selRaw.trim();
      // Only simple compound selectors: tag, .class, #id and combinations (no descendant/child/attribute/pseudo).
      if (!sel || /[\s>+~[\]:*]/.test(sel)) continue;
      const tag = /^[a-zA-Z][\w-]*/.exec(sel)?.[0];
      const id = /#([\w-]+)/.exec(sel)?.[1];
      const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
      rules.push({ tag, id, classes, spec: (id ? 100 : 0) + classes.length * 10 + (tag ? 1 : 0), order: order++, decls });
    }
  }
  return rules;
};

const PRESENTATION = [
  "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "display", "visibility", "color",
  "stop-color", "stop-opacity",
];

type Inherited = {
  fill: string;
  stroke: string;
  strokeWidth: string;
  fillOpacity: number;
  strokeOpacity: number;
  fillRule: "nonzero" | "evenodd";
  visible: boolean;
  color: string;
};

const ROOT_STYLE: Inherited = { fill: "black", stroke: "none", strokeWidth: "1", fillOpacity: 1, strokeOpacity: 1, fillRule: "nonzero", visible: true, color: "black" };

const SKIP_TAGS = new Set([
  "defs", "clippath", "mask", "symbol", "pattern", "marker", "title", "desc", "metadata", "style", "script",
  "lineargradient", "radialgradient", "filter", "foreignobject", "font", "font-face", "glyph", "missing-glyph", "view", "cursor",
]);

const localName = (n: string) => n.replace(/^.*:/, "").toLowerCase();

const num1 = (v: string | undefined, ref = 0): number => {
  if (v === undefined) return 0;
  const s = v.trim();
  if (s.endsWith("%")) return (parseFloat(s) / 100) * ref;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const opacityVal = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const s = v.trim();
  const n = s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
};

const shapeToD = (tag: string, a: Record<string, string>, vb: [number, number, number, number]): string | null => {
  const W = vb[2], H = vb[3], D = Math.hypot(W, H) / Math.SQRT2;
  switch (tag) {
    case "path":
      return a.d ?? null;
    case "rect": {
      const x = num1(a.x, W), y = num1(a.y, H), w = num1(a.width, W), h = num1(a.height, H);
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx !== undefined && a.rx !== "auto" ? num1(a.rx, W) : undefined;
      let ry = a.ry !== undefined && a.ry !== "auto" ? num1(a.ry, H) : undefined;
      if (rx === undefined) rx = ry ?? 0;
      if (ry === undefined) ry = rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (rx === 0 || ry === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return (
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
        `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
      );
    }
    case "circle": {
      const cx = num1(a.cx, W), cy = num1(a.cy, H), r = num1(a.r, D);
      if (r <= 0) return null;
      return `M${cx + r} ${cy}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${r} ${r} 0 0 1 ${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`;
    }
    case "ellipse": {
      const cx = num1(a.cx, W), cy = num1(a.cy, H);
      let rx = a.rx !== undefined && a.rx !== "auto" ? num1(a.rx, W) : undefined;
      let ry = a.ry !== undefined && a.ry !== "auto" ? num1(a.ry, H) : undefined;
      rx = rx ?? ry ?? 0;
      ry = ry ?? rx;
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`;
    }
    case "line":
      return `M${num1(a.x1, W)} ${num1(a.y1, H)}L${num1(a.x2, W)} ${num1(a.y2, H)}`;
    case "polyline":
    case "polygon": {
      const v = nums(a.points ?? "");
      if (v.length < 4) return null;
      let d = `M${v[0]} ${v[1]}`;
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`;
      return tag === "polygon" ? d + "Z" : d;
    }
    default:
      return null;
  }
};

const viewBoxMatrix = (vb: number[], w: number, h: number, par: string | undefined): Mat => {
  if (vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0 || !(w > 0) || !(h > 0)) return IDENTITY;
  const p = (par ?? "xMidYMid meet").trim();
  let sx = w / vb[2], sy = h / vb[3];
  if (!p.startsWith("none")) {
    const s = /slice/.test(p) ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
  }
  let tx = -vb[0] * sx, ty = -vb[1] * sy;
  const align = p.split(/\s+/)[0];
  if (align !== "none") {
    if (/xMid/.test(align)) tx += (w - vb[2] * sx) / 2;
    else if (/xMax/.test(align)) tx += w - vb[2] * sx;
    if (/YMid/.test(align)) ty += (h - vb[3] * sy) / 2;
    else if (/YMax/.test(align)) ty += h - vb[3] * sy;
  }
  return [sx, 0, 0, sy, tx, ty];
};

const collectDrawables = (root: INode, warnings: string[]): { drawables: Drawable[]; viewBox: [number, number, number, number] } => {
  // index ids + styles
  const ids = new Map<string, INode>();
  let css: CssRule[] = [];
  const indexWalk = (n: INode) => {
    if (n.attributes?.id) ids.set(n.attributes.id, n);
    if (localName(n.name) === "style") {
      const txt = (n.children ?? []).map((c) => c.value ?? "").join("");
      css = css.concat(parseCss(txt, css.length));
    }
    for (const c of n.children ?? []) indexWalk(c);
  };
  indexWalk(root);
  css.sort((a, b) => a.spec - b.spec || a.order - b.order);

  // viewBox
  const ra = root.attributes ?? {};
  let viewBox = nums(ra.viewBox ?? ra.viewbox ?? "");
  if (viewBox.length !== 4 || viewBox[2] <= 0 || viewBox[3] <= 0) {
    const w = parseFloat(ra.width ?? ""), h = parseFloat(ra.height ?? "");
    viewBox = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? [0, 0, w, h] : [];
  }
  const vb: [number, number, number, number] = viewBox.length === 4 ? (viewBox as [number, number, number, number]) : [0, 0, 0, 0];

  const propsOf = (n: INode): Record<string, string> => {
    const a = n.attributes ?? {};
    const out: Record<string, string> = {};
    for (const k of PRESENTATION) if (a[k] !== undefined) out[k] = a[k];
    if (css.length) {
      const tag = localName(n.name);
      const classes = (a.class ?? "").split(/\s+/).filter(Boolean);
      for (const r of css) {
        if (r.tag && r.tag.toLowerCase() !== tag) continue;
        if (r.id && r.id !== a.id) continue;
        if (r.classes.some((c) => !classes.includes(c))) continue;
        Object.assign(out, r.decls);
      }
    }
    if (a.style) Object.assign(out, parseDecls(a.style));
    return out;
  };

  const gradientStops = (g: INode, depth = 0): { color: RGBA; offset: number }[] => {
    const stops = (g.children ?? []).filter((c) => localName(c.name) === "stop");
    if (!stops.length && depth < 5) {
      const href = g.attributes?.href ?? g.attributes?.["xlink:href"];
      const ref = href?.startsWith("#") ? ids.get(href.slice(1)) : undefined;
      if (ref) return gradientStops(ref, depth + 1);
    }
    return stops
      .map((s) => {
        const p = propsOf(s);
        const c = parseColor(p["stop-color"] ?? "black");
        if (!c) return null;
        c.a *= opacityVal(p["stop-opacity"]) ?? 1;
        return { color: c, offset: num1(s.attributes?.offset, 1) };
      })
      .filter((x): x is { color: RGBA; offset: number } => !!x);
  };

  const resolvePaint = (raw: string, color: string): Paint => {
    const v = raw.trim();
    if (!v || v === "none" || v === "transparent") return null;
    if (v === "currentColor" || v === "currentcolor") return resolvePaint(color, "black");
    const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(v);
    if (url) {
      const ref = ids.get(url[1]);
      const tag = ref ? localName(ref.name) : "";
      if (ref && (tag === "lineargradient" || tag === "radialgradient")) {
        const stops = gradientStops(ref);
        if (!stops.length) return null;
        const vis = stops.filter((s) => s.color.a > 0);
        const use = vis.length ? vis : stops;
        const avg = use.reduce((s, x) => ({ r: s.r + x.color.r, g: s.g + x.color.g, b: s.b + x.color.b }), { r: 0, g: 0, b: 0 });
        const n = use.length;
        const alpha = stops.reduce((s, x) => s + x.color.a, 0) / stops.length;
        return { hex: toHex({ r: avg.r / n, g: avg.g / n, b: avg.b / n }), alpha, gradient: stops.map((s) => toHex(s.color)) };
      }
      if (url[2]) return resolvePaint(url[2], color);
      warnings.push(`paint "${v}" references a pattern or unknown id; treated as mid-grey`);
      return { hex: "#808080", alpha: 1 };
    }
    const c = parseColor(v);
    if (!c) {
      warnings.push(`unparsed color "${v}"; treated as black`);
      return { hex: "#000000", alpha: 1 };
    }
    return { hex: toHex(c), alpha: c.a };
  };

  const drawables: Drawable[] = [];
  const textSeen = { text: 0, image: 0 };

  const walk = (n: INode, ctm: Mat, inh: Inherited, op: number, useStack: string[], viaUse = false) => {
    if (n.type !== "element") return;
    const tag = localName(n.name);
    if (SKIP_TAGS.has(tag) && !(viaUse && tag === "symbol")) return;
    if (tag === "text" || tag === "tspan" || tag === "textpath") {
      textSeen.text++;
      return;
    }
    if (tag === "image") {
      textSeen.image++;
      return;
    }
    const props = propsOf(n);
    if ((props.display ?? "").trim() === "none") return;
    const st: Inherited = { ...inh };
    if (props.fill !== undefined && props.fill !== "inherit") st.fill = props.fill;
    if (props.stroke !== undefined && props.stroke !== "inherit") st.stroke = props.stroke;
    if (props["stroke-width"] !== undefined && props["stroke-width"] !== "inherit") st.strokeWidth = props["stroke-width"];
    if (props.color !== undefined && props.color !== "inherit") st.color = props.color;
    const fo = opacityVal(props["fill-opacity"]);
    if (fo !== undefined) st.fillOpacity = fo;
    const so = opacityVal(props["stroke-opacity"]);
    if (so !== undefined) st.strokeOpacity = so;
    if (props["fill-rule"] === "evenodd" || props["fill-rule"] === "nonzero") st.fillRule = props["fill-rule"];
    if (props.visibility !== undefined) st.visible = !/hidden|collapse/.test(props.visibility);
    const o = opacityVal(props.opacity) ?? 1;
    const opHere = op * o;
    if (opHere <= 0.001) return;
    const a = n.attributes ?? {};
    let m = mul(ctm, parseTransform(a.transform));

    if (tag === "use") {
      const href = a.href ?? a["xlink:href"];
      if (!href?.startsWith("#")) return;
      const refId = href.slice(1);
      const ref = ids.get(refId);
      if (!ref || useStack.includes(refId) || useStack.length > 16) return;
      m = mul(m, translate(num1(a.x, vb[2]), num1(a.y, vb[3])));
      if (localName(ref.name) === "symbol") {
        const svb = nums(ref.attributes?.viewBox ?? "");
        const w = a.width !== undefined ? num1(a.width, vb[2]) : svb[2];
        const h = a.height !== undefined ? num1(a.height, vb[3]) : svb[3];
        if (svb.length === 4) m = mul(m, viewBoxMatrix(svb, w, h, ref.attributes?.preserveAspectRatio));
        // symbol's own presentation attributes still cascade
        const sprops = propsOf(ref);
        const sst: Inherited = { ...st };
        if (sprops.fill) sst.fill = sprops.fill;
        if (sprops.stroke) sst.stroke = sprops.stroke;
        if (sprops["stroke-width"]) sst.strokeWidth = sprops["stroke-width"];
        for (const c of ref.children ?? []) walk(c, m, sst, opHere, [...useStack, refId]);
      } else walk(ref, m, st, opHere, [...useStack, refId], true);
      return;
    }

    if (tag === "svg" || tag === "g" || tag === "a" || tag === "switch" || tag === "symbol") {
      if (tag === "svg") {
        const svb = nums(a.viewBox ?? "");
        m = mul(m, translate(num1(a.x, vb[2]), num1(a.y, vb[3])));
        if (svb.length === 4) m = mul(m, viewBoxMatrix(svb, num1(a.width ?? "100%", vb[2]), num1(a.height ?? "100%", vb[3]), a.preserveAspectRatio));
      }
      for (const c of n.children ?? []) walk(c, m, st, opHere, useStack);
      return;
    }

    const d = shapeToD(tag, a, vb);
    if (!d || !st.visible) return;
    let baked: string;
    try {
      const p = svgpath(d);
      baked = (isIdentity(m) ? p : p.matrix(m)).abs().unarc().unshort().toString();
    } catch (e) {
      warnings.push(`could not parse <${tag}> path data: ${(e as Error).message}`);
      return;
    }
    let fill = tag === "line" ? null : resolvePaint(st.fill, st.color);
    let stroke = resolvePaint(st.stroke, st.color);
    if (fill) fill = { ...fill, alpha: fill.alpha * st.fillOpacity * opHere };
    if (stroke) stroke = { ...stroke, alpha: stroke.alpha * st.strokeOpacity * opHere };
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const sw = num1(st.strokeWidth, Math.hypot(vb[2], vb[3]) / Math.SQRT2) * scale;
    if (fill && fill.alpha <= 0.01) fill = null;
    if (stroke && (stroke.alpha <= 0.01 || sw <= 0)) stroke = null;
    if (!fill && !stroke) return;
    drawables.push({ tag, d: baked, fill, stroke, strokeWidth: sw, fillRule: st.fillRule, opacity: opHere });
  };

  // root <svg>: its own x/y/viewBox scaling is NOT applied (we work in viewBox space)
  const rootProps = propsOf(root);
  const rootInh: Inherited = { ...ROOT_STYLE };
  if (rootProps.fill) rootInh.fill = rootProps.fill;
  if (rootProps.stroke) rootInh.stroke = rootProps.stroke;
  if (rootProps["stroke-width"]) rootInh.strokeWidth = rootProps["stroke-width"];
  if (rootProps.color) rootInh.color = rootProps.color;
  if (rootProps["fill-rule"] === "evenodd") rootInh.fillRule = "evenodd";
  const rootOp = opacityVal(rootProps.opacity) ?? 1;
  for (const c of root.children ?? []) walk(c, IDENTITY, rootInh, rootOp, []);
  if (textSeen.text) warnings.push(`${textSeen.text} <text> element(s) skipped: convert text to outlines/paths in the source SVG to animate the wordmark`);
  if (textSeen.image) warnings.push(`${textSeen.image} embedded <image> element(s) skipped (raster content cannot be split into parts)`);
  return { drawables, viewBox: vb };
};

// ---------------------------------------------------------------- drawables → parts

type RawPart = Omit<Part, "id" | "holeIds" | "kind"> & { outer: Sub; holes: Sub[]; srcIndex: number };

const buildParts = (drawables: Drawable[], vb: [number, number, number, number], dec: number, warnings: string[]): RawPart[] => {
  const maxDim = Math.max(vb[2], vb[3]) || 1;
  const tol = maxDim / 500;
  const minArea = (maxDim * maxDim) * 1e-7;
  const out: RawPart[] = [];
  const bboxOf = (s: Sub): BBox => ({ x: s.min[0], y: s.min[1], w: s.max[0] - s.min[0], h: s.max[1] - s.min[1] });

  drawables.forEach((dr, srcIndex) => {
    const subs = parseAbsPath(dr.d).map((r) => flattenSub(r, tol));
    if (!subs.length) return;
    const extras: Partial<Part> = {};
    if (dr.opacity < 0.999) extras.opacity = r2(dr.opacity, 3);

    if (dr.fill) {
      if (dr.fill.gradient) extras.gradient = dr.fill.gradient;
      if (dr.stroke) {
        extras.stroke = dr.stroke.hex;
        extras.strokeWidth = r2(dr.strokeWidth, 3);
      }
      const evenodd = dr.fillRule === "evenodd";
      const filled = (w: number) => (evenodd ? Math.abs(w) % 2 === 1 : w !== 0);
      const valid = subs.filter((s) => Math.abs(s.area) > minArea);
      const sorted = [...valid].sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
      const containers = new Map<Sub, Sub[]>();
      for (const s of sorted) containers.set(s, sorted.filter((o) => o !== s && contains(o, s)));
      const role = new Map<Sub, "outer" | "hole">();
      for (const s of sorted) {
        const cs = containers.get(s)!;
        const wOut = evenodd ? cs.length : cs.reduce((acc, o) => acc + Math.sign(o.area), 0);
        const wIn = evenodd ? wOut + 1 : wOut + Math.sign(s.area);
        const fo = filled(wOut), fi = filled(wIn);
        if (!fo && fi) role.set(s, "outer");
        else if (fo && !fi) role.set(s, "hole");
      }
      const outers = sorted.filter((s) => role.get(s) === "outer");
      const holesOf = new Map<Sub, Sub[]>(outers.map((o) => [o, []]));
      for (const h of sorted.filter((s) => role.get(s) === "hole")) {
        const parent = containers
          .get(h)!
          .filter((o) => role.get(o) === "outer")
          .sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0];
        if (parent) holesOf.get(parent)!.push(h);
      }
      // keep document order of outers
      for (const o0 of subs.filter((s) => role.get(s) === "outer")) {
        const outer = o0.area < 0 ? reverseSub(o0) : o0;
        const holes = holesOf.get(o0)!.map((h) => (h.area > 0 ? reverseSub(h) : h));
        const oc = polyCentroid(outer.poly);
        let A = Math.abs(oc.a), cx = oc.c[0] * Math.abs(oc.a), cy = oc.c[1] * Math.abs(oc.a);
        let P = outer.len;
        for (const h of holes) {
          const hc = polyCentroid(h.poly);
          A -= Math.abs(hc.a);
          cx -= hc.c[0] * Math.abs(hc.a);
          cy -= hc.c[1] * Math.abs(hc.a);
          P += h.len;
        }
        const area = Math.max(0, A);
        const bbox = bboxOf(outer);
        const centroid: Pt = area > 1e-9 ? [cx / A, cy / A] : oc.c;
        const maxSide = Math.max(bbox.w, bbox.h) || 1;
        out.push({
          d: [outer, ...holes].map((s) => subToD({ ...s, closed: true }, dec)).join(""),
          fill: dr.fill.hex,
          fillRule: dr.fillRule,
          area,
          bbox,
          centroid,
          circularity: outer.len > 0 ? Math.min(1, (4 * Math.PI * Math.abs(outer.area)) / (outer.len * outer.len)) : 0,
          thinness: P > 0 ? Math.max(0, Math.min(1, 1 - (4 * area) / (P * maxSide))) : 0,
          length: P,
          outer,
          holes,
          srcIndex,
          ...extras,
        });
      }
      return;
    }

    // stroke-only: each subpath is one part (centerline), fill = stroke color
    const sw = dr.strokeWidth;
    const sExtras: Partial<Part> = { ...extras, strokeOnly: true, strokeWidth: r2(sw, 3) };
    if (dr.stroke!.gradient) sExtras.gradient = dr.stroke!.gradient;
    for (const s of subs) {
      if (s.len <= 0) continue;
      const bb = bboxOf(s);
      const bbox = { x: bb.x - sw / 2, y: bb.y - sw / 2, w: bb.w + sw, h: bb.h + sw };
      out.push({
        d: subToD(s, dec),
        fill: dr.stroke!.hex,
        fillRule: "nonzero",
        area: s.len * sw,
        bbox,
        centroid: s.closed && Math.abs(s.area) > minArea ? polyCentroid(s.poly).c : lineCentroid(s.poly, s.closed),
        circularity: s.closed && s.len > 0 ? Math.min(1, (4 * Math.PI * Math.abs(s.area)) / (s.len * s.len)) : 0,
        thinness: 1,
        length: s.len,
        outer: s,
        holes: [],
        srcIndex,
        ...sExtras,
      });
    }
  });

  // drop full-canvas white / transparent backgrounds
  const vbArea = vb[2] * vb[3];
  return out.filter((p, i) => {
    const coversCanvas =
      vbArea > 0 &&
      p.bbox.x <= vb[0] + vb[2] * 0.02 &&
      p.bbox.y <= vb[1] + vb[3] * 0.02 &&
      p.bbox.x + p.bbox.w >= vb[0] + vb[2] * 0.98 &&
      p.bbox.y + p.bbox.h >= vb[1] + vb[3] * 0.98 &&
      !p.holes.length &&
      !p.strokeOnly &&
      p.area >= vbArea * 0.9;
    if (!coversCanvas) return true;
    const c = parseColor(p.fill)!;
    const whiteish = Math.min(c.r, c.g, c.b) >= 245;
    const transparent = (p.opacity ?? 1) < 0.05;
    if (whiteish || transparent) {
      warnings.push(`skipped a full-canvas ${whiteish ? "white" : "transparent"} background shape`);
      return false;
    }
    if (i === 0 && out.length > 1) warnings.push(`part 0 is a full-canvas ${p.fill} background (kept; set the logo layer's parts/color accordingly)`);
    return true;
  });
};

// ---------------------------------------------------------------- groups (icon vs wordmark)

const detectWordmark = (parts: Part[]): Set<number> => {
  const glyph = new Set<number>();
  const n = parts.length;
  if (n < 3) return glyph;
  const bottom = (p: Part) => p.bbox.y + p.bbox.h;
  // adjacency: same line, similar height, small horizontal gap
  const adj: number[][] = parts.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = parts[i].bbox, b = parts[j].bbox;
      const hMin = Math.min(a.h, b.h), hMax = Math.max(a.h, b.h);
      if (hMin <= 0 || hMax / hMin > 1.9) continue;
      const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (vOverlap < 0.5 * hMin) continue;
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      if (gap > 0.9 * hMin) continue;
      // a glyph never sits inside another glyph's box (that would be a hole-ish detail of an icon)
      const xOverlap = -gap;
      if (xOverlap > 0.6 * Math.min(a.w, b.w)) continue;
      adj[i].push(j);
      adj[j].push(i);
    }
  }
  const seen = new Array(n).fill(false);
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      for (const j of adj[k]) if (!seen[j]) { seen[j] = true; stack.push(j); }
    }
    if (comp.length < 3) continue;
    // drop height outliers (an icon chained to the first letter) …
    const mh0 = median(comp.map((k) => parts[k].bbox.h));
    let mem = comp.filter((k) => parts[k].bbox.h < 1.6 * mh0 && parts[k].bbox.h > 0.45 * mh0);
    // … and parts isolated by a much larger gap than the letter spacing
    const hGap = (i: number, j: number) => {
      const a = parts[i].bbox, b = parts[j].bbox;
      return Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
    };
    const nearest = (k: number, set: number[]) => Math.min(...set.filter((j) => j !== k).map((j) => hGap(k, j)));
    if (mem.length >= 3) {
      const g = median(mem.map((k) => nearest(k, mem)));
      const keep = mem.filter((k) => nearest(k, mem) <= Math.max(2.5 * g, 0.3 * mh0));
      mem = keep;
    }
    if (mem.length < 3) continue;
    const hs = mem.map((k) => parts[k].bbox.h);
    const mh = median(hs);
    const mb = median(mem.map((k) => bottom(parts[k])));
    const onBase = mem.filter((k) => Math.abs(bottom(parts[k]) - mb) < 0.12 * mh);
    if (onBase.length / mem.length < 0.6 || onBase.length < 3) continue;
    // members: glyphs on the baseline, plus descenders (top aligned with a baseline glyph, bottom a bit below the baseline)
    const tops = onBase.map((k) => parts[k].bbox.y);
    const members = mem.filter((k) => {
      if (onBase.includes(k)) return true;
      const b = parts[k].bbox;
      const desc = bottom(parts[k]) - mb;
      return desc > 0 && desc < 0.5 * mh && tops.some((t) => Math.abs(b.y - t) < 0.12 * mh);
    });
    const minX = Math.min(...members.map((k) => parts[k].bbox.x));
    const maxX = Math.max(...members.map((k) => parts[k].bbox.x + parts[k].bbox.w));
    if (maxX - minX < 1.5 * mh) continue;
    for (const k of members) glyph.add(k);
    // attach small marks (i-dots, accents, periods, hyphens) that sit within the word's span
    const top = Math.min(...comp.map((k) => parts[k].bbox.y));
    for (let k = 0; k < n; k++) {
      if (glyph.has(k)) continue;
      const b = parts[k].bbox;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (b.h < 0.6 * mh && b.w < 1.2 * mh && cx >= minX - 0.3 * mh && cx <= maxX + 0.3 * mh && cy >= top - 0.6 * mh && cy <= mb + 0.4 * mh) glyph.add(k);
    }
  }
  return glyph;
};

// ---------------------------------------------------------------- orders, palette, kit

const computeOrders = (parts: Part[], centroid: Pt, paletteIndexOf: (hex: string) => number): Record<LogoOrder, number[]> => {
  const ids = parts.map((p) => p.id);
  const by = (f: (p: Part) => number[]) =>
    [...parts]
      .sort((a, b) => {
        const fa = f(a), fb = f(b);
        for (let i = 0; i < fa.length; i++) if (Math.abs(fa[i] - fb[i]) > 1e-9) return fa[i] - fb[i];
        return a.id - b.id;
      })
      .map((p) => p.id);
  // reading: greedy rows by vertical center
  const rows: { top: number; bottom: number; ids: number[] }[] = [];
  for (const p of [...parts].sort((a, b) => a.bbox.y + a.bbox.h / 2 - (b.bbox.y + b.bbox.h / 2))) {
    const cy = p.bbox.y + p.bbox.h / 2;
    const row = rows.find((r) => cy >= r.top && cy <= r.bottom);
    if (row) {
      row.ids.push(p.id);
      row.top = Math.min(row.top, p.bbox.y);
      row.bottom = Math.max(row.bottom, p.bbox.y + p.bbox.h);
    } else rows.push({ top: p.bbox.y, bottom: p.bbox.y + p.bbox.h, ids: [p.id] });
  }
  rows.sort((a, b) => a.top - b.top);
  const reading = rows.flatMap((r) => r.ids.sort((a, b) => parts[a].bbox.x - parts[b].bbox.x || a - b));
  const angle = (p: Part) => {
    const a = Math.atan2(p.centroid[0] - centroid[0], -(p.centroid[1] - centroid[1]));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return {
    leftToRight: by((p) => [p.bbox.x, p.bbox.y]),
    topToBottom: by((p) => [p.bbox.y, p.bbox.x]),
    reading,
    bySizeDesc: by((p) => [-p.area]),
    radialOut: by((p) => [Math.hypot(p.centroid[0] - centroid[0], p.centroid[1] - centroid[1])]),
    angular: by((p) => [angle(p)]),
    document: ids,
    byColor: by((p) => [paletteIndexOf(p.fill), p.bbox.x]),
  };
};

const computePalette = (parts: Part[]): { palette: LogoAnalysis["palette"]; indexOf: (hex: string) => number } => {
  const weights = new Map<string, number>();
  for (const p of parts) weights.set(p.fill, (weights.get(p.fill) ?? 0) + Math.max(p.area, 1e-9));
  const entries = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const clusters: { hex: string; lab: [number, number, number]; weight: number; members: string[] }[] = [];
  for (const [hex, w] of entries) {
    const lab = oklab(hex);
    const hit = clusters.find((c) => labDist(c.lab, lab) < 0.04);
    if (hit) {
      hit.weight += w;
      hit.members.push(hex);
    } else clusters.push({ hex, lab, weight: w, members: [hex] });
  }
  const total = clusters.reduce((s, c) => s + c.weight, 0) || 1;
  const chroma = (c: { lab: [number, number, number] }) => Math.hypot(c.lab[1], c.lab[2]);
  const chromatic = clusters.filter((c) => chroma(c) >= 0.04);
  const primary = chromatic[0] ?? clusters[0];
  const palette = clusters.map((c) => ({
    hex: c.hex,
    weight: r2(c.weight / total, 4),
    role: (c === primary ? "primary" : chroma(c) >= 0.04 ? "accent" : c.lab[0] < 0.6 ? "dark" : "light") as PaletteRole,
  }));
  const indexOf = (hex: string) => clusters.findIndex((c) => c.members.includes(hex));
  return { palette, indexOf };
};

type Raster = { w: number; h: number; data: Uint8Array };

/** Rasterize parts into a small mask (each part evenodd over its own subpaths; parts OR-ed). */
const rasterize = (parts: (Part & { _subs: Sub[] })[], box: BBox, size = 96): Raster => {
  const scale = size / Math.max(box.w, box.h, 1e-9);
  const w = Math.max(1, Math.round(box.w * scale)), h = Math.max(1, Math.round(box.h * scale));
  const data = new Uint8Array(w * h);
  for (const p of parts) {
    if (p.strokeOnly) {
      const r = ((p.strokeWidth ?? 1) / 2) * scale;
      const poly = p._subs[0].poly.map(([x, y]) => [(x - box.x) * scale, (y - box.y) * scale] as Pt);
      const n = p._subs[0].closed ? poly.length : poly.length - 1;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r));
        const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r));
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const px = x + 0.5, py = y + 0.5;
            const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
            if (Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)) <= Math.max(r, 0.5)) data[y * w + x] = 1;
          }
      }
      continue;
    }
    const polys = p._subs.map((s) => s.poly.map(([x, y]) => [(x - box.x) * scale, (y - box.y) * scale] as Pt));
    for (let y = 0; y < h; y++) {
      const py = y + 0.5;
      const xs: number[] = [];
      for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if (yi > py !== yj > py) xs.push(xi + ((py - yi) * (xj - xi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) data[y * w + x] = 1;
      }
    }
  }
  return { w, h, data };
};

const symmetryOf = (r: Raster): "x" | "y" | "radial" | null => {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.data[y * r.w + x]) { n++; sx += x + 0.5; sy += y + 0.5; }
  if (n < 20) return null;
  const cx = sx / n, cy = sy / n;
  const at = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    return xi >= 0 && yi >= 0 && xi < r.w && yi < r.h ? r.data[yi * r.w + xi] : 0;
  };
  const iou = (map: (x: number, y: number) => [number, number]) => {
    let inter = 0, uni = 0;
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const a = r.data[y * r.w + x];
        const [mx, my] = map(x + 0.5, y + 0.5);
        const b = at(mx, my);
        if (a && b) inter++;
        if (a || b) uni++;
      }
    return uni ? inter / uni : 0;
  };
  // mirror about the best of: mask centroid / raster center (the raster is fitted to the bbox, so its center is pixel-exact)
  const ix = Math.max(iou((x, y) => [2 * cx - x, y]), iou((x, y) => [r.w - x, y]));
  const iy = Math.max(iou((x, y) => [x, 2 * cy - y]), iou((x, y) => [x, r.h - y]));
  let ir = 0;
  for (const k of [3, 4, 5, 6, 8]) {
    const a = (2 * Math.PI) / k, c = Math.cos(a), s = Math.sin(a);
    ir = Math.max(ir, iou((x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]));
  }
  if (ir >= 0.88) return "radial";
  // "x" = mirror left↔right (vertical axis), "y" = mirror top↔bottom; both → "x" (the one a split reveal uses)
  if (ix >= 0.9) return "x";
  if (iy >= 0.9) return "y";
  return null;
};

const computeKit = (parts: (Part & { _subs: Sub[] })[], symParts: (Part & { _subs: Sub[] })[], maxDim: number): LogoAnalysis["kit"] => {
  // stroke weight
  const strokeWs = parts.filter((p) => p.strokeOnly).map((p) => p.strokeWidth ?? 0);
  let strokeWeight: number;
  if (strokeWs.length) strokeWeight = median(strokeWs);
  else {
    const thin = parts.filter((p) => p.thinness > 0.4);
    const use = thin.length ? thin : parts;
    strokeWeight = median(use.map((p) => (p.length > 0 ? (2 * p.area) / p.length : 0)));
  }

  // corners + angles from straight segments
  const radii: number[] = [];
  let sharp = 0;
  const hist = new Float64Array(180);
  let straightTotal = 0;
  const minLen = maxDim * 0.02;
  const dir = (a: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [0, 0];
  };
  const turn = (u: Pt, v: Pt) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  const cornerSet = new Set(symParts.map((p) => p.id)); // corners: the icon's language, not the typeface's
  for (const p of parts) {
    const countCorners = cornerSet.has(p.id);
    for (const s of p._subs) {
      let segs = s.segs;
      const last = segs[segs.length - 1].p;
      if (s.closed && Math.hypot(last[0] - s.start[0], last[1] - s.start[1]) > 1e-9) segs = [...segs, { t: "L", p: s.start }];
      const startOf = (i: number): Pt => (i === 0 ? s.start : segs[i - 1].p);
      const n = segs.length;
      const inDir = (i: number): Pt => {
        const g = segs[i], a = startOf(i);
        if (g.t === "L") return dir(a, g.p);
        if (g.t === "C") return Math.hypot(g.c1[0] - a[0], g.c1[1] - a[1]) > 1e-9 ? dir(a, g.c1) : dir(a, g.c2);
        return dir(a, g.c);
      };
      const outDir = (i: number): Pt => {
        const g = segs[i], a = startOf(i);
        if (g.t === "L") return dir(a, g.p);
        if (g.t === "C") return Math.hypot(g.p[0] - g.c2[0], g.p[1] - g.c2[1]) > 1e-9 ? dir(g.c2, g.p) : dir(g.c1, g.p);
        return dir(g.c, g.p);
      };
      for (let i = 0; i < n; i++) {
        const g = segs[i];
        const a = startOf(i);
        if (g.t === "L") {
          const l = Math.hypot(g.p[0] - a[0], g.p[1] - a[1]);
          if (l >= minLen) {
            let ang = (Math.atan2(g.p[1] - a[1], g.p[0] - a[0]) * 180) / Math.PI;
            ang = ((Math.round(ang) % 180) + 180) % 180;
            hist[ang] += l;
            straightTotal += l;
          }
        }
        const hasPrev = s.closed || i > 0, hasNext = s.closed || i < n - 1;
        if (!countCorners || !hasPrev || !hasNext) continue;
        const pi = (i - 1 + n) % n, ni = (i + 1) % n;
        if (g.t === "L" && segs[ni].t === "L") {
          if ((turn(outDir(i), inDir(ni)) * 180) / Math.PI > 25) sharp++;
        } else if (g.t !== "L" && segs[pi].t === "L" && segs[ni].t === "L") {
          const u = outDir(pi), v = inDir(ni);
          const th = turn(u, v);
          const g1 = (turn(u, inDir(i)) * 180) / Math.PI < 15 && (turn(outDir(i), v) * 180) / Math.PI < 15;
          const deg = (th * 180) / Math.PI;
          if (g1 && deg > 15 && deg < 170) {
            const chord = Math.hypot(g.p[0] - a[0], g.p[1] - a[1]);
            radii.push(chord / (2 * Math.sin(th / 2)));
          }
        }
      }
    }
  }
  const cornerRadius = radii.length > sharp ? median(radii) : 0;

  // dominant angles: smoothed histogram peaks with ±5° suppression
  const angles: number[] = [];
  if (straightTotal > 0) {
    const sm = new Float64Array(180);
    for (let a = 0; a < 180; a++) for (let k = -2; k <= 2; k++) sm[a] += hist[(a + k + 180) % 180];
    const used = new Uint8Array(180);
    for (let iter = 0; iter < 4; iter++) {
      let best = -1;
      for (let a = 0; a < 180; a++) if (!used[a] && (best < 0 || sm[a] > sm[best])) best = a;
      if (best < 0 || sm[best] < 0.1 * straightTotal) break;
      // refine to the weighted mean of the raw histogram around the smoothed peak
      let wsum = 0, asum = 0;
      for (let k = -2; k <= 2; k++) {
        const w = hist[(best + k + 180) % 180];
        wsum += w;
        asum += (best + k) * w;
      }
      angles.push(wsum > 0 ? ((Math.round(asum / wsum) % 180) + 180) % 180 : best);
      for (let k = -5; k <= 5; k++) used[(best + k + 180) % 180] = 1;
    }
  }

  let symmetry: LogoAnalysis["kit"]["symmetry"] = null;
  if (symParts.length) {
    const box = unionBBox(symParts);
    symmetry = symmetryOf(rasterize(symParts, box));
  }
  return { strokeWeight: r2(strokeWeight, 3), cornerRadius: r2(cornerRadius, 3), angles, symmetry };
};

const unionBBox = (parts: { bbox: BBox }[]): BBox => {
  if (!parts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...parts.map((p) => p.bbox.x)), y0 = Math.min(...parts.map((p) => p.bbox.y));
  const x1 = Math.max(...parts.map((p) => p.bbox.x + p.bbox.w)), y1 = Math.max(...parts.map((p) => p.bbox.y + p.bbox.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// ---------------------------------------------------------------- main

const roundBox = (b: BBox, dec: number): BBox => ({ x: r2(b.x, dec), y: r2(b.y, dec), w: r2(b.w, dec), h: r2(b.h, dec) });

/** Analyze SVG markup. `source` is recorded as-is (e.g. "assets/logo.svg"). */
export const analyzeLogoSvg = (svg: string, source: string): LogoAnalysis => {
  const warnings: string[] = [];
  let root: INode;
  try {
    root = parseSync(svg);
  } catch (e) {
    throw new Error(`Could not parse SVG ${source}: ${(e as Error).message}`);
  }
  if (localName(root.name) !== "svg") {
    const inner = (root.children ?? []).find((c) => localName(c.name) === "svg");
    if (!inner) throw new Error(`${source} has no <svg> root element`);
    root = inner;
  }
  const { drawables, viewBox: vb0 } = collectDrawables(root, warnings);
  let vb = vb0;
  // precision from the viewBox size (fallback 1000 until we know it)
  const dec0 = Math.max(vb[2], vb[3]) > 0 && Math.max(vb[2], vb[3]) < 100 ? 3 : 2;
  const raw = buildParts(drawables, vb[2] > 0 ? vb : [0, 0, 1000, 1000], dec0, warnings);
  if (!(vb[2] > 0 && vb[3] > 0)) {
    const b = unionBBox(raw);
    vb = [b.x, b.y, b.w || 1, b.h || 1];
    warnings.push("SVG has no viewBox/width/height; using the drawing's bounding box");
  }
  const dec = Math.max(vb[2], vb[3]) < 100 ? 3 : 2;
  const mDec = dec; // metric rounding

  // assemble parts (ids in document order)
  const holes: LogoAnalysis["holes"] = [];
  const parts: (Part & { _subs: Sub[] })[] = raw.map((rp, id) => {
    const holeIds: number[] = [];
    const outerArea = Math.abs(rp.outer.area);
    for (const h of rp.holes) {
      holeIds.push(holes.length);
      holes.push({ partId: id, d: subToD({ ...h, closed: true }, dec), areaRatio: r2(outerArea > 0 ? Math.abs(h.area) / outerArea : 0, 4) });
    }
    const { outer, holes: hs, srcIndex: _s, ...rest } = rp;
    return { id, ...rest, holeIds, kind: "shape" as const, _subs: [outer, ...hs] };
  });

  // painted ("fake") counters: a white shape drawn on top of an earlier shape instead of a real hole
  for (const p of parts) {
    const c = parseColor(p.fill);
    if (!c || Math.min(c.r, c.g, c.b) < 240 || p.strokeOnly) continue;
    const under = parts.find(
      (q) =>
        q.id < p.id &&
        !q.strokeOnly &&
        q.area > p.area &&
        p.bbox.x >= q.bbox.x - 1e-6 && p.bbox.y >= q.bbox.y - 1e-6 &&
        p.bbox.x + p.bbox.w <= q.bbox.x + q.bbox.w + 1e-6 && p.bbox.y + p.bbox.h <= q.bbox.y + q.bbox.h + 1e-6 &&
        pointInPoly(p.centroid, q._subs[0].poly),
    );
    if (under) warnings.push(`part ${p.id} (${p.fill}) is painted on top of part ${under.id} as a fake counter; it stays ${p.fill} on any background (use the logo layer's color override or a light background)`);
  }

  const glyphSet = detectWordmark(parts);
  for (const p of parts) if (glyphSet.has(p.id)) p.kind = "glyph";
  const groups = { icon: parts.filter((p) => p.kind === "shape").map((p) => p.id), wordmark: parts.filter((p) => p.kind === "glyph").map((p) => p.id) };

  const totalArea = parts.reduce((s, p) => s + p.area, 0);
  const bbox = unionBBox(parts);
  const centroid: Pt =
    totalArea > 0
      ? [parts.reduce((s, p) => s + p.centroid[0] * p.area, 0) / totalArea, parts.reduce((s, p) => s + p.centroid[1] * p.area, 0) / totalArea]
      : [bbox.x + bbox.w / 2, bbox.y + bbox.h / 2];

  const { palette, indexOf } = computePalette(parts);
  const orders = computeOrders(parts, centroid, indexOf);
  const symParts = groups.icon.length && groups.wordmark.length ? parts.filter((p) => p.kind === "shape") : parts;
  const kit = computeKit(parts, symParts, Math.max(vb[2], vb[3]));
  if (!parts.length) warnings.push("no visible shapes found");

  const outParts: Part[] = parts.map(({ _subs, ...p }) => ({
    ...p,
    area: r2(p.area, mDec),
    bbox: roundBox(p.bbox, mDec),
    centroid: [r2(p.centroid[0], mDec), r2(p.centroid[1], mDec)],
    circularity: r2(p.circularity, 4),
    thinness: r2(p.thinness, 4),
    length: r2(p.length, mDec),
  }));

  const analysis: LogoAnalysis = {
    version: 1,
    source,
    viewBox: [vb[0], vb[1], vb[2], vb[3]],
    width: vb[2],
    height: vb[3],
    parts: outParts,
    groups,
    orders,
    palette,
    kit,
    holes,
    bbox: roundBox(bbox, mDec),
    centroid: [r2(centroid[0], mDec), r2(centroid[1], mDec)],
    unionD: outParts.map((p) => p.d).join(""),
  };
  const uniq = [...new Set(warnings)];
  if (uniq.length) analysis.warnings = uniq;
  return analysis;
};

// ---------------------------------------------------------------- files / cache

export const logoJsonPath = (assetAbs: string) => `${assetAbs}.logo.json`;
export const isLogoJson = (file: string) => file.endsWith(".logo.json");

/** Analyze an .svg file and write `<file>.logo.json` next to it. */
export const analyzeLogoFile = (assetAbs: string, source: string): LogoAnalysis => {
  const svg = fs.readFileSync(assetAbs, "utf8");
  const analysis = analyzeLogoSvg(svg, source);
  const out = logoJsonPath(assetAbs);
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(analysis) + "\n");
  fs.renameSync(tmp, out);
  return analysis;
};

/** Cached analysis (re-analyzes when the SVG is newer than the JSON, or when forced). */
export const ensureLogoAnalysis = (assetAbs: string, source: string, opts: { force?: boolean } = {}): LogoAnalysis => {
  const out = logoJsonPath(assetAbs);
  if (!opts.force && fs.existsSync(out)) {
    try {
      if (fs.statSync(out).mtimeMs >= fs.statSync(assetAbs).mtimeMs) {
        const j = JSON.parse(fs.readFileSync(out, "utf8")) as LogoAnalysis;
        if (j.version === 1 && Array.isArray(j.parts) && j.source === source) return j;
      }
    } catch {
      /* re-analyze */
    }
  }
  return analyzeLogoFile(assetAbs, source);
};

// ---------------------------------------------------------------- decision framework (§1.4)

export type LogoMode = (typeof LOGO_MODES)[number];
export type LogoModeSuggestion = { mode: LogoMode; score: number; reasons: string[]; order?: LogoOrder; parts?: "all" | "icon" | "wordmark" };
export type LogoBrief = { verb?: string; values?: string[]; industry?: string };

/** How well a part matches a primitive (circle / ring / rect / capsule), 0..1. */
export const primitiveFit = (p: Part): { type: "circle" | "ring" | "rect" | "capsule"; score: number } => {
  const { w, h } = p.bbox;
  const aspect = Math.min(w, h) / Math.max(w, h, 1e-9);
  // circularity: circle 1, square 0.785, hexagon 0.91 → only near-circles score
  const circle = aspect > 0.85 ? Math.max(0, (p.circularity - 0.8) / 0.2) : 0;
  if (p.strokeOnly) return { type: "circle", score: circle };
  const fits: { type: "circle" | "ring" | "rect" | "capsule"; score: number }[] = [];
  if (p.holeIds.length === 0) {
    fits.push({ type: "circle", score: circle });
    fits.push({ type: "rect", score: Math.min(1, p.area / Math.max(w * h, 1e-9)) });
    const r = Math.min(w, h) / 2;
    const capArea = w * h - (4 - Math.PI) * r * r;
    fits.push({ type: "capsule", score: aspect < 0.85 ? Math.max(0, 1 - Math.abs(p.area / Math.max(capArea, 1e-9) - 1) * 4) : 0 });
  } else if (p.holeIds.length === 1) fits.push({ type: "ring", score: circle });
  return fits.sort((a, b) => b.score - a.score)[0] ?? { type: "rect", score: 0 };
};

const MEANING: { re: RegExp; modes: [LogoMode, number][]; why: string }[] = [
  { re: /connect|together|community|unite|join|team|social|collab/, modes: [["assemble", 1.5]], why: "connect/together → parts converge" },
  { re: /grow|sprout|build|rise|learn/, modes: [["draw", 1], ["build", 1]], why: "grow → draw/build up" },
  { re: /fast|speed|quick|deliver|ship|move|logistic|travel/, modes: [["trace", 1.5], ["mask", 0.5]], why: "speed → trace a route / slit mask" },
  { re: /secure|solid|safe|protect|trust|bank|strong/, modes: [["build", 0.5], ["mask", 0.5]], why: "secure/solid → measured build or mask" },
  { re: /play|fun|kid|joy|friendly|bounce/, modes: [["build", 1], ["liquid", 1], ["pop", 1]], why: "playful → bouncy build / gooey" },
  { re: /luxury|premium|elegant|calm|craft|fashion|jewel/, modes: [["mask", 1.5], ["draw", 1]], why: "luxury → slow mask/light sweep, fine draw" },
  { re: /tech|ai|digital|data|cyber|game|signal|crypto|code|dev/, modes: [["glitch", 1.5], ["assemble", 0.5]], why: "tech/AI → glitch resolve, particles→logo" },
  { re: /food|drink|coffee|juice|beverage|liquid|flow|water|brew/, modes: [["liquid", 1.5], ["morph-from", 1]], why: "food/drink → liquid fill, morph from ingredient" },
  { re: /fintech|finance|pay/, modes: [["build", 1], ["mask", 1]], why: "fintech prior → build/mask" },
  { re: /media|film|stream|news|music|video|content|creator/, modes: [["window", 1], ["cascade", 1]], why: "media prior → window/cascade" },
  { re: /saas|software|platform|app|productivity/, modes: [["assemble", 1]], why: "SaaS prior → assemble" },
  { re: /transform|change|become|evolve/, modes: [["morph-from", 1.5]], why: "transform → morph" },
  { re: /open|reveal|discover|explore/, modes: [["split", 1], ["window", 0.5]], why: "open → split / iris" },
];

/**
 * Rank LOGO_MODES for this logo (research §1.4). Geometry-driven always; meaning-driven when a brief is given.
 * Ties break toward fewer moving parts.
 */
export const suggestLogoModes = (a: LogoAnalysis, brief: LogoBrief = {}): LogoModeSuggestion[] => {
  const score = new Map<LogoMode, { s: number; why: string[] }>(LOGO_MODES.map((m) => [m, { s: 0, why: [] }]));
  const add = (m: LogoMode, s: number, why: string) => {
    const e = score.get(m)!;
    e.s += s;
    e.why.push(`${s >= 0 ? "+" : ""}${s} ${why}`);
  };
  const parts = a.parts;
  const icon = a.groups.icon.map((i) => parts[i]);
  const glyphs = a.groups.wordmark.length;
  const subpaths = parts.reduce((s, p) => s + 1 + p.holeIds.length, 0);
  const totalArea = parts.reduce((s, p) => s + p.area, 0) || 1;
  const strokeOnly = parts.filter((p) => p.strokeOnly).length;
  const meanThin = parts.length ? parts.reduce((s, p) => s + p.thinness * p.area, 0) / totalArea : 0;

  // baseline: mask works for anything
  add("mask", 1, "works for any logo (wipe / iris / light sweep)");
  add("pop", 0.5, "simple, always renderable");
  add("glitch", 0.25, "any logo can glitch-resolve (stronger for tech brands)");

  // DRAW
  if (strokeOnly >= parts.length / 2 && strokeOnly > 0) add("draw", 2.5, `${strokeOnly}/${parts.length} parts are stroked lines (monoline)`);
  else if (meanThin > 0.6) add("draw", 2, `outline-y shapes (area-weighted thinness ${meanThin.toFixed(2)} > 0.6)`);
  else if (meanThin > 0.45) add("draw", 0.75, `moderately thin shapes (thinness ${meanThin.toFixed(2)})`);
  if (subpaths > 40) add("draw", -1, `${subpaths} subpaths is a lot to draw one by one`);

  // TRACE
  const longThin = parts.filter((p) => p.thinness > 0.8 && p.length > 0.8 * Math.max(a.bbox.w, a.bbox.h));
  if (longThin.length) add("trace", 1, `${longThin.length} long stroke-like part(s) a dot/route can travel along`);
  if (parts.some((p) => p.strokeOnly && !/Z$/i.test(p.d.trim()))) add("trace", 0.5, "open stroked paths (a route)");

  // BUILD (primitives)
  const iconOrAll = icon.length ? icon : parts;
  const fits = iconOrAll.map(primitiveFit);
  const primScore = fits.length ? fits.reduce((s, f) => s + f.score, 0) / fits.length : 0;
  if (primScore > 0.7) add("build", 2, `parts are primitives (${[...new Set(fits.filter((f) => f.score > 0.7).map((f) => f.type))].join("/")}; fit ${primScore.toFixed(2)})`);
  else if (primScore > 0.55) add("build", 1, `parts are roughly primitive (fit ${primScore.toFixed(2)})`);

  // ASSEMBLE
  const islands = iconOrAll.length;
  if (islands >= 3) {
    const areas = iconOrAll.map((p) => p.area).sort((x, y) => x - y);
    const ratio = areas[areas.length - 1] / Math.max(areas[0], 1e-9);
    const similar = ratio < 4;
    add("assemble", similar ? 2 : 1, `${islands} separable ${icon.length ? "icon " : ""}islands${similar ? " of similar size" : ""}`);
  }
  if (subpaths > 40) add("assemble", -1, `complexity budget: ${subpaths} subpaths (> 40)`);

  // NEGATIVE SPACE → window
  const bigHoles = a.holes.filter((h) => h.areaRatio > 0.08);
  if (bigHoles.length) add("window", 1, `${bigHoles.length} meaningful hole(s)/counter(s) (> 8% of their shape) — push through the counter or animate an object into it`);
  const biggest = [...parts].sort((x, y) => y.area - x.area)[0];
  if (biggest && biggest.area / totalArea > 0.6 && biggest.circularity > 0.5 && !biggest.strokeOnly) add("window", 1, "one large closed shape that can hold footage");

  // CASCADE
  if (glyphs >= 3) {
    if (!icon.length) add("cascade", 2.5, `wordmark-only logo (${glyphs} glyphs)`);
    else add("cascade", 1.25, `wordmark present (${glyphs} glyphs) — use as the secondary beat after the icon`);
  }

  // MORPH-FROM: single compact silhouette
  if (icon.length >= 1 && icon.length <= 2) {
    const ib = icon.reduce((s, p) => s + p.area, 0);
    const main = [...icon].sort((x, y) => y.area - x.area)[0];
    if (main.area / Math.max(ib, 1e-9) > 0.7 && !main.strokeOnly) add("morph-from", 2, "single compact icon silhouette (pick a concept object that rhymes with it for `from`)");
  } else if (!icon.length && parts.length <= 2) add("morph-from", 1.5, "single compact silhouette");
  if (subpaths > 40) add("morph-from", -2, `complexity budget: ${subpaths} subpaths (> 40 animated subpaths for morph)`);

  // LIQUID
  const rounded = a.kit.cornerRadius > 0 || iconOrAll.reduce((s, p) => s + p.circularity, 0) / Math.max(1, iconOrAll.length) > 0.6;
  if (rounded) add("liquid", 1, "rounded shapes suit a gooey/liquid fill");
  if (a.palette.length === 1) add("liquid", 0.5, "single colour (gooey filter bleeds colours)");

  // SPLIT
  if (a.kit.symmetry) add("split", 1, `symmetric (${a.kit.symmetry}) — halves can slide together`);

  if (subpaths > 40) add("mask", 1.5, `fallback for complex logos (${subpaths} subpaths)`);

  // meaning-driven
  const words = [brief.verb ?? "", ...(brief.values ?? []), brief.industry ?? ""].join(" ").toLowerCase();
  if (words.trim()) for (const rule of MEANING) if (rule.re.test(words)) for (const [m, s] of rule.modes) add(m, s, rule.why);

  // fewer moving parts wins ties
  const moving: Record<LogoMode, number> = {
    mask: 1, pop: 1, glitch: 1, split: 2, window: 1, liquid: 1, "morph-from": 2, trace: 2,
    draw: parts.length, build: parts.length, assemble: parts.length, cascade: glyphs || parts.length,
  };
  const orderFor: Partial<Record<LogoMode, LogoOrder>> = {
    draw: "reading", build: "bySizeDesc", assemble: "radialOut", cascade: "leftToRight", pop: "bySizeDesc", trace: "document",
  };
  return [...score.entries()]
    .map(([mode, e]) => ({
      mode,
      score: r2(e.s, 2),
      reasons: e.why,
      ...(orderFor[mode] ? { order: orderFor[mode] } : {}),
      ...(mode === "cascade" && icon.length ? { parts: "wordmark" as const } : {}),
    }))
    .sort((x, y) => y.score - x.score || moving[x.mode] - moving[y.mode]);
};

/** Compact, AI-readable summary (for add_asset / analyze_logo). */
export const logoSummary = (a: LogoAnalysis, brief: LogoBrief = {}, jsonPath?: string) => {
  const modes = suggestLogoModes(a, brief);
  const subpaths = a.parts.reduce((s, p) => s + 1 + p.holeIds.length, 0);
  return {
    source: a.source,
    analysis: jsonPath,
    viewBox: a.viewBox,
    parts: a.parts.length,
    subpaths,
    strokeOnlyParts: a.parts.filter((p) => p.strokeOnly).length,
    groups: { icon: a.groups.icon, wordmark: a.groups.wordmark },
    holes: a.holes.map((h) => ({ partId: h.partId, areaRatio: h.areaRatio })),
    palette: a.palette,
    kit: a.kit,
    ...(a.groups.wordmark.length >= 3 && a.groups.icon.length
      ? { secondaryBeat: { mode: "cascade", parts: "wordmark", order: "leftToRight", why: "reveal the icon with the top mode (parts: \"icon\"), then cascade the wordmark in a second logo layer" } }
      : {}),
    suggestedModes: modes.slice(0, 5).map((m) => ({ mode: m.mode, score: m.score, ...(m.order ? { order: m.order } : {}), ...(m.parts ? { parts: m.parts } : {}), why: m.reasons.join("; ") })),
    orders: LOGO_ORDERS,
    ...(a.warnings?.length ? { warnings: a.warnings } : {}),
  };
};

// ---------------------------------------------------------------- preview image

/** A point inside the part (centroid if it is inside, else the middle of the widest span on the centroid's row). */
const labelPoint = (p: Part): Pt => {
  const polys = parseAbsPath(p.d).map((r) => flattenSub({ ...r, closed: true }, Math.max(p.bbox.w, p.bbox.h) / 50 || 1).poly);
  const inside = (pt: Pt) => polys.reduce((n, poly) => n + (pointInPoly(pt, poly) ? 1 : 0), 0) % 2 === 1;
  if (p.strokeOnly || !polys.length || inside(p.centroid)) return p.centroid;
  let best: Pt = p.centroid, bestW = -1;
  for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const y = p.bbox.y + p.bbox.h * fy;
    const xs: number[] = [];
    for (const poly of polys)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > bestW) { bestW = xs[k + 1] - xs[k]; best = [(xs[k] + xs[k + 1]) / 2, y]; }
    if (bestW > 0) break;
  }
  return best;
};

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** SVG with every part colored by its position in `order` (red → violet) and labelled with its id. */
export const logoPreviewSvg = (a: LogoAnalysis, order: LogoOrder = "document", size = 768): string => {
  const b = a.bbox.w > 0 ? a.bbox : { x: a.viewBox[0], y: a.viewBox[1], w: a.viewBox[2], h: a.viewBox[3] };
  const pad = Math.max(b.w, b.h) * 0.06;
  const vx = b.x - pad, vy = b.y - pad, vw = b.w + 2 * pad, vh = b.h + 2 * pad;
  const W = vw >= vh ? size : Math.round((size * vw) / vh);
  const H = vw >= vh ? Math.round((size * vh) / vw) : size;
  const ord = a.orders[order] ?? a.orders.document;
  const n = Math.max(1, ord.length - 1);
  const rank = new Map(ord.map((id, i) => [id, i]));
  const unit = vw / W; // viewBox units per pixel
  const font = Math.max(10, Math.min(22, size / 40)) * unit;
  const shapes = a.parts
    .map((p) => {
      const hue = Math.round((280 * (rank.get(p.id) ?? 0)) / n);
      const col = `hsl(${hue},80%,50%)`;
      const outline = p.kind === "glyph" ? ` stroke="#000" stroke-width="${unit * 1.5}" stroke-dasharray="${unit * 4} ${unit * 3}"` : "";
      return p.strokeOnly
        ? `<path d="${esc(p.d)}" fill="none" stroke="${col}" stroke-width="${p.strokeWidth ?? unit * 2}" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="${esc(p.d)}" fill="${col}" fill-rule="evenodd"${outline}/>`;
    })
    .join("");
  const labels = a.parts
    .map((p) => [p, labelPoint(p)] as const)
    .map(
      ([p, lp]) =>
        `<text x="${lp[0]}" y="${lp[1] + font * 0.35}" font-size="${font}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="${font * 0.18}" paint-order="stroke">${p.id}</text>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${vx} ${vy} ${vw} ${vh}">` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#f2f2f2"/>${shapes}${labels}</svg>`
  );
};

/** Rasterize the preview with ffmpeg's librsvg decoder (PNG buffer). Throws if ffmpeg lacks librsvg. */
export const renderLogoPreviewPng = async (a: LogoAnalysis, order: LogoOrder = "document", size = 768): Promise<Buffer> => {
  const tmp = path.join(os.tmpdir(), `ms-logo-${crypto.randomBytes(6).toString("hex")}.svg`);
  fs.writeFileSync(tmp, logoPreviewSvg(a, order, size));
  try {
    return await runBinary("ffmpeg", ["-v", "error", "-i", tmp, "-frames:v", "1", "-f", "image2", "-c:v", "png", "-"]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
};
