/**
 * Diagram model (pure): node sizes, auto layout (ranked flow right / down, radial hub, or manual), edge routing
 * (curved / orthogonal / straight between facing ports), sampled edge geometry for packets, and the reveal timeline.
 * The Diagram component, the sound planner and the reflow estimate all read this, so they agree on every number.
 */
import type { z } from "zod";
import { getLength, getPointAtLength } from "@remotion/paths";
import type { DiagramLayer } from "../../spec/schema";

export type DiagramL = z.infer<typeof DiagramLayer>;
type Node = DiagramL["nodes"][number];
type Pt = [number, number];

export type NodeGeo = {
  id: string; node: Node; index: number;
  /** center (px from diagram center, before fit scale) */
  x: number; y: number;
  /** port box (the visible shape) */
  w: number; h: number;
  /** footprint used for spacing (circle labels hang below the shape) */
  lw: number; lh: number;
  rank: number; order: number; appear: number;
};
export type EdgeGeo = {
  index: number; from: string; to: string; d: string; len: number; samples: Pt[];
  start: number; end: number; mid: Pt; tip: Pt; dir: Pt;
  edge: NonNullable<DiagramL["edges"]>[number];
};
export type DiagramModel = { nodes: NodeGeo[]; edges: EdgeGeo[]; W: number; H: number; scale: number; land: number; fs: number };

const textW = (s: string, fs: number, k = 0.56) => s.length * fs * k;

const nodeSize = (n: Node, fs: number): { w: number; h: number; lw: number; lh: number } => {
  const shape = n.shape ?? "card";
  const icon = n.icon ? fs * 1.9 : 0;
  const lab = textW(n.label, fs), sub = n.sub ? textW(n.sub, fs * 0.78, 0.54) : 0;
  switch (shape) {
    case "pill": { const w = n.width ?? Math.max(fs * 4, Math.max(lab, sub) + fs * 1.8 + (n.icon ? fs * 1.5 : 0)); const h = fs * (n.sub ? 2.9 : 2.1); return { w, h, lw: w, lh: h }; }
    case "chip": { const w = n.width ?? textW(n.label, fs * 0.74, 0.66) + fs * 1.6; const h = fs * 1.6; return { w, h, lw: w, lh: h }; }
    case "circle": { const D = n.width ?? fs * 3.4; const lw = Math.max(D, lab, sub); return { w: D, h: D, lw, lh: D + fs * (n.sub ? 2.6 : 1.6) }; }
    case "diamond": { const s = n.width ?? Math.max(fs * 3.6, lab * 0.85 + fs); const b = s * Math.SQRT2; return { w: b, h: b, lw: b, lh: b }; }
    default: { const w = n.width ?? Math.max(fs * 6.5, icon + Math.max(lab, sub) + fs * 2); const h = fs * (n.sub ? 3.3 : 2.5); return { w, h, lw: w, lh: h }; }
  }
};

/** Longest-path ranks; back edges (cycles) are ignored for ranking. */
const rankNodes = (ids: string[], edges: { from: string; to: string }[]): Map<string, number> => {
  const out = new Map<string, string[]>();
  ids.forEach((id) => out.set(id, []));
  for (const e of edges) if (out.has(e.from) && out.has(e.to) && e.from !== e.to) out.get(e.from)!.push(e.to);
  // DFS to drop back edges
  const state = new Map<string, 0 | 1 | 2>();
  const dag = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const s = state.get(v) ?? 0;
      if (s === 1) continue; // back edge
      dag.get(u)!.push(v);
      if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  ids.forEach((id) => { if (!state.get(id)) visit(id); });
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [, vs] of dag) for (const v of vs) indeg.set(v, (indeg.get(v) ?? 0) + 1);
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => !indeg.get(id));
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of dag.get(u)!) {
      rank.set(v, Math.max(rank.get(v)!, rank.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (!indeg.get(v)) queue.push(v);
    }
  }
  return rank;
};

