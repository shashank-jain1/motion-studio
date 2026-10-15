/**
 * Spec preprocessing (pure, no DOM — safe to import from Node and from the Remotion bundle).
 *
 * Converts musical time strings into seconds before the spec is validated:
 *   "beat:N"        global beat N (0-based, fractional ok). From `beats[]` (interpolated / extrapolated) or bpm + beatOffset.
 *   "bar:N"         global beat 4·N (4/4).
 *   "beats:N"       a LENGTH of N beats (at the local tempo), e.g. scene `duration: "beats:8"`.
 *   "beat:N@apex"   on enter.delay / layer start / delay-like keys: shift so the move's apex (≈85% of its
 *                   duration — the settle of an ease-out move) lands on the beat instead of its start.
 *
 * Global beats are converted into the time base of where they are written:
 *   spec level (sfx[].at, fx.flashes[].at …)              → seconds from video start
 *   scene level (camera keyframes t, punch[], fx …)      → seconds from that scene's start
 *   layer `start` / `duration`                           → seconds from scene start (duration = until that beat)
 *   inside a layer (enter.delay, animate[].t, path.start, highlight.at, morph shapes[].at, exitAt, words…)
 *                                                         → seconds from the layer's start
 *   group children / device screens                      → nested bases
 *   actors: poses[].t → seconds into the pose's scene; actor.layer times → seconds from the actor's first scene start
 *
 * The scene timeline mirrors the engine exactly (frame-rounded scene and transition lengths, overlaps subtracted),
 * so a "beat:N" lands on frame round(N_seconds · fps) of the final video.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

const BEAT_RE = /^\s*(beat|bar|beats|bars)\s*:\s*(-?\d+(?:\.\d+)?)\s*(@\s*apex)?\s*$/i;

type Parsed = { kind: "point" | "length"; beats: number; apex: boolean };
const parseBeat = (v: unknown): Parsed | null => {
  if (typeof v !== "string") return null;
  const m = BEAT_RE.exec(v);
  if (!m) return null;
  const unit = m[1].toLowerCase();
  const n = Number(m[2]);
  const mult = unit.startsWith("bar") ? 4 : 1;
  return { kind: unit === "beat" || unit === "bar" ? "point" : "length", beats: n * mult, apex: !!m[3] };
};

/** Transitions that do not overlap scenes (hard cuts). Keep in sync with render/transitions.tsx transitionSeconds. */
export const ZERO_LENGTH_TRANSITIONS = new Set(["none", "cut", "match"]);
const DEFAULT_TRANSITION = 0.5;

/** Beat clock: beat index ↔ seconds. */
export type BeatClock = { toSec: (beat: number) => number; toBeat: (sec: number) => number };

export const makeBeatClock = (spec: { bpm?: unknown; beatOffset?: unknown; beats?: unknown }): BeatClock | null => {
  const beats = Array.isArray(spec.beats) ? (spec.beats.filter((b) => typeof b === "number" && Number.isFinite(b)) as number[]).sort((a, b) => a - b) : [];
  const bpm = num(spec.bpm);
  if (beats.length >= 2) {
    const n = beats.length;
    const tail = beats.slice(Math.max(0, n - 5));
    const tailIv = (tail[tail.length - 1] - tail[0]) / Math.max(1, tail.length - 1);
    const head = beats.slice(0, 5);
    const headIv = (head[head.length - 1] - head[0]) / Math.max(1, head.length - 1);
    const toSec = (b: number) => {
      if (b <= 0) return beats[0] + b * headIv;
      if (b >= n - 1) return beats[n - 1] + (b - (n - 1)) * tailIv;
      const i = Math.floor(b), f = b - i;
      return beats[i] + (beats[i + 1] - beats[i]) * f;
    };
    const toBeat = (s: number) => {
      if (s <= beats[0]) return (s - beats[0]) / headIv;
      if (s >= beats[n - 1]) return n - 1 + (s - beats[n - 1]) / tailIv;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= s) lo = mid; else hi = mid; }
      return lo + (s - beats[lo]) / Math.max(1e-9, beats[lo + 1] - beats[lo]);
    };
    return { toSec, toBeat };
  }
  if (bpm && bpm > 0) {
    const spb = 60 / bpm;
    const off = num(spec.beatOffset) ?? beats[0] ?? 0;
    return { toSec: (b) => off + b * spb, toBeat: (s) => (s - off) / spb };
  }
  return null;
};

