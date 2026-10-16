/**
 * Shape source → extruded, beveled 3D geometry (one BufferGeometry per logo part / glyph).
 *
 * Pipeline: resolveRaw parts (SVG d, any coordinates) → normalized so the whole shape is 100 units tall,
 * centered, y flipped (SVG y-down → three y-up) → adaptive flattening of every cubic (straight cubics stay one
 * segment) → THREE.ShapePath + toShapes() (r185+: honours nonzero/evenodd, so counters become holes) →
 * ExtrudeGeometry with a rounded (quarter-circle) bevel that is INSET (bevelOffset = -bevelSize) so the
 * silhouette stays brand-exact → crease-angle normals (smooth across bevel rings and curves, sharp at real
 * corners) → scaled down to 1 unit tall.
 *
 * Everything is cached at module level per (source, font, depth, bevel) so frames never rebuild geometry.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Cubic, type GPath, type Pt, parsePath } from "../../shapes/geom";
import type { RawShape, ShapePart } from "../../shapes/resolve";

export const PRIMITIVES = ["sphere", "box", "torus", "capsule", "cylinder", "knot"] as const;
export type Primitive = (typeof PRIMITIVES)[number];

export type Part3D = {
  geometry: THREE.BufferGeometry;
  /** brand color of this part (svg sources), else null */
  fill: string | null;
  /** rest position of the part's center (model space, 1 unit = shape height) */
  center: THREE.Vector3;
  /** 2D size of the part (model units) */
  w: number;
  h: number;
};

export type Model3D = {
  parts: Part3D[];
  /** overall extents (model units; height of 2D shapes is 1) */
  width: number;
  height: number;
  depth: number;
  kind: RawShape["kind"] | "primitive";
};

/** Normalized working height (crease-normal hashing quantizes at 0.01, so work big, then scale down). */
const H = 100;
const CREASE = (32 * Math.PI) / 180;

// ---------------------------------------------------------------------------------------------
// 2D: normalized, flattened ShapePaths

const isStraight = (p0: Pt, c: Cubic) => {
  const dx = c[4] - p0[0], dy = c[5] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(c[0] - p0[0], c[1] - p0[1]) < 1e-6 && Math.hypot(c[2] - p0[0], c[3] - p0[1]) < 1e-6;
  const off = (x: number, y: number) => Math.abs((x - p0[0]) * dy - (y - p0[1]) * dx) / len;
  return off(c[0], c[1]) < 0.02 && off(c[2], c[3]) < 0.02;
};

const cubicAt = (p0: Pt, c: Cubic, t: number): Pt => {
  const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
  return [a * p0[0] + b * c[0] + cc * c[2] + d * c[4], a * p0[1] + b * c[1] + cc * c[3] + d * c[5]];
};

/** Flatten a closed subpath: straight cubics → 1 segment (or `maxStraight`-unit pieces when tessellating),
 * curves → ~1.4-unit segments (2..40). */
const flattenSub = (start: Pt, curves: Cubic[], seg: number, maxStraight = 0): Pt[] => {
  const out: Pt[] = [start];
  let p0 = start;
  for (const c of curves) {
    if (isStraight(p0, c)) {
      const len = Math.hypot(c[4] - p0[0], c[5] - p0[1]);
      const n = maxStraight > 0 ? Math.max(1, Math.ceil(len / maxStraight)) : 1;
      for (let i = 1; i <= n; i++) out.push([p0[0] + ((c[4] - p0[0]) * i) / n, p0[1] + ((c[5] - p0[1]) * i) / n]);
    }
    else {
      const poly = Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]);
      const n = Math.max(2, Math.min(40, Math.ceil(poly / seg)));
      for (let i = 1; i <= n; i++) out.push(cubicAt(p0, c, i / n));
    }
    p0 = [c[4], c[5]];
  }
  // dedupe near-coincident neighbours (degenerate triangles → normal acne)
  const clean: Pt[] = [];
  for (const p of out) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.04) clean.push(p);
  }
  const f = clean[0], l = clean[clean.length - 1];
  if (clean.length > 2 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.04) clean.pop();
  return clean;
};

