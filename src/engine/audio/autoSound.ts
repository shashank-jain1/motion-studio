/**
 * Auto sound design v2 — intent-driven (PURE: no DOM, no React; runs in Node for tests / bakes and in the bundle).
 * docs/research/04-sound-design.md §4–5. Pipeline:
 *
 *   1. EVENTS   walk the spec (transitions, camera, layers, actors) → motion events with a role, priority, lead-in,
 *               screen x / size / direction, scene, and IMPORTANCE (hero > structural > supporting > micro).
 *   2. BRIEF    deriveBrief(): voice, realism, materials, space, key, beats / onsets, energy per scene (brief.ts).
 *   3. RESTRAINT what NOT to sound, before choosing anything: one gesture = one sound (cascades collapse); a
 *               strategic silence + music stopdown before each hero; nothing piled on a hero's aftershock; events the
 *               music already hits are dropped / thinned; a per-scene density budget (energy × restraint) keeps the
 *               heroes and drops micro → supporting first; soft consecutive transitions alternate with silence.
 *   4. GRID     picture is master: a sound moves onto a beat only within −1 / +2 frames of its event (sync tolerance);
 *               on-beat events win the density budget, far-off-beat micro events drop at high restraint.
 *   5. SCORE    each layer slot scores the library (category fit, material vs brief + object, world, weight vs
 *               size × energy × importance, speed vs lead time, brightness vs voice, emotion, palette, recency —
 *               a no-repeat memory across the film) and picks among the top 3 with a seeded RNG.
 *   6. LAYER    recipes by importance: micro = 1 light layer … hero = transient + material body + tuned sub +
 *               tail / air (+ a reverse swell into it, or the brand's sonic signature on the logo).
 *   7. VARY     per-layer deterministic pitch (real varispeed, ±semitones) and gain jitter; bigger objects lower.
 *   8. TUNE     tonal recorded layers are transposed onto chord tones of the key (≤ 3 semitones, else not chosen);
 *               synth layers (sub, ping, shimmer, swell, riser, mnemonic) are generated in the key.
 *   9. SPACE    pan from on-screen x (sweep on lateral moves, subs centred, subtler on 9:16), one shared reverb.
 *  10. MIX      volume hierarchy (one hero; everything else ≥ 4 dB under), duck depth by importance, de-dup
 *               (80 ms apex spacing, one hit per 220 ms, ≤ 3 overlapping bodies).
 * Every cue is a bake recipe (bake.ts): its layers are mixed into ONE file whose apex lands on the event frame.
 */
import type { Layer, Scene, Spec } from "../spec/schema";
import { FORMATS } from "../spec/schema";
import { sceneIndexOf, type SceneSlot } from "../spec/preprocess";
import { progress, type EaseName } from "../core/animate";
import { hashStr, rng } from "./dsp";
import { bakeSrc, RECORDED, SFX, sfxInfo, sfxName, type SfxEntry, type SfxPalette } from "./library";
import { pitchedLength, type BakeLayer, type Recipe } from "./bake";
import { synthMeta, type SynthSpec, type Timbre } from "./synth";
import { deriveBrief, keyName, midiIn, scalePcs, shiftTo, VOICE_BRIGHT, type Brief, type Voice } from "./brief";
import { midiOf } from "./dsp";

export type Importance = "hero" | "structural" | "supporting" | "micro";
export type Cue = {
  /** "bake:<recipe>", "sfx:<name>" or an assets/ path */
  src: string;
  /** global seconds when the FILE starts (offset so its apex lands on the event; may be < 0) */
  at: number;
  /** 0..1 relative mix level (the SFX master volume is applied on top by SoundTrack) */
  volume: number;
  /** playback rate (manual cues only; planned cues bake pitch / length into the file) */
  rate?: number;
  /** global seconds of the apex / transient (= the event) */
  peak: number;
  /** seconds the cue plays */
  dur: number;
  /** 0..1 how much the music ducks under this cue */
  duck: number;
  priority: number;
  role: string;
  reason: string;
  importance?: Importance;
  /** human-readable layer list (cue sheets) */
  layers?: string[];
  pan?: number;
};
/** A music move (not a sound): stopdown / filter-down before a hero, executed by the music volume envelope. */
export type MixEvent = { kind: "stopdown"; from: number; to: number; depth: number; release: number; reason: string };
export type SoundPlan = { cues: Cue[]; mix: MixEvent[]; brief: Brief; dropped: { t: number; role: string; why: string }[] };

export type PlanOpts = {
  fps: number;
  /** total video seconds (cues whose apex falls after the end are dropped) */
  total?: number;
  palette?: SfxPalette;
  /** 0..1, default 0.6 (legacy: scales the density budget) */
  intensity?: number;
  width?: number;
  height?: number;
};

type Role =
  | "move" | "moveLong" | "trans" | "transFast" | "zoom" | "expand" | "riser" | "swell"
  | "impact" | "slam" | "slamSoft" | "punch" | "boom" | "hitSoft" | "flash" | "logoHit"
  | "tick" | "ding" | "pop" | "click" | "notify" | "glitch" | "data" | "shimmer" | "sparkle" | "morph" | "slide" | "type";

const WHOOSH_ROLES = new Set<Role>(["move", "moveLong", "trans", "transFast", "zoom", "slide"]);
const HITS = new Set<string>(["impact", "slam", "punch", "boom", "hitSoft", "flash", "logoHit"]);

/** Volume hierarchy: impacts > whooshes > ticks. */
const ROLE_VOL: Record<Role, number> = {
  impact: 1, logoHit: 1, flash: 0.95, slam: 0.9, boom: 0.9, punch: 0.85, hitSoft: 0.8,
  zoom: 0.72, expand: 0.65, trans: 0.66, transFast: 0.64, riser: 0.6, swell: 0.6, moveLong: 0.56, move: 0.5,
  ding: 0.66, notify: 0.56, glitch: 0.55, slamSoft: 0.62, pop: 0.5, sparkle: 0.5, morph: 0.52, slide: 0.52,
  click: 0.46, shimmer: 0.46, data: 0.42, tick: 0.32, type: 0.3,
};
const IMP_RANK: Record<Importance, number> = { hero: 3, structural: 2, supporting: 1, micro: 0 };
const IMP_DUCK: Record<Importance, number> = { hero: 0.6, structural: 0.42, supporting: 0.2, micro: 0.08 };

// --------------------------------------------------------------------------------------------- events

type Ev = {
  t: number;
  role: Role;
  priority: number;
  reason: string;
  lead?: number;
  align?: "peak" | "start";
  src?: string;
  vol?: number;
  cascade?: string;
  /** screen x (px from centre), relative size 0..1, lateral direction */
  x?: number;
  size?: number;
  dir?: number;
  /** extra material hint from the object (device → metal-thin, card → paper…) */
  mat?: string[];
  scene: number;
  key: string;
  importance?: Importance;
  onBeat?: boolean;
};

const SLAM_TEXT = new Set(["stretch", "zoom-from-camera", "drop-in", "physics", "pop"]);
const TEXT_LAND: Record<string, number> = { stretch: 0.3, "zoom-from-camera": 0.25, "drop-in": 0.47, physics: 0.5, pop: 0.3 };
const WHIP_ENTER = new Set(["whip-left", "whip-right", "whip-up", "whip-down"]);
const DROP_ENTER = new Set(["drop", "drop-bounce", "drop-in-3d", "stretch"]);
const FLY_ENTER = new Set(["fly-in-3d", "spin-in", "swing", "slide-left", "slide-right", "slide-up", "slide-down", "rise", "drop-in-3d", ...WHIP_ENTER]);
const POP_ENTER = new Set(["pop", "grow", "zoom-in"]);
const LOGO_T: Record<string, number> = {
  draw: 1.8, build: 1.2, assemble: 1.4, "morph-from": 1.4, mask: 1.2, cascade: 1.2, glitch: 0.9,
  liquid: 1.7, window: 1.9, split: 1.0, trace: 2.0, pop: 0.8,
};
const enterDir = (t: string) => (/left/.test(t) ? -1 : /right/.test(t) ? 1 : 0);

const defaultBy = (preset: string, text: string): "char" | "word" | "line" => {
  if (["typewriter", "scramble", "wave", "flip", "stretch", "zoom-from-camera", "drop-in", "pop", "cascade-3d", "weight-wave", "physics"].includes(preset))
    return text.length > 60 ? "word" : "char";
  if (["mask-up", "slide-words", "skew-in", "slot"].includes(preset)) return "word";
  if (["split-reveal", "slice", "echo"].includes(preset)) return "line";
  return text.length > 28 ? "word" : "char";
};

class Events {
  evs: Ev[] = [];
  constructor(private spec: Spec, private slots: SceneSlot[], private fps: number) {}
  push(e: Ev) { if (Number.isFinite(e.t)) this.evs.push(e); }

