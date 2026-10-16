/**
 * Story Engine unit tests (src/core/story.ts + craft linter wiring): rubric math vs the research's worked examples,
 * gates, winner/tie rules, intensity-curve checks, cliché detection across niches, niche inference, brand linkage.
 * Run: npx tsx scripts/tests/story.test.ts
 */
import assert from "node:assert/strict";
import { SpecSchema, type Spec, type SpecInput } from "../../src/engine/spec/schema";
import { preprocessSpec } from "../../src/engine/spec/preprocess";
import { craftWarnings } from "../../src/core/craft";
import {
  BLACKLIST, GATES, MAX_WEIGHTED, RUBRIC, checkCurve, curveShape, findCliches, nicheOf, perSecond, pickWinner,
  scoreCandidate, sparkline, storyIssues, storyKit, storyReport, type CandidateInput, type StoryBeat,
} from "../../src/core/story";

let n = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    n++;
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
};
const parse = (raw: unknown): Spec => SpecSchema.parse(preprocessSpec(raw as SpecInput));
const codes = (spec: Spec) => storyIssues(spec).map((i) => i.code);

// "H S E P B C U F" → candidate
const cand = (title: string, technique: string, s: string, extra: Partial<CandidateInput> = {}): CandidateInput => {
  const [hook, surprise, emotionalPeak, payoff, brandLinkage, clarity, uniqueness, feasibility] = s.split(" ").map(Number);
  return { title, technique, logline: title, scores: { hook, surprise, emotionalPeak, payoff, brandLinkage, clarity, uniqueness, feasibility }, ...extra };
};

// ---------------------------------------------------------------- rubric

test("rubric weights/gates match research 06 §4c", () => {
  assert.equal(MAX_WEIGHTED, 75);
  assert.deepEqual(RUBRIC.map((r) => r.weight), [2, 2, 2, 2, 2, 1.5, 2, 1.5]);
  assert.deepEqual(GATES, { uniqueness: 3, brandLinkage: 3, clarity: 3, feasibility: 3 });
});

// Penny (research 06 §4g example 1): totals in the table
const PENNY = [
  cand("Coins into a jar", "control", "2 0 1 2 2 5 0 5"),
  cand("Crumbs → coin → O", "metaphor mining + inherent drama", "4 4 3 4 5 4 4 4"),
  cand("Sofa change narrates", "perspective-shift (POV)", "3 3 3 3 4 3 4 3"),
  cand("Staircase to a plane ticket", "consequence / time leap", "3 3 4 4 3 3 3 4"),
  cand("Resolution card crumbles", "competition (Goldenberg)", "3 3 3 3 3 4 3 4"),
  cand("Coffee, bus, rent…", "pattern-break triple (humour)", "4 4 3 3 4 4 4 4"),
  cand("Round-ups compose the sonic logo", "sound-led", "3 3 3 4 4 3 4 3"),
  cand("Quiet money", "cultural tension", "2 2 2 2 2 3 3 4"),
];

test("scoreCandidate reproduces the research totals", () => {
  assert.deepEqual(PENNY.map((c, i) => scoreCandidate(c, i).total), [39, 80, 65, 67, 64, 75, 68, 49]);
  const ctl = scoreCandidate(PENNY[0]);
  assert.equal(ctl.gatesPassed, false);
  assert.deepEqual(ctl.failedGates, ["uniqueness 0 < 3", "brandLinkage 2 < 3"]);
  // Hush winner 88, Relay winner 87, Nook control 33
  assert.equal(scoreCandidate(cand("comb", "sensory", "4 4 4 5 5 4 5 4")).total, 88);
  assert.equal(scoreCandidate(cand("tetris", "competition", "5 4 4 5 4 5 4 4")).total, 87);
  assert.equal(scoreCandidate(cand("skyline", "control", "2 0 1 1 1 5 0 5")).total, 33);
  assert.throws(() => scoreCandidate(cand("bad", "x", "6 0 0 0 0 0 0 0")), /0–5/);
});

