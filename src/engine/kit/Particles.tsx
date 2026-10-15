import React, { useLayoutEffect, useMemo, useRef } from "react";
import { random } from "remotion";
import type { z } from "zod";
import type { ParticlesLayer } from "../spec/schema";
import { useColor } from "../core/context";
import { useContainer } from "../core/container";
import { cssToRgb } from "./shaders";

type Layer = z.infer<typeof ParticlesLayer>;
type Preset = Layer["preset"];
type Props = { layer: Layer; t: number; duration: number };
type Rgb = [number, number, number]; // 0..255

/**
 * Particle systems drawn on a 2D canvas.
 * Every particle position is an ANALYTIC function of (seed, index, t): no simulation state, no Math.random,
 * so any frame can be rendered in isolation (Remotion renders out of order, in parallel).
 *
 * `size` = typical particle size in px, `speed` = time multiplier, `count` = number of particles.
 * Ambient presets scale their default count with the layer area.
 */
const PRESETS: Record<Preset, { count: number; size: number; colors?: string[]; ambient: boolean }> = {
  confetti: { count: 160, size: 16, ambient: false },
  sparkles: { count: 40, size: 22, ambient: true },
  dust: { count: 140, size: 2.2, ambient: true },
  bokeh: { count: 18, size: 90, ambient: true },
  snow: { count: 220, size: 5, colors: ["#ffffff"], ambient: true },
  embers: { count: 90, size: 5, colors: ["#ffb347", "#ff6a1a", "#ffd27a", "#ff8c2e"], ambient: true },
  burst: { count: 56, size: 8, ambient: false },
  stars: { count: 320, size: 1.6, colors: ["$fg", "#ffffff", "$accent2"], ambient: true },
  rain: { count: 260, size: 1.5, colors: ["$fg"], ambient: true },
  bubbles: { count: 30, size: 18, ambient: true },
  warp: { count: 280, size: 1.6, ambient: false },
};
const DEFAULT_COLORS = ["$accent", "$accent2", "$fg"];
const R = 12; // random numbers per particle
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// helpers

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const wrap = (v: number, lo: number, hi: number) => {
  const span = hi - lo;
  return lo + ((((v - lo) % span) + span) % span);
};
const pick = (pal: Rgb[], v: number) => pal[Math.floor(v * pal.length) % pal.length];
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lighten = (c: Rgb, k: number): Rgb => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k].map(Math.round) as Rgb;
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k].map(Math.round) as Rgb;
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

