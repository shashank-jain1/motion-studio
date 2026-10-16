/**
 * Procedural SFX library for Motion Studio (royalty-free: every sample is synthesized here, nothing is sampled).
 *
 *   pnpm gen:sfx            generate library/sfx/*.wav + manifest.json (skips when up to date)
 *   pnpm gen:sfx --force    regenerate everything
 *
 * Pure Node, no dependencies: seeded noise / oscillators / TPT state-variable filters / Freeverb, written as
 * 16-bit 48 kHz stereo PCM WAV (TPDF-dithered). Deterministic: the same GEN_VERSION produces identical files.
 *
 * Every sound has a documented `peakAt` (seconds from the file start to its transient / apex). The engine
 * (src/engine/audio/autoSound.ts) starts a cue at `event - peakAt` so the apex lands exactly on the cut / landing frame.
 * Loudness: each file is normalized to a max momentary loudness of TARGET_LUFS (BS.1770 K-weighted, 400 ms) with a
 * hard sample-peak ceiling of −1 dBFS; the engine then sets the hierarchy (impacts > whooshes > ticks) with volume.
 *
 * Imported at boot by the server / CLI / MCP server (`ensureSfxLibrary()`): generating the whole set takes well under
 * a few seconds, and nothing happens when the files already exist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIBRARY_DIR } from "../src/core/paths";
import { analyze } from "../src/engine/audio/dsp";

/** v4: manifest v2 entries (taxonomy category, analysis tags). The planner (autoSound v2) now builds most cues from
 * the recorded CC0 library + tunable synth LAYERS (src/engine/audio/synth.ts); these whole synthesized sounds remain
 * for manual `spec.sfx` / overrides ("sfx:<name>") and as fallbacks. */
export const GEN_VERSION = 4;
export const SFX_DIR = path.join(LIBRARY_DIR, "sfx");
export const MANIFEST_PATH = path.join(SFX_DIR, "manifest.json");

const SR = 48000;
const TARGET_LUFS = -16;
const PEAK_CEIL = Math.pow(10, -1 / 20); // −1 dBFS

export type Palette = "cinematic" | "tech" | "playful" | "minimal" | "luxury" | "hype";
export type SfxCategory = string;
export type SfxManifestEntry = {
  name: string;
  category: SfxCategory;
  palette: Palette[];
  durationSec: number;
  /** seconds from file start to the transient / apex that should land on the event */
  peakAt: number;
  description: string;
};
export type SfxManifest = { version: number; sampleRate: number; channels: 2; targetLufs: number; sounds: (SfxManifestEntry & Record<string, unknown>)[] };

/** v1 category → manifest v2 taxonomy + material. */
const TAXO: Record<string, (name: string) => { category: string; material: string[] }> = {
  whoosh: (n) => ({ category: /long|deep/.test(n) ? "whoosh.long" : /air/.test(n) ? "whoosh.medium" : "whoosh.short", material: ["air"] }),
  impact: (n) => ({ category: /deep|slam/.test(n) ? "impact.heavy" : /soft|thud/.test(n) ? "impact.light" : "impact.medium", material: ["synthetic"] }),
  riser: () => ({ category: "riser", material: ["air"] }),
  ui: (n) => ({ category: /click|tap/.test(n) ? "ui.click" : "ui.pop", material: ["digital"] }),
  tick: () => ({ category: "ui.tick", material: ["digital"] }),
  chime: () => ({ category: "magic.chime", material: ["glass"] }),
  glitch: () => ({ category: "digital.glitch", material: ["digital"] }),
  magic: (n) => ({ category: /morph/.test(n) ? "liquid.morph" : "magic.shimmer", material: ["glass"] }),
  foley: (n) => ({ category: /paper/.test(n) ? "foley.paper" : /typewriter/.test(n) ? "foley.typing" : /camera/.test(n) ? "foley.camera" : /cash/.test(n) ? "foley.coins" : "foley.misc", material: ["synthetic"] }),
  bass: () => ({ category: "sub.boom", material: ["air"] }),
};

// ------------------------------------------------------------------------------------------------- DSP primitives

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const expMix = (a: number, b: number, t: number) => a * Math.pow(b / a, t);
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** mulberry32 */
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hashName = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Topology-preserving-transform state-variable filter: stable under per-sample cutoff modulation. */
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  lp = 0; bp = 0; hp = 0;
  run(x: number, fc: number, q: number) {
    const g = Math.tan((Math.PI * clamp(fc, 10, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - k * v1 - v2;
    return this;
  }
}

/** Pink-ish noise (Paul Kellet's economy filter) from a white source. */
const pinkGen = (rnd: () => number) => {
  let b0 = 0, b1 = 0, b2 = 0;
  return () => {
    const w = rnd() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.25;
  };
};

type Buf = { L: Float32Array; R: Float32Array; n: number };
const makeBuf = (dur: number): Buf => { const n = Math.round(dur * SR); return { L: new Float32Array(n), R: new Float32Array(n), n }; };

/** Equal-power pan: p ∈ [-1, 1]. */
const panGains = (p: number): [number, number] => { const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };

/** Freeverb (Jezar) — 8 damped combs + 4 allpasses per channel, stereo spread. Adds wet into the buffer. */
const reverb = (buf: Buf, o: { room: number; damp: number; wet: number; predelay?: number; width?: number; dry?: number; hp?: number }) => {
  const scale = SR / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const spread = 23;
  const fb = 0.7 + 0.28 * clamp(o.room, 0, 1);
  const damp = clamp(o.damp, 0, 1) * 0.4;
  const pre = Math.round((o.predelay ?? 0.012) * SR);
  const width = o.width ?? 1;
  const mk = (off: number) => ({
    combs: combT.map((t) => ({ b: new Float32Array(Math.round((t + off) * scale)), i: 0, s: 0 })),
    aps: apT.map((t) => ({ b: new Float32Array(Math.round((t + off) * scale)), i: 0 })),
  });
  const chans = [mk(0), mk(spread)];
  const outL = new Float32Array(buf.n), outR = new Float32Array(buf.n);
  // send filter: keep sub energy out of the tank (a reverberated 40 Hz sine rings as a pitched drone)
  const send = new Float32Array(buf.n);
  const hpf = new SVF();
  for (let i = 0; i < buf.n; i++) { const m = (buf.L[i] + buf.R[i]) * 0.5; send[i] = o.hp ? hpf.run(m, o.hp, 0.7).hp : m; }
  for (let i = 0; i < buf.n; i++) {
    const j = i - pre;
    const input = j >= 0 ? send[j] * 0.03 : 0;
    const ys = [0, 0];
    for (let c = 0; c < 2; c++) {
      const ch = chans[c];
      let acc = 0;
      for (const cb of ch.combs) {
        const y = cb.b[cb.i];
        cb.s = y * (1 - damp) + cb.s * damp;
        cb.b[cb.i] = input + cb.s * fb;
        cb.i = (cb.i + 1) % cb.b.length;
        acc += y;
      }
      for (const ap of ch.aps) {
        const bo = ap.b[ap.i];
        const y = -acc + bo;
        ap.b[ap.i] = acc + bo * 0.5;
        ap.i = (ap.i + 1) % ap.b.length;
        acc = y;
      }
      ys[c] = acc;
    }
    const w1 = o.wet * (width / 2 + 0.5), w2 = o.wet * ((1 - width) / 2);
    outL[i] = ys[0] * w1 + ys[1] * w2;
    outR[i] = ys[1] * w1 + ys[0] * w2;
  }
  const dry = o.dry ?? 1;
  for (let i = 0; i < buf.n; i++) { buf.L[i] = buf.L[i] * dry + outL[i]; buf.R[i] = buf.R[i] * dry + outR[i]; }
};

const saturate = (buf: Buf, drive: number) => {
  if (drive <= 0) return;
  const k = 1 + drive, norm = 1 / Math.tanh(k);
  for (let i = 0; i < buf.n; i++) { buf.L[i] = Math.tanh(buf.L[i] * k) * norm; buf.R[i] = Math.tanh(buf.R[i] * k) * norm; }
};

/** Raised-cosine fade in/out at the file edges (no clicks), plus a DC blocker. */
const finish = (buf: Buf, fadeInMs = 0.6, fadeOutMs = 12) => {
  for (const ch of [buf.L, buf.R]) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < buf.n; i++) { const y = ch[i] - x1 + 0.9995 * y1; x1 = ch[i]; y1 = y; ch[i] = y; }
  }
  const fi = Math.max(1, Math.round((fadeInMs / 1000) * SR)), fo = Math.max(1, Math.round((fadeOutMs / 1000) * SR));
  for (let i = 0; i < Math.min(fi, buf.n); i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fi); buf.L[i] *= g; buf.R[i] *= g; }
  for (let i = 0; i < Math.min(fo, buf.n); i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fo); buf.L[buf.n - 1 - i] *= g; buf.R[buf.n - 1 - i] *= g; }
};

