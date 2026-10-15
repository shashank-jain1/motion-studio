import React from "react";
import { AbsoluteFill, Img, OffthreadVideo } from "remotion";
import { noise2D } from "@remotion/noise";
import type { Background } from "../spec/schema";
import { isVideoSrc, useAsset, useColor } from "../core/context";
import { useContainer } from "../core/container";
import { ShaderCanvas } from "./ShaderCanvas";
import { DEFAULT_SHADER_COLORS } from "./Shader";
import { Grain } from "./Fx";

/**
 * Scene backgrounds. A single background or an array (stacked bottom -> top).
 * All motion is a pure function of `t` (scene-local seconds).
 */
type Props = { bg: Background | Background[] | undefined; t: number; duration: number };
type Of<K extends Background["type"]> = Extract<Background, { type: K }>;
type One<K extends Background["type"]> = { bg: Of<K>; t: number; duration: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Same color at a given alpha (works with any resolved CSS color). */
const alpha = (c: string, a: number) => `color-mix(in srgb, ${c} ${Math.round(clamp01(a) * 1000) / 10}%, transparent)`;

// ---------------------------------------------------------------------------------------------

const Solid: React.FC<One<"solid">> = ({ bg }) => {
  const color = useColor();
  return <AbsoluteFill style={{ background: color(bg.color, "$bg") }} />;
};

const Gradient: React.FC<One<"gradient">> = ({ bg, t }) => {
  const color = useColor();
  const cols = bg.colors.map((c) => color(c)).join(", ");
  const spin = bg.spin ?? 0;
  if (bg.radial) {
    // A spinning radial gradient orbits its center gently.
    const a = ((spin * t) * Math.PI) / 180;
    const cx = 50 + (spin ? 14 * Math.cos(a) : 0);
    const cy = 50 + (spin ? 14 * Math.sin(a) : 0);
    return <AbsoluteFill style={{ background: `radial-gradient(circle at ${cx}% ${cy}%, ${cols})` }} />;
  }
  return <AbsoluteFill style={{ background: `linear-gradient(${(bg.angle ?? 135) + spin * t}deg, ${cols})` }} />;
};

/** Premium "mesh gradient": huge soft color fields drifting organically over a base color. */
const MESH_ANCHORS: [number, number][] = [[0.18, 0.22], [0.82, 0.18], [0.78, 0.82], [0.2, 0.8], [0.5, 0.5]];

const Mesh: React.FC<One<"mesh">> = ({ bg, t }) => {
  const color = useColor();
  const { width: W, height: H } = useContainer();
  const M = Math.max(W, H);
  const cols = bg.colors.map((c) => color(c));
  const n = Math.min(5, Math.max(3, cols.length));
  const T = t * (bg.speed ?? 1);
  return (
    <AbsoluteFill style={{ background: color(bg.base, "$bg"), overflow: "hidden" }}>
      {Array.from({ length: n }, (_, i) => {
        const c = cols[i % cols.length];
        const [ax, ay] = MESH_ANCHORS[i];
        const nx = noise2D(`mesh-x-${i}`, T * 0.11, i * 7.1);
        const ny = noise2D(`mesh-y-${i}`, T * 0.11, i * 7.1 + 3.3);
        const ns = noise2D(`mesh-s-${i}`, T * 0.09, i * 7.1 + 5.7);
        const D = M * (i === 4 ? 0.7 : 0.95) * (1 + 0.18 * ns);
        const cx = (ax + nx * 0.3) * W;
        const cy = (ay + ny * 0.3) * H;
        const stretch = 1 + 0.25 * noise2D(`mesh-e-${i}`, T * 0.08, i);
        const rot = 60 * noise2D(`mesh-r-${i}`, T * 0.05, i);
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: cx - D / 2, top: cy - D / 2, width: D, height: D, borderRadius: "50%",
              // eased falloff stops approximate a gaussian (no costly blur filter needed)
              background: `radial-gradient(circle closest-side, ${alpha(c, 1)} 0%, ${alpha(c, 0.86)} 18%, ${alpha(c, 0.6)} 38%, ${alpha(c, 0.3)} 58%, ${alpha(c, 0.1)} 78%, ${alpha(c, 0)} 100%)`,
              transform: `rotate(${rot}deg) scale(${stretch}, ${2 - stretch})`,
            }}
          />
        );
      })}
      {/* faint static grain: kills 8-bit banding on the big gradients */}
      <Grain opacity={0.04} seed={7} width={W} height={H} />
    </AbsoluteFill>
  );
};

