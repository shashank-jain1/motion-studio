import assert from "node:assert/strict";
import { SpecSchema, type Layer } from "../../src/engine/spec/schema";
import { sceneTimeline } from "../../src/engine/spec/preprocess";
import { planSoundV2 } from "../../src/engine/audio/autoSound";
import { clickAt, interactionFrame, toggleAt } from "../../src/engine/core/interaction";
import { buildDesignFilm } from "../../src/engine/choreo/designFilm";
import { inspectSound } from "../../src/engine/audio/inspect";
import { reflowSpec } from "../../src/engine/spec/reflow";

const plan = (layers: Layer[], fps = 30) => {
  const spec = SpecSchema.parse({ fps, sound: { restraint: 0.3 }, beats: [0, 0.85, 1.5], scenes: [{ duration: 3, layers }] });
  return planSoundV2(spec, sceneTimeline(spec.scenes, fps), { fps });
};
for (const fps of [24, 30, 60]) {
  const start = Math.round(0.117 * fps) / fps, at = interactionFrame(0.81, fps);
  const cues = plan([{ type: "group", start: 0.117, layers: [{ type: "cursor", clicks: [0.81, 4], label: "Edit" }] }], fps).cues;
  assert.equal(cues.length, 1, "ignore interactions after a clipped parent's end");
  assert.equal(cues[0].locked, true);
  assert.ok(Math.abs(cues[0].peak - (start + at)) < 0.0001, "nested press stays on its visible frame instead of a nearby beat");
  assert.equal(clickAt([at], at - 1 / fps).press, 0);
  assert.equal(clickAt([at], at).press, 1);
}
const cues = plan([{ type: "toggle", initial: false, states: [{ at: 1.8, on: false }, { at: 0.7, on: true }, { at: 1, on: true }] }]).cues;
assert.equal(cues.length, 2, "only real state transitions produce clicks, sorted in time");
assert.deepEqual(cues.map((c) => c.peak), [0.7, 1.8]);
assert.equal(plan([{ type: "cursor", clicks: [1], sound: false }]).cues.length, 0);
assert.equal(plan([{ type: "toggle", states: [{ at: 1, on: true }], accents: [] }]).cues.length, 0, "authored sound ownership still wins");
const states = [{ at: 0.5, on: true }, { at: 0.6, on: false }];
const before = toggleAt(states, 0.6 - 1e-8), after = toggleAt(states, 0.6);
assert.ok(Math.abs(before - after) < 1e-6 && before > 0 && before < 1, "an interrupted toggle starts from its current thumb position");
const sought = [1.2, 0.55, 0, 0.62, 0.6].map((t) => toggleAt(states, t));
assert.deepEqual(sought, [1.2, 0.55, 0, 0.62, 0.6].map((t) => toggleAt(states, t)), "reverse/random scrubbing is deterministic");
for (let i = 0; i <= 200; i++) assert.ok(toggleAt(states, i / 100) >= 0 && toggleAt(states, i / 100) <= 1);

const film = buildDesignFilm(), tl = sceneTimeline(film.scenes, film.fps), report = inspectSound(film);
assert.equal(tl.totalFrames, 600);
assert.equal(film.concept!.story!.candidates![film.concept!.story!.chosen!].title, "The cursor composes");
assert.ok(report.cues.some((c) => c.reason.includes("cursor press")));
assert.ok(report.cues.some((c) => c.reason.includes("toggle on")));
assert.ok(report.bridges.length > 5 && report.warnings.length === 0);
assert.ok(report.cues.filter((c) => c.locked).every((c) => c.syncErrorFrames === 0));
for (const format of ["9:16", "1:1", "4:5", "21:9"] as const) {
  const adapted = SpecSchema.parse(reflowSpec(film, format));
  assert.equal(sceneTimeline(adapted.scenes, adapted.fps).totalFrames, 600, "layout changes preserve action clocks");
  assert.equal((adapted.scenes[2].layers.find((l) => l.type === "toggle") as Extract<Layer, { type: "toggle" }>).states[0].at, 1.3);
}
console.log("Interactions: nested/frame-locked clicks, clipping, mute ownership, no-op states, interrupted toggle continuity, random seeking, design-film story/sound and cross-format timing passed.");
