/**
 * Film-level captions (spec.captions): one caption track over every scene, timed from the voiceover's word timings
 * (spec.voiceover[].words, relative to each clip). Reuses the captions kit, so styles match per-scene caption layers.
 */
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Spec } from "../spec/schema";
import { Captions } from "../kit/Captions";
import { ContainerProvider } from "../core/container";

export const filmCaptionWords = (spec: Pick<Spec, "voiceover">): { text: string; start: number; end: number }[] =>
  (spec.voiceover ?? []).flatMap((c) => {
    const at = c.at ?? 0, trim = c.trimStart ?? 0, end = c.duration != null ? at + c.duration : Infinity;
    return (c.words ?? [])
      .map((w) => ({ text: w.text, start: at + w.start - trim, end: at + w.end - trim }))
      .filter((w) => w.end > at && w.start < end && w.text.trim());
  }).sort((a, b) => a.start - b.start);

export const FilmCaptions: React.FC<{ spec: Spec; width: number; height: number; total: number }> = ({ spec, width, height, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = spec.captions;
  const words = useMemo(() => filmCaptionWords(spec), [spec]);
  if (!c || !words.length) return null;
  const portrait = height > width;
  const y = c.y ?? (c.position === "upper" ? -height * 0.3 : c.position === "center" ? 0 : height * (portrait ? 0.24 : 0.33));
  const layer = {
    type: "captions" as const, words, style: c.style ?? "pop", wordsPerPage: c.wordsPerPage ?? 3, uppercase: c.uppercase,
    fontSize: c.fontSize, font: c.font, color: c.color, highlightColor: c.highlightColor, width: c.width,
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center", justifyContent: "center" }}>
      <ContainerProvider value={{ width, height, nested: false }}>
        <div style={{ transform: `translateY(${y}px)`, width: c.width ?? width * 0.85, display: "flex", justifyContent: "center" }}>
          <Captions layer={layer} t={frame / fps} duration={total} />
        </div>
      </ContainerProvider>
    </AbsoluteFill>
  );
};
