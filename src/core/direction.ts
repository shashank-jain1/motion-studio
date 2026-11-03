/**
 * Direction linter: a brief's hard rules (concept.direction) checked against the spec. Briefs from top motion
 * designers are mostly constraints — "never cut", "one element drives everything", "the last frame is the first",
 * "something happens on every beat", and a list of banned techniques. Each detector below finds the spec fields that
 * would put a banned technique on screen and names the fix.
 */
import { BANNABLE, type Layer, type Scene, type Spec } from "../engine/spec/schema";
import { sceneTimeline } from "../engine/spec/preprocess";

type Ban = (typeof BANNABLE)[number];
type Hit = { where: string; what: string };

const CONTENT_AWARE = new Set(["expand", "zoom-into", "match", "slice"]);
const CROSSFADES = new Set(["fade", "dissolve", "dreamy-zoom"]);
const BOUNCY = new Set(["outBounce", "bouncy", "outElastic", "physicalLoose"]);
const BOUNCY_ENTERS = new Set(["drop-bounce", "pop", "swing"]);
const BURSTS = new Set(["burst", "confetti", "sparkles"]);
const FLIPS = new Set(["flip-up", "flip-side", "flip", "book-flip"]);

type Visit = { layer: Layer; where: string; start: number };
/** Every layer (groups and device screens flattened) with a readable location and its film start time. */
const allLayers = (spec: Spec): Visit[] => {
  const out: Visit[] = [];
  const slots = sceneTimeline(spec.scenes, spec.fps).scenes;
  const walk = (layers: Layer[], where: string, start: number) => {
    layers.forEach((l, i) => {
      const at = `${where}/${l.id ?? `${l.type}#${i}`}`, s = start + (l.start ?? 0);
      out.push({ layer: l, where: at, start: s });
      if (l.type === "group") walk(l.layers, at, s);
      if (l.type === "device") for (const sc of l.screens ?? []) if (sc.layers) walk(sc.layers as Layer[], at, s + (sc.at ?? 0));
    });
  };
  spec.scenes.forEach((sc, i) => walk(sc.layers, sc.id ?? `scene ${i + 1}`, slots[i]?.start ?? 0));
  for (const a of spec.actors ?? []) out.push({ layer: a.layer as Layer, where: `actor ${a.id}`, start: 0 });
  return out;
};

/** Every value under a key anywhere in an object tree (for props many layer types share: ease, glow, gradient…). */
const valuesOf = (node: unknown, key: string, acc: unknown[] = []): unknown[] => {
  if (Array.isArray(node)) for (const v of node) valuesOf(v, key, acc);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) acc.push(v);
      if (k !== "concept") valuesOf(v, key, acc);
    }
  }
  return acc;
};

const sceneName = (s: Scene, i: number) => s.id ?? `scene ${i + 1}`;
const fxOf = (spec: Spec) => [{ where: "film fx", fx: spec.fx }, ...spec.scenes.map((s, i) => ({ where: `${sceneName(s, i)} fx`, fx: s.fx }))];