/** Frame-accurate scene timeline, identical to how SpecVideo builds the TransitionSeries. */
export type SceneSlot = { index: number; id?: string; startFrame: number; frames: number; start: number; end: number; overlapIn: number };

export const sceneTimeline = (
  scenes: { id?: string; duration: number; transition?: { type: string; duration?: number } }[],
  fps: number,
): { scenes: SceneSlot[]; totalFrames: number } => {
  const out: SceneSlot[] = [];
  let cursor = 0;
  scenes.forEach((s, index) => {
    const frames = Math.max(1, Math.round(s.duration * fps));
    const tr = s.transition;
    const overlap = index === 0 || !tr || ZERO_LENGTH_TRANSITIONS.has(tr.type) ? 0 : Math.max(1, Math.round((tr.duration ?? DEFAULT_TRANSITION) * fps));
    const startFrame = Math.max(0, cursor - overlap);
    out.push({ index, id: s.id, startFrame, frames, start: startFrame / fps, end: (startFrame + frames) / fps, overlapIn: overlap / fps });
    cursor = startFrame + frames;
  });
  return { scenes: out, totalFrames: cursor };
};

/** Resolve a scene reference (id or index) to an index; -1 when unknown. */
export const sceneIndexOf = (scenes: { id?: string }[], ref: unknown): number => {
  if (typeof ref === "number") return ref >= 0 && ref < scenes.length ? Math.floor(ref) : -1;
  if (typeof ref === "string") {
    const i = scenes.findIndex((s) => s.id === ref);
    if (i >= 0) return i;
    if (/^\d+$/.test(ref)) { const n = Number(ref); return n < scenes.length ? n : -1; }
  }
  return -1;
};

// Keys that hold a LENGTH whose start is a sibling key (so "beat:N" there means "until beat N").
const DURATION_START: Record<string, string[]> = {
  duration: ["start", "delay", "at"],
  drawDuration: ["drawStart"],
  countDuration: ["countDelay"],
};
// Keys whose value is a point in time ("beat:N@apex" is honoured on these).
const APEX_KEYS = new Set(["delay", "start", "at"]);
// Free-text keys are never converted (a caption could legitimately read "beat:4").
const TEXT_KEYS = new Set(["text", "words", "title", "body", "meta", "notes", "prefix", "suffix", "emoji", "url", "id", "src", "concept"]);
const isText = (k: string, x: unknown) =>
  TEXT_KEYS.has(k) && (typeof x === "string" || isObj(x) || (Array.isArray(x) && x.every((e) => typeof e === "string")));

class Ctx {
  errors: string[] = [];
  constructor(public clock: BeatClock | null, public fps: number) {}

  /** Seconds for a beat string; `base` = global seconds of the local time origin. */
  value(v: unknown, base: number, path: string, opts: { lengthStart?: number; apexDuration?: number } = {}): unknown {
    const p = parseBeat(v);
    if (!p) return v;
    if (!this.clock) {
      this.errors.push(`${path}: "${v}" needs a beat clock — set "bpm" (+ "beatOffset") or "beats" on the spec`);
      return v;
    }
    if (p.kind === "length") {
      const b0 = this.clock.toBeat(base + (opts.lengthStart ?? 0));
      return r6(Math.max(0, this.clock.toSec(b0 + p.beats) - this.clock.toSec(b0)));
    }
    let s = this.clock.toSec(p.beats) - base;
    if (opts.lengthStart !== undefined) s -= opts.lengthStart; // a duration written as "until beat N"
    if (p.apex && opts.apexDuration !== undefined) s -= opts.apexDuration * 0.85;
    return r6(Math.max(0, s));
  }

