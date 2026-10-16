/**
 * Shared, dependency-free audio DSP (pure: no fs, no DOM). Used by the synthesizer (scripts/gen-sfx.ts), the layer
 * generator (synth.ts), the cue baker (bake.ts) and the ingest analyzer (scripts/sfx-ingest.ts).
 *
 * All buffers are 48 kHz stereo Float32. Everything is deterministic (seeded noise only).
 */

export const SR = 48000;
export const TAU = Math.PI * 2;

export type Buf = { L: Float32Array; R: Float32Array; n: number };
export const makeBuf = (dur: number): Buf => { const n = Math.max(1, Math.round(dur * SR)); return { L: new Float32Array(n), R: new Float32Array(n), n }; };
export const bufFrom = (L: Float32Array, R: Float32Array): Buf => ({ L, R, n: L.length });

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const expMix = (a: number, b: number, t: number) => a * Math.pow(b / a, t);
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-12, g));
export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const midiOf = (f: number) => 69 + 12 * Math.log2(f / 440);

/** mulberry32 */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** FNV-1a 32-bit. */
export const hashStr = (s: string, seed = 2166136261) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Topology-preserving-transform state-variable filter: stable under per-sample cutoff modulation. */
export class SVF {
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
export const pinkGen = (rnd: () => number) => {
  let b0 = 0, b1 = 0, b2 = 0;
  return () => {
    const w = rnd() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.25;
  };
};

/** Equal-power pan: p ∈ [-1, 1] → [gainL, gainR] (unity at centre). */
export const panGains = (p: number): [number, number] => { const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };

export type VerbOpts = { room: number; damp: number; wet: number; predelay?: number; width?: number; dry?: number; hp?: number; lp?: number };
/** Freeverb (Jezar) — 8 damped combs + 4 allpasses per channel. Adds the wet signal into the buffer. */
export const reverb = (buf: Buf, o: VerbOpts) => {
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
  const hpf = new SVF(), lpf = new SVF();
  for (let i = 0; i < buf.n; i++) {
    let m = (buf.L[i] + buf.R[i]) * 0.5;
    if (o.hp) m = hpf.run(m, o.hp, 0.7).hp;
    if (o.lp) m = lpf.run(m, o.lp, 0.7).lp;
    send[i] = m;
  }
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

export const saturate = (buf: Buf, drive: number) => {
  if (drive <= 0) return;
  const k = 1 + drive, norm = 1 / Math.tanh(k);
  for (let i = 0; i < buf.n; i++) { buf.L[i] = Math.tanh(buf.L[i] * k) * norm; buf.R[i] = Math.tanh(buf.R[i] * k) * norm; }
};

/** Raised-cosine fade in/out at the file edges (no clicks), plus a DC blocker. */
export const finish = (buf: Buf, fadeInMs = 0.6, fadeOutMs = 12) => {
  for (const ch of [buf.L, buf.R]) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < buf.n; i++) { const y = ch[i] - x1 + 0.9995 * y1; x1 = ch[i]; y1 = y; ch[i] = y; }
  }
  fadeEdges(buf, fadeInMs, fadeOutMs);
};
export const fadeEdges = (buf: Buf, fadeInMs: number, fadeOutMs: number) => {
  const fi = Math.max(1, Math.round((fadeInMs / 1000) * SR)), fo = Math.max(1, Math.round((fadeOutMs / 1000) * SR));
  for (let i = 0; i < Math.min(fi, buf.n); i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fi); buf.L[i] *= g; buf.R[i] *= g; }
  for (let i = 0; i < Math.min(fo, buf.n); i++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fo); buf.L[buf.n - 1 - i] *= g; buf.R[buf.n - 1 - i] *= g; }
};

export const reverseBuf = (buf: Buf) => { buf.L.reverse(); buf.R.reverse(); };
export const scaleBuf = (buf: Buf, g: number) => { for (let i = 0; i < buf.n; i++) { buf.L[i] *= g; buf.R[i] *= g; } };

