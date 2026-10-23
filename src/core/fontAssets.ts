import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import opentype from "opentype.js";
import { ROOT } from "./paths";

export const FONT_LIBRARY_DIR = path.join(ROOT, "fonts");
export const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
export type FontMetadata = { family: string; weight: number | string; style: "normal" | "italic" | "oblique"; hash: string; outlineSupport: boolean; note?: string };

export const inspectFontAsset = (file: string): FontMetadata => {
  const ext = path.extname(file).toLowerCase();
  if (!FONT_EXTENSIONS.has(ext)) throw new Error("Choose a TTF, OTF, WOFF or WOFF2 font.");
  if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error("Font files must be under 32 MB.");
  const buf = fs.readFileSync(file), magic = buf.subarray(0, 4).toString("latin1");
  if (!["\x00\x01\x00\x00", "OTTO", "true", "wOFF", "wOF2"].includes(magic)) throw new Error("This file has no supported font signature.");
  const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const stem = path.basename(file, ext), guessed = stem.replace(/[-_ ](?:regular|bold|italic|black|light|medium|semibold|thin|extrabold|variable).*$/i, "").replace(/[_-]/g, " ").trim();
  if (magic === "wOF2") return { family: guessed || stem, weight: 400, style: /italic/i.test(stem) ? "italic" : "normal", hash,
    outlineSupport: false, note: "WOFF2 works in browser text. Supply its TTF/OTF counterpart for morph/3D text outlines; family/weight may need an explicit override." };
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  // opentype.js 2 groups name records by platform; older fonts/library versions expose them flat.
  const names = font.names as unknown as Record<string, any>;
  const tablesByPlatform = [names.windows, names.unicode, names.macintosh, names].filter(Boolean);
  const localized = (key: string): string | undefined => {
    for (const table of tablesByPlatform) {
      const values = table[key];
      const value = values?.en ?? Object.values(values ?? {}).find((v) => typeof v === "string");
      if (typeof value === "string" && value.trim()) return value;
    }
    return undefined;
  };
  const family = localized("preferredFamily") ?? localized("fontFamily") ?? guessed;
  const subfamily = localized("preferredSubfamily") ?? localized("fontSubfamily") ?? stem;
  const tables = font.tables as { os2?: { usWeightClass?: number }; fvar?: { axes?: { tag: string; minValue: number; maxValue: number }[] } };
  const axis = tables.fvar?.axes?.find((a) => a.tag === "wght");
  return { family, weight: axis ? `${Math.round(axis.minValue)} ${Math.round(axis.maxValue)}` : tables.os2?.usWeightClass ?? 400,
    style: /italic/i.test(subfamily) ? "italic" : /oblique/i.test(subfamily) ? "oblique" : "normal", hash, outlineSupport: true };
};

export const localFontPath = (relative: string): string => {
  const base = fs.realpathSync(FONT_LIBRARY_DIR), file = fs.realpathSync(path.resolve(base, relative));
  if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile()) throw new Error("Choose a file listed in the project's fonts directory.");
  return file;
};

export const listLocalFonts = () => {
  const fonts: (FontMetadata & { file: string })[] = [], errors: { file: string; error: string }[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && FONT_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        const file = path.relative(FONT_LIBRARY_DIR, abs);
        try { fonts.push({ file, ...inspectFontAsset(abs) }); } catch (error) { errors.push({ file, error: (error as Error).message }); }
      }
    }
  };
  walk(FONT_LIBRARY_DIR);
  return { fonts: fonts.sort((a, b) => a.family.localeCompare(b.family) || a.file.localeCompare(b.file)), errors };
};
