/**
 * Animated charts with a current product-UI finish: bars that grow with a small settle, lines that draw with a glowing
 * head and a live value tag, donuts that sweep segment by segment, Activity-style rings. Gridlines draw in first,
 * numbers count in tabular figures, one highlighted item can carry the story (the rest stays neutral), callouts land
 * after the data. All timing comes from chart/model.ts (the sound planner reads the same numbers).
 */
import React, { useId, useMemo } from "react";
import { getLength, getPointAtLength } from "@remotion/paths";
import { clamp01, ease, lerp, progress, type EaseName } from "../core/animate";
import { useColor, useFont, useRuntime } from "../core/context";
import { alpha, formatter, isDark, palette, panel, type SurfaceKind } from "./surface";
import { chartBox, chartDomain, chartItems, chartTiming, highlightIndex, type ChartL } from "./chart/model";

type Props = { layer: ChartL; t: number; duration: number };

type Ctx = {
  l: ChartL; t: number; W: number; H: number; fs: number; uid: string; dark: boolean;
  fg: string; muted: string; accent: string; neutral: string; colors: string[]; hi: number;
  body: string; mono: string; display: string; fmt: (v: number) => string;
  /** resolve a spec color ($tokens included) */
  res: (c: string) => string;
  /** bar / hbar color of item i (highlight → accent vs neutral; else its own color, the palette, or one accent) */
  barColor: (i: number) => string;
  timing: ReturnType<typeof chartTiming>;
  plot: { x0: number; x1: number; y0: number; y1: number };
};

const GREEN = "#22c55e", RED = "#ef4444";

// ---------------------------------------------------------------------------------------------------------------------

export const Chart: React.FC<Props> = ({ layer: l, t }) => {
  const color = useColor();
  const font = useFont();
  const rt = useRuntime();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { w: W, h: H } = chartBox(l);
  const dark = isDark(color("$bg"));
  const fs = l.fontSize ?? Math.max(16, Math.min(34, Math.round(Math.min(W, H) * 0.042)));
  const items = chartItems(l);
  const surface: SurfaceKind = l.surface ?? "none";
  const pad = surface === "none" ? Math.round(fs * 0.4) : Math.round(Math.min(W, H) * 0.07);
  const fg = color("$fg");
  const muted = rt.colors.muted ? color("$muted") : alpha(fg, 0.55);
  const accent = color(l.color ?? "$accent");
  const hi = highlightIndex(l);
  const n = l.kind === "line" || l.kind === "area" ? (l.series ?? []).length : items.length;
  const colors = palette(rt.colors, color, Math.max(1, n), l.colors);
  const res = (c: string) => color(c);
  const neutral = alpha(fg, dark ? 0.2 : 0.14);
  const barColor = (i: number) => {
    const own = l.data?.[i]?.color;
    if (hi >= 0) return i === hi ? (own ? res(own) : accent) : neutral;
    if (own) return res(own);
    return l.colors?.length ? colors[i] : accent;
  };
  const sample = l.kind === "line" || l.kind === "area" ? (l.series ?? []).flatMap((s) => s.values) : items.map((d) => d.value);
  const fmt = useMemo(() => formatter(l, sample), [l, sample.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const timing = useMemo(() => chartTiming(l), [l]);

  const header = !!(l.title || l.subtitle || l.delta);
  const headerH = header ? fs * 1.35 + (l.subtitle ? fs * 1.15 : 0) + fs * 0.9 : 0;
  const ctx: Ctx = {
    l, t, W, H, fs, uid, dark, fg, muted, accent, neutral, colors, hi, res, barColor,
    body: font(l.font, "body"), mono: font(undefined, "mono"), display: font(undefined, "display"), fmt, timing,
    plot: { x0: pad, x1: W - pad, y0: pad + headerH, y1: H - pad },
  };

  const headerIn = progress(t, 0, 0.6, "expoOut");
  return (
    <div style={{ position: "relative", width: W, height: H, ...panel(surface, dark, Math.round(Math.min(W, H) * 0.06), color("$card", "$bg"), fg) }}>
      {header && (
        <div style={{ position: "absolute", left: pad, right: pad, top: pad, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: fs,
          opacity: headerIn, transform: `translateY(${(1 - headerIn) * fs * 0.6}px)` }}>
          <div style={{ minWidth: 0 }}>
            {l.title && <div style={{ fontFamily: ctx.body, fontSize: fs * 1.18, fontWeight: 650, color: fg, letterSpacing: "-0.01em", lineHeight: 1.15, whiteSpace: "nowrap" }}>{l.title}</div>}
            {l.subtitle && <div style={{ fontFamily: ctx.body, fontSize: fs * 0.82, color: muted, marginTop: fs * 0.3, whiteSpace: "nowrap" }}>{l.subtitle}</div>}
          </div>
          {l.delta && <Delta text={l.delta} fs={fs} font={ctx.body} good={l.deltaGood ?? "up"} />}
        </div>
      )}
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {l.kind === "bar" && <Bars c={ctx} />}
        {l.kind === "hbar" && <HBars c={ctx} />}
        {(l.kind === "line" || l.kind === "area") && <Lines c={ctx} />}
        {(l.kind === "donut" || l.kind === "pie") && <Donut c={ctx} />}
        {l.kind === "rings" && <Rings c={ctx} />}
      </svg>
    </div>
  );
};

const Delta: React.FC<{ text: string; fs: number; font: string; good: "up" | "down" }> = ({ text, fs, font, good }) => {
  const down = /^[−-]/.test(text.trim());
  const c = down === (good === "down") ? GREEN : RED;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: fs * 0.25, padding: `${fs * 0.22}px ${fs * 0.5}px`, borderRadius: 999,
      background: alpha(c, 0.14), color: c, fontFamily: font, fontSize: fs * 0.8, fontWeight: 650, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: fs * 0.62 }}>{down ? "▼" : "▲"}</span>{text.replace(/^[+−-]\s*/, "")}
    </div>
  );
};

