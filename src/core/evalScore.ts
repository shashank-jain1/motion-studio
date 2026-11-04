/**
 * Director evaluation score: one transparent 0–100 number per spec, plus the parts it was built from. Used by
 * scripts/eval-director.ts to compare director runs on the same briefs (docs/research/10-direction-briefs.md).
 * Penalties come from the linters the director already sees; the motion metrics reward the cinematic register's habits
 * (springs, continuity, no dead time) without requiring them.
 */
import { SpecSchema, type Spec } from "../engine/spec/schema";
import { sceneTimeline } from "../engine/spec/preprocess";
import { craftWarnings } from "./craft";
import { storyIssues } from "./story";
import { allLayers, eventTimes } from "./direction";

export type EvalScore = {
  score: number;
  valid: boolean;
  seconds: number;
  warnings: { craft: number; story: number; direction: number; list: string[] };
  storyErrors: number;
  motion: {
    /** share of animated keys that land on a physical spring */
    springShare: number;
    /** actors, content-aware joins, or one scene with a travelling camera */
    continuity: boolean;
    /** longest stretch with nothing starting to change (s), end-card hold excluded */
    longestGap: number;
    /** changes per second */
    density: number;
  };
  breakdown: string[];
};

const CONTENT_AWARE = new Set(["expand", "zoom-into", "match", "slice"]);

export const scoreSpec = (input: unknown): EvalScore => {
  const parsed = SpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      score: 0, valid: false, seconds: 0, warnings: { craft: 0, story: 0, direction: 0, list: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) },
      storyErrors: 0, motion: { springShare: 0, continuity: false, longestGap: 0, density: 0 }, breakdown: ["invalid spec → 0"],
    };
  }
  const spec: Spec = parsed.data;
  const seconds = sceneTimeline(spec.scenes, spec.fps).totalFrames / spec.fps;
  const list = craftWarnings(spec);
  const direction = list.filter((w) => w.startsWith("direction")).length;
  const story = list.filter((w) => w.startsWith("story")).length;
  const craft = list.length - direction - story;
  const storyErrors = (() => { try { return storyIssues(spec).filter((i) => i.severity === "error").length; } catch { return 0; } })();

  // motion habits
  const layers = allLayers(spec);
  const keys = [...layers.flatMap((v) => v.layer.animate ?? []), ...spec.scenes.flatMap((s) => s.camera?.keyframes ?? [])].filter((k) => k.ease);
  const springShare = keys.length ? keys.filter((k) => k.ease === "physical" || k.ease === "physicalLoose").length / keys.length : 0;
  const continuity = !!spec.actors?.length
    || spec.scenes.slice(1).every((s) => s.transition && CONTENT_AWARE.has(s.transition.type))
    || (spec.scenes.length === 1 && !!spec.scenes[0].camera?.keyframes?.length);
  const ev = eventTimes(spec, layers);
  let longestGap = 0, prev = 0;
  for (const t of [...ev, Math.max(0, seconds - 1.5)]) {
    if (t > seconds - 1.5) break;
    longestGap = Math.max(longestGap, t - prev);
    prev = Math.max(prev, t);
  }
  const density = seconds > 0 ? new Set(ev.map((t) => Math.round(t * 10))).size / seconds : 0;

  const breakdown: string[] = [];
  let score = 100;
  const take = (n: number, why: string) => { if (n > 0) { score -= n; breakdown.push(`−${+n.toFixed(1)} ${why}`); } };
  take(Math.min(40, direction * 8), `${direction} direction rule break(s) × 8`);
  take(Math.min(20, storyErrors * 5), `${storyErrors} story error(s) × 5`);
  take(Math.min(20, craft * 2), `${craft} craft warning(s) × 2`);
  take(Math.min(10, story), `${story} story warning(s) × 1`);
  take(longestGap > 2 ? Math.min(10, (longestGap - 2) * 4) : 0, `dead stretch of ${longestGap.toFixed(1)}s`);
  take(continuity ? 0 : 6, "no continuity (actors, content-aware joins or one travelling take)");
  take(density < 1 ? 4 : 0, `low change density (${density.toFixed(2)}/s)`);
  return {
    score: Math.max(0, Math.round(score)), valid: true, seconds,
    warnings: { craft, story, direction, list }, storyErrors,
    motion: { springShare: +springShare.toFixed(2), continuity, longestGap: +longestGap.toFixed(2), density: +density.toFixed(2) },
    breakdown,
  };
};
