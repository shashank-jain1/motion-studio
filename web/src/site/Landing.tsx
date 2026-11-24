/**
 * The product site (`/` for visitors, `/about` for everyone). Same instrument language as the studio (web/DESIGN.md):
 * every film on the page is a Scene Spec played live by the engine, from the bundled starter templates (./films).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Player, type PlayerRef } from "@remotion/player";
import { SpecVideo } from "../../../src/engine/render/SpecVideo";
import { api, API_ORIGIN } from "../api";
import { Wordmark } from "../components/AppBar";
import { HeroPlayer } from "../components/HeroPlayer";
import { IconArrowRight, IconCheck, IconExternal, Spinner } from "../components/Icons";
import { CopyButton, CropMarks, FormatGlyph, SlateStripe, TallyDot, useReducedMotion } from "../components/ui";
import { fmtTC } from "../lib/format";
import type { ParsedInfo } from "../lib/specInfo";
import { FILMS, filmBase, filmPoster, loadFilm, splitTitle, type Film } from "./films";
import "./site.css";

const REPO = "https://github.com/shashank-jain1/motion-studio";
const MCP_URL = `${API_ORIGIN || location.origin}/mcp`;

export const Landing = () => {
  useEffect(() => {
    document.title = "Motion Studio — motion graphics, directed by AI";
    // the page mounts after the session check, so the browser's own jump to #section has already missed
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  const [film, setFilm] = useState<Film>(FILMS[0]);
  const [info, setInfo] = useState<ParsedInfo | null>(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    void loadFilm(film).then((i) => { if (alive) setInfo(i); });
    return () => { alive = false; };
  }, [film]);

  return (
    <div className="site">
      <SiteNav />
      <main id="top">
        <Hero />
        <SpecStrip />
        <Section id="films" n={2} kicker="Screening room" title="Every film here is playing live."
          sub="No video files. Each one is a Scene Spec — plain JSON — drawn frame by frame by the engine in your browser. These are the starter templates you can open in the studio and make your own.">
          <ScreeningRoom film={film} info={info} onPick={setFilm} />
        </Section>
        <Section id="how" n={3} kicker="How it works" title="You write the brief. The director does the rest."
          sub="A brief becomes a spec, the spec becomes frames, and the director checks those frames before you see anything.">
          <HowItWorks film={film} info={info} />
        </Section>
        <Section id="engine" n={4} kicker="The engine" title="A finishing suite, not a slideshow."
          sub="Built for the craft that makes motion feel expensive: physical springs, continuous camera, sound on every hit.">
          <EngineGrid />
        </Section>
        <Section id="claude" n={5} kicker="Bring your own AI" title="Direct it from Claude."
          sub="Motion Studio is an MCP server. Claude, Claude Code or any MCP client gets the same tools the built-in director uses.">
          <ClaudeConnect />
        </Section>
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
};

// ---------------------------------------------------------------- chrome

const SiteNav = () => (
  <header className="site-nav">
    <div className="site-wrap site-nav-in">
      <a href="#top" className="brand-link" aria-label="Motion Studio — top"><Wordmark /></a>
      <nav className="site-links" aria-label="Sections">
        <a href="#films">Films</a>
        <a href="#how">How it works</a>
        <a href="#engine">Engine</a>
        <a href="#claude">Claude</a>
      </nav>
      <span className="spacer" />
      <Link to="/login?next=%2F" className="btn ghost sm">Sign in</Link>
      <a href="#join" className="btn primary sm">Join waitlist</a>
    </div>
  </header>
);

const Section = ({ id, n, kicker, title, sub, children }: { id: string; n: number; kicker: string; title: string; sub: string; children: React.ReactNode }) => (
  <section id={id} className="site-section" aria-labelledby={`${id}-t`}>
    <div className="site-wrap">
      <header className="site-head">
        <span className="label"><span className="mono">{String(n).padStart(2, "0")}</span> · {kicker}</span>
        <h2 id={`${id}-t`} className="site-h2">{title}</h2>
        <p className="site-sub">{sub}</p>
      </header>
      {children}
    </div>
  </section>
);

const SiteFooter = () => (
  <footer className="site-footer">
    <div className="site-wrap site-footer-in">
      <Wordmark />
      <span className="dim small">Motion graphics, directed by AI. Rendered with Remotion.</span>
      <span className="spacer" />
      <a href={REPO} target="_blank" rel="noopener noreferrer" className="site-foot-link">GitHub <IconExternal size={12} /></a>
      <Link to="/login?next=%2F" className="site-foot-link">Sign in</Link>
      <span className="mono dim small">© {new Date().getFullYear()}</span>
    </div>
  </footer>
);

// ---------------------------------------------------------------- hero

const Hero = () => (
  <section className="site-hero" aria-labelledby="hero-t">
    <div className="site-wrap site-hero-grid">
      <div className="site-hero-copy">
        <span className="label rise" style={{ "--i": 0 } as React.CSSProperties}><TallyDot /> 01 · AI-directed motion graphics</span>
        <h1 id="hero-t" className="site-display rise" style={{ "--i": 1 } as React.CSSProperties}>Brief it like a director.</h1>
        <p className="site-lede rise" style={{ "--i": 2 } as React.CSSProperties}>
          Motion Studio turns a few lines into a finished motion-graphics film — kinetic type, 3D, camera moves, an original
          score and sound design — and renders it for every platform.
        </p>
        <div className="rise" style={{ "--i": 3 } as React.CSSProperties}>
          <WaitlistForm compact />
          <p className="site-fine dim">Opening to a small group first. Already have access? <Link to="/login?next=%2F">Sign in</Link></p>
        </div>
      </div>
      <div className="site-hero-film wipe-in">
        <HeroPlayer />
      </div>
    </div>
  </section>
);

const SpecStrip = () => (
  <div className="site-wrap">
    <dl className="site-strip" aria-label="Engine at a glance">
      {[
        ["Layer types", "25"],
        ["Transitions", "29"],
        ["Sound effects", "347"],
        ["Formats", "5"],
        ["MCP tools", "47"],
      ].map(([k, v]) => (
        <div key={k} className="site-strip-cell"><dt className="label">{k}</dt><dd className="mono">{v}</dd></div>
      ))}
    </dl>
  </div>
);

// ---------------------------------------------------------------- screening room

const ScreeningRoom = ({ film, info, onPick }: { film: Film; info: ParsedInfo | null; onPick: (f: Film) => void }) => {
  const t = splitTitle(film.title);
  return (
    <div className="screening">
      <div className={`screening-stage ${film.format === "9:16" || film.format === "4:5" ? "is-portrait" : ""}`}>
        <FilmPlayer film={film} info={info} />
        <div className="screening-meta">
          <div className="label">{t.kind || film.niche}</div>
          <div className="serif-line">{t.name}</div>
          <p className="dim">{film.description}</p>
          <div className="screening-tags">
            {film.formats.map((f) => <span key={f} className="site-chip mono"><FormatGlyph format={f} size={10} />{f}</span>)}
            {film.tags.slice(0, 4).map((x) => <span key={x} className="site-chip dim">{x}</span>)}
          </div>
        </div>
      </div>
      <ol className="edl" aria-label="Films">
        <li className="edl-head label" aria-hidden><span>#</span><span>Film</span><span className="num">Dur</span><span>Fmt</span></li>
        {FILMS.map((f, i) => {
          const ft = splitTitle(f.title);
          const on = f.slug === film.slug;
          return (
            <li key={f.slug}>
              <button type="button" className={`edl-row ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => onPick(f)}>
                <span className="mono dim">{String(i + 1).padStart(2, "0")}</span>
                <span className="edl-title">
                  <img src={filmPoster(f.slug)} alt="" loading="lazy" className="edl-poster" />
                  <span className="ellipsis"><span className="dim">{ft.kind}</span> {ft.name}</span>
                </span>
                <span className="mono num">{f.durationSeconds.toFixed(1)}s</span>
                <span className="mono dim">{f.format}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

/** A template film, autoplaying muted while on screen (paused off screen and for reduced motion). */
const FilmPlayer = ({ film, info }: { film: Film; info: ParsedInfo | null }) => {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [visible, setVisible] = useState(false);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!player || !info) return;
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener("frameupdate", on);
    if (reduced) { player.pause(); player.seekTo(Math.round(info.durationInFrames * 0.6)); }
    else if (visible) player.play();
    else player.pause();
    return () => player.removeEventListener("frameupdate", on);
  }, [player, info, visible, reduced]);
  // muted, no sound library: the page never plays audio
  const inputProps = useMemo(() => (info ? { spec: info.raw as never, assetBase: filmBase(film.slug), projectId: `site-${film.slug}`, libraryBase: "" } : null), [info, film.slug]);
  const [w, h] = info ? [info.width, info.height] : film.format === "9:16" ? [9, 16] : film.format === "1:1" ? [1, 1] : film.format === "4:5" ? [4, 5] : [16, 9];
  const portrait = h > w;
  return (
    <figure className={`film ${portrait ? "is-portrait" : ""}`} aria-label={`${film.title}, rendered live by the engine`}>
      <div ref={box} className="film-frame" style={{ aspectRatio: `${w} / ${h}` }}>
        <CropMarks inset={-10} />
        <img className="film-poster" src={filmPoster(film.slug)} alt="" aria-hidden />
        {info && inputProps && (
          <Player key={film.slug} ref={setPlayer} component={SpecVideo} inputProps={inputProps}
            durationInFrames={info.durationInFrames} fps={info.fps} compositionWidth={info.width} compositionHeight={info.height}
            style={{ width: "100%", height: "100%", position: "relative" }} controls={false} loop initiallyMuted clickToPlay={false}
            errorFallback={() => null} />
        )}
      </div>
      <figcaption className="hero-readout">
        <TallyDot live={!!info && visible && !reduced} />
        <span className="label">{info ? "Live · engine" : "Loading spec"}</span>
        <span className="mono tc">{info ? fmtTC(frame / info.fps, info.fps) : "00:00:00:00"}</span>
        <span className="spacer" />
        <span className="mono dim">{info ? `${info.width}×${info.height} · ${info.fps} FPS` : film.format}</span>
      </figcaption>
    </figure>
  );
};

