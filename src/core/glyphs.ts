/**
 * Text → outline paths for "text:<string>" shape sources (morph layers, logo morph-from), research §3.4.
 *
 * On writeSpec the spec is scanned and every (font, weight, text) gets an entry in projects/<id>/glyphs.json:
 *   key   `${family}|${weight}|${text}`  — family is RESOLVED: "$display"/"$body"/"$mono" tokens and the default
 *         (no font → the theme's display font via the style preset) become the Google Fonts family name, CSS stacks
 *         are cut to their first family, known names use FONT_NAMES casing. weight defaults to 700. text is verbatim.
 *   value outlines at font size 1000, baseline y = 0, text starts at x = 0, y up is negative (SVG coordinates).
 * Fonts come from Google Fonts as TTF (non-browser User-Agent) and are cached in .cache/fonts/.
 */
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { CACHE_DIR } from "./paths";
import { FONT_NAMES } from "./fontNames";
import { DEFAULT_STYLE, STYLES } from "../engine/spec/styles";

export type GlyphEntry = {
  size: 1000;
  /** distance from baseline to the font's ascender (glyph tops reach y ≈ -ascent) */
  ascent: number;
  /** distance from baseline to the font's descender (positive; descenders reach y ≈ +descent) */
  descent: number;
  /** total advance width of the (longest) line */
  width: number;
  /** whole string outline */
  d: string;
  /** one entry per character (spaces included with d = ""); x = pen position, advance includes kerning to the next glyph */
  glyphs: { char: string; d: string; x: number; advance: number }[];
};
export type GlyphFile = Record<string, GlyphEntry>;

export const GLYPH_SIZE = 1000;
export const DEFAULT_GLYPH_WEIGHT = 700;
export const FONT_CACHE_DIR = path.join(CACHE_DIR, "fonts");

export const glyphKey = (family: string, weight: number, text: string) => `${family}|${weight}|${text}`;

// ---------------------------------------------------------------- font resolution

type SpecLike = { style?: string; theme?: { fonts?: { display?: string; body?: string; mono?: string } } };

/** Resolve a layer's `font` (undefined, "$display", "Inter, sans-serif", "inter", …) to a Google Fonts family name. */
export const resolveFontFamily = (font: string | undefined, spec: SpecLike): string => {
  const style = STYLES[spec.style ?? DEFAULT_STYLE] ?? STYLES[DEFAULT_STYLE];
  const fonts = { ...style.fonts, ...(spec.theme?.fonts ?? {}) } as Record<string, string | undefined>;
  let f = (font ?? "").trim() || "$display";
  for (let i = 0; i < 3 && f.startsWith("$"); i++) f = (fonts[f.slice(1)] ?? style.fonts.display).trim();
  const first = f.split(",")[0].trim().replace(/^["']|["']$/g, "");
  const known = FONT_NAMES.find((n) => n.toLowerCase() === first.toLowerCase());
  return known ?? first;
};

// ---------------------------------------------------------------- spec scan

export type TextShapeRef = { family: string; weight: number; text: string; at: string };

/**
 * Find every "text:" shape source in the spec (scenes, nested group/device-screen layers, actors — any depth).
 * font/weight come from the nearest enclosing layer that sets them (morph layers have font/weight).
 */
export const collectTextShapes = (spec: SpecLike & Record<string, unknown>): TextShapeRef[] => {
  const out: TextShapeRef[] = [];
  const walk = (v: unknown, at: string, ctx: { font?: string; weight?: number }) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`, ctx));
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    let here = ctx;
    if (typeof o.type === "string") {
      // a layer: font/weight scope (only morph layers use them for shapes; other layers reset to defaults)
      here = o.type === "morph" ? { font: typeof o.font === "string" ? o.font : undefined, weight: typeof o.weight === "number" ? o.weight : undefined } : {};
    }
    for (const [k, val] of Object.entries(o)) {
      const p = at ? `${at}.${k}` : k;
      if ((k === "shape" || k === "from") && typeof val === "string" && val.startsWith("text:")) {
        const text = val.slice(5);
        if (text.length) out.push({ family: resolveFontFamily(here.font, spec), weight: here.weight ?? DEFAULT_GLYPH_WEIGHT, text, at: p });
      } else if (val && typeof val === "object") walk(val, p, here);
    }
  };
  walk(spec.scenes, "scenes", {});
  walk(spec.actors, "actors", {});
  return out;
};

// ---------------------------------------------------------------- font download + cache

const UA = "motion-studio/0.1 (+https://github.com; node fetch) curl/8"; // non-browser UA → Google serves TTF
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const fontCache = new Map<string, Promise<{ font: opentype.Font; weight: number; file: string }>>();

const slug = (family: string) => family.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const indexFile = () => path.join(FONT_CACHE_DIR, "index.json");
const readIndex = (): Record<string, string> => {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
const writeIndex = (idx: Record<string, string>) => {
  fs.mkdirSync(FONT_CACHE_DIR, { recursive: true });
  const tmp = `${indexFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2) + "\n");
  fs.renameSync(tmp, indexFile());
};

const fetchWithTimeout = async (url: string, ms = 20000) => fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms), redirect: "follow" });