const toShapes = (gp: GPath, fillRule: "nonzero" | "evenodd", seg: number, maxStraight = 0): THREE.Shape[] => {
  const sp = new THREE.ShapePath();
  sp.userData = { style: { fillRule } };
  for (const s of gp) {
    const pts = flattenSub(s.start, s.curves, seg, maxStraight);
    if (pts.length < 3) continue;
    sp.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sp.lineTo(pts[i][0], pts[i][1]);
    sp.lineTo(pts[0][0], pts[0][1]);
  }
  return sp.toShapes();
};

/** Mean stroke thickness ≈ 2·area / perimeter (exact for long bars, conservative for blobs). */
const strokeThickness = (shapes: THREE.Shape[]) => {
  let area = 0, perim = 0;
  const ring = (pts: THREE.Vector2[]) => {
    let p = 0;
    for (let i = 0; i < pts.length; i++) p += pts[i].distanceTo(pts[(i + 1) % pts.length]);
    return p;
  };
  for (const s of shapes) {
    const { shape, holes } = s.extractPoints(1);
    area += Math.abs(THREE.ShapeUtils.area(shape));
    perim += ring(shape);
    for (const h of holes) {
      area -= Math.abs(THREE.ShapeUtils.area(h));
      perim += ring(h);
    }
  }
  return perim > 0 ? (2 * Math.max(area, 0)) / perim : H;
};

// ---------------------------------------------------------------------------------------------
// extrusion

export type ExtrudeOpts = {
  depth: number;
  bevel: number;
  /** draft = fewer bevel rings / coarser curves */
  draft?: boolean;
  /** tessellate for vertex deformers: subdivided contours, 12 extrusion steps, subdivided caps */
  tess?: boolean;
};

/** Longest-edge bisection of the cap triangles (group 0) until every edge is < maxEdge. Non-indexed in/out. */
const subdivideCaps = (g: THREE.BufferGeometry, maxEdge: number): THREE.BufferGeometry => {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const outP: number[] = [], outN: number[] = [], outU: number[] = [];
  const groups: { start: number; count: number; mi: number }[] = [];
  type V = { p: number[]; n: number[]; u: number[] };
  const get = (i: number): V => ({ p: [pos.getX(i), pos.getY(i), pos.getZ(i)], n: [nor.getX(i), nor.getY(i), nor.getZ(i)], u: uv ? [uv.getX(i), uv.getY(i)] : [0, 0] });
  const mid = (a: V, b: V): V => ({ p: a.p.map((v, k) => (v + b.p[k]) / 2), n: a.n.map((v, k) => (v + b.n[k]) / 2), u: a.u.map((v, k) => (v + b.u[k]) / 2) });
  const d2 = (a: V, b: V) => (a.p[0] - b.p[0]) ** 2 + (a.p[1] - b.p[1]) ** 2 + (a.p[2] - b.p[2]) ** 2;
  const emit = (a: V, b: V, c: V) => {
    for (const v of [a, b, c]) { outP.push(...v.p); outN.push(...v.n); outU.push(...v.u); }
  };
  const m2 = maxEdge * maxEdge;
  const split = (a: V, b: V, c: V, depth: number) => {
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a);
    const L = Math.max(ab, bc, ca);
    if (L <= m2 || depth > 14) return emit(a, b, c);
    if (L === ab) { const m = mid(a, b); split(a, m, c, depth + 1); split(m, b, c, depth + 1); }
    else if (L === bc) { const m = mid(b, c); split(a, b, m, depth + 1); split(a, m, c, depth + 1); }
    else { const m = mid(c, a); split(a, b, m, depth + 1); split(m, b, c, depth + 1); }
  };
  const gs = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  for (const gr of gs) {
    const start = outP.length / 3;
    const end = Math.min(pos.count, gr.start + (Number.isFinite(gr.count) ? gr.count : pos.count));
    for (let i = gr.start; i + 2 < end; i += 3) {
      if (gr.materialIndex === 0) split(get(i), get(i + 1), get(i + 2), 0);
      else emit(get(i), get(i + 1), get(i + 2));
    }
    groups.push({ start, count: outP.length / 3 - start, mi: gr.materialIndex ?? 0 });
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outP, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(outN, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(outU, 2));
  for (const gr of groups) out.addGroup(gr.start, gr.count, gr.mi);
  return out;
};

