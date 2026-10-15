import React from "react";
import { Img, interpolateColors, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import type { DeviceLayerT, ScreenT } from "../spec/schema";
import { clamp01, lerp, progress } from "../core/animate";
import { isVideoSrc, useAsset, useColor } from "../core/context";
import { ContainerProvider } from "../core/container";
import { LayerList } from "../render/LayerList";

type Props = { layer: DeviceLayerT; t: number; duration: number };

const FRAME_COLORS: Record<string, string> = {
  black: "#1d1d1f", titanium: "#8a857c", natural: "#8a857c", silver: "#d6d6db", white: "#eeeeee",
  "deep-red": "#5e1626", red: "#7a1e2c", blue: "#2c3a4f", gold: "#c9b28a", purple: "#4b3a63", green: "#3e4d3f",
};

const shade = (c: string, amt: number) =>
  amt >= 0 ? interpolateColors(amt, [0, 1], [c, "#ffffff"]) : interpolateColors(-amt, [0, 1], [c, "#000000"]);

const isDark = (c: string) => {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum < 128;
};

const StatusBar: React.FC<{ width: number; dark: boolean; top: number; pad: number }> = ({ width, dark, top, pad }) => {
  const c = dark ? "#fff" : "#000";
  const fs = width * 0.04;
  return (
    <div style={{ position: "absolute", top, left: pad, right: pad, height: fs * 1.6, display: "flex", justifyContent: "space-between", alignItems: "center", color: c, fontFamily: "Inter, system-ui", fontWeight: 600, fontSize: fs, zIndex: 50, pointerEvents: "none" }}>
      <span style={{ paddingLeft: width * 0.05 }}>9:41</span>
      <svg width={fs * 4.2} height={fs} viewBox="0 0 84 20" style={{ marginRight: width * 0.03 }}>
        {[0, 1, 2, 3].map((i) => <rect key={i} x={i * 5} y={14 - i * 4} width={3.4} height={6 + i * 4} rx={1} fill={c} />)}
        <path d="M30 8 a14 14 0 0 1 20 0 l-2.5 2.6 a10.5 10.5 0 0 0 -15 0z M34 12 a8 8 0 0 1 12 0 l-2.6 2.6 a4.3 4.3 0 0 0 -6.8 0z M40 19 l-3 -3 a4.3 4.3 0 0 1 6 0z" fill={c} />
        <rect x={56} y={4} width={24} height={12} rx={3.5} fill="none" stroke={c} strokeOpacity={0.5} strokeWidth={1.4} />
        <rect x={58} y={6} width={18} height={8} rx={2} fill={c} />
        <rect x={81} y={8} width={2} height={4} rx={1} fill={c} fillOpacity={0.5} />
      </svg>
    </div>
  );
};

const FaceGlyph: React.FC<{ size: number; color: string; draw: number; smile: number }> = ({ size, color, draw, smile }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    {[[10, 30, 10, 10, 30, 10], [70, 10, 90, 10, 90, 30], [90, 70, 90, 90, 70, 90], [30, 90, 10, 90, 10, 70]].map(([a, b, c, d, e, f], i) => (
      <path key={i} d={`M${a} ${b} L${c} ${d} L${e} ${f}`} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={60} strokeDashoffset={60 * (1 - draw)} />
    ))}
    <line x1={36} y1={38} x2={36} y2={46} stroke={color} strokeWidth={6} strokeLinecap="round" opacity={draw} />
    <line x1={64} y1={38} x2={64} y2={46} stroke={color} strokeWidth={6} strokeLinecap="round" opacity={draw} />
    <path d={`M50 40 L50 56 L45 56`} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" opacity={draw} />
    <path d={`M34 66 Q50 ${66 + 12 * smile} 66 66`} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" opacity={draw} />
  </svg>
);

const Island: React.FC<{ W: number; top: number; t: number; activity?: DeviceLayerT["island"] }> = ({ W, top, t, activity }) => {
  const baseW = W * 0.3, baseH = W * 0.088;
  let w = baseW, h = baseH, r = baseH / 2, content: React.ReactNode = null;
  if (activity?.activity) {
    const at = activity.at ?? 0.5;
    const dur = activity.duration ?? 1.6;
    const open = progress(t, at, 0.5, "spring") * (1 - progress(t, at + dur, 0.4, "inOutQuint"));
    const a = activity.activity;
    const bigW = a === "music" || a === "timer" || a === "pay" ? W * 0.86 : W * 0.42;
    const bigH = a === "music" || a === "timer" || a === "pay" ? W * 0.2 : W * 0.42;
    w = lerp(baseW, bigW, open);
    h = lerp(baseH, bigH, open);
    r = lerp(baseH / 2, a.startsWith("faceid") ? W * 0.11 : W * 0.1, open);
    const local = t - at;
    if (open > 0.3) {
      if (a.startsWith("faceid")) {
        const draw = clamp01((local - 0.15) / 0.4);
        const ok = a === "faceid-success" ? clamp01((local - 0.8) / 0.25) : 0;
        const ring = (local * 360 * 1.4) % 360;
        content = (
          <div style={{ position: "relative", width: h * 0.62, height: h * 0.62, opacity: clamp01((open - 0.3) * 3) }}>
            {ok < 1 && (
              <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, transform: `rotate(${ring}deg)`, opacity: 1 - ok }}>
                {Array.from({ length: 24 }).map((_, i) => {
                  const ang = (i / 24) * Math.PI * 2;
                  return <circle key={i} cx={50 + Math.cos(ang) * 42} cy={50 + Math.sin(ang) * 42} r={2.6} fill="#fff" opacity={0.25 + 0.75 * ((i / 24 + local) % 1)} />;
                })}
              </svg>
            )}
            <div style={{ position: "absolute", inset: "14%", opacity: ok > 0 ? 1 : draw * 0.4 }}>
              <FaceGlyph size={h * 0.62 * 0.72} color={ok > 0 ? "#34c759" : "#ffffff"} draw={ok > 0 ? ok : draw} smile={ok} />
            </div>
          </div>
        );
      } else if (a === "pay") {
        const ok = clamp01((local - 0.6) / 0.3);
        content = (
          <div style={{ display: "flex", alignItems: "center", gap: W * 0.03, color: "#fff", fontFamily: "Inter", fontWeight: 600, fontSize: W * 0.045, opacity: clamp01((open - 0.3) * 3) }}>
            <div style={{ width: W * 0.08, height: W * 0.08, borderRadius: "50%", background: ok > 0 ? "#34c759" : "#333", display: "grid", placeItems: "center", transform: `scale(${0.6 + 0.4 * ok})` }}>
              <svg width="60%" height="60%" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={24} strokeDashoffset={24 * (1 - ok)} /></svg>
            </div>
            <span>{ok > 0.5 ? "Done" : "Paying…"}</span>
          </div>
        );
      } else {
        content = (
          <div style={{ display: "flex", alignItems: "center", gap: W * 0.02, opacity: clamp01((open - 0.3) * 3) }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ width: W * 0.012, height: W * 0.05 * (0.3 + 0.7 * Math.abs(Math.sin(local * 6 + i))), background: "#ff6b9d", borderRadius: 4 }} />
            ))}
          </div>
        );
      }
    }
  }
  return (
    <div style={{ position: "absolute", top, left: "50%", width: w, height: h, marginLeft: -w / 2, borderRadius: r, background: "#000", zIndex: 60, display: "grid", placeItems: "center", overflow: "hidden" }}>
      {content}
    </div>
  );
};

