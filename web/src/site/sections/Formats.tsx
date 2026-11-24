/**
 * One spec, every format: a pinned section whose frame springs between aspect ratios as you scroll, while the engine
 * reflows the same film into each one live (reflowSpec — what a multi-format render does) on a shared clock.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "@remotion/player";
import { SpecVideo } from "../../../../src/engine/render/SpecVideo";
import type { Format } from "../../api";
import type { ParsedInfo } from "../../lib/specInfo";
import { filmBase, loadFilmAs } from "../films";
import { clamp, onFrame, useFilmClock, useOnScreen, usePinProgress } from "../motion";

const SLUG = "event";
const STEPS: { f: Format; w: number; h: number; where: string }[] = [
  { f: "16:9", w: 1920, h: 1080, where: "YouTube · web · keynotes" },
  { f: "1:1", w: 1080, h: 1080, where: "Feed posts · LinkedIn" },
  { f: "9:16", w: 1080, h: 1920, where: "Reels · TikTok · Shorts" },
  { f: "4:5", w: 1080, h: 1350, where: "Instagram portrait" },
  { f: "21:9", w: 2520, h: 1080, where: "Cinema · hero banners" },
];

export const Formats = () => {
  const sec = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [films, setFilms] = useState<Partial<Record<Format, ParsedInfo>>>({});
  const [onRef, on] = useOnScreen<HTMLDivElement>(0.05);
  useEffect(() => {
    STEPS.forEach(({ f }) => void loadFilmAs(SLUG, f).then((i) => i && setFilms((m) => ({ ...m, [f]: i }))));
  }, []);
  const cur = STEPS[step];
  const info = films[cur.f] ?? films["16:9"];
  const frame = useFilmClock(info?.durationInFrames ?? 1, info?.fps ?? 30, on && !!info);

  // the frame's aspect springs toward the current step's (log space, so 21:9 ↔ 9:16 feels even)
  const target = useRef(Math.log(16 / 9));
  useEffect(() => { target.current = Math.log(cur.w / cur.h); }, [cur]);
  useEffect(() => {
    let a = target.current, v = 0;
    return onFrame((_, dt) => {
      const k = 190, c = 2 * Math.sqrt(k) * 0.62;
      v += (k * (target.current - a) - c * v) * dt;
      a += v * dt;
      const el = box.current, st = stage.current;
      if (!el || !st) return;
      const W = st.clientWidth, H = st.clientHeight, r = Math.exp(a);
      const w = Math.min(W, H * r), h = w / r;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    });
  }, []);

  usePinProgress(sec, (p) => setStep(Math.min(STEPS.length - 1, Math.floor(clamp(p * 1.08 - 0.04) * STEPS.length))), 0);

  const inputProps = useMemo(() => (info ? { spec: info.raw as never, assetBase: filmBase(SLUG), projectId: `site-${SLUG}-${cur.f}`, libraryBase: "" } : null), [info, cur.f]);
  return (
    <section ref={sec} className="formats" id="formats" aria-labelledby="fmt-t">
      <div ref={onRef} className="formats-pin">
        <div className="formats-copy site-wrap">
          <span className="label">04 · Every platform</span>
          <h2 id="fmt-t" className="sec-title">One spec. <em>Five formats.</em></h2>
          <p className="dim">The same film, reflowed by the engine as you scroll: type resizes, layouts restack, safe zones hold.</p>
        </div>
        <div ref={stage} className="formats-stage">
          <div ref={box} className="formats-box">
            <i className="fb tl" /><i className="fb tr" /><i className="fb bl" /><i className="fb br" />
            {info && inputProps && (
              <Thumbnail key={cur.f} component={SpecVideo} inputProps={inputProps} compositionWidth={info.width} compositionHeight={info.height}
                durationInFrames={info.durationInFrames} fps={info.fps} frameToDisplay={Math.min(frame, info.durationInFrames - 1)} style={{ width: "100%", height: "100%" }} />
            )}
          </div>
        </div>
        <div className="formats-readout site-wrap">
          <div className="formats-big mono" aria-live="polite"><span key={cur.f} className="formats-roll">{cur.f}</span></div>
          <div className="mono">{cur.w}×{cur.h}</div>
          <div className="dim">{cur.where}</div>
          <ol className="formats-steps" aria-hidden>
            {STEPS.map((s, i) => <li key={s.f} className={i === step ? "is-on" : i < step ? "is-past" : ""}>{s.f}</li>)}
          </ol>
        </div>
      </div>
    </section>
  );
};
