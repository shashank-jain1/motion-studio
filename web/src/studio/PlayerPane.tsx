import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { SpecVideo } from "../../../src/engine/render/SpecVideo";
import { FORMATS } from "../../../src/engine/spec/schema";
import { SAFE_ZONES, adaptTargets, reflowSpec, type Format } from "../../../src/engine/spec/reflow";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { useStudio } from "./context";
import { useBus, type SafeMode } from "./bus";
import { ASPECT, fmtDate, fmtTC } from "../lib/format";
import { splitErrors } from "../lib/specInfo";
import { CropMarks, SlateStripe, TallyDot } from "../components/ui";
import {
  IconAlert, IconChevronDown, IconFullscreen, IconLoop, IconMute, IconPause, IconPlay, IconStepBack, IconStepFwd, IconToEnd, IconToStart, IconVolume, Spinner,
} from "../components/Icons";

export const PlayerPane = () => {
  const s = useStudio();
  const { info, bus, liveSpec, parseError, id } = s;
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [player, setPlayer] = useState<PlayerRef | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the bus in sync with composition timing
  useEffect(() => {
    if (!info) return;
    bus.fps = info.fps;
    bus.durationInFrames = info.durationInFrames;
    if (bus.frame > info.durationInFrames - 1) bus.seek(info.durationInFrames - 1);
    else bus.emit();
  }, [info, bus]);

  useEffect(() => {
    if (!player) return;
    bus.player = player;
    const onFrame = (e: { detail: { frame: number } }) => { bus.frame = e.detail.frame; bus.emit(); };
    const onPlay = () => { bus.playing = true; bus.emit(); };
    const onPause = () => { bus.playing = false; bus.frame = player.getCurrentFrame(); bus.emit(); };
    const onSeek = (e: { detail: { frame: number } }) => { bus.frame = e.detail.frame; bus.emit(); };
    const onMute = (e: { detail: { isMuted: boolean } }) => { bus.muted = e.detail.isMuted; bus.emit(); };
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("seeked", onSeek);
    player.addEventListener("mutechange", onMute);
    if (bus.frame > 0) player.seekTo(Math.min(bus.frame, bus.durationInFrames - 1));
    if (bus.muted) player.mute();
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("seeked", onSeek);
      player.removeEventListener("mutechange", onMute);
      if (bus.player === player) bus.player = null;
    };
  }, [player, bus]);

  // Player input: the last spec that parsed (an invalid draft keeps the previous one; the overlay explains).
  // Viewing another format plays the REFLOWED film (spec/reflow.ts, same function the renderer uses).
  const master = (info?.spec.format ?? s.project.format) as Format;
  const viewFormat = useBus(bus, (b) => b.viewFormat) as Format | null;
  const fmt: Format = viewFormat ?? master;
  const view = useMemo(() => {
    if (!info) return null;
    if (fmt === master) return { spec: info.raw, width: info.width, height: info.height };
    try {
      const [width, height] = FORMATS[fmt];
      return { spec: reflowSpec({ ...info.spec, format: master }, fmt) as unknown as Record<string, unknown>, width, height };
    } catch {
      return { spec: info.raw, width: info.width, height: info.height };
    }
  }, [info, fmt, master]);
  const playerSpec = view?.spec ?? null;
  const inputProps = useMemo(() => ({ spec: playerSpec as never, assetBase: `${location.origin}/files/${id}`, projectId: id }), [playerSpec, id]);

  const fit = useMemo(() => {
    if (!view || !box.w || !box.h) return null;
    const padX = 56, padY = 40;
    const sc = Math.min((box.w - padX * 2) / view.width, (box.h - padY * 2) / view.height);
    return { w: Math.max(1, Math.floor(view.width * sc)), h: Math.max(1, Math.floor(view.height * sc)) };
  }, [view, box]);

  const loop = useBus(bus, (b) => b.loop);
  const rate = useBus(bus, (b) => b.rate);
  const safe = useBus(bus, (b) => b.safe);

  return (
    <div className="viewer">
      <ViewerHead format={fmt} master={master} />
      <div className="stage" ref={stageRef}>
        {info && playerSpec && fit && (
          <div className="stage-frame" style={{ width: fit.w, height: fit.h }}>
            <CropMarks inset={-14} />
            <Player
              ref={setPlayer}
              component={SpecVideo}
              inputProps={inputProps}
              key={fmt}
              durationInFrames={info.durationInFrames}
              fps={info.fps}
              compositionWidth={view!.width}
              compositionHeight={view!.height}
              style={{ width: fit.w, height: fit.h }}
              controls={false}
              loop={loop}
              playbackRate={rate}
              clickToPlay
              doubleClickToFullscreen
              spaceKeyToPlayOrPause={false}
              moveToBeginningWhenEnded={false}
              allowFullscreen
              renderLoading={() => <div className="player-loading"><Spinner size={16} /></div>}
              errorFallback={({ error }) => <div className="player-crash"><IconAlert size={16} /><span className="mono">{error.message}</span></div>}
            />
            {safe !== "off" && <SafeOverlay mode={safe} w={view!.width} h={view!.height} format={fmt} />}
            {fmt !== master && <span className="reflow-tag mono" aria-hidden>REFLOW {master} → {fmt}</span>}
          </div>
        )}
        {!liveSpec && <EmptyStage format={s.project.format} name={s.project.name} running={s.chatRunning} />}
        {parseError && <ErrorOverlay message={parseError} hasFallback={!!playerSpec} />}
      </div>
      <Deck disabled={!info || !playerSpec} />
    </div>
  );
};

