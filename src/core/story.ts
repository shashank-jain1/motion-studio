/**
 * Story Engine helpers (pure, no I/O): the rubric + gates, concept ranking, the intensity curve and its checks,
 * niche inference and the per-niche cliché blacklist. Source of truth: docs/research/06-story-psychology.md;
 * operating manual for the AI: docs/STORY_ENGINE.md. Used by the craft linter (craft.ts) and the
 * story_kit / score_concepts / check_story tools (tools.ts).
 */
import { NICHES, STORY_STRUCTURES, STORY_TEMPLATES, type Layer, type Spec } from "../engine/spec/schema";
import { sceneIndexOf, sceneTimeline } from "../engine/spec/preprocess";

export type Niche = (typeof NICHES)[number];
export type Structure = (typeof STORY_STRUCTURES)[number];
type Story = NonNullable<NonNullable<Spec["concept"]>["story"]>;
export type StoryBeat = NonNullable<Story["beats"]>[number];
export type Scores = { hook: number; surprise: number; emotionalPeak: number; payoff: number; brandLinkage: number; clarity: number; uniqueness: number; feasibility: number };
export type ScoreKey = keyof Scores;
export type CandidateInput = { title: string; technique: string; logline: string; scores: Scores; total?: number; typicality?: number };
export type StoryIssue = { code: string; severity: "error" | "warn" | "info"; message: string };

// ---------------------------------------------------------------- rubric (research 06 §4c)

export const RUBRIC: { key: ScoreKey; code: string; weight: number; measures: string; one: string; three: string; five: string }[] = [
  { key: "hook", code: "H", weight: 2, measures: "motion onset + a prediction error or specific gap in ≤1s", one: "logo/title card, static start", three: "moving and readable, generic 'why keep watching'", five: "frame 0 shows an impossible or unfinished thing with a precise question" },
  { key: "surprise", code: "S", weight: 2, measures: "a prior is set, violated, then resolved", one: "nothing unexpected", three: "one mild, guessable twist", five: "expectation built, violated, resolved in <1s; viewers re-watch" },
  { key: "emotionalPeak", code: "E", weight: 2, measures: "a named emotion peaking at 60–80%", one: "flat throughout", three: "a peak exists but mild or mistimed", five: "unmistakable peak, tension before it, fast release" },
  { key: "payoff", code: "P", weight: 2, measures: "peak-end: ending resolves the gap, ≥80% of peak; motif becomes the logo", one: "fades to a logo card", three: "logo lands but the gap is half-closed", five: "the end is a second high (snap + mnemonic) and loops" },
  { key: "brandLinkage", code: "B", weight: 2, measures: "only works for this brand; distinctive assets inside the peak; pulsed", one: "swap-a-logo test fails", three: "brand at the peak but the idea is generic", five: "the story IS the product truth; motif/colour/sound are owned assets" },
  { key: "clarity", code: "C", weight: 1.5, measures: "one idea, ≤3 claims, readable sound-off, one sentence", one: "needs a voiceover", three: "clear on the second watch", five: "a stranger retells it in one sentence after one view" },
  { key: "uniqueness", code: "U", weight: 2, measures: "distance from the control, the blacklist and known ads", one: "a blacklisted cliché is central", three: "fresh execution of a familiar idea", five: "no competitor could run it; the critic can't name a precedent" },
  { key: "feasibility", code: "F", weight: 1.5, measures: "buildable with morph, actors, logo modes, path, particles, counter, device, 3D, sfx", one: "needs footage/character animation we don't have", three: "needs a custom component", five: "built entirely from documented primitives" },
];
/** Σ weight × 5 = 75. */
export const MAX_WEIGHTED = RUBRIC.reduce((a, r) => a + r.weight * 5, 0);
/** Hard fails regardless of total (research 06 §4c). */
export const GATES: Partial<Record<ScoreKey, number>> = { uniqueness: 3, brandLinkage: 3, clarity: 3, feasibility: 3 };
export const TYPICALITY_MAX = 0.3;
export const ALT_HOOK_MIN = 70;

export type ScoredCandidate = CandidateInput & { index: number; total: number; exact: number; gatesPassed: boolean; failedGates: string[]; discarded?: string };

export const scoreCandidate = (c: CandidateInput, index = 0): ScoredCandidate => {
  const bad = RUBRIC.filter((r) => typeof c.scores?.[r.key] !== "number" || c.scores[r.key] < 0 || c.scores[r.key] > 5 || Number.isNaN(c.scores[r.key]));
  if (bad.length) throw new Error(`candidate #${index} "${c.title}": scores need ${bad.map((r) => r.key).join(", ")} as numbers 0–5`);
  const exact = (RUBRIC.reduce((a, r) => a + r.weight * c.scores[r.key], 0) / MAX_WEIGHTED) * 100;
  const failedGates = Object.entries(GATES).filter(([k, min]) => c.scores[k as ScoreKey] < (min as number)).map(([k, min]) => `${k} ${c.scores[k as ScoreKey]} < ${min}`);
  const discarded = c.typicality !== undefined && c.typicality > TYPICALITY_MAX ? `typicality ${c.typicality} > ${TYPICALITY_MAX} (a typical first idea)` : undefined;
  return { ...c, index, exact, total: Math.round(exact), gatesPassed: failedGates.length === 0, failedGates, ...(discarded ? { discarded } : {}) };
};

const ep = (c: ScoredCandidate) => c.scores.emotionalPeak + c.scores.payoff;

// ---------------------------------------------------------------- techniques, templates, structures (research 06 §2, §3)

export const TECHNIQUES: { id: string; name: string; prompt: string; match: RegExp }[] = [
  { id: "inherent-drama", name: "Inherent drama", prompt: "Find the 1-second moment in the product's mechanism that is already dramatic.", match: /inherent|drama|mechanism/ },
  { id: "metaphor-mining", name: "Metaphor mining", prompt: "Force a NON-category domain (a kitchen for finance, weather for software); silhouette must rhyme with the logo.", match: /metaphor|analog/ },
  { id: "inversion", name: "Inversion / convention flip", prompt: "List 5 category conventions and do the opposite of one (Think Small).", match: /invers|flip|opposite|subver/ },
  { id: "exaggeration", name: "Exaggeration / extreme situation", prompt: "Push one attribute to an absurd extreme.", match: /exaggerat|extreme|absurd/ },
  { id: "perspective-shift", name: "Perspective shift", prompt: "Tell it from the POV of the object, the problem, the motif or the competitor.", match: /perspective|pov|point of view/ },
  { id: "forced-connection", name: "Forced connection", prompt: "Pick a random kit shape (bean pin bolt spiral eye moon…) and force a link to the brand truth.", match: /forced|random/ },
  { id: "constraint", name: "Constraint", prompt: "One shape, one colour, no words — or the whole film in one continuous shot.", match: /constrain|one[- ]shot|one shape|no words/ },
  { id: "cultural-tension", name: "Cultural tension", prompt: "'Everyone in the category says X, but the audience secretly feels Y.'", match: /cultur|tension/ },
  { id: "consequence", name: "Consequence / time leap", prompt: "Day 1 vs day 365, or the ripple effect of one action.", match: /consequen|time[- ]?leap|ripple/ },
  { id: "sensory-transposition", name: "Sensory transposition", prompt: "Show taste as sound, speed as colour, quiet as a straight line.", match: /sensor|transpos|synesth/ },
];

export const GOLDENBERG: { id: (typeof STORY_TEMPLATES)[number]; does: string; kit: string; match: RegExp }[] = [
  { id: "pictorial-analogy", does: "a symbol enters the product space (replacement, extreme analogy)", kit: "`morph` A→B, logo `window`, the motif becomes the product", match: /pictorial|analogy|replacement/ },
  { id: "extreme-situation", does: "an unrealistic situation exaggerates one attribute (absurd alternative, extreme attribute/worth)", kit: "scale jumps, world-without structure, physics gags", match: /extreme|absurd|world[- ]without/ },
  { id: "consequences", does: "the extreme result of using — or NOT using — the product", kit: "time-leap `counter`, chain-reaction `path`, collapse vs order", match: /consequen/ },
  { id: "competition", does: "the product competes with something from another class (attribute, worth, uncommon use)", kit: "split-screen race, 'vs.' card, product in an odd job", match: /competi|uncommon use|\bvs\b/ },
  { id: "interactive-experiment", does: "the viewer does or imagines an experiment", kit: "'pause now' / 'count the dots' overlays; viewer completes the shape", match: /interactive|experiment|viewer (does|complet)/ },
  { id: "dimensionality-alteration", does: "changes the product's dimension (new connection, multiplication, division, time leap)", kit: "time-lapse, ×100 `repeat`, split into parts, infinite `zoom-into`", match: /dimension|multipl|division|time[- ]?leap|infinite zoom/ },
];