// ---------------------------------------------------------------- how it works

const STEPS = [
  { k: "Brief", t: "Say what you're making", d: "Product, audience, length, platform, the feeling. Drop in a logo, footage or music, or point it at your website." },
  { k: "Spec", t: "It writes a Scene Spec", d: "Scenes, layers, camera, easing, music and sound cues, in readable JSON you can edit by hand or in the timeline." },
  { k: "Look", t: "It watches its own cut", d: "The director renders preview frames, looks at them and fixes what's off — collisions, dead time, weak framing — before you see a frame." },
  { k: "Render", t: "Export everywhere", d: "Final MP4s in 16:9, 9:16, 1:1, 4:5 and 21:9 from one spec, with the score and sound design mixed in." },
];

const HowItWorks = ({ film, info }: { film: Film; info: ParsedInfo | null }) => (
  <div className="how">
    <ol className="how-steps">
      {STEPS.map((s, i) => (
        <li key={s.k} className="how-step">
          <div className="how-num mono">{String(i + 1).padStart(2, "0")}</div>
          <div>
            <div className="label">{s.k}</div>
            <h3 className="how-title">{s.t}</h3>
            <p className="dim">{s.d}</p>
          </div>
        </li>
      ))}
    </ol>
    <SpecExcerpt film={film} info={info} />
  </div>
);

