import React from "react";
import type { z } from "zod";
import type { ShapeLayer } from "../spec/schema";
import { progress } from "../core/animate";
import { useColor } from "../core/context";

type Props = { layer: z.infer<typeof ShapeLayer>; t: number; duration: number };

const polygonPoints = (sides: number, w: number, h: number, star = false) => {
  const pts: string[] = [];
  const n = star ? sides * 2 : sides;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = star && i % 2 === 1 ? 0.45 : 1;
    pts.push(`${w / 2 + Math.cos(a) * (w / 2) * r},${h / 2 + Math.sin(a) * (h / 2) * r}`);
  }
  return pts.join(" ");
};

export const Shape: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const W = layer.width ?? 200;
  const H = layer.height ?? (layer.shape === "line" ? 4 : W);
  const fill = layer.gradient ? `url(#g-${layer.id ?? "s"})` : color(layer.color, "$accent");
  const stroke = layer.stroke ? color(layer.stroke) : layer.shape === "ring" ? fill : undefined;
  const sw = layer.strokeWidth ?? (layer.shape === "ring" ? Math.max(4, W * 0.06) : 0);
  const glow = layer.glow ? color(typeof layer.glow === "string" ? layer.glow : (layer.color ?? "$accent")) : undefined;
  const draw = layer.draw ? progress(t, 0, layer.drawDuration ?? 1, "inOutQuint") : 1;
  const style: React.CSSProperties = { overflow: "visible", filter: glow ? `drop-shadow(0 0 ${W * 0.06}px ${glow}) drop-shadow(0 0 ${W * 0.18}px ${glow})` : undefined };

  // CSS shapes for rect/circle/blob: crisper and support gradients easily
  if (layer.shape === "rect" || layer.shape === "circle" || layer.shape === "blob") {
    const bg = layer.gradient ? `linear-gradient(135deg, ${layer.gradient.map((c) => color(c)).join(", ")})` : color(layer.color, "$accent");
    const r = layer.shape === "circle" ? "50%" : layer.shape === "blob" ? `${42 + 8 * Math.sin(t * 2)}% ${58 - 8 * Math.sin(t * 1.6)}% ${52 + 6 * Math.cos(t * 1.3)}% ${48 - 6 * Math.sin(t)}% / ${55 + 7 * Math.sin(t * 1.1)}% ${45 - 5 * Math.cos(t * 1.7)}% ${55 + 5 * Math.sin(t * 1.4)}% ${45 - 7 * Math.cos(t)}%` : (layer.radius ?? 0);
    return <div style={{ width: W, height: H, background: bg, borderRadius: r, border: layer.stroke ? `${sw || 2}px solid ${color(layer.stroke)}` : undefined, boxShadow: glow ? `0 0 ${W * 0.15}px ${glow}` : undefined }} />;
  }

  const grad = layer.gradient ? (
    <defs>
      <linearGradient id={`g-${layer.id ?? "s"}`} x1="0" y1="0" x2="1" y2="1">
        {layer.gradient.map((c, i) => <stop key={i} offset={i / (layer.gradient!.length - 1)} stopColor={color(c)} />)}
      </linearGradient>
    </defs>
  ) : null;

  if (layer.shape === "ring") {
    const r = W / 2 - sw / 2;
    const c = 2 * Math.PI * r;
    return (
      <svg width={W} height={W} style={style}>
        {grad}
        <circle cx={W / 2} cy={W / 2} r={r} fill="none" stroke={fill} strokeWidth={sw} strokeDasharray={c} strokeDashoffset={c * (1 - draw)} strokeLinecap="round" transform={`rotate(-90 ${W / 2} ${W / 2})`} />
      </svg>
    );
  }
  if (layer.shape === "line") {
    return (
      <svg width={W} height={Math.max(H, 4)} style={style}>
        {grad}
        <line x1={0} y1={H / 2} x2={W * draw} y2={H / 2} stroke={layer.gradient ? fill : color(layer.color, "$accent")} strokeWidth={H} strokeLinecap="round" />
      </svg>
    );
  }
  const pts = layer.shape === "triangle" ? polygonPoints(3, W, H) : polygonPoints(layer.sides ?? (layer.shape === "star" ? 5 : 6), W, H, layer.shape === "star");
  const per = 4 * (W + H);
  return (
    <svg width={W} height={H} style={style}>
      {grad}
      <polygon points={pts} fill={layer.draw ? "none" : fill} stroke={stroke ?? (layer.draw ? fill : undefined)} strokeWidth={sw || (layer.draw ? 4 : 0)} strokeLinejoin="round"
        strokeDasharray={layer.draw ? per : undefined} strokeDashoffset={layer.draw ? per * (1 - draw) : undefined} />
    </svg>
  );
};
