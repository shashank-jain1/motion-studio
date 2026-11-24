/**
 * The product site's films: five films about Motion Studio, directed through the studio's own tools and rendered by the
 * engine (projects/site-film-*). Each has its Scene Spec here (./specs, audio stripped: the page is silent) for the live
 * engine sections, and a muted MP4 loop in web/public/site/media for the video sections.
 */
import type { Format } from "../api";
import { analyzeSpec, type ParsedInfo } from "../lib/specInfo";
import { parseSpec } from "../../../src/engine/render/SpecVideo";
import { reflowSpec } from "../../../src/engine/spec/reflow";

export type SiteFilm = { slug: string; title: string; kicker: string; blurb: string; format: Format; seconds: number };

export const FILMS: SiteFilm[] = [
  { slug: "brief-it", title: "Brief it", kicker: "Launch film", format: "16:9", seconds: 16.1,
    blurb: "A prompt is typed, the camera flies into the send dot, the spec writes itself and the film builds in the viewer." },
  { slug: "studio", title: "The studio", kicker: "Product demo", format: "16:9", seconds: 19.4,
    blurb: "A note to the director, a scrub of the playhead, 16:9 flipped to 9:16, three formats exported. One take." },
  { slug: "kit", title: "The kit, in numbers", kicker: "Data explainer", format: "16:9", seconds: 17.8,
    blurb: "The pipeline as a diagram, the kit as a chart, 347 sounds counted, every format rendered from a terminal." },
  { slug: "formats", title: "One spec, every format", kicker: "Social reel", format: "9:16", seconds: 11.4,
    blurb: "Beat-locked at 120 BPM: words slam on the beat, then one frame springs through all five formats." },
  { slug: "claude", title: "Direct it from Claude", kicker: "Connector", format: "16:9", seconds: 14.8,
    blurb: "Tool calls tick off in a chat, the director catches its own collision, and the finished reel plays." },
];

const specs = import.meta.glob<Record<string, unknown>>("./specs/*.json", { import: "default" });

/** Muted MP4 loop of a film (16:9 renders; the vertical reel also has its 16:9 reflow). */
export const filmLoop = (slug: string) => `/site/media/${slug}.mp4`;
export const filmPoster = (slug: string) => `/site/media/${slug}.jpg`;
/** The specs use no asset files; the base only has to be absolute for the engine's resolver. */
export const filmBase = (_slug: string) => `${location.origin}/site/media`;

/** A film's raw spec (cached). */
export const loadRaw = (slug: string) => {
  const load = specs[`./specs/${slug}.json`];
  return load ? load() : Promise.reject(new Error(`no spec for ${slug}`));
};

const cache = new Map<string, Promise<ParsedInfo | null>>();
/** A film as the engine plays it, optionally adapted to another format by the engine's reflow. */
export const loadFilmAs = (slug: string, format?: Format) => {
  const key = `${slug}@${format ?? "master"}`;
  let p = cache.get(key);
  if (!p) {
    p = loadRaw(slug)
      .then((raw) => analyzeSpec(format ? (reflowSpec(parseSpec(raw), format) as unknown as Record<string, unknown>) : raw))
      .catch((e) => { console.warn(`[site] ${key}: ${(e as Error).message}`); return null; });
    cache.set(key, p);
  }
  return p;
};
