/**
 * Free music libraries, license-aware.
 *
 *   freetouse  Free To Use (api.freetouse.com/v3, no key). Free License: NON-premium tracks in personal user-generated
 *              content on social platforms (monetization allowed) with credit in the description. NOT for commercial
 *              content (promoting a business/brand/product), broadcast or products — that needs their paid plan.
 *   openverse  Openverse (api.openverse.org, no key): openly licensed audio from Jamendo, ccMixter, Freesound,
 *              Wikimedia. Only CC0, public domain and CC BY are accepted (commercial + editing allowed; BY needs
 *              credit). Share-alike (BY-SA) and non-commercial / no-derivatives licenses are excluded.
 *
 * A film's `usage` decides what is allowed: "commercial" (brand / client / ads) accepts only commercial-safe licenses;
 * "personal" also accepts Free To Use. Every import writes assets/<file>.license.json; renders write the credits the
 * licenses require next to the MP4.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CACHE_DIR } from "./paths";

export type MusicProvider = "freetouse" | "openverse";
export type Usage = "personal" | "commercial";

export type LicenseInfo = {
  /** "cc0" | "pdm" | "by" | "freetouse-free" … */
  code: string;
  name: string;
  url?: string;
  /** allowed in commercial content (ads, brand / client work) */
  commercial: boolean;
  /** may be cut / faded / looped */
  modification: boolean;
  attribution: boolean;
  /** the exact credit line to publish (empty when not required) */
  credit: string;
  /** where the credit goes */
  creditWhere?: string;
  terms?: string;
};

export type MusicHit = {
  provider: MusicProvider;
  id: string;
  title: string;
  artist: string;
  seconds: number;
  genre?: string;
  tags: string[];
  audioUrl: string;
  pageUrl: string;
  license: LicenseInfo;
  /** loudness along the track (0..1), when the provider supplies it */
  energy?: number[];
};

export type TrackLicense = { provider: MusicProvider | "composed" | "upload"; id?: string; title?: string; artist?: string; pageUrl?: string; audioUrl?: string; license: LicenseInfo; importedAt: string };

const UA = "motion-studio/0.1 (+https://github.com/shashank-jain1/motion-studio)";
export let fetchImpl: typeof fetch = (...a) => fetch(...a);
export const setMusicFetch = (f: typeof fetch) => { fetchImpl = f; };

// ---------------------------------------------------------------- license policy

const FTU_TERMS = "Free To Use Free License: non-premium tracks in personal content on social platforms (monetization allowed) with credit in the description; not for content promoting a business, brand or product (needs their Commercial plan).";

export const freeToUseLicense = (title: string, artist: string): LicenseInfo => ({
  code: "freetouse-free", name: "Free To Use — Free License", url: "https://freetouse.com/license",
  commercial: false, modification: true, attribution: true,
  credit: `Music from Free To Use\nSource: https://freetouse.com/music\n${title} by ${artist}`,
  creditWhere: "video description", terms: FTU_TERMS,
});

const CC: Record<string, Omit<LicenseInfo, "credit" | "url">> = {
  cc0: { code: "cc0", name: "CC0 (public domain dedication)", commercial: true, modification: true, attribution: false },
  pdm: { code: "pdm", name: "Public Domain Mark", commercial: true, modification: true, attribution: false },
  by: { code: "by", name: "CC BY", commercial: true, modification: true, attribution: true },
};

/** Openverse/CC license → policy; null for licenses this app refuses (NC, ND, SA, sampling). */
export const ccLicense = (code: string, version: string | undefined, url: string | undefined, attribution: string): LicenseInfo | null => {
  const base = CC[code.toLowerCase()];
  if (!base) return null;
  const name = `${base.name}${version && base.code === "by" ? ` ${version}` : ""}`;
  return { ...base, name, url, credit: base.attribution ? attribution : "", creditWhere: base.attribution ? "video description or end credits" : undefined };
};

/** Can this license be used for a film with this usage? (unspecified usage behaves like personal, with a warning elsewhere) */
export const allowedFor = (l: LicenseInfo, usage: Usage | undefined) => l.modification && (usage !== "commercial" || l.commercial);

// ---------------------------------------------------------------- search