// --- shared pieces -----------------------------------------------------------------------------------------------------

const Grid: React.FC<{ c: Ctx; ticks: number[]; yOf: (v: number) => number; x0: number }> = ({ c, ticks, yOf, x0 }) => {
  const g = progress(c.t, c.timing.grid.start, c.timing.grid.end - c.timing.grid.start, "expoOut");
  const { x1 } = c.plot;
  return (
    <g>
      {ticks.map((v, i) => {
        const y = yOf(v);
        const base = v === 0;
        return (
          <g key={i} opacity={g}>
            <line x1={x0} x2={lerp(x0, x1, g)} y1={y} y2={y} style={{ stroke: alpha(c.fg, base ? 0.22 : 0.08), strokeWidth: 1, strokeDasharray: base ? undefined : "3 7" }} />
            <text x={x0 - c.fs * 0.55} y={y + c.fs * 0.3} textAnchor="end" style={{ fontFamily: c.mono, fontSize: c.fs * 0.66, fill: c.muted, fontVariantNumeric: "tabular-nums" }}>{c.fmt(v)}</text>
          </g>
        );
      })}
    </g>
  );
};

const yAxisWidth = (c: Ctx, ticks: number[]) => (c.l.grid === false ? 0 : Math.max(...ticks.map((v) => c.fmt(v).length)) * c.fs * 0.66 * 0.62 + c.fs * 0.9);

/** Accent pill above (x, y) with a short leader; `y` is the point it refers to (the leader stops just above it). */
const Callout: React.FC<{ c: Ctx; x: number; y: number; text: string; at: number; lift?: number }> = ({ c, x, y, text, at, lift = 2.3 }) => {
  const p = progress(c.t, at, 0.5, "spring");
  if (c.t < at) return null;
  const w = text.length * c.fs * 0.5 + c.fs * 1.2, h = c.fs * 1.5;
  const rise = c.fs * lift;
  const bx = Math.min(c.W - w / 2 - 4, Math.max(w / 2 + 4, x)), by = y - rise;
  const ink = c.dark ? "#0b0b0f" : "#ffffff";
  return (
    <g opacity={clamp01(p * 2)} transform={`translate(${bx} ${by + (1 - p) * c.fs * 0.5}) scale(${0.85 + 0.15 * p})`}>
      <line x1={x - bx} x2={x - bx} y1={h / 2} y2={rise - c.fs * 0.3} style={{ stroke: c.accent, strokeWidth: 1.5 }} />
      <circle cx={x - bx} cy={rise - c.fs * 0.3} r={c.fs * 0.14} style={{ fill: c.accent }} />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} style={{ fill: c.accent }} />
      <text x={0} y={c.fs * 0.27} textAnchor="middle" style={{ fontFamily: c.body, fontSize: c.fs * 0.74, fontWeight: 650, fill: ink }}>{text}</text>
    </g>
  );
};

const annotationTarget = (c: Ctx, key: number | string, n: number, labels: string[]): number =>
  typeof key === "number" ? Math.max(0, Math.min(n - 1, key)) : Math.max(0, labels.findIndex((x) => x.toLowerCase() === key.toLowerCase()));

// --- bar (columns) ------------------------------------------------------------------------------------------------------

