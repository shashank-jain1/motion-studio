import assert from "node:assert/strict";
import { ACCENT_ROLES, FORMATS, GESTURES, SpecSchema, type Layer, type Spec } from "../../src/engine/spec/schema";
import { gestureTiming, motionFrameTime } from "../../src/engine/core/choreography";
import { computeLayerTransform } from "../../src/engine/core/physics";
import { analyseLayerMotion } from "../../src/engine/audio/motionEvents";
import { planSoundV2 } from "../../src/engine/audio/autoSound";
import { inspectSound } from "../../src/engine/audio/inspect";
import { preprocessSpec, sceneTimeline } from "../../src/engine/spec/preprocess";
import { buildMotionScene, MOTION_RECIPES } from "../../src/engine/choreo/recipes";
import { reflowSpec } from "../../src/engine/spec/reflow";

const specFor = (layer: Layer, fps = 30): Spec => SpecSchema.parse({ fps, format: "16:9", sound: { restraint: 0.5 }, scenes: [{ id: "one", duration: 4, layers: [layer] }] });
const plan = (s: Spec) => planSoundV2(s, sceneTimeline(s.scenes, s.fps), { fps: s.fps });

for (const fps of [12, 24, 30, 60]) for (const preset of GESTURES) {
  const l: Layer = { type: "shape", shape: "rect", x: 53, y: 21, gesture: { preset, duration: 1.25, delay: 0.15 } };
  const clock = gestureTiming(l.gesture!);
  const contact = computeLayerTransform(l, clock.contact, 4, { fps });
  assert.ok(Math.abs(contact.x - 53) < 1e-8 && Math.abs(contact.y - 21) < 1e-8, `${preset}: contact must reach the authored landing point`);
  const rest = computeLayerTransform(l, clock.settle + 0.5, 4, { fps });
  assert.equal(rest.scale, 1); assert.equal(rest.rotate, 0); assert.equal(rest.rotateX, 0); assert.equal(rest.rotateY, 0);
  assert.equal(rest.scaleX, 1); assert.equal(rest.scaleY, 1);
  for (let f = 0; f < 4 * fps; f++) {
    const pose = computeLayerTransform(l, f / fps, 4, { fps });
    assert.ok(Object.values(pose).every((v) => typeof v !== "number" || Number.isFinite(v)));
  }
  const s = specFor(l, fps);
  // A music beat just after contact must never drag a pinned sound away from picture.
  const target = Math.round(clock.contact * fps) / fps;
  s.beats = [0, target + 1 / fps, 2, 3];
  const p = plan(s);
  assert.equal(p.cues.length, 1, `${preset}: one gesture, one cue`);
  assert.ok(Math.abs(p.cues[0].peak - target) < 0.0001, `${preset}: pinned contact moved onto a music beat`);
  assert.equal(p.cues[0].locked, true);
  assert.deepEqual(p, plan(s), "repeat planning must be identical");
}

const keyed: Layer = { type: "shape", shape: "circle", animate: [{ t: 0, x: -650 }, { t: 1.2, x: 0, ease: "inOutQuint" }, { t: 3, x: 0 }] };
const stepped: Layer = { type: "shape", shape: "circle", stepRate: 12, gesture: { preset: "elastic-slam", duration: 1.2 } };
const steppedContact = motionFrameTime(stepped, gestureTiming(stepped.gesture!).contact, 30);
assert.ok(Math.abs(plan(specFor(stepped)).cues[0].peak - steppedContact) < 0.0001, "a contact animated on twos must wait for its visible content tick");
const measured = analyseLayerMotion(keyed, 4, 30);
assert.equal(measured.length, 1, "a stationary keyframe hold must not generate a sound");
assert.ok(measured[0].rush > 0.4 && measured[0].rush < 0.8);
assert.ok(plan(specFor(keyed)).cues.some((c) => Math.abs(c.peak - measured[0].rush) < 0.0001), "whoosh apex follows measured speed");
const slow: Layer = { ...keyed, animate: [{ t: 0, x: 0 }, { t: 4, x: 20 }] };
assert.equal(plan(specFor(slow)).cues.length, 0, "subtle breathing moves stay silent");

