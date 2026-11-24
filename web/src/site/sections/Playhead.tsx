/**
 * "Scroll is the playhead": a pinned section where page scroll scrubs a template film frame by frame through the live
 * engine, under the studio's own NLE — one track per layer (from the spec's timings), ruler, playhead, timecode and an
 * inspector listing the layers on screen at that frame.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "@remotion/player";
import { SpecVideo } from "../../../../src/engine/render/SpecVideo";
import { fmtTC } from "../../lib/format";
import type { ParsedInfo } from "../../lib/specInfo";
import { filmBase, loadFilmAs } from "../films";
import { span, usePinProgress } from "../motion";

const SLUG = "fintech";
const MAX_TRACKS = 9;

type Clip = { label: string; kind: string; start: number; end: number; track: number };

const labelOf = (l: Record<string, unknown>) => {
  const t = typeof l.text === "string" ? l.text.replace(/\s+/g, " ").trim() : "";
  if (t) return `“${t.length > 22 ? t.slice(0, 21) + "…" : t}”`;
  return (l.id as string | undefined) ?? (l.preset as string | undefined) ?? (l.shape as string | undefined) ?? String(l.type);
};

/** Every layer as a clip on the film's clock, packed greedily onto as few tracks as fit. */
const clipsOf = (info: ParsedInfo): Clip[] => {
  const ends: number[] = [];
  const out: Clip[] = [];
  info.spec.scenes.forEach((sc, i) => {
    const slot = info.timeline.scenes[i];
    if (!slot) return;
    for (const l of sc.layers as unknown as Record<string, unknown>[]) {
      const start = slot.start + (Number(l.start) || 0);
      const end = Math.min(slot.end, l.duration != null ? start + Number(l.duration) : slot.end);
      if (end - start < 0.05) continue;
      let track = ends.findIndex((e) => e <= start + 0.02);
      if (track < 0) { track = ends.length; ends.push(0); }
      ends[track] = end;
      out.push({ label: labelOf(l), kind: String(l.type), start, end, track });
    }
  });
  return out.filter((c) => c.track < MAX_TRACKS);
};

export const Playhead = () => {
  const sec = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<ParsedInfo | null>(null);
  const [frame, setFrame] = useState(0);
  useEffect(() => { void loadFilmAs(SLUG, "16:9").then(setInfo); }, []);
  const clips = useMemo(() => (info ? clipsOf(info) : []), [info]);
  const tracks = Math.max(1, ...clips.map((c) => c.track + 1));
  const inputProps = useMemo(() => (info ? { spec: info.raw as never, assetBase: filmBase(SLUG), projectId: `site-${SLUG}-scrub`, libraryBase: "" } : null), [info]);

  usePinProgress(sec, (p) => {
    if (!info) return;
    const play = span(p, 0.12, 0.96);
    const f = Math.min(info.durationInFrames - 1, Math.round(play * (info.durationInFrames - 1)));
    setFrame(f);
    if (head.current) head.current.style.left = `${play * 100}%`;
    if (intro.current) {
      const o = 1 - span(p, 0.1, 0.18);
      intro.current.style.opacity = String(o);
      intro.current.style.transform = `translateY(${(1 - o) * -40}px)`;
    }
  }, 0.12);

  const t = info ? frame / info.fps : 0;
  const live = clips.filter((c) => t >= c.start && t < c.end);
  const sceneIdx = info ? Math.max(0, info.timeline.scenes.findIndex((s) => t >= s.start && t < s.end)) : 0;
  const scene = info?.timeline.scenes[sceneIdx];

  return (
    <section ref={sec} className="scrub" id="playhead" aria-labelledby="scrub-t">
      <div className="scrub-pin">
        <div className="scrub-monitor">
          <div className="scrub-stage"><div className="scrub-screen">
            {info && inputProps && (
              <Thumbnail component={SpecVideo} inputProps={inputProps} compositionWidth={info.width} compositionHeight={info.height}
                durationInFrames={info.durationInFrames} fps={info.fps} frameToDisplay={frame} style={{ width: "100%", height: "100%" }} />
            )}
            <div ref={intro} className="scrub-intro">
              <span className="label">02 · Scroll is the playhead</span>
              <h2 id="scrub-t" className="sec-title">Every frame, <em>drawn live.</em></h2>
              <p>This film isn't a video. It's a spec, and the engine is drawing whichever frame your scroll points at — right now, in your browser.</p>
            </div>
          </div></div>
          <aside className="scrub-inspector mono" aria-label="Layers on screen">
            <div className="label">Inspector</div>
            <div className="scrub-kv"><span>Scene</span><b>{String(sceneIdx + 1).padStart(2, "0")} {scene?.id?.toUpperCase()}</b></div>
            <div className="scrub-kv"><span>Frame</span><b>{String(frame).padStart(4, "0")}</b></div>
            <div className="scrub-kv"><span>On screen</span><b>{live.length} layers</b></div>
            <ul>
              {live.slice(0, 7).map((c, i) => <li key={`${c.track}-${c.start}-${i}`}><span className="scrub-kind">{c.kind}</span>{c.label}</li>)}
            </ul>
          </aside>
        </div>
        <div className="nle" aria-hidden>
          <div className="nle-bar">
            <span className="nle-dot" />
            <span className="mono nle-tc">{fmtTC(t, info?.fps ?? 30)}</span>
            <span className="mono dim">{info ? `${info.width}×${info.height} · ${info.fps} FPS · ${info.seconds.toFixed(1)}s` : ""}</span>
            <span className="spacer" />
            <span className="label">Scroll ↕ to scrub</span>
          </div>
          <div className="nle-body">
            <div className="nle-ruler">
              {info && Array.from({ length: Math.floor(info.seconds) + 1 }, (_, s) => (
                <span key={s} style={{ left: `${(s / info.seconds) * 100}%` }}><i />{s}s</span>
              ))}
            </div>
            <div className="nle-scenes">
              {info?.timeline.scenes.map((s, i) => (
                <span key={i} className={i === sceneIdx ? "is-on" : ""} style={{ left: `${(s.start / info.seconds) * 100}%`, width: `${((s.end - s.start) / info.seconds) * 100}%` }}>
                  {String(i + 1).padStart(2, "0")} {s.id}
                </span>
              ))}
            </div>
            <div className="nle-tracks" style={{ "--tracks": tracks } as React.CSSProperties}>
              {info && clips.map((c, i) => (
                <span key={i} className={`nle-clip k-${c.kind} ${t >= c.start && t < c.end ? "is-live" : ""}`}
                  style={{ left: `${(c.start / info.seconds) * 100}%`, width: `${((c.end - c.start) / info.seconds) * 100}%`, top: `calc(${c.track} * var(--row))` }}>
                  {c.label}
                </span>
              ))}
            </div>
            <div ref={head} className="nle-head"><i /></div>
          </div>
        </div>
      </div>
    </section>
  );
};
