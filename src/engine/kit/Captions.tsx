import React, { useMemo } from "react";
import type { z } from "zod";
import type { CaptionsLayer } from "../spec/schema";
import { clamp01, ease, lerp, progress } from "../core/animate";
import { useColor, useFont } from "../core/context";
import { useContainer } from "../core/container";

type Props = { layer: z.infer<typeof CaptionsLayer>; t: number; duration: number };

type Word = { text: string; start: number; end: number };
type Page = { words: Word[]; first: number; start: number; end: number };

/** Words from explicit timings, or `text` spread over the layer weighted by word length (feels spoken). */
const buildWords = (layer: Props["layer"], duration: number): Word[] => {
  if (layer.words && layer.words.length > 0) {
    return [...layer.words].filter((w) => w.text.trim().length > 0).sort((a, b) => a.start - b.start);
  }
  const tokens = (layer.text ?? "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  // Leave a short breath at the end so the last word is readable before the layer exits.
  const span = Math.max(0.1, duration - Math.min(0.4, duration * 0.08));
  const weights = tokens.map((w) => w.length + 2 + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return tokens.map((text, i) => {
    const start = (acc / total) * span;
    acc += weights[i];
    return { text, start, end: (acc / total) * span };
  });
};

/** Chunk into pages of `per` words; a sentence end also closes the page. */
const paginate = (words: Word[], per: number, duration: number): Page[] => {
  const pages: Page[] = [];
  let cur: Word[] = [];
  let firstIdx = 0;
  words.forEach((w, i) => {
    if (cur.length === 0) firstIdx = i;
    cur.push(w);
    if (cur.length >= per || /[.!?]$/.test(w.text) || i === words.length - 1) {
      pages.push({ words: cur, first: firstIdx, start: cur[0].start, end: cur[cur.length - 1].end });
      cur = [];
    }
  });
  // A page stays up until the next one starts (or a short hold after its last word if there's a gap).
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    const hold = p.end + 0.7;
    p.end = next ? Math.min(next.start, hold) : Math.max(duration, hold);
  });
  return pages;
};

/** Rough "is this a light colour?" for #hex / rgb() so box-style text stays readable on the pill. */
const isLight = (c: string) => {
  let r: number, g: number, b: number;
  const hex = c.trim().match(/^#([0-9a-f]{3,8})$/i);
  const rgb = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].split("").map((x) => x + x).join("") : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) {
    [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  } else return false;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 165;
};

/** Outline + depth via stacked text-shadows (reliable across Chrome versions, unlike paint-order). */
const outlineShadow = (w: number, color: string, depth: number) => {
  const dirs: string[] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    dirs.push(`${(Math.cos(a) * w).toFixed(2)}px ${(Math.sin(a) * w).toFixed(2)}px 0 ${color}`);
  }
  dirs.push(`0 ${depth * 0.35}px ${depth}px rgba(0,0,0,0.45)`);
  return dirs.join(", ");
};

/**
 * TikTok/Reels-style captions. Pages of a few words; the spoken word is emphasised per `style`:
 * karaoke (colour), pop (scale + colour), box (highlight pill), bounce (words pop in as spoken),
 * clean (soft fade, no outline).
 */
