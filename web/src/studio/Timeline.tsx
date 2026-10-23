import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "@remotion/player";
import { SpecVideo } from "../../../src/engine/render/SpecVideo";
import { useStudio } from "./context";
import { IconFit, IconMagnet, IconMinus, IconPlus } from "../components/Icons";
import { fmtTC } from "../lib/format";
import { inkOn, sceneColor, themeColors } from "../lib/sceneColor";
import type { ParsedInfo } from "../lib/specInfo";
import { inspectSound } from "../../../src/engine/audio/inspect";
import { sfxInfo } from "../../../src/engine/audio/library";

const HEAD_W = 112; // track label column
const MIN_PPS = 8;
const MAX_PPS = 600;
const SNAP_PX = 8;
const THUMB_H = 56;

/** NLE timeline: timecode ruler, scene clips colored by their real background with thumbnail strips, transition joins, actor tracks. */
export const TimelinePanel = () => {
  const { info, bus, selectedScene, selectScene, serverTimeline, id } = useStudio();
  const timeline = info?.timeline ?? serverTimeline;
  const scenesMeta = info?.scenes;
  const total = Math.max(0.1, timeline?.total ?? 0);
  const sound = useMemo(() => info ? inspectSound(info.spec) : null, [info]);
  const soundCues = useMemo(() => [
    ...(sound?.cues ?? []).map((c) => ({ peak: c.peak, start: c.start, end: c.end, role: c.role, hero: c.importance === "hero", locked: c.locked, reason: c.reason })),
    ...(sound?.manual ?? []).map((c) => {
      const meta = sfxInfo(c.src), rate = c.rate ?? 1;
      return { peak: c.at + (meta?.peakAt ?? 0) / rate, start: c.at, end: c.at + (meta?.durationSec ?? 0.5) / rate, role: "manual", hero: false, locked: true, reason: c.src };
    }),
  ].sort((a, b) => a.peak - b.peak), [sound]);
  const hasSoundTrack = !!info?.spec.sound || soundCues.length > 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const [pps, setPps] = useState<number | null>(null); // null = zoom-to-fit
  const [snap, setSnap] = useState(true);
  const fitPps = viewW > 0 ? Math.max(MIN_PPS, (viewW - 24) / total) : 60;
  const scale = pps ?? fitPps;
  const contentW = Math.max(viewW, total * scale + 24);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  const colors = useMemo(() => {
    if (!info) return null;
    const theme = themeColors(info.spec);
    return info.spec.scenes.map((_, i) => sceneColor(info.spec, i, theme));
  }, [info]);

  // playhead follows the bus without React re-renders
  const fps = info?.fps ?? 30;
  useEffect(() => {
    const update = () => {
      const t = bus.frame / (bus.fps || fps);
      const x = t * scale;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      const sc = scrollRef.current;
      if (sc && bus.playing && pps != null) {
        if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 40);
      }
    };
    update();
    return bus.subscribe(update);
  }, [bus, scale, fps, pps]);

  const bounds = useMemo(() => (timeline ? [0, ...timeline.scenes.flatMap((s) => [s.start, s.end]), ...soundCues.map((c) => c.peak)] : []), [timeline, soundCues]);
  const timeAt = useCallback((clientX: number, allowSnap: boolean) => {
    const sc = scrollRef.current!;
    const r = sc.getBoundingClientRect();
    let t = Math.max(0, Math.min(total, (clientX - r.left + sc.scrollLeft) / scale));
    if (allowSnap) {
      const near = bounds.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), Infinity);
      if (Math.abs(near - t) * scale < SNAP_PX) t = near;
    }
    return t;
  }, [scale, total, bounds]);
  const seekTime = useCallback((t: number) => bus.seek(t * (bus.fps || fps)), [bus, fps]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !timeline) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-sound-cue]")) { bus.player?.pause(); return; }
    const sceneEl = target.closest<HTMLElement>("[data-scene]");
    if (sceneEl) selectScene(Number(sceneEl.dataset.scene), { scrollEditor: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    bus.player?.pause();
    seekTime(timeAt(e.clientX, snap !== e.shiftKey));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) seekTime(timeAt(e.clientX, snap !== e.shiftKey));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const sc = scrollRef.current!;
    const t = timeAt(e.clientX, false);
    const next = Math.max(MIN_PPS, Math.min(MAX_PPS, scale * Math.exp(-e.deltaY * 0.004)));
    setPps(next);
    requestAnimationFrame(() => { sc.scrollLeft = t * next - (e.clientX - sc.getBoundingClientRect().left); });
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, [!!timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = useMemo(() => {
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const major = steps.find((s) => s * scale >= 72) ?? 60;
    const minor = steps.filter((s) => s < major).reverse().find((s) => s * scale >= 8 && Math.abs(major / s - Math.round(major / s)) < 1e-6) ?? major;
    const out: { t: number; major: boolean }[] = [];
    const n = Math.round(major / minor);
    for (let i = 0; i * minor <= total + 1e-6; i++) out.push({ t: +(i * minor).toFixed(5), major: i % n === 0 });
    return { list: out, major };
  }, [scale, total, fps]);
  const tickLabel = (t: number) => {
    const tc = fmtTC(t, fps); // HH:MM:SS:FF
    return ticks.major < 1 ? tc.slice(6) : tc.slice(3, 8) + ":" + tc.slice(9);
  };

  const actors = timeline?.actors ?? [];
  const zoomBy = (k: number) => setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, scale * k)));
  const zoomPct = Math.round((scale / fitPps) * 100);

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <span className="label">Timeline</span>
        {timeline && <span className="mono dim">{String(timeline.scenes.length).padStart(2, "0")} SC · {fmtTC(total, fps)}</span>}
        <span className="spacer" />
        <button className={`icon-btn ghost xs ${snap ? "is-on" : ""}`} onClick={() => setSnap((v) => !v)} aria-pressed={snap} aria-label="Snap to cuts and sound accents" title="Snap to cuts and sound accents (hold ⇧ to invert)"><IconMagnet size={14} /></button>
        <span className="tl-div" />
        <button className="icon-btn ghost xs" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out (⌘/Ctrl + wheel)"><IconMinus size={14} /></button>
        <span className="mono zoom-pct">{zoomPct}%</span>
        <button className="icon-btn ghost xs" onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in (⌘/Ctrl + wheel)"><IconPlus size={14} /></button>
        <button className={`icon-btn ghost xs ${pps == null ? "is-on" : ""}`} onClick={() => setPps(null)} aria-label="Zoom to fit" title="Zoom to fit"><IconFit size={14} /></button>
      </div>
      {!timeline ? (
        <div className="timeline-empty">
          <div className="tl-empty-heads"><span className="label">V1</span><span className="label">A1</span></div>
          <div className="tl-empty-body"><span className="label">No scenes on the timeline yet</span></div>
        </div>
      ) : (
        <div className="timeline-body">
          <div className="track-heads" style={{ width: HEAD_W }}>
            <div className="track-head ruler-head mono">{fps} FPS</div>
            <div className="track-head scenes-head"><span className="mono">V1</span><span>Scenes</span></div>
            {actors.map((a, i) => <div key={a.id} className="track-head actor-head" title={`Actor “${a.id}” — persists across cuts`}><span className="mono">A{i + 1}</span><span className="ellipsis">{a.id}</span></div>)}
            {hasSoundTrack && <div className="track-head sound-head" title={`${soundCues.length} sound accents. Click a marker to inspect the picture at its sound apex.`}><span className="mono">SFX</span><span>Accents</span></div>}
          </div>
          <div className="timeline-scroll" ref={scrollRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onWheel={onWheel}>
            <div className="timeline-content" style={{ width: contentW }}>
              <div className="ruler">
                {ticks.list.map((tk) => (
                  <div key={tk.t} className={`tick ${tk.major ? "major" : ""}`} style={{ transform: `translateX(${tk.t * scale}px)` }}>
                    {tk.major && <span className="mono">{tickLabel(tk.t)}</span>}
                  </div>
                ))}
              </div>
              <div className="track scene-track">
                {timeline.scenes.map((sc, i) => {
                  const meta = scenesMeta?.[i];
                  const left = sc.start * scale;
                  const w = Math.max(2, (sc.end - sc.start) * scale);
                  const bg = colors?.[i] ?? "#2A2925";
                  const fg = inkOn(bg);
                  return (
                    <div key={i} data-scene={i}
                      className={`clip ${selectedScene === i ? "is-selected" : ""} ${w < 72 ? "is-narrow" : ""}`}
                      style={{ transform: `translateX(${left}px)`, width: w, background: bg, color: fg }}
                      title={`${sc.id ?? `Scene ${i + 1}`} · ${fmtTC(sc.start, fps)} → ${fmtTC(sc.end, fps)}${meta?.notes ? `\n${meta.notes}` : ""}`}
                      onDoubleClick={() => selectScene(i, { scrollEditor: true })}>
                      {info && <ClipThumbs info={info} id={id} start={sc.start} end={sc.end} width={w} />}
                      <span className="clip-label">
                        <span className="clip-n mono">{String(i + 1).padStart(2, "0")}</span>
                        <span className="clip-name">{sc.id ?? `Scene ${i + 1}`}</span>
                        <span className="clip-dur mono">{(sc.end - sc.start).toFixed(2)}s</span>
                      </span>
                    </div>
                  );
                })}
                {timeline.scenes.map((sc, i) => {
                  if (i === 0) return null;
                  const tr = sc.transition ?? scenesMeta?.[i]?.transition;
                  if (sc.overlapIn > 0) {
                    return (
                      <div key={`j${i}`} className="join" style={{ transform: `translateX(${sc.start * scale}px)`, width: Math.max(4, sc.overlapIn * scale) }}>
                        <span className="join-tag mono">{(tr ?? "mix").toUpperCase()} {sc.overlapIn.toFixed(2)}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={`c${i}`} className="cut" style={{ transform: `translateX(${sc.start * scale}px)` }}>
                      <span className="join-tag mono">{(tr ?? "cut").toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
              {actors.map((a) => (
                <div key={a.id} className="track actor-track">
                  <div className="actor-bar" style={{ transform: `translateX(${a.from * scale}px)`, width: Math.max(4, (a.until - a.from) * scale) }} title={`${a.id}: ${fmtTC(a.from, fps)} → ${fmtTC(a.until, fps)}`}>
                    <span className="mono">{a.id}</span>
                  </div>
                </div>
              ))}
              {hasSoundTrack && <div className="track sound-track">
                {(sound?.bridges ?? []).map((b) => <span key={b.id} className="sound-bridge" style={{ left: b.at * scale, width: b.dur * scale }} title={`${b.reason}\n${b.family}`} />)}
                {(sound?.beats ?? []).filter((t) => t >= 0 && t < total).map((t, i) => <span key={`beat-${i}`} className="sound-beat" style={{ left: t * scale }} aria-hidden />)}
                {soundCues.map((c, i) => {
                  const from = Math.max(0, c.start), end = Math.min(total, c.end);
                  if (c.peak < 0 || c.peak >= total) return null;
                  return <button key={i} data-sound-cue className={`sound-cue ${c.hero ? "is-hero" : ""}`}
                    style={{ left: from * scale, width: Math.max(8, (end - from) * scale) }}
                    title={`${c.role} · ${fmtTC(c.peak, fps)}${c.locked ? " · locked to picture" : ""}\n${c.reason}`}
                    aria-label={`${c.role} sound at ${c.peak.toFixed(2)} seconds${c.hero ? ", hero accent" : ""}`}
                    onClick={() => { bus.player?.pause(); seekTime(c.peak); }}>
                    <span className="sound-apex" style={{ left: (c.peak - from) * scale }} />
                    <span className="sound-cue-label mono">{c.role}</span>
                  </button>;
                })}
                {!soundCues.length && <span className="sound-track-empty">{sound?.enabled ? "No accents planned" : "Automatic sound is off"}</span>}
              </div>}
              <div className="playhead" ref={playheadRef}><div className="playhead-head" /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Thumbnail strip inside a clip: engine frames at evenly spaced points (midpoint first), capped so it stays cheap. */
const ClipThumbs = memo(({ info, id, start, end, width }: { info: ParsedInfo; id: string; start: number; end: number; width: number }) => {
  const thumbW = Math.max(8, Math.round(THUMB_H * (info.width / info.height)));
  const n = Math.max(0, Math.min(4, Math.floor((width - 4) / thumbW)));
  const inputProps = useMemo(() => ({ spec: info.raw as never, assetBase: `${location.origin}/files/${id}`, projectId: id }), [info, id]);
  if (!n) return null;
  const times = n === 1 ? [(start + end) / 2] : Array.from({ length: n }, (_, k) => start + ((k + 0.5) / n) * (end - start));
  return (
    <span className="clip-thumbs" aria-hidden>
      {times.map((t, k) => (
        <span key={k} className="clip-thumb" style={{ width: thumbW, height: THUMB_H }}>
          <Thumbnail component={SpecVideo} inputProps={inputProps} compositionWidth={info.width} compositionHeight={info.height}
            durationInFrames={info.durationInFrames} fps={info.fps} frameToDisplay={Math.min(info.durationInFrames - 1, Math.round(t * info.fps))}
            style={{ width: thumbW, height: THUMB_H }} />
        </span>
      ))}
    </span>
  );
});