const SAFE_OPTIONS: { value: SafeMode; label: string; vertical?: boolean }[] = [
  { value: "off", label: "Off" },
  { value: "core", label: "Core" },
  { value: "title", label: "Title" },
  { value: "tiktok", label: "TikTok", vertical: true },
  { value: "reels", label: "Reels", vertical: true },
  { value: "shorts", label: "Shorts", vertical: true },
];

const VIEW_FORMATS: Format[] = ["16:9", "9:16", "1:1", "4:5"];

/**
 * Format switcher: previews the film reflowed to each canvas; the master is marked M; formats that export with the film
 * (spec.formats) carry a dot. "Add format" toggles the viewed format in spec.formats (saved like any spec edit).
 */
const FormatSwitch = ({ format, master }: { format: Format; master: Format }) => {
  const { bus, info, liveSpec, id, dirty, applyServerSpec } = useStudio();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const targets = info ? adaptTargets({ ...info.spec, format: master }) : [master];
  const opts = [...new Set<Format>([master, ...VIEW_FORMATS])];
  const inExport = targets.includes(format);
  const toggle = async () => {
    if (!liveSpec || busy) return;
    if (dirty) { toast.info("Save the spec first", "Adding a format edits spec.formats — press ⌘S, then try again."); return; }
    const cur = ((liveSpec.formats as Format[] | undefined) ?? []).filter((f) => f !== master);
    const next = cur.includes(format) ? cur.filter((f) => f !== format) : [...cur, format];
    const spec = { ...liveSpec, formats: next.length ? next : undefined };
    if (!next.length) delete (spec as Record<string, unknown>).formats;
    setBusy(true);
    try {
      const r = await api.saveSpec(id, spec);
      if (!r.ok) throw new Error(r.errors[0]);
      applyServerSpec(spec, r.timeline);
      toast.success(cur.includes(format) ? `Removed ${format} from exports` : `${format} added to exports`, next.length ? `Exports: ${[master, ...next].join(" · ")}` : `Exports: ${master} only`);
    } catch (e) {
      toast.error("Couldn't update formats", (e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <>
      <span className="label dim">Format</span>
      <div className="segmented sm fmt-switch" role="radiogroup" aria-label="Preview format">
        {opts.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={format === f} className={format === f ? "is-active" : ""} disabled={!info}
            title={f === master ? `${f} · master (authored)` : `${f} · reflowed${targets.includes(f) ? " · exports" : ""}`}
            onClick={() => { bus.viewFormat = f === master ? null : f; if (bus.safe === "tiktok" || bus.safe === "reels" || bus.safe === "shorts") bus.safe = (ASPECT[f] ?? 1) < 1 ? bus.safe : "core"; bus.emit(); }}>
            {f}{f === master ? <i className="fmt-m">M</i> : targets.includes(f) ? <i className="fmt-dot" /> : null}
          </button>
        ))}
      </div>
      {format !== master && (
        <button type="button" className={`btn xs ${inExport ? "ghost" : ""}`} onClick={toggle} disabled={busy || !info} aria-pressed={inExport}
          title={inExport ? `Stop exporting ${format}` : `Export ${format} too (adds it to spec.formats)`}>
          {busy ? <Spinner size={12} /> : inExport ? "✓ In export" : `+ Add ${format}`}
        </button>
      )}
    </>
  );
};

const ViewerHead = ({ format, master }: { format: Format; master: Format }) => {
  const { bus, info, chatRunning } = useStudio();
  const safe = useBus(bus, (b) => b.safe);
  const playing = useBus(bus, (b) => b.playing);
  const vertical = (ASPECT[format] ?? 1) < 1;
  const opts = SAFE_OPTIONS.filter((o) => !o.vertical || vertical);
  return (
    <div className="viewer-head">
      <span className="label">Viewer</span>
      {(playing || chatRunning) && <span className="onair"><TallyDot />{playing ? "PLAY" : "DIRECTING"}</span>}
      <span className="spacer" />
      <FormatSwitch format={format} master={master} />
      <span className="viewer-sep" aria-hidden />
      <span className="label dim">Safe</span>
      <div className="segmented sm" role="radiogroup" aria-label="Safe-zone overlay (S)">
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={safe === o.value} className={safe === o.value ? "is-active" : ""}
            disabled={!info} onClick={() => { bus.safe = o.value; bus.emit(); }}>{o.label}</button>
        ))}
      </div>
    </div>
  );
};

