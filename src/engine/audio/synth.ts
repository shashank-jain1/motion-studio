/**
 * Tunable synthesized LAYERS (pure, deterministic). The synthesizer is no longer the whole library: it supplies the
 * layers where synthesis beats recordings (docs/research/04-sound-design.md §5 "keep the synthesizer"):
 *   sub      tuned sine/808 drop with harmonics (audible on phones)          — hits, logo, shake
 *   boom     sub + low noise thump + long dark tail                           — hero impacts, drops
 *   air      noise whoosh with an exact pre-apex / post-apex length            — every move, fitted to the frame
 *   riser    noise + tonal stack climbing INTO the key's root (apex = end)     — builds into cuts
 *   swell    reversed shimmer chord in key (apex = end)                        — pre-hero suck, mask reveals
 *   shimmer  glassy partial cloud on chord tones                               — logo draws, sparkle
 *   ping     struck tonal notes (glass / bell / soft / marimba / metal)        — chimes, success, notification
 *   blip     tiny sine blips on the pentatonic                                 — data, HUD, counters
 *   tick     synthetic transient click (fallback when no recorded transient)
 * Every spec is plain JSON (part of a bake recipe), so a layer is rebuilt identically anywhere from its spec.
 * `synthMeta(spec)` returns duration + apex analytically (the planner needs it without rendering).
 */
import { SR, TAU, SVF, clamp, expMix, hz, makeBuf, mix, panGains, pinkGen, reverb, reverseBuf, rng, saturate, smooth, type Buf } from "./dsp";

export type Timbre = "glass" | "bell" | "soft" | "marimba" | "metal";
export type SynthSpec =
  | { k: "thread"; d: number; m: number; phase: number; brightness: number; tension: number; seed: number }
  | { k: "sub"; m: number; d: number; drop?: number; drive?: number; seed: number }
  | { k: "boom"; m: number; d: number; seed: number }
  | { k: "air"; pre: number; post: number; b: number; s: number; dir?: number; seed: number }
  | { k: "riser"; m: number; d: number; tonal: number; seed: number }
  | { k: "swell"; m: number; d: number; chord: number[]; seed: number }
  | { k: "shimmer"; d: number; notes: number[]; seed: number }
  | { k: "ping"; notes: number[]; gap: number; t: Timbre; d: number; seed: number }
  | { k: "blip"; notes: number[]; gap: number; seed: number }
  | { k: "tick"; b: number; seed: number };

/** Duration and apex (seconds from file start) of a synth layer. */
export const synthMeta = (s: SynthSpec): { dur: number; peakAt: number } => {
  switch (s.k) {
    case "thread": return { dur: s.d, peakAt: s.d * 0.5 };
    case "sub": case "boom": return { dur: s.d, peakAt: 0.004 };
    case "air": return { dur: s.pre + s.post, peakAt: s.pre };
    case "riser": case "swell": return { dur: s.d + 0.03, peakAt: s.d };
    case "shimmer": return { dur: s.d, peakAt: Math.min(0.35, s.d * 0.3) };
    case "ping": return { dur: s.d, peakAt: 0.002 };
    case "blip": return { dur: 0.12 + s.gap * (s.notes.length - 1), peakAt: 0.002 };
    case "tick": return { dur: 0.06, peakAt: 0.001 };
  }
};

/** Inharmonic partial sets [ratio, amp, decay(s)]. */
const PARTIALS: Record<Timbre, [number, number, number][]> = {
  glass: [[1, 1, 1.1], [2.32, 0.42, 0.55], [4.25, 0.24, 0.3], [6.63, 0.12, 0.16], [9.1, 0.05, 0.08]],
  bell: [[0.5, 0.25, 1.4], [1, 1, 1.0], [1.19, 0.3, 0.8], [1.5, 0.22, 0.6], [2.0, 0.4, 0.5], [2.74, 0.2, 0.3], [5.4, 0.08, 0.12]],
  soft: [[1, 1, 0.35], [2, 0.18, 0.15], [3, 0.06, 0.08]],
  marimba: [[1, 1, 0.45], [3.93, 0.32, 0.08], [9.2, 0.08, 0.025]],
  metal: [[1, 1, 0.5], [1.47, 0.7, 0.4], [2.09, 0.55, 0.3], [2.56, 0.4, 0.22], [3.37, 0.3, 0.14]],
};

