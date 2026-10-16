import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, type ApiToken, type ConnectInfo, type Job, type NewToken, type ProjectCard } from "../api";
import { useAuth } from "../auth";
import { AppBar } from "../components/AppBar";
import { CopyButton, Dialog, SlateStripe, TallyDot } from "../components/ui";
import { IconAlert, IconClose, IconDownload, IconExternal, IconKey, IconLogout, IconPlus, IconTrash, Spinner } from "../components/Icons";
import { useToast } from "../components/Toast";
import { SettingsForm } from "./Settings";
import { useJobs, isActive } from "../lib/jobs";
import { basename, fmtBytes, fmtDate, fmtRelative } from "../lib/format";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "director", label: "Director" },
  { id: "tokens", label: "API tokens" },
  { id: "connect", label: "Connect to Claude" },
  { id: "queue", label: "Render queue" },
] as const;

export const Account = () => {
  const loc = useLocation();
  const [current, setCurrent] = useState<string>("profile");
  const [freshToken, setFreshToken] = useState<NewToken | null>(null);
  useEffect(() => { document.title = "Account — Motion Studio"; }, []);
  // deep link (#connect) + scroll spy
  useEffect(() => {
    const id = loc.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 60);
  }, [loc.hash]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setCurrent(vis.target.id);
    }, { rootMargin: "-20% 0px -60% 0px" });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  return (
    <div className="page account">
      <AppBar crumbs={<span className="crumb">Account</span>} />
      <div className="account-grid">
        <nav className="account-nav" aria-label="Account sections">
          <div className="label">Index</div>
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={current === s.id ? "is-active" : ""} aria-current={current === s.id ? "location" : undefined}>
                  <span className="mono">{String(i + 1).padStart(2, "0")}</span>{s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <main className="account-main">
          <Section n={1} id="profile" title="Profile"><Profile /></Section>
          <Section n={2} id="director" title="Director" sub="The model that writes and revises your Scene Specs. Applies to every project."><div className="panel-box"><SettingsForm /></div></Section>
          <Section n={3} id="tokens" title="API tokens" sub="Personal access tokens for Claude Code, scripts and CI. Each token can do anything you can do in the studio."><Tokens onCreated={setFreshToken} /></Section>
          <Section n={4} id="connect" title="Connect to Claude" sub="Direct videos from claude.ai or Claude Code. Motion Studio is a remote MCP server."><Connect token={freshToken} /></Section>
          <Section n={5} id="queue" title="Render queue" sub="Every render across your projects — started here, by the director, or over MCP."><Queue /></Section>
        </main>
      </div>
    </div>
  );
};

const Section = ({ n, id, title, sub, children }: { n: number; id: string; title: string; sub?: string; children: React.ReactNode }) => (
  <section id={id} className="acct-section" aria-labelledby={`${id}-t`}>
    <header className="acct-head">
      <span className="acct-num mono">{String(n).padStart(2, "0")}</span>
      <div>
        <h2 id={`${id}-t`} className="acct-title">{title}</h2>
        {sub && <p className="acct-sub">{sub}</p>}
      </div>
    </header>
    {children}
  </section>
);

const Profile = () => {
  const { user, me, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="panel-box profile">
      <div className="kv">
        <span className="label">Name</span><span>{user.name}</span>
        <span className="label">Email</span><span className="mono">{user.email}</span>
        <span className="label">User ID</span><span className="mono dim">{user.id}</span>
        <span className="label">Mode</span><span className="mono">{me?.mode === "hosted" ? "HOSTED" : "LOCAL"}<span className="dim"> — {me?.mode === "hosted" ? "accounts required, assets by upload or URL" : "single owner, auto signed-in"}</span></span>
        {me?.publicUrl && <><span className="label">Studio URL</span><span className="mono">{me.publicUrl}</span></>}
      </div>
      {me?.mode === "hosted" && <button className="btn" onClick={() => void logout()}><IconLogout size={14} />Sign out</button>}
    </div>
  );
};