  transitions() {
    this.spec.scenes.forEach((scene, i) => {
      const tr = scene.transition;
      if (i === 0 || !tr || tr.sound === false) return;
      const ts = this.slots[i].start;
      const d = this.slots[i].overlapIn;
      const mid = ts + d / 2;
      const why = `transition ${tr.type} → scene ${scene.id ?? i}`;
      const dir = (tr as { direction?: string }).direction === "left" ? -1 : (tr as { direction?: string }).direction === "right" ? 1 : 0;
      const base = { scene: i, key: `tr${i}`, size: 1, dir };
      if (typeof tr.sound === "string") { this.push({ ...base, t: d > 0 ? mid : ts, role: "trans", priority: 2, reason: why + " (override)", src: tr.sound, lead: d / 2 }); return; }
      const lead = Math.max(0.08, d / 2);
      switch (tr.type) {
        case "none": case "cut": return;
        case "match": this.push({ ...base, t: ts, role: "hitSoft", priority: 0.8, reason: why }); return;
        case "whip": this.push({ ...base, t: mid, role: "transFast", priority: 0.9, reason: why, lead, dir: dir || 1 }); return;
        case "zoom-through": case "zoom-into": case "cross-zoom": case "zoom-blur": case "zoom-in-out": case "dreamy-zoom":
          this.push({ ...base, t: mid, role: "zoom", priority: 0.88, reason: why, lead }); return;
        case "flash": this.push({ ...base, t: mid, role: "flash", priority: 0.9, reason: why }); return;
        case "glitch": this.push({ ...base, t: ts, role: "glitch", priority: 0.85, reason: why, align: "start" }); return;
        case "slice": this.push({ ...base, t: mid, role: "slide", priority: 0.8, reason: why, lead, mat: ["paper", "metal-thin"] }); return;
        case "expand": this.push({ ...base, t: ts + d * 0.8, role: "expand", priority: 0.85, reason: why, lead: d * 0.8 }); return;
        case "film-burn": this.push({ ...base, t: mid, role: "swell", priority: 0.7, reason: why, lead: d / 2 }); return;
        case "flip": case "book-flip": this.push({ ...base, t: mid, role: "slide", priority: 0.7, reason: why, lead, mat: ["paper"] }); return;
        case "ripple": case "crosswarp": this.push({ ...base, t: mid, role: "morph", priority: 0.65, reason: why, lead }); return;
        case "fade": case "dissolve": this.push({ ...base, t: mid, role: "move", priority: 0.3, reason: why, lead }); return;
        default: this.push({ ...base, t: mid, role: "trans", priority: 0.75, reason: why, lead }); return;
      }
    });
  }

  cameras() {
    this.spec.scenes.forEach((scene, i) => {
      const s0 = this.slots[i].start;
      const cam = scene.camera;
      if (!cam) return;
      (cam.punch ?? []).forEach((p, k) => this.push({ t: s0 + p, role: "punch", priority: 0.8, reason: `camera punch @${p}s (scene ${scene.id ?? i})`, scene: i, key: `cp${i}.${k}`, size: 1 }));
      const sh = cam.shake;
      if (sh && (sh.amount ?? 6) >= 4 && (sh.duration ?? scene.duration) <= 1.8) {
        this.push({ t: s0 + (sh.start ?? 0), role: "boom", priority: 0.7, reason: `camera shake (scene ${scene.id ?? i})`, scene: i, key: `cs${i}`, size: 1 });
      }
      const kfs = [...(cam.keyframes ?? [])].sort((a, b) => a.t - b.t);
      for (let k = 1; k < kfs.length; k++) {
        const a = kfs[k - 1], b = kfs[k];
        const dt = b.t - a.t;
        const dz = Math.abs(Math.log((b.zoom ?? a.zoom ?? 1) / (a.zoom ?? 1)));
        const dx = (b.x ?? a.x ?? 0) - (a.x ?? 0);
        const dxy = Math.hypot(dx, (b.y ?? a.y ?? 0) - (a.y ?? 0));
        if (dt > 0.15 && dt <= 1.4 && (dz >= 0.45 || dxy >= 700)) {
          this.push({ t: s0 + b.t - dt * 0.15, role: dt > 0.8 ? "moveLong" : "move", priority: 0.5, reason: `camera move (scene ${scene.id ?? i})`, lead: dt * 0.85, scene: i, key: `cm${i}.${k}`, size: 1, dir: Math.abs(dx) > 300 ? -Math.sign(dx) : 0 });
        }
      }
    });
  }

  layers() {
    this.spec.scenes.forEach((scene, i) => this.walk(scene.layers, this.slots[i].start, this.slots[i].start + scene.duration, `${i}`, scene, i));
  }

  private walk(layers: Layer[], base: number, end: number, key: string, scene: Scene, si: number) {
    layers.forEach((l, j) => this.layer(l, base, end, `${key}.${j}`, scene, si));
  }

  private layer(l: Layer, base: number, parentEnd: number, key: string, scene: Scene, si: number) {
    if (l.sound === false) return;
    const g0 = base + (l.start ?? 0);
    const end = Math.min(parentEnd, l.duration !== undefined ? g0 + l.duration : Infinity);
    if (g0 >= end) return;
    const name = l.id ?? `${l.type}#${key}`;
    const en = l.enter && l.enter.type !== "none" ? l.enter : undefined;
    const enDelay = en?.delay ?? 0, enDur = en?.duration ?? 0.6;
    const landing = g0 + enDelay + enDur * (en?.type === "drop-bounce" ? 0.45 : 0.4);
    const before = this.evs.length;
    const geo = { x: l.x ?? 0, scene: si, key };

    switch (l.type) {
      case "text": this.text(l, g0, name, geo); break;
      case "counter": this.counter(l, g0, name, geo); break;
      case "morph": this.morph(l, g0, name, geo); break;
      case "logo": this.logo(l, g0 + enDelay, name, geo); break;
      case "card": this.card(l, g0, landing, name, !!en, geo); break;
      case "particles": {
        if (l.preset === "confetti") this.push({ ...geo, t: g0, role: "sparkle", priority: 0.5, reason: `confetti ${name}`, align: "start", size: 0.6 });
        else if (l.preset === "burst") this.push({ ...geo, t: g0 + 0.02, role: "pop", priority: 0.5, reason: `particle burst ${name}`, size: 0.5 });
        else if (l.preset === "sparkles" || l.preset === "stars") this.push({ ...geo, t: g0, role: "shimmer", priority: 0.3, reason: `sparkles ${name}`, align: "start", size: 0.4 });
        break;
      }
      case "device": {
        if (l.island?.activity === "faceid-success" || l.island?.activity === "pay") {
          this.push({ ...geo, t: g0 + (l.island.at ?? 0.5) + 0.9, role: "ding", priority: 0.45, reason: `device island ${l.island.activity} ${name}`, size: 0.3, mat: ["glass", "metal-thin"] });
        }
        (l.screens ?? []).forEach((s, k) => {
          const sAt = g0 + (s.at ?? 0);
          if (k > 0 && s.transition && s.transition !== "none") this.push({ ...geo, key: `${key}.s${k}`, t: sAt + 0.2, role: "move", priority: 0.35, reason: `device screen ${k} ${name}`, lead: 0.2, size: 0.4, mat: ["glass"] });
          if (s.layers) this.walk(s.layers, sAt, end, `${key}.s${k}`, scene, si);
        });
        break;
      }
      case "group": this.walk(l.layers, g0, end, key, scene, si); break;
      default: break;
    }
    for (let k = this.evs.length - 1; k >= before; k--) if (this.evs[k].t > end + 0.02) this.evs.splice(k, 1);

    const own = this.evs.length > before && l.type !== "group" && l.type !== "device";
    if (en && !own) {
      const casc = `${key.split(".").slice(0, -1).join(".")}|${en.type}|${l.type}`;
      const size = l.type === "device" ? 0.75 : l.type === "card" ? 0.45 : l.type === "media" ? 0.6 : 0.4;
      const mat = l.type === "device" ? ["metal-thin", "glass"] : l.type === "card" ? ["paper", "plastic"] : (l.type as string) === "three" ? ["metal", "glass"] : undefined;
      const e = { ...geo, size, mat, dir: enterDir(en.type) };
      if (WHIP_ENTER.has(en.type)) this.push({ ...e, t: landing, role: "move", priority: 0.45, reason: `${en.type} enter ${name}`, lead: enDur * 0.4, cascade: casc });
      else if (DROP_ENTER.has(en.type)) this.push({ ...e, t: landing, role: "slamSoft", priority: 0.5, reason: `${en.type} landing ${name}`, cascade: casc });
      else if (l.type === "device" && FLY_ENTER.has(en.type)) this.push({ ...e, t: landing, role: "move", priority: 0.55, reason: `device ${en.type} ${name}`, lead: enDur * 0.4 });
      else if (FLY_ENTER.has(en.type) && en.type !== "rise" && !en.type.startsWith("slide")) this.push({ ...e, t: landing, role: "move", priority: 0.4, reason: `${en.type} enter ${name}`, lead: enDur * 0.4, cascade: casc });
      else if (POP_ENTER.has(en.type) && (l.type === "card" || l.type === "shape" || l.type === "media" || l.type === "cloud")) {
        this.push({ ...e, t: g0 + enDelay + enDur * 0.3, role: "pop", priority: 0.4, reason: `${en.type} enter ${name}`, cascade: casc });
      }
    }

    if (typeof l.sound === "string") {
      const mine = this.evs.splice(before);
      const main = mine.sort((a, b) => b.priority - a.priority)[0];
      this.push({ ...geo, t: main ? main.t : en ? landing : g0, role: main?.role ?? "impact", priority: 2, reason: `layer ${name} sound override`, src: l.sound, lead: main?.lead, align: main?.align });
    }
  }

