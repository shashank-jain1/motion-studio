/**
 * The starter films as a tilted 3D video wall (rows drifting in opposite directions, scroll-linked), and the engine's
 * features as a pinned horizontal reel of cards, each with a small looping demo drawn in CSS.
 */
import { useRef } from "react";
import { FILMS, splitTitle } from "../films";
import { span, useOnScreen, usePinProgress } from "../motion";

const media = (slug: string) => `/site/media/${slug}.mp4`;

const Tile = ({ slug, title, play }: { slug: string; title: string; play: boolean }) => {
  const t = splitTitle(title);
  return (
    <figure className="sh-wall-tile">
      <video src={media(slug)} poster={`/site/templates/${slug}/poster.jpg`} muted loop playsInline preload="none" autoPlay={play}
        ref={(v) => { if (!v) return; if (play) void v.play().catch(() => undefined); else v.pause(); }} />
      <figcaption><span className="label">{t.kind}</span><span className="serif-line sm">{t.name}</span></figcaption>
    </figure>
  );
};

export const Wall = () => {
  const sec = useRef<HTMLElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const [onRef, on] = useOnScreen<HTMLDivElement>(0);
  usePinProgress(sec, (p) => {
    const el = plane.current;
    if (!el) return;
    el.style.setProperty("--drift", String(p));
    el.style.transform = `rotateX(${42 - p * 22}deg) rotateZ(${-14 + p * 8}deg) translateY(${(0.5 - p) * 20}vh) scale(${1.05 + p * 0.25})`;
  }, 0.1);
  const rows = [FILMS.slice(0, 4), FILMS.slice(4, 8), [...FILMS.slice(2, 6)]];
  return (
    <section ref={sec} className="sh-wall" id="films" aria-labelledby="wall-t">
      <div ref={onRef} className="sh-wall-pin">
        <div ref={plane} className="sh-wall-plane" aria-hidden>
          {rows.map((r, i) => (
            <div key={i} className={`sh-wall-row ${i % 2 ? "rev" : ""}`} style={{ "--row": i } as React.CSSProperties}>
              {[...r, ...r].map((f, j) => <Tile key={`${f.slug}-${j}`} slug={f.slug} title={f.title} play={on} />)}
            </div>
          ))}
        </div>
        <div className="sh-wall-copy site-wrap">
          <span className="label">06 · Starter films</span>
          <h2 id="wall-t" className="sec-title">Eight films to <em>start from.</em></h2>
          <p>App launches, fintech, product drops, food, real estate, events, SaaS, creators. Open one in the studio and brief your own version.</p>
          <ul className="sr-only">{FILMS.map((f) => <li key={f.slug}>{f.title}: {f.description}</li>)}</ul>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- features

const DEMOS: { k: string; t: string; d: string; demo: React.ReactNode }[] = [
  { k: "Type", t: "Kinetic typography", d: "Twenty-plus text animations: mask reveals, slot-machine words, per-glyph physics, footage seen through letters.",
    demo: <div className="dm-slot"><span>BRIEF</span><span>SPEC</span><span>LOOK</span><span>SHIP</span><span>BRIEF</span></div> },
  { k: "Camera", t: "One continuous take", d: "Pushes, pans and log-space zooms on physical springs that carry momentum from move to move.",
    demo: <div className="dm-cam"><div className="dm-cam-grid">{Array.from({ length: 16 }, (_, i) => <i key={i} />)}</div><b /></div> },
  { k: "Springs", t: "Motion with weight", d: "Every move can land on a real damped spring: a touch of overshoot, then stillness. No canned bounces.",
    demo: <div className="dm-spring"><svg viewBox="0 0 200 80" aria-hidden><path d="M0 70 C 40 70, 50 2, 90 6 S 130 18, 150 12 S 180 10, 200 10" /></svg><b /></div> },
  { k: "Interface", t: "Product demos, no screen recording", d: "Cursors that click and drag, sliders, toggles, gliding indicators — animated straight from the spec.",
    demo: <div className="dm-ui"><div className="dm-toggle"><i /></div><div className="dm-cursor" /></div> },
  { k: "3D", t: "Devices and logos in 3D", d: "Phones, laptops and extruded logos, lit and moved by the same camera as everything else.",
    demo: <div className="dm-cube">{["f", "b", "l", "r", "t", "u"].map((s) => <i key={s} className={s} />)}</div> },
  { k: "Sound", t: "Original score, sound on every hit", d: "Music composed to the cut, no licensing. 347 effects placed automatically, plus voiceover and captions.",
    demo: <div className="dm-eq">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</div> },
  { k: "Data", t: "Charts, diagrams, code", d: "Charts that build, diagrams that focus, code that types itself, visualizers on the beat.",
    demo: <div className="dm-chart">{[38, 62, 45, 80, 58, 96].map((h, i) => <i key={i} style={{ "--h": `${h}%`, "--i": i } as React.CSSProperties} />)}</div> },
  { k: "Cuts", t: "Transitions that stay in the shot", d: "29 transitions, including match cuts, zoom-into and slices — content-aware joins for films that never cut away.",
    demo: <div className="dm-iris"><i /><i /></div> },
  { k: "Taste", t: "A brief it has to obey", d: "Ban glows or bouncy easing; ask for one take, a hero object, a seamless loop. A linter holds the director to it.",
    demo: <ul className="dm-rules mono"><li>glow</li><li>bouncy-easing</li><li>hard-cuts</li><li className="ok">one take</li></ul> },
];

export const Features = () => {
  const sec = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  usePinProgress(sec, (p) => {
    const el = track.current;
    if (!el) return;
    const travel = Math.max(0, el.scrollWidth - innerWidth + 64);
    el.style.transform = `translateX(${-span(p, 0.04, 0.96) * travel}px)`;
    if (bar.current) bar.current.style.transform = `scaleX(${p})`;
  }, 0.1);
  return (
    <section ref={sec} className="feat" id="engine" aria-labelledby="feat-t">
      <div className="feat-pin">
        <div className="site-wrap feat-head">
          <span className="label">07 · The engine</span>
          <h2 id="feat-t" className="sec-title">A finishing suite, <em>not a slideshow.</em></h2>
        </div>
        <div ref={track} className="feat-track">
          {DEMOS.map((f, i) => (
            <article key={f.k} className="feat-card">
              <div className="feat-demo" aria-hidden>{f.demo}</div>
              <div className="row gap"><span className="mono dim">{String(i + 1).padStart(2, "0")}</span><span className="label">{f.k}</span></div>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </article>
          ))}
        </div>
        <div className="site-wrap"><div className="feat-progress"><div ref={bar} /></div></div>
      </div>
    </section>
  );
};
