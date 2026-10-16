/** Representative colors of a spec, so UI (timeline clips, cards, treatment swatches) looks like the film. */
import { DEFAULT_STYLE, STYLES } from "../../../src/engine/spec/styles";
import type { Spec } from "../../../src/engine/spec/schema";

type Bg = { type: string; color?: string; colors?: string[]; base?: string };

export const themeColors = (spec: Pick<Spec, "style" | "theme">): Record<string, string> => ({
  ...(STYLES[spec.style ?? DEFAULT_STYLE] ?? STYLES[DEFAULT_STYLE]).colors,
  ...(spec.theme?.colors ?? {}),
});

const cache = new Map<string, string | null>();
let ctx: CanvasRenderingContext2D | null | undefined;
/** Normalize any CSS color to #rrggbb (null if transparent / not a color). */
export const toHex = (c: string | undefined | null): string | null => {
  if (!c) return null;
  const k = c.trim();
  if (cache.has(k)) return cache.get(k)!;
  let out: string | null = null;
  if (/^#([0-9a-f]{6})$/i.test(k)) out = k.toLowerCase();
  else if (/^#([0-9a-f]{3})$/i.test(k)) out = "#" + k.slice(1).split("").map((x) => x + x).join("").toLowerCase();
  else if (k !== "transparent" && typeof document !== "undefined") {
    if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000001";
      ctx.fillStyle = k;
      const v = String(ctx.fillStyle);
      if (v !== "#000001" && v.startsWith("#")) out = v;
      else if (/^rgba\(.*,\s*0(\.0+)?\)$/.test(v)) out = null;
      else if (v.startsWith("rgba")) {
        const m = v.match(/[\d.]+/g)!.map(Number);
        out = "#" + m.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
      }
    }
  }
  cache.set(k, out);
  return out;
};

const resolve = (c: string | undefined, colors: Record<string, string>): string | null =>
  c ? toHex(c.startsWith("$") ? colors[c.slice(1)] : c) : null;

/** The color a viewer reads as "this scene": solid color, gradient start, mesh base, shader dominant… */
export const sceneColor = (spec: Spec, index: number, colors = themeColors(spec)): string => {
  const sc = spec.scenes[index];
  const list = (Array.isArray(sc?.background) ? sc.background : sc?.background ? [sc.background] : []) as Bg[];
  for (const b of list) {
    let c: string | null = null;
    switch (b.type) {
      case "solid": c = resolve(b.color, colors); break;
      case "gradient": c = resolve(b.colors?.[0], colors); break;
      case "mesh": c = resolve(b.colors?.[0], colors) ?? resolve(b.base, colors); break;
      case "shader": c = resolve(b.colors?.[b.colors.length > 2 ? 2 : 0], colors) ?? resolve(b.colors?.[0], colors) ?? "#1c1c24"; break;
      case "grid": c = resolve(b.base, colors) ?? resolve(b.color, colors); break;
      case "spotlight": c = resolve(b.base, colors) ?? resolve(b.color, colors); break;
      case "media": c = "#2a2925"; break;
    }
    if (c) return c;
  }
  return resolve("$bg", colors) ?? "#151512";
};

export const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
/** Ink or Bone, whichever reads on top of `hex`. */
export const inkOn = (hex: string) => (luminance(hex) > 0.36 ? "#0D0D0B" : "#ECE8DF");
