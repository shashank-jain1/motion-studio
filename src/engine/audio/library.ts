/**
 * The built-in SFX library, manifest v2. Two statically imported manifests (so the engine knows every sound's
 * length / apex / tags without fetching anything):
 *   library/sfx/manifest.json           synthesized sounds (scripts/gen-sfx.ts — generated, wholly ours)
 *   library/sfx/recorded/manifest.json  curated CC0 recordings (scripts/sfx-curate.ts → scripts/sfx-ingest.ts;
 *                                       provenance per file in library/LICENSES.json)
 * Only audio is loaded at playback / render time, from `libraryBase`:
 *   renders (CLI / MCP / server local backend)  `${assetServer.origin}/_library`
 *   web Player                                   `${location.origin}/library`
 *   Lambda                                       `${s3 asset prefix}/_library`
 * Planned auto cues are "baked" (layers mixed / pitched / panned / reverbed into one WAV, see bake.ts):
 *   `${libraryBase}/bake/<hash>.wav?r=<recipe>` — the host bakes it on first request and caches it by hash.
 */
import synthManifest from "../../../library/sfx/manifest.json";
import recordedManifest from "../../../library/sfx/recorded/manifest.json";
import { encodeRecipe, recipeHash, type Recipe } from "./bake";

export type SfxPalette = "cinematic" | "tech" | "playful" | "minimal" | "luxury" | "hype";

/** Manifest v2 entry (synth and recorded share it). */
export type SfxEntry = {
  name: string;
  /** path under library/sfx/ ("whoosh-short.wav", "recorded/glass-tap-1.wav") */
  file: string;
  source: "recorded" | "synth";
  /** taxonomy: "impact.light", "whoosh.short", "ui.click", "foley.paper", "magic.chime", … */
  category: string;
  material: string[];
  /** 0..1 */
  weight: number;
  /** 0..1 */
  speed: number;
  /** 0..1 (spectral centroid, log scale) */
  brightness: number;
  tonal: boolean;
  pitchHz?: number;
  /** seconds from the file start to its transient / apex */
  peakAt: number;
  durationSec: number;
  /** max momentary loudness (LUFS) */
  loudness: number;
  sharpness?: number;
  flatness?: number;
  world: "hyper-real" | "abstract";
  palettes: string[];
  emotions: string[];
  /** round-robin family */
  group: string;
  /** "CC0-1.0" (see library/LICENSES.json) or "original" (synthesized) */
  license: string;
  description: string;
};
/** v1 name kept for callers. */
export type SfxInfo = SfxEntry;

type RawManifest = { sounds: Partial<SfxEntry>[] & { palette?: string[] }[] };
const norm = (s: Partial<SfxEntry> & { palette?: string[] }, source: "recorded" | "synth"): SfxEntry => ({
  name: s.name!, file: s.file ?? `${s.name}.wav`, source: s.source ?? source, category: s.category ?? "misc",
  material: s.material ?? [], weight: s.weight ?? 0.5, speed: s.speed ?? 0.5, brightness: s.brightness ?? 0.5,
  tonal: s.tonal ?? false, ...(s.pitchHz ? { pitchHz: s.pitchHz } : {}), peakAt: s.peakAt ?? 0, durationSec: s.durationSec ?? 1,
  loudness: s.loudness ?? -16, sharpness: s.sharpness, flatness: s.flatness, world: s.world ?? (source === "synth" ? "abstract" : "hyper-real"),
  palettes: s.palettes ?? s.palette ?? [], emotions: s.emotions ?? [], group: s.group ?? s.name!.replace(/-?\d+$/, ""),
  license: s.license ?? (source === "synth" ? "original" : "CC0-1.0"), description: s.description ?? "",
});

export const SFX: Record<string, SfxEntry> = Object.fromEntries([
  ...((synthManifest as unknown as RawManifest).sounds.map((s) => norm(s, "synth"))),
  ...((recordedManifest as unknown as RawManifest).sounds.map((s) => norm(s, "recorded"))),
].map((s) => [s.name, s]));
export const SFX_NAMES = Object.keys(SFX);
export const RECORDED = SFX_NAMES.filter((n) => SFX[n].source === "recorded").map((n) => SFX[n]);

/** "sfx:whoosh-short" → "whoosh-short"; anything else → null. */
export const sfxName = (src: string): string | null => {
  const m = /^sfx:([a-z0-9-]+)$/i.exec(src.trim());
  return m ? m[1].toLowerCase() : null;
};

export const sfxInfo = (src: string): SfxEntry | null => {
  const n = sfxName(src);
  return n ? SFX[n] ?? null : null;
};

/** "bake:<recipe>" cue sources (planned, layered cues). */
export const bakeSrc = (r: Recipe) => `bake:${encodeRecipe(r)}`;
export const isBakeSrc = (src: string) => src.startsWith("bake:");

/**
 * Resolve a "sfx:<name>" / "bake:<recipe>" source to a URL under `libraryBase`. Returns null for unknown names or when
 * no base is available (e.g. plain Remotion Studio without a library server). Other sources are returned unchanged.
 */
export const resolveSfx = (src: string, libraryBase: string | undefined): string | null => {
  if (isBakeSrc(src)) {
    if (!libraryBase) return null;
    const r = src.slice(5);
    return `${libraryBase.replace(/\/$/, "")}/bake/${recipeHash(r)}.wav?r=${r}`;
  }
  const n = sfxName(src);
  if (n === null) return src;
  if (!SFX[n] || !libraryBase) return null;
  return `${libraryBase.replace(/\/$/, "")}/sfx/${SFX[n].file}`;
};

/**
 * Default library base when the host did not pass one: the web server's public `/library` route on the same origin
 * as an absolute `assetBase` (the web Player passes `${origin}/files/<id>`). Renders always pass `libraryBase`.
 */
export const defaultLibraryBase = (assetBase: string | undefined): string | undefined => {
  if (!assetBase || !/^https?:\/\//.test(assetBase)) return undefined;
  try {
    const u = new URL(assetBase);
    if (!u.pathname.startsWith("/files/")) return undefined;
    return `${u.origin}/library`;
  } catch {
    return undefined;
  }
};
