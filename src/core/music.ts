/**
 * Procedural score: original, royalty-free music composed for one film's timeline (no samples, no network, no key).
 *
 *   - tempo chosen near the mood's tempo so the scene cuts fall on beats; bars start at 0
 *   - sections from the film: intro → build (riser + reverse swell into the peak) → peak ("drop" on the peak bar) →
 *     resolve (final chord rings from the last scene to the end)
 *   - instruments synthesized here: detuned-saw pad, sub bass, pluck/arp with ping-pong delay, FM keys, bells,
 *     kick / clap / hats / toms, riser, impact; kick sidechain on the bed; one shared reverb; peak-safe master
 *
 * Deterministic: the same request renders the same file. Reports bpm / beats / bars / key so the auto sound planner
 * can lock SFX to the music's grid (spec.sound.music).
 */
import { SVF, encodeWav, hz, makeBuf, normalize, reverb, rng, hashStr, softLimit, panGains, SR, type Buf } from "../engine/audio/dsp";

export const MOODS = ["cinematic", "epic", "tech", "hype", "playful", "minimal", "luxury", "calm", "warm"] as const;
export type Mood = (typeof MOODS)[number];

type Quality = "maj" | "min" | "maj7" | "min7" | "min9" | "add9" | "sus2" | "dom7";
type Chord = [number, Quality];
const Q: Record<Quality, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], min9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], sus2: [0, 2, 7], dom7: [0, 4, 7, 10],
};

type Preset = {
  bpm: number; minor: boolean; prog: Chord[]; barsPerChord: number;
  pad: number; bass: "whole" | "eighths" | "offbeat" | "pulse"; arp: 0 | 8 | 16; keys: number; bells: number;
  drums: "none" | "soft" | "four" | "trap" | "cinematic"; pump: number; bright: number; space: number;
};

const PRESETS: Record<Mood, Preset> = {
  cinematic: { bpm: 90, minor: true, prog: [[0, "min"], [8, "maj"], [3, "maj"], [10, "maj"]], barsPerChord: 1, pad: 1, bass: "pulse", arp: 8, keys: 0, bells: 0.3, drums: "cinematic", pump: 0.15, bright: 0.45, space: 0.75 },
  epic: { bpm: 100, minor: true, prog: [[0, "min"], [8, "maj"], [10, "maj"], [0, "min"]], barsPerChord: 1, pad: 1, bass: "pulse", arp: 16, keys: 0, bells: 0, drums: "cinematic", pump: 0.2, bright: 0.55, space: 0.7 },
  tech: { bpm: 118, minor: true, prog: [[0, "min7"], [5, "min7"], [8, "maj7"], [7, "min7"]], barsPerChord: 1, pad: 0.7, bass: "eighths", arp: 16, keys: 0, bells: 0.2, drums: "four", pump: 0.35, bright: 0.7, space: 0.45 },
  hype: { bpm: 128, minor: true, prog: [[0, "min"], [8, "maj"], [3, "maj"], [10, "maj"]], barsPerChord: 1, pad: 0.8, bass: "offbeat", arp: 16, keys: 0, bells: 0, drums: "four", pump: 0.55, bright: 0.85, space: 0.4 },
  playful: { bpm: 112, minor: false, prog: [[0, "maj"], [7, "maj"], [9, "min"], [5, "maj"]], barsPerChord: 1, pad: 0.5, bass: "eighths", arp: 8, keys: 0.6, bells: 0.5, drums: "trap", pump: 0.2, bright: 0.8, space: 0.4 },
  minimal: { bpm: 96, minor: false, prog: [[0, "maj7"], [5, "maj7"]], barsPerChord: 2, pad: 0.6, bass: "whole", arp: 8, keys: 0.8, bells: 0.3, drums: "soft", pump: 0.15, bright: 0.5, space: 0.6 },
  luxury: { bpm: 84, minor: true, prog: [[0, "min9"], [5, "min7"], [10, "dom7"], [3, "maj7"]], barsPerChord: 1, pad: 0.7, bass: "whole", arp: 0, keys: 1, bells: 0.2, drums: "soft", pump: 0.1, bright: 0.4, space: 0.8 },
  calm: { bpm: 76, minor: false, prog: [[0, "add9"], [5, "add9"], [9, "min7"], [7, "sus2"]], barsPerChord: 2, pad: 1, bass: "whole", arp: 0, keys: 0.6, bells: 0.6, drums: "none", pump: 0, bright: 0.35, space: 0.85 },
  warm: { bpm: 92, minor: false, prog: [[0, "maj"], [9, "min"], [5, "maj"], [7, "maj"]], barsPerChord: 1, pad: 0.7, bass: "eighths", arp: 8, keys: 0.8, bells: 0.2, drums: "soft", pump: 0.2, bright: 0.55, space: 0.55 },
};

