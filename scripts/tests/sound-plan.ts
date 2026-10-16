/**
 * Sound v2 planner test (in memory — nothing is written to the projects): prints the brief + cue sheet for existing
 * specs under different briefs and checks
 *   - variety: the same recorded file never plays twice in a row for the same role / slot
 *   - layering: hero cues are ≥ 3 layers (transient / body / sub / tail…), micro cues 1 layer
 *   - restraint: nothing but the hero in its pre-hero window, a music stopdown before every hero, density < 2.2 cues/s
 *   - key: every tonal layer (synth notes, tuned recorded layers) sits on the key's scale
 *   - sync: transition apexes land on their cut frames (±1), no two apexes within 80 ms
 *   - determinism: planning twice gives identical cues
 * plus bakes one hero + one whoosh recipe and checks the baked file's apex / peak level.
 *   node_modules/.bin/tsx scripts/tests/sound-plan.ts [--quiet]
 */
import fs from "node:fs";
import path from "node:path";
import { SpecSchema, type Spec } from "../../src/engine/spec/schema";
import { preprocessSpec, sceneTimeline } from "../../src/engine/spec/preprocess";
import { formatBrief, formatCueSheet, planSoundV2, type SoundPlan } from "../../src/engine/audio/autoSound";
import { SFX } from "../../src/engine/audio/library";
import { decodeRecipe } from "../../src/engine/audio/bake";
import { scalePcs } from "../../src/engine/audio/brief";
import { decodeWav, envelope, maxMomentary, midiOf, truePeak } from "../../src/engine/audio/dsp";
import { bakeRecipe } from "../sfx-bake";
import { estimateKey } from "../../src/core/audio";
import { synthesize } from "../../src/engine/audio/synth";
import { hz } from "../../src/engine/audio/dsp";

const quiet = process.argv.includes("--quiet");
let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.log(`  FAIL ${msg}`); } };

type Case = { id: string; label: string; sound: Record<string, unknown>; audio?: boolean };
const CASES: Case[] = [
  { id: "brew-film-f96a", label: "warm editorial (brief: wood/paper, room)", sound: { brief: { voice: "warm", materials: ["wood", "paper"], space: "room" } } },
  { id: "loopa-reel-049c", label: "playful (palette) + variation 0.8", sound: { palette: "playful", variation: 0.8 } },
  { id: "kova-every-platform-3bb0", label: "kova as saved (palette tech) — inferred brief", sound: {} },
  { id: "kova-every-platform-3bb0", label: "kova luxury glass, high restraint, avoid digital", sound: { brief: { voice: "luxury", materials: ["glass", "metal-thin"], space: "plate", avoid: ["digital", "gamey"] }, restraint: 0.8 } },
  { id: "neon-drop-test-6aa4", label: "neon raw + MUSIC (F# minor, 128 bpm, onsets)", sound: { brief: { voice: "raw" } }, audio: true },
];

const planFor = (c: Case) => {
  const raw = JSON.parse(fs.readFileSync(path.join("projects", c.id, "spec.json"), "utf8"));
  raw.sound = { ...(raw.sound ?? {}), ...c.sound };
  if (c.audio) {
    const beats = Array.from({ length: 40 }, (_, i) => Math.round(i * (60 / 128) * 1000) / 1000);
    raw.audio = { src: "assets/fake-music.mp3" };
    raw.sound.music = { key: "F# minor", keyConfidence: 0.82, bpm: 128, beats, onsets: beats.filter((_, i) => i % 4 === 0) };
  }
  const spec: Spec = SpecSchema.parse(preprocessSpec(raw));
  const tl = sceneTimeline(spec.scenes, spec.fps);
  const total = tl.totalFrames / spec.fps;
  return { spec, tl, total, plan: planSoundV2(spec, tl, { fps: spec.fps, total }) };
};

const layerFiles = (src: string) => (src.startsWith("bake:") ? decodeRecipe(src.slice(5)).l : []);

