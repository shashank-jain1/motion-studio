import React from "react";
import { interpolateColors, useVideoConfig } from "remotion";
import type { z } from "zod";
import type { CursorLayer, SelectionLayer, ToggleLayer } from "../spec/schema";
import { progress } from "../core/animate";
import { clickAt, interactionFrame, toggleAt } from "../core/interaction";
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

export const Cursor: React.FC<{ layer: z.infer<typeof CursorLayer>; t: number }> = ({ layer, t }) => {
  const { fps } = useVideoConfig();
  const color = useColor(), c = color(layer.color, "$accent"), state = clickAt((layer.clicks ?? []).map((at) => interactionFrame(at, fps)), t), size = layer.size ?? 36;
  return <div style={{ position: "relative", width: 1, height: 1 }}>
    {state.ripple !== null && <div style={{ position: "absolute", width: size * (0.3 + state.ripple * 2), height: size * (0.3 + state.ripple * 2),
      borderRadius: "50%", border: `2px solid ${c}`, opacity: (1 - state.ripple) * 0.7, transform: "translate(-50%,-50%)" }} />}
    <CursorGlyph kind={layer.kind} color={c} size={size} label={layer.label} press={state.press} />
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
  return <div style={{ position: "relative", width: w, height: h, borderRadius: h, background: bg, boxShadow: "inset 0 1px 2px #fff2" }}>
    <div style={{ position: "absolute", left: pad + (w - pad * 2 - size) * p, top: pad, width: size, height: size, borderRadius: "50%",
      background: color(layer.thumbColor, "white"), boxShadow: "0 4px 10px #0002", transform: `scaleX(${1 + Math.sin(p * Math.PI) * 0.07})` }} />
  </div>;
};