const DETECT: Record<Exclude<Ban, "dead-time">, (spec: Spec, layers: Visit[]) => Hit[]> = {
  glow: (spec, layers) => [
    ...layers.filter(({ layer: l }) => valuesOf({ ...l, layers: undefined }, "glow").some(Boolean) || (l.type === "visualizer" && l.glow !== false))
      .map((v) => ({ where: v.where, what: "glow" })),
    ...layers.filter(({ layer: l }) => l.type === "three" && valuesOf(l, "bloom").some(Boolean)).map((v) => ({ where: v.where, what: "3D bloom" })),
  ],
  particles: (_s, layers) => layers.filter(({ layer: l }) => l.type === "particles").map((v) => ({ where: v.where, what: "particles layer" })),
  "particle-bursts": (_s, layers) => layers.filter(({ layer: l }) =>
    (l.type === "particles" && BURSTS.has(l.preset)) || (l.type === "cloud" && l.arrangement === "burst"))
    .map((v) => ({ where: v.where, what: "burst" })),
  gradients: (spec, layers) => [
    ...layers.filter(({ layer: l }) => valuesOf({ ...l, layers: undefined }, "gradient").some((g) => Array.isArray(g) && g.length > 1)
      || (l.type === "text" && l.preset === "gradient-sweep"))
      .map((v) => ({ where: v.where, what: "gradient fill" })),
    ...spec.scenes.flatMap((s, i) => [s.background ?? []].flat()
      .filter((b) => b.type === "gradient" || b.type === "mesh").map((b) => ({ where: sceneName(s, i), what: `${b.type} background` }))),
  ],
  "bouncy-easing": (spec, layers) => [
    ...layers.flatMap((v) => {
      const eases = valuesOf({ ...v.layer, layers: undefined }, "ease").filter((e): e is string => typeof e === "string" && BOUNCY.has(e));
      const enters: string[] = [v.layer.enter?.type, v.layer.exit?.type].filter((e): e is NonNullable<typeof e> => !!e && BOUNCY_ENTERS.has(e));
      if (v.layer.inertia) enters.push("inertia wobble");
      return [...new Set([...eases, ...enters])].map((e) => ({ where: v.where, what: e }));
    }),
    ...spec.scenes.flatMap((s, i) => [...new Set(valuesOf(s.camera, "ease").filter((e) => BOUNCY.has(e as string)))]
      .map((e) => ({ where: `${sceneName(s, i)} camera`, what: String(e) }))),
  ],
  "camera-shake": (spec) => spec.scenes.flatMap((s, i) => (s.camera?.shake ? [{ where: sceneName(s, i), what: "camera.shake" }] : [])),
  "zoom-punch": (spec) => spec.scenes.flatMap((s, i) => (s.camera?.punch?.length ? [{ where: sceneName(s, i), what: `${s.camera.punch.length} zoom punch(es)` }] : [])),
  "rgb-split": (spec, layers) => [
    ...fxOf(spec).filter((f) => (f.fx?.chromatic ?? 0) > 0).map((f) => ({ where: f.where, what: "chromatic" })),
    ...layers.filter(({ layer: l }) => l.type === "three" && valuesOf(l, "ca").some(Boolean)).map((v) => ({ where: v.where, what: "3D chromatic aberration" })),
  ],
  "light-leaks": (spec) => [
    ...fxOf(spec).filter((f) => (f.fx?.lightLeak ?? 0) > 0).map((f) => ({ where: f.where, what: "lightLeak" })),
    ...spec.scenes.flatMap((s, i) => (s.transition?.type === "film-burn" ? [{ where: sceneName(s, i), what: "film-burn transition" }] : [])),
  ],
  flashes: (spec) => [
    ...fxOf(spec).filter((f) => f.fx?.flashes?.length).map((f) => ({ where: f.where, what: "flashes" })),
    ...spec.scenes.flatMap((s, i) => (s.transition?.type === "flash" ? [{ where: sceneName(s, i), what: "flash transition" }] : [])),
  ],
  glitch: (spec, layers) => [
    ...layers.filter(({ layer: l }) => (l.type === "text" && l.preset === "glitch") || (l.type === "logo" && l.mode === "glitch")).map((v) => ({ where: v.where, what: "glitch" })),
    ...spec.scenes.flatMap((s, i) => (s.transition?.type === "glitch" ? [{ where: sceneName(s, i), what: "glitch transition" }] : [])),
  ],
  "blur-ins": (_s, layers) => layers.filter(({ layer: l }) => l.enter?.type === "blur-in" || (l.type === "text" && (l.preset ?? "blur-rise") === "blur-rise"))
    .map((v) => ({ where: v.where, what: v.layer.enter?.type === "blur-in" ? "blur-in enter" : "blur-rise text (the default preset)" })),
  "3d-flips": (spec, layers) => [
    ...layers.filter(({ layer: l }) => FLIPS.has(l.enter?.type ?? "") || FLIPS.has(l.exit?.type ?? "") || (l.type === "text" && l.preset === "flip"))
      .map((v) => ({ where: v.where, what: "flip" })),
    ...spec.scenes.flatMap((s, i) => (s.transition && FLIPS.has(s.transition.type) ? [{ where: sceneName(s, i), what: `${s.transition.type} transition` }] : [])),
  ],
  scanlines: (spec) => fxOf(spec).filter((f) => (f.fx?.scanlines ?? 0) > 0).map((f) => ({ where: f.where, what: "scanlines" })),
  "hard-cuts": (spec) => spec.scenes.slice(1).flatMap((s, j) => {
    const t = s.transition?.type;
    return !t || t === "cut" || t === "none" || t === "push-cut" ? [{ where: sceneName(s, j + 1), what: t ? `${t} transition` : "no transition (hard cut)" }] : [];
  }),
  crossfades: (spec) => spec.scenes.slice(1).flatMap((s, j) => (s.transition && CROSSFADES.has(s.transition.type) ? [{ where: sceneName(s, j + 1), what: `${s.transition.type} transition` }] : [])),
  "generic-transitions": (spec) => spec.scenes.slice(1).flatMap((s, j) => {
    const t = s.transition?.type;
    return t && !CONTENT_AWARE.has(t) && t !== "cut" && t !== "none" ? [{ where: sceneName(s, j + 1), what: `${t} transition` }] : [];
  }),
};

