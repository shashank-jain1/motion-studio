import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type SpecVersion } from "../api";
import { useStudio } from "./context";
import { useToast } from "../components/Toast";
import { IconAlert, IconChevronDown, Spinner } from "../components/Icons";
import { fmtRelative } from "../lib/format";
import { diffSpecs } from "../../../src/engine/spec/diff";

export const authorText = (a: SpecVersion["author"]) =>
  a.kind === "you" ? a.name ?? "You" : a.kind === "director" ? "Director" : a.kind === "mcp" ? a.name ?? "AI client" : a.kind === "template" ? "Template" : "System";

/** Version specs are immutable: cache them for the session. */
const specCache = new Map<string, Record<string, unknown>>();
const fetchVersion = async (id: string, n: number) => {
  const key = `${id}:${n}`;
  const hit = specCache.get(key);
  if (hit) return hit;
  const { spec } = await api.version(id, n);
  specCache.set(key, spec);
  return spec;
};

/**
 * Restore a version: the server writes it as a NEW version (so the restore can be undone too) and returns the spec.
 * With unsaved edits the first call only arms (returns "armed"); the caller shows a confirm state and calls again.
 */
export const useRestoreVersion = () => {
  const { id, dirty, applyServerSpec, setVersionPreview } = useStudio();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => { if (!dirty) setArmed(null); }, [dirty]);
  const restore = useCallback(async (n: number): Promise<"armed" | boolean> => {
    if (dirty && armed !== n) { setArmed(n); return "armed"; }
    setBusy(n);
    try {
      const r = await api.restoreVersion(id, n);
      if (!r.ok) { toast.error(`Couldn't restore v${n}`, r.errors[0]); return false; }
      if (r.spec) applyServerSpec(r.spec, r.timeline, { force: true });
      setVersionPreview(null);
      toast.success(`Restored v${n}`, r.version ? `Saved as v${r.version.n}. Restore v${r.version.n - 1} to go back.` : "Already the current version");
      return true;
    } catch (e) {
      toast.error(`Couldn't restore v${n}`, (e as Error).message);
      return false;
    } finally { setBusy(null); setArmed(null); }
  }, [id, dirty, armed, applyServerSpec, setVersionPreview, toast]);
  return { restore, busy, armed, disarm: () => setArmed(null) };
};