  private text(l: Extract<Layer, { type: "text" }>, g0: number, name: string, geo: { x: number; scene: number; key: string }) {
    const preset = l.preset ?? "blur-rise";
    const text = l.uppercase ? l.text.toUpperCase() : l.text;
    const by = l.by ?? defaultBy(preset, text);
    const stagger = l.stagger ?? (by === "char" ? (preset === "cascade-3d" ? 0.04 : 0.03) : by === "word" ? 0.07 : 0.15);
    const unitDur = l.unitDuration ?? (preset === "typewriter" ? 0 : 0.7);
    const units = by === "char" ? text.replace(/\s+/g, "").length : by === "word" ? text.split(/\s+/).filter(Boolean).length : text.split("\n").length;
    const spread = Math.max(0, units - 1) * stagger;
    const px = (l.fontSize ?? 120) * (l.scale ?? 1);
    const big = px >= 96;
    const size = Math.min(1, px / 240);
    const heavy = (l.weight ?? 0) >= 750;
    const e = { ...geo, size: heavy ? Math.min(1, size + 0.15) : size };
    if (SLAM_TEXT.has(preset)) {
      const first = g0 + unitDur * (TEXT_LAND[preset] ?? 0.3);
      const cascade = spread > 0.45;
      const role: Role = preset === "pop" ? (big && !cascade ? "slamSoft" : "pop") : big && !cascade ? "slam" : "slamSoft";
      this.push({ ...e, t: first + Math.min(spread, 0.1) * 0.5, role, priority: cascade ? 0.6 : 0.85, reason: `text ${preset} slam ${name}` });
      return;
    }
    if (preset === "typewriter") {
      const step = Math.max(1, Math.ceil(0.09 / Math.max(0.005, stagger)));
      for (let k = 0, n = 0; k < units && n < 16; k += step, n++) this.push({ ...e, key: `${geo.key}.k${n}`, t: g0 + k * stagger, role: "type", priority: 0.35, reason: `typewriter ${name}` });
      return;
    }
    if (preset === "scramble") { this.push({ ...e, t: g0, role: "data", priority: 0.45, reason: `scramble text ${name}`, align: "start" }); return; }
    if (preset === "glitch") { this.push({ ...e, t: g0, role: "glitch", priority: 0.5, reason: `glitch text ${name}`, align: "start" }); return; }
    if (preset === "slot" && l.swap?.words.length) {
      const every = Math.max(0.2, l.swap.every ?? 0.7);
      const rollDur = Math.min(every * 0.8, 12 / this.fps);
      const words = text.split(/\s+/).filter(Boolean).length;
      const enterStart = Math.max(0, words - 1) * stagger;
      const firstRoll = Math.max(enterStart + unitDur + 0.15, every);
      const rolls = Math.min(l.swap.words.length, 12);
      for (let k = 0; k < rolls; k++) this.push({ ...e, key: `${geo.key}.r${k}`, t: g0 + firstRoll + k * every + rollDur, role: "tick", priority: 0.5, reason: `slot word ${k + 1} ${name}` });
      return;
    }
    if (px >= 150 && ["mask-up", "slide-words", "skew-in", "split-reveal", "tracking", "cascade-3d", "echo", "slice"].includes(preset)) {
      this.push({ ...e, t: g0 + unitDur * 0.35 + Math.min(spread, 0.2) * 0.5, role: "move", priority: 0.38, reason: `text ${preset} ${name}`, lead: unitDur * 0.35 });
    }
  }

  private counter(l: Extract<Layer, { type: "counter" }>, g0: number, name: string, geo: { x: number; scene: number; key: string }) {
    const from = l.from ?? 0, to = l.to;
    const cd = l.countDelay ?? 0, cdur = l.countDuration ?? 1.5;
    const q = Math.pow(10, l.decimals ?? 0);
    const shown = (t: number) => Math.round((from + (to - from) * progress(t, cd, cdur, l.ease as EaseName | undefined, "outExpo")) * q);
    const final = Math.round(to * q);
    let reach = cd + cdur;
    const step = 1 / this.fps;
    for (let t = cd; t <= cd + cdur + 1e-9; t += step) if (shown(t) === final) { reach = t; break; }
    let last = -Infinity, prev = shown(cd), n = 0;
    const ticks: number[] = [];
    for (let t = cd + step; t < reach - 0.1 && n < 18; t += step) {
      const v = shown(t);
      if (v !== prev && t - last >= 0.085) { ticks.push(t); last = t; n++; }
      prev = v;
    }
    ticks.forEach((t, k) => this.push({ ...geo, key: `${geo.key}.t${k}`, t: g0 + t, role: "tick", priority: 0.55, reason: `counter tick ${name}`, vol: 0.75 + 0.25 * (k / Math.max(1, ticks.length - 1)), size: 0.2 }));
    if (from !== to) this.push({ ...geo, t: g0 + reach, role: "ding", priority: 0.8, reason: `counter lands on ${to} ${name}`, size: 0.5 });
  }

  private morph(l: Extract<Layer, { type: "morph" }>, g0: number, name: string, geo: { x: number; scene: number; key: string }) {
    let last = -Infinity;
    l.shapes.forEach((s, k) => {
      if (k === 0) {
        if (l.draw) this.push({ ...geo, key: `${geo.key}.d`, t: g0 + Math.max(0, s.at - 0.6), role: "shimmer", priority: 0.4, reason: `morph draw-on ${name}`, align: "start", size: 0.5 });
        return;
      }
      const t = g0 + s.at;
      if (t - last < 0.35) return;
      last = t;
      this.push({ ...geo, key: `${geo.key}.m${k}`, t, role: "morph", priority: 0.6, reason: `morph → ${s.shape.slice(0, 24)} ${name}`, lead: s.morph ?? 0.7, size: 0.6, mat: ["liquid"] });
    });
  }

  private logo(l: Extract<Layer, { type: "logo" }>, rs: number, name: string, geo: { x: number; scene: number; key: string }) {
    const mode = l.mode ?? "build";
    const T = Math.max(0.2, l.revealDuration ?? LOGO_T[mode] ?? 1.2);
    const g = { ...geo, size: 0.8 };
    switch (mode) {
      case "draw": case "trace": this.push({ ...g, key: `${geo.key}.d`, t: rs + T * 0.6, role: "shimmer", priority: 0.55, reason: `logo ${mode} ${name}`, lead: T * 0.6 }); break;
      case "build": case "assemble": case "cascade": case "pop": {
        for (let k = 0; k < 3; k++) {
          const t = T * 0.3 + k * Math.min(0.14, T * 0.15);
          if (t < T * 0.85) this.push({ ...g, key: `${geo.key}.p${k}`, t: rs + t, role: "pop", priority: 0.5 - k * 0.03, reason: `logo ${mode} parts ${name}`, cascade: `logo|${geo.key}`, size: 0.3 });
        }
        break;
      }
      case "glitch": this.push({ ...g, key: `${geo.key}.g`, t: rs, role: "glitch", priority: 0.6, reason: `logo glitch ${name}`, align: "start" }); break;
      case "morph-from": this.push({ ...g, key: `${geo.key}.m`, t: rs + T * 0.8, role: "morph", priority: 0.6, reason: `logo morph-from ${name}`, lead: T * 0.6, mat: ["liquid"] }); break;
      case "liquid": this.push({ ...g, key: `${geo.key}.l`, t: rs + T * 0.85, role: "morph", priority: 0.6, reason: `logo liquid ${name}`, lead: T * 0.5, mat: ["liquid"] }); break;
      default: break; // mask / window / split: the hero's own pre-swell carries the reveal
    }
    this.push({ ...g, t: rs + T, role: "logoHit", priority: 0.95, reason: `logo resolves ${name}` });
  }

