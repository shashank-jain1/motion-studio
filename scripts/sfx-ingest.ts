/**
 * SFX ingest: turn a folder of licensed source sounds into library entries (reusable for any future licensed pack, and
 * for per-tenant BYO-license uploads — write those to a tenant folder, never into the shared library).
 *
 *   tsx scripts/sfx-ingest.ts survey <dir> [> survey.tsv]           analyze every audio file under <dir> (no output files)
 *   tsx scripts/sfx-ingest.ts ingest <curation.json> [--out <dir>]   process the curated items (see Curation below)
 *
 * Processing per item: ffmpeg decode → 48 kHz stereo float → trim silence (−50 dB re peak) → optional max length with a
 * raised-cosine tail fade → 25 Hz high-pass (DC/rumble) → loudness-normalize to a max momentary loudness of −16 LUFS
 * with a −1 dBTP ceiling (the same target as scripts/gen-sfx.ts) → 16-bit 48 kHz stereo WAV.
 * Then AUTO-ANALYSIS (src/engine/audio/dsp.ts `analyze`): duration, onset/apex (`peakAt`), attack, decay, loudness,
 * spectral centroid → brightness, flatness, low-band ratio, crude f0 (tonal sounds), weight, speed, transient sharpness,
 * stereo width. Tags come from the curation (category, materials, emotions…) and are completed from the analysis.
 *
 * Outputs: <out>/<name>.wav, <out>/manifest.json (v2 entries, merged by name) and library/LICENSES.json (one provenance
 * row per shipped file: source URL, pack, author, license + URL, verification date, sha256 of source and output,
 * processing applied).
 *
 * Heavy-ish (ffmpeg per file, sequential): run under `flock /tmp/claude-1000/ms-heavy.lock` on this machine.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LIBRARY_DIR } from "../src/core/paths";
import { SR, analyze, bufFrom, encodeWav, fadeEdges, filterBuf, normalize, trimSilence, type Analysis, type Buf } from "../src/engine/audio/dsp";
import type { SfxEntry } from "../src/engine/audio/library";

const execFileP = promisify(execFile);
export const TARGET_LUFS = -16;
export const RECORDED_DIR = path.join(LIBRARY_DIR, "sfx", "recorded");
export const LEDGER_PATH = path.join(LIBRARY_DIR, "LICENSES.json");

export type PackInfo = {
  id: string; title: string; url: string; author: string; license: string; licenseUrl: string;
  /** date the license was read on the pack page */
  verified: string;
  /** download URL of the archive / file */
  download: string;
  /** local folder (absolute, or relative to the curation's root) holding the extracted files */
  root: string;
};
export type CurationItem = {
  name: string; pack: string; file: string;
  category: string; material?: string[]; emotions?: string[]; palettes?: string[];
  /** cap the length (seconds); a raised-cosine fade ends the file */
  maxDur?: number;
  /** start offset into the source (seconds) before trimming, for multi-hit recordings */
  from?: number;
  /** high-pass cutoff (Hz), default 25 — raise it for handling rumble on close-miked foley */
  hp?: number;
  /** override analysis-derived values */
  weight?: number; speed?: number; tonal?: boolean;
  /** "hyper-real" (recorded material) or "abstract" (synthetic/game) */
  world?: "hyper-real" | "abstract";
  /** variant family for round-robin; default = name without the trailing number */
  group?: string;
  description?: string;
};
export type Curation = { root?: string; packs: PackInfo[]; items: CurationItem[] };
export type LedgerRow = {
  file: string; name: string; sha256: string; sourceUrl: string; sourceFile: string; sourceSha256: string; pack: string; packTitle: string;
  author: string; license: string; licenseUrl: string; verified: string; ingested: string; processing: string;
};

const decode = async (file: string, from = 0): Promise<Buf> => {
  const { stdout } = await execFileP("ffmpeg", ["-v", "error", ...(from ? ["-ss", String(from)] : []), "-i", file, "-vn", "-ac", "2", "-ar", String(SR), "-f", "f32le", "-acodec", "pcm_f32le", "-"], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  const b = stdout as Buffer;
  const n = Math.floor(b.byteLength / 8);
  const f = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * 8));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return bufFrom(L, R);
};

const sha256 = (data: Uint8Array | Buffer) => crypto.createHash("sha256").update(data).digest("hex");

/** Noise floor: the 10th-percentile 20 ms RMS relative to the max, dB (hiss check for the survey). */
const floorDb = (buf: Buf) => {
  const w = Math.round(0.02 * SR);
  const v: number[] = [];
  for (let s = 0; s + w <= buf.n; s += w) { let a = 0; for (let i = s; i < s + w; i++) a += buf.L[i] * buf.L[i]; v.push(Math.sqrt(a / w)); }
  if (v.length < 3) return -99;
  const max = Math.max(...v);
  const sorted = [...v].sort((a, b) => a - b);
  return Math.round(20 * Math.log10(Math.max(1e-9, sorted[Math.floor(sorted.length * 0.1)]) / max));
};