/** One-pole-pair (12 dB/oct) high/low-pass over the whole buffer, in place. */
export const filterBuf = (buf: Buf, kind: "hp" | "lp", fc: number, q = 0.707) => {
  const f = [new SVF(), new SVF()];
  for (let i = 0; i < buf.n; i++) {
    const l = f[0].run(buf.L[i], fc, q), r = f[1].run(buf.R[i], fc, q);
    buf.L[i] = kind === "hp" ? l.hp : l.lp;
    buf.R[i] = kind === "hp" ? r.hp : r.lp;
  }
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

/** Max momentary loudness, LUFS (400 ms windows, 10 ms hop; windows extend into silence past the end, as ebur128 does). */
export const maxMomentary = (buf: Buf) => {
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

/** True peak (4× oversampling with a Hann-windowed sinc), linear. */
export const truePeak = (buf: Buf) => {
  const OS = 4, TAPS = 12;
  const kern: Float64Array[] = [];
  for (let ph = 1; ph < OS; ph++) {
    const k = new Float64Array(2 * TAPS);
    for (let j = -TAPS + 1, m = 0; j <= TAPS; j++, m++) {
      const x = j - ph / OS;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / TAPS);
      k[m] = x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) * w;
    }
    kern.push(k);
  }
  let p = 0;
  for (const ch of [buf.L, buf.R]) {
    for (let i = 0; i < buf.n; i++) {
      const a = Math.abs(ch[i]);
      if (a > p) p = a;
      // only oversample around samples that could plausibly exceed the running max
      if (a < p * 0.7) continue;
      for (const k of kern) {
        let acc = 0;
        for (let j = 0; j < k.length; j++) { const idx = i + j - TAPS + 1; if (idx >= 0 && idx < buf.n) acc += ch[idx] * k[j]; }
        if (Math.abs(acc) > p) p = Math.abs(acc);
      }
    }
  }
  return p;
};

/** Gain so that the max momentary loudness hits `lufs`, never letting the true peak exceed `ceilDb`. Returns applied dB. */
export const normalize = (buf: Buf, lufs = -16, ceilDb = -1) => {
  const m = maxMomentary(buf);
  const p = truePeak(buf);
  const g = Math.min(dbToGain(lufs - m), dbToGain(ceilDb) / Math.max(1e-9, p));
  scaleBuf(buf, g);
  return gainToDb(g);
};

/** Soft safety limiter: a tanh knee above `ceil` (linear) so summed layers never clip. */
export const softLimit = (buf: Buf, ceil = 0.89) => {
  for (const ch of [buf.L, buf.R]) for (let i = 0; i < buf.n; i++) {
    const x = ch[i], a = Math.abs(x);
    if (a > ceil * 0.8) { const knee = ceil * 0.8; ch[i] = Math.sign(x) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee))); }
  }
};

// ------------------------------------------------------------------------------------------------- resampling

/**
 * Varispeed ("tape") resample by `ratio` (> 1 = faster & higher): pitch shifts by 12·log2(ratio) semitones and the length
 * scales by 1/ratio — exactly what ffmpeg `asetrate+aresample` does. Lanczos-4 interpolation with an anti-alias
 * cutoff when speeding up.
 */
export const varispeed = (buf: Buf, ratio: number): Buf => {
  if (Math.abs(ratio - 1) < 1e-4) return { L: buf.L.slice(), R: buf.R.slice(), n: buf.n };
  const n = Math.max(1, Math.floor(buf.n / ratio));
  const out: Buf = { L: new Float32Array(n), R: new Float32Array(n), n };
  const A = 4;
  const cut = Math.min(1, 1 / ratio); // normalized cutoff
  const lanczos = (x: number) => {
    if (x === 0) return 1;
    if (x <= -A || x >= A) return 0;
    const px = Math.PI * x;
    return (A * Math.sin(px) * Math.sin(px / A)) / (px * px);
  };
  const span = Math.ceil(A / cut);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    let l = 0, r = 0, wsum = 0;
    for (let j = i0 - span + 1; j <= i0 + span; j++) {
      if (j < 0 || j >= buf.n) continue;
      const w = lanczos((pos - j) * cut);
      l += buf.L[j] * w; r += buf.R[j] * w; wsum += w;
    }
    if (wsum !== 0) { out.L[i] = l / wsum; out.R[i] = r / wsum; }
  }
  return out;
};