const route = (a: NodeGeo, b: NodeGeo, axis: "h" | "v", connector: "curved" | "orthogonal" | "straight"): { d: string; p0: Pt; p1: Pt } => {
  let p0: Pt, p1: Pt, n0: Pt, n1: Pt;
  if (axis === "h") {
    const s = b.x >= a.x ? 1 : -1;
    p0 = [a.x + (s * a.w) / 2, a.y]; p1 = [b.x - (s * b.w) / 2, b.y]; n0 = [s, 0]; n1 = [s, 0];
  } else {
    const s = b.y >= a.y ? 1 : -1;
    // circle labels hang below the shape: a connector leaving / entering from below starts under the label
    const below = (g: NodeGeo) => g.h / 2 + (g.node.shape === "circle" ? g.lh - g.h : 0);
    p0 = [a.x, s > 0 ? a.y + below(a) : a.y - a.h / 2]; p1 = [b.x, s > 0 ? b.y - b.h / 2 : b.y + below(b)]; n0 = [0, s]; n1 = [0, s];
  }
  const f = (n: number) => Math.round(n * 10) / 10;
  if (connector === "straight") return { d: `M${f(p0[0])},${f(p0[1])} L${f(p1[0])},${f(p1[1])}`, p0, p1 };
  if (connector === "orthogonal") {
    const r = 16;
    if (axis === "h") {
      const mx = (p0[0] + p1[0]) / 2, dy = p1[1] - p0[1], sy = Math.sign(dy), sx = Math.sign(p1[0] - p0[0]) || 1;
      if (Math.abs(dy) < 2 * r) return { d: `M${f(p0[0])},${f(p0[1])} L${f(p1[0])},${f(p1[1])}`, p0, p1 };
      return { d: `M${f(p0[0])},${f(p0[1])} L${f(mx - sx * r)},${f(p0[1])} Q${f(mx)},${f(p0[1])} ${f(mx)},${f(p0[1] + sy * r)} L${f(mx)},${f(p1[1] - sy * r)} Q${f(mx)},${f(p1[1])} ${f(mx + sx * r)},${f(p1[1])} L${f(p1[0])},${f(p1[1])}`, p0, p1 };
    }
    const my = (p0[1] + p1[1]) / 2, dx = p1[0] - p0[0], sx = Math.sign(dx), sy = Math.sign(p1[1] - p0[1]) || 1;
    if (Math.abs(dx) < 2 * r) return { d: `M${f(p0[0])},${f(p0[1])} L${f(p1[0])},${f(p1[1])}`, p0, p1 };
    return { d: `M${f(p0[0])},${f(p0[1])} L${f(p0[0])},${f(my - sy * r)} Q${f(p0[0])},${f(my)} ${f(p0[0] + sx * r)},${f(my)} L${f(p1[0] - sx * r)},${f(my)} Q${f(p1[0])},${f(my)} ${f(p1[0])},${f(my + sy * r)} L${f(p1[0])},${f(p1[1])}`, p0, p1 };
  }
  const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const k = Math.max(30, dist * 0.42);
  return { d: `M${f(p0[0])},${f(p0[1])} C${f(p0[0] + n0[0] * k)},${f(p0[1] + n0[1] * k)} ${f(p1[0] - n1[0] * k)},${f(p1[1] - n1[1] * k)} ${f(p1[0])},${f(p1[1])}`, p0, p1 };
};