/** A real scene from the film in the screening room, so the JSON on the page is the JSON on the screen. */
const SpecExcerpt = ({ film, info }: { film: Film; info: ParsedInfo | null }) => {
  const text = useMemo(() => {
    if (!info) return "";
    const scenes = (info.raw.scenes as Record<string, unknown>[] | undefined) ?? [];
    const sc = scenes[Math.min(1, scenes.length - 1)];
    if (!sc) return "";
    const layers = (sc.layers as unknown[] | undefined) ?? [];
    const scene = { ...sc, layers: layers.slice(0, 3) };
    const head = { format: info.raw.format, fps: info.raw.fps, scenes: [`… ${scenes.length} scenes`] };
    const json = JSON.stringify(scene, null, 2).split("\n").map((l) => "    " + l).join("\n");
    return `${JSON.stringify(head, null, 2).replace(/\n\s*"… \d+ scenes"\n\s*\]/, `\n    // scene ${Math.min(2, scenes.length)} of ${scenes.length}\n${json}${layers.length > 3 ? `\n    // + ${layers.length - 3} more layers` : ""}\n  ]`)}`;
  }, [info]);
  return (
    <figure className="spec-excerpt">
      <figcaption className="spec-excerpt-bar">
        <span className="label">spec.json</span>
        <span className="mono dim small ellipsis">{film.slug}</span>
      </figcaption>
      <pre className="mono" aria-label="Scene Spec excerpt"><code>{text ? highlight(text) : "…"}</code></pre>
    </figure>
  );
};

/** Minimal JSON colouring: keys bone, strings ash, numbers and literals tally-free warm, comments smoke. */
const highlight = (src: string) => {
  const out: React.ReactNode[] = [];
  const re = /(\/\/.*$)|("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|\b(true|false|null)\b/gm;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="j-c">{m[1]}</span>);
    else if (m[2] && m[3]) out.push(<span key={k++} className="j-k">{m[2]}</span>, m[3]);
    else if (m[2]) out.push(<span key={k++} className="j-s">{m[2]}</span>);
    else out.push(<span key={k++} className="j-n">{m[4] ?? m[5]}</span>);
    last = re.lastIndex;
  }
  out.push(src.slice(last));
  return out;
};

// ---------------------------------------------------------------- engine

