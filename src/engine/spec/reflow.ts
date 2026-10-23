/**
 * One spec → every platform. `reflowSpec(spec, target)` adapts a film authored in its master format (spec.format) to
 * another format by RE-LAYING-OUT each scene, not by scaling the canvas. PURE and deterministic (no DOM, no IO):
 * the same function runs in the renderer (src/core/render.ts), the web Player (format switcher) and the tests.
 *
 * Per scene:
 *  1. Classify top-level layers.
 *     - "fill" (shaders, particles, clouds, full-bleed media/paths/panels, anything without a size that defaults to the
 *       frame): they FILL the new canvas — explicit sizes and positions scale per axis (sx, sy).
 *     - "content" (text, logo, counter, cards, devices, shapes, morphs, small media, groups…) plus every actor pose
 *       that sits in the scene (as a pseudo item, so text never lands on the motif).
 *  2. Content items are measured (estimated boxes, same heuristics as the engine defaults), overlapping items are
 *     merged into rigid clusters (a ring behind a logo stays behind the logo), clusters side by side (same y band) form
 *     rows.
 *  3. Rows that no longer fit the target's width are split and restacked as a column, ordered by their original y then
 *     x (16:9 → 9:16: [pill · phone · notification] becomes notification / phone / pill). Units are stacked top→bottom
 *     with their original gaps (scaled, clamped) and the stack keeps its original vertical anchor (upper third stays
 *     upper third).
 *  4. A column that is too tall for a wider target (9:16 → 16:9) spreads into two columns when a dominant visual exists
 *     (device / logo / media / motif): visual on the right, the rest stacked on the left. Otherwise the stack shrinks.
 *  5. Critical content (text, logo, counter, cards, captions) is fitted into the target's universal safe zone
 *     (SAFE_ZONES); text keeps readable sizes (floors: 80px hook / 48px body on verticals, never shrunk below them
 *     elsewhere) and otherwise relies on the engine's auto-fit; cards stay inside the safe width.
 *  6. Everything spatial follows the same mapping: camera keyframe x/y, spotlight centers, particle burst origins,
 *     transition origins (expand / zoom-into x/y map through the PREVIOUS scene), motion paths, keyframe deltas, actor
 *     poses (snapTo poses are left alone: the engine computes them). Order and z never change.
 *  7. Explicit `layer.adapt[target]` overrides win last (shallow merge), anywhere in the tree.
 * The result has `format: target` (explicit width/height dropped).
 */
import { FORMATS, type Spec } from "./schema";

export type Format = keyof typeof FORMATS;
export const FORMAT_LIST = Object.keys(FORMATS) as Format[];

/** Center-relative rect in px (l/t negative). */
export type Rect = { l: number; r: number; t: number; b: number };

/**
 * Universal "safe everywhere" rect per format for CRITICAL content (text, logo, counter, cards), center-relative px.
 * 9:16 = docs/research/03 §2.5 (x 90–930 → ±420, y 270–1250 → −690…+290: clears TikTok/Reels/Shorts UI and Meta ads).
 * 4:5 / 1:1 = feed crops + caption overlap; 16:9 / 21:9 = title-safe minus the player's bottom chrome.
 */
export const SAFE_ZONES: Record<Format, Rect> = {
  "9:16": { l: -420, r: 420, t: -690, b: 290 },
  "4:5": { l: -460, r: 460, t: -575, b: 535 },
  "1:1": { l: -462, r: 462, t: -462, b: 462 },
  "16:9": { l: -830, r: 830, t: -460, b: 440 },
  "21:9": { l: -1110, r: 1110, t: -460, b: 440 },
};

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type SpecLike = Pick<Spec, "format" | "width" | "height"> & { formats?: readonly string[] | null };

const isFormat = (f: unknown): f is Format => typeof f === "string" && f in FORMATS;

/** The format a spec is authored in (explicit width/height → nearest aspect). */
export const masterFormat = (spec: SpecLike): Format => {
  if (isFormat(spec.format)) return spec.format;
  if (spec.width && spec.height) {
    const a = spec.width / spec.height;
    return FORMAT_LIST.reduce((best, f) => (Math.abs(Math.log(FORMATS[f][0] / FORMATS[f][1] / a)) < Math.abs(Math.log(FORMATS[best][0] / FORMATS[best][1] / a)) ? f : best), "16:9" as Format);
  }
  return "16:9";
};

/** Every format this film exports to: the master first, then spec.formats (deduplicated, valid only). */
export const adaptTargets = (spec: SpecLike): Format[] => {
  const out: Format[] = [masterFormat(spec)];
  for (const f of spec.formats ?? []) if (isFormat(f) && !out.includes(f)) out.push(f);
  return out;
};

const srcSize = (spec: SpecLike): [number, number] =>
  spec.width && spec.height ? [spec.width, spec.height] : [...FORMATS[masterFormat(spec)]] as [number, number];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clamp = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v)));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ------------------------------------------------------------------------------------------------ measuring

type Box = { w: number; h: number };

const CARD_W: Record<string, number> = { notification: 23.8, "notification-dark": 23.8, glass: 20, solid: 20, toast: 18, "chat-left": 16, "chat-right": 16, stat: 12, quote: 26, button: 12, search: 22 };
const CARD_H: Record<string, number> = { notification: 3.6, "notification-dark": 3.6, glass: 3.6, solid: 3.4, pill: 2.2, toast: 2.6, "chat-left": 3, "chat-right": 3, stat: 5, quote: 6, button: 2.6, search: 2.3 };

const textLines = (l: Any): string[] => String((l.uppercase ? String(l.text ?? "").toUpperCase() : l.text) ?? "").split("\n");
/** Estimated natural (unwrapped, unfitted) width of a text layer at font size fs. */
const textNaturalW = (l: Any, fs: number) => {
  const lines = textLines(l);
  const longest = Math.max(1, ...lines.map((s) => s.length));
  const perChar = (l.uppercase ? 0.64 : 0.56) + (num(l.letterSpacing) ? l.letterSpacing : 0);
  return fs * perChar * longest;
};

