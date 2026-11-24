/**
 * Kinetic manifesto: four giant lines, each animated by scroll with a different text technique from the engine's kit —
 * scramble, whip (directional blur), per-glyph physics drop, horizontal stretch. Styles are written directly per frame.
 */
import { useRef } from "react";
import { clamp, easeOutExpo, easeSpring, scramble, useEnterProgress } from "../motion";

type Effect = "scramble" | "whip" | "drop" | "stretch";

const Line = ({ text, effect, serif, note }: { text: string; effect: Effect; serif?: boolean; note: string }) => {
  const el = useRef<HTMLDivElement>(null);
  const chars = [...text];
  const words = text.split(" ");
  useEnterProgress(el, (p) => {
    const root = el.current;
    if (!root) return;
    root.style.setProperty("--p", String(p));
    if (effect === "scramble") {
      const span = root.querySelector<HTMLElement>(".k-text");
      if (span) span.textContent = scramble(text, Math.floor(clamp(p * 1.25) * text.length), Math.floor(p * 40));
    } else if (effect === "whip") {
      root.querySelectorAll<HTMLElement>(".k-w").forEach((w, i) => {
        const q = easeOutExpo(clamp(p * 1.6 - i * 0.12));
        const dir = i % 2 ? 1 : -1;
        const d = (1 - q) * 60 * dir;
        w.style.transform = `translateX(${d}vw) skewX(${(1 - q) * -dir * 28}deg)`;
        w.style.filter = q < 0.98 ? `blur(${(1 - q) * 14}px)` : "none";
        w.style.opacity = String(clamp(q * 3));
      });
    } else if (effect === "drop") {
      root.querySelectorAll<HTMLElement>(".k-c").forEach((c, i, all) => {
        const q = easeSpring(clamp(p * 1.7 - (i / all.length) * 0.75));
        c.style.transform = `translateY(${(1 - q) * -110}%) rotate(${(1 - q) * (i % 2 ? 14 : -10)}deg)`;
        c.style.opacity = String(clamp(q * 4));
      });
    } else {
      const q = easeOutExpo(clamp(p * 1.4));
      const t = root.querySelector<HTMLElement>(".k-text");
      if (t) { t.style.transform = `scaleX(${1 + (1 - q) * 2.4}) scaleY(${0.35 + q * 0.65})`; t.style.letterSpacing = `${(1 - q) * 0.25}em`; t.style.opacity = String(clamp(q * 2.5)); }
    }
  }, 0.3);
  return (
    <div ref={el} className={`k-line k-${effect} ${serif ? "is-serif" : ""}`} aria-label={text} role="img">
      <span className="k-note label" aria-hidden>{note}</span>
      {effect === "whip" ? (
        <span className="k-text" aria-hidden>{words.map((w, i) => <span key={i} className="k-w">{w}{i < words.length - 1 ? " " : ""}</span>)}</span>
      ) : effect === "drop" ? (
        <span className="k-text" aria-hidden>{chars.map((c, i) => <span key={i} className="k-c">{c === " " ? " " : c}</span>)}</span>
      ) : (
        <span className="k-text" aria-hidden>{text}</span>
      )}
    </div>
  );
};

export const Kinetic = () => (
  <section className="kinetic" aria-labelledby="kin-t">
    <div className="site-wrap">
      <span className="label">03 · The kit</span>
      <h2 id="kin-t" className="sr-only">Type that moves, a camera that never cuts, sound on every hit, every format from one spec.</h2>
      <Line text="TYPE THAT MOVES." effect="scramble" note="text · scramble" />
      <Line text="A camera that never cuts." effect="whip" serif note="camera · physical springs" />
      <Line text="SOUND ON EVERY HIT." effect="drop" note="sfx · 347 cues" />
      <Line text="ONE SPEC, EVERY FORMAT." effect="stretch" note="reflow · 5 formats" />
    </div>
  </section>
);