export const STRUCTURES: { id: Structure; beats: string; t10: string | null; t15: string; t30: string | null; use: string }[] = [
  { id: "story-spine", beats: "every day → until one day → because of that ×2 → until finally → ever since", t10: "0–1.5/1.5–3/3–7/7–8/8–10", t15: "0–2/2–4/4–10/10–12/12–15", t30: "0–4/4–8/8–20/20–25/25–30", use: "character-led; the motif as hero" },
  { id: "abt", beats: "And (world) → But (conflict) → Therefore (brand)", t10: "0–2.5/2.5–5/5–10", t15: "0–4/4–8/8–15", t30: "0–8/8–16/16–30", use: "explainers, B2B, one claim — default when unsure" },
  { id: "pas", beats: "Problem → agitation → solution", t10: "0–2/2–5/5–10", t15: "0–3/3–8/8–15", t30: "0–5/5–15/15–30", use: "pain-led performance ads (keep agitation comic/abstract)" },
  { id: "before-after-bridge", beats: "hook on After → Before → Bridge (brand) → After", t10: "0–1.5/1.5–4/4–8/8–10", t15: "0–2/2–6/6–12/12–15", t30: "0–3/3–12/12–25/25–30", use: "visible transformations (D2C, design tools)" },
  { id: "heros-journey", beats: "ordinary → call → threshold → ordeal → reward → return", t10: null, t15: "0–2/2–4/4–6/6–10/10–13/13–15", t30: "0–3/3–6/6–10/10–20/20–26/26–30", use: "launches, manifestos, fitness (not ≤10s)" },
  { id: "volta", beats: "long setup in one register → one-cut reinterpretation → landing", t10: "0–6.5/6.5–7.5/7.5–10", t15: "0–10/10–11/11–15", t30: "0–20/20–22/22–30", use: "humour, causes, 'it was X all along'" },
  { id: "metaphor", beats: "show A → A behaves like B → A becomes B → B is the brand", t10: "0–2/2–5/5–8/8–10", t15: "0–2/2–6/6–12/12–15", t30: "0–4/4–14/14–25/25–30", use: "abstract products (software, finance, insurance)" },
  { id: "transformation", beats: "state A (grey, chaos) → process → state B (brand colour, order)", t10: "0–2/2–7/7–10", t15: "0–3/3–11/11–15", t30: "0–6/6–24/24–30", use: "verb is clarify / organise / grow" },
  { id: "reveal", beats: "partial (macro, silhouette, blur) → clues → full reveal", t10: "0–4/4–7/7–10", t15: "0–6/6–11/11–15", t30: "0–12/12–24/24–30", use: "launches, mystery, unboxing" },
  { id: "loop", beats: "last frame = first frame; the story implies a cycle", t10: "0–9 + seam", t15: "0–14 + seam", t30: "0–29 + seam", use: "organic Reels/TikTok, web heroes" },
  { id: "mystery-box", beats: "unexplained object → withheld → partial answers → answer + new question", t10: "0–2/2–6/6–9/9–10", t15: "0–3/3–9/9–13/13–15", t30: "0–5/5–18/18–27/27–30", use: "series, teasers, edu" },
  { id: "contrast", beats: "two lanes in parallel → they diverge → one wins", t10: "0–1.5/1.5–7/7–10", t15: "0–2/2–11/11–15", t30: "0–3/3–24/24–30", use: "comparison without naming rivals" },
  { id: "world-without", beats: "world without the product, absurd → product appears → world snaps right", t10: "0–5/5–7/7–10", t15: "0–7/7–10/10–15", t30: "0–14/14–20/20–30", use: "category-defining utilities" },
  { id: "pattern-break", beats: "beat, same beat, broken beat", t10: "0–2/2–4/4–7/7–10", t15: "0–3/3–6/6–10/10–15", t30: null, use: "humour, 6–10s bumpers (sub-structure at 30s)" },
];

/** Structure picker (research 06 §2 picking rules). */
export const structuresFor = (seconds: number): Structure[] => {
  if (seconds <= 10) return ["abt", "volta", "pattern-break", "reveal"];
  if (seconds <= 20) return STRUCTURES.filter((s) => s.id !== "heros-journey").map((s) => s.id);
  return ["story-spine", "heros-journey", "contrast", "abt", "transformation", "metaphor"];
};

// ---------------------------------------------------------------- ranking (research 06 §3.5, §4b–c)

const techniqueCard = (t: string): string | null => {
  const s = t.toLowerCase();
  if (/control|obvious/.test(s)) return "control";
  return TECHNIQUES.find((c) => c.match.test(s))?.id ?? null;
};

export type Ranking = { ranked: ScoredCandidate[]; winner: ScoredCandidate | null; alternates: ScoredCandidate[]; grafts: ScoredCandidate[]; advice: string[] };

export const pickWinner = (cands: CandidateInput[]): Ranking => {
  const scored = cands.map((c, i) => scoreCandidate(c, i));
  const ranked = [...scored].sort((a, b) => b.total - a.total || ep(b) - ep(a) || b.exact - a.exact);
  const winner = ranked.find((c) => c.gatesPassed && !c.discarded) ?? null;
  const alternates = winner ? ranked.filter((c) => c !== winner && c.gatesPassed && !c.discarded && c.total >= ALT_HOOK_MIN && c.scores.hook > winner.scores.hook) : [];
  const grafts = winner
    ? ranked.filter((c) => c !== winner && c.total >= 65 && (["surprise", "emotionalPeak", "payoff"] as ScoreKey[]).some((k) => c.scores[k] > winner.scores[k]))
    : [];
  const advice: string[] = [];
  if (cands.length < 8) advice.push(`Only ${cands.length} concepts — generate 8 (later ideas are more original; the first is everyone's).`);
  if (cands.length && techniqueCard(cands[0].technique) !== "control") advice.push("Candidate #0 should be the control: the deliberately obvious idea. Name it, ban its elements in clicheControl, and use it as the score floor.");
  const control = scored.find((c) => techniqueCard(c.technique) === "control");
  if (control && control.gatesPassed) advice.push(`The control (#${control.index}) passes every gate — you are scoring too kindly: an obvious idea has Uniqueness ≤ 1.`);
  const byCard = new Map<string, number[]>();
  scored.forEach((c) => {
    const card = techniqueCard(c.technique);
    if (card && card !== "control") byCard.set(card, [...(byCard.get(card) ?? []), c.index]);
  });
  for (const [card, ix] of byCard) if (ix.length > 1) advice.push(`Technique "${card}" is used by #${ix.join(", #")} — each concept must use a different technique card.`);
  const all = cands.map((c) => `${c.technique} ${c.logline}`.toLowerCase()).join(" | ");
  if (cands.length >= 4) {
    if (!GOLDENBERG.some((g) => g.match.test(all))) advice.push("No concept uses a Goldenberg template (pictorial analogy, extreme situation, consequences, competition, interactive experiment, dimensionality).");
    if (!/sound|sonic|audio|music|note|silence/.test(all)) advice.push("No sound-led concept — add one (sound ideas also graft easily onto the winner).");
    if (!/humou?r|benign|joke|gag|comic|funny|pattern[- ]break/.test(all)) advice.push("No humorous (benign-violation) concept — add one unless the brand is somber.");
  }
  scored.forEach((c) => {
    if (cands[c.index].total !== undefined && Math.abs((cands[c.index].total as number) - c.total) > 1) advice.push(`#${c.index} total recomputed: ${c.total} (you wrote ${cands[c.index].total}).`);
    if (c.discarded) advice.push(`#${c.index} discarded: ${c.discarded}.`);
  });
  if (!winner) advice.push("No concept passes the gates (U, B, C, F ≥ 3). Generate more with unused techniques before writing a spec.");
  else {
    const close = ranked.filter((c) => c !== winner && c.gatesPassed && c.total === winner.total);
    if (close.length) advice.push(`Tie at ${winner.total}: #${winner.index} wins on E+P (peak-end beats everything).`);
    if (winner.scores.emotionalPeak < 3) advice.push("The winner's emotional peak is weak (E < 3): name the emotion and design its peak at 60–80%.");
    if (alternates.length) advice.push(`Alternate hook variant${alternates.length > 1 ? "s" : ""}: #${alternates.map((a) => a.index).join(", #")} (≥70 and a stronger hook) — reuse the winner's body.`);
    if (grafts.length) advice.push(`Graft candidates: #${grafts.map((g) => g.index).join(", #")} beat the winner on S/E/P — graft ONE element if it keeps clarity.`);
  }
  return { ranked, winner, alternates, grafts, advice };
};

