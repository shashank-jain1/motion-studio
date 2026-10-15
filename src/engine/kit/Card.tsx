import React from "react";
import { Img, random } from "remotion";
import type { z } from "zod";
import type { CardLayer } from "../spec/schema";
import { clamp01, lerp, progress } from "../core/animate";
import { isEmoji, useAsset, useColor, useFont } from "../core/context";

type Props = { layer: z.infer<typeof CardLayer>; t: number; duration: number };
type Layer = Props["layer"];

/**
 * UI cards: iOS notifications, glass/solid panels, pills, toasts, iMessage bubbles, stats, quotes,
 * CTA buttons and search bars. Every dimension derives from `fontSize` (default 26) so a card can be
 * scaled by changing a single number and still keep iOS-like proportions.
 */

// ---------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------

/** Layered soft shadow (contact + ambient), sized relative to the font size. */
const softShadow = (fs: number, k = 1) =>
  `0 ${fs * 0.04}px ${fs * 0.08}px rgba(0,0,0,${0.05 * k}), 0 ${fs * 0.3}px ${fs * 0.9}px rgba(0,0,0,${0.1 * k}), 0 ${fs * 0.9}px ${fs * 2.4}px rgba(0,0,0,${0.14 * k})`;

const looksLikePath = (s: string) => /^(https?:|data:|blob:)/.test(s) || /[/\\]/.test(s) || /\.[a-z0-9]{2,5}$/i.test(s);

/** Mild "squircle" corner radius used by iOS app icons. */
const ICON_RADIUS = "22.5%";

/** App icon: image asset, emoji on a tinted tile, or a letter tile. */
const AppIcon: React.FC<{ icon?: string; size: number; tint: string; fallback?: string; round?: boolean; fontFamily: string }> = ({
  icon,
  size,
  tint,
  fallback,
  round,
  fontFamily,
}) => {
  const asset = useAsset();
  const radius = round ? "50%" : ICON_RADIUS;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    overflow: "hidden",
    boxShadow: `inset 0 0 0 ${Math.max(0.5, size * 0.012)}px rgba(0,0,0,0.06)`,
  };
  if (icon && !isEmoji(icon) && looksLikePath(icon)) {
    return <Img src={asset(icon)} style={{ ...base, objectFit: "cover", display: "block" }} />;
  }
  const glyph = icon ?? (fallback ? Array.from(fallback.trim())[0]?.toUpperCase() : undefined) ?? "•";
  const emoji = isEmoji(glyph);
  return (
    <div
      style={{
        ...base,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: emoji
          ? "linear-gradient(180deg, #ffffff 0%, #eceef2 100%)"
          : `linear-gradient(160deg, color-mix(in srgb, ${tint} 70%, white) 0%, ${tint} 100%)`,
        color: "#fff",
        fontFamily,
        fontWeight: 700,
        fontSize: size * (emoji ? 0.6 : 0.5),
        lineHeight: 1,
      }}
    >
      {glyph}
    </div>
  );
};

/** Tap feedback: quick squash then a springy release (slight overshoot). */
const pressScale = (t: number, press: number | undefined, depth: number) => {
  if (press === undefined || t < press) return 1;
  const down = progress(t, press, 0.1, "out");
  const up = progress(t, press + 0.1, 0.45, "outBack");
  return 1 - depth * down + depth * up;
};

/** Text style for single-line truncation. */
const ellipsis: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

