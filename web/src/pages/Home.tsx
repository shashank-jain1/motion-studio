import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Format, type ProjectCard } from "../api";
import { Dialog, FormatBadge, Skeleton } from "../components/ui";
import { IconGear, IconPlus, IconTrash, IconSparkle, Logo, Spinner } from "../components/Icons";
import { useToast } from "../components/Toast";
import { ASPECT, fmtDuration, fmtRelative, gradientFor } from "../lib/format";
import { SettingsDialog } from "./Settings";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "9:16", label: "Vertical", hint: "Reels · TikTok · Shorts" },
  { id: "16:9", label: "Landscape", hint: "YouTube · web · decks" },
  { id: "1:1", label: "Square", hint: "Feed posts" },
  { id: "4:5", label: "Portrait", hint: "Instagram feed" },
];

export const Home = () => {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ProjectCard | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.projects().then(setProjects).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); document.title = "Motion Studio"; }, [load]);

  const remove = async (p: ProjectCard) => {
    setToDelete(null);
    const prev = projects;
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null); // optimistic
    try { await api.deleteProject(p.id); toast.success(`Deleted “${p.name}”`); } catch (e) {
      setProjects(prev);
      toast.error("Couldn't delete project", (e as Error).message);
    }
  };

  return (
    <div className="home">
      <div className="home-glow" aria-hidden />
      <header className="topbar home-top">
        <Link to="/" className="brand"><Logo /><span>Motion Studio</span></Link>
        <div className="topbar-right">
          <button className="icon-btn ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"><IconGear /></button>
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <div>
            <h1 className="display">Projects</h1>
            <p className="lede">Brief the director, watch it cut. Every project is a living scene spec you can scrub, tweak and render.</p>
          </div>
          <button className="btn primary lg" onClick={() => setNewOpen(true)}><IconPlus />New project</button>
        </section>

        {error && (
          <div className="callout error row">
            <span>{error}</span>
            <button className="btn sm" onClick={load}>Retry</button>
          </div>
        )}

        {!projects && !error && (
          <div className="gallery">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="card skeleton-card" key={i} style={{ animationDelay: `${i * 60}ms` }}>
                <Skeleton className="card-thumb" />
                <div className="card-meta"><Skeleton w="60%" h={14} /><Skeleton w="40%" h={11} /></div>
              </div>
            ))}
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="home-empty">
            <div className="empty-orbit" aria-hidden><span /><span /><span /></div>
            <h2>Your first cut starts here</h2>
            <p className="muted">Create a project, drop in a logo or a track, and tell the director what you want to feel.</p>
            <button className="btn primary" onClick={() => setNewOpen(true)}><IconSparkle />Start a project</button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="gallery">
            <button className="card card-new" onClick={() => setNewOpen(true)}>
              <span className="card-new-plus"><IconPlus size={20} /></span>
              <span>New project</span>
            </button>
            {projects.map((p, i) => (
              <ProjectTile key={p.id} p={p} i={i} onDelete={() => setToDelete(p)} />
            ))}
          </div>
        )}
      </main>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Dialog open={!!toDelete} onClose={() => setToDelete(null)} title="Delete project?" width={420}
        subtitle={toDelete ? <>“{toDelete.name}” and all its assets and renders will be removed. This can't be undone.</> : null}
        footer={<>
          <button className="btn ghost" onClick={() => setToDelete(null)}>Cancel</button>
          <button className="btn danger" data-autofocus onClick={() => toDelete && remove(toDelete)}>Delete</button>
        </>}>
        <></>
      </Dialog>
    </div>
  );
};

const ProjectTile = ({ p, i, onDelete }: { p: ProjectCard; i: number; onDelete: () => void }) => {
  const [imgOk, setImgOk] = useState(!!p.thumbnail);
  const ar = ASPECT[p.format] ?? 16 / 9;
  return (
    <div className="card project-card" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
      <Link to={`/p/${encodeURIComponent(p.id)}`} className="card-link" aria-label={`Open ${p.name}`}>
        <div className="card-thumb" style={{ background: gradientFor(p.id) }}>
          {p.thumbnail && imgOk ? (
            <>
              <img className="thumb-blur" src={p.thumbnail} alt="" aria-hidden />
              <img className="thumb-img" src={p.thumbnail} alt="" loading="lazy" onError={() => setImgOk(false)} />
            </>
          ) : (
            <div className="thumb-frame" style={{ aspectRatio: String(ar) }}><span>{p.name.slice(0, 1).toUpperCase()}</span></div>
          )}
          {p.durationSeconds != null && <span className="thumb-chip">{fmtDuration(p.durationSeconds)}</span>}
          {!p.hasSpec && <span className="thumb-chip left">Draft brief</span>}
        </div>
        <div className="card-meta">
          <div className="card-title">{p.name}</div>
          <div className="card-sub"><FormatBadge format={p.format} /><span className="dot" />{fmtRelative(p.updatedAt)}</div>
        </div>
      </Link>
      <button className="icon-btn sm card-del" onClick={onDelete} aria-label={`Delete ${p.name}`} title="Delete"><IconTrash size={14} /></button>
    </div>
  );
};

export const NewProjectDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<Format>("9:16");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setBusy(false); } }, [open]);
  const create = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = await api.createProject(name.trim(), format);
      nav(`/p/${encodeURIComponent(p.id)}`);
    } catch (err) {
      toast.error("Couldn't create project", (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="New project" subtitle="Pick a canvas. The director can always change it later." width={540}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => create()} disabled={!name.trim() || busy}>{busy && <Spinner />}Create project</button>
      </>}>
      <form className="form" onSubmit={create}>
        <label className="field">
          <span className="field-label">Name</span>
          <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring drop teaser" maxLength={80} />
        </label>
        <div className="field">
          <span className="field-label">Format</span>
          <div className="format-grid" role="radiogroup" aria-label="Format">
            {FORMATS.map((f) => {
              const [w, h] = f.id.split(":").map(Number);
              const s = 56 / Math.max(w, h);
              return (
                <button type="button" key={f.id} role="radio" aria-checked={format === f.id}
                  className={`format-tile ${format === f.id ? "is-active" : ""}`} onClick={() => setFormat(f.id)}>
                  <span className="format-stage"><span className="format-rect" style={{ width: w * s, height: h * s }} /></span>
                  <span className="format-name">{f.id} <em>{f.label}</em></span>
                  <span className="format-hint">{f.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
};