test("pickWinner: gates, winner, advice", () => {
  const r = pickWinner(PENNY);
  assert.equal(r.winner?.index, 1);
  assert.equal(r.ranked[0].index, 1);
  assert.ok(r.ranked.find((c) => c.index === 0)!.gatesPassed === false);
  assert.ok(!r.advice.some((a) => /control/.test(a) && /should be/.test(a)), r.advice.join("\n"));
  // a high-scoring concept that fails a gate never wins
  const r2 = pickWinner([cand("ctl", "control", "2 0 1 2 2 5 0 5"), cand("flashy", "exaggeration", "5 5 5 5 2 5 5 5"), cand("solid", "inversion", "3 3 3 3 3 3 3 3")]);
  assert.equal(r2.winner?.index, 2);
  assert.ok(r2.advice.some((a) => /Only 3 concepts/.test(a)));
  // typicality > 0.3 → discarded
  const r3 = pickWinner([cand("ctl", "control", "2 0 1 2 2 5 0 5"), cand("typical", "metaphor", "5 5 5 5 5 5 5 5", { typicality: 0.6 }), cand("ok", "inversion", "3 3 3 3 3 3 3 3")]);
  assert.equal(r3.winner?.index, 2);
  // tie → higher emotionalPeak + payoff
  const r4 = pickWinner([cand("A", "inversion", "5 5 3 3 4 4 4 4"), cand("B", "metaphor", "3 3 5 5 4 4 4 4")]);
  assert.equal(scoreCandidate(r4.ranked[0]).total, scoreCandidate(r4.ranked[1]).total);
  assert.equal(r4.winner?.title, "B");
  // repeated techniques, missing control, all gates failing
  const r5 = pickWinner([cand("x", "metaphor", "3 3 3 3 2 3 3 3"), cand("y", "metaphor mining", "3 3 3 3 3 3 2 3")]);
  assert.equal(r5.winner, null);
  assert.ok(r5.advice.some((a) => /metaphor-mining" is used by #0, #1/.test(a)), r5.advice.join("\n"));
  assert.ok(r5.advice.some((a) => /control/.test(a)));
  // a control that passes every gate means the scoring is too kind
  assert.ok(pickWinner([cand("ctl", "control", "3 3 3 3 3 3 3 3")]).advice.some((a) => /too kindly/.test(a)));
});

// ---------------------------------------------------------------- curve

const PENNY_BEATS: StoryBeat[] = [
  { t: 0, beat: "hook", intensity: 6 },
  { t: 1.5, beat: "tension", intensity: 5, to: 6 },
  { t: 5, beat: "transformation", intensity: 7, to: 8 },
  { t: 8.6, beat: "hold", intensity: 4 },
  { t: 9, beat: "peak", intensity: 10, wow: "crumbs snap into a coin" },
  { t: 11, beat: "payoff", intensity: 9 },
  { t: 12.5, beat: "lock", intensity: 8 },
];
const HUSH_BEATS: StoryBeat[] = [
  { t: 0, beat: "hook", intensity: 7 },
  { t: 1.5, beat: "tension", intensity: 6, to: 8 },
  { t: 5, beat: "hold", intensity: 5 },
  { t: 6, beat: "peak", intensity: 10, wow: "noise combed flat" },
  { t: 10, beat: "payoff", intensity: 9 },
  { t: 12.5, beat: "lock", intensity: 8 },
];

test("research example curves pass", () => {
  assert.deepEqual(checkCurve(PENNY_BEATS, 15, 9), []);
  assert.deepEqual(checkCurve(HUSH_BEATS, 15, 6), []);
  const c = curveShape(PENNY_BEATS, 15);
  assert.equal(c.peak, 10);
  assert.ok(Math.abs(c.peakStart - 9) < 0.06 && Math.abs(c.peakEnd - 11) < 0.06, `${c.peakStart}–${c.peakEnd}`);
  assert.ok(c.dip && c.dip.v === 4 && c.dip.length <= 0.5);
  assert.equal(c.end, 8);
  assert.equal(perSecond(PENNY_BEATS, 15).length, 15);
  const sp = sparkline(PENNY_BEATS, 15);
  assert.ok(sp.includes("^") && sp.includes("v") && sp.includes("="), sp);
});

const has = (issues: { code: string }[], code: string) => issues.some((i) => i.code === code);
test("curve violations are caught", () => {
  // peak too early (20%), and no dip
  const early = checkCurve([{ t: 0, beat: "hook", intensity: 10 }, { t: 3, beat: "x", intensity: 6, to: 8 }, { t: 9, beat: "lock", intensity: 8 }], 15);
  assert.ok(has(early, "curve-peak") && has(early, "curve-dip"), JSON.stringify(early));
  // fade-out ending (peak-end)
  const fade = checkCurve([...PENNY_BEATS.slice(0, 6), { t: 12.5, beat: "fade to logo", intensity: 4 }], 15);
  assert.ok(has(fade, "peak-end"), JSON.stringify(fade));
  // two equal peaks
  const twin = checkCurve([...PENNY_BEATS.slice(0, 5), { t: 11, beat: "payoff", intensity: 7 }, { t: 12.5, beat: "lock", intensity: 10 }], 15);
  assert.ok(has(twin, "peaks"), JSON.stringify(twin));
  // weak / late hook
  const hook = checkCurve([{ t: 0, beat: "logo card", intensity: 3 }, ...PENNY_BEATS.slice(1)], 15);
  assert.ok(has(hook, "curve-hook"));
  assert.ok(has(checkCurve(PENNY_BEATS.slice(1), 15), "curve-hook"));
  // flat body and floor
  const flat = checkCurve([{ t: 0, beat: "hook", intensity: 6 }, { t: 1.5, beat: "flat", intensity: 2 }, { t: 18, beat: "hold", intensity: 4 }, { t: 18.5, beat: "peak", intensity: 10 }, { t: 22, beat: "lock", intensity: 9 }], 30);
  assert.ok(has(flat, "curve-flat") && has(flat, "curve-floor"), JSON.stringify(flat));
  // low peak, declared peakAt mismatch
  assert.ok(has(checkCurve(PENNY_BEATS.map((b) => ({ ...b, intensity: Math.min(b.intensity, 7) })), 15), "curve-peak"));
  assert.ok(checkCurve(PENNY_BEATS, 15, 3).some((i) => /peakAt/.test(i.message)));
});

// ---------------------------------------------------------------- specs

const base = (extra: Record<string, unknown> = {}, scenes?: unknown[]) =>
  parse({ fps: 30, format: "9:16", scenes: scenes ?? [{ duration: 15, layers: [{ type: "text", text: "Hello" }] }], ...extra });

test("cliché detection across niches (text, shapes, emoji, particles, counters, concept)", () => {
  const cases: [string, Record<string, unknown>, unknown[], string][] = [
    ["fintech", { concept: { niche: "fintech" } }, [{ duration: 8, layers: [{ type: "morph", shapes: [{ at: 0.5, shape: "coin" }, { at: 2, shape: "circle" }] }] }], "coin-jar"],
    ["fintech", { concept: { niche: "fintech", metaphor: "a coin climbs a rising line" } }, [{ duration: 8, layers: [] }], "rising-arrow"],
    ["wellness", { concept: { niche: "wellness" } }, [{ duration: 8, layers: [{ type: "text", text: "Stop counting sheep" }] }], "sheep"],
    ["food", { concept: { niche: "food" } }, [{ duration: 8, layers: [{ type: "particles", preset: "embers" }] }], "fire"],
    ["app", { concept: { niche: "app" } }, [{ duration: 8, layers: [{ type: "particles", preset: "confetti" }, { type: "card", variant: "button", title: "Download now" }] }], "download-now"],
    ["real-estate", { concept: { niche: "real-estate" } }, [{ duration: 8, layers: [{ type: "text", text: "Your dream home awaits" }] }], "dream-home"],
    ["saas", { concept: { niche: "saas" } }, [{ duration: 8, layers: [{ type: "card", variant: "glass", icon: "🧩", title: "Integrations" }] }], "puzzle"],
    ["creator", { concept: { niche: "creator" } }, [{ duration: 8, layers: [{ type: "counter", to: 10000, suffix: " followers" }] }], "follower-counter"],
    ["ai", { concept: { niche: "ai" } }, [{ duration: 8, layers: [{ type: "text", text: "✨ Meet your assistant" }] }], "sparkle"],
    ["education", { concept: { niche: "education" } }, [{ duration: 8, layers: [{ type: "cloud", items: [{ text: "Hola" }, { text: "Bonjour" }] }] }], "hello-bubbles"],
    ["events", { concept: { niche: "events" } }, [{ duration: 8, layers: [{ type: "text", text: "See you there" }] }], "see-you-there"],
    ["travel", { concept: { niche: "travel" } }, [{ duration: 8, layers: [{ type: "morph", shapes: [{ at: 1, shape: "globe" }] }] }], "globe"],
  ];
  for (const [niche, extra, scenes, id] of cases) {
    const hits = findCliches(base(extra, scenes));
    assert.ok(hits.some((h) => h.niche === niche && h.item.id === id && !h.twist), `${niche}/${id}: ${JSON.stringify(hits.map((h) => h.item.id))}`);
  }
  assert.equal(Object.keys(BLACKLIST).length, 15);
  // a clean film in the same niche has no hits; a hit in another niche's list is not reported
  assert.deepEqual(findCliches(base({ concept: { niche: "wellness" } }, [{ duration: 8, layers: [{ type: "text", text: "Comb the noise flat" }] }])), []);
  assert.deepEqual(findCliches(base({ concept: { niche: "saas" } }, [{ duration: 8, layers: [{ type: "text", text: "Stop counting sheep" }] }])), []);
});

test("twists allow a blacklisted item; banned items are flagged", () => {
  const scenes = [{ duration: 8, layers: [{ type: "morph", shapes: [{ at: 1, shape: "coin" }] }, { type: "text", text: "Spare change, saved." }] }];
  const twisted = base({ concept: { niche: "fintech", story: { clicheControl: { obvious: "coins into a jar", banned: ["jar"], twists: [{ item: "coin", twist: "assembled from crumbs" }] } } } }, scenes);
  const hits = findCliches(twisted);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].twist, "assembled from crumbs");
  assert.ok(!codes(twisted).includes("cliche"));
  const banned = base({ concept: { niche: "fintech", story: { clicheControl: { obvious: "x", banned: ["change"] } } } }, scenes);
  assert.ok(codes(banned).includes("banned"));
  assert.ok(codes(banned).includes("cliche"), "coin without a twist is flagged");
});

