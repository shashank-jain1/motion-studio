import React, { useLayoutEffect, useRef, useState } from "react";
import { OffthreadVideo, continueRender, delayRender, interpolateColors, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { TextLayer } from "../spec/schema";
import { clamp01, ease, lerp, progress } from "../core/animate";
import { isVideoSrc, useAsset, useColor, useFont } from "../core/context";
import { fontReady } from "../core/fonts";
import { useContainer } from "../core/container";

type Props = { layer: z.infer<typeof TextLayer>; t: number; duration: number };

const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*@$";

type Unit = { text: string; line: number; word: number; idx: number; isSpace: boolean };

const defaultBy = (preset: string, text: string): "char" | "word" | "line" => {
  if (["typewriter", "scramble", "wave", "flip", "stretch", "zoom-from-camera", "drop-in", "pop", "cascade-3d", "weight-wave", "physics"].includes(preset))
    return text.length > 60 ? "word" : "char";
  if (["mask-up", "slide-words", "skew-in", "slot"].includes(preset)) return "word";
  if (["split-reveal", "slice", "echo"].includes(preset)) return "line";
  return text.length > 28 ? "word" : "char";
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Layout geometry of the rendered units (container-relative px), measured once per layout for text fills. */
type Geom = { w: number; h: number; units: Record<number, { x: number; y: number; base: number }>; img?: { w: number; h: number } };

type Variant = "normal" | "outline";

export const KineticText: React.FC<Props> = ({ layer, t, duration }) => {
  const color = useColor();
  const font = useFont();
  const asset = useAsset();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const preset = layer.preset ?? "blur-rise";
  const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  const by = layer.by ?? defaultBy(preset, text);
  const stagger = layer.stagger ?? (by === "char" ? (preset === "cascade-3d" ? 0.04 : 0.03) : by === "word" ? 0.07 : 0.15);
  const unitDur = layer.unitDuration ?? (preset === "typewriter" ? 0 : 0.7);
  const box = useContainer();
  const family = font(layer.font, "display");
  const baseFontSize = layer.fontSize ?? 120;
  const weight = layer.weight ?? 700;
  const lineHeight = layer.lineHeight ?? 1.08;
  const autoFit = layer.fit ?? (layer.maxWidth === undefined && layer.width === undefined);

  // Slot preset: the last word rolls through alternatives -----------------------------------
  const isSlot = preset === "slot" && !!layer.swap?.words.length;
  const textWords = text.split(/\s+/).filter(Boolean);
  const lastWord = textWords[textWords.length - 1] ?? "";
  const slotWords = isSlot ? [lastWord, ...layer.swap!.words.map((w) => (layer.uppercase ? w.toUpperCase() : w))] : [];
  const slotKey = slotWords.join("\u0001");

  // Text fill (image / video seen through the letters) -------------------------------------
  const fillSrc = layer.fill ? asset(layer.fill) : undefined;
  const fillVideo = !!layer.fill && isVideoSrc(layer.fill);

  // Measurement (auto-fit, slot word widths, fill geometry) ---------------------------------
  // Everything is measured from hidden, unanimated copies or from layout boxes (transforms don't affect
  // offsetLeft/offsetTop), once per font/text → identical on every frame → deterministic renders.
  const needsMeasure = autoFit || isSlot || !!fillSrc;
  const measureRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const unitRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const lineProbeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [fit, setFit] = useState<{ scale: number; measured: boolean; slotW: number[] | null; img?: { w: number; h: number } }>({ scale: 1, measured: false, slotW: null });
  const [geom, setGeom] = useState<Geom | null>(null);
  const fitHandle = useRef<number | null>(null);
  const letterSpacingEm = (fs: number) => layer.letterSpacing ?? (fs >= 90 ? -0.035 : -0.01);

  useLayoutEffect(() => {
    if (!needsMeasure) return;
    const handle = delayRender("kinetic-text-measure", { timeoutInMilliseconds: 20000 });
    fitHandle.current = handle;
    let alive = true;
    const shorthand = `${layer.italic ? "italic " : ""}${weight} ${baseFontSize}px ${family}`;
    const imgSize = fillSrc && !fillVideo
      ? new Promise<{ w: number; h: number } | undefined>((res) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res(undefined);
        im.src = fillSrc;
      })
      : Promise.resolve(undefined);
    fontReady(family).then(() => document.fonts.load(shorthand, text + " " + slotWords.join(" "))).catch(() => undefined).then(() => imgSize).then((img) => {
      if (!alive) return;
      let scale = 1;
      if (autoFit) {
        const el = measureRef.current;
        const avail = box.width * 0.9;
        const w = el ? el.scrollWidth : 0;
        scale = w > avail ? avail / w : 1;
      }
      const slotW = isSlot ? slotWords.map((_, i) => (slotRefs.current[i]?.offsetWidth ?? 0) / baseFontSize) : null;
      setGeom(null);
      setFit({ scale, measured: true, slotW, img });
    });
    return () => { alive = false; if (fitHandle.current !== null) { continueRender(fitHandle.current); fitHandle.current = null; } };
  }, [needsMeasure, autoFit, text, baseFontSize, family, weight, layer.italic, layer.letterSpacing, box.width, slotKey, fillSrc]);

  // After the measured layout commits: fill geometry (if needed), then release the frame.
  useLayoutEffect(() => {
    if (!fit.measured) return;
    if (fillSrc && !geom) {
      const c = containerRef.current;
      if (c) {
        const units: Geom["units"] = {};
        const bases = lineProbeRefs.current.map((p) => (p ? p.offsetTop : 0));
        unitRefs.current.forEach((el, key) => {
          const line = Number(el.dataset.line ?? 0);
          units[key] = { x: el.offsetLeft, y: el.offsetTop, base: bases[line] ?? 0 };
        });
        setGeom({ w: c.offsetWidth, h: c.offsetHeight, units, img: fit.img });
        return;
      }
    }
    if (fitHandle.current !== null) { continueRender(fitHandle.current); fitHandle.current = null; }
  }, [fit, geom, fillSrc]);

  const fitScale = fit.scale;
  const fontSize = baseFontSize * fitScale;
  const baseColor = color(layer.color, "$fg");
  const gradient = fillSrc ? undefined : layer.gradient?.map((c) => color(c));
  const exitAt = layer.exitAt ?? (layer.exitPreset && layer.exitPreset !== "none" ? duration - 0.55 : Infinity);
  const seed = layer.id ?? text;

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
  const totalChars = units.filter((u) => !u.isSpace).length;
  const lastWordIdx = wordCounter - 1;

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
    let strokeWave = 0;

    switch (preset) {
      case "none": case "slice": case "echo": break;
      case "blur-rise":
        s = { opacity: p, transform: `translateY(${0.45 * h}em)`, filter: h > 0.01 ? `blur(${0.12 * h * fontSize}px)` : undefined };
        break;
      case "mask-up": case "slot": {
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
      case "physics": {
        // Per-glyph drop: gravity fall (ease-in), impact squash, then an inertial bounce whose size scales with
        // the impact velocity (Ebberts). Seeded variance per glyph: ±15% timing, ±3° rotation, ±15% drop height.
        const r1 = random(`${seed}-ph-a-${charIndex}`), r2 = random(`${seed}-ph-b-${charIndex}`);
        const r3 = random(`${seed}-ph-c-${charIndex}`), r4 = random(`${seed}-ph-d-${charIndex}`);
        const st = start * (1 + (r1 - 0.5) * 0.3);
        const H = 2.4 * (1 + (r2 - 0.5) * 0.3); // em
        const D = Math.max(0.12, unitDur * 0.5 * (1 + (r3 - 0.5) * 0.3));
        const rot0 = (i % 2 === 0 ? -1 : 1) * 5 + (r4 - 0.5) * 6;
        const tau = t - st;
        if (tau < 0) { s = { opacity: 0 }; break; }
        if (tau < D) {
          const k = tau / D;
          s = { opacity: clamp01(k * 5), transform: `translateY(${-H * (1 - k * k)}em) rotate(${rot0}deg)`, transformOrigin: "50% 100%" };
          break;
        }
        const tb = tau - D;
        const v = (2 * H) / D; // em/s at impact
        const w = 2 * Math.PI * 3.1;
        const decay = Math.exp(-6.5 * tb);
        const y = -0.42 * v * Math.abs(Math.sin(w * tb)) * decay / w; // bounces stay above the floor
        const sq = Math.exp(-tb * 22) * Math.min(1, v / 12);
        const rot = rot0 * Math.cos(w * tb) * decay;
        s = { transform: `translateY(${y}em) rotate(${rot}deg) scale(${1 + 0.14 * sq}, ${1 - 0.2 * sq})`, transformOrigin: "50% 100%" };
        break;
      }
      case "cascade-3d": {
        // Glyphs hinge up from below the baseline on rotateX, out of depth, staggered.
        const pe = progress(t, start, unitDur * 1.15, "outExpo");
        const hh = 1 - pe;
        s = {
          opacity: clamp01(pe * 2.5),
          transform: `perspective(${fontSize * 7}px) translate3d(0, ${0.5 * hh}em, ${-1.4 * hh * fontSize}px) rotateX(${-100 * hh}deg)`,
          transformOrigin: "50% 100%",
          filter: hh > 0.02 ? `brightness(${0.45 + 0.55 * pe})` : undefined,
        };
        break;
      }
      case "weight-wave": {
        // Our fonts are static weights, so "weight" is emulated with a same-color text-stroke whose thickness
        // travels across the glyphs as a wave, plus a slight width (scaleX) breathing on the same phase.
        const amp = progress(t, start + unitDur * 0.5, 0.6, "inOut");
        const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t - i * 0.55);
        strokeWave = amp * w;
        s = {
          opacity: p,
          transform: `translateY(${0.35 * h}em) scaleX(${1 + 0.06 * strokeWave})`,
          transformOrigin: "50% 100%",
          filter: h > 0.01 ? `blur(${0.08 * h * fontSize}px)` : undefined,
        };
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
    if (preset === "weight-wave") {
      const sw = fontSize * (0.004 + 0.05 * strokeWave);
      s.WebkitTextStroke = `${sw}px ${String(s.color ?? baseColor)}`;
    }
    return { outer, inner: s, display };
  };

  // Typewriter cursor position
  const visibleChars = preset === "typewriter" ? Math.floor(t / Math.max(stagger, 1e-3)) + 1 : 0;

  // Container-level effects -----------------------------------------------------
  const container: React.CSSProperties = {
    fontFamily: family,
    fontSize,
    fontWeight: weight,
    fontStyle: layer.italic ? "italic" : undefined,
    color: baseColor,
    lineHeight,
    letterSpacing: `${letterSpacingEm(fontSize)}em`,
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

  // Image fill: each unit carries its own slice of the (cover-fitted) image via background-clip:text, so every
  // per-unit preset keeps working and the picture assembles as the letters land.
  const imageFill = !!fillSrc && !fillVideo && !!geom;
  const fillBg = (key: number): React.CSSProperties | null => {
    if (!imageFill || !geom) return null;
    const g = geom.units[key];
    if (!g) return null;
    const iw = geom.img?.w ?? geom.w, ih = geom.img?.h ?? geom.h;
    const kb = lerp(1.12, 1, progress(t, 0, Math.max(1, duration), "out")); // slow settle inside the letters
    const k = Math.max(geom.w / iw, geom.h / ih) * kb;
    const bw = iw * k, bh = ih * k;
    const bx = (geom.w - bw) / 2 - g.x, by = (geom.h - bh) / 2 - g.y;
    return {
      backgroundImage: `url("${fillSrc}")`, backgroundSize: `${bw}px ${bh}px`, backgroundPosition: `${bx}px ${by}px`, backgroundRepeat: "no-repeat",
      WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
    };
  };

  // Slot box ---------------------------------------------------------------------
  const slotNode = (() => {
    if (!isSlot) return null;
    const n = slotWords.length;
    const every = Math.max(0.2, layer.swap?.every ?? 0.7);
    const rollDur = Math.min(every * 0.8, 12 / fps); // 12f expo in-out roll
    const myIdx = units.find((u) => !u.isSpace && u.word === lastWordIdx)?.idx ?? 0;
    const enterStart = Math.max(0, myIdx) * stagger;
    const pin = progress(t, enterStart, unitDur, "outExpo");
    const firstRoll = Math.max(enterStart + unitDur + 0.15, every);
    const maxRolls = layer.swap?.loop ? Infinity : n - 1;
    const since = t - firstRoll;
    let k = 0, e = 0;
    if (since >= 0) {
      const done = Math.floor(since / every);
      const frac = since - done * every;
      if (done >= maxRolls) { k = maxRolls; e = 0; }
      else { k = done; e = frac < rollDur ? ease("inOutExpo", frac / rollDur) : 1; if (e >= 1) { k += 1; e = 0; } }
    }
    const cur = slotWords[k % n], next = slotWords[(k + 1) % n];
    const widths = fit.slotW ?? slotWords.map((w) => w.length * 0.55);
    const wNow = lerp(widths[k % n], widths[(k + 1) % n], e);
    // Emphasis color only when asked for (highlight.color); default keeps the text color so it can never vanish into an accent background.
    const slotColor = layer.highlight?.color ? color(layer.highlight.color) : gradient ? gradient[gradient.length - 1] : baseColor;
    const blur = Math.sin(Math.PI * e) * fontSize * 0.025;
    const item = (w: string, y: number): React.ReactNode => (
      <span style={{ position: "absolute", left: 0, top: 0, whiteSpace: "pre", transform: `translateY(${y}em)`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>{w}</span>
    );
    const pitch = lineHeight * 1.3; // roll spacing: words stay separated while they pass the mask edge
    const yIn = (1 - pin) * pitch;
    return (
      <span key="slot" style={{
        position: "relative", display: "inline-block", width: `${wNow}em`, verticalAlign: "top", color: slotColor,
        clipPath: `inset(-0.06em -0.6em -0.06em -0.6em)`, textAlign: "left",
      }}>
        <span style={{ visibility: "hidden", whiteSpace: "pre", display: "inline-block", width: 0 }}>{cur}</span>
        {item(cur, yIn - e * pitch)}
        {e > 0 && item(next, yIn + (1 - e) * pitch)}
      </span>
    );
  })();

  // Render ----------------------------------------------------------------------
  const renderLines = (variant: Variant, register: boolean): React.ReactNode[] => {
    let charIndex = 0;
    const byLine: React.ReactNode[][] = lines.map(() => []);
    if (register) unitRefs.current.clear();
    units.forEach((u, k) => {
      if (isSlot && !u.isSpace && u.word === lastWordIdx) {
        if (!byLine[u.line].includes(slotNode)) byLine[u.line].push(slotNode);
        return;
      }
      if (u.isSpace && by !== "line") { byLine[u.line].push(<span key={k}>{u.text}</span>); return; }
      const ci = charIndex;
      charIndex += Array.from(u.text).length;
      if (preset === "typewriter" && ci >= visibleChars) return;
      const { outer, inner, display } = unitStyle(u, ci);
      let st: React.CSSProperties = { display: "inline-block", whiteSpace: "pre", ...inner };
      const fb = fillBg(k);
      if (fb) st = { ...st, ...fb };
      if (variant === "outline") {
        st = { ...st, color: "transparent", backgroundImage: undefined, WebkitTextStroke: `${Math.max(1.5, fontSize * 0.014)}px ${String(inner.color ?? baseColor)}` };
      }
      const el = (
        <span key={k} data-line={u.line} style={st}
          ref={register && fillSrc ? (node) => { if (node) unitRefs.current.set(k, node); } : undefined}>{display}</span>
      );
      byLine[u.line].push(outer ? <span key={k} style={outer}>{el}</span> : el);
    });
    return byLine.map((nodes, li) => (
      <div key={li}>
        {register && fillSrc && <span ref={(n) => { lineProbeRefs.current[li] = n; }} style={{ display: "inline-block", width: 0, height: 0 }} />}
        {nodes}
        {li === byLine.length - 1 ? cursor : null}
      </div>
    ));
  };

  const cursor = preset === "typewriter" && Math.floor(t * 2) % 2 === 0
    ? <span style={{ display: "inline-block", width: "0.06em", height: "0.9em", background: baseColor, marginLeft: "0.04em", verticalAlign: "-0.08em" }} />
    : null;

  const measureLs = `${letterSpacingEm(baseFontSize)}em`;
  const measure = needsMeasure ? (
    <div aria-hidden style={{
      position: "absolute", left: 0, top: 0, visibility: "hidden", whiteSpace: "pre", pointerEvents: "none",
      fontFamily: family, fontSize: baseFontSize, fontWeight: weight, fontStyle: layer.italic ? "italic" : undefined,
      letterSpacing: measureLs, width: 0, height: 0, overflow: "visible",
    }}>
      <div ref={measureRef} style={{ display: "inline-block" }}>
        {isSlot ? (
          <>
            {text.slice(0, text.lastIndexOf(lastWord))}
            <span style={{ display: "inline-grid" }}>{slotWords.map((w, i) => <span key={i} style={{ gridArea: "1 / 1" }}>{w}</span>)}</span>
          </>
        ) : text}
      </div>
      {isSlot && slotWords.map((w, i) => (
        <span key={i} ref={(n) => { slotRefs.current[i] = n; }} style={{ display: "inline-block", position: "absolute", left: 0, top: 0 }}>{w}</span>
      ))}
    </div>
  ) : null;

  // Preset compositions (whole-line effects) ---------------------------------------
  const main = renderLines("normal", true);
  let body: React.ReactNode = main;
  const sc = Math.max(0.2, unitDur) / 0.7; // time scale for whole-line presets

  if (preset === "slice") {
    // Bands of the line slide in from alternating sides on a stagger and lock together.
    // Bands are cut across the glyph body (cap height → baseline) so each slice carries letterform, not air.
    const single = lines.length === 1;
    const n = single ? 4 : 5;
    const top = single ? 16 : 0, bottom = single ? 84 : 100;
    const edge = (j: number) => (j <= 0 ? 0 : j >= n ? 100 : top + ((bottom - top) * j) / n);
    const bandDur = 0.55 * sc, bandStagger = 0.05 * sc;
    const settled = t >= (n - 1) * bandStagger + bandDur;
    if (!settled) {
      const bands = Array.from({ length: n }).map((_, j) => {
        const x = clamp01((t - j * bandStagger) / bandDur);
        const pe = 1 - Math.pow(1 - x, 6); // fast travel, decisive lock (short tail)
        const sign = j % 2 === 0 ? -1 : 1;
        const a = edge(j), b = 100 - edge(j + 1);
        const off = sign * (1 - pe) * 110;
        const speed = (1 - pe) * (1 - pe);
        return (
          <div key={j} style={{
            position: j === 0 ? "relative" : "absolute", inset: j === 0 ? undefined : 0,
            clipPath: `inset(${Math.max(0, a - 0.3)}% -200% ${Math.max(0, b - 0.3)}% -200%)`,
            transform: `translateX(${off}%)`, opacity: clamp01(pe * 8),
            filter: speed > 0.03 ? `blur(${speed * fontSize * 0.05}px)` : undefined,
          }}>{j === 0 ? main : renderLines("normal", false)}</div>
        );
      });
      body = bands;
    }
  }

  if (preset === "echo") {
    // DIA-style stacked repeats: rows slide in on phase-shifted offsets (outline/fill alternating), hold as a
    // typographic texture, then collapse into one filled line.
    const count = Math.max(3, Math.min(13, layer.echoCount ?? 7));
    const m = Math.floor((count - 1) / 2);
    const gap = lines.length * lineHeight * 0.9; // em between rows
    const slideDur = 0.9 * sc;
    const tR = (0.9 + 0.07 * m + 0.45) * sc;
    const fillP = progress(t, tR + 0.25 * sc, 0.4 * sc, "inOut");
    const rows: React.ReactNode[] = [];
    const outlineNodes = renderLines("outline", false);
    const fillNodes = renderLines("normal", false);
    for (let k = -m; k <= m; k++) {
      if (k === 0) continue;
      const a = Math.abs(k);
      const pIn = progress(t, a * 0.07 * sc, slideDur, "outExpo");
      const r = progress(t, tR + (m - a) * 0.05 * sc, 0.55 * sc, "inOutExpo");
      if (r >= 1 || t < a * 0.07 * sc) continue;
      const dir = (k % 2 === 0 ? 1 : -1) * (k < 0 ? 1 : -1);
      const drift = Math.sin(2 * Math.PI * 0.45 * t + a * 0.9) * 0.12 * (1 - r) * pIn;
      const x = dir * (1 - pIn) * (35 + 12 * a);
      rows.push(
        <div key={k} aria-hidden style={{
          position: "absolute", inset: 0, transform: `translate(${x}%, ${k * gap * (1 - r)}em) translateX(${drift * dir}em)`,
          opacity: (1 - clamp01((r - 0.45) / 0.55)) * clamp01(pIn * 3),
        }}>{a % 2 === 1 ? fillNodes : outlineNodes}</div>,
      );
    }
    const pC = progress(t, 0, slideDur, "outExpo");
    body = (
      <>
        {rows}
        <div style={{ position: "relative", transform: `translateX(${(1 - pC) * -25}%)`, opacity: clamp01(pC * 3) }}>
          {renderLines("outline", false)}
          <div style={{ position: "absolute", inset: 0, opacity: fillP }}>{main}</div>
        </div>
      </>
    );
  }

  // Video fill: the letters animate in solid, then open up into a window onto the footage
  // (SVG clipPath built from the measured glyph positions; static once the entrance has settled).
  let videoWindow: React.ReactNode = null;
  if (fillSrc && fillVideo && geom) {
    const lastStart = Math.max(0, (by === "line" ? lines.length : idx) - 1) * stagger;
    const winP = progress(t, lastStart + unitDur * 0.9, 0.5, "inOut");
    const clipId = `ktfill-${String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}-${Math.round(baseFontSize)}`;
    const ls = letterSpacingEm(fontSize) * fontSize;
    const texts: React.ReactNode[] = [];
    units.forEach((u, k) => {
      const g = geom.units[k];
      if (!g || u.isSpace) return;
      texts.push(<text key={k} x={g.x} y={g.base} style={{ fontFamily: family, fontSize, fontWeight: weight, fontStyle: layer.italic ? "italic" : undefined, letterSpacing: ls, whiteSpace: "pre" }}>{u.text}</text>);
    });
    if (winP > 0) {
      videoWindow = (
        <>
          <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">{texts}</clipPath>
          </svg>
          <div style={{ position: "absolute", left: 0, top: 0, width: geom.w, height: geom.h, clipPath: `url(#${clipId})`, opacity: winP }}>
            <OffthreadVideo src={fillSrc} muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${lerp(1.15, 1, winP)})` }} />
          </div>
        </>
      );
    }
  }

  return (
    <div ref={containerRef} style={{ ...container, position: "relative" }}>
      {measure}
      {body}
      {glitchLayers}
      {videoWindow}
    </div>
  );
};
