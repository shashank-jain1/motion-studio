/**
 * Template gallery: premium starter films in templates/<slug>/{template.json, spec.json, assets/, glyphs.json, poster.jpg}
 * (built by scripts/build-templates.ts). Starting a project from a template copies its spec + assets into the new project;
 * picking another canvas than the template's master bakes a reflowed version (spec/reflow.ts) in as the new master.
 */
import fs from "node:fs";
import path from "node:path";
import { FORMATS, SpecSchema, type SpecInput } from "../engine/spec/schema";
import { preprocessSpec } from "../engine/spec/preprocess";
import { adaptTargets, reflowSpec, type Format } from "../engine/spec/reflow";
import { ROOT } from "./paths";
import { createProject, deleteProject, writeSpec, type ProjectInfo } from "./projects";
import { ensureLogoAnalysis } from "./logo";

export const TEMPLATES_DIR = path.resolve(process.env.MOTION_STUDIO_TEMPLATES || path.join(ROOT, "templates"));
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

export type TemplateMeta = {
  slug: string;
  title: string;
  niche: string;
  description: string;
  format: Format;
  /** every format the film is designed to adapt to (master first) */
  formats: Format[];
  durationSeconds: number;
  tags: string[];
  /** public URL of the poster frame (cache-busted), when rendered */
  poster?: string;
};

export const templateDir = (slug: string): string => {
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid template "${slug}"`);
  return path.join(TEMPLATES_DIR, slug);
};

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

const metaOf = (slug: string): TemplateMeta | null => {
  const dir = templateDir(slug);
  try {
    const m = readJson<Omit<TemplateMeta, "slug" | "poster" | "formats"> & { formats?: Format[] }>(path.join(dir, "template.json"));
    const spec = readJson<SpecInput>(path.join(dir, "spec.json"));
    const poster = path.join(dir, "poster.jpg");
    return {
      slug,
      title: m.title,
      niche: m.niche,
      description: m.description,
      format: m.format,
      formats: adaptTargets({ format: m.format, formats: spec.formats ?? m.formats }),
      durationSeconds: m.durationSeconds,
      tags: m.tags ?? [],
      ...(fs.existsSync(poster) ? { poster: `/templates/${slug}/poster.jpg?v=${Math.round(fs.statSync(poster).mtimeMs)}` } : {}),
    };
  } catch {
    return null;
  }
};

/** Every valid template, in gallery order (template.json `order`, then title). */
export const listTemplates = (): TemplateMeta[] => {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  const out: (TemplateMeta & { order: number })[] = [];
  for (const e of fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const m = metaOf(e.name);
    if (!m) continue;
    let order = 999;
    try { order = readJson<{ order?: number }>(path.join(TEMPLATES_DIR, e.name, "template.json")).order ?? 999; } catch { /* default */ }
    out.push({ ...m, order });
  }
  return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)).map(({ order: _o, ...m }) => m);
};

export const getTemplate = (slug: string): { meta: TemplateMeta; spec: SpecInput } | null => {
  const meta = SLUG_RE.test(slug) ? metaOf(slug) : null;
  if (!meta) return null;
  return { meta, spec: readJson<SpecInput>(path.join(templateDir(slug), "spec.json")) };
};

/** Public template file (poster.jpg, glyphs.json, assets/*) → absolute path, or null. Never escapes the template dir. */
export const templateFile = (slug: string, rel: string): string | null => {
  if (!SLUG_RE.test(slug)) return null;
  const clean = path.posix.normalize(rel).replace(/^\/+/, "");
  if (!(clean === "poster.jpg" || clean === "glyphs.json" || /^assets\/[^/]+$/.test(clean)) || clean.includes("..")) return null;
  const abs = path.join(templateDir(slug), clean);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
};

/**
 * New project from a template: copies assets (+ logo analyses, glyphs) and writes the spec through writeSpec (validation,
 * glyph sync). With a `format` other than the template's master, the reflowed film becomes the new master and the
 * template's other formats stay as adapt targets.
 */
export const createProjectFromTemplate = async (opts: { name: string; template: string; format?: Format }): Promise<ProjectInfo> => {
  const t = getTemplate(opts.template);
  if (!t) throw new Error(`Template "${opts.template}" not found`);
  const format = opts.format ?? t.meta.format;
  if (!(format in FORMATS)) throw new Error(`Unknown format "${format}"`);
  const project = createProject({ name: opts.name, format });
  try {
    const src = templateDir(opts.template);
    const assets = path.join(src, "assets");
    if (fs.existsSync(assets)) {
      for (const f of fs.readdirSync(assets)) {
        const abs = path.join(assets, f);
        if (f.startsWith(".") || !fs.statSync(abs).isFile()) continue;
        fs.copyFileSync(abs, path.join(project.dir, "assets", f));
      }
      for (const f of fs.readdirSync(path.join(project.dir, "assets"))) {
        if (f.toLowerCase().endsWith(".svg")) {
          try { ensureLogoAnalysis(path.join(project.dir, "assets", f), `assets/${f}`); } catch { /* not a logo */ }
        }
      }
    }
    if (fs.existsSync(path.join(src, "glyphs.json"))) fs.copyFileSync(path.join(src, "glyphs.json"), path.join(project.dir, "glyphs.json"));
    let spec: unknown = t.spec;
    if (format !== t.meta.format) {
      const parsed = SpecSchema.parse(preprocessSpec({ ...t.spec, format: t.meta.format }));
      const out = reflowSpec(parsed, format);
      out.formats = t.meta.formats.filter((f) => f !== format);
      spec = out;
    }
    const res = await writeSpec(project.id, spec);
    if (!res.ok) throw new Error(`Template spec is invalid: ${res.errors.join("; ")}`);
    return project;
  } catch (e) {
    try { deleteProject(project.id); } catch { /* best effort */ }
    throw e;
  }
};
