/**
 * Footage edit planner tests (src/core/editPlan.ts). Run: npx tsx scripts/tests/edit-plan.test.ts
 * Synthetic word timings: retakes, stutters, fillers, long pauses, smeared silences, manual cuts.
 */
import assert from "node:assert/strict";
import { describePlan, planEdit, type Word } from "../../src/core/editPlan";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${(e as Error).stack}`); process.exitCode = 1; }
};

/** "a b c | 1.0 d e" → words 0.3s long with 0.05s gaps; "| x" inserts an x-second pause. */
const say = (script: string, t0 = 0.5): Word[] => {
  const out: Word[] = [];
  let t = t0;
  const toks = script.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === "|") { t += Number(toks[++i]); continue; }
    out.push({ text: toks[i], start: t, end: t + 0.3 });
    t += 0.35;
  }
  return out;
};
const kept = (p: ReturnType<typeof planEdit>) => p.keep.map((k) => k.text).join(" / ");

test("clean speech: one stretch, only head/tail trimmed", () => {
  const w = say("Coffee should taste like morning.");
  const p = planEdit(w, 3);
  assert.equal(p.keep.length, 1);
  assert.equal(kept(p), "Coffee should taste like morning.");
  assert.deepEqual(p.cuts.map((c) => c.reason), ["head", "tail"]);
  assert.ok(p.editedSeconds < 3 && p.editedSeconds > 1.5);
});

test("long pause is tightened, short one kept", () => {
  const w = say("First idea here. | 2.0 Second idea | 0.2 continues.");
  const p = planEdit(w, 8);
  assert.equal(p.keep.length, 2);
  assert.equal(p.stats.pause.count, 1);
  assert.ok(p.stats.pause.seconds > 1.7);
  assert.equal(p.keep[1].text, "Second idea continues.");
});

test("fillers removed and split the stretch", () => {
  const p = planEdit(say("So um this is uh the plan."), 4);
  assert.equal(kept(p), "So / this is / the plan.");
  assert.equal(p.stats.filler.count, 2);
});

test("stutters: repeated word and repeated phrase drop the first copy", () => {
  const p = planEdit(say("I think I think the the answer is simple."), 5);
  assert.equal(kept(p).replace(/ \/ /g, " "), "I think the answer is simple.");
  assert.ok(p.stats.stutter.count >= 2);
});

test("retake after a breath keeps the last take", () => {
  const p = planEdit(say("So the main reason | 0.8 So the main reason is speed."), 6);
  assert.equal(kept(p), "So the main reason is speed.");
  assert.equal(p.stats.retake.count, 1);
  assert.match(p.cuts.find((c) => c.reason === "retake")!.text!, /So the main reason/);
});

test("retake with junk in between and a sentence end", () => {
  const p = planEdit(say("We built this for. | 0.6 Wait. | 0.6 We built this for busy people."), 8);
  assert.equal(kept(p), "We built this for busy people.");
});

test("different sentences sharing one opening word are NOT retakes", () => {
  const p = planEdit(say("The cup is warm. | 0.6 The bean is roasted."), 6);
  assert.equal(kept(p), "The cup is warm. / The bean is roasted.");
  assert.equal(p.stats.retake.count, 0);
});

test("silence smeared into a word's timing is still cut", () => {
  const w = say("Hello there friend");
  w[1].end += 2.5; // whisper stretched "there" over a pause that really follows it
  w[2].start += 2.5; w[2].end += 2.5;
  const silence = { start: w[1].start + 0.32, end: w[1].start + 2.7 };
  const p = planEdit(w, 6, {}, [silence]);
  assert.equal(p.keep.length, 2);
  assert.ok(p.editedSeconds < 2.2, String(p.editedSeconds));
});

test("manual cut range and options off", () => {
  const w = say("Keep this. | 0.5 Drop this part. | 0.5 Keep that.");
  const p = planEdit(w, 8, { cutRanges: [{ start: w[2].start, end: w[4].end }] });
  assert.equal(kept(p), "Keep this. / Keep that.");
  assert.equal(p.stats.manual.count, 1);
  const raw = planEdit(say("um um so so"), 3, { removeFillers: false, removeStutters: false, removeRetakes: false });
  assert.equal(kept(raw), "um um so so");
});

test("plan never overlaps, stays in bounds, and describes itself", () => {
  const w = say("um So the the plan | 1.5 So the plan is simple. | 3 We ship uh today.");
  const p = planEdit(w, 14);
  for (let i = 0; i < p.keep.length; i++) {
    assert.ok(p.keep[i].start >= 0 && p.keep[i].end <= 14 && p.keep[i].end > p.keep[i].start);
    if (i) assert.ok(p.keep[i].start >= p.keep[i - 1].end);
  }
  const total = p.keep.reduce((s, k) => s + k.end - k.start, 0) + p.cuts.reduce((s, c) => s + c.end - c.start, 0);
  assert.ok(Math.abs(total - 14) < 0.01, String(total));
  const d = describePlan(p);
  assert.match(d, /^Edit plan: 0:14\.0 → /);
  assert.match(d, /RETAKE/);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
