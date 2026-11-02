/**
 * Gemini API client (Interactions API, https://ai.google.dev/gemini-api/docs) for the audio features:
 *   - speech:   gemini-3.8-flash-tts / gemini-3.8-flash-lite-tts (free tier available) → 24 kHz mono WAV
 *   - transcribe: gemini-3.5-transcribe (free tier available) → words with start/end offsets
 *   - music:    lyria-3-clip-preview (30 s) / lyria-3.5 (full song) — paid only, never used unless asked for
 *
 * The key comes from GEMINI_API_KEY / GOOGLE_API_KEY, else `geminiApiKey` in the local config file written by the
 * studio's settings (~/.config/motion-studio/config.json). It is only ever sent to generativelanguage.googleapis.com.
 * Free-tier requests may be used by Google to improve its products — the settings screen says so.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "https://generativelanguage.googleapis.com";
const CONFIG_FILE = path.join(process.env.MOTION_STUDIO_CONFIG_DIR || path.join(os.homedir(), ".config", "motion-studio"), "config.json");

export const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview"] as const;
export const DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts";
export const TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

/** The 30 prebuilt voices and their documented character. */
export const GEMINI_VOICES: Record<string, string> = {
  Zephyr: "bright", Puck: "upbeat", Charon: "informative", Kore: "firm", Fenrir: "excitable", Leda: "youthful", Orus: "firm",
  Aoede: "breezy", Callirrhoe: "easy-going", Autonoe: "bright", Enceladus: "breathy", Iapetus: "clear", Umbriel: "easy-going",
  Algieba: "smooth", Despina: "smooth", Erinome: "clear", Algenib: "gravelly", Rasalgethi: "informative", Laomedeia: "upbeat",
  Achernar: "soft", Alnilam: "firm", Schedar: "even", Gacrux: "mature", Pulcherrima: "forward", Achird: "friendly",
  Zubenelgenubi: "casual", Sadachbia: "lively", Sadaltager: "knowledgeable", Sulafat: "warm", Vindemiatrix: "gentle",
};

export const geminiKey = (): string | null => {
  const env = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (env) return env;
  try {
    const k = (JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as { geminiApiKey?: string }).geminiApiKey;
    return typeof k === "string" && k.trim() ? k.trim() : null;
  } catch { return null; }
};
export const hasGeminiKey = () => !!geminiKey();

const needKey = () => {
  const k = geminiKey();
  if (!k) throw new Error("No Gemini API key. Get a free one at https://aistudio.google.com/apikey and add it in Settings (or set GEMINI_API_KEY). Local alternatives: provider \"system\" (voice) or \"whisper\" (transcription).");
  return k;
};

/** Injected in tests. */
export let fetchImpl: typeof fetch = (...a) => fetch(...a);
export const setFetch = (f: typeof fetch) => { fetchImpl = f; };

