import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Format, type ProjectCard } from "../api";
import { AppBar } from "../components/AppBar";
import { HeroPlayer } from "../components/HeroPlayer";
import { SpecThumb } from "../components/SpecThumb";
import { CropMarks, Dialog, Odometer, Segmented, SlateStripe } from "../components/ui";
import { IconArrowRight, IconPlus, IconTrash, Spinner } from "../components/Icons";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth";
import { ASPECT, fmtDate, fmtDuration, fmtRelative, fmtTC, RES } from "../lib/format";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "9:16", label: "Vertical", hint: "Reels · TikTok · Shorts" },
  { id: "16:9", label: "Landscape", hint: "YouTube · web · decks" },
  { id: "1:1", label: "Square", hint: "Feed posts" },
  { id: "4:5", label: "Portrait", hint: "Instagram feed" },
];

type Filter = "all" | Format;

export const Home = () => {
  const toast = useToast();
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ProjectCard | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    setError(null);
    api.projects().then(setProjects).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); document.title = "Projects — Motion Studio"; }, [load]);

  const remove = async (p: ProjectCard) => {
    setToDelete(null);
    const prev = projects;
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
    try { await api.deleteProject(p.id); toast.success(`Deleted “${p.name}”`); } catch (e) {
      setProjects(prev);
      toast.error("Couldn't delete project", (e as Error).message);
    }
  };

  const shown = useMemo(() => (projects ?? []).filter((p) => filter === "all" || p.format === filter), [projects, filter]);
  const runtime = (projects ?? []).reduce((s, p) => s + (p.durationSeconds ?? 0), 0);
  const cut = (projects ?? []).filter((p) => p.hasSpec).length;
  const formats = Array.from(new Set((projects ?? []).map((p) => p.format)));

  return (
    <div className="page home">
      <AppBar />
      <main className="home-main">
        <section className="hero">
          <div className="hero-copy rise-group">
            <div className="label rise" style={{ ["--i" as string]: 0 }}>Reel 00 — {user?.name ? `${user.name.split(" ")[0]}'s studio` : "Studio"}</div>
            <h1 className="hero-title rise" style={{ ["--i" as string]: 1 }}>You direct.<br />The engine cuts.</h1>
            <p className="hero-lede rise" style={{ ["--i" as string]: 2 }}>
              Brief the director in plain words. It writes a Scene Spec, previews its own frames, and fixes what looks off —
              played here frame-accurate, rendered to MP4 when you call it.
            </p>
            <div className="hero-actions rise" style={{ ["--i" as string]: 3 }}>
              <button className="btn primary lg" onClick={() => setNewOpen(true)}><IconPlus size={16} />New project</button>
              <Link to="/account#connect" className="btn ghost lg">Connect to Claude<IconArrowRight size={16} /></Link>
            </div>
            <div className="hero-stats rise" style={{ ["--i" as string]: 4 }}>
              <div className="stat"><span className="label">Projects</span><Odometer value={String(projects?.length ?? 0).padStart(2, "0")} className="stat-value" /></div>
              <div className="stat"><span className="label">Cut</span><Odometer value={String(cut).padStart(2, "0")} className="stat-value" /></div>
              <div className="stat"><span className="label">Total runtime</span><Odometer value={fmtTC(runtime, 30)} className="stat-value" /></div>
            </div>
          </div>
          <div className="hero-media wipe-in">
            <HeroPlayer format="16:9" />
          </div>
        </section>

        <section className="wall" aria-labelledby="wall-title">
          <div className="section-head">
            <h2 id="wall-title" className="label">Reel wall</h2>
            <span className="mono dim">{projects ? String(shown.length).padStart(2, "0") : "--"}</span>
            <span className="spacer" />
            {formats.length > 1 && (
              <Segmented size="sm" label="Filter by format" value={filter} onChange={setFilter}
                options={[{ value: "all", label: "All" }, ...formats.map((f) => ({ value: f, label: f }))] as { value: Filter; label: string }[]} />
            )}
          </div>

          {error && (
            <div className="callout error">
              <span className="mono">{error}</span>
              <button className="btn sm" onClick={load}>Retry</button>
            </div>
          )}

          {!projects && !error && (
            <div className="wall-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="reel is-loading" key={i}><div className="reel-media"><div className="thumb-loading" /></div><div className="reel-meta"><div className="skeleton" style={{ width: "60%", height: 18 }} /><div className="skeleton" style={{ width: "40%", height: 10 }} /></div></div>
              ))}
            </div>
          )}

          {projects && projects.length === 0 && (
            <div className="wall-empty">
              <SlateStripe />
              <div className="wall-empty-body">
                <div className="label">Roll 01 · Scene 01 · Take 01</div>
                <p className="serif-line">Nothing on the reel yet.</p>
                <p className="dim">Create a project, drop in a logo or a track, and brief the director on what the audience should feel.</p>
                <button className="btn primary" onClick={() => setNewOpen(true)}><IconPlus size={16} />New project</button>
              </div>
            </div>
          )}

          {projects && projects.length > 0 && (
            <div className="wall-grid">
              <button className="reel reel-new" onClick={() => setNewOpen(true)}>
                <span className="reel-media"><span className="reel-new-plus"><IconPlus size={20} /></span><span className="label">New project</span></span>
                <span className="reel-meta"><span className="reel-new-hint dim">Pick a canvas · brief the director</span></span>
              </button>
              {shown.map((p, i) => <Reel key={p.id} p={p} index={i + 1} onDelete={() => setToDelete(p)} />)}
            </div>
          )}
        </section>
      </main>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <Dialog open={!!toDelete} onClose={() => setToDelete(null)} title="Delete project?" width={440} label="Destructive"
        subtitle={toDelete ? <>“{toDelete.name}”, its assets and its renders will be removed. This can't be undone.</> : null}
        footer={<>
          <button className="btn ghost" onClick={() => setToDelete(null)}>Cancel</button>
          <button className="btn danger" data-autofocus onClick={() => toDelete && remove(toDelete)}><IconTrash size={14} />Delete</button>
        </>}>
        <></>
      </Dialog>
    </div>
  );
};

