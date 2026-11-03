/**
 * Audio-reactive visuals driven by the film's real soundtrack: the music is decoded and analysed per frame (FFT),
 * mapped to log-spaced bands with a tilt so highs read as well as the bass, and drawn as spectrum bars with a
 * reflection, a mirrored equalizer, layered oscilloscope waves, a radial ring, a breathing liquid orb, or an LED
 * matrix with peak hold. Sampling uses the film clock (scene + layer offsets) and the music's `at` / `trimStart`,
 * so picture and sound stay locked in the Player and in renders. Before the music starts (or with no music) it idles.
 */
import React, { useId } from "react";
import { useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio, visualizeAudioWaveform, type MediaUtilsAudioData } from "@remotion/media-utils";
import type { z } from "zod";
import type { VisualizerLayer } from "../spec/schema";
import { useAsset, useColor, useRuntime } from "../core/context";
import { useFilmFrame } from "../core/filmClock";
import { alpha, mix } from "./surface";
import { visualizerBox } from "./visualizer/box";

type VL = z.infer<typeof VisualizerLayer>;
type Props = { layer: VL; t: number; duration: number };


const SAMPLES = 512;
const FLOOR_DB = -72, CEIL_DB = -4;

/** Band levels (0..1, log-spaced 40 Hz … 14 kHz) for a frame of decoded audio. */
const bandLevels = (audio: MediaUtilsAudioData, frame: number, fps: number, bands: number, gain: number, smoothing: boolean): number[] => {
  if (frame < 0) return new Array(bands).fill(0);
  const mags = visualizeAudio({ audioData: audio, frame, fps, numberOfSamples: SAMPLES, smoothing, optimizeFor: "speed" });
  const nyq = audio.sampleRate / 2;
  const lo = 40, hi = Math.min(14000, nyq * 0.95);
  const out: number[] = [];
  for (let b = 0; b < bands; b++) {
    const f0 = lo * Math.pow(hi / lo, b / bands), f1 = lo * Math.pow(hi / lo, (b + 1) / bands);
    let i0 = Math.floor((f0 / nyq) * mags.length), i1 = Math.ceil((f1 / nyq) * mags.length);
    i0 = Math.max(0, Math.min(mags.length - 1, i0)); i1 = Math.max(i0 + 1, Math.min(mags.length, i1));
    let m = 0;
    for (let i = i0; i < i1; i++) m = Math.max(m, mags[i]);
    const fc = Math.sqrt(f0 * f1);
    const db = 20 * Math.log10(m + 1e-9) + 2.5 * Math.log2(Math.max(1, fc / 120)); // tilt: music falls off toward the highs
    const v = Math.max(0, Math.min(1, ((db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)) * gain));
    out.push(Math.pow(v, 1.6));
  }
  return out;
};

/** Synthetic idle motion so a layer is never dead (before the music starts / without music). */
const idleLevels = (bands: number, t: number): number[] =>
  Array.from({ length: bands }, (_, b) => 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 2.1 + b * 0.55)) * (0.6 + 0.4 * Math.sin(t * 0.7 + b * 0.13)));

const bassOf = (lv: number[]) => { const n = Math.max(1, Math.round(lv.length * 0.12)); return lv.slice(0, n).reduce((a, v) => a + v, 0) / n; };

export const Visualizer: React.FC<Props> = (p) => {
  const rt = useRuntime();
  const src = p.layer.src ?? rt.music?.src;
  return src ? <WithAudio {...p} src={src} /> : <Draw {...p} levels={null} wave={null} history={null} />;
};