// ---------------------------------------------------------------- intensity curve (research 06 §1.5, §1.19, §4d)

export const PEAK_WINDOW: [number, number] = [0.6, 0.8];
export const END_RATIO = 0.8;
const DT = 0.05;

/** Intensity at time t: each beat holds from its t until the next beat (linear ramp to `to` when given); 0 before the first beat. */
export const intensityAt = (beats: StoryBeat[], t: number, duration: number): number => {
  const bs = [...beats].sort((a, b) => a.t - b.t);
  let v = 0;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.t > t + 1e-9) break;
    const end = bs[i + 1]?.t ?? duration;
    const span = Math.max(1e-6, end - b.t);
    v = b.to === undefined ? b.intensity : b.intensity + (b.to - b.intensity) * Math.min(1, (t - b.t) / span);
  }
  return v;
};

/** Sampled curve (default every 0.05s) over [0, duration). */
export const intensityCurve = (beats: StoryBeat[], duration: number, dt = DT): { t: number; v: number }[] => {
  const out: { t: number; v: number }[] = [];
  for (let t = 0; t < duration - 1e-9; t += dt) out.push({ t: +t.toFixed(4), v: intensityAt(beats, t, duration) });
  return out;
};

/** One value per second (the mean of that second), as in the research's curves. */
export const perSecond = (beats: StoryBeat[], duration: number): number[] => {
  const s = intensityCurve(beats, duration);
  const out: number[] = [];
  for (let k = 0; k < Math.ceil(duration - 1e-9); k++) {
    const vs = s.filter((x) => x.t >= k && x.t < k + 1).map((x) => x.v);
    out.push(vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10 : 0);
  }
  return out;
};

export type CurveShape = {
  peak: number; peakStart: number; peakEnd: number; peakRegions: [number, number][];
  dip: { at: number; v: number; length: number } | null; end: number; hookMin: number; duration: number;
};

export const curveShape = (beats: StoryBeat[], duration: number): CurveShape => {
  const s = intensityCurve(beats, duration);
  const peak = Math.max(0, ...s.map((x) => x.v));
  // regions at (near) peak height, split by a real drop (> 1 point)
  const regions: [number, number][] = [];
  let open: number | null = null, lastHigh = 0;
  for (const x of s) {
    if (x.v >= peak - 0.5) {
      if (open === null) open = x.t;
      lastHigh = x.t + DT;
    } else if (open !== null && x.v < peak - 1) {
      regions.push([open, lastHigh]);
      open = null;
    }
  }
  if (open !== null) regions.push([open, lastHigh]);
  // the dominant peak = the region holding the first sample AT the max
  const firstMax = s.find((x) => x.v >= peak - 1e-9)?.t ?? 0;
  const main = regions.find(([a, b]) => firstMax >= a - 1e-9 && firstMax < b + 1e-9) ?? [firstMax, firstMax + DT];
  const [peakStart, peakEnd] = [Math.max(firstMax, main[0]), main[1]];
  // the pre-peak dip: the lowest point within 2s before the peak, if ≥3 below the peak
  const pre = s.filter((x) => x.t >= peakStart - 2 && x.t < peakStart);
  let dip: CurveShape["dip"] = null;
  if (pre.length) {
    const lo = pre.reduce((a, b) => (b.v < a.v ? b : a));
    if (lo.v <= peak - 3) {
      const length = pre.filter((x) => x.v <= lo.v + 0.5).length * DT;
      dip = { at: lo.t, v: lo.v, length: +length.toFixed(2) };
    }
  }
  const hook = s.filter((x) => x.t >= 0.5 - 1e-9 && x.t <= 1.5);
  return {
    peak, peakStart, peakEnd, peakRegions: regions, dip,
    end: s.length ? s[s.length - 1].v : 0,
    hookMin: hook.length ? Math.min(...hook.map((x) => x.v)) : 0,
    duration,
  };
};

const pct = (t: number, d: number) => `${Math.round((t / d) * 100)}%`;
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Curve rules (research 06 §4d.2): hook, single dominant peak at 60–80%, dip before it, peak-end, floor, no flat stretch. */
export const checkCurve = (beats: StoryBeat[], duration: number, peakAt?: number): StoryIssue[] => {
  const out: StoryIssue[] = [];
  if (!beats.length) return [{ code: "beats", severity: "warn", message: "no beats: write the beat sheet with an intensity (0–10) per beat — it is the film's intensity curve." }];
  const sorted = [...beats].sort((a, b) => a.t - b.t);
  if (sorted.some((b, i) => b !== beats[i])) out.push({ code: "beats", severity: "warn", message: "beats are not in time order." });
  const late = beats.filter((b) => b.t >= duration);
  if (late.length) out.push({ code: "beats", severity: "warn", message: `${late.length} beat(s) start at/after the film ends (${f1(duration)}s).` });
  if (sorted[0].t > 0.5) out.push({ code: "curve-hook", severity: "warn", message: `the first beat starts at ${f1(sorted[0].t)}s — the hook must be live from frame 0.` });
  const c = curveShape(beats, duration);
  if (c.hookMin < 5) out.push({ code: "curve-hook", severity: "warn", message: `hook intensity ${f1(c.hookMin)} in 0.5–1.5s; it needs ≥5 (a prediction error or a specific gap from frame 0).` });
  const [w0, w1] = [PEAK_WINDOW[0] * duration, PEAK_WINDOW[1] * duration];
  const tol = 0.25;
  if (c.peak < 8) out.push({ code: "curve-peak", severity: "warn", message: `the peak is only ${f1(c.peak)}/10 — design one unmistakable 9–10 moment (the wow).` });
  if (!(c.peakStart < w1 + tol && c.peakEnd > w0 - tol)) {
    out.push({ code: "curve-peak", severity: "warn", message: `the peak (${f1(c.peakStart)}–${f1(c.peakEnd)}s, ${pct(c.peakStart, duration)}) should sit at 60–80% of the runtime (${f1(w0)}–${f1(w1)}s).` });
  }
  if (c.peakRegions.length > 1) {
    out.push({ code: "peaks", severity: "warn", message: `${c.peakRegions.length} equal peaks (${c.peakRegions.map(([a, b]) => `${f1(a)}–${f1(b)}s`).join(", ")}). Keep ONE dominant peak; lower the others by ≥1.` });
  }
  if (!c.dip) out.push({ code: "curve-dip", severity: "warn", message: `no dip before the peak: add a 0.3–0.6s near-silence or freeze (≥3 below the peak) right before ${f1(c.peakStart)}s — the payoff is only as big as the tension before it.` });
  else if (c.dip.length > 1.6) out.push({ code: "curve-dip", severity: "info", message: `the pre-peak dip lasts ~${f1(c.dip.length)}s; 0.3–0.6s is enough (a long lull loses viewers).` });
  if (c.end < END_RATIO * c.peak - 1e-6) {
    out.push({ code: "peak-end", severity: "warn", message: `the ending (${f1(c.end)}) is below 80% of the peak (${f1(c.peak)}). Viewers remember the peak and the END: give the lockup its own hit (motif snaps into the logo + sonic mnemonic), no fade-out.` });
  }
  // floor: the body (after the hook, outside the pre-peak dip) never below 3
  const s = intensityCurve(beats, duration);
  const low = s.filter((x) => x.t > 1.5 && x.t < c.peakStart - 2 && x.v < 3);
  if (low.length) out.push({ code: "curve-floor", severity: "warn", message: `intensity drops below 3 at ${f1(low[0].t)}s — the tension beat may dip, but never below 3 (outside the pre-peak hold).` });
  // flat stretch > 5s
  let runStart = 0;
  for (let i = 1; i <= s.length; i++) {
    if (i === s.length || Math.abs(s[i].v - s[runStart].v) > 1e-6) {
      const len = (i - runStart) * DT;
      if (len > 5 + 1e-6) {
        out.push({ code: "curve-flat", severity: "warn", message: `intensity is flat at ${f1(s[runStart].v)} for ${f1(len)}s from ${f1(s[runStart].t)}s — tension should rise (stack escalating micro-rewards).` });
        break;
      }
      runStart = i;
    }
  }
  if (peakAt !== undefined && (peakAt < c.peakStart - 0.5 || peakAt > c.peakEnd + 0.5)) {
    out.push({ code: "curve-peak", severity: "warn", message: `peakAt ${f1(peakAt)}s doesn't match the beat sheet's peak (${f1(c.peakStart)}–${f1(c.peakEnd)}s).` });
  }
  return out;
};

