/**
 * Logo reveal layer: every mode in LOGO_MODES, driven by the Node-side analyzer output (`<logo>.svg.logo.json`).
 *
 * Rules (docs/research/02 §1.4, 01 §3): hero reveal ~0.7–1.8 s, stagger capped (≤ 0.6 s, eased distribution),
 * 2–6 % overshoot on landings, exact brand colors, and once the reveal is done the logo is rendered as plain
 * <path d fill fill-rule> with no transforms/masks/filters, so the held frame is pixel-exact.
 * Everything is a pure function of `t` (frames render out of order): no Math.random, timers or CSS transitions.
 */
import React, { useEffect, useId, useMemo, useState } from "react";
import { Easing, OffthreadVideo, random, useDelayRender } from "remotion";
import type { z } from "zod";
import type { LogoLayer, LOGO_MODES } from "../spec/schema";
import { EASING, clamp01 } from "../core/animate";
import { isVideoSrc, useAsset, useColor } from "../core/context";
import { useContainer } from "../core/container";
import { type BBox, type GPath, areaCentroid, interiorPoint, lengthTable, lengthTableFromPts, parsePath, polylines, splitSubpaths, strokeOutline, unionBBox } from "../shapes/geom";
import { type LogoAnalysis, type LogoOrder, type LogoPart, fitRaw, logoJsonPath, resolveRaw, selectLogoParts, sourceAssets, useFontKey, useJsonAssets } from "../shapes/resolve";
import { type MultiMorph, prepMultiMorph } from "../shapes/morph";
import { mixColor, settleEase } from "./Morph";

type Props = { layer: z.infer<typeof LogoLayer>; t: number; duration: number };
type Mode = (typeof LOGO_MODES)[number];

// ---------------------------------------------------------------------------------------------
// timing helpers

const smooth = (e0: number, e1: number, x: number) => {
  const k = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return k * k * (3 - 2 * k);
};
/** Damped spring that settles EXACTLY at u=1. decay/osc tune the overshoot (≈ 2–6 %). */
const spring = (u: number, decay = 5.5, osc = 1.1) => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 1 - Math.cos(2 * Math.PI * osc * u) * Math.exp(-decay * u) * (1 - u);
};
const SPRING_SOFT = [6.5, 1.1] as const; // ~3 %
const SPRING_HERO = [5.5, 1.1] as const; // ~4.5 %
const SPRING_POP = [4.5, 1.05] as const; // ~6 %
const outQuad = (x: number) => 1 - (1 - x) * (1 - x);
/** calm reveal curve: quick departure, long settle (Carbon "expressive entrance"-like) */
const MASK_BEZ = Easing.bezier(0.3, 0.05, 0.1, 1);
const MASK_EASE = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : MASK_BEZ(x));

const DEFAULT_T: Record<Mode, number> = {
  draw: 1.8, build: 1.2, assemble: 1.4, "morph-from": 1.4, mask: 1.2, cascade: 1.2, glitch: 0.9,
  liquid: 1.7, window: 1.9, split: 1.0, trace: 2.0, pop: 0.8,
};
const DEFAULT_ORDER: Partial<Record<Mode, LogoOrder>> = {
  build: "bySizeDesc", cascade: "leftToRight", assemble: "radialOut", draw: "leftToRight", trace: "leftToRight",
  "morph-from": "leftToRight", split: "topToBottom",
};
const RASTER_MODES = new Set<Mode>(["mask", "pop", "glitch", "split", "liquid"]);

/** Eased, capped stagger: total spread ≤ 0.6 s (or ≤ half the reveal). */
const makeDelays = (n: number, T: number, stagger?: number) => {
  if (n <= 1) return { spread: 0, at: (_i: number) => 0 };
  const base = stagger !== undefined ? stagger * (n - 1) : Math.min(0.07 * (n - 1), 0.45);
  const spread = Math.max(0, Math.min(0.6, base, T * 0.5));
  return { spread, at: (i: number) => spread * outQuad(i / (n - 1)) };
};

const tf = (cx: number, cy: number, o: { x?: number; y?: number; r?: number; s?: number; sx?: number; sy?: number }) => {
  const sx = (o.s ?? 1) * (o.sx ?? 1), sy = (o.s ?? 1) * (o.sy ?? 1);
  return `translate(${cx + (o.x ?? 0)} ${cy + (o.y ?? 0)}) rotate(${o.r ?? 0}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`;
};

// ---------------------------------------------------------------------------------------------
// raster natural size (module cache + delayRender)

const imgCache = new Map<string, { done: boolean; w: number; h: number; p: Promise<void> }>();
const loadImgSize = (url: string) => {
  const hit = imgCache.get(url);
  if (hit) return hit;
  const e = { done: false, w: 0, h: 0, p: Promise.resolve() };
  e.p = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      e.w = img.naturalWidth || 1;
      e.h = img.naturalHeight || 1;
      // make sure the bitmap is decoded before the frame is captured
      (img.decode ? img.decode() : Promise.resolve()).catch(() => undefined).then(() => resolve());
    };
    img.onerror = () => resolve();
    img.src = url;
  }).then(() => {
    e.done = true;
  });
  imgCache.set(url, e);
  return e;
};
const useImageSize = (url: string | null) => {
  const { delayRender, continueRender } = useDelayRender();
  const [, bump] = useState(0);
  const [h] = useState(() => (url && !loadImgSize(url).done ? { id: delayRender(`logo image ${url}`), open: true } : null));
  useEffect(() => {
    if (!url) return;
    let live = true;
    loadImgSize(url).p.then(() => {
      if (live) bump((x) => x + 1);
      if (h?.open) {
        h.open = false;
        continueRender(h.id);
      }
    });
    return () => {
      live = false;
    };
  }, [url, h, continueRender]);
  const e = url ? imgCache.get(url) : undefined;
  return e?.done ? { w: e.w || 1, h: e.h || 1 } : null;
};

