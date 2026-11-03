/**
 * Direction briefs — physical springs (superposition, velocity carried through retargets), log-space camera zoom and
 * the concept.direction linter (banned techniques, one take, hero, loop seam, dead time / every beat).
 */
import assert from "node:assert/strict";
import { SpecSchema, type Spec } from "../../src/engine/spec/schema";
import { EASING, evalKeyframes, springStep, springOmega } from "../../src/engine/core/animate";
import { directionWarnings } from "../../src/core/direction";

// --- springs -------------------------------------------------------------------------------------------------------------
// eased-only tracks are unchanged: piecewise interpolation, exact values at keys
const eased = [{ t: 0, x: 0 }, { t: 1, x: 100, ease: "outQuint" as const }, { t: 2, x: -50 }];
assert.equal(evalKeyframes(eased, 1).x, 100);
assert.equal(evalKeyframes(eased, 3).x, -50);
assert.equal(evalKeyframes(eased, 1.5).x, 25);

// `physical`: tiny overshoot, settles by its keyframe
const peak = Math.max(...Array.from({ length: 400 }, (_, i) => springStep(i / 200, springOmega(1, 0.82), 0.82)));
assert.ok(peak > 1 && peak < 1.02, `physical overshoot ${peak}`);
const one = [{ t: 0, x: 0 }, { t: 0.6, x: 300, ease: "physical" as const }];
assert.ok(Math.abs(evalKeyframes(one, 0.6).x! - 300) < 3.5, "settles within ~1% at its key");
assert.ok(Math.abs(evalKeyframes(one, 5).x! - 300) < 1e-6, "rests on the target");
assert.equal(EASING.physical(1), 1, "bounded ease is pinned at 1");

// retarget mid-flight keeps velocity (no stop between the two moves)
const chain = [{ t: 0, x: 0 }, { t: 0.6, x: 300, ease: "physical" as const, settle: 1 }, { t: 0.9, x: 500, ease: "physical" as const }];
const v = (t: number) => (evalKeyframes(chain, t + 0.005).x! - evalKeyframes(chain, t - 0.005).x!) / 0.01;
assert.ok(v(0.6) > 150, `velocity carried into the retarget (${v(0.6).toFixed(0)} px/s)`);
assert.ok(Math.abs(evalKeyframes(chain, 6).x! - 500) < 0.5, "chain ends on its last target");

// --- direction linter ----------------------------------------------------------------------------------------------------
const spec = (s: Record<string, unknown>): Spec => SpecSchema.parse({ fps: 30, concept: { truth: "t", motif: "m" }, ...s });
const has = (w: string[], re: RegExp) => w.some((x) => re.test(x));

assert.deepEqual(directionWarnings(spec({ scenes: [{ duration: 3, fx: { chromatic: 4 } }] })), [], "no direction block → no checks");

const busy = spec({
  concept: { truth: "t", motif: "m", direction: { banned: ["glow", "particle-bursts", "bouncy-easing", "rgb-split", "gradients", "camera-shake"] } },
  fx: { chromatic: 3 },
  scenes: [{
    duration: 4, camera: { shake: { amount: 4 } }, background: { type: "gradient", colors: ["#000", "#111"] },
    layers: [
      { type: "text", id: "h", text: "Hi", glow: true, enter: { type: "drop-bounce" } },
      { type: "particles", preset: "confetti" },
      { type: "shape", id: "s", shape: "circle", animate: [{ t: 0, x: 0 }, { t: 1, x: 100, ease: "outElastic" }] },
    ],
  }],
});
const bw = directionWarnings(busy);
for (const ban of ["glow", "particle-bursts", "bouncy-easing", "rgb-split", "gradients", "camera-shake"]) {
  assert.ok(has(bw, new RegExp(`banned ${ban}:`)), `detects ${ban}: ${bw.join("\n")}`);
}
const flips = directionWarnings(spec({ concept: { truth: "t", motif: "m", direction: { banned: ["blur-ins", "3d-flips"] } },
  scenes: [{ duration: 2, layers: [{ type: "text", id: "d", text: "a" }, { type: "text", id: "m", text: "b", preset: "mask-up", enter: { type: "flip-up" } }] }, { duration: 2, transition: { type: "book-flip" } }] }));