const strike = (b: Buf, at: number, f: number, amp: number, t: Timbre, pan: number, rnd: () => number, decayMul = 1) => {
  const s0 = Math.round(at * SR);
  const [gl, gr] = panGains(pan);
  const parts = PARTIALS[t];
  const ph = parts.map(() => rnd() * TAU);
  const det = parts.map(() => 1 + (rnd() - 0.5) * 0.0016);
  const maxD = Math.max(...parts.map((p) => p[2])) * decayMul;
  const end = Math.min(b.n, s0 + Math.round(maxD * 6 * SR));
  const mallet = new SVF();
  for (let i = Math.max(0, s0); i < end; i++) {
    const tt = (i - s0) / SR;
    let v = 0;
    for (let k = 0; k < parts.length; k++) {
      const [r, a, d] = parts[k];
      const fr = f * r * det[k];
      if (fr > SR * 0.45) continue;
      // slight beating on the fundamental of glass / bell (two close modes)
      v += Math.sin(ph[k] + TAU * fr * tt) * a * Math.exp(-tt / (d * decayMul));
    }
    // mallet / strike noise: 3 ms band-limited click, gives the "real" attack
    const n = tt < 0.006 ? mallet.run(rnd() * 2 - 1, Math.min(9000, f * 4), 0.9).bp * Math.exp(-tt / 0.0012) * (t === "soft" ? 0.15 : 0.6) : 0;
    v = (v * (1 - Math.exp(-tt / 0.0008)) + n) * amp;
    b.L[i] += v * gl;
    b.R[i] += v * gr;
  }
};

