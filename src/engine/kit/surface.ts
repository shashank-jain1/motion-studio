/**
 * Shared look of the v9 data / diagram / code / music layers: one surface language so a chart, a flow diagram and a
 * code window sitting in the same film read as one product. Frosted glass with a hairline border and a top highlight
 * on dark scenes, quiet cards with soft depth on light ones; theme accents for data; numbers in tabular figures.
 */
import type React from "react";

/** Any CSS color at `a` opacity (works for hex, rgb(), hsl(), named colors, $-resolved values). */
export const alpha = (c: string, a: number): string =>
  a >= 1 ? c : `color-mix(in srgb, ${c} ${Math.round(Math.max(0, Math.min(1, a)) * 1000) / 10}%, transparent)`;

/** Mix two colors (t = share of b). */
export const mix = (a: string, b: string, t: number): string =>
  `color-mix(in srgb, ${a} ${Math.round((1 - t) * 1000) / 10}%, ${b})`;

/** Relative luminance of a hex color (other notations count as mid-grey → treated as dark). */
export const luminance = (c: string): number => {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) {
    const rgb = c.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (!rgb) return 0.2;
    return lum([+rgb[1], +rgb[2], +rgb[3]]);
  }
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return lum([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
};
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const isDark = (bg: string) => luminance(bg) < 0.32;

export type SurfaceKind = "glass" | "solid" | "outline" | "none";

/** Panel style for a surface kind on a dark / light scene. */
export const panel = (kind: SurfaceKind, dark: boolean, radius: number, card: string, fg: string): React.CSSProperties => {
  switch (kind) {
    case "none": return {};
    case "outline": return { borderRadius: radius, border: `1px solid ${alpha(fg, dark ? 0.16 : 0.14)}` };
    case "solid": return dark
      ? { borderRadius: radius, background: card, border: `1px solid ${alpha(fg, 0.08)}`, boxShadow: `inset 0 1px 0 ${alpha("#ffffff", 0.06)}, 0 30px 70px -28px rgba(0,0,0,0.65)` }
      : { borderRadius: radius, background: card, border: `1px solid ${alpha(fg, 0.07)}`, boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 24px 60px -24px rgba(20,20,40,0.22)" };
    case "glass": return dark
      ? {
          borderRadius: radius,
          background: `linear-gradient(180deg, ${alpha("#ffffff", 0.075)}, ${alpha("#ffffff", 0.025)})`,
          border: `1px solid ${alpha("#ffffff", 0.1)}`,
          boxShadow: `inset 0 1px 0 ${alpha("#ffffff", 0.12)}, 0 40px 80px -30px rgba(0,0,0,0.7)`,
          backdropFilter: "blur(22px) saturate(150%)", WebkitBackdropFilter: "blur(22px) saturate(150%)",
        }
      : {
          borderRadius: radius,
          background: `linear-gradient(180deg, ${alpha("#ffffff", 0.82)}, ${alpha("#ffffff", 0.62)})`,
          border: `1px solid ${alpha("#ffffff", 0.9)}`,
          boxShadow: `inset 0 1px 0 #ffffff, 0 1px 2px rgba(0,0,0,0.04), 0 28px 60px -26px rgba(20,20,40,0.25)`,
          backdropFilter: "blur(22px) saturate(140%)", WebkitBackdropFilter: "blur(22px) saturate(140%)",
        };
  }
};

/** Default data palette from the theme: accents first, then blends so 6+ items stay distinguishable. */
export const palette = (theme: Record<string, string>, color: (c: string | undefined, f?: string) => string, n: number, custom?: string[]): string[] => {
  if (custom?.length) return Array.from({ length: n }, (_, i) => color(custom[i % custom.length]));
  const accent = theme.accent ?? "#7c5cff", accent2 = theme.accent2 ?? mix(accent, "#22d3ee", 0.6), fg = theme.fg ?? "#ffffff";
  const accent3 = theme.accent3 ?? mix(accent, accent2, 0.5);
  const base = [accent, accent2, accent3, mix(accent, fg, 0.38), mix(accent2, fg, 0.38), mix(accent, "#ffffff", 0.5), mix(accent2, "#000000", 0.3)];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
};

/** Locale/format-aware number formatting shared by charts. */
export type NumFmt = { prefix?: string; suffix?: string; decimals?: number; locale?: string; format?: "standard" | "compact" | "percent" };
export const formatter = (f: NumFmt, sample: number[]) => {
  const fracDigits = (n: number) => (Number.isInteger(n) ? 0 : Math.min(2, String(n).split(".")[1]?.length ?? 0));
  const dec = f.decimals ?? (f.format === "compact" ? 1 : f.format === "percent" ? 0 : Math.max(0, ...sample.map(fracDigits)));
  let nf: Intl.NumberFormat;
  try {
    nf = new Intl.NumberFormat(f.locale ?? "en-US", f.format === "compact"
      ? { notation: "compact", maximumFractionDigits: dec }
      : f.format === "percent" ? { style: "percent", minimumFractionDigits: dec, maximumFractionDigits: dec }
      : { minimumFractionDigits: dec, maximumFractionDigits: dec });
  } catch { nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: dec }); }
  return (v: number) => {
    const q = Math.pow(10, dec + (f.format === "percent" ? 2 : 0));
    const r = Math.round(v * q) / q;
    return `${f.prefix ?? ""}${nf.format(Object.is(r, -0) ? 0 : r)}${f.suffix ?? ""}`;
  };
};

/** "Nice" axis: 0 … a round number above max with ~4 steps (1 / 2 / 2.5 / 5 × 10^k). */
export const niceScale = (lo: number, hi: number, steps = 4): { min: number; max: number; ticks: number[] } => {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999) ?? 10 * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { min, max, ticks };
};

/** Mono micro-label style (uppercase, tracked, muted). */
export const microLabel = (font: string, size: number, color: string): React.CSSProperties => ({
  fontFamily: font, fontSize: size, letterSpacing: "0.08em", textTransform: "uppercase", color, fontWeight: 500,
});