/** Multi-line clamp. */
const clampLines = (n: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: n,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

// ---------------------------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------------------------

export const Card: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const font = useFont();
  const fs = layer.fontSize ?? 26;
  const bodyFont = font(layer.font, "body");
  const accent = color(layer.accent, "$accent");
  const v = layer.variant;

  let content: React.ReactNode;
  switch (v) {
    case "notification":
    case "notification-dark":
      content = <Notification layer={layer} fs={fs} dark={v === "notification-dark"} fontFamily={bodyFont} accent={accent} />;
      break;
    case "glass":
    case "solid":
      content = <Panel layer={layer} fs={fs} glass={v === "glass"} fontFamily={bodyFont} accent={accent} />;
      break;
    case "pill":
      content = <Pill layer={layer} fs={fs} fontFamily={bodyFont} accent={accent} />;
      break;
    case "toast":
      content = <Toast layer={layer} fs={fs} t={t} fontFamily={bodyFont} />;
      break;
    case "chat-left":
    case "chat-right":
      content = <Bubble layer={layer} fs={fs} right={v === "chat-right"} fontFamily={bodyFont} />;
      break;
    case "stat":
      content = <Stat layer={layer} fs={fs} fontFamily={bodyFont} displayFont={font(layer.font, "display")} accent={accent} />;
      break;
    case "quote":
      content = <Quote layer={layer} fs={fs} fontFamily={bodyFont} serif={font(layer.font ?? "Instrument Serif")} accent={accent} />;
      break;
    case "button":
      content = <Button layer={layer} fs={fs} t={t} fontFamily={bodyFont} accent={accent} />;
      break;
    case "search":
      content = <Search layer={layer} fs={fs} t={t} fontFamily={bodyFont} accent={accent} />;
      break;
  }

  // Buttons do their own (deeper) press with ripple; everything else gets a gentle tap.
  const s = v === "button" ? 1 : pressScale(t, layer.press, 0.03);
  return <div style={{ transform: s !== 1 ? `scale(${s})` : undefined }}>{content}</div>;
};

// ---------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------

type VProps = { layer: Layer; fs: number; fontFamily: string };

/** iOS lock-screen / banner notification. */
const Notification: React.FC<VProps & { dark: boolean; accent: string }> = ({ layer, fs, dark, fontFamily, accent }) => {
  const color = useColor();
  const W = layer.width ?? fs * 23.8;
  const bg = layer.background ? color(layer.background) : dark ? "rgba(28,28,30,0.72)" : "rgba(246,246,248,0.8)";
  const fg = layer.color ? color(layer.color) : dark ? "#ffffff" : "#000000";
  const meta = dark ? "rgba(235,235,245,0.6)" : "rgba(60,60,67,0.6)";
  return (
    <div
      style={{
        width: W,
        minHeight: layer.height,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: fs * 0.56,
        padding: `${fs * 0.6}px ${fs * 0.66}px ${fs * 0.62}px ${fs * 0.6}px`,
        borderRadius: fs * 0.96,
        background: bg,
        backdropFilter: "blur(30px) saturate(180%)",
        WebkitBackdropFilter: "blur(30px) saturate(180%)",
        boxShadow: `${softShadow(fs, dark ? 1.4 : 1)}, inset 0 0 0 ${Math.max(0.5, fs * 0.03)}px ${dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)"}`,
        fontFamily,
        color: fg,
        letterSpacing: "-0.012em",
        fontSize: fs,
        lineHeight: 1.28,
      }}
    >
      <AppIcon icon={layer.icon} size={fs * 1.62} tint={accent} fallback={layer.title} fontFamily={fontFamily} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {(layer.title || layer.meta) && (
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: fs * 0.5 }}>
            <span style={{ ...ellipsis, fontWeight: 600 }}>{layer.title}</span>
            {layer.meta && <span style={{ flexShrink: 0, fontSize: fs * 0.8, color: meta, fontWeight: 400 }}>{layer.meta}</span>}
          </div>
        )}
        {layer.body && <div style={{ ...clampLines(4), fontWeight: 400, opacity: dark ? 0.92 : 0.9 }}>{layer.body}</div>}
      </div>
    </div>
  );
};