type SpriteKind = "glow" | "soft" | "bokeh";
const spriteCache = new Map<string, HTMLCanvasElement>();
/** Pre-rendered radial sprites (much faster and smoother than per-particle gradients). Pure function of inputs. */
const sprite = (c: Rgb, kind: SpriteKind): HTMLCanvasElement => {
  const key = `${kind}:${c.join(",")}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const N = kind === "bokeh" ? 256 : 96;
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  const stops: [number, number][] =
    kind === "glow" ? [[0, 1], [0.12, 0.85], [0.3, 0.35], [0.6, 0.08], [1, 0]]
    : kind === "soft" ? [[0, 1], [0.35, 0.8], [0.7, 0.28], [1, 0]]
    : [[0, 0.5], [0.55, 0.55], [0.8, 0.72], [0.88, 0.6], [0.96, 0.15], [1, 0]];
  for (const [o, a] of stops) g.addColorStop(o, rgba(c, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  if (spriteCache.size > 256) spriteCache.clear();
  spriteCache.set(key, cv);
  return cv;
};
const drawSprite = (ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, r: number, alpha: number) => {
  if (alpha <= 0.004 || r <= 0.05) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
};
/** 4-point star with concave sides. */
const star4 = (ctx: CanvasRenderingContext2D, r: number, pinch = 0.14) => {
  const k = r * pinch;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(k, -k, r, 0);
  ctx.quadraticCurveTo(k, k, 0, r);
  ctx.quadraticCurveTo(-k, k, -r, 0);
  ctx.quadraticCurveTo(-k, -k, 0, -r);
  ctx.closePath();
  ctx.fill();
};

type DrawCtx = {
  ctx: CanvasRenderingContext2D;
  W: number; H: number;
  /** layer-local seconds, and time scaled by speed */
  t: number; T: number;
  duration: number;
  n: number;
  r: (i: number, k: number) => number;
  size: number;
  pal: Rgb[];
  ox: number; oy: number;
  seed: number;
  /** spatial scale for velocities (1 at 1920 wide) */
  sc: number;
};

// ---------------------------------------------------------------------------------------------
// presets

const DRAW: Record<Preset, (d: DrawCtx) => void> = {
  // Burst from origin, ballistic with linear drag + gravity, tumbling & fluttering paper.
  confetti: ({ ctx, W, H, t, T, duration, n, r, size, pal, ox, oy, sc }) => {
    const k = 2.6;
    const g = 1000 * sc;
    const term = g / k;
    const fade = clamp01((duration - t) / 0.5);
    for (let i = 0; i < n; i++) {
      const tau = T - r(i, 0) * 0.15;
      if (tau < 0) continue;
      const ang = -Math.PI / 2 + (r(i, 1) - 0.5) * Math.PI * 0.95;
      const v0 = (900 + r(i, 2) * 1700) * sc;
      const vx = Math.cos(ang) * v0;
      const vy = Math.sin(ang) * v0;
      const e = 1 - Math.exp(-k * tau);
      const sway = (20 + r(i, 3) * 40) * sc * Math.min(1, tau);
      const x = ox + (r(i, 9) - 0.5) * 24 + (vx / k) * e + Math.sin(tau * (2 + r(i, 4) * 3) + r(i, 5) * TAU) * sway;
      const y = oy + (r(i, 10) - 0.5) * 24 + term * tau + ((vy - term) / k) * e;
      if (y > H + 60 || y < -200 || x < -60 || x > W + 60) continue;
      const s = size * (0.6 + r(i, 6) * 0.8);
      const flip = Math.cos(tau * (5 + r(i, 7) * 9) + r(i, 8) * TAU);
      const rot = r(i, 11) * TAU + tau * (r(i, 4) - 0.5) * 8;
      const base = pick(pal, r(i, 3));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(1, Math.max(0.06, Math.abs(flip)));
      ctx.globalAlpha = fade;
      // darker when seen edge-on, a touch brighter face-on
      ctx.fillStyle = rgba(flip * flip > 0.8 ? lighten(base, 0.15) : shade(base, 0.62 + 0.38 * Math.abs(flip)), 1);
      const kind = r(i, 5);
      if (kind < 0.55) ctx.fillRect(-s / 2, -s * 0.32, s, s * 0.64);
      else if (kind < 0.85) ctx.fillRect(-s * 0.16, -s * 0.75, s * 0.32, s * 1.5);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.36, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  // 4-point twinkling stars with a soft glow; each re-appears somewhere new every cycle.
  sparkles: ({ ctx, W, H, T, n, r, size, pal, seed, sc }) => {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const P = 1.4 + r(i, 0) * 2.2;
      const ph = T / P + r(i, 1);
      const cyc = Math.floor(ph);
      const life = ph - cyc;
      const s = Math.pow(Math.sin(life * Math.PI), 2);
      const rad = size * (0.45 + r(i, 2) * 0.8) * s;
      if (rad < 0.3) continue;
      const x = random(`spk-${seed}-${i}-${cyc}-x`) * W;
      const y = random(`spk-${seed}-${i}-${cyc}-y`) * H - life * 14 * sc;
      const col = pick(pal, r(i, 3));
      drawSprite(ctx, sprite(col, "glow"), x, y, rad * 1.5, 0.5 * s);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r(i, 4) * 0.6 + life * (r(i, 5) - 0.5) * 1.6);
      ctx.globalAlpha = s;
      ctx.fillStyle = rgba(lighten(col, 0.55), 1);
      star4(ctx, rad);
      ctx.restore();
    }
  },

  // Tiny glowing motes drifting and twinkling in the air.
  dust: ({ ctx, W, H, T, n, r, size, pal, sc }) => {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const depth = r(i, 0);
      const x = wrap(r(i, 1) * W + T * (r(i, 2) - 0.5) * 40 * sc + Math.sin(T * (0.3 + r(i, 3) * 0.5) + r(i, 4) * TAU) * 25 * sc, -20, W + 20);
      const y = wrap(r(i, 5) * H - T * (6 + r(i, 6) * 18) * sc + Math.cos(T * (0.25 + r(i, 7) * 0.4) + r(i, 8) * TAU) * 18 * sc, -20, H + 20);
      const rad = size * (0.5 + depth * 1.6);
      const tw = 0.55 + 0.45 * Math.sin(T * (0.8 + r(i, 9) * 2.5) + r(i, 10) * TAU);
      drawSprite(ctx, sprite(pick(pal, r(i, 11)), "glow"), x, y, rad * 2.6, (0.2 + 0.6 * r(i, 11)) * tw);
    }
  },

  // Large out-of-focus lights: crisp-rimmed discs and very soft blobs, slowly drifting.
  bokeh: ({ ctx, W, H, T, n, r, size, pal, sc }) => {
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < n; i++) {
      const rad = size * (0.35 + r(i, 0) * 0.9);
      const m = rad;
      const x = wrap(r(i, 1) * (W + 2 * m) + T * (r(i, 2) - 0.5) * 30 * sc + Math.sin(T * 0.25 + r(i, 3) * TAU) * 30 * sc, -m, W + m);
      const y = wrap(r(i, 4) * (H + 2 * m) + T * (r(i, 5) - 0.6) * 22 * sc + Math.cos(T * 0.2 + r(i, 6) * TAU) * 25 * sc, -m, H + m);
      const pulse = 0.75 + 0.25 * Math.sin(T * (0.5 + r(i, 7)) + r(i, 8) * TAU);
      const disc = r(i, 10) < 0.55;
      drawSprite(ctx, sprite(pick(pal, r(i, 11)), disc ? "bokeh" : "soft"), x, y, disc ? rad : rad * 1.4, (0.28 + 0.42 * r(i, 9)) * pulse);
    }
  },

  // Falling flakes with depth: near flakes are bigger, faster, brighter.
  snow: ({ ctx, W, H, T, n, r, size, pal, sc }) => {
    for (let i = 0; i < n; i++) {
      const depth = r(i, 0);
      const rad = size * (0.35 + depth * 0.9);
      const m = rad * 2 + 10;
      const y = wrap(r(i, 1) * (H + 2 * m) + T * (35 + depth * 85) * sc, -m, H + m);
      const x = wrap(r(i, 2) * W + Math.sin(T * (0.4 + r(i, 3) * 0.6) + r(i, 4) * TAU) * (15 + depth * 30) * sc + T * 12 * sc, -m, W + m);
      drawSprite(ctx, sprite(pick(pal, r(i, 5)), "soft"), x, y, rad * 1.4, 0.35 + 0.6 * depth);
    }
  },

  // Rising, flickering, glowing sparks from a fire below.
  embers: ({ ctx, W, H, T, n, r, size, pal, seed, sc }) => {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const P = 2.5 + r(i, 0) * 3.5;
      const ph = T / P + r(i, 1);
      const cyc = Math.floor(ph);
      const life = ph - cyc;
      const x0 = random(`emb-${seed}-${i}-${cyc}`) * W;
      const y0 = H * (0.9 + 0.2 * random(`emb-${seed}-${i}-${cyc}-y`));
      const rise = (0.55 + r(i, 2) * 0.6) * H;
      const y = y0 - life * rise;
      const x = x0 + Math.sin(T * (1.1 + r(i, 3)) + r(i, 4) * TAU) * (12 + 30 * life) * sc + (r(i, 5) - 0.5) * 140 * sc * life;
      const flick = 0.6 + 0.4 * Math.sin(T * (11 + r(i, 6) * 9) + r(i, 7) * TAU) * Math.sin(T * (4.3 + r(i, 8) * 3) + r(i, 9) * TAU);
      const env = Math.pow(Math.sin(life * Math.PI), 0.6) * (1 - life * 0.4);
      const rad = size * (0.5 + r(i, 10) * 0.9) * (1 - life * 0.45);
      const col = pick(pal, r(i, 11));
      drawSprite(ctx, sprite(col, "glow"), x, y, rad * 7, 0.75 * env * flick);
      drawSprite(ctx, sprite(lighten(col, 0.55), "soft"), x, y, rad * 1.2, env * flick);
    }
  },

  // One-shot radial impact at layer start: flash, shockwave ring, speed lines and flying sparks.
  burst: ({ ctx, W, H, T, n, r, size, pal, ox, oy, sc }) => {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const Rad = Math.min(W, H) * 0.42;
    const rays = Math.min(n, Math.max(6, Math.round(n * 0.4)));
    const dots = Math.max(0, n - rays);
    // flash core
    if (T < 0.5) drawSprite(ctx, sprite(lighten(pal[0], 0.6), "glow"), ox, oy, Rad * 0.5 * (0.6 + easeOutCubic(T / 0.5) * 0.7), Math.pow(1 - T / 0.5, 2) * 0.9);
    // shockwave ring
    const rp = clamp01(T / 0.7);
    if (rp < 1) {
      ctx.globalAlpha = Math.pow(1 - rp, 2) * 0.85;
      ctx.strokeStyle = rgba(lighten(pal[0], 0.3), 1);
      ctx.lineWidth = size * 1.2 * (1 - rp) + 0.5;
      ctx.beginPath();
      ctx.arc(ox, oy, Rad * 1.05 * easeOutCubic(rp), 0, TAU);
      ctx.stroke();
    }
    // speed lines
    for (let j = 0; j < rays; j++) {
      const tt = T - r(j, 2) * 0.05;
      if (tt < 0) continue;
      const hp = clamp01(tt / 0.5);
      const tp = clamp01((tt - 0.06) / 0.6);
      if (tp >= 1) continue;
      const ang = (j / rays) * TAU + (r(j, 0) - 0.5) * 0.3;
      const L = Rad * (0.55 + r(j, 1) * 0.55);
      const head = L * (0.12 + 0.88 * easeOutExpo(hp));
      const tail = L * (0.12 + 0.88 * easeOutCubic(tp));
      const c = Math.cos(ang), s = Math.sin(ang);
      ctx.globalAlpha = 1 - tp * tp;
      ctx.strokeStyle = rgba(lighten(pick(pal, r(j, 4)), 0.2), 1);
      ctx.lineWidth = Math.max(0.5, size * (0.35 + r(j, 3) * 0.5) * (1 - tp * 0.7));
      ctx.beginPath();
      ctx.moveTo(ox + c * tail, oy + s * tail);
      ctx.lineTo(ox + c * head, oy + s * head);
      ctx.stroke();
    }
    // sparks
    for (let j = 0; j < dots; j++) {
      const i = rays + j;
      const tt = T - r(i, 2) * 0.08;
      if (tt < 0) continue;
      const life = clamp01(tt / (0.7 + r(i, 4) * 0.5));
      if (life >= 1) continue;
      const ang = r(i, 0) * TAU;
      const dist = Rad * (0.5 + r(i, 1) * 0.9) * (1 - Math.exp(-tt * (4 + r(i, 3) * 3)));
      const x = ox + Math.cos(ang) * dist;
      const y = oy + Math.sin(ang) * dist + 60 * sc * tt * tt;
      const rad = size * (0.25 + r(i, 5) * 0.6) * (1 - life);
      const col = pick(pal, r(i, 6));
      drawSprite(ctx, sprite(col, "glow"), x, y, rad * 3, (1 - life) * 0.6);
      drawSprite(ctx, sprite(lighten(col, 0.6), "soft"), x, y, rad, 1 - life);
    }
  },

  // Star field: tiny twinkling points, slow parallax drift, a few bright ones with glints.
  stars: ({ ctx, W, H, T, n, r, size, pal, sc }) => {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const depth = r(i, 0);
      const x = wrap(r(i, 1) * W - T * (2 + depth * 6) * sc, -6, W + 6);
      const y = r(i, 2) * H;
      const big = r(i, 3) > 0.95;
      const rad = size * (0.4 + Math.pow(r(i, 4), 3) * 1.6) * (big ? 1.6 : 1);
      const tw = 0.5 + 0.5 * Math.sin(T * (0.7 + r(i, 5) * 3) + r(i, 6) * TAU);
      const a = (0.25 + 0.75 * depth) * (0.35 + 0.65 * tw);
      const col = pick(pal, r(i, 7));
      drawSprite(ctx, sprite(col, "glow"), x, y, rad * 2.6, a);
      if (big) {
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = rgba(lighten(col, 0.6), 1);
        star4(ctx, rad * 7, 0.06);
        ctx.restore();
      }
    }
  },

  // Slanted rain streaks with depth.
  rain: ({ ctx, W, H, T, n, r, size, pal, sc }) => {
    ctx.lineCap = "round";
    const slant = 0.22;
    for (let i = 0; i < n; i++) {
      const depth = r(i, 0);
      const v = (1300 + depth * 1100) * sc;
      const L = (22 + depth * 50) * sc;
      const y = wrap(r(i, 1) * (H + L) + T * v, -L, H + L);
      const x = -H * slant + r(i, 2) * (W + H * slant) + (y + L) * slant;
      const col = pick(pal, r(i, 3));
      const g = ctx.createLinearGradient(x - L * slant, y - L, x, y);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(1, rgba(col, 0.12 + 0.4 * depth));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = size * (0.5 + depth * 0.8);
      ctx.beginPath();
      ctx.moveTo(x - L * slant, y - L);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  },

  // Rising soap-like bubbles: tinted rim, glossy highlight, gentle wobble.
  bubbles: ({ ctx, W, H, T, n, r, size, pal, sc }) => {
    for (let i = 0; i < n; i++) {
      const rad = size * (0.4 + r(i, 0) * 1.1);
      const m = rad + 10;
      const y = wrap(r(i, 2) * (H + 2 * m) - T * (40 + r(i, 1) * 80) * sc * (0.6 + (rad / size) * 0.3), -m, H + m);
      const x = r(i, 3) * W + Math.sin(T * (1 + r(i, 4) * 1.2) + r(i, 5) * TAU) * (8 + r(i, 6) * 18) * sc;
      const wob = 1 + 0.06 * Math.sin(T * (3 + r(i, 7) * 3) + r(i, 8) * TAU);
      const col = pick(pal, r(i, 9));
      const a = clamp01((y + m) / (H * 0.15)); // fade out near the top
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(wob, 2 - wob);
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(0, 0, rad * 0.2, 0, 0, rad);
      g.addColorStop(0, rgba(col, 0.02));
      g.addColorStop(0.8, rgba(col, 0.12));
      g.addColorStop(1, rgba(col, 0.38));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(lighten(col, 0.3), 0.65);
      ctx.lineWidth = Math.max(1, rad * 0.05);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = Math.max(1, rad * 0.07);
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.72, Math.PI * 1.1, Math.PI * 1.45);
      ctx.stroke();
      drawSprite(ctx, sprite([255, 255, 255], "soft"), -rad * 0.4, -rad * 0.4, rad * 0.28, a * 0.85);
      ctx.restore();
    }
  },

  // Hyperspace streaks radiating from the origin, accelerating with perspective.
  warp: ({ ctx, W, H, T, n, r, size, pal, ox, oy }) => {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const diag = Math.hypot(W, H) / 2;
    const minR = diag * 0.035;
    const proj = (z: number) => minR / (1 - z * 0.985);
    drawSprite(ctx, sprite(pal[0], "glow"), ox, oy, minR * 7, 0.35);
    for (let i = 0; i < n; i++) {
      const z = (((r(i, 2) + T * (0.22 + r(i, 1) * 0.38)) % 1) + 1) % 1;
      const head = proj(z);
      const tail = proj(Math.max(0, z - 0.06 - 0.06 * r(i, 3)));
      if (tail > diag * 1.2) continue;
      const ang = r(i, 0) * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      const col = pick(pal, r(i, 4));
      const g = ctx.createLinearGradient(ox + c * tail, oy + s * tail, ox + c * head, oy + s * head);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(1, rgba(lighten(col, 0.4), Math.min(1, z * 1.8)));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = size * (0.4 + 2.2 * z * z);
      ctx.beginPath();
      ctx.moveTo(ox + c * tail, oy + s * tail);
      ctx.lineTo(ox + c * head, oy + s * head);
      ctx.stroke();
    }
  },
};

// ---------------------------------------------------------------------------------------------

export const Particles: React.FC<Props> = ({ layer, t, duration }) => {
  const color = useColor();
  const box = useContainer();
  const W = Math.max(1, Math.round(layer.width ?? box.width));
  const H = Math.max(1, Math.round(layer.height ?? box.height));
  const def = PRESETS[layer.preset] ?? PRESETS.dust;
  const areaK = Math.min(2, Math.max(0.12, (W * H) / (1920 * 1080)));
  const count = Math.max(1, Math.min(4000, Math.round(layer.count ?? (def.ambient ? def.count * areaK : def.count))));
  const seed = layer.seed ?? 1;

  const colorKey = (layer.colors?.length ? layer.colors : def.colors ?? DEFAULT_COLORS).map((c) => color(c)).join("|");
  const pal = useMemo(
    () => colorKey.split("|").map((c) => cssToRgb(c).map((v) => Math.round(v * 255)) as Rgb),
    [colorKey],
  );
  // Per-particle random attributes, seeded (deterministic across processes).
  const rnd = useMemo(() => {
    const a = new Float64Array(count * R);
    for (let i = 0; i < count; i++) for (let k = 0; k < R; k++) a[i * R + k] = random(`p${seed}-${i}-${k}`);
    return a;
  }, [count, seed]);

  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    DRAW[layer.preset]({
      ctx, W, H, t, T: t * (layer.speed ?? 1), duration, n: count,
      r: (i, k) => rnd[i * R + k],
      size: layer.size ?? def.size,
      pal: pal.length ? pal : [[255, 255, 255]],
      ox: W / 2 + (layer.originX ?? 0),
      oy: H / 2 + (layer.originY ?? 0),
      seed,
      sc: Math.max(0.25, Math.max(W, H) / 1920),
    });
    ctx.restore();
  });

  return <canvas ref={ref} width={W} height={H} style={{ width: W, height: H, display: "block" }} />;
};
