import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Wordmark } from "../components/AppBar";
import { HeroPlayer } from "../components/HeroPlayer";
import { IconAlert, IconArrowRight, Spinner } from "../components/Icons";
import { fmtDate } from "../lib/format";

/** Only same-origin, path-absolute redirects (no "//host" or scheme). */
export const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");

export const AuthPage = ({ mode }: { mode: "login" | "signup" }) => {
  const { me, user, setUser } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = `${mode === "login" ? "Sign in" : "Create account"} — Motion Studio`; setError(null); }, [mode]);

  if (me && user && me.mode === "hosted") {
    if (/^\/(oauth|mcp|\.well-known)\b/.test(next)) { window.location.assign(next); return null; }
    return <Navigate to={next} replace />;
  }
  const local = me?.mode === "local";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === "signup" && password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setBusy(true);
    try {
      const r = mode === "login" ? await api.login(email.trim(), password) : await api.signup(email.trim(), password, name.trim());
      setUser(r.user);
      // server-handled paths (e.g. /oauth/authorize) need a real navigation, not a client-side route
      if (/^\/(oauth|mcp|\.well-known)\b/.test(next)) window.location.assign(next);
      else nav(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const q = params.toString() ? `?${params.toString()}` : "";
  return (
    <div className="auth">
      <section className="auth-form-col">
        <header className="auth-head">
          <Link to="/" aria-label="Motion Studio"><Wordmark /></Link>
          <span className="label">{local ? "Local studio" : "Hosted studio"}</span>
        </header>

        <div className="auth-body rise-group">
          <div className="auth-index mono rise" style={{ ["--i" as string]: 0 }}>{mode === "login" ? "01" : "00"}<span>/</span>{mode === "login" ? "Sign in" : "New account"}</div>
          <h1 className="auth-title rise" style={{ ["--i" as string]: 1 }}>{mode === "login" ? <>Back to the<br />edit suite.</> : <>Open a<br />new studio.</>}</h1>

          {local ? (
            <div className="auth-local rise" style={{ ["--i" as string]: 2 }}>
              <p className="dim">This studio runs in local mode — you're signed in as the owner automatically. Accounts only exist on hosted studios.</p>
              <Link to={next} className="btn primary lg">Enter studio<IconArrowRight size={16} /></Link>
            </div>
          ) : (
            <form className="auth-form rise" style={{ ["--i" as string]: 2 }} onSubmit={submit} noValidate>
              {mode === "signup" && (
                <label className="swiss-field">
                  <span className="swiss-num mono">A</span>
                  <span className="label">Name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Dana Reyes" maxLength={80} />
                </label>
              )}
              <label className="swiss-field">
                <span className="swiss-num mono">{mode === "signup" ? "B" : "A"}</span>
                <span className="label">Email</span>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@studio.com" required autoFocus />
              </label>
              <label className="swiss-field">
                <span className="swiss-num mono">{mode === "signup" ? "C" : "B"}</span>
                <span className="label">Password{mode === "signup" && <em className="dim"> · 8+ characters</em>}</span>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
              </label>
              {error && <div className="callout error" role="alert"><IconAlert size={14} /><span>{error}</span></div>}
              <button className="btn primary lg auth-submit" type="submit" disabled={busy || !email || !password}>
                {busy ? <Spinner /> : null}{mode === "login" ? "Sign in" : "Create account"}<IconArrowRight size={16} />
              </button>
              <p className="auth-switch dim">
                {mode === "login" ? (me?.signup === false ? <>Accounts on this studio are created by its admin.</> : <>No account yet? <Link to={`/signup${q}`}>Create one</Link></>) : <>Already have an account? <Link to={`/login${q}`}>Sign in</Link></>}
              </p>
            </form>
          )}
        </div>

        <footer className="auth-foot mono">
          <span>MOTION STUDIO</span><span>REMOTION ENGINE 4.0</span><span>{fmtDate(new Date().toISOString())}</span>
        </footer>
      </section>
      <section className="auth-media" aria-hidden={false}>
        <div className="auth-media-inner wipe-in">
          <HeroPlayer format="4:5" />
        </div>
        <p className="auth-caption"><span className="label">Fig. 1</span> This reel is a Scene Spec, rendered live in your browser by the same engine that cuts your films.</p>
      </section>
    </div>
  );
};
