import React, { useMemo } from "react";
import { Img } from "remotion";
import { getLength, getPointAtLength, getTangentAtLength, scalePath } from "@remotion/paths";
import type { z } from "zod";
import type { PathLayer } from "../spec/schema";
import { progress } from "../core/animate";
import { isEmoji, useAsset, useColor, useFont } from "../core/context";
import { useContainer } from "../core/container";

type Props = { layer: z.infer<typeof PathLayer>; t: number; duration: number };

/** Preset paths drawn in a 1000x1000 box. */
export const PATH_PRESETS: Record<string, string> = {
  swoosh: "M 20 820 C 250 760, 380 300, 620 260 S 900 360, 980 120",
  arc: "M 40 800 Q 500 -100 960 800",
  wave: "M 0 500 C 125 300, 250 300, 375 500 S 625 700, 750 500 S 875 300, 1000 500",
  loop: "M 40 700 C 300 700, 420 200, 560 260 C 720 330, 560 560, 460 440 C 380 340, 600 200, 960 220",
  zigzag: "M 20 600 L 200 400 L 380 600 L 560 400 L 740 600 L 980 380",
  spiral: "M 500 500 m 0 -40 a 40 40 0 1 1 -1 0 m 1 -60 a 100 100 0 1 1 -1 0 m 1 -80 a 180 180 0 1 1 -1 0",
  underline: "M 20 520 C 300 470, 700 470, 980 500",
  "circle-scribble": "M 520 120 C 860 110, 960 420, 860 700 C 760 930, 260 940, 120 700 C 0 480, 160 160, 560 150 C 700 150, 760 190, 800 230",
  "s-curve": "M 100 80 C 900 80, 900 500, 500 500 S 100 920, 900 920",
};

export const PathDraw: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const asset = useAsset();
  const font = useFont();
  const box = useContainer();
  const W = layer.width ?? box.width;
  const H = layer.height ?? box.height;
  const raw = layer.d ?? PATH_PRESETS[layer.preset ?? "swoosh"];
  const d = useMemo(() => scalePath(raw, W / 1000, H / 1000), [raw, W, H]);
  const len = useMemo(() => getLength(d), [d]);
  const p = progress(t, layer.drawStart ?? 0, layer.drawDuration ?? 1.2, layer.ease, "inOutQuint");
  const sw = layer.strokeWidth ?? 10;
  const strokeColor = layer.gradient ? `url(#pg-${layer.id ?? "p"})` : color(layer.color, "$accent");
  const glow = layer.glow ? color(typeof layer.glow === "string" ? layer.glow : (layer.color ?? "$accent")) : undefined;

  let dashArray: string, dashOffset: number;
  if (layer.trail !== undefined) {
    const seg = len * layer.trail;
    const head = p * (len + seg);
    dashArray = `${seg} ${len * 2}`;
    dashOffset = -(head - seg);
  } else {
    dashArray = `${len} ${len}`;
    dashOffset = len * (1 - p);
  }

  let follower: React.ReactNode = null;
  const f = layer.follower;
  if (f && p > 0 && p < 1.0001) {
    const at = Math.min(len - 0.01, Math.max(0.01, p * len));
    const pt = getPointAtLength(d, at) ?? { x: 0, y: 0 };
    const tan = getTangentAtLength(d, at) ?? { x: 1, y: 0 };
    const ang = (Math.atan2(tan.y, tan.x) * 180) / Math.PI + (f.rotateOffset ?? 0);
    const size = f.size ?? 80;
    const rot = f.rotate === false ? 0 : ang;
    const inner = f.src && !isEmoji(f.src) ? <Img src={asset(f.src)} style={{ width: size, height: size, objectFit: "contain" }} />
      : <div style={{ fontSize: size, lineHeight: 1, fontFamily: font(undefined, "display") }}>{f.emoji ?? f.text ?? f.src ?? "✈️"}</div>;
    follower = (
      <div style={{ position: "absolute", left: pt.x, top: pt.y, transform: `translate(-50%, -50%) rotate(${rot}deg)` }}>{inner}</div>
    );
  }

  return (
    <div style={{ position: "relative", width: W, height: H }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible", filter: glow ? `drop-shadow(0 0 ${sw}px ${glow})` : undefined }}>
        {layer.gradient && (
          <defs>
            <linearGradient id={`pg-${layer.id ?? "p"}`} x1="0" y1="0" x2="1" y2="0">
              {layer.gradient.map((c, i) => <stop key={i} offset={i / (layer.gradient!.length - 1)} stopColor={color(c)} />)}
            </linearGradient>
          </defs>
        )}
        <path d={d} fill="none" stroke={strokeColor} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={layer.dashed ? `${sw * 2} ${sw * 2}` : dashArray} strokeDashoffset={layer.dashed ? 0 : dashOffset}
          style={layer.dashed ? { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } : undefined} />
      </svg>
      {follower}
    </div>
  );
};