const AUDIO = /\.(wav|ogg|mp3|flac|aif|aiff|m4a)$/i;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (d.isDirectory()) return d.name === "__MACOSX" ? [] : walk(p);
  return AUDIO.test(d.name) && !d.name.startsWith("._") ? [p] : [];
});

export const survey = async (dir: string, log = (s: string) => console.log(s)) => {
  log(["file", "dur", "peakAt", "kind", "attackMs", "decay", "lufs", "centroid", "flat", "low", "tonal", "f0", "weight", "speed", "sharp", "width", "floorDb"].join("\t"));
  for (const f of walk(dir).sort()) {
    try {
      const raw = await decode(f);
      const t = trimSilence(raw);
      const a = analyze(t);
      log([path.relative(dir, f), a.duration, a.peakAt, a.kind, a.attackMs, a.decay, a.loudness, a.centroid, a.flatness, a.lowRatio, a.tonal ? 1 : 0, a.pitchHz ?? "", a.weight, a.speed, a.sharpness, a.width, floorDb(t)].join("\t"));
    } catch (e) {
      log(`${path.relative(dir, f)}\tERROR ${(e as Error).message.split("\n")[0]}`);
    }
  }
};

/** Process one curated item into a normalized buffer + analysis. */
export const processItem = async (srcFile: string, it: CurationItem) => {
  let buf = trimSilence(await decode(srcFile, it.from ?? 0));
  const steps = ["decode→48k stereo", "trim silence (−50 dB)"];
  if (it.maxDur && buf.n / SR > it.maxDur) {
    const n = Math.round(it.maxDur * SR);
    buf = { L: buf.L.slice(0, n), R: buf.R.slice(0, n), n };
    fadeEdges(buf, 0.5, Math.min(250, it.maxDur * 1000 * 0.35));
    steps.push(`cut to ${it.maxDur}s + fade`);
  } else fadeEdges(buf, 0.5, Math.min(40, (buf.n / SR) * 1000 * 0.2));
  const hp = it.hp ?? 25;
  filterBuf(buf, "hp", hp);
  if (hp > 40) filterBuf(buf, "hp", hp); // 24 dB/oct for real rumble
  steps.push(`HP ${hp} Hz`, "edge fades");
  const gain = normalize(buf, TARGET_LUFS, -1);
  steps.push(`normalize ${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB → −16 LUFS max-momentary / −1 dBTP`, "16-bit WAV");
  return { buf, analysis: analyze(buf), processing: steps.join("; ") };
};

const groupOf = (name: string) => name.replace(/-?\d+$/, "");

/** Turn analysis + curation tags into a manifest v2 entry. */
export const toEntry = (it: CurationItem, a: Analysis, file: string, license: string): SfxEntry => ({
  name: it.name, file, source: "recorded", category: it.category,
  material: it.material ?? [], weight: it.weight ?? a.weight, speed: it.speed ?? a.speed, brightness: a.brightness,
  tonal: it.tonal ?? a.tonal, ...(a.pitchHz && (it.tonal ?? a.tonal) ? { pitchHz: a.pitchHz } : {}),
  peakAt: a.peakAt, durationSec: a.duration, loudness: a.loudness, sharpness: a.sharpness, flatness: a.flatness,
  world: it.world ?? "hyper-real", palettes: it.palettes ?? [], emotions: it.emotions ?? [], group: it.group ?? groupOf(it.name),
  license, description: it.description ?? `${it.category} (${(it.material ?? []).join("/") || "generic"})`,
});

/**
 * Pick the round-robin set of a variant family: drop near-duplicates (same length / brightness / weight — packs often
 * ship the same take twice), then keep the `cap` takes closest to the family's median (consistent variants; outlier
 * takes — clipped, noisy, wrong mic — fall out).
 */
const selectVariants = <T extends { a: Analysis }>(xs: T[], cap: number): T[] => {
  const uniq: T[] = [];
  for (const x of xs) if (!uniq.some((u) => Math.abs(u.a.duration - x.a.duration) < 0.012 && Math.abs(u.a.brightness - x.a.brightness) < 0.015 && Math.abs(u.a.weight - x.a.weight) < 0.015)) uniq.push(x);
  if (uniq.length <= cap) return uniq;
  const feats = (a: Analysis) => [a.brightness, a.weight, a.speed, Math.log(a.duration + 0.05) / 3, a.flatness];
  const med = feats(uniq[0].a).map((_, k) => { const v = uniq.map((u) => feats(u.a)[k]).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; });
  const dist = (a: Analysis) => feats(a).reduce((s, v, k) => s + (v - med[k]) ** 2, 0);
  const keep = new Set([...uniq].sort((p, q) => dist(p.a) - dist(q.a)).slice(0, cap));
  return uniq.filter((u) => keep.has(u)); // original order
};