const NOTE: Record<string, number> = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };
/** "F# minor" → { root: 6, minor: true }; null when unparseable. */
export const parseKey = (k: string | undefined): { root: number; minor: boolean } | null => {
  const m = /^\s*([a-g](?:#|b)?)\s*(major|maj|minor|min|m)?\s*$/i.exec(k ?? "");
  if (!m) return null;
  const root = NOTE[m[1].toLowerCase()];
  return root == null ? null : { root, minor: /^m(in(or)?)?$/i.test(m[2] ?? "") };
};
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export type ScoreRequest = {
  seconds: number;
  mood?: Mood;
  bpm?: number;
  key?: string;
  /** scene start times (s) — the tempo is chosen so these land on beats */
  cuts?: number[];
  /** the film's peak moment (s): the drop lands on the bar nearest it (default 70% of the film) */
  peak?: number;
  /** where the resolving chord / end hit lands (default: the last cut, else 88%) */
  resolve?: number;
  /** 0..1 overall density (default 0.7) */
  intensity?: number;
  seed?: number;
};
export type ScoreMeta = {
  bpm: number; key: string; mood: Mood; seconds: number; beats: number[]; bars: number[];
  sections: { name: "intro" | "build" | "peak" | "resolve"; from: number; to: number }[];
  /** mean distance (ms) from each cut to its nearest beat */
  cutAlignmentMs: number;
};

/**
 * Tempo near `base` (±10 %) minimizing the cuts' distance to a beat grid anchored at `anchor` (the drop), so the peak is
 * always exactly on a downbeat. Half-beat matches count 2/3.
 */
export const fitTempo = (base: number, cuts: number[], anchor = 0): { bpm: number; errMs: number } => {
  const cs = cuts.filter((c) => c > 0.05).map((c) => c - anchor);
  if (!cs.length) return { bpm: base, errMs: 0 };
  let best = { bpm: base, err: Infinity };
  for (let b = base * 0.9; b <= base * 1.1; b += 0.25) {
    const beat = 60 / b;
    const err = cs.reduce((s, c) => {
      const d1 = Math.abs(c - Math.round(c / beat) * beat), d2 = Math.abs(c - Math.round(c / (beat / 2)) * (beat / 2)) * 1.5;
      return s + Math.min(d1, d2);
    }, 0) / cs.length + Math.abs(b - base) * 0.0004;
    if (err < best.err) best = { bpm: Math.round(b * 4) / 4, err };
  }
  return { bpm: best.bpm, errMs: Math.round(best.err * 1000) };
};

// ------------------------------------------------------------------------------------------------- voices

const TAU = Math.PI * 2;
/** PolyBLEP saw (band-limited enough for pads/plucks at 48 kHz). */
const blep = (t: number, dt: number) => (t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0);
const add = (b: Buf, i: number, v: number, pan = 0) => { if (i < 0 || i >= b.n) return; const [l, r] = panGains(pan); b.L[i] += v * l * 0.7071; b.R[i] += v * r * 0.7071; };

const padNote = (b: Buf, t0: number, dur: number, midi: number, amp: number, bright: number, rnd: () => number) => {
  const n0 = Math.round(t0 * SR), att = Math.min(0.6, dur * 0.3), rel = 0.9, N = Math.round((dur + rel) * SR);
  const f = hz(midi), dets = [-0.07, 0, 0.065], ph = dets.map(() => rnd()), fl = new SVF(), fr = new SVF();
  const pan = (rnd() - 0.5) * 0.8;
  for (let k = 0; k < N; k++) {
    const t = k / SR;
    const env = t < att ? t / att : t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel);
    if (env <= 0) continue;
    let sL = 0, sR = 0;
    dets.forEach((d, j) => {
      const fj = f * Math.pow(2, d / 12), dt = fj / SR;
      ph[j] = (ph[j] + dt) % 1;
      const s = 2 * ph[j] - 1 - blep(ph[j], dt);
      if (j !== 2) sL += s; if (j !== 0) sR += s;
    });
    const cut = 500 + bright * 2600 + 500 * Math.sin(TAU * 0.13 * (t0 + t));
    add(b, n0 + k, fl.run(sL * 0.5, cut, 0.6).lp * env * amp, pan - 0.4);
    add(b, n0 + k, fr.run(sR * 0.5, cut * 1.03, 0.6).lp * env * amp, pan + 0.4);
  }
};

const pluck = (b: Buf, t0: number, midi: number, amp: number, bright: number, pan: number, decay = 0.22) => {
  const n0 = Math.round(t0 * SR), N = Math.round((decay * 3) * SR), f = hz(midi), dt = f / SR, flt = new SVF();
  let ph = 0;
  for (let k = 0; k < N; k++) {
    const t = k / SR, env = Math.exp(-t / decay);
    ph = (ph + dt) % 1;
    const s = 2 * ph - 1 - blep(ph, dt);
    add(b, n0 + k, flt.run(s, 300 + (1500 + bright * 5000) * Math.exp(-t / (decay * 0.5)), 1.1).lp * env * amp, pan);
  }
};

/** FM electric piano / bell: carrier + modulator with a decaying index. */
const fm = (b: Buf, t0: number, midi: number, amp: number, o: { ratio: number; index: number; decay: number; pan?: number }) => {
  const n0 = Math.round(t0 * SR), N = Math.round(o.decay * 4 * SR), f = hz(midi);
  for (let k = 0; k < N; k++) {
    const t = k / SR, env = Math.min(1, t / 0.004) * Math.exp(-t / o.decay);
    const mod = Math.sin(TAU * f * o.ratio * t) * o.index * Math.exp(-t / (o.decay * 0.35));
    add(b, n0 + k, Math.sin(TAU * f * t + mod) * env * amp, o.pan ?? 0);
  }
};

const subNote = (b: Buf, t0: number, dur: number, midi: number, amp: number) => {
  const n0 = Math.round(t0 * SR), N = Math.round((dur + 0.08) * SR), f = hz(midi);
  for (let k = 0; k < N; k++) {
    const t = k / SR, env = Math.min(1, t / 0.008) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.08));
    const s = Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t) + 0.08 * Math.sin(TAU * 3 * f * t);
    add(b, n0 + k, s * env * amp, 0);
  }
};

