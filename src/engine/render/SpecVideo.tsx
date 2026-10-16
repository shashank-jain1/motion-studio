import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { SpecSchema, FORMATS, type Layer, type Scene, type Spec, type SpecInput } from "../spec/schema";
import { preprocessSpecDetailed, sceneIndexOf, sceneTimeline } from "../spec/preprocess";
import { DEFAULT_STYLE, STYLES } from "../spec/styles";
import { EASING, evalKeyframes } from "../core/animate";
import { RuntimeProvider, resolveColor, type RuntimeContext } from "../core/context";
import { ChromaticWrap, FxOverlay } from "../kit/Fx";
import { SceneView, evalCamera } from "./Scene";
import { getPresentation, transitionEase, transitionSeconds, type TransitionOrigin } from "./transitions";
import { ActorsLayer, actorPoseAt, findSnapLayer, resolveActor, type ResolvedActor, type SnapCtx } from "./Actors";
import { type LogoAnalysis, logoJsonPath, useJsonAssets } from "../shapes/resolve";

export type SpecVideoProps = { spec: SpecInput; assetBase?: string; projectId?: string };

export const resolveSize = (spec: Pick<Spec, "format" | "width" | "height">) => {
  const [fw, fh] = FORMATS[spec.format ?? "16:9"];
  return { width: spec.width ?? fw, height: spec.height ?? fh };
};

/**
 * Total seconds: scenes minus transition overlaps, counted in whole frames exactly as the TransitionSeries lays
 * them out (so the composition never gains/loses a frame to rounding). Same as src/core computeTimeline up to rounding.
 */
export const specSeconds = (spec: Spec) => sceneTimeline(spec.scenes, spec.fps).totalFrames / spec.fps;

/** Validate a spec (beat-time strings like "beat:12" are converted to seconds first, see spec/preprocess.ts). */
export const parseSpec = (input: SpecInput | unknown): Spec => {
  const pre = preprocessSpecDetailed(input);
  const r = SpecSchema.safeParse(pre.spec);
  if (!r.success) {
    throw new Error("Invalid spec: " + [...pre.errors, ...r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)].join("; "));
  }
  return r.data;
};

// --- Content-aware transition origins -------------------------------------------------------

type Found = { layer: Layer; x: number; y: number; start: number };
const findLayer = (layers: Layer[], id: string, ox = 0, oy = 0, start = 0): Found | null => {
  for (const l of layers) {
    if (l.id === id) return { layer: l, x: ox, y: oy, start };
    if (l.type === "group") {
      const hit = findLayer(l.layers, id, ox + (l.x ?? 0), oy + (l.y ?? 0), start + (l.start ?? 0));
      if (hit) return hit;
    }
  }
  return null;
};

/** Approximate on-screen box of a layer (base size × scale), used as the origin of expand / zoom-into. */
const layerBox = (l: Layer, frameW: number): { w: number; h: number } => {
  if (l.type === "text") {
    const fs = l.fontSize ?? 120;
    const lines = (l.uppercase ? l.text.toUpperCase() : l.text).split("\n");
    const longest = Math.max(...lines.map((s) => s.length));
    const w = Math.min(l.maxWidth ?? l.width ?? Infinity, fs * 0.56 * longest, frameW * 0.9);
    return { w, h: l.height ?? fs * (l.lineHeight ?? 1.08) * lines.length };
  }
  const w = l.width ?? (l.type === "shape" || l.type === "morph" || l.type === "logo" ? 200 : 400);
  return { w, h: l.height ?? w };
};

