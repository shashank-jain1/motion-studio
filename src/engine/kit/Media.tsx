import React from "react";
import { Img, OffthreadVideo, Loop, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { MediaLayer } from "../spec/schema";
import { lerp, progress } from "../core/animate";
import { isVideoSrc, useAsset, useColor } from "../core/context";
import { useContainer } from "../core/container";

type Props = { layer: z.infer<typeof MediaLayer>; t: number; duration: number };

const MASKS: Record<string, string> = {
  circle: "circle(50% at 50% 50%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  arch: "inset(0 round 50% 50% 0 0 / 35% 35% 0 0)",
  blob: "path('M0.5,0 C0.8,0 1,0.2 1,0.5 C1,0.85 0.75,1 0.45,1 C0.15,1 0,0.75 0,0.5 C0,0.2 0.2,0 0.5,0 Z')",
};

export const Media: React.FC<Props> = ({ layer, t, duration }) => {
  const asset = useAsset();
  const color = useColor();
  const box = useContainer();
  const { fps } = useVideoConfig();
  const W = layer.width ?? box.width;
  const H = layer.height ?? box.height;
  const src = asset(layer.src);
  const video = layer.kind === "video" || (layer.kind !== "image" && isVideoSrc(layer.src));

  const kb = layer.kenBurns;
  const kbP = progress(t, 0, duration, "linear");
  const kbScale = kb ? lerp(kb.from ?? 1, kb.to ?? 1.15, kbP) : 1;
  const kbX = kb ? (kb.x ?? 0) * kbP : 0;
  const kbY = kb ? (kb.y ?? 0) * kbP : 0;

  // Reveal
  let clip: string | undefined = layer.mask && layer.mask !== "none" && layer.mask !== "rounded" && layer.mask !== "blob" ? MASKS[layer.mask] : undefined;
  const rv = layer.reveal && layer.reveal !== "none" ? progress(t, 0, layer.revealDuration ?? 0.9, "inOutExpo") : 1;
  let revealInner: React.CSSProperties = {};
  if (rv < 1) {
    const h = 1 - rv;
    switch (layer.reveal) {
      case "wipe-left": clip = `inset(0 ${h * 100}% 0 0)`; break;
      case "wipe-right": clip = `inset(0 0 0 ${h * 100}%)`; break;
      case "wipe-up": clip = `inset(${h * 100}% 0 0 0)`; break;
      case "wipe-down": clip = `inset(0 0 ${h * 100}% 0)`; break;
      case "circle": clip = `circle(${rv * 75}% at 50% 50%)`; break;
      case "split": clip = `inset(${h * 50}% 0 ${h * 50}% 0)`; break;
    }
    revealInner = { transform: `scale(${1 + 0.25 * h})` };
  }
  const radius = layer.mask === "rounded" ? (layer.radius ?? 36) : layer.radius;

  const mediaStyle: React.CSSProperties = {
    width: "100%", height: "100%", objectFit: layer.fit ?? "cover", display: "block",
    transform: `scale(${kbScale}) translate(${kbX}px, ${kbY}px)`, filter: layer.filter,
  };
  const trimFrames = Math.round((layer.trimStart ?? 0) * fps);
  let el: React.ReactNode = video ? (
    <OffthreadVideo src={src} style={mediaStyle} muted={layer.muted ?? layer.volume === undefined} volume={layer.volume ?? 1} trimBefore={trimFrames || undefined} playbackRate={layer.playbackRate ?? 1} />
  ) : (
    <Img src={src} style={mediaStyle} />
  );
  if (video && layer.loopVideo) {
    el = <Loop durationInFrames={Math.max(1, Math.round(4 * fps))}>{el}</Loop>;
  }

  return (
    <div style={{
      width: W, height: H, overflow: "hidden", borderRadius: radius, clipPath: clip,
      border: layer.border ? color(layer.border) : undefined,
      WebkitMaskImage: layer.mask === "blob" ? "radial-gradient(closest-side, #000 92%, transparent 100%)" : undefined,
    }}>
      <div style={{ width: "100%", height: "100%", ...revealInner }}>{el}</div>
    </div>
  );
};
