import React, { useMemo } from "react";
import { Img, random } from "remotion";
import type { z } from "zod";
import type { CloudLayer } from "../spec/schema";
import { clamp01, lerp, progress } from "../core/animate";
import { isEmoji, useAsset, useColor, useFont } from "../core/context";
import { useContainer } from "../core/container";

type Props = { layer: z.infer<typeof CloudLayer>; t: number; duration: number };
type Item = Props["layer"]["items"][number];
type Pt = { x: number; y: number };

/**
 * A cloud of items (logos, emoji, words) laid out inside the layer box as app-icon tiles.
 * Arrangements: scatter | orbit | grid | marquee | burst | arc. All motion is a pure function of t;
 * pseudo-randomness comes from remotion's seeded `random()`.
 *
 * `speed` is a multiplier (1 = default) for orbit rotation, marquee scroll and idle float.
 */

// ---------------------------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------------------------

const Tile: React.FC<{ item: Item; size: number; tile: boolean; fontFamily: string; fg: string }> = ({ item, size, tile, fontFamily, fg }) => {
  const asset = useAsset();
  const color = useColor();
  const src = item.src && !isEmoji(item.src) ? item.src : undefined;
  const emoji = item.emoji ?? (item.src && isEmoji(item.src) ? item.src : undefined);
  const bg = item.background ? color(item.background) : tile ? "#ffffff" : undefined;
  const boxed = !!bg;

  // Words become pills (a square tile would cramp them).
  if (!src && !emoji && item.text) {
    const h = size * 0.56;
    return (
      <div
        style={{
          height: h,
          padding: boxed ? `0 ${size * 0.26}px` : 0,
          display: "flex",
          alignItems: "center",
          borderRadius: 999,
          background: bg,
          boxShadow: boxed ? tileShadow(size) : undefined,
          fontFamily,
          fontWeight: 600,
          fontSize: size * 0.24,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          color: boxed ? (item.background ? "#ffffff" : "#111114") : fg,
        }}
      >
        {item.text}
      </div>
    );
  }

  const radius = "22.5%";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        boxShadow: boxed ? `${tileShadow(size)}, inset 0 0 0 ${Math.max(0.5, size * 0.006)}px rgba(0,0,0,0.05)` : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box",
        padding: boxed && src ? size * 0.16 : 0,
      }}
    >
      {src ? (
        <Img src={asset(src)} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: boxed ? 0 : radius }} />
      ) : (
        <span style={{ fontSize: size * (boxed ? 0.56 : 0.8), lineHeight: 1 }}>{emoji ?? "•"}</span>
      )}
    </div>
  );
};

const tileShadow = (s: number) =>
  `0 ${s * 0.01}px ${s * 0.02}px rgba(0,0,0,0.06), 0 ${s * 0.08}px ${s * 0.2}px rgba(0,0,0,0.12), 0 ${s * 0.22}px ${s * 0.5}px rgba(0,0,0,0.14)`;

// ---------------------------------------------------------------------------------------------
// Layout helpers (pure, memoised)
// ---------------------------------------------------------------------------------------------

/**
 * Best-candidate (Mitchell) sampling: evenly spread, organic-looking points inside the box,
 * kept out of the centre rectangle so a headline can sit there.
 */