const kick = (b: Buf, t0: number, amp: number, deep = 1) => {
  const n0 = Math.round(t0 * SR), N = Math.round(0.45 * deep * SR);
  let ph = 0;
  for (let k = 0; k < N; k++) {
    const t = k / SR, f = 45 + 110 * Math.exp(-t / 0.035);
    ph += TAU * f / SR;
    add(b, n0 + k, (Math.sin(ph) * Math.exp(-t / (0.16 * deep)) + (k < 40 ? (1 - k / 40) * 0.3 : 0)) * amp, 0);
  }
};

const noiseHit = (b: Buf, rnd: () => number, t0: number, amp: number, o: { hz: number; q: number; decay: number; mode: "bp" | "hp" | "lp"; pan?: number; body?: number; claps?: number }) => {
  const n0 = Math.round(t0 * SR), N = Math.round(o.decay * 5 * SR), flt = new SVF();
  const claps = o.claps ?? 1;
  for (let k = 0; k < N; k++) {
    const t = k / SR;
    let env = Math.exp(-t / o.decay);
    if (claps > 1) { const c = Math.floor(t / 0.011); if (c < claps - 1) env = Math.exp(-(t - c * 0.011) / 0.004); else env = Math.exp(-(t - (claps - 1) * 0.011) / o.decay); }
    const r = flt.run(rnd() * 2 - 1, o.hz, o.q);
    let v = (o.mode === "bp" ? r.bp : o.mode === "hp" ? r.hp : r.lp) * env * amp;
    if (o.body) v += Math.sin(TAU * o.body * t) * Math.exp(-t / 0.05) * amp * 0.5;
    add(b, n0 + k, v, o.pan ?? 0);
  }
};

