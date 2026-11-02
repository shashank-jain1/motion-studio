/**
 * Footage edit planning (pure): from a word-level transcript (+ optional detected silences) decide what to keep.
 *
 * Removes, each with a reason the user can review before anything renders:
 *   - pauses longer than `maxPause` (dead air between phrases, kept short so speech still breathes),
 *   - filler words ("um", "uh", "erm"…),
 *   - stutters (an immediately repeated word or short phrase: "the the", "I think I think"),
 *   - retakes: a phrase that is abandoned and restarted ("So the main— So the main reason is…") keeps the LAST take.
 * Laughs, music and anything Whisper did not transcribe are only cut when they sit inside a pause, never mid-phrase.
 *
 * Times are seconds in the source file. No I/O here: src/core/footage.ts supplies transcripts and silences.
 */

export type Word = { text: string; start: number; end: number; p?: number };
export type Span = { start: number; end: number };
export type CutReason = "pause" | "filler" | "stutter" | "retake" | "head" | "tail" | "manual";
export type Cut = Span & { reason: CutReason; text?: string };
export type Keep = Span & { text: string; words: Word[] };

export type EditOptions = {
  /** Longest pause kept inside the edit, seconds (default 0.35). Longer gaps are tightened to this. */
  maxPause?: number;
  /** Air kept before the first and after the last word of each kept stretch (default 0.08). */
  pad?: number;
  removeFillers?: boolean;
  removeStutters?: boolean;
  removeRetakes?: boolean;
  /** Extra source ranges the user wants gone (e.g. "cut 12.0–15.5"). */
  cutRanges?: Span[];
  /** Stretches shorter than this are merged into a neighbour or dropped (default 0.25). */
  minKeep?: number;
};

export type EditPlan = {
  keep: Keep[];
  cuts: Cut[];
  sourceSeconds: number;
  editedSeconds: number;
  stats: Record<CutReason, { count: number; seconds: number }>;
  options: Required<Omit<EditOptions, "cutRanges">> & { cutRanges: Span[] };
};

export const DEFAULT_EDIT: Required<Omit<EditOptions, "cutRanges">> = {
  maxPause: 0.35, pad: 0.08, removeFillers: true, removeStutters: true, removeRetakes: true, minKeep: 0.25,
};

const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mhm", "eh"]);
/** Gap that ends a phrase for retake detection (people restart after a breath). */
const PHRASE_GAP = 0.45;

