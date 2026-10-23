/**
 * Shape sources → normalized path parts.
 *
 *   "circle" | "bean" | …            library shape (1000×1000 box, optical size kept)
 *   "path:<d>"                       raw path data in a 1000×1000 box
 *   "svg:assets/x.svg[#icon|#wordmark|#N]"  parts from the analyzer's `assets/x.svg.logo.json`
 *   "text:Word"                      glyph outlines from the project's `glyphs.json`
 *
 * Every source is fit-contained into the requested box (w×h, centered). JSON assets are fetched
 * once per URL (module cache) behind delayRender, so headless renders wait for them.
 */
import { useEffect, useMemo, useState } from "react";
import { useDelayRender } from "remotion";
import { useAsset, useRuntime } from "../core/context";
import { type BBox, dBBox, fitAffine, strokeOutline, transformD, unionBBox } from "./geom";
import { libraryShape } from "./library";
import { customFontIdentity, glyphFontFamily } from "../core/fontIdentity";

// ---------------------------------------------------------------------------------------------
// data contracts (produced Node-side by the logo analyzer / glyph extractor)

export type LogoPart = {
  id: number;
  d: string;
  fill: string;
  fillRule?: "nonzero" | "evenodd";
  area: number;
  bbox: { x: number; y: number; w: number; h: number };
  centroid: [number, number];
  circularity?: number;
  thinness?: number;
  holeIds?: number[];
  length?: number;
  kind?: "shape" | "glyph";
  /** the part is a stroked centerline (fill = stroke color, strokeWidth in viewBox units) */
  strokeOnly?: boolean;
  stroke?: string;
  strokeWidth?: number;
  gradient?: string[];
  opacity?: number;
};

export const LOGO_ORDERS = ["leftToRight", "topToBottom", "reading", "bySizeDesc", "radialOut", "angular", "document", "byColor"] as const;
export type LogoOrder = (typeof LOGO_ORDERS)[number];

export type LogoAnalysis = {
  version: 1;
  source?: string;
  viewBox: [number, number, number, number];
  width?: number;
  height?: number;
  parts: LogoPart[];
  groups?: { icon?: number[]; wordmark?: number[] };
  orders?: Partial<Record<LogoOrder, number[]>>;
  palette?: { hex: string; weight: number; role: string }[];
  kit?: { strokeWeight?: number; cornerRadius?: number; angles?: number[]; symmetry?: string | null };
  holes?: { partId: number; d: string; areaRatio: number }[];
  bbox?: { x: number; y: number; w: number; h: number };
  centroid?: [number, number];
  unionD?: string;
};

export type GlyphRun = {
  size: number;
  ascent: number;
  descent: number;
  width: number;
  d: string;
  glyphs: { char: string; d: string; x: number; advance: number }[];
};
export type GlyphFile = Record<string, GlyphRun>;

// ---------------------------------------------------------------------------------------------
// JSON asset loading (module cache, delayRender-gated)

type Entry = { done: boolean; value: unknown; promise: Promise<void> };
const jsonCache = new Map<string, Entry>();

const loadJson = (url: string): Entry => {
  const hit = jsonCache.get(url);
  if (hit) return hit;
  const entry: Entry = { done: false, value: null, promise: Promise.resolve() };
  entry.promise = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((v) => {
      entry.value = v;
      entry.done = true;
    });
  jsonCache.set(url, entry);
  return entry;
};