const ScreenContent: React.FC<{ screen: ScreenT; width: number; height: number; t: number; layerKey: string }> = ({ screen, width, height, t, layerKey }) => {
  const asset = useAsset();
  const color = useColor();
  const { fps } = useVideoConfig();
  const bg = color(screen.background, "#ffffff");
  let img: React.ReactNode = null;
  if (screen.src) {
    const src = asset(screen.src);
    if (isVideoSrc(screen.src)) {
      img = <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
    } else {
      const sc = screen.scroll;
      const p = sc ? progress(t, sc.start ?? 0.4, sc.duration ?? 2, sc.ease, "inOutQuint") * sc.to : 0;
      img = (
        <Img src={src} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "auto", transform: `translateY(calc(${-p} * (100% - ${height}px)))` }} />
      );
    }
  }
  return (
    <div style={{ position: "absolute", inset: 0, background: bg, overflow: "hidden" }}>
      {img}
      {screen.layers && screen.layers.length > 0 && (
        <Sequence from={0} layout="none" name={`${layerKey}-ui`}>
          <ContainerProvider value={{ width, height, nested: true }}>
            <LayerList layers={screen.layers} />
          </ContainerProvider>
        </Sequence>
      )}
    </div>
  );
};

const Screens: React.FC<{ screens: ScreenT[]; width: number; height: number; t: number; layerKey: string }> = ({ screens, width, height, t, layerKey }) => {
  const { fps } = useVideoConfig();
  const timed = screens.map((s, i) => ({ s, at: s.at ?? (i === 0 ? 0 : i * 2) }));
  let cur = 0;
  timed.forEach((x, i) => { if (t >= x.at) cur = i; });
  const TRANS = 0.5;
  const nodes: React.ReactNode[] = [];
  const render = (i: number, style: React.CSSProperties) => {
    const { s, at } = timed[i];
    nodes.push(
      <div key={i} style={{ position: "absolute", inset: 0, ...style }}>
        <Sequence from={Math.round(at * fps)} layout="none">
          <ScreenContent screen={s} width={width} height={height} t={t - at} layerKey={`${layerKey}-${i}`} />
        </Sequence>
      </div>,
    );
  };
  const p = cur > 0 ? progress(t, timed[cur].at, TRANS, "inOutQuint") : 1;
  if (p < 1 && cur > 0) {
    const kind = timed[cur].s.transition ?? "push";
    const prevStyle: React.CSSProperties = kind === "push" ? { transform: `translateX(${-30 * p}%)`, filter: `brightness(${1 - 0.3 * p})` }
      : kind === "zoom" ? { transform: `scale(${1 - 0.08 * p})`, opacity: 1 - p } : kind === "fade" ? { opacity: 1 } : {};
    const curStyle: React.CSSProperties = kind === "push" || kind === "slide" ? { transform: `translateX(${(1 - p) * 100}%)`, boxShadow: "-20px 0 40px rgba(0,0,0,0.15)" }
      : kind === "zoom" ? { transform: `scale(${1.1 - 0.1 * p})`, opacity: p } : kind === "fade" ? { opacity: p } : {};
    render(cur - 1, prevStyle);
    render(cur, curStyle);
  } else {
    render(cur, {});
  }
  return <>{nodes}</>;
};

