import React from "react";
import { interpolateColors, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { CursorLayer, SelectionLayer, SliderLayer, ToggleLayer } from "../spec/schema";
import { progress } from "../core/animate";
import { clickAt, heldAt, interactionFrame, sliderAt, toggleAt } from "../core/interaction";
import { useSiblings } from "../core/container";
import { useColor, useFont } from "../core/context";

/** Anchor is the pointer's tip, not its bounding-box center. Reused by path followers. */
export const CursorGlyph: React.FC<{ kind?: "pointer" | "pen"; size?: number; color?: string; label?: string; press?: number }> = ({ kind = "pointer", size = 36, color = "#7040ff", label, press = 0 }) => {
  const font = useFont();
  return <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${1 - press * 0.16})`, transformOrigin: "0 0" }}>
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 2px 2px #0002)" }}>
      <path d={kind === "pen" ? "M0 0 L5 20 L12 12 L20 5 Z M5 20 L18 33 L33 18 L20 5 M12 12 L25 25" : "M0 0 L29 17 L17 20 L12 32 Z"}
        fill={color} stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
    {label && <div style={{ position: "absolute", left: size * 0.72, top: size * 0.83, padding: "6px 10px", borderRadius: 5,
      background: color, color: "white", font: `500 ${size * 0.36}px ${font(undefined, "body")}`, whiteSpace: "nowrap" }}>{label}</div>}
  </div>;
};

/** 0..1 "pressed" level of a press-and-hold: quick attack on press, short release. */
const holdLevel = (drags: { at: number; until: number }[] | undefined, t: number) => {
  let v = 0;
  for (const d of drags ?? []) {
    if (t < d.at) continue;
    v = Math.max(v, t <= d.until ? Math.min(1, (t - d.at) / 0.08) : Math.max(0, 1 - (t - d.until) / 0.16));
  }
  return v;
};

export const Cursor: React.FC<{ layer: z.infer<typeof CursorLayer>; t: number }> = ({ layer, t }) => {
  const { fps } = useVideoConfig();
  const color = useColor(), c = color(layer.color, "$accent"), state = clickAt((layer.clicks ?? []).map((at) => interactionFrame(at, fps)), t), size = layer.size ?? 36;
  const press = Math.max(state.press, holdLevel(layer.drags, t));
  return <div style={{ position: "relative", width: 1, height: 1 }}>
    {state.ripple !== null && <div style={{ position: "absolute", width: size * (0.3 + state.ripple * 2), height: size * (0.3 + state.ripple * 2),
      borderRadius: "50%", border: `2px solid ${c}`, opacity: (1 - state.ripple) * 0.7, transform: "translate(-50%,-50%)" }} />}
    <CursorGlyph kind={layer.kind} color={c} size={size} label={layer.label} press={press} />
  </div>;
};

export const Selection: React.FC<{ layer: z.infer<typeof SelectionLayer>; t: number }> = ({ layer, t }) => {
  const color = useColor(), font = useFont(), c = color(layer.color, "$accent");
  const w = layer.width ?? 640, h = layer.height ?? 180, p = progress(t, 0, layer.drawDuration ?? 0.35, "outQuint");
  const points = layer.handles === "none" ? [] : layer.handles === "corners" ? [[0, 0], [w, 0], [w, h], [0, h]] : [[0, 0], [w / 2, 0], [w, 0], [w, h / 2], [w, h], [w / 2, h], [0, h], [0, h / 2]];
  return <div style={{ position: "relative", width: w, height: h }}>
    <svg width={w} height={h} style={{ position: "absolute", overflow: "visible" }}>
      <rect width={w} height={h} fill={c} fillOpacity={(layer.fillOpacity ?? 0.03) * p} stroke={c} strokeWidth={1.5}
        pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />
      {points.map(([x, y], i) => <rect key={i} x={x - 4} y={y - 4} width={8} height={8} fill="white" stroke={c} strokeWidth={1.5} opacity={p} />)}
    </svg>
    {layer.label && <div style={{ position: "absolute", left: -1, bottom: "100%", padding: "5px 9px", background: c, color: "white", opacity: p,
      font: `500 15px ${font(undefined, "body")}`, whiteSpace: "nowrap" }}>{layer.label}</div>}
    {layer.dimensions && <div style={{ position: "absolute", left: "50%", top: "100%", transform: "translateX(-50%)", marginTop: 12,
      padding: "4px 8px", background: c, color: "white", opacity: p, font: `500 13px ${font(undefined, "mono")}`, whiteSpace: "nowrap" }}>{Math.round(w)} × {Math.round(h)}</div>}
  </div>;
};

export const Toggle: React.FC<{ layer: z.infer<typeof ToggleLayer>; t: number }> = ({ layer, t }) => {
  const { fps } = useVideoConfig();
  const color = useColor(), w = layer.width ?? 280, h = layer.height ?? 132, pad = h * 0.09, size = h - pad * 2;
  const p = toggleAt(layer.states.map((s) => ({ ...s, at: interactionFrame(s.at, fps) })), t, layer.initial, layer.stateDuration);
  const bg = interpolateColors(p, [0, 1], [color(layer.offColor, "#34333b"), color(layer.color, "$accent")]);
  // The thumb's edges ride a fast and a slow transition: the leading edge pulls ahead, so the thumb stretches as it travels.
  const states = layer.states.map((st) => ({ ...st, at: interactionFrame(st.at, fps) })), d = layer.stateDuration ?? 0.28;
  const fast = toggleAt(states, t, layer.initial, d * 0.6), slow = toggleAt(states, t, layer.initial, d * 1.25), travel = w - pad * 2 - size;
  const left = pad + travel * Math.min(fast, slow), right = pad + travel * Math.max(fast, slow) + size;
  return <div style={{ position: "relative", width: w, height: h, borderRadius: h, background: bg, boxShadow: "inset 0 1px 2px #fff2" }}>
    <div style={{ position: "absolute", left, top: pad, width: right - left, height: size, borderRadius: size,
      background: color(layer.thumbColor, "white"), boxShadow: "0 4px 10px #0002" }} />
  </div>;
};

/** A value slider. Bound to a sibling cursor (`cursor`), it follows the pointer while a drag holds and springs back on release. */
export const Slider: React.FC<{ layer: z.infer<typeof SliderLayer>; t: number }> = ({ layer, t }) => {
  const color = useColor(), font = useFont(), sib = useSiblings();
  const W = layer.width ?? 640, th = layer.thickness ?? 12, knob = layer.knob ?? 36, start = layer.start ?? 0;
  const bound = layer.cursor ? sib.layerOf(layer.cursor) : null;
  const cursor = bound?.layer.type === "cursor" ? bound.layer : null;
  // the cursor's press intervals on the slider's clock
  const drags = cursor?.drags?.map((d) => ({ at: bound!.start + d.at - start, until: bound!.start + d.until - start }));
  const raw = cursor ? (lt: number) => {
    const p = sib.transformAt(layer.cursor!, lt + start);
    if (!p) return null;
    const self = layer.id ? sib.transformAt(layer.id, lt + start) : null;
    const cx = self?.x ?? layer.x ?? 0, sc = self?.scale ?? layer.scale ?? 1;
    return (p.x - (cx - (W * sc) / 2)) / (W * sc);
  } : undefined;
  const { value } = sliderAt({ t, initial: layer.value, values: layer.values, drags, raw, settle: layer.settle, stretch: layer.stretch });
  const hold = drags ? Math.max(0, ...drags.map((d) => (t < d.at ? 0 : t <= d.until ? Math.min(1, (t - d.at) / 0.12) : Math.max(0, 1 - (t - d.until) / 0.25)))) : 0;

  // Past an end the track stretches with the knob and thins (its area stays the same)
  const lo = Math.min(0, value) * W, hi = Math.max(1, value) * W, thin = (th * W) / (hi - lo);
  const kx = value * W, fill = color(layer.color, "$accent");
  const b = layer.bubble, shown = b ? (b.show === "drag" ? hold : 1) : 0;
  const num = b ? (b.min ?? 0) + Math.min(1, Math.max(0, value)) * ((b.max ?? 100) - (b.min ?? 0)) : 0;
  const H = Math.max(knob, th);
  return <div style={{ position: "relative", width: W, height: H }}>
    <div style={{ position: "absolute", left: lo, width: hi - lo, top: (H - thin) / 2, height: thin, borderRadius: thin, background: color(layer.trackColor, "#d9d6cf") }} />
    <div style={{ position: "absolute", left: lo, width: Math.max(0, kx - lo), top: (H - thin) / 2, height: thin, borderRadius: thin, background: fill }} />
    {knob > 0 && <div style={{ position: "absolute", left: kx - knob / 2, top: (H - knob) / 2, width: knob, height: knob, borderRadius: "50%",
      background: color(layer.knobColor, "white"), boxShadow: "0 2px 6px #0003, 0 0 0 1px #0001", transform: `scale(${1 + 0.12 * hold})` }} />}
    {b && shown > 0.001 && <div style={{ position: "absolute", left: kx, bottom: H / 2 + knob / 2 + 14, opacity: shown,
      transform: `translateX(-50%) translateY(${(1 - shown) * 8}px)`, padding: "6px 12px", borderRadius: 999, background: fill, color: "white",
      font: `600 ${Math.max(14, knob * 0.5)}px ${font(undefined, "body")}`, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {(b.prefix ?? "") + num.toFixed(b.decimals ?? 0) + (b.suffix ?? "")}
    </div>}
  </div>;
};
