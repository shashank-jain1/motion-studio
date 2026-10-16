/**
 * Actors: persistent hero elements rendered ABOVE the TransitionSeries for the whole video (shared-element continuity,
 * "one object never leaves the frame"). Each actor is any layer plus a list of poses pinned to scene times; the poses
 * become keyframes on a full-canvas wrapper so the actor travels pose → pose straight through every cut and transition.
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import type { z } from "zod";
import type { ActorSchema, Keyframe, Layer, Spec } from "../spec/schema";
import { evalKeyframes } from "../core/animate";
import { ContainerProvider } from "../core/container";
import { sceneIndexOf, type SceneSlot } from "../spec/preprocess";
import type { LogoAnalysis } from "../shapes/resolve";
import { type PartSelect, logoBoxSize, logoView, parsePartSelect, subsetBBox, subsetOffset } from "../shapes/logoLayout";
import { cameraAt, cameraMoves } from "./Scene";
import { LayerList } from "./LayerList";

export type Actor = z.infer<typeof ActorSchema>;
type PoseProp = "x" | "y" | "scale" | "rotate" | "opacity" | "blur";
const POSE_PROPS: PoseProp[] = ["x", "y", "scale", "rotate", "opacity", "blur"];

export type ResolvedActor = {
  actor: Actor;
  /** global seconds */
  start: number;
  end: number;
  /** keyframes relative to `start` */
  keyframes: Keyframe[];
  /** the wrapper layer handed to LayerList */
  layer: Layer;
};

/** What snapTo needs from the renderer: loaded logo analyses (by asset src) and the frame rate. */
export type SnapCtx = { getLogo: (src: string) => LogoAnalysis | null; fps: number };

type Pose = Actor["poses"][number];
type SnapTarget = { at: (tau: number) => { x: number; y: number; scale: number }; sceneIdx: number };

const findLayerById = (layers: Layer[], id: string): Layer | null => layers.find((l) => l.id === id) ?? null;

/** Logo layer referenced by "<layerId>[#sel]": the pose's scene first, then any scene. */
export const findSnapLayer = (scenes: Pick<Spec, "scenes">["scenes"], sceneIdx: number, ref: string) => {
  const lid = ref.split("#")[0];
  const order = [sceneIdx, ...scenes.map((_, i) => i).filter((i) => i !== sceneIdx)];
  for (const i of order) {
    const l = findLayerById(scenes[i]?.layers ?? [], lid);
    if (l) return { layer: l, sceneIdx: i };
  }
  return null;
};

/** The morph shape an actor shows at local time tl (the one being morphed into, or formed). */
const activeShape = (layer: Layer, tl: number) => {
  if (layer.type !== "morph") return null;
  const steps = [...layer.shapes].sort((a, b) => a.at - b.at);
  let cur = steps[0];
  for (const st of steps) if (tl >= st.at - (st.morph ?? 0.7)) cur = st;
  return cur;
};