// ------------------------------------------------------------------------------------------------- loudness

/** BS.1770 K-weighting at 48 kHz (pre-filter shelf + RLB high-pass). */
const kWeight = (x: Float32Array) => {
  const out = new Float64Array(x.length);
  const st = (b: number[], a: number[], src: ArrayLike<number>, dst: Float64Array) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < src.length; i++) {
      const y = b[0] * src[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = src[i]; y2 = y1; y1 = y; dst[i] = y;
    }
  };
  const tmp = new Float64Array(x.length);
  st([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x, tmp);
  st([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], tmp, out);
  return out;
};

/** Max momentary loudness (400 ms windows, 10 ms hop; windows extend into silence past the end, as ebur128 does). */
const maxMomentary = (buf: Buf) => {
  const zl = kWeight(buf.L), zr = kWeight(buf.R);
  const win = Math.round(0.4 * SR), hop = Math.round(0.01 * SR);
  const cl = new Float64Array(buf.n + 1), cr = new Float64Array(buf.n + 1);
  for (let i = 0; i < buf.n; i++) { cl[i + 1] = cl[i] + zl[i] * zl[i]; cr[i + 1] = cr[i] + zr[i] * zr[i]; }
  let best = -Infinity;
  for (let s = -win + hop; s < buf.n; s += hop) {
    const a = Math.max(0, s), b = Math.min(buf.n, s + win);
    const ms = (cl[b] - cl[a] + cr[b] - cr[a]) / win;
    if (ms > 0) best = Math.max(best, -0.691 + 10 * Math.log10(ms));
  }
  return best;
};

/** True peak (BS.1770-style 4× oversampling with a Hann-windowed sinc), so inter-sample overs are caught too. */
const peakOf = (buf: Buf) => {
  const OS = 4, TAPS = 12;
  const kern: number[][] = [];
  for (let ph = 1; ph < OS; ph++) {
    const k: number[] = [];
    for (let j = -TAPS + 1; j <= TAPS; j++) {
      const x = j - ph / OS;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / TAPS);
      k.push(x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) * w);
    }
    kern.push(k);
  }
  let p = 0;
  for (const ch of [buf.L, buf.R]) {
    for (let i = 0; i < buf.n; i++) {
      p = Math.max(p, Math.abs(ch[i]));
      for (const k of kern) {
        let acc = 0;
        for (let j = 0; j < k.length; j++) { const idx = i + j - TAPS + 1; if (idx >= 0 && idx < buf.n) acc += ch[idx] * k[j]; }
        p = Math.max(p, Math.abs(acc));
      }
    }
  }
  return p;
};

const normalize = (buf: Buf) => {
  const m = maxMomentary(buf);
  const p = peakOf(buf);
  const g = Math.min(Math.pow(10, (TARGET_LUFS - m) / 20), PEAK_CEIL / Math.max(1e-9, p));
  for (let i = 0; i < buf.n; i++) { buf.L[i] *= g; buf.R[i] *= g; }
};

/** Short-term envelope (5 ms RMS, mono), used to measure where the apex / transient actually lands. */
const measurePeak = (buf: Buf, kind: "apex" | "onset") => {
  const w = Math.round(0.005 * SR);
  let best = 0, bestI = 0;
  const env: number[] = [];
  for (let s = 0; s + w <= buf.n; s += w) {
    let acc = 0;
    for (let i = s; i < s + w; i++) { const m = (buf.L[i] + buf.R[i]) * 0.5; acc += m * m; }
    const v = Math.sqrt(acc / w);
    env.push(v);
    if (v > best) { best = v; bestI = env.length - 1; }
  }
  if (kind === "apex") return (bestI + 0.5) * (w / SR);
  const thr = best * 0.5;
  const i = env.findIndex((v) => v >= thr);
  return (Math.max(0, i) + 0.5) * (w / SR);
};

// ------------------------------------------------------------------------------------------------- building blocks

/** Asymmetric pass-by envelope: 1 at `peak`, Lorentzian-like flanks (slow approach, quicker departure). */
const passBy = (t: number, peak: number, wB: number, wA: number, pow = 1.5) => {
  const w = t < peak ? wB : wA;
  const d = (t - peak) / w;
  return 1 / Math.pow(1 + d * d, pow);
};