const BARS = " ▁▂▃▄▅▆▇█";

/** ASCII sparkline of the curve with the 60–80% window and markers (^ peak, v dip, W wow). */
export const sparkline = (beats: StoryBeat[], duration: number, width = Math.min(60, Math.max(10, Math.ceil(duration / 0.25)))): string => {
  const step = duration / width;
  const c = curveShape(beats, duration);
  const col = (t: number) => Math.min(width - 1, Math.max(0, Math.floor(t / step)));
  const bars = Array.from({ length: width }, (_, i) => BARS[Math.round((intensityAt(beats, (i + 0.5) * step, duration) / 10) * 8)]).join("");
  const win = Array.from({ length: width }, (_, i) => {
    const t = (i + 0.5) * step;
    return t >= PEAK_WINDOW[0] * duration && t <= PEAK_WINDOW[1] * duration ? "=" : "·";
  }).join("");
  const marks = Array(width).fill(" ");
  const wow = beats.find((b) => b.wow);
  if (wow) marks[col(wow.t)] = "W";
  if (c.dip) marks[col(c.dip.at)] = "v";
  marks[col(c.peakStart)] = "^";
  const axis = `0s${" ".repeat(Math.max(1, width - 2 - `${f1(duration)}s`.length))}${f1(duration)}s`;
  return [`intensity |${bars}|`, `60–80%    |${win}|`, `marks     |${marks.join("")}|`, `          |${axis}|`].join("\n");
};

// ---------------------------------------------------------------- spec walking

export type Token = { kind: "text" | "shape" | "concept"; value: string; where: string; at?: number };

const totalSeconds = (spec: Spec) => sceneTimeline(spec.scenes, spec.fps).totalFrames / spec.fps;

const shapeName = (s: string) => s.split("#")[0].trim().toLowerCase();

/** Every layer (recursing into groups and device screens) with its absolute start time. */
export const walkLayers = (spec: Spec, cb: (l: Layer, where: string, at: number) => void) => {
  const tl = sceneTimeline(spec.scenes, spec.fps);
  const visit = (l: Layer, where: string, base: number) => {
    const at = base + (l.start ?? 0);
    cb(l, where, at);
    if (l.type === "group") l.layers.forEach((c, i) => visit(c, `${where}.layers[${i}]`, at));
    if (l.type === "device") l.screens?.forEach((s, si) => s.layers?.forEach((c, i) => visit(c, `${where}.screens[${si}].layers[${i}]`, at + (s.at ?? 0))));
  };
  spec.scenes.forEach((sc, si) => sc.layers.forEach((l, li) => visit(l, `scenes[${si}].layers[${li}]`, tl.scenes[si].start)));
  (spec.actors ?? []).forEach((a) => {
    const fromIdx = sceneIndexOf(spec.scenes, a.from ?? a.poses[0]?.scene);
    const at = fromIdx >= 0 ? tl.scenes[fromIdx].start + (a.from === undefined ? (a.poses[0]?.t ?? 0) : 0) : 0;
    visit(a.layer, `actors["${a.id}"].layer`, at);
  });
};

/** Words, shape sources, icons/emojis and concept text the spec puts forward. */
export const specTokens = (spec: Spec): Token[] => {
  const out: Token[] = [];
  const push = (kind: Token["kind"], value: unknown, where: string, at?: number) => {
    if (typeof value === "string" && value.trim()) out.push({ kind, value: kind === "shape" ? shapeName(value) : value.toLowerCase(), where, at });
  };
  walkLayers(spec, (l, where, at) => {
    switch (l.type) {
      case "text": push("text", l.text, where, at); l.swap?.words.forEach((w) => push("text", w, where, at)); break;
      case "card": push("text", l.title, where, at); push("text", l.body, where, at); push("text", l.icon, where, at); break;
      case "counter": push("text", l.prefix, where, at); push("text", l.suffix, where, at); break;
      case "captions": push("text", l.text, where, at); l.words?.forEach((w) => push("text", w.text, where, at)); break;
      case "cloud": l.items.forEach((it, i) => { push("text", it.text, `${where}.items[${i}]`, at); push("text", it.emoji, `${where}.items[${i}]`, at); }); break;
      case "path": push("text", l.follower?.emoji, where, at); push("text", l.follower?.text, where, at); break;
      case "particles": push("shape", l.preset, where, at); break;
      case "morph": l.shapes.forEach((s, i) => push("shape", s.shape, `${where}.shapes[${i}]`, at + Math.max(0, s.at - (s.morph ?? 0.7)))); break;
      case "logo": push("shape", l.from, where, at); break;
      case "three": push("shape", l.source, where, at); break;
      default: break;
    }
  });
  const c = spec.concept;
  if (c) {
    push("concept", c.metaphor, "concept.metaphor");
    push("concept", c.motif, "concept.motif");
    push("concept", c.hook, "concept.hook");
    c.arc?.forEach((a, i) => push("concept", a, `concept.arc[${i}]`));
    const st = c.story;
    st?.beats?.forEach((b, i) => { push("concept", b.beat, `concept.story.beats[${i}]`, b.t); push("concept", b.wow, `concept.story.beats[${i}].wow`, b.t); });
    const ch = st?.chosen !== undefined ? st.candidates?.[st.chosen] : undefined;
    if (ch) push("concept", ch.logline, `concept.story.candidates[${st!.chosen}]`);
  }
  return out;
};

// ---------------------------------------------------------------- niche inference

const NICHE_WORDS: Record<Niche, RegExp> = {
  fintech: /\b(bank\w*|savings?|saver|money|invest\w*|budget\w*|payments?|pay|finance|fintech|loan|credit|debit|wallet|round-?ups?|interest|spend\w*)\b/g,
  crypto: /\b(crypto\w*|blockchain|web3|token|nft|defi|bitcoin|ethereum|on-?chain)\b/g,
  saas: /\b(saas|b2b|team(s|mates)?|workflow|dashboard|productivity|crm|meetings?|standups?|projects?|tickets|workspace|sprint|async)\b/g,
  ai: /\b(ai|a\.i\.|assistant|copilot|llm|gpt|agent|machine learning|prompt)\b/g,
  food: /\b(food|recipe|coffee|sauce|restaurant|menu|snack|taste|flavou?r|cook\w*|dinner|meal|kitchen|bakery|chef|pizza|oven|dough|burger|wood-fired|delivery|eat\w*)\b/g,
  beauty: /\b(skin\w*|beauty|serum|glow|hair|makeup|cosmetic\w*|moisturi\w*|spf|lipstick)\b/g,
  wellness: /\b(sleep\w*|health|calm|meditat\w*|wellness|therapy|mindful\w*|stress|insomnia|rest)\b/g,
  "real-estate": /\b(real estate|apartments?|rent(al)?|property|properties|listings?|mortgage|homes?|realtor|co-?living|tenants?)\b/g,
  app: /\b(app|apps|download|app store|google play|install|ios|android|notifications?|pings?|on tap)\b/g,
  education: /\b(learn\w*|language|courses?|lessons?|study|students?|teach\w*|school|tutor\w*|fluent)\b/g,
  events: /\b(events?|festival|concert|tickets?|conference|lineup|summit|gig|meetup|rsvp)\b/g,
  fitness: /\b(workouts?|gym|fitness|training|run(ning|ners?)?|reps|athletes?|cardio|strength)\b/g,
  travel: /\b(travel\w*|trips?|flights?|hotels?|destinations?|vacation|holiday|journey|booking)\b/g,
  sustainability: /\b(sustainab\w*|carbon|climate|recycl\w*|eco|planet|emissions|renewable|zero waste|compost)\b/g,
  creator: /\b(creators?|followers?|follow|subscribers?|subscribe|content|youtube|tiktok|influencer\w*|newsletter|posts?|breakdowns?|channel|@[a-z0-9_.]+)\b/g,
};