export const Captions: React.FC<Props> = ({ layer, t, duration }) => {
  const color = useColor();
  const font = useFont();
  const box = useContainer();
  const style = layer.style ?? "karaoke";
  const fs = layer.fontSize ?? Math.round(Math.min(box.width, box.height) * 0.066);
  const W = layer.width ?? box.width * 0.85;
  const fg = color(layer.color, "#ffffff");
  const hl = color(layer.highlightColor, "$accent");
  const upper = layer.uppercase ?? style !== "clean";

  const words = useMemo(() => buildWords(layer, duration), [layer, duration]);
  const pages = useMemo(() => paginate(words, Math.max(1, layer.wordsPerPage ?? 3), duration), [words, layer.wordsPerPage, duration]);

  // Current page: the last one that has started (pages show slightly before their first word).
  const LEAD = 0.05;
  let pi = -1;
  for (let i = 0; i < pages.length; i++) if (t >= pages[i].start - LEAD) pi = i;
  if (pi < 0 || t > pages[pi].end) return <div style={{ width: W, minHeight: fs * 1.3 }} />;
  const page = pages[pi];

  // Page entrance: snappy pop for punchy styles, fade for clean.
  const pin = progress(t, page.start - LEAD, style === "clean" ? 0.25 : 0.22, style === "clean" ? "out" : "outBack");
  const pageScale = style === "clean" ? 1 : lerp(0.86, 1, pin);
  const pageOpacity = clamp01(pin * 1.6);
  const pageY = style === "clean" ? (1 - pin) * fs * 0.25 : 0;

  const outline = style === "clean" ? `0 ${fs * 0.04}px ${fs * 0.22}px rgba(0,0,0,0.55), 0 0 ${fs * 0.5}px rgba(0,0,0,0.25)` : outlineShadow(Math.max(2, fs * 0.055), "rgba(0,0,0,0.92)", fs * 0.14);

  return (
    <div
      style={{
        width: W,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        columnGap: fs * 0.26,
        rowGap: fs * 0.08,
        fontFamily: font(layer.font, "display"),
        fontSize: fs,
        fontWeight: style === "clean" ? 700 : 900,
        lineHeight: 1.12,
        letterSpacing: style === "clean" ? "-0.01em" : "-0.005em",
        textAlign: "center",
        opacity: pageOpacity,
        transform: `translateY(${pageY}px) scale(${pageScale})`,
      }}
    >
      {page.words.map((w, wi) => {
        const text = upper ? w.text.toUpperCase() : w.text;
        // Active = being spoken; if between words, the last spoken word stays lit until the next begins.
        const nextStart = page.words[wi + 1]?.start ?? page.end;
        const active = t >= w.start && t < Math.max(w.end, nextStart);
        const spoken = t >= w.start;
        const since = t - w.start;

        let wordStyle: React.CSSProperties = { display: "inline-block", position: "relative", color: fg, textShadow: outline, whiteSpace: "nowrap" };
        let boxEl: React.ReactNode = null;

        switch (style) {
          case "karaoke":
            if (active) wordStyle.color = hl;
            break;
          case "pop": {
            // Spring up to 1.15 when spoken, relax back once the word is over.
            const up = spoken ? ease("spring", since / 0.32) : 0;
            const down = t >= w.end ? progress(t, Math.max(w.end, nextStart), 0.18, "out") : 0;
            const s = 1 + 0.15 * up * (1 - down);
            wordStyle = { ...wordStyle, transform: `scale(${s})`, color: active ? hl : fg, zIndex: active ? 1 : 0 };
            break;
          }
          case "box": {
            if (active) {
              const bp = progress(t, w.start, 0.16, "outBack");
              boxEl = (
                <span
                  style={{
                    position: "absolute",
                    left: -fs * 0.16,
                    right: -fs * 0.16,
                    top: -fs * 0.02,
                    bottom: -fs * 0.04,
                    borderRadius: fs * 0.2,
                    background: hl,
                    transform: `scale(${lerp(0.7, 1, bp)}) rotate(${lerp(-4, -1.5, bp)}deg)`,
                    opacity: clamp01(bp * 2),
                    boxShadow: `0 ${fs * 0.06}px ${fs * 0.22}px rgba(0,0,0,0.35)`,
                    zIndex: -1,
                  }}
                />
              );
              wordStyle = { ...wordStyle, color: isLight(hl) ? "#0b0b0f" : fg, textShadow: `0 ${fs * 0.02}px ${fs * 0.06}px rgba(0,0,0,0.25)`, zIndex: 0, isolation: "isolate" };
            }
            break;
          }
          case "bounce": {
            // Each word pops in exactly when spoken; unspoken words keep their slot (no reflow).
            const bp = spoken ? progress(t, w.start, 0.26, "outBack") : 0;
            wordStyle = {
              ...wordStyle,
              opacity: spoken ? clamp01(bp * 3) : 0,
              transform: `translateY(${(1 - bp) * fs * 0.35}px) scale(${lerp(0.45, 1, bp)})`,
              color: active ? hl : fg,
            };
            break;
          }
          case "clean": {
            const fp = spoken ? progress(t, w.start, 0.2, "out") : 0;
            wordStyle = { ...wordStyle, opacity: lerp(0.4, 1, fp) };
            break;
          }
        }

        return (
          <span key={`${pi}-${wi}`} style={wordStyle}>
            {boxEl}
            {text}
          </span>
        );
      })}
    </div>
  );
};