/** Load project JSON assets (relative paths like "glyphs.json"); returns values (null = missing) once ready. */
export const useJsonAssets = (paths: string[]): { ready: boolean; get: <T>(path: string) => T | null } => {
  const asset = useAsset();
  const rt = useRuntime();
  const { delayRender, continueRender } = useDelayRender();
  const key = paths.join("|");
  const fontKey = rt.fontFaces?.length ? customFontIdentity(rt.fontFaces) : "";
  const urls = useMemo(() => [...new Set(paths)].map((p) => {
    const url = asset(p);
    return [p, p === "glyphs.json" && fontKey ? `${url}${url.includes("?") ? "&" : "?"}fonts=${fontKey}` : url] as const;
  }), [key, rt.assetBase, rt.projectId, fontKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, bump] = useState(0);
  const [handle] = useState(() => {
    const pending = urls.some(([, u]) => !loadJson(u).done);
    return pending ? { id: delayRender(`load ${urls.map(([p]) => p).join(", ")}`, { timeoutInMilliseconds: 30000 }), open: true } : null;
  });
  useEffect(() => {
    let live = true;
    const release = () => {
      if (handle?.open) {
        handle.open = false;
        continueRender(handle.id);
      }
    };
    if (!urls.some(([, u]) => !loadJson(u).done)) {
      release();
      return;
    }
    Promise.all(urls.map(([, u]) => loadJson(u).promise)).then(() => {
      if (live) bump((x) => x + 1);
      release();
    });
    return () => {
      live = false;
    };
  }, [urls, handle, continueRender]);
  const map = new Map(urls.map(([p, u]) => [p, jsonCache.get(u)]));
  return {
    ready: urls.every(([, u]) => jsonCache.get(u)?.done),
    get: <T,>(p: string) => (map.get(p)?.value ?? null) as T | null,
  };
};

// ---------------------------------------------------------------------------------------------
// parsing sources

export type ShapePart = {
  /** fill geometry (stroke-only parts are converted to their outline so they morph as shapes) */
  d: string;
  fill?: string;
  fillRule?: "nonzero" | "evenodd";
  id?: number;
  kind?: "shape" | "glyph";
  /** exact stroked centerline for stroke-only logo parts: rendered at rest instead of `d` */
  line?: { d: string; width: number };
};
export type RawShape = { parts: ShapePart[]; box: BBox; kind: "library" | "path" | "svg" | "text" | "missing" };

export type SourceSpec =
  | { kind: "library"; name: string }
  | { kind: "path"; d: string }
  | { kind: "svg"; file: string; select: "all" | "icon" | "wordmark" | number }
  | { kind: "text"; text: string };

export const parseSource = (src: string): SourceSpec => {
  const s = src.trim();
  if (s.startsWith("path:")) return { kind: "path", d: s.slice(5) };
  if (s.startsWith("text:")) return { kind: "text", text: s.slice(5) };
  if (s.startsWith("svg:")) {
    const [file, frag] = s.slice(4).split("#");
    const select = !frag || frag === "all" ? "all" : frag === "icon" || frag === "wordmark" ? frag : Number.isFinite(Number(frag)) ? Number(frag) : "all";
    return { kind: "svg", file: file.trim(), select };
  }
  if (/^[MmLlCcHhVvQqSsTtAaZz][\s\d.,-]/.test(s) && /\d/.test(s)) return { kind: "path", d: s };
  return { kind: "library", name: s };
};

export const logoJsonPath = (file: string) => `${file.replace(/^\.?\//, "")}.logo.json`;

/** JSON assets a source needs. */
export const sourceAssets = (src: string): string[] => {
  const p = parseSource(src);
  if (p.kind === "svg") return [logoJsonPath(p.file)];
  if (p.kind === "text") return ["glyphs.json"];
  return [];
};

export const selectLogoParts = (logo: LogoAnalysis, select: "all" | "icon" | "wordmark" | number): LogoPart[] => {
  if (typeof select === "number") {
    const p = logo.parts.find((q) => q.id === select) ?? logo.parts[select];
    return p ? [p] : [];
  }
  if (select === "all") return logo.parts;
  const ids = logo.groups?.[select];
  if (!ids || !ids.length) return logo.parts;
  const set = new Set(ids);
  return logo.parts.filter((p) => set.has(p.id));
};

/** Look up a glyph run by font family / weight / text, with graceful fallbacks. */
export const findGlyphRun = (file: GlyphFile | null, family: string, weight: number, text: string): GlyphRun | null => {
  if (!file) return null;
  const exact = file[`${family}|${weight}|${text}`];
  if (exact) return exact;
  const keys = Object.keys(file).filter((k) => k.endsWith(`|${text}`));
  if (!keys.length) return null;
  const sameFamily = keys.filter((k) => k.split("|")[0].toLowerCase() === family.toLowerCase());
  if (family.includes("@font-") && !sameFamily.length) return null; // no unrelated fallback for a versioned project font
  const pool = sameFamily.length ? sameFamily : keys;
  pool.sort((a, b) => Math.abs(Number(a.split("|")[1]) - weight) - Math.abs(Number(b.split("|")[1]) - weight));
  return file[pool[0]];
};

/** Glyph parts positioned in word space (glyph d may be absolute or relative to its pen x). */
export const glyphParts = (run: GlyphRun): ShapePart[] => {
  const gs = run.glyphs.filter((g) => g.d && g.d.trim().length > 2);
  if (!gs.length) return run.d ? [{ d: run.d, kind: "glyph" }] : [];
  let relVotes = 0, votes = 0;
  gs.forEach((g, i) => {
    if (i === 0 || g.x <= 0) return;
    const b = dBBox(g.d);
    votes++;
    if (b.x + b.w / 2 < g.x) relVotes++;
  });
  const relative = votes > 0 && relVotes * 2 > votes;
  return gs.map((g) => ({ d: relative ? transformD(g.d, [1, 0, 0, 1, g.x, 0]) : g.d, kind: "glyph" as const }));
};

const FULL_BOX: BBox = { x: 0, y: 0, w: 1000, h: 1000 };

export type ResolveCtx = { get: <T>(path: string) => T | null; family: string; weight: number };

/** Source → parts in their own coordinates (+ the box that should be fit). */
export const resolveRaw = (src: string, ctx: ResolveCtx): RawShape => {
  const p = parseSource(src);
  if (p.kind === "library") {
    const d = libraryShape(p.name);
    if (d) return { parts: [{ d }], box: FULL_BOX, kind: "library" };
  } else if (p.kind === "path") {
    if (p.d.trim()) return { parts: [{ d: p.d }], box: FULL_BOX, kind: "path" };
  } else if (p.kind === "svg") {
    const logo = ctx.get<LogoAnalysis>(logoJsonPath(p.file));
    if (logo?.parts?.length) {
      const parts: ShapePart[] = selectLogoParts(logo, p.select).map((q) =>
        q.strokeOnly
          ? { d: strokeOutline(q.d, q.strokeWidth ?? 2), fill: q.fill, id: q.id, kind: q.kind, line: { d: q.d, width: q.strokeWidth ?? 2 } }
          : { d: q.d, fill: q.fill, fillRule: q.fillRule, id: q.id, kind: q.kind });
      if (parts.length) return { parts, box: unionBBox(parts.map((q) => dBBox(q.d))), kind: "svg" };
    }
  } else if (p.kind === "text") {
    const run = findGlyphRun(ctx.get<GlyphFile>("glyphs.json"), ctx.family, ctx.weight, p.text);
    if (run) {
      const parts = glyphParts(run);
      if (parts.length) return { parts, box: unionBBox(parts.map((q) => dBBox(q.d))), kind: "text" };
    }
  }
  return { parts: [{ d: libraryShape("circle")! }], box: FULL_BOX, kind: "missing" };
};

/** Fit-contain raw parts into a rect (centered). */
export const fitRaw = (raw: RawShape, rect: BBox): ShapePart[] => {
  const m = fitAffine(raw.box, rect, true);
  return raw.parts.map((q) => ({ ...q, d: transformD(q.d, m), line: q.line ? { d: transformD(q.line.d, m), width: q.line.width * m[0] } : undefined }));
};

export type ResolvedShape = { d: string; parts: ShapePart[]; ready: boolean; kind: RawShape["kind"] };

/** Resolve the font token ("$display") and weight used for text sources. */
export const useFontKey = (font?: string, weight?: number) => {
  const rt = useRuntime();
  let family = font ?? "$display";
  if (family.startsWith("$")) family = rt.fonts[family.slice(1) as "display" | "body" | "mono"] ?? rt.fonts.display;
  return { family: glyphFontFamily(family, rt.fontFaces), weight: weight ?? 700 };
};

/** Resolve many sources at once (one asset load, one delayRender). */
export const useShapeSources = (
  srcs: string[],
  opts: { font?: string; weight?: number; box: { w: number; h: number }; fit?: "contain" },
): { shapes: ResolvedShape[]; ready: boolean } => {
  const { family, weight } = useFontKey(opts.font, opts.weight);
  const needs = useMemo(() => srcs.flatMap(sourceAssets), [srcs.join("\u0000")]); // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useJsonAssets(needs);
  const { w, h } = opts.box;
  const shapes = useMemo(() => {
    if (!assets.ready) return srcs.map(() => ({ d: "", parts: [], ready: false, kind: "missing" as const }));
    return srcs.map((s) => {
      const raw = resolveRaw(s, { get: assets.get, family, weight });
      if (raw.kind === "missing") console.warn(`[shapes] could not resolve "${s}", using circle`);
      const parts = fitRaw(raw, { x: 0, y: 0, w, h });
      return { d: parts.map((q) => q.d).join(""), parts, ready: true, kind: raw.kind };
    });
  }, [assets.ready, srcs.join("\u0000"), family, weight, w, h]); // eslint-disable-line react-hooks/exhaustive-deps
  return { shapes, ready: assets.ready };
};

/** Normalize ANY shape source into a box: `{ d, parts, ready }`. */
export const useShapeSource = (
  src: string,
  opts: { font?: string; weight?: number; box: { w: number; h: number }; fit?: "contain" },
): ResolvedShape => {
  const { shapes } = useShapeSources([src], opts);
  return shapes[0];
};