export const nicheOf = (spec: Spec): { niche: Niche; source: "concept" | "inferred"; score: number } | null => {
  if (spec.concept?.niche) return { niche: spec.concept.niche, source: "concept", score: Infinity };
  const c = spec.concept;
  const textParts = [spec.title, c?.truth, c?.metaphor, c?.motif, c?.hook, c?.story?.insight, c?.story?.audienceTension, ...(c?.arc ?? [])];
  const layerText = specTokens(spec).filter((t) => t.kind === "text").map((t) => t.value);
  const blob = [...textParts, ...layerText].filter(Boolean).join(" \n ").toLowerCase();
  let best: { niche: Niche; score: number } | null = null;
  for (const n of NICHES) {
    const score = (blob.match(NICHE_WORDS[n]) ?? []).length;
    if (score > 0 && (!best || score > best.score)) best = { niche: n, score };
  }
  return best && best.score >= 2 ? { ...best, source: "inferred" } : null;
};

// ---------------------------------------------------------------- cliché blacklist (research 06 §4f)

export type ClicheItem = { id: string; label: string; terms?: RegExp; shapes?: string[]; emoji?: string[] };

const R = (s: string) => new RegExp(s, "i");
export const BLACKLIST: Record<Niche, ClicheItem[]> = {
  fintech: [
    { id: "rising-arrow", label: "rising arrow / green line chart going up", terms: R("\\b(rising|upward|climbing|up and to the right|growth)\\s+(arrow|chart|line|curve|graph)|\\b(arrow|chart|line|graph) (going|goes|rising|climbs?) up\\b|\\bclimbs? (a|the) (rising )?(curve|line|chart)"), shapes: ["arrow"], emoji: ["📈", "⬆️", "↗️"] },
    { id: "coin-jar", label: "coins dropping into a piggy bank / jar", terms: R("\\bpiggy\\b|\\bcoin jar\\b|\\bcoins? (drop|falls?|dropping|into)\\b|\\bjar of coins\\b"), shapes: ["coin"], emoji: ["🐷", "🐖", "🪙"] },
    { id: "cash-gold", label: "stacks of cash / gold bars", terms: R("\\b(stacks? of (cash|money|bills)|gold bars?|money rain|raining money)\\b"), emoji: ["💰", "💵", "💸", "🤑"] },
    { id: "credit-card-spin", label: "a spinning credit card", terms: R("\\b(spinning|rotating|floating) (credit |debit )?card\\b"), shapes: ["card"], emoji: ["💳"] },
    { id: "padlock-shield", label: "padlock / shield for 'secure'", terms: R("\\b(padlock|locked down|lock(s|ed)? (in|into|up)|shield)\\b"), shapes: ["lock", "shield"], emoji: ["🔒", "🔐", "🛡️"] },
    { id: "handshake", label: "a handshake", terms: R("\\bhandshake\\b"), emoji: ["🤝"] },
    { id: "rocket-moon", label: "a rocket 'to the moon'", terms: R("\\b(rocket|to the moon|skyrocket\\w*)\\b"), emoji: ["🚀"] },
    { id: "money-plant", label: "a sprouting money plant", terms: R("\\b(money (plant|tree)|sprout\\w*|seedling)\\b"), shapes: ["leaf"], emoji: ["🌱"] },
    { id: "grad-cap", label: "a graduation cap", terms: R("\\bgraduation cap|mortarboard\\b"), emoji: ["🎓"] },
  ],
  crypto: [
    { id: "blockchain-cubes", label: "glowing blockchain cubes", terms: R("\\b(glowing )?(blockchain )?cubes?\\b") },
    { id: "node-network", label: "a network of nodes", terms: R("\\b(node network|network of nodes|connected nodes)\\b") },
    { id: "neon-circuitry", label: "neon circuitry / matrix code rain", terms: R("\\b(circuit(ry| board)|matrix|code rain)\\b") },
    { id: "rocket-moon", label: "'to the moon' rockets", terms: R("\\b(rocket|to the moon)\\b"), emoji: ["🚀", "🌕"] },
    { id: "coin-spin", label: "a Bitcoin coin spin", terms: R("\\b(bitcoin|coin spin|spinning coin)\\b"), shapes: ["coin"], emoji: ["₿", "🪙"] },
  ],
  saas: [
    { id: "glass-dashboards", label: "floating glassy dashboards", terms: R("\\b(floating|glass(y)?) dashboards?\\b") },
    { id: "isometric-office", label: "a 3D isometric office", terms: R("\\bisometric\\b") },
    { id: "node-network", label: "a node network 'connecting teams'", terms: R("\\b(node network|connected nodes|connecting teams|network of (nodes|dots))\\b") },
    { id: "get-started-cursor", label: "a cursor clicking 'Get started'", terms: R("\\bget started\\b") },
    { id: "puzzle", label: "puzzle pieces", terms: R("\\bpuzzle( pieces?)?\\b"), emoji: ["🧩"] },
    { id: "gears", label: "gears turning", terms: R("\\bgears?\\b|\\bcogs?\\b"), emoji: ["⚙️"] },
    { id: "lightbulb", label: "a lightbulb idea", terms: R("\\blight ?bulb\\b"), emoji: ["💡"] },
    { id: "high-five", label: "people high-fiving at a laptop", terms: R("\\bhigh[- ]?fiv\\w*"), emoji: ["🙌"] },
    { id: "all-in-one-orbit", label: "'all-in-one' icons orbiting a logo", terms: R("\\ball[- ]in[- ]one\\b|\\bicons? orbit\\w*") },
  ],
  ai: [
    { id: "glowing-brain", label: "a glowing brain", terms: R("\\bbrain\\b"), emoji: ["🧠"] },
    { id: "robot-hand", label: "a robot hand touching a human hand", terms: R("\\brobot\\w*\\b"), emoji: ["🤖", "🦾"] },
    { id: "nebula", label: "purple-blue particle nebula", terms: R("\\bnebula\\b") },
    { id: "sparkle", label: "a sparkle ✨ icon on everything", terms: R("\\bsparkles? icon\\b"), shapes: ["sparkle"], emoji: ["✨"] },
    { id: "chat-bubbles", label: "typing chat bubbles as the whole story", terms: R("\\btyping (dots|bubbles?|indicator)\\b") },
    { id: "magic-wand", label: "a 'magic wand'", terms: R("\\bmagic wand\\b|\\bwand\\b"), emoji: ["🪄"] },
  ],
  food: [
    { id: "slow-pour", label: "slow-motion pours", terms: R("\\bslow[- ]?(mo(tion)?)? ?pour\\w*|\\bpour(ing)? in slow") },
    { id: "steam", label: "rising steam", terms: R("\\b(rising )?steam\\b") },
    { id: "flying-ingredients", label: "flying ingredients exploding in slo-mo", terms: R("\\b(flying|exploding) ingredients\\b") },
    { id: "fire", label: "fire and flames for 'spicy'", terms: R("\\b(fire|flames?|blaze)\\b"), shapes: ["flame", "embers"], emoji: ["🔥", "🌶️"] },
    { id: "cheese-pull", label: "a cheese pull", terms: R("\\bcheese pull\\b"), emoji: ["🧀"] },
    { id: "fork-twirl", label: "a fork twirling pasta", terms: R("\\bfork twirl\\w*|twirl\\w* (the )?pasta") },
    { id: "mmm-bite", label: "the 'mmm' bite-and-close-eyes", terms: R("\\bm{3,}\\b|\\byum+\\b"), emoji: ["😋"] },
    { id: "splash-crown", label: "a water-splash crown on fruit", terms: R("\\bsplash crown\\b") },
  ],
  beauty: [
    { id: "droplets", label: "water droplets on skin", terms: R("\\b(water )?droplets?\\b|\\bdewy\\b"), shapes: ["drop"], emoji: ["💧"] },
    { id: "botanical-swirl", label: "a botanical leaf swirl for 'natural'", terms: R("\\b(botanical|leaf swirl|leaves swirl)\\b"), shapes: ["leaf"], emoji: ["🌿", "🍃"] },
    { id: "pastel-pedestal", label: "a product rotating on a pastel pedestal", terms: R("\\bpedestal\\b|\\bplinth\\b") },
    { id: "before-after-skin", label: "before/after skin split", terms: R("\\bbefore\\s*/\\s*after\\b|\\bbefore and after\\b") },
    { id: "cheek-touch", label: "a model touching her cheek", terms: R("\\btouch\\w* (her |the )?cheek\\b") },
    { id: "molecules", label: "floating ingredient molecules", terms: R("\\bmolecules?\\b") },
  ],
  wellness: [
    { id: "moon-stars", label: "moon and stars", terms: R("\\bmoon\\b|\\bstars\\b"), shapes: ["moon", "stars"], emoji: ["🌙", "⭐", "🌛", "✨"] },
    { id: "sheep", label: "counting sheep", terms: R("\\bsheep\\b"), emoji: ["🐑"] },
    { id: "yawn", label: "a yawning person", terms: R("\\byawn\\w*"), emoji: ["🥱"] },
    { id: "lotus", label: "a lotus / meditation silhouette at sunset", terms: R("\\blotus\\b|\\bmeditation silhouette\\b"), emoji: ["🪷", "🧘"] },
    { id: "heartbeat-line", label: "a heartbeat line for 'health'", terms: R("\\b(heartbeat|ecg|ekg|pulse) line\\b"), emoji: ["💓"] },
    { id: "leaves-ripples", label: "leaves and water ripples", terms: R("\\bripples?\\b|\\bfalling leaves\\b"), shapes: ["leaf"], emoji: ["🍃"] },
  ],
  "real-estate": [
    { id: "drone-skyline", label: "drone flyover of the skyline at golden hour", terms: R("\\b(drone|skyline|golden hour)\\b"), emoji: ["🌇", "🏙️"] },
    { id: "keys", label: "keys handed over", terms: R("\\bkeys?\\b"), emoji: ["🔑", "🗝️"] },
    { id: "dream-home", label: "'Your dream home awaits'", terms: R("\\bdream home\\b|\\bawaits\\b") },
    { id: "map-pin", label: "a map pin bouncing", terms: R("\\b(map )?pin (drop|bounc\\w*)\\b|\\bmap pin\\b"), shapes: ["pin"], emoji: ["📍"] },
    { id: "moving-family", label: "a family carrying boxes and laughing", terms: R("\\bcarrying boxes\\b|\\bmoving boxes\\b"), emoji: ["📦"] },
    { id: "house-heart", label: "a house icon with a heart", terms: R("\\bhouse icon\\b|\\bhome (icon|with a heart)\\b"), shapes: ["house", "heart"], emoji: ["🏠", "🏡", "❤️"] },
  ],
  app: [
    { id: "phone-spin", label: "a phone spinning in space", terms: R("\\b(phone|device|iphone) (spin\\w*|floating|rotat\\w*)\\b|\\bspinning (phone|device)\\b"), shapes: ["phone"], emoji: ["📱"] },
    { id: "icons-rain", label: "app icons raining down", terms: R("\\bicons? (rain\\w*|fall\\w*)\\b") },
    { id: "confetti", label: "a notification confetti burst", terms: R("\\bconfetti\\b"), shapes: ["confetti"], emoji: ["🎉", "🎊"] },
    { id: "hand-phone", label: "a hand holding a phone with a glowing screen", terms: R("\\bhand holding (a|the) phone\\b") },
    { id: "download-now", label: "'Download now' / App Store badges as the climax", terms: R("\\bdownload now\\b|\\bapp store\\b|\\bgoogle play\\b") },
  ],
  education: [
    { id: "flags", label: "flags", terms: R("\\bflags?\\b"), emoji: ["🇪🇸", "🇫🇷", "🇮🇹", "🇩🇪", "🏳️"] },
    { id: "hello-bubbles", label: "speech bubbles saying 'Hola/Bonjour/Ciao'", terms: R("\\b(hola|bonjour|ciao|hallo|konnichiwa)\\b") },
    { id: "globe", label: "a spinning globe", terms: R("\\bglobe\\b"), shapes: ["globe"], emoji: ["🌍", "🌎", "🌏"] },
    { id: "passport-stamps", label: "passport stamps", terms: R("\\bpassport\\b") },
    { id: "grad-cap", label: "a graduation cap", terms: R("\\bgraduation\\b|\\bmortarboard\\b"), emoji: ["🎓"] },
    { id: "lightbulb", label: "a lightbulb", terms: R("\\blight ?bulb\\b"), emoji: ["💡"] },
    { id: "books", label: "stacks of books", terms: R("\\bstacks? of books\\b|\\bbooks\\b"), emoji: ["📚"] },
    { id: "streak-flame", label: "a streak flame", terms: R("\\bstreak\\b"), shapes: ["flame"], emoji: ["🔥"] },
  ],
  events: [
    { id: "countdown", label: "countdown 3-2-1", terms: R("\\b3[\\s.,-]*2[\\s.,-]*1\\b|\\bcountdown\\b") },
    { id: "hands-up", label: "crowd hands in the air in silhouette", terms: R("\\bhands (in the air|up)\\b"), emoji: ["🙌"] },
    { id: "lasers", label: "laser beams", terms: R("\\blasers?\\b") },
    { id: "speakers", label: "speaker cones pulsing", terms: R("\\bspeakers? (cones?|puls\\w*)\\b"), emoji: ["🔊"] },
    { id: "confetti", label: "confetti cannons", terms: R("\\bconfetti\\b"), shapes: ["confetti"], emoji: ["🎉", "🎊"] },
    { id: "see-you-there", label: "'See you there'", terms: R("\\bsee you there\\b") },
  ],
  fitness: [
    { id: "sweat", label: "sweat drops in slo-mo", terms: R("\\bsweat\\w*\\b"), shapes: ["drop"], emoji: ["💦"] },
    { id: "lifting-silhouette", label: "a lifting silhouette", terms: R("\\blifting silhouette\\b|\\bsilhouette lift\\w*") , emoji: ["🏋️"] },
    { id: "heartbeat-line", label: "a heartbeat line", terms: R("\\b(heartbeat|ecg|ekg|pulse) line\\b"), emoji: ["💓"] },
    { id: "stopwatch", label: "a stopwatch", terms: R("\\bstopwatch\\b"), emoji: ["⏱️"] },
    { id: "no-pain", label: "'No pain no gain' type slams", terms: R("\\bno pain\\b|\\bbeast mode\\b|\\bgrind\\b") },
    { id: "sunrise-run", label: "a sunrise run", terms: R("\\bsunrise run\\b") },
  ],
  travel: [
    { id: "plane-dotted", label: "a plane crossing a map with a dotted line", terms: R("\\b(plane|airplane)\\b.*\\b(map|dotted)\\b|\\bdotted (line|route)\\b"), emoji: ["✈️", "🛫"] },
    { id: "passport-suitcase", label: "a passport and suitcase", terms: R("\\b(passport|suitcase|luggage)\\b"), emoji: ["🧳"] },
    { id: "hammock", label: "a beach hammock", terms: R("\\bhammock\\b"), emoji: ["🏝️", "🏖️"] },
    { id: "polaroids", label: "polaroids scattering", terms: R("\\bpolaroids?\\b") },
    { id: "globe", label: "a spinning globe", terms: R("\\bglobe\\b"), shapes: ["globe"], emoji: ["🌍", "🌎", "🌏"] },
  ],
  sustainability: [
    { id: "leaf-hand", label: "a leaf in a hand", terms: R("\\bleaf in (a|the) hand\\b|\\bleaf\\b"), shapes: ["leaf"], emoji: ["🌱", "🌿", "🍃"] },
    { id: "earth-palms", label: "the Earth in palms", terms: R("\\bearth in\\b|\\bglobe\\b"), shapes: ["globe"], emoji: ["🌍", "🌎", "🌏"] },
    { id: "green-check", label: "a green check over a globe", terms: R("\\bgreen check\\b"), shapes: ["check"], emoji: ["✅"] },
    { id: "turbines", label: "wind turbines at sunset", terms: R("\\b(wind )?turbines?\\b") },
    { id: "recycling", label: "recycling arrows", terms: R("\\brecycling (arrows|symbol)\\b"), emoji: ["♻️"] },
  ],
  creator: [
    { id: "like-hearts", label: "like hearts floating up", terms: R("\\b(like )?hearts? (float\\w*|rising)\\b"), shapes: ["heart"], emoji: ["❤️", "💖", "👍"] },
    { id: "follower-counter", label: "follower counters ticking up", terms: R("\\bfollowers\\b|\\bsubscribers\\b") },
    { id: "ring-light", label: "a ring light", terms: R("\\bring ?light\\b") },
    { id: "link-in-bio", label: "'link in bio' arrows as the payoff", terms: R("\\blink in bio\\b") },
  ],
};

