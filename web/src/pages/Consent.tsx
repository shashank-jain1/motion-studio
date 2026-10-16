import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Wordmark } from "../components/AppBar";
import { IconAlert, IconCheck, IconClose, Spinner } from "../components/Icons";
import { SlateStripe } from "../components/ui";

const SCOPES: Record<string, { title: string; lines: string[] }> = {
  studio: {
    title: "Create projects, write specs, preview and render videos in your studio",
    lines: [
      "List and open your projects",
      "Create projects and write Scene Specs",
      "Add assets from https URLs",
      "Preview frames and queue renders",
    ],
  },
};

/** OAuth consent: "<client> wants to direct videos in your Motion Studio". */
export const Consent = () => {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user, me, logout } = useAuth();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = useMemo(() => Object.fromEntries(params.entries()), [params]);
  const clientName = params.get("client_name") || params.get("client_id") || "An application";
  const redirect = params.get("redirect_uri");
  const host = useMemo(() => { try { return redirect ? new URL(redirect).hostname : null; } catch { return null; } }, [redirect]);
  const scopes = (params.get("scope") || "studio").split(/\s+/).filter(Boolean);
  useEffect(() => { document.title = `Authorize ${clientName} — Motion Studio`; }, [clientName]);

  const decide = async (approve: boolean) => {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    try {
      const r = await api.oauthDecision(all, approve);
      window.location.assign(r.redirect);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { nav(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); return; }
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const missing = !params.get("client_id") || !redirect;
  return (
    <div className="consent">
      <header className="consent-top"><Wordmark /><span className="label">Authorization request</span></header>
      <main className="consent-card wipe-in" aria-labelledby="consent-title">
        <SlateStripe tally />
        <div className="consent-body">
          <div className="consent-rows mono">
            <span>CLIENT</span><span>{params.get("client_id") ?? "—"}</span>
            <span>SCOPE</span><span>{scopes.join(" ")}</span>
          </div>
          <h1 id="consent-title" className="consent-title"><em>{clientName}</em> wants to direct videos in your Motion Studio.</h1>
          {host && (
            <div className="consent-return">
              <span className="label">Will return you to</span>
              <span className="consent-host mono">{host}</span>
              <span className="dim small">The app name above is self-declared — check this address is the one you expect.</span>
            </div>
          )}
          {missing ? (
            <div className="callout error"><IconAlert size={14} /><span>This authorization link is incomplete (missing client or redirect URI). Start the connection again from the app.</span></div>
          ) : (
            <>
              <div className="consent-scope">
                {scopes.map((s) => {
                  const d = SCOPES[s] ?? { title: s, lines: [] };
                  return (
                    <div key={s} className="scope">
                      <div className="scope-head"><span className="label">Scope</span><code className="mono">{s}</code><span className="dim">{d.title}</span></div>
                      <ul>{d.lines.map((l) => <li key={l}><IconCheck size={14} />{l}</li>)}</ul>
                    </div>
                  );
                })}
                <p className="dim small">It can't see your password, your API key or other users' projects. Revoke access any time from Account.</p>
              </div>
              <div className="consent-account">
                <span className="label">Signed in as</span>
                <span>{user?.name}</span>
                <span className="mono dim">{user?.email}</span>
                <span className="spacer" />
                {me?.mode === "hosted" && <button className="btn ghost sm" onClick={() => void logout()}>Not you?</button>}
              </div>
              {error && <div className="callout error" role="alert"><IconAlert size={14} /><span>{error}</span></div>}
              <div className="consent-actions">
                <button className="btn lg" onClick={() => decide(false)} disabled={!!busy}>{busy === "deny" ? <Spinner /> : <IconClose size={14} />}Deny</button>
                <button className="btn primary lg" onClick={() => decide(true)} disabled={!!busy} data-autofocus>{busy === "approve" ? <Spinner /> : <IconCheck size={14} />}Approve</button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
