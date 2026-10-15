/**
 * Hand-built primitive + concept-object library: smooth cubic outlines in a 1000×1000 box, centered,
 * optically balanced (~800 box), holes wound opposite to their outers (renders identically with
 * nonzero/evenodd). These are morph sources for brand stories (bean → cup → logo …).
 *
 * Shapes are generated once at module load from a small builder (arcs, rounded polygons,
 * Catmull-Rom ribbons) so curves stay smooth and every shape is pure M/C/Z data.
 */
import { type GPath, type Pt, type Sub, catmull, lineCubic, mapPath, orientPath, pathBBox, ribbon, toD } from "./geom";

// ---------------------------------------------------------------------------------------------
// builder

const rad = (deg: number) => (deg * Math.PI) / 180;

class Pen {
  subs: GPath = [];
  private cur: Sub | null = null;
  private pos: Pt = [0, 0];
  M(x: number, y: number) {
    this.cur = { start: [x, y], curves: [] };
    this.subs.push(this.cur);
    this.pos = [x, y];
    return this;
  }
  L(x: number, y: number) {
    if (Math.hypot(x - this.pos[0], y - this.pos[1]) < 1e-9) return this;
    this.cur!.curves.push(lineCubic(this.pos, [x, y]));
    this.pos = [x, y];
    return this;
  }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.cur!.curves.push([x1, y1, x2, y2, x, y]);
    this.pos = [x, y];
    return this;
  }
  /** Elliptical arc around (cx,cy) from angle a0 to a1 (degrees, any sign of sweep). Moves (L) to the start if needed. */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
    const sx = cx + rx * Math.cos(rad(a0)), sy = cy + ry * Math.sin(rad(a0));
    if (!this.cur) this.M(sx, sy);
    else this.L(sx, sy);
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
    for (let i = 0; i < n; i++) {
      const t0 = rad(a0 + ((a1 - a0) * i) / n), t1 = rad(a0 + ((a1 - a0) * (i + 1)) / n);
      const k = (4 / 3) * Math.tan((t1 - t0) / 4);
      const p0: Pt = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)];
      const p3: Pt = [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)];
      this.C(
        p0[0] - k * rx * Math.sin(t0), p0[1] + k * ry * Math.cos(t0),
        p3[0] + k * rx * Math.sin(t1), p3[1] - k * ry * Math.cos(t1),
        p3[0], p3[1],
      );
    }
    return this;
  }
  Z() {
    if (this.cur) {
      const s = this.cur.start;
      this.L(s[0], s[1]);
    }
    this.cur = null;
    return this;
  }
  add(...subs: Sub[]) {
    this.subs.push(...subs);
    return this;
  }
}

const circle = (cx: number, cy: number, r: number): Sub => new Pen().arc(cx, cy, r, r, 0, 360).Z().subs[0];
const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0): Sub => {
  const s = new Pen().arc(0, 0, rx, ry, 0, 360).Z().subs[0];
  const c = Math.cos(rad(rot)), si = Math.sin(rad(rot));
  return mapPath([s], (x, y) => [cx + x * c - y * si, cy + x * si + y * c])[0];
};

/** Polygon with rounded corners; r = fillet length cut back along each edge (number or per-vertex). */
const roundedPoly = (pts: Pt[], r: number | number[]): Sub => {
  const n = pts.length;
  const K = 0.5523;
  const corner = (i: number) => {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ri = Math.max(0, Math.min(Array.isArray(r) ? r[i] : r, la * 0.5, lb * 0.5));
    const ua: Pt = [(a[0] - p[0]) / la, (a[1] - p[1]) / la], ub: Pt = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    return {
      inP: [p[0] + ua[0] * ri, p[1] + ua[1] * ri] as Pt,
      outP: [p[0] + ub[0] * ri, p[1] + ub[1] * ri] as Pt,
      c1: [p[0] + ua[0] * ri * (1 - K), p[1] + ua[1] * ri * (1 - K)] as Pt,
      c2: [p[0] + ub[0] * ri * (1 - K), p[1] + ub[1] * ri * (1 - K)] as Pt,
      ri,
    };
  };
  const cs = pts.map((_, i) => corner(i));
  const pen = new Pen().M(cs[0].outP[0], cs[0].outP[1]);
  for (let k = 1; k <= n; k++) {
    const c = cs[k % n];
    pen.L(c.inP[0], c.inP[1]);
    if (c.ri > 1e-9) pen.C(c.c1[0], c.c1[1], c.c2[0], c.c2[1], c.outP[0], c.outP[1]);
  }
  return pen.Z().subs[0];
};