  private card(l: Extract<Layer, { type: "card" }>, g0: number, landing: number, name: string, hasEnter: boolean, geo: { x: number; scene: number; key: string }) {
    const at = hasEnter ? landing : g0 + 0.15;
    const v = l.variant;
    const g = { ...geo, size: 0.45, mat: ["paper", "plastic"] };
    if (v === "notification" || v === "notification-dark" || v === "toast") this.push({ ...g, t: at, role: "notify", priority: 0.65, reason: `${v} card ${name}`, mat: ["glass"] });
    else if (v === "chat-left" || v === "chat-right") this.push({ ...g, t: at, role: "pop", priority: 0.55, reason: `chat bubble ${name}`, dir: v === "chat-left" ? -1 : 1 });
    if (l.press !== undefined) this.push({ ...g, key: `${geo.key}.press`, t: g0 + l.press, role: "click", priority: 0.6, reason: `button press ${name}` });
  }

  actors() {
    for (const a of this.spec.actors ?? []) {
      if (a.layer.sound === false) continue;
      let px: number | undefined, py: number | undefined, ps: number | undefined;
      a.poses.forEach((p, k) => {
        const si = sceneIndexOf(this.spec.scenes, p.scene);
        if (si < 0) return;
        const g = this.slots[si].start + (p.t ?? 0);
        const nx = p.x ?? px ?? 0, ny = p.y ?? py ?? 0, ns = p.scale ?? ps ?? 1;
        if (k > 0) {
          const dist = Math.hypot(nx - (px ?? 0), ny - (py ?? 0));
          const ratio = Math.max(ns, ps ?? 1) / Math.max(1e-3, Math.min(ns, ps ?? 1));
          const m = p.move ?? 1.0;
          if (m >= 0.2 && (dist >= 300 || ratio >= 1.8 || (p.snapTo && dist + ratio * 100 >= 260))) {
            this.push({ t: g, role: m > 0.9 ? "moveLong" : "move", priority: 0.6, reason: `actor ${a.id} → pose ${k}${p.snapTo ? ` (snap ${p.snapTo})` : ""}`, lead: m * 0.8, scene: si, key: `a${a.id}.${k}`, x: nx, size: Math.min(1, 0.4 * ns), dir: Math.abs(nx - (px ?? 0)) > 250 ? Math.sign(nx - (px ?? 0)) : 0 });
          }
        }
        if (!p.snapTo) { px = nx; py = ny; ps = ns; } else { px = undefined; py = undefined; ps = undefined; }
      });
    }
  }
}

// --------------------------------------------------------------------------------------------- importance + restraint

const STRUCTURAL = new Set<Role>(["trans", "transFast", "zoom", "expand", "flash", "glitch", "swell", "punch", "slam", "boom", "impact", "moveLong", "slide", "riser"]);
const MICRO = new Set<Role>(["tick", "type"]);

const classify = (evs: Ev[], brief: Brief, total: number, storyPeak?: number) => {
  for (const e of evs) e.importance = MICRO.has(e.role) ? "micro" : STRUCTURAL.has(e.role) ? "structural" : "supporting";
  // heroes: the (last) logo resolve + the single biggest slam / flash, at least 2.5 s apart
  const logos = evs.filter((e) => e.role === "logoHit").sort((a, b) => b.t - a.t);
  const heroes: Ev[] = [];
  if (logos[0]) heroes.push(logos[0]);
  for (const l of logos.slice(1)) l.importance = "structural";
  const big = evs.filter((e) => (e.role === "slam" || e.role === "flash" || e.role === "impact" || e.role === "boom") && e.priority < 2)
    .map((e) => ({ e, s: (e.size ?? 0.5) + e.priority + brief.energy[e.scene] * 0.6 + (e.t / Math.max(1, total)) * 0.2 }))
    .sort((a, b) => b.s - a.s);
  // Story Engine peak (concept.story.peakAt): the film's declared emotional climax is ALWAYS a hero moment —
  // promote the strongest non-micro event within ±0.4 s, or add an impact there so the climax never plays silent.
  if (storyPeak !== undefined && storyPeak > 0 && storyPeak < total && heroes.every((h) => Math.abs(h.t - storyPeak) > 0.6)) {
    const near = evs
      .filter((e) => !MICRO.has(e.role) && Math.abs(e.t - storyPeak) <= 0.4)
      .sort((a, b) => (b.priority + (b.size ?? 0.5)) - (a.priority + (a.size ?? 0.5)) || Math.abs(a.t - storyPeak) - Math.abs(b.t - storyPeak))[0];
    if (near) heroes.push(near);
    else {
      const scene = Math.max(0, evs.filter((e) => e.t <= storyPeak).sort((a, b) => b.t - a.t)[0]?.scene ?? 0);
      const peakEv: Ev = { t: storyPeak, role: "impact", priority: 1.5, reason: "story peak (concept.story.peakAt)", scene, key: `story-peak@${storyPeak}`, size: 0.9, x: 0 };
      evs.push(peakEv);
      heroes.push(peakEv);
    }
    // a big slam that now competes within 2.5 s of the story peak steps down — one climax
    const pk = heroes[heroes.length - 1];
    for (let i = heroes.length - 2; i >= 0; i--) if (heroes[i].role !== "logoHit" && Math.abs(heroes[i].t - pk.t) < 2.5) { heroes[i].importance = "structural"; heroes.splice(i, 1); }
  }
  for (const h of heroes) h.importance = "hero";
  return heroes;
};

// --------------------------------------------------------------------------------------------- library scoring

type Slot = "T" | "B" | "W" | "P" | "L" | "X";
/** Category fit per slot (1 = exact job, lower = acceptable stand-in). */
const SLOT_CATS: Record<Slot, Record<string, number>> = {
  T: { "ui.click": 1, "ui.snap": 1, "mech.click": 0.9, "mech.switch": 0.85, "foley.typing": 0.7, "ui.tap": 0.8, "impact.light": 0.6, "foley.desk": 0.7, "mech.latch": 0.6, "ui.tick": 0.6 },
  B: { "impact.light": 1, "impact.medium": 1, "impact.heavy": 1, "mech.latch": 0.5, "foley.camera": 0.3 },
  W: { "whoosh.micro": 1, "whoosh.paper": 0.95, "whoosh.cloth": 0.95, "whoosh.medium": 1, "whoosh.long": 1, "whoosh.burst": 0.6, "whoosh.in": 0.7, "whoosh.out": 0.7, "foley.paper": 0.6 },
  P: { "ui.ping": 1, "ui.confirm": 1, "magic.chime": 1, "digital.blip": 0.6, "digital.powerup": 0.5 },
  L: { "liquid.drop": 1, "liquid.bubble": 1, "ui.pop": 0.85, "liquid.splash": 0.6 },
  X: {},
};

type Pick = { e: SfxEntry; semis: number };

class Chooser {
  /** file name → use times (s) ; group → use times */
  used = new Map<string, number[]>();
  usedGroup = new Map<string, number[]>();
  lastBySlot = new Map<string, string[]>();
  constructor(private brief: Brief, private seed: number) {}

  note(e: SfxEntry, t: number, slotKey: string) {
    this.used.set(e.name, [...(this.used.get(e.name) ?? []), t]);
    this.usedGroup.set(e.group, [...(this.usedGroup.get(e.group) ?? []), t]);
    this.lastBySlot.set(slotKey, [e.name, ...(this.lastBySlot.get(slotKey) ?? [])].slice(0, 3));
  }

  avoided(e: SfxEntry) {
    const a = this.brief.avoid;
    if (!a.length) return false;
    const hay = [e.name, e.group, e.category, e.category.split(".")[0], ...e.material, ...e.emotions, ...(e.emotions.includes("gamey") ? ["cartoon", "game"] : [])];
    return a.some((x) => hay.includes(x) || (x.length > 3 && e.name.includes(x)));
  }

