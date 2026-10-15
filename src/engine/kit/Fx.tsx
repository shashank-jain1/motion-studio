import React, { useId } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { noise2D } from "@remotion/noise";
import type { z } from "zod";
import type { FxSchema } from "../spec/schema";
import { useColor } from "../core/context";
import { useContainer } from "../core/container";

/**
 * Scene-level finishing effects (film grain, vignette, light leaks, letterbox, scanlines, flashes)
 * and an RGB-split chromatic aberration wrapper. Everything is a pure function of time.
 *
 * NOTE: grain / light leaks use mix-blend-mode, so FxOverlay must be rendered as a later SIBLING of the
 * scene content inside the same stacking context (don't wrap it in an element with z-index + position,
 * opacity, transform, filter or isolation, or the blend has no backdrop).
 */

type Fx = z.infer<typeof FxSchema>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** useId() output contains characters that break url(#id) references. */
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");
const alpha = (c: string, a: number) => `color-mix(in srgb, ${c} ${Math.round(clamp01(a) * 1000) / 10}%, transparent)`;

// ---------------------------------------------------------------------------------------------

/**
 * Film grain via SVG feTurbulence. Rendered at 1/`scale` resolution and scaled up (cheaper, more filmic).
 * `seed` should change per frame for animated grain. `opacity` is the final strength.
 */
export const Grain: React.FC<{
  opacity: number;
  seed: number;
  width: number;
  height: number;
  scale?: number;
  blend?: React.CSSProperties["mixBlendMode"];
}> = ({ opacity, seed, width, height, scale = 2, blend = "overlay" }) => {
  const id = "grain" + safeId(useId());
  if (opacity <= 0) return null;
  const w = Math.ceil(width / scale);
  const h = Math.ceil(height / scale);
  return (
    <svg
      width={w}
      height={h}
      style={{
        position: "absolute", left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "0 0",
        mixBlendMode: blend, opacity: clamp01(opacity), pointerEvents: "none",
      }}
    >
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency={0.8} numOctaves={2} seed={seed} stitchTiles="stitch" result="n" />
        {/* grayscale, fully opaque */}
        <feColorMatrix in="n" type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1" />
        {/* boost contrast around mid-gray */}
        <feComponentTransfer>
          <feFuncR type="linear" slope={2.4} intercept={-0.7} />
          <feFuncG type="linear" slope={2.4} intercept={-0.7} />
          <feFuncB type="linear" slope={2.4} intercept={-0.7} />
        </feComponentTransfer>
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
};

// ---------------------------------------------------------------------------------------------

/** Warm, drifting, flaring blobs of light, blended with screen. */
const LEAKS = [
  { color: "#ff6a00", x: 0.04, y: 0.25, ax: 0.2, ay: 0.25, size: 1.0 },
  { color: "#ff2d6f", x: 0.98, y: 0.8, ax: 0.18, ay: 0.2, size: 0.85 },
  { color: "#ffc14d", x: 0.62, y: 0.0, ax: 0.25, ay: 0.12, size: 0.75 },
];

const LightLeak: React.FC<{ amount: number; t: number; W: number; H: number }> = ({ amount, t, W, H }) => {
  const M = Math.max(W, H);
  const band = noise2D("leak-band", t * 0.12, 0);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {LEAKS.map((l, i) => {
        const nx = noise2D(`leak-x-${i}`, t * 0.15, i * 3);
        const ny = noise2D(`leak-y-${i}`, t * 0.15, i * 3 + 1);
        const flare = 0.55 + 0.45 * noise2D(`leak-a-${i}`, t * 0.4, i * 3 + 2);
        const D = l.size * M * (0.9 + 0.2 * flare);
        const cx = (l.x + l.ax * nx) * W;
        const cy = (l.y + l.ay * ny) * H;
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: cx - D / 2, top: cy - D / 2, width: D, height: D, borderRadius: "50%",
              background: `radial-gradient(circle closest-side, ${alpha(l.color, 0.95)} 0%, ${alpha(l.color, 0.55)} 30%, ${alpha(l.color, 0.18)} 62%, ${alpha(l.color, 0)} 100%)`,
              opacity: clamp01(amount * (0.55 + 0.6 * flare)),
              mixBlendMode: "screen",
            }}
          />
        );
      })}
      {/* a soft anamorphic streak sweeping across */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(100deg, rgba(255,150,80,0) 30%, rgba(255,150,80,0.32) 48%, rgba(255,210,150,0.4) 50%, rgba(255,150,80,0.32) 52%, rgba(255,150,80,0) 70%)",
          transform: `translateX(${band * W * 0.45}px)`,
          opacity: clamp01(amount * (0.35 + 0.35 * noise2D("leak-band-a", t * 0.3, 0))),
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------

const hasFx = (fx: Fx | undefined): fx is Fx =>
  !!fx &&
  ((fx.grain ?? 0) > 0 || (fx.vignette ?? 0) > 0 || (fx.lightLeak ?? 0) > 0 || (fx.letterbox ?? 0) > 0 ||
    (fx.scanlines ?? 0) > 0 || (fx.flashes?.length ?? 0) > 0);

/** Finishing effects drawn on top of a scene. (`fx.chromatic` is applied separately with ChromaticWrap.) */
export const FxOverlay: React.FC<{ fx: Fx | undefined; t: number; duration: number }> = ({ fx, t }) => {
  const frame = useCurrentFrame();
  const color = useColor();
  const box = useContainer();
  if (!hasFx(fx)) return null;
  const W = box.width;
  const H = box.height;

  const grain = fx.grain ?? 0;
  const vig = clamp01(fx.vignette ?? 0);
  const leak = fx.lightLeak ?? 0;
  const bars = clamp01(fx.letterbox ?? 0);
  const scan = fx.scanlines ?? 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {leak > 0 && <LightLeak amount={leak} t={t} W={W} H={H} />}

      {vig > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,0) 38%, rgba(0,0,0,${0.45 * vig}) 72%, rgba(0,0,0,${0.9 * vig}) 100%)`,
          }}
        />
      )}

      {grain > 0 && <Grain opacity={Math.min(1, grain * 0.5)} seed={(frame % 997) + 1} width={W} height={H} />}

      {scan > 0 && (
        <>
          <AbsoluteFill
            style={{
              backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,${0.55 * clamp01(scan)}) 0px, rgba(0,0,0,${0.55 * clamp01(scan)}) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)`,
            }}
          />
          {/* slow CRT roll bar */}
          <div
            style={{
              position: "absolute", left: 0, right: 0, height: "18%",
              top: `${(((t * 0.18) % 1.3) - 0.2) * 100}%`,
              background: `linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,${0.05 * clamp01(scan)}), rgba(255,255,255,0))`,
            }}
          />
        </>
      )}

      {fx.flashes?.map((f, i) => {
        const dur = f.duration ?? 0.35;
        const dt = t - f.at;
        const attack = 0.04;
        if (dt < -attack || dt > dur) return null;
        // quick ramp to the peak exactly at `at`, then fast decay to zero at `at + duration`
        const a = dt < 0 ? 1 + dt / attack : Math.pow(1 - dt / dur, 2.4);
        return <AbsoluteFill key={i} style={{ background: color(f.color, "#ffffff"), opacity: clamp01(a * (f.intensity ?? 0.85)) }} />;
      })}

      {bars > 0 && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${bars * 100}%`, background: "#000" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${bars * 100}%`, background: "#000" }} />
        </>
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------

/**
 * RGB-split chromatic aberration: red shifted left, blue shifted right, recombined with screen.
 * Fills its parent (AbsoluteFill). px <= 0 renders children untouched.
 * Note: SVG filters flatten 3D (preserve-3d) inside the wrapper and cost some render time.
 */
export const ChromaticWrap: React.FC<{ px: number; children: React.ReactNode }> = ({ px, children }) => {
  const id = "ca" + safeId(useId());
  if (!(px > 0)) return <>{children}</>;
  return (
    <>
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={-px} dy={0} result="ro" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={px} dy={0} result="bo" />
            <feBlend in="ro" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{ filter: `url(#${id})` }}>{children}</AbsoluteFill>
    </>
  );
};