const roundedRect = (x: number, y: number, w: number, h: number, r: number | number[]): Sub =>
  roundedPoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r);

const superellipse = (cx: number, cy: number, rx: number, ry: number, e: number, samples = 72): Sub => {
  const pts: Pt[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pts.push([cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / e)]);
  }
  return catmull(pts);
};

/** Upper (smaller y) intersection of two circles. */
const circleX = (a: [number, number, number], b: [number, number, number], upper = true): Pt => {
  const [x0, y0, r0] = a, [x1, y1, r1] = b;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const l = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - l * l));
  const mx = x0 + (l * (x1 - x0)) / d, my = y0 + (l * (y1 - y0)) / d;
  const p1: Pt = [mx + (h * (y1 - y0)) / d, my - (h * (x1 - x0)) / d];
  const p2: Pt = [mx - (h * (y1 - y0)) / d, my + (h * (x1 - x0)) / d];
  return upper ? (p1[1] < p2[1] ? p1 : p2) : (p1[1] < p2[1] ? p2 : p1);
};
const angOf = (c: [number, number, number], p: Pt) => (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;

const parse = (d: string): Sub[] => {
  // tiny parser for the hand-authored absolute M/C/L/Z strings below
  const pen = new Pen();
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let i = 0;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    const c = tok[i++].toUpperCase();
    if (c === "M") pen.M(num(), num());
    else if (c === "L") pen.L(num(), num());
    else if (c === "C") pen.C(num(), num(), num(), num(), num(), num());
    else if (c === "Z") pen.Z();
  }
  return pen.subs;
};

const mirrorX = (s: Sub, cx: number) => mapPath([s], (x, y) => [2 * cx - x, y])[0];
const mirrorY = (s: Sub, cy: number) => mapPath([s], (x, y) => [x, 2 * cy - y])[0];
const rotSub = (s: Sub, deg: number, cx: number, cy: number) => {
  const c = Math.cos(rad(deg)), si = Math.sin(rad(deg));
  return mapPath([s], (x, y) => [cx + (x - cx) * c - (y - cy) * si, cy + (x - cx) * si + (y - cy) * c])[0];
};

/** Fit to an optical box (max side = size) centered at 500,500 (+ optical offset), orient holes, serialize. */
const finish = (subs: Sub[], size = 800, dx = 0, dy = 0): string => {
  const p = orientPath(subs);
  const b = pathBBox(p);
  const k = size / Math.max(b.w, b.h);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return toD(mapPath(p, (x, y) => [500 + dx + (x - cx) * k, 500 + dy + (y - cy) * k]), 1);
};

// ---------------------------------------------------------------------------------------------
// shapes

const star = (points: number, inner: number, rTip: number, rIn: number) => {
  const pts: Pt[] = [], radii: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rad(-90 + (i * 180) / points);
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    radii.push(i % 2 === 0 ? rTip : rIn);
  }
  return roundedPoly(pts, radii);
};

const capsule = (cx: number, cy: number, len: number, w: number, deg: number) =>
  rotSub(roundedRect(cx - len / 2, cy - w / 2, len, w, w / 2), deg, cx, cy);

const cloud = (): Sub[] => {
  const L: [number, number, number] = [290, 610, 130], M: [number, number, number] = [500, 470, 220], R: [number, number, number] = [720, 590, 150];
  const lm = circleX(L, M), mr = circleX(M, R);
  const norm = (a0: number, a1: number) => (a1 < a0 ? a1 + 360 : a1);
  const pen = new Pen().M(290, 740);
  const aL = angOf(L, lm), aM0 = angOf(M, lm), aM1 = angOf(M, mr), aR = angOf(R, mr);
  pen.arc(L[0], L[1], L[2], L[2], 90, norm(90, aL));
  pen.arc(M[0], M[1], M[2], M[2], aM0 < 90 ? aM0 + 360 : aM0, norm(aM0 < 90 ? aM0 + 360 : aM0, aM1 + 360));
  const r0 = aR < 0 ? aR + 360 : aR;
  pen.arc(R[0], R[1], R[2], R[2], r0, 450);
  pen.L(290, 740).Z();
  return pen.subs;
};