const riserFx = (b: Buf, rnd: () => number, t0: number, t1: number, amp: number) => {
  const n0 = Math.round(t0 * SR), N = Math.round((t1 - t0) * SR), fl = new SVF(), fr = new SVF();
  for (let k = 0; k < N; k++) {
    const x = k / N, env = Math.pow(x, 2.4);
    const fc = 300 * Math.pow(30, x);
    add(b, n0 + k, fl.run(rnd() * 2 - 1, fc, 2.2).bp * env * amp, -0.5 + x * 0.3);
    add(b, n0 + k, fr.run(rnd() * 2 - 1, fc * 1.02, 2.2).bp * env * amp, 0.5 - x * 0.3);
  }
};

const impactFx = (b: Buf, rnd: () => number, t0: number, amp: number) => {
  kick(b, t0, amp * 1.1, 2.2);
  noiseHit(b, rnd, t0, amp * 0.6, { hz: 2500, q: 0.6, decay: 0.25, mode: "lp" });
};

// ------------------------------------------------------------------------------------------------- composer

export const composeScore = (req: ScoreRequest): { buf: Buf; meta: ScoreMeta } => {
  const mood: Mood = req.mood ?? "cinematic";
  const P = PRESETS[mood];
  const total = Math.max(2, req.seconds);
  const keyIn = parseKey(req.key);
  const key = keyIn ?? { root: [9, 2, 4, 7, 0][hashStr(mood) % 5], minor: P.minor };
  const peakIn = Math.max(0.5, Math.min(total - 0.5, req.peak ?? total * 0.7));
  const fit = req.bpm ? { bpm: req.bpm, errMs: 0 } : fitTempo(P.bpm, req.cuts ?? [], peakIn);
  const bpm = fit.bpm, beat = 60 / bpm, bar = beat * 4;
  // the grid is anchored on the peak: bar lines fall exactly on it; bar 0 is a pickup that may start before 0 s
  const origin = peakIn - Math.ceil(peakIn / bar) * bar;
  const barT = (bi: number) => origin + bi * bar;
  const rnd = rng((req.seed ?? 1) ^ hashStr(`${mood}|${bpm}|${key.root}|${total.toFixed(2)}`));
  const intensity = Math.max(0, Math.min(1, req.intensity ?? 0.7));

  const nBars = Math.ceil((total - origin) / bar);
  const snapBar = (t: number) => Math.max(0, Math.min(nBars - 1, Math.round((t - origin) / bar)));
  const peakBar = Math.round((peakIn - origin) / bar);
  const lastCut = (req.cuts ?? []).filter((c) => c > total * 0.5).pop();
  const resolveT = Math.min(total - 0.5, req.resolve ?? lastCut ?? total * 0.88);
  const resolveBar = Math.max(peakBar + (peakBar < nBars - 1 ? 1 : 0), snapBar(resolveT));
  const buildBar = Math.max(1, Math.min(peakBar - 1, Math.round(peakBar * 0.35)));
  const sections: ScoreMeta["sections"] = [
    { name: "intro" as const, from: 0, to: barT(buildBar) },
    { name: "build" as const, from: barT(buildBar), to: barT(peakBar) },
    { name: "peak" as const, from: barT(peakBar), to: Math.min(total, barT(resolveBar)) },
    { name: "resolve" as const, from: Math.min(total, barT(resolveBar)), to: total },
  ].map((s) => ({ ...s, from: Math.max(0, s.from) })).filter((s) => s.to - s.from > 0.05).map((s) => ({ ...s, from: r3(s.from), to: r3(s.to) }));
  // intro is present (phones are loud places), the build climbs, the peak is full, the resolve settles
  const energy = (barIdx: number) => barIdx < buildBar ? 0.42 : barIdx < peakBar ? 0.5 + 0.38 * ((barIdx - buildBar) / Math.max(1, peakBar - buildBar)) : barIdx < resolveBar ? 1 : 0.35;

  const bed = makeBuf(total + 2.5), drums = makeBuf(total + 2.5), send = makeBuf(total + 2.5);
  const chordAt = (barIdx: number): number[] => {
    const [off, q] = P.prog[Math.floor(barIdx / P.barsPerChord) % P.prog.length];
    return Q[q].map((iv) => key.root + off + iv);
  };
  const rootAt = (barIdx: number) => key.root + P.prog[Math.floor(barIdx / P.barsPerChord) % P.prog.length][0];
  const kicks: number[] = [];

  for (let bi = 0; bi < nBars; bi++) {
    const t = barT(bi), e = energy(bi) * (0.6 + 0.4 * intensity);
    const final = bi === resolveBar;
    if (bi > resolveBar) break; // the final chord rings out
    const ch = chordAt(final ? 0 : bi); // resolve on the tonic
    const voiced = ch.map((n, j) => 48 + ((n % 12) + 12) % 12 + (j > 2 ? 12 : 0) + (j === 0 ? 0 : 12));
    const dur = final ? total - t + 1.5 : bar * (bi % P.barsPerChord === 0 ? P.barsPerChord : 0);
    if (P.pad && dur > 0) voiced.forEach((m) => padNote(bed, t, Math.min(dur, total - t + 1.2), m, 0.055 * P.pad * (0.5 + e * 0.6), P.bright * (0.6 + e * 0.5), rnd));
    // sub bass
    const root = 36 + (((rootAt(final ? 0 : bi) % 12) + 12) % 12);
    if (final) subNote(bed, t, Math.min(total - t, bar * 2), root, 0.32);
    else if (e > 0.3 || P.bass === "whole") {
      if (P.bass === "whole") subNote(bed, t, bar * 0.98, root, 0.26 * e + 0.08);
      else for (let k = 0; k < 8; k++) {
        if (P.bass === "offbeat" && k % 2 === 0) continue;
        if (P.bass === "pulse" && e < 0.6 && k % 2 === 1) continue;
        subNote(bed, t + k * beat / 2, beat * (P.bass === "pulse" ? 0.45 : 0.4), root, 0.24 * e);
      }
    }
    // arp / plucks
    if (P.arp && e > 0.35 && !final) {
      const steps = P.arp === 16 ? 16 : 8, step = bar / steps;
      const pattern = [0, 1, 2, 1, 2, 3 % ch.length, 2, 1];
      for (let k = 0; k < steps; k++) {
        if (e < 0.55 && k % 2 === 1) continue;
        const n = ch[pattern[k % pattern.length] % ch.length];
        const m = 60 + ((n % 12) + 12) % 12 + (k % 8 >= 4 ? 12 : 0);
        pluck(send, t + k * step, m, 0.08 * e, P.bright, k % 2 ? 0.45 : -0.45, P.arp === 16 ? 0.14 : 0.22);
      }
    }
    // keys (FM EP) on beats 1 and 3 (2 + 4 offbeat stabs in playful)
    if (P.keys && !final) {
      const hits = mood === "playful" ? [0, 1.5, 2, 3.5] : [0, 2.5];
      for (const h of hits) voiced.slice(0, 4).forEach((m, j) => fm(send, t + h * beat + j * 0.006, m + 12, 0.05 * P.keys * (0.6 + 0.4 * e), { ratio: 1, index: 1.6, decay: 0.55, pan: (j - 1.5) * 0.25 }));
    }
    if (P.bells && (bi % 2 === 0 || final) && e < 0.9) fm(send, t + (final ? 0 : beat * 2), 84 + ((ch[ch.length - 1] % 12) + 12) % 12, 0.045 * P.bells, { ratio: 3.5, index: 2.2, decay: 0.9, pan: rnd() - 0.5 });
    // drums
    const d = P.drums;
    if (d !== "none" && !final && bi >= buildBar && e > 0.45) {
      for (let k = 0; k < 4; k++) {
        const bt = t + k * beat;
        const four = d === "four" && e > 0.45;
        const isKick = four || (d === "trap" && (k === 0 || (k === 2 && e > 0.7))) || (d === "soft" && (k === 0 || k === 2) && e > 0.4) || (d === "cinematic" && e > 0.85 && (k === 0 || k === 2));
        if (isKick) { kick(drums, bt, 0.55 * Math.min(1, e + 0.2)); kicks.push(bt); }
        if ((k === 1 || k === 3) && e > 0.55 && d !== "cinematic") noiseHit(drums, rnd, bt, d === "soft" ? 0.12 : 0.22, { hz: 1500, q: 0.9, decay: d === "soft" ? 0.06 : 0.09, mode: "bp", body: 190, claps: d === "soft" ? 1 : 3 });
        if (d === "cinematic" && e > 0.6) {
          // toms + timpani-like ostinato
          const tomPat = [0, 0.75, 1.5, 2, 3, 3.5];
          if (k === 0) for (const tp of tomPat) { const tt = t + tp * beat; kick(drums, tt, 0.22 * e, 1.2); noiseHit(drums, rnd, tt, 0.05 * e, { hz: 250, q: 0.8, decay: 0.08, mode: "lp" }); }
        }
        // hats: 8ths (16ths at peak for four / trap)
        const sub = (d === "four" || d === "trap") && e > 0.85 ? 4 : 2;
        if (d !== "cinematic" && e > 0.4) for (let s = 0; s < sub; s++) noiseHit(drums, rnd, bt + s * beat / sub, (s % 2 ? 0.05 : 0.035) * (d === "soft" ? 0.6 : 1), { hz: 8500, q: 0.7, decay: s % 2 && sub === 2 ? 0.05 : 0.025, mode: "hp", pan: 0.25 });
      }
    }
  }

  // build: riser + reverse swell into the drop; impact on the drop and a soft hit on the resolve
  const peakT = barT(peakBar);
  if (peakBar > buildBar) riserFx(bed, rnd, Math.max(0, peakT - Math.min(bar * 2, peakT * 0.5)), peakT, 0.14 * intensity + 0.04);
  if (mood !== "calm") impactFx(drums, rnd, peakT, 0.5);
  const resT = barT(resolveBar);
  if (resT < total) { kick(drums, resT, mood === "calm" ? 0.2 : 0.45, 1.8); }

  // sidechain the bed on kicks
  if (P.pump && kicks.length) {
    let ki = 0;
    for (let i = 0; i < bed.n; i++) {
      const t = i / SR;
      while (ki < kicks.length - 1 && kicks[ki + 1] <= t) ki++;
      const dt = t - kicks[ki];
      const g = dt >= 0 && dt < 0.25 ? 1 - P.pump * Math.exp(-dt / 0.07) : 1;
      bed.L[i] *= g; bed.R[i] *= g; send.L[i] *= g; send.R[i] *= g;
    }
  }

  // shared space: plucks/keys/bells fully through the reverb; the pad gets some
  reverb(send, { room: 0.55 + P.space * 0.35, damp: 0.45, wet: 0.35 + P.space * 0.25, predelay: 0.02, width: 1 });
  const out = makeBuf(total);
  for (let i = 0; i < out.n; i++) {
    out.L[i] = bed.L[i] + send.L[i] + drums.L[i];
    out.R[i] = bed.R[i] + send.R[i] + drums.R[i];
  }
  // final fade over the last 0.35 s
  const fadeN = Math.round(0.35 * SR);
  for (let k = 0; k < fadeN; k++) { const g = k / fadeN; out.L[out.n - 1 - k] *= g; out.R[out.n - 1 - k] *= g; }
  softLimit(out, 0.9);
  normalize(out, -14, -1.5); // ≈ −20 LUFS integrated: a bed that sits under the voice (−16) and the hits

  const beats: number[] = [], bars: number[] = [];
  for (let k = 0, t = origin; t < total - 1e-6; k++, t = origin + k * beat) if (t >= -1e-6) { beats.push(r3(Math.max(0, t))); if (k % 4 === 0) bars.push(r3(Math.max(0, t))); }
  const meta: ScoreMeta = {
    bpm, key: `${NAMES[((key.root % 12) + 12) % 12]} ${key.minor ? "minor" : "major"}`, mood, seconds: r3(total), beats, bars, sections,
    cutAlignmentMs: fit.errMs,
  };
  return { buf: out, meta };
};

export const scoreWav = (buf: Buf) => Buffer.from(encodeWav(buf, 11));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
