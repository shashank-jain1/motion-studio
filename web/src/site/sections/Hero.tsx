/**
 * Title section: the headline rises in word by word, with the pitch and the calls to action, over a studio timeline strip
 * whose playhead sweeps the site's five films (the only motion; no video, no pinning).
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { IconArrowRight } from "../../components/Icons";
import { FILMS } from "../films";
import { onFrame, reducedMotion } from "../motion";

const LOOP = 14; // seconds for the playhead to cross the strip

const tc = (s: number) => {
  const f = Math.floor((s % 1) * 30);
  return [Math.floor(s / 60) % 60, Math.floor(s) % 60, f].map((v) => String(v).padStart(2, "0")).join(":");
};

const Strip = () => {
  const head = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLSpanElement>(null);
  const clips = useRef<HTMLDivElement>(null);
  const total = FILMS.reduce((n, f) => n + f.seconds, 0);
  useEffect(() => {
    const place = (p: number) => {
      if (head.current) head.current.style.left = `${p * 100}%`;
      if (code.current) code.current.textContent = tc(p * total);
      let acc = 0;
      clips.current?.querySelectorAll<HTMLElement>(".hs-clip").forEach((c, i) => {
        const a = acc / total, b = (acc += FILMS[i].seconds) / total;
        c.classList.toggle("is-on", p >= a && p < b);
      });
    };
    if (reducedMotion()) { place(0.32); return; }
    let t = 0;
    return onFrame((_, dt) => { t = (t + dt / LOOP) % 1; place(t); });
  }, [total]);
  return (
    <div className="hs-strip" aria-hidden>
      <div className="hs-bar">
        <i className="hs-rec" /><span ref={code} className="mono">00:00:00</span>
        <span className="mono dim">5 films · {total.toFixed(1)}s · made in Motion Studio</span>
      </div>
      <div className="hs-track">
        <div ref={clips} className="hs-clips">
          {FILMS.map((f) => (
            <div key={f.slug} className="hs-clip" style={{ flexGrow: f.seconds }}>
              <span className="mono">{f.kicker}</span><b>{f.title}</b>
            </div>
          ))}
        </div>
        <div ref={head} className="hs-head"><i /></div>
      </div>
    </div>
  );
};

export const Hero = () => {
  const words = ["Brief", "it", "like", "a"];
  return (
    <section className="sh-hero" aria-labelledby="hero-t">
      <div className="site-wrap sh-hero-in">
        <span className="label sh-hero-kicker"><i className="sh-hero-rec" /> AI-directed motion graphics</span>
        <h1 id="hero-t" className="sh-hero-title">
          {words.map((w, i) => <span key={w} className="sh-w" style={{ "--i": i } as React.CSSProperties}><span>{w}</span></span>)}
          <span className="sh-w" style={{ "--i": words.length } as React.CSSProperties}><span><em>director.</em></span></span>
        </h1>
        <div className="sh-hero-foot">
          <p>Turn a few lines into a finished motion-graphics film — kinetic type, 3D, camera moves, an original score and sound design — rendered for every platform.</p>
          <div className="row gap">
            <a href="#join" className="btn primary lg magnetic">Join waitlist <IconArrowRight size={14} /></a>
            <Link to="/login?next=%2F" className="btn ghost lg">Sign in</Link>
          </div>
        </div>
        <Strip />
      </div>
    </section>
  );
};