type WhooshOpts = {
  dur: number; peak: number; wB: number; wA: number;
  f0: number; f1: number; f2: number; q: number;
  panFrom?: number; panTo?: number; width?: number;
  air?: number; rumble?: number; whistle?: number; pink?: boolean; pow?: number;
  verb?: { room: number; damp: number; wet: number };
};
const whoosh = (o: WhooshOpts, rnd: () => number): Buf => {
  const buf = makeBuf(o.dur);
  const pinkC = pinkGen(rnd), pinkL = pinkGen(rnd), pinkR = pinkGen(rnd);
  const white = () => rnd() * 2 - 1;
  const fl = [new SVF(), new SVF()], body = [new SVF(), new SVF()], air = [new SVF(), new SVF()], rum = new SVF();
  const width = o.width ?? 0.6;
  let ph = 0, phW = 0;
  const tail = Math.max(0.03, (o.dur - o.peak) * 0.3);
  for (let i = 0; i < buf.n; i++) {
    const t = i / SR;
    const edgeIn = smooth(t / Math.min(0.03, o.peak * 0.5 + 1e-3));
    const edgeOut = smooth((o.dur - t) / tail);
    const a = passBy(t, o.peak, o.wB, o.wA, o.pow ?? 1.5) * edgeIn * edgeOut;
    // doppler: the filter apex sits slightly before the amplitude apex
    const aF = passBy(t + 0.012, o.peak, o.wB, o.wA * 0.8, 1.2);
    const fc = t < o.peak ? expMix(o.f0, o.f1, aF) : expMix(o.f2, o.f1, aF);
    const nC = o.pink ? pinkC() * 2.2 : white();
    const nL = o.pink ? pinkL() * 2.2 : white();
    const nR = o.pink ? pinkR() * 2.2 : white();
    const srcs = [nC * (1 - width) + nL * width, nC * (1 - width) + nR * width];
    const pan = mix(o.panFrom ?? -0.6, o.panTo ?? 0.6, 1 / (1 + Math.exp(-(t - o.peak) / (0.18 * (o.wB + o.wA)))));
    const [gl, gr] = panGains(pan * 0.8);
    const out = [0, 0];
    for (let c = 0; c < 2; c++) {
      const bp = fl[c].run(srcs[c], fc, o.q).bp;
      const lp = body[c].run(srcs[c], fc * 0.55, 0.7).lp;
      const hi = air[c].run(srcs[c], 7000, 0.7).hp;
      out[c] = (bp * 0.9 + lp * 0.45) * a + hi * (o.air ?? 0) * a * a;
    }
    let mono = 0;
    if (o.rumble) {
      ph += (TAU * mix(52, 38, clamp(t / o.dur, 0, 1))) / SR;
      mono += (Math.sin(ph) * 0.6 + rum.run(nC, 140, 0.8).lp * 2.5) * o.rumble * Math.pow(a, 1.3);
    }
    if (o.whistle) {
      phW += (TAU * fc * 0.5) / SR;
      mono += Math.sin(phW) * o.whistle * Math.pow(a, 2);
    }
    buf.L[i] = (out[0] + mono) * gl;
    buf.R[i] = (out[1] + mono) * gr;
  }
  if (o.verb) reverb(buf, o.verb);
  return buf;
};

type ImpactOpts = {
  dur: number;
  body?: { f0: number; f1: number; glide: number; decay: number; amp: number; attack?: number };
  sub?: { f: number; decay: number; amp: number };
  click?: { hz: number; decay: number; amp: number };
  crunch?: { hz: number; q: number; decay: number; amp: number };
  noise?: { lp: number; decay: number; amp: number; width?: number };
  drive?: number;
  verb?: { room: number; damp: number; wet: number; predelay?: number; hp?: number };
  at?: number;
};
const impactInto = (buf: Buf, o: ImpactOpts, rnd: () => number, gain = 1) => {
  const t0 = o.at ?? 0;
  const s0 = Math.round(t0 * SR);
  const fC = new SVF(), fCr = new SVF(), fNL = new SVF(), fNR = new SVF();
  let ph = 0, phS = 0;
  for (let i = s0; i < buf.n; i++) {
    const t = (i - s0) / SR;
    let m = 0;
    if (o.body) {
      const b = o.body;
      const f = b.f1 + (b.f0 - b.f1) * Math.exp(-t / b.glide);
      ph += (TAU * f) / SR;
      m += Math.sin(ph) * b.amp * (1 - Math.exp(-t / (b.attack ?? 0.0012))) * Math.exp(-t / b.decay);
    }
    if (o.sub) {
      phS += (TAU * o.sub.f) / SR;
      m += Math.sin(phS) * o.sub.amp * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / o.sub.decay);
    }
    const w = rnd() * 2 - 1;
    if (o.click) m += fC.run(w, o.click.hz, 0.8).hp * o.click.amp * (1 - Math.exp(-t / 0.0003)) * Math.exp(-t / o.click.decay);
    if (o.crunch) m += Math.tanh(fCr.run(w, o.crunch.hz, o.crunch.q).bp * 3) * o.crunch.amp * (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / o.crunch.decay);
    let l = m, r = m;
    if (o.noise) {
      const wd = o.noise.width ?? 0.7;
      const nl = w * (1 - wd) + (rnd() * 2 - 1) * wd, nr = w * (1 - wd) + (rnd() * 2 - 1) * wd;
      const e = o.noise.amp * (1 - Math.exp(-t / 0.0008)) * Math.exp(-t / o.noise.decay);
      l += fNL.run(nl, o.noise.lp, 0.7).lp * e;
      r += fNR.run(nr, o.noise.lp, 0.7).lp * e;
    }
    buf.L[i] += l * gain;
    buf.R[i] += r * gain;
  }
};
const impact = (o: ImpactOpts, rnd: () => number): Buf => {
  const buf = makeBuf(o.dur);
  impactInto(buf, o, rnd);
  saturate(buf, o.drive ?? 0.6);
  if (o.verb) reverb(buf, { hp: 220, ...o.verb });
  return buf;
};

/** A struck bell / glass / metal note: inharmonic partials with individual decays. */
type Partial = [ratio: number, amp: number, decay: number];
const BELL: Partial[] = [[1, 1, 0.9], [2.0, 0.45, 0.6], [2.76, 0.32, 0.45], [5.4, 0.16, 0.22], [8.93, 0.08, 0.12]];
const GLASS: Partial[] = [[1, 1, 0.7], [2.32, 0.4, 0.4], [4.25, 0.22, 0.25], [6.63, 0.1, 0.12]];
const METAL: Partial[] = [[1, 1, 0.35], [1.47, 0.7, 0.28], [2.09, 0.55, 0.22], [2.56, 0.4, 0.18], [3.37, 0.3, 0.12]];
const SOFT: Partial[] = [[1, 1, 0.25], [2, 0.15, 0.12], [3, 0.05, 0.08]];
const note = (buf: Buf, at: number, freq: number, amp: number, partials: Partial[], pan = 0, decayMul = 1, attack = 0.002) => {
  const s0 = Math.round(at * SR);
  const [gl, gr] = panGains(pan);
  const phs = partials.map(() => 0);
  const maxDecay = Math.max(...partials.map((p) => p[2])) * decayMul;
  const end = Math.min(buf.n, s0 + Math.round(maxDecay * 7 * SR));
  for (let i = Math.max(0, s0); i < end; i++) {
    const t = (i - s0) / SR;
    const att = 1 - Math.exp(-t / attack);
    let v = 0;
    partials.forEach(([r, a, d], k) => {
      const f = freq * r;
      if (f > SR * 0.45) return;
      phs[k] += (TAU * f) / SR;
      v += Math.sin(phs[k]) * a * Math.exp(-t / (d * decayMul));
    });
    v *= amp * att;
    buf.L[i] += v * gl;
    buf.R[i] += v * gr;
  }
};
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Short filtered-noise burst (clicks, snaps, ticks, paper grains). */
const burst = (buf: Buf, rnd: () => number, at: number, o: { hz: number; q: number; decay: number; amp: number; mode?: "bp" | "hp" | "lp"; pan?: number; attack?: number }) => {
  const s0 = Math.round(at * SR);
  const f = new SVF();
  const [gl, gr] = panGains(o.pan ?? 0);
  const end = Math.min(buf.n, s0 + Math.round(o.decay * 8 * SR));
  for (let i = Math.max(0, s0); i < end; i++) {
    const t = (i - s0) / SR;
    const r = f.run(rnd() * 2 - 1, o.hz, o.q);
    const v = (o.mode === "hp" ? r.hp : o.mode === "lp" ? r.lp : r.bp) * o.amp * (1 - Math.exp(-t / (o.attack ?? 0.0002))) * Math.exp(-t / o.decay);
    buf.L[i] += v * gl;
    buf.R[i] += v * gr;
  }
};