/** Approximate layer box (px, before the layer's own `scale`), in a frame of W×H — mirrors the engine defaults. */
export const estimateBox = (l: Any, W: number, H: number): Box => {
  switch (l.type) {
    case "text": {
      const fs = num(l.fontSize) ? l.fontSize : 120;
      const lines = textLines(l);
      const nat = textNaturalW(l, fs);
      const cap = num(l.maxWidth) ? l.maxWidth : num(l.width) ? l.width : null;
      const w = cap != null ? Math.min(cap, nat) : Math.min(nat, W * 0.9);
      const wraps = cap != null && nat > cap ? Math.ceil(nat / cap) : 1;
      return { w, h: num(l.height) ? l.height : fs * (num(l.lineHeight) ? l.lineHeight : 1.1) * lines.length * wraps };
    }
    case "counter": {
      const fs = num(l.fontSize) ? l.fontSize : 140;
      const digits = String(Math.round(Math.abs(num(l.to) ? l.to : 0))).length;
      const len = digits + Math.floor((digits - 1) / 3) + (num(l.decimals) ? l.decimals + 1 : 0) + String(l.prefix ?? "").length + String(l.suffix ?? "").length;
      return { w: fs * 0.6 * Math.max(1, len), h: fs * 1.1 };
    }
    case "card": {
      const fs = num(l.fontSize) ? l.fontSize : 26;
      const v = String(l.variant ?? "solid");
      const titleLen = String(l.title ?? "").length + (l.body ? 0 : 0);
      const w = num(l.width) ? l.width : v === "pill" ? fs * (0.58 * Math.max(titleLen, String(l.body ?? "").length) + (l.icon ? 2.2 : 0) + 1.8) : v === "button" ? Math.max(fs * 12, fs * 0.62 * titleLen + fs * 3) : fs * (CARD_W[v] ?? 20);
      return { w, h: num(l.height) ? l.height : fs * (CARD_H[v] ?? 3.4) };
    }
    case "captions": {
      const fs = num(l.fontSize) ? l.fontSize : Math.round(Math.min(W, H) * 0.066);
      // one page of words, not the whole caption box
      const words = Array.isArray(l.words) ? l.words.map((w: Any) => String(w.text ?? "")) : String(l.text ?? "").split(/\s+/);
      const per = num(l.wordsPerPage) ? l.wordsPerPage : 3;
      const page = Math.max(4, ...Array.from({ length: Math.ceil(words.length / per) }, (_, i) => words.slice(i * per, i * per + per).join(" ").length));
      const box = num(l.width) ? l.width : W * 0.85;
      const nat = fs * (l.uppercase ? 0.66 : 0.58) * page;
      return { w: Math.min(box, nat), h: fs * 1.3 * Math.ceil(nat / box) };
    }
    case "device": {
      if (l.model === "browser") return { w: num(l.width) ? l.width : 1280, h: num(l.height) ? l.height : 800 };
      const tablet = l.model === "tablet";
      const h = num(l.height) ? l.height : tablet ? 820 : 780;
      return { w: num(l.width) ? l.width : h * (tablet ? 0.72 : 0.488), h };
    }
    case "logo": {
      // aspect unknown without the analysis: lockups are wide, an icon part is square
      const aspect = l.parts === "icon" ? 1 : 2.6;
      if (num(l.width) && num(l.height)) return { w: l.width, h: l.height };
      if (num(l.width)) return { w: l.width, h: l.width / aspect };
      const h = num(l.height) ? l.height : 300;
      return { w: h * aspect, h };
    }
    case "shape": {
      const w = num(l.width) ? l.width : 200;
      return { w, h: num(l.height) ? l.height : l.shape === "line" ? 4 : w };
    }
    case "morph": return { w: num(l.width) ? l.width : 400, h: num(l.height) ? l.height : 400 };
    case "group": {
      const kids: Any[] = Array.isArray(l.layers) ? l.layers : [];
      if (!kids.length) return { w: 1, h: 1 };
      let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
      for (const c of kids) {
        if (isFill(c, W, H)) continue;
        const b = estimateBox(c, W, H);
        const s = num(c.scale) ? c.scale : 1;
        const cx = num(c.x) ? c.x : 0, cy = num(c.y) ? c.y : 0;
        L = Math.min(L, cx - (b.w * s) / 2); R = Math.max(R, cx + (b.w * s) / 2);
        T = Math.min(T, cy - (b.h * s) / 2); B = Math.max(B, cy + (b.h * s) / 2);
      }
      if (!Number.isFinite(L)) return { w: W, h: H };
      // the group is positioned by its center; its children's union may be off-center → measure symmetric
      return { w: 2 * Math.max(Math.abs(L), Math.abs(R)), h: 2 * Math.max(Math.abs(T), Math.abs(B)) };
    }
    default: {
      const w = num(l.width) ? l.width : num(l.height) ? l.height : l.type === "media" || l.type === "path" ? W : 400;
      return { w, h: num(l.height) ? l.height : l.type === "media" || l.type === "path" ? H : w };
    }
  }
};

/** Layers that belong to the canvas rather than to the composition: they fill whatever frame they're in. */
const isFill = (l: Any, W: number, H: number): boolean => {
  switch (l.type) {
    case "shader": case "particles": case "cloud": return true;
    case "media": case "path":
      // big in both dimensions (a full-bleed swoosh, a map, a backdrop photo); a large but placed element is content
      return !num(l.width) || !num(l.height) || (l.width >= W * 0.6 && l.height >= H * 0.6 && (l.width >= W * 0.75 || l.height >= H * 0.75));
    case "shape":
      return num(l.width) && num(l.height) && (l.width >= W * 0.85 || l.height >= H * 0.85) && l.shape !== "circle" && l.shape !== "ring";
    default: return false;
  }
};

