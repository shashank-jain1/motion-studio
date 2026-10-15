/** Maps spec transitions to @remotion/transitions presentations (incl. WebGL ones) plus custom cinematic cuts. */
import React from "react";
import { AbsoluteFill, random } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { iris } from "@remotion/transitions/iris";
import { bookFlip } from "@remotion/transitions/book-flip";
import { zoomBlur } from "@remotion/transitions/zoom-blur";
import { dreamyZoom } from "@remotion/transitions/dreamy-zoom";
import { filmBurn } from "@remotion/transitions/film-burn";
import { linearBlur } from "@remotion/transitions/linear-blur";
import { zoomInOut } from "@remotion/transitions/zoom-in-out";
import { dissolve } from "@remotion/transitions/dissolve";
import { ripple } from "@remotion/transitions/ripple";
import { crosswarp } from "@remotion/transitions/crosswarp";
import { crossZoom } from "@remotion/transitions/cross-zoom";
import { swap } from "@remotion/transitions/swap";
import { pushCut } from "@remotion/transitions/push-cut";
import { blurSlide } from "@remotion/transitions/blur-slide";
import type { z } from "zod";
import type { TransitionSchema } from "../spec/schema";
import { EASING, type EaseName } from "../core/animate";

type T = z.infer<typeof TransitionSchema>;
type Dir = "left" | "right" | "up" | "down";

const toSlideDir = (d: Dir | undefined) =>
  (({ left: "from-right", right: "from-left", up: "from-bottom", down: "from-top" } as const)[d ?? "left"]);

// --- Custom presentations ------------------------------------------------------

type WhipProps = { direction: Dir };
const Whip: React.FC<TransitionPresentationComponentProps<WhipProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const p = presentationProgress;
  const horizontal = passedProps.direction === "left" || passedProps.direction === "right";
  const sign = passedProps.direction === "left" || passedProps.direction === "up" ? -1 : 1;
  // exiting: 0 → -100%; entering: +100% → 0, both with heavy directional blur at peak speed
  const offset = presentationDirection === "exiting" ? sign * p * 100 : -sign * (1 - p) * 100;
  const speed = Math.sin(p * Math.PI); // peaks mid-transition
  const id = `whip-${presentationDirection}`;
  return (
    <AbsoluteFill style={{ transform: horizontal ? `translateX(${-offset}%)` : `translateY(${-offset}%)`, filter: speed > 0.02 ? `url(#${id})` : undefined }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={horizontal ? `${90 * speed} 0` : `0 ${90 * speed}`} />
        </filter>
      </svg>
      {children}
    </AbsoluteFill>
  );
};

const ZoomThrough: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const style: React.CSSProperties = presentationDirection === "exiting"
    ? { transform: `scale(${1 + p * p * 4})`, opacity: 1 - Math.max(0, (p - 0.5) * 2), filter: `blur(${p * 18}px)` }
    : { transform: `scale(${0.82 + 0.18 * p})`, opacity: Math.min(1, Math.max(0, (p - 0.25) / 0.45)), filter: p < 1 ? `blur(${(1 - p) * 16}px)` : undefined };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

type FlashProps = { color: string };
const Flash: React.FC<TransitionPresentationComponentProps<FlashProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  // first half: outgoing scene burns to color; second half: incoming emerges from it
  const visible = presentationDirection === "exiting" ? p < 0.5 : p >= 0.5;
  const flash = presentationDirection === "exiting" ? Math.min(1, p * 2) : Math.min(1, (1 - p) * 2);
  return (
    <AbsoluteFill style={{ opacity: visible ? 1 : 0 }}>
      {children}
      <AbsoluteFill style={{ background: passedProps.color, opacity: flash ** 1.5 }} />
    </AbsoluteFill>
  );
};