const CACHE = path.join(CACHE_DIR, "music-search");
const TTL_MS = 24 * 3600 * 1000;
const cacheGet = (key: string): MusicHit[] | null => {
  const f = path.join(CACHE, `${key}.json`);
  try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < TTL_MS) return JSON.parse(fs.readFileSync(f, "utf8")) as MusicHit[]; } catch { /* miss */ }
  return null;
};
const cacheSet = (key: string, hits: MusicHit[]) => { try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(path.join(CACHE, `${key}.json`), JSON.stringify(hits)); } catch { /* best effort */ } };

const getJson = async (url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> => {
  const t = AbortSignal.timeout(timeoutMs);
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, t]) : t });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

type FtuTrack = {
  id: string; title: string; duration: number; genre?: string | null; is_premium?: boolean; lyrics?: string | null;
  artists?: [number, { name: string }][]; tags?: [number, string][]; categories?: [number, { name: string }][];
  waveform?: number[]; files?: { mp3?: string };
};

const searchFreeToUse = async (q: string, limit: number, signal?: AbortSignal): Promise<MusicHit[]> => {
  const url = `https://api.freetouse.com/v3/music/tracks/search?query=${encodeURIComponent(q)}&limit=${Math.min(50, limit * 2)}`;
  const d = (await getJson(url, 15000, signal)) as { data?: FtuTrack[] };
  return (d.data ?? [])
    .filter((t) => !t.is_premium && t.files?.mp3) // premium tracks are never free
    .map((t): MusicHit => {
      const artist = (t.artists ?? []).sort((a, b) => a[0] - b[0]).map((a) => a[1].name).join(" & ") || "Unknown artist";
      const wf = (t.waveform ?? []).map((v) => Math.max(0, Math.min(1, v / 100)));
      return {
        provider: "freetouse", id: t.id, title: t.title, artist, seconds: Math.round(t.duration * 10) / 10, genre: t.genre ?? undefined,
        tags: [...(t.categories ?? []).map((c) => c[1].name), ...(t.tags ?? []).map((x) => x[1])].map((s) => s.toLowerCase()).filter((s, i, a) => a.indexOf(s) === i),
        audioUrl: t.files!.mp3!, pageUrl: "https://freetouse.com/music", license: freeToUseLicense(t.title, artist), ...(wf.length ? { energy: wf } : {}),
      };
    });
};

type OvAudio = {
  id: string; title?: string; creator?: string; url?: string; foreign_landing_url?: string; license: string; license_version?: string; license_url?: string;
  attribution?: string; duration?: number; genres?: string[]; tags?: { name: string }[]; source?: string; category?: string; filetype?: string; mature?: boolean;
};

const searchOpenverse = async (q: string, limit: number, signal?: AbortSignal): Promise<MusicHit[]> => {
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&category=music&license=cc0,pdm,by&page_size=${Math.min(20, limit * 2)}&mature=false`;
  const d = (await getJson(url, 12000, signal)) as { results?: OvAudio[] };
  return (d.results ?? []).flatMap((r): MusicHit[] => {
    if (!r.url || r.mature) return [];
    const title = r.title?.trim() || "Untitled";
    const artist = r.creator?.trim() || "Unknown artist";
    const credit = r.attribution?.trim() || `"${title}" by ${artist}, licensed under ${r.license.toUpperCase()} ${r.license_version ?? ""}${r.license_url ? `. ${r.license_url}` : ""}`.trim();
    const lic = ccLicense(r.license, r.license_version, r.license_url, credit); // re-check client side: never trust a filter alone
    if (!lic) return [];
    return [{
      provider: "openverse", id: r.id, title, artist, seconds: Math.round((r.duration ?? 0) / 100) / 10, genre: r.genres?.[0],
      tags: [r.source ?? "", ...(r.tags ?? []).map((t) => t.name)].map((s) => s.toLowerCase()).filter(Boolean).slice(0, 12),
      audioUrl: r.url, pageUrl: r.foreign_landing_url ?? `https://openverse.org/audio/${r.id}`, license: lic,
    }];
  });
};

export type SearchResult = { hits: MusicHit[]; notes: string[] };