const globe = (): Sub[] => {
  const C = 500, R = 400, ri = 355, h = 20, rxo = 205, rxi = 165;
  const thC = 180 + (Math.asin(h / ri) * 180) / Math.PI;
  const phT = 360 - (Math.acos(-h / rxi) * 180) / Math.PI; // upper-left solution
  const lune = new Pen().M(C, C - ri).arc(C, C, ri, ri, 270, thC).arc(C, C, rxo, ri, thC, 270).Z().subs[0];
  const yTop = C + ri * Math.sin(rad(phT));
  const lens = new Pen().M(C - h, yTop).L(C - h, C - h).arc(C, C, rxi, ri, thC, phT).Z().subs[0];
  const cells: Sub[] = [];
  for (const s of [lune, lens]) {
    cells.push(s, mirrorX(s, C), mirrorY(s, C), mirrorY(mirrorX(s, C), C));
  }
  return [circle(C, C, R), ...cells];
};

const lock = (): Sub[] => {
  const body = roundedRect(180, 440, 640, 440, 70);
  const cx = 500, cy = 420, R = 200, r = 128, legY = 470;
  const shackle = new Pen().M(cx - R, legY).L(cx - R, cy).arc(cx, cy, R, R, 180, 360).L(cx + R, legY).L(cx + r, legY).L(cx + r, cy)
    .arc(cx, cy, r, r, 360, 180).L(cx - r, legY).Z().subs[0];
  const kc = 500, ky = 625, kr = 56, sw = 26;
  const a0 = 90 + (Math.asin(sw / kr) * 180) / Math.PI; // lower-left exit angle
  const key = new Pen().arc(kc, ky, kr, kr, a0, 180 - a0 + 360).L(kc + sw, 765).C(kc + sw, 790, kc - sw, 790, kc - sw, 765).Z().subs[0];
  return [body, shackle, key];
};

const bag = (): Sub[] => {
  const body = roundedPoly([[230, 340], [770, 340], [812, 880], [188, 880]], [36, 36, 70, 70]);
  const cx = 500, cy = 345, R = 165, r = 112, legY = 380;
  const handle = new Pen().M(cx - R, legY).L(cx - R, cy).arc(cx, cy, R, R, 180, 360).L(cx + R, legY).L(cx + r, legY).L(cx + r, cy)
    .arc(cx, cy, r, r, 360, 180).L(cx - r, legY).Z().subs[0];
  return [body, handle, circle(cx - (R + r) / 2, 440, 22), circle(cx + (R + r) / 2, 440, 22)];
};

const moon = (): Sub[] => {
  const A: [number, number, number] = [500, 500, 380], B: [number, number, number] = [680, 380, 310];
  const p = circleX(A, B, true), q = circleX(A, B, false);
  const inB = (x: number, y: number) => Math.hypot(x - B[0], y - B[1]) < B[2];
  const inA = (x: number, y: number) => Math.hypot(x - A[0], y - A[1]) < A[2];
  let a0 = angOf(A, p), a1 = angOf(A, q);
  // pick the arc of A that lies outside B
  let mid = rad((a0 + (a1 < a0 ? a1 + 360 : a1)) / 2);
  if (inB(A[0] + A[2] * Math.cos(mid), A[1] + A[2] * Math.sin(mid))) a1 = a1 > a0 ? a1 - 360 : a1;
  else a1 = a1 < a0 ? a1 + 360 : a1;
  let b0 = angOf(B, q), b1 = angOf(B, p);
  mid = rad((b0 + (b1 < b0 ? b1 + 360 : b1)) / 2);
  if (!inA(B[0] + B[2] * Math.cos(mid), B[1] + B[2] * Math.sin(mid))) b1 = b1 > b0 ? b1 - 360 : b1;
  else b1 = b1 < b0 ? b1 + 360 : b1;
  return new Pen().arc(A[0], A[1], A[2], A[2], a0, a1).arc(B[0], B[1], B[2], B[2], b0, b1).Z().subs;
};

const sun = (): Sub[] => {
  const out: Sub[] = [circle(500, 500, 205)];
  for (let i = 0; i < 8; i++) {
    const a = rad(i * 45 - 90);
    const r0 = 290, r1 = 420, m = (r0 + r1) / 2;
    out.push(capsule(500 + Math.cos(a) * m, 500 + Math.sin(a) * m, r1 - r0, 66, i * 45 - 90));
  }
  return out;
};