const CRITICAL = new Set(["text", "logo", "counter", "card", "captions"]);
const TEXTY = new Set(["text", "counter", "captions"]);
const isCritical = (l: Any) => CRITICAL.has(l.type);

// ------------------------------------------------------------------------------------------------ context

type Ctx = {
  W0: number; H0: number; W1: number; H1: number;
  sx: number; sy: number;
  /** base content scale (area ratio, clamped) */
  s: number;
  /** vertical-gap factor (taller targets breathe more) */
  gamma: number;
  safe: Rect;
  target: Format;
  vertical: boolean;
  /** keyframe / path delta scale factors relative to an item's k */
  mx: number; my: number;
};

const makeCtx = (W0: number, H0: number, target: Format): Ctx => {
  const [W1, H1] = FORMATS[target];
  const sx = W1 / W0, sy = H1 / H0;
  const s = clamp(Math.sqrt((W1 * H1) / (W0 * H0)), 0.7, 1.15);
  const aspectChange = (H1 / W1) / (H0 / W0);
  return {
    W0, H0, W1, H1, sx, sy, s,
    gamma: Math.sqrt(clamp(aspectChange, 0.6, 1.5)),
    safe: SAFE_ZONES[target], target,
    vertical: H1 > W1,
    mx: Math.min(1, sx / s), my: Math.min(1, sy / s),
  };
};

// ------------------------------------------------------------------------------------------------ layout

type Item = {
  layer: Any;
  /** actor pseudo item (pose in this scene) */
  pose?: Any;
  actorLayer?: Any;
  cx: number; cy: number; w: number; h: number;
  /** layout-space source position (= cx/cy unless a row was re-wrapped into a grid) */
  vx: number; vy: number;
  critical: boolean; text: boolean;
  hook: boolean;
  /** paint order (layer index; actor poses paint above every scene layer) */
  order: number;
  // results
  nx: number; ny: number; k: number;
  /** horizontal room this item may use (for text fitting) */
  limitW: number;
};

type Cluster = { items: Item[]; l: number; r: number; t: number; b: number; critical: boolean; visualArea: number; textOnly: boolean };
type Unit = {
  clusters: Cluster[]; l: number; r: number; t: number; b: number; f: number; critical: boolean; visualArea: number;
  /** id of the side-by-side row this unit was split from (satellites may tuck onto that row's hero) */
  split?: number;
  /** highest paint order of its items (layer index; actors paint above scenes) */
  order: number;
  /** center horizontally (peers split off a row read as a list, not a staircase) */
  center?: boolean;
};

const bounds = (xs: { l: number; r: number; t: number; b: number }[]) => ({
  l: Math.min(...xs.map((x) => x.l)), r: Math.max(...xs.map((x) => x.r)), t: Math.min(...xs.map((x) => x.t)), b: Math.max(...xs.map((x) => x.b)),
});
const itemRect = (i: Item) => ({ l: i.vx - i.w / 2, r: i.vx + i.w / 2, t: i.vy - i.h / 2, b: i.vy + i.h / 2 });

/** Union-find over n nodes with a pair predicate (deterministic: components ordered by their smallest index). */
const components = (n: number, linked: (a: number, b: number) => boolean): number[][] => {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (p[i] === i ? i : (p[i] = find(p[i])));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (linked(a, b)) p[find(b)] = find(a);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); }
  return [...groups.values()].sort((x, y) => x[0] - y[0]);
};

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const area = (a: Rect) => Math.max(1, (a.r - a.l) * (a.b - a.t));

/**
 * Should two items move as one rigid cluster? Real overlap (two texts only when they share the same spot), or a small
 * stacked block — a number over its label, an icon over its caption — narrow, centered on each other, nearly touching.
 */
const sticks = (a: Item, b: Item, W: number) => {
  const ra = itemRect(a), rb = itemRect(b);
  // a path is a thin stroke: it only binds what it frames (a scribble around a word), not what its box happens to cross
  for (const [p, o] of [[a, b], [b, a]] as const) {
    if (p.layer.type === "path" && !p.pose) return Math.abs(o.vx - p.vx) < 0.25 * p.w && Math.abs(o.vy - p.vy) < 0.25 * p.h;
  }
  const ov = overlapArea(ra, rb);
  if (ov <= 0) {
    const narrow = a.w < 0.4 * W && b.w < 0.4 * W;
    const aligned = Math.abs(a.vx - b.vx) < 0.25 * Math.min(a.w, b.w) + 8;
    const gap = Math.max(ra.t, rb.t) - Math.min(ra.b, rb.b);
    return narrow && aligned && gap < 0.6 * Math.min(a.h, b.h) && (a.text || b.text);
  }
  const small = Math.min(area(ra), area(rb));
  return a.text && b.text ? ov >= small * 0.5 : ov >= small * 0.12;
};

const mkCluster = (items: Item[]): Cluster => {
  const bb = bounds(items.map(itemRect));
  return {
    items, ...bb,
    critical: items.some((i) => i.critical),
    visualArea: Math.max(0, ...items.filter((i) => !i.text && !i.critical).map((i) => i.w * i.h), ...items.filter((i) => i.layer.type === "logo").map((i) => i.w * i.h)),
    textOnly: items.every((i) => i.text),
  };
};
const mkUnit = (clusters: Cluster[]): Unit => ({
  clusters, ...bounds(clusters), f: 1,
  critical: clusters.some((c) => c.critical),
  visualArea: Math.max(0, ...clusters.map((c) => c.visualArea)),
  order: Math.max(...clusters.flatMap((c) => c.items.map((i) => i.order))),
});

