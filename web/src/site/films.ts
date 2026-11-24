/**
 * The starter templates as the product site's films: metadata bundled, specs loaded on demand, public files served from
 * /site/templates/<slug>/ (copied into the build by the site-templates plugin in web/vite.config.ts). No API involved.
 */
import type { Format } from "../api";
import { analyzeSpec, type ParsedInfo } from "../lib/specInfo";
import { parseSpec } from "../../../src/engine/render/SpecVideo";
import { reflowSpec } from "../../../src/engine/spec/reflow";

export type Film = {
  slug: string; title: string; niche: string; description: string; format: Format;
  formats: Format[]; durationSeconds: number; tags: string[]; order: number;
};

type Meta = Omit<Film, "slug" | "formats" | "order"> & { formats?: Format[]; order?: number };
const metas = import.meta.glob<Meta>("../../../templates/*/template.json", { eager: true, import: "default" });
const specs = import.meta.glob<Record<string, unknown>>("../../../templates/*/spec.json", { import: "default" });
const slugOf = (p: string) => p.split("/").at(-2)!;

export const FILMS: Film[] = Object.entries(metas)
  .map(([p, m]) => ({ ...m, slug: slugOf(p), formats: m.formats ?? [m.format], tags: m.tags ?? [], order: m.order ?? 99 }))
  .sort((a, b) => a.order - b.order);

/** "Event: most nights blur" → { kind: "Event", name: "most nights blur" } */
export const splitTitle = (t: string) => {
  const i = t.indexOf(":");
  return i < 0 ? { kind: "", name: t } : { kind: t.slice(0, i).trim(), name: t.slice(i + 1).trim() };
};

export const filmBase = (slug: string) => `${location.origin}/site/templates/${encodeURIComponent(slug)}`;

const reflowed = new Map<string, Promise<ParsedInfo | null>>();
/** A film adapted to another format by the engine's reflow (the same adaptation a multi-format render uses). */
export const loadFilmAs = (slug: string, format: Format) => {
  const key = `${slug}@${format}`;
  let p = reflowed.get(key);
  if (!p) {
    const f = FILMS.find((x) => x.slug === slug);
    const load = specs[`../../../templates/${slug}/spec.json`];
    p = f && load
      ? load().then((raw) => analyzeSpec(reflowSpec(parseSpec({ ...raw, format: f.format }), format) as unknown as Record<string, unknown>)).catch((e) => { console.warn(`[site] ${key}: ${(e as Error).message}`); return null; })
      : Promise.resolve(null);
    reflowed.set(key, p);
  }
  return p;
};
