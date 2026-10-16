import { useEffect, useRef, useState } from "react";
import { api, postSSE, renderUrl, type RenderInfo } from "../api";
import { useStudio } from "./context";
import { useToast } from "../components/Toast";
import { Lightbox } from "../components/ui";
import { IconDownload, IconFilm, IconGrid, IconSparkle, Spinner } from "../components/Icons";
import { basename, fmtBytes, fmtDuration, fmtRelative } from "../lib/format";

type Job = { quality: "draft" | "final"; progress: number; startedAt: number; stage?: string } | null;

export const RendersPanel = () => {
  const { id, renders, addRender, info, dirty } = useStudio();
  const toast = useToast();
  const [job, setJob] = useState<Job>(null);
  const [sheet, setSheet] = useState<{ sheetUrl: string | null; frames: { time: number; url: string; label: string }[] } | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [lb, setLb] = useState<number | null>(null);
  const ctlRef = useRef<AbortController | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [job]);

  const render = async (quality: "draft" | "final") => {
    if (job) return;
    if (dirty) toast.info("Rendering the saved spec", "Your unsaved editor changes aren't included — press ⌘S first.");
    setJob({ quality, progress: 0, startedAt: Date.now() });
    const ctl = new AbortController();
    ctlRef.current = ctl;
    let finished = false;
    try {
      await postSSE(renderUrl(id), { quality }, (event, data) => {
        if (event === "progress") setJob((j) => (j ? { ...j, progress: Math.max(j.progress, Number(data?.progress) || 0), stage: typeof data?.stage === "string" ? data.stage : j.stage } : j));
        else if (event === "done" && data?.render) { finished = true; addRender(data.render as RenderInfo); toast.success(`${quality === "final" ? "Final" : "Draft"} render ready`, basename(data.render.file)); }
        else if (event === "error") { finished = true; toast.error("Render failed", String(data?.message ?? "unknown error")); }
      }, ctl.signal);
      if (!finished && !ctl.signal.aborted) toast.error("Render stream ended unexpectedly");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("Render failed", (e as Error).message);
      else toast.info("Render cancelled");
    } finally {
      setJob(null);
      ctlRef.current = null;
    }
  };

  const contactSheet = async () => {
    setSheetBusy(true);
    try {
      const r = await api.preview(id, {});
      setSheet(r);
    } catch (e) { toast.error("Preview failed", (e as Error).message); } finally { setSheetBusy(false); }
  };

  const elapsed = job ? (Date.now() - job.startedAt) / 1000 : 0;
  const eta = job && job.progress > 0.04 ? elapsed / job.progress - elapsed : null;
  const lbImages = sheet ? [...(sheet.sheetUrl ? [{ url: sheet.sheetUrl, label: "Contact sheet" }] : []), ...sheet.frames.map((f) => ({ url: f.url, label: f.label || `${f.time}s` }))] : [];

  return (
    <div className="renders-panel">
      <div className="render-actions">
        <button className="render-btn" onClick={() => render("draft")} disabled={!!job || !info}>
          <span className="render-btn-icon"><IconFilm size={15} /></span>
          <span><strong>Render draft</strong><em>540p · fast check</em></span>
        </button>
        <button className="render-btn final" onClick={() => render("final")} disabled={!!job || !info}>
          <span className="render-btn-icon"><IconSparkle size={15} /></span>
          <span><strong>Render final</strong><em>1080p · delivery</em></span>
        </button>
      </div>

      {job && (
        <div className="progress-card">
          <div className="progress-head">
            <Spinner size={13} />
            <span>{job.stage === "queued" ? "Queued — waiting for the current render…" : <>Rendering {job.quality}{job.stage && job.stage !== "starting" ? <span className="muted"> · {job.stage}</span> : "…"}</>}</span>
            <span className="spacer" />
            <span className="mono">{Math.round(job.progress * 100)}%</span>
            <button className="btn xs ghost" onClick={() => ctlRef.current?.abort()} title="Cancel render">Cancel</button>
          </div>
          <div className="progress"><div className="progress-fill" style={{ transform: `scaleX(${job.progress})` }} /></div>
          <div className="progress-foot muted small">
            <span>{elapsed.toFixed(0)}s elapsed</span>
            {eta != null && <span>~{Math.max(1, Math.round(eta))}s left</span>}
          </div>
        </div>
      )}

      <div className="section-row">
        <div className="section-label">Preview frames</div>
        <button className="btn sm" onClick={contactSheet} disabled={sheetBusy || !info}>{sheetBusy ? <Spinner size={12} /> : <IconGrid size={13} />}Contact sheet</button>
      </div>
      {sheetBusy && !sheet && <div className="sheet-skeleton skeleton" />}
      {sheet?.sheetUrl && (
        <button className={`sheet ${sheetBusy ? "is-busy" : ""}`} onClick={() => setLb(0)} aria-label="Open contact sheet">
          <img src={sheet.sheetUrl} alt="Contact sheet" />
        </button>
      )}
      {sheet && !sheet.sheetUrl && (
        <div className="frame-strip">
          {sheet.frames.map((f, i) => <button key={f.url} onClick={() => setLb(i)}><img src={f.url} alt="" /><span>{f.label || `${f.time}s`}</span></button>)}
        </div>
      )}

      <div className="section-row">
        <div className="section-label">Renders</div>
        <span className="muted small">{renders.length || ""}</span>
      </div>
      {renders.length === 0 && !job && (
        <div className="panel-empty">
          <div className="panel-empty-art"><IconFilm size={18} /></div>
          <strong>Nothing rendered yet</strong>
          <span>Draft renders are quick to share for feedback; final is full quality.</span>
        </div>
      )}
      <div className="render-list">
        {renders.map((r) => <RenderItem key={r.file} r={r} />)}
      </div>
      {lb != null && <Lightbox images={lbImages} index={lb} onClose={() => setLb(null)} onIndex={setLb} />}
    </div>
  );
};

const RenderItem = ({ r }: { r: RenderInfo }) => (
  <div className="render-item">
    <video src={r.url} controls preload="metadata" playsInline />
    <div className="render-meta">
      <span className={`tag ${r.quality === "final" ? "accent" : ""}`}>{r.quality}</span>
      <span className="render-name" title={r.file}>{fmtRelative(r.createdAt)}</span>
      <span className="muted small">{[r.seconds != null ? fmtDuration(r.seconds) : null, r.width && r.height ? `${r.width}×${r.height}` : null, fmtBytes(r.sizeBytes)].filter(Boolean).join(" · ")}</span>
      <span className="spacer" />
      <a className="icon-btn xs" href={r.url} download={basename(r.file)} title="Download" aria-label="Download"><IconDownload size={13} /></a>
    </div>
  </div>
);