/** Platform UI zones on a 1080×1920 canvas: [top, right, bottom, left] px kept clear + where the UI sits. */
const PLATFORM: Record<"tiktok" | "reels" | "shorts", { name: string; clear: [number, number, number, number]; rail: number; caption: number }> = {
  tiktok: { name: "TIKTOK", clear: [160, 150, 480, 60], rail: 1080 - 130, caption: 1920 - 440 },
  reels: { name: "REELS", clear: [220, 140, 420, 60], rail: 1080 - 120, caption: 1920 - 380 },
  shorts: { name: "SHORTS", clear: [190, 130, 380, 60], rail: 1080 - 115, caption: 1920 - 350 },
};

/** Hairline safe-zone overlay in composition coordinates. */
const SafeOverlay = ({ mode, w, h, format }: { mode: SafeMode; w: number; h: number; format: Format }) => {
  const k = Math.min(w, h) / 1080; // stroke/label scale
  const label = (x: number, y: number, t: string, anchor: "start" | "end" = "start") => (
    <text x={x} y={y} textAnchor={anchor} fontFamily="Geist Mono, monospace" fontSize={22 * k} letterSpacing={2 * k} fill="#ECE8DF" opacity={0.85}>{t}</text>
  );
  if (mode === "core") {
    // the universal safe rect the reflow keeps critical content in (spec/reflow.ts SAFE_ZONES)
    const z = SAFE_ZONES[format] ?? SAFE_ZONES["16:9"];
    const sx = w / FORMATS[format][0], sy = h / FORMATS[format][1];
    const r = { x: w / 2 + z.l * sx, y: h / 2 + z.t * sy, w: (z.r - z.l) * sx, h: (z.b - z.t) * sy };
    return (
      <svg className="safe-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <pattern id="hatch-core" width={14 * k} height={14 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={14 * k} height={14 * k} fill="rgba(13,13,11,0.22)" />
            <line x1="0" y1="0" x2="0" y2={14 * k} stroke="#ECE8DF" strokeOpacity={0.14} strokeWidth={3 * k} />
          </pattern>
          <mask id="m-core"><rect width={w} height={h} fill="white" /><rect x={r.x} y={r.y} width={r.w} height={r.h} fill="black" /></mask>
        </defs>
        <rect width={w} height={h} fill="url(#hatch-core)" mask="url(#m-core)" />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#ECE8DF" strokeOpacity={0.85} strokeWidth={2 * k} strokeDasharray={`${12 * k} ${8 * k}`} />
        <path d={`M${w / 2 - 30 * k} ${h / 2}h${60 * k}M${w / 2} ${h / 2 - 30 * k}v${60 * k}`} stroke="#ECE8DF" strokeOpacity={0.6} strokeWidth={2 * k} />
        {label(r.x + 12 * k, r.y + 32 * k, `CORE SAFE · ${format}`)}
        {label(r.x + r.w - 12 * k, r.y + r.h - 14 * k, `${z.r - z.l}×${z.b - z.t}`, "end")}
      </svg>
    );
  }
  if (mode === "title") {
    const a = { x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.9 };
    const t = { x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 };
    return (
      <svg className="safe-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <rect {...a} width={a.w} height={a.h} fill="none" stroke="#ECE8DF" strokeOpacity={0.6} strokeWidth={2 * k} />
        <rect {...t} width={t.w} height={t.h} fill="none" stroke="#ECE8DF" strokeOpacity={0.6} strokeWidth={2 * k} strokeDasharray={`${10 * k} ${8 * k}`} />
        <path d={`M${w / 2 - 30 * k} ${h / 2}h${60 * k}M${w / 2} ${h / 2 - 30 * k}v${60 * k}`} stroke="#ECE8DF" strokeOpacity={0.6} strokeWidth={2 * k} />
        {label(a.x + 12 * k, a.y + 30 * k, "ACTION SAFE 90%")}
        {label(t.x + 12 * k, t.y + 30 * k, "TITLE SAFE 80%")}
      </svg>
    );
  }
  const p = PLATFORM[mode as "tiktok"];
  const sx = w / 1080, sy = h / 1920;
  const [ct, cr, cb, cl] = p.clear;
  const inner = { x: cl * sx, y: ct * sy, w: w - (cl + cr) * sx, h: h - (ct + cb) * sy };
  const railX = p.rail * sx;
  const capY = p.caption * sy;
  return (
    <svg className="safe-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <pattern id={`hatch-${mode}`} width={14 * k} height={14 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={14 * k} height={14 * k} fill="rgba(13,13,11,0.28)" />
          <line x1="0" y1="0" x2="0" y2={14 * k} stroke="#ECE8DF" strokeOpacity={0.18} strokeWidth={3 * k} />
        </pattern>
        <mask id={`m-${mode}`}><rect width={w} height={h} fill="white" /><rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} fill="black" /></mask>
      </defs>
      <rect width={w} height={h} fill={`url(#hatch-${mode})`} mask={`url(#m-${mode})`} />
      <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} fill="none" stroke="#ECE8DF" strokeOpacity={0.8} strokeWidth={2 * k} strokeDasharray={`${12 * k} ${8 * k}`} />
      {/* action rail */}
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={railX - 34 * sx} y={h * 0.5 + i * 150 * sy} width={68 * sx} height={68 * sx} fill="none" stroke="#ECE8DF" strokeOpacity={0.55} strokeWidth={2 * k} />)}
      {/* caption block */}
      <rect x={cl * sx} y={capY} width={560 * sx} height={26 * sy} fill="#ECE8DF" fillOpacity={0.35} />
      <rect x={cl * sx} y={capY + 44 * sy} width={760 * sx} height={20 * sy} fill="#ECE8DF" fillOpacity={0.22} />
      <rect x={cl * sx} y={capY + 78 * sy} width={420 * sx} height={20 * sy} fill="#ECE8DF" fillOpacity={0.22} />
      {label(inner.x + 12 * k, inner.y + 32 * k, `${p.name} SAFE`)}
      {label(inner.x + inner.w - 12 * k, inner.y + inner.h - 14 * k, `${Math.round(inner.w / sx)}×${Math.round(inner.h / sy)}`, "end")}
    </svg>
  );
};

