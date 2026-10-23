import assert from "node:assert/strict";
import fs from "node:fs";
import { SpecSchema, FORMATS } from "../../src/engine/spec/schema";
import { sceneIndexOf, sceneTimeline } from "../../src/engine/spec/preprocess";
import { planSoundV2 } from "../../src/engine/audio/autoSound";
import { decodeRecipe, validateRecipe } from "../../src/engine/audio/bake";
import { SFX } from "../../src/engine/audio/library";
import { synthesize } from "../../src/engine/audio/synth";
import { connectSound } from "../../src/engine/audio/continuity";
import { flowAt, flowKeyframes } from "../../src/engine/core/flow";
import { buildMotionSequence } from "../../src/engine/choreo/sequences";
import { decodeWav, truePeak } from "../../src/engine/audio/dsp";
import { bakeRecipe, soundFilesForSpec } from "../sfx-bake";

const spec = buildMotionSequence({ treatment: "metamorphosis" });
const tl = sceneTimeline(spec.scenes, spec.fps), opts = { fps: spec.fps, total: tl.totalFrames / spec.fps };
const plan = planSoundV2(spec, tl, opts);
assert.equal(plan.cues.length, 4, "authored actor accents must not also infer pose-travel whooshes");
assert.equal(plan.bridges.length, 3, "each adjacent action in the phrase must connect");
assert.equal(plan.phrases.length, 1, "cuts do not reset the sonic phrase");
assert.deepEqual(plan, planSoundV2(spec, tl, opts));
for (const bridge of plan.bridges) {
  assert.ok(bridge.at > bridge.from && bridge.at + bridge.dur < bridge.to);
  const target = plan.cues.find((c) => c.peak === bridge.to)!;
  if (target.importance === "hero") assert.ok(bridge.at + bridge.dur <= target.peak - (0.35 + 0.5 * plan.brief.restraint) + 1e-6, "hero silence must survive the bridge");
  const recipe = decodeRecipe(bridge.src.slice(5));
  validateRecipe(recipe, (name) => !!SFX[name]);
  assert.ok(recipe.l.some((l) => l.s?.k === "thread"));
  assert.ok(recipe.l.some((l) => l.f && !l.rv && (l.i ?? 0) > 0), "carry the preceding recorded decay without replaying its attack");
  assert.equal(recipe.l.some((l) => l.rv), target.importance !== "hero", "prepare the next material except in the pre-hero rest");
  const audio = decodeWav(new Uint8Array(fs.readFileSync(bakeRecipe(bridge.src.slice(5)))));
  assert.ok(truePeak(audio) > 0.001 && truePeak(audio) < 1, "bridge is audible and unclipped");
}
const files = soundFilesForSpec(spec);
assert.ok(files.length >= plan.cues.length + plan.bridges.length, "Lambda must upload the connecting textures too");
const independent = SpecSchema.parse({ ...spec, sound: { ...spec.sound, continuity: false } });
assert.equal(planSoundV2(independent, tl, opts).bridges.length, 0);
const noBridges = SpecSchema.parse({ ...spec, sound: { ...spec.sound, continuity: { ...spec.sound!.continuity as object, bridges: false } } });
assert.equal(planSoundV2(noBridges, tl, opts).bridges.length, 0);
assert.deepEqual(plan.cues.map((c) => c.src), planSoundV2(noBridges, tl, opts).cues.map((c) => c.src), "bridge-only toggle must preserve foreground effects for A/B review");
const withManual = SpecSchema.parse({ ...spec, sfx: [{ src: "manual.wav", at: (plan.cues[0].peak + plan.cues[1].peak) / 2 }] });
assert.equal(connectSound(withManual, plan.cues, plan.brief, opts.total).bridges.length, 2, "manual sound owns its interval without an automatic bridge");
const rests = SpecSchema.parse({ ...spec, sound: { ...spec.sound, continuity: { maxGap: 0.3 } } });
const separated = connectSound(rests, plan.cues, plan.brief, opts.total);
assert.equal(separated.bridges.length, 0, "long rests remain quiet");
assert.equal(separated.phrases.length, 4, "a long rest begins a new phrase");
const underMusic = connectSound(spec, plan.cues, { ...plan.brief, hasMusic: true }, opts.total);
assert.ok(underMusic.bridges.every((b, i) => Math.abs(b.volume - plan.bridges[i].volume * 0.65) < 1e-10), "music retains headroom above the connecting textures");

const thread = { k: "thread" as const, d: 2, m: 50, brightness: 0.5, tension: 0.5, seed: 9 };
const a = synthesize({ ...thread, phase: 0 }), b = synthesize({ ...thread, phase: 1 });
assert.ok(Math.abs(a.L[72000] - b.L[24000]) < 1e-7, "the same global phase produces the same texture across bridge files");
assert.deepEqual(a, synthesize({ ...thread, phase: 0 }));

const keys = [{ t: 0, x: 0, scale: 0.2 }, { t: 1, x: 300, scale: 1 }, { t: 2, x: 900, scale: 0.5 }];
const eps = 0.00001;
const left = (flowAt(keys, 1).x! - flowAt(keys, 1 - eps).x!) / eps;
const right = (flowAt(keys, 1 + eps).x! - flowAt(keys, 1).x!) / eps;
assert.ok(Math.abs(left - right) < 0.1 && left > 1, "velocity is continuous and nonzero across a chapter boundary");
for (let i = 0; i <= 200; i++) assert.ok(flowAt(keys, i / 100).scale! > 0 && flowAt(keys, i / 100).scale! <= 1, "size never overshoots its authored bounds");
for (const treatment of ["sculpture-flow", "metamorphosis"] as const) for (const format of Object.keys(FORMATS) as (keyof typeof FORMATS)[]) {
  const film = buildMotionSequence({ treatment, format });
  const timeline = sceneTimeline(film.scenes, film.fps);
  const poses = film.actors![0].poses.map(({ scene, t, ...pose }) => ({ ...pose, t: timeline.scenes[sceneIndexOf(film.scenes, scene)].start + (t ?? 0) }));
  assert.ok(flowKeyframes(poses, film.fps).length > 100);
  assert.equal(film.actors!.length, 1);
  assert.equal(planSoundV2(film, timeline, { fps: film.fps }).bridges.length, 3);
}
console.log("Continuity: cross-cut phrases, material carries, hero silence, deterministic phase, Lambda assets, A/B isolation, continuous spline velocity and 10 sequence treatments/formats passed.");