/** Frosted glass panel or solid card. */
const Panel: React.FC<VProps & { glass: boolean; accent: string }> = ({ layer, fs, glass, fontFamily, accent }) => {
  const color = useColor();
  const W = layer.width ?? fs * 20;
  const fg = color(layer.color, glass ? "#ffffff" : "$fg");
  const bg = layer.background ? color(layer.background) : glass ? "rgba(255,255,255,0.14)" : color("$card");
  return (
    <div
      style={{
        width: W,
        minHeight: layer.height,
        boxSizing: "border-box",
        padding: fs * 1.15,
        borderRadius: fs * 1.15,
        background: glass ? `linear-gradient(160deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 60%), ${bg}` : bg,
        backdropFilter: glass ? "blur(30px) saturate(160%)" : undefined,
        WebkitBackdropFilter: glass ? "blur(30px) saturate(160%)" : undefined,
        border: glass ? `${Math.max(1, fs * 0.04)}px solid rgba(255,255,255,0.28)` : `${Math.max(1, fs * 0.03)}px solid rgba(127,127,127,0.12)`,
        boxShadow: glass
          ? `inset 0 ${fs * 0.04}px 0 rgba(255,255,255,0.35), ${softShadow(fs, 1.1)}`
          : softShadow(fs),
        color: fg,
        fontFamily,
        fontSize: fs,
        lineHeight: 1.35,
        letterSpacing: "-0.01em",
      }}
    >
      {(layer.icon || layer.title || layer.meta) && (
        <div style={{ display: "flex", alignItems: "center", gap: fs * 0.6 }}>
          {layer.icon && <AppIcon icon={layer.icon} size={fs * 1.9} tint={accent} fontFamily={fontFamily} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            {layer.title && <div style={{ fontWeight: 600, fontSize: fs * 1.15, lineHeight: 1.2, letterSpacing: "-0.02em" }}>{layer.title}</div>}
            {layer.meta && <div style={{ fontSize: fs * 0.8, opacity: 0.6, marginTop: fs * 0.1 }}>{layer.meta}</div>}
          </div>
        </div>
      )}
      {layer.body && (
        <div style={{ marginTop: layer.icon || layer.title || layer.meta ? fs * 0.6 : 0, opacity: 0.78 }}>{layer.body}</div>
      )}
    </div>
  );
};

/** Rounded chip with icon + text. */
const Pill: React.FC<VProps & { accent: string }> = ({ layer, fs, fontFamily, accent }) => {
  const color = useColor();
  const iconSize = fs * 1.3;
  const pad = fs * 0.42;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: fs * 0.42,
        width: layer.width,
        height: layer.height,
        boxSizing: "border-box",
        justifyContent: layer.width ? "center" : undefined,
        padding: `${pad}px ${fs * 0.9}px ${pad}px ${layer.icon ? pad : fs * 0.9}px`,
        borderRadius: 999,
        background: color(layer.background, "$card"),
        color: color(layer.color, "$fg"),
        boxShadow: `${softShadow(fs, 0.8)}, inset 0 0 0 ${Math.max(0.5, fs * 0.03)}px rgba(127,127,127,0.12)`,
        fontFamily,
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
      }}
    >
      {layer.icon && <AppIcon icon={layer.icon} size={iconSize} tint={accent} round fontFamily={fontFamily} />}
      <span>{layer.title ?? layer.body}</span>
      {layer.meta && <span style={{ fontWeight: 500, opacity: 0.55 }}>{layer.meta}</span>}
    </div>
  );
};

/** Success toast with a green check that draws itself in. */
const Toast: React.FC<VProps & { t: number }> = ({ layer, fs, t, fontFamily }) => {
  const color = useColor();
  const green = color(layer.accent, "#34C759");
  const circle = progress(t, 0.12, 0.45, "outBack");
  const tick = progress(t, 0.32, 0.42, "inOutQuint");
  const ring = progress(t, 0.3, 0.7, "out");
  const size = fs * 1.55;
  const twoLine = !!layer.body && !!layer.title;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: fs * 0.55,
        width: layer.width,
        boxSizing: "border-box",
        padding: `${fs * 0.5}px ${fs * 1.0}px ${fs * 0.5}px ${fs * 0.5}px`,
        borderRadius: twoLine ? fs * 0.95 : 999,
        background: layer.background ? color(layer.background) : "rgba(255,255,255,0.86)",
        backdropFilter: "blur(30px) saturate(180%)",
        WebkitBackdropFilter: "blur(30px) saturate(180%)",
        boxShadow: `${softShadow(fs)}, inset 0 0 0 ${Math.max(0.5, fs * 0.03)}px rgba(255,255,255,0.6)`,
        color: layer.color ? color(layer.color) : "#000",
        fontFamily,
        fontSize: fs,
        letterSpacing: "-0.012em",
        lineHeight: 1.25,
      }}
    >
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        {/* soft expanding ring as the check lands */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `${fs * 0.08}px solid ${green}`,
            transform: `scale(${lerp(1, 1.7, ring)})`,
            opacity: ring > 0 && ring < 1 ? 0.5 * (1 - ring) : 0,
          }}
        />
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", inset: 0, overflow: "visible", transform: `scale(${circle})` }}>
          <circle cx={12} cy={12} r={12} fill={green} />
          <path
            d="M6.8 12.4 L10.4 15.9 L17.4 8.6"
            pathLength={1}
            fill="none"
            stroke="#fff"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 1"
            strokeDashoffset={1 - tick}
          />
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{layer.title ?? layer.body ?? "Done"}</div>
        {twoLine && <div style={{ fontSize: fs * 0.85, opacity: 0.6 }}>{layer.body}</div>}
      </div>
      {layer.meta && <div style={{ marginLeft: fs * 0.4, fontSize: fs * 0.8, opacity: 0.5, whiteSpace: "nowrap" }}>{layer.meta}</div>}
    </div>
  );
};