const ShaderBg: React.FC<One<"shader">> = ({ bg, t }) => {
  const color = useColor();
  const { width, height } = useContainer();
  const colors = (bg.colors?.length ? bg.colors : DEFAULT_SHADER_COLORS).map((c) => color(c));
  return (
    <AbsoluteFill>
      <ShaderCanvas shader={bg.shader} colors={colors} speed={bg.speed} intensity={bg.intensity} width={width} height={height} t={t} />
    </AbsoluteFill>
  );
};

/** Flat grid (fading toward the edges) or a retro perspective floor rushing toward the camera. */
const Grid: React.FC<One<"grid">> = ({ bg, t }) => {
  const color = useColor();
  const { width: W, height: H } = useContainer();
  const base = color(bg.base, "$bg");
  const size = bg.size ?? 80;

  if (!bg.perspective) {
    const line = color(bg.color, "$fg");
    const off = t * (bg.speed ?? 0) * size;
    const mask = "radial-gradient(ellipse 75% 75% at 50% 50%, #000 35%, transparent 100%)";
    return (
      <AbsoluteFill style={{ background: base }}>
        <AbsoluteFill
          style={{
            opacity: bg.color ? 0.45 : 0.1,
            backgroundImage: `linear-gradient(${line} 1.5px, transparent 1.5px), linear-gradient(90deg, ${line} 1.5px, transparent 1.5px)`,
            backgroundSize: `${size}px ${size}px`,
            backgroundPosition: `${(W / 2) % size}px ${(((H / 2 + off) % size) + size) % size}px`,
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        />
      </AbsoluteFill>
    );
  }

  // Analytic perspective projection: screen y = horizon + A / z (z = 1 at the bottom edge).
  const line = color(bg.color, "$accent");
  const hy = H * 0.55;
  const A = H - hy;
  const sp = size * 1.6; // cell width at the bottom edge, px
  const dz = (0.6 * sp) / A;
  const phase = ((((t * (bg.speed ?? 1)) % 1) + 1) % 1);
  const rows: { y: number; o: number }[] = [];
  for (let k = 0; k < 400; k++) {
    const z = 1 + (k - phase) * dz;
    if (z <= 0.05) continue;
    const y = hy + A / z;
    if (y > H + 4) continue;
    const gap = (A * dz) / (z * z);
    if (gap < 2) break;
    rows.push({ y, o: clamp01((gap - 2) / 8) });
  }
  const sway = Math.sin(t * 0.4) * sp * 0.2;
  const J = Math.ceil((2 * W) / sp) + 2;
  const cols: number[] = [];
  for (let j = -J; j <= J; j++) cols.push(W / 2 + j * sp + sway);

  return (
    <AbsoluteFill style={{ background: base }}>
      {/* horizon glow */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 65% 30% at 50% ${(hy / H) * 100}%, ${alpha(line, 0.35)} 0%, ${alpha(line, 0.08)} 45%, ${alpha(line, 0)} 100%)` }} />
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, filter: `drop-shadow(0 0 6px ${alpha(line, 0.8)})` }}>
        <g stroke={line} strokeWidth={2} fill="none">
          {cols.map((x, i) => <line key={`v${i}`} x1={W / 2} y1={hy} x2={x} y2={H} />)}
          {rows.map((r, i) => <line key={`h${i}`} x1={0} y1={r.y} x2={W} y2={r.y} strokeOpacity={r.o} />)}
        </g>
      </svg>
      {/* depth haze: fades the grid into the horizon */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, top: hy - 1, height: A + 1,
          background: `linear-gradient(to bottom, ${base} 0%, ${alpha(base, 0.75)} 10%, ${alpha(base, 0.2)} 32%, ${alpha(base, 0)} 55%)`,
        }}
      />
      <div style={{ position: "absolute", left: 0, right: 0, top: hy - 1, height: 2, background: line, opacity: 0.55, boxShadow: `0 0 18px 2px ${line}` }} />
    </AbsoluteFill>
  );
};

const MediaBg: React.FC<One<"media">> = ({ bg, t, duration }) => {
  const asset = useAsset();
  const { width: W, height: H } = useContainer();
  const src = asset(bg.src);
  const blur = bg.blur ?? 0;
  const p = duration > 0 ? clamp01(t / duration) : 0;
  // overscale when blurred so the soft edges stay off-frame
  const blurScale = blur > 0 ? 1 + (blur * 3) / Math.min(W, H) : 1;
  const kb = bg.kenBurns ? ` scale(${1.04 + 0.1 * p}) translate(${-1.5 * p}%, ${-1 * p}%)` : "";
  const style: React.CSSProperties = {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
    transform: `scale(${blurScale})${kb}`,
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      {isVideoSrc(bg.src) ? <OffthreadVideo src={src} style={style} muted /> : <Img src={src} style={style} />}
      {(bg.dim ?? 0) > 0 && <AbsoluteFill style={{ background: "#000", opacity: clamp01(bg.dim ?? 0) }} />}
    </AbsoluteFill>
  );
};

/** Radial light pool at (x, y) px from the center over a base color, gently breathing. */
const Spotlight: React.FC<One<"spotlight">> = ({ bg, t }) => {
  const color = useColor();
  const { width: W, height: H } = useContainer();
  const base = color(bg.base, "$bg");
  const c = color(bg.color, "$accent");
  const x = W / 2 + (bg.x ?? 0);
  const y = H / 2 + (bg.y ?? 0);
  const r = (bg.size ?? Math.max(W, H) * 0.55) * (1 + 0.03 * Math.sin(t * 0.8));
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(circle ${r}px at ${x}px ${y}px, ${alpha(c, 0.75)} 0%, ${alpha(c, 0.4)} 28%, ${alpha(c, 0.12)} 62%, ${alpha(c, 0)} 100%)`,
          `radial-gradient(circle ${r * 2.2}px at ${x}px ${y}px, ${alpha(c, 0.14)} 0%, ${alpha(c, 0)} 100%)`,
          base,
        ].join(", "),
      }}
    />
  );
};

// ---------------------------------------------------------------------------------------------

const BackgroundOne: React.FC<{ bg: Background; t: number; duration: number }> = ({ bg, t, duration }) => {
  switch (bg.type) {
    case "solid": return <Solid bg={bg} t={t} duration={duration} />;
    case "gradient": return <Gradient bg={bg} t={t} duration={duration} />;
    case "mesh": return <Mesh bg={bg} t={t} duration={duration} />;
    case "shader": return <ShaderBg bg={bg} t={t} duration={duration} />;
    case "grid": return <Grid bg={bg} t={t} duration={duration} />;
    case "media": return <MediaBg bg={bg} t={t} duration={duration} />;
    case "spotlight": return <Spotlight bg={bg} t={t} duration={duration} />;
    default: return null;
  }
};

const DEFAULT_BG: Background = { type: "solid", color: "$bg" };

export const BackgroundView: React.FC<Props> = ({ bg, t, duration }) => {
  const list = bg === undefined ? [DEFAULT_BG] : Array.isArray(bg) ? (bg.length ? bg : [DEFAULT_BG]) : [bg];
  return (
    <>
      {list.map((b, i) => (
        <BackgroundOne key={i} bg={b} t={t} duration={duration} />
      ))}
    </>
  );
};