  /**
   * Score the library for one layer slot of one event and pick among the top 3 (seeded). `cats` overrides the slot's
   * category table (e.g. coins for a revenue counter); `weight` / `speed` targets; `mats` the event's materials.
   */
  pick(slot: Slot, ev: Ev, o: { weight: number; speed?: number; mats: string[]; cats?: Record<string, number>; tonalKind?: "triad" | "penta" | "power"; lead?: number; slotKey: string; exclude?: Set<string> }): Pick | null {
    const b = this.brief;
    const cats = o.cats ?? SLOT_CATS[slot];
    const keyKnown = b.key.confidence >= 0.5;
    const cand: { e: SfxEntry; s: number; semis: number }[] = [];
    const recent = this.lastBySlot.get(o.slotKey) ?? [];
    for (const e of RECORDED) {
      const cf = cats[e.category];
      if (!cf) continue;
      if (o.exclude?.has(e.name) || this.avoided(e)) continue;
      if (recent.includes(e.name)) continue; // hard ban: never one of the last 3 picks for this slot
      const uses = this.used.get(e.name) ?? [];
      if (uses.some((u) => Math.abs(u - ev.t) < 1.5)) continue;
      // tuning: tonal items must reach a chord tone within ±3 semitones
      let semis = 0, tonalRisk = 0;
      if (e.tonal && e.pitchHz) {
        if (keyKnown) {
          const pc = ((midiOf(e.pitchHz) % 12) + 12) % 12;
          semis = shiftTo(pc, scalePcs(b.key, o.tonalKind ?? "triad"));
          if (Math.abs(semis) > 3) continue;
        } else if (b.hasMusic) tonalRisk = 1;
      }
      const matSet = new Set(o.mats);
      const matHit = e.material.length ? Math.max(...e.material.map((m) => (matSet.has(m) ? 1 : b.materials.includes(m) ? (b.materials.indexOf(m) === 0 ? 0.9 : 0.6) : 0))) : 0.3;
      const world = b.realism === "hyper-real" ? (e.world === "hyper-real" ? 1 : 0.25) : b.realism === "abstract" ? (e.world === "abstract" ? 1 : 0.55) : 0.8;
      const wFit = 1 - Math.min(1, Math.abs(e.weight - o.weight) * 1.4);
      const sFit = o.speed === undefined ? 0.5 : 1 - Math.abs(e.speed - o.speed);
      const leadFit = o.lead ? 1 - Math.min(1, Math.abs(Math.log(Math.max(0.03, e.peakAt) / Math.max(0.05, o.lead)))) : 0.5;
      const bright = 1 - Math.abs(e.brightness - VOICE_BRIGHT[b.voice]);
      const pal = e.palettes.length ? (e.palettes.includes(b.palette) ? 1 : 0) : 0.5;
      const gamey = e.emotions.includes("gamey") && (b.voice === "luxury" || b.voice === "calm" || b.voice === "epic" || b.voice === "warm") ? 3 : 0;
      const rec = uses.reduce((s, u) => s + Math.exp(-Math.abs(ev.t - u) / 4), 0) + 0.5 * (this.usedGroup.get(e.group) ?? []).reduce((s, u) => s + Math.exp(-Math.abs(ev.t - u) / 3), 0);
      const s = 3 * cf + 2 * matHit + 1.5 * world + 1.5 * wFit + 1 * sFit + 1 * leadFit + 0.5 * bright + 0.6 * pal - 2.5 * rec - tonalRisk - gamey;
      cand.push({ e, s, semis });
    }
    if (!cand.length) return null;
    cand.sort((x, y) => y.s - x.s || (x.e.name < y.e.name ? -1 : 1));
    const top = cand.slice(0, 3);
    const r = rng(hashStr(`${o.slotKey}|${ev.key}|${ev.t.toFixed(3)}`, this.seed))();
    const ws = top.map((c, i) => Math.max(0.05, c.s - top[top.length - 1].s + 0.5) * (i === 0 ? 1.5 : 1));
    let acc = r * ws.reduce((a, c) => a + c, 0);
    let chosen = top[0];
    for (let i = 0; i < top.length; i++) { acc -= ws[i]; if (acc <= 0) { chosen = top[i]; break; } }
    this.note(chosen.e, ev.t, o.slotKey);
    return { e: chosen.e, semis: chosen.semis };
  }
}

// --------------------------------------------------------------------------------------------- recipes

type LayerPlan = BakeLayer & { apex: number; len: number; label: string; lead?: boolean };

const TIMBRE: Record<Voice, Timbre> = { precise: "glass", luxury: "glass", warm: "marimba", playful: "marimba", epic: "bell", raw: "metal", calm: "soft" };
/** Mnemonic shapes (scale-degree semitones over the root) — one is chosen per brand, forever. */
const MNEMONICS = [[0, 7, 12], [0, 4, 7, 12], [7, 4, 12], [0, 7, 16], [12, 7, 9, 12], [0, 12, 7]];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

class Designer {
  constructor(private brief: Brief, private ch: Chooser, private fps: number, private seed: number) {}

  private jit(ev: Ev, tag: string, range: number) {
    if (!range) return 0;
    const r = rng(hashStr(`${tag}|${ev.key}|${ev.t.toFixed(3)}`, this.seed));
    return (r() * 2 - 1) * range * (this.brief.variation / 0.5);
  }

  /** A recorded layer, varispeed-pitched (size + jitter + key), with its apex / length after pitching. */
  private rec(p: Pick, ev: Ev, g: number, opts: { jitter: number; sizePitch?: boolean; w?: number; x?: number; hp?: number; lp?: number; tag: string }): LayerPlan {
    let semis = p.semis;
    if (!p.e.tonal || !p.semis) {
      if (opts.sizePitch && ev.size !== undefined) semis += Math.max(-3, Math.min(2.5, -2.5 * Math.log2(Math.max(0.15, ev.size) / 0.5)));
      semis += this.jit(ev, opts.tag, opts.jitter);
      semis = Math.max(-3.5, Math.min(3.5, semis));
    }
    const len = Math.min(opts.x ?? Infinity, pitchedLength(p.e.durationSec, semis));
    const gj = this.jit(ev, opts.tag + "g", ev.importance === "micro" ? 1.5 : 1);
    return { f: p.e.name, o: 0, g: r3(g + gj), ...(Math.abs(semis) > 0.02 ? { p: r3(semis) } : {}), w: opts.w, x: opts.x, hp: opts.hp, lp: opts.lp, apex: pitchedLength(p.e.peakAt, semis), len, label: `${opts.tag}:${p.e.name}${Math.abs(semis) > 0.02 ? `@${semis > 0 ? "+" : ""}${semis.toFixed(1)}` : ""}` };
  }

  private syn(s: SynthSpec, g: number, tag: string, extra: Partial<BakeLayer> = {}): LayerPlan {
    const m = synthMeta(s);
    return { s, o: 0, g, ...extra, apex: m.peakAt, len: m.dur, label: `${tag}:${s.k}${"m" in s ? `(${noteName(s.m)})` : "notes" in s ? `(${s.notes.map(noteName).join(" ")})` : ""}` };
  }

  private lastSub = -Infinity;
  /** hero apex times: no structural sub in the 3 s before a hero (the hero's sub must be the biggest low end) */
  heroTimes: number[] = [];
  private subOk(ev: Ev, energy: number) {
    return energy >= 0.6 && ev.t - this.lastSub >= 2.5 && !["calm", "luxury", "warm"].includes(this.brief.voice) && !this.heroTimes.some((h) => h > ev.t + 0.05 && h - ev.t < 3);
  }

  private sub(ev: Ev, g: number, dur: number, boom = false): LayerPlan {
    this.lastSub = Math.max(this.lastSub, ev.t);
    const k = this.brief.key;
    const fifth = this.jit(ev, "subroot", 1) > 0.55 && !boom;
    const pc = fifth ? (k.root + 7) % 12 : k.root;
    const m = midiIn(pc, 31); // G1..F#2 — felt, and its saturated harmonics survive phones
    const seed = hashStr(`${ev.key}|sub`, this.seed);
    return boom ? this.syn({ k: "boom", m, d: dur, seed }, g, "S", { c: 1 }) : this.syn({ k: "sub", m, d: dur, drop: 5 + Math.round(this.jit(ev, "drop", 2) + 2), seed }, g, "S", { c: 1 });
  }

  private air(ev: Ev, lead: number, post: number, g: number, bright: number, dir = 0): LayerPlan {
    const pre = Math.max(0.06, Math.min(1.8, lead));
    return this.syn({ k: "air", pre: r3(pre), post: r3(Math.max(0.1, post)), b: r3(Math.max(0, Math.min(1, bright + this.jit(ev, "airb", 0.08)))), s: r3(ev.size ?? 0.5), dir, seed: hashStr(`${ev.key}|air`, this.seed) }, g, "A", { w: 0.3 });
  }

  private triad(octLo: number, kind: "triad" | "penta" = "triad") {
    return scalePcs(this.brief.key, kind).map((pc) => midiIn(pc, octLo));
  }