/** Sine blip with an exponential pitch sweep (pops, bubbles, bleeps). */
const blip = (buf: Buf, at: number, o: { f0: number; f1: number; sweep: number; decay: number; amp: number; pan?: number; square?: number; attack?: number }) => {
  const s0 = Math.round(at * SR);
  const [gl, gr] = panGains(o.pan ?? 0);
  let ph = 0;
  const end = Math.min(buf.n, s0 + Math.round(o.decay * 8 * SR));
  for (let i = Math.max(0, s0); i < end; i++) {
    const t = (i - s0) / SR;
    const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / o.sweep);
    ph += (TAU * f) / SR;
    const s = Math.sin(ph);
    const w = o.square ? Math.tanh(s * (1 + o.square * 8)) : s;
    const v = w * o.amp * (1 - Math.exp(-t / (o.attack ?? 0.0015))) * Math.exp(-t / o.decay);
    buf.L[i] += v * gl;
    buf.R[i] += v * gr;
  }
};

const reverse = (buf: Buf) => { buf.L.reverse(); buf.R.reverse(); };

// ------------------------------------------------------------------------------------------------- recipes

type Recipe = Omit<SfxManifestEntry, "durationSec" | "peakAt" | "name"> & {
  /** designed apex / transient time (s) */
  peak: number;
  measure: "apex" | "onset";
  make: (rnd: () => number) => Buf;
};

