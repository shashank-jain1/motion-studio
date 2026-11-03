/**
 * Raster → vector tracing (PNG/WebP/JPG with alpha) so scraped bitmap elements become real shapes: the traced SVG goes
 * through the normal logo analysis and can then be extruded in 3D (`three` source "svg:assets/x.traced.svg"), morphed,
 * drawn on, or assembled part by part.
 *
 * Pipeline: ffmpeg decode → RGBA grid (≤ maxSide px) → k-means palette (opaque pixels only) → 3×3 mode filter (kills
 * anti-alias speckle) → per-color crack-following boundary loops → drop specks → Douglas–Peucker → smooth quadratic
 * curves that keep real corners sharp. Regions are emitted largest-first with evenodd fills.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMediaTool } from "./mediaTool";
import { aviFrames } from "./footage";

const TOP_DOWN = true;

export type TraceOptions = {
  /** max palette colors (default 6) */
  colors?: number;
  /** working resolution as a pixel budget (default 360 000 ≈ 600×600; wide images get a long side to match) */
  pixels?: number;
  /** merge everything opaque into one silhouette (die-cut sticker / 3D cutout) */
  silhouette?: boolean;
  /** drop regions smaller than this fraction of the image area (default 0.0004) */
  minArea?: number;
};

export type TraceResult = { svg: string; width: number; height: number; colors: string[]; paths: number };

type Pt = [number, number];

const probeSize = async (file: string): Promise<{ w: number; h: number }> => {
  const { stdout } = await runMediaTool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [w, h] = stdout.trim().split(/[,\s]+/).map(Number);
  if (!w || !h) throw new Error(`Could not read the size of ${path.basename(file)}`);
  return { w, h };
};

