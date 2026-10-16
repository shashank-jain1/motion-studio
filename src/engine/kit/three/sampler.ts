/**
 * Logo / text silhouettes for the cloner and particles: the front-cap triangles of the extruded model (exactly the
 * brand outline, counters are holes) rasterized into grids, plus even (jittered-grid, seeded) point sampling.
 * Pure JS on the CPU, deterministic, Node-testable; cached per model.
 */
import type { Model3D } from "./geometry";

export type Silhouette = {
  /** triangles in model space: x0,y0,x1,y1,x2,y2 */
  tris: Float32Array;
  /** part index per triangle */
  part: Uint16Array;
  x0: number; y0: number; x1: number; y1: number;
  area: number;
};

export type Mask = { cols: number; rows: number; x0: number; y0: number; cell: number; part: Int16Array };

export const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const silCache = new WeakMap<Model3D, Silhouette>();

export const silhouette = (model: Model3D): Silhouette => {
  const hit = silCache.get(model);
  if (hit) return hit;
  const tris: number[] = [];
  const part: number[] = [];
  if (model.kind === "primitive") {
    const w = model.width / 2, h = model.height / 2;
    tris.push(-w, -h, w, -h, w, h, -w, -h, w, h, -w, h);
    part.push(0, 0);
  } else {
    model.parts.forEach((p, pi) => {
      const g = p.geometry;
      const pos = g.attributes.position;
      const idx = g.index;
      const at = (i: number) => (idx ? idx.getX(i) : i);
      for (const gr of g.groups) {
        if (gr.materialIndex !== 0) continue;
        const end = Math.min(idx ? idx.count : pos.count, gr.start + (Number.isFinite(gr.count) ? gr.count : Infinity));
        for (let i = gr.start; i + 2 < end; i += 3) {
          const a = at(i), b = at(i + 1), c = at(i + 2);
          if (pos.getZ(a) + pos.getZ(b) + pos.getZ(c) <= 0) continue; // front cap only
          tris.push(
            pos.getX(a) + p.center.x, pos.getY(a) + p.center.y,
            pos.getX(b) + p.center.x, pos.getY(b) + p.center.y,
            pos.getX(c) + p.center.x, pos.getY(c) + p.center.y,
          );
          part.push(pi);
        }
      }
    });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  for (let i = 0; i < tris.length; i += 6) {
    for (let k = 0; k < 6; k += 2) {
      x0 = Math.min(x0, tris[i + k]); x1 = Math.max(x1, tris[i + k]);
      y0 = Math.min(y0, tris[i + k + 1]); y1 = Math.max(y1, tris[i + k + 1]);
    }
    area += Math.abs((tris[i + 2] - tris[i]) * (tris[i + 5] - tris[i + 1]) - (tris[i + 3] - tris[i + 1]) * (tris[i + 4] - tris[i])) / 2;
  }
  if (!Number.isFinite(x0)) { x0 = -0.5; y0 = -0.5; x1 = 0.5; y1 = 0.5; }
  const s: Silhouette = { tris: new Float32Array(tris), part: new Uint16Array(part), x0, y0, x1, y1, area };
  silCache.set(model, s);
  return s;
};

const maskCache = new WeakMap<Silhouette, Map<string, Mask>>();

/** Rasterize the silhouette: cell centers inside a triangle get that triangle's part index (else -1). */
export const rasterize = (sil: Silhouette, cell: number, pad = 0): Mask => {
  let m = maskCache.get(sil);
  if (!m) { m = new Map(); maskCache.set(sil, m); }
  const key = `${cell.toFixed(6)}|${pad}`;
  const hit = m.get(key);
  if (hit) return hit;
  const x0 = sil.x0 - pad * cell, y0 = sil.y0 - pad * cell;
  const cols = Math.max(1, Math.ceil((sil.x1 - sil.x0) / cell) + 2 * pad);
  const rows = Math.max(1, Math.ceil((sil.y1 - sil.y0) / cell) + 2 * pad);
  // center the grid on the silhouette
  const ox = x0 - (cols * cell - (sil.x1 - sil.x0 + 2 * pad * cell)) / 2;
  const oy = y0 - (rows * cell - (sil.y1 - sil.y0 + 2 * pad * cell)) / 2;
  const part = new Int16Array(cols * rows).fill(-1);
  const T = sil.tris;
  for (let ti = 0, n = T.length / 6; ti < n; ti++) {
    const ax = T[ti * 6], ay = T[ti * 6 + 1], bx = T[ti * 6 + 2], by = T[ti * 6 + 3], cx = T[ti * 6 + 4], cy = T[ti * 6 + 5];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - ox) / cell - 0.5));
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx, cx) - ox) / cell - 0.5));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - oy) / cell - 0.5));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, by, cy) - oy) / cell - 0.5));
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(d) < 1e-12) continue;
    for (let r = r0; r <= r1; r++) {
      const py = oy + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const px = ox + (c + 0.5) * cell;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) part[r * cols + c] = sil.part[ti];
      }
    }
  }
  const mask: Mask = { cols, rows, x0: ox, y0: oy, cell, part };
  if (m.size > 16) m.clear();
  m.set(key, mask);
  return mask;
};