/**
 * A row of ≥3 peers (similar sizes, e.g. an icon strip or a feature row) that no longer fits wraps into a balanced grid
 * of lines instead of a long single column. Returns the line units (in layout space), or null when it isn't a peer row.
 */
const wrapRow = (row: Cluster[], budget: number): Unit[] | null => {
  if (row.length < 3) return null;
  const areas = row.map((c) => (c.r - c.l) * (c.b - c.t));
  if (Math.max(...areas) > 6 * Math.min(...areas)) return null;
  const byX = [...row].sort((a, b) => a.l - b.l);
  const gs = byX.slice(1).map((c, i) => Math.max(0, c.l - byX[i].r)).sort((a, b) => a - b);
  const maxW = Math.max(...byX.map((c) => c.r - c.l)), lineH = Math.max(...byX.map((c) => c.b - c.t));
  const gap = Math.min(gs[Math.floor(gs.length / 2)] ?? 0, maxW * 0.6);
  const perLine = Math.floor((budget + gap) / (maxW + gap));
  if (perLine < 2) return null;
  const lines = Math.ceil(byX.length / perLine);
  const per = Math.ceil(byX.length / lines);
  const cx = (byX[0].l + byX[byX.length - 1].r) / 2, cy = (Math.min(...byX.map((c) => c.t)) + Math.max(...byX.map((c) => c.b))) / 2;
  const vgap = Math.max(gap, lineH * 0.3);
  const out: Unit[] = [];
  for (let j = 0; j < lines; j++) {
    const chunk = byX.slice(j * per, (j + 1) * per);
    const total = chunk.reduce((w, c) => w + (c.r - c.l), 0) + gap * (chunk.length - 1);
    let x = cx - total / 2;
    const y = cy + (j - (lines - 1) / 2) * (lineH + vgap);
    const moved = chunk.map((c) => {
      const dx = x + (c.r - c.l) / 2 - (c.l + c.r) / 2, dy = y - (c.t + c.b) / 2;
      x += c.r - c.l + gap;
      for (const it of c.items) { it.vx += dx; it.vy += dy; }
      return mkCluster(c.items);
    });
    out.push(mkUnit(moved));
  }
  return out;
};

