/**
 * Flow / architecture diagrams with a current product finish: glass nodes that arrive with a soft spring, blur and a
 * ping ring; connectors that draw toward their target and land with an arrowhead the moment the target appears;
 * glowing data packets with comet trails; focus beats that light the story's nodes and dim the rest.
 * Geometry and timing come from diagram/model.ts.
 */
import React, { useId, useMemo } from "react";
import { Img } from "remotion";
import { clamp01, progress } from "../core/animate";
import { isEmoji, useAsset, useColor, useFont, useRuntime } from "../core/context";
import { alpha, isDark, microLabel, panel, type SurfaceKind } from "./surface";
import { diagramModel, focusLevels, sampleAt, type DiagramL, type NodeGeo } from "./diagram/model";

type Props = { layer: DiagramL; t: number; duration: number };

export const Diagram: React.FC<Props> = ({ layer: l, t }) => {
  const color = useColor();
  const font = useFont();
  const asset = useAsset();
  const rt = useRuntime();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const m = useMemo(() => diagramModel(l), [l]);
  const fs = m.fs;
  const dark = isDark(color("$bg"));
  const fg = color("$fg");
  const muted = rt.colors.muted ? color("$muted") : alpha(fg, 0.55);
  const edgeCol = color(l.color ?? "$accent");
  const surface: SurfaceKind = l.surface ?? (dark ? "glass" : "solid");
  const body = font(l.font, "body"), mono = font(undefined, "mono");
  const card = color("$card", "$bg");

  // focus: per-node highlight (0..1) and how much everything else dims
  const beats = focusLevels(l, t);
  const anyFocus = Math.max(0, ...beats.map((b) => b.level));
  const hl = (id: string) => Math.max(0, ...beats.filter((b) => b.nodes.has(id)).map((b) => b.level));

  const packets = l.packets ?? 2;
  const speed = l.speed ?? 260;
  const cx = m.W / 2, cy = m.H / 2 + (l.title ? fs * 0.8 : 0);

  return (
    <div style={{ position: "relative", width: m.W, height: m.H }}>
      {l.title && (
        <div style={{ position: "absolute", left: fs * 1.2, top: fs * 0.6, ...microLabel(mono, fs * 0.62, muted), opacity: progress(t, 0, 0.5, "expoOut") }}>{l.title}</div>
      )}
      <div style={{ position: "absolute", left: cx, top: cy, transform: `scale(${m.scale})`, transformOrigin: "0 0" }}>
        <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1} height={1}>
          <defs>
            {m.edges.map((e) => (
              <mask key={e.index} id={`${uid}m${e.index}`} maskUnits="userSpaceOnUse" x={-5000} y={-5000} width={10000} height={10000}>
                <path d={e.d} style={{ fill: "none", stroke: "#fff", strokeWidth: 12, strokeDasharray: e.len, strokeDashoffset: e.len * (1 - progress(t, e.start, e.end - e.start, "inOutQuint")) }} />
              </mask>
            ))}
          </defs>
          {m.edges.map((e) => {
            const p = progress(t, e.start, e.end - e.start, "inOutQuint");
            if (p <= 0) return null;
            const lit = Math.min(hl(e.from), hl(e.to));
            const dim = 1 - anyFocus * 0.6 * (1 - lit);
            const col = e.edge.color ? color(e.edge.color) : edgeCol;
            const tipIn = progress(t, e.end - 0.08, 0.3, "outBack");
            const [dx, dy] = e.dir, s = fs * 0.32;
            const [tx, ty] = e.tip;
            return (
              <g key={e.index} opacity={dim}>
                <path d={e.d} mask={`url(#${uid}m${e.index})`} style={{ fill: "none", stroke: alpha(col, 0.14 + lit * 0.2), strokeWidth: 7, strokeLinecap: "round" }} />
                <path d={e.d} mask={`url(#${uid}m${e.index})`}
                  style={{ fill: "none", stroke: alpha(col, 0.62 + lit * 0.38), strokeWidth: 2, strokeLinecap: "round", strokeDasharray: e.edge.style === "dashed" ? "6 8" : undefined }} />
                {tipIn > 0 && (
                  <path d={`M${tx - dx * s * 1.6 - dy * s},${ty - dy * s * 1.6 + dx * s} L${tx},${ty} L${tx - dx * s * 1.6 + dy * s},${ty - dy * s * 1.6 - dx * s}`}
                    transform={`translate(${tx} ${ty}) scale(${tipIn}) translate(${-tx} ${-ty})`}
                    style={{ fill: "none", stroke: alpha(col, 0.9), strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }} />
                )}
              </g>
            );
          })}
          {/* data packets */}
          {packets > 0 && m.edges.map((e) => {
            if (e.edge.flow === false || t < e.end) return null;
            const col = e.edge.color ? color(e.edge.color) : edgeCol;
            const lit = Math.min(hl(e.from), hl(e.to));
            const dim = 1 - anyFocus * 0.75 * (1 - lit);
            const fadeIn = progress(t, e.end, 0.4, "inOut");
            const period = Math.max(0.6, e.len / speed);
            return Array.from({ length: packets }, (_, j) => {
              const u = (((t - e.end) / period + j / packets) % 1 + 1) % 1;
              const edgeFade = Math.min(1, u * 8, (1 - u) * 8);
              return (
                <g key={`${e.index}-${j}`} opacity={fadeIn * dim * edgeFade}>
                  {[0.045, 0.03, 0.015].map((back, k) => {
                    const [px, py] = sampleAt(e.samples, u - back);
                    return <circle key={k} cx={px} cy={py} r={3.2 - k * 0.6} style={{ fill: alpha(col, 0.12 + k * 0.12) }} />;
                  })}
                  {(() => { const [px, py] = sampleAt(e.samples, u); return <circle cx={px} cy={py} r={4.2 + lit * 1.2} style={{ fill: "#ffffff", filter: `drop-shadow(0 0 6px ${col}) drop-shadow(0 0 12px ${alpha(col, 0.8)})` }} />; })()}
                </g>
              );
            });
          })}
        </svg>
        {/* edge labels */}
        {m.edges.map((e) => {
          if (!e.edge.label) return null;
          const p = progress(t, e.end - 0.1, 0.4, "expoOut");
          if (p <= 0) return null;
          return (
            <div key={e.index} style={{ position: "absolute", left: e.mid[0], top: e.mid[1], transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * p})`, opacity: p * (1 - anyFocus * 0.5 * (1 - Math.min(hl(e.from), hl(e.to)))),
              padding: `${fs * 0.16}px ${fs * 0.45}px`, borderRadius: 999, background: dark ? "#0d0d12" : "#ffffff", border: `1px solid ${alpha(fg, 0.12)}`,
              ...microLabel(mono, fs * 0.5, muted), whiteSpace: "nowrap" }}>{e.edge.label}</div>
          );
        })}
        {m.nodes.map((g) => (
          <NodeView key={g.id} g={g} t={t} fs={fs} dark={dark} fg={fg} muted={muted} card={card} surface={surface} body={body} mono={mono}
            accent={g.node.color ? color(g.node.color) : edgeCol} focus={hl(g.id)} dim={anyFocus * (1 - hl(g.id))} asset={asset} />
        ))}
      </div>
    </div>
  );
};

const NodeView: React.FC<{
  g: NodeGeo; t: number; fs: number; dark: boolean; fg: string; muted: string; card: string; surface: SurfaceKind; body: string; mono: string;
  accent: string; focus: number; dim: number; asset: (s: string) => string;
}> = ({ g, t, fs, dark, fg, muted, card, surface, body, mono, accent, focus, dim, asset }) => {
  const n = g.node;
  const shape = n.shape ?? "card";
  const p = progress(t, g.appear, 0.6, "spring");
  if (t < g.appear) return null;
  const pb = progress(t, g.appear, 0.45, "expoOut");
  const ping = progress(t, g.appear + 0.08, 0.75, "expoOut");
  const scale = (0.84 + 0.16 * p) * (1 + 0.045 * focus);
  const opacity = clamp01(pb * 1.6) * (1 - dim * 0.42);
  const glow = focus > 0 ? `0 0 0 1px ${alpha(accent, 0.85 * focus)}, 0 0 ${fs * 1.4}px ${alpha(accent, 0.45 * focus)}` : "";
  const base = panel(surface === "none" ? "outline" : surface, dark, shape === "pill" || shape === "chip" ? 999 : shape === "circle" ? 9999 : fs * 0.55, card, fg);
  const icon = n.icon ? <Icon icon={n.icon} size={shape === "circle" ? g.w * 0.42 : fs * 0.95} color={accent} asset={asset} font={body} /> : null;
  const pingRing = ping < 1 && (
    <div style={{ position: "absolute", inset: -fs * 0.5 * ping, borderRadius: (base.borderRadius as number) ?? fs * 0.55, border: `1.5px solid ${alpha(accent, 0.55 * (1 - ping))}`, pointerEvents: "none" }} />
  );
  const shell: React.CSSProperties = {
    position: "absolute", left: g.x - g.w / 2, top: g.y - g.h / 2, width: g.w, height: g.h,
    transform: `scale(${scale})`, opacity, filter: pb < 1 ? `blur(${(1 - pb) * 6}px)` : undefined,
  };
  const label = <div style={{ fontFamily: body, fontSize: fs, fontWeight: 620, color: fg, letterSpacing: "-0.01em", whiteSpace: "nowrap", lineHeight: 1.15 }}>{n.label}</div>;
  const sub = n.sub && <div style={{ fontFamily: body, fontSize: fs * 0.72, color: muted, whiteSpace: "nowrap", marginTop: fs * 0.18, lineHeight: 1.15 }}>{n.sub}</div>;

  if (shape === "circle") {
    return (
      <div style={shell}>
        <div style={{ position: "absolute", inset: 0, ...base, borderRadius: "50%", display: "grid", placeItems: "center", boxShadow: [base.boxShadow, glow].filter(Boolean).join(", ") || undefined }}>{icon}</div>
        {pingRing}
        <div style={{ position: "absolute", top: g.h + fs * 0.45, left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>{label}{sub}</div>
      </div>
    );
  }
  if (shape === "diamond") {
    const s = g.w / Math.SQRT2;
    return (
      <div style={shell}>
        <div style={{ position: "absolute", left: (g.w - s) / 2, top: (g.h - s) / 2, width: s, height: s, ...base, borderRadius: fs * 0.35, transform: "rotate(45deg)", boxShadow: [base.boxShadow, glow].filter(Boolean).join(", ") || undefined }} />
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}><div>{label}{sub}</div></div>
      </div>
    );
  }
  if (shape === "chip") {
    return (
      <div style={{ ...shell, ...base, display: "flex", alignItems: "center", justifyContent: "center", gap: fs * 0.3, boxShadow: [base.boxShadow, glow].filter(Boolean).join(", ") || undefined }}>
        <span style={{ width: fs * 0.32, height: fs * 0.32, borderRadius: 99, background: accent, boxShadow: `0 0 ${fs * 0.5}px ${alpha(accent, 0.8)}` }} />
        <span style={{ ...microLabel(mono, fs * 0.6, fg), whiteSpace: "nowrap" }}>{n.label}</span>
        {pingRing}
      </div>
    );
  }
  // card / pill
  return (
    <div style={{ ...shell, ...base, display: "flex", alignItems: "center", gap: fs * 0.55, padding: `0 ${fs * 0.75}px`, boxSizing: "border-box",
      justifyContent: shape === "pill" && !icon ? "center" : "flex-start", boxShadow: [base.boxShadow, glow].filter(Boolean).join(", ") || undefined }}>
      {icon && (
        <div style={{ flex: "none", width: fs * 1.5, height: fs * 1.5, borderRadius: shape === "pill" ? 999 : fs * 0.4, display: "grid", placeItems: "center",
          background: alpha(accent, dark ? 0.16 : 0.12), boxShadow: `inset 0 0 0 1px ${alpha(accent, 0.25)}` }}>{icon}</div>
      )}
      <div style={{ minWidth: 0 }}>{label}{sub}</div>
      {pingRing}
      {focus > 0 && (
        <div style={{ position: "absolute", left: "8%", right: "8%", top: -1, height: 1, background: `linear-gradient(90deg, transparent, ${alpha(accent, focus)}, transparent)` }} />
      )}
    </div>
  );
};

const Icon: React.FC<{ icon: string; size: number; color: string; asset: (s: string) => string; font: string }> = ({ icon, size, color, asset, font }) => {
  if (/^(assets\/|https?:|data:)/.test(icon)) return <Img src={asset(icon)} style={{ width: size, height: size, objectFit: "contain" }} />;
  if (isEmoji(icon)) return <span style={{ fontSize: size * 0.9, lineHeight: 1 }}>{icon}</span>;
  return <span style={{ fontFamily: font, fontSize: size * 0.82, fontWeight: 700, color, lineHeight: 1 }}>{icon}</span>;
};