const itemMatches = (item: ClicheItem, t: Token): boolean => {
  if (t.kind === "shape") return !!item.shapes?.includes(t.value);
  if (item.terms?.test(t.value)) return true;
  return !!item.emoji?.some((e) => t.value.includes(e));
};

/** Does a free-form declared string (twist item / banned element) refer to this cliché? */
const refersTo = (item: ClicheItem, s: string): boolean => {
  const v = s.toLowerCase().trim();
  if (!v) return false;
  if (v === item.id || item.label.toLowerCase().includes(v) || item.shapes?.includes(v) || item.emoji?.includes(v)) return true;
  return !!item.terms?.test(v);
};

export type ClicheHit = { niche: Niche; item: ClicheItem; tokens: Token[]; twist?: string };

/** Blacklisted items present in the spec (text, shape sources, icons/emoji, concept text). `twist` set when declared. */
export const findCliches = (spec: Spec, niche?: Niche): ClicheHit[] => {
  const n = niche ?? nicheOf(spec)?.niche;
  if (!n) return [];
  const tokens = specTokens(spec);
  const twists = spec.concept?.story?.clicheControl?.twists ?? [];
  const out: ClicheHit[] = [];
  for (const item of BLACKLIST[n]) {
    const hits = tokens.filter((t) => itemMatches(item, t));
    if (!hits.length) continue;
    const tw = twists.find((x) => refersTo(item, x.item));
    out.push({ niche: n, item, tokens: hits, ...(tw ? { twist: tw.twist } : {}) });
  }
  return out;
};

