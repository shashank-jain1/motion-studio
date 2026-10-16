import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type Asset, type ProjectState, type RenderInfo, type Settings, type Timeline, type ValidationResult } from "../api";
import { StudioContext, useStudio, type RightTab, type StudioApi } from "./context";
import { PlayerBus } from "./bus";
import { analyzeSpec, type ParsedInfo } from "../lib/specInfo";
import { useToast } from "../components/Toast";
import { ErrorBoundary, FormatBadge, Skeleton } from "../components/ui";
import { IconArrowLeft, IconCode, IconFilm, IconGear, IconImage, IconPanelLeft, IconPanelRight, Logo } from "../components/Icons";
import { ChatPanel } from "./Chat";
import { PlayerPane } from "./PlayerPane";
import { TimelinePanel } from "./Timeline";
import { AssetsPanel } from "./AssetsPanel";
import { SpecPanel } from "./SpecPanel";
import { RendersPanel } from "./RendersPanel";
import { SettingsDialog } from "../pages/Settings";
import { fmtDuration } from "../lib/format";

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

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest(".cm-editor"));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!t?.closest(".cm-editor")) void saveEditor();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".dialog-backdrop, .lightbox")) return;
      if (e.key === " " && !(t instanceof HTMLButtonElement)) { e.preventDefault(); bus.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); bus.step(e.shiftKey ? -bus.fps : -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); bus.step(e.shiftKey ? bus.fps : 1); }
      else if (e.key === "Home") { e.preventDefault(); bus.seek(0); }
      else if (e.key === "End") { e.preventDefault(); bus.seek(bus.durationInFrames - 1); }
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
  const [leftW, setLeftW] = usePersisted("ms.leftW", 380);
  const [rightW, setRightW] = usePersisted("ms.rightW", 380);
  const [tlH, setTlH] = usePersisted("ms.timelineH", 196);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  if (loadError) {
    return (
      <div className="center-screen">
        <Logo size={40} />
        <h1 className="display-sm">{loadError.status === 404 ? "Project not found" : "Couldn't open project"}</h1>
        <p className="muted">{loadError.message}</p>
        <div className="row gap">
          <Link to="/" className="btn">Back to projects</Link>
          {loadError.status !== 404 && <button className="btn primary" onClick={() => location.reload()}>Retry</button>}
        </div>
      </div>
    );
  }

  const cols = `${leftOpen ? leftW : 0}px ${leftOpen ? "1px" : "0px"} minmax(420px, 1fr) ${rightOpen ? "1px" : "0px"} ${rightOpen ? rightW : 0}px`;

  return (
    <div className="studio">
      <header className="topbar studio-top">
        <div className="topbar-left">
          <Link to="/" className="icon-btn ghost" aria-label="All projects" title="All projects"><IconArrowLeft size={15} /></Link>
          <Link to="/" className="brand compact"><Logo size={20} /></Link>
          <span className="crumb-sep">/</span>
          {state ? <span className="project-name">{state.project.name}</span> : <Skeleton w={140} h={14} />}
          {state && <FormatBadge format={info?.spec.format ?? state.project.format} />}
          {info && <span className="badge subtle mono">{fmtDuration(info.seconds)}</span>}
          {state && dirty && <span className="dirty-dot" title="Unsaved spec edits — ⌘S to save">Unsaved</span>}
        </div>
        <div className="topbar-right">
          <button className={`icon-btn ghost ${leftOpen ? "" : "is-off"}`} onClick={() => setLeftOpen((o) => !o)} aria-pressed={leftOpen} aria-label="Toggle director panel" title="Toggle director panel"><IconPanelLeft size={15} /></button>
          <button className={`icon-btn ghost ${rightOpen ? "" : "is-off"}`} onClick={() => setRightOpen((o) => !o)} aria-pressed={rightOpen} aria-label="Toggle inspector" title="Toggle inspector"><IconPanelRight size={15} /></button>
          <button className="icon-btn ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"><IconGear size={15} /></button>
        </div>
      </header>

      {!api_ ? <StudioSkeleton /> : (
        <StudioContext.Provider value={api_}>
          <div className="studio-grid" style={{ gridTemplateColumns: cols }}>
            <aside className={`pane pane-left ${leftOpen ? "" : "is-collapsed"}`}>
              {leftOpen && <ErrorBoundary label="Chat"><ChatPanel /></ErrorBoundary>}
            </aside>
            <Resizer side="left" hidden={!leftOpen} value={leftW} onChange={(v) => setLeftW(Math.max(300, Math.min(560, v)))} />
            <main className="pane pane-center" style={{ gridTemplateRows: `minmax(220px, 1fr) 1px ${tlH}px` }}>
              <ErrorBoundary label="Player"><PlayerPane /></ErrorBoundary>
              <Resizer side="bottom" value={tlH} onChange={(v) => setTlH(Math.max(120, Math.min(420, v)))} />
              <ErrorBoundary label="Timeline" compact><TimelinePanel /></ErrorBoundary>
            </main>
            <Resizer side="right" hidden={!rightOpen} value={rightW} onChange={(v) => setRightW(Math.max(320, Math.min(620, v)))} />
            <aside className={`pane pane-right ${rightOpen ? "" : "is-collapsed"}`}>
              {rightOpen && <Inspector />}
            </aside>
          </div>
        </StudioContext.Provider>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={setSettings} />
    </div>
  );
};

const TABS: { id: RightTab; label: string; icon: React.ReactNode }[] = [
  { id: "assets", label: "Assets", icon: <IconImage size={13} /> },
  { id: "spec", label: "Spec", icon: <IconCode size={13} /> },
  { id: "renders", label: "Renders", icon: <IconFilm size={13} /> },
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
    spec: dirty ? <i className="tab-dot" /> : validation && !validation.ok ? <i className="tab-dot error" /> : null,
  };
  return (
    <div className="inspector">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} role="tab" aria-selected={rightTab === t.id}
            className={`tab ${rightTab === t.id ? "is-active" : ""}`} onClick={() => setRightTab(t.id)}>
            {t.icon}{t.label}{count[t.id] != null && <span className="tab-count">{count[t.id]}</span>}
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
  <div className="studio-grid" style={{ gridTemplateColumns: "380px 1px 1fr 1px 380px" }}>
    <aside className="pane pane-left sk-pane">
      <Skeleton h={14} w="40%" />
      <div className="sk-stack">{[80, 60, 90, 50].map((w, i) => <Skeleton key={i} h={44} w={`${w}%`} r={12} />)}</div>
    </aside>
    <div />
    <main className="pane pane-center sk-center"><Skeleton className="sk-stage" r={12} /><Skeleton h={150} r={10} /></main>
    <div />
    <aside className="pane pane-right sk-pane"><Skeleton h={30} r={8} /><Skeleton h={90} r={12} /><div className="sk-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={110} r={10} />)}</div></aside>
  </div>
);