const FIX: Record<Ban, string> = {
  glow: "light it with contrast and shadow instead (glow: false; visualizer glow: false; no 3D bloom)",
  particles: "remove the particles layer; let a real element carry the energy",
  "particle-bursts": "replace the burst with the hero element itself reacting (squash, spring, scale)",
  gradients: "use flat fills from the palette (one accent)",
  "bouncy-easing": "use `physical` (≈1.5% overshoot) or snap/expoOut",
  "camera-shake": "remove camera.shake; let the hit land with a spring on the element",
  "zoom-punch": "remove camera.punch; move the camera with purpose instead",
  "rgb-split": "set fx.chromatic to 0",
  "light-leaks": "remove lightLeak / film-burn",
  flashes: "remove flashes; cut on the beat instead",
  glitch: "remove glitch styles / transitions",
  scanlines: "remove fx.scanlines",
  "hard-cuts": "join the scenes with match / expand / zoom-into, or make it one scene with a moving camera",
  crossfades: "use a match cut or grow the next scene out of an element (expand / zoom-into)",
  "generic-transitions": "only content-aware transitions (expand / zoom-into / match / slice)",
  "blur-ins": "enter with a mask, a move or a match instead (text preset mask-up / slide-words / none)",
  "3d-flips": "use a flat move or a morph instead of a flip",
  "dead-time": "give every gap a change (a keyframe, a cursor action, a camera move) on the beat",
};

/** Seconds at which something visibly starts changing (layer starts, keyframes, camera keys, clicks, transitions, actor moves). */
const eventTimes = (spec: Spec, layers: Visit[]): number[] => {
  const slots = sceneTimeline(spec.scenes, spec.fps).scenes;
  const ts: number[] = [];
  for (const { layer: l, start } of layers) {
    ts.push(start + (l.enter?.delay ?? 0));
    for (const k of l.animate ?? []) ts.push(start + k.t);
    if (l.type === "cursor") for (const c of [...(l.clicks ?? []), ...(l.drags ?? []).flatMap((d) => [d.at, d.until])]) ts.push(start + c);
    if (l.type === "toggle") for (const st of l.states) ts.push(start + st.at);
    if (l.type === "slider") for (const v of l.values ?? []) ts.push(start + v.at);
    if (l.type === "shape") for (const g of l.glide?.stops ?? []) ts.push(start + g.at);
    if (l.type === "counter" || l.type === "chart" || l.type === "code") ts.push(start + 0.5);
  }
  spec.scenes.forEach((s, i) => {
    const s0 = slots[i]?.start ?? 0;
    ts.push(s0);
    for (const k of s.camera?.keyframes ?? []) ts.push(s0 + k.t);
    for (const p of s.camera?.punch ?? []) ts.push(s0 + p);
  });
  for (const a of spec.actors ?? []) for (const p of a.poses) {
    const idx = typeof p.scene === "number" ? p.scene : spec.scenes.findIndex((s) => s.id === p.scene);
    const at = (slots[idx]?.start ?? 0) + (p.t ?? 0);
    ts.push(at - (p.move ?? 1), at);
  }
  return ts.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
};