/** Lay one scene's content items out for the target. Fills nx/ny/k/limitW of every item. */
const layoutItems = (items: Item[], ctx: Ctx) => {
  if (!items.length) return;
  const { s, W1, H1, safe } = ctx;
  // Clusters from scene layers; actor poses then join the cluster they sit on (they never glue two clusters together).
  const layerItems = items.filter((i) => !i.pose);
  const groups = components(layerItems.length, (a, b) => sticks(layerItems[a], layerItems[b], ctx.W0)).map((ix) => ix.map((i) => layerItems[i]));
  for (const it of items.filter((i) => i.pose)) {
    let best: Item[] | null = null, bestA = Infinity;
    for (const g of groups) {
      const r = bounds(g.map(itemRect));
      if (it.vx >= r.l && it.vx <= r.r && it.vy >= r.t && it.vy <= r.b && area(r) < bestA) { best = g; bestA = area(r); }
    }
    if (best) best.push(it); else groups.push([it]);
  }
  const clusters = groups.map(mkCluster);

  // rows: clusters sharing a horizontal band (≥40% of the smaller height)
  const rowIdx = components(clusters.length, (a, b) => {
    const A = clusters[a], B = clusters[b];
    const ov = Math.min(A.b, B.b) - Math.max(A.t, B.t);
    return ov > 0.4 * Math.min(A.b - A.t, B.b - B.t);
  });
  const units: Unit[] = [];
  for (const ix of rowIdx) {
    const row = ix.map((i) => clusters[i]);
    if (row.length === 1) { units.push(mkUnit(row)); continue; }
    const u = mkUnit(row);
    const limit = (u.critical ? safe.r - safe.l : W1 * 0.94);
    const need = (u.r - u.l) * s;
    if (need <= limit) units.push(u);
    else if (limit / need >= 0.8) { u.f = limit / need; units.push(u); }
    else {
      const grid = wrapRow(row, limit / s);
      if (grid) units.push(...grid);
      else {
        const areas = row.map((c) => (c.r - c.l) * (c.b - c.t));
        const peers = Math.max(...areas) <= 6 * Math.min(...areas);
        for (const c of [...row].sort((a, b) => (a.t + a.b) / 2 - (b.t + b.b) / 2 || (a.l + a.r) / 2 - (b.l + b.r) / 2)) units.push({ ...mkUnit([c]), split: ix[0], center: peers });
      }
    }
  }
  units.sort((a, b) => (a.t + a.b) / 2 - (b.t + b.b) / 2 || (a.l + a.r) / 2 - (b.l + b.r) / 2);

  // width fit per unit (critical → safe width, else frame)
  const fitWidth = (u: Unit, limitW: number) => {
    const w = (u.r - u.l) * s * u.f;
    if (w > limitW) u.f *= limitW / w;
    const hmax = u.critical ? safe.b - safe.t : H1 * 0.92;
    const h = (u.b - u.t) * s * u.f;
    if (h > hmax) u.f *= hmax / h;
  };

  const place = (col: Unit[], xCenter: number | null, limitW: number, center: number | null) => {
    for (const u of col) fitWidth(u, u.critical ? Math.min(limitW, safe.r - safe.l) : Math.min(limitW * 1.1, W1 * 0.94));
    const gMin = 0.02 * Math.min(W1, H1), gMax = 0.12 * H1, gStd = 0.035 * H1;
    const gaps: number[] = [];
    for (let i = 1; i < col.length; i++) {
      const src = col[i].t - col[i - 1].b;
      const a = col[i - 1], b = col[i];
      // satellites split off a hero's row (notification next to a phone) tuck onto the hero's edge when they paint above it
      const ha = (a.b - a.t) * s * a.f, hb = (b.b - b.t) * s * b.f;
      const [big, small, hs, hbg] = a.visualArea >= b.visualArea ? [a, b, hb, ha] : [b, a, ha, hb];
      const tuck = a.split !== undefined && a.split === b.split && big.visualArea > 0 && (small.r - small.l) * (small.b - small.t) <= 0.3 * big.visualArea && small.order > big.order;
      gaps.push(tuck ? -Math.min(0.1 * hbg, 0.45 * hs) : src >= 0 ? clamp(src * s * ctx.gamma, gMin, gMax) : gStd);
    }
    const srcCenter = center ?? ((col[0].t + col[col.length - 1].b) / 2) * ctx.sy;
    // shrink until critical units fit the safe band (and everything fits the frame)
    let f = 1;
    let best: { f: number; off: number; tops: number[] } | null = null;
    for (let iter = 0; iter < 14; iter++) {
      const tops: number[] = [];
      let y = 0;
      col.forEach((u, i) => { tops.push(y); y += (u.b - u.t) * s * u.f * f + (gaps[i] ?? 0) * f; });
      const total = y;
      let lo = -Infinity, hi = Infinity;
      col.forEach((u, i) => {
        const h = (u.b - u.t) * s * u.f * f;
        const [T, B] = u.critical ? [safe.t, safe.b] : [-H1 * 0.48, H1 * 0.48];
        lo = Math.max(lo, T - tops[i]);
        hi = Math.min(hi, B - (tops[i] + h));
      });
      const want = srcCenter - total / 2;
      if (lo <= hi) { best = { f, off: clamp(want, lo, hi), tops }; break; }
      best = { f, off: clamp(want, hi, lo), tops };
      if (f <= 0.56) break;
      f *= 0.94;
    }
    const { off, tops } = best!;
    f = best!.f;
    col.forEach((u, i) => {
      const k = s * u.f * f;
      const h = (u.b - u.t) * k, w = (u.r - u.l) * k;
      const ucx = (u.l + u.r) / 2, ucy = (u.t + u.b) / 2;
      let nx = xCenter ?? (u.center ? 0 : ucx * ctx.sx);
      const [L, R] = u.critical ? [safe.l, safe.r] : [-W1 * 0.5, W1 * 0.5];
      nx = clamp(nx, L + w / 2, R - w / 2);
      let ny = off + tops[i] + h / 2;
      if (u.critical) ny = clamp(ny, safe.t + h / 2, safe.b - h / 2);
      for (const c of u.clusters) for (const it of c.items) {
        it.k = k;
        it.nx = nx + (it.vx - ucx) * k;
        it.ny = ny + (it.vy - ucy) * k;
        it.limitW = limitW;
      }
    });
    const last = col.length - 1;
    return { f, height: tops[last] + (col[last].b - col[last].t) * s * col[last].f * f };
  };

  const wide = W1 / H1 >= 1.3;
  // Trial: a single column.
  const trial = units.map((u) => ({ ...u }));
  const single = place(trial, null, safe.r - safe.l, null);
  const hero = [...units].filter((u) => u.visualArea * s * s >= 0.05 * W1 * H1).sort((a, b) => b.visualArea - a.visualArea)[0];
  // landscape targets read better as [copy | visual] than as a tall, cramped column
  const rest = units.filter((u) => u !== hero);
  const restArea = rest.reduce((a, u) => a + (u.r - u.l) * (u.b - u.t), 0);
  if (wide && hero && rest.length && restArea >= 0.2 * (hero.r - hero.l) * (hero.b - hero.t) && (single.f < 0.9 || single.height > 0.78 * (safe.b - safe.t))) {
    // Two columns, vertically centered on the same axis: the dominant visual right, everything else stacked left.
    const gutter = 0.03 * W1;
    const mid = (safe.t + safe.b) / 2;
    place(rest, (safe.l - gutter) / 2, -gutter - safe.l, mid);
    const hw = (hero.r - hero.l) * s, hh = (hero.b - hero.t) * s;
    hero.f = Math.min(1, (W1 * 0.44) / hw, (H1 * 0.86) / hh);
    place([hero], W1 * 0.25, W1 * 0.44, mid);
    return;
  }
  // keep the single column result
  units.forEach((u, i) => { u.f = trial[i].f; });
};

// ------------------------------------------------------------------------------------------------ applying

/** Text floors: hooks ≥80px, body ≥48px on vertical targets; elsewhere never shrink below them by reflow. */
const fontFloor = (orig: number, hook: boolean, ctx: Ctx) => {
  const floor = hook ? 80 : 48;
  if (ctx.vertical && orig >= (hook ? 40 : 28)) return floor;
  return Math.min(orig, floor);
};

const scaleMoves = (l: Any, k: number, mxk: number, myk: number) => {
  if (Array.isArray(l.animate)) for (const kf of l.animate) {
    if (num(kf.x)) kf.x = r1(kf.x * mxk);
    if (num(kf.y)) kf.y = r1(kf.y * myk);
  }
  for (const m of [l.enter, l.exit]) if (m && num(m.distance)) m.distance = r1(m.distance * k);
  if (l.gesture) l.gesture.distance = r1((l.gesture.distance ?? 480) * k);
  if (l.repeat) { if (num(l.repeat.x)) l.repeat.x = r1(l.repeat.x * k); if (num(l.repeat.y)) l.repeat.y = r1(l.repeat.y * k); }
};

const mul = (l: Any, key: string, k: number, round = r1) => { if (num(l[key])) l[key] = round(l[key] * k); };