const R: Record<string, Recipe> = {
  // ---------------- whooshes (length ≈ move length; apex = landing / cut frame)
  "whoosh-short": {
    category: "whoosh", palette: ["tech", "hype", "playful", "minimal"], peak: 0.26, measure: "apex",
    description: "Fast, tight air whoosh for quick moves and whip transitions (0.45 s).",
    make: (r) => whoosh({ dur: 0.45, peak: 0.26, wB: 0.075, wA: 0.05, f0: 500, f1: 3200, f2: 900, q: 1.1, air: 0.35, panFrom: -0.7, panTo: 0.7 }, r),
  },
  "whoosh-long": {
    category: "whoosh", palette: ["cinematic", "luxury"], peak: 0.72, measure: "apex",
    description: "Big, slow cinematic pass-by with a low body — long camera moves, scene transitions (1.1 s).",
    make: (r) => whoosh({ dur: 1.1, peak: 0.72, wB: 0.24, wA: 0.13, f0: 220, f1: 2200, f2: 380, q: 0.9, air: 0.2, rumble: 0.25, pink: true, panFrom: -0.8, panTo: 0.8, verb: { room: 0.6, damp: 0.5, wet: 0.18 } }, r),
  },
  "whoosh-air": {
    category: "whoosh", palette: ["minimal", "luxury", "cinematic"], peak: 0.42, measure: "apex",
    description: "Soft, breathy, high air whoosh — elegant slides and fades (0.7 s).",
    make: (r) => whoosh({ dur: 0.7, peak: 0.42, wB: 0.14, wA: 0.09, f0: 1400, f1: 5200, f2: 2000, q: 0.8, air: 0.6, width: 0.85, panFrom: -0.5, panTo: 0.5, verb: { room: 0.5, damp: 0.3, wet: 0.15 } }, r),
  },
  "whoosh-deep": {
    category: "whoosh", palette: ["cinematic", "hype"], peak: 0.6, measure: "apex",
    description: "Heavy whoosh with a sub rumble — zoom-throughs, big reveals, hype cuts (0.9 s).",
    make: (r) => whoosh({ dur: 0.9, peak: 0.6, wB: 0.17, wA: 0.09, f0: 160, f1: 1600, f2: 260, q: 1.0, rumble: 0.7, pink: true, air: 0.15, panFrom: -0.5, panTo: 0.5, verb: { room: 0.55, damp: 0.6, wet: 0.14 } }, r),
  },
  "swoosh-up": {
    category: "whoosh", palette: ["playful", "tech", "hype"], peak: 0.4, measure: "apex",
    description: "Rising swoosh (filter + whistle climb) that slams into its apex — zoom-into / leading into a cut (0.55 s).",
    make: (r) => whoosh({ dur: 0.55, peak: 0.4, wB: 0.12, wA: 0.035, f0: 400, f1: 5000, f2: 3000, q: 1.6, whistle: 0.12, air: 0.3, panFrom: -0.3, panTo: 0.3 }, r),
  },
  "swoosh-down": {
    category: "whoosh", palette: ["playful", "tech", "minimal"], peak: 0.14, measure: "apex",
    description: "Falling swoosh — drops, exits, things settling down (0.55 s).",
    make: (r) => whoosh({ dur: 0.55, peak: 0.14, wB: 0.045, wA: 0.13, f0: 2500, f1: 4200, f2: 300, q: 1.4, whistle: 0.1, air: 0.25, panFrom: 0.3, panTo: -0.3 }, r),
  },

  // ---------------- impacts (transient at ~0)
  "impact-deep": {
    category: "impact", palette: ["cinematic", "hype"], peak: 0.004, measure: "onset",
    description: "Trailer hit: sub drop + noise crack + long hall tail — logo lockups, hero slams (2.2 s).",
    make: (r) => impact({
      dur: 2.2, body: { f0: 120, f1: 36, glide: 0.09, decay: 0.55, amp: 1.0 }, click: { hz: 2500, decay: 0.006, amp: 0.7 },
      crunch: { hz: 700, q: 1.2, decay: 0.07, amp: 0.5 }, noise: { lp: 3500, decay: 0.18, amp: 0.7 }, drive: 1.2,
      verb: { room: 0.88, damp: 0.45, wet: 0.5, predelay: 0.015 },
    }, r),
  },
  "impact-punch": {
    category: "impact", palette: ["hype", "tech", "playful"], peak: 0.003, measure: "onset",
    description: "Tight, punchy hit (kick + crack) — camera punches, type slams on the beat (0.7 s).",
    make: (r) => impact({
      dur: 0.7, body: { f0: 190, f1: 52, glide: 0.035, decay: 0.16, amp: 1.0 }, click: { hz: 3500, decay: 0.004, amp: 0.8 },
      crunch: { hz: 1400, q: 1.5, decay: 0.035, amp: 0.55 }, noise: { lp: 6000, decay: 0.05, amp: 0.4 }, drive: 1.6,
      verb: { room: 0.35, damp: 0.5, wet: 0.16 },
    }, r),
  },
  "impact-soft": {
    category: "impact", palette: ["luxury", "minimal", "cinematic"], peak: 0.006, measure: "onset",
    description: "Rounded, polished low hit with a plate tail — match cuts, elegant landings (1.0 s).",
    make: (r) => impact({
      dur: 1.0, body: { f0: 95, f1: 55, glide: 0.05, decay: 0.22, amp: 1.0, attack: 0.003 }, noise: { lp: 1400, decay: 0.05, amp: 0.45 },
      click: { hz: 1800, decay: 0.003, amp: 0.15 }, drive: 0.5, verb: { room: 0.7, damp: 0.6, wet: 0.3 },
    }, r),
  },
  "thud-soft": {
    category: "impact", palette: ["minimal", "playful", "luxury"], peak: 0.005, measure: "onset",
    description: "Muffled felt thud — small type slams, objects landing (0.45 s).",
    make: (r) => impact({
      dur: 0.45, body: { f0: 130, f1: 68, glide: 0.03, decay: 0.09, amp: 1.0, attack: 0.002 }, noise: { lp: 900, decay: 0.03, amp: 0.6 }, drive: 0.8,
      verb: { room: 0.2, damp: 0.7, wet: 0.08 },
    }, r),
  },
  "hit-slam": {
    category: "impact", palette: ["hype", "tech", "cinematic"], peak: 0.003, measure: "onset",
    description: "Type slam: punchy low hit + bright snap layer, cuts through music (0.8 s).",
    make: (r) => {
      const b = impact({
        dur: 0.8, body: { f0: 160, f1: 48, glide: 0.045, decay: 0.2, amp: 1.0 }, click: { hz: 4200, decay: 0.008, amp: 0.9 },
        crunch: { hz: 2200, q: 1.0, decay: 0.03, amp: 0.7 }, noise: { lp: 9000, decay: 0.07, amp: 0.55, width: 0.9 }, drive: 1.8,
      }, r);
      reverb(b, { room: 0.55, damp: 0.4, wet: 0.22, hp: 250 });
      return b;
    },
  },
  "boom-sub": {
    category: "bass", palette: ["cinematic", "hype"], peak: 0.006, measure: "onset",
    description: "Long sub boom with rumble — camera shake, earthquakes, drops (2.6 s).",
    make: (r) => impact({
      dur: 2.6, body: { f0: 75, f1: 28, glide: 0.35, decay: 0.9, amp: 1.0, attack: 0.004 }, noise: { lp: 220, decay: 0.6, amp: 1.4, width: 0.5 },
      click: { hz: 900, decay: 0.008, amp: 0.25 }, drive: 1.4, verb: { room: 0.9, damp: 0.8, wet: 0.35, hp: 90 },
    }, r),
  },
  "drop-bass": {
    category: "bass", palette: ["hype", "tech"], peak: 0.004, measure: "onset",
    description: "808-style bass dive with saturation (audible on phone speakers) — beat drops, hype reveals (1.6 s).",
    make: (r) => {
      const b = impact({ dur: 1.6, body: { f0: 120, f1: 36, glide: 0.25, decay: 0.55, amp: 1.0, attack: 0.002 }, click: { hz: 2000, decay: 0.004, amp: 0.5 }, drive: 3.2 }, r);
      return b;
    },
  },

  // ---------------- risers / swells (apex at the END: they lead into the cut)
  "riser-short": {
    category: "riser", palette: ["hype", "tech", "cinematic"], peak: 0.97, measure: "apex",
    description: "1 s tension riser (noise + detuned pitch climb) that peaks on the cut — lead-ins, zoom-throughs.",
    make: (r) => riser(1.0, 0.97, r),
  },
  "riser-long": {
    category: "riser", palette: ["cinematic", "hype"], peak: 2.33, measure: "apex",
    description: "2.4 s build-up riser — long anticipation before a reveal or drop.",
    make: (r) => riser(2.4, 2.36, r),
  },
  "reverse-swell": {
    category: "riser", palette: ["cinematic", "luxury", "minimal"], peak: 1.3, measure: "apex",
    description: "Reverse cymbal/reverb swell sucking into the cut — expands, mask reveals, film burns (1.4 s).",
    make: (r) => {
      const b = makeBuf(1.4);
      // a cymbal-ish wash + chord strike, then reversed so the tail becomes a swell
      burst(b, r, 0.1, { hz: 7000, q: 0.6, decay: 0.35, amp: 0.8, mode: "hp" });
      note(b, 0.1, hz(57), 0.25, GLASS, -0.3, 1.2, 0.002);
      note(b, 0.1, hz(64), 0.2, GLASS, 0.3, 1.2, 0.002);
      reverb(b, { room: 0.92, damp: 0.35, wet: 0.7, dry: 1.4, predelay: 0.0 });
      reverse(b);
      // hard stop right after the apex (the silence after it is the effect)
      const cut = Math.round(1.33 * SR);
      for (let i = cut; i < b.n; i++) { const g = Math.max(0, 1 - (i - cut) / (0.012 * SR)); b.L[i] *= g; b.R[i] *= g; }
      return b;
    },
  },

  // ---------------- UI
  "click-ui": {
    category: "ui", palette: ["tech", "minimal", "luxury", "playful", "cinematic", "hype"], peak: 0.002, measure: "onset",
    description: "Crisp, small UI click — button presses, toggles (0.08 s).",
    make: (r) => {
      const b = makeBuf(0.08);
      burst(b, r, 0, { hz: 3200, q: 1.6, decay: 0.0025, amp: 1.0 });
      blip(b, 0, { f0: 1700, f1: 1200, sweep: 0.004, decay: 0.008, amp: 0.4, attack: 0.0003 });
      return b;
    },
  },
  "tap-soft": {
    category: "ui", palette: ["minimal", "luxury", "playful"], peak: 0.003, measure: "onset",
    description: "Soft, rounded fingertip tap — gentle UI moments, cards settling (0.12 s).",
    make: (r) => {
      const b = makeBuf(0.12);
      blip(b, 0, { f0: 520, f1: 300, sweep: 0.01, decay: 0.022, amp: 1.0, attack: 0.001 });
      burst(b, r, 0, { hz: 1500, q: 0.9, decay: 0.004, amp: 0.25, mode: "lp" });
      return b;
    },
  },
  "pop-bubble": {
    category: "ui", palette: ["playful", "minimal"], peak: 0.006, measure: "onset",
    description: "Round bubble pop (upward pitch bloop) — chat bubbles, stickers, checkmarks (0.18 s).",
    make: (r) => {
      const b = makeBuf(0.18);
      blip(b, 0, { f0: 260, f1: 980, sweep: 0.018, decay: 0.035, amp: 1.0, attack: 0.002 });
      burst(b, r, 0, { hz: 2500, q: 2, decay: 0.003, amp: 0.2 });
      reverb(b, { room: 0.2, damp: 0.5, wet: 0.1 });
      return b;
    },
  },
  "pop-snap": {
    category: "ui", palette: ["tech", "hype", "playful", "cinematic"], peak: 0.002, measure: "onset",
    description: "Dry finger-snap pop — checkmarks, icons snapping in, logo parts (0.14 s).",
    make: (r) => {
      const b = makeBuf(0.14);
      burst(b, r, 0, { hz: 2600, q: 2.2, decay: 0.009, amp: 1.0 });
      burst(b, r, 0, { hz: 6500, q: 1.0, decay: 0.004, amp: 0.4, mode: "hp" });
      blip(b, 0, { f0: 1500, f1: 900, sweep: 0.005, decay: 0.01, amp: 0.25 });
      reverb(b, { room: 0.25, damp: 0.4, wet: 0.12 });
      return b;
    },
  },
  "notification-ping": {
    category: "chime", palette: ["tech", "minimal", "playful", "luxury"], peak: 0.004, measure: "onset",
    description: "Two-tone phone notification ping — notification / toast cards (0.8 s).",
    make: (r) => {
      const b = makeBuf(0.8);
      note(b, 0, hz(81), 0.7, SOFT, -0.1, 1.2, 0.0015);
      note(b, 0.085, hz(88), 0.6, SOFT, 0.1, 1.6, 0.0015);
      reverb(b, { room: 0.45, damp: 0.4, wet: 0.16 });
      return b;
    },
  },

  // ---------------- counters
  "tick-mech": {
    category: "tick", palette: ["cinematic", "playful", "minimal", "luxury"], peak: 0.002, measure: "onset",
    description: "Mechanical counter / clock tick — number roll-ups (0.05 s).",
    make: (r) => {
      const b = makeBuf(0.05);
      burst(b, r, 0, { hz: 4200, q: 4, decay: 0.003, amp: 1.0 });
      burst(b, r, 0.0015, { hz: 1800, q: 3, decay: 0.002, amp: 0.4 });
      return b;
    },
  },
  "tick-digital": {
    category: "tick", palette: ["tech", "hype"], peak: 0.002, measure: "onset",
    description: "Short digital bleep tick — data counters, HUDs (0.05 s).",
    make: () => {
      const b = makeBuf(0.05);
      blip(b, 0, { f0: 2300, f1: 2200, sweep: 0.01, decay: 0.007, amp: 0.8, square: 0.5, attack: 0.0005 });
      return b;
    },
  },
  "ding-success": {
    category: "chime", palette: ["tech", "playful", "minimal", "hype"], peak: 0.004, measure: "onset",
    description: "Bright two-note success ding — counter reaching its final value, task done (1.4 s).",
    make: () => {
      const b = makeBuf(1.4);
      note(b, 0, hz(84), 0.8, BELL, -0.15, 0.7, 0.001);
      note(b, 0.07, hz(91), 0.65, BELL, 0.15, 0.8, 0.001);
      reverb(b, { room: 0.55, damp: 0.35, wet: 0.2 });
      return b;
    },
  },
  "chime-bright": {
    category: "chime", palette: ["luxury", "cinematic", "playful"], peak: 0.004, measure: "onset",
    description: "Glassy three-note chime with a shimmer tail — premium lockups, reveals (1.8 s).",
    make: () => {
      const b = makeBuf(1.8);
      note(b, 0, hz(76), 0.6, GLASS, -0.35, 1.3, 0.0015);
      note(b, 0.055, hz(80), 0.55, GLASS, 0.0, 1.3, 0.0015);
      note(b, 0.11, hz(83), 0.55, GLASS, 0.35, 1.5, 0.0015);
      note(b, 0.11, hz(95), 0.15, GLASS, 0.0, 1.5, 0.0015);
      reverb(b, { room: 0.8, damp: 0.25, wet: 0.35 });
      return b;
    },
  },

  // ---------------- glitch / data
  "glitch-crackle": {
    category: "glitch", palette: ["tech", "hype", "cinematic"], peak: 0.004, measure: "onset",
    description: "Digital crackle: gated bit-crushed noise and buzz fragments — glitch transitions & text (0.6 s).",
    make: (r) => {
      const b = makeBuf(0.6);
      let t = 0.0;
      const f = new SVF();
      while (t < 0.5) {
        const len = 0.012 + r() * 0.045;
        const kind = r();
        const pan = r() * 1.6 - 0.8;
        const [gl, gr] = panGains(pan);
        const amp = (0.6 + r() * 0.4) * (1 - t / 0.6);
        const crush = 2 + Math.floor(r() * 10);
        const fc = 600 + r() * 6000;
        const buzzF = 80 + r() * 600;
        const s0 = Math.round(t * SR), s1 = Math.min(b.n, Math.round((t + len) * SR));
        let held = 0;
        for (let i = s0; i < s1; i++) {
          const k = i - s0, L = s1 - s0;
          const g = Math.min(1, k / 24, (L - k) / 24) * amp;
          let v: number;
          if (kind < 0.45) { if (k % crush === 0) held = r() * 2 - 1; v = f.run(held, fc, 0.9).bp * 2; }
          else if (kind < 0.75) v = Math.sign(Math.sin((TAU * buzzF * k) / SR)) * 0.5;
          else v = Math.round((r() * 2 - 1) * 3) / 3 * 0.6;
          b.L[i] += v * g * gl; b.R[i] += v * g * gr;
        }
        t += len + (r() < 0.35 ? r() * 0.04 : 0.002);
      }
      return b;
    },
  },
  "glitch-stutter": {
    category: "glitch", palette: ["hype", "tech"], peak: 0.004, measure: "onset",
    description: "Tape-stop stutter: a buzzy chord grain repeated faster and faster — hype glitch cuts (0.5 s).",
    make: (r) => {
      const b = makeBuf(0.5);
      const grain = Math.round(0.055 * SR);
      const g = new Float32Array(grain);
      let p1 = 0, p2 = 0, p3 = 0;
      const f = new SVF();
      for (let i = 0; i < grain; i++) {
        p1 += (TAU * 110) / SR; p2 += (TAU * 164.8) / SR; p3 += (TAU * 220.5) / SR;
        const saw = ((p1 / TAU) % 1) * 2 - 1 + ((p2 / TAU) % 1) - 0.5 + ((p3 / TAU) % 1) - 0.5;
        g[i] = f.run(saw + (r() * 2 - 1) * 0.3, 2400, 1.2).lp;
      }
      let pos = 0, n = 0, len = grain;
      while (pos + 32 < b.n && n < 14) {
        const L = Math.min(len, b.n - pos);
        const pan = n % 2 ? 0.35 : -0.35;
        const [gl, gr] = panGains(pan);
        const amp = 1 - n * 0.045;
        for (let k = 0; k < L; k++) {
          const e = Math.min(1, k / 48, (L - k) / 48) * amp;
          const v = g[Math.floor((k * grain) / len) % grain] * e;
          b.L[pos + k] += v * gl; b.R[pos + k] += v * gr;
        }
        pos += L + Math.round(0.006 * SR);
        len = Math.max(Math.round(0.012 * SR), Math.round(len * 0.8));
        n++;
      }
      saturate(b, 1.0);
      return b;
    },
  },
  "data-burst": {
    category: "glitch", palette: ["tech", "hype"], peak: 0.004, measure: "onset",
    description: "Rapid computer bleeps (quantized random pitches) — scramble text, data, HUD builds (0.45 s).",
    make: (r) => {
      const b = makeBuf(0.45);
      const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91];
      let t = 0, k = 0;
      while (t < 0.38) {
        const m = scale[Math.floor(r() * scale.length)];
        blip(b, t, { f0: hz(m), f1: hz(m), sweep: 1, decay: 0.009, amp: 0.55 * (1 - t / 0.5), square: 0.6, pan: (k % 3 - 1) * 0.5, attack: 0.0006 });
        t += 0.022 + r() * 0.018;
        k++;
      }
      const lp = [new SVF(), new SVF()];
      for (let i = 0; i < b.n; i++) { b.L[i] = lp[0].run(b.L[i], 7000, 0.7).lp; b.R[i] = lp[1].run(b.R[i], 7000, 0.7).lp; }
      return b;
    },
  },

  // ---------------- magic
  shimmer: {
    category: "magic", palette: ["luxury", "cinematic", "minimal", "playful"], peak: 0.51, measure: "apex",
    description: "Airy shimmer cloud of glassy partials — logo draws, sparkles, magical reveals (1.4 s, apex 0.51 s).",
    make: (r) => {
      const b = makeBuf(1.4);
      const chord = [88, 91, 95, 96, 100, 103, 107];
      for (let k = 0; k < 26; k++) {
        const m = chord[Math.floor(r() * chord.length)] + (r() < 0.3 ? 12 : 0);
        const at = 0.05 + Math.pow(r(), 0.8) * 0.5;
        note(b, at, hz(m) * (1 + (r() - 0.5) * 0.004), 0.12 + r() * 0.1, [[1, 1, 0.25], [2.01, 0.2, 0.12]], r() * 1.6 - 0.8, 1, 0.012);
      }
      const n = makeBuf(1.4);
      burst(n, r, 0.05, { hz: 9000, q: 0.7, decay: 0.25, amp: 0.15, mode: "hp", attack: 0.25 });
      for (let i = 0; i < b.n; i++) { b.L[i] += n.L[i]; b.R[i] += n.R[i]; }
      reverb(b, { room: 0.85, damp: 0.2, wet: 0.45 });
      return b;
    },
  },
  "sparkle-up": {
    category: "magic", palette: ["playful", "luxury", "hype"], peak: 0.46, measure: "apex",
    description: "Rising arpeggio of tiny glints — confetti, bursts, success moments (0.9 s, apex 0.46 s).",
    make: (r) => {
      const b = makeBuf(0.9);
      const steps = [79, 83, 86, 88, 91, 95, 98, 100];
      steps.forEach((m, i) => note(b, i * 0.065, hz(m), 0.32 + i * 0.03, [[1, 1, 0.12], [2.76, 0.25, 0.05], [5.4, 0.1, 0.03]], i % 2 ? 0.45 : -0.45, 1, 0.001));
      burst(b, r, 0.0, { hz: 8000, q: 0.7, decay: 0.12, amp: 0.08, mode: "hp", attack: 0.2 });
      reverb(b, { room: 0.6, damp: 0.25, wet: 0.25 });
      return b;
    },
  },
  "morph-wobble": {
    category: "magic", palette: ["playful", "tech", "minimal", "cinematic", "luxury", "hype"], peak: 0.42, measure: "apex",
    description: "Liquid FM wobble with a filter sweep, apex at the moment the new shape forms — morphs, blobs (0.7 s).",
    make: (r) => {
      const b = makeBuf(0.7);
      let pc = 0, pm = 0;
      const f = [new SVF(), new SVF()];
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const a = passBy(t, 0.42, 0.13, 0.11, 1.4) * smooth(t / 0.02) * smooth((0.7 - t) / 0.08);
        const vib = Math.sin(TAU * mix(5, 14, t / 0.7) * t) * 0.06;
        const fcar = 190 * (1 + vib) * (1 + 0.6 * a);
        pc += (TAU * fcar) / SR;
        pm += (TAU * fcar * 1.5) / SR;
        const idx = 1.2 + 2.5 * a;
        const s = Math.sin(pc + idx * Math.sin(pm));
        const cut = 500 + 3500 * a;
        const n = (r() * 2 - 1) * 0.05;
        b.L[i] = f[0].run(s + n, cut, 2.5).lp * a;
        b.R[i] = f[1].run(s - n, cut * 1.04, 2.5).lp * a;
      }
      reverb(b, { room: 0.4, damp: 0.4, wet: 0.15 });
      return b;
    },
  },

  // ---------------- foley
  "slide-paper": {
    category: "foley", palette: ["minimal", "luxury", "playful", "cinematic"], peak: 0.2, measure: "apex",
    description: "Paper / card slide friction — slice transitions, cards sliding, page flips (0.45 s).",
    make: (r) => {
      const b = makeBuf(0.45);
      const f = [new SVF(), new SVF()], g = new SVF();
      const pink = pinkGen(r);
      let grit = 0;
      for (let i = 0; i < b.n; i++) {
        const t = i / SR;
        const a = passBy(t, 0.2, 0.08, 0.1, 1.6) * smooth(t / 0.015) * smooth((0.45 - t) / 0.06);
        if (i % 90 === 0) grit = 0.6 + r() * 0.4;
        const fric = g.run(r() * 2 - 1, 40, 0.7).lp * 6 + grit;
        const n = pink() * 3;
        b.L[i] = f[0].run(n, mix(1800, 3600, a), 0.9).bp * a * fric;
        b.R[i] = f[1].run(n * 0.9 + (r() * 2 - 1) * 0.1, mix(1900, 3700, a), 0.9).bp * a * fric;
      }
      return b;
    },
  },
  "typewriter-key": {
    category: "foley", palette: ["minimal", "cinematic", "playful"], peak: 0.002, measure: "onset",
    description: "Single typewriter key strike — typewriter text, one per character (0.09 s).",
    make: (r) => {
      const b = makeBuf(0.09);
      burst(b, r, 0, { hz: 2800, q: 2.2, decay: 0.004, amp: 1.0 });
      blip(b, 0, { f0: 260, f1: 200, sweep: 0.01, decay: 0.012, amp: 0.55 });
      note(b, 0.003, 6400, 0.06, [[1, 1, 0.02], [1.41, 0.6, 0.015]], 0.1, 1, 0.0005);
      return b;
    },
  },
  "camera-shutter": {
    category: "foley", palette: ["minimal", "playful", "cinematic", "luxury"], peak: 0.002, measure: "onset",
    description: "Mechanical camera shutter (two-blade click) — photo reveals, snapshots, flashes (0.25 s).",
    make: (r) => {
      const b = makeBuf(0.25);
      burst(b, r, 0, { hz: 3000, q: 2.5, decay: 0.006, amp: 1.0, pan: -0.1 });
      blip(b, 0, { f0: 900, f1: 500, sweep: 0.004, decay: 0.01, amp: 0.3 });
      burst(b, r, 0.012, { hz: 6000, q: 0.8, decay: 0.03, amp: 0.15, mode: "hp", attack: 0.01 });
      burst(b, r, 0.075, { hz: 2400, q: 2.5, decay: 0.007, amp: 0.8, pan: 0.1 });
      blip(b, 0.075, { f0: 700, f1: 450, sweep: 0.004, decay: 0.012, amp: 0.25 });
      reverb(b, { room: 0.2, damp: 0.5, wet: 0.08 });
      return b;
    },
  },
  "heartbeat-low": {
    category: "foley", palette: ["cinematic", "minimal"], peak: 0.006, measure: "onset",
    description: "Low lub-dub heartbeat — suspense, waiting beats, health/fitness (0.9 s; second beat at 0.28 s).",
    make: (r) => {
      const b = makeBuf(0.9);
      impactInto(b, { dur: 0.9, body: { f0: 70, f1: 44, glide: 0.04, decay: 0.08, amp: 1.0, attack: 0.004 }, noise: { lp: 300, decay: 0.03, amp: 0.4 } }, r);
      impactInto(b, { dur: 0.9, at: 0.28, body: { f0: 64, f1: 42, glide: 0.04, decay: 0.07, amp: 0.7, attack: 0.004 }, noise: { lp: 260, decay: 0.03, amp: 0.3 } }, r);
      saturate(b, 0.8);
      return b;
    },
  },
  "cash-register": {
    category: "foley", palette: ["playful", "hype", "tech"], peak: 0.004, measure: "onset",
    description: "Coin clink + small till bell — prices, savings, payments, sales counters (0.9 s).",
    make: (r) => {
      const b = makeBuf(0.9);
      note(b, 0, 2350, 0.5, METAL, -0.2, 1, 0.0005);
      note(b, 0.055, 2780, 0.42, METAL, 0.2, 1, 0.0005);
      burst(b, r, 0, { hz: 5000, q: 1.2, decay: 0.004, amp: 0.5 });
      note(b, 0.13, hz(93), 0.38, BELL, 0, 0.5, 0.001);
      reverb(b, { room: 0.35, damp: 0.3, wet: 0.14 });
      return b;
    },
  },
};