const roundTop = (x: number, yb: number, w: number, yt: number, r: number): string => {
  const hgt = yb - yt;
  if (Math.abs(hgt) < 0.5) return "";
  if (hgt < 0) { // negative value: grows downward, round the bottom
    const rr = Math.min(r, w / 2, -hgt);
    return `M${x},${yb} L${x},${yt - rr} Q${x},${yt} ${x + rr},${yt} L${x + w - rr},${yt} Q${x + w},${yt} ${x + w},${yt - rr} L${x + w},${yb} Z`;
  }
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${yb} L${x},${yt + rr} Q${x},${yt} ${x + rr},${yt} L${x + w - rr},${yt} Q${x + w},${yt} ${x + w},${yt + rr} L${x + w},${yb} Z`;
};

const Bars: React.FC<{ c: Ctx }> = ({ c }) => {
  const { l, t, fs } = c;
  const data = l.data ?? [];
  const dom = chartDomain(l);
  const showGrid = l.grid !== false;
  const x0 = c.plot.x0 + (showGrid ? yAxisWidth(c, dom.ticks) : 0);
  const { x1 } = c.plot;
  const y0 = c.plot.y0 + fs * 1.4, y1 = c.plot.y1 - fs * 1.9;
  const yOf = (v: number) => y1 - ((v - dom.min) / (dom.max - dom.min || 1)) * (y1 - y0);
  const yb = yOf(Math.max(dom.min, Math.min(0, dom.max)));
  const n = Math.max(1, data.length);
  const slot = (x1 - x0) / n;
  const bw = Math.min(slot * 0.62, fs * 5);
  const r = l.radius ?? Math.min(10, bw * 0.28);
  const land = c.timing.land;
  const dim = c.hi >= 0 ? progress(t, land, 0.45, "inOut") : 0;
  const sweep = progress(t, land + 0.1, 0.9, "inOut");
  const valuesMode = l.values ?? "auto";
  return (
    <g>
      <defs>
        {data.map((_, i) => {
          const col = c.barColor(i);
          return (
            <linearGradient key={i} id={`${c.uid}b${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: col }} />
              <stop offset="100%" style={{ stopColor: alpha(col, c.hi >= 0 && i !== c.hi ? 0.9 : 0.5) }} />
            </linearGradient>
          );
        })}
        <linearGradient id={`${c.uid}sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
          <stop offset="50%" style={{ stopColor: "#ffffff", stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: "#ffffff", stopOpacity: 0 }} />
        </linearGradient>
        <clipPath id={`${c.uid}bars`}>
          {data.map((d, i) => <path key={i} d={roundTop(x0 + slot * i + (slot - bw) / 2, yb, bw, yOf(d.value), r)} />)}
        </clipPath>
      </defs>
      {showGrid && <Grid c={c} ticks={dom.ticks} yOf={yOf} x0={x0} />}
      {data.map((d, i) => {
        const sp = c.timing.items[i];
        const p = progress(t, sp.start, sp.end - sp.start, (l.ease as EaseName) ?? "spring");
        const pv = progress(t, sp.start, sp.end - sp.start, "expoOut");
        const x = x0 + slot * i + (slot - bw) / 2;
        const top = lerp(yb, yOf(d.value), p);
        const isHi = i === c.hi;
        const op = c.hi >= 0 && !isHi ? 1 - dim * 0.45 : 1;
        const lp = progress(t, sp.start, 0.5, "expoOut");
        return (
          <g key={i} opacity={op}>
            <path d={roundTop(x, yb, bw, top, r)} style={{ fill: `url(#${c.uid}b${i})`, filter: isHi && dim > 0 ? `drop-shadow(0 0 ${fs * 0.9 * dim}px ${alpha(c.accent, 0.65)})` : undefined }} />
            {valuesMode !== "none" && (
              <text x={x + bw / 2} y={(d.value >= 0 ? top - fs * 0.5 : top + fs * 1.1)} textAnchor="middle" opacity={clamp01((p - 0.12) * 3)}
                style={{ fontFamily: c.body, fontSize: fs * (isHi ? 0.98 : 0.86), fontWeight: 650, fill: isHi ? c.accent : c.fg, fontVariantNumeric: "tabular-nums" }}>
                {c.fmt(d.value * pv)}
              </text>
            )}
            <text x={x + bw / 2} y={y1 + fs * 1.35} textAnchor="middle" opacity={lp} transform={`translate(0 ${(1 - lp) * fs * 0.4})`}
              style={{ fontFamily: c.body, fontSize: fs * 0.78, fill: isHi ? c.fg : c.muted, fontWeight: isHi ? 600 : 450 }}>
              {d.label ?? ""}
            </text>
          </g>
        );
      })}
      {sweep > 0 && sweep < 1 && (
        <rect x={lerp(x0 - (x1 - x0) * 0.35, x1, sweep)} y={y0 - fs} width={(x1 - x0) * 0.35} height={y1 - y0 + fs * 2} clipPath={`url(#${c.uid}bars)`} style={{ fill: `url(#${c.uid}sheen)` }} />
      )}
      {(l.annotate ?? []).map((a, k) => {
        const i = annotationTarget(c, a.at, data.length, data.map((d) => d.label ?? ""));
        const d = data[i];
        if (!d) return null;
        return <Callout key={k} c={c} x={x0 + slot * i + slot / 2} y={yOf(d.value) - fs * 1.35} lift={1.9} text={a.text} at={land + 0.25 + (a.delay ?? k * 0.35)} />;
      })}
    </g>
  );
};