export const diagramModel = (l: DiagramL): DiagramModel => {
  const fs = l.fontSize ?? 26;
  const nodes = l.nodes;
  const edges = (l.edges ?? []).filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const manual = l.layout === "manual" || (l.layout === undefined && nodes.every((n) => n.x !== undefined && n.y !== undefined));
  const layout = manual ? "manual" : l.layout ?? "right";
  const sizes = nodes.map((n) => nodeSize(n, fs));
  const geo: NodeGeo[] = nodes.map((n, i) => ({ id: n.id, node: n, index: i, x: n.x ?? 0, y: n.y ?? 0, ...sizes[i], rank: 0, order: i, appear: 0 }));
  const byId = new Map(geo.map((g) => [g.id, g]));
  const gap = l.gap ?? Math.max(90, fs * 4.4);

  if (layout === "right" || layout === "down") {
    const rank = rankNodes(nodes.map((n) => n.id), edges);
    geo.forEach((g) => { g.rank = rank.get(g.id) ?? 0; });
    const ranks = Math.max(0, ...geo.map((g) => g.rank)) + 1;
    const cols: NodeGeo[][] = Array.from({ length: ranks }, () => []);
    geo.forEach((g) => cols[g.rank].push(g));
    // barycenter ordering (two sweeps) to keep edges from crossing
    const preds = (g: NodeGeo) => edges.filter((e) => e.to === g.id).map((e) => byId.get(e.from)!).filter((p) => p.rank < g.rank);
    for (let sweep = 0; sweep < 2; sweep++) {
      for (let r = 1; r < ranks; r++) {
        cols[r].sort((a, b) => {
          const ba = preds(a), bb = preds(b);
          const ma = ba.length ? ba.reduce((s, p) => s + p.order, 0) / ba.length : a.order;
          const mb = bb.length ? bb.reduce((s, p) => s + p.order, 0) / bb.length : b.order;
          return ma - mb;
        });
        cols[r].forEach((g, i) => { g.order = i; });
      }
    }
    cols[0]?.forEach((g, i) => { g.order = i; });
    const across = layout === "right" ? "lh" : "lw";
    const along = layout === "right" ? "lw" : "lh";
    const sep = fs * 1.3;
    let cursor = 0;
    cols.forEach((col) => {
      const thick = Math.max(...col.map((g) => g[along]));
      const total = col.reduce((s, g) => s + g[across], 0) + sep * Math.max(0, col.length - 1);
      let off = -total / 2;
      col.forEach((g) => {
        const c = off + g[across] / 2;
        const lift = g.node.shape === "circle" ? (g.lh - g.h) / 2 : 0; // the shape sits above its hanging label
        if (layout === "right") { g.x = cursor + thick / 2; g.y = c - lift; } else { g.x = c; g.y = cursor + thick / 2 - lift; }
        off += g[across] + sep;
      });
      cursor += thick + gap;
    });
  } else if (layout === "radial") {
    const degree = (id: string) => edges.filter((e) => e.from === id || e.to === id).length;
    const hub = [...geo].sort((a, b) => degree(b.id) - degree(a.id) || a.index - b.index)[0];
    const others = geo.filter((g) => g !== hub);
    const R = Math.max(gap * 1.6, ...others.map((g) => Math.max(g.lw, g.lh))) + Math.max(hub.lw, hub.lh) * 0.5;
    hub.x = 0; hub.y = 0; hub.rank = 0;
    others.forEach((g, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, others.length);
      g.x = Math.cos(a) * R * 1.25; g.y = Math.sin(a) * R; g.rank = 1; g.order = i;
    });
  }

  // center the drawing on its bounds
  const L = Math.min(...geo.map((g) => g.x - g.lw / 2)), R = Math.max(...geo.map((g) => g.x + g.lw / 2));
  const T = Math.min(...geo.map((g) => g.y - g.h / 2)), B = Math.max(...geo.map((g) => g.y - g.h / 2 + g.lh));
  if (layout !== "manual") geo.forEach((g) => { g.x -= (L + R) / 2; g.y -= (T + B) / 2; });
  const bw = R - L, bh = B - T;
  const margin = fs * 1.6 + (l.title ? fs * 1.6 : 0);
  const W = l.width ?? Math.round(bw + margin * 2), H = l.height ?? Math.round(bh + margin * 2);
  // fit the box: shrink when it is too small, grow (up to 1.5×) when the box was sized larger than the drawing
  const scale = Math.min(1.5, (W - margin * 2) / Math.max(1, bw), (H - margin * 2) / Math.max(1, bh));

  // reveal order: flow order (rank, then order), unless a node sets `at`
  const stagger = l.stagger ?? 0.22;
  const ordered = [...geo].sort((a, b) => a.rank - b.rank || a.order - b.order || a.index - b.index);
  ordered.forEach((g, k) => { g.appear = g.node.at ?? 0.15 + k * stagger; });

  const edgeGeo: EdgeGeo[] = edges.map((e, i) => {
    const a = byId.get(e.from)!, b = byId.get(e.to)!;
    const axis: "h" | "v" = layout === "right" ? "h" : layout === "down" ? "v" : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "h" : "v";
    const { d, p1 } = route(a, b, axis, l.connector ?? "curved");
    const len = Math.max(1, getLength(d));
    const samples: Pt[] = Array.from({ length: 49 }, (_, k) => { const p = getPointAtLength(d, (len * k) / 48); return p ? [p.x, p.y] : [p1[0], p1[1]]; });
    const dur = Math.max(0.35, Math.min(0.8, len / 1400));
    const start = e.at ?? (b.appear >= a.appear ? Math.max(a.appear + 0.2, b.appear - dur * 0.85) : Math.max(a.appear, b.appear) + 0.2);
    const pre = samples[samples.length - 3];
    const dl = Math.hypot(p1[0] - pre[0], p1[1] - pre[1]) || 1;
    return { index: i, from: e.from, to: e.to, d, len, samples, start, end: start + dur, mid: samples[24], tip: p1, dir: [(p1[0] - pre[0]) / dl, (p1[1] - pre[1]) / dl], edge: e };
  });
  const land = Math.max(0, ...geo.map((g) => g.appear + 0.55), ...edgeGeo.map((e) => e.end));
  return { nodes: geo, edges: edgeGeo, W, H, scale, land, fs };
};

/** Position along sampled edge geometry (u in 0..1). */
export const sampleAt = (s: Pt[], u: number): Pt => {
  const f = Math.max(0, Math.min(1, u)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(f)), k = f - i;
  return [s[i][0] + (s[i + 1][0] - s[i][0]) * k, s[i][1] + (s[i + 1][1] - s[i][1]) * k];
};

/** Focus intensity of each focus beat at time t (0..1), crossfading into the next beat. */
export const focusLevels = (l: DiagramL, t: number): { nodes: Set<string>; level: number }[] => {
  const beats = [...(l.focus ?? [])].sort((a, b) => a.at - b.at);
  return beats.map((f, i) => {
    const end = f.until ?? beats[i + 1]?.at ?? Infinity;
    const rampIn = Math.max(0, Math.min(1, (t - f.at) / 0.35));
    const rampOut = end === Infinity ? 1 : 1 - Math.max(0, Math.min(1, (t - end) / 0.35));
    const lv = rampIn * rampOut;
    return { nodes: new Set(f.nodes), level: lv * (3 - 2 * lv) * (lv > 0 ? 1 : 0) };
  });
};
