import React, { useId, useMemo } from "react";
import { interpolateColors } from "remotion";
import type { z } from "zod";
import type { MorphLayer } from "../spec/schema";
import { EASING, clamp01 } from "../core/animate";
import { useColor } from "../core/context";
import { type ShapePart, useShapeSources } from "../shapes/resolve";
import { type MultiMorph, prepMultiMorph, rotateD } from "../shapes/morph";
import { areaCentroid, parsePath, splitSubpaths } from "../shapes/geom";

type Props = { layer: z.infer<typeof MorphLayer>; t: number; duration: number };

/** Default morph curve: quintic in-out that crests ~4% past the target, then settles exactly at 1. */
export const settleEase = (u: number, overshoot = 0.04) => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const a = 0.78;
  if (u < a) return EASING.inOutQuint(u / a) * (1 + overshoot);
  return 1 + overshoot * 0.5 * (1 + Math.cos((Math.PI * (u - a)) / (1 - a)));
};

const smooth = (e0: number, e1: number, x: number) => {
  const k = clamp01((x - e0) / (e1 - e0));
  return k * k * (3 - 2 * k);
};

/** interpolateColors that never throws (gradients/"none" step at the midpoint). */
export const mixColor = (a: string, b: string, p: number) => {
  if (a === b) return a;
  const k = clamp01(p);
  try {
    return interpolateColors(k, [0, 1], [a, b]);
  } catch {
    return k < 0.5 ? a : b;
  }
};

type Step = z.infer<typeof MorphLayer>["shapes"][number];