/** iMessage bubble tail, drawn in a 20x20 box whose left 8 units overlap the bubble's corner. */
const TAIL_D = "M0 0 H8 V8 C8 13.6 10.8 17.6 16.2 19.6 C11 20.5 5.4 19.9 0 17.2 Z";

/** iMessage-style chat bubble: gray incoming (left), accent outgoing (right). */
const Bubble: React.FC<VProps & { right: boolean }> = ({ layer, fs, right, fontFamily }) => {
  const color = useColor();
  const bg = layer.background ? color(layer.background) : right ? color(layer.accent, "$accent") : "#E9E9EB";
  const fg = layer.color ? color(layer.color) : right ? "#ffffff" : "#000000";
  const r = fs * 0.85;
  const tail = fs * 0.8; // svg box size; 1 unit = tail / 20
  const u = tail / 20;
  const text = layer.body ?? layer.title ?? "";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: right ? "flex-end" : "flex-start",
        width: layer.width ?? fs * 16,
        fontFamily,
      }}
    >
      {layer.body && layer.title && (
        <div style={{ fontSize: fs * 0.62, opacity: 0.55, margin: `0 ${r}px ${fs * 0.15}px`, color: color(undefined, "$fg") }}>{layer.title}</div>
      )}
      <div style={{ position: "relative", maxWidth: "78%" }}>
        <div
          style={{
            position: "relative",
            zIndex: 1,
            background: bg,
            color: fg,
            fontSize: fs,
            lineHeight: 1.3,
            letterSpacing: "-0.012em",
            padding: `${fs * 0.36}px ${fs * 0.62}px ${fs * 0.38}px`,
            borderRadius: r,
            [right ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: fs * 0.3,
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
        <svg
          width={tail}
          height={tail}
          viewBox="0 0 20 20"
          style={{
            position: "absolute",
            zIndex: 0,
            bottom: 0,
            [right ? "right" : "left"]: -12 * u,
            transform: right ? undefined : "scaleX(-1)",
            overflow: "visible",
          }}
        >
          <path d={TAIL_D} fill={bg} />
        </svg>
      </div>
      {layer.meta && (
        <div style={{ fontSize: fs * 0.55, fontWeight: 500, opacity: 0.5, marginTop: fs * 0.18, padding: `0 ${fs * 0.2}px`, color: color(undefined, "$fg") }}>
          {layer.meta}
        </div>
      )}
    </div>
  );
};

/** Big number + label, with an optional delta chip (meta like "+12.4%"). */
const Stat: React.FC<VProps & { displayFont: string; accent: string }> = ({ layer, fs, fontFamily, displayFont, accent }) => {
  const color = useColor();
  const fg = color(layer.color, "$fg");
  const meta = layer.meta?.trim();
  const chip = meta ? (meta.startsWith("+") || meta.startsWith("▲") ? "#34C759" : meta.startsWith("-") || meta.startsWith("−") || meta.startsWith("▼") ? "#FF3B30" : accent) : accent;
  return (
    <div
      style={{
        width: layer.width,
        minHeight: layer.height,
        boxSizing: "border-box",
        padding: `${fs * 1.0}px ${fs * 1.2}px ${fs * 1.1}px`,
        borderRadius: fs * 1.1,
        background: color(layer.background, "$card"),
        boxShadow: `${softShadow(fs)}, inset 0 0 0 ${Math.max(0.5, fs * 0.03)}px rgba(127,127,127,0.12)`,
        color: fg,
        fontFamily,
        fontSize: fs,
        display: "inline-flex",
        flexDirection: "column",
        gap: fs * 0.3,
      }}
    >
      {(layer.icon || meta) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: fs * 0.8, marginBottom: fs * 0.2 }}>
          {layer.icon ? <AppIcon icon={layer.icon} size={fs * 1.5} tint={accent} fontFamily={fontFamily} /> : <span />}
          {meta && (
            <span
              style={{
                fontSize: fs * 0.72,
                fontWeight: 600,
                padding: `${fs * 0.16}px ${fs * 0.42}px`,
                borderRadius: 999,
                color: chip,
                background: `color-mix(in srgb, ${chip} 14%, transparent)`,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {meta}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          fontFamily: displayFont,
          fontSize: fs * 2.8,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: layer.accent ? accent : fg,
        }}
      >
        {layer.title}
      </div>
      {layer.body && <div style={{ fontSize: fs * 0.9, fontWeight: 500, opacity: 0.6, letterSpacing: "-0.01em" }}>{layer.body}</div>}
    </div>
  );
};

/** Pull quote: oversized serif quote mark, serif text, author line. */
const Quote: React.FC<VProps & { serif: string; accent: string }> = ({ layer, fs, fontFamily, serif, accent }) => {
  const color = useColor();
  const fg = color(layer.color, "$fg");
  const hasBg = !!layer.background;
  return (
    <div
      style={{
        width: layer.width ?? fs * 26,
        boxSizing: "border-box",
        padding: hasBg ? fs * 1.4 : 0,
        borderRadius: hasBg ? fs * 1.1 : 0,
        background: hasBg ? color(layer.background) : undefined,
        boxShadow: hasBg ? softShadow(fs) : undefined,
        color: fg,
      }}
    >
      <div style={{ fontFamily: serif, fontSize: fs * 5, lineHeight: 0.62, height: fs * 2.1, color: accent, marginLeft: -fs * 0.15 }}>{"“"}</div>
      <div style={{ fontFamily: serif, fontSize: fs * 1.65, lineHeight: 1.22, letterSpacing: "-0.01em" }}>{layer.body ?? layer.title}</div>
      {layer.body && (layer.title || layer.meta || layer.icon) && (
        <div style={{ display: "flex", alignItems: "center", gap: fs * 0.55, marginTop: fs * 1.0, fontFamily, fontSize: fs * 0.85 }}>
          {layer.icon && <AppIcon icon={layer.icon} size={fs * 1.9} tint={accent} round fallback={layer.title} fontFamily={fontFamily} />}
          {!layer.icon && <div style={{ width: fs * 1.4, height: Math.max(1, fs * 0.06), background: accent, borderRadius: 2 }} />}
          <div>
            {layer.title && <div style={{ fontWeight: 600 }}>{layer.title}</div>}
            {layer.meta && <div style={{ opacity: 0.55 }}>{layer.meta}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

/** Big rounded CTA with tap squash + ripple at `press`. */
const Button: React.FC<VProps & { t: number; accent: string }> = ({ layer, fs, t, fontFamily, accent }) => {
  const color = useColor();
  const bg = layer.background ? color(layer.background) : accent;
  const s = pressScale(t, layer.press, 0.06);
  const rp = layer.press !== undefined ? progress(t, layer.press, 0.65, "out") : 0;
  const pressing = layer.press !== undefined && t >= layer.press;
  const flash = layer.press !== undefined ? clamp01(1 - Math.abs(t - layer.press - 0.08) / 0.18) : 0;
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: fs * 0.45,
        width: layer.width,
        height: layer.height,
        boxSizing: "border-box",
        padding: `${fs * 0.78}px ${fs * 1.75}px`,
        borderRadius: 999,
        background: `linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 55%), ${bg}`,
        color: color(layer.color, "#ffffff"),
        fontFamily,
        fontSize: fs * 1.1,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        transform: `scale(${s})`,
        boxShadow: `inset 0 ${fs * 0.04}px 0 rgba(255,255,255,0.28), 0 ${fs * lerp(0.45, 0.2, flash)}px ${fs * lerp(1.3, 0.6, flash)}px color-mix(in srgb, ${bg} 45%, transparent), 0 ${fs * 0.05}px ${fs * 0.12}px rgba(0,0,0,0.12)`,
      }}
    >
      {layer.icon && <AppIcon icon={layer.icon} size={fs * 1.2} tint={bg} round fontFamily={fontFamily} />}
      <span style={{ position: "relative", zIndex: 1 }}>{layer.title ?? layer.body ?? "Continue"}</span>
      {/* press highlight + ripple */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,1)", opacity: 0.14 * flash }} />
      {pressing && rp < 1 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${rp * 260}%`,
            aspectRatio: "1",
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.25) 55%, rgba(255,255,255,0) 70%)",
            opacity: 1 - rp,
          }}
        />
      )}
    </div>
  );
};

/** Search bar that types its query out character by character with a human cadence. */
const Search: React.FC<VProps & { t: number; accent: string }> = ({ layer, fs, t, fontFamily, accent }) => {
  const color = useColor();
  const asset = useAsset();
  const query = layer.title ?? layer.body ?? "";
  const chars = Array.from(query);
  const typeStart = 0.3;
  const typeDur = Math.min(1.4, Math.max(0.6, chars.length * 0.055));
  // Deterministic, slightly irregular keystroke timing.
  const gaps = chars.map((_, i) => 0.6 + 0.8 * random(`search-${query}-${i}`));
  const total = gaps.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  let typed = 0;
  for (let i = 0; i < chars.length; i++) {
    acc += gaps[i];
    if (t - typeStart >= (acc / total) * typeDur) typed = i + 1;
  }
  const typing = t >= typeStart && typed < chars.length;
  const caretOn = typing || Math.floor(t * 1.9) % 2 === 0;
  const fg = color(layer.color, "#1c1c1e");
  const placeholder = layer.meta ?? "Search";
  const rightIcon = layer.icon;
  return (
    <div
      style={{
        width: layer.width ?? fs * 22,
        height: layer.height ?? fs * 2.3,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: fs * 0.5,
        padding: `0 ${fs * 0.75}px`,
        borderRadius: 999,
        background: layer.background ? color(layer.background) : "#ffffff",
        boxShadow: `${softShadow(fs, 0.9)}, inset 0 0 0 ${Math.max(0.5, fs * 0.03)}px rgba(0,0,0,0.06)`,
        fontFamily,
        fontSize: fs,
        letterSpacing: "-0.01em",
        color: fg,
      }}
    >
      <svg width={fs * 0.95} height={fs * 0.95} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <circle cx={10.5} cy={10.5} r={6.8} fill="none" stroke="rgba(60,60,67,0.6)" strokeWidth={2.4} />
        <path d="M15.6 15.6 L20.5 20.5" stroke="rgba(60,60,67,0.6)" strokeWidth={2.6} strokeLinecap="round" />
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", ...ellipsis }}>
        {typed === 0 ? (
          <>
            <Caret on={caretOn} fs={fs} color={accent} />
            <span style={{ opacity: 0.4 }}>{placeholder}</span>
          </>
        ) : (
          <>
            <span style={{ whiteSpace: "pre" }}>{chars.slice(0, typed).join("")}</span>
            <Caret on={caretOn} fs={fs} color={accent} />
          </>
        )}
      </div>
      {rightIcon &&
        (isEmoji(rightIcon) || !looksLikePath(rightIcon) ? (
          <span style={{ fontSize: fs * 0.95, lineHeight: 1, flexShrink: 0 }}>{rightIcon}</span>
        ) : (
          <Img src={asset(rightIcon)} style={{ width: fs * 1.2, height: fs * 1.2, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
        ))}
    </div>
  );
};

const Caret: React.FC<{ on: boolean; fs: number; color: string }> = ({ on, fs, color }) => (
  <span
    style={{
      display: "inline-block",
      width: Math.max(2, fs * 0.075),
      height: fs * 1.15,
      marginLeft: fs * 0.04,
      marginRight: fs * 0.04,
      borderRadius: 2,
      background: color,
      opacity: on ? 1 : 0,
      flexShrink: 0,
    }}
  />
);
