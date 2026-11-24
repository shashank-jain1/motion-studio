/**
 * Site chrome: a film-leader countdown on first visit (per tab), a viewfinder cursor that labels what it's over,
 * magnetic primary buttons, and a nav whose readout treats the page as a film — scroll position as timecode.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../../components/AppBar";
import { finePointer, onFrame, reducedMotion } from "../motion";

const SEEN = "ms-site-leader";

export const Leader = ({ onDone }: { onDone: () => void }) => {
  const [n, setN] = useState(3);
  const [out, setOut] = useState(false);
  useEffect(() => {
    let skip = false;
    try { skip = sessionStorage.getItem(SEEN) === "1"; } catch { /* storage off */ }
    if (skip || reducedMotion()) { onDone(); return; }
    try { sessionStorage.setItem(SEEN, "1"); } catch { /* storage off */ }
    const ts = [setTimeout(() => setN(2), 420), setTimeout(() => setN(1), 840), setTimeout(() => setOut(true), 1260), setTimeout(onDone, 1900)];
    return () => ts.forEach(clearTimeout);
  }, [onDone]);
  return (
    <div className={`leader ${out ? "is-out" : ""}`} aria-hidden>
      <div className="leader-cross" />
      <div className="leader-ring"><svg viewBox="0 0 100 100"><circle key={n} cx="50" cy="50" r="44" /></svg></div>
      <div key={n} className="leader-n mono">{n}</div>
      <div className="leader-meta mono"><span>MOTION/STUDIO</span><span>REEL 01</span><span>30 FPS</span></div>
    </div>
  );
};

export const Cursor = () => {
  const el = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!finePointer() || reducedMotion()) return;
    setOn(true);
    document.documentElement.classList.add("site-cursor");
    let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, hot = false;
    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      const t = (e.target as Element | null)?.closest?.("a, button, input, textarea, [data-cursor]");
      hot = !!t;
      setLabel(t?.getAttribute("data-cursor") ?? "");
    };
    addEventListener("pointermove", move);
    const off = onFrame((_, dt) => {
      const k = 1 - Math.exp(-dt / 0.06);
      cx += (x - cx) * k; cy += (y - cy) * k;
      const c = el.current;
      if (!c) return;
      c.style.transform = `translate(${cx}px, ${cy}px)`;
      c.classList.toggle("is-hot", hot);
    });
    // magnetic buttons: pull toward the pointer a little, spring back on leave
    const mags = new Map<HTMLElement, { x: number; y: number; tx: number; ty: number }>();
    const magMove = (e: PointerEvent) => {
      document.querySelectorAll<HTMLElement>(".magnetic").forEach((b) => {
        const r = b.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const near = Math.abs(dx) < r.width * 0.9 && Math.abs(dy) < r.height * 1.6;
        const s = mags.get(b) ?? { x: 0, y: 0, tx: 0, ty: 0 };
        s.tx = near ? dx * 0.28 : 0; s.ty = near ? dy * 0.4 : 0;
        mags.set(b, s);
      });
    };
    addEventListener("pointermove", magMove);
    const offMag = onFrame((_, dt) => {
      const k = 1 - Math.exp(-dt / 0.09);
      mags.forEach((s, b) => { s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k; b.style.translate = `${s.x}px ${s.y}px`; });
    });
    return () => {
      off(); offMag();
      removeEventListener("pointermove", move); removeEventListener("pointermove", magMove);
      document.documentElement.classList.remove("site-cursor");
    };
  }, []);
  if (!on) return null;
  return (
    <div ref={el} className="cursor" aria-hidden>
      <i className="c-tl" /><i className="c-tr" /><i className="c-bl" /><i className="c-br" /><b />
      {label && <span className="cursor-label mono">{label}</span>}
    </div>
  );
};

const tc = (s: number) => {
  const f = Math.floor((s % 1) * 30);
  const t = Math.floor(s);
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60, f].map((v) => String(v).padStart(2, "0")).join(":");
};

export const SiteNav = () => {
  const bar = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLSpanElement>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    let lastY = scrollY, shown = true;
    return onFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? scrollY / max : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      // the page is a 90-second film: scroll position as timecode
      if (code.current) code.current.textContent = tc(p * 90);
      const dy = scrollY - lastY;
      if (Math.abs(dy) > 6) {
        const want = dy < 0 || scrollY < 80;
        if (want !== shown) { shown = want; nav.current?.classList.toggle("is-hidden", !want); }
        lastY = scrollY;
      }
    });
  }, []);
  return (
    <header ref={nav} className="site-nav">
      <div className="site-wrap site-nav-in">
        <a href="#top" className="brand-link" aria-label="Motion Studio — top"><Wordmark /></a>
        <nav className="site-links" aria-label="Sections">
          <a href="#playhead">Engine</a>
          <a href="#formats">Formats</a>
          <a href="#how">How it works</a>
          <a href="#films">Films</a>
          <a href="#claude">Claude</a>
        </nav>
        <span className="spacer" />
        <span className="nav-tc mono" aria-hidden><i className="nav-rec" /><span ref={code}>00:00:00:00</span></span>
        <Link to="/login?next=%2F" className="btn ghost sm nav-signin">Sign in</Link>
        <a href="#join" className="btn primary sm">Join waitlist</a>
      </div>
      <div className="nav-progress" aria-hidden><div ref={bar} /></div>
    </header>
  );
};