/** Resize a content layer by k (crisp: font sizes / widths, rigid composites via `scale`). */
const resizeContent = (l: Any, k: number, ctx: Ctx, hook: boolean, limitW: number) => {
  if (Math.abs(k - 1) < 1e-3 && l.type !== "text" && l.type !== "counter" && l.type !== "captions") return;
  switch (l.type) {
    case "text": {
      const fs0 = num(l.fontSize) ? l.fontSize : 120;
      let fs = fs0 * k;
      // fit the safe/column width by font size (the engine's auto-fit only knows the frame)
      const nat = textNaturalW(l, fs);
      const cap = num(l.maxWidth) ? l.maxWidth * k : num(l.width) ? l.width * k : null;
      if (cap == null && nat > limitW) fs *= limitW / nat;
      fs = Math.max(fs, fontFloor(fs0, hook, ctx));
      l.fontSize = Math.floor(fs);
      const capW = Math.min(limitW, ctx.W1 * 0.9);
      for (const key of ["maxWidth", "width"]) if (num(l[key])) l[key] = Math.round(Math.min(l[key] * k, capW));
      if (l.stroke && num(l.stroke.width)) l.stroke.width = r1(l.stroke.width * k);
      return;
    }
    case "counter": {
      const fs0 = num(l.fontSize) ? l.fontSize : 140;
      l.fontSize = Math.round(Math.max(fs0 * k, fontFloor(fs0, hook, ctx)));
      return;
    }
    case "captions": {
      if (num(l.fontSize)) l.fontSize = Math.round(Math.max(l.fontSize * k, fontFloor(l.fontSize, false, ctx)));
      // the caption box defaults to 85% of the frame: pin it to the safe/column width so pages wrap inside it
      l.width = Math.round(Math.min(num(l.width) ? l.width * k : ctx.W1 * 0.85, limitW, ctx.safe.r - ctx.safe.l));
      return;
    }
    case "card": {
      const fs0 = num(l.fontSize) ? l.fontSize : 26;
      const fs = Math.max(fs0 * k, Math.min(fs0, ctx.vertical ? 26 : 22));
      l.fontSize = r1(fs);
      const capW = Math.min(limitW, ctx.safe.r - ctx.safe.l, ctx.W1 * 0.88);
      if (num(l.width)) l.width = Math.round(Math.min(l.width * k, capW));
      if (num(l.height)) l.height = Math.round(l.height * (fs / fs0));
      return;
    }
    case "logo": {
      if (!num(l.width) && !num(l.height)) l.height = 300;
      mul(l, "width", k, Math.round); mul(l, "height", k, Math.round);
      return;
    }
    case "morph": {
      if (!num(l.width)) l.width = 400;
      if (!num(l.height)) l.height = 400;
      mul(l, "width", k, Math.round); mul(l, "height", k, Math.round); mul(l, "strokeWidth", k);
      return;
    }
    case "shape": {
      if (!num(l.width)) l.width = 200;
      mul(l, "width", k, Math.round); mul(l, "height", k, Math.round); mul(l, "strokeWidth", k); mul(l, "radius", k);
      return;
    }
    case "media": case "path": case "three": {
      if (num(l.width) || num(l.height)) {
        mul(l, "width", k, Math.round); mul(l, "height", k, Math.round); mul(l, "radius", k); mul(l, "strokeWidth", k);
        if (l.follower && num(l.follower.size)) l.follower.size = r1(l.follower.size * k);
        return;
      }
      l.scale = r3((num(l.scale) ? l.scale : 1) * k);
      return;
    }
    default:
      // device / group / custom / lottie: rigid composites (inner px layouts stay intact)
      l.scale = r3((num(l.scale) ? l.scale : 1) * k);
  }
};

/** Fill layers adopt the new canvas: explicit sizes and positions per axis. */
const applyFill = (l: Any, ctx: Ctx, mapPoint: MapPoint) => {
  const { sx, sy, s } = ctx;
  const x0 = num(l.x) ? l.x : 0, y0 = num(l.y) ? l.y : 0;
  if (num(l.x)) l.x = r1(l.x * sx);
  if (num(l.y)) l.y = r1(l.y * sy);
  mul(l, "width", sx, Math.round); mul(l, "height", sy, Math.round);
  mul(l, "strokeWidth", s);
  if (l.type === "particles" && (num(l.originX) || num(l.originY))) {
    const p = mapPoint(x0 + (num(l.originX) ? l.originX : 0), y0 + (num(l.originY) ? l.originY : 0));
    l.originX = r1(p.x - (num(l.x) ? l.x : 0));
    l.originY = r1(p.y - (num(l.y) ? l.y : 0));
  }
  if (l.type === "cloud") {
    mul(l, "radius", s); mul(l, "itemSize", s);
    if (l.avoidCenter) { mul(l.avoidCenter, "width", s, Math.round); mul(l.avoidCenter, "height", s, Math.round); }
  }
  if (l.follower && num(l.follower.size)) l.follower.size = r1(l.follower.size * s);
  if (Array.isArray(l.animate)) for (const kf of l.animate) { if (num(kf.x)) kf.x = r1(kf.x * sx); if (num(kf.y)) kf.y = r1(kf.y * sy); }
  if (l.path?.points) l.path.points = l.path.points.map(([x, y]: [number, number]) => { const p = mapPoint(x, y); return [r1(p.x), r1(p.y)]; });
};

type MapPoint = (x: number, y: number) => { x: number; y: number; k: number };

/** Point mapping for a laid-out scene: points inside (or near) a cluster follow it; elsewhere proportional. */
const makeMapPoint = (items: Item[], ctx: Ctx): MapPoint => (x, y) => {
  let best: Item | null = null;
  let bestA = Infinity;
  for (const it of items) {
    const pad = Math.max(40, 0.15 * Math.max(it.w, it.h));
    if (Math.abs(x - it.cx) <= it.w / 2 + pad && Math.abs(y - it.cy) <= it.h / 2 + pad) {
      const a = it.w * it.h;
      if (a < bestA) { bestA = a; best = it; }
    }
  }
  if (best) return { x: best.nx + (x - best.cx) * best.k, y: best.ny + (y - best.cy) * best.k, k: best.k };
  return { x: x * ctx.sx, y: y * ctx.sy, k: ctx.s };
};

