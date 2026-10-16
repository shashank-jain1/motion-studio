import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "./context";
import { IconFit, IconLayers, IconPlus } from "../components/Icons";
import { fmtTime } from "../lib/format";

const HEAD_W = 92; // track label column
const MIN_PPS = 8;
const MAX_PPS = 600;

/** Scene/actor timeline under the Player: proportional blocks, transition overlaps, playhead synced with the bus. */
export const TimelinePanel = () => {
  const { info, bus, selectedScene, selectScene, serverTimeline } = useStudio();
  const timeline = info?.timeline ?? serverTimeline;
  const scenesMeta = info?.scenes;
  const total = Math.max(0.1, timeline?.total ?? 0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const [pps, setPps] = useState<number | null>(null); // null = zoom-to-fit
  const fitPps = viewW > 0 ? Math.max(MIN_PPS, (viewW - 24) / total) : 60;
  const scale = pps ?? fitPps;
  const contentW = Math.max(viewW, total * scale + 24);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const timeAt = useCallback((clientX: number) => {
    const sc = scrollRef.current!;
    const r = sc.getBoundingClientRect();
    return Math.max(0, Math.min(total, (clientX - r.left + sc.scrollLeft) / scale));
  }, [scale, total]);
  const seekTime = useCallback((t: number) => bus.seek(t * (bus.fps || fps)), [bus, fps]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !timeline) return;
    const target = e.target as HTMLElement;
    const sceneEl = target.closest<HTMLElement>("[data-scene]");
    if (sceneEl) selectScene(Number(sceneEl.dataset.scene), { scrollEditor: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    bus.player?.pause();
    seekTime(timeAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) seekTime(timeAt(e.clientX));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const sc = scrollRef.current!;
    const t = timeAt(e.clientX);
    const next = Math.max(MIN_PPS, Math.min(MAX_PPS, scale * Math.exp(-e.deltaY * 0.004)));
    setPps(next);
    requestAnimationFrame(() => { sc.scrollLeft = t * next - (e.clientX - sc.getBoundingClientRect().left); });
  };
  // React's wheel listener is passive; block page zoom on ctrl+wheel natively
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, []);

  const ticks = useMemo(() => {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const major = steps.find((s) => s * scale >= 64) ?? 60;
    const minor = steps.filter((s) => s < major).reverse().find((s) => s * scale >= 10 && (major / s) % 1 === 0) ?? major;
    const out: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= total + 1e-6; t += minor) out.push({ t: +t.toFixed(4), major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
    return { list: out, major };
  }, [scale, total]);

  const actors = timeline?.actors ?? [];
  const zoomBy = (k: number) => setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, scale * k)));

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <span className="panel-title"><IconLayers size={13} />Timeline</span>
        {timeline && <span className="muted mono small">{timeline.scenes.length} scenes · {fmtTime(total)}</span>}
        <div className="spacer" />
        <div className="zoom">
          <button className="icon-btn ghost xs" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out" title="Zoom out (Ctrl+wheel)"><span className="minus" /></button>
          <button className="icon-btn ghost xs" onClick={() => zoomBy(1.5)} aria-label="Zoom in" title="Zoom in (Ctrl+wheel)"><IconPlus size={12} /></button>
          <button className={`icon-btn ghost xs ${pps == null ? "is-on" : ""}`} onClick={() => setPps(null)} aria-label="Zoom to fit" title="Zoom to fit"><IconFit size={13} /></button>
        </div>
      </div>
      {!timeline ? (
        <div className="timeline-empty">
          {Array.from({ length: 5 }, (_, i) => <span key={i} style={{ flex: [1.2, 0.8, 1.5, 1, 0.7][i] }} />)}
        </div>
      ) : (
        <div className="timeline-body">
          <div className="track-heads" style={{ width: HEAD_W }}>
            <div className="track-head ruler-head" />
            <div className="track-head scenes-head">Scenes</div>
            {actors.map((a) => <div key={a.id} className="track-head actor-head" title={`Actor “${a.id}” — persists across cuts`}><i />{a.id}</div>)}
          </div>
          <div className="timeline-scroll" ref={scrollRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onWheel={onWheel}>
            <div className="timeline-content" style={{ width: contentW }}>
              <div className="ruler">
                {ticks.list.map((tk) => (
                  <div key={tk.t} className={`tick ${tk.major ? "major" : ""}`} style={{ transform: `translateX(${tk.t * scale}px)` }}>
                    {tk.major && <span>{ticks.major < 1 ? tk.t.toFixed(ticks.major < 0.5 ? 2 : 1) : `${Math.round(tk.t)}s`}</span>}
                  </div>
                ))}
              </div>
              <div className="track scene-track">
                {timeline.scenes.map((sc, i) => {
                  const meta = scenesMeta?.[i];
                  const left = sc.start * scale;
                  const w = Math.max(2, (sc.end - sc.start) * scale);
                  return (
                    <div key={i} data-scene={i}
                      className={`scene-block hue-${i % 6} ${selectedScene === i ? "is-selected" : ""} ${w < 60 ? "is-narrow" : ""}`}
                      style={{ transform: `translateX(${left}px)`, width: w, paddingLeft: sc.overlapIn > 0 && w > 60 ? Math.min(w / 2, sc.overlapIn * scale + 8) : undefined }}
                      title={`${sc.id ?? `Scene ${i + 1}`} · ${fmtTime(sc.start)} → ${fmtTime(sc.end)}${meta?.notes ? `\n${meta.notes}` : ""}`}
                      onDoubleClick={() => selectScene(i, { scrollEditor: true })}>
                      <span className="scene-label">{sc.id ?? `Scene ${i + 1}`}</span>
                      <span className="scene-meta">
                        <span>{+(sc.end - sc.start).toFixed(2)}s</span>
                        {meta && <span className="layers" title={`${meta.layers} layers`}><IconLayers size={10} />{meta.layers}</span>}
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
                        <span className="join-tip">{tr ?? "transition"} · {+sc.overlapIn.toFixed(2)}s</span>
                      </div>
                    );
                  }
                  return (
                    <div key={`c${i}`} className={`cut ${tr ? "has-tr" : ""}`} style={{ transform: `translateX(${sc.start * scale}px)` }}>
                      <span className="join-tip">{tr ?? "cut"}</span>
                    </div>
                  );
                })}
              </div>
              {actors.map((a) => (
                <div key={a.id} className="track actor-track">
                  <div className="actor-bar" style={{ transform: `translateX(${a.from * scale}px)`, width: Math.max(4, (a.until - a.from) * scale) }} title={`${a.id}: ${fmtTime(a.from)} → ${fmtTime(a.until)}`}>
                    <span>{a.id}</span>
                  </div>
                </div>
              ))}
              <div className="playhead" ref={playheadRef}><div className="playhead-knob" /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
