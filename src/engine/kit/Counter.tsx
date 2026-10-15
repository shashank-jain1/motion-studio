import React, { useMemo } from "react";
import type { z } from "zod";
import type { CounterLayer } from "../spec/schema";
import { lerp, progress } from "../core/animate";
import { useColor, useFont } from "../core/context";

type Props = { layer: z.infer<typeof CounterLayer>; t: number; duration: number };

/** Number of fraction digits a literal like 12.75 carries (used when `decimals` is omitted). */
const fractionDigits = (n: number) => {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
};

/**
 * Animated number: counts from → to over `countDuration` after `countDelay`, eased (outExpo by
 * default, so it races then lands softly). Locale-aware grouping (en-IN gives lakh/crore),
 * tabular numerals so the width doesn't jitter, optional gradient fill.
 */
export const Counter: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const font = useFont();
  const from = layer.from ?? 0;
  const decimals = layer.decimals ?? Math.max(fractionDigits(from), fractionDigits(layer.to));
  const p = progress(t, layer.countDelay ?? 0, layer.countDuration ?? 1.5, layer.ease, "outExpo");
  const value = lerp(from, layer.to, p);

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(layer.locale ?? "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } catch {
      return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
  }, [layer.locale, decimals]);

  // Round to the displayed precision first so we never show "-0" or a premature final digit.
  const f = Math.pow(10, decimals);
  const rounded = Math.round(value * f) / f;
  const text = `${layer.prefix ?? ""}${fmt.format(Object.is(rounded, -0) ? 0 : rounded)}${layer.suffix ?? ""}`;

  const fontSize = layer.fontSize ?? 140;
  const gradient = layer.gradient && layer.gradient.length > 0
    ? (layer.gradient.length === 1 ? [layer.gradient[0], layer.gradient[0]] : layer.gradient).map((c) => color(c))
    : undefined;

  const style: React.CSSProperties = {
    fontFamily: font(layer.font, "display"),
    fontSize,
    fontWeight: layer.weight ?? 800,
    lineHeight: 1,
    letterSpacing: "-0.035em",
    fontVariantNumeric: "tabular-nums",
    fontFeatureSettings: '"tnum" 1',
    whiteSpace: "nowrap",
    color: gradient ? "transparent" : color(layer.color, "$fg"),
    ...(gradient
      ? {
          backgroundImage: `linear-gradient(135deg, ${gradient.join(", ")})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
          // a little padding keeps descenders/italics from being clipped by background-clip
          padding: `0 ${fontSize * 0.04}px ${fontSize * 0.06}px`,
        }
      : {}),
  };

  return <div style={style}>{text}</div>;
};
