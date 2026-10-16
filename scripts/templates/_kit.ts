/**
 * Shared pieces for the template gallery (scripts/build-templates.ts): procedural SVG logos (icon geometry + a wordmark
 * converted to real glyph outlines, like scripts/fixtures/make-loopa-logo.ts) and the TemplateDef shape.
 */
import { getTextOutline } from "../../src/core/glyphs";
import type { Format } from "../../src/engine/spec/reflow";

export type TemplateDef = {
  slug: string;
  order: number;
  title: string;
  niche: string;
  description: string;
  tags: string[];
  format: Format;
  /** seconds on the global timeline for the poster frame */
  posterTime: number;
  /** extra preview moments for the critique pass */
  previewTimes?: number[];
  logos: { file: string; build: () => Promise<string> }[];
  spec: Record<string, unknown>;
};

/**
 * Lockup logo: `icon` (SVG elements drawn in a 0..H square box, H = 280) on the left, the wordmark as glyph outlines on the
 * right, one viewBox. Returns the SVG text.
 */
export const lockupLogo = async (opts: { icon: string; word: string; font: string; weight: number; color: string; size?: number; gap?: number; tracking?: number }) => {
  const H = 280;
  const size = opts.size ?? 150; // cap height-ish px of the wordmark
  const g = await getTextOutline(opts.font, opts.weight, opts.word);
  const scale = size / 1000 * 1.25;
  const x0 = H + (opts.gap ?? 40);
  const baseline = H / 2 + (g.ascent * scale) * 0.36;
  const track = (opts.tracking ?? 0) * size;
  const glyphs = g.glyphs.filter((x) => x.d).map((x, i) =>
    `<path transform="translate(${(x0 + i * track).toFixed(2)} ${baseline.toFixed(2)}) scale(${scale.toFixed(4)})" d="${x.d}" fill="${opts.color}"/>`).join("\n  ");
  const width = Math.ceil(x0 + g.width * scale + track * Math.max(0, g.glyphs.length - 1) + 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}">
  ${opts.icon}
  ${glyphs}
</svg>
`;
};

/** Rounded rect path (for icons). */
export const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
/** Circle path. */
export const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