function riser(dur: number, peak: number, rnd: () => number): Buf {
  const b = makeBuf(dur);
  const f = [new SVF(), new SVF()];
  const ph = [0, 0, 0];
  const det = [1, 1.007, 0.993];
  const pink = [pinkGen(rnd), pinkGen(rnd)];
  for (let i = 0; i < b.n; i++) {
    const t = i / SR;
    const x = clamp(t / peak, 0, 1);
    const a = Math.pow(x, 2.2) * smooth(t / 0.05) * (t > peak ? Math.max(0, 1 - (t - peak) / 0.025) : 1);
    const fc = expMix(250, 9000, Math.pow(x, 1.6));
    const fp = expMix(180, 900, Math.pow(x, 1.4));
    let tone = 0;
    for (let k = 0; k < 3; k++) {
      ph[k] += (TAU * fp * det[k]) / SR;
      tone += (((ph[k] / TAU) % 1) * 2 - 1) / 3;
    }
    const trem = 1 + 0.25 * Math.sin(TAU * mix(4, 18, x) * t) * x;
    for (let c = 0; c < 2; c++) {
      const n = pink[c]() * 3;
      const v = f[c].run(n * 0.8 + tone * 0.35, fc, 1.2 + 2 * x).lp;
      (c ? b.R : b.L)[i] = v * a * trem;
    }
  }
  reverb(b, { room: 0.5, damp: 0.4, wet: 0.12 });
  return b;
}