const EmptyStage = ({ format, name, running }: { format: string; name: string; running: boolean }) => (
  <div className="stage-empty">
    <div className="stage-slate" style={{ aspectRatio: String(ASPECT[format] ?? 16 / 9) }}>
      <CropMarks inset={-14} />
      <SlateStripe />
      <div className="stage-slate-body">
        <div className="slate-grid mono">
          <span className="label">Prod</span><span className="slate-val">{name}</span>
          <span className="label">Format</span><span className="slate-val">{format}</span>
          <span className="label">Date</span><span className="slate-val">{fmtDate(new Date().toISOString())}</span>
        </div>
        <div className="stage-slate-status">
          {running ? <><Spinner size={14} /><span>The director is blocking out the first cut…</span></> : <span className="serif-line sm">No cut yet. Brief the director.</span>}
        </div>
      </div>
    </div>
  </div>
);

const ErrorOverlay = ({ message, hasFallback }: { message: string; hasFallback: boolean }) => {
  const [open, setOpen] = useState(true);
  const lines = splitErrors(message);
  return (
    <div className={`error-overlay ${open ? "is-open" : ""}`} role="alert">
      <button className="error-overlay-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconAlert size={14} />
        <span className="mono">{String(lines.length).padStart(2, "0")} SPEC {lines.length === 1 ? "ERROR" : "ERRORS"}</span>
        {hasFallback && <span className="dim">showing last valid cut</span>}
        <IconChevronDown size={14} className="chev" />
      </button>
      {open && (
        <ul className="error-overlay-list">
          {lines.slice(0, 8).map((l, i) => <li key={i}><code className="mono">{l}</code></li>)}
          {lines.length > 8 && <li className="dim">+{lines.length - 8} more</li>}
        </ul>
      )}
    </div>
  );
};

