/**
 * Music analysis for beat-synced edits: tempo, beat grid, strong onsets, loudness curve.
 * Pure JS on top of an ffmpeg decode (mono, 22050 Hz, f32le).
 */
import { runBinary } from "./probe";

export type AudioAnalysis = {
  /** seconds */
  duration: number;
  /** estimated tempo (70–180) */
  bpm: number;
  /** 0..1, how periodic the onsets are (low = no clear beat; treat bpm/beats as rough) */
  beatConfidence: number;
  /** beat times in seconds (tracked grid that snaps to strong onsets) */
  beats: number[];
  /** times (s) of the strongest onsets (hits, drops, accents), sorted by time */
  onsets: number[];
  /** normalized loudness 0..1 sampled at 2 Hz (index i = time i*0.5s) */
  energyCurve: number[];
  /** convenience: biggest sustained rise in loudness (likely "drop"), seconds, or null */
  dropAt: number | null;
};

const SR = 22050;
const FRAME = 1024;
const HOP = 512;

/** In-place radix-2 FFT. */
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
};

const decode = async (file: string): Promise<Float32Array> => {
  const buf = await runBinary(
    "ffmpeg",
    ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
    1024 * 1024 * 1024,
  );
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab, 0, Math.floor(buf.byteLength / 4));
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const analyzeAudio = async (filePath: string): Promise<AudioAnalysis> => {
  const x = await decode(filePath);
  const duration = x.length / SR;
  const hopT = HOP / SR;
  const nFrames = Math.max(0, Math.floor((x.length - FRAME) / HOP) + 1);

  // --- onset envelope: spectral flux on log-compressed magnitudes (half-wave rectified)
  const win = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const bins = FRAME / 2;
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  const env = new Float64Array(nFrames);
  // Separate low-band (< ~200 Hz) flux so kicks count as much as broadband hats/snares.
  const envLow = new Float64Array(nFrames);
  const lowBins = Math.max(2, Math.round((200 * FRAME) / SR));
  const rms = new Float64Array(nFrames);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = x[off + i];
      e += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / FRAME);
    fft(re, im);
    let flux = 0;
    let lowFlux = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) {
        flux += d;
        if (k <= lowBins) lowFlux += d;
      }
    }
    env[f] = f === 0 ? flux * 0.5 : flux;
    envLow[f] = f === 0 ? lowFlux * 0.5 : lowFlux;
    [prev, cur] = [cur, prev];
  }

  // Normalize each band: subtract a local mean (~0.5s), rectify, scale by std; then sum the bands.
  const localW = Math.max(1, Math.round(0.25 / hopT));
  const normalizeEnv = (e: Float64Array): Float64Array => {
    const o = new Float64Array(nFrames);
    const pre = new Float64Array(nFrames + 1);
    for (let i = 0; i < nFrames; i++) pre[i + 1] = pre[i] + e[i];
    for (let i = 0; i < nFrames; i++) {
      const a = Math.max(0, i - localW), b = Math.min(nFrames, i + localW + 1);
      o[i] = Math.max(0, e[i] - (pre[b] - pre[a]) / (b - a));
    }
    let mean = 0;
    for (const v of o) mean += v;
    mean /= nFrames || 1;
    let sd = 0;
    for (const v of o) sd += (v - mean) ** 2;
    sd = Math.sqrt(sd / (nFrames || 1));
    if (sd < 1e-9) return o.fill(0);
    for (let i = 0; i < nFrames; i++) o[i] /= sd;
    return o;
  };
  const onset = new Float64Array(nFrames);
  {
    const full = normalizeEnv(env);
    const low = normalizeEnv(envLow);
    for (let i = 0; i < nFrames; i++) onset[i] = 0.5 * (full[i] + low[i]);
  }

  // --- tempo: autocorrelation of the onset envelope over 70–180 BPM lags, with a mild 120 BPM prior
  const minLag = Math.max(1, Math.floor(60 / 180 / hopT));
  const maxLag = Math.ceil(60 / 70 / hopT);
  let bestLag = Math.round(60 / 120 / hopT);
  let bestScore = -Infinity;
  const ac = new Float64Array(maxLag + 2);
  let ac0 = 0;
  for (let i = 0; i < nFrames; i++) ac0 += onset[i] * onset[i];
  for (let lag = minLag; lag <= maxLag + 1 && lag < nFrames; lag++) {
    let s = 0;
    for (let i = lag; i < nFrames; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (nFrames - lag);
  }
  for (let lag = minLag; lag <= maxLag && lag < nFrames; lag++) {
    const bpm = 60 / (lag * hopT);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    // Reward lags whose multiples are also strong (stabilizes against half/double errors).
    const twice = 2 * lag < ac.length ? ac[2 * lag] : 0;
    const score = (ac[lag] + 0.5 * twice) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Parabolic refinement
  let lagF = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) lagF = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  }
  const bpm = nFrames > 4 ? Math.round((60 / (lagF * hopT)) * 10) / 10 : 0;
  const beatConfidence = ac0 > 0 ? Math.max(0, Math.min(1, ((ac[bestLag] * nFrames) / ac0) * 1.5)) : 0;

  // --- beat tracking: dynamic programming (Ellis 2007) — beats on strong onsets, spacing near the period
  const beats: number[] = [];
  if (nFrames > 4 && bpm > 0) {
    const period = lagF;
    const tightness = 100;
    const score = new Float64Array(nFrames);
    const back = new Int32Array(nFrames).fill(-1);
    const lo = Math.round(period / 2), hi = Math.round(period * 2);
    for (let t = 0; t < nFrames; t++) {
      let best = 0;
      let bi = -1;
      for (let p = t - hi; p <= t - lo; p++) {
        if (p < 0) continue;
        const pen = -tightness * Math.log((t - p) / period) ** 2;
        const v = score[p] + pen;
        if (bi === -1 || v > best) {
          best = v;
          bi = p;
        }
      }
      score[t] = onset[t] + (bi >= 0 ? Math.max(0, best) : 0);
      back[t] = bi >= 0 && best > 0 ? bi : -1;
    }
    // Start from the best-scoring frame in the last period.
    let t = nFrames - 1;
    let bestEnd = -Infinity;
    for (let i = Math.max(0, nFrames - Math.round(period)); i < nFrames; i++) {
      if (score[i] > bestEnd) {
        bestEnd = score[i];
        t = i;
      }
    }
    const frames: number[] = [];
    while (t >= 0) {
      frames.push(t);
      t = back[t];
    }
    frames.reverse();
    // Extend the grid backwards to the start if tracking began late.
    let first = frames[0] ?? 0;
    const tol = Math.round(0.05 / hopT);
    while (first - period >= -tol) {
      first = Math.max(0, first - period);
      frames.unshift(Math.round(first));
    }
    for (const f of frames) beats.push(r3(f * hopT + FRAME / 2 / SR));
  }
  // Refine tempo from the tracked grid (least-squares slope of beat time vs index).
  let bpmOut = bpm;
  if (beats.length >= 8) {
    const n = beats.length;
    const mx = (n - 1) / 2;
    const my = beats.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    beats.forEach((b, i) => { num += (i - mx) * (b - my); den += (i - mx) ** 2; });
    const slope = num / den;
    if (slope > 0 && Math.abs(60 / slope - bpm) / bpm < 0.08) bpmOut = Math.round((60 / slope) * 10) / 10;
  }

  // --- strong onsets: local maxima above an adaptive threshold, min spacing 100ms, top N by strength
  const peaks: { t: number; s: number }[] = [];
  const nb = Math.max(1, Math.round(0.05 / hopT));
  const minGap = 0.1;
  for (let i = 1; i < nFrames - 1; i++) {
    const v = onset[i];
    if (v < 1.5) continue;
    let isMax = true;
    for (let j = Math.max(0, i - nb); j <= Math.min(nFrames - 1, i + nb); j++) if (onset[j] > v) { isMax = false; break; }
    if (isMax) peaks.push({ t: i * hopT + FRAME / 2 / SR, s: v });
  }
  peaks.sort((a, b) => b.s - a.s);
  const maxOnsets = Math.min(200, Math.max(16, Math.round(duration * 2)));
  const chosen: { t: number; s: number }[] = [];
  for (const p of peaks) {
    if (chosen.length >= maxOnsets) break;
    if (chosen.every((c) => Math.abs(c.t - p.t) >= minGap)) chosen.push(p);
  }
  const onsets = chosen.map((c) => r3(c.t)).sort((a, b) => a - b);

  // --- loudness curve at 2 Hz (RMS in dB, normalized to 0..1 over a 50 dB range below the max)
  const per = Math.max(1, Math.round(0.5 / hopT));
  const db: number[] = [];
  for (let i = 0; i * 0.5 < duration; i++) {
    const a = Math.round((i * 0.5) / hopT);
    const b = Math.min(nFrames, a + per);
    let s = 0, n = 0;
    for (let j = a; j < b; j++) { s += rms[j] * rms[j]; n++; }
    db.push(n ? 10 * Math.log10(s / n + 1e-12) : -120);
  }
  const maxDb = db.length ? Math.max(...db) : 0;
  const energyCurve = db.map((d) => Math.round(Math.max(0, Math.min(1, (d - (maxDb - 50)) / 50)) * 100) / 100);

  // --- drop: largest increase of 2s-mean loudness vs. the preceding 4s
  let dropAt: number | null = null;
  let bestRise = 0.12;
  for (let i = 8; i + 4 <= energyCurve.length; i++) {
    const before = energyCurve.slice(i - 8, i).reduce((a, b) => a + b, 0) / 8;
    const after = energyCurve.slice(i, i + 4).reduce((a, b) => a + b, 0) / 4;
    if (after - before > bestRise) {
      bestRise = after - before;
      dropAt = i * 0.5;
    }
  }
  if (dropAt !== null) {
    // Snap to the nearest beat if close.
    const near = beats.reduce<number | null>((acc, b) => (Math.abs(b - dropAt!) < 0.5 && (acc === null || Math.abs(b - dropAt!) < Math.abs(acc - dropAt!)) ? b : acc), null);
    if (near !== null) dropAt = near;
  }

  return { duration: r3(duration), bpm: bpmOut, beatConfidence: Math.round(beatConfidence * 100) / 100, beats, onsets, energyCurve, dropAt };
};