const decodeRgba = async (file: string, w: number, h: number): Promise<Uint8Array> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-trace-"));
  try {
    // the bundled FFmpeg has no raw muxer, but has AVI + the rawvideo encoder (BGRA, bottom-up DIB rows)
    const out = path.join(tmp, "img.avi");
    await runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=area,format=bgra`, "-c:v", "rawvideo", "-f", "avi", out]);
    const raw = aviFrames(fs.readFileSync(out), w * h * 4);
    if (raw.length < w * h * 4) throw new Error("Image decode came back short");
    const rgba = new Uint8Array(w * h * 4);
    const flip = !TOP_DOWN;
    for (let y = 0; y < h; y++) {
      const sy = flip ? h - 1 - y : y;
      for (let x = 0; x < w; x++) {
        const s = (sy * w + x) * 4, d = (y * w + x) * 4;
        rgba[d] = raw[s + 2]; rgba[d + 1] = raw[s + 1]; rgba[d + 2] = raw[s]; rgba[d + 3] = raw[s + 3];
      }
    }
    return rgba;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
};

const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** k-means++ on opaque pixels (deterministic seeding), then merge near-duplicate centers. */
const palette = (px: Uint8Array, n: number, k: number): number[][] => {
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= 128) idx.push(i);
  if (!idx.length) return [];
  const step = Math.max(1, Math.floor(idx.length / 6000));
  const sample = idx.filter((_, j) => j % step === 0).map((i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers: number[][] = [sample[Math.floor(sample.length / 2)].slice()];
  while (centers.length < Math.min(k, sample.length)) {
    let best = -1, bi = 0;
    for (let j = 0; j < sample.length; j++) {
      const m = Math.min(...centers.map((c) => d2(c, sample[j])));
      if (m > best) { best = m; bi = j; }
    }
    if (best < 18 * 18) break; // image has fewer real colors than k
    centers.push(sample[bi].slice());
  }
  for (let it = 0; it < 12; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const s of sample) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, ci) => { const d = d2(c, s); if (d < bd) { bd = d; bi = ci; } });
      sum[bi][0] += s[0]; sum[bi][1] += s[1]; sum[bi][2] += s[2]; sum[bi][3]++;
    }
    sum.forEach((s, ci) => { if (s[3]) centers[ci] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const merged: number[][] = [];
  for (const c of centers) if (!merged.some((m) => d2(m, c) < 22 * 22)) merged.push(c);
  return merged;
};

/** Boundary loops of `inside` cells, following pixel edges (clockwise around each pixel, screen coords). */
const crackLoops = (inside: (x: number, y: number) => boolean, w: number, h: number): Pt[][] => {
  const out = new Map<number, number[]>(); // vertex key → list of end-vertex keys
  const K = (x: number, y: number) => y * (w + 1) + x;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = K(ax, ay);
    const l = out.get(k);
    if (l) l.push(K(bx, by)); else out.set(k, [K(bx, by)]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (y === 0 || !inside(x, y - 1)) add(x, y, x + 1, y);
    if (x === w - 1 || !inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (y === h - 1 || !inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (x === 0 || !inside(x - 1, y)) add(x, y + 1, x, y);
  }
  const xy = (k: number): Pt => [k % (w + 1), Math.floor(k / (w + 1))];
  const loops: Pt[][] = [];
  for (const [start, list] of out) {
    while (list.length) {
      const loop: Pt[] = [xy(start)];
      let prev = start, cur = list.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 4 * (w + 1) * (h + 1)) {
        loop.push(xy(cur));
        const nexts = out.get(cur);
        if (!nexts || !nexts.length) break;
        let pick = 0;
        if (nexts.length > 1) {
          // saddle: take the sharpest right turn so diagonal-touching regions stay separate
          const [px, py] = xy(prev), [cx, cy] = xy(cur);
          const din = [cx - px, cy - py];
          let best = -Infinity;
          nexts.forEach((n, i) => {
            const [nx, ny] = xy(n);
            const cross = din[0] * (ny - cy) - din[1] * (nx - cx);
            if (cross > best) { best = cross; pick = i; }
          });
        }
        prev = cur;
        cur = nexts.splice(pick, 1)[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
};

const area = (p: Pt[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
};

const rdp = (pts: Pt[], tol: number): Pt[] => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let md = -1, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len;
    if (d > md) { md = d; mi = i; }
  }
  if (md <= tol) return [a, b];
  return [...rdp(pts.slice(0, mi + 1), tol).slice(0, -1), ...rdp(pts.slice(mi), tol)];
};

const simplifyClosed = (loop: Pt[], tol: number): Pt[] => {
  // split at the vertex farthest from the first one so both halves are open polylines
  let fi = 0, fd = -1;
  loop.forEach((p, i) => { const d = Math.hypot(p[0] - loop[0][0], p[1] - loop[0][1]); if (d > fd) { fd = d; fi = i; } });
  const a = rdp(loop.slice(0, fi + 1), tol);
  const b = rdp([...loop.slice(fi), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
};

const f = (n: number) => String(Math.round(n * 10) / 10);

/** Smooth closed path: quadratic curves through edge midpoints; corners sharper than ~115° stay sharp. */
const smoothD = (p: Pt[], s: number): string => {
  const n = p.length;
  if (n < 3) return "";
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const sharp = p.map((c, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const v1 = [a[0] - c[0], a[1] - c[1]], v2 = [b[0] - c[0], b[1] - c[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1])) || 1);
    const short = Math.min(Math.hypot(v1[0], v1[1]), Math.hypot(v2[0], v2[1]));
    return cos > -0.42 && short > 2.2; // angle < ~115° between long edges = a designed corner
  });
  const S = (q: Pt) => `${f(q[0] * s)} ${f(q[1] * s)}`;
  let d = `M${S(mid(p[n - 1], p[0]))}`;
  for (let i = 0; i < n; i++) {
    const c = p[i], m = mid(c, p[(i + 1) % n]);
    d += sharp[i] ? `L${S(c)}L${S(m)}` : `Q${S(c)} ${S(m)}`;
  }
  return d + "Z";
};

export const traceImage = async (file: string, o: TraceOptions = {}): Promise<TraceResult> => {
  const { w: W, h: H } = await probeSize(file);
  const sc = Math.min(1, Math.sqrt((o.pixels ?? 360_000) / (W * H)));
  const w = Math.max(8, Math.round(W * sc)), h = Math.max(8, Math.round(H * sc));
  const px = await decodeRgba(file, w, h);
  const n = w * h;
  const centers = o.silhouette ? [[0, 0, 0]] : palette(px, n, Math.max(1, Math.min(12, o.colors ?? 6)));
  if (!centers.length) throw new Error(`${path.basename(file)} has no opaque pixels to trace`);

  // label every pixel (-1 = transparent)
  let lab = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (px[i * 4 + 3] < 128) { lab[i] = -1; continue; }
    if (o.silhouette) { lab[i] = 0; continue; }
    let bi = 0, bd = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = (px[i * 4] - centers[c][0]) ** 2 + (px[i * 4 + 1] - centers[c][1]) ** 2 + (px[i * 4 + 2] - centers[c][2]) ** 2;
      if (d < bd) { bd = d; bi = c; }
    }
    lab[i] = bi;
  }
  // 3×3 mode filter (opaque pixels only): anti-aliased fringe joins its neighbours
  if (!o.silhouette) {
    const next = new Int16Array(lab);
    const votes = new Int32Array(centers.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (lab[i] < 0) continue;
      votes.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = lab[i + dy * w + dx]; if (l >= 0) votes[l]++; }
      let bl = lab[i], bv = votes[lab[i]];
      votes.forEach((v, l) => { if (v > bv) { bv = v; bl = l; } });
      next[i] = bl;
    }
    lab = next;
  }

  const minA = (o.minArea ?? 0.0004) * w * h;
  const s = W / w; // back to source pixel units
  // paint order: largest color first. Each region also claims a 1-px rim of the regions painted BEFORE it, so the
  // simplified edges overlap instead of leaving hairline gaps between colors.
  const count = new Array(centers.length).fill(0);
  for (let i = 0; i < n; i++) if (lab[i] >= 0) count[lab[i]]++;
  const rank = count.map((_, ci) => count.filter((c2, cj) => c2 > count[ci] || (c2 === count[ci] && cj < ci)).length);
  const regions: { color: string; d: string; area: number }[] = [];
  centers.forEach((c, ci) => {
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : lab[y * w + x]);
    const mine = (x: number, y: number) => {
      const l = at(x, y);
      if (l === ci) return true;
      if (l < 0 || rank[l] > rank[ci]) return false;
      return at(x - 1, y) === ci || at(x + 1, y) === ci || at(x, y - 1) === ci || at(x, y + 1) === ci;
    };
    const loops = crackLoops(mine, w, h).filter((l) => Math.abs(area(l)) >= Math.max(4, minA));
    if (!loops.length) return;
    const total = loops.reduce((a, l) => a + area(l), 0);
    if (Math.abs(total) < minA) return;
    const d = loops.map((l) => smoothD(simplifyClosed(l, 0.75), s)).filter(Boolean).join("");
    if (d) regions.push({ color: o.silhouette ? "#111111" : hex(c), d, area: Math.abs(total) });
  });
  regions.sort((a, b) => b.area - a.area); // = paint order
  const paths = regions.map((r) => `  <path fill="${r.color}" fill-rule="evenodd" d="${r.d}"/>`).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n${paths}\n</svg>\n`;
  return { svg, width: W, height: H, colors: regions.map((r) => r.color), paths: regions.length };
};

/** Trace `file` (absolute) and write `<name>.traced.svg` (or `.cutout.svg` for silhouettes) next to it. */
export const traceToFile = async (file: string, o: TraceOptions = {}): Promise<{ file: string } & TraceResult> => {
  const r = await traceImage(file, o);
  const out = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.${o.silhouette ? "cutout" : "traced"}.svg`);
  fs.writeFileSync(out, r.svg);
  return { file: out, ...r };
};