assert.ok(has(flips, /banned blur-ins: .*\/d \(blur-rise/) && !has(flips, /blur-ins: .*\/m /), flips.join("\n"));
assert.ok(has(flips, /banned 3d-flips: .*\/m \(flip\).*book-flip/), flips.join("\n"));
assert.ok(has(bw, /outElastic/) && has(bw, /drop-bounce/), "names the bouncy ease and enter");

// one take: hard cuts / crossfades / generic transitions are flagged; content-aware joins pass
const cuts = spec({
  concept: { truth: "t", motif: "m", direction: { oneTake: true } },
  scenes: [{ id: "a", duration: 2 }, { id: "b", duration: 2 }, { id: "c", duration: 2, transition: { type: "fade" } }, { id: "d", duration: 2, transition: { type: "match" } }],
});
const cw = directionWarnings(cuts);
assert.ok(has(cw, /banned hard-cuts: b/), cw.join("\n"));
assert.ok(has(cw, /banned crossfades: c/));
assert.ok(!cw.some((w) => / d \(/.test(w)), "match transition is allowed");
assert.ok(has(directionWarnings(spec({ concept: { truth: "t", motif: "m", direction: { oneTake: true } }, scenes: [{ duration: 6 }] })), /one-take: one scene but the camera never moves/));

// hero must be in every scene
const hero = directionWarnings(spec({
  concept: { truth: "t", motif: "m", direction: { hero: "dot" } },
  scenes: [{ id: "a", duration: 2, layers: [{ type: "shape", id: "dot", shape: "circle" }] }, { id: "b", duration: 2, transition: { type: "match" } }],
}));
assert.ok(has(hero, /hero: "dot" is missing from b/), hero.join("\n"));

// loop seam
const seam = directionWarnings(spec({
  concept: { truth: "t", motif: "m", direction: { loop: true } },
  scenes: [{ duration: 4, camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 3, zoom: 2.5 }] } }],
}));
assert.ok(has(seam, /loop: .*camera zoom 1→2\.5/), seam.join("\n"));
const closed = directionWarnings(spec({
  concept: { truth: "t", motif: "m", direction: { loop: true } },
  scenes: [{ duration: 4, camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 2, zoom: 2.5 }, { t: 4, zoom: 1 }] } }],
}));
assert.ok(!has(closed, /loop/), "a camera that comes home has no seam");
const fadeIn = directionWarnings(spec({
  concept: { truth: "t", motif: "m", direction: { loop: true } },
  scenes: [{ duration: 4, layers: [{ type: "text", id: "w", text: "Hi" }, { type: "text", id: "still", text: "Yo", preset: "none" }] }],
}));
assert.ok(has(fadeIn, /w animate in at frame 0/) && !has(fadeIn, /still/), fadeIn.join("\n"));

// dead time / every beat
const sparse = spec({
  bpm: 120,
  concept: { truth: "t", motif: "m", direction: { everyBeat: true, banned: ["dead-time"] } },
  scenes: [{ duration: 8, layers: [{ type: "shape", shape: "circle", animate: [{ t: 0, x: 0 }, { t: 0.5, x: 100 }, { t: 5, x: 0 }] }] }],
});
const sw = directionWarnings(sparse);
assert.ok(has(sw, /dead-time: nothing starts changing during 0\.50–5\.00s/), sw.join("\n"));
assert.ok(has(sw, /every-beat: \d+\/\d+ beats/));
const dense = spec({
  bpm: 120,
  concept: { truth: "t", motif: "m", direction: { everyBeat: true, banned: ["dead-time"] } },
  scenes: [{ duration: 4, layers: [{ type: "shape", shape: "circle", animate: Array.from({ length: 9 }, (_, i) => ({ t: i * 0.5, x: i % 2 ? 50 : 0 })) }] }],
});
assert.deepEqual(directionWarnings(dense), [], "a change on every beat passes");

console.log("direction: ok");