export const Device: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const model = layer.model ?? "iphone";
  const screens = layer.screens?.length ? layer.screens : [{ background: "#ffffff" }];
  const key = layer.id ?? "device";

  if (model === "browser") {
    const W = layer.width ?? 1280, H = layer.height ?? 800;
    const bar = 46;
    return (
      <div style={{ width: W, height: H, borderRadius: 14, overflow: "hidden", background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 30px 80px rgba(0,0,0,0.25)" }}>
        <div style={{ height: bar, background: "#f1f1f3", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, borderBottom: "1px solid #e2e2e6" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
          <div style={{ marginLeft: 24, flex: 1, maxWidth: W * 0.5, height: 28, borderRadius: 8, background: "#fff", border: "1px solid #e2e2e6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontSize: 14, color: "#555" }}>
            {layer.url ?? "yourproduct.com"}
          </div>
        </div>
        <div style={{ position: "relative", width: W, height: H - bar, overflow: "hidden" }}>
          <Screens screens={screens} width={W} height={H - bar} t={t} layerKey={key} />
        </div>
      </div>
    );
  }

  const isTablet = model === "tablet";
  const H = layer.height ?? (isTablet ? 820 : 780);
  const W = layer.width ?? H * (isTablet ? 0.72 : 0.488);
  const bezel = W * (isTablet ? 0.045 : 0.034);
  const R = W * (isTablet ? 0.07 : 0.165);
  const base = FRAME_COLORS[layer.frameColor ?? "black"] ?? color(layer.frameColor);
  const thickness = layer.thickness ?? 14;
  const slices = 10;
  const screenW = W - bezel * 2, screenH = H - bezel * 2;
  const dark = isDark(color(screens[0]?.background, "#ffffff"));
  const glareX = ((t * 0.08) % 1.6) - 0.3;

  return (
    <div style={{ position: "relative", width: W, height: H, transformStyle: "preserve-3d" }}>
      {/* edge thickness */}
      {Array.from({ length: slices }).map((_, i) => (
        <div key={i} style={{ position: "absolute", inset: 0, borderRadius: R, background: shade(base, -0.25 - (i / slices) * 0.35), transform: `translateZ(${-((i + 1) / slices) * thickness}px)` }} />
      ))}
      {/* side buttons */}
      {!isTablet && [[0.2, 0.05], [0.28, 0.09], [0.39, 0.09]].map(([top, h], i) => (
        <div key={i} style={{ position: "absolute", left: -W * 0.012, top: H * top, width: W * 0.016, height: H * h, borderRadius: 3, background: shade(base, -0.15), transform: `translateZ(${-thickness / 2}px)` }} />
      ))}
      {!isTablet && <div style={{ position: "absolute", right: -W * 0.012, top: H * 0.3, width: W * 0.016, height: H * 0.13, borderRadius: 3, background: shade(base, -0.15), transform: `translateZ(${-thickness / 2}px)` }} />}
      {/* front frame */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: R,
        background: `linear-gradient(135deg, ${shade(base, 0.35)} 0%, ${base} 22%, ${shade(base, -0.3)} 50%, ${base} 78%, ${shade(base, 0.25)} 100%)`,
        boxShadow: `inset 0 0 0 1.5px ${shade(base, 0.45)}, inset 0 0 0 ${bezel * 0.55}px #050505`,
      }} />
      {/* screen */}
      <div style={{ position: "absolute", left: bezel, top: bezel, width: screenW, height: screenH, borderRadius: Math.max(0, R - bezel), overflow: "hidden", background: "#000", transform: "translateZ(0.5px)" }}>
        <Screens screens={screens} width={screenW} height={screenH} t={t} layerKey={key} />
        {layer.statusBar !== false && !isTablet && <StatusBar width={screenW} dark={dark} top={screenW * 0.045} pad={screenW * 0.04} />}
        {!isTablet && model === "iphone" && <Island W={screenW} top={screenW * 0.035} t={t} activity={layer.island} />}
        {model === "android" && <div style={{ position: "absolute", top: screenW * 0.04, left: "50%", width: screenW * 0.045, height: screenW * 0.045, marginLeft: -screenW * 0.0225, borderRadius: "50%", background: "#000", zIndex: 60 }} />}
        {layer.glare !== false && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 70, background: `linear-gradient(115deg, transparent ${(glareX - 0.15) * 100}%, rgba(255,255,255,0.10) ${glareX * 100}%, transparent ${(glareX + 0.15) * 100}%)` }} />
        )}
      </div>
    </div>
  );
};
