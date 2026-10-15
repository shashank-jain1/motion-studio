import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { SpecSchema, FORMATS, type Spec, type SpecInput } from "../spec/schema";
import { DEFAULT_STYLE, STYLES } from "../spec/styles";
import { EASING } from "../core/animate";
import { RuntimeProvider, resolveColor, type RuntimeContext } from "../core/context";
import { ChromaticWrap, FxOverlay } from "../kit/Fx";
import { SceneView } from "./Scene";
import { getPresentation, transitionSeconds } from "./transitions";

export type SpecVideoProps = { spec: SpecInput; assetBase?: string; projectId?: string };

export const resolveSize = (spec: Pick<Spec, "format" | "width" | "height">) => {
  const [fw, fh] = FORMATS[spec.format ?? "16:9"];
  return { width: spec.width ?? fw, height: spec.height ?? fh };
};

/** Total seconds: scenes minus transition overlaps. */
export const specSeconds = (spec: Spec) =>
  spec.scenes.reduce((acc, s, i) => acc + s.duration - (i > 0 ? transitionSeconds(s.transition) : 0), 0);

export const parseSpec = (input: SpecInput): Spec => {
  const r = SpecSchema.safeParse(input);
  if (!r.success) throw new Error("Invalid spec: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};

/** Video-wide finishing FX (grain, vignette, letterbox…) on top of all scenes and transitions. */
const GlobalFx: React.FC<{ fx: React.ComponentProps<typeof FxOverlay>["fx"]; duration: number }> = ({ fx, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return <FxOverlay fx={fx} t={frame / fps} duration={duration} />;
};

const ErrorCard: React.FC<{ message: string }> = ({ message }) => (
  <AbsoluteFill style={{ background: "#1a0010", color: "#ff8fb1", fontFamily: "monospace", fontSize: 28, padding: 60, whiteSpace: "pre-wrap" }}>{message}</AbsoluteFill>
);

export const SpecVideo: React.FC<SpecVideoProps> = ({ spec: input, assetBase, projectId }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const parsed = useMemo(() => { try { return { spec: parseSpec(input) }; } catch (e) { return { error: (e as Error).message }; } }, [input]);
  if ("error" in parsed) return <ErrorCard message={parsed.error!} />;
  const spec = parsed.spec;

  const style = STYLES[spec.style ?? DEFAULT_STYLE] ?? STYLES[DEFAULT_STYLE];
  const rt: RuntimeContext = {
    colors: { ...style.colors, ...(spec.theme?.colors ?? {}) },
    fonts: { ...style.fonts, ...(spec.theme?.fonts ?? {}) } as RuntimeContext["fonts"],
    assetBase, projectId, width, height, fps,
  };
  const fx = { ...(style.fx ?? {}), ...(spec.fx ?? {}) };
  const asset = (src: string) => {
    if (/^(https?:|data:)/.test(src)) return src;
    const clean = src.replace(/^\.?\//, "");
    if (assetBase) return `${assetBase.replace(/\/$/, "")}/${clean}`;
    return staticFile(projectId ? `${projectId}/${clean}` : clean);
  };

  const series: React.ReactNode[] = [];
  spec.scenes.forEach((scene, i) => {
    if (i > 0 && scene.transition) {
      const pres = getPresentation(scene.transition, width, height, (c) => resolveColor(rt, c));
      const secs = transitionSeconds(scene.transition);
      if (pres && secs > 0) {
        series.push(
          <TransitionSeries.Transition key={`t${i}`} presentation={pres}
            timing={linearTiming({ durationInFrames: Math.max(1, Math.round(secs * fps)), easing: EASING[scene.transition.ease ?? "inOutQuint"] })} />,
        );
      }
    }
    series.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={Math.max(1, Math.round(scene.duration * fps))} name={scene.id ?? `scene-${i + 1}`}>
        <SceneView scene={scene} />
      </TransitionSeries.Sequence>,
    );
  });

  const total = durationInFrames / fps;
  const a = spec.audio;
  return (
    <RuntimeProvider value={rt}>
      <AbsoluteFill style={{ background: resolveColor(rt, "$bg") }}>
        <ChromaticWrap px={fx.chromatic ?? 0}>
          <TransitionSeries>{series}</TransitionSeries>
        </ChromaticWrap>
        <GlobalFx fx={{ ...fx, chromatic: undefined }} duration={total} />
        {a && (
          <Audio src={asset(a.src)} trimBefore={a.trimStart ? Math.round(a.trimStart * fps) : undefined}
            volume={(f) => {
              const s = f / fps;
              const fin = a.fadeIn ? interpolate(s, [0, a.fadeIn], [0, 1], { extrapolateRight: "clamp" }) : 1;
              const fout = a.fadeOut ? interpolate(s, [total - a.fadeOut, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
              return (a.volume ?? 1) * fin * fout;
            }} />
        )}
        {spec.sfx?.map((s, i) => (
          <Sequence key={i} from={Math.round(s.at * fps)} layout="none"><Audio src={asset(s.src)} volume={s.volume ?? 1} /></Sequence>
        ))}
      </AbsoluteFill>
    </RuntimeProvider>
  );
};
