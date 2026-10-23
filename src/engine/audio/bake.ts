/**
 * Cue "bake" recipes (pure). A planned cue = a stack of layers (recorded transient / material body, tuned synth sub,
 * air, tail…) that share one apex. The Player has only a handful of audio tags and Remotion's playbackRate keeps
 * pitch, so instead of mounting 3–5 tags per hit we describe the cue as a small JSON recipe and mix it ONCE into a
 * single WAV: varispeed pitch (real pitch shift, length changes with it — the planner accounts for that), per-layer
 * gain / filters, equal-power pan (+ optional sweep across the apex, subs stay centred) and a shared reverb "space"
 * (the same preset for the whole film = glue).
 *
 * The recipe travels in the URL (`${libraryBase}/bake/<hash>.wav?r=<recipe>`); the host (asset server for renders,
 * web server for the Player, pre-upload for Lambda) renders it on first request with `renderRecipe` and caches it by
 * hash. Same recipe → same bytes everywhere (deterministic DSP, seeded synth, deterministic dither).
 */
import { SR, dbToGain, fadeEdges, filterBuf, makeBuf, normalize, panGains, reverb, reverseBuf, softLimit, varispeed, type Buf } from "./dsp";
import { synthesize, synthMeta, type SynthSpec } from "./synth";

export const BAKE_VERSION = 1;

export type BakeLayer = {
  /** library sound name (manifest) … */
  f?: string;
  /** … or a synth layer */
  s?: SynthSpec;
  /** start of the layer inside the cue file (s) */
  o: number;
  /** gain, dB */
  g: number;
  /** varispeed pitch shift, semitones (also scales the length by 2^(-p/12)) */
  p?: number;
  hp?: number;
  lp?: number;
  /** reverse */
  rv?: 1;
  /** centred + dry (subs): never panned, no reverb send */
  c?: 1;
  /** reverb send 0..1 (default 0.25) */
  w?: number;
  /** max length (s) of the layer after pitching (fade-out at the cut) */
  x?: number;
  /** Trim source after varispeed, seconds; used for carrying the previous material's decay. */
  i?: number;
};
export type Space = "dry" | "room" | "plate" | "hall";
export type Recipe = {
  v: number;
  /** cue file length (s) */
  d: number;
  l: BakeLayer[];
  /** −1..1 */
  pan?: number;
  /** pan sweep: pan moves from (pan − sw) to (pan + sw) around the apex `ap` */
  sw?: number;
  /** apex time in the file (s) */
  ap?: number;
  sp?: Space;
  /** stereo width of the dry layers 0..1 (1 = as recorded) */
  wd?: number;
};

const B64 = (s: string) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"));
const UNB64 = (s: string) => (typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Round every number to 3 decimals (stable, short URLs). */
const tidy = (v: unknown): unknown => (typeof v === "number" ? r3(v) : Array.isArray(v) ? v.map(tidy) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, tidy(x)])) : v);

export const encodeRecipe = (r: Recipe) => B64(JSON.stringify(tidy(r))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const decodeRecipe = (s: string): Recipe => JSON.parse(UNB64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)));

/** 64-bit (two FNV-1a lanes) hex hash of the encoded recipe. */
export const recipeHash = (enc: string) => {
  let a = 2166136261 ^ BAKE_VERSION, b = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < enc.length; i++) { const c = enc.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13); }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
};

/** Sanity limits (the host renders recipes from URLs). Throws on anything out of bounds. */
export const validateRecipe = (r: Recipe, exists: (name: string) => boolean) => {
  if (!r || typeof r !== "object" || !Array.isArray(r.l)) throw new Error("bad recipe");
  if (!(r.d > 0 && r.d <= 8)) throw new Error("bad length");
  if (r.l.length < 1 || r.l.length > 8) throw new Error("bad layer count");
  for (const l of r.l) {
    if (!!l.f === !!l.s) throw new Error("layer needs exactly one of f / s");
    if (l.f && (!/^[a-z0-9-]+$/.test(l.f) || !exists(l.f))) throw new Error(`unknown sound ${l.f}`);
    if (l.s) { const m = synthMeta(l.s); if (!(m.dur > 0 && m.dur <= 8)) throw new Error("bad synth length"); }
    if (Math.abs(l.o) > 8 || Math.abs(l.g) > 48 || Math.abs(l.p ?? 0) > 12) throw new Error("layer params out of range");
    if (l.i !== undefined && (!Number.isFinite(l.i) || l.i < 0 || l.i > 30)) throw new Error("bad source trim");
  }
};