// ---------------------------------------------------------------------------------------------

/** shapeD: fill geometry for morph/clip (stroke-only parts → their outline) */
type PartInfo = LogoPart & { cx: number; cy: number; subs: string[]; paint: string; gid?: string; shapeD: string };

export const Logo: React.FC<Props> = ({ layer, t, duration }) => {
  const color = useColor();
  const asset = useAsset();
  const box = useContainer();
  const uid = "lg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const isSvg = /\.svg(\?|#|$)/i.test(layer.src);
  const requested: Mode = layer.mode ?? "build";
  const fromSrc = layer.from ?? "circle";
  const needs = useMemo(
    () => (isSvg ? [logoJsonPath(layer.src), ...(requested === "morph-from" ? sourceAssets(fromSrc) : [])] : []),
    [isSvg, layer.src, requested, fromSrc],
  );
  const assets = useJsonAssets(needs);
  const logo = isSvg && assets.ready ? assets.get<LogoAnalysis>(logoJsonPath(layer.src)) : null;
  const vector = !!logo && Array.isArray(logo.parts) && logo.parts.length > 0;
  const rasterUrl = asset(layer.src);
  const imgSize = useImageSize(!vector && (assets.ready || !isSvg) ? rasterUrl : null);
  const fontKey = useFontKey(undefined, undefined);
  const windowImg = requested === "window" && layer.windowSrc && !isVideoSrc(layer.windowSrc) ? asset(layer.windowSrc) : null;
  useImageSize(windowImg);

  // ---------------- geometry prep (once per logo/options)
  const overridePaint = layer.color ? color(layer.color) : undefined;
  const prep = useMemo(() => {
    if (!vector || !logo) return null;
    const sel = selectLogoParts(logo, layer.parts ?? "all");
    const parts: PartInfo[] = sel.map((p) => {
      const c = p.centroid && Number.isFinite(p.centroid[0]) ? { cx: p.centroid[0], cy: p.centroid[1] } : areaCentroid(parsePath(p.d));
      const paint = overridePaint ?? p.fill;
      const grad = !overridePaint && p.gradient;
      return {
        ...p, cx: c.cx, cy: c.cy, subs: p.strokeOnly ? [p.d] : splitSubpaths(p.d), shapeD: p.strokeOnly ? strokeOutline(p.d, p.strokeWidth ?? 2) : p.d, paint: grad && grad.length > 1 ? `url(#${uid}g${p.id})` : paint,
        gid: grad && grad.length > 1 ? `${uid}g${p.id}` : undefined,
      };
    });
    const bb = unionBBox(parts.map((p) => p.bbox));
    const [vx0, vy0, vw0, vh0] = logo.viewBox;
    const pad = Math.max(bb.w, bb.h) * 0.04;
    const view: BBox = (layer.parts ?? "all") === "all" && vw0 > 0 && vh0 > 0
      ? { x: vx0, y: vy0, w: vw0, h: vh0 }
      : { x: bb.x - pad, y: bb.y - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad };
    const orderName: LogoOrder = layer.order ?? DEFAULT_ORDER[requested] ?? "bySizeDesc";
    const ids = new Set(parts.map((p) => p.id));
    const ord = (logo.orders?.[orderName] ?? []).filter((id) => ids.has(id));
    for (const p of parts) if (!ord.includes(p.id)) ord.push(p.id);
    const rank = new Map(ord.map((id, i) => [id, i]));
    const center = areaCentroid(parts.flatMap((p) => parsePath(p.d)));
    return { parts, bb, view, rank, n: parts.length, center: { x: center.cx, y: center.cy } };
  }, [vector, logo, layer.parts, overridePaint, layer.order, requested, uid]);

  // ---------------- sizing
  const view: BBox | null = prep ? prep.view : imgSize ? { x: 0, y: 0, w: imgSize.w, h: imgSize.h } : null;
  const aspect = view ? view.w / view.h : 1;
  let W: number, H: number;
  if (layer.width && layer.height) {
    W = layer.width;
    H = layer.height;
  } else if (layer.width) {
    W = layer.width;
    H = W / aspect;
  } else {
    H = layer.height ?? 300;
    W = H * aspect;
  }
  const k = view ? Math.min(W / view.w, H / view.h) : 1; // px per view unit

  // mode resolution (raster fallbacks)
  const mode: Mode = vector ? requested : RASTER_MODES.has(requested) ? requested : "mask";
  const T = Math.max(0.2, layer.revealDuration ?? DEFAULT_T[mode]);

  // ---------------- morph-from prep
  const morph = useMemo<{ mm: MultiMorph; fromD: string; order: number[] } | null>(() => {
    if (mode !== "morph-from" || !prep || !assets.ready) return null;
    const raw = resolveRaw(fromSrc, { get: assets.get, ...fontKey });
    const side = Math.min(prep.bb.w, prep.bb.h) * 1.05;
    const cx = prep.bb.x + prep.bb.w / 2, cy = prep.bb.y + prep.bb.h / 2;
    const fromParts = fitRaw(raw, { x: cx - side / 2, y: cy - side / 2, w: side, h: side });
    const fromD = fromParts.map((p) => p.d).join("");
    const mm = prepMultiMorph([fromD], prep.parts.map((p) => p.shapeD));
    const order = mm.pairs.map((pr) => prep.rank.get(prep.parts[pr.to]?.id ?? -1) ?? 0);
    return { mm, fromD, order };
  }, [mode, prep, assets.ready, fromSrc, fontKey.family, fontKey.weight]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- trace / window prep
  const tracePrep = useMemo(() => {
    if (!prep || mode !== "trace") return null;
    const main = prep.parts.reduce((a, b) => ((b.length ?? 0) > (a.length ?? 0) ? b : a), prep.parts[0]);
    // open centerlines (stroke-only parts) must not be auto-closed, or the dot would ride back along the closing chord
    const line = main.strokeOnly ? polylines(main.d, 24)[0] : null;
    const sub = parsePath(main.d)[0];
    return { main, table: line ? lengthTableFromPts(line.pts) : sub ? lengthTable(sub, 24) : null };
  }, [prep, mode]);
  const pivot = useMemo(() => {
    if (!prep || mode !== "window") return null;
    const big = prep.parts.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a), prep.parts[0]);
    const [x, y] = interiorPoint(parsePath(big.shapeD) as GPath);
    return { x, y };
  }, [prep, mode]);

  if (!view || (!vector && !imgSize)) return <div style={{ width: W, height: H }} />;

  // ---------------------------------------------------------------------------------------------
  // painting primitives

  const vb = `${view.x} ${view.y} ${view.w} ${view.h}`;
  const unit = 1 / k; // one screen px in view units
  const containerSpan = Math.max(box.width, box.height) / k;

  const defs: React.ReactNode[] = [];
  if (prep) {
    for (const p of prep.parts) {
      const g = p.gradient;
      if (p.gid && g) {
        defs.push(
          <linearGradient key={p.gid} id={p.gid} gradientUnits="userSpaceOnUse" x1={p.bbox.x} y1={p.bbox.y} x2={p.bbox.x + p.bbox.w} y2={p.bbox.y + p.bbox.h}>
            {g.map((c, i) => <stop key={i} offset={i / (g.length - 1)} stopColor={c} />)}
          </linearGradient>,
        );
      }
    }
  }

  /** One logo part, exactly as authored (strokeOnly parts are strokes). */
  const partEl = (p: PartInfo, key: React.Key, extra: React.SVGProps<SVGPathElement> = {}, paintOverride?: string) => {
    const paint = paintOverride ?? p.paint;
    const op = p.opacity !== undefined && p.opacity < 1 ? p.opacity : undefined;
    if (p.strokeOnly) {
      return <path key={key} d={p.d} fill="none" stroke={paint} strokeWidth={p.strokeWidth ?? 2 * unit} strokeLinecap="round" strokeLinejoin="round" opacity={op} {...extra} />;
    }
    return (
      <path key={key} d={p.d} fill={paint} fillRule={p.fillRule ?? "nonzero"} opacity={op}
        stroke={p.stroke ? (overridePaint ?? p.stroke) : undefined} strokeWidth={p.stroke ? p.strokeWidth : undefined} {...extra} />
    );
  };
  const rasterEl = (key: React.Key, extra: React.SVGProps<SVGImageElement> = {}) => (
    <image key={key} href={rasterUrl} x={view.x} y={view.y} width={view.w} height={view.h} preserveAspectRatio="xMidYMid meet" {...extra} />
  );
  /** The whole logo art (vector parts or the raster image), optionally recolored. */
  const art = (key: React.Key, paintOverride?: string) =>
    prep ? <g key={key}>{prep.parts.map((p, i) => partEl(p, i, {}, paintOverride))}</g> : rasterEl(key);
  const restArt = () => art("rest");

  const svgWrap = (children: React.ReactNode, extraDefs: React.ReactNode[] = [], style?: React.CSSProperties) => (
    <div style={{ position: "relative", width: W, height: H }}>
      <svg width={W} height={H} viewBox={vb} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, overflow: "visible", ...style }}>
        {(defs.length > 0 || extraDefs.length > 0) && <defs>{defs}{extraDefs}</defs>}
        {children}
      </svg>
    </div>
  );

  const bb = prep ? prep.bb : view;
  const ccx = bb.x + bb.w / 2, ccy = bb.y + bb.h / 2;
  const rank = (p: PartInfo) => prep?.rank.get(p.id) ?? 0;
  const N = prep?.n ?? 1;
  const delays = makeDelays(N, T, layer.stagger);
  const partDur = Math.max(0.35, T - delays.spread);
  const uOf = (p: PartInfo, durScale = 1) => clamp01((t - delays.at(rank(p))) / (partDur * durScale));
  const strokeW = Math.max(2.2, Math.min(4, Math.min(W, H) * 0.011)) * unit;

  // ---------------------------------------------------------------------------------------------
  // exit (near layer end)

  const exitMode = layer.exitMode ?? "none";
  const E = Math.min(0.7, duration * 0.3);
  const exitStart = duration - E;
  if (exitMode !== "none" && t >= exitStart && t > T) {
    const q = clamp01((t - exitStart) / E);
    if (exitMode === "fade" || !prep) {
      const s = exitMode === "explode" ? 1 + 0.25 * EASING.in(q) : exitMode === "collapse" ? 1 - EASING.inBack(q) : 1 - 0.04 * q;
      return svgWrap(<g transform={tf(ccx, ccy, { s: Math.max(0.001, s) })} opacity={1 - EASING.out(q)}>{restArt()}</g>);
    }
    if (exitMode === "explode") {
      const e = EASING.in(q);
      return svgWrap(prep.parts.map((p, i) => {
        let dx = p.cx - prep.center.x, dy = p.cy - prep.center.y;
        const l = Math.hypot(dx, dy);
        if (l < 1e-6) {
          const a = i * 2.39996;
          dx = Math.cos(a);
          dy = Math.sin(a);
        } else {
          dx /= l;
          dy /= l;
        }
        const D = containerSpan * 0.55;
        const r = (random(`${uid}x${p.id}`) - 0.5) * 180 * e;
        return partEl(p, i, { transform: tf(p.cx, p.cy, { x: dx * D * e, y: dy * D * e, r, s: 1 - 0.35 * e }), opacity: 1 - smooth(0.35, 1, q) });
      }));
    }
    if (exitMode === "collapse") {
      return svgWrap(prep.parts.map((p, i) => {
        const e = EASING.inBack(clamp01((q - 0.08 * ((N - 1 - rank(p)) / Math.max(1, N - 1))) / 0.92));
        return partEl(p, i, {
          transform: tf(p.cx, p.cy, { x: (prep.center.x - p.cx) * e, y: (prep.center.y - p.cy) * e, s: Math.max(0.001, 1 - e) }),
          opacity: 1 - smooth(0.85, 1, q),
        });
      }));
    }
    // draw-out: fill drains, outline un-draws in reverse order
    const fillA = 1 - smooth(0, 0.4, q);
    return svgWrap(
      <>
        {prep.parts.map((p, i) => partEl(p, `f${i}`, { opacity: fillA }))}
        {prep.parts.flatMap((p, i) => {
          const lag = (N - 1 - rank(p)) / Math.max(1, N - 1);
          const v = 1 - EASING.inOut(clamp01((q - 0.2 - 0.25 * lag) / 0.55));
          return p.subs.map((d, j) => (
            <path key={`s${i}-${j}`} d={d} fill="none" stroke={layer.strokeColor ? color(layer.strokeColor) : p.paint} strokeWidth={p.strokeOnly ? (p.strokeWidth ?? strokeW) : strokeW}
              strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - v} />
          ));
        })}
      </>,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // reveal finished → pixel-exact hold

  const revealEnd = mode === "morph-from" ? T + 0.15 : T + 0.02;
  if (t >= revealEnd) return svgWrap(restArt());

  // ---------------------------------------------------------------------------------------------
  // modes

  switch (mode) {
    case "draw": {
      if (!prep) break;
      const strokeEnd = T * 0.72;
      const wipe = EASING.inOut(clamp01((t - T * 0.58) / (T * 0.4)));
      const strokeFade = 1 - smooth(T * 0.82, T, t);
      const dSpread = Math.min(delays.spread, strokeEnd * 0.45);
      const angle = (18 * Math.PI) / 180;
      const dir = [Math.cos(angle), Math.sin(angle)];
      const span = bb.w * dir[0] + bb.h * dir[1];
      const feather = span * 0.3;
      const f = bb.x * dir[0] + bb.y * dir[1] + (span + feather) * wipe;
      const mid = { x: ccx, y: ccy };
      const proj = (s: number) => ({ x: mid.x + dir[0] * (s - (mid.x * dir[0] + mid.y * dir[1])), y: mid.y + dir[1] * (s - (mid.x * dir[0] + mid.y * dir[1])) });
      const a = proj(f - feather), b = proj(f);
      const maskId = `${uid}wipe`;
      const extra = [
        <linearGradient key="wg" id={`${maskId}g`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
          <stop offset={0} stopColor="#fff" />
          <stop offset={1} stopColor="#000" />
        </linearGradient>,
        <mask key="wm" id={maskId} maskUnits="userSpaceOnUse" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3}>
          <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={`url(#${maskId}g)`} />
        </mask>,
      ];
      const fills = prep.parts.filter((p) => !p.strokeOnly);
      return svgWrap(
        <>
          {wipe > 0 && <g mask={`url(#${maskId})`}>{fills.map((p, i) => partEl(p, `f${i}`))}</g>}
          {prep.parts.flatMap((p, i) => {
            const d0 = N > 1 ? dSpread * outQuad(rank(p) / (N - 1)) : 0;
            const v = EASING.inOut(clamp01((t - d0) / Math.max(0.3, strokeEnd - dSpread)));
            const stroke = layer.strokeColor ? color(layer.strokeColor) : p.paint;
            return p.subs.map((d, j) => {
              const vj = clamp01((v - (j > 0 ? 0.12 : 0)) / (j > 0 ? 0.88 : 1));
              return (
                <path key={`s${i}-${j}`} d={d} fill="none" stroke={stroke} strokeWidth={p.strokeOnly ? (p.strokeWidth ?? strokeW) : strokeW}
                  strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - vj}
                  opacity={p.strokeOnly ? 1 : strokeFade} />
              );
            });
          })}
        </>,
        extra,
      );
    }

    case "build": {
      if (!prep) break;
      return svgWrap(prep.parts.map((p, i) => {
        const u = uOf(p);
        if (u <= 0) return null;
        const s = spring(u, ...SPRING_HERO);
        const sign = rank(p) % 2 === 0 ? -1 : 1;
        const r0 = (p.kind === "glyph" ? 5 : 11) * sign;
        const r = r0 * (1 - spring(u, ...SPRING_SOFT));
        return partEl(p, i, { transform: tf(p.cx, p.cy, { s: Math.max(0.0005, s), r }), opacity: smooth(0, 0.12, u) });
      }));
    }

    case "assemble": {
      if (!prep) break;
      return svgWrap(prep.parts.map((p, i) => {
        const u = uOf(p);
        if (u <= 0) return null;
        let dx = p.cx - prep.center.x, dy = p.cy - prep.center.y;
        const l = Math.hypot(dx, dy);
        if (l < bb.w * 0.02) {
          const a = rank(p) * 2.39996 + 0.6;
          dx = Math.cos(a);
          dy = Math.sin(a);
        } else {
          dx /= l;
          dy /= l;
        }
        const D = containerSpan * 0.62;
        const sx = p.cx + dx * D, sy = p.cy + dy * D;
        // control point: off to one side → every part swings in on a clockwise arc
        const mx = (sx + p.cx) / 2, my = (sy + p.cy) / 2;
        const cxp = mx - dy * D * 0.45, cyp = my + dx * D * 0.45;
        const s = spring(u, ...SPRING_SOFT);
        const bx = (1 - s) * (1 - s) * sx + 2 * (1 - s) * s * cxp + s * s * p.cx;
        const byy = (1 - s) * (1 - s) * sy + 2 * (1 - s) * s * cyp + s * s * p.cy;
        const r0 = (rank(p) % 2 === 0 ? 1 : -1) * (70 + 50 * random(`${uid}r${p.id}`));
        return partEl(p, i, {
          transform: tf(p.cx, p.cy, { x: bx - p.cx, y: byy - p.cy, r: r0 * (1 - s), s: 0.55 + 0.45 * Math.min(1.04, s) }),
          opacity: smooth(0, 0.08, u),
        });
      }));
    }

    case "morph-from": {
      if (!prep || !morph) break;
      const hold = 0.15;
      const u = clamp01((t - hold) / T);
      const fromPaint = layer.strokeColor ? color(layer.strokeColor) : prep.parts.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a)).paint;
      if (u <= 0) return svgWrap(<path d={morph.fromD} fill={fromPaint} />);
      const pairs = morph.mm.pairs;
      const n = pairs.length;
      const spread = n > 1 ? Math.min(0.22, 0.045 * (n - 1)) : 0;
      const pulse = 1 + 0.025 * Math.sin(Math.PI * u);
      return svgWrap(
        <g transform={tf(ccx, ccy, { s: pulse })}>
          <path d={morph.fromD} fill={fromPaint} opacity={1 - smooth(0, 0.14, u)} />
          {pairs.map((pr, i) => {
            const part = prep.parts[pr.to] ?? prep.parts[0];
            const dl = n > 1 ? spread * outQuad(morph.order[i] / Math.max(1, n - 1)) : 0;
            const uk = clamp01((u - dl) / (1 - spread));
            const pk = settleEase(uk, 0.035);
            const fill = part.gid ? (uk > 0.6 ? part.paint : fromPaint) : mixColor(fromPaint, part.paint, smooth(0.15, 0.85, uk));
            return <path key={i} d={pr.fn(pk)} fill={fill} fillRule="nonzero" />;
          })}
        </g>,
      );
    }

    case "mask": {
      const lin = clamp01(t / T);
      const p = MASK_EASE(lin);
      const angle = (14 * Math.PI) / 180;
      const dir = [Math.cos(angle), Math.sin(angle)];
      const span = bb.w * dir[0] + bb.h * dir[1];
      const feather = span * 0.16;
      const proj0 = ccx * dir[0] + ccy * dir[1];
      const at = (s: number) => ({ x: ccx + dir[0] * (s - proj0), y: ccy + dir[1] * (s - proj0) });
      const start = bb.x * dir[0] + bb.y * dir[1];
      const front = start + (span + feather) * p;
      const a = at(front - feather), b = at(front);
      // specular glint: a narrow light band riding just behind the reveal edge, clipped to the logo
      const gw = span * 0.07;
      const gc = front - feather * 0.6;
      const h0 = at(gc - gw), h2 = at(gc + gw);
      const glint = 0.6 * Math.sin(Math.PI * Math.min(1, lin * 1.08));
      const big = { x: view.x - view.w, y: view.y - view.h, width: view.w * 3, height: view.h * 3 };
      const extra = [
        <linearGradient key="g" id={`${uid}mg`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
          <stop offset={0} stopColor="#fff" />
          <stop offset={1} stopColor="#000" />
        </linearGradient>,
        <mask key="m" id={`${uid}m`} maskUnits="userSpaceOnUse" {...big}><rect {...big} fill={`url(#${uid}mg)`} /></mask>,
        <linearGradient key="hg" id={`${uid}hg`} gradientUnits="userSpaceOnUse" x1={h0.x} y1={h0.y} x2={h2.x} y2={h2.y}>
          <stop offset={0} stopColor="#000" />
          <stop offset={0.5} stopColor="#fff" />
          <stop offset={1} stopColor="#000" />
        </linearGradient>,
        <mask key="hm" id={`${uid}h`} maskUnits="userSpaceOnUse" {...big}><rect {...big} fill={`url(#${uid}hg)`} /></mask>,
        ...(!prep ? [<filter key="w" id={`${uid}white`}><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" /></filter>] : []),
      ];
      const settle = 1.03 - 0.03 * EASING.outQuint(lin);
      const slide = -0.02 * view.w * (1 - EASING.outQuint(lin));
      return svgWrap(
        <g transform={tf(ccx, ccy, { s: settle, x: slide })}>
          <g mask={`url(#${uid}m)`}>{art("a")}</g>
          {glint > 0.01 && (
            <g mask={`url(#${uid}h)`} opacity={glint}>
              {prep ? <g>{prep.parts.map((q, i) => partEl(q, i, {}, "#ffffff"))}</g> : rasterEl("hl", { filter: `url(#${uid}white)` })}
            </g>
          )}
        </g>,
        extra,
      );
    }

    case "cascade": {
      if (!prep) break;
      const groups = logo?.groups;
      const wmSet = new Set(groups?.wordmark ?? []);
      let word = prep.parts.filter((p) => wmSet.has(p.id));
      if (!word.length) word = prep.parts.filter((p) => p.kind === "glyph");
      if (!word.length) word = prep.parts;
      const wordIds = new Set(word.map((p) => p.id));
      const icon = prep.parts.filter((p) => !wordIds.has(p.id));
      const wb = unionBBox(word.map((p) => p.bbox));
      const ib = icon.length ? unionBBox(icon.map((p) => p.bbox)) : null;
      const iconU = clamp01(t / (T * 0.62));
      const iconS = spring(iconU, ...SPRING_POP);
      const wordStart = icon.length ? T * 0.18 : 0;
      const sorted = [...word].sort((a, b) => a.bbox.x - b.bbox.x);
      const wd = makeDelays(sorted.length, T - wordStart, layer.stagger ?? 0.06);
      const glyphDur = Math.max(0.35, T - wordStart - wd.spread);
      const rise = wb.h * 1.15;
      const clipId = `${uid}base`;
      const extra = [
        <clipPath key="c" id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x={view.x - view.w} y={wb.y - wb.h * 3} width={view.w * 3} height={wb.h * 3 + wb.h + 0.5 * unit} />
        </clipPath>,
      ];
      return svgWrap(
        <>
          {ib && iconU > 0 && (
            <g transform={tf(ib.x + ib.w / 2, ib.y + ib.h / 2, { s: Math.max(0.0005, iconS), r: -8 * (1 - spring(iconU, ...SPRING_SOFT)) })} opacity={smooth(0, 0.1, iconU)}>
              {icon.map((p, i) => partEl(p, i))}
            </g>
          )}
          <g clipPath={`url(#${clipId})`}>
            {sorted.map((p, i) => {
              const u = clamp01((t - wordStart - wd.at(i)) / glyphDur);
              if (u <= 0) return null;
              const s = spring(u, 7, 1.0);
              return partEl(p, `w${i}`, { transform: tf(p.bbox.x, p.bbox.y + p.bbox.h, { y: rise * (1 - s), r: 7 * (1 - Math.min(1, s)) }) });
            })}
          </g>
        </>,
        extra,
      );
    }

    case "glitch": {
      const p = clamp01(t / T);
      const fq = Math.floor(t * 15);
      const I = Math.pow(1 - p, 1.6);
      if (I < 0.015) return svgWrap(restArt());
      const visible = p > 0.32 || random(`${uid}v${fq}`) > 0.45 * (1 - p / 0.32);
      if (!visible) return svgWrap(null);
      const bands = 7;
      const bh = view.h / bands;
      const ghost = 0.035 * view.w * I * (0.6 + 0.4 * random(`${uid}g${fq}`));
      const extra: React.ReactNode[] = [];
      for (let i = 0; i < bands; i++) {
        extra.push(
          <clipPath key={i} id={`${uid}b${i}`} clipPathUnits="userSpaceOnUse">
            <rect x={view.x - view.w} y={view.y + i * bh - 0.5 * unit} width={view.w * 3} height={bh + unit} />
          </clipPath>,
        );
      }
      if (!prep) {
        extra.push(
          <filter key="r" id={`${uid}red`}><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.16  0 0 0 0 0.33  0 0 0 1 0" /></filter>,
          <filter key="c" id={`${uid}cy`}><feColorMatrix type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.9  0 0 0 0 1  0 0 0 1 0" /></filter>,
        );
      }
      const ghostArt = (key: string, c: string, filterId: string) => (prep ? art(key, c) : rasterEl(key, { filter: `url(#${uid}${filterId})` }));
      return svgWrap(
        <>
          <g transform={`translate(${-ghost} 0)`} opacity={0.75}>{ghostArt("r", "#ff2a55", "red")}</g>
          <g transform={`translate(${ghost} 0)`} opacity={0.75}>{ghostArt("c", "#19e3ff", "cy")}</g>
          {Array.from({ length: bands }, (_, i) => {
            const on = random(`${uid}s${fq}-${i}`) < 0.55;
            const dx = on ? (random(`${uid}d${fq}-${i}`) - 0.5) * 2 * 0.12 * view.w * I : 0;
            return <g key={i} clipPath={`url(#${uid}b${i})`} transform={`translate(${dx} 0)`}>{art(`m${i}`)}</g>;
          })}
        </>,
        extra,
      );
    }

    case "liquid": {
      const p = clamp01(t / T);
      const level = EASING.inOut(p);
      const top = bb.y - bb.h * 0.06, bottom = bb.y + bb.h * 1.06;
      const amp = bb.h * 0.07 * Math.pow(1 - level, 0.6) + bb.h * 0.004;
      const wave = (lv: number, phase: number, a: number) => {
        const y0 = bottom - (bottom - top) * lv;
        const x0 = view.x - view.w * 0.1, x1 = view.x + view.w * 1.1;
        const pts: string[] = [];
        const n = 48;
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n;
          const y = y0 + a * Math.sin((x - view.x) / (bb.h * 0.55) + phase) + a * 0.35 * Math.sin((x - view.x) / (bb.h * 0.23) - phase * 1.7);
          pts.push(`${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`);
        }
        return `${pts.join("")}L${x1} ${bottom + bb.h}L${x0} ${bottom + bb.h}Z`;
      };
      const ph = t * Math.PI * 2 * 0.9;
      const extra = [
        <mask key="w1" id={`${uid}w1`} maskUnits="userSpaceOnUse" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3}>
          <path d={wave(level, ph, amp)} fill="#fff" />
        </mask>,
        <mask key="w2" id={`${uid}w2`} maskUnits="userSpaceOnUse" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3}>
          <path d={wave(Math.min(1, level + 0.06 * (1 - level)), ph + 2.1, amp * 1.15)} fill="#fff" />
        </mask>,
      ];
      const ghostA = 0.3 * (1 - smooth(0.8, 1, p)) * smooth(0, 0.08, p);
      return svgWrap(
        <>
          {prep
            ? <g opacity={ghostA}>{prep.parts.map((q, i) => partEl(q, `o${i}`, q.strokeOnly ? {} : { fill: "none", stroke: q.paint, strokeWidth: 1.6 * unit }))}</g>
            : <g opacity={ghostA * 0.5}>{rasterEl("ghost")}</g>}
          <g mask={`url(#${uid}w2)`} opacity={0.38}>{art("back")}</g>
          <g mask={`url(#${uid}w1)`}>{art("front")}</g>
        </>,
        extra,
      );
    }

    case "window": {
      if (!prep || !pivot) break;
      const p = clamp01(t / T);
      const S0 = 7;
      const e = EASING.inOut(p);
      const s = Math.exp(Math.log(S0) * (1 - e));
      const media = layer.windowSrc;
      const clipId = `${uid}win`;
      const mediaA = 1 - smooth(0.8, 0.97, p);
      const brandA = smooth(0.7, 0.93, p);
      const pal = logo?.palette?.map((q) => q.hex) ?? [prep.parts[0].paint];
      const mb = { x: bb.x - bb.w * 0.02, y: bb.y - bb.h * 0.02, width: bb.w * 1.04, height: bb.h * 1.04 };
      let mediaEl: React.ReactNode;
      if (media && isVideoSrc(media)) {
        mediaEl = (
          <foreignObject {...mb}>
            <OffthreadVideo src={asset(media)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </foreignObject>
        );
      } else if (media) {
        mediaEl = <image href={asset(media)} {...mb} preserveAspectRatio="xMidYMid slice" />;
      } else {
        mediaEl = <rect {...mb} fill={`url(#${uid}wg)`} />;
      }
      const extra = [
        <clipPath key="c" id={clipId} clipPathUnits="userSpaceOnUse">
          {prep.parts.map((q, i) => <path key={i} d={q.shapeD} clipRule={q.strokeOnly ? "nonzero" : (q.fillRule ?? "nonzero")} />)}
        </clipPath>,
        <linearGradient key="g" id={`${uid}wg`} gradientUnits="userSpaceOnUse" x1={bb.x} y1={bb.y} x2={bb.x + bb.w} y2={bb.y + bb.h}>
          {(pal.length > 1 ? pal : [pal[0], "#ffffff"]).map((c, i, arr) => <stop key={i} offset={i / (arr.length - 1)} stopColor={c} />)}
        </linearGradient>,
      ];
      const inner = 1 + 0.12 * (1 - e); // media drifts slightly inside the window (parallax)
      // the pivot starts at the logo center (frame center for a centered layer) and drifts home as we pull out
      const drift = (s - 1) / (S0 - 1);
      return svgWrap(
        <g transform={tf(pivot.x, pivot.y, { s, x: (ccx - pivot.x) * drift, y: (ccy - pivot.y) * drift })}>
          {mediaA > 0.001 && (
            <g clipPath={`url(#${clipId})`} opacity={mediaA}>
              <g transform={tf(pivot.x, pivot.y, { s: inner })}>{mediaEl}</g>
            </g>
          )}
          {brandA > 0 && <g opacity={brandA}>{restArt()}</g>}
        </g>,
        extra,
      );
    }

    case "split": {
      const n = bb.h > bb.w * 1.2 ? 8 : bb.h > bb.w * 0.6 ? 7 : 6;
      const h = (bb.h + 2 * unit) / n;
      const step = Math.min(0.065, (T * 0.4) / Math.max(1, n - 1));
      const dur = Math.max(0.35, T - step * (n - 1));
      const D = containerSpan * 0.6;
      const extra = Array.from({ length: n }, (_, i) => (
        <clipPath key={i} id={`${uid}sp${i}`} clipPathUnits="userSpaceOnUse">
          <rect x={view.x - view.w * 3} y={bb.y - unit + i * h - 0.6 * unit} width={view.w * 7} height={h + 1.2 * unit} />
        </clipPath>
      ));
      return svgWrap(
        <>
          {Array.from({ length: n }, (_, i) => {
            const u = clamp01((t - i * step) / dur);
            if (u <= 0) return null;
            const s = spring(u, 7, 1.0);
            const dir = i % 2 === 0 ? -1 : 1;
            return (
              <g key={i} transform={`translate(${dir * D * (1 - s)} 0)`} opacity={smooth(0, 0.1, u)}>
                <g clipPath={`url(#${uid}sp${i})`}>{art(`b${i}`)}</g>
              </g>
            );
          })}
        </>,
        extra,
      );
    }

    case "trace": {
      if (!prep || !tracePrep) break;
      const traceEnd = T * 0.62;
      const v = EASING.inOut(clamp01(t / traceEnd));
      const main = tracePrep.main;
      const mainSubs = main.subs;
      const dotColor = layer.strokeColor ? color(layer.strokeColor) : (logo?.palette?.find((q) => q.role === "accent")?.hex ?? main.paint);
      const head = tracePrep.table ? tracePrep.table.at(v) : null;
      const fillPhase = (p: PartInfo) => clamp01((t - T * 0.55 - 0.25 * T * (rank(p) / Math.max(1, N - 1))) / (T * 0.3));
      const strokeFade = 1 - smooth(T * 0.8, T, t);
      const dotA = 1 - smooth(traceEnd, traceEnd + 0.12 * T, t);
      const burst = clamp01((t - traceEnd) / (0.22 * T));
      return svgWrap(
        <>
          {prep.parts.map((p, i) => {
            const fp = fillPhase(p);
            if (fp <= 0 || p.strokeOnly) return null;
            const s = 0.94 + 0.06 * spring(fp, ...SPRING_SOFT);
            return partEl(p, `f${i}`, { opacity: smooth(0, 0.6, fp), transform: tf(p.cx, p.cy, { s }) });
          })}
          {prep.parts.flatMap((p, i) => {
            const isMain = p.id === main.id;
            const lv = isMain ? v : EASING.inOut(clamp01((t - T * 0.12 - 0.2 * T * (rank(p) / Math.max(1, N - 1))) / (T * 0.45)));
            const subs = isMain ? mainSubs : p.subs;
            return subs.map((d, j) => (
              <path key={`t${i}-${j}`} d={d} fill="none" stroke={isMain ? dotColor : p.paint} strokeWidth={p.strokeOnly ? (p.strokeWidth ?? strokeW) : (isMain ? 2.6 : 1.6) * unit}
                strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1"
                strokeDashoffset={1 - clamp01(isMain && j > 0 ? (lv - 0.5) * 2 : lv)} opacity={p.strokeOnly ? 1 : strokeFade * (isMain ? 1 : 0.55)} />
            ));
          })}
          {head && dotA > 0.001 && (
            <g opacity={dotA}>
              <circle cx={head.x} cy={head.y} r={22 * unit} fill={dotColor} opacity={0.18} />
              <circle cx={head.x} cy={head.y} r={8 * unit} fill={dotColor} />
            </g>
          )}
          {head && burst > 0 && burst < 1 && (
            <circle cx={head.x} cy={head.y} r={(6 + 40 * EASING.out(burst)) * unit} fill="none" stroke={dotColor} strokeWidth={2 * unit * (1 - burst)} opacity={1 - burst} />
          )}
        </>,
      );
    }

    case "pop": {
      const u = clamp01(t / T);
      const s = spring(u, ...SPRING_POP);
      return svgWrap(
        <g transform={tf(ccx, ccy, { s: Math.max(0.0005, s), r: -6 * (1 - spring(u, ...SPRING_SOFT)) })} opacity={smooth(0, 0.08, u)}>{restArt()}</g>,
      );
    }
  }

  // unsupported combination (e.g. data missing for a vector-only mode): spring pop as a safe default
  const u = clamp01(t / T);
  return svgWrap(<g transform={tf(ccx, ccy, { s: Math.max(0.0005, spring(u, ...SPRING_POP)) })}>{restArt()}</g>);
};