const Reel = ({ p, index, onDelete }: { p: ProjectCard; index: number; onDelete: () => void }) => {
  const ar = ASPECT[p.format] ?? 16 / 9;
  const tall = ar < 1;
  const [scenes, setScenes] = useState<number | null>(null);
  return (
    <article className="reel rise" style={{ ["--i" as string]: Math.min(index, 10) }}>
      <Link to={`/p/${encodeURIComponent(p.id)}`} className="reel-link" aria-label={`Open ${p.name}`}>
        <div className={`reel-media ${tall ? "is-tall" : ""}`}>
          <span className="reel-index mono">{String(index).padStart(2, "0")}</span>
          <span className="reel-format mono">{p.format}</span>
          <div className={`reel-film ${tall ? "perf-sides" : ""}`} style={{ aspectRatio: String(ar) }}>
            <CropMarks inset={-6} />
            {p.hasSpec ? (
              <SpecThumb projectId={p.id} scrub onInfo={(i) => setScenes(i?.spec.scenes.length ?? null)}
                empty={<div className="reel-nocut"><SlateStripe /><span className="label">Spec error</span></div>} />
            ) : (
              <div className="reel-nocut"><SlateStripe /><span className="label">No cut yet</span></div>
            )}
          </div>
          {p.durationSeconds != null && <span className="reel-tc mono">{fmtTC(p.durationSeconds)}</span>}
        </div>
        <div className="reel-meta">
          <h3 className="reel-title">{p.name}</h3>
          <div className="reel-sub mono">
            <span>{RES[p.format]?.join("×")}</span>
            {scenes != null && <span>{scenes} SC</span>}
            {p.durationSeconds != null && <span>{fmtDuration(p.durationSeconds)}</span>}
            <span className="spacer" />
            <span title={fmtDate(p.updatedAt)}>{fmtRelative(p.updatedAt)}</span>
          </div>
        </div>
      </Link>
      <button className="icon-btn sm reel-del" onClick={onDelete} aria-label={`Delete ${p.name}`} title="Delete project"><IconTrash size={14} /></button>
    </article>
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
    <Dialog open={open} onClose={onClose} title="New project" label="Slate" subtitle="Name the film and pick a canvas. The director can change the format later." width={580}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => create()} disabled={!name.trim() || busy}>{busy ? <Spinner /> : <IconPlus size={14} />}Create project</button>
      </>}>
      <form className="form" onSubmit={create}>
        <label className="field">
          <span className="label">Title</span>
          <input className="input lg" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring drop teaser" maxLength={80} />
        </label>
        <div className="field">
          <span className="label">Canvas</span>
          <div className="format-grid" role="radiogroup" aria-label="Format">
            {FORMATS.map((f) => {
              const [w, h] = f.id.split(":").map(Number);
              const s = 52 / Math.max(w, h);
              return (
                <button type="button" key={f.id} role="radio" aria-checked={format === f.id}
                  className={`format-tile ${format === f.id ? "is-active" : ""}`} onClick={() => setFormat(f.id)}>
                  <span className="format-stage"><span className="format-rect" style={{ width: w * s, height: h * s }} /></span>
                  <span className="format-name mono">{f.id}</span>
                  <span className="format-res mono">{RES[f.id].join("×")}</span>
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
