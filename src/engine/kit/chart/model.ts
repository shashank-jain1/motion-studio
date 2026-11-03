/**
 * Chart model (pure, no React): box defaults, item timing and value domains. Shared by the Chart component, the
 * auto sound planner (ticks as bars land) and the linter, so sound and picture can never disagree.
 */
import type { z } from "zod";
import type { ChartLayer } from "../../spec/schema";
import { niceScale } from "../surface";

export type ChartL = z.infer<typeof ChartLayer>;
export type Span = { start: number; end: number };

const ROUND = new Set(["donut", "pie", "rings"]);
export const isRound = (kind: ChartL["kind"]) => ROUND.has(kind);

export const chartBox = (l: Pick<ChartL, "kind" | "width" | "height">): { w: number; h: number } => {
  if (isRound(l.kind)) return { w: l.width ?? 860, h: l.height ?? 520 };
  return { w: l.width ?? 880, h: l.height ?? 560 };
};

/** Items (bars / segments / rings) with their resolved labels. Line charts return one item per series. */
export const chartItems = (l: ChartL): { label: string; value: number; color?: string }[] => {
  if (l.kind === "line" || l.kind === "area") {
    return (l.series ?? []).map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, value: s.values[s.values.length - 1] ?? 0, color: s.color }));
  }
  return (l.data ?? []).map((d, i) => ({ label: d.label ?? String(i + 1), value: d.value, color: d.color }));
};

/** Index of the highlighted item (by index or label), or -1. */
export const highlightIndex = (l: ChartL): number => {
  if (l.highlight === undefined) return -1;
  const items = l.kind === "line" || l.kind === "area" ? (l.labels ?? []).map((x) => ({ label: x })) : chartItems(l);
  if (typeof l.highlight === "number") return l.highlight >= 0 && l.highlight < items.length ? l.highlight : -1;
  const k = items.findIndex((it) => it.label.toLowerCase() === String(l.highlight).toLowerCase());
  return k;
};

/** When each item animates (seconds after layer start) and when the whole chart has landed. */
export const chartTiming = (l: ChartL): { items: Span[]; land: number; grid: Span } => {
  const grid = { start: 0, end: 0.6 };
  const stagger = l.stagger ?? (l.kind === "hbar" ? 0.09 : 0.07);
  const grow = l.growDuration ?? 0.9;
  const draw = l.drawDuration ?? 1.6;
  const s0 = 0.28;
  if (l.kind === "line" || l.kind === "area") {
    const items = (l.series ?? []).map((_, i) => ({ start: s0 + i * 0.3, end: s0 + i * 0.3 + draw }));
    return { items, land: Math.max(s0 + draw, ...items.map((s) => s.end)), grid };
  }
  const data = l.data ?? [];
  if (l.kind === "donut" || l.kind === "pie") {
    const total = data.reduce((a, d) => a + Math.max(0, d.value), 0) || 1;
    let cum = 0;
    const items = data.map((d) => {
      const a = cum / total;
      cum += Math.max(0, d.value);
      return { start: s0 + draw * sweepEase(a), end: s0 + draw * sweepEase(cum / total) };
    });
    return { items, land: s0 + draw, grid };
  }
  if (l.kind === "rings") {
    const items = data.map((_, i) => ({ start: s0 + i * stagger * 2, end: s0 + i * stagger * 2 + grow * 1.5 }));
    return { items, land: Math.max(s0, ...items.map((s) => s.end)), grid };
  }
  const items = data.map((_, i) => ({ start: s0 + i * stagger, end: s0 + i * stagger + grow }));
  return { items, land: Math.max(s0, ...items.map((s) => s.end)), grid };
};

/** Inverse-ish of the donut sweep ease (inOutQuint) so segment start times match where the sweep actually is. */
const sweepEase = (fraction: number) => {
  // find t with inOutQuint(t) = fraction (bisection; monotone)
  const f = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);
  let lo = 0, hi = 1;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (f(m) < fraction) lo = m; else hi = m; }
  return (lo + hi) / 2;
};

/** Value domain + ticks for bar / hbar / line / area. */
export const chartDomain = (l: ChartL): { min: number; max: number; ticks: number[] } => {
  const vals = l.kind === "line" || l.kind === "area" ? (l.series ?? []).flatMap((s) => s.values) : (l.data ?? []).map((d) => d.value);
  if (!vals.length) return { min: 0, max: 1, ticks: [0, 1] };
  const lo = l.min ?? Math.min(0, ...vals);
  const hiRaw = l.max ?? Math.max(...vals);
  const nice = niceScale(lo, hiRaw, 4);
  return { min: l.min ?? nice.min, max: l.max ?? nice.max, ticks: nice.ticks.filter((t) => t >= (l.min ?? nice.min) - 1e-9 && t <= (l.max ?? nice.max) + 1e-9) };
};

/** Words a viewer must read (title, labels, annotations) — for the reading-time linter. */
export const chartWords = (l: ChartL): string =>
  [l.title, l.subtitle, ...(l.annotate ?? []).map((a) => a.text)].filter(Boolean).join(" ");
