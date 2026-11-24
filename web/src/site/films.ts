/**
 * The starter templates as the product site's films: metadata bundled, specs loaded per film, public files served from
 * /site/templates/<slug>/ (copied into the build by the site-templates plugin in web/vite.config.ts). No API involved.
 */
import type { Format } from "../api";
import { analyzeSpec, type ParsedInfo } from "../lib/specInfo";

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
export const filmPoster = (slug: string) => `${filmBase(slug)}/poster.jpg`;

const cache = new Map<string, Promise<ParsedInfo | null>>();
export const loadFilm = (f: Film) => {
  let p = cache.get(f.slug);
  if (!p) {
    const load = specs[`../../../templates/${f.slug}/spec.json`];
    p = load ? load().then((spec) => analyzeSpec({ ...spec, format: f.format })).catch(() => null) : Promise.resolve(null);
    cache.set(f.slug, p);
  }
  return p;
};