  /** Layer stack for one event (empty = silence). */
  design(ev: Ev, signature: unknown): LayerPlan[] {
    const b = this.brief;
    const imp = ev.importance ?? "supporting";
    const energy = b.energy[ev.scene] ?? 0.6;
    const mats = [...(ev.mat ?? []), ...b.materials];
    const tw = Math.max(0, Math.min(1, { hero: 0.85, structural: 0.6, supporting: 0.35, micro: 0.15 }[imp] + ((ev.size ?? 0.5) - 0.5) * 0.4 + (energy - 0.6) * 0.3));
    const slotKey = (s: string) => `${s}|${ev.role}`;
    const L: LayerPlan[] = [];
    const add = (l: LayerPlan | null | undefined) => { if (l) L.push(l); };
    const pick = (slot: Slot, weight: number, extra: Partial<Parameters<Chooser["pick"]>[2]> = {}) => this.ch.pick(slot, ev, { weight, mats, slotKey: slotKey(slot), ...extra });
    const bright = VOICE_BRIGHT[b.voice];

    switch (ev.role) {
      // ------------------------------------------------ hits
      case "impact": case "slam": case "punch": case "hitSoft": case "slamSoft": case "flash": case "boom": case "logoHit": {
        if (ev.role === "logoHit" && imp === "hero" && signature !== false) return this.logo(ev, signature, tw, mats);
        if (ev.role === "boom") {
          add(this.sub(ev, imp === "hero" ? -1 : -3, 2.2, true));
          const p = pick("B", 0.85);
          if (p) add(this.rec(p, ev, -4, { jitter: 0.4, sizePitch: true, w: 0.45, tag: "B" }));
          if (imp === "hero") {
            const t = pick("T", 0.2, { speed: 0.9 });
            if (t) add(this.rec(t, ev, -6, { jitter: 0.6, w: 0.12, tag: "T", hp: 900 }));
            add(this.preSwell(ev));
          }
          break;
        }
        const body = pick("B", tw, { speed: ev.role === "punch" || ev.role === "slam" ? 0.6 : undefined });
        if (imp === "micro") { if (body) add(this.rec(body, ev, 0, { jitter: 0.5, sizePitch: true, w: 0.2, tag: "B" })); break; }
        if (body) add(this.rec(body, ev, 0, { jitter: 0.35, sizePitch: true, w: imp === "hero" ? 0.5 : 0.3, tag: "B" }));
        const tr = pick("T", 0.15, { speed: 0.9 });
        if (tr) add(this.rec(tr, ev, imp === "supporting" ? -4 : -3, { jitter: 0.6, w: 0.12, tag: "T", hp: 900 }));
        // sub weight is precious: always on heroes; on structural hits only when the scene is hot, the voice is not
        // calm / luxury / warm, and no other sub played in the last 2.5 s
        if (imp === "hero" || (imp === "structural" && this.subOk(ev, energy) && (ev.role === "slam" || ev.role === "flash" || ev.role === "impact" || energy >= 0.8))) add(this.sub(ev, imp === "hero" ? -5 : -8, imp === "hero" ? 1.6 : 0.9));
        if (ev.role === "flash") add(this.air(ev, 0.06, 0.5, -6, Math.min(1, bright + 0.3), 0));
        if (imp === "hero") {
          add(this.syn({ k: "shimmer", d: 1.6, notes: this.triad(84, "penta"), seed: hashStr(`${ev.key}|tail`, this.seed) }, b.voice === "raw" ? -18 : -13, "Tl", { w: 0.6 }));
          add(this.preSwell(ev));
        }
        break;
      }
      // ------------------------------------------------ whooshes (fitted to the move; material body on structural moves)
      case "move": case "moveLong": case "trans": case "transFast": case "zoom": case "slide": {
        const lead = Math.max(0.06, ev.lead ?? 0.3);
        const post = Math.min(0.6, 0.18 + (ev.size ?? 0.5) * 0.35 + (ev.role === "moveLong" ? 0.2 : 0));
        const fast = ev.role === "transFast" || lead < 0.22;
        const dir = ev.role === "zoom" ? 1 : 0;
        const wb = bright + (fast ? 0.15 : 0) - (ev.role === "moveLong" ? 0.15 : 0);
        if (imp === "supporting" || imp === "micro") {
          // light: ONE layer — a recorded swish when it fits the lead, else fitted air
          const w = fast || ev.role === "slide" ? pick("W", 0.25, { lead, speed: 0.8 }) : null;
          if (w) add(this.rec(w, ev, 0, { jitter: 1, w: 0.25, tag: "W" }));
          else add(this.air(ev, lead, post, 0, wb, dir));
          break;
        }
        add(this.air(ev, lead, post, -1, wb, dir));
        const w = pick("W", tw * 0.6, { lead, speed: fast ? 0.85 : 0.5, cats: ev.role === "slide" ? { "whoosh.paper": 1, "foley.paper": 0.9, "whoosh.micro": 0.8 } : undefined });
        if (w) add(this.rec(w, ev, -4, { jitter: 1, w: 0.25, tag: "W" }));
        if (ev.role === "zoom" && this.subOk(ev, energy)) add(this.sub(ev, -9, 0.8));
        if (imp === "hero") add(this.preSwell(ev));
        break;
      }
      case "expand": case "swell": {
        const d = Math.max(0.3, Math.min(1.6, ev.lead ?? 0.8));
        add(this.syn({ k: "swell", m: midiIn(b.key.root, 57), d: r3(d), chord: b.key.minor ? [0, 3, 7, 12] : [0, 4, 7, 12], seed: hashStr(`${ev.key}|sw`, this.seed) }, 0, "R", { w: 0.3 }));
        if (imp !== "supporting") { const p = pick("B", 0.4); if (p) add(this.rec(p, ev, -6, { jitter: 0.3, w: 0.35, tag: "B" })); }
        break;
      }
      case "riser": {
        const d = Math.max(0.6, Math.min(2.4, ev.lead ?? 1));
        add(this.syn({ k: "riser", m: midiIn(b.key.root, 48), d: r3(d), tonal: b.key.confidence >= 0.5 ? 0.7 : 0, seed: hashStr(`${ev.key}|ri`, this.seed) }, 0, "R", { w: 0.3 }));
        break;
      }
      // ------------------------------------------------ UI / data
      case "tick": {
        const coins = /\$|€|£|revenue|sales|price|save/i.test(ev.reason);
        const p = pick("T", 0.1, { speed: 0.95, cats: coins ? { "foley.coins": 0.9, "ui.tick": 1 } : { "ui.tick": 1, "ui.click": 0.8, "foley.typing": 0.6, "mech.click": 0.7, "impact.light": 0.4 } });
        if (p) add(this.rec(p, ev, 0, { jitter: 0.9, w: 0.08, tag: "T", x: 0.25, hp: 500 }));
        break;
      }
      case "type": {
        const p = pick("T", 0.15, { cats: { "foley.typing": 1, "mech.click": 0.6 } });
        if (p) add(this.rec(p, ev, 0, { jitter: 0.8, w: 0.1, tag: "T", x: 0.22 }));
        break;
      }
      case "click": {
        const p = pick("T", 0.2, { cats: { "ui.click": 1, "mech.switch": 0.95, "ui.tap": 0.8, "mech.click": 0.8 } });
        if (p) add(this.rec(p, ev, 0, { jitter: 0.6, w: 0.1, tag: "T", x: 0.5 }));
        break;
      }
      case "pop": {
        const liquid = mats.includes("liquid") || b.voice === "playful";
        const p = pick(liquid ? "L" : "T", 0.25, { cats: liquid ? undefined : { "ui.pop": 1, "ui.tap": 0.9, "impact.light": 0.8, "ui.snap": 0.8, "mech.latch": 0.6 } });
        if (p) add(this.rec(p, ev, 0, { jitter: 0.8, sizePitch: true, w: 0.2, tag: liquid ? "L" : "T", x: 0.6 }));
        break;
      }
      case "ding": case "notify": {
        // tonal: synth ping in key (or a recorded chime transposed onto the triad), soft transient under it
        const useRec = this.jit(ev, "pingsrc", 1) > 0.2 && b.realism !== "abstract";
        const p = useRec ? pick("P", 0.3, { tonalKind: "triad" }) : null;
        if (p) add(this.rec(p, ev, 0, { jitter: 0, w: 0.35, tag: "P", x: 1.4 }));
        else {
          const tri = this.triad(76);
          const notes = ev.role === "notify" ? [tri[0], tri[2]] : [tri[1], tri[2] + (tri[2] < tri[1] ? 12 : 0)];
          add(this.syn({ k: "ping", notes, gap: ev.role === "notify" ? 0.085 : 0.07, t: TIMBRE[b.voice], d: 1.2, seed: hashStr(`${ev.key}|p`, this.seed) }, 0, "P", { w: 0.35 }));
        }
        if (imp !== "micro") { const t = pick("T", 0.15, { cats: { "ui.tap": 1, "ui.click": 0.8, "impact.light": 0.6 } }); if (t) add(this.rec(t, ev, -9, { jitter: 0.5, w: 0.1, tag: "T", x: 0.3 })); }
        break;
      }
      case "glitch": {
        const p = pick("T", 0.2, { cats: { "digital.glitch": 1, "digital.zap": 0.6 } });
        if (p) add(this.rec(p, ev, 0, { jitter: 1.2, w: 0.05, tag: "G" }));
        add(this.syn({ k: "blip", notes: this.triad(84, "penta").concat(this.triad(96, "penta")).slice(0, 6), gap: 0.028, seed: hashStr(`${ev.key}|gl`, this.seed) }, -6, "G", { w: 0.05 }));
        break;
      }
      case "data": {
        const pent = this.triad(84, "penta");
        const r = rng(hashStr(`${ev.key}|data`, this.seed));
        const notes = Array.from({ length: 8 }, () => pent[Math.floor(r() * pent.length)] + (r() < 0.3 ? 12 : 0));
        add(this.syn({ k: "blip", notes, gap: 0.04, seed: hashStr(`${ev.key}|d`, this.seed) }, 0, "D", { w: 0.15 }));
        break;
      }
      case "shimmer": case "sparkle": {
        add(this.syn({ k: "shimmer", d: ev.role === "sparkle" ? 1.0 : 1.4, notes: this.triad(84, "penta"), seed: hashStr(`${ev.key}|sh`, this.seed) }, 0, "Sh", { w: 0.4 }));
        if (ev.role === "sparkle") { const p = pick("P", 0.1, { cats: { "ui.ping": 1, "impact.light": 0.5 }, mats: ["glass", ...mats], tonalKind: "penta" }); if (p) add(this.rec(p, ev, -8, { jitter: 0, w: 0.3, tag: "P" })); }
        break;
      }
      case "morph": {
        const p = pick("L", 0.35, { cats: { "liquid.drop": 1, "liquid.bubble": 0.8, "ui.pop": 0.5 } });
        if (p) add(this.rec(p, ev, 0, { jitter: 0.8, sizePitch: true, w: 0.25, tag: "L" }));
        if (imp !== "micro") add(this.air(ev, Math.max(0.1, (ev.lead ?? 0.5) * 0.6), 0.25, -8, Math.max(0, bright - 0.1), 0));
        break;
      }
    }
    return L;
  }

