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

const custom = <P extends Record<string, unknown>>(component: React.FC<TransitionPresentationComponentProps<P>>, props: P): TransitionPresentation<P> => ({ component, props });

// --- Mapping -------------------------------------------------------------------------

export const getPresentation = (tr: T, width: number, height: number, resolveColor: (c: string) => string): TransitionPresentation<any> | null => {
  const d = tr.direction;
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
  }
};

/** Seconds a transition overlaps its neighbouring scenes. */
export const transitionSeconds = (tr: T | undefined) =>
  !tr || tr.type === "none" || tr.type === "cut" ? 0 : (tr.duration ?? 0.5);
