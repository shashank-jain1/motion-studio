/**
 * Voiceover: script → narration WAV (48 kHz stereo, −16 LUFS peak-momentary) + word timings for captions and ducking.
 *
 * Providers, freest first:
 *   - "system"  the OS voice (macOS `say`, Linux `espeak-ng`): free, offline, always available, plainer delivery.
 *   - "kokoro"  Kokoro-82M (Apache-2.0) via the optional `kokoro-js` package: free, offline, natural English voices.
 *               Not bundled (it pulls ONNX Runtime); `pnpm add kokoro-js` enables it.
 *   - "gemini"  Gemini 3.8 Flash TTS: free tier with rate limits, the most expressive (30 voices, style direction,
 *               <laugh>/<short pause> tags, 100+ languages). Needs a Gemini API key.
 *   "auto" = gemini when a key is set, else kokoro when installed, else system.
 *
 * Word timings: local Whisper when it is already set up → Gemini transcription (free tier) → an estimate from the
 * audio's voiced regions. Caption text always comes from the SCRIPT (exact spelling), timed by the transcript.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decodeWav, encodeWav, envelope, normalize, softLimit, type Buf, SR } from "../engine/audio/dsp";
import { GEMINI_VOICES, DEFAULT_TTS_MODEL, geminiSpeech, geminiTranscribe, hasGeminiKey } from "./gemini";
import { norm as normWord, type Word } from "./editPlan";

const execFileP = promisify(execFile);

export type VoiceProvider = "gemini" | "kokoro" | "system";
export type VoiceRequest = {
  text: string;
  provider?: VoiceProvider | "auto";
  voice?: string;
  /** delivery direction for Gemini ("warm, unhurried, smiling"); ignored by local voices */
  style?: string;
  model?: string;
  /** speaking rate multiplier (local voices) */
  speed?: number;
  /** two-voice dialogue (Gemini): lines with speaker names, `speakers` maps names → voices */
  dialogue?: { speaker: string; text: string; style?: string }[];
  speakers?: Record<string, string>;
};
export type VoiceResult = { provider: VoiceProvider; voice: string; seconds: number; file: string };

/** Inline delivery tags (<short pause>, <laugh>…) shape Gemini's performance but are never spoken or captioned. */
export const spokenText = (s: string) => s.replace(/<[^>]{1,40}>/g, " ").replace(/\s+/g, " ").trim();

let kokoroMod: Promise<unknown> | null = null;
const loadKokoro = async () => {
  const name = "kokoro-js"; // kept in a variable: the package is optional and not bundled
  kokoroMod ??= import(name).catch(() => null);
  const m = (await kokoroMod) as { KokoroTTS?: { from_pretrained: (id: string, o: Record<string, unknown>) => Promise<{ generate: (t: string, o: Record<string, unknown>) => Promise<{ toWav: () => ArrayBuffer }>; list_voices?: () => unknown }> } } | null;
  return m?.KokoroTTS ?? null;
};
export const kokoroAvailable = async () => !!(await loadKokoro());

const KOKORO_VOICES: Record<string, string> = {
  af_heart: "US female, warm (default)", af_bella: "US female, bright", af_nicole: "US female, soft", af_sarah: "US female, clear",
  am_michael: "US male, warm", am_fenrir: "US male, deep", am_puck: "US male, upbeat", bf_emma: "UK female", bm_george: "UK male, mature", bm_fable: "UK male, storyteller",
};

export const systemVoices = async (): Promise<{ name: string; lang: string }[]> => {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileP("say", ["-v", "?"]);
      return stdout.split("\n").map((l) => /^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})/.exec(l)).filter(Boolean).map((m) => ({ name: m![1].trim(), lang: m![2] }));
    }
    const { stdout } = await execFileP("espeak-ng", ["--voices"]);
    return stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length > 3).map((p) => ({ name: p[3], lang: p[1] }));
  } catch { return []; }
};

export const listVoices = async () => ({
  gemini: { available: hasGeminiKey(), model: DEFAULT_TTS_MODEL, note: "free tier with rate limits; style direction + <laugh>/<short pause> tags; 100+ languages", voices: GEMINI_VOICES },
  kokoro: { available: await kokoroAvailable(), note: "free + offline after a one-time model download; enable with `pnpm add kokoro-js`", voices: KOKORO_VOICES },
  system: { available: true, note: process.platform === "darwin" ? "macOS voices (Siri voices excluded); free + offline" : "espeak-ng if installed; free + offline", voices: (await systemVoices()).slice(0, 80) },
});

const pickProvider = async (p: VoiceRequest["provider"]): Promise<VoiceProvider> => {
  if (p && p !== "auto") return p;
  if (hasGeminiKey()) return "gemini";
  if (await kokoroAvailable()) return "kokoro";
  return "system";
};