const checkPlan = (c: Case, spec: Spec, tl: ReturnType<typeof sceneTimeline>, total: number, plan: SoundPlan) => {
  const { cues, brief } = plan;
  // variety: per role, consecutive cues share no recorded file in the same slot
  const byRole = new Map<string, string[][]>();
  for (const q of cues) byRole.set(q.role, [...(byRole.get(q.role) ?? []), (q.layers ?? []).filter((l) => /^[A-Z]+:[a-z]/.test(l) && !/:(sub|boom|air|riser|swell|shimmer|ping|blip|tick)\b/.test(l)).map((l) => l.replace(/@.*$/, ""))]);
  for (const [role, seq] of byRole) for (let i = 1; i < seq.length; i++) {
    const rep = seq[i].filter((f) => seq[i - 1].includes(f));
    check(!rep.length, `${c.id}: ${role} repeats ${rep.join(",")} back to back`);
  }
  // layering
  for (const q of cues) {
    const n = layerFiles(q.src).length;
    if (q.importance === "hero") check(n >= 3, `${c.id}: hero ${q.reason} has only ${n} layers`);
    if (q.importance === "micro") check(n <= 1, `${c.id}: micro cue ${q.reason} has ${n} layers`);
  }
  // restraint: pre-hero window empty + stopdown
  const heroes = cues.filter((q) => q.importance === "hero");
  for (const h of heroes) {
    const win = 0.35 + 0.5 * brief.restraint;
    const intruders = cues.filter((q) => q !== h && q.priority < 2 && q.peak < h.peak - 0.02 && q.peak >= h.peak - win);
    check(!intruders.length, `${c.id}: ${intruders.length} cue(s) inside the silence before hero @${h.peak}`);
    check(plan.mix.some((m) => Math.abs(m.to - h.peak) < 0.05), `${c.id}: no stopdown before hero @${h.peak}`);
  }
  check(cues.length / total < 2.2, `${c.id}: density ${(cues.length / total).toFixed(2)} cues/s`);
  // key: tonal layers on the scale
  const scale = new Set(scalePcs(brief.key, "penta").concat(scalePcs(brief.key, "triad"), scalePcs(brief.key, "power")));
  if (brief.key.confidence >= 0.5) for (const q of cues) for (const l of layerFiles(q.src)) {
    const notes: number[] = [];
    if (l.s && "m" in l.s && l.s.k !== "air") notes.push(l.s.m);
    if (l.s && "notes" in l.s) notes.push(...l.s.notes);
    if (l.f && SFX[l.f]?.tonal && SFX[l.f].pitchHz) notes.push(Math.round(midiOf(SFX[l.f].pitchHz!) + (l.p ?? 0)));
    for (const m of notes) check(scale.has(((Math.round(m) % 12) + 12) % 12), `${c.id}: off-key note ${m} in ${q.role} (${q.reason})`);
  }
  // sync
  spec.scenes.forEach((sc, i) => {
    const tr = sc.transition;
    if (!i || !tr || ["none", "cut", "glitch"].includes(tr.type)) return;
    const slot = tl.scenes[i];
    const expect = tr.type === "match" ? slot.start : tr.type === "expand" ? slot.start + slot.overlapIn * 0.8 : slot.start + slot.overlapIn / 2;
    const q = cues.find((x) => x.reason.startsWith(`transition ${tr.type}`) && x.reason.includes(`scene ${sc.id ?? i}`));
    if (!q) { if (!quiet) console.log(`  (transition into ${sc.id ?? i} left silent: ${plan.dropped.find((d) => d.why.includes(`scene ${sc.id ?? i}`))?.why ?? "budget"})`); return; }
    const f = Math.round(q.peak * spec.fps), fe = Math.round(expect * spec.fps);
    check(f - fe >= -1 && f - fe <= 2, `${c.id}: transition ${tr.type} apex frame ${f} vs cut frame ${fe}`);
  });
  for (let a = 0; a < cues.length; a++) for (let b = a + 1; b < cues.length; b++) check(Math.abs(cues[a].peak - cues[b].peak) >= 0.08 - 1e-6, `${c.id}: apexes within 80 ms`);
};

