import React, { useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, interpolateColors, random, useCurrentFrame } from "remotion";
import type { z } from "zod";
import type { TextLayer } from "../spec/schema";
import { clamp01, ease, lerp, progress } from "../core/animate";
import { useColor, useFont } from "../core/context";
import { fontReady } from "../core/fonts";
import { useContainer } from "../core/container";

type Props = { layer: z.infer<typeof TextLayer>; t: number; duration: number };

const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*@$";

type Unit = { text: string; line: number; word: number; idx: number; isSpace: boolean };

const defaultBy = (preset: string, text: string): "char" | "word" | "line" => {
  if (["typewriter", "scramble", "wave", "flip", "stretch", "zoom-from-camera", "drop-in", "pop"].includes(preset))
    return text.length > 60 ? "word" : "char";
  if (["mask-up", "slide-words", "skew-in"].includes(preset)) return "word";
  if (["split-reveal"].includes(preset)) return "line";
  return text.length > 28 ? "word" : "char";
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const KineticText: React.FC<Props> = ({ layer, t, duration }) => {
  const color = useColor();
  const font = useFont();
  const frame = useCurrentFrame();
  const preset = layer.preset ?? "blur-rise";
  const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  const by = layer.by ?? defaultBy(preset, text);
  const stagger = layer.stagger ?? (by === "char" ? 0.03 : by === "word" ? 0.07 : 0.15);
  const unitDur = layer.unitDuration ?? (preset === "typewriter" ? 0 : 0.7);
  const box = useContainer();
  const family = font(layer.font, "display");
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; measured: boolean }>({ scale: 1, measured: false });
  const fitHandle = useRef<number | null>(null);
  const autoFit = layer.fit ?? (layer.maxWidth === undefined && layer.width === undefined);
  const baseFontSize = layer.fontSize ?? 120;
  const weight = layer.weight ?? 700;
  // Auto-fit: once the exact font face is loaded, measure a hidden, unanimated copy
  // (identical on every frame → deterministic), then release the frame after the re-render commits.
  useLayoutEffect(() => {
    if (!autoFit) return;
    const handle = delayRender("kinetic-text-fit", { timeoutInMilliseconds: 20000 });
    fitHandle.current = handle;
    let alive = true;
    const shorthand = `${layer.italic ? "italic " : ""}${weight} ${baseFontSize}px ${family}`;
    fontReady(family).then(() => document.fonts.load(shorthand, text)).catch(() => undefined).then(() => {
      if (!alive) return;
      const el = measureRef.current;
      const avail = box.width * 0.9;
      const w = el ? el.scrollWidth : 0;
      setFit({ scale: w > avail ? avail / w : 1, measured: true });
    });
    return () => { alive = false; if (fitHandle.current !== null) { continueRender(fitHandle.current); fitHandle.current = null; } };
  }, [autoFit, text, baseFontSize, family, weight, layer.italic, layer.letterSpacing, box.width]);
  useLayoutEffect(() => {
    if (fit.measured && fitHandle.current !== null) { continueRender(fitHandle.current); fitHandle.current = null; }
  }, [fit]);
  const fitScale = fit.scale;
  const fontSize = baseFontSize * fitScale;
  const baseColor = color(layer.color, "$fg");
  const gradient = layer.gradient?.map((c) => color(c));
  const exitAt = layer.exitAt ?? (layer.exitPreset && layer.exitPreset !== "none" ? duration - 0.55 : Infinity);

  // Build units ---------------------------------------------------------------
  const lines = text.split("\n");
  const units: Unit[] = [];
  let idx = 0;
  let wordCounter = 0;
  lines.forEach((ln, li) => {
    const words = ln.split(/(\s+)/);
    words.forEach((w) => {
      if (w.length === 0) return;
      const isSpace = /^\s+$/.test(w);
      if (by === "char" && !isSpace) {
        for (const ch of Array.from(w)) units.push({ text: ch, line: li, word: wordCounter, idx: idx++, isSpace: false });
      } else if (by === "line") {
        units.push({ text: w, line: li, word: wordCounter, idx: li, isSpace });
      } else {
        units.push({ text: w, line: li, word: wordCounter, idx: isSpace ? -1 : idx++, isSpace });
      }
      if (!isSpace) wordCounter++;
    });
  });
  const unitCount = by === "line" ? lines.length : idx;
  const totalChars = units.filter((u) => !u.isSpace).length;

  const wordTexts: string[] = [];
  units.forEach((u) => { if (!u.isSpace) wordTexts[u.word] = (wordTexts[u.word] ?? "") + u.text; });
  const hlSet = new Set((layer.highlight?.words ?? []).map(norm));
  const hlColor = color(layer.highlight?.color, "$accent");
  const hlP = layer.highlight ? progress(t, layer.highlight.at ?? 0.6, 0.5, "outQuint") : 0;

  // Per-unit style ------------------------------------------------------------
  const unitStyle = (u: Unit, charIndex: number): { outer?: React.CSSProperties; inner: React.CSSProperties; display: string } => {
    const i = u.idx < 0 ? 0 : u.idx;
    const start = i * stagger;
    const p = unitDur === 0 ? (t >= start ? 1 : 0) : progress(t, start, unitDur, undefined, "outQuint");
    const h = 1 - p;
    let s: React.CSSProperties = {};
    let outer: React.CSSProperties | undefined;
    let display = u.text;

    switch (preset) {
      case "none": break;
      case "blur-rise":
        s = { opacity: p, transform: `translateY(${0.45 * h}em)`, filter: h > 0.01 ? `blur(${0.12 * h * fontSize}px)` : undefined };
        break;
      case "mask-up": {
        const pe = progress(t, start, unitDur, "outExpo");
        outer = { overflow: "hidden", display: "inline-block", verticalAlign: "top", paddingBottom: "0.08em", marginBottom: "-0.08em" };
        s = { transform: `translateY(${(1 - pe) * 110}%) rotate(${(1 - pe) * 4}deg)`, transformOrigin: "left bottom" };
        break;
      }
      case "pop": {
        const pp = progress(t, start, unitDur, "outBack");
        s = { transform: `scale(${pp})`, opacity: clamp01(pp * 3) };
        break;
      }
      case "flip":
        s = { transform: `perspective(600px) rotateX(${-95 * h}deg)`, transformOrigin: "50% 100%", opacity: clamp01(p * 2) };
        break;
      case "typewriter":
        s = { opacity: p };
        break;
      case "scramble": {
        const settle = start + Math.max(unitDur, 0.3);
        if (t < start) s = { opacity: 0 };
        else if (t < settle && !u.isSpace && u.text.trim()) {
          const r = random(`${layer.id ?? "t"}-${charIndex}-${Math.floor(frame / 2)}`);
          display = SCRAMBLE[Math.floor(r * SCRAMBLE.length)];
          s = { opacity: 0.6, color: color("$accent") };
        }
        break;
      }
      case "wave": {
        const wv = Math.sin(t * 5 - i * 0.45) * 0.08;
        s = { opacity: p, transform: `translateY(${0.5 * h + wv}em)` };
        break;
      }
      case "stretch":
        s = { opacity: p, transform: `scaleY(${1 + 2.2 * h}) scaleX(${1 - 0.6 * h})`, transformOrigin: "50% 100%", filter: h > 0.01 ? `blur(${6 * h}px)` : undefined };
        break;
      case "tracking": break; // handled at container level
      case "slide-words":
        s = { opacity: p, transform: `translateX(${1.2 * h}em)`, filter: h > 0.01 ? `blur(${10 * h}px)` : undefined };
        break;
      case "zoom-from-camera": {
        const pz = progress(t, start, unitDur, "outExpo");
        s = { opacity: clamp01(pz * 1.5), transform: `scale(${lerp(5, 1, pz)})`, filter: pz < 0.99 ? `blur(${(1 - pz) * 24}px)` : undefined };
        break;
      }
      case "gradient-sweep": break;
      case "drop-in": {
        const pd = progress(t, start, unitDur * 1.3, "outBounce");
        s = { opacity: clamp01((t - start) * 8), transform: `translateY(${-(1 - pd) * 3}em)` };
        break;
      }
      case "skew-in":
        s = { opacity: p, transform: `translateX(${0.8 * h}em) skewX(${-25 * h}deg)` };
        break;
      case "glitch": {
        const g = t - start < 0.35 && !u.isSpace ? random(`${charIndex}-${frame}`) : 0;
        s = { opacity: t >= start ? 1 : 0, transform: g > 0.6 ? `translate(${(g - 0.8) * 0.3}em, ${(random(frame) - 0.5) * 0.1}em)` : undefined };
        break;
      }
      case "split-reveal": {
        const pe = progress(t, start, unitDur, "outExpo");
        s = { clipPath: `inset(${50 * (1 - pe)}% 0 ${50 * (1 - pe)}% 0)`, transform: `scaleY(${lerp(1.3, 1, pe)})` };
        break;
      }
    }

    // Exit -------------------------------------------------------------------
    if (t >= exitAt && layer.exitPreset && layer.exitPreset !== "none") {
      const ex = progress(t, exitAt + i * stagger * 0.5, 0.45, "in");
      const ep = layer.exitPreset;
      const prev = s.transform ?? "";
      if (ep === "fade") s = { ...s, opacity: (s.opacity as number ?? 1) * (1 - ex) };
      if (ep === "blur-out") s = { ...s, opacity: 1 - ex, filter: `blur(${ex * 20}px)` };
      if (ep === "rise-out") s = { ...s, opacity: 1 - ex, transform: `${prev} translateY(${-ex * 0.6}em)` };
      if (ep === "drop-out") s = { ...s, opacity: 1 - ex, transform: `${prev} translateY(${ex * 0.8}em) rotate(${ex * 10}deg)` };
      if (ep === "scatter") {
        const a = random(`sc${charIndex}`) * Math.PI * 2;
        s = { ...s, opacity: 1 - ex, transform: `${prev} translate(${Math.cos(a) * ex * 3}em, ${Math.sin(a) * ex * 3}em) rotate(${(random(`r${charIndex}`) - 0.5) * 360 * ex}deg)` };
      }
      if (ep === "mask-down") {
        outer = { overflow: "hidden", display: "inline-block", verticalAlign: "top", paddingBottom: "0.08em", marginBottom: "-0.08em" };
        s = { ...s, transform: `${prev} translateY(${ex * 110}%)` };
      }
    }

    // Color: gradient across units, highlight words ---------------------------
    if (gradient && gradient.length >= 2 && !s.color) {
      const f = totalChars <= 1 ? 0 : charIndex / (totalChars - 1);
      s.color = interpolateColors(f, gradient.map((_, k) => k / (gradient.length - 1)), gradient);
    }
    if (!u.isSpace && hlSet.has(norm(wordTexts[u.word] ?? ""))) {
      const style = layer.highlight?.style ?? "color";
      if (style === "color") s.color = interpolateColors(hlP, [0, 1], [String(s.color ?? baseColor), hlColor]);
      else {
        const marker = style === "marker" ? "45%" : style === "underline" ? "10%" : "100%";
        s.backgroundImage = `linear-gradient(${hlColor}, ${hlColor})`;
        s.backgroundRepeat = "no-repeat";
        s.backgroundPosition = "0 88%";
        s.backgroundSize = `${hlP * 100}% ${marker}`;
        if (style === "box") { s.backgroundPosition = "0 50%"; s.color = interpolateColors(hlP, [0, 1], [baseColor, color("$bg")]); }
      }
    }
    return { outer, inner: s, display };
  };

  // Typewriter cursor position
  const visibleChars = preset === "typewriter" ? Math.floor(t / Math.max(stagger, 1e-3)) + 1 : 0;

  // Container-level effects -----------------------------------------------------
  const container: React.CSSProperties = {
    fontFamily: family,
    fontSize,
    fontWeight: layer.weight ?? 700,
    fontStyle: layer.italic ? "italic" : undefined,
    color: baseColor,
    lineHeight: layer.lineHeight ?? 1.08,
    letterSpacing: `${layer.letterSpacing ?? (fontSize >= 90 ? -0.035 : -0.01)}em`,
    textAlign: layer.align ?? "center",
    maxWidth: layer.maxWidth ?? layer.width,
    whiteSpace: "pre-wrap",
    WebkitTextStroke: layer.stroke ? `${layer.stroke.width}px ${color(layer.stroke.color)}` : undefined,
    textShadow: layer.glow
      ? (() => { const g = color(typeof layer.glow === "string" ? layer.glow : "$accent"); return `0 0 ${fontSize * 0.15}px ${g}, 0 0 ${fontSize * 0.45}px ${g}`; })()
      : undefined,
  };
  if (preset === "tracking") {
    const p = progress(t, 0, unitDur * 1.6, "outExpo");
    container.letterSpacing = `${lerp(0.6, layer.letterSpacing ?? -0.02, p)}em`;
    container.opacity = p;
    container.filter = p < 0.99 ? `blur(${(1 - p) * 10}px)` : undefined;
  }
  if (preset === "gradient-sweep") {
    const g = gradient ?? [baseColor, color("$accent"), color("$accent2", "$accent"), baseColor];
    const p = progress(t, 0, Math.max(1.2, duration * 0.8), "inOut");
    container.backgroundImage = `linear-gradient(100deg, ${g.join(", ")})`;
    container.backgroundSize = "300% 100%";
    container.backgroundPosition = `${100 - p * 100}% 50%`;
    container.WebkitBackgroundClip = "text";
    container.backgroundClip = "text";
    container.color = "transparent";
    container.opacity = progress(t, 0, 0.4);
  }
  let glitchLayers: React.ReactNode = null;
  if (preset === "glitch" && t < 0.6) {
    const j = random(`g${frame}`);
    if (j > 0.35) {
      const off = (j - 0.5) * 0.06;
      glitchLayers = (
        <>
          <div style={{ position: "absolute", inset: 0, color: "#ff004c", transform: `translateX(${off}em)`, mixBlendMode: "screen", opacity: 0.8 }}>{text}</div>
          <div style={{ position: "absolute", inset: 0, color: "#00e5ff", transform: `translateX(${-off}em)`, mixBlendMode: "screen", opacity: 0.8 }}>{text}</div>
        </>
      );
    }
  }

  // Render ----------------------------------------------------------------------
  let charIndex = 0;
  const byLine: React.ReactNode[][] = lines.map(() => []);
  units.forEach((u, k) => {
    if (u.isSpace && by !== "line") { byLine[u.line].push(<span key={k}>{u.text}</span>); return; }
    const ci = charIndex;
    charIndex += Array.from(u.text).length;
    if (preset === "typewriter" && ci >= visibleChars) return;
    const { outer, inner, display } = unitStyle(u, ci);
    const el = <span key={k} style={{ display: "inline-block", whiteSpace: "pre", ...inner }}>{display}</span>;
    byLine[u.line].push(outer ? <span key={k} style={outer}>{el}</span> : el);
  });
  const cursor = preset === "typewriter" && Math.floor(t * 2) % 2 === 0
    ? <span style={{ display: "inline-block", width: "0.06em", height: "0.9em", background: baseColor, marginLeft: "0.04em", verticalAlign: "-0.08em" }} />
    : null;

  const measure = autoFit ? (
    <div ref={measureRef} aria-hidden style={{
      position: "absolute", left: 0, top: 0, visibility: "hidden", whiteSpace: "pre", pointerEvents: "none",
      fontFamily: family, fontSize: baseFontSize, fontWeight: weight, fontStyle: layer.italic ? "italic" : undefined,
      letterSpacing: `${layer.letterSpacing ?? (baseFontSize >= 90 ? -0.035 : -0.01)}em`,
    }}>{text}</div>
  ) : null;

  return (
    <div style={{ ...container, position: "relative" }}>
      {measure}
      {byLine.map((nodes, li) => (
        <div key={li}>{nodes}{li === byLine.length - 1 ? cursor : null}</div>
      ))}
      {glitchLayers}
    </div>
  );
};