  /** Reverse swell in key that ends one frame before the hero (the "suck" into the hit). */
  private preSwell(ev: Ev): LayerPlan {
    const d = 0.35 + 0.45 * this.brief.restraint;
    const k = this.brief.key;
    const l = this.syn({ k: "swell", m: midiIn(k.root, 57), d: r3(d), chord: k.minor ? [0, 3, 7, 12] : [0, 4, 7, 12], seed: hashStr(`${ev.key}|pre`, this.seed) }, -7, "R", { w: 0.2 });
    // its apex sits 1 frame BEFORE the hit apex
    return { ...l, apex: l.apex + 1 / this.fps, lead: true };
  }

  /** The brand's sonic signature on the logo lock: mnemonic in key + brand-material body + tuned sub + air. */
  private logo(ev: Ev, signature: unknown, tw: number, mats: string[]): LayerPlan[] {
    const b = this.brief;
    const L: LayerPlan[] = [];
    if (typeof signature === "string" && signature !== "auto") {
      const info = sfxInfo(signature);
      if (info) { L.push({ f: info.name, o: 0, g: 0, apex: info.peakAt, len: info.durationSec, label: `SIG:${info.name}`, w: 0.3 }); L.push(this.sub(ev, -7, 1.4)); L.push(this.preSwell(ev)); return L; }
    }
    const shape = MNEMONICS[hashStr(b.brand) % MNEMONICS.length];
    const root = midiIn(b.key.root, 72);
    const third = b.key.minor ? 3 : 4;
    const notes = shape.map((iv) => root + (iv === 4 ? third : iv === 16 ? 12 + third : iv === 9 ? (b.key.minor ? 8 : 9) : iv));
    L.push(this.syn({ k: "ping", notes, gap: b.voice === "raw" || b.voice === "playful" ? 0.09 : 0.13, t: TIMBRE[b.voice], d: 2.2, seed: hashStr(`${b.brand}|mnemonic`) }, -2, "SIG", { w: 0.45 }));
    const body = this.ch.pick("B", ev, { weight: Math.max(0.55, tw), mats, slotKey: "B|logo" });
    if (body) L.push(this.rec(body, ev, -1, { jitter: 0.2, sizePitch: false, w: 0.5, tag: "B" }));
    L.push(this.sub(ev, -6, 1.8));
    L.push(this.syn({ k: "air", pre: 0.05, post: 0.8, b: VOICE_BRIGHT[b.voice] + 0.25, s: 0.9, seed: hashStr(`${ev.key}|lair`, this.seed) }, -14, "A", { w: 0.5 }));
    L.push(this.preSwell(ev));
    return L;
  }
}

