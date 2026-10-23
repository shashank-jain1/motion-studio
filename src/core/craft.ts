/**
 * Craft linter: turns the research rules (docs/research/01–03, docs/DIRECTOR_GUIDE.md) into warnings the AI
 * director sees on every set_spec. Heuristic by design: each warning names the rule and a concrete fix.
 */
import { FORMATS, type Layer, type Spec } from "../engine/spec/schema";
import { sceneTimeline } from "../engine/spec/preprocess";
import { SAFE_ZONES } from "../engine/spec/reflow";
import { storyIssues } from "./story";
import { motionSoundWarnings } from "../engine/audio/inspect";

const HERO_TYPES = new Set(["logo", "device"]);
const READ_WPS = 1 / 0.3; // ~3.3 words/s → hold ≥ words × 0.3s

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Text a layer puts on screen (for reading-time checks). */
const layerText = (l: Layer): string | null => {
  if (l.type === "text") return l.text; // slot alternatives show one at a time
  if (l.type === "card") return [l.title, l.body].filter(Boolean).join(" ") || null;
  return null;
};

export const craftWarnings = (spec: Spec): string[] => {
  const out: string[] = motionSoundWarnings(spec).map((w) => `craft/motion-sound: ${w}`);
  const fmt = spec.format ?? "16:9";
  const [W, H] = spec.width && spec.height ? [spec.width, spec.height] : FORMATS[fmt];
  const vertical = H > W;
  const tl = sceneTimeline(spec.scenes, spec.fps);

  // 1. Concept first (director workflow §1)
  if (!spec.concept?.truth || !spec.concept?.motif) {
    out.push("craft/concept: fill `concept` (truth, metaphor, motif, verb, arc). Every premium piece is ONE idea that transforms; decide it before the scenes.");
  }

  // 2. Continuity: a multi-scene video with no thread element and only generic transitions reads as slides
  const contentAware = spec.scenes.some((s) => s.transition && ["expand", "zoom-into", "match", "slice"].includes(s.transition.type));
  const hasMorph = JSON.stringify(spec.scenes).includes('"type":"morph"') || !!spec.actors?.length;
  if (spec.scenes.length >= 3 && !spec.actors?.length && !contentAware) {
    out.push("craft/continuity: no actor and no content-aware transition (expand / zoom-into / match). Scenes will read as slides — carry a motif across cuts with `actors`, or grow the next scene out of an element.");
  }
  if (spec.scenes.length >= 3 && !hasMorph && !JSON.stringify(spec.scenes).includes('"type":"logo"')) {
    out.push("craft/transformation: nothing transforms (no morph, no actor, no logo reveal). Add at least one 'A becomes B' beat.");
  }

  // 2b. Actor snapTo targets must be logo layers (SVG) that exist
  for (const a of spec.actors ?? []) a.poses.forEach((p, pi) => {
    if (!p.snapTo) return;
    const id = p.snapTo.split("#")[0];
    const hit = spec.scenes.flatMap((s) => s.layers).find((l) => l.id === id);
    const at = `actors["${a.id}"].poses[${pi}].snapTo`;
    if (!hit) out.push(`${at}: no layer with id "${id}" in any scene (give the logo layer an \`id\`).`);
    else if (hit.type !== "logo") out.push(`${at}: layer "${id}" is a ${hit.type} layer; snapTo targets must be \`logo\` layers.`);
    else if (!/\.svg(\?|#|$)/i.test(hit.src)) out.push(`${at}: logo "${hit.src}" is not an SVG, so its parts can't be located — the snap is skipped.`);
    if (p.x !== undefined || p.y !== undefined || p.scale !== undefined) out.push(`${at}: x/y/scale on a snapTo pose are ignored (the snap computes them).`);
  });

  // 2c. Build with sound
  if (spec.scenes.length >= 2 && !spec.sound && !spec.audio && !spec.sfx?.length) {
    out.push("craft/sound: the film is silent. Add `\"sound\": {\"palette\": …}` (auto sound design: whooshes on cuts, hits on slams, ticks on counters) and optionally a music `audio` track — sound sync is a top retention lever.");
  }
  // 2d. 3D budget (one WebGL context per 3D layer; Chrome caps ~16)
  spec.scenes.forEach((sc, si) => {
    const n = sc.layers.filter((l) => l.type === "three").length;
    if (n > 2) out.push(`craft/3d scenes[${si}]: ${n} 3D layers. 3D is a centrepiece — keep 1 (max 2) per scene.`);
    for (const l of sc.layers) if (l.type === "three" && (l.repeat || l.motionBlur)) out.push(`craft/3d scenes[${si}]: avoid repeat/motionBlur on 3D layers (each copy is another WebGL canvas).`);
  });

  // 3. Hook: frame 0 must already move and be readable
  const first = spec.scenes[0];
  if (first) {
    const early = first.layers.filter((l) => (l.start ?? 0) <= 0.5);
    if (!early.length) out.push("craft/hook: nothing appears in the first 0.5s. Frame 0 is the thumbnail and the hook — start mid-motion.");
    if (first.layers.some((l) => l.type === "logo" && (l.start ?? 0) < 1)) {
      out.push("craft/hook: opening on the logo. A logo card is not a hook — integrate the brand into the motif and resolve the logo at the payoff.");
    }
  }

  spec.scenes.forEach((scene, si) => {
    const where = `scenes[${si}]${scene.id ? ` "${scene.id}"` : ""}`;
    const slot = tl.scenes[si];
    const visibleEnd = scene.duration - (spec.scenes[si + 1]?.transition ? (tl.scenes[si + 1]?.overlapIn ?? 0) : 0);

    // 4. Static frames: > 5s with no camera move, no loop, no animated background
    const camMoves = !!(scene.camera?.keyframes?.length || scene.camera?.punch?.length || scene.camera?.shake);
    // living elements: loops, keyframes, paths, 3D objects with motion/orbit, animated shaders, particles
    const anyLoop = scene.layers.some((l) => l.loop || l.animate?.length || l.path
      || (l.type === "three" && ((l.animation ?? "spin-in") !== "none" || !!l.orbit?.length))
      || l.type === "shader" || l.type === "particles");
    if (scene.duration > 5 && !camMoves && !anyLoop) {
      out.push(`craft/pacing ${where}: ${scene.duration}s with no camera move or living element. Add a breathing push (zoom 1→1.04) or a float loop — never hold a dead frame >5s.`);
    }

    // 5. Flash safety: > 3 flashes per second
    const flashes = [...(scene.fx?.flashes ?? []), ...(spec.fx?.flashes ?? [])].map((f) => f.at).sort((a, b) => a - b);
    for (let i = 0; i + 3 < flashes.length; i++) {
      if (flashes[i + 3] - flashes[i] < 1) { out.push(`craft/safety ${where}: more than 3 flashes within 1s (photosensitive-epilepsy limit).`); break; }
    }

    scene.layers.forEach((l, li) => {
      const at = `${where}.layers[${li}]${l.id ? ` #${l.id}` : ""}`;
      const start = l.start ?? 0;
      const end = Math.min(visibleEnd, l.duration !== undefined ? start + l.duration : visibleEnd);

      // 6. Reading time
      const txt = layerText(l);
      if (txt) {
        const n = words(txt);
        const need = Math.max(1.2, n / READ_WPS);
        if (end - start < need - 0.05) {
          out.push(`craft/reading ${at}: ${n} words visible for ${(end - start).toFixed(2)}s; needs ≥ ${need.toFixed(1)}s (max(1.2s, words×0.3s)). Lengthen the scene/layer or cut words.`);
        }
        if (l.type === "text" && n > 9) out.push(`craft/text ${at}: ${n} words on one beat. Keep ≤ 7 words per text beat; split it across beats.`);
      }

      // 7. Hero elements are revealed, not faded
      const isHero = HERO_TYPES.has(l.type) || (l.type === "text" && (l.fontSize ?? 120) >= 140);
      if (isHero && l.enter && ["fade", "blur-in"].includes(l.enter.type)) {
        out.push(`craft/reveal ${at}: hero element fades in. Reveal it instead (reveal-up / clip-* / grow / fly-in-3d / logo mode) — fades read as cheap on hero moments.`);
      }

      // 8. Long straight moves should arc
      const kfs = l.animate ?? [];
      for (let k = 1; k < kfs.length; k++) {
        const a = kfs[k - 1], b = kfs[k];
        if (a.x !== undefined && b.x !== undefined && a.y !== undefined && b.y !== undefined && Math.hypot(b.x - a.x, b.y - a.y) > 300 && !l.path) {
          out.push(`craft/arcs ${at}: a ${Math.round(Math.hypot(b.x - a.x, b.y - a.y))}px straight-line move. Use \`path.points\` (3+ points) so it travels on an arc.`);
          break;
        }
      }

      // 9. Safe zone for critical content, per format (same SAFE_ZONES the reflow engine uses)
      if (vertical && (txt || l.type === "logo" || l.type === "counter")) {
        const z = SAFE_ZONES[(spec.format ?? "9:16") as keyof typeof SAFE_ZONES] ?? SAFE_ZONES["9:16"];
        const ref = FORMATS[(spec.format ?? "9:16") as keyof typeof FORMATS] ?? [1080, 1920];
        const sx = W / ref[0], sy = H / ref[1];
        const x = l.x ?? 0, y = l.y ?? 0;
        if (y > z.b * sy || y < z.t * sy || x > z.r * sx || x < z.l * sx) {
          out.push(`craft/safe-zone ${at}: critical content at (${x}, ${y}) is outside the ${spec.format ?? "9:16"} safe zone (x ${z.l}…${z.r}, y ${z.t}…${z.b} from center). Platform UI will cover it.`);
        }
      }
    });
    void slot;
  });

  // 10. Story Engine (docs/STORY_ENGINE.md, research 06): story block, gates, intensity curve, peak-end, wow, brand linkage, clichés
  try {
    for (const i of storyIssues(spec)) if (i.severity !== "info") out.push(`story/${i.code}: ${i.message}`);
  } catch (e) {
    out.push(`story: checks skipped (${(e as Error).message})`);
  }

  return out;
};