// --- hbar (ranked rows) --------------------------------------------------------------------------------------------------

const HBars: React.FC<{ c: Ctx }> = ({ c }) => {
  const { l, t, fs } = c;
  const data = l.data ?? [];
  const max = l.max ?? Math.max(...data.map((d) => d.value), 1);
  const n = Math.max(1, data.length);
  const { x0, x1, y0, y1 } = c.plot;
  const rowH = (y1 - y0) / n;
  const barH = Math.min(rowH * 0.46, fs * 1.25);
  const labelW = Math.min((x1 - x0) * 0.38, Math.max(...data.map((d) => (d.label ?? "").length), 3) * fs * 0.52 + fs);
  const valueW = Math.max(...data.map((d) => c.fmt(d.value).length), 3) * fs * 0.58 + fs * 0.6;
  const bx = x0 + labelW, maxW = x1 - bx - valueW;
  const land = c.timing.land;
  const dim = c.hi >= 0 ? progress(t, land, 0.45, "inOut") : 0;
  return (
    <g>
      <defs>
        {data.map((_, i) => {
          const col = c.barColor(i);
          return (
            <linearGradient key={i} id={`${c.uid}h${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" style={{ stopColor: alpha(col, c.hi >= 0 && i !== c.hi ? 0.9 : 0.55) }} />
              <stop offset="100%" style={{ stopColor: col }} />
            </linearGradient>
          );
        })}
      </defs>
      {data.map((d, i) => {
        const sp = c.timing.items[i];
        const p = progress(t, sp.start, sp.end - sp.start, (l.ease as EaseName) ?? "spring");
        const pv = progress(t, sp.start, sp.end - sp.start, "expoOut");
        const cy = y0 + rowH * i + rowH / 2;
        const w = Math.max(barH, (maxW * Math.max(0, d.value)) / max) * Math.max(0, p);
        const isHi = i === c.hi;
        const rowIn = progress(t, sp.start - 0.1, 0.45, "expoOut");
        const op = c.hi >= 0 && !isHi ? 1 - dim * 0.45 : 1;
        return (
          <g key={i} opacity={op * rowIn} transform={`translate(${(1 - rowIn) * -fs * 0.6} 0)`}>
            <text x={x0} y={cy + fs * 0.3} style={{ fontFamily: c.body, fontSize: fs * 0.86, fill: isHi ? c.fg : alpha(c.fg, 0.82), fontWeight: isHi ? 650 : 500 }}>{d.label ?? ""}</text>
            <rect x={bx} y={cy - barH / 2} width={maxW} height={barH} rx={barH / 2} style={{ fill: alpha(c.fg, c.dark ? 0.06 : 0.05) }} />
            {w > 0.5 && <rect x={bx} y={cy - barH / 2} width={w} height={barH} rx={barH / 2}
              style={{ fill: `url(#${c.uid}h${i})`, filter: isHi && dim > 0 ? `drop-shadow(0 0 ${fs * 0.8 * dim}px ${alpha(c.accent, 0.6)})` : undefined }} />}
            {l.values !== "none" && (
              <text x={bx + w + fs * 0.45} y={cy + fs * 0.3} opacity={clamp01((p - 0.1) * 3)}
                style={{ fontFamily: c.body, fontSize: fs * 0.86, fontWeight: 650, fill: isHi ? c.accent : c.fg, fontVariantNumeric: "tabular-nums" }}>
                {c.fmt(d.value * pv)}
              </text>
            )}
          </g>
        );
      })}
      {(l.annotate ?? []).map((a, k) => {
        const i = annotationTarget(c, a.at, data.length, data.map((d) => d.label ?? ""));
        const d = data[i];
        if (!d) return null;
        const w = Math.max(barH, (maxW * Math.max(0, d.value)) / max);
        return <Callout key={k} c={c} x={bx + w} y={y0 + rowH * i + rowH / 2 - barH / 2} lift={1.9} text={a.text} at={land + 0.25 + (a.delay ?? k * 0.35)} />;
      })}
    </g>
  );
};

// --- line / area ---------------------------------------------------------------------------------------------------------

type Pt = [number, number];
const pathFor = (pts: Pt[], curve: "smooth" | "linear" | "step"): string => {
  if (pts.length < 2) return "";
  if (curve === "linear") return pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  if (curve === "step") {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const xm = (pts[i - 1][0] + pts[i][0]) / 2; d += ` L${xm},${pts[i - 1][1]} L${xm},${pts[i][1]} L${pts[i][0]},${pts[i][1]}`; }
    return d;
  }
  // monotone cubic (Fritsch–Carlson): smooth without overshooting the data
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (dx[i] || 1));
  const tg: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) tg.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  tg.push(m[n - 2]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + tg[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - tg[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
};

const Lines: React.FC<{ c: Ctx }> = ({ c }) => {
  const { l, t, fs } = c;
  const series = l.series ?? [];
  const N = Math.max(2, ...series.map((s) => s.values.length));
  const labels = l.labels ?? [];
  const dom = chartDomain(l);
  const showGrid = l.grid !== false;
  const legend = series.length > 1 && l.legend !== false;
  const x0 = c.plot.x0 + (showGrid ? yAxisWidth(c, dom.ticks) : 0) + fs * 0.4;
  const x1 = c.plot.x1 - fs * 1.2;
  const y0 = c.plot.y0 + fs * (legend ? 2.6 : 1.6), y1 = c.plot.y1 - fs * 1.9;
  const xOf = (j: number) => x0 + ((x1 - x0) * j) / (N - 1);
  const yOf = (v: number) => y1 - ((v - dom.min) / (dom.max - dom.min || 1)) * (y1 - y0);
  const curve = l.curve ?? "smooth";
  const geo = useMemo(() => series.map((s) => {
    const pts: Pt[] = s.values.map((v, j) => [xOf(j), yOf(v)]);
    const d = pathFor(pts, curve);
    return { pts, d, len: d ? getLength(d) : 0 };
  }), [l, c.W, c.H, fs]); // eslint-disable-line react-hooks/exhaustive-deps
  const dots = l.dots ?? N <= 16;
  const everyK = Math.max(1, Math.ceil(labels.length / 8));
  const land = c.timing.land;
  const yb = yOf(Math.max(dom.min, Math.min(0, dom.max)));
  return (
    <g>
      {showGrid && <Grid c={c} ticks={dom.ticks} yOf={yOf} x0={x0 - fs * 0.4} />}
      {labels.map((lab, j) => {
        if (j % everyK !== 0 && j !== labels.length - 1) return null;
        const x = xOf(j);
        const sp = c.timing.items[0];
        const reached = sp ? progress(t, sp.start, sp.end - sp.start, (l.ease as EaseName) ?? "inOut") * (x1 - x0) + x0 >= x - 1 : true;
        const p = reached ? 1 : 0.0;
        return <text key={j} x={x} y={y1 + fs * 1.35} textAnchor="middle" style={{ fontFamily: c.body, fontSize: fs * 0.74, fill: c.muted, opacity: 0.35 + 0.65 * p }}>{lab}</text>;
      })}
      {legend && (
        <g transform={`translate(${x0 - fs * 0.4} ${c.plot.y0 + fs * 0.6})`} opacity={progress(t, 0.1, 0.5, "expoOut")}>
          {series.map((s, i) => {
            const off = series.slice(0, i).reduce((a, q, k) => a + (q.name ?? `Series ${k + 1}`).length * fs * 0.48 + fs * 1.8, 0);
            return (
              <g key={i} transform={`translate(${off} 0)`}>
                <rect x={0} y={-fs * 0.32} width={fs * 0.9} height={fs * 0.28} rx={fs * 0.14} style={{ fill: s.color ? c.res(s.color) : c.colors[i] }} />
                <text x={fs * 1.25} y={0} style={{ fontFamily: c.body, fontSize: fs * 0.74, fill: c.muted }}>{s.name ?? `Series ${i + 1}`}</text>
              </g>
            );
          })}
        </g>
      )}
      {series.map((s, i) => {
        const g = geo[i];
        if (!g || !g.d) return null;
        const col = s.color ? c.res(s.color) : c.colors[i];
        const sp = c.timing.items[i];
        const P = progress(t, sp.start, sp.end - sp.start, (l.ease as EaseName) ?? "inOut");
        const head = getPointAtLength(g.d, Math.max(0.001, g.len * P)) ?? { x: g.pts[0][0], y: g.pts[0][1] };
        // interpolated value under the head (by x between the two neighbouring points)
        const jf = Math.max(0, Math.min(N - 1, ((head.x - x0) / (x1 - x0)) * (N - 1)));
        const j0 = Math.floor(jf), j1 = Math.min(s.values.length - 1, j0 + 1);
        const val = lerp(s.values[j0] ?? 0, s.values[j1] ?? s.values[j0] ?? 0, jf - j0);
        const strokeW = Math.max(3, fs * 0.16);
        const tag = i === 0 || i === c.hi;
        const area = l.kind === "area";
        return (
          <g key={i}>
            <defs>
              <linearGradient id={`${c.uid}a${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: alpha(col, area ? 0.42 : 0.16) }} />
                <stop offset="100%" style={{ stopColor: alpha(col, 0) }} />
              </linearGradient>
              <clipPath id={`${c.uid}c${i}`}><rect x={x0 - 2} y={0} width={Math.max(0, head.x - x0 + 2)} height={c.H} /></clipPath>
            </defs>
            {P > 0 && <path d={`${g.d} L${g.pts[g.pts.length - 1][0]},${yb} L${g.pts[0][0]},${yb} Z`} clipPath={`url(#${c.uid}c${i})`} style={{ fill: `url(#${c.uid}a${i})` }} />}
            <path d={g.d} style={{ fill: "none", stroke: alpha(col, 0.45), strokeWidth: strokeW * 3.2, strokeLinecap: "round", strokeLinejoin: "round", filter: `blur(${strokeW * 1.6}px)`,
              strokeDasharray: g.len, strokeDashoffset: g.len * (1 - P) }} />
            <path d={g.d} style={{ fill: "none", stroke: col, strokeWidth: strokeW, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: g.len, strokeDashoffset: g.len * (1 - P) }} />
            {dots && g.pts.map(([x, y], j) => {
              const dp = clamp01((head.x - x + 2) / (fs * 1.2));
              if (dp <= 0) return null;
              return <circle key={j} cx={x} cy={y} r={strokeW * 1.15 * ease("outBack", dp)} style={{ fill: c.dark ? "#0b0b0f" : "#ffffff", stroke: col, strokeWidth: strokeW * 0.7 }} />;
            })}
            {P > 0 && (
              <g>
                <circle cx={head.x} cy={head.y} r={strokeW * 2.6} style={{ fill: alpha(col, 0.22) }} />
                <circle cx={head.x} cy={head.y} r={strokeW * 1.35} style={{ fill: col, stroke: c.dark ? "#0b0b0f" : "#ffffff", strokeWidth: strokeW * 0.6 }} />
              </g>
            )}
            {P > 0 && tag && (() => {
              const handover = (l.annotate?.length ?? 0) > 0 ? progress(t, land + 0.1, 0.3, "inOut") : 0;
              if (handover >= 1) return null;
              const txt = c.fmt(val);
              const w = txt.length * fs * 0.52 + fs * 0.9, h = fs * 1.35;
              const tx = Math.min(c.W - w / 2 - 2, Math.max(w / 2 + 2, head.x)), ty = head.y - fs * 1.5;
              return (
                <g opacity={clamp01(P * 6) * (1 - handover)}>
                  <rect x={tx - w / 2} y={ty - h / 2} width={w} height={h} rx={h / 2} style={{ fill: col }} />
                  <text x={tx} y={ty + fs * 0.27} textAnchor="middle" style={{ fontFamily: c.body, fontSize: fs * 0.74, fontWeight: 700, fill: c.dark ? "#0b0b0f" : "#ffffff", fontVariantNumeric: "tabular-nums" }}>{txt}</text>
                </g>
              );
            })()}
          </g>
        );
      })}
      {(l.annotate ?? []).map((a, k) => {
        const j = annotationTarget(c, a.at, N, labels);
        const s0 = series[0];
        if (!s0) return null;
        const v = s0.values[Math.min(j, s0.values.length - 1)];
        return <Callout key={k} c={c} x={xOf(j)} y={yOf(v) - fs * 0.45} text={a.text} at={land + 0.25 + (a.delay ?? k * 0.35)} />;
      })}
    </g>
  );
};

// --- donut / pie -----------------------------------------------------------------------------------------------------------

const polar = (cx: number, cy: number, r: number, deg: number): Pt => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
};
const wedge = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
};

/** Round-chart frame: the disc on the left and the legend on the right (wide boxes), or the legend under it. */
const roundLayout = (c: Ctx, n: number) => {
  const { x0, x1, y0, y1 } = c.plot;
  const legend = c.l.legend !== false && n > 0;
  const wide = x1 - x0 > (y1 - y0) * 1.25;
  if (legend && wide) {
    const R = Math.min((y1 - y0) / 2, (x1 - x0) * 0.27);
    return { cx: x0 + R + c.fs * 0.4, cy: (y0 + y1) / 2, R, legendX: x0 + 2 * R + c.fs * 2.2, legendY: (y0 + y1) / 2 - (n * c.fs * 1.75) / 2 + c.fs * 0.9, legend };
  }
  const legendH = legend ? Math.ceil(n / 2) * c.fs * 1.6 + c.fs : 0;
  const R = Math.min((x1 - x0) / 2, (y1 - y0 - legendH) / 2);
  return { cx: (x0 + x1) / 2, cy: y0 + R, R, legendX: x0, legendY: y0 + 2 * R + c.fs * 1.6, legend, below: true };
};

const Legend: React.FC<{ c: Ctx; x: number; y: number; below?: boolean; rows: { label: string; value: string; color: string; at: number; hi: boolean }[] }> = ({ c, x, y, rows, below }) => (
  <g>
    {rows.map((r, i) => {
      const p = progress(c.t, r.at, 0.45, "expoOut");
      const col = below ? i % 2 : 0, row = below ? Math.floor(i / 2) : i;
      const gx = x + col * ((c.plot.x1 - c.plot.x0) / 2), gy = y + row * c.fs * (below ? 1.6 : 1.75);
      return (
        <g key={i} opacity={p} transform={`translate(${gx + (1 - p) * c.fs * 0.5} ${gy})`}>
          <rect x={0} y={-c.fs * 0.5} width={c.fs * 0.62} height={c.fs * 0.62} rx={c.fs * 0.18} style={{ fill: r.color }} />
          <text x={c.fs * 1.05} y={0} style={{ fontFamily: c.body, fontSize: c.fs * 0.84, fill: r.hi ? c.fg : alpha(c.fg, 0.85), fontWeight: r.hi ? 650 : 500 }}>{r.label}</text>
          <text x={c.fs * 1.05 + r.label.length * c.fs * 0.5 + c.fs * 0.6} y={0} style={{ fontFamily: c.body, fontSize: c.fs * 0.84, fill: c.muted, fontVariantNumeric: "tabular-nums" }}>{r.value}</text>
        </g>
      );
    })}
  </g>
);

const Donut: React.FC<{ c: Ctx }> = ({ c }) => {
  const { l, t, fs } = c;
  const data = l.data ?? [];
  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0) || 1;
  const lay = roundLayout(c, data.length);
  const pie = l.kind === "pie";
  const T = pie ? lay.R : lay.R * (l.thickness ?? 0.26);
  const rm = lay.R - T / 2;
  const s0 = c.timing.items[0]?.start ?? 0.28;
  const draw = l.drawDuration ?? 1.6;
  const A = 360 * progress(t, s0, draw, "inOutQuint");
  const land = c.timing.land;
  const dim = c.hi >= 0 ? progress(t, land, 0.45, "inOut") : 0;
  const gap = data.length > 1 ? (pie ? 1.2 : 2.4) : 0;
  const capDeg = pie ? 0 : ((T / 2) / rm) * (180 / Math.PI);
  let cum = 0;
  const segs = data.map((d, i) => {
    const a0 = (cum / total) * 360;
    cum += Math.max(0, d.value);
    return { a0, a1: (cum / total) * 360, d, i };
  });
  const centerVal = c.hi >= 0 ? data[c.hi]?.value ?? total : total;
  const pct = c.hi >= 0 && !l.format && !l.suffix;
  const countP = progress(t, s0, draw, "expoOut");
  const centerTxt = pct ? `${Math.round((centerVal / total) * 100 * countP)}%` : c.fmt(centerVal * countP);
  return (
    <g>
      {!pie && <circle cx={lay.cx} cy={lay.cy} r={rm} style={{ fill: "none", stroke: alpha(c.fg, c.dark ? 0.06 : 0.05), strokeWidth: T }} />}
      {segs.map(({ a0, a1, d, i }) => {
        const isHi = i === c.hi;
        const col = d.color ? c.res(d.color) : c.colors[i];
        const shown = Math.min(a1, A);
        if (shown <= a0) return null;
        const op = c.hi >= 0 && !isHi ? 1 - dim * 0.55 : 1;
        const bump = isHi ? dim * T * 0.16 : 0;
        if (pie) {
          const [ox, oy] = polar(0, 0, bump * 1.2, (a0 + a1) / 2);
          return <path key={i} d={wedge(lay.cx + ox, lay.cy + oy, lay.R, a0 + gap / 2, Math.max(a0 + gap / 2 + 0.01, shown - gap / 2))} opacity={op}
            style={{ fill: col, filter: isHi && dim > 0 ? `drop-shadow(0 0 ${fs * dim}px ${alpha(col, 0.6)})` : undefined }} />;
        }
        const roundCaps = a1 - a0 > 2 * capDeg + gap + 1;
        const s = a0 + gap / 2 + (roundCaps ? capDeg : 0);
        const e = Math.max(s + 0.01, shown - gap / 2 - (roundCaps ? capDeg : 0));
        if (e <= s + 0.02 && shown < a1) return null;
        return <path key={i} d={arc(lay.cx, lay.cy, rm + bump, s, e)} opacity={op}
          style={{ fill: "none", stroke: col, strokeWidth: T + bump * 0.6, strokeLinecap: roundCaps ? "round" : "butt",
            filter: isHi && dim > 0 ? `drop-shadow(0 0 ${fs * dim}px ${alpha(col, 0.6)})` : undefined }} />;
      })}
      {!pie && (
        <g opacity={progress(t, s0 + 0.2, 0.5, "expoOut")}>
          <text x={lay.cx} y={lay.cy + lay.R * 0.11} textAnchor="middle"
            style={{ fontFamily: c.display, fontSize: Math.min(lay.R * 0.42, (rm - T / 2) * 0.9), fontWeight: 700, fill: c.fg, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{centerTxt}</text>
          <text x={lay.cx} y={lay.cy + lay.R * 0.11 + fs * 1.25} textAnchor="middle"
            style={{ fontFamily: c.body, fontSize: fs * 0.72, fill: c.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{l.center ?? (c.hi >= 0 ? data[c.hi]?.label ?? "" : "Total")}</text>
        </g>
      )}
      {lay.legend && (
        <Legend c={c} x={lay.legendX} y={lay.legendY} below={"below" in lay && lay.below}
          rows={data.map((d, i) => ({ label: d.label ?? String(i + 1), value: c.l.format === "percent" ? c.fmt(d.value) : `${Math.round((Math.max(0, d.value) / total) * 100)}%`,
            color: d.color ? c.res(d.color) : c.colors[i], at: c.timing.items[i]?.start ?? 0, hi: i === c.hi }))} />
      )}
    </g>
  );
};

// --- rings (Activity-style progress) ----------------------------------------------------------------------------------------

const Rings: React.FC<{ c: Ctx }> = ({ c }) => {
  const { l, t, fs } = c;
  const data = l.data ?? [];
  const max = l.max ?? 100;
  const lay = roundLayout(c, data.length);
  const T = lay.R * (l.thickness ?? 0.14);
  const step = T * 1.32;
  const first = c.hi >= 0 ? c.hi : 0;
  const d0 = data[first];
  const p0 = c.timing.items[first];
  const countP = p0 ? progress(t, p0.start, p0.end - p0.start, "expoOut") : 1;
  return (
    <g>
      {data.map((d, i) => {
        const r = lay.R - T / 2 - i * step;
        if (r <= T) return null;
        const col = d.color ? c.res(d.color) : c.colors[i];
        const sp = c.timing.items[i];
        const p = progress(t, sp.start, sp.end - sp.start, (l.ease as EaseName) ?? "expoOut");
        const frac = Math.min(0.999, Math.max(0, d.value / max)) * p;
        const capDeg = ((T / 2) / r) * (180 / Math.PI);
        const sweep = Math.max(0.01, frac * 360);
        const end = polar(lay.cx, lay.cy, r, sweep);
        return (
          <g key={i}>
            <circle cx={lay.cx} cy={lay.cy} r={r} style={{ fill: "none", stroke: alpha(col, 0.16), strokeWidth: T }} />
            {frac > 0.002 && (
              <path d={arc(lay.cx, lay.cy, r, 0, sweep)} style={{ fill: "none", stroke: col, strokeWidth: T, strokeLinecap: "round", filter: `drop-shadow(0 0 ${T * 0.35}px ${alpha(col, 0.45)})` }} />
            )}
            {frac > 0.002 && sweep > capDeg && <circle cx={end[0]} cy={end[1]} r={T * 0.18} style={{ fill: alpha("#ffffff", 0.75) }} />}
          </g>
        );
      })}
      {d0 && (
        <g opacity={progress(t, (p0?.start ?? 0) + 0.15, 0.5, "expoOut")}>
          <text x={lay.cx} y={lay.cy + lay.R * 0.08} textAnchor="middle"
            style={{ fontFamily: c.display, fontSize: Math.max(fs, (lay.R - data.length * step) * 0.62), fontWeight: 700, fill: c.fg, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
            {c.l.format || c.l.suffix || c.l.prefix ? c.fmt(d0.value * countP) : `${Math.round((d0.value / max) * 100 * countP)}%`}
          </text>
          <text x={lay.cx} y={lay.cy + lay.R * 0.08 + fs * 1.15} textAnchor="middle"
            style={{ fontFamily: c.body, fontSize: fs * 0.66, fill: c.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{l.center ?? d0.label ?? ""}</text>
        </g>
      )}
      {lay.legend && (
        <Legend c={c} x={lay.legendX} y={lay.legendY} below={"below" in lay && lay.below}
          rows={data.map((d, i) => ({ label: d.label ?? String(i + 1), value: c.fmt(d.value), color: d.color ? c.res(d.color) : c.colors[i], at: c.timing.items[i]?.start ?? 0, hi: i === c.hi }))} />
      )}
    </g>
  );
};