const NN = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteName = (m: number) => `${NN[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/** Assemble layer plans into one recipe whose apex lands on the event (returns cue + recipe). */
const assemble = (L: LayerPlan[], ev: Ev, brief: Brief, apexT: number): { recipe: Recipe; at: number; dur: number; pan: number } | null => {
  if (!L.length) return null;
  const A = Math.max(...L.map((l) => l.apex));
  let d = 0;
  const layers: BakeLayer[] = L.map((l) => {
    const o = A - l.apex;
    d = Math.max(d, o + l.len);
    const { apex: _a, len: _l, label: _b, lead: _c, ...rest } = l;
    return { ...rest, o: r3(o) };
  });
  d = Math.min(8, d + 0.02);
  let pan = 0, sw = 0;
  if (brief.stereo) {
    const lim = brief.aspect < 1 ? 0.3 : 0.6;
    pan = Math.max(-lim, Math.min(lim, ((ev.x ?? 0) / (brief.width / 2)) * 0.6));
    if (ev.dir && WHOOSH_ROLES.has(ev.role)) sw = 0.35 * ev.dir * (brief.aspect < 1 ? 0.5 : 1);
  }
  const recipe: Recipe = { v: 1, d: r3(d), l: layers, ...(pan ? { pan: r3(pan) } : {}), ...(sw ? { sw: r3(sw), ap: r3(A) } : {}), sp: brief.space, wd: r3(0.6 + 0.4 * (ev.size ?? 0.5)) };
  return { recipe, at: apexT - A, dur: d, pan };
};

// --------------------------------------------------------------------------------------------- main

const DEFAULT_ASSET = { durationSec: 1, peakAt: 0 };

/** Plan the film's sound (see file header). Manual `spec.sfx` is not included, but planned cues avoid it. */
export const planSoundV2 = (spec: Spec, timeline: { scenes: SceneSlot[] }, opts: PlanOpts): SoundPlan => {
  const fps = opts.fps;
  const total = opts.total ?? (timeline.scenes.length ? timeline.scenes[timeline.scenes.length - 1].end : Infinity);
  const dims = spec.width && spec.height ? [spec.width, spec.height] : FORMATS[(spec.format ?? "16:9") as keyof typeof FORMATS] ?? [1920, 1080];
  const brief = deriveBrief(spec, timeline.scenes, { width: opts.width ?? dims[0], height: opts.height ?? dims[1] });
  if (opts.palette) brief.palette = opts.palette;
  const intensity = Math.max(0, Math.min(1, opts.intensity ?? spec.sound?.intensity ?? 0.6));
  const seed = hashStr(`${spec.title ?? ""}|${brief.brand}|v2`);
  const dropped: SoundPlan["dropped"] = [];
  const drop = (e: Ev, why: string) => dropped.push({ t: Math.round(e.t * 1000) / 1000, role: e.role, why: `${why} — ${e.reason}` });

  const ex = new Events(spec, timeline.scenes, fps);
  ex.transitions(); ex.cameras(); ex.layers(); ex.actors();

  // one gesture, one sound: collapse entrance cascades
  let evs: Ev[] = [];
  const lastByCascade = new Map<string, number>();
  for (const e of [...ex.evs].sort((a, b) => a.t - b.t)) {
    if (e.cascade) {
      const prev = lastByCascade.get(e.cascade);
      lastByCascade.set(e.cascade, e.t);
      if (prev !== undefined && e.t - prev <= 0.18) { drop(e, "cascade (one gesture, one sound)"); continue; }
    }
    evs.push(e);
  }
  evs = evs.filter((e) => e.t <= total + 0.05);

  const storyPeak = (spec as { concept?: { story?: { peakAt?: unknown } } }).concept?.story?.peakAt;
  const heroes = classify(evs, brief, total, typeof storyPeak === "number" ? storyPeak : undefined);
  const R = brief.restraint;
  const mix: MixEvent[] = [];

  // grid: picture is master — a sound may slide onto a beat only within −1 / +2 frames of its event
  if (brief.beats.length) {
    for (const e of evs) {
      let best = Infinity;
      for (const bt of brief.beats) if (Math.abs(bt - e.t) < Math.abs(best)) best = bt - e.t;
      if (best >= -1 / fps - 1e-6 && best <= 2 / fps + 1e-6) { e.t += best; e.onBeat = true; }
      else if (e.role === "tick") {
        // counter ticks: quantize to the 1/8 grid when close
        const half = brief.beats.flatMap((bt, i) => (i + 1 < brief.beats.length ? [bt, (bt + brief.beats[i + 1]) / 2] : [bt]));
        let h = Infinity;
        for (const bt of half) if (Math.abs(bt - e.t) < Math.abs(h)) h = bt - e.t;
        if (Math.abs(h) <= 0.04) { e.t += h; e.onBeat = true; }
      }
    }
  }

  // RESTRAINT 1: strategic silence before each hero (+ a music stopdown), and its aftershock
  const keep: Ev[] = [];
  for (const e of evs) {
    if (e.priority >= 2 || e.importance === "hero") { keep.push(e); continue; }
    const at = e.align === "start" ? e.t + 0.35 : e.t; // start-aligned sounds peak ~0.35 s after they start
    const pre = heroes.find((h) => at < h.t - 0.02 && at >= h.t - (0.35 + 0.5 * R) - (e.align === "start" ? 0.35 : 0));
    if (pre) { drop(e, `silence before hero @${pre.t.toFixed(2)}s`); continue; }
    const after = heroes.find((h) => at > h.t + 0.02 && at < h.t + 0.3 + 0.5 * R);
    if (after && e.importance !== "structural") { drop(e, `aftershock of hero @${after.t.toFixed(2)}s`); continue; }
    keep.push(e);
  }
  for (const h of heroes) mix.push({ kind: "stopdown", from: r3(h.t - (0.35 + 0.5 * R)), to: r3(h.t - 0.01), depth: r3(0.55 + 0.35 * R), release: 0.18, reason: `stopdown before hero (${h.reason})` });

  // RESTRAINT 2: let the music hit it — events on a strong music onset are thinned
  let evs2 = keep;
  if (brief.hasMusic && brief.onsets.length) {
    evs2 = keep.filter((e) => {
      if (e.importance === "hero" || e.importance === "structural" || e.priority >= 2) return true;
      const on = brief.onsets.some((o) => Math.abs(o - e.t) <= 0.06);
      if (on && R >= 0.35) { drop(e, "the music already hits here"); return false; }
      return true;
    });
  }

  // RESTRAINT 3: alternate soft consecutive transitions with silence
  {
    let prevSoft = false;
    evs2 = evs2.filter((e) => {
      if (!e.reason.startsWith("transition")) return true;
      const soft = e.priority <= 0.4;
      if (soft && prevSoft && R >= 0.5) { prevSoft = false; drop(e, "soft transition after a soft transition: silence"); return false; }
      prevSoft = soft;
      return true;
    });
  }

  // RESTRAINT 4: density budget per scene (heroes always; micro first, then supporting)
  const density = (0.95 - 0.6 * R) * (0.6 + 0.8 * intensity);
  const byScene = new Map<number, Ev[]>();
  for (const e of evs2) byScene.set(e.scene, [...(byScene.get(e.scene) ?? []), e]);
  const kept: Ev[] = [];
  for (const [si, list] of byScene) {
    const sc = spec.scenes[si];
    const en = brief.energy[si] ?? 0.6;
    // ticks of one counter / one typewriter count as ONE gesture for the budget
    const gestures = new Map<string, Ev[]>();
    for (const e of list) { const g = e.role === "tick" || e.role === "type" ? e.key.replace(/\.[tkr]\d+$/, "") + e.role : e.key + e.role + e.t; gestures.set(g, [...(gestures.get(g) ?? []), e]); }
    const budget = Math.max(1, Math.round(sc.duration * (0.6 + 1.6 * en) * density));
    const ranked = [...gestures.values()].map((g) => ({ g, s: IMP_RANK[g[0].importance ?? "supporting"] * 10 + Math.max(...g.map((e) => e.priority)) + (g.some((e) => e.onBeat) ? 0.15 : 0) + (g[0].priority >= 2 ? 100 : 0) }))
      .sort((a, b) => b.s - a.s);
    ranked.forEach((r, i) => {
      if (i < budget || r.g[0].importance === "hero" || r.g[0].priority >= 2) kept.push(...r.g);
      else r.g.forEach((e) => drop(e, `density budget (scene ${sc.id ?? si}: ${budget} gestures)`));
    });
  }
  // micro events far off the beat drop at high restraint
  let final = kept.sort((a, b) => a.t - b.t);
  if (brief.beats.length && R >= 0.6) final = final.filter((e) => { if (e.importance === "micro" && !e.onBeat) { drop(e, "off-beat micro (high restraint)"); return false; } return true; });

  // SELECT + LAYER + TUNE + SPACE
  const chooser = new Chooser(brief, seed);
  const designer = new Designer(brief, chooser, fps, seed);
  designer.heroTimes = heroes.map((h) => h.t);
  const signature = spec.sound?.signature ?? "auto";
  const cands: Cue[] = [];
  for (const e of final) {
    const imp = e.importance ?? "supporting";
    const volBase = ROLE_VOL[e.role] * (e.vol ?? 1);
    const vol = imp === "hero" ? 1 : Math.min(0.62, volBase * (0.75 + 0.3 * (brief.energy[e.scene] ?? 0.6)) * (imp === "micro" ? 0.8 : 1));
    if (e.src) {
      // explicit override: play it as-is (whole sound), apex on the event
      const isLib = sfxName(e.src) !== null;
      const info = isLib ? sfxInfo(e.src) : DEFAULT_ASSET;
      if (!info) continue;
      const peak = e.align === "start" ? e.t + info.peakAt : e.t;
      cands.push({ src: e.src, at: r4(peak - info.peakAt), volume: r4(Math.min(1, volBase)), peak: r4(peak), dur: r4(info.durationSec), duck: IMP_DUCK[imp], priority: e.priority, role: e.role, reason: e.reason, importance: imp, layers: [`override:${e.src}`] });
      continue;
    }
    const L = designer.design(e, signature);
    if (!L.length) { drop(e, "no suitable sound"); continue; }
    const A = Math.max(...L.map((l) => l.apex));
    const apexT = e.align === "start" ? e.t + A : e.t;
    const asm = assemble(L, e, brief, apexT);
    if (!asm) continue;
    if (asm.at + asm.dur <= 0 || apexT > total + 0.05) continue;
    cands.push({
      src: bakeSrc(asm.recipe), at: r4(asm.at), volume: r4(vol), peak: r4(apexT), dur: r4(asm.dur),
      duck: IMP_DUCK[imp] * (HITS.has(e.role) ? 1 : 0.7), priority: e.priority + IMP_RANK[imp] * 0.01, role: e.role, reason: e.reason, importance: imp,
      layers: L.map((l) => l.label), ...(asm.pan ? { pan: r4(asm.pan) } : {}),
    });
  }

  // manual sfx occupy their slots
  const fixed = (spec.sfx ?? []).map((s) => {
    const info = sfxInfo(s.src) ?? DEFAULT_ASSET;
    const k = s.rate ?? 1;
    return { peak: s.at + info.peakAt / k, start: s.at, end: s.at + Math.min(info.durationSec / k, info.peakAt / k + 0.35) };
  });

  // de-duplicate: importance / priority first; no two apexes within 80 ms; one hit per 220 ms; ≤ 3 bodies
  const accepted: { c: Cue; start: number; end: number }[] = [];
  const body = (c: Cue) => ({ start: Math.max(c.at, c.peak - 0.08), end: Math.min(c.at + c.dur, c.peak + 0.35) });
  for (const c of [...cands].sort((a, b) => b.priority - a.priority || a.peak - b.peak)) {
    if (c.priority < 2 && fixed.some((f) => Math.abs(f.peak - c.peak) < 0.08)) continue;
    if (accepted.some((a) => Math.abs(a.c.peak - c.peak) < 0.08)) continue;
    if (HITS.has(c.role) && accepted.some((a) => HITS.has(a.c.role) && Math.abs(a.c.peak - c.peak) < 0.22)) continue;
    const bd = body(c);
    const overlapping = [...accepted, ...fixed.map((f) => ({ start: f.start, end: f.end }))].filter((a) => a.start < c.peak + 0.05 && a.end > c.peak - 0.05).length;
    if (overlapping >= 3 && c.priority < 2) continue;
    accepted.push({ c, ...bd });
  }
  return { cues: accepted.map((a) => a.c).sort((a, b) => a.at - b.at), mix, brief, dropped };
};

/** v1-compatible entry point: just the cues. */
export const planSound = (spec: Spec, timeline: { scenes: SceneSlot[] }, opts: PlanOpts): Cue[] => planSoundV2(spec, timeline, opts).cues;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Readable cue sheet (tests / debugging). */
export const formatCueSheet = (cues: Cue[], fps: number) =>
  cues.map((c) => `${c.peak.toFixed(3).padStart(7)}s f${String(Math.round(c.peak * fps)).padStart(4)}  ${(c.importance ?? "").padEnd(10)} ${c.role.padEnd(9)} vol ${c.volume.toFixed(2)}${c.pan ? ` pan ${c.pan > 0 ? "+" : ""}${c.pan.toFixed(2)}` : ""}  [${(c.layers ?? [c.src]).join(" + ")}]  ${c.reason}`).join("\n");

export const formatBrief = (b: Brief) =>
  `voice ${b.voice} · ${b.realism} · materials ${b.materials.join("/")} · space ${b.space} · key ${keyName(b.key)} (${b.key.source}, conf ${b.key.confidence}) · energy [${b.energy.join(", ")}] · variation ${b.variation} · restraint ${b.restraint}${b.beats.length ? ` · ${b.beats.length} beats` : ""}`;
