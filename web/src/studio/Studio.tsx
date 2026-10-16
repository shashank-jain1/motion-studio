import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type Asset, type ProjectState, type RenderInfo, type Settings, type Timeline, type ValidationResult } from "../api";
import { StudioContext, useStudio, type RightTab, type StudioApi } from "./context";
import { PlayerBus } from "./bus";
import { analyzeSpec, type ParsedInfo } from "../lib/specInfo";
import { useToast } from "../components/Toast";
import { ErrorBoundary, Skeleton, SlateStripe } from "../components/ui";
import { IconGear, IconPanelBottom, IconPanelLeft, IconPanelRight } from "../components/Icons";
import { AppBar } from "../components/AppBar";
import { ChatPanel } from "./Chat";
import { PlayerPane } from "./PlayerPane";
import { TimelinePanel } from "./Timeline";
import { AssetsPanel } from "./AssetsPanel";
import { SpecPanel } from "./SpecPanel";
import { RendersPanel } from "./RendersPanel";
import { SettingsDialog } from "../pages/Settings";
import { fmtTC } from "../lib/format";

const pretty = (spec: unknown) => (spec ? JSON.stringify(spec, null, 2) : "");

const usePersisted = (key: string, initial: number) => {
  const [v, setV] = useState<number>(() => {
    try { const n = Number(localStorage.getItem(key)); return n > 0 ? n : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, String(Math.round(v))); } catch { /* private mode */ } }, [key, v]);
  return [v, setV] as const;
};

