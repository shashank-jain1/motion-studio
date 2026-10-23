/** Inspect the actual planner used by Player/export. These are timeline checks, not a claim of listening to a mix. */
import type { Layer, Spec } from "../spec/schema";
import { sceneIndexOf, sceneTimeline } from "../spec/preprocess";
import { analyseLayerMotion } from "./motionEvents";
import { gestureTiming } from "../core/choreography";
import { formatBrief, planSoundV2 } from "./autoSound";
import { sfxInfo } from "./library";

export const motionSoundWarnings = (spec: Spec): string[] => {
  const tl = sceneTimeline(spec.scenes, spec.fps);
  const enabled = !!spec.sound && spec.sound.auto !== false;
  const warnings: string[] = [];
  const visit = (layers: Layer[], duration: number, where: string) => {
    for (const [i, l] of layers.entries()) {
      const name = `${where}/${l.id ?? `${l.type}-${i}`}`;
      const dur = Math.min(duration - (l.start ?? 0), l.duration ?? Infinity);
      if (l.gesture && gestureTiming(l.gesture).settle + 0.5 > dur) warnings.push(`${name}: allow at least 0.5s after the gesture settles.`);
      if (l.sound !== false && l.accents?.length) {
        if (!enabled) warnings.push(`${name}: accents are inactive; enable spec.sound.auto.`);
        const m = analyseLayerMotion(l, dur, spec.fps).sort((a, b) => b.travel - a.travel)[0];
        const g = l.gesture ? gestureTiming(l.gesture) : undefined;
        for (const a of l.accents) {
          const at = typeof a.at === "number" ? a.at : a.at === "rush" ? m?.rush : a.at === "contact" ? g?.contact ?? m?.contact : g?.settle ?? m?.settle;
          if (at === undefined) warnings.push(`${name}: cannot resolve '${a.at}'; use a numeric time for internal 3D/custom actions.`);
          else if (at + (a.offset ?? 0) < 0 || at + (a.offset ?? 0) >= dur) warnings.push(`${name}: accent '${a.at}' is outside the layer's visible duration.`);
          if (a.src?.startsWith("sfx:") && !sfxInfo(a.src)) warnings.push(`${name}: unknown sound '${a.src}'.`);
          if (a.src && !a.src.startsWith("sfx:") && a.sourcePeak === undefined) warnings.push(`${name}: imported accent '${a.src}' needs sourcePeak to align its internal transient; currently aligned at file start.`);
          if (a.sourceDuration !== undefined && (a.sourcePeak ?? 0) >= a.sourceDuration) warnings.push(`${name}: sourcePeak must fall inside sourceDuration.`);
        }
      }
      if (l.type === "group" && l.sound !== false) visit(l.layers, dur, name);
      if (l.type === "device" && l.sound !== false) for (const s of l.screens ?? []) if (s.layers) visit(s.layers, dur - (s.at ?? 0), name);
    }
  };
  for (const s of spec.scenes) visit(s.layers, s.duration, s.id ?? "scene");
  for (const a of spec.actors ?? []) {
    const indices = a.poses.map((p) => sceneIndexOf(spec.scenes, p.scene)).filter((i) => i >= 0);
    const fi = a.from === undefined ? Math.min(...indices) : sceneIndexOf(spec.scenes, a.from);
    const ui = a.until === undefined ? tl.scenes.length - 1 : sceneIndexOf(spec.scenes, a.until);
    if (tl.scenes[fi] && tl.scenes[ui]) visit([a.layer], tl.scenes[ui].end - tl.scenes[fi].start, `actor ${a.id}`);
  }
  return warnings;
};

export const inspectSound = (spec: Spec) => {
  const tl = sceneTimeline(spec.scenes, spec.fps), total = tl.totalFrames / spec.fps;
  const enabled = !!spec.sound && spec.sound.auto !== false;
  const plan = enabled ? planSoundV2(spec, tl, { fps: spec.fps, total }) : null;
  const warnings = motionSoundWarnings(spec);
  const cues = (plan?.cues ?? []).map((c) => ({
    frame: Math.round(c.peak * spec.fps), peak: c.peak, start: c.at, end: Math.min(total, c.at + c.dur),
    role: c.role, importance: c.importance, volume: c.volume, pan: c.pan ?? 0,
    locked: !!c.locked, syncErrorFrames: c.eventTime === undefined ? null : Math.round((c.peak - c.eventTime) * spec.fps * 100) / 100,
    layers: c.layers, reason: c.reason, family: c.family,
  }));
  const previewFrames = [...new Set(cues.filter((c) => c.locked || c.importance === "hero").flatMap((c) => [c.frame - 2, c.frame, c.frame + 2]))]
    .filter((f) => f >= 0 && f < tl.totalFrames).sort((a, b) => a - b);
  return { enabled, total, fps: spec.fps, brief: plan ? formatBrief(plan.brief) : "Automatic sound is disabled", cues,
    manual: (spec.sfx ?? []).map((s) => ({ ...s, frame: Math.round(s.at * spec.fps) })),
    mix: plan?.mix ?? [], dropped: plan?.dropped ?? [], warnings, beats: plan?.brief.beats ?? [],
    bridges: (plan?.bridges ?? []).map(({ src: _src, ...b }) => b), phrases: plan?.phrases ?? [],
    previewTimes: previewFrames.map((f) => f / spec.fps),
    review: "Inspect contact ±2 frames, then play the rendered MP4 with audio. Planner timing does not measure exported PCM sync or perceived sound quality.",
  };
};