// ------------------------------------------------------------------------------------------------ adapt overrides

const walkLayers = (layers: Any[] | undefined, fn: (l: Any) => void) => {
  for (const l of layers ?? []) {
    fn(l);
    if (l.type === "group") walkLayers(l.layers, fn);
    if (l.type === "device") for (const sc of l.screens ?? []) walkLayers(sc.layers, fn);
  }
};

const applyAdapt = (spec: Any, target: Format) => {
  const apply = (l: Any) => {
    const o = l.adapt?.[target];
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "adapt" && k !== "type") l[k] = v;
  };
  for (const sc of spec.scenes ?? []) walkLayers(sc.layers, apply);
  for (const a of spec.actors ?? []) walkLayers([a.layer], apply);
};

// ------------------------------------------------------------------------------------------------ main

const sceneIdx = (scenes: Any[], ref: unknown): number => {
  if (typeof ref === "number") return ref >= 0 && ref < scenes.length ? ref : -1;
  return scenes.findIndex((s) => s.id === ref);
};

/**
 * Adapt a film to `target`. Works on a parsed Spec (or any spec-shaped input with numeric times); returns a deep copy
 * with `format: target`. Identity (plus `adapt[target]` overrides) when the target is the master format.
 */
export const reflowSpec = <T extends Spec>(input: T, target: Format): T => {
  if (!isFormat(target)) throw new Error(`Unknown format "${String(target)}". Use one of: ${FORMAT_LIST.join(", ")}`);
  const spec = clone(input) as Any;
  const [W0, H0] = srcSize(input);
  const [W1, H1] = FORMATS[target];
  if (W0 === W1 && H0 === H1) {
    spec.format = target;
    delete spec.width; delete spec.height;
    applyAdapt(spec, target);
    return spec as T;
  }
  const ctx = makeCtx(W0, H0, target);
  const scenes: Any[] = spec.scenes ?? [];
  const actors: Any[] = spec.actors ?? [];

  // actors: base size follows the global scale; their poses join each scene's layout as pseudo items
  const actorBox = actors.map((a) => {
    const b = estimateBox(a.layer ?? {}, W0, H0);
    const s = num(a.layer?.scale) ? a.layer.scale : 1;
    return { w: b.w * s, h: b.h * s };
  });

  const mapPoints: MapPoint[] = [];
  scenes.forEach((scene, si) => {
    const items: Item[] = [];
    const fills: Any[] = [];
    let maxText = 0;
    for (const l of scene.layers ?? []) if (si === 0 && (l.type === "text" || l.type === "counter")) maxText = Math.max(maxText, num(l.fontSize) ? l.fontSize : l.type === "text" ? 120 : 140);
    (scene.layers ?? []).forEach((l: Any, li: number) => {
      if (isFill(l, W0, H0)) { fills.push(l); return; }
      const b = estimateBox(l, W0, H0);
      const sc = num(l.scale) ? l.scale : 1;
      const last = l.path?.points?.length ? l.path.points[l.path.points.length - 1] : null;
      const fs = num(l.fontSize) ? l.fontSize : l.type === "text" ? 120 : 140;
      items.push({
        layer: l,
        cx: last ? last[0] : num(l.x) ? l.x : 0, cy: last ? last[1] : num(l.y) ? l.y : 0,
        vx: last ? last[0] : num(l.x) ? l.x : 0, vy: last ? last[1] : num(l.y) ? l.y : 0,
        w: Math.max(1, b.w * sc), h: Math.max(1, b.h * sc),
        critical: isCritical(l), text: TEXTY.has(l.type),
        hook: si === 0 && (l.type === "text" || l.type === "counter") && (fs >= maxText || (num(l.start) ? l.start : 0) <= 0.5) && fs >= 40,
        order: num(l.zIndex) ? l.zIndex : li,
        nx: 0, ny: 0, k: ctx.s, limitW: ctx.safe.r - ctx.safe.l,
      });
    });
    actors.forEach((a, ai) => {
      for (const p of a.poses ?? []) {
        if (p.snapTo || sceneIdx(scenes, p.scene) !== si || (!num(p.x) && !num(p.y))) continue;
        const ps = num(p.scale) ? p.scale : 1;
        items.push({
          layer: a.layer ?? {}, pose: p, actorLayer: a.layer,
          cx: num(p.x) ? p.x : 0, cy: num(p.y) ? p.y : 0, vx: num(p.x) ? p.x : 0, vy: num(p.y) ? p.y : 0,
          w: Math.max(1, actorBox[ai].w * ps), h: Math.max(1, actorBox[ai].h * ps),
          critical: isCritical(a.layer ?? {}), text: TEXTY.has(a.layer?.type), hook: false, order: 10_000 + ai,
          nx: 0, ny: 0, k: ctx.s, limitW: ctx.safe.r - ctx.safe.l,
        });
      }
    });

    layoutItems(items, ctx);
    const mapPoint = makeMapPoint(items, ctx);
    mapPoints[si] = mapPoint;

    for (const it of items) {
      if (it.pose) {
        it.pose.x = r1(it.nx); it.pose.y = r1(it.ny);
        const ratio = clamp(it.k / ctx.s, 0.4, 2.5);
        if (Math.abs(ratio - 1) > 1e-3) it.pose.scale = r3((num(it.pose.scale) ? it.pose.scale : 1) * ratio);
        continue;
      }
      const l = it.layer;
      const x0 = num(l.x) ? l.x : 0, y0 = num(l.y) ? l.y : 0;
      if (l.path?.points) {
        const last = l.path.points[l.path.points.length - 1];
        l.path.points = l.path.points.map(([x, y]: [number, number]) => [r1(it.nx + (x - last[0]) * it.k * ctx.mx), r1(it.ny + (y - last[1]) * it.k * ctx.my)]);
      }
      if (num(l.x) || Math.abs(it.nx - x0) >= 0.5) l.x = r1(l.path?.points ? x0 * ctx.sx : it.nx);
      if (num(l.y) || Math.abs(it.ny - y0) >= 0.5) l.y = r1(l.path?.points ? y0 * ctx.sy : it.ny);
      resizeContent(l, it.k, ctx, it.hook, it.limitW);
      scaleMoves(l, it.k, it.k * ctx.mx, it.k * ctx.my);
      // safety net: font floors may have grown a critical layer after layout → keep it inside the safe zone
      if (it.critical && !l.path?.points) {
        const b = estimateBox(l, W1, H1);
        const sc = num(l.scale) ? l.scale : 1;
        const S = ctx.safe;
        const x = clamp(num(l.x) ? l.x : 0, S.l + (b.w * sc) / 2, S.r - (b.w * sc) / 2);
        const y = clamp(num(l.y) ? l.y : 0, S.t + (b.h * sc) / 2, S.b - (b.h * sc) / 2);
        if (Math.abs(x - (num(l.x) ? l.x : 0)) >= 0.5) l.x = r1(x);
        if (Math.abs(y - (num(l.y) ? l.y : 0)) >= 0.5) l.y = r1(y);
      }
    }
    for (const l of fills) applyFill(l, ctx, mapPoint);

    // camera looks at mapped points
    for (const kf of scene.camera?.keyframes ?? []) {
      // (0,0) is the neutral camera, not a point of interest
      if (!(num(kf.x) && kf.x !== 0) && !(num(kf.y) && kf.y !== 0)) continue;
      const p = mapPoint(num(kf.x) ? kf.x : 0, num(kf.y) ? kf.y : 0);
      if (num(kf.x)) kf.x = r1(p.x);
      if (num(kf.y)) kf.y = r1(p.y);
    }
    if (scene.camera?.shake && num(scene.camera.shake.amount)) scene.camera.shake.amount = r1(scene.camera.shake.amount * ctx.s);
    // spotlight backgrounds
    for (const bg of Array.isArray(scene.background) ? scene.background : scene.background ? [scene.background] : []) {
      if (bg.type !== "spotlight") continue;
      if (num(bg.x) || num(bg.y)) {
        const p = mapPoint(num(bg.x) ? bg.x : 0, num(bg.y) ? bg.y : 0);
        if (num(bg.x)) bg.x = r1(p.x);
        if (num(bg.y)) bg.y = r1(p.y);
      }
      if (num(bg.size) && bg.size > 10) bg.size = Math.round(bg.size * Math.max(W1, H1) / Math.max(W0, H0));
    }
  });

  // transitions: x/y origins live in the PREVIOUS scene's coordinates
  scenes.forEach((scene, si) => {
    const tr = scene.transition;
    if (!tr || si === 0 || (!num(tr.x) && !num(tr.y))) return;
    const p = mapPoints[si - 1](num(tr.x) ? tr.x : 0, num(tr.y) ? tr.y : 0);
    if (num(tr.x)) tr.x = r1(p.x);
    if (num(tr.y)) tr.y = r1(p.y);
  });

  // actor layers: base size by the global scale (poses carry the per-scene ratio)
  for (const a of actors) {
    if (!a.layer) continue;
    const l = a.layer;
    resizeContent(l, ctx.s, ctx, false, ctx.safe.r - ctx.safe.l);
    scaleMoves(l, ctx.s, ctx.s * ctx.mx, ctx.s * ctx.my);
  }

  spec.format = target;
  delete spec.width; delete spec.height;
  applyAdapt(spec, target);
  return spec as T;
};