/** Resample an arbitrary-rate buffer to 48 kHz (used when decoding WAVs at other rates). */
export const toSR = (L: Float32Array, R: Float32Array, rate: number): Buf => (rate === SR ? bufFrom(L, R) : varispeed(bufFrom(L, R), rate / SR));

// ------------------------------------------------------------------------------------------------- WAV

/** 16-bit PCM stereo 48 kHz WAV (TPDF-dithered, deterministic). */
export const encodeWav = (buf: Buf, seed = 1): Uint8Array => {
  const dither = rng(seed ^ 0x9e3779b9);
  const bytes = new Uint8Array(44 + buf.n * 4);
  const dv = new DataView(bytes.buffer);
  const w4 = (o: number, s: string) => { for (let i = 0; i < 4; i++) bytes[o + i] = s.charCodeAt(i); };
  w4(0, "RIFF"); dv.setUint32(4, 36 + buf.n * 4, true); w4(8, "WAVE");
  w4(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  w4(36, "data"); dv.setUint32(40, buf.n * 4, true);
  for (let i = 0; i < buf.n; i++) {
    for (let c = 0; c < 2; c++) {
      const x = (c ? buf.R : buf.L)[i];
      const d = (dither() - dither()) / 32768;
      dv.setInt16(44 + i * 4 + c * 2, clamp(Math.round(clamp(x + d, -1, 1) * 32767), -32768, 32767), true);
    }
  }
  return bytes;
};

/** Decode a PCM (8/16/24/32-bit int or 32-bit float) WAV of any rate / channel count into a 48 kHz stereo Buf. */
export const decodeWav = (bytes: Uint8Array): Buf => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let off = 12, fmt = 1, ch = 2, rate = SR, bits = 16, dataOff = -1, dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off), len = dv.getUint32(off + 4, true);
    if (id === "fmt ") { fmt = dv.getUint16(off + 8, true); ch = dv.getUint16(off + 10, true); rate = dv.getUint32(off + 12, true); bits = dv.getUint16(off + 22, true); if (fmt === 0xfffe) fmt = dv.getUint16(off + 32, true); }
    else if (id === "data") { dataOff = off + 8; dataLen = Math.min(len, bytes.length - dataOff); break; }
    off += 8 + len + (len & 1);
  }
  if (dataOff < 0) throw new Error("WAV without data chunk");
  const bps = bits / 8, frames = Math.floor(dataLen / (bps * ch));
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const read = (p: number) => {
    if (fmt === 3) return bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
    if (bits === 16) return dv.getInt16(p, true) / 32768;
    if (bits === 24) { const v = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16); return ((v << 8) >> 8) / 8388608; }
    if (bits === 32) return dv.getInt32(p, true) / 2147483648;
    return (bytes[p] - 128) / 128;
  };
  for (let i = 0; i < frames; i++) {
    const p = dataOff + i * bps * ch;
    L[i] = read(p);
    R[i] = ch > 1 ? read(p + bps) : L[i];
  }
  return toSR(L, R, rate);
};

// ------------------------------------------------------------------------------------------------- analysis

/** In-place radix-2 FFT. */
export const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
};

/** Mono RMS envelope with `winMs` windows (hop = window). */
export const envelope = (buf: Buf, winMs = 5) => {
  const w = Math.max(1, Math.round((winMs / 1000) * SR));
  const env: number[] = [];
  for (let s = 0; s < buf.n; s += w) {
    let acc = 0, k = 0;
    for (let i = s; i < Math.min(buf.n, s + w); i++, k++) { const m = (buf.L[i] + buf.R[i]) * 0.5; acc += m * m; }
    env.push(Math.sqrt(acc / Math.max(1, k)));
  }
  return { env, hop: w / SR };
};

