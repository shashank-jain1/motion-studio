/**
 * Title sequence. The showreel plays inside giant "MOTION" letters (an ink plate with the word cut out of it); scrolling
 * pushes the camera into the I — a log-space zoom, like the engine's camera — until the film fills the screen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IconArrowRight } from "../../components/Icons";
import { clamp, easeOutExpo, lerp, onFrame, reducedMotion, span, usePinProgress } from "../motion";

const WORD = "MOTION";
const FONT = (px: number) => `700 ${px}px Geist, "Geist", system-ui, sans-serif`;
const TRACK = -0.045; // em

type Layout = { w: number; h: number; size: number; xs: number[]; base: number; ox: number; oy: number; zoom: number };

const measure = (w: number, h: number): Layout => {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = FONT(100);
  const adv = [...WORD].map((c) => ctx.measureText(c).width + TRACK * 100);
  const total = adv.reduce((a, b) => a + b, 0) - TRACK * 100;
  const size = Math.min((w * (w < 700 ? 0.94 : 0.9)) / total * 100, h * 0.46);
  const k = size / 100;
  const left = (w - total * k) / 2;
  const xs: number[] = [];
  adv.reduce((x, a) => { xs.push(x); return x + a * k; }, left);
  const cap = size * 0.7;
  const base = h * (w < 700 ? 0.44 : 0.5) + cap / 2;
  // dive into the stem of the I: the letters are the window onto the film, so the camera must end inside a stroke
  const ii = WORD.indexOf("I");
  const iw = (adv[ii] - TRACK * 100) * k;
  const ox = xs[ii] + iw / 2, oy = base - cap / 2;
  const stem = iw * 0.42;
  return { w, h, size, xs, base, ox, oy, zoom: (Math.max(ox, w - ox) * 2.4) / stem };
};

export const Hero = ({ reel, poster, ready }: { reel: string; poster: string; ready: boolean }) => {
  const sec = useRef<HTMLElement>(null);
  const outline = useRef<SVGGElement>(null);
  const cutRect = useRef<SVGRectElement>(null);
  const plate = useRef<SVGSVGElement>(null);
  const word = useRef<SVGGElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const [L, setL] = useState<Layout | null>(null);

  const relayout = useCallback(() => setL(measure(innerWidth, innerHeight)), []);
  useLayoutEffect(() => {
    relayout();
    void document.fonts?.ready.then(relayout);
    let t = 0;
    const on = () => { clearTimeout(t); t = window.setTimeout(relayout, 80); };
    addEventListener("resize", on);
    return () => { removeEventListener("resize", on); clearTimeout(t); };
  }, [relayout]);

  /** Chrome caches a mask's rendering: re-point the plate at it whenever its letters move. */
  const flip = useRef(false);
  const invalidate = () => {
    flip.current = !flip.current;
    cutRect.current?.setAttribute("mask", flip.current ? "url(#hero-cut)" : "url('#hero-cut')");
  };

  // letters rise into place once laid out (and the site intro is done), driven per frame so the mask repaints
  useEffect(() => {
    if (!L || !ready) return;
    const letters = [...(word.current?.querySelectorAll("text") ?? []), ...(outline.current?.querySelectorAll("text") ?? [])];
    if (reducedMotion()) { letters.forEach((el) => el.removeAttribute("transform")); invalidate(); return; }
    let t = 0;
    const off = onFrame((_, dt) => {
      t += dt;
      letters.forEach((el, j) => {
        const i = j % WORD.length;
        const q = easeOutExpo(clamp((t - 0.1 - i * 0.07) / 1.1));
        el.setAttribute("transform", `translate(0 ${((1 - q) * L.size * 0.6).toFixed(2)})`);
        el.setAttribute("opacity", q.toFixed(3));
      });
      invalidate();
      if (t > 1.8) off();
    });
    return off;
  }, [L, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  usePinProgress(sec, (p) => {
    if (!L) return;
    // reduced motion: no camera move, the title stays put and the page scrolls on
    const dive = reducedMotion() ? 0 : span(p, 0.06, 0.62);
    const s = Math.exp(lerp(0, Math.log(L.zoom), dive * dive * (3 - 2 * dive)));
    const tf = `translate(${L.ox} ${L.oy}) scale(${s}) translate(${-L.ox} ${-L.oy})`;
    word.current?.setAttribute("transform", tf);
    outline.current?.setAttribute("transform", tf);
    if (outline.current) outline.current.style.opacity = String(1 - span(dive, 0, 0.25));
    invalidate();
    if (plate.current) plate.current.style.visibility = dive >= 1 ? "hidden" : "visible";
    const out = span(p, 0, 0.12);
    if (copy.current) { copy.current.style.opacity = String(1 - out); copy.current.style.transform = `translateY(${-out * 60}px)`; }
    if (hint.current) hint.current.style.opacity = String(1 - span(p, 0, 0.05));
    if (after.current) {
      const a = span(p, 0.6, 0.9);
      after.current.style.setProperty("--a", String(a));
      after.current.querySelectorAll<HTMLElement>(".sh-hero-after-w").forEach((w, i, all) => {
        const q = easeOutExpo(clamp(a * (all.length + 2) - i));
        w.style.transform = `translateY(${(1 - q) * 110}%)`;
      });
      after.current.style.opacity = String(span(p, 0.58, 0.66) * (1 - span(p, 0.96, 1)));
    }
  }, 0.06);

  return (
    <section ref={sec} className="sh-hero" aria-label="Motion Studio">
      <div className="sh-hero-pin">
        <video className="sh-hero-reel" src={reel} poster={poster} autoPlay muted loop playsInline preload="auto" aria-hidden />
        {L && (
          <svg ref={plate} className="sh-hero-plate" width={L.w} height={L.h} viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden>
            <defs>
              <mask id="hero-cut" maskUnits="userSpaceOnUse" x="0" y="0" width={L.w} height={L.h}>
                <rect width={L.w} height={L.h} fill="#fff" />
                <g ref={word}>
                  {[...WORD].map((c, i) => (
                    <text key={i} x={L.xs[i]} y={L.base} fill="#000" opacity={0} style={{ font: FONT(L.size) }}>{c}</text>
                  ))}
                </g>
              </mask>
            </defs>
            <rect ref={cutRect} width={L.w} height={L.h} style={{ fill: "var(--ink)" }} mask="url(#hero-cut)" />
            <g ref={outline} className="sh-hero-outline">
              {[...WORD].map((c, i) => (
                <text key={i} x={L.xs[i]} y={L.base} opacity={0} style={{ font: FONT(L.size) }}>{c}</text>
              ))}
            </g>
          </svg>
        )}
        <div ref={copy} className="sh-hero-copy site-wrap">
          <div className="sh-hero-copy-l">
            <span className="label"><i className="sh-hero-rec" /> AI-directed motion graphics</span>
            <h1 className="sh-hero-h1">Brief it like a <em>director.</em></h1>
          </div>
          <div className="sh-hero-copy-r">
            <p>Turn a few lines into a finished motion-graphics film — kinetic type, 3D, camera moves, an original score and sound design — rendered for every platform.</p>
            <div className="row gap">
              <a href="#join" className="btn primary lg magnetic">Join waitlist <IconArrowRight size={14} /></a>
              <Link to="/login?next=%2F" className="btn ghost lg">Sign in</Link>
            </div>
          </div>
        </div>
        <div ref={hint} className="sh-hero-hint mono" aria-hidden>Scroll to enter<i /></div>
        <div ref={after} className="sh-hero-after site-wrap" aria-hidden>
          <div className="sh-hero-after-line"><span className="sh-hero-after-w">A few lines in.</span></div>
          <div className="sh-hero-after-line"><span className="sh-hero-after-w"><em>A film out.</em></span></div>
        </div>
      </div>
    </section>
  );
};
