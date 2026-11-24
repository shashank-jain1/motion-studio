/**
 * Spec → film: a pinned section where a real scene's JSON types itself layer by layer while the engine plays the same
 * scene built from only the layers typed so far. Background first, then each card, the counter, the line.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "@remotion/player";
import { SpecVideo } from "../../../../src/engine/render/SpecVideo";
import { analyzeSpec, type ParsedInfo } from "../../lib/specInfo";
import { filmBase, loadRaw } from "../films";
import { clamp, span, useFilmClock, useOnScreen, usePinProgress } from "../motion";

const SLUG = "kit";
const SCENE = 1; // "kit": the chart, the counter, the donut

type Scene = { id?: string; duration?: unknown; background?: unknown; camera?: unknown; layers: Record<string, unknown>[] };

const STEPS = [
  { k: "Brief", d: "“Show what the director works with, as a chart. Real numbers.”" },
  { k: "Spec", d: "The director writes scenes and layers: plain JSON you can read and edit." },
  { k: "Look", d: "It renders frames, looks at them, fixes collisions and dead time." },
  { k: "Render", d: "MP4s for every platform, score and sound mixed in." },
];

export const Build = () => {
  const sec = useRef<HTMLElement>(null);
  const code = useRef<HTMLPreElement>(null);
  const [base, setBase] = useState<{ raw: Record<string, unknown>; scene: Scene } | null>(null);
  const [n, setN] = useState(0); // layers shown
  const [typed, setTyped] = useState(0); // characters typed
  const [onRef, on] = useOnScreen<HTMLDivElement>(0.05);

  useEffect(() => {
    void loadRaw(SLUG).then((raw) => {
      const { transition: _t, ...scene } = (raw.scenes as (Scene & { transition?: unknown })[])[SCENE];
      setBase({ raw, scene });
    });
  }, []);

  const blocks = useMemo(() => {
    if (!base) return [] as string[];
    const { layers, ...rest } = base.scene;
    const head = JSON.stringify({ id: rest.id, duration: rest.duration, background: rest.background }, null, 2).replace(/\n}$/, ",\n  \"layers\": [");
    return [head, ...layers.map((l, i) => "\n" + JSON.stringify(l, null, 2).split("\n").map((x) => "    " + x).join("\n") + (i < layers.length - 1 ? "," : ""))];
  }, [base]);
  const full = blocks.join("");
  const cuts = useMemo(() => blocks.reduce<number[]>((acc, b) => [...acc, (acc.at(-1) ?? 0) + b.length], []), [blocks]);

  usePinProgress(sec, (p) => {
    if (!cuts.length) return;
    const total = cuts.at(-1)!;
    const c = Math.round(span(p, 0.05, 0.85) * total);
    setTyped(c);
    setN(Math.max(0, cuts.filter((x) => x <= c).length - 1));
  }, 0.1);
  useEffect(() => { if (code.current) code.current.scrollTop = code.current.scrollHeight; }, [typed]);

  const info: ParsedInfo | null = useMemo(() => {
    if (!base) return null;
    try {
      const { actors: _a, sound: _s, sfx: _x, ...rest } = base.raw;
      return analyzeSpec({ ...rest, format: "16:9", scenes: [{ ...base.scene, layers: base.scene.layers.slice(0, n) }] });
    } catch { return null; }
  }, [base, n]);
  const frame = useFilmClock(info?.durationInFrames ?? 1, info?.fps ?? 30, on && !!info);
  const inputProps = useMemo(() => (info ? { spec: info.raw as never, assetBase: filmBase(SLUG), projectId: `site-build-${n}`, libraryBase: "" } : null), [info, n]);
  const stepIdx = Math.min(3, Math.floor(clamp(typed / Math.max(1, cuts.at(-1) ?? 1)) * 3.999));

  return (
    <section ref={sec} className="build" id="how" aria-labelledby="build-t">
      <div ref={onRef} className="build-pin site-wrap">
        <header className="build-head">
          <span className="label">05 · How it works</span>
          <h2 id="build-t" className="sec-title">The spec <em>is</em> the film.</h2>
          <ol className="build-steps">
            {STEPS.map((s, i) => (
              <li key={s.k} className={i === stepIdx ? "is-on" : i < stepIdx ? "is-past" : ""}>
                <span className="mono">{String(i + 1).padStart(2, "0")}</span>
                <div><b>{s.k}</b><p>{s.d}</p></div>
              </li>
            ))}
          </ol>
        </header>
        <div className="build-code">
          <div className="build-bar"><span className="label">spec.json</span><span className="mono dim">scene 02 · {n}/{base?.scene.layers.length ?? 0} layers</span></div>
          <pre ref={code} className="mono" aria-label="Scene Spec being written"><code>{full.slice(0, typed)}<i className="build-caret" /></code></pre>
        </div>
        <div className="build-film">
          <div className="build-frame">
            {info && inputProps && (
              <Thumbnail component={SpecVideo} inputProps={inputProps} compositionWidth={info.width} compositionHeight={info.height}
                durationInFrames={info.durationInFrames} fps={info.fps} frameToDisplay={Math.min(frame, info.durationInFrames - 1)} style={{ width: "100%", height: "100%" }} />
            )}
          </div>
          <div className="build-meta mono"><span className="nle-dot" /> engine · {n === 0 ? "background" : `${n} layer${n > 1 ? "s" : ""}`}</div>
        </div>
      </div>
    </section>
  );
};