/** Search providers in parallel; a slow / failing provider is reported, never fatal. Results allowed for `usage` only. */
export const searchMusic = async (q: string, o: { providers?: MusicProvider[]; usage?: Usage; minSeconds?: number; limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult> => {
  const providers: MusicProvider[] = o.providers ?? ["freetouse", "openverse"];
  const limit = Math.max(1, Math.min(25, o.limit ?? 10));
  const notes: string[] = [];
  if (o.usage === "commercial" && providers.includes("freetouse")) notes.push("Free To Use is skipped: its free license excludes commercial content (ads, brand/client work).");
  const lists = await Promise.all(providers.filter((p) => !(o.usage === "commercial" && p === "freetouse")).map(async (p) => {
    const key = crypto.createHash("sha1").update(`${p}|${q.toLowerCase().trim()}|${limit}`).digest("hex").slice(0, 16);
    const cached = cacheGet(key);
    if (cached) return cached;
    try {
      const hits = p === "freetouse" ? await searchFreeToUse(q, limit, o.signal) : await searchOpenverse(q, limit, o.signal);
      cacheSet(key, hits);
      return hits;
    } catch (e) {
      if ((e as Error).name === "AbortError" && o.signal?.aborted) throw e;
      notes.push(`${p === "freetouse" ? "Free To Use" : "Openverse"} is unavailable right now (${(e as Error).message.slice(0, 80)}); try again later or use compose_music.`);
      return [];
    }
  }));
  const minS = o.minSeconds ?? 0;
  const hits = lists.flat().filter((h) => h.seconds >= minS && allowedFor(h.license, o.usage));
  // interleave providers so neither crowds the other out
  const by = providers.map((p) => hits.filter((h) => h.provider === p));
  const out: MusicHit[] = [];
  for (let i = 0; out.length < limit && by.some((l) => l[i]); i++) for (const l of by) if (l[i] && out.length < limit) out.push(l[i]);
  return { hits: out, notes };
};

/** Fetch one track's metadata again by id (Free To Use) — import never trusts a client-supplied URL or license. */
export const lookupTrack = async (provider: MusicProvider, id: string, signal?: AbortSignal): Promise<MusicHit> => {
  if (!/^[A-Za-z0-9-]{6,64}$/.test(id)) throw new Error("Invalid track id");
  if (provider === "freetouse") {
    const d = (await getJson(`https://api.freetouse.com/v3/music/tracks/${id}`, 15000, signal)) as { data?: FtuTrack } & FtuTrack;
    const t = (d.data ?? d) as FtuTrack;
    if (!t?.id) throw new Error("Track not found on Free To Use");
    if (t.is_premium) throw new Error("This Free To Use track is premium — it needs a paid license and can't be used for free.");
    const hits = await (async () => {
      const artist = (t.artists ?? []).sort((a, b) => a[0] - b[0]).map((a) => a[1].name).join(" & ") || "Unknown artist";
      return [{ provider: "freetouse" as const, id: t.id, title: t.title, artist, seconds: t.duration, tags: [], audioUrl: t.files?.mp3 ?? "", pageUrl: "https://freetouse.com/music", license: freeToUseLicense(t.title, artist) }];
    })();
    if (!hits[0].audioUrl) throw new Error("Track has no downloadable file");
    return hits[0];
  }
  const r = (await getJson(`https://api.openverse.org/v1/audio/${id}/`, 15000, signal)) as OvAudio;
  const title = r.title?.trim() || "Untitled", artist = r.creator?.trim() || "Unknown artist";
  const lic = ccLicense(r.license, r.license_version, r.license_url, r.attribution?.trim() || `"${title}" by ${artist}, ${r.license.toUpperCase()} ${r.license_version ?? ""}`);
  if (!lic) throw new Error(`This track's license (${r.license}) is not one this studio accepts (CC0, public domain, CC BY only).`);
  if (!r.url) throw new Error("Track has no downloadable file");
  return { provider: "openverse", id: r.id, title, artist, seconds: (r.duration ?? 0) / 1000, tags: [], audioUrl: r.url, pageUrl: r.foreign_landing_url ?? `https://openverse.org/audio/${r.id}`, license: lic };
};

export const licensePath = (assetFile: string) => `${assetFile}.license.json`;
export const writeTrackLicense = (assetFile: string, l: TrackLicense) => fs.writeFileSync(licensePath(assetFile), JSON.stringify(l, null, 2) + "\n");
export const readTrackLicense = (assetFile: string): TrackLicense | null => {
  try { return JSON.parse(fs.readFileSync(licensePath(assetFile), "utf8")) as TrackLicense; } catch { return null; }
};

/** The music credit block for a render (null when nothing needs crediting). */
export const creditsText = (l: TrackLicense | null): string | null => {
  if (!l || !l.license.attribution || !l.license.credit) return null;
  return `${l.license.credit}${l.license.creditWhere ? `\n(Required by ${l.license.name}: publish this in the ${l.license.creditWhere}.)` : ""}`;
};