/** Trim leading / trailing silence below `thrDb` relative to the peak (keeps `padMs` before the first sound). */
export const trimSilence = (buf: Buf, thrDb = -50, padMs = 4, tailPadMs = 30): Buf => {
  let peak = 0;
  for (let i = 0; i < buf.n; i++) peak = Math.max(peak, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  if (peak <= 0) return buf;
  const { env, hop } = envelope(buf, 2);
  const thr = peak * dbToGain(thrDb);
  const first = env.findIndex((v) => v * 1.41 >= thr);
  let last = env.length - 1;
  while (last > 0 && env[last] * 1.41 < thr) last--;
  const a = Math.max(0, Math.round((first * hop - padMs / 1000) * SR));
  const b = Math.min(buf.n, Math.round(((last + 1) * hop + tailPadMs / 1000) * SR));
  return { L: buf.L.slice(a, b), R: buf.R.slice(a, b), n: Math.max(1, b - a) };
};

export type Analysis = {
  duration: number;
  /** seconds from file start to the transient (impulsive sounds) or the loudness apex (swells / whooshes) */
  peakAt: number;
  kind: "transient" | "swell";
  attackMs: number;
  /** seconds from the apex until the envelope falls 30 dB below it, ×2 (a T60 estimate) */
  decay: number;
  /** max momentary loudness, LUFS */
  loudness: number;
  truePeakDb: number;
  /** spectral centroid around the apex, Hz */
  centroid: number;
  /** 0..1 (log scale 150 Hz → 9 kHz) */
  brightness: number;
  /** 0 = tonal, 1 = white noise */
  flatness: number;
  /** share of energy below 150 Hz */
  lowRatio: number;
  tonal: boolean;
  pitchHz?: number;
  /** 0..1 how heavy it feels (low band, long, dark) */
  weight: number;
  /** 0..1 how fast / snappy (short envelope, sharp attack) */
  speed: number;
  /** 0..1 transient sharpness (crest of the attack) */
  sharpness: number;
  /** side / mid energy, 0 = mono */
  width: number;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Analyze a (trimmed, normalized) sound. */
export const analyze = (buf: Buf): Analysis => {
  const duration = buf.n / SR;
  const { env, hop } = envelope(buf, 5);
  let max = 0, maxI = 0;
  env.forEach((v, i) => { if (v > max) { max = v; maxI = i; } });
  // attack: 10% → 90% of the max, measured on the rise into the max
  let i10 = 0;
  for (let i = maxI; i >= 0; i--) if (env[i] < max * 0.1) { i10 = i; break; }
  let i90 = maxI;
  for (let i = i10; i <= maxI; i++) if (env[i] >= max * 0.9) { i90 = i; break; }
  const attackMs = Math.max(0, (i90 - i10) * hop * 1000);
  const kind: Analysis["kind"] = attackMs <= 25 ? "transient" : "swell";
  let peakAt: number;
  if (kind === "transient") {
    // the onset: first window that reaches half the max on the way up
    let k = maxI;
    for (let i = i10; i <= maxI; i++) if (env[i] >= max * 0.5) { k = i; break; }
    peakAt = k * hop;
  } else {
    // apex of a 30 ms smoothed envelope
    const sm = env.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 3); j <= Math.min(env.length - 1, i + 3); j++) { s += env[j]; c++; } return s / c; });
    let b = 0, bi = 0;
    sm.forEach((v, i) => { if (v > b) { b = v; bi = i; } });
    peakAt = (bi + 0.5) * hop;
  }
  let iEnd = env.length - 1;
  for (let i = maxI; i < env.length; i++) if (env[i] < max * dbToGain(-30)) { iEnd = i; break; }
  const decay = (iEnd - maxI) * hop * 2;
  // sharpness: how much of the max is reached within 3 ms of the onset vs the following 50 ms average
  const on = Math.round(peakAt / hop);
  let post = 0, pc = 0;
  for (let i = on; i < Math.min(env.length, on + 10); i++) { post += env[i]; pc++; }
  const sharpness = clamp((max / Math.max(1e-9, post / Math.max(1, pc)) - 1) / 2 + (kind === "transient" ? 0.4 : 0), 0, 1);

  // spectrum around the apex (up to 8 × 2048-sample frames weighted by energy)
  const N = 2048;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const center = Math.round(peakAt * SR);
  const power = new Float64Array(N / 2);
  let frames = 0;
  for (let f = 0; f < 8; f++) {
    const s = center - N / 4 + f * (N / 2);
    if (s >= buf.n) break;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = j >= 0 && j < buf.n ? ((buf.L[j] + buf.R[j]) * 0.5) * win[i] : 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  let ptot = 0, pc2 = 0, low = 0, logSum = 0, lin = 0, cnt = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N, p = power[k] + 1e-18;
    ptot += p; pc2 += p * f;
    if (f < 150) low += p;
    if (f >= 60 && f <= 12000) { logSum += Math.log(p); lin += p; cnt++; }
  }
  const centroid = ptot > 0 ? pc2 / ptot : 1000;
  const flatness = cnt ? clamp(Math.exp(logSum / cnt) / (lin / cnt), 0, 1) : 1;
  const lowRatio = ptot > 0 ? low / ptot : 0;
  const brightness = clamp(Math.log(centroid / 150) / Math.log(9000 / 150), 0, 1);

  // pitch: normalized autocorrelation (YIN-style CMNDF) on 60 ms after the apex
  let pitchHz: number | undefined;
  let tonal = false;
  {
    const a = Math.min(buf.n - 1, center + Math.round(0.01 * SR));
    const W = Math.min(Math.round(0.06 * SR), buf.n - a);
    if (W > 1200 && frames) {
      const x = new Float64Array(W);
      for (let i = 0; i < W; i++) x[i] = (buf.L[a + i] + buf.R[a + i]) * 0.5;
      const minLag = Math.floor(SR / 2500), maxLag = Math.min(Math.floor(SR / 50), Math.floor(W / 2));
      const d = new Float64Array(maxLag + 1);
      let run = 0, best = 1, bestLag = 0;
      for (let tau = 1; tau <= maxLag; tau++) {
        let s = 0;
        for (let i = 0; i + tau < W; i++) { const df = x[i] - x[i + tau]; s += df * df; }
        run += s;
        d[tau] = run > 0 ? (s * tau) / run : 1;
        if (tau >= minLag && d[tau] < best) { best = d[tau]; bestLag = tau; if (best < 0.1) break; }
      }
      if (bestLag && best < 0.22 && flatness < 0.25) {
        // parabolic refinement
        let t = bestLag;
        if (bestLag > 1 && bestLag < maxLag) { const p0 = d[bestLag - 1], p1 = d[bestLag], p2 = d[bestLag + 1]; const den = p0 - 2 * p1 + p2; if (den) t = bestLag + clamp((0.5 * (p0 - p2)) / den, -0.5, 0.5); }
        pitchHz = SR / t;
        tonal = decay > 0.08;
      }
    }
  }
  // stereo width
  let mid = 0, side = 0;
  for (let i = 0; i < buf.n; i++) { const m = buf.L[i] + buf.R[i], s = buf.L[i] - buf.R[i]; mid += m * m; side += s * s; }
  const width = mid > 0 ? clamp(side / mid, 0, 1) : 0;

  const weight = clamp(0.42 * (1 - brightness) + 0.33 * Math.min(1, lowRatio * 3) + 0.25 * Math.min(1, (decay + duration) / 3), 0, 1);
  const envLenMs = Math.max(10, (attackMs + decay * 1000 * 0.5));
  const speed = clamp(1 - (Math.log10(envLenMs) - 1.3) / 1.7, 0, 1);
  return {
    duration: r3(duration), peakAt: r3(peakAt), kind, attackMs: Math.round(attackMs), decay: r3(decay),
    loudness: Math.round(maxMomentary(buf) * 10) / 10, truePeakDb: Math.round(gainToDb(truePeak(buf)) * 10) / 10,
    centroid: Math.round(centroid), brightness: Math.round(brightness * 100) / 100, flatness: Math.round(flatness * 1000) / 1000,
    lowRatio: Math.round(lowRatio * 1000) / 1000, tonal, ...(pitchHz ? { pitchHz: Math.round(pitchHz * 10) / 10 } : {}),
    weight: Math.round(weight * 100) / 100, speed: Math.round(speed * 100) / 100, sharpness: Math.round(sharpness * 100) / 100,
    width: Math.round(width * 100) / 100,
  };
};