const resolveOrigin = (prev: Scene, fromId: string, sceneLocalT: number, frameW: number): TransitionOrigin | null => {
  const hit = findLayer(prev.layers, fromId);
  if (!hit) return null;
  const l = hit.layer;
  const lt = sceneLocalT - hit.start - (l.start ?? 0);
  const kf = evalKeyframes(l.animate, Math.max(0, lt));
  const scale = (l.scale ?? 1) * (kf.scale ?? 1);
  const x = hit.x + (l.x ?? 0) + (kf.x ?? 0);
  const y = hit.y + (l.y ?? 0) + (kf.y ?? 0);
  const box = layerBox(l, frameW);
  // scene camera (top-level parallax: screen = zoom·(p − cam·depth))
  const cam = evalCamera(prev.camera?.keyframes, sceneLocalT);
  const depth = l.depth ?? 1;
  const zoom = 1 + (cam.zoom - 1) * depth;
  return { x: zoom * (x - cam.x * depth), y: zoom * (y - cam.y * depth), w: box.w * scale * zoom, h: box.h * scale * zoom };
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

  return (
    <RuntimeProvider value={rt}>
      <SpecBody spec={spec} rt={rt} fx={fx} asset={asset} />
    </RuntimeProvider>
  );
};

/** Everything that needs the runtime context (asset/JSON loading for actor snapTo, scenes, actors, audio). */
const SpecBody: React.FC<{ spec: Spec; rt: RuntimeContext; fx: Record<string, any>; asset: (src: string) => string }> = ({ spec, rt, fx, asset }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();

  // Logo analyses needed by actor poses that snapTo a logo layer
  const snapLogoSrcs = useMemo(() => {
    const out = new Set<string>();
    for (const a of spec.actors ?? []) for (const p of a.poses) {
      if (!p.snapTo) continue;
      const hit = findSnapLayer(spec.scenes, Math.max(0, sceneIndexOf(spec.scenes, p.scene)), p.snapTo);
      if (hit?.layer.type === "logo" && /\.svg(\?|#|$)/i.test(hit.layer.src)) out.add(hit.layer.src);
    }
    return [...out];
  }, [spec]);
  const logos = useJsonAssets(snapLogoSrcs.map(logoJsonPath));
  const total = durationInFrames / fps;
  const slots = useMemo(() => sceneTimeline(spec.scenes, fps).scenes, [spec, fps]);
  // Resolved once per spec (+ when logo analyses arrive): snapTo can emit one keyframe per frame while following a camera.
  const actors: ResolvedActor[] = useMemo(() => {
    const snap: SnapCtx = { fps, getLogo: (src) => (logos.ready ? logos.get<LogoAnalysis>(logoJsonPath(src)) : null) };
    return (spec.actors ?? []).map((a, i) => resolveActor(a, i, spec, slots, total, snap)).filter((a): a is ResolvedActor => !!a);
  }, [spec, slots, total, fps, logos.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const series: React.ReactNode[] = [];
  spec.scenes.forEach((scene, i) => {
    if (i > 0 && scene.transition) {
      const tr = scene.transition;
      const secs = transitionSeconds(tr);
      let origin: TransitionOrigin | undefined;
      if (tr.from && (tr.type === "expand" || tr.type === "zoom-into")) {
        const prev = spec.scenes[i - 1];
        const localT = Math.max(0, prev.duration - secs); // where scene A is when the transition starts
        origin = resolveOrigin(prev, tr.from, localT, width) ?? undefined;
        if (!origin) {
          const ai = sceneIndexOf(actors.map((a) => ({ id: a.actor.id })), tr.from);
          if (ai >= 0) origin = actorPoseAt(actors[ai], slots[i].start);
        }
      }
      const pres = getPresentation(tr, width, height, (c) => resolveColor(rt, c), origin);
      if (pres && secs > 0) {
        series.push(
          <TransitionSeries.Transition key={`t${i}`} presentation={pres}
            timing={linearTiming({ durationInFrames: Math.max(1, Math.round(secs * fps)), easing: EASING[transitionEase(tr)] })} />,
        );
      }
    }
    series.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={Math.max(1, Math.round(scene.duration * fps))} name={scene.id ?? `scene-${i + 1}`}>
        <SceneView scene={scene} />
      </TransitionSeries.Sequence>,
    );
  });

  const a = spec.audio;
  return (
      <AbsoluteFill style={{ background: resolveColor(rt, "$bg") }}>
        <ChromaticWrap px={fx.chromatic ?? 0}>
          <TransitionSeries>{series}</TransitionSeries>
          <ActorsLayer actors={actors} width={width} height={height} />
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
  );
};