const imported: Layer = { type: "shape", shape: "circle", start: 0.113, gesture: { preset: "magnetic", duration: 1 },
  accents: [{ at: "contact", role: "impact", importance: "hero", src: "assets/hit.wav", sourcePeak: 0.24, sourceDuration: 1.1 }] };
const nested = specFor({ type: "group", start: 0.117, layers: [imported], accents: [] });
const cue = plan(nested).cues[0];
const expected = (Math.round(0.117 * 30) + Math.round(0.113 * 30) + Math.round(0.64 * 30)) / 30;
assert.ok(Math.abs(cue.peak - expected) < 0.0001, "nested starts must round independently like nested Remotion Sequences");
assert.ok(Math.abs(cue.at + 0.24 - cue.peak) < 0.0001, "imported file's internal peak aligns to picture");
assert.equal(cue.importance, "hero");
assert.equal(inspectSound(nested).warnings.length, 0);

const silence = specFor({ type: "group", sound: false, layers: [imported] });
assert.equal(plan(silence).cues.length, 0, "parent mute suppresses the subtree");
const empty = specFor({ ...keyed, accents: [] });
assert.equal(plan(empty).cues.length, 0, "explicit empty accents suppress inference");
const conflict = specFor({ type: "shape", shape: "circle", accents: [{ at: 1, role: "impact" }, { at: 1.02, role: "click" }] });
assert.equal(plan(conflict).cues.length, 1);
assert.ok(plan(conflict).dropped.some((d) => d.why.includes("80 ms")), "collisions need a visible explanation");
conflict.sfx = [{ at: 1, src: "assets/manual.wav" }];
assert.equal(plan(conflict).cues.length, 0, "manual sound wins over inferred and authored auto cues");
assert.ok(plan(conflict).dropped.some((d) => d.why.includes("manual SFX")));

const unresolved = specFor({ type: "three", source: "primitive:box", accents: [{ at: "contact", role: "impact" }] });
assert.ok(inspectSound(unresolved).warnings.some((w) => w.includes("cannot resolve")));
unresolved.sound!.auto = false;
assert.equal(inspectSound(unresolved).cues.length, 0);
assert.ok(inspectSound(unresolved).warnings.some((w) => w.includes("inactive")));

const beatSpec = SpecSchema.parse(preprocessSpec({ bpm: 120, fps: 30, sound: {}, scenes: [{ duration: 4, layers: [{ type: "shape", shape: "circle", start: 0.5, accents: [{ at: "beat:3", role: "impact" }] }] }] }));
assert.equal(plan(beatSpec).cues[0].peak, 1.5, "beat anchors must resolve in the layer time base");

const actorSpec = specFor({ type: "shape", shape: "circle", sound: false });
actorSpec.actors = [{ id: "traveller", layer: { type: "shape", shape: "circle", gesture: { preset: "magnetic" } }, poses: [{ scene: "one", t: 0, x: 0, y: 0 }] }];
assert.ok(plan(actorSpec).cues.some((c) => c.reason.includes("actor.traveller")));

for (const recipe of MOTION_RECIPES) for (const [format, [width, height]] of Object.entries(FORMATS)) {
  const scene = buildMotionScene({ recipe: recipe.id, text: "SHIFT", width, height });
  const s = SpecSchema.parse({ fps: 30, format, sound: {}, scenes: [scene] });
  const report = inspectSound(s);
  assert.ok(report.cues.length > 0, `${recipe.id}/${format} has no sound`);
  assert.deepEqual(report.warnings, [], `${recipe.id}/${format}: invalid motion/sound contract`);
  assert.ok(report.cues.every((c) => c.syncErrorFrames === 0), `${recipe.id}: authored accents must be pinned`);
  assert.deepEqual(scene, buildMotionScene({ recipe: recipe.id, text: "SHIFT", width, height }));
}
const adapted = reflowSpec(specFor(imported), "9:16");
assert.equal(adapted.scenes[0].layers[0].gesture?.duration, 1, "format adaptation preserves timing");
assert.ok(adapted.scenes[0].layers[0].gesture?.distance !== undefined, "default gesture distance must also reflow");
assert.ok(ACCENT_ROLES.length > 5);
console.log("Choreography: 24 gesture/fps contracts, 40 recipe/format contracts, measured motion, nested timing, imported peaks, conflicts, actors and beat anchors passed.");