let heroSrc: string | null = null, whooshSrc: string | null = null;
for (const c of CASES) {
  const { spec, tl, total, plan } = planFor(c);
  const again = planFor(c).plan;
  check(JSON.stringify(again.cues) === JSON.stringify(plan.cues), `${c.id}: plan is not deterministic`);
  console.log(`\n=== ${c.id} — ${c.label}  (${total.toFixed(2)}s, ${plan.cues.length} cues, ${plan.dropped.length} events left silent)`);
  console.log("brief: " + formatBrief(plan.brief));
  if (!quiet) {
    console.log(formatCueSheet(plan.cues, spec.fps));
    for (const m of plan.mix) console.log(`  mix  ${m.kind} ${m.from.toFixed(2)}→${m.to.toFixed(2)}s depth ${m.depth} (${m.reason})`);
    const why = new Map<string, number>();
    for (const d of plan.dropped) { const k = d.why.split(" — ")[0].replace(/@[\d.]+s/, "@…").replace(/\(scene .*\)/, "(scene …)"); why.set(k, (why.get(k) ?? 0) + 1); }
    console.log("  silent: " + [...why].map(([k, n]) => `${n}× ${k}`).join("; "));
  }
  checkPlan(c, spec, tl, total, plan);
  heroSrc ??= plan.cues.find((q) => q.importance === "hero")?.src ?? null;
  whooshSrc ??= plan.cues.find((q) => q.role === "trans" || q.role === "zoom")?.src ?? null;
}

// bake check: the hero's loudest moment sits at its apex, peaks stay under 0 dBFS
for (const [label, src] of [["hero", heroSrc], ["whoosh", whooshSrc]] as const) {
  if (!src) { check(false, `no ${label} cue to bake`); continue; }
  const r = decodeRecipe(src.slice(5));
  const t0 = Date.now();
  const file = bakeRecipe(src.slice(5));
  const buf = decodeWav(new Uint8Array(fs.readFileSync(file)));
  const { env, hop } = envelope(buf, 5);
  // the apex = where the cue's non-lead layers line up (max layer offset + apex) — compare against envelope max after the lead
  const lead = r.l.find((l) => l.s?.k === "swell");
  const from = lead ? Math.floor(((lead.o ?? 0) + (lead.s && "d" in lead.s ? lead.s.d : 0)) / hop) - 4 : 0;
  let mi = from, mv = 0;
  for (let i = Math.max(0, from); i < env.length; i++) if (env[i] > mv) { mv = env[i]; mi = i; }
  const tp = 20 * Math.log10(truePeak(buf));
  console.log(`\nbake ${label}: ${r.l.length} layers, ${buf.n / 48000}s, loudest at ${(mi * hop).toFixed(3)}s, true peak ${tp.toFixed(1)} dBFS, max momentary ${maxMomentary(buf).toFixed(1)} LUFS (${Date.now() - t0} ms) → ${path.relative(process.cwd(), file)}`);
  check(tp <= 0, `${label} bake clips (${tp.toFixed(1)} dBFS)`);
}

// key detector on synthesized progressions
const prog = (chords: number[][], sec = 1.2) => {
  const sr = 22050, n = Math.round(chords.length * sec * sr), x = new Float32Array(n);
  chords.forEach((ch, k) => ch.forEach((m) => {
    const b = synthesize({ k: "ping", notes: [m], gap: 0, t: "soft", d: sec, seed: m * 7 + k });
    for (let i = 0; i < Math.round(sec * sr); i++) x[Math.round(k * sec * sr) + i] += b.L[Math.min(b.n - 1, Math.round((i * 48000) / sr))] * 0.2 + 0.05 * Math.sin((2 * Math.PI * hz(ch[0] - 24) * i) / sr);
  }));
  return estimateKey(x, sr);
};
const kC = prog([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74], [60, 64, 67]]);
const kF = prog([[66, 69, 73], [71, 74, 78], [73, 76, 80], [66, 69, 73], [62, 66, 69], [71, 74, 78], [73, 77, 80], [66, 69, 73]]);
console.log(`\nkey detector: I–IV–V–I in C → ${kC.key} (conf ${kC.confidence}); i–iv–V–i in F# minor → ${kF.key} (conf ${kF.confidence})`);
check(kC.key === "C major" || kC.key === "A minor", `key detector: C progression → ${kC.key}`);
check(kF.key === "F# minor" || kF.key === "A major", `key detector: F# minor progression → ${kF.key}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