  /** Generic walk: converts every beat string in a value, with time origin `base`. */
  walk(v: unknown, base: number, path: string): unknown {
    if (Array.isArray(v)) return v.map((x, i) => this.walk(x, base, `${path}[${i}]`));
    if (!isObj(v)) return this.value(v, base, path);
    const out: Obj = { ...v };
    // 1) lengths ("beats:N") anywhere, 2) points, 3) durations written as "until beat N" (measured from their start key)
    for (const [k, x] of Object.entries(out)) {
      if (!TEXT_KEYS.has(k) && parseBeat(x)?.kind === "length") out[k] = this.value(x, base, `${path}.${k}`);
    }
    for (const [k, x] of Object.entries(out)) {
      if (k in DURATION_START) continue;
      if (isText(k, x)) continue;
      if (APEX_KEYS.has(k) && parseBeat(x)) {
        const dur = num(out.duration) ?? (typeof out.type === "string" ? 0.6 : undefined);
        out[k] = this.value(x, base, `${path}.${k}`, { apexDuration: dur });
      } else out[k] = this.walk(x, base, `${path}.${k}`);
    }
    for (const [k, starts] of Object.entries(DURATION_START)) {
      if (!(k in out)) continue;
      const st = starts.map((s) => num(out[s])).find((n) => n !== undefined) ?? 0;
      out[k] = this.value(out[k], base, `${path}.${k}`, { lengthStart: st });
    }
    return out;
  }

  /** A layer: `start`/`duration` relative to `base`; everything inside relative to base + start. */
  layer(v: unknown, base: number, path: string): unknown {
    if (!isObj(v)) return v;
    const out: Obj = { ...v };
    const ps = parseBeat(out.start);
    if (ps) {
      if (ps.apex && ps.kind === "point" && this.clock) {
        // the enter's apex (delay + 0.85·duration) lands on the beat
        const enter = isObj(out.enter) ? out.enter : undefined;
        const delay = enter ? (num(enter.delay) ?? 0) : 0;
        const dur = enter ? (num(enter.duration) ?? 0.6) : 0.6;
        out.start = r6(Math.max(0, this.clock.toSec(ps.beats) - base - delay - dur * 0.85));
      } else out.start = this.value(out.start, base, `${path}.start`);
    }
    const start = num(out.start) ?? 0;
    if ("duration" in out) out.duration = this.value(out.duration, base, `${path}.duration`, { lengthStart: start });
    const inner = base + start;
    for (const [k, x] of Object.entries(out)) {
      if (k === "start" || k === "duration" || isText(k, x)) continue;
      if (k === "layers" && Array.isArray(x)) out.layers = x.map((l, i) => this.layer(l, inner, `${path}.layers[${i}]`));
      else if (k === "screens" && Array.isArray(x)) out.screens = x.map((s, i) => this.screen(s, inner, `${path}.screens[${i}]`));
      else out[k] = this.walk(x, inner, `${path}.${k}`);
    }
    return out;
  }

  screen(v: unknown, base: number, path: string): unknown {
    if (!isObj(v)) return v;
    const out: Obj = { ...v };
    if ("at" in out) out.at = this.value(out.at, base, `${path}.at`);
    const inner = base + (num(out.at) ?? 0);
    for (const [k, x] of Object.entries(out)) {
      if (k === "at" || isText(k, x)) continue;
      if (k === "layers" && Array.isArray(x)) out.layers = x.map((l, i) => this.layer(l, inner, `${path}.layers[${i}]`));
      else out[k] = this.walk(x, inner, `${path}.${k}`);
    }
    return out;
  }
}