const WithAudio: React.FC<Props & { src: string }> = (p) => {
  const asset = useAsset();
  const rt = useRuntime();
  const { fps } = useVideoConfig();
  const film = useFilmFrame();
  const audio = useAudioData(asset(p.src));
  const own = !!p.layer.src;
  // the film's music starts at `at` (film time) and skips `trimStart` of the file; an explicit src plays from film 0
  const frame = film - (own ? 0 : Math.round((rt.music?.at ?? 0) * fps)) + (own ? 0 : Math.round((rt.music?.trimStart ?? 0) * fps));
  if (!audio || frame < 0 || frame / fps > audio.durationInSeconds) return <Draw {...p} levels={null} wave={null} history={null} />;
  const style = p.layer.style;
  const bands = p.layer.bars ?? (style === "circle" ? 96 : style === "dots" ? 24 : style === "orb" ? 32 : 48);
  const gain = p.layer.sensitivity ?? 1;
  const smoothing = p.layer.smoothing ?? true;
  const levels = bandLevels(audio, frame, fps, style === "circle" ? Math.ceil(bands / 2) : bands, gain, smoothing);
  const wave = style === "wave"
    ? [0, 2, 4].map((lag) => visualizeAudioWaveform({ audioData: audio, frame: Math.max(0, frame - lag), fps, windowInSeconds: 0.022, numberOfSamples: 64, normalize: true }))
    : null;
  // peak hold for the LED matrix: highest level over the last ~0.4 s, falling
  const history = style === "dots"
    ? Array.from({ length: 10 }, (_, k) => bandLevels(audio, frame - (k + 1) * 1, fps, bands, gain, smoothing).map((v) => v * (1 - (k + 1) * 0.07)))
    : null;
  return <Draw {...p} levels={levels} wave={wave} history={history} />;
};