// ------------------------------------------------------------------------------------------------- WAV + manifest

const writeWav = (file: string, buf: Buf, seed: number) => {
  const dither = rng(seed ^ 0x9e3779b9);
  const data = Buffer.alloc(buf.n * 4);
  for (let i = 0; i < buf.n; i++) {
    for (let c = 0; c < 2; c++) {
      const x = (c ? buf.R : buf.L)[i];
      const d = (dither() - dither()) / 32768; // TPDF, ±1 LSB
      const v = Math.round(clamp(x + d, -1, 1) * 32767);
      data.writeInt16LE(clamp(v, -32768, 32767), i * 4 + c * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, Buffer.concat([h, data]));
  fs.renameSync(tmp, file);
};

export const SFX_NAMES = Object.keys(R);

/** Synthesize one sound (normalized). Exposed for tests. */
export const synthesize = (name: string) => {
  const rec = R[name];
  if (!rec) throw new Error(`unknown sfx "${name}"`);
  const seed = hashName(name) ^ GEN_VERSION;
  const buf = rec.make(rng(seed));
  const dur = buf.n / SR;
  // long, gentle tail fade unless the apex sits at the very end (risers / swells cut hard on purpose)
  const fadeOut = rec.peak > dur * 0.8 ? 10 : Math.max(10, Math.min(180, dur * 1000 * 0.2));
  finish(buf, rec.measure === "onset" ? 0.15 : 0.6, fadeOut);
  normalize(buf);
  return { buf, seed, rec };
};

export const generateSfx = (opts: { outDir?: string; only?: string[]; log?: (s: string) => void } = {}): SfxManifest => {
  const outDir = opts.outDir ?? SFX_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const sounds: SfxManifest["sounds"] = [];
  for (const name of SFX_NAMES) {
    const { buf, seed, rec } = synthesize(name);
    const measured = measurePeak(buf, rec.measure);
    if (Math.abs(measured - rec.peak) > 0.03) opts.log?.(`[gen-sfx] ${name}: measured ${rec.measure} ${measured.toFixed(3)}s vs designed ${rec.peak}s`);
    if (!opts.only || opts.only.includes(name)) writeWav(path.join(outDir, `${name}.wav`), buf, seed);
    const a = analyze(buf);
    const tx = TAXO[rec.category](name);
    sounds.push({
      name, file: `${name}.wav`, source: "synth", category: tx.category as SfxCategory, material: tx.material, palette: rec.palette, palettes: rec.palette,
      durationSec: Math.round((buf.n / SR) * 1000) / 1000,
      // transients: the designed onset (sample-accurate by construction); apexes: the designed apex, verified above
      peakAt: Math.round(rec.peak * 1000) / 1000,
      weight: a.weight, speed: a.speed, brightness: a.brightness, tonal: a.tonal, ...(a.pitchHz && a.tonal ? { pitchHz: a.pitchHz } : {}),
      loudness: a.loudness, sharpness: a.sharpness, flatness: a.flatness, world: "abstract", emotions: [], group: name, license: "original",
      v1category: rec.category, description: rec.description,
    });
  }
  const manifest: SfxManifest = { version: GEN_VERSION, sampleRate: SR, channels: 2, targetLufs: TARGET_LUFS, sounds };
  const json = JSON.stringify(manifest, null, 2) + "\n";
  const mPath = path.join(outDir, "manifest.json");
  if (!fs.existsSync(mPath) || fs.readFileSync(mPath, "utf8") !== json) fs.writeFileSync(mPath, json);
  return manifest;
};

/** What is missing / stale in the library (empty = up to date). */
export const missingSfx = (outDir = SFX_DIR): string[] => {
  let version = -1;
  try { version = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")).version; } catch { /* missing */ }
  const stamp = path.join(outDir, `.v${GEN_VERSION}`);
  if (version !== GEN_VERSION || !fs.existsSync(stamp)) return [...SFX_NAMES];
  return SFX_NAMES.filter((n) => !fs.existsSync(path.join(outDir, `${n}.wav`)));
};

/**
 * Generate the library when files are missing or from an older generator version (fast: ~1 s). Safe to call on
 * every boot / render; never throws (a failure only means renders that use "sfx:" cues lack those files).
 */
export const ensureSfxLibrary = (opts: { force?: boolean; quiet?: boolean } = {}): { generated: number; ms: number } => {
  const t0 = Date.now();
  try {
    const missing = opts.force ? [...SFX_NAMES] : missingSfx();
    if (!missing.length) return { generated: 0, ms: 0 };
    const stale = missing.length === SFX_NAMES.length;
    generateSfx({ only: stale ? undefined : missing, log: opts.quiet ? undefined : (s) => console.error(s) });
    if (stale) {
      for (const f of fs.readdirSync(SFX_DIR)) if (/^\.v\d+$/.test(f)) fs.rmSync(path.join(SFX_DIR, f), { force: true });
      fs.writeFileSync(path.join(SFX_DIR, `.v${GEN_VERSION}`), "");
    }
    const ms = Date.now() - t0;
    if (!opts.quiet) console.error(`[motion-studio] sfx library: generated ${missing.length} sound(s) in ${ms} ms -> ${SFX_DIR}`);
    return { generated: missing.length, ms };
  } catch (e) {
    console.error(`[motion-studio] sfx library generation failed: ${(e as Error).message}`);
    return { generated: 0, ms: Date.now() - t0 };
  }
};

const isMain = (() => {
  try { return path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  const force = process.argv.includes("--force");
  const r = ensureSfxLibrary({ force });
  if (!r.generated) console.error(`[motion-studio] sfx library up to date (${SFX_NAMES.length} sounds in ${SFX_DIR}); use --force to regenerate`);
}
