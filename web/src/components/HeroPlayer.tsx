import { useEffect, useMemo, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { SpecVideo } from "../../../src/engine/render/SpecVideo";
import { analyzeSpec } from "../lib/specInfo";
import { makeHeroSpec, type HeroFormat } from "../hero-spec";
import { fmtTC } from "../lib/format";
import { CropMarks, TallyDot, useReducedMotion } from "./ui";

/** The product's showreel, played live by our own engine. */
export const HeroPlayer = ({ format = "16:9", className, readout = true }: { format?: HeroFormat; className?: string; readout?: boolean }) => {
  const info = useMemo(() => analyzeSpec(makeHeroSpec(format) as Record<string, unknown>), [format]);
  const reduced = useReducedMotion();
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [frame, setFrame] = useState(0);
  const inputProps = useMemo(() => ({ spec: info.raw as never }), [info]);

  useEffect(() => {
    if (!player) return;
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener("frameupdate", on);
    if (reduced) { player.pause(); player.seekTo(Math.round(info.durationInFrames * 0.86)); }
    else player.play();
    return () => player.removeEventListener("frameupdate", on);
  }, [player, reduced, info]);

  const t = frame / info.fps;
  const scene = info.timeline.scenes.findIndex((s) => t >= s.start && t < s.end);
  const sc = info.timeline.scenes[Math.max(0, scene)];
  return (
    <figure className={`hero-player ${className ?? ""}`} aria-label="Motion Studio showreel, rendered live by the engine">
      <div className="hero-frame" style={{ aspectRatio: `${info.width} / ${info.height}` }}>
        <CropMarks inset={-12} />
        <Player
          ref={setPlayer}
          component={SpecVideo}
          inputProps={inputProps}
          durationInFrames={info.durationInFrames}
          fps={info.fps}
          compositionWidth={info.width}
          compositionHeight={info.height}
          style={{ width: "100%", height: "100%" }}
          controls={false}
          loop
          autoPlay={!reduced}
          initiallyMuted
          clickToPlay={false}
        />
      </div>
      {readout && (
        <figcaption className="hero-readout">
          <TallyDot live={!reduced} />
          <span className="label">Live · engine</span>
          <span className="mono tc">{fmtTC(t, info.fps)}</span>
          <span className="mono dim">SC {String(Math.max(0, scene) + 1).padStart(2, "0")} {sc?.id?.toUpperCase()}</span>
          <span className="spacer" />
          <span className="mono dim">{info.width}×{info.height} · {info.fps} FPS</span>
        </figcaption>
      )}
    </figure>
  );
};
