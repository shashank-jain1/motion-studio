/**
 * Closing run: the Claude connector as a terminal that types itself, the waitlist under a slot-machine headline, and a
 * footer wordmark whose letters spring away from the cursor.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, API_ORIGIN } from "../../api";
import { IconArrowRight, IconCheck, IconExternal, Spinner } from "../../components/Icons";
import { CopyButton } from "../../components/ui";
import { finePointer, onFrame, reducedMotion, useSeen } from "../motion";

const REPO = "https://github.com/shashank-jain1/motion-studio";
const MCP_URL = `${API_ORIGIN || location.origin}/mcp`;

// ---------------------------------------------------------------- claude

const SESSION: { who: string; text: string; dim?: string }[] = [
  { who: "you", text: "Make a 15s reel launching our cold brew. Logo's attached." },
  { who: "tool", text: "create_project · add_asset · analyze_logo" },
  { who: "tool", text: "set_spec", dim: "5 scenes · 15.0s · 9:16" },
  { who: "tool", text: "preview_frames", dim: "6 frames" },
  { who: "claude", text: "The tagline collides with the can in scene 3. Moving it up." },
  { who: "tool", text: "update_scene · compose_music · render_video" },
];

export const Claude = () => {
  const [ref, seen] = useSeen<HTMLDivElement>(0.4);
  const [chars, setChars] = useState(0);
  const total = SESSION.reduce((n, l) => n + l.text.length + (l.dim?.length ?? 0) + 8, 0);
  useEffect(() => {
    if (!seen) return;
    if (reducedMotion()) { setChars(total); return; }
    let c = 0;
    return onFrame((_, dt) => { c = Math.min(total, c + dt * 55); setChars(Math.floor(c)); });
  }, [seen, total]);
  let budget = chars;
  const cmd = `claude mcp add --transport http motion-studio ${MCP_URL}`;
  return (
    <section className="claude-sec" id="claude" aria-labelledby="claude-t">
      <div className="site-wrap claude-grid">
        <div className="claude-l">
          <span className="label">08 · Bring your own AI</span>
          <h2 id="claude-t" className="sec-title">Direct it <em>from Claude.</em></h2>
          <p className="dim">Motion Studio is an MCP server: Claude, Claude Code or any MCP client gets the same 47 tools the built-in director uses.</p>
          <div className="label">Claude Code</div>
          <div className="claude-cmd"><code className="mono">{cmd}</code><CopyButton text={cmd} /></div>
          <div className="label">claude.ai · Claude Desktop → Settings → Connectors → Add custom connector</div>
          <div className="claude-cmd"><code className="mono">{MCP_URL}</code><CopyButton text={MCP_URL} /></div>
          <p className="site-fine dim">Connecting needs a Motion Studio account: sign in once and approve access.</p>
        </div>
        <div ref={ref} className="term mono" aria-label="Example session">
          <div className="term-bar"><i /><i /><i /><span>example session</span></div>
          <ol>
            {SESSION.map((l, i) => {
              if (budget <= 0) return null;
              const n = Math.min(l.text.length, budget);
              budget -= l.text.length;
              const d = l.dim && budget > 0 ? l.dim.slice(0, Math.max(0, budget)) : "";
              budget -= (l.dim?.length ?? 0) + 8;
              const typing = budget <= 0;
              return (
                <li key={i} className={`term-${l.who}`}>
                  <span className="term-who">{l.who}</span>
                  <span>{l.text.slice(0, n)}{d && <span className="dim"> — {d}</span>}{typing && <i className="term-caret" />}</span>
                </li>
              );
            })}
            {chars >= total && <li className="term-done"><IconCheck size={12} />  final · 1080×1920 · 15.0s<i className="term-caret" /></li>}
          </ol>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- waitlist

const WORDS = ["launch film", "product demo", "event promo", "app reel", "brand loop"];

export const Join = () => {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setI((x) => (x + 1) % WORDS.length), 1700);
    return () => clearInterval(t);
  }, []);
  return (
    <section id="join" className="sh-join" aria-labelledby="join-t">
      <div className="sh-join-stripes" aria-hidden />
      <div className="site-wrap sh-join-grid">
        <div>
          <span className="label">09 · Waitlist</span>
          <h2 id="join-t" className="sh-join-title">
            Your next <span className="sh-join-slot" aria-live="polite"><span key={i} className="sh-join-word">{WORDS[i]}</span></span><br />is a paragraph away.
          </h2>
          <p className="dim">We're opening the studio to a small group of makers first. Leave your email and what you'd make.</p>
        </div>
        <WaitlistForm />
      </div>
    </section>
  );
};

export const WaitlistForm = ({ compact }: { compact?: boolean }) => {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "busy") return;
    setState("busy"); setErr(null);
    try {
      await api.joinWaitlist(email.trim(), note.trim(), trap);
      setState("done");
    } catch (e2) {
      const status = (e2 as { status?: number }).status;
      setErr(status === 0 || status === 502 || status === 504 ? "Couldn't reach the studio right now. Try again in a bit." : (e2 as Error).message);
      setState("idle");
    }
  };
  if (state === "done") {
    return (
      <div className="waitlist is-done" role="status">
        <IconCheck size={16} />
        <div><div className="waitlist-ok">You're on the list.</div><div className="dim small">You'll hear from us at {email.trim()} when a seat opens.</div></div>
      </div>
    );
  }
  const id = compact ? "wl-email-c" : "wl-email";
  return (
    <form className={`waitlist ${compact ? "compact" : ""}`} onSubmit={submit}>
      <div className="waitlist-row">
        <label className="sr-only" htmlFor={id}>Email</label>
        <input id={id} className="input lg" type="email" required autoComplete="email" inputMode="email"
          placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        <button className="btn primary lg magnetic" type="submit" disabled={state === "busy"}>
          {state === "busy" ? <Spinner size={14} /> : null}Join waitlist{state === "busy" ? null : <IconArrowRight size={14} />}
        </button>
      </div>
      {!compact && (
        <>
          <label className="label" htmlFor="wl-note">What would you make? <span className="dim">(optional)</span></label>
          <textarea id="wl-note" className="input waitlist-note" rows={3} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Launch reels for our app, event promos, product explainers…" />
        </>
      )}
      <input className="waitlist-trap" tabIndex={-1} autoComplete="off" aria-hidden name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
      {err && <p className="err-line" role="alert">{err}</p>}
    </form>
  );
};

// ---------------------------------------------------------------- footer

const MARK = "MOTION STUDIO";

export const SiteFooter = () => {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mark.current;
    if (!el || reducedMotion() || !finePointer()) return;
    const letters = [...el.querySelectorAll<HTMLElement>(".fm-l")];
    const st = letters.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0 }));
    let mx = -9999, my = -9999;
    const move = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    const leave = () => { mx = my = -9999; };
    addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    const off = onFrame((_, dt) => {
      const er = el.getBoundingClientRect();
      if (er.bottom < 0 || er.top > innerHeight) return;
      letters.forEach((l, i) => {
        const s = st[i];
        const b = l.getBoundingClientRect();
        const cx = b.left + b.width / 2 - s.x, cy = b.top + b.height / 2 - s.y;
        const dx = cx - mx, dy = cy - my, d = Math.hypot(dx, dy), R = Math.max(160, b.height * 1.4);
        let tx = 0, ty = 0;
        if (d < R) { const f = (1 - d / R) ** 2; tx = (dx / (d || 1)) * f * R * 0.45; ty = (dy / (d || 1)) * f * R * 0.45; }
        const k = 220, c = 2 * Math.sqrt(k) * 0.45;
        s.vx += (k * (tx - s.x) - c * s.vx) * dt; s.vy += (k * (ty - s.y) - c * s.vy) * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.r = s.vx * 0.04;
        l.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg)`;
      });
    });
    return () => { off(); removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); };
  }, []);
  return (
    <footer className="site-footer">
      <div ref={mark} className="footer-mark" aria-hidden>
        {[...MARK].map((c, i) => <span key={i} className={`fm-l ${c === "/" ? "t" : ""}`}>{c === " " ? " " : c}</span>)}
      </div>
      <div className="site-wrap site-footer-in">
        <span className="dim small">Motion graphics, directed by AI. Every frame on this page was made by Motion Studio.</span>
        <span className="spacer" />
        <a href={REPO} target="_blank" rel="noopener noreferrer" className="site-foot-link">GitHub <IconExternal size={12} /></a>
        <Link to="/login?next=%2F" className="site-foot-link">Sign in</Link>
        <span className="mono dim small">© {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
};