export const Morph: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const W = layer.width ?? 400;
  const H = layer.height ?? 400;
  const cx = W / 2, cy = H / 2;

  const steps = useMemo<Step[]>(() => [...layer.shapes].sort((a, b) => a.at - b.at), [layer.shapes]);
  const { shapes, ready } = useShapeSources(steps.map((s) => s.shape), { font: layer.font, weight: layer.weight, box: { w: W, h: H } });

  const morphLen = (i: number) => Math.max(0.05, steps[i].morph ?? 0.7);

  // which segment are we in?
  let idx = 0;
  for (let k = 1; k < steps.length; k++) {
    if (t >= steps[k].at - morphLen(k)) idx = k;
    else break;
  }
  const morphing = idx > 0 && t < steps[idx].at;
  const u = morphing ? clamp01((t - (steps[idx].at - morphLen(idx))) / morphLen(idx)) : 1;
  const twist = morphing ? (steps[idx].twist ?? 0) : 0;

  const mm = useMemo<MultiMorph | null>(() => {
    if (!ready || !morphing) return null;
    const from = shapes[idx - 1].parts.map((p) => p.d);
    const to = shapes[idx].parts.map((p) => rotateD(p.d, -twist, cx, cy));
    return prepMultiMorph(from, to);
  }, [ready, morphing, idx, twist, shapes, cx, cy]);

  // stagger for one→many / many→many (by target x), capped
  const delays = useMemo(() => {
    if (!mm || mm.pairs.length < 2 || !ready) return null;
    const toParts = shapes[idx].parts;
    const xs = mm.pairs.map((p) => {
      const d = p.to >= 0 ? toParts[p.to].d : shapes[idx - 1].parts[p.from].d;
      return areaCentroid(parsePath(d)).cx;
    });
    const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const spread = Math.min(0.22, 0.05 * (order.length - 1));
    const out = new Array(order.length).fill(0);
    order.forEach((pi, rank) => {
      out[pi] = spread * EASING.out(rank / Math.max(1, order.length - 1));
    });
    return { out, spread };
  }, [mm, ready, shapes, idx]);

  if (!ready) return <div style={{ width: W, height: H }} />;

  const gradId = `mg${uid}`;
  const useGrad = !!layer.gradient && layer.gradient.length > 1;
  const fillFor = (i: number, part?: ShapePart) => (useGrad ? `url(#${gradId})` : color(steps[i].fill ?? part?.fill ?? layer.fill, "$accent"));
  const strokeFor = (i: number) => {
    const s = steps[i].stroke ?? layer.stroke;
    return s ? color(s) : undefined;
  };
  const strokeWFor = (i: number) => steps[i].strokeWidth ?? layer.strokeWidth ?? Math.max(2, Math.min(W, H) * 0.012);

  const easeFn = (i: number) => {
    const e = steps[i].ease;
    return e ? (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : EASING[e](x)) : (x: number) => settleEase(x);
  };

  let content: React.ReactNode;
  let groupTransform = "";
  let gooStd = 0;

  if (morphing && mm) {
    const e = easeFn(idx);
    const p = e(u);
    const pc = clamp01(p);
    const scale = (steps[idx - 1].scale ?? 1) + ((steps[idx].scale ?? 1) - (steps[idx - 1].scale ?? 1)) * p;
    const pulse = 1 + 0.025 * Math.sin(Math.PI * u);
    groupTransform = `translate(${cx} ${cy}) rotate(${twist * p}) scale(${scale * pulse}) translate(${-cx} ${-cy})`;
    const fromParts = shapes[idx - 1].parts, toParts = shapes[idx].parts;
    const sw0 = strokeWFor(idx - 1), sw1 = strokeWFor(idx);
    const st0 = strokeFor(idx - 1), st1 = strokeFor(idx);
    content = mm.pairs.map((pair, k) => {
      const delay = delays ? delays.out[k] : 0;
      const span = delays ? 1 - delays.spread : 1;
      const pk = delays ? e(clamp01((u - delay) / span)) : p;
      const c0 = pair.from >= 0 ? fillFor(idx - 1, fromParts[pair.from]) : fillFor(idx, toParts[pair.to]);
      const c1 = pair.to >= 0 ? fillFor(idx, toParts[pair.to]) : c0;
      const stroke = st0 || st1 ? mixColor(st0 ?? c0, st1 ?? c1, pc) : undefined;
      const swk = stroke ? (st0 ? sw0 : 0) + ((st1 ? sw1 : 0) - (st0 ? sw0 : 0)) * pc : 0;
      return (
        <path key={k} d={pair.fn(pk)} fill={mixColor(c0, c1, clamp01(pk))} fillRule="nonzero"
          stroke={stroke} strokeWidth={swk || undefined} strokeLinejoin="round" />
      );
    });
    if (layer.goo && layer.goo > 0) gooStd = layer.goo * 0.045 * Math.min(W, H) * Math.pow(Math.sin(Math.PI * u), 0.8);
  } else {
    const i = idx;
    const parts = shapes[i].parts;
    const sc = steps[i].scale ?? 1;
    if (sc !== 1) groupTransform = `translate(${cx} ${cy}) scale(${sc}) translate(${-cx} ${-cy})`;
    const stroke = strokeFor(i);
    const sw = strokeWFor(i);

    // draw-on intro for the first shape
    const D = Math.max(0.3, steps[0].morph ?? 1.2);
    const drawStart = Math.max(0, steps[0].at - D);
    const drawing = layer.draw && i === 0 && t < drawStart + D;
    if (drawing) {
      const v = clamp01((t - drawStart) / D);
      const strokeP = EASING.inOut(clamp01(v / 0.85));
      const fillA = smooth(0.7, 1, v);
      const strokeA = stroke ? 1 : 1 - smooth(0.82, 1, v);
      const subs = parts.flatMap((part, pi) => (part.line ? [part.line.d] : splitSubpaths(part.d)).map((d, si) => ({ d, pi, si, w: part.line?.width })));
      content = (
        <>
          {parts.map((part, pi) => part.line ? null : (
            <path key={`f${pi}`} d={part.d} fill={fillFor(i, part)} fillRule={part.fillRule ?? "nonzero"} opacity={fillA} />
          ))}
          {subs.map(({ d, pi, w }, k) => {
            const lag = subs.length > 1 ? (k / (subs.length - 1)) * 0.25 : 0;
            const pk = clamp01((strokeP - lag) / (1 - 0.25 * (subs.length > 1 ? 1 : 0)));
            return (
              <path key={`s${k}`} d={d} fill="none" stroke={w ? fillFor(i, parts[pi]) : (stroke ?? fillFor(i, parts[pi]))} strokeWidth={w ?? sw}
                strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - pk}
                opacity={w ? 1 : strokeA} />
            );
          })}
        </>
      );
    } else {
      content = parts.map((part, pi) =>
        part.line ? (
          <path key={pi} d={part.line.d} fill="none" stroke={fillFor(i, part)} strokeWidth={part.line.width} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={pi} d={part.d} fill={fillFor(i, part)} fillRule={part.fillRule ?? "nonzero"}
            stroke={stroke} strokeWidth={stroke ? sw : undefined} strokeLinejoin="round" />
        ),
      );
    }
  }

  const goo = gooStd > 0.35;
  return (
    <div style={{ position: "relative", width: W, height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          {useGrad && (
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              {layer.gradient!.map((c, i) => <stop key={i} offset={i / (layer.gradient!.length - 1)} stopColor={color(c)} />)}
            </linearGradient>
          )}
          {goo && (
            <filter id={`goo${uid}`} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation={gooStd} result="blur" />
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" result="goo" />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          )}
        </defs>
        <g transform={groupTransform || undefined} filter={goo ? `url(#goo${uid})` : undefined}>{content}</g>
      </svg>
    </div>
  );
};