/** Elements the director banned in clicheControl.banned that still appear in the visible spec (not in concept text). */
export const bannedHits = (spec: Spec): { banned: string; tokens: Token[] }[] => {
  const banned = spec.concept?.story?.clicheControl?.banned ?? [];
  const tokens = specTokens(spec).filter((t) => t.kind !== "concept");
  const out: { banned: string; tokens: Token[] }[] = [];
  for (const b of banned) {
    const v = b.toLowerCase().trim();
    if (!v) continue;
    const wordy = /[\p{L}\p{N}]/u.test(v);
    const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?\\b`, "i");
    const hits = tokens.filter((t) => (t.kind === "shape" ? t.value === v : wordy ? re.test(t.value) : t.value.includes(v)));
    if (hits.length) out.push({ banned: b, tokens: hits });
  }
  return out;
};

// ---------------------------------------------------------------- brand linkage (research 06 §1.15)

export const brandName = (spec: Spec): string | null => {
  const m = /^\s*([\p{L}\p{N}][\p{L}\p{N}&.'-]*(?:\s+[\p{Lu}][\p{L}\p{N}&.'-]*)?)\s+(helps|lets|gives|makes|turns|is)\b/u.exec(spec.concept?.truth ?? "");
  if (m) return m[1];
  const t = /^\s*([\p{L}\p{N}][\p{L}\p{N}&.'-]{2,})\s*[—–:-]/u.exec(spec.title ?? "");
  return t ? t[1] : null;
};

/** First moment a brand asset is on screen: a logo layer, a logo-sourced shape (svg:), a motif actor that becomes the logo, or the brand name. */
export const brandPresence = (spec: Spec): { first: number | null; logoAt: number | null; seededBy: string | null } => {
  const name = brandName(spec);
  const nameRe = name && name.length >= 3 ? new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
  let first: number | null = null, logoAt: number | null = null, seededBy: string | null = null;
  const see = (t: number, why: string) => { if (first === null || t < first) { first = t; seededBy = why; } };
  walkLayers(spec, (l, where, at) => {
    if (l.type === "logo") { see(at, `logo layer ${where}`); logoAt = logoAt === null ? at : Math.min(logoAt, at); }
    if (l.type === "morph") l.shapes.forEach((s) => { if (s.shape.startsWith("svg:")) see(at + Math.max(0, s.at - (s.morph ?? 0.7)), `logo-part morph ${where}`); });
    if (l.type === "three" && l.source.startsWith("svg:")) see(at, `3D logo ${where}`);
    if (nameRe) {
      const txt = l.type === "text" ? l.text : l.type === "card" ? `${l.title ?? ""} ${l.body ?? ""}` : "";
      if (txt && nameRe.test(txt)) see(at, `brand name in ${where}`);
    }
  });
  // a motif actor that ends as the logo carries the brand from its first appearance (Google's dots)
  const tl = sceneTimeline(spec.scenes, spec.fps);
  for (const a of spec.actors ?? []) {
    const becomesLogo = a.poses.some((p) => p.snapTo) || (a.layer.type === "morph" && a.layer.shapes.some((s) => s.shape.startsWith("svg:")));
    if (!becomesLogo) continue;
    const idx = sceneIndexOf(spec.scenes, a.from ?? a.poses[0]?.scene);
    if (idx >= 0) see(tl.scenes[idx].start + (a.from === undefined ? (a.poses[0]?.t ?? 0) : 0), `motif actor "${a.id}" (ends as the logo)`);
  }
  return { first, logoAt, seededBy };
};

// ---------------------------------------------------------------- the full story check

export const STORY_MIN_SECONDS = 6;

/** Every story issue for a parsed spec (the craft linter prefixes them with "story/"). */
export const storyIssues = (spec: Spec): StoryIssue[] => {
  const out: StoryIssue[] = [];
  const D = totalSeconds(spec);
  const story = spec.concept?.story;
  if (!story) {
    if (D > STORY_MIN_SECONDS) out.push({ code: "missing", severity: "warn", message: `no concept.story on a ${f1(D)}s film. Run the Story Engine (story_kit → 8 concepts → score_concepts → beats with an intensity curve) so it has a hook, ONE peak at 60–80%, and an ending people remember.` });
  } else {
    if (story.candidates?.length) {
      if (story.chosen === undefined || story.chosen >= story.candidates.length) {
        out.push({ code: "gates", severity: "warn", message: "concept.story.chosen must index the winning candidate." });
      } else {
        try {
          const r = pickWinner(story.candidates);
          const ch = r.ranked.find((c) => c.index === story.chosen)!;
          if (!ch.gatesPassed) out.push({ code: "gates", severity: "warn", message: `the chosen concept #${ch.index} "${ch.title}" fails the gates (${ch.failedGates.join(", ")}). Pick a concept with U, B, C, F ≥ 3${r.winner ? ` — #${r.winner.index} "${r.winner.title}" (${r.winner.total}) passes` : ""}.` });
          else if (r.winner && r.winner.index !== ch.index && r.winner.total - ch.total >= 5) out.push({ code: "gates", severity: "info", message: `chosen #${ch.index} (${ch.total}) scores below #${r.winner.index} "${r.winner.title}" (${r.winner.total}). Fine if deliberate; say why in a note.` });
        } catch (e) {
          out.push({ code: "gates", severity: "warn", message: (e as Error).message });
        }
      }
    }
    if (story.beats?.length) {
      out.push(...checkCurve(story.beats, D, story.peakAt));
      if (!story.beats.some((b) => b.wow)) out.push({ code: "wow", severity: "warn", message: "no wow moment declared. Mark the peak beat with `wow` (impossible transformation, scale jump, pattern break, satisfying completion or reinterpretation) — it must contain the brand asset." });
      else {
        const c = curveShape(story.beats, D);
        const w = story.beats.find((b) => b.wow)!;
        const sorted = [...story.beats].sort((a, b) => a.t - b.t);
        const wEnd = sorted[sorted.indexOf(w) + 1]?.t ?? D;
        if (!(w.t < c.peakEnd + 0.25 && wEnd > c.peakStart - 0.25)) out.push({ code: "wow", severity: "warn", message: `the wow beat (${f1(w.t)}s) is not the peak (${f1(c.peakStart)}s) — the wow must BE the film's peak.` });
      }
    } else out.push({ code: "beats", severity: "warn", message: "concept.story has no beats: add the beat sheet {t, beat, emotion, intensity, wow?, sound?} — it is how the curve gets checked." });
    if (!story.mnemonic) out.push({ code: "mnemonic", severity: "warn", message: "no mnemonic: end on a visual mnemonic (motif → logo) + a sonic one (the brand's fixed 2–4-note signature)." });
  }
  // brand linkage: present before the very end, or seeded early by a motif that becomes the logo
  if (D > STORY_MIN_SECONDS) {
    const b = brandPresence(spec);
    if (b.first === null) out.push({ code: "brand", severity: "warn", message: "no brand asset anywhere (logo layer, svg: logo part, motif that snaps into the logo, brand name). The brand has to be inside the peak, not missing." });
    else if (b.first > 0.6 * D) out.push({ code: "brand", severity: "warn", message: `brand linkage weak: the first brand asset appears at ${f1(b.first)}s (${pct(b.first, D)}) via ${b.seededBy}. Seed it early (brand colour/motif in the hook, a motif actor that becomes the logo) and pulse it 2–4×.` });
  }
  // clichés
  const twistless = findCliches(spec).filter((h) => !h.twist);
  for (const h of twistless) {
    const where = [...new Set(h.tokens.map((t) => t.where))].slice(0, 3).join(", ");
    out.push({ code: "cliche", severity: "warn", message: `${h.niche} cliché "${h.item.label}" (${where}). Remove it, or use it ONLY as the object of a twist and declare it in concept.story.clicheControl.twists [{item:"${h.item.shapes?.[0] ?? h.item.id}", twist:"…"}].` });
  }
  for (const b of bannedHits(spec)) {
    out.push({ code: "banned", severity: "warn", message: `"${b.banned}" is banned in clicheControl but appears at ${[...new Set(b.tokens.map((t) => t.where))].slice(0, 3).join(", ")}.` });
  }
  return out;
};