/** Download one weight's TTF. Returns null when Google has no such weight (HTTP 400). Throws on network errors. */
const downloadTtf = async (family: string, weight: number): Promise<Buffer | null> => {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weight}`;
  const res = await fetchWithTimeout(cssUrl);
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Google Fonts CSS ${res.status} ${res.statusText} for ${family} ${weight}`);
  const css = await res.text();
  const urls = [...css.matchAll(/url\((['"]?)([^)'"]+)\1\)\s*format\(['"]?([a-z0-9-]+)['"]?\)/gi)].map((m) => ({ url: m[2], format: m[3].toLowerCase() }));
  const pick = urls.find((u) => u.format === "truetype" || u.format === "opentype") ?? urls.find((u) => /\.(ttf|otf)$/i.test(u.url));
  if (!pick) throw new Error(`Google Fonts returned no TTF/OTF for ${family} ${weight} (formats: ${urls.map((u) => u.format).join(", ") || "none"})`);
  const fr = await fetchWithTimeout(pick.url, 60000);
  if (!fr.ok) throw new Error(`font download ${fr.status} for ${family} ${weight}`);
  return Buffer.from(await fr.arrayBuffer());
};

const gposKerners = new WeakMap<opentype.Font, (a: number, b: number) => number>();

const parseFont = (buf: Buffer): opentype.Font => {
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  try {
    const k = gposPairKerning(buf);
    if (k) gposKerners.set(font, k);
  } catch {
    /* fall back to opentype's kerning */
  }
  return font;
};

/**
 * Minimal GPOS 'kern' reader: PairPos formats 1 and 2, also wrapped in Extension lookups (type 9), which
 * opentype.js 2.0 does not support (Inter, many Google variable-font instances keep their kerning there).
 * Returns null when the font has no GPOS kern feature.
 */
const gposPairKerning = (buf: Buffer): ((left: number, right: number) => number) | null => {
  const u16 = (o: number) => buf.readUInt16BE(o);
  const u32 = (o: number) => buf.readUInt32BE(o);
  const numTables = u16(4);
  let gpos = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("latin1", rec, rec + 4) === "GPOS") gpos = u32(rec + 8);
  }
  if (gpos < 0) return null;
  const featureList = gpos + u16(gpos + 6);
  const lookupList = gpos + u16(gpos + 8);
  const lookupIdx = new Set<number>();
  for (let i = 0, n = u16(featureList); i < n; i++) {
    const rec = featureList + 2 + i * 6;
    if (buf.toString("latin1", rec, rec + 4) !== "kern") continue;
    const feat = featureList + u16(rec + 4);
    for (let j = 0, m = u16(feat + 2); j < m; j++) lookupIdx.add(u16(feat + 4 + j * 2));
  }
  if (!lookupIdx.size) return null;

  const coverage = (off: number): Map<number, number> => {
    const map = new Map<number, number>();
    const fmt = u16(off);
    if (fmt === 1) for (let i = 0, n = u16(off + 2); i < n; i++) map.set(u16(off + 4 + i * 2), i);
    else if (fmt === 2)
      for (let i = 0, n = u16(off + 2); i < n; i++) {
        const r = off + 4 + i * 6;
        const start = u16(r), end = u16(r + 2), idx = u16(r + 4);
        for (let g = start; g <= end; g++) map.set(g, idx + g - start);
      }
    return map;
  };
  const classDef = (off: number): ((g: number) => number) => {
    const fmt = u16(off);
    if (fmt === 1) {
      const start = u16(off + 2), n = u16(off + 4);
      return (g) => (g >= start && g < start + n ? u16(off + 6 + (g - start) * 2) : 0);
    }
    if (fmt === 2) {
      const n = u16(off + 2);
      return (g) => {
        let lo = 0, hi = n - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const r = off + 4 + mid * 6;
          if (g < u16(r)) hi = mid - 1;
          else if (g > u16(r + 2)) lo = mid + 1;
          else return u16(r + 4);
        }
        return 0;
      };
    }
    return () => 0;
  };
  const popcount = (v: number) => { let c = 0; for (; v; v &= v - 1) c++; return c; };
  const xAdv = (rec: number, vf: number) => (vf & 4 ? buf.readInt16BE(rec + 2 * popcount(vf & 3)) : 0);

  type Sub = (l: number, r: number) => number | null; // null = first glyph not covered
  const subs: Sub[][] = [];
  for (const li of [...lookupIdx].sort((a, b) => a - b)) {
    const lk = lookupList + u16(lookupList + 2 + li * 2);
    const type = u16(lk);
    const list: Sub[] = [];
    for (let i = 0, n = u16(lk + 4); i < n; i++) {
      let st = lk + u16(lk + 6 + i * 2);
      let stType = type;
      if (type === 9) {
        stType = u16(st + 2);
        st = st + u32(st + 4);
      }
      if (stType !== 2) continue;
      const fmt = u16(st);
      const cov = coverage(st + u16(st + 2));
      const vf1 = u16(st + 4), vf2 = u16(st + 6);
      const size1 = 2 * popcount(vf1), size2 = 2 * popcount(vf2);
      if (fmt === 1) {
        list.push((l, r) => {
          const ci = cov.get(l);
          if (ci === undefined) return null;
          const set = st + u16(st + 10 + ci * 2);
          const recSize = 2 + size1 + size2;
          let lo = 0, hi = u16(set) - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const rec = set + 2 + mid * recSize;
            const g = u16(rec);
            if (r < g) hi = mid - 1;
            else if (r > g) lo = mid + 1;
            else return xAdv(rec + 2, vf1);
          }
          return null; // covered but no pair → keep looking in later subtables
        });
      } else if (fmt === 2) {
        const cd1 = classDef(st + u16(st + 8)), cd2 = classDef(st + u16(st + 10));
        const c1n = u16(st + 12), c2n = u16(st + 14);
        list.push((l, r) => {
          if (!cov.has(l)) return null;
          const c1 = cd1(l), c2 = cd2(r);
          if (c1 >= c1n || c2 >= c2n) return 0;
          return xAdv(st + 16 + (c1 * c2n + c2) * (size1 + size2), vf1);
        });
      }
    }
    if (list.length) subs.push(list);
  }
  if (!subs.length) return null;
  const cache = new Map<number, number>();
  return (l, r) => {
    const key = l * 65536 + r;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let v = 0;
    for (const list of subs)
      for (const sub of list) {
        const x = sub(l, r);
        if (x !== null) { v += x; break; }
      }
    cache.set(key, v);
    return v;
  };
};

