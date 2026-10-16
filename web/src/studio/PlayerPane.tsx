import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { SpecVideo } from "../../../src/engine/render/SpecVideo";
import { useStudio } from "./context";
import { useBus } from "./bus";
import { fmtTime, ASPECT } from "../lib/format";
import { splitErrors } from "../lib/specInfo";
import { FormatBadge } from "../components/ui";
import {
  IconAlert, IconChevronDown, IconFullscreen, IconLoop, IconMute, IconPause, IconPlay, IconSparkle, IconStepBack, IconStepFwd, IconVolume, Spinner,
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

  // Player input: the last spec that parsed (an invalid draft keeps the previous one; the overlay explains)
  const playerSpec = info?.raw ?? null;
  const inputProps = useMemo(() => ({ spec: playerSpec as never, assetBase: `${location.origin}/files/${id}`, projectId: id }), [playerSpec, id]);

  const fit = useMemo(() => {
    if (!info || !box.w || !box.h) return null;
    const pad = 28;
    const sc = Math.min((box.w - pad * 2) / info.width, (box.h - pad * 2) / info.height);
    return { w: Math.max(1, Math.floor(info.width * sc)), h: Math.max(1, Math.floor(info.height * sc)) };
  }, [info, box]);

  const loop = useBus(bus, (b) => b.loop);
  const fmt = info?.spec.format ?? s.project.format;

  return (
    <div className="player-pane">
      <div className="stage" ref={stageRef}>
        <div className="stage-grid" aria-hidden />
        {info && playerSpec && fit && (
          <div className="stage-frame" style={{ width: fit.w, height: fit.h }}>
            <Player
              ref={setPlayer}
              component={SpecVideo}
              inputProps={inputProps}
              durationInFrames={info.durationInFrames}
              fps={info.fps}
              compositionWidth={info.width}
              compositionHeight={info.height}
              style={{ width: fit.w, height: fit.h }}
              controls={false}
              loop={loop}
              clickToPlay
              doubleClickToFullscreen
              spaceKeyToPlayOrPause={false}
              moveToBeginningWhenEnded={false}
              allowFullscreen
              renderLoading={() => <div className="player-loading"><Spinner size={18} /></div>}
              errorFallback={({ error }) => <div className="player-crash"><IconAlert size={18} /><span>{error.message}</span></div>}
            />
          </div>
        )}
        {!liveSpec && <EmptyStage format={s.project.format} running={s.chatRunning} />}
        {parseError && <ErrorOverlay message={parseError} hasFallback={!!playerSpec} />}
      </div>
      <Controls disabled={!info || !playerSpec} format={fmt} />
    </div>
  );
};

const EmptyStage = ({ format, running }: { format: string; running: boolean }) => (
  <div className="stage-empty">
    <div className="stage-empty-frame" style={{ aspectRatio: String(ASPECT[format] ?? 16 / 9) }}>
      <div className="stage-empty-shimmer" />
      <div className="stage-empty-inner">
        <span className="stage-empty-icon">{running ? <Spinner size={18} /> : <IconSparkle size={18} />}</span>
        <strong>{running ? "The director is blocking out your first cut…" : "No cut yet"}</strong>
        <span className="muted">{running ? "Scenes appear here the moment the spec is saved." : "Brief the director on the left — the preview plays here live."}</span>
      </div>
    </div>
  </div>
);

const ErrorOverlay = ({ message, hasFallback }: { message: string; hasFallback: boolean }) => {
  const [open, setOpen] = useState(true);
  const lines = splitErrors(message);
  return (
    <div className={`error-overlay ${open ? "is-open" : ""}`} role="alert">
      <button className="error-overlay-head" onClick={() => setOpen((o) => !o)}>
        <IconAlert size={14} />
        <span>{lines.length} validation {lines.length === 1 ? "error" : "errors"}{hasFallback ? " · showing last valid version" : ""}</span>
        <IconChevronDown size={14} className="chev" />
      </button>
      {open && (
        <ul className="error-overlay-list">
          {lines.slice(0, 8).map((l, i) => <li key={i}><code>{l}</code></li>)}
          {lines.length > 8 && <li className="muted">+{lines.length - 8} more</li>}
        </ul>
      )}
    </div>
  );
};

const Controls = memo(({ disabled, format }: { disabled: boolean; format: string }) => {
  const { bus, info } = useStudio();
  const playing = useBus(bus, (b) => b.playing);
  const muted = useBus(bus, (b) => b.muted);
  const loop = useBus(bus, (b) => b.loop);
  const frame = useBus(bus, (b) => b.frame);
  const fps = info?.fps ?? 30;
  const total = info?.durationInFrames ?? 1;
  return (
    <div className={`controls ${disabled ? "is-disabled" : ""}`}>
      <div className="controls-left">
        <button className="icon-btn play-btn" onClick={bus.toggle} disabled={disabled} aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)">
          {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
        </button>
        <button className="icon-btn ghost sm" onClick={() => bus.step(-1)} disabled={disabled} aria-label="Previous frame" title="Previous frame (←)"><IconStepBack size={13} /></button>
        <button className="icon-btn ghost sm" onClick={() => bus.step(1)} disabled={disabled} aria-label="Next frame" title="Next frame (→)"><IconStepFwd size={13} /></button>
        <span className="timecode" title={`Frame ${frame} / ${total - 1}`}>
          <span className="tc-now">{fmtTime(frame / fps, fps)}</span>
          <span className="tc-sep">/</span>
          <span className="tc-total">{fmtTime(total / fps, fps)}</span>
        </span>
      </div>
      <Scrubber disabled={disabled} />
      <div className="controls-right">
        <FormatBadge format={format} />
        <button className={`icon-btn ghost sm toggle ${loop ? "is-on" : ""}`} onClick={() => { bus.loop = !bus.loop; bus.emit(); }} aria-pressed={loop} aria-label="Loop" title="Loop"><IconLoop size={14} /></button>
        <button className="icon-btn ghost sm" onClick={() => bus.setMuted(!muted)} disabled={disabled} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>{muted ? <IconMute size={14} /> : <IconVolume size={14} />}</button>
        <button className="icon-btn ghost sm" onClick={() => bus.player?.requestFullscreen()} disabled={disabled} aria-label="Fullscreen" title="Fullscreen"><IconFullscreen size={14} /></button>
      </div>
    </div>
  );
});

const Scrubber = ({ disabled }: { disabled: boolean }) => {
  const { bus } = useStudio();
  const ref = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => bus.subscribe(() => {
    const p = bus.durationInFrames > 1 ? bus.frame / (bus.durationInFrames - 1) : 0;
    if (fill.current) fill.current.style.transform = `scaleX(${p})`;
    if (ref.current) ref.current.style.setProperty("--p", String(p));
  }), [bus]);
  const seekAt = useCallback((clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    bus.seek(((clientX - r.left) / r.width) * (bus.durationInFrames - 1));
  }, [bus]);
  return (
    <div ref={ref} className="scrubber" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={bus.durationInFrames - 1} aria-valuenow={bus.frame} tabIndex={-1}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        bus.player?.pause();
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX); }}>
      <div className="scrubber-track"><div ref={fill} className="scrubber-fill" /></div>
      <div className="scrubber-knob" />
    </div>
  );
};