const svgSource = (shape: string | undefined) => {
  const m = shape?.match(/^svg:([^#]+)(?:#(.+))?$/);
  return m ? { file: m[1].replace(/^\.?\//, ""), sel: parsePartSelect(m[2]) } : null;
};

/**
 * Solve the pose that puts the actor exactly on a logo layer's part subset, as a function of that scene's local time
 * (so the actor can follow the scene camera). Uses the same layout math as the Logo renderer (shapes/logoLayout.ts).
 */
const resolveSnap = (spec: Pick<Spec, "scenes">, poseScene: number, ref: string, actorLayer: Layer, actorLocalT: number, ctx: SnapCtx): SnapTarget | null => {
  const hit = findSnapLayer(spec.scenes, poseScene, ref);
  if (!hit || hit.layer.type !== "logo") return null;
  const logoLayer = hit.layer;
  const logo = ctx.getLogo(logoLayer.src);
  if (!logo?.parts?.length) return null;
  const file = logoLayer.src.replace(/^\.?\//, "");

  // which parts: explicit "#…", else whatever logo subset the actor's morph is showing, else the whole logo
  const shown = svgSource(activeShape(actorLayer, actorLocalT)?.shape);
  const sameLogo = !!shown && shown.file === file;
  const explicit = ref.includes("#") ? parsePartSelect(ref.split("#")[1]) : null;
  const sel: PartSelect = explicit ?? (sameLogo ? shown!.sel : "all");

  const view = logoView(logo, logoLayer.parts, logoLayer.frame);
  const { k } = logoBoxSize(logoLayer, view);
  const ls = logoLayer.scale ?? 1;
  const off = subsetOffset(logo, view, k, sel);
  if (!off) return null;
  const target = { x: (logoLayer.x ?? 0) + off.dx * ls, y: (logoLayer.y ?? 0) + off.dy * ls, w: off.w * ls, h: off.h * ls };

  // how big (and where) the selected subset is inside the actor at scale 1
  const aw = actorLayer.width ?? (actorLayer.type === "morph" ? 400 : 200);
  const ah = actorLayer.height ?? (actorLayer.type === "morph" ? 400 : aw);
  let scale: number, cx = 0, cy = 0;
  const step = activeShape(actorLayer, actorLocalT);
  const shownBB = sameLogo ? subsetBBox(logo, shown!.sel) : null;
  const selBB = subsetBBox(logo, sel);
  if (shownBB && selBB) {
    const f = Math.min(aw / shownBB.w, ah / shownBB.h) * (step?.scale ?? 1); // Morph fit-contains the shown subset
    scale = target.w / (selBB.w * f);
    cx = (selBB.x + selBB.w / 2 - (shownBB.x + shownBB.w / 2)) * f; // selected subset's offset from the actor center
    cy = (selBB.y + selBB.h / 2 - (shownBB.y + shownBB.h / 2)) * f;
  } else {
    scale = Math.min(target.w / aw, target.h / ah); // generic: fit the actor box onto the target
  }

  const scene = spec.scenes[hit.sceneIdx];
  const depth = logoLayer.depth ?? 1;
  return {
    sceneIdx: hit.sceneIdx,
    at: (tau) => {
      // top-level scene layers are drawn through the camera: p' = z·(p − cam·depth)
      const cam = cameraAt(scene, tau);
      const z = 1 + (cam.zoom - 1) * depth;
      const s = scale * z;
      return { x: z * (target.x - cam.x * depth) - cx * s, y: z * (target.y - cam.y * depth) - cy * s, scale: s };
    },
  };
};

/** Resolve poses to global times and build the wrapper layer. Returns null for actors that reference unknown scenes only. */
export const resolveActor = (actor: Actor, index: number, spec: Pick<Spec, "scenes">, slots: SceneSlot[], totalSeconds: number, snap?: SnapCtx): ResolvedActor | null => {
  const poses = actor.poses
    .map((p) => {
      const si = sceneIndexOf(spec.scenes, p.scene);
      return si < 0 ? null : { p, g: slots[si].start + (p.t ?? 0) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.g - b.g);
  if (!poses.length) return null;

  const fromIdx = actor.from !== undefined ? sceneIndexOf(spec.scenes, actor.from) : -1;
  const start = fromIdx >= 0 ? slots[fromIdx].start : Math.min(poses[0].g, slots[sceneIndexOf(spec.scenes, actor.poses[0].scene)]?.start ?? poses[0].g);
  const untilIdx = actor.until !== undefined ? sceneIndexOf(spec.scenes, actor.until) : -1;
  const end = Math.max(start + 0.05, untilIdx >= 0 ? slots[untilIdx].end : totalSeconds);

  // Hold-then-move: each pose's move takes `move` seconds (default 1s) ending at its time; before that the actor
  // holds the previous pose (80/20 rhythm). A hold keyframe carrying the evaluated previous values is inserted.
  const DEFAULT_MOVE = 1.0;
  const keyframes: Keyframe[] = [];
  poses.forEach(({ p, g }, i) => {
    const t = Math.max(0, g - start);
    if (i > 0) {
      const prevT = keyframes[keyframes.length - 1].t;
      const holdT = t - Math.min(p.move ?? DEFAULT_MOVE, t - prevT);
      if (holdT > prevT + 1e-3) {
        // evaluate a COPY: keyframe tracks are cached by array identity, and this array is still being built
        const held = evalKeyframes([...keyframes], holdT);
        const hold: Keyframe = { t: holdT };
        const props: PoseProp[] = p.snapTo ? ["x", "y", "scale", ...POSE_PROPS.filter((k) => k !== "x" && k !== "y" && k !== "scale" && p[k] !== undefined)] : POSE_PROPS.filter((k) => p[k] !== undefined);
        for (const k of props) if (held[k] !== undefined) hold[k] = held[k];
        if (Object.keys(hold).length > 1) keyframes.push(hold);
      }
    }
    const kf: Keyframe = { t };
    for (const k of POSE_PROPS) if (p[k] !== undefined) kf[k] = p[k];
    kf.ease = p.ease ?? "expoOut";

    // snapTo: land exactly on a logo layer's part slot (overrides x/y/scale), then optionally follow its camera
    const si = sceneIndexOf(spec.scenes, p.scene);
    const target = p.snapTo && snap ? resolveSnap(spec, si, p.snapTo, actor.layer as Layer, t, snap) : null;
    if (target) {
      const slot = slots[target.sceneIdx];
      const pose0 = target.at(g - slot.start);
      kf.x = pose0.x; kf.y = pose0.y; kf.scale = pose0.scale;
      keyframes.push(kf);
      if (p.follow !== false && cameraMoves(spec.scenes[target.sceneIdx])) {
        const next = poses[i + 1];
        const stop = Math.min(slot.end, next ? next.g - (next.p.move ?? DEFAULT_MOVE) : Infinity, start + (totalSeconds - start));
        const dt = 1 / snap!.fps;
        for (let gg = g + dt; gg < stop - 1e-6; gg += dt) {
          const q = target.at(gg - slot.start);
          keyframes.push({ t: gg - start, x: q.x, y: q.y, scale: q.scale, ease: "linear" });
        }
      }
      return;
    }
    keyframes.push(kf);
  });

  // Props the poses drive become absolute: strip them from the inner layer so they don't double up.
  const driven = new Set(POSE_PROPS.filter((k) => k !== "opacity" && k !== "blur" && (poses.some(({ p }) => p[k] !== undefined) || (["x", "y", "scale"].includes(k) && poses.some(({ p }) => p.snapTo)))));
  const inner = { ...actor.layer } as Record<string, unknown>;
  for (const k of driven) delete inner[k];
  if (!inner.id) inner.id = `${actor.id}-body`;

  const layer = {
    type: "group",
    id: `actor-${actor.id}`,
    start,
    duration: end - start,
    zIndex: 1000 + index,
    animate: keyframes,
    layers: [inner as Layer],
  } as Layer;
  return { actor, start, end, keyframes, layer };
};

/** Pose of a resolved actor at global time g (for transitions that grow from an actor). */
export const actorPoseAt = (ra: ResolvedActor, g: number) => {
  const v = evalKeyframes(ra.keyframes, g - ra.start);
  const l = ra.actor.layer as { x?: number; y?: number; scale?: number; width?: number; height?: number };
  const scale = (v.scale ?? 1) * (l.scale ?? 1);
  const w = (l.width ?? 120) * scale;
  const h = (l.height ?? l.width ?? 120) * scale;
  return { x: v.x ?? l.x ?? 0, y: v.y ?? l.y ?? 0, w, h };
};

export const ActorsLayer: React.FC<{ actors: ResolvedActor[]; width: number; height: number }> = ({ actors, width, height }) => {
  if (!actors.length) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <ContainerProvider value={{ width, height, nested: false }}>
        <LayerList layers={actors.map((a) => a.layer)} />
      </ContainerProvider>
    </AbsoluteFill>
  );
};
