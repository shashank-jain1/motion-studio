/**
 * The film's SOUND BRIEF (pure): what the sound must be, derived once per spec before any sound is chosen
 * (docs/research/04-sound-design.md §4.1). `spec.sound.brief` wins field by field; everything missing is inferred from
 * the palette / style / concept / on-screen objects / music analysis:
 *   voice      precise | warm | playful | epic | luxury | raw | calm   (brand voice → envelope, brightness, timbres)
 *   realism    hyper-real (recorded material foley) | abstract (synth / tonal) | mixed
 *   materials  1–2 primary + 1 accent material families (glass, metal-thin, paper, wood, liquid, digital…)
 *   space      dry | room | plate | hall — ONE shared reverb for the whole film
 *   key        tonal centre: brief.key > music analysis (sound.music.key) > a stable per-brand key (no music)
 *   energy     0..1 per scene (arc words, position, cut rate) → density, layer count, hit weight
 */
import type { Spec, Layer } from "../spec/schema";
import { hashStr } from "./dsp";
import type { Space } from "./bake";
import type { SfxPalette } from "./library";

export type Voice = "precise" | "warm" | "playful" | "epic" | "luxury" | "raw" | "calm";
export type Realism = "hyper-real" | "abstract" | "mixed";
export type MusicKey = { root: number; minor: boolean; confidence: number; source: "brief" | "music" | "brand" };
export type Brief = {
  voice: Voice;
  realism: Realism;
  materials: string[];
  space: Space;
  avoid: string[];
  key: MusicKey;
  hasMusic: boolean;
  bpm?: number;
  beats: number[];
  onsets: number[];
  energy: number[];
  variation: number;
  restraint: number;
  stereo: boolean;
  /** width / height of the frame (9:16 → subtler pan) */
  aspect: number;
  width: number;
  /** legacy palette label matching the voice (library `palettes` tags) */
  palette: SfxPalette;
  /** stable id for the brand's sonic signature */
  brand: string;
};

export const VOICE_PALETTE: Record<Voice, SfxPalette> = { precise: "tech", warm: "minimal", playful: "playful", epic: "cinematic", luxury: "luxury", raw: "hype", calm: "minimal" };
const PALETTE_VOICE: Record<SfxPalette, Voice> = { cinematic: "epic", tech: "precise", playful: "playful", minimal: "calm", luxury: "luxury", hype: "raw" };
export const VOICE_SPACE: Record<Voice, Space> = { precise: "room", warm: "room", playful: "room", epic: "hall", luxury: "plate", raw: "dry", calm: "plate" };
const VOICE_MATERIALS: Record<Voice, string[]> = {
  precise: ["metal-thin", "glass", "plastic"], luxury: ["glass", "metal-thin", "ceramic"], warm: ["wood", "paper", "ceramic"],
  playful: ["plastic", "liquid", "body"], epic: ["metal", "stone", "air"], raw: ["metal", "digital", "body"], calm: ["paper", "cloth", "ceramic"],
};
/** Target brightness (0..1) of the film's sounds per voice: luxury / calm darker, tech / playful brighter. */
export const VOICE_BRIGHT: Record<Voice, number> = { precise: 0.6, warm: 0.4, playful: 0.6, epic: 0.32, luxury: 0.42, raw: 0.55, calm: 0.36 };

const KEYWORDS: [RegExp, Voice][] = [
  [/luxur|gold|elegan|premium|jewel|fashion|perfume|silk/i, "luxury"],
  [/epic|cinema|trailer|dark|hero|power|launch/i, "epic"],
  [/neon|cyber|glitch|hype|drop|street|rave|bold|loud/i, "raw"],
  [/play|fun|kid|candy|pop|toy|bounce|cute|game/i, "playful"],
  [/warm|coffee|brew|craft|organic|food|bake|cozy|wood|hand/i, "warm"],
  [/calm|wellness|meditat|sleep|soft|minimal|zen|breath|health/i, "calm"],
  [/tech|saas|app|dev|data|fintech|ai|precise|apple|clean|pay|platform|cloud/i, "precise"],
];

const NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** "F# minor", "Bbm", "c#", "E major" → { root, minor } */
export const parseKey = (s: string | undefined): { root: number; minor: boolean } | null => {
  if (!s) return null;
  const m = /^\s*([a-g])\s*([#b♯♭]?)\s*(m(?:in(?:or)?)?|maj(?:or)?|min|minor|major)?\s*$/i.exec(s.trim());
  if (!m) return null;
  let root = NOTE[m[1].toLowerCase()];
  if (m[2] === "#" || m[2] === "♯") root += 1;
  if (m[2] === "b" || m[2] === "♭") root -= 1;
  const q = (m[3] ?? "").toLowerCase();
  return { root: (root + 12) % 12, minor: q.startsWith("m") && !q.startsWith("maj") };
};
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const keyName = (k: { root: number; minor: boolean }) => `${NAMES[k.root]} ${k.minor ? "minor" : "major"}`;

/** Pitch classes for chord-tone tuning. */
export const scalePcs = (k: { root: number; minor: boolean }, kind: "root" | "power" | "triad" | "penta") => {
  const iv = kind === "root" ? [0] : kind === "power" ? [0, 7] : kind === "triad" ? (k.minor ? [0, 3, 7] : [0, 4, 7]) : k.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  return iv.map((i) => (k.root + i) % 12);
};
/** Smallest semitone shift (−6..+6) moving pitch class `pc` (fractional ok) onto one of `targets`. */
export const shiftTo = (pc: number, targets: number[]) => {
  let best = 99;
  for (const t of targets) { let d = ((t - pc) % 12 + 18) % 12 - 6; if (Math.abs(d) < Math.abs(best)) best = d; }
  return best;
};
/** Midi note of pitch class `pc` in [lo, lo+12). */
export const midiIn = (pc: number, lo: number) => lo + ((pc - lo) % 12 + 12) % 12;

const PHYSICAL = new Set(["device", "card", "media", "image", "video", "three", "browser", "phone"]);
const ABSTRACT = new Set(["shape", "morph", "particles", "counter", "chart", "path", "cloud", "gradient", "grid"]);

const walkLayers = (layers: Layer[], f: (l: Layer) => void) => {
  for (const l of layers) {
    f(l);
    const any = l as unknown as { layers?: Layer[]; screens?: { layers?: Layer[] }[] };
    if (any.layers) walkLayers(any.layers, f);
    for (const s of any.screens ?? []) if (s.layers) walkLayers(s.layers, f);
  }
};

const ARC_ENERGY: [RegExp, number][] = [
  [/payoff|climax|drop|reveal|lock|logo/i, 0.92], [/transform|turn|shift/i, 0.78], [/hook/i, 0.72], [/cta|call/i, 0.62],
  [/build|rise|tension|problem/i, 0.55], [/breath|calm|pause|intro/i, 0.32],
];

export type BriefOpts = { width?: number; height?: number };

export const deriveBrief = (spec: Spec, slots: { start: number; end: number }[], opts: BriefOpts = {}): Brief => {
  const s = (spec.sound ?? {}) as NonNullable<Spec["sound"]> & Record<string, any>;
  const b = (s.brief ?? {}) as Record<string, any>;
  const text = [spec.style, spec.title, spec.concept?.truth, spec.concept?.metaphor, spec.concept?.verb, spec.concept?.motif].filter(Boolean).join(" ");

  // voice
  let voice: Voice | undefined = b.voice;
  if (!voice && s.palette) voice = PALETTE_VOICE[s.palette as SfxPalette];
  if (!voice) for (const [re, v] of KEYWORDS) if (re.test(text)) { voice = v; break; }
  voice ??= "precise";

  // on-screen objects → realism + materials
  const counts: Record<string, number> = {};
  let physical = 0, abstract = 0;
  for (const sc of spec.scenes) walkLayers(sc.layers, (l) => {
    const t = l.type as string;
    if (PHYSICAL.has(t)) physical++;
    if (ABSTRACT.has(t)) abstract++;
    const add = (m: string, w = 1) => { counts[m] = (counts[m] ?? 0) + w; };
    if (t === "device") { add("metal-thin", 1.5); add("glass", 1.5); }
    if (t === "card") { add("paper"); add("plastic", 0.6); }
    if (t === "three") { add("metal"); add("glass"); }
    if (t === "morph") add("liquid", 0.8);
    if (t === "logo" && (l as any).mode === "liquid") add("liquid", 2);
    if (t === "counter" || t === "chart") add("digital", 0.7);
    if (t === "particles") add("air", 0.5);
  });
  const realism: Realism = b.realism ?? (physical >= Math.max(2, abstract * 0.8) ? "hyper-real" : abstract > physical * 2 + 2 ? "abstract" : "mixed");
  let materials: string[] = b.materials;
  if (!materials?.length) {
    VOICE_MATERIALS[voice].forEach((m, i) => { counts[m] = (counts[m] ?? 0) + (3 - i) * 0.9; });
    materials = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([m]) => m);
  }

  // music
  const music = (s.music ?? {}) as { key?: string; keyConfidence?: number; bpm?: number; onsets?: number[]; beats?: number[] };
  const hasMusic = !!spec.audio;
  const brand = String(spec.title ?? spec.scenes.flatMap((sc) => sc.layers).find((l) => l.type === "logo")?.["src" as keyof Layer] ?? "brand").toLowerCase();
  let key: MusicKey;
  const kb = parseKey(b.key), km = parseKey(music.key);
  if (kb) key = { ...kb, confidence: 1, source: "brief" };
  else if (km && hasMusic) key = { ...km, confidence: music.keyConfidence ?? 0.7, source: "music" };
  else {
    // no music: a stable per-brand tonal centre, so the brand's chimes / subs / signature always agree
    const pool: Record<Voice, [number, boolean][]> = {
      precise: [[9, true], [4, true], [2, false], [7, false]], luxury: [[1, false], [3, false], [8, false]], warm: [[5, false], [7, false], [0, false]],
      playful: [[0, false], [7, false], [5, false], [2, false]], epic: [[2, true], [0, true], [7, true]], raw: [[4, true], [9, true], [6, true]], calm: [[5, false], [10, false], [3, false]],
    };
    const opts2 = pool[voice];
    const [root, minor] = opts2[hashStr(brand) % opts2.length];
    key = { root, minor, confidence: hasMusic ? 0 : 1, source: "brand" };
  }
  const beats = spec.beats?.length ? [...spec.beats] : music.beats?.length ? [...music.beats] : spec.bpm ? (() => {
    const out: number[] = [];
    const end = slots.length ? slots[slots.length - 1].end : 0;
    for (let t = spec.beatOffset ?? 0; t <= end + 1e-6; t += 60 / spec.bpm!) out.push(Math.round(t * 1000) / 1000);
    return out;
  })() : [];

  // energy per scene
  const arc = spec.concept?.arc ?? [];
  const n = spec.scenes.length;
  const energy = spec.scenes.map((sc, i) => {
    let e = n <= 1 ? 0.7 : i === 0 ? 0.68 : i === n - 1 ? 0.88 : 0.5 + 0.2 * (i / (n - 1));
    const word = arc.length === n ? arc[i] : (sc as { id?: string }).id;
    if (word) for (const [re, v] of ARC_ENERGY) if (re.test(word)) { e = v; break; }
    const dur = sc.duration;
    if (dur < 1.5) e += 0.08;
    if (dur > 4) e -= 0.06;
    if (voice === "raw" || voice === "epic") e += 0.05;
    if (voice === "calm" || voice === "luxury") e -= 0.06;
    return Math.max(0.15, Math.min(1, Math.round(e * 100) / 100));
  });

  const w = opts.width ?? 1920, h = opts.height ?? 1080;
  return {
    voice, realism, materials, space: b.space ?? VOICE_SPACE[voice], avoid: (b.avoid ?? []).map((x: string) => x.toLowerCase()),
    key, hasMusic, bpm: music.bpm ?? spec.bpm, beats, onsets: music.onsets ?? [], energy,
    variation: clamp01(s.variation ?? 0.5), restraint: clamp01(s.restraint ?? 0.5), stereo: s.stereo !== false,
    aspect: w / h, width: w, palette: (s.palette as SfxPalette | undefined) ?? VOICE_PALETTE[voice], brand,
  };
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