/**
 * Load a Google font at `weight` (TTF cached in .cache/fonts/<Family>-<weight>.ttf). If that weight does not exist,
 * the nearest available weight is used (and remembered in .cache/fonts/index.json).
 */
export const loadFont = (family: string, weight: number): Promise<{ font: opentype.Font; weight: number; file: string }> => {
  const key = `${family}|${weight}`;
  let p = fontCache.get(key);
  if (!p) {
    p = (async () => {
      fs.mkdirSync(FONT_CACHE_DIR, { recursive: true });
      const idx = readIndex();
      const aliased = idx[key];
      if (aliased && fs.existsSync(path.join(FONT_CACHE_DIR, aliased))) {
        const file = path.join(FONT_CACHE_DIR, aliased);
        const w = Number(/-(\d+)\.ttf$/.exec(aliased)?.[1] ?? weight);
        return { font: parseFont(fs.readFileSync(file)), weight: w, file };
      }
      const order = [weight, ...WEIGHTS.filter((w) => w !== weight).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || b - a)];
      for (const w of order) {
        const name = `${slug(family)}-${w}.ttf`;
        const file = path.join(FONT_CACHE_DIR, name);
        let buf: Buffer | null = null;
        if (fs.existsSync(file)) buf = fs.readFileSync(file);
        else {
          buf = await downloadTtf(family, w);
          if (!buf) continue;
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, file);
        }
        const font = parseFont(buf);
        writeIndex({ ...readIndex(), [key]: name });
        return { font, weight: w, file };
      }
      throw new Error(`font "${family}" is not available on Google Fonts`);
    })();
    fontCache.set(key, p);
    // forget failures after a while (network hiccups), but don't re-hit Google on every set_spec meanwhile
    p.catch(() => setTimeout(() => fontCache.delete(key), 10 * 60 * 1000).unref());
  }
  return p;
};