const explain = async (res: Response, what: string) => {
  let detail = "";
  try { const j = (await res.json()) as { error?: { message?: string; status?: string } }; detail = j.error?.message ?? ""; } catch { /* not json */ }
  if (res.status === 429) return new Error(`Gemini ${what}: the free-tier limit was reached (HTTP 429). Wait a minute and retry, or use a local provider.${detail ? ` (${detail.slice(0, 200)})` : ""}`);
  if (res.status === 401 || res.status === 403) return new Error(`Gemini ${what}: the API key was rejected (HTTP ${res.status}). Check it in Settings.${detail ? ` (${detail.slice(0, 200)})` : ""}`);
  return new Error(`Gemini ${what} failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
};

type Interaction = { status?: string; steps?: { type?: string; content?: { type?: string; text?: string; data?: string; mime_type?: string; annotations?: Record<string, unknown>[] }[] }[]; output_text?: string };

export const interact = async (body: Record<string, unknown>, what: string, signal?: AbortSignal): Promise<Interaction> => {
  const res = await fetchImpl(`${API}/v1beta/interactions`, {
    method: "POST", signal,
    headers: { "x-goog-api-key": needKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await explain(res, what);
  return (await res.json()) as Interaction;
};

const outputs = (i: Interaction) => (i.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []);

// ---------------------------------------------------------------- speech

export type GeminiSpeech = {
  text: string; voice?: string; style?: string; model?: string;
  /** two-speaker dialogue: each line names a speaker mapped to a voice */
  dialogue?: { speaker: string; text: string; style?: string }[]; speakers?: Record<string, string>;
};

/** Text → WAV bytes (24 kHz mono 16-bit). Inline tags like <short pause>, <laugh>, <sigh> are honoured by the model. */
export const geminiSpeech = async (o: GeminiSpeech, signal?: AbortSignal): Promise<Buffer> => {
  const model = o.model ?? DEFAULT_TTS_MODEL;
  const item = (text: string, style?: string, speaker?: string) => ({
    type: "text", text, ...(style || speaker ? { annotations: [{ type: "speech_metadata", ...(speaker ? { speaker } : {}), ...(style ? { style } : {}) }] } : {}),
  });
  const multi = !!o.dialogue?.length;
  if (multi && Object.keys(o.speakers ?? {}).length > 2) throw new Error("Gemini speech supports at most 2 speakers per request");
  const voice = o.voice ?? "Kore";
  if (!multi && !GEMINI_VOICES[voice]) throw new Error(`Unknown Gemini voice "${voice}". Voices: ${Object.keys(GEMINI_VOICES).join(", ")}`);
  const body = {
    model,
    input: [{ type: "user_input", content: multi ? o.dialogue!.map((d) => item(d.text, d.style, d.speaker)) : [item(o.text, o.style)] }],
    response_format: { type: "audio" },
    generation_config: {
      speech_config: multi ? { speakers: Object.entries(o.speakers ?? {}).map(([speaker, v]) => ({ speaker, voice: v })) } : [{ voice }],
    },
  };
  const out = await interact(body, "speech", signal);
  const audio = outputs(out).filter((c) => c.type === "audio" && c.data).pop();
  if (!audio?.data) throw new Error("Gemini speech returned no audio (the text may have been blocked or empty).");
  const bytes = Buffer.from(audio.data, "base64");
  // unary responses are WAV; raw L16 is wrapped so callers always get a playable file
  return bytes.subarray(0, 4).toString("latin1") === "RIFF" ? bytes : pcm16Wav(bytes, 24000, 1);
};

export const pcm16Wav = (pcm: Buffer, sampleRate: number, channels: number) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

// ---------------------------------------------------------------- files + transcription

const INLINE_LIMIT = 14 * 1024 * 1024; // base64 grows ×4/3; requests stay under the 20 MB inline cap

/** Files API resumable upload → file URI (waits until the file is ACTIVE). */
export const uploadFile = async (bytes: Buffer, mime: string, name: string, signal?: AbortSignal): Promise<string> => {
  const key = needKey();
  const start = await fetchImpl(`${API}/upload/v1beta/files`, {
    method: "POST", signal,
    headers: {
      "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  if (!start.ok) throw await explain(start, "upload");
  const url = start.headers.get("x-goog-upload-url");
  if (!url) throw new Error("Gemini upload: no upload URL returned");
  const up = await fetchImpl(url, {
    method: "POST", signal,
    headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: new Uint8Array(bytes),
  });
  if (!up.ok) throw await explain(up, "upload");
  let file = ((await up.json()) as { file?: { uri?: string; name?: string; state?: string } }).file;
  for (let i = 0; file?.state === "PROCESSING" && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const g = await fetchImpl(`${API}/v1beta/${file.name}`, { headers: { "x-goog-api-key": key }, signal });
    if (!g.ok) throw await explain(g, "upload status");
    file = (await g.json()) as typeof file;
  }
  if (!file?.uri) throw new Error("Gemini upload: no file URI returned");
  if (file.state === "FAILED") throw new Error("Gemini could not process the uploaded audio");
  return file.uri;
};

const seconds = (v: unknown) => {
  if (typeof v === "number") return v;
  const m = /^(-?[\d.]+)s?$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : NaN;
};

export type GeminiWord = { text: string; start: number; end: number; speaker?: string };

/**
 * Word-timed transcript of WAV/MP3/M4A bytes with gemini-3.5-transcribe (verbatim mode, word timestamps; up to 30 min).
 * `languages` (BCP-47, e.g. ["hi-IN"]) helps for short clips; empty = auto-detect.
 */
export const geminiTranscribe = async (bytes: Buffer, mime: string, o: { languages?: string[]; signal?: AbortSignal } = {}): Promise<{ text: string; words: GeminiWord[] }> => {
  const audio = bytes.length <= INLINE_LIMIT
    ? { type: "audio", data: bytes.toString("base64"), mime_type: mime }
    : { type: "audio", uri: await uploadFile(bytes, mime, "motion-studio-audio", o.signal), mime_type: mime };
  const out = await interact({
    model: TRANSCRIBE_MODEL,
    input: [audio],
    generation_config: { transcription_config: { ...(o.languages?.length ? { language_codes: o.languages } : {}), mode: { type: "verbatim", timestamp_granularities: ["word"] } } },
  }, "transcription", o.signal);
  const content = outputs(out).filter((c) => c.type === "text");
  const words: GeminiWord[] = content.flatMap((c) => (c.annotations ?? []).filter((a) => a.type === "word_info").map((a) => ({
    text: String(a.text ?? "").trim(), start: seconds(a.start_offset), end: seconds(a.end_offset), ...(a.speaker ? { speaker: String(a.speaker) } : {}),
  }))).filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  return { text: content.map((c) => c.text ?? "").join(" ").trim() || out.output_text || "", words };
};

// ---------------------------------------------------------------- music (paid)

/** Lyria: prompt → MP3 bytes. Paid on the Gemini API (no free tier); callers must have the user's go-ahead. */
export const lyriaMusic = async (prompt: string, o: { full?: boolean; signal?: AbortSignal } = {}): Promise<Buffer> => {
  const out = await interact({ model: o.full ? "lyria-3.5" : "lyria-3-clip-preview", input: prompt }, "music", o.signal);
  const audio = outputs(out).filter((c) => c.type === "audio" && c.data).pop();
  if (!audio?.data) throw new Error("Lyria returned no audio (the prompt may have been blocked — avoid artist names and lyrics of existing songs).");
  return Buffer.from(audio.data, "base64");
};