export const HistoryPanel = ({ active }: { active: boolean }) => {
  const { id, specNonce, versionPreview, setVersionPreview, dirty, editorText } = useStudio();
  const toast = useToast();
  const [versions, setVersions] = useState<SpecVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [compare, setCompare] = useState<{ n: number; lines: string[] } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<number | null>(null);
  const { restore, busy, armed, disarm } = useRestoreVersion();

  // fetch when shown, and again whenever the saved spec changes while shown (stale otherwise; refetched on next show)
  const stale = useRef(true);
  useEffect(() => { stale.current = true; }, [specNonce]);
  useEffect(() => {
    if (!active || !stale.current) return;
    stale.current = false;
    const ctl = new AbortController();
    api.versions(id, ctl.signal).then((r) => { setVersions(r.versions); setError(null); }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => ctl.abort();
  }, [active, id, specNonce]);

  const latest = versions?.[0];
  const aiLast = latest && (latest.author.kind === "director" || latest.author.kind === "mcp") && versions!.length > 1 ? latest : null;

  const preview = async (v: SpecVersion) => {
    if (versionPreview?.n === v.n) { setVersionPreview(null); return; }
    setLoadingPreview(v.n);
    try { setVersionPreview({ n: v.n, spec: await fetchVersion(id, v.n), summary: v.summary }); }
    catch (e) { toast.error(`Couldn't load v${v.n}`, (e as Error).message); }
    finally { setLoadingPreview(null); }
  };

  const doCompare = async (v: SpecVersion) => {
    if (compare?.n === v.n) { setCompare(null); return; }
    try {
      let current: unknown = null;
      try { current = JSON.parse(editorText); } catch { /* broken JSON */ }
      const d = diffSpecs(await fetchVersion(id, v.n), current);
      setCompare({ n: v.n, lines: d.identical ? ["Identical to what is in the editor now."] : d.lines });
    } catch (e) { toast.error("Compare failed", (e as Error).message); }
  };

  const groups = useMemo(() => groupByDay(versions ?? []), [versions]);

  return (
    <div className="history-panel">
      <div className="spec-toolbar">
        <span className="label">Versions</span>
        {versions && <span className="mono dim">{versions.length}</span>}
        <span className="spacer" />
        {!versions && !error && <Spinner size={12} />}
      </div>
      <div className="edit-scroll">
        {error && <div className="callout error edit-callout"><IconAlert size={14} /><span>{error}</span></div>}

        {aiLast && (
          <div className="history-undo">
            <div>
              <div className="label">{authorText(aiLast.author)} · last change</div>
              <p className="small">{aiLast.summary}</p>
            </div>
            <button className="btn xs" disabled={busy != null} onClick={() => void restore(versions![1].n)} title={`Restore v${versions![1].n}`}>
              {busy === versions![1].n ? <Spinner size={12} /> : null}{armed === versions![1].n ? "Discard edits & undo" : "Undo it"}
            </button>
          </div>
        )}

        {versions && !versions.length && (
          <div className="edit-empty">
            <p className="serif-line sm">No versions yet</p>
            <p className="dim small">Every save from here on, by you or the director, is kept. You can preview, compare and restore any of them.</p>
          </div>
        )}

        {dirty && versions && versions.length > 0 && (
          <div className="version-row is-draft"><span className="version-n mono">DRAFT</span><span className="small">Unsaved edits in the editor</span></div>
        )}

        {groups.map(({ day, items }) => (
          <section key={day}>
            <div className="history-day label">{day}</div>
            {items.map((v) => {
              const isOpen = open === v.n;
              const isLatest = v.n === latest?.n;
              const previewing = versionPreview?.n === v.n;
              return (
                <div key={v.n} className={`version ${isOpen ? "is-open" : ""} ${previewing ? "is-previewing" : ""}`}>
                  <button className="version-row" onClick={() => { setOpen(isOpen ? null : v.n); disarm(); }} aria-expanded={isOpen}>
                    <span className="version-n mono">v{v.n}</span>
                    <span className="version-main">
                      <span className="version-meta">
                        <span className={`author-tag mono author-${v.author.kind}`}>{authorText(v.author)}</span>
                        <span className="mono dim">{new Date(v.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="dim small">{fmtRelative(v.at)}</span>
                        {isLatest && <span className="tag mono">LATEST</span>}
                        {previewing && <span className="tag tally mono">ON SCREEN</span>}
                      </span>
                      <span className="version-summary">{v.restoredFrom ? <b>Restored v{v.restoredFrom}</b> : v.summary}</span>
                    </span>
                    <IconChevronDown size={12} style={{ transform: isOpen ? "none" : "rotate(-90deg)" }} />
                  </button>
                  {isOpen && (
                    <div className="version-body">
                      <div className="mono dim small">{v.scenes} scene{v.scenes === 1 ? "" : "s"}{v.seconds != null ? ` · ${v.seconds.toFixed(2)}s` : ""}</div>
                      {v.changes.length > 0 && <ul className="version-changes">{v.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                      {compare?.n === v.n && (
                        <div className="version-compare">
                          <div className="label">From v{v.n} to the editor now</div>
                          <ul className="version-changes">{compare.lines.map((c, i) => <li key={i}>{c}</li>)}</ul>
                        </div>
                      )}
                      <div className="row gap version-actions">
                        <button className={`btn xs ${previewing ? "is-on" : ""}`} onClick={() => void preview(v)} disabled={loadingPreview === v.n}>
                          {loadingPreview === v.n ? <Spinner size={12} /> : null}{previewing ? "Stop preview" : "Preview"}
                        </button>
                        <button className="btn xs ghost" onClick={() => void doCompare(v)}>{compare?.n === v.n ? "Hide compare" : "Compare"}</button>
                        <span className="spacer" />
                        {!isLatest && (
                          <button className={`btn xs ${armed === v.n ? "danger" : ""}`} disabled={busy != null} onClick={() => void restore(v.n)}>
                            {busy === v.n ? <Spinner size={12} /> : null}{armed === v.n ? "Discard edits & restore" : "Restore"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
};

const groupByDay = (vs: SpecVersion[]) => {
  const out: { day: string; items: SpecVersion[] }[] = [];
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  for (const v of vs) {
    const d = new Date(v.at).toDateString();
    const day = d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(v.at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
    out[out.length - 1].items.push(v);
  }
  return out;
};