export const Studio = () => {
  const { id = "" } = useParams();
  const toast = useToast();
  const [state, setState] = useState<ProjectState | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);

  // spec state
  const [liveSpec, setLiveSpec] = useState<Record<string, unknown> | null>(null);
  const [savedText, setSavedText] = useState("");
  const [editorText, setEditorTextState] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [serverTimeline, setServerTimeline] = useState<Timeline | null>(null);
  const [conflict, setConflict] = useState(false);
  const [assets, setAssetsState] = useState<Asset[]>([]);
  const [renders, setRenders] = useState<RenderInfo[]>([]);
  const [selectedScene, setSelectedScene] = useState<number | null>(null);
  const [sceneFocus, setSceneFocus] = useState<{ index: number; nonce: number } | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("assets");
  const [uploaderNonce, setUploaderNonce] = useState(0);
  const [chatRunning, setChatRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const refreshSettings = useCallback(() => { api.settings().then(setSettings).catch(() => {}); }, []);
  useEffect(() => { refreshSettings(); }, [refreshSettings]);
  const bus = useMemo(() => new PlayerBus(), []);

  const editorRef = useRef(""); editorRef.current = editorText;
  const savedRef = useRef(""); savedRef.current = savedText;
  const liveRef = useRef<string>("");
  const chatInsert = useRef<(t: string) => void>(() => {});

  // ---- load
  useEffect(() => {
    const ctl = new AbortController();
    setState(null); setLoadError(null);
    api.project(id, ctl.signal).then((s) => {
      setState(s);
      const txt = pretty(s.spec);
      setSavedText(txt); setEditorTextState(txt);
      setLiveSpec(s.spec); liveRef.current = s.spec ? JSON.stringify(s.spec) : "";
      setValidation(s.validation); setServerTimeline(s.timeline);
      setAssetsState(s.assets); setRenders(s.renders);
      if (!s.spec) setRightTab("assets");
      document.title = `${s.project.name} — Motion Studio`;
    }).catch((e) => { if (e.name !== "AbortError") setLoadError({ message: e.message, status: (e as ApiError).status ?? 0 }); });
    return () => ctl.abort();
  }, [id]);

  // ---- parse the live spec (keeps last good info for the Player/Timeline)
  const lastInfo = useRef<ParsedInfo | null>(null);
  const parsed = useMemo(() => {
    if (!liveSpec) return { info: null, error: null };
    try { return { info: analyzeSpec(liveSpec), error: null }; } catch (e) { return { info: null, error: (e as Error).message }; }
  }, [liveSpec]);
  if (parsed.info || !liveSpec) lastInfo.current = parsed.info;
  const info = parsed.info ?? lastInfo.current;
  const parseError = parsed.error;

  const dirty = editorText !== savedText;

  const setDraftSpec = useCallback((spec: Record<string, unknown> | null, v?: ValidationResult | null) => {
    const key = spec ? JSON.stringify(spec) : "";
    if (key !== liveRef.current) { liveRef.current = key; setLiveSpec(spec); }
    if (v !== undefined) setValidation(v);
  }, []);

  const applyServerSpec = useCallback((spec: Record<string, unknown>, timeline?: Timeline | null) => {
    const txt = pretty(spec);
    const wasDirty = editorRef.current !== savedRef.current;
    setSavedText(txt);
    if (!wasDirty || editorRef.current === txt) setEditorTextState(txt);
    else setConflict(true);
    const key = JSON.stringify(spec);
    if (key !== liveRef.current) { liveRef.current = key; setLiveSpec(spec); }
    if (timeline) setServerTimeline(timeline);
  }, []);

  const resolveConflict = useCallback((keepMine: boolean) => {
    setConflict(false);
    if (!keepMine) setEditorTextState(savedRef.current);
  }, []);

  const saveEditor = useCallback(async () => {
    const text = editorRef.current;
    let spec: Record<string, unknown>;
    try { spec = JSON.parse(text); } catch (e) { toast.error("Can't save — invalid JSON", (e as Error).message); return false; }
    try {
      const r = await api.saveSpec(id, spec);
      if (r.ok) {
        setSavedText(text);
        setConflict(false);
        setValidation(r);
        if (r.timeline) setServerTimeline(r.timeline);
        setDraftSpec(spec);
        toast.success("Spec saved", `${+r.durationSeconds.toFixed(2)}s${r.warnings.length ? ` · ${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"}` : ""}`);
        return true;
      }
      setValidation(r);
      toast.error("Not saved — spec has errors", r.errors[0]);
      return false;
    } catch (e) {
      toast.error("Save failed", (e as Error).message);
      return false;
    }
  }, [id, toast, setDraftSpec]);

  const refreshSide = useCallback(() => {
    api.project(id).then((s) => { setAssetsState(s.assets); setRenders(s.renders); }).catch(() => {});
  }, [id]);

  const selectScene = useCallback((i: number | null, opts?: { scrollEditor?: boolean }) => {
    setSelectedScene(i);
    if (i != null && opts?.scrollEditor) setSceneFocus({ index: i, nonce: Date.now() });
  }, []);

  const api_: StudioApi | null = state && {
    id, project: state.project, bus,
    liveSpec, info, parseError, serverTimeline, validation,
    editorText, setEditorText: setEditorTextState, dirty, conflict, resolveConflict, saveEditor, setDraftSpec, applyServerSpec,
    assets, setAssets: (fn) => setAssetsState(fn), renders,
    addRender: (r) => setRenders((rs) => [r, ...rs.filter((x) => x.file !== r.file)]),
    refreshSide,
    selectedScene, selectScene, sceneFocus,
    rightTab, setRightTab,
    openUploader: () => { setRightTab("assets"); setRightOpen(true); setUploaderNonce(Date.now()); },
    uploaderNonce,
    insertIntoChat: (t) => chatInsert.current(t),
    registerChatInsert: (fn) => { chatInsert.current = fn; },
    settings, refreshSettings, openSettings: () => setSettingsOpen(true),
    chatRunning, setChatRunning,
  };

  // ---- keyboard: Space · J/K/L shuttle · ←/→ frame (⇧ = 1s) · Home/End · S safe zones · F fullscreen · ⌘S save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest(".cm-editor"));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!t?.closest(".cm-editor")) void saveEditor();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".dialog-backdrop, .lightbox, .menu, .select-list")) return;
      const k = e.key.toLowerCase();
      if (e.key === " " && !(t instanceof HTMLButtonElement)) { e.preventDefault(); bus.toggle(); }
      else if (k === "k") { e.preventDefault(); bus.halt(); }
      else if (k === "l") { e.preventDefault(); bus.shuttle(1); }
      else if (k === "j") { e.preventDefault(); bus.shuttle(-1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); bus.step(e.shiftKey ? -bus.fps : -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); bus.step(e.shiftKey ? bus.fps : 1); }
      else if (e.key === "Home") { e.preventDefault(); bus.seek(0); }
      else if (e.key === "End") { e.preventDefault(); bus.seek(bus.durationInFrames - 1); }
      else if (k === "s" && !e.shiftKey) { e.preventDefault(); bus.safe = bus.safe === "off" ? "title" : "off"; bus.emit(); }
      else if (k === "f") { e.preventDefault(); bus.player?.requestFullscreen(); }
      else if (k === "1" || k === "2" || k === "3") { e.preventDefault(); setRightTab((["assets", "spec", "renders"] as const)[Number(k) - 1]); setRightOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bus, saveEditor]);

  // warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ---- layout
  const roomy = typeof window === "undefined" || window.innerWidth >= 1400;
  const [leftW, setLeftW] = usePersisted("ms.leftW", roomy ? 384 : 340);
  const [rightW, setRightW] = usePersisted("ms.rightW", roomy ? 360 : 312);
  const [tlH, setTlH] = usePersisted("ms.timelineH", 228);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [tlOpen, setTlOpen] = useState(true);

  if (loadError) {
    return (
      <div className="page">
        <AppBar crumbs={<span className="crumb mono">{id}</span>} />
        <BootSlateInline title={loadError.status === 404 ? "Project not found" : "Couldn't open project"} detail={loadError.message}
          actions={<><Link to="/" className="btn">Back to projects</Link>{loadError.status !== 404 && <button className="btn primary" onClick={() => location.reload()}>Retry</button>}</>} />
      </div>
    );
  }

  const cols = `${leftOpen ? leftW : 0}px ${leftOpen ? "1px" : "0px"} minmax(440px, 1fr) ${rightOpen ? "1px" : "0px"} ${rightOpen ? rightW : 0}px`;
  const fmt = info?.spec.format ?? state?.project.format ?? "16:9";

  return (
    <div className="studio">
      <AppBar compact
        crumbs={state ? (
          <span className="crumbs">
            <Link to="/" className="crumb-link">Projects</Link>
            <span className="crumb-slash">/</span>
            <span className="crumb-title">{state.project.name}</span>
            {dirty && <span className="tag warn" title="Unsaved spec edits — ⌘S to save">Unsaved</span>}
          </span>
        ) : <Skeleton w={160} h={14} />}
        right={
          <>
            {info && (
              <span className="studio-readouts mono" aria-label="Composition">
                <span>{fmt}</span><span>{info.width}×{info.height}</span><span>{info.fps} FPS</span><span>{fmtTC(info.seconds, info.fps)}</span>
              </span>
            )}
            <span className="tool-group" role="group" aria-label="Panels">
              <button className={`icon-btn ghost sm ${leftOpen ? "is-on" : ""}`} onClick={() => setLeftOpen((o) => !o)} aria-pressed={leftOpen} aria-label="Director panel" title="Director panel"><IconPanelLeft size={16} /></button>
              <button className={`icon-btn ghost sm ${tlOpen ? "is-on" : ""}`} onClick={() => setTlOpen((o) => !o)} aria-pressed={tlOpen} aria-label="Timeline" title="Timeline"><IconPanelBottom size={16} /></button>
              <button className={`icon-btn ghost sm ${rightOpen ? "is-on" : ""}`} onClick={() => setRightOpen((o) => !o)} aria-pressed={rightOpen} aria-label="Inspector" title="Inspector"><IconPanelRight size={16} /></button>
              <button className="icon-btn ghost sm" onClick={() => setSettingsOpen(true)} aria-label="Director settings" title="Director settings"><IconGear size={16} /></button>
            </span>
          </>
        } />

      {!api_ ? <StudioSkeleton /> : (
        <StudioContext.Provider value={api_}>
          <div className="studio-grid" style={{ gridTemplateColumns: cols }}>
            <aside className={`pane pane-left ${leftOpen ? "" : "is-collapsed"}`} aria-label="Director">
              {leftOpen && <ErrorBoundary label="Director"><ChatPanel /></ErrorBoundary>}
            </aside>
            <Resizer side="left" hidden={!leftOpen} value={leftW} onChange={(v) => setLeftW(Math.max(320, Math.min(560, v)))} />
            <main className="pane pane-center" style={{ gridTemplateRows: tlOpen ? `minmax(240px, 1fr) 1px ${tlH}px` : "minmax(240px, 1fr) 0 0" }}>
              <ErrorBoundary label="Viewer"><PlayerPane /></ErrorBoundary>
              <Resizer side="bottom" hidden={!tlOpen} value={tlH} onChange={(v) => setTlH(Math.max(140, Math.min(440, v)))} />
              {tlOpen ? <ErrorBoundary label="Timeline" compact><TimelinePanel /></ErrorBoundary> : <div />}
            </main>
            <Resizer side="right" hidden={!rightOpen} value={rightW} onChange={(v) => setRightW(Math.max(300, Math.min(620, v)))} />
            <aside className={`pane pane-right ${rightOpen ? "" : "is-collapsed"}`} aria-label="Inspector">
              {rightOpen && <Inspector />}
            </aside>
          </div>
        </StudioContext.Provider>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={setSettings} />
    </div>
  );
};

const BootSlateInline = ({ title, detail, actions }: { title: string; detail: string; actions: React.ReactNode }) => (
  <div className="center-screen">
    <div className="nf-card">
      <SlateStripe />
      <div className="nf-body">
        <div className="label">Fault</div>
        <p className="serif-line">{title}</p>
        <p className="mono dim small">{detail}</p>
        <div className="row gap">{actions}</div>
      </div>
    </div>
  </div>
);

const TABS: { id: RightTab; label: string; key: string }[] = [
  { id: "assets", label: "Assets", key: "1" },
  { id: "spec", label: "Spec", key: "2" },
  { id: "renders", label: "Renders", key: "3" },
];

const Inspector = () => {
  const { rightTab, setRightTab, assets, renders, dirty, validation } = useStudio();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [ink, setInk] = useState({ x: 0, w: 0 });
  useEffect(() => {
    const el = tabRefs.current[rightTab];
    if (el) setInk({ x: el.offsetLeft, w: el.offsetWidth });
  }, [rightTab]);
  const count: Partial<Record<RightTab, React.ReactNode>> = {
    assets: assets.length || null,
    renders: renders.length || null,
    spec: dirty ? <i className="tab-dot warn" /> : validation && !validation.ok ? <i className="tab-dot error" /> : null,
  };
  return (
    <div className="inspector">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} role="tab" aria-selected={rightTab === t.id}
            className={`tab ${rightTab === t.id ? "is-active" : ""}`} onClick={() => setRightTab(t.id)}>
            <span className="tab-key mono">{t.key}</span>{t.label}{count[t.id] != null && <span className="tab-count mono">{count[t.id]}</span>}
          </button>
        ))}
        <span className="tab-ink" style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />
      </div>
      <div className="tab-panels">
        <div className="tab-panel" hidden={rightTab !== "assets"}><ErrorBoundary label="Assets"><AssetsPanel /></ErrorBoundary></div>
        <div className="tab-panel no-pad" hidden={rightTab !== "spec"}><ErrorBoundary label="Spec editor"><SpecPanel active={rightTab === "spec"} /></ErrorBoundary></div>
        <div className="tab-panel" hidden={rightTab !== "renders"}><ErrorBoundary label="Renders"><RendersPanel /></ErrorBoundary></div>
      </div>
    </div>
  );
};

