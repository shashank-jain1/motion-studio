/**
 * Pure logo-layer layout, shared by the Logo renderer and actor `snapTo` so both always agree on where every
 * logo part lands on screen.
 */
import { type BBox, unionBBox } from "./geom";
import { type LogoAnalysis, selectLogoParts } from "./resolve";

export type PartSelect = "all" | "icon" | "wordmark" | number;

/** Parse "icon" | "wordmark" | "all" | "<partId>" into a selector. */
export const parsePartSelect = (s: string | undefined): PartSelect => {
  if (!s || s === "all") return "all";
  if (s === "icon" || s === "wordmark") return s;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : "all";
};

/** Bounding box (viewBox units) of a part subset. */
export const subsetBBox = (logo: LogoAnalysis, sel: PartSelect): BBox | null => {
  const parts = selectLogoParts(logo, sel);
  return parts.length ? unionBBox(parts.map((p) => p.bbox)) : null;
};

/**
 * The region of the logo's coordinate space a logo layer frames.
 * - showing all parts, or `frame: "full"` → the logo's own viewBox (a wordmark-only layer then sits exactly where
 *   it would in the full lockup — the slot an icon actor can snapTo)
 * - otherwise → the shown parts' bbox plus 4% padding
 */
export const logoView = (logo: LogoAnalysis, parts: "all" | "icon" | "wordmark" | undefined, frame?: "full" | "parts"): BBox => {
  const [vx, vy, vw, vh] = logo.viewBox;
  const shown = parts ?? "all";
  if ((shown === "all" || frame === "full") && vw > 0 && vh > 0) return { x: vx, y: vy, w: vw, h: vh };
  const bb = subsetBBox(logo, shown) ?? { x: vx, y: vy, w: vw || 1, h: vh || 1 };
  const pad = Math.max(bb.w, bb.h) * 0.04;
  return { x: bb.x - pad, y: bb.y - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad };
};

/** Layer box size and px-per-view-unit scale `k` (preserveAspectRatio meet), from width/height (default height 300). */
export const logoBoxSize = (layer: { width?: number; height?: number }, view: BBox): { W: number; H: number; k: number } => {
  const aspect = view.w / view.h;
  let W: number, H: number;
  if (layer.width && layer.height) { W = layer.width; H = layer.height; }
  else if (layer.width) { W = layer.width; H = W / aspect; }
  else { H = layer.height ?? 300; W = H * aspect; }
  return { W, H, k: Math.min(W / view.w, H / view.h) };
};

/** Where a part subset of a logo layer sits, relative to the layer's own center (px, before layer transforms). */
export const subsetOffset = (logo: LogoAnalysis, view: BBox, k: number, sel: PartSelect) => {
  const bb = subsetBBox(logo, sel);
  if (!bb) return null;
  return {
    dx: (bb.x + bb.w / 2 - (view.x + view.w / 2)) * k,
    dy: (bb.y + bb.h / 2 - (view.y + view.h / 2)) * k,
    w: bb.w * k,
    h: bb.h * k,
    bbox: bb,
  };
};