/** Like preprocessSpec, but also returns human-readable problems (e.g. beat strings without a beat clock). */
export const preprocessSpecDetailed = (input: unknown): { spec: unknown; errors: string[] } => {
  if (!isObj(input) || !Array.isArray(input.scenes)) return { spec: input, errors: [] };
  const fps = num(input.fps) ?? 30;
  const ctx = new Ctx(makeBeatClock(input), fps);
  const spec: Obj = { ...input };

  // Pass 1: transitions + scene durations → frame-accurate timeline.
  const scenes = (input.scenes as unknown[]).map((s) => (isObj(s) ? { ...s } : s)) as Obj[];
  let cursor = 0; // frames
  const starts: number[] = [];
  scenes.forEach((sc, i) => {
    if (!isObj(sc)) { starts.push(cursor / fps); return; }
    if (isObj(sc.transition)) {
      const tr = { ...sc.transition };
      tr.duration = ctx.value(tr.duration, cursor / fps, `scenes[${i}].transition.duration`);
      sc.transition = tr;
    }
    const tr = isObj(sc.transition) ? sc.transition : undefined;
    const overlap = i === 0 || !tr || ZERO_LENGTH_TRANSITIONS.has(String(tr.type)) ? 0 : Math.max(1, Math.round((num(tr.duration) ?? DEFAULT_TRANSITION) * fps));
    const startFrame = Math.max(0, cursor - overlap);
    const start = startFrame / fps;
    const p = parseBeat(sc.duration);
    if (p && ctx.clock) {
      const endSec = p.kind === "length" ? ctx.clock.toSec(ctx.clock.toBeat(start) + p.beats) : ctx.clock.toSec(p.beats);
      const frames = Math.max(1, Math.round(endSec * fps) - startFrame);
      sc.duration = r6(frames / fps);
    } else if (p) {
      ctx.value(sc.duration, start, `scenes[${i}].duration`); // records the error
    }
    starts.push(start);
    const d = num(sc.duration);
    cursor = startFrame + (d !== undefined ? Math.max(1, Math.round(d * fps)) : 0);
  });

  // Pass 2: everything inside scenes.
  spec.scenes = scenes.map((sc, i) => {
    if (!isObj(sc)) return sc;
    const out: Obj = { ...sc };
    const base = starts[i];
    for (const [k, x] of Object.entries(out)) {
      if (k === "duration" || k === "transition" || isText(k, x)) continue;
      if (k === "layers" && Array.isArray(x)) out.layers = x.map((l, j) => ctx.layer(l, base, `scenes[${i}].layers[${j}]`));
      else out[k] = ctx.walk(x, base, `scenes[${i}].${k}`);
    }
    return out;
  });

  // Actors: poses in their scene's time base; the actor layer in the base of its first scene.
  const sceneRefs = scenes.map((s) => ({ id: isObj(s) && typeof s.id === "string" ? s.id : undefined }));
  if (Array.isArray(input.actors)) {
    spec.actors = input.actors.map((a, ai) => {
      if (!isObj(a)) return a;
      const out: Obj = { ...a };
      const poses = Array.isArray(a.poses) ? a.poses : [];
      out.poses = poses.map((p, pi) => {
        if (!isObj(p)) return p;
        const si = sceneIndexOf(sceneRefs, p.scene);
        return ctx.walk(p, si >= 0 ? starts[si] : 0, `actors[${ai}].poses[${pi}]`);
      });
      const firstRef = a.from ?? (isObj(poses[0]) ? poses[0].scene : 0);
      const fi = sceneIndexOf(sceneRefs, firstRef);
      out.layer = ctx.layer(a.layer, fi >= 0 ? starts[fi] : 0, `actors[${ai}].layer`);
      return out;
    });
  }

  // Spec-level: global seconds.
  for (const [k, x] of Object.entries(spec)) {
    if (k === "scenes" || k === "actors" || k === "beats" || k === "bpm" || k === "beatOffset") continue;
    spec[k] = ctx.walk(x, 0, k);
  }
  return { spec, errors: ctx.errors };
};

/** Convert beat-time strings to seconds (see file header). Pure; returns the input untouched when there is nothing to do. */
export const preprocessSpec = (input: unknown): unknown => preprocessSpecDetailed(input).spec;