const extrudePart = (gp: GPath, fillRule: "nonzero" | "evenodd", o: ExtrudeOpts): THREE.BufferGeometry | null => {
  const seg = o.draft ? 2.2 : 1.3;
  const shapes = toShapes(gp, fillRule, seg, o.tess ? 3 : 0);
  if (!shapes.length) return null;
  const D = Math.max(0.5, o.depth * H);
  const thick = strokeThickness(shapes);
  // bevel never eats more than ~20% of the stroke (inset caps would self-intersect) nor half the depth
  const b = Math.max(0, Math.min(o.bevel * H, thick * 0.2, D * 0.45));
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(0.2, D - 2 * b),
    curveSegments: 1,
    steps: o.tess ? 12 : 1,
    bevelEnabled: b > 0.05,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: o.draft ? 3 : 5,
  });
  // z: [-b, D-2b+b] → centered on 0
  geo.translate(0, 0, -(D - 2 * b) / 2);
  const creased = toCreasedNormals(geo, CREASE);
  if (creased !== geo) geo.dispose();
  // caps (group 0) must be perfectly flat: creased normals would bleed the bevel's tilt across the long cap
  // triangles and chrome would show it as dents
  // (ExtrudeGeometry adds one cap group per shape: fix them all)
  const pos = creased.attributes.position, nor = creased.attributes.normal;
  const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
  for (const gr of creased.groups) {
    if (gr.materialIndex !== 0) continue;
    const end = Math.min(pos.count, gr.start + (Number.isFinite(gr.count) ? gr.count : pos.count));
    for (let i = gr.start; i + 2 < end; i += 3) {
      a.fromBufferAttribute(pos, i); b2.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      const nz = a.z + b2.z + c.z >= 0 ? 1 : -1; // geometry is z-centered: front cap > 0, back cap < 0
      for (let k = 0; k < 3; k++) nor.setXYZ(i + k, 0, 0, nz);
    }
  }
  nor.needsUpdate = true;
  let outGeo = creased;
  if (o.tess) {
    outGeo = subdivideCaps(creased, 4);
    creased.dispose();
  }
  const finalGeo = outGeo;
  finalGeo.scale(1 / H, 1 / H, 1 / H);
  finalGeo.computeBoundingBox();
  finalGeo.computeBoundingSphere();
  return finalGeo;
};

/** Parts that overlap an earlier part in 2D get pushed forward a hair (no coplanar z-fighting). */
const layerOffsets = (boxes: { x0: number; y0: number; x1: number; y1: number }[]) => {
  const level: number[] = [];
  boxes.forEach((b, i) => {
    let lv = 0;
    for (let j = 0; j < i; j++) {
      const a = boxes[j];
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;
      const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (ix * iy > small * 0.2) lv = Math.max(lv, level[j] + 1);
    }
    level.push(lv);
  });
  return level;
};

const modelCache = new Map<string, Model3D>();

