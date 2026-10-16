import { useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "@remotion/player";
import { SpecVideo } from "../../../src/engine/render/SpecVideo";
import { api, templateBase } from "../api";
import { analyzeSpec, type ParsedInfo } from "../lib/specInfo";
import { fmtTC } from "../lib/format";
import { useInView } from "./ui";

/** Specs fetched for thumbnails, shared across cards and visits. */
const specCache = new Map<string, Promise<ParsedInfo | null>>();
const loadInfo = (id: string) => {
  let p = specCache.get(id);
  if (!p) {
    p = api.project(id).then((s) => (s.spec ? analyzeSpec(s.spec) : null)).catch(() => null);
    specCache.set(id, p);
  }
  return p;
};
export const invalidateThumb = (id: string) => specCache.delete(id);
const loadTemplateInfo = (slug: string) => {
  const key = `tpl:${slug}`;
  let p = specCache.get(key);
  if (!p) {
    p = api.template(slug).then((t) => analyzeSpec({ ...t.spec, format: t.format })).catch(() => null);
    specCache.set(key, p);
  }
  return p;
};

/** A good poster frame: the middle of the scene after the hook (or the only scene), away from transitions. */
export const posterFrame = (info: ParsedInfo) => {
  const scenes = info.timeline.scenes;
  const sc = scenes[Math.min(scenes.length - 1, scenes.length > 2 ? 1 : 0)];
  const t = sc ? sc.start + sc.overlapIn + (sc.end - sc.start - sc.overlapIn) * 0.6 : info.seconds / 2;
  return Math.min(info.durationInFrames - 1, Math.round(t * info.fps));
};

/**
 * Live engine thumbnail of a project's film. Loads lazily when scrolled into view.
 * With `scrub`, hovering scrubs through the film by mouse x (no rendering, the engine draws the frame).
 */
export const SpecThumb = ({ projectId, template, poster: posterUrl, scrub, onInfo, empty }: {
  /** a project's film, or (with `template`) a gallery template's film served from /templates/<slug> */
  projectId?: string; template?: string; poster?: string;
  scrub?: boolean; onInfo?: (i: ParsedInfo | null) => void; empty?: React.ReactNode;
}) => {
  const [ref, seen] = useInView<HTMLDivElement>("300px");
  const [info, setInfo] = useState<ParsedInfo | null | undefined>(undefined);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!seen) return;
    let alive = true;
    void (template ? loadTemplateInfo(template) : loadInfo(projectId ?? "")).then((i) => { if (alive) { setInfo(i); onInfo?.(i); } });
    return () => { alive = false; };
  }, [seen, projectId, template]); // eslint-disable-line react-hooks/exhaustive-deps
  const inputProps = useMemo(() => (info
    ? { spec: info.raw as never, assetBase: template ? templateBase(template) : `${location.origin}/files/${projectId}`, projectId: template ? `tpl-${template}` : projectId }
    : null), [info, projectId, template]);
  const poster = info ? posterFrame(info) : 0;
  const frame = info && hover != null ? Math.round(hover * (info.durationInFrames - 1)) : poster;

  return (
    <div ref={ref} className={`spec-thumb ${hover != null ? "is-scrubbing" : ""}`}
      onPointerMove={scrub && info ? (e) => { const r = box.current!.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); } : undefined}
      onPointerLeave={() => setHover(null)}>
      <div ref={box} className="spec-thumb-box">
        {posterUrl && info !== null && <img className="spec-thumb-poster" src={posterUrl} alt="" aria-hidden />}
        {info === undefined && !posterUrl && <div className="thumb-loading" aria-label="Loading preview" />}
        {info === null && (empty ?? null)}
        {info && inputProps && (
          <Thumbnail component={SpecVideo} inputProps={inputProps} compositionWidth={info.width} compositionHeight={info.height}
            durationInFrames={info.durationInFrames} fps={info.fps} frameToDisplay={frame} style={{ width: "100%", height: "100%" }}
            errorFallback={() => <div className="thumb-loading is-error" />} />
        )}
      </div>
      {info && hover != null && (
        <>
          <span className="scrub-line" style={{ left: `${hover * 100}%` }} aria-hidden />
          <span className="scrub-tc mono">{fmtTC(frame / info.fps, info.fps)}</span>
        </>
      )}
    </div>
  );
};