/** Space presets: one shared reverb per film (dry sources + the same room = one designed world). */
const SPACES: Record<Space, { room: number; damp: number; predelay: number; hp: number; lp: number; scale: number }> = {
  dry: { room: 0.2, damp: 0.7, predelay: 0.004, hp: 400, lp: 6000, scale: 0.35 },
  room: { room: 0.45, damp: 0.55, predelay: 0.008, hp: 300, lp: 7000, scale: 0.8 },
  plate: { room: 0.72, damp: 0.3, predelay: 0.012, hp: 350, lp: 9000, scale: 1 },
  hall: { room: 0.9, damp: 0.45, predelay: 0.022, hp: 250, lp: 6500, scale: 1.1 },
};

/** Length of a library / synth source after pitching (for planners). */
export const pitchedLength = (dur: number, semis = 0) => dur / Math.pow(2, semis / 12);

/**
 * Render a recipe. `load(name)` returns the decoded 48 kHz stereo library sound (already −16 LUFS normalized), or
 * null if unknown. Synth layers are normalized to the same loudness so layer gains mean the same thing for both.
 */
export const renderRecipe = (r: Recipe, load: (name: string) => Buf | null): Buf => {
  const out = makeBuf(r.d);
  const send = makeBuf(r.d);
  const width = r.wd ?? 1;
  const panAt = (t: number) => {
    const base = r.pan ?? 0;
    if (!r.sw) return base;
    return Math.max(-1, Math.min(1, base + r.sw * Math.tanh((t - (r.ap ?? r.d / 2)) / 0.12)));
  };
  for (const l of r.l) {
    let src: Buf | null;
    if (l.s) { src = synthesize(l.s); if (l.s.k !== "thread") normalize(src, -16, -1); }
    else { const b = load(l.f!); src = b ? { L: b.L.slice(), R: b.R.slice(), n: b.n } : null; }
    if (!src) continue;
    if (l.rv) reverseBuf(src);
    if (l.p) src = varispeed(src, Math.pow(2, l.p / 12));
    if (l.i) { const at = Math.min(src.n, Math.round(l.i * SR)); src = { L: src.L.slice(at), R: src.R.slice(at), n: src.n - at }; }
    if (l.hp) filterBuf(src, "hp", l.hp);
    if (l.lp) filterBuf(src, "lp", l.lp);
    if (l.x && src.n > l.x * SR) { const n = Math.round(l.x * SR); src = { L: src.L.slice(0, n), R: src.R.slice(0, n), n }; fadeEdges(src, 0, Math.min(120, l.x * 300)); }
    const g = dbToGain(l.g);
    const o = Math.round(l.o * SR);
    const wet = l.c ? 0 : l.w ?? 0.25;
    for (let i = 0; i < src.n; i++) {
      const j = o + i;
      if (j < 0) continue;
      if (j >= out.n) break;
      let L = src.L[i] * g, R = src.R[i] * g;
      if (l.c) { const m = (L + R) * 0.5; L = m; R = m; }
      else {
        if (width < 1) { const m = (L + R) * 0.5; L = m + (L - m) * width; R = m + (R - m) * width; }
        const p = panAt(j / SR);
        if (p) { const [gl, gr] = panGains(p); const m = (L + R) * 0.5; L = (L * 0.4 + m * 0.6) * gl; R = (R * 0.4 + m * 0.6) * gr; }
      }
      out.L[j] += L; out.R[j] += R;
      if (wet) { send.L[j] += src.L[i] * g * wet; send.R[j] += src.R[i] * g * wet; }
    }
  }
  const sp = SPACES[r.sp ?? "room"];
  // shared space: the reverb return stays wide and centred (the room does not pan with the object)
  reverb(send, { room: sp.room, damp: sp.damp, wet: sp.scale, dry: 0, predelay: sp.predelay, hp: sp.hp, lp: sp.lp });
  for (let i = 0; i < out.n; i++) { out.L[i] += send.L[i]; out.R[i] += send.R[i]; }
  fadeEdges(out, 0.3, Math.min(60, r.d * 200));
  softLimit(out, 0.93);
  return out;
};