const Draw: React.FC<Props & { levels: number[] | null; wave: number[][] | null; history: number[][] | null }> = ({ layer: l, t, levels, wave, history }) => {
  const color = useColor();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { w: W, h: H } = visualizerBox(l);
  const cols = (l.colors?.length ? l.colors : ["$accent", "$accent2"]).map((c) => color(c));
  const c0 = cols[0], c1 = cols[cols.length - 1];
  const at = (u: number) => { // color along the gradient, u 0..1
    if (cols.length === 1) return c0;
    const x = Math.max(0, Math.min(1, u)) * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(x));
    return mix(cols[i], cols[i + 1], x - i);
  };
  const glow = l.glow ?? true;
  const style = l.style;
  const bands = l.bars ?? (style === "circle" ? 96 : style === "dots" ? 24 : style === "orb" ? 32 : 48);
  const lv = levels ?? idleLevels(style === "circle" ? Math.ceil(bands / 2) : bands, t);
  const grad = (
    <linearGradient id={`${uid}g`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
      {cols.map((c, i) => <stop key={i} offset={`${(i / Math.max(1, cols.length - 1)) * 100}%`} style={{ stopColor: c }} />)}
    </linearGradient>
  );

  if (style === "bars" || style === "mirror") {
    const n = lv.length, slot = W / n, bw = Math.max(2, l.thickness ?? slot * 0.62);
    const mirror = style === "mirror";
    const base = mirror ? H / 2 : H * 0.74, maxH = mirror ? H * 0.92 : H * 0.7;
    const bars = lv.map((v, i) => {
      const h = Math.max(bw * 0.9, v * maxH);
      const x = i * slot + (slot - bw) / 2;
      return mirror
        ? <rect key={i} x={x} y={base - h / 2} width={bw} height={h} rx={bw / 2} />
        : <rect key={i} x={x} y={base - h} width={bw} height={h} rx={bw / 2} />;
    });
    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          {grad}
          <linearGradient id={`${uid}r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: "#fff", stopOpacity: 0.32 }} /><stop offset="70%" style={{ stopColor: "#fff", stopOpacity: 0 }} /></linearGradient>
          <mask id={`${uid}m`}><rect x={0} y={base} width={W} height={H - base} style={{ fill: `url(#${uid}r)` }} /></mask>
        </defs>
        {glow && <g style={{ fill: `url(#${uid}g)`, filter: `blur(${Math.max(6, bw * 0.9)}px)`, opacity: 0.55 }}>{bars}</g>}
        <g style={{ fill: `url(#${uid}g)` }}>{bars}</g>
        {!mirror && <g mask={`url(#${uid}m)`}><g transform={`translate(0 ${2 * base + 4}) scale(1 -1)`} style={{ fill: `url(#${uid}g)` }}>{bars}</g></g>}
      </svg>
    );
  }

  if (style === "wave") {
    const lines = wave ?? [0, 1, 2].map((k) => Array.from({ length: 96 }, (_, i) => 0.18 * Math.sin(i * 0.22 + t * 3 + k * 0.8) * Math.sin(i * 0.05 + t)));
    const loud = lv.reduce((a, v) => a + v, 0) / Math.max(1, lv.length);
    const amp = H * 0.42 * (l.sensitivity ?? 1) * (levels ? 0.25 + 0.95 * Math.min(1, loud * 1.6) : 1);
    const path = (vals: number[], scale: number) => {
      // light 3-tap smoothing keeps it liquid rather than jagged
      // + a sine envelope: the line tapers to the center at both ends (no dangling edge samples)
      const sm = vals.map((v, i) => ((2 * v + (vals[i - 1] ?? v) + (vals[i + 1] ?? v)) / 4) * Math.pow(Math.sin((Math.PI * i) / Math.max(1, vals.length - 1)), 0.8));
      const pts = sm.map((v, i) => [(i / (sm.length - 1)) * W, H / 2 + Math.max(-1, Math.min(1, v * 2.6)) * amp * scale] as [number, number]);
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; d += ` Q${x0},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2}`; }
      return d + ` L${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
    };
    const sw = l.thickness ?? 4;
    // fade the ends so the line emerges from nothing
    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          {grad}
          <linearGradient id={`${uid}f`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" style={{ stopColor: "#fff", stopOpacity: 0 }} /><stop offset="15%" style={{ stopColor: "#fff", stopOpacity: 1 }} /><stop offset="85%" style={{ stopColor: "#fff", stopOpacity: 1 }} /><stop offset="100%" style={{ stopColor: "#fff", stopOpacity: 0 }} /></linearGradient>
          <mask id={`${uid}e`}><rect x={-20} y={-H} width={W + 40} height={H * 3} style={{ fill: `url(#${uid}f)` }} /></mask>
        </defs>
        <g mask={`url(#${uid}e)`} style={{ fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }}>
          {lines.slice(1).reverse().map((vals, k) => <path key={k} d={path(vals, 0.75 - k * 0.2)} style={{ stroke: `url(#${uid}g)`, strokeWidth: sw * 0.6, opacity: 0.35 - k * 0.12 }} />)}
          {glow && <path d={path(lines[0], 1)} style={{ stroke: `url(#${uid}g)`, strokeWidth: sw * 3.5, opacity: 0.45, filter: `blur(${sw * 2}px)` }} />}
          <path d={path(lines[0], 1)} style={{ stroke: `url(#${uid}g)`, strokeWidth: sw }} />
        </g>
      </svg>
    );
  }

  if (style === "circle") {
    const half = lv.length;
    const R = l.radius ?? Math.min(W, H) * 0.27;
    const bass = bassOf(lv);
    const pulse = 1 + bass * 0.07;
    const sw = l.thickness ?? Math.max(3, (2 * Math.PI * R) / (half * 2) * 0.55);
    const rot = t * 8;
    const spokes: React.ReactNode[] = [];
    for (let k = 0; k < half * 2; k++) {
      const band = k < half ? k : half * 2 - 1 - k; // mirrored left / right
      const v = lv[band];
      const a = ((k / (half * 2)) * 360 + rot - 90) * (Math.PI / 180);
      const r0 = R * pulse, r1 = r0 + Math.max(sw * 0.6, v * R * 0.85);
      spokes.push(<line key={k} x1={W / 2 + Math.cos(a) * r0} y1={H / 2 + Math.sin(a) * r0} x2={W / 2 + Math.cos(a) * r1} y2={H / 2 + Math.sin(a) * r1}
        style={{ stroke: at(band / Math.max(1, half - 1)), strokeWidth: sw, strokeLinecap: "round" }} />);
    }
    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        {glow && <g style={{ filter: `blur(${sw * 2.2}px)`, opacity: 0.6 }}>{spokes}</g>}
        <g>{spokes}</g>
        <circle cx={W / 2} cy={H / 2} r={R * pulse * 0.93} style={{ fill: "none", stroke: alpha(c0, 0.35 + bass * 0.4), strokeWidth: 2 }} />
        <circle cx={W / 2} cy={H / 2} r={R * pulse * 0.88} style={{ fill: alpha(c0, 0.06 + bass * 0.1) }} />
      </svg>
    );
  }

  if (style === "orb") {
    const bass = bassOf(lv);
    const mid = lv.slice(Math.round(lv.length * 0.2), Math.round(lv.length * 0.6)).reduce((a, v) => a + v, 0) / Math.max(1, Math.round(lv.length * 0.4));
    const R = l.radius ?? Math.min(W, H) * 0.3;
    const blob = (phase: number, scale: number) => {
      const N = 48;
      const pts: [number, number][] = Array.from({ length: N }, (_, i) => {
        const a = (i / N) * Math.PI * 2;
        const wob = 0.05 * Math.sin(3 * a + t * 1.3 + phase) + 0.04 * Math.sin(5 * a - t * 1.7 + phase * 2) + mid * 0.12 * Math.sin(7 * a + t * 2.4 + phase);
        const r = R * scale * (1 + bass * 0.22 + wob);
        return [W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r];
      });
      // closed Catmull-Rom → cubic Béziers
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 0; i < N; i++) {
        const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
        d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
      }
      return d + "Z";
    };
    return (
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          <radialGradient id={`${uid}o`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" style={{ stopColor: mix(c0, "#ffffff", 0.55) }} /><stop offset="45%" style={{ stopColor: c0 }} /><stop offset="100%" style={{ stopColor: c1 }} />
          </radialGradient>
        </defs>
        {glow && <path d={blob(0, 1.05)} style={{ fill: c0, opacity: 0.45 + bass * 0.3, filter: `blur(${R * 0.35}px)` }} />}
        <path d={blob(1.7, 0.98)} style={{ fill: alpha(c1, 0.55), mixBlendMode: "screen" }} />
        <path d={blob(0, 0.92)} style={{ fill: `url(#${uid}o)` }} />
        <path d={blob(3.1, 0.55)} style={{ fill: alpha("#ffffff", 0.12 + mid * 0.2), mixBlendMode: "overlay" }} />
      </svg>
    );
  }

  // dots: LED matrix with peak hold
  const n = lv.length, rows = 12;
  const cw = W / n, rh = H / rows, r = Math.min(cw, rh) * 0.32;
  const peaks = history ? lv.map((v, i) => Math.max(v, ...history.map((h) => h[i] ?? 0))) : lv;
  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {Array.from({ length: n }, (_, i) => Array.from({ length: rows }, (_, k) => {
        const level = lv[i] * rows, on = k < level, peak = Math.min(rows - 1, Math.floor(peaks[i] * rows)) === k && !on;
        const c = at(k / (rows - 1));
        return <circle key={`${i}-${k}`} cx={i * cw + cw / 2} cy={H - (k + 0.5) * rh} r={r}
          style={{ fill: on || peak ? c : alpha(color("$fg"), 0.07), opacity: peak ? 0.7 : 1, filter: on && glow ? `drop-shadow(0 0 ${r * 1.4}px ${alpha(c, 0.8)})` : undefined }} />;
      }))}
    </svg>
  );
};