/** Transport deck: locate · step · play · step · locate, big timecode, frame counter, shuttle, loop/mute/full. */
const Deck = memo(({ disabled }: { disabled: boolean }) => {
  const { bus, info } = useStudio();
  const playing = useBus(bus, (b) => b.playing);
  const muted = useBus(bus, (b) => b.muted);
  const loop = useBus(bus, (b) => b.loop);
  const frame = useBus(bus, (b) => b.frame);
  const rate = useBus(bus, (b) => b.rate);
  const fps = info?.fps ?? 30;
  const total = info?.durationInFrames ?? 1;
  return (
    <div className={`deck ${disabled ? "is-disabled" : ""}`}>
      <div className="transport" role="group" aria-label="Transport">
        <button className="t-btn" onClick={() => bus.seek(0)} disabled={disabled} aria-label="Go to start" title="Start (Home)"><IconToStart size={14} /></button>
        <button className="t-btn" onClick={() => bus.step(-1)} disabled={disabled} aria-label="Previous frame" title="Previous frame (←)"><IconStepBack size={14} /></button>
        <button className={`t-btn play ${playing ? "is-playing" : ""}`} onClick={bus.toggle} disabled={disabled} aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space) · J/K/L shuttle">
          {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
        </button>
        <button className="t-btn" onClick={() => bus.step(1)} disabled={disabled} aria-label="Next frame" title="Next frame (→)"><IconStepFwd size={14} /></button>
        <button className="t-btn" onClick={() => bus.seek(total - 1)} disabled={disabled} aria-label="Go to end" title="End (End)"><IconToEnd size={14} /></button>
      </div>
      <div className="tc-block" title={`Frame ${frame} of ${total - 1}`}>
        <span className={`tc-big mono ${playing ? "is-live" : ""}`}>{fmtTC(frame / fps, fps)}</span>
        <span className="tc-sub mono">
          <span>F {String(frame).padStart(4, "0")}<span className="dim">/{String(total - 1).padStart(4, "0")}</span></span>
          <span className="dim">DUR {fmtTC(total / fps, fps)}</span>
        </span>
      </div>
      <Scrubber disabled={disabled} />
      <div className="deck-right">
        <span className={`shuttle mono ${rate !== 1 ? "is-on" : ""}`} title="Shuttle rate (J/K/L)">{rate > 0 ? "▸" : "◂"} {Math.abs(rate)}×</span>
        <button className={`icon-btn ghost sm ${loop ? "is-on" : ""}`} onClick={() => { bus.loop = !bus.loop; bus.emit(); }} aria-pressed={loop} aria-label="Loop" title="Loop"><IconLoop size={16} /></button>
        <button className="icon-btn ghost sm" onClick={() => bus.setMuted(!muted)} disabled={disabled} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>{muted ? <IconMute size={16} /> : <IconVolume size={16} />}</button>
        <button className="icon-btn ghost sm" onClick={() => bus.player?.requestFullscreen()} disabled={disabled} aria-label="Fullscreen" title="Fullscreen (F)"><IconFullscreen size={16} /></button>
      </div>
    </div>
  );
});

const Scrubber = ({ disabled }: { disabled: boolean }) => {
  const { bus, info } = useStudio();
  const ref = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const up = () => {
      const p = bus.durationInFrames > 1 ? bus.frame / (bus.durationInFrames - 1) : 0;
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      if (ref.current) ref.current.style.setProperty("--p", String(p));
    };
    up();
    return bus.subscribe(up);
  }, [bus]);
  const seekAt = useCallback((clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    bus.seek(((clientX - r.left) / r.width) * (bus.durationInFrames - 1));
  }, [bus]);
  const total = info?.seconds ?? 1;
  return (
    <div ref={ref} className="scrubber" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={bus.durationInFrames - 1} aria-valuenow={bus.frame} tabIndex={-1}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        bus.player?.pause();
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX); }}>
      <div className="scrubber-track">
        <div ref={fill} className="scrubber-fill" />
        {info?.timeline.scenes.slice(1).map((sc) => <i key={sc.index} className="scrubber-cut" style={{ left: `${(sc.start / total) * 100}%` }} />)}
      </div>
      <div className="scrubber-knob" />
    </div>
  );
};
