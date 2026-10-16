import { parseSpec, resolveSize, specSeconds } from "../../../src/engine/render/SpecVideo";
import { sceneIndexOf, sceneTimeline } from "../../../src/engine/spec/preprocess";
import type { Spec } from "../../../src/engine/spec/schema";
import type { Timeline } from "../api";

export type ParsedInfo = {
  /** The raw spec this was parsed from (what the Player is fed). */
  raw: Record<string, unknown>;
  spec: Spec;
  width: number; height: number; fps: number;
  durationInFrames: number; seconds: number;
  timeline: Timeline;
  scenes: { id?: string; layers: number; transition?: string; transitionSeconds: number; notes?: string }[];
};

/** Parse a raw spec into everything the Player + Timeline need. Throws the engine's validation error. */
export const analyzeSpec = (raw: Record<string, unknown>): ParsedInfo => {
  const spec = parseSpec(raw);
  const { width, height } = resolveSize(spec);
  const seconds = specSeconds(spec);
  const durationInFrames = Math.max(1, Math.round(seconds * spec.fps));
  const tl = sceneTimeline(spec.scenes, spec.fps);
  const slots = tl.scenes;
  const timeline: Timeline = {
    total: seconds,
    scenes: slots.map((s) => ({ index: s.index, id: s.id, start: s.start, end: s.end, duration: s.end - s.start, overlapIn: s.overlapIn, transition: spec.scenes[s.index].transition?.type })),
    actors: (spec.actors ?? []).map((a) => {
      const fi = sceneIndexOf(spec.scenes, a.from ?? a.poses[0]?.scene ?? 0);
      const ui = a.until == null ? slots.length - 1 : sceneIndexOf(spec.scenes, a.until);
      return { id: a.id, from: slots[Math.max(0, fi)]?.start ?? 0, until: slots[ui < 0 ? slots.length - 1 : ui]?.end ?? seconds };
    }),
  };
  return {
    raw, spec, width, height, fps: spec.fps, durationInFrames, seconds, timeline,
    scenes: spec.scenes.map((s) => ({ id: s.id, layers: countLayers(s.layers), transition: s.transition?.type, transitionSeconds: s.transition?.duration ?? 0.5, notes: s.notes })),
  };
};

const countLayers = (ls: { type: string; layers?: unknown }[]): number =>
  ls.reduce((n, l) => n + 1 + (l.type === "group" && Array.isArray(l.layers) ? countLayers(l.layers as { type: string }[]) : 0), 0);

/** Split an engine error message ("Invalid spec: a; b; c") into readable lines. */
export const splitErrors = (msg: string) => msg.replace(/^Invalid spec:\s*/, "").split(/;\s+(?=[\w$[\]."]+(?:\.\d+)*[:\s])/).map((s) => s.trim()).filter(Boolean);

/**
 * Find the character ranges of each element of the top-level "scenes" array in a JSON text (tolerant scanner,
 * no full parse) — used to scroll the editor to a scene and to map the cursor back to a scene.
 */
export const sceneRanges = (text: string): { from: number; to: number }[] => {
  const out: { from: number; to: number }[] = [];
  let depth = 0;
  let i = 0;
  let lastKey: string | null = null;
  let scenesDepth = -1; // depth of the scenes array contents
  let elemStart = -1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const s = i;
      i++;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      const str = text.slice(s + 1, i);
      i++;
      // a key if followed by ':'
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === ":" && depth === 1) lastKey = str;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      if (c === "[" && depth === 2 && lastKey === "scenes" && scenesDepth < 0) scenesDepth = depth + 1;
      else if (depth === scenesDepth && c === "{") elemStart = i;
    } else if (c === "}" || c === "]") {
      if (depth === scenesDepth && c === "}" && elemStart >= 0) { out.push({ from: elemStart, to: i + 1 }); elemStart = -1; }
      if (scenesDepth > 0 && depth === scenesDepth - 1 && c === "]") return out;
      depth--;
    }
    i++;
  }
  return out;
};