// ---------------------------------------------------------------- outlines

// Glyph-by-glyph layout (cmap + kerning) instead of opentype's shaper: 1 glyph per character (no ligatures, so
// letters can cascade individually) and immune to GSUB lookups opentype.js 2.0 cannot apply (it throws on some fonts).
type Positioner = { getDefaultScriptName(): string; getKerningTables(script: string, lang?: string): unknown; getKerningValue(t: unknown, a: number, b: number): number };

const kerner = (font: opentype.Font) => {
  const gpos = gposKerners.get(font);
  if (gpos) return (a: opentype.Glyph, b: opentype.Glyph): number => gpos(a.index, b.index);
  const pos = (font as unknown as { position?: Positioner }).position;
  let tables: unknown;
  try {
    tables = pos?.getKerningTables(pos.getDefaultScriptName());
  } catch {
    tables = undefined;
  }
  return (a: opentype.Glyph, b: opentype.Glyph): number => {
    try {
      if (tables && pos) return pos.getKerningValue(tables, a.index, b.index) || 0;
      return font.getKerningValue(a, b) || 0;
    } catch {
      return 0;
    }
  };
};

/** Outline `text` at size 1000 (baseline y=0, x from 0). Lines split on "\n" are stacked by the font's line height. */
export const textToGlyphs = (font: opentype.Font, text: string): GlyphEntry => {
  const size = GLYPH_SIZE;
  const scale = size / font.unitsPerEm;
  const hhea = (font.tables as { hhea?: { lineGap?: number } }).hhea;
  const lineHeight = (font.ascender - font.descender + (hhea?.lineGap ?? 0)) * scale;
  const kern = kerner(font);
  const r = (n: number) => Math.round(n * 100) / 100;
  const glyphs: GlyphEntry["glyphs"] = [];
  const ds: string[] = [];
  let width = 0;
  const lines = text.split("\n");
  lines.forEach((line, li) => {
    const y = li * lineHeight;
    const chars = Array.from(line);
    const gs = chars.map((c) => font.charToGlyph(c));
    let x = 0;
    gs.forEach((g, i) => {
      const d = g.getPath(x, y, size, { kerning: false, hinting: false } as opentype.RenderOptions, font).toPathData(2);
      let adv = (g.advanceWidth ?? 0) * scale;
      if (i + 1 < gs.length) adv += kern(g, gs[i + 1]) * scale;
      if (d) ds.push(d);
      glyphs.push({ char: chars[i], d, x: r(x), advance: r(adv) });
      x += adv;
    });
    width = Math.max(width, x);
    if (li < lines.length - 1) glyphs.push({ char: "\n", d: "", x: r(x), advance: 0 });
  });
  return {
    size: GLYPH_SIZE,
    ascent: r(font.ascender * scale),
    descent: r(-font.descender * scale),
    width: r(width),
    d: ds.join(""),
    glyphs,
  };
};

