/** Film-level sound phrases: keep a material identity and pass decay/anticipation across successive actions. */
import type { Spec } from "../spec/schema";
import type { Cue } from "./autoSound";
import type { Brief } from "./brief";
import { midiIn, VOICE_BRIGHT } from "./brief";
import { decodeRecipe, type BakeLayer, type Recipe } from "./bake";
import { bakeSrc, SFX, sfxInfo } from "./library";
import { hashStr } from "./dsp";

export type SoundBridge = Cue & { id: string; from: number; to: number; family: string };
export type SoundPhrase = { id: string; from: number; to: number; cueFrames: number[]; families: string[]; bridges: number };

export const cueMaterial = (c: Cue) => {
  const layers = c.src.startsWith("bake:") ? decodeRecipe(c.src.slice(5)).l : [];
  const recorded = layers.filter((l) => l.f && SFX[l.f]);
  const source = recorded.find((l) => SFX[l.f!].category.startsWith("impact")) ?? recorded[0];
  const e = source?.f ? SFX[source.f] : sfxInfo(c.src);
  return { family: e?.group ?? `synth:${layers.find((l) => l.s)?.s?.k ?? c.role}`, source, entry: e };
};

export const connectSound = (spec: Spec, cues: Cue[], brief: Brief, total: number): { bridges: SoundBridge[]; phrases: SoundPhrase[] } => {
  if (spec.sound?.continuity === false) return { bridges: [], phrases: [] };
  const cfg = spec.sound?.continuity ?? {}, maxGap = cfg.maxGap ?? 4.5;
  const anchors = [...cues].filter((c) => c.importance !== "micro" && c.volume > 0).sort((a, b) => a.peak - b.peak);
  const bridges: SoundBridge[] = [], phrases: SoundPhrase[] = [];
  const seed = hashStr(`${brief.brand}|sonic-thread`);
  let phrase: SoundPhrase | undefined;
  for (let i = 0; i < anchors.length; i++) {
    const current = anchors[i], material = cueMaterial(current);
    current.family = material.family;
    const previous = anchors[i - 1];
    if (!phrase || !previous || current.peak - previous.peak > maxGap) {
      phrase = { id: `phrase-${phrases.length + 1}`, from: Math.max(0, current.at), to: Math.min(total, current.at + current.dur), cueFrames: [], families: [], bridges: 0 };
      phrases.push(phrase);
    }
    phrase.cueFrames.push(Math.round(current.peak * spec.fps));
    phrase.to = Math.min(total, Math.max(phrase.to, current.at + current.dur));
    if (!phrase.families.includes(material.family)) phrase.families.push(material.family);
    if (!previous || cfg.bridges === false || (cfg.bridgeVolume ?? 0.22) <= 0) continue;
    const gap = current.peak - previous.peak;
    if (gap < 0.3 || gap > maxGap || (spec.sfx ?? []).some((s) => s.at > previous.peak && s.at < current.peak)) continue;
    const preHeroSilence = current.importance === "hero" ? 0.35 + 0.5 * brief.restraint : 0.04;
    const at = Math.max(0, previous.peak + 0.035), end = Math.min(total, current.peak - preHeroSilence);
    const d = end - at;
    if (d < 0.18) continue;
    const prev = cueMaterial(previous), layers: BakeLayer[] = [];
    // Carry the actual previous material's decay, without replaying its attack.
    if (prev.source?.f && prev.entry) {
      const rate = Math.pow(2, (prev.source.p ?? 0) / 12), tail = prev.entry.peakAt / rate + 0.025;
      if (prev.entry.durationSec / rate > tail + 0.03) layers.push({ f: prev.source.f, p: prev.source.p, i: tail,
        o: 0, x: Math.min(d, 0.6), g: Math.max(-40, prev.source.g - 10), w: 0.35 });
    }
    // Prepare the next material before it is seen: reverse its attack into the destination action.
    if (material.source?.f && material.entry && current.importance !== "hero") {
      const rate = Math.pow(2, (material.source.p ?? 0) / 12), len = material.entry.durationSec / rate;
      const length = Math.min(d * 0.5, 0.48, len);
      layers.push({ f: material.source.f, p: material.source.p, rv: 1, i: Math.max(0, len - length),
        o: d - length, x: length, g: Math.max(-40, material.source.g - 15), w: 0.2 });
    }
    layers.push({ s: { k: "thread", d, m: midiIn(brief.key.root, 45), phase: at,
      brightness: VOICE_BRIGHT[brief.voice], tension: current.importance === "hero" ? 1 : 0.5, seed }, o: 0, g: 0, w: 0.3 });
    const r: Recipe = { v: 1, d, l: layers, sp: brief.space, wd: 0.75 };
    bridges.push({ id: `bridge-${i}`, src: bakeSrc(r), at, dur: d, peak: at + d / 2,
      volume: Math.min(0.5, cfg.bridgeVolume ?? 0.22) * (brief.hasMusic ? 0.65 : 1),
      priority: -1, role: "bridge", duck: 0, from: previous.peak, to: current.peak,
      family: `${prev.family} → ${material.family}`, reason: `carry ${previous.role} decay into ${current.role} anticipation`,
      layers: [...layers.filter((l) => l.f).map((l) => `${l.rv ? "prelap" : "tail"}:${l.f}`), "phase-continuous thread"],
    });
    phrase.bridges++;
  }
  return { bridges, phrases };
};