/** Human report for check_story: niche, curve sparkline, issues. */
export const storyReport = (spec: Spec): { text: string; issues: StoryIssue[] } => {
  const D = totalSeconds(spec);
  const story = spec.concept?.story;
  const niche = nicheOf(spec);
  const issues = storyIssues(spec);
  const lines: string[] = [];
  lines.push(`Story check · ${f1(D)}s · niche: ${niche ? `${niche.niche} (${niche.source === "concept" ? "concept.niche" : "inferred — set concept.niche to be sure"})` : "unknown (set concept.niche)"}${story?.structure ? ` · structure: ${story.structure}` : ""}${story?.template ? ` · template: ${story.template}` : ""}`);
  if (story?.beats?.length) {
    const c = curveShape(story.beats, D);
    lines.push("", sparkline(story.beats, D));
    lines.push(`per second: [${perSecond(story.beats, D).map((v) => f1(v)).join(",")}]`);
    lines.push(`peak ${f1(c.peak)} at ${f1(c.peakStart)}–${f1(c.peakEnd)}s (${pct(c.peakStart, D)}) · dip ${c.dip ? `${f1(c.dip.v)} at ${f1(c.dip.at)}s` : "none"} · end ${f1(c.end)} (${c.peak ? Math.round((c.end / c.peak) * 100) : 0}% of peak) · hook ${f1(c.hookMin)}`);
  }
  if (story?.candidates?.length) {
    try {
      const r = pickWinner(story.candidates);
      lines.push("", `Concepts: ${r.ranked.map((c) => `#${c.index} ${c.total}${c.gatesPassed ? "" : "✗"}${c.index === story.chosen ? "★" : ""}`).join(" · ")}`);
    } catch (e) {
      lines.push("", `Concepts: ${(e as Error).message}`);
    }
  } else if (story) lines.push("", "Concepts: none recorded (run score_concepts and keep the 8 candidates in concept.story.candidates).");
  const b = brandPresence(spec);
  lines.push(`Brand: ${b.first === null ? "not found" : `first at ${f1(b.first)}s (${pct(b.first, D)}) via ${b.seededBy}`}${b.logoAt !== null ? ` · logo layer at ${f1(b.logoAt)}s` : ""}`);
  const tw = findCliches(spec).filter((h) => h.twist);
  if (tw.length) lines.push(`Twisted clichés (allowed): ${tw.map((h) => `${h.item.label} → ${h.twist}`).join("; ")}`);
  lines.push("", issues.length ? `Issues (${issues.length}):\n${issues.map((i) => `  • [${i.severity}] story/${i.code}: ${i.message}`).join("\n")}` : "No story issues. Now preview_frames and check the picture delivers the curve.");
  return { text: lines.join("\n"), issues };
};

// ---------------------------------------------------------------- story_kit text

export const storyKit = (niche?: Niche, seconds?: number): string => {
  const L: string[] = [];
  L.push("# Story kit (docs/STORY_ENGINE.md has the full procedure)");
  L.push("", "## Rubric — score 0–5 each; total = Σ(weight × score) / 75 × 100");
  L.push("| Dim | W | Measures | 1 | 3 | 5 |", "|---|---|---|---|---|---|");
  for (const r of RUBRIC) L.push(`| ${r.key} (${r.code}) | ${r.weight} | ${r.measures} | ${r.one} | ${r.three} | ${r.five} |`);
  L.push("", `**Gates (hard fail):** ${Object.entries(GATES).map(([k, v]) => `${k} ≥ ${v}`).join(", ")}. Typicality > ${TYPICALITY_MAX} → discard. Winner = highest total passing the gates; ties → higher emotionalPeak + payoff. Runner-up ≥${ALT_HOOK_MIN} with a stronger hook → alternate hook variant. Graft ONE element from a strong loser.`);
  L.push("", "## Curve rules (beats → intensity 0–10)", "- 0.5–1.5s ≥5 (hook live from frame 0) · body never below 3 · rising toward the peak, no flat stretch > 5s", "- ONE dominant peak 9–10 at 60–80% of runtime · a 0.3–0.6s dip/silence/freeze (≥3 below the peak) right before it", "- the ending ≥ 80% of the peak (lockup has its own hit + sonic mnemonic) · the wow beat IS the peak and contains the brand asset");
  L.push("", "## Technique cards (concepts #1–#7 each use a different one; #0 is the control)");
  TECHNIQUES.forEach((t, i) => L.push(`${i + 1}. **${t.id}** — ${t.prompt}`));
  L.push("Also required across the 8: ≥1 Goldenberg template, ≥1 sound-led, ≥1 humorous (benign violation) unless the brand is somber.");
  L.push("", "## Goldenberg templates → motion kit (89% of top award-winning ads fit one)");
  for (const g of GOLDENBERG) L.push(`- **${g.id}**: ${g.does} → ${g.kit}`);
  L.push("", `## Structures (concept first, then the container)${seconds ? ` — for ${seconds}s prefer: ${structuresFor(seconds).join(", ")}` : ""}`);
  L.push("| id | beats | 10s | 15s | 30s | use |", "|---|---|---|---|---|---|");
  for (const s of STRUCTURES) L.push(`| ${s.id} | ${s.beats} | ${s.t10 ?? "—"} | ${s.t15} | ${s.t30 ?? "sub-structure"} | ${s.use} |`);
  L.push("Picking: ≤10s → abt / volta / pattern-break / reveal · 15s → anything but heros-journey · 30s+ → story-spine / heros-journey / contrast · organic → loop or a loop seam.");
  if (niche) {
    L.push("", `## Cliché blacklist: ${niche} (allowed ONLY as the object of a twist → declare it in concept.story.clicheControl.twists)`);
    for (const it of BLACKLIST[niche]) L.push(`- ${it.label}${it.shapes?.length ? ` (shapes: ${it.shapes.join(", ")})` : ""}`);
  } else {
    L.push("", `## Cliché blacklists — call story_kit {niche} for one: ${NICHES.join(", ")}`);
  }
  L.push("", "## concept.story shape", "`{insight, audienceTension, inherentDrama, orthodoxy[], structure, template?, candidates:[{title, technique, logline, scores:{hook,surprise,emotionalPeak,payoff,brandLinkage,clarity,uniqueness,feasibility}, typicality?}], chosen, clicheControl:{obvious, banned[], twists?:[{item,twist}]}, beats:[{t, beat, emotion, intensity, to?, wow?, sound?}], peakAt, mnemonic:{visual, sonic, loop}}` + `concept.niche`.");
  return L.join("\n");
};