const Resizer = ({ side, value, onChange, hidden }: { side: "left" | "right" | "bottom"; value: number; onChange: (v: number) => void; hidden?: boolean }) => {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const vertical = side === "bottom";
  return (
    <div className={`resizer ${vertical ? "horizontal" : "vertical"} ${hidden ? "is-hidden" : ""}`} role="separator" aria-orientation={vertical ? "horizontal" : "vertical"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: vertical ? e.clientY : e.clientX, value };
        document.body.classList.add(vertical ? "is-resizing-v" : "is-resizing-h");
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = (vertical ? e.clientY : e.clientX) - start.current.pos;
        onChange(start.current.value + (side === "left" ? d : -d));
      }}
      onPointerUp={() => { start.current = null; document.body.classList.remove("is-resizing-v", "is-resizing-h"); }}
      onPointerCancel={() => { start.current = null; document.body.classList.remove("is-resizing-v", "is-resizing-h"); }}>
      <span />
    </div>
  );
};

const StudioSkeleton = () => (
  <div className="studio-grid" style={{ gridTemplateColumns: "384px 1px 1fr 1px 360px" }}>
    <aside className="pane pane-left sk-pane">
      <Skeleton h={10} w="30%" />
      <div className="sk-stack">{[80, 60, 90, 50].map((w, i) => <Skeleton key={i} h={36} w={`${w}%`} />)}</div>
    </aside>
    <div />
    <main className="pane pane-center sk-center"><div className="sk-stage"><span className="label">Loading project</span></div><Skeleton h={180} /></main>
    <div />
    <aside className="pane pane-right sk-pane"><Skeleton h={28} /><Skeleton h={80} /><div className="sk-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={100} />)}</div></aside>
  </div>
);
