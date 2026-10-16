import { useEffect, useState } from "react";
import { api, type Job, type RenderInfo } from "../api";
import { useStudio } from "./context";
import { useToast } from "../components/Toast";
import { Lightbox, TallyDot } from "../components/ui";
import { IconClose, IconDownload, IconGrid, IconRecord, Spinner } from "../components/Icons";
import { basename, fmtBytes, fmtClock, fmtDuration, fmtRelative } from "../lib/format";
import { isActive, useJobs } from "../lib/jobs";
import { adaptTargets, type Format } from "../../../src/engine/spec/reflow";

export const RendersPanel = () => {
  const { id, renders, addRender, info, dirty, project } = useStudio();
  const toast = useToast();
  const { jobs, error: queueError, start, startAll, cancel } = useJobs(id, {
    onDone: (j, out) => { addRender(out); toast.success(`${j.quality === "final" ? "Final" : "Draft"} render ready${j.format ?? out.format ? ` · ${j.format ?? out.format}` : ""}`, basename(out.file)); },
    onError: (_j, m) => toast.error("Render failed", m),
  });
  const [starting, setStarting] = useState<"draft" | "final" | "all" | null>(null);
  const [allQuality, setAllQuality] = useState<"draft" | "final">("final");
  const master = (info?.spec.format ?? project.format) as Format;
  const targets = info ? adaptTargets({ ...info.spec, format: master }) : [master];
  const [sheet, setSheet] = useState<{ sheetUrl: string | null; frames: { time: number; url: string; label: string }[] } | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [lb, setLb] = useState<number | null>(null);
  const [, tick] = useState(0);
  const live = (jobs ?? []).filter(isActive);
  const recent = (jobs ?? []).filter((j) => j.status === "error" || j.status === "canceled").slice(0, 2);
  useEffect(() => {
    if (!live.length) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live.length]);

  const render = async (quality: "draft" | "final") => {
    if (starting) return;
    if (dirty) toast.info("Rendering the saved spec", "Unsaved editor changes aren't included — press ⌘S first.");
    setStarting(quality);
    try { await start(id, quality); } catch (e) { toast.error("Couldn't queue render", (e as Error).message); } finally { setStarting(null); }
  };

  const exportAll = async () => {
    if (starting) return;
    if (dirty) toast.info("Rendering the saved spec", "Unsaved editor changes aren't included — press ⌘S first.");
    setStarting("all");
    try {
      const js = await startAll(id, allQuality);
      toast.info(`Queued ${js.length} ${allQuality} render${js.length === 1 ? "" : "s"}`, targets.join(" · "));
    } catch (e) { toast.error("Couldn't queue renders", (e as Error).message); } finally { setStarting(null); }
  };

  const contactSheet = async () => {
    setSheetBusy(true);
    try { setSheet(await api.preview(id, {})); } catch (e) { toast.error("Preview failed", (e as Error).message); } finally { setSheetBusy(false); }
  };

  const lbImages = sheet ? [...(sheet.sheetUrl ? [{ url: sheet.sheetUrl, label: "Contact sheet" }] : []), ...sheet.frames.map((f) => ({ url: f.url, label: f.label || `${f.time}s` }))] : [];

  return (
    <div className="renders-panel">
      <div className="render-actions">
        <button className="rec-btn" onClick={() => render("draft")} disabled={!!starting || !info}>
          <span className="rec-dot"><IconRecord size={12} /></span>
          <span className="rec-text"><strong>Draft</strong><span className="mono">540P · FAST CHECK</span></span>
          {starting === "draft" && <Spinner size={12} />}
        </button>
        <button className="rec-btn final" onClick={() => render("final")} disabled={!!starting || !info}>
          <span className="rec-dot"><IconRecord size={12} /></span>
          <span className="rec-text"><strong>Final</strong><span className="mono">1080P · DELIVERY</span></span>
          {starting === "final" && <Spinner size={12} />}
        </button>
      </div>

      <div className="export-all">
        <div className="export-all-head">
          <span className="label">Every platform</span>
          <span className="spacer" />
          <div className="segmented sm" role="radiogroup" aria-label="Export quality">
            {(["draft", "final"] as const).map((q) => (
              <button key={q} type="button" role="radio" aria-checked={allQuality === q} className={allQuality === q ? "is-active" : ""} onClick={() => setAllQuality(q)}>{q === "draft" ? "Draft" : "Final"}</button>
            ))}
          </div>
        </div>
        <div className="export-all-formats mono" aria-label="Formats in this export">
          {targets.map((f) => <span key={f} className={`fmt-chip ${f === master ? "is-master" : ""}`} title={f === master ? "master (authored)" : "reflowed"}>{f}{f === master ? <i>M</i> : null}</span>)}
          {targets.length === 1 && <span className="dim small">Add formats from the Viewer's format switcher</span>}
        </div>
        <button className="btn sm export-all-btn" onClick={exportAll} disabled={!!starting || !info}>
          {starting === "all" ? <Spinner size={12} /> : <IconRecord size={12} />}Export all formats<span className="mono dim">{String(targets.length).padStart(2, "0")}</span>
        </button>
      </div>

      {queueError && <div className="callout warn small">{queueError}</div>}
      {live.map((j) => <JobCard key={j.id} j={j} onCancel={() => cancel(j.id).then(() => toast.info("Render canceled")).catch((e) => toast.error("Couldn't cancel", (e as Error).message))} />)}
      {recent.map((j) => (
        <div key={j.id} className={`job-line st-${j.status}`}>
          <span className="mono">{j.status === "error" ? "FAILED" : "CANCELED"}</span>
          <span className="mono dim">{j.quality.toUpperCase()}{j.format ? ` · ${j.format}` : ""}</span>
          <span className="ellipsis dim" title={j.error}>{j.error ?? fmtRelative(j.finishedAt ?? j.createdAt)}</span>
        </div>
      ))}

      <div className="section-row">
        <span className="label">Preview frames</span>
        <span className="spacer" />
        <button className="btn xs" onClick={contactSheet} disabled={sheetBusy || !info}>{sheetBusy ? <Spinner size={12} /> : <IconGrid size={14} />}Contact sheet</button>
      </div>
      {sheetBusy && !sheet && <div className="contact perf is-loading"><div className="thumb-loading" /></div>}
      {sheet && sheet.frames.length > 0 && (
        <div className="contact perf">
          {sheet.frames.map((f, i) => (
            <button key={f.url} className="strip-frame" onClick={() => setLb(i + (sheet.sheetUrl ? 1 : 0))}>
              <img src={f.url} alt="" /><span>{f.label || `${f.time}s`}</span>
            </button>
          ))}
        </div>
      )}
      {sheet?.sheetUrl && <button className="btn ghost xs" onClick={() => setLb(0)}>Open full sheet</button>}

      <div className="section-row">
        <span className="label">Renders</span>
        <span className="mono dim">{String(renders.length).padStart(2, "0")}</span>
      </div>
      {renders.length === 0 && !live.length && (
        <div className="panel-empty">
          <span className="label">No takes printed</span>
          <span className="dim">Draft renders are quick to share for feedback; final is full quality for delivery.</span>
        </div>
      )}
      <div className="render-list">
        {renders.map((r, i) => <RenderItem key={r.file} r={r} n={renders.length - i} />)}
      </div>
      {lb != null && <Lightbox images={lbImages} index={lb} onClose={() => setLb(null)} onIndex={setLb} />}
    </div>
  );
};

const JobCard = ({ j, onCancel }: { j: Job; onCancel: () => void }) => {
  const started = j.startedAt ? new Date(j.startedAt).getTime() : null;
  const elapsed = started ? Date.now() - started : 0;
  const eta = started && j.progress > 0.04 ? elapsed / j.progress - elapsed : null;
  const queued = j.status === "queued";
  return (
    <div className={`job-card ${queued ? "is-queued" : "is-running"}`} role="status">
      <div className="job-head">
        {queued ? <i className="st-dot" /> : <TallyDot />}
        <span className="mono">{queued ? "QUEUED" : "RENDERING"} · {j.quality.toUpperCase()}</span>
        {j.format && <span className="fmt-chip mono">{j.format}</span>}
        {queued && j.position != null && <span className="mono dim">POS {String(j.position).padStart(2, "0")}</span>}
        <span className="spacer" />
        <span className="mono job-pct">{queued ? "--" : `${Math.round(j.progress * 100)}`}<span className="dim">%</span></span>
        <button className="icon-btn ghost xs" onClick={onCancel} aria-label="Cancel render" title="Cancel render"><IconClose size={12} /></button>
      </div>
      <div className="meter lg"><span className="meter-fill" style={{ transform: `scaleX(${queued ? 0 : j.progress})` }} /></div>
      <div className="job-foot mono dim">
        <span>{queued ? "Waiting for the current render" : (j.stage ?? "starting").toUpperCase()}</span>
        <span className="spacer" />
        {started && <span>{fmtClock(elapsed)}</span>}
        {eta != null && <span>−{fmtClock(eta)}</span>}
        <span>{j.backend?.toUpperCase()}</span>
      </div>
    </div>
  );
};

const RenderItem = ({ r, n }: { r: RenderInfo; n: number }) => (
  <div className="render-item">
    <video src={r.url} controls preload="metadata" playsInline />
    <div className="render-meta">
      <span className="mono take">TK{String(n).padStart(2, "0")}</span>
      <span className={`tag ${r.quality === "final" ? "tally" : ""}`}>{r.quality}</span>
      {r.format && <span className="fmt-chip mono">{r.format}</span>}
      <span className="mono dim small ellipsis grow">{[r.seconds != null ? fmtDuration(r.seconds) : null, r.width && r.height ? `${r.width}×${r.height}` : null, fmtBytes(r.sizeBytes)].filter(Boolean).join(" · ")}</span>
      <span className="dim small nowrap" title={r.createdAt}>{fmtRelative(r.createdAt)}</span>
      <a className="icon-btn ghost xs" href={r.url} download={basename(r.file)} title="Download MP4" aria-label="Download MP4"><IconDownload size={14} /></a>
    </div>
  </div>
);