/** One-off helper: outlines for (family, weight, text), downloading the font if needed. */
export const getTextOutline = async (family: string, weight: number, text: string): Promise<GlyphEntry & { usedWeight: number }> => {
  const { font, weight: used } = await loadFont(family, weight);
  return { ...textToGlyphs(font, text), usedWeight: used };
};

// ---------------------------------------------------------------- glyphs.json

export const glyphsFile = (projectDirAbs: string) => path.join(projectDirAbs, "glyphs.json");

export const readGlyphFile = (projectDirAbs: string): GlyphFile => {
  try {
    return JSON.parse(fs.readFileSync(glyphsFile(projectDirAbs), "utf8")) as GlyphFile;
  } catch {
    return {};
  }
};

/**
 * Make sure glyphs.json has an entry for every "text:" shape in the spec. Existing entries are kept (merged).
 * Never throws: problems come back as warnings.
 */
export const syncGlyphs = async (projectDirAbs: string, spec: SpecLike & Record<string, unknown>): Promise<{ added: string[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const added: string[] = [];
  let refs: TextShapeRef[];
  try {
    refs = collectTextShapes(spec);
  } catch (e) {
    return { added, warnings: [`glyphs: could not scan spec: ${(e as Error).message}`] };
  }
  if (!refs.length) return { added, warnings };
  const existing = readGlyphFile(projectDirAbs);
  const todo = new Map<string, TextShapeRef>();
  for (const r of refs) {
    const k = glyphKey(r.family, r.weight, r.text);
    if (!existing[k] && !todo.has(k)) todo.set(k, r);
  }
  if (!todo.size) return { added, warnings };
  const fresh: GlyphFile = {};
  for (const [k, r] of todo) {
    try {
      const { font, weight: used } = await loadFont(r.family, r.weight);
      fresh[k] = textToGlyphs(font, r.text);
      added.push(k);
      if (used !== r.weight) warnings.push(`${r.at}: font "${r.family}" has no weight ${r.weight}; "text:" outlines use weight ${used}`);
      const missing = [...new Set(Array.from(r.text).filter((c) => c.trim() && font.charToGlyphIndex(c) === 0))];
      if (missing.length) warnings.push(`${r.at}: font "${r.family}" has no glyph for ${missing.map((c) => JSON.stringify(c)).join(", ")}`);
    } catch (e) {
      warnings.push(`${r.at}: could not build outlines for "text:${r.text}" in ${r.family} ${r.weight}: ${(e as Error).message}`);
    }
  }
  if (added.length) {
    try {
      // re-read right before writing so concurrent writers' entries are not dropped
      const merged = { ...readGlyphFile(projectDirAbs), ...fresh };
      const file = glyphsFile(projectDirAbs);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(merged) + "\n");
      fs.renameSync(tmp, file);
    } catch (e) {
      warnings.push(`glyphs: could not write glyphs.json: ${(e as Error).message}`);
    }
  }
  return { added, warnings };
};