const scatterPoints = (n: number, W: number, H: number, size: number, avoid: { width: number; height: number } | undefined, seed: string): Pt[] => {
  const pts: Pt[] = [];
  const m = size * 0.6;
  const ax = avoid ? avoid.width / 2 + size * 0.55 : 0;
  const ay = avoid ? avoid.height / 2 + size * 0.55 : 0;
  const inAvoid = (x: number, y: number) => !!avoid && Math.abs(x - W / 2) < ax && Math.abs(y - H / 2) < ay;
  for (let i = 0; i < n; i++) {
    let best: Pt | null = null;
    let bestD = -1;
    let tries = 0;
    for (let c = 0; c < 40 && tries < 400; tries++) {
      const x = lerp(m, W - m, random(`${seed}-sx-${i}-${tries}`));
      const y = lerp(m, H - m, random(`${seed}-sy-${i}-${tries}`));
      if (inAvoid(x, y)) continue;
      c++;
      // distance to nearest existing point (and a soft preference to stay off the very edges)
      let d = Infinity;
      for (const p of pts) d = Math.min(d, Math.hypot((p.x - x) / W, (p.y - y) / H));
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
    pts.push(best ?? { x: lerp(m, W - m, random(`${seed}-fx-${i}`)), y: lerp(m, H - m, random(`${seed}-fy-${i}`)) });
  }
  return pts;
};

// ---------------------------------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------------------------------

export const Cloud: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const font = useFont();
  const box = useContainer();
  const W = layer.width ?? box.width;
  const H = layer.height ?? box.height;
  const items = layer.items;
  const n = items.length;
  const arrangement = layer.arrangement ?? "scatter";
  const S = layer.itemSize ?? Math.round(Math.min(W, H) * 0.11);
  const tile = layer.tile ?? true;
  const stagger = layer.stagger ?? (arrangement === "marquee" ? 0 : 0.06);
  const speed = layer.speed ?? 1;
  const seed = `cloud-${layer.seed ?? 1}`;
  const fontFamily = font(undefined, "body");
  const fg = color(undefined, "$fg");
  // Scatter/burst keep the centre clear for a headline unless told otherwise (pass 0x0 to disable).
  const avoid = layer.avoidCenter ?? (arrangement === "scatter" || arrangement === "burst" ? { width: W * 0.42, height: H * 0.3 } : undefined);

  const scatter = useMemo(
    () => (arrangement === "scatter" || arrangement === "burst" ? scatterPoints(n, W, H, S, avoid && avoid.width > 0 && avoid.height > 0 ? avoid : undefined, seed) : []),
    [arrangement, n, W, H, S, avoid?.width, avoid?.height, seed],
  );

  // Per-item seeded traits: depth scale, resting tilt, float phase/frequency.
  const traits = useMemo(
    () =>
      items.map((_, i) => ({
        depth: 0.84 + 0.3 * random(`${seed}-d-${i}`),
        tilt: (random(`${seed}-r-${i}`) - 0.5) * 10,
        spin: (random(`${seed}-sp-${i}`) - 0.5) * 360,
        phase: random(`${seed}-p-${i}`) * Math.PI * 2,
        freq: 0.16 + 0.12 * random(`${seed}-f-${i}`),
      })),
    [items, seed],
  );

  const float = (i: number, amp = 1) => {
    const tr = traits[i];
    const w = 2 * Math.PI * tr.freq * speed * t + tr.phase;
    return { x: Math.cos(w * 0.8) * S * 0.035 * amp, y: Math.sin(w) * S * 0.07 * amp, r: Math.sin(w * 0.7) * 2.2 * amp };
  };

  /** Standard staggered pop-in. */
  const pop = (order: number) => {
    const p = progress(t, order * stagger, 0.6, "outBack");
    return { scale: Math.max(0, p), opacity: clamp01(progress(t, order * stagger, 0.25, "out")) };
  };

  const place = (key: React.Key, item: Item, x: number, y: number, scale: number, rotate: number, opacity: number, size = S, z = 0) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: z,
        opacity,
        transform: `translate(-50%, -50%) rotate(${rotate}deg) scale(${scale})`,
        willChange: "transform",
      }}
    >
      <Tile item={item} size={size} tile={tile} fontFamily={fontFamily} fg={fg} />
    </div>
  );

  let children: React.ReactNode[] = [];

  switch (arrangement) {
    case "scatter": {
      // Ripple outwards: items nearest the centre arrive first.
      const order = rankBy(scatter.map((p) => Math.hypot(p.x - W / 2, p.y - H / 2)));
      children = items.map((it, i) => {
        const p = scatter[i];
        const tr = traits[i];
        const a = pop(order[i]);
        const f = float(i);
        const rot = lerp(tr.tilt * 3, tr.tilt * 0.4, clamp01(a.scale)) + f.r;
        return place(i, it, p.x + f.x, p.y + f.y, a.scale * tr.depth, rot, a.opacity, S, Math.round(tr.depth * 100));
      });
      break;
    }

    case "burst": {
      // Fly out from the centre with overshoot and a decaying spin, then idle-float.
      children = items.map((it, i) => {
        const p = scatter[i];
        const tr = traits[i];
        const start = i * stagger * 0.5;
        const k = progress(t, start, 0.95, "outBack");
        const kl = progress(t, start, 0.95, "outQuint");
        const f = float(i, clamp01((t - start - 0.9) / 0.6));
        const x = lerp(W / 2, p.x, k) + f.x;
        const y = lerp(H / 2, p.y, k) + f.y;
        const rot = lerp(tr.spin, tr.tilt * 0.4, kl) + f.r;
        const scale = lerp(0.2, 1, kl) * tr.depth;
        return place(i, it, x, y, scale, rot, clamp01((t - start) / 0.12), S, Math.round(tr.depth * 100));
      });
      break;
    }

    case "orbit": {
      const R = layer.radius ?? Math.min(W, H) * 0.36;
      const rot = t * 12 * speed; // deg/s
      children = items.map((it, i) => {
        const ang = ((i / Math.max(1, n)) * 360 - 90 + rot) * (Math.PI / 180);
        const a = pop(i);
        // Tiles stay upright (no rotation applied) as they travel the ring.
        return place(i, it, W / 2 + Math.cos(ang) * R, H / 2 + Math.sin(ang) * R, a.scale, 0, a.opacity);
      });
      break;
    }

    case "grid": {
      const cols = Math.max(1, Math.round(layer.columns ?? Math.ceil(Math.sqrt((n * W) / Math.max(1, H)))));
      const rows = Math.ceil(n / cols);
      const pitch = S * 1.32;
      const ox = W / 2 - ((cols - 1) * pitch) / 2;
      const oy = H / 2 - ((rows - 1) * pitch) / 2;
      children = items.map((it, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const a = pop(c + r); // diagonal wave
        const f = float(i, 0.4);
        return place(i, it, ox + c * pitch + f.x, oy + r * pitch + f.y, a.scale, f.r * 0.5, a.opacity);
      });
      break;
    }

    case "marquee": {
      const rowsN = Math.max(1, Math.min(4, Math.round(layer.columns ?? Math.max(1, Math.min(3, Math.round(n / 6))))));
      const pitch = S * 1.3;
      const rowGap = S * 1.3;
      const oy = H / 2 - ((rowsN - 1) * rowGap) / 2;
      const pxPerSec = S * 0.9 * speed;
      const fadeIn = clamp01(progress(t, 0, 0.5, "out"));
      for (let r = 0; r < rowsN; r++) {
        const rowItems = items.filter((_, i) => i % rowsN === r);
        if (rowItems.length === 0) continue;
        const seqLen = rowItems.length * pitch;
        const reps = Math.max(1, Math.ceil((W + 2 * pitch) / seqLen));
        const total = seqLen * reps;
        const dir = r % 2 === 0 ? -1 : 1;
        const offset = dir * t * pxPerSec + r * pitch * 0.5;
        for (let k = 0; k < rowItems.length * reps; k++) {
          const raw = k * pitch + offset;
          const x = (((raw % total) + total) % total) - pitch;
          if (x > W + pitch) continue;
          children.push(place(`${r}-${k}`, rowItems[k % rowItems.length], x, oy + r * rowGap, 1, 0, fadeIn));
        }
      }
      break;
    }

    case "arc": {
      const R = layer.radius ?? Math.max(W, H) * 0.45;
      const step = (S * 1.25) / R; // radians between neighbours
      const span = Math.min((150 * Math.PI) / 180, step * Math.max(0, n - 1));
      const cy = H / 2 + (R * (1 + Math.cos(span / 2))) / 2; // vertically centre the arc band
      children = items.map((it, i) => {
        const th = n <= 1 ? 0 : -span / 2 + (span * i) / (n - 1);
        const x = W / 2 + Math.sin(th) * R;
        const y = cy - Math.cos(th) * R;
        // Rise into place from below, fanned like a hand of cards.
        const start = Math.abs(i - (n - 1) / 2) * stagger; // centre first
        const k = progress(t, start, 0.7, "outBack");
        const f = float(i, 0.35);
        return place(i, it, x + f.x, y + (1 - k) * S * 1.2 + f.y, lerp(0.6, 1, k), (th * 180) / Math.PI + f.r, clamp01(progress(t, start, 0.25, "out")));
      });
      break;
    }
  }

  if (arrangement === "marquee") {
    // Soft-edged horizontal clip. The mask box is padded vertically by S so tile shadows aren't cut.
    const mask = "linear-gradient(90deg, transparent 0%, #000 9%, #000 91%, transparent 100%)";
    return (
      <div style={{ position: "relative", width: W, height: H }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: -S, bottom: -S, overflow: "hidden", maskImage: mask, WebkitMaskImage: mask }}>
          <div style={{ position: "absolute", left: 0, top: S, width: W, height: H }}>{children}</div>
        </div>
      </div>
    );
  }

  return <div style={{ position: "relative", width: W, height: H }}>{children}</div>;
};

/** Rank of each value in ascending order (0 = smallest). */
const rankBy = (vals: number[]) => {
  const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(vals.length);
  idx.forEach(([, i], r) => (out[i] = r));
  return out;
};