const beatGrid = (spec: Spec, total: number): number[] => {
  if (spec.beats?.length) return spec.beats.filter((b) => b <= total);
  if (!spec.bpm) return [];
  const spb = 60 / spec.bpm, out: number[] = [];
  for (let t = spec.beatOffset ?? 0; t <= total; t += spb) out.push(t);
  return out;
};

/** First keyframe value of a camera prop vs its value after the last key (holds after the last key). */
const camEnds = (s: Scene | undefined, prop: "zoom" | "x" | "y") => {
  const pts = (s?.camera?.keyframes ?? []).filter((k) => k[prop] !== undefined).sort((a, b) => a.t - b.t);
  const def = prop === "zoom" ? 1 : 0;
  return { first: pts[0]?.[prop] ?? def, last: pts[pts.length - 1]?.[prop] ?? def };
};

export const directionWarnings = (spec: Spec): string[] => {
  const d = spec.concept?.direction;
  if (!d) return [];
  const out: string[] = [];
  const layers = allLayers(spec);
  const total = sceneTimeline(spec.scenes, spec.fps).totalFrames / spec.fps;
  const bans = new Set<Ban>(d.banned ?? []);
  if (d.oneTake) bans.add("hard-cuts").add("crossfades").add("generic-transitions");

  for (const ban of bans) {
    if (ban === "dead-time") continue;
    const hits = DETECT[ban](spec, layers);
    if (!hits.length) continue;
    const list = hits.slice(0, 4).map((h) => `${h.where} (${h.what})`).join(", ");
    out.push(`direction/banned ${ban}: ${list}${hits.length > 4 ? ` +${hits.length - 4} more` : ""} — ${FIX[ban]}.`);
  }

  // Beat density / dead time: gaps with nothing starting to change
  const events = eventTimes(spec, layers);
  const grid = beatGrid(spec, total);
  if (bans.has("dead-time") || d.everyBeat) {
    const spb = grid.length > 1 ? (grid[grid.length - 1] - grid[0]) / (grid.length - 1) : 0.5;
    const limit = Math.max(0.9, 2 * spb), end = total - 1.5; // the end card may hold
    const gaps: string[] = [];
    let prev = 0;
    for (const t of [...events, end]) {
      if (t > end) break;
      if (t - prev > limit) gaps.push(`${prev.toFixed(2)}–${t.toFixed(2)}s`);
      prev = Math.max(prev, t);
    }
    if (gaps.length) out.push(`direction/dead-time: nothing starts changing during ${gaps.slice(0, 4).join(", ")} (limit ${limit.toFixed(2)}s) — ${FIX["dead-time"]}.`);
  }
  if (d.everyBeat) {
    if (!grid.length) out.push("direction/every-beat: set spec.bpm (+ beatOffset) or spec.beats from analyze_audio so beats can be checked.");
    else {
      const spb = grid.length > 1 ? grid[1] - grid[0] : 0.5;
      const empty = grid.filter((b) => b < total - 1 && !events.some((e) => Math.abs(e - b) <= spb * 0.35));
      if (empty.length > grid.length * 0.25) {
        out.push(`direction/every-beat: ${empty.length}/${grid.length} beats have no change near them (first: ${empty.slice(0, 5).map((b) => b.toFixed(2) + "s").join(", ")}). Put keyframes, clicks or camera keys on those beats ("beat:N" times).`);
      }
    }
  }

  // One take: a single scene with a camera, or content-aware joins only (detected above); a one-scene film needs camera travel
  if (d.oneTake && spec.scenes.length === 1 && !spec.scenes[0].camera?.keyframes?.length && !spec.actors?.length) {
    out.push("direction/one-take: one scene but the camera never moves — lay the beats out in one world and travel between them with camera keyframes (log-space zoom, `physical` eases).");
  }

  // Hero element: present in every scene (as an actor spanning the film, or a layer id in each scene)
  if (d.hero) {
    const actor = spec.actors?.find((a) => a.id === d.hero);
    if (!actor) {
      const missing = spec.scenes.map((s, i) => ({ s, i })).filter(({ s }) => !JSON.stringify(s.layers).includes(`"id":"${d.hero}"`));
      if (missing.length) out.push(`direction/hero: "${d.hero}" is missing from ${missing.map(({ s, i }) => sceneName(s, i)).join(", ")} — make it an actor so ONE element carries every scene.`);
    } else if (actor.until !== undefined || (actor.from !== undefined && actor.from !== 0 && actor.from !== spec.scenes[0].id)) {
      out.push(`direction/hero: actor "${d.hero}" doesn't span the whole film (from/until set) — the hero should be on screen from the first frame to the last.`);
    }
  }

  // Loop: the last frame must rebuild the first
  if (d.loop || spec.concept?.story?.mnemonic?.loop) {
    const first = spec.scenes[0], last = spec.scenes[spec.scenes.length - 1];
    const off: string[] = [];
    for (const p of ["zoom", "x", "y"] as const) {
      const a = camEnds(first, p).first, b = camEnds(last, p).last;
      if (Math.abs(a - b) > (p === "zoom" ? 0.01 : 2)) off.push(`camera ${p} ${a}→${b}`);
    }
    if (JSON.stringify(first.background ?? null) !== JSON.stringify(last.background ?? null)) off.push("background differs");
    for (const a of spec.actors ?? []) {
      const p0 = a.poses[0], p1 = a.poses[a.poses.length - 1];
      for (const k of ["x", "y", "scale", "rotate"] as const) {
        const v0 = p0[k] ?? (k === "scale" ? 1 : 0), v1 = p1[k] ?? (k === "scale" ? 1 : 0);
        if (Math.abs(v0 - v1) > (k === "scale" ? 0.01 : 2)) off.push(`actor ${a.id} ${k} ${v0}→${v1}`);
      }
    }
    if (spec.scenes.length > 1) {
      const ids = first.layers.map((l) => l.id).filter(Boolean) as string[];
      const lastIds = new Set(last.layers.map((l) => l.id));
      const gone = ids.filter((id) => !lastIds.has(id));
      if (gone.length) off.push(`opening layers not rebuilt at the end: ${gone.slice(0, 4).join(", ")}`);
    }
    // Elements on screen at the end that animate IN at frame 0 are missing from the first frame
    const lastIds = new Set(last.layers.map((l) => l.id).filter(Boolean));
    const entering = first.layers.filter((l) => !(l.start ?? 0) && (spec.scenes.length === 1 || lastIds.has(l.id)) && (
      (l.enter && l.enter.type !== "none") || (l.type === "text" && (l.preset ?? "blur-rise") !== "none")));
    if (entering.length) off.push(`${entering.slice(0, 4).map((l) => l.id ?? l.type).join(", ")} animate in at frame 0 but are visible at the end (set preset/enter "none" or exit them)`);
    if (off.length) out.push(`direction/loop: the last frame doesn't match the first (${off.slice(0, 5).join("; ")}). Return every element, the camera and the background to their frame-0 state so the loop has no seam.`);
  }
  return out;
};