const synthSystem = async (text: string, voice: string | undefined, speed: number | undefined, tmp: string): Promise<{ wav: Buffer; voice: string }> => {
  const out = path.join(tmp, "say.wav"), txt = path.join(tmp, "say.txt");
  fs.writeFileSync(txt, text);
  if (process.platform === "darwin") {
    const v = voice ?? "Samantha";
    const args = ["-v", v, "-f", txt, "-o", out, "--file-format=WAVE", "--data-format=LEI16@48000"];
    if (speed) args.push("-r", String(Math.round(175 * speed)));
    await execFileP("say", args).catch((e) => { throw new Error(`System voice "${v}" failed: ${(e as Error).message.split("\n")[0]}. list_voices shows the installed voices.`); });
    return { wav: fs.readFileSync(out), voice: v };
  }
  const v = voice ?? "en-us";
  await execFileP("espeak-ng", ["-v", v, "-s", String(Math.round(160 * (speed ?? 1))), "-f", txt, "-w", out]).catch((e) => {
    throw new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? "No system voice: install espeak-ng (apt install espeak-ng), add a Gemini key, or `pnpm add kokoro-js`." : (e as Error).message);
  });
  return { wav: fs.readFileSync(out), voice: v };
};

const synthKokoro = async (text: string, voice: string | undefined, speed: number | undefined) => {
  const K = await loadKokoro();
  if (!K) throw new Error("Kokoro is not installed. Run `pnpm add kokoro-js` (first use downloads the ~90 MB model), or use provider \"gemini\" / \"system\".");
  const tts = await K.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
  const v = voice ?? "af_heart";
  const audio = await tts.generate(text, { voice: v, speed: speed ?? 1 });
  return { wav: Buffer.from(audio.toWav()), voice: v };
};