const wave = (): Sub[] => {
  const band = (y0: number) => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = 130 + (740 * i) / 40;
      pts.push([x, y0 + 62 * Math.sin(((x - 130) / 370) * Math.PI * 2)]);
    }
    return ribbon(pts, 92);
  };
  return [band(400), band(600)];
};

const spiral = (): Sub[] => {
  const turns = 2.35, r0 = 50, r1 = 395;
  const pts: Pt[] = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * turns * Math.PI * 2;
    const r = r0 + ((r1 - r0) * i) / N;
    pts.push([500 + r * Math.cos(th - Math.PI / 2), 500 + r * Math.sin(th - Math.PI / 2)]);
  }
  const widths = pts.map((_, i) => 46 + (40 * i) / N);
  return [ribbon(pts, widths)];
};

const bean = (): Sub[] => {
  const outer = superellipse(0, 0, 300, 410, 2.15);
  const crease: Pt[] = [], widths: number[] = [];
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const u = i / N, y = -360 + 720 * u;
    crease.push([52 * Math.sin(u * Math.PI * 2) * Math.sin(u * Math.PI), y]);
    widths.push(64 * Math.pow(Math.sin(u * Math.PI), 0.8));
  }
  const hole = ribbon(crease, widths, false);
  return [rotSub(outer, -32, 0, 0), rotSub(hole, -32, 0, 0)];
};

const leaf = (): Sub[] => [
  ...parse("M 170 830 C 150 470 400 190 845 155 C 865 575 610 850 170 830 Z"),
  ribbon([[250, 760], [400, 600], [560, 430], [700, 290], [775, 222]], [0, 22, 20, 14, 0], false),
  ribbon([[185, 815], [120, 880], [95, 905]], 34),
];

const music = (): Sub[] => [
  ellipse(330, 765, 128, 94, -24),
  ellipse(730, 690, 128, 94, -24),
  roundedRect(410, 230, 48, 540, 8),
  roundedRect(810, 160, 48, 535, 8),
  roundedPoly([[410, 205], [858, 125], [858, 240], [410, 320]], 10),
];

