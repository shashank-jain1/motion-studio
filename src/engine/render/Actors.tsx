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

/** Resolve poses to global times and build the wrapper layer. Returns null for actors that reference unknown scenes only. */
export const resolveActor = (actor: Actor, index: number, spec: Pick<Spec, "scenes">, slots: SceneSlot[], totalSeconds: number): ResolvedActor | null => {
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

  const keyframes: Keyframe[] = poses.map(({ p, g }) => {
    const kf: Keyframe = { t: Math.max(0, g - start) };
    for (const k of POSE_PROPS) if (p[k] !== undefined) kf[k] = p[k];
    if (p.ease) kf.ease = p.ease;
    return kf;
  });

  // Props the poses drive become absolute: strip them from the inner layer so they don't double up.
  const driven = new Set(POSE_PROPS.filter((k) => k !== "opacity" && k !== "blur" && poses.some(({ p }) => p[k] !== undefined)));
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