test("nicheOf: explicit wins, inference from copy, null when unclear", () => {
  assert.equal(nicheOf(base({ concept: { niche: "travel" } }))?.niche, "travel");
  const inferred = nicheOf(base({ concept: { truth: "Kova helps young earners grow their savings automatically" } }, [{ duration: 8, layers: [{ type: "text", text: "Every round-up, saved" }, { type: "card", variant: "button", title: "Open an account at your bank" }] }]));
  assert.equal(inferred?.niche, "fintech");
  assert.equal(inferred?.source, "inferred");
  assert.equal(nicheOf(base()), null);
});

const LOGO = { type: "logo", id: "lockup", src: "assets/logo.svg", mode: "cascade" };
test("brand linkage, missing story, wow, mnemonic", () => {
  // logo only at 90% and nothing seeded → brand warning; >6s without story → missing
  const late = base({}, [{ duration: 9, layers: [{ type: "text", text: "Hello there" }] }, { duration: 3, layers: [{ ...LOGO, start: 1.8 }] }]);
  const c1 = codes(late);
  assert.ok(c1.includes("brand") && c1.includes("missing"), c1.join());
  // a motif actor that snaps into the logo seeds the brand from 0s
  const seeded = parse({
    fps: 30, format: "9:16",
    scenes: [{ id: "a", duration: 9, layers: [{ type: "text", text: "Hello there" }] }, { id: "b", duration: 3, layers: [{ ...LOGO, start: 1.8 }] }],
    actors: [{ id: "dot", layer: { type: "morph", shapes: [{ at: 0, shape: "circle" }] }, poses: [{ scene: "a", t: 0, x: 0, y: 0 }, { scene: "b", t: 2, snapTo: "lockup" }] }],
  });
  assert.ok(!codes(seeded).includes("brand"));
  // short films don't need a story block
  assert.ok(!codes(base({}, [{ duration: 5, layers: [{ type: "text", text: "Hi" }] }])).includes("missing"));
  // story without wow / mnemonic; chosen candidate failing a gate
  const noWow = base({ concept: { story: { beats: PENNY_BEATS.map(({ wow: _w, ...b }) => b), candidates: PENNY, chosen: 0 } } });
  const c2 = codes(noWow);
  assert.ok(c2.includes("wow") && c2.includes("mnemonic") && c2.includes("gates"), c2.join());
  // a full, clean story → only curve-clean codes
  const clean = parse({
    fps: 30, format: "9:16",
    concept: { niche: "fintech", truth: "Penny helps people save spare change, feeling effortless.", story: { beats: PENNY_BEATS, peakAt: 9, candidates: PENNY, chosen: 1, mnemonic: { visual: "coin → O", sonic: "3 ticks", loop: true } } },
    scenes: [{ duration: 12.5, layers: [{ type: "text", text: "Where did that go?" }] }, { duration: 2.5, layers: [{ ...LOGO, start: 0 }] }],
    actors: [{ id: "crumb", layer: { type: "morph", shapes: [{ at: 0, shape: "circle" }] }, poses: [{ scene: 0, t: 0 }, { scene: 1, t: 0.5, snapTo: "lockup" }] }],
  });
  assert.deepEqual(storyIssues(clean).filter((i) => i.severity !== "info"), []);
  assert.ok(!craftWarnings(clean).some((w) => w.startsWith("story/")), craftWarnings(clean).join("\n"));
  assert.ok(craftWarnings(late).some((w) => w.startsWith("story/missing")));
  const rep = storyReport(clean);
  assert.ok(rep.text.includes("intensity |") && rep.text.includes("No story issues"), rep.text);
});

test("storyKit is compact and complete", () => {
  const k = storyKit("wellness", 15);
  for (const s of ["hook (H)", "uniqueness ≥ 3", "inherent-drama", "pictorial-analogy", "story-spine", "world-without", "counting sheep"]) assert.ok(k.includes(s), s);
  assert.ok(k.split(/\s+/).length < 2200, `kit is ${k.split(/\s+/).length} words`);
  assert.ok(!storyKit().includes("counting sheep"));
});

console.log(`story tests: ${n} OK`);