const LIB_BUILD: Record<string, () => string> = {
  circle: () => finish([circle(0, 0, 1)], 800),
  square: () => finish([roundedRect(0, 0, 1, 1, 0.012)], 715),
  "rounded-square": () => finish([superellipse(0, 0, 1, 1, 4.6)], 760),
  pill: () => finish([roundedRect(0, 0, 2.2, 1, 0.5)], 900),
  triangle: () => finish([roundedPoly([[0, -1], [0.866, 0.5], [-0.866, 0.5]], 0.2)], 830, 0, 18),
  star: () => finish([star(5, 0.5, 0.1, 0.06)], 850, 0, 12),
  heart: () => finish(parse("M 500 235 C 530 175 590 135 670 135 C 805 135 910 240 910 380 C 910 560 760 690 528 866 C 512 878 488 878 472 866 C 240 690 90 560 90 380 C 90 240 195 135 330 135 C 410 135 470 175 500 235 Z"), 820, 0, 10),
  hexagon: () => finish([roundedPoly(Array.from({ length: 6 }, (_, i) => [Math.cos(rad(-90 + i * 60)), Math.sin(rad(-90 + i * 60))] as Pt), 0.14)], 820),
  ring: () => finish([circle(0, 0, 1), circle(0, 0, 0.6)], 800),
  drop: () => finish(parse("M 500 80 C 560 205 790 400 790 612 C 790 772 660 900 500 900 C 340 900 210 772 210 612 C 210 400 440 205 500 80 Z"), 820),
  leaf: () => finish(leaf(), 820),
  bean: () => finish(bean(), 820),
  pin: () => finish([...parse("M 500 920 C 430 820 220 612 220 400 C 220 245 345 120 500 120 C 655 120 780 245 780 400 C 780 612 570 820 500 920 Z"), circle(500, 400, 108)], 820),
  bubble: () => finish([roundedPoly([[100, 160], [900, 160], [900, 700], [450, 700], [255, 880], [300, 700], [100, 700]], [150, 150, 150, 28, 22, 18, 150])], 840),
  bolt: () => finish([roundedPoly([[560, 60], [700, 60], [545, 420], [800, 420], [400, 940], [475, 580], [215, 580]], [22, 22, 20, 22, 18, 20, 22])], 830),
  arrow: () => finish([roundedPoly([[100, 410], [540, 410], [540, 210], [900, 500], [540, 790], [540, 590], [100, 590]], [36, 14, 34, 40, 34, 14, 36])], 860),
  cloud: () => finish(cloud(), 860, 0, 10),
  shield: () => finish(parse("M 500 80 C 620 150 740 170 840 170 L 840 470 C 840 690 690 840 500 930 C 310 840 160 690 160 470 L 160 170 C 260 170 380 150 500 80 Z"), 820),
  check: () => finish([roundedPoly([[140, 520], [240, 420], [400, 580], [760, 220], [860, 320], [400, 780]], [44, 44, 18, 44, 44, 48])], 800),
  plus: () => {
    const a = 0.17;
    const pts: Pt[] = [[-a, -1], [a, -1], [a, -a], [1, -a], [1, a], [a, a], [a, 1], [-a, 1], [-a, a], [-1, a], [-1, -a], [-a, -a]];
    return finish([roundedPoly(pts, pts.map((_, i) => (i % 3 === 2 ? 0.05 : 0.09)))], 760);
  },
  sparkle: () => finish(parse("M 500 70 C 532 372 628 468 930 500 C 628 532 532 628 500 930 C 468 628 372 532 70 500 C 372 468 468 372 500 70 Z"), 860),
  flame: () => finish(parse("M 500 70 C 565 225 765 335 765 600 C 765 785 645 915 500 915 C 355 915 235 805 235 640 C 235 520 300 445 362 395 C 358 492 398 555 452 582 C 430 430 450 250 500 70 Z M 500 590 C 545 665 620 712 620 782 C 620 842 568 878 500 878 C 432 878 380 842 380 782 C 380 712 455 665 500 590 Z"), 830),
  house: () => finish([roundedPoly([[500, 110], [890, 450], [800, 450], [800, 880], [200, 880], [200, 450], [110, 450]], [34, 22, 10, 40, 40, 10, 22]), roundedRect(430, 630, 140, 190, [36, 36, 6, 6])], 820),
  cup: () => finish([
    ...parse("M 160 300 L 720 300 L 714 365 C 820 352 902 425 892 525 C 882 625 790 688 688 694 L 674 800 C 668 845 632 875 584 875 L 296 875 C 248 875 212 845 206 800 Z"),
    ...parse("M 708 432 C 778 426 822 470 816 527 C 810 588 760 620 694 624 Z"),
  ], 800),
  globe: () => finish(globe(), 800),
  lock: () => finish(lock(), 800),
  bag: () => finish(bag(), 800),
  card: () => finish([
    roundedPoly([[70, 220], [930, 220], [930, 330], [70, 330]], [60, 60, 0, 0]),
    roundedPoly([[70, 410], [930, 410], [930, 780], [70, 780]], [0, 0, 60, 60]),
    roundedRect(170, 500, 150, 112, 22),
  ], 880),
  coin: () => finish([circle(0, 0, 1), circle(0, 0, 0.86), circle(0, 0, 0.77)], 800),
  phone: () => finish([roundedRect(0, 0, 460, 920, 84), roundedRect(30, 30, 400, 860, 58), roundedRect(170, 58, 120, 34, 17)], 840),
  play: () => finish([roundedPoly([[280, 140], [840, 500], [280, 860]], 80)], 760, 20, 0),
  music: () => finish(music(), 800),
  eye: () => finish([
    ...parse("M 70 500 C 190 285 340 200 500 200 C 660 200 810 285 930 500 C 810 715 660 800 500 800 C 340 800 190 715 70 500 Z"),
    circle(500, 500, 185), circle(500, 500, 92),
  ], 880),
  sun: () => finish(sun(), 840),
  moon: () => finish(moon(), 800, -10, 0),
  wave: () => finish(wave(), 860),
  spiral: () => finish(spiral(), 800),
};

const built = new Map<string, string>();

/** Library names, in a stable order. */
export const SHAPE_NAMES = Object.keys(LIB_BUILD);

/** Path data (1000×1000 box) for a library shape, or undefined. Built lazily and memoized. */
export const libraryShape = (name: string): string | undefined => {
  const key = name.trim().toLowerCase();
  const hit = built.get(key);
  if (hit) return hit;
  const b = LIB_BUILD[key];
  if (!b) return undefined;
  const d = b();
  built.set(key, d);
  return d;
};

export const isLibraryShape = (name: string) => name.trim().toLowerCase() in LIB_BUILD;