const Glitch: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const visible = presentationDirection === "exiting" ? p < 0.5 : p >= 0.5;
  const step = Math.floor(p * 12);
  const r = random(`glitch-${step}`);
  const off = (r - 0.5) * 80 * Math.sin(p * Math.PI);
  const slices = Array.from({ length: 6 }).map((_, i) => {
    const top = i * (100 / 6);
    const dx = (random(`gs-${step}-${i}`) - 0.5) * 160 * Math.sin(p * Math.PI);
    return (
      <AbsoluteFill key={i} style={{ clipPath: `inset(${top}% 0 ${100 - top - 100 / 6}% 0)`, transform: `translateX(${dx}px)` }}>{children}</AbsoluteFill>
    );
  });
  return (
    <AbsoluteFill style={{ opacity: visible ? 1 : 0, filter: `hue-rotate(${off * 2}deg) saturate(${1 + Math.abs(off) / 30})` }}>
      {slices}
      <AbsoluteFill style={{ background: "#ff004c", mixBlendMode: "screen", opacity: 0.25 * Math.sin(p * Math.PI), transform: `translateX(${off}px)` }} />
    </AbsoluteFill>
  );
};

// --- Content-aware presentations (built from the scene's own elements) -------------------

/** Origin element of a content-aware transition: center (px from canvas center) and size, as seen on screen. */
export type TransitionOrigin = { x: number; y: number; w: number; h: number };
type Shape = "circle" | "rounded" | "rect";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Distance from (cx, cy) to the farthest frame corner. */
const coverRadius = (W: number, H: number, cx: number, cy: number) => Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 2;