export const synthesize = (s: SynthSpec): Buf => {
  const rnd = rng(s.seed >>> 0 || 1);
  switch (s.k) {
    case "thread": {
      const b = makeBuf(s.d), root = hz(s.m);
      const noise = (x: number) => {
        const i = Math.floor(x), u = x - i, q = u * u * (3 - 2 * u);
        const h = (n: number) => { let v = Math.imul(n ^ s.seed, 0x45d9f3b); v = Math.imul(v ^ (v >>> 16), 0x45d9f3b); return ((v ^ (v >>> 16)) >>> 0) / 2147483648 - 1; };
        return h(i) * (1 - q) + h(i + 1) * q;
      };
      for (let i = 0; i < b.n; i++) {
        const t = i / SR, global = s.phase + t, u = t / Math.max(0.001, s.d);
        const attack = Math.sin(Math.min(1, t / 0.16) * Math.PI / 2);
        const release = Math.sin(Math.min(1, (s.d - t) / 0.22) * Math.PI / 2);
        const breath = 0.45 + 0.55 * Math.sin(Math.PI * u) ** 2;
        const air = noise(global * 900) * 0.1 + noise(global * 3400) * (0.025 + s.brightness * 0.045);
        const tone = (Math.sin(TAU * root * global) + 0.35 * Math.sin(TAU * root * 1.5 * global)) * 0.045;
        const env = attack * release * breath * (0.7 + s.tension * 0.3);
        b.L[i] = (air + tone) * env;
        b.R[i] = (noise(global * 900 + 0.17) * 0.1 + tone) * env;
      }
      return b;
    }
    case "sub": {
      const b = makeBuf(s.d);
      const f1 = hz(s.m), f0 = hz(s.m + (s.drop ?? 7));
      let ph = 0;
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const f = f1 + (f0 - f1) * Math.exp(-t / 0.06);
        ph += (TAU * f) / SR;
        const env = (1 - Math.exp(-t / 0.003)) * Math.exp(-t / (s.d * 0.38));
        const v = Math.sin(ph) * env;
        b.L[i] = v; b.R[i] = v;
      }
      saturate(b, s.drive ?? 1.6); // harmonics → phones reproduce the weight
      return b;
    }
    case "boom": {
      const b = makeBuf(s.d);
      const f1 = hz(s.m), f0 = hz(s.m + 12);
      const lp = new SVF(), lp2 = new SVF();
      const pink = pinkGen(rnd);
      let ph = 0;
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const f = f1 + (f0 - f1) * Math.exp(-t / 0.045);
        ph += (TAU * f) / SR;
        const sub = Math.sin(ph) * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / (s.d * 0.32));
        const thump = lp.run(pink() * 3, 180 + 900 * Math.exp(-t / 0.05), 0.8).lp * Math.exp(-t / 0.09) * 1.4;
        const rumble = lp2.run(pink() * 3, 90, 0.7).lp * Math.exp(-t / (s.d * 0.45)) * 0.9;
        const v = sub + thump + rumble;
        b.L[i] = v; b.R[i] = v;
      }
      saturate(b, 1.3);
      reverb(b, { room: 0.9, damp: 0.75, wet: 0.25, hp: 120, lp: 3000 });
      return b;
    }
    case "air": {
      const dur = s.pre + s.post;
      const b = makeBuf(dur);
      const pk = s.pre;
      const pinkL = pinkGen(rnd), pinkR = pinkGen(rnd), pinkC = pinkGen(rnd);
      const f = [new SVF(), new SVF()], body = [new SVF(), new SVF()], hiF = [new SVF(), new SVF()];
      const fLo = mix(180, 900, s.b) * mix(1.2, 0.6, s.s), fHi = mix(1800, 7500, s.b) * mix(1.15, 0.7, s.s);
      const wB = Math.max(0.03, s.pre * 0.42), wA = Math.max(0.025, s.post * 0.3);
      const dir = s.dir ?? 0; // +1 rising (zoom into), −1 falling (exit / drop)
      // slow amplitude flutter: real air past an object is not a smooth bell curve
      const flutRate = mix(9, 22, s.b), flutPh = rnd() * TAU;
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const d = (t - pk) / (t < pk ? wB : wA);
        let a = 1 / Math.pow(1 + d * d, 1.5);
        a *= smooth(t / Math.min(0.03, pk * 0.5 + 1e-3)) * smooth((dur - t) / Math.max(0.02, s.post * 0.35));
        a *= 1 + 0.12 * Math.sin(flutPh + TAU * flutRate * t) * a;
        // doppler: brightness peaks just before the amplitude apex; dir tilts the whole sweep
        const x = 1 / (1 + Math.pow((t - pk + 0.012) / (t < pk ? wB : wA * 0.8), 2));
        const tilt = dir > 0 ? smooth(t / Math.max(1e-3, dur)) : dir < 0 ? 1 - smooth(t / Math.max(1e-3, dur)) : 0.5;
        const fc = expMix(fLo, fHi, clamp(x * 0.85 + tilt * 0.3 - 0.15, 0, 1));
        const nC = pinkC() * 2.4;
        const src = [nC * 0.45 + pinkL() * 2.4 * 0.55, nC * 0.45 + pinkR() * 2.4 * 0.55];
        for (let c = 0; c < 2; c++) {
          const bp = f[c].run(src[c], fc * (c ? 1.04 : 0.96), 0.9 + 0.6 * s.b).bp;
          const lo = body[c].run(src[c], fc * 0.5, 0.7).lp * mix(0.7, 0.2, s.b);
          const hi = hiF[c].run(src[c], 6500, 0.7).hp * mix(0.05, 0.4, s.b) * a;
          (c ? b.R : b.L)[i] = (bp + lo + hi) * a;
        }
      }
      return b;
    }
    case "riser": {
      const b = makeBuf(s.d + 0.03);
      const f = [new SVF(), new SVF()];
      const pink = [pinkGen(rnd), pinkGen(rnd)];
      const root = hz(s.m);
      // Shepard-ish stack: octaves of the root gliding up one octave, crossfaded by register
      const voices = [0.5, 1, 2, 4];
      const ph = voices.map(() => rnd() * TAU);
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const x = clamp(t / s.d, 0, 1);
        const a = Math.pow(x, 2.1) * smooth(t / 0.05) * (t > s.d ? Math.max(0, 1 - (t - s.d) / 0.02) : 1);
        let tone = 0;
        for (let k = 0; k < voices.length; k++) {
          const fr = root * voices[k] * Math.pow(2, x - 1);
          ph[k] += (TAU * fr) / SR;
          const reg = Math.log2(fr / root) + 1; // 0..4 → window
          const w = Math.exp(-((reg - 1.6) ** 2) / 1.5);
          tone += (Math.sin(ph[k]) + 0.3 * Math.sin(2 * ph[k])) * w;
        }
        const trem = 1 + 0.3 * Math.sin(TAU * mix(3, 16, x * x) * t) * x;
        const fc = expMix(300, 11000, Math.pow(x, 1.5));
        for (let c = 0; c < 2; c++) {
          const n = f[c].run(pink[c]() * 3, fc, 0.8 + 1.8 * x).lp;
          (c ? b.R : b.L)[i] = (n * (1 - s.tonal * 0.5) + tone * 0.35 * s.tonal) * a * trem;
        }
      }
      return b;
    }
    case "swell": {
      const len = s.d + 0.45;
      const b = makeBuf(len);
      // a struck chord + cymbal-ish wash, reverberated, then reversed: the tail becomes the swell
      const root = hz(s.m);
      s.chord.forEach((iv, k) => strike(b, 0.05, root * Math.pow(2, iv / 12), 0.35, "glass", (k / Math.max(1, s.chord.length - 1)) * 1.2 - 0.6, rnd, 1.6));
      const hp = [new SVF(), new SVF()];
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const e = t > 0.05 ? Math.exp(-(t - 0.05) / 0.35) : 0;
        b.L[i] += hp[0].run(rnd() * 2 - 1, 6500, 0.6).hp * e * 0.35;
        b.R[i] += hp[1].run(rnd() * 2 - 1, 6500, 0.6).hp * e * 0.35;
      }
      reverb(b, { room: 0.93, damp: 0.3, wet: 0.75, dry: 1.2, predelay: 0 });
      reverseBuf(b);
      // keep exactly `d` seconds of swell, cut hard right after the apex
      const start = b.n - Math.round(0.4 * SR) - Math.round(s.d * SR);
      const out = makeBuf(s.d + 0.03);
      for (let i = 0; i < out.n; i++) {
        const j = start + i;
        const g = i / SR > s.d ? Math.max(0, 1 - (i / SR - s.d) / 0.015) : smooth(i / SR / Math.min(0.2, s.d * 0.3));
        if (j >= 0 && j < b.n) { out.L[i] = b.L[j] * g; out.R[i] = b.R[j] * g; }
      }
      return out;
    }
    case "shimmer": {
      const b = makeBuf(s.d);
      const n = Math.round(14 + s.d * 10);
      for (let k = 0; k < n; k++) {
        const m = s.notes[Math.floor(rnd() * s.notes.length)] + (rnd() < 0.3 ? 12 : 0);
        const at = 0.02 + Math.pow(rnd(), 0.9) * s.d * 0.45;
        strike(b, at, hz(m) * (1 + (rnd() - 0.5) * 0.003), 0.09 + rnd() * 0.08, rnd() < 0.7 ? "glass" : "bell", rnd() * 1.4 - 0.7, rnd, 0.35);
      }
      const hp = [new SVF(), new SVF()];
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const e = smooth(t / 0.15) * Math.exp(-t / (s.d * 0.35)) * 0.06;
        b.L[i] += hp[0].run(rnd() * 2 - 1, 9000, 0.7).hp * e;
        b.R[i] += hp[1].run(rnd() * 2 - 1, 9000, 0.7).hp * e;
      }
      reverb(b, { room: 0.85, damp: 0.2, wet: 0.4 });
      return b;
    }
    case "ping": {
      const b = makeBuf(s.d);
      s.notes.forEach((m, k) => strike(b, k * s.gap, hz(m), 0.8 - k * 0.06, s.t, s.notes.length > 1 ? (k / (s.notes.length - 1)) * 0.5 - 0.25 : 0, rnd, s.t === "soft" ? 1 : s.d / 1.6));
      return b;
    }
    case "blip": {
      const b = makeBuf(0.12 + s.gap * (s.notes.length - 1));
      s.notes.forEach((m, k) => {
        const s0 = Math.round(k * s.gap * SR);
        const [gl, gr] = panGains((k % 3 - 1) * 0.3);
        let ph = 0;
        const f = hz(m);
        for (let i = s0; i < Math.min(b.n, s0 + Math.round(0.1 * SR)); i++) {
          const t = (i - s0) / SR;
          ph += (TAU * f * (1 + 0.04 * Math.exp(-t / 0.004))) / SR;
          const v = Math.tanh(Math.sin(ph) * 2) * 0.6 * (1 - Math.exp(-t / 0.0006)) * Math.exp(-t / 0.018);
          b.L[i] += v * gl; b.R[i] += v * gr;
        }
      });
      return b;
    }
    case "tick": {
      const b = makeBuf(0.06);
      const f = new SVF(), g = new SVF();
      const fc = mix(1500, 6000, s.b);
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const w = rnd() * 2 - 1;
        const v = f.run(w, fc, 2.2).bp * Math.exp(-t / 0.0025) + g.run(w, fc * 0.45, 3).bp * Math.exp(-t / 0.006) * 0.5;
        b.L[i] = v * (1 - Math.exp(-t / 0.0002)); b.R[i] = b.L[i];
      }
      return b;
    }
  }
};
