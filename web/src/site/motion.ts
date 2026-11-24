/**
 * Scroll and time primitives for the product site. Everything runs on one requestAnimationFrame loop and writes styles
 * directly where it can, so pinned, scroll-scrubbed sections stay at 60 fps without re-rendering React every frame.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of `v` through [a, b], clamped to 0..1. */
export const span = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInExpo = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
/** Underdamped spring step response (the engine's `physical` feel): overshoots ~6%, settles by t = 1. */
export const easeSpring = (t: number) => {
  if (t >= 1) return 1;
  const z = 0.55, w = 9.5, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
};

export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches;

// ---------------------------------------------------------------- one shared frame loop

type Tick = (now: number, dt: number) => void;
const ticks = new Set<Tick>();
let raf = 0, last = 0;
const loop = (now: number) => {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  ticks.forEach((t) => t(now, dt));
  raf = ticks.size ? requestAnimationFrame(loop) : 0;
  if (!raf) last = 0;
};
export const onFrame = (t: Tick) => {
  ticks.add(t);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => { ticks.delete(t); };
};

/**
 * Progress (0..1) of the page scrolling through a pinned section: 0 when its top reaches the viewport top, 1 when its
 * bottom reaches the viewport bottom. `cb` runs every frame the value changes (smoothed with a critically damped
 * follow, `lag` seconds), only while the section is near the viewport.
 */
export const usePinProgress = (ref: RefObject<HTMLElement | null>, cb: (p: number, raw: number) => void, lag = 0.08) => {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let near = true, v = -1, prev = -2;
    const io = new IntersectionObserver(([e]) => { near = e.isIntersecting; }, { rootMargin: "50% 0px" });
    io.observe(el);
    const read = () => {
      const r = el.getBoundingClientRect();
      const travel = r.height - innerHeight;
      return travel > 0 ? clamp(-r.top / travel) : clamp((innerHeight - r.top) / (innerHeight + r.height));
    };
    const off = onFrame((_, dt) => {
      if (!near && v >= 0) return;
      const raw = read();
      v = v < 0 || lag <= 0 ? raw : v + (raw - v) * (1 - Math.exp(-dt / lag));
      if (Math.abs(raw - v) < 0.0004) v = raw;
      if (v !== prev) { prev = v; cbRef.current(v, raw); }
    });
    return () => { off(); io.disconnect(); };
  }, [ref, lag]);
};

/** Progress of an element travelling through the viewport: 0 as its top enters at the bottom, 1 as it reaches `end` (0..1 of the viewport from the top). */
export const useEnterProgress = (ref: RefObject<HTMLElement | null>, cb: (p: number) => void, end = 0.35) => {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let prev = -1;
    const off = onFrame(() => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) { if (prev !== -1 && prev !== 0 && prev !== 1) { prev = r.top > 0 ? 0 : 1; cbRef.current(prev); } return; }
      const p = clamp((innerHeight - r.top) / (innerHeight * (1 - end)));
      if (p !== prev) { prev = p; cbRef.current(p); }
    });
    return off;
  }, [ref, end]);
};

/** A film clock: advances frames at `fps` while `running`, looping at `frames`. Returns the current frame (React state). */
export const useFilmClock = (frames: number, fps: number, running: boolean) => {
  const [frame, setFrame] = useState(0);
  const t = useRef(0);
  useEffect(() => {
    if (!running || frames <= 1) return;
    return onFrame((_, dt) => {
      t.current = (t.current + dt * fps) % frames;
      const f = Math.floor(t.current);
      setFrame((old) => (old === f ? old : f));
    });
  }, [frames, fps, running]);
  return frame;
};

/** True while the element is (at least `threshold`) on screen. */
export const useOnScreen = <T extends Element>(threshold = 0.15) => {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, on] as const;
};

/** True once the element has been on screen. */
export const useSeen = <T extends Element>(threshold = 0.3) => {
  const [ref, on] = useOnScreen<T>(threshold);
  const [seen, setSeen] = useState(false);
  useEffect(() => { if (on) setSeen(true); }, [on]);
  return [ref, seen] as const;
};

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>";
/** `text` with its unsettled characters (from index `settled` on, within `width`) scrambled; deterministic per `seed`. */
export const scramble = (text: string, settled: number, seed: number, width = 6) =>
  [...text].map((c, i) => {
    if (i < settled || c === " " || i >= settled + width) return i < settled || c === " " ? c : "";
    return GLYPHS[Math.abs(Math.floor(Math.sin((i + 1) * 99.13 + seed * 7.7) * 10000)) % GLYPHS.length];
  }).join("");