const FEATURES = [
  { k: "Type", t: "Kinetic typography", d: "Twenty-plus text animations: mask reveals, slot-machine words, per-glyph physics, footage seen through the letters." },
  { k: "Camera", t: "One continuous take", d: "Pushes, pans and zooms on physical springs that carry momentum from one move into the next." },
  { k: "3D", t: "Devices and logos in 3D", d: "Phones, laptops and extruded logos, lit and moved by the same camera as everything else." },
  { k: "Interface", t: "Product demos without screen recording", d: "Cursors that click and drag, sliders, toggles and gliding indicators, all animated from the spec." },
  { k: "Data", t: "Charts, diagrams, code", d: "Charts that build, diagrams that focus, code that types itself, and music visualizers on the beat." },
  { k: "Sound", t: "Original score and sound design", d: "Music composed to the cut, with no licensing to clear. 347 sound effects placed on every hit, plus voiceover and captions." },
  { k: "Cuts", t: "Transitions that keep you in the shot", d: "29 transitions, including content-aware joins — match cuts, zoom-into, slices — for films that never cut away." },
  { k: "Formats", t: "One spec, every platform", d: "Reflows to 16:9, 9:16, 1:1, 4:5 and 21:9, checked against each platform's safe zones." },
  { k: "Taste", t: "A brief it has to obey", d: "Ban glows or bouncy easing, ask for one take, a hero object, a seamless loop or a change on every beat. A linter holds the director to it." },
];

const EngineGrid = () => (
  <ul className="engine">
    {FEATURES.map((f, i) => (
      <li key={f.k} className="engine-cell">
        <div className="row gap"><span className="mono dim">{String(i + 1).padStart(2, "0")}</span><span className="label">{f.k}</span></div>
        <h3 className="engine-title">{f.t}</h3>
        <p className="dim">{f.d}</p>
      </li>
    ))}
  </ul>
);

// ---------------------------------------------------------------- claude

const ClaudeConnect = () => {
  const cmd = `claude mcp add --transport http motion-studio ${MCP_URL}`;
  return (
    <div className="claude">
      <div className="claude-col">
        <div className="label">Claude Code</div>
        <div className="claude-cmd">
          <code className="mono">{cmd}</code>
          <CopyButton text={cmd} />
        </div>
        <div className="label">claude.ai and Claude Desktop</div>
        <p className="dim">Settings → Connectors → Add custom connector, then paste</p>
        <div className="claude-cmd">
          <code className="mono">{MCP_URL}</code>
          <CopyButton text={MCP_URL} />
        </div>
        <p className="site-fine dim">Connecting needs a Motion Studio account. You sign in once and approve access.</p>
      </div>
      <ol className="claude-log mono" aria-label="Example session">
        <li className="claude-log-head label" aria-hidden><span>Example session</span></li>
        <li><span className="dim">you</span><span>Make a 15s reel launching our cold brew. Logo's attached.</span></li>
        <li><span className="dim">tool</span><span>create_project · add_asset · analyze_logo</span></li>
        <li><span className="dim">tool</span><span>set_spec <span className="dim">— 5 scenes · 15.0s · 9:16</span></span></li>
        <li><span className="dim">tool</span><span>preview_frames <span className="dim">— 6 frames</span></span></li>
        <li><span className="dim">claude</span><span>The tagline collides with the can in scene 3. Moving it up.</span></li>
        <li><span className="dim">tool</span><span>update_scene · compose_music · render_video</span></li>
        <li className="claude-done"><IconCheck size={12} /> final · 1080×1920 · 15.0s</li>
      </ol>
    </div>
  );
};

// ---------------------------------------------------------------- waitlist

const Closing = () => (
  <section id="join" className="site-closing" aria-labelledby="join-t">
    <SlateStripe />
    <div className="site-wrap site-closing-in">
      <div>
        <span className="label"><span className="mono">06</span> · Waitlist</span>
        <h2 id="join-t" className="site-display sm">Your next launch film is a paragraph away.</h2>
        <p className="site-sub">We're opening the studio to a small group of makers first. Leave your email and what you'd make.</p>
      </div>
      <WaitlistForm />
    </div>
  </section>
);

const WaitlistForm = ({ compact }: { compact?: boolean }) => {
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
      <div className={`waitlist is-done ${compact ? "compact" : ""}`} role="status">
        <IconCheck size={16} />
        <div><div className="waitlist-ok">You're on the list.</div><div className="dim small">You'll hear from us at {email.trim()} when a seat opens.</div></div>
      </div>
    );
  }
  return (
    <form className={`waitlist ${compact ? "compact" : ""}`} onSubmit={submit} noValidate={false}>
      <div className="waitlist-row">
        <label className="sr-only" htmlFor={compact ? "wl-email-hero" : "wl-email"}>Email</label>
        <input id={compact ? "wl-email-hero" : "wl-email"} className="input lg" type="email" required autoComplete="email" inputMode="email"
          placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        <button className="btn primary lg" type="submit" disabled={state === "busy"}>
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

export default Landing;