export const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
const endsSentence = (w: string) => /[.!?…]["')\]]*$/.test(w.trim());

/** Split word indices into phrases at long gaps or sentence ends. */
const phrases = (words: Word[]): number[][] => {
  const out: number[][] = [];
  let cur: number[] = [];
  words.forEach((w, i) => {
    if (cur.length && w.start - words[cur[cur.length - 1]].end > PHRASE_GAP) { out.push(cur); cur = []; }
    cur.push(i);
    if (endsSentence(w.text)) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
};

export const planEdit = (wordsIn: Word[], sourceSeconds: number, opts: EditOptions = {}, silences: Span[] = []): EditPlan => {
  const o = { ...DEFAULT_EDIT, ...opts, cutRanges: opts.cutRanges ?? [] };
  const words = wordsIn.filter((w) => w.text.trim() && w.end > w.start).sort((a, b) => a.start - b.start);
  const dropped = new Map<number, CutReason>();
  const n = words.map((w) => norm(w.text));

  if (o.removeFillers) n.forEach((t, i) => { if (FILLERS.has(t)) dropped.set(i, "filler"); });

  // stutters: an n-gram (n = 1..3) immediately repeated → drop the first copy
  if (o.removeStutters) {
    const live = () => n.map((_, i) => i).filter((i) => !dropped.has(i) && n[i]);
    for (const size of [3, 2, 1]) {
      const idx = live();
      for (let k = 0; k + 2 * size <= idx.length; k++) {
        const a = idx.slice(k, k + size), b = idx.slice(k + size, k + 2 * size);
        if (a.some((i) => dropped.has(i))) continue;
        if (a.every((i, j) => n[i] === n[b[j]]) && words[b[0]].start - words[a[size - 1]].end < 1.2) a.forEach((i) => dropped.set(i, "stutter"));
      }
    }
  }

  // retakes: phrase P is restarted by a later phrase Q (within the next two) that opens with P's first words.
  if (o.removeRetakes) {
    const ph = phrases(words).map((p) => p.filter((i) => !dropped.has(i) && n[i]));
    for (let a = 0; a < ph.length; a++) {
      const P = ph[a];
      if (P.length < 2) continue;
      for (let b = a + 1; b <= Math.min(a + 2, ph.length - 1); b++) {
        const Q = ph[b];
        if (!Q.length) continue;
        let same = 0;
        while (same < Math.min(P.length, Q.length) && n[P[same]] === n[Q[same]]) same++;
        // a restart repeats at least 2 opening words (or ≥60% of a short abandoned phrase) and P ends no later in the thought
        const restart = same >= 2 || (same >= 1 && P.length <= 3 && same / P.length >= 0.6);
        if (restart && (P.length <= Q.length + 1 || !endsSentence(words[P[P.length - 1]].text))) {
          P.forEach((i) => dropped.set(i, "retake"));
          // anything said between the abandoned take and the restart belongs to the abandoned attempt too
          for (let m = a + 1; m < b; m++) ph[m].forEach((i) => dropped.set(i, "retake"));
          break;
        }
      }
    }
  }

  // manual cuts drop any word they overlap
  words.forEach((w, i) => { if (o.cutRanges.some((r) => w.start < r.end && w.end > r.start)) dropped.set(i, "manual"); });

  // keep stretches: consecutive kept words whose gap ≤ maxPause
  const keepIdx = words.map((_, i) => i).filter((i) => !dropped.has(i));
  const raw: { start: number; end: number; idx: number[] }[] = [];
  for (const i of keepIdx) {
    const w = words[i];
    const last = raw[raw.length - 1];
    const prevKept = last ? words[last.idx[last.idx.length - 1]] : null;
    // a dropped word between two kept ones always splits the stretch, even if the gap is tiny
    const between = last ? words.slice(last.idx[last.idx.length - 1] + 1, i).length > 0 : false;
    if (last && prevKept && !between && w.start - prevKept.end <= o.maxPause) { last.end = w.end; last.idx.push(i); }
    else raw.push({ start: w.start, end: w.end, idx: [i] });
  }

  // pad (never into a neighbouring word, so no sliver of a removed "um" survives), then split around long silences
  // Whisper smeared into word timings
  let spans = raw.map((r) => {
    const first = r.idx[0], last = r.idx[r.idx.length - 1];
    const before = first > 0 ? words[first - 1].end : 0;
    const after = last < words.length - 1 ? words[last + 1].start : sourceSeconds;
    return { ...r, start: Math.max(0, before, r.start - o.pad), end: Math.min(sourceSeconds, after, r.end + o.pad) };
  });
  for (const s of silences.filter((x) => x.end - x.start > o.maxPause + 2 * o.pad)) {
    spans = spans.flatMap((r) => {
      if (s.start <= r.start || s.end >= r.end) return [r];
      const left = { ...r, end: s.start + o.pad, idx: r.idx.filter((i) => words[i].start < s.start) };
      const right = { ...r, start: s.end - o.pad, idx: r.idx.filter((i) => words[i].start >= s.start) };
      return [left, right].filter((x) => x.idx.length);
    });
  }
  // padded neighbours that now overlap or touch become one stretch
  const merged: typeof spans = [];
  for (const r of spans) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end <= 0.02) { last.end = Math.max(last.end, r.end); last.idx.push(...r.idx); }
    else merged.push({ ...r, idx: [...r.idx] });
  }
  const keep: Keep[] = merged
    .filter((r) => r.end - r.start >= o.minKeep || r.idx.some((i) => words[i].end - words[i].start > 0.15))
    .map((r) => ({ start: round(r.start), end: round(r.end), words: r.idx.map((i) => words[i]), text: r.idx.map((i) => words[i].text.trim()).join(" ") }));

  // cuts = complement of keep, labelled by what they removed
  const cuts: Cut[] = [];
  let t = 0;
  for (let k = 0; k <= keep.length; k++) {
    const end = k < keep.length ? keep[k].start : sourceSeconds;
    if (end - t > 0.01) {
      const inside = words.map((w, i) => ({ w, i })).filter(({ w, i }) => (w.start + w.end) / 2 >= t && (w.start + w.end) / 2 <= end && dropped.has(i));
      const reasons = inside.map(({ i }) => dropped.get(i)!);
      const reason: CutReason = k === 0 && !inside.length ? "head" : k === keep.length && !inside.length ? "tail"
        : reasons.includes("retake") ? "retake" : reasons.includes("manual") ? "manual" : reasons.includes("stutter") ? "stutter" : reasons.includes("filler") ? "filler" : "pause";
      cuts.push({ start: round(t), end: round(end), reason, ...(inside.length ? { text: inside.map(({ w }) => w.text.trim()).join(" ") } : {}) });
    }
    if (k < keep.length) t = keep[k].end;
  }

  const stats = Object.fromEntries((["pause", "filler", "stutter", "retake", "head", "tail", "manual"] as CutReason[]).map((r) => {
    const cs = cuts.filter((c) => c.reason === r);
    return [r, { count: cs.length, seconds: round(cs.reduce((s, c) => s + c.end - c.start, 0)) }];
  })) as EditPlan["stats"];
  const editedSeconds = round(keep.reduce((s, k) => s + k.end - k.start, 0));
  return { keep, cuts, sourceSeconds: round(sourceSeconds), editedSeconds, stats, options: o };
};

const round = (x: number) => Math.round(x * 1000) / 1000;

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** The edit plan as the user reviews it before rendering. */
export const describePlan = (plan: EditPlan, maxLines = 40): string => {
  const saved = plan.sourceSeconds - plan.editedSeconds;
  const st = plan.stats;
  const parts = (["retake", "stutter", "filler", "pause", "manual", "head", "tail"] as CutReason[])
    .filter((r) => st[r].count).map((r) => `${st[r].count} ${r}${st[r].count === 1 ? "" : "s"} (${st[r].seconds.toFixed(1)}s)`);
  const lines = [
    `Edit plan: ${clock(plan.sourceSeconds)} → ${clock(plan.editedSeconds)} (−${saved.toFixed(1)}s, ${plan.keep.length} kept stretches).`,
    parts.length ? `Removed: ${parts.join(", ")}.` : "Nothing to remove.",
    "",
    "Cuts (source time):",
    ...plan.cuts.filter((c) => c.reason !== "pause" || c.end - c.start > 0.8).slice(0, maxLines).map((c) =>
      `  ${clock(c.start)}–${clock(c.end)}  ${c.reason.toUpperCase().padEnd(7)} ${c.text ? `“${c.text.length > 70 ? c.text.slice(0, 69) + "…" : c.text}”` : `${(c.end - c.start).toFixed(1)}s`}`),
  ];
  const small = plan.cuts.filter((c) => c.reason === "pause" && c.end - c.start <= 0.8).length;
  if (small) lines.push(`  …plus ${small} short pause${small === 1 ? "" : "s"} tightened.`);
  return lines.join("\n");
};