/** Build (or fetch) the extruded model for resolved raw parts. `key` must identify the source uniquely. */
export const buildModel = (key: string, raw: RawShape, o: ExtrudeOpts): Model3D => {
  const ck = `${key}|${o.depth}|${o.bevel}|${o.draft ? 1 : 0}|${o.tess ? 1 : 0}`;
  const hit = modelCache.get(ck);
  if (hit) return hit;
  const box = raw.box;
  const s = H / Math.max(box.h, box.w * 0.02, 1e-9);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const map = (gp: GPath): GPath =>
    gp.map((sub) => ({
      start: [(sub.start[0] - cx) * s, -(sub.start[1] - cy) * s] as Pt,
      curves: sub.curves.map((c) => [(c[0] - cx) * s, -(c[1] - cy) * s, (c[2] - cx) * s, -(c[3] - cy) * s, (c[4] - cx) * s, -(c[5] - cy) * s] as Cubic),
    }));

  const built: { geo: THREE.BufferGeometry; part: ShapePart }[] = [];
  for (const part of raw.parts) {
    // y flip reverses winding; toShapes classifies by relative winding, so both fill rules stay correct
    const geo = extrudePart(map(parsePath(part.d)), part.fillRule ?? "nonzero", o);
    if (geo) built.push({ geo, part });
  }
  const boxes = built.map(({ geo }) => {
    const bb = geo.boundingBox!;
    return { x0: bb.min.x, y0: bb.min.y, x1: bb.max.x, y1: bb.max.y };
  });
  const levels = layerOffsets(boxes);
  const dz = Math.max(0.006, o.depth * 0.08);
  const parts: Part3D[] = built.map(({ geo, part }, i) => {
    const bb = geo.boundingBox!;
    const c = new THREE.Vector3();
    bb.getCenter(c);
    geo.translate(-c.x, -c.y, -c.z);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return { geometry: geo, fill: part.fill ?? null, center: new THREE.Vector3(c.x, c.y, c.z + levels[i] * dz), w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y };
  });
  const maxLevel = levels.length ? Math.max(...levels) : 0;
  const model: Model3D = { parts, width: (box.w * s) / H, height: (box.h * s) / H, depth: o.depth + maxLevel * dz, kind: raw.kind };
  if (modelCache.size > 64) modelCache.clear();
  modelCache.set(ck, model);
  return model;
};

// ---------------------------------------------------------------------------------------------
// primitives (all ~1 unit tall, smooth, high tessellation: they are hero objects)

const primCache = new Map<string, Model3D>();

export const parsePrimitive = (src: string): Primitive | null => {
  const m = /^primitive:\s*([a-z]+)/i.exec(src.trim());
  if (!m) return null;
  const n = m[1].toLowerCase();
  return (PRIMITIVES as readonly string[]).includes(n) ? (n as Primitive) : "sphere";
};

/** Lathe profile of a cylinder with rounded rims (reads premium, catches a rim highlight). */
const roundedCylinder = (r: number, h: number, rr: number, draft: boolean) => {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)];
  const n = draft ? 6 : 10;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - rr + rr * Math.cos(a), -h / 2 + rr + rr * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - rr + rr * Math.cos(a), h / 2 - rr + rr * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, draft ? 64 : 128);
};

export const buildPrimitive = (p: Primitive, draft = false): Model3D => {
  const ck = `${p}|${draft ? 1 : 0}`;
  const hit = primCache.get(ck);
  if (hit) return hit;
  const q = draft ? 0.5 : 1;
  let geo: THREE.BufferGeometry;
  switch (p) {
    case "box": geo = new RoundedBoxGeometry(0.9, 0.9, 0.9, draft ? 4 : 8, 0.09); break;
    case "torus": geo = new THREE.TorusGeometry(0.36, 0.15, Math.round(64 * q), Math.round(192 * q)); break;
    case "capsule": geo = new THREE.CapsuleGeometry(0.26, 0.48, Math.round(24 * q), Math.round(64 * q)); break;
    case "cylinder": geo = roundedCylinder(0.42, 0.8, 0.07, draft); break;
    case "knot": geo = new THREE.TorusKnotGeometry(0.3, 0.1, Math.round(480 * q), Math.round(48 * q)); break;
    default: geo = new THREE.SphereGeometry(0.5, Math.round(160 * q), Math.round(96 * q));
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const model: Model3D = {
    parts: [{ geometry: geo, fill: null, center: new THREE.Vector3(), w: size.x, h: size.y }],
    width: size.x, height: size.y, depth: size.z, kind: "primitive",
  };
  primCache.set(ck, model);
  return model;
};