// ------------------------------------------------------------------------------------------------ inspection

export type LayoutBox = { scene: number; layer: number | null; actor?: string; type: string; critical: boolean; x: number; y: number; w: number; h: number; fontSize?: number };

/**
 * Estimated boxes of every top-level content layer and positioned actor pose, per scene (same estimator the reflow
 * uses) — for tests, craft warnings and debug overlays. Fill layers are skipped.
 */
export const layoutBoxes = (spec: Spec): LayoutBox[] => {
  const [W, H] = srcSize(spec);
  const out: LayoutBox[] = [];
  const scenes = spec.scenes as Any[];
  scenes.forEach((sc, si) => {
    (sc.layers ?? []).forEach((l: Any, li: number) => {
      if (isFill(l, W, H)) return;
      const b = estimateBox(l, W, H);
      const k = num(l.scale) ? l.scale : 1;
      const last = l.path?.points?.length ? l.path.points[l.path.points.length - 1] : null;
      out.push({ scene: si, layer: li, type: l.type, critical: isCritical(l), x: last ? last[0] : l.x ?? 0, y: last ? last[1] : l.y ?? 0, w: b.w * k, h: b.h * k, ...(TEXTY.has(l.type) || l.type === "card" ? { fontSize: l.fontSize } : {}) });
    });
  });
  for (const a of (spec.actors ?? []) as Any[]) {
    const b = estimateBox(a.layer ?? {}, W, H);
    const k = num(a.layer?.scale) ? a.layer.scale : 1;
    for (const p of a.poses ?? []) {
      if (p.snapTo || (!num(p.x) && !num(p.y))) continue;
      const ps = num(p.scale) ? p.scale : 1;
      out.push({ scene: sceneIdx(scenes, p.scene), layer: null, actor: a.id, type: a.layer?.type ?? "?", critical: isCritical(a.layer ?? {}), x: p.x ?? 0, y: p.y ?? 0, w: b.w * k * ps, h: b.h * k * ps });
    }
  }
  return out;
};