/** Synthesize narration to `outFile` (WAV). Loudness-normalized so every provider sits at the same level in the mix. */
export const synthesizeVoice = async (req: VoiceRequest, outFile: string, signal?: AbortSignal): Promise<VoiceResult> => {
  const provider = await pickProvider(req.provider);
  if (!req.dialogue?.length && !spokenText(req.text)) throw new Error("The script is empty");
  if (req.dialogue?.length && provider !== "gemini") throw new Error("Two-voice dialogue needs provider \"gemini\"; for local voices generate one clip per speaker.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-voice-"));
  try {
    let wav: Buffer, voice: string;
    if (provider === "gemini") {
      wav = await geminiSpeech({ text: req.text, voice: req.voice, style: req.style, model: req.model, dialogue: req.dialogue, speakers: req.speakers }, signal);
      voice = req.dialogue?.length ? Object.values(req.speakers ?? {}).join("+") : req.voice ?? "Kore";
    } else if (provider === "kokoro") ({ wav, voice } = await synthKokoro(spokenText(req.text), req.voice, req.speed));
    else ({ wav, voice } = await synthSystem(spokenText(req.text), req.voice, req.speed, tmp));
    const buf = decodeWav(wav);
    trimEdges(buf);
    normalize(buf, -16, -1.5);
    softLimit(buf, 0.9);
    fs.writeFileSync(outFile, encodeWav(buf, 7));
    return { provider, voice, seconds: Math.round((buf.n / SR) * 1000) / 1000, file: outFile };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

/** Cut leading/trailing silence down to 60 ms so a clip's `at` is where the voice starts. */
const trimEdges = (buf: Buf) => {
  const { env, hop } = envelope(buf, 10);
  const peak = Math.max(1e-6, ...env);
  const thr = peak * 0.02;
  const first = env.findIndex((v) => v > thr), last = env.length - 1 - [...env].reverse().findIndex((v) => v > thr);
  if (first < 0) return;
  const a = Math.max(0, Math.round((first * hop - 0.06) * SR)), b = Math.min(buf.n, Math.round(((last + 1) * hop + 0.12) * SR));
  buf.L = buf.L.slice(a, b); buf.R = buf.R.slice(a, b); buf.n = b - a;
};

export const voiceFileName = (req: VoiceRequest, provider: string) =>
  `vo-${crypto.createHash("sha1").update(JSON.stringify([provider, req.voice, req.style, req.model, req.speed, req.text, req.dialogue, req.speakers])).digest("hex").slice(0, 10)}.wav`;

// ---------------------------------------------------------------- word timing

/**
 * Estimate word timings from the audio alone: voiced stretches (envelope above a floor) are filled with the script's
 * words in order, each taking time in proportion to its syllables, and sentence ends are pulled onto pauses.
 */
export const estimateWords = (text: string, buf: Buf): Word[] => {
  const tokens = spokenText(text).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const { env, hop } = envelope(buf, 10);
  const peak = Math.max(1e-6, ...env);
  const on = env.map((v) => v > peak * 0.06);
  // voiced runs, bridging gaps < 120 ms (stop consonants)
  const runs: { start: number; end: number }[] = [];
  let s = -1, gap = 0;
  on.forEach((v, i) => {
    if (v) { if (s < 0) s = i; gap = 0; }
    else if (s >= 0 && ++gap * hop > 0.12) { runs.push({ start: s * hop, end: (i - gap + 1) * hop }); s = -1; gap = 0; }
  });
  if (s >= 0) runs.push({ start: s * hop, end: env.length * hop });
  if (!runs.length) runs.push({ start: 0, end: buf.n / SR });
  const syl = (w: string) => Math.max(1, (normWord(w).match(/[aeiouy]+/g) ?? []).length) + (/[.,!?;:…]$/.test(w) ? 0.4 : 0);
  const weights = tokens.map(syl);
  const voiced = runs.reduce((a, r) => a + r.end - r.start, 0);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Word[] = [];
  let ri = 0, cursor = runs[0].start;
  tokens.forEach((t, i) => {
    let d = (weights[i] / total) * voiced;
    // a sentence end that nearly finishes a run snaps to it, so the next sentence starts after the pause
    if (cursor + d > runs[ri].end - 0.05 || (/[.!?…]$/.test(t) && runs[ri].end - (cursor + d) < 0.25 && ri < runs.length - 1)) {
      const start = cursor, end = Math.max(start + 0.08, Math.min(runs[ri].end, start + d));
      out.push({ text: t, start: r3(start), end: r3(end) });
      if (ri < runs.length - 1) { ri++; cursor = runs[ri].start; } else cursor = end;
      return;
    }
    out.push({ text: t, start: r3(cursor), end: r3(cursor + d) });
    cursor += d;
  });
  return out;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Put the SCRIPT's words onto a transcript's timings (edit-distance alignment on normalized tokens): exact spelling
 * from the script, timing from what was actually said. Unmatched script words are interpolated between neighbours.
 */
export const alignScript = (script: string, heard: Word[]): Word[] => {
  const S = spokenText(script).split(/\s+/).filter(Boolean);
  if (!heard.length) return [];
  const a = S.map(normWord), b = heard.map((w) => normWord(w.text));
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const match = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { match[i - 1] = j - 1; i--; j--; }
    else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  // Only EXACT matches anchor timing. A substitution (e.g. the script's "devfest dot bhopal dot dev" heard as one token
  // "devfest.bhopal.dev") must not pin a word to the wrong place: unmatched runs are spread, by word length, over the time
  // between the surrounding anchors — so order is always preserved.
  const exact = S.map((_, i) => match[i] >= 0 && a[i] === b[match[i]]);
  const out: Word[] = S.map((t, i) => (exact[i] ? { text: t, start: heard[match[i]].start, end: heard[match[i]].end } : { text: t, start: NaN, end: NaN }));
  for (let i = 0; i < n; i++) {
    if (exact[i]) continue;
    let k = i; while (k < n && !exact[k]) k++;
    const from = i > 0 ? out[i - 1].end : heard[0].start;
    const to = Math.max(from + 0.05 * (k - i), k < n ? out[k].start : heard[m - 1].end);
    const weights = S.slice(i, k).map((w) => Math.max(1, normWord(w).length));
    const total = weights.reduce((x, y) => x + y, 0);
    let t = from;
    for (let q = i; q < k; q++) {
      const d = ((to - from) * weights[q - i]) / total;
      out[q] = { text: out[q].text, start: r3(t), end: r3(t + d) };
      t += d;
    }
  }
  return out;
};

export type TimingMethod = "whisper" | "gemini" | "estimate";

/** Word timings for a narration file: whisper (if ready) → gemini (if key) → estimate. Never throws. */
export const timeWords = async (file: string, script: string, o: { prefer?: TimingMethod | "auto"; whisperReady?: () => boolean; whisper?: (f: string) => Promise<Word[]>; signal?: AbortSignal } = {}): Promise<{ words: Word[]; method: TimingMethod; note?: string }> => {
  const buf = decodeWav(fs.readFileSync(file));
  const tries: TimingMethod[] = o.prefer && o.prefer !== "auto" ? [o.prefer, "estimate"] : ["whisper", "gemini", "estimate"];
  const notes: string[] = [];
  for (const m of tries) {
    try {
      if (m === "whisper") {
        if (!o.whisper || (o.prefer !== "whisper" && !o.whisperReady?.())) continue;
        const heard = await o.whisper(file);
        if (heard.length) return { words: alignScript(script, heard), method: m };
      } else if (m === "gemini") {
        if (!hasGeminiKey()) continue;
        const { words } = await geminiTranscribe(fs.readFileSync(file), "audio/wav", { signal: o.signal });
        if (words.length) return { words: alignScript(script, words), method: m };
      } else return { words: estimateWords(script, buf), method: m, note: notes.join(" ") || undefined };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      notes.push(`${m} timing failed (${(e as Error).message.slice(0, 120)}); `);
    }
  }
  return { words: estimateWords(script, buf), method: "estimate", note: notes.join(" ") || undefined };
};