export const ingest = async (cur: Curation, opts: { outDir?: string; log?: (s: string) => void; baseDir?: string; maxPerGroup?: number; groupCaps?: Record<string, number>; prune?: boolean } = {}) => {
  const out = opts.outDir ?? RECORDED_DIR;
  const log = opts.log ?? ((s: string) => console.error(s));
  fs.mkdirSync(out, { recursive: true });
  const manPath = path.join(out, "manifest.json");
  const man: { version: number; sounds: SfxEntry[] } = fs.existsSync(manPath) && !opts.prune ? JSON.parse(fs.readFileSync(manPath, "utf8")) : { version: 2, sounds: [] };
  const ledger: { version: number; note: string; files: LedgerRow[] } = fs.existsSync(LEDGER_PATH)
    ? JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"))
    : { version: 1, note: "Provenance of every third-party audio file shipped in library/. Only CC0 (public domain) sources. Synthesized files (library/sfx/*.wav, generated by scripts/gen-sfx.ts) are original work and not listed.", files: [] };
  const packs = new Map(cur.packs.map((p) => [p.id, p]));
  const today = new Date().toISOString().slice(0, 10);
  const relOut = path.relative(LIBRARY_DIR, out).split(path.sep).join("/");
  if (opts.prune) ledger.files = ledger.files.filter((r) => !r.file.startsWith(relOut + "/"));
  // group items by variant family (in list order)
  const groups = new Map<string, CurationItem[]>();
  for (const it of cur.items) { const g = it.group ?? groupOf(it.name); groups.set(g, [...(groups.get(g) ?? []), it]); }
  let n = 0, seen = 0;
  const written = new Set<string>();
  for (const [g, its] of groups) {
    const done: { it: CurationItem; buf: Buf; a: Analysis; processing: string; src: string; p: PackInfo }[] = [];
    for (const it of its) {
      const p = packs.get(it.pack);
      if (!p) throw new Error(`${it.name}: unknown pack ${it.pack}`);
      if (!/^CC0/i.test(p.license)) throw new Error(`${it.name}: pack ${p.id} is not CC0 (${p.license}) — refusing to ship it`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.name)) throw new Error(`bad name ${it.name}`);
      const root = path.isAbsolute(p.root) ? p.root : path.join(opts.baseDir ?? cur.root ?? ".", p.root);
      const src = path.join(root, it.file);
      seen++;
      if (!fs.existsSync(src)) { log(`[ingest] MISSING ${src}`); continue; }
      const { buf, analysis, processing } = await processItem(src, it);
      done.push({ it, buf, a: analysis, processing, src, p });
    }
    const cap = opts.groupCaps?.[g] ?? opts.maxPerGroup ?? Infinity;
    const keep = selectVariants(done, cap);
    // renumber the kept variants 1..k so names stay dense
    keep.forEach((k, i) => {
      const name = keep.length === its.length || !/-\d+$/.test(k.it.name) ? k.it.name : `${g}-${i + 1}`;
      const it = { ...k.it, name };
      const wav = encodeWav(k.buf, n + 7);
      const fileRel = `${relOut}/${name}.wav`;
      fs.writeFileSync(path.join(out, `${name}.wav`), wav);
      written.add(`${name}.wav`);
      man.sounds = [...man.sounds.filter((s) => s.name !== name), toEntry(it, k.a, fileRel.replace(/^sfx\//, ""), "CC0-1.0")];
      ledger.files = [...ledger.files.filter((r) => r.file !== fileRel), {
        file: fileRel, name, sha256: sha256(wav), sourceUrl: k.p.url, sourceFile: `${decodeURIComponent(path.basename(k.p.download))}:${k.it.file}`, sourceSha256: sha256(fs.readFileSync(k.src)),
        pack: k.p.id, packTitle: k.p.title, author: k.p.author, license: k.p.license, licenseUrl: k.p.licenseUrl, verified: k.p.verified, ingested: today, processing: k.processing,
      }];
      n++;
    });
    if (keep.length < done.length) log(`[ingest] ${g}: kept ${keep.length}/${done.length}`);
  }
  if (opts.prune) for (const f of fs.readdirSync(out)) if (f.endsWith(".wav") && !written.has(f)) fs.rmSync(path.join(out, f));
  man.version = 2;
  man.sounds.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  ledger.files.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1) + "\n");
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 1) + "\n");
  log(`[ingest] ${n} sound(s) from ${seen} candidate(s) → ${out}; ledger ${LEDGER_PATH}`);
  return { count: n, manifest: man };
};

const isMain = (() => { try { return path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  const outFlag = process.argv.indexOf("--out");
  if (cmd === "survey" && arg) await survey(path.resolve(arg));
  else if (cmd === "ingest" && arg) {
    const cur = JSON.parse(fs.readFileSync(arg, "utf8")) as Curation;
    await ingest(cur, { outDir: outFlag > 0 ? path.resolve(process.argv[outFlag + 1]) : undefined, baseDir: path.dirname(path.resolve(arg)) });
  } else {
    console.error("usage: sfx-ingest.ts survey <dir> | ingest <curation.json> [--out <dir>]");
    process.exitCode = 2;
  }
}
