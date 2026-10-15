/**
 * Smart stagger (research §3.4): eased delay distribution with a capped total spread, ordered by meaning/space.
 *
 *   staggerDelays(12, { base: 0.06, order: "center" })  // -> seconds per item, item 0..11
 *
 * Total cascade = min(base * (n - 1), maxSpread): long lists never take forever, short lists keep their rhythm.
 */
import { EASING, type EaseName } from "./animate";

export type StaggerOrder = "index" | "reverse" | "center" | "edges" | "random";

export type StaggerOptions = {
  /** seconds between neighbours before capping (default 0.06 ≈ 2 frames @30) */
  base?: number;
  /** cap on the total cascade in seconds (default 0.6) */
  maxSpread?: number;
  order?: StaggerOrder;
  /** seed for order "random" (default 1) */
  seed?: number;
  /** distribution curve over rank 0..1 (default "linear" when uncapped, gentle "out" when capped so the cascade bunches at its tail) */
  ease?: EaseName | ((r: number) => number);
  /** constant added to every delay */
  offset?: number;
};

/** mulberry32: tiny deterministic PRNG, returns a function yielding [0, 1). */
export const seededRandom = (seed: number) => {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const gentleOut = (r: number) => 1 - (1 - r) * (1 - r);

/** Rank 0..1 for each item (0 = goes first). */
export const staggerRanks = (n: number, order: StaggerOrder = "index", seed = 1): number[] => {
  if (n <= 1) return n === 1 ? [0] : [];
  const last = n - 1;
  const mid = last / 2;
  switch (order) {
    case "reverse": return Array.from({ length: n }, (_, i) => (last - i) / last);
    case "center": return Array.from({ length: n }, (_, i) => (mid === 0 ? 0 : Math.abs(i - mid) / mid));
    case "edges": return Array.from({ length: n }, (_, i) => (mid === 0 ? 0 : 1 - Math.abs(i - mid) / mid));
    case "random": {
      const rnd = seededRandom(seed);
      const idx = Array.from({ length: n }, (_, i) => i);
      for (let i = last; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const ranks = new Array<number>(n);
      idx.forEach((item, pos) => { ranks[item] = pos / last; });
      return ranks;
    }
    default: return Array.from({ length: n }, (_, i) => i / last);
  }
};

/** Delay (seconds) for each of n items. */
export const staggerDelays = (n: number, opts: StaggerOptions = {}): number[] => {
  const base = opts.base ?? 0.06;
  const maxSpread = opts.maxSpread ?? 0.6;
  const raw = base * Math.max(0, n - 1);
  const spread = Math.min(raw, maxSpread);
  const capped = raw > maxSpread;
  const curve = typeof opts.ease === "function" ? opts.ease : opts.ease ? EASING[opts.ease] : capped ? gentleOut : (r: number) => r;
  const off = opts.offset ?? 0;
  return staggerRanks(n, opts.order ?? "index", opts.seed ?? 1).map((r) => off + spread * (r <= 0 ? 0 : r >= 1 ? 1 : curve(r)));
};

/** Convenience: delay of item i of n (allocates the array; cache staggerDelays() yourself in hot loops). */
export const staggerDelay = (i: number, n: number, opts?: StaggerOptions) => staggerDelays(n, opts)[i] ?? 0;
