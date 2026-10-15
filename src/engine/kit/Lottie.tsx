import React, { useEffect, useState } from "react";
import { Sequence, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import type { z } from "zod";
import type { LottieLayer } from "../spec/schema";
import { useAsset } from "../core/context";

type Props = { layer: z.infer<typeof LottieLayer>; t: number; duration: number };

/**
 * Lottie animation from a JSON asset/URL. The JSON is fetched once; rendering is blocked
 * (delayRender) until it arrives so every frame is complete. Playback is re-zeroed to the
 * layer start with a local Sequence, so it starts at t=0 regardless of how the host nests us.
 */
export const LottieView: React.FC<Props> = ({ layer, t }) => {
  const asset = useAsset();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const url = asset(layer.src);
  const [data, setData] = useState<LottieAnimationData | null>(null);
  // Block the frame synchronously on first render (before any effect) until the JSON is in.
  const [handle] = useState(() => delayRender(`Loading Lottie ${layer.src}`));

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Lottie fetch failed (${r.status}): ${url}`);
        return r.json();
      })
      .then((json: LottieAnimationData) => {
        if (alive) setData(json);
        continueRender(handle);
      })
      .catch((err) => cancelRender(err instanceof Error ? err : new Error(String(err))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Default size: explicit width/height, else the animation's aspect ratio at 400px wide.
  const W = layer.width ?? (layer.height && data ? (layer.height * data.w) / data.h : 400);
  const H = layer.height ?? (data ? (W * data.h) / data.w : W);

  if (!data) return <div style={{ width: W, height: H }} />;

  // Shift a local timeline so the Lottie's internal frame == layer-local frame.
  const localFrom = frame - Math.round(t * fps);
  return (
    <div style={{ width: W, height: H }}>
      <Sequence from={localFrom} layout="none">
        <Lottie
          animationData={data}
          loop={layer.loopAnim ?? false}
          playbackRate={layer.speed ?? 1}
          style={{ width: W, height: H }}
        />
      </Sequence>
    </div>
  );
};