/** Clip for a window shape centered at (cx, cy) with half-size (hw, hh), corner radius cr. */
const windowClip = (shape: Shape, W: number, H: number, cx: number, cy: number, hw: number, hh: number, cr: number) => {
  if (shape === "circle") return `circle(${Math.max(0, hw)}px at ${cx}px ${cy}px)`;
  const top = cy - hh, left = cx - hw, bottom = H - (cy + hh), right = W - (cx + hw);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${Math.max(0, cr)}px)`;
};

type ExpandProps = { width: number; height: number; origin: TransitionOrigin; shape: Shape; color: string | null };
/**
 * Container transform: scene B is revealed inside a shape that grows from the origin element to cover the frame.
 * With `color`, a solid fill expands first and B materialises inside it (color-script hand-off).
 */
const Expand: React.FC<TransitionPresentationComponentProps<ExpandProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const { width: W, height: H, origin: o, shape, color } = passedProps;
  if (presentationDirection === "exiting") {
    // the outgoing world recedes a touch while the container grows over it
    return <AbsoluteFill style={{ transform: `scale(${1 - 0.035 * p})` }}>{children}</AbsoluteFill>;
  }
  if (p >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  const cx = W / 2 + o.x, cy = H / 2 + o.y;
  let clip: string;
  if (shape === "circle") {
    const r0 = Math.max(o.w, o.h) / 2;
    clip = windowClip("circle", W, H, cx, cy, lerp(r0, coverRadius(W, H, cx, cy), p), 0, 0);
  } else {
    // the rect grows from the element's box to the frame (center travels with it)
    const hw = lerp(o.w / 2, W / 2, p), hh = lerp(o.h / 2, H / 2, p);
    const ccx = lerp(cx, W / 2, p), ccy = lerp(cy, H / 2, p);
    const cr0 = shape === "rounded" ? Math.min(o.w, o.h) * 0.22 + 8 : 0;
    clip = windowClip("rect", W, H, ccx, ccy, hw, hh, lerp(cr0, 0, p * p));
  }
  const settle = 1.05 - 0.05 * EASING.outQuint(clamp01(p));
  const content = (
    <AbsoluteFill style={{ transform: `scale(${settle})`, transformOrigin: `${cx}px ${cy}px`, opacity: color ? clamp01((p - 0.45) / 0.45) : 1 }}>{children}</AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ clipPath: clip }}>
      {color && <AbsoluteFill style={{ background: color }} />}
      {content}
    </AbsoluteFill>
  );
};

type ZoomIntoProps = { width: number; height: number; origin: TransitionOrigin; shape: Shape };
/**
 * Camera flies INTO the origin element of scene A (log-space scale = constant perceived speed) while scene B
 * appears inside a window at that point that grows with the zoom — reads as passing through a hole into the next world.
 */
const ZoomInto: React.FC<TransitionPresentationComponentProps<ZoomIntoProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const { width: W, height: H, origin: o, shape } = passedProps;
  const cx = W / 2 + o.x, cy = H / 2 + o.y;
  const hasSize = o.w > 1 && o.h > 1;
  const hw0 = shape === "circle" ? Math.max(6, (hasSize ? Math.min(o.w, o.h) : 24) / 2) : Math.max(6, (hasSize ? o.w : 32) / 2);
  const hh0 = shape === "circle" ? hw0 : Math.max(6, (hasSize ? o.h : 32) / 2);
  // The camera flies AT the target: it scales up in log space while being steered to frame center.
  const sEnd = shape === "circle" ? coverRadius(W, H, W / 2, H / 2) / hw0 : Math.max((W / 2 + 2) / hw0, (H / 2 + 2) / hh0);
  const s = Math.exp(Math.log(sEnd) * p);
  const steer = EASING.inOut(clamp01(p * 1.15));
  const px = lerp(cx, W / 2, steer), py = lerp(cy, H / 2, steer); // window center on screen
  if (presentationDirection === "exiting") {
    const blur = Math.max(0, p - 0.35) * 14;
    return (
      <AbsoluteFill style={{
        transform: `translate(${px - cx}px, ${py - cy}px) scale(${s})`, transformOrigin: `${cx}px ${cy}px`,
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
      }}>
        {children}
      </AbsoluteFill>
    );
  }
  if (p >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  const hw = hw0 * s, hh = hh0 * s;
  const clip = windowClip(shape, W, H, px, py, hw, hh, shape === "rounded" ? Math.min(hw, hh) * 0.3 : 0);
  // B lives "deeper": it approaches more slowly than the hole (parallax), from 0.45× to 1×.
  const sB = Math.exp(Math.log(0.45) * (1 - p));
  const depth = (1 - p) * 0.55;
  const rr = shape === "circle" ? hw : Math.max(hw, hh);
  return (
    <AbsoluteFill style={{ clipPath: clip }}>
      <AbsoluteFill style={{ transform: `scale(${sB})`, transformOrigin: `${px}px ${py}px` }}>{children}</AbsoluteFill>
      {depth > 0.01 && (
        <AbsoluteFill style={{ background: `radial-gradient(circle ${Math.max(1, rr)}px at ${px}px ${py}px, rgba(0,0,0,0) 55%, rgba(0,0,0,${depth}) 100%)` }} />
      )}
    </AbsoluteFill>
  );
};

type SliceProps = { width: number; height: number; slices: number; vertical: boolean; reverse: boolean; ease: EaseName };
/**
 * Designed split: scene A is cut into N bands that slide off in alternating directions on a staggered cascade,
 * uncovering scene B, which settles from a slight scale.
 */
const Slice: React.FC<TransitionPresentationComponentProps<SliceProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const { width: W, height: H, slices, vertical, reverse, ease } = passedProps;
  if (presentationDirection === "entering") {
    const e = EASING.outQuint(clamp01((p - 0.1) / 0.9));
    return <AbsoluteFill style={{ zIndex: 0, transform: `scale(${1.08 - 0.08 * e})` }}>{children}</AbsoluteFill>;
  }
  if (p <= 0) return <AbsoluteFill style={{ zIndex: 1 }}>{children}</AbsoluteFill>;
  const n = Math.max(2, Math.min(16, slices));
  const spread = 0.38; // fraction of the transition spent on the cascade
  const span = 1 - spread;
  const bands = Array.from({ length: n }).map((_, i) => {
    const order = reverse ? n - 1 - i : i;
    const local = clamp01((p - (order / (n - 1)) * spread) / span);
    const e = EASING[ease](local);
    if (e >= 1) return null;
    const sign = (i % 2 === 0 ? -1 : 1) * (reverse ? -1 : 1);
    const a = (i / n) * 100, b = 100 - ((i + 1) / n) * 100;
    // tiny overlap so no hairline seam shows between resting bands
    const clip = vertical ? `inset(0 ${Math.max(0, b - 0.05)}% 0 ${Math.max(0, a - 0.05)}%)` : `inset(${Math.max(0, a - 0.05)}% 0 ${Math.max(0, b - 0.05)}% 0)`;
    const d = sign * e * (vertical ? H : W) * 1.04;
    return (
      <AbsoluteFill key={i} style={{ clipPath: clip, transform: vertical ? `translateY(${d}px)` : `translateX(${d}px)` }}>{children}</AbsoluteFill>
    );
  });
  return <AbsoluteFill style={{ zIndex: 1 }}>{bands}</AbsoluteFill>;
};

const custom = <P extends Record<string, unknown>>(component: React.FC<TransitionPresentationComponentProps<P>>, props: P): TransitionPresentation<P> => ({ component, props });

// --- Mapping -------------------------------------------------------------------------

export const getPresentation = (
  tr: T, width: number, height: number, resolveColor: (c: string) => string, origin?: TransitionOrigin,
): TransitionPresentation<any> | null => {
  const d = tr.direction;
  const o: TransitionOrigin = origin ?? { x: tr.x ?? 0, y: tr.y ?? 0, w: 0, h: 0 };
  switch (tr.type) {
    case "none": case "cut": return null;
    case "fade": return fade();
    case "slide": return slide({ direction: toSlideDir(d) });
    case "wipe": return wipe({ direction: toSlideDir(d) });
    case "flip": return flip({ direction: toSlideDir(d) });
    case "clock-wipe": return clockWipe({ width, height });
    case "iris": return iris({ width, height });
    case "book-flip": return bookFlip({ direction: toSlideDir(d) });
    case "zoom-blur": return zoomBlur({});
    case "dreamy-zoom": return dreamyZoom({});
    case "film-burn": return filmBurn({});
    case "linear-blur": return linearBlur({});
    case "zoom-in-out": return zoomInOut({});
    case "dissolve": return dissolve({});
    case "ripple": return ripple({});
    case "crosswarp": return crosswarp({});
    case "cross-zoom": return crossZoom({ strength: 0.4 });
    case "swap": return swap({});
    case "push-cut": return pushCut({});
    case "blur-slide": return blurSlide({ direction: toSlideDir(d) });
    case "whip": return custom(Whip, { direction: d ?? "left" });
    case "zoom-through": return custom(ZoomThrough, {});
    case "flash": return custom(Flash, { color: resolveColor(tr.color ?? "#ffffff") });
    case "glitch": return custom(Glitch, {});
    case "expand": return custom(Expand, { width, height, origin: o, shape: tr.shape ?? "circle", color: tr.color ? resolveColor(tr.color) : null });
    case "zoom-into": return custom(ZoomInto, { width, height, origin: o, shape: tr.shape ?? "circle" });
    case "slice": return custom(Slice, {
      width, height, slices: tr.slices ?? 6, vertical: d === "up" || d === "down", reverse: d === "right" || d === "down",
      ease: tr.ease ?? "inOutQuint",
    });
    case "match": return null; // graphic match cut: a hard cut whose continuity is designed into the two frames
    default: return null;
  }
};

/** Default timing easing per transition (content-aware ones shape their own curves). */
export const transitionEase = (tr: T): EaseName => {
  if (tr.type === "slice") return "linear"; // per-band easing happens inside
  if (tr.ease) return tr.ease;
  if (tr.type === "expand") return "inOutExpo";
  if (tr.type === "zoom-into") return "inOut";
  return "inOutQuint";
};

/** Seconds a transition overlaps its neighbouring scenes. */
export const transitionSeconds = (tr: Pick<T, "type" | "duration"> | undefined) =>
  !tr || tr.type === "none" || tr.type === "cut" || tr.type === "match" ? 0 : (tr.duration ?? 0.5);