const Tokens = ({ onCreated }: { onCreated: (t: NewToken) => void }) => {
  const toast = useToast();
  const [list, setList] = useState<ApiToken[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<NewToken | null>(null);
  const [revoke, setRevoke] = useState<ApiToken | null>(null);
  const load = useCallback(() => { api.tokens().then((l) => { setList(l); setErr(null); }).catch((e) => { setErr(e.message); setList([]); }); }, []);
  useEffect(load, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const t = await api.createToken(name.trim());
      setFresh(t); onCreated(t); setName("");
      load();
    } catch (e2) { toast.error("Couldn't create token", (e2 as Error).message); } finally { setBusy(false); }
  };
  const doRevoke = async (t: ApiToken) => {
    setRevoke(null);
    const prev = list;
    setList((l) => l?.filter((x) => x.id !== t.id) ?? l);
    try { await api.deleteToken(t.id); toast.success("Token revoked", t.name); if (fresh?.id === t.id) setFresh(null); } catch (e) { setList(prev); toast.error("Couldn't revoke token", (e as Error).message); }
  };

  return (
    <div className="tokens">
      <form className="token-create" onSubmit={create}>
        <label className="field grow">
          <span className="label">New token name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Code — studio laptop" maxLength={60} />
        </label>
        <button className="btn primary" disabled={!name.trim() || busy}>{busy ? <Spinner /> : <IconPlus size={14} />}Create token</button>
      </form>

      {fresh && (
        <div className="token-reveal wipe-in" role="status">
          <SlateStripe tally />
          <div className="token-reveal-body">
            <div className="token-reveal-head">
              <IconKey size={14} /><span className="label">{fresh.name}</span>
              <span className="warn-text">Shown once — copy it now. We only store a hash.</span>
              <span className="spacer" />
              <button className="icon-btn ghost sm" onClick={() => setFresh(null)} aria-label="Hide token"><IconClose size={14} /></button>
            </div>
            <div className="secret">
              <code className="mono">{fresh.token}</code>
              <CopyButton text={fresh.token} />
            </div>
          </div>
        </div>
      )}

      {err && <div className="callout error"><IconAlert size={14} /><span className="mono">{err}</span></div>}
      <table className="table">
        <thead><tr><th>Name</th><th>Prefix</th><th className="num">Created</th><th className="num">Last used</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {!list && <tr><td colSpan={5}><div className="skeleton" style={{ height: 14, width: "40%" }} /></td></tr>}
          {list && list.length === 0 && !err && <tr className="empty-row"><td colSpan={5}><span className="dim">No tokens yet. Create one for Claude Code or a script.</span></td></tr>}
          {list?.map((t) => (
            <tr key={t.id} className={fresh?.id === t.id ? "is-new" : ""}>
              <td>{t.name}</td>
              <td className="mono">{t.prefix}<span className="dim">••••••••</span></td>
              <td className="num mono" title={t.createdAt}>{fmtDate(t.createdAt)}</td>
              <td className="num mono">{t.lastUsedAt ? fmtRelative(t.lastUsedAt) : <span className="dim">never</span>}</td>
              <td className="act"><button className="btn ghost xs danger-hover" onClick={() => setRevoke(t)}><IconTrash size={12} />Revoke</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!revoke} onClose={() => setRevoke(null)} title="Revoke token?" label="Destructive" width={440}
        subtitle={revoke ? <>Anything using <span className="mono">{revoke.prefix}…</span> (“{revoke.name}”) stops working immediately.</> : null}
        footer={<><button className="btn ghost" onClick={() => setRevoke(null)}>Cancel</button><button className="btn danger" data-autofocus onClick={() => revoke && doRevoke(revoke)}><IconTrash size={14} />Revoke</button></>}>
        <></>
      </Dialog>
    </div>
  );
};

const Connect = ({ token }: { token: NewToken | null }) => {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { me } = useAuth();
  useEffect(() => { api.connect().then(setInfo).catch((e) => setErr(e.message)); }, []);
  const fallbackUrl = `${me?.publicUrl ?? location.origin}/mcp`;
  const mcpUrl = info?.mcpUrl ?? fallbackUrl;
  const bearer = token?.token ?? "<YOUR_TOKEN>";
  const cli = `claude mcp add --transport http motion-studio ${mcpUrl} \\\n  --header "Authorization: Bearer ${bearer}"`;
  const steps = info?.steps?.length ? info.steps : [
    "Open claude.ai → Settings → Connectors.",
    "Choose “Add custom connector”.",
    `Paste ${mcpUrl} as the URL and name it Motion Studio.`,
    "Click Connect, then Approve on the Motion Studio consent screen.",
  ];
  return (
    <div className="connect">
      {err && <div className="callout warn"><IconAlert size={14} /><span>Connection details unavailable from the server ({err}). Showing defaults for this address.</span></div>}
      <div className="panel-box mcp-url">
        <span className="label">MCP server URL</span>
        <div className="secret"><code className="mono">{mcpUrl}</code><CopyButton text={mcpUrl} /></div>
        <span className="field-hint">Streamable HTTP · OAuth 2.1 (claude.ai) or a personal access token (Claude Code).</span>
      </div>
      <div className="connect-grid">
        <div className="panel-box">
          <div className="box-head"><span className="label">A</span><h3>claude.ai — custom connector</h3></div>
          <ol className="steps">
            {steps.map((s, i) => <li key={i}><span className="mono step-n">{String(i + 1).padStart(2, "0")}</span><span>{s}</span></li>)}
          </ol>
          <a className="btn sm" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer"><IconExternal size={14} />Open claude.ai connectors</a>
        </div>
        <div className="panel-box">
          <div className="box-head"><span className="label">B</span><h3>Claude Code</h3></div>
          <p className="dim small">{token ? <>Uses the token you just created (<span className="mono">{token.prefix}…</span>).</> : <>Create a token above, then replace <span className="mono">&lt;YOUR_TOKEN&gt;</span>.</>}</p>
          <div className="code-block">
            <pre className="mono">{cli}</pre>
            <CopyButton text={cli.replace(/\\\n\s+/g, "")} />
          </div>
          {info?.claudeCodeConfig && (
            <details className="disclosure">
              <summary><span className="label">.mcp.json snippet</span></summary>
              <div className="code-block">
                <pre className="mono">{token ? info.claudeCodeConfig.replace(/<[A-Z_ ]*TOKEN[A-Z_ ]*>/g, token.token) : info.claudeCodeConfig}</pre>
                <CopyButton text={token ? info.claudeCodeConfig.replace(/<[A-Z_ ]*TOKEN[A-Z_ ]*>/g, token.token) : info.claudeCodeConfig} />
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
};

const STATUS_LABEL: Record<Job["status"], string> = { queued: "QUEUED", running: "RENDERING", done: "DONE", error: "FAILED", canceled: "CANCELED" };

export const JobStatus = ({ j }: { j: Job }) => (
  <span className={`job-status st-${j.status}`}>
    {j.status === "running" ? <TallyDot /> : <i className="st-dot" />}
    <span className="mono">{STATUS_LABEL[j.status]}</span>
  </span>
);

export const JobProgress = ({ j }: { j: Job }) => (
  <span className={`job-progress st-${j.status}`}>
    <span className="meter"><span className="meter-fill" style={{ transform: `scaleX(${j.status === "done" ? 1 : Math.max(0, Math.min(1, j.progress || 0))})` }} /></span>
    <span className="mono num">{j.status === "queued" ? (j.position ? `#${j.position}` : "—") : `${Math.round((j.status === "done" ? 1 : j.progress || 0) * 100)}%`}</span>
  </span>
);

const Queue = () => {
  const toast = useToast();
  const { jobs, error, cancel } = useJobs(undefined, {
    onDone: (j) => toast.success("Render ready", `${j.projectId} · ${j.quality}`),
    onError: (j, m) => toast.error("Render failed", j ? `${j.projectId}: ${m}` : m),
  });
  const [projects, setProjects] = useState<Record<string, ProjectCard>>({});
  useEffect(() => { api.projects().then((ps) => setProjects(Object.fromEntries(ps.map((p) => [p.id, p])))).catch(() => {}); }, []);
  const running = useMemo(() => (jobs ?? []).filter(isActive).length, [jobs]);
  return (
    <div className="queue">
      <div className="queue-strip">
        <span className="label">Active</span><span className="mono">{String(running).padStart(2, "0")}</span>
        <span className="label">Total</span><span className="mono">{String(jobs?.length ?? 0).padStart(2, "0")}</span>
        {running > 0 && <TallyDot label="Rendering" />}
      </div>
      {error && <div className="callout warn"><IconAlert size={14} /><span>{error}</span></div>}
      <table className="table jobs">
        <thead><tr><th>Status</th><th>Project</th><th>Quality</th><th>Backend</th><th>Progress</th><th className="num">Queued</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {!jobs && <tr><td colSpan={7}><div className="skeleton" style={{ height: 14, width: "50%" }} /></td></tr>}
          {jobs && jobs.length === 0 && !error && <tr className="empty-row"><td colSpan={7}><span className="dim">Nothing in the queue. Renders you start in a project appear here with live progress.</span></td></tr>}
          {jobs?.map((j) => (
            <tr key={j.id}>
              <td><JobStatus j={j} /></td>
              <td><Link to={`/p/${encodeURIComponent(j.projectId)}`}>{projects[j.projectId]?.name ?? j.projectId}</Link>{j.stage && isActive(j) && <span className="dim small"> · {j.stage}</span>}{j.error && <div className="err-line mono" title={j.error}>{j.error}</div>}</td>
              <td className="mono">{j.quality.toUpperCase()}</td>
              <td className="mono dim">{j.backend?.toUpperCase()}</td>
              <td><JobProgress j={j} /></td>
              <td className="num mono" title={j.createdAt}>{fmtRelative(j.createdAt)}</td>
              <td className="act">
                {isActive(j) && <button className="btn ghost xs" onClick={() => cancel(j.id).catch((e) => toast.error("Couldn't cancel", (e as Error).message))}><IconClose size={12} />Cancel</button>}
                {j.status === "done" && j.output && <a className="btn ghost xs" href={j.output.url} download={basename(j.output.file)} title={fmtBytes(j.output.sizeBytes)}><IconDownload size={12} />MP4</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