export const cellCenter = (m: Mask, c: number, r: number): [number, number] => [m.x0 + (c + 0.5) * m.cell, m.y0 + (r + 0.5) * m.cell];

/** Cells of the mask whose 4-neighbourhood touches the outside (the outline, one cell thick). */
export const isEdge = (m: Mask, c: number, r: number) => {
  if (m.part[r * m.cols + c] < 0) return false;
  const out = (cc: number, rr: number) => cc < 0 || rr < 0 || cc >= m.cols || rr >= m.rows || m.part[rr * m.cols + cc] < 0;
  return out(c - 1, r) || out(c + 1, r) || out(c, r - 1) || out(c, r + 1);
};

export type Samples = { x: Float32Array; y: Float32Array; part: Uint16Array; count: number };
const sampleCache = new WeakMap<Silhouette, Map<string, Samples>>();

/**
 * ~n points evenly spread inside the silhouette (jittered grid, rejection-tested on a 3× finer raster).
 * `edge`: only points on the outline band.
 */
export const samplePoints = (sil: Silhouette, n: number, seed = 1, edge = false): Samples => {
  let m = sampleCache.get(sil);
  if (!m) { m = new Map(); sampleCache.set(sil, m); }
  const key = `${n}|${seed}|${edge ? 1 : 0}`;
  const hit = m.get(key);
  if (hit) return hit;
  const area = Math.max(sil.area, 1e-6);
  const cell = edge ? Math.max(1e-4, (2 * area) / Math.max(1, n) / Math.max(1e-3, (sil.x1 - sil.x0 + sil.y1 - sil.y0)) ) : Math.sqrt(area / Math.max(1, n));
  const coarse = rasterize(sil, edge ? Math.max(cell, 0.004) : cell, 1);
  const fine = rasterize(sil, coarse.cell / 3, 3);
  const rnd = mulberry32(seed * 7919 + 17);
  const xs: number[] = [], ys: number[] = [], ps: number[] = [];
  const inside = (x: number, y: number) => {
    const c = Math.floor((x - fine.x0) / fine.cell), r = Math.floor((y - fine.y0) / fine.cell);
    if (c < 0 || r < 0 || c >= fine.cols || r >= fine.rows) return -1;
    return fine.part[r * fine.cols + c];
  };
  for (let r = 0; r < coarse.rows; r++) {
    for (let c = 0; c < coarse.cols; c++) {
      const p = coarse.part[r * coarse.cols + c];
      if (p < 0 && !edge) {
        // cells whose center is outside may still overlap the shape at thin strokes: try a jittered point
        const [cx, cy] = cellCenter(coarse, c, r);
        const jx = cx + (rnd() - 0.5) * coarse.cell, jy = cy + (rnd() - 0.5) * coarse.cell;
        const q = inside(jx, jy);
        if (q >= 0 && rnd() < 0.5) { xs.push(jx); ys.push(jy); ps.push(q); }
        continue;
      }
      if (edge && !isEdge(coarse, c, r)) continue;
      const [cx, cy] = cellCenter(coarse, c, r);
      let done = false;
      for (let k = 0; k < 6 && !done; k++) {
        const jx = cx + (rnd() - 0.5) * coarse.cell, jy = cy + (rnd() - 0.5) * coarse.cell;
        const q = inside(jx, jy);
        if (q >= 0) { xs.push(jx); ys.push(jy); ps.push(q); done = true; }
      }
      if (!done && p >= 0) { xs.push(cx); ys.push(cy); ps.push(p); }
    }
  }
  const s: Samples = { x: new Float32Array(xs), y: new Float32Array(ys), part: new Uint16Array(ps), count: xs.length };
  if (m.size > 16) m.clear();
  m.set(key, s);
  return s;
};
