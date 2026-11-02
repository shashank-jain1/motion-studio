/**
 * Real-footage editing: transcription (whisper.cpp via @remotion/install-whisper-cpp, local, no API key), silence
 * detection, reference-style measurement, reusable edit styles, and compiling an edit plan into a Scene Spec.
 *
 * The compiled spec is ordinary Motion Studio material: one scene per kept stretch, each with the footage trimmed to
 * its source range and word-timed captions. Every visual tool (Edit tab, timeline trim, director, History) then works on
 * it, and motion graphics can be layered on top of any cut.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { downloadWhisperModel, installWhisperCpp, toCaptions, transcribe, type WhisperModel } from "@remotion/install-whisper-cpp";
import type { Language } from "@remotion/install-whisper-cpp/dist/languages";
import { CACHE_DIR, LIBRARY_DIR } from "./paths";
import { runMediaTool } from "./mediaTool";
import { describePlan, planEdit, type EditOptions, type EditPlan, type Span, type Word } from "./editPlan";
import { FORMATS } from "../engine/spec/schema";

export const WHISPER_VERSION = "1.7.5";
export const DEFAULT_WHISPER_MODEL: WhisperModel = (process.env.MOTION_STUDIO_WHISPER_MODEL as WhisperModel) || "base";
const WHISPER_DIR = path.resolve(process.env.MOTION_STUDIO_WHISPER_DIR || path.join(CACHE_DIR, "whisper"));
const MODELS = ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large-v3-turbo"] as const;

export type Transcript = {
  model: string; language: string; seconds: number; words: Word[];
  /** identity of the transcribed file (size + mtime) so edits to the asset invalidate the cache */
  source: { file: string; bytes: number; mtimeMs: number };
};

type Progress = (p: { progress: number; message?: string }) => void;

// ---------------------------------------------------------------- whisper

let installing: Promise<string> | null = null;
/** Build whisper.cpp once (git + make/cmake; ~1 min) and return the executable folder. */
const ensureWhisper = async (onProgress?: Progress, signal?: AbortSignal): Promise<string> => {
  const dir = path.join(WHISPER_DIR, `whisper.cpp-${WHISPER_VERSION}`);
  installing ??= (async () => {
    fs.mkdirSync(WHISPER_DIR, { recursive: true });
    onProgress?.({ progress: 0, message: "Setting up the local transcriber (first run only, ~1 min)" });
    try {
      await installWhisperCpp({ version: WHISPER_VERSION, to: dir, printOutput: false, signal });
    } catch (e) {
      installing = null;
      throw new Error(`Could not build whisper.cpp ${WHISPER_VERSION} (needs git, make and a C++ compiler; on macOS: xcode-select --install, brew install cmake): ${(e as Error).message}`);
    }
    return dir;
  })();
  return installing;
};

const ensureModel = async (model: WhisperModel, onProgress?: Progress, signal?: AbortSignal) => {
  const folder = path.join(WHISPER_DIR, "models");
  fs.mkdirSync(folder, { recursive: true });
  await downloadWhisperModel({
    model, folder, printOutput: false, signal,
    onProgress: (downloaded, total) => onProgress?.({ progress: total ? Math.min(0.99, downloaded / total) * 0.3 : 0, message: `Downloading speech model “${model}”` }),
  });
  return folder;
};

/** 16 kHz mono PCM WAV, as whisper.cpp requires. */
const toWav16k = async (input: string, out: string) => {
  await runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);
};

const transcriptPath = (file: string) => `${file}.transcript.json`;

export const readTranscript = (file: string): Transcript | null => {
  const p = transcriptPath(file);
  if (!fs.existsSync(p)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(p, "utf8")) as Transcript;
    const st = fs.statSync(file);
    return t.source?.bytes === st.size && Math.abs(t.source.mtimeMs - st.mtimeMs) < 1 ? t : null;
  } catch { return null; }
};

/**
 * Word-level transcript of an audio/video file, cached next to it as <file>.transcript.json.
 * `language` "auto" (default) lets Whisper detect it; English-only models (*.en) are faster for English.
 */
export const transcribeFile = async (file: string, opts: { model?: WhisperModel; language?: string; force?: boolean; onProgress?: Progress; signal?: AbortSignal } = {}): Promise<Transcript> => {
  const model = opts.model ?? DEFAULT_WHISPER_MODEL;
  if (!MODELS.includes(model as (typeof MODELS)[number])) throw new Error(`Unknown speech model "${model}". Use one of: ${MODELS.join(", ")}`);
  if (!opts.force) {
    const cached = readTranscript(file);
    if (cached && cached.model === model) return cached;
  }
  const whisperPath = await ensureWhisper(opts.onProgress, opts.signal);
  const modelFolder = await ensureModel(model, opts.onProgress, opts.signal);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-whisper-"));
  try {
    const wav = path.join(tmp, "audio.wav");
    opts.onProgress?.({ progress: 0.32, message: "Extracting audio" });
    await toWav16k(file, wav);
    const out = await transcribe({
      inputPath: wav, whisperPath, whisperCppVersion: WHISPER_VERSION, model, modelFolder, tokenLevelTimestamps: true, splitOnWord: true,
      language: (opts.language && opts.language !== "auto" ? opts.language : null) as Language | null,
      printOutput: false, signal: opts.signal,
      onProgress: (p) => opts.onProgress?.({ progress: 0.35 + p * 0.6, message: "Transcribing" }),
    });
    const { captions } = toCaptions({ whisperCppOutput: out });
    const words: Word[] = captions
      .map((c) => ({ text: c.text.trim(), start: c.startMs / 1000, end: c.endMs / 1000, p: c.confidence ?? undefined }))
      .filter((w) => w.text && !/^\[.*\]$/.test(w.text) && w.end > w.start);
    const st = fs.statSync(file);
    const t: Transcript = {
      model, language: out.result?.language ?? opts.language ?? "auto", seconds: await mediaSeconds(file), words,
      source: { file: path.basename(file), bytes: st.size, mtimeMs: st.mtimeMs },
    };
    fs.writeFileSync(transcriptPath(file), JSON.stringify(t, null, 1));
    return t;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

export const mediaSeconds = async (file: string): Promise<number> => {
  const { stdout } = await runMediaTool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const s = Number(stdout.trim());
  return Number.isFinite(s) ? s : 0;
};

// ---------------------------------------------------------------- silence + shots

/** Stretches quieter than `noiseDb` for at least `minSeconds` (ffmpeg silencedetect). */
export const detectSilences = async (file: string, noiseDb = -35, minSeconds = 0.3): Promise<Span[]> => {
  const { stderr } = await runMediaTool("ffmpeg", ["-v", "info", "-i", file, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`, "-f", "null", "-"]);
  const out: Span[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start != null) { out.push({ start, end: Number(e[1]) }); start = null; }
  }
  return out;
};

/**
 * Hard cuts (shot changes) in a video. Frames are decoded tiny (32×18 RGB, 30 fps — lower rates hold the old frame past a cut) and compared in JS, so this works
 * with Remotion's minimal bundled FFmpeg (no select/scdet filters). A cut is a frame difference that is both large in
 * absolute terms and far above the local motion level, so fast camera moves and flashes inside a shot rarely count.
 */
export const detectShots = async (file: string, opts: { threshold?: number; fps?: number } = {}): Promise<number[]> => {
  const W = 32, H = 18, fps = opts.fps ?? 30, threshold = opts.threshold ?? 0.12;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-shots-"));
  try {
    // uncompressed RGB frames in an AVI: the bundled FFmpeg has no raw muxer, but has AVI + the rawvideo encoder.
    // Colour (not grey) so a cut between equally bright shots still registers.
    const avi = path.join(tmp, "frames.avi");
    const F = W * H * 3;
    await runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", file, "-an", "-r", String(fps), "-vf", `scale=${W}:${H},format=bgr24`, "-c:v", "rawvideo", "-f", "avi", avi]);
    const buf = aviFrames(fs.readFileSync(avi), F);
    const n = Math.floor(buf.length / F);
    const diffs: number[] = [0];
    for (let f = 1; f < n; f++) {
      let s = 0;
      for (let i = 0; i < F; i++) s += Math.abs(buf[f * F + i] - buf[(f - 1) * F + i]);
      diffs.push(s / (F * 255));
    }
    const cuts: number[] = [];
    for (let f = 1; f < n; f++) {
      const local = diffs.slice(Math.max(1, f - 8), f).concat(diffs.slice(f + 1, f + 9));
      const base = local.length ? quant(local, 0.5) : 0;
      if (diffs[f] > threshold && diffs[f] > base * 3 + 0.02 && (!cuts.length || f / fps - cuts[cuts.length - 1] > 0.25)) cuts.push(Math.round((f / fps) * 1000) / 1000);
    }
    return cuts;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

/** Concatenated payloads of an AVI's video chunks ("00db"/"00dc") of exactly `size` bytes. */
const aviFrames = (avi: Buffer, size: number): Buffer => {
  const out: Buffer[] = [];
  for (let i = avi.indexOf("movi"); i >= 0 && i + 8 <= avi.length;) {
    const id = avi.toString("latin1", i, i + 4);
    if ((id === "00db" || id === "00dc") && avi.readUInt32LE(i + 4) === size && i + 8 + size <= avi.length) {
      out.push(avi.subarray(i + 8, i + 8 + size));
      i += 8 + size + (size & 1);
    } else i++;
  }
  return Buffer.concat(out);
};

const quant = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))];
};
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- reference style

export type StyleMeasurement = {
  seconds: number;
  shots: { count: number; cutsPerMinute: number; medianShot: number; p25Shot: number; p75Shot: number; firstCut: number | null };
  speech?: { words: number; wordsPerMinute: number; medianGap: number; p90Gap: number; longestPause: number };
};

/** Measure a reference video's pacing (shot lengths, cut rate) and, when it has speech, its delivery (WPM, pause lengths). */
export const measureReference = async (file: string, opts: { transcribe?: boolean; onProgress?: Progress; signal?: AbortSignal } = {}): Promise<StyleMeasurement> => {
  const seconds = await mediaSeconds(file);
  opts.onProgress?.({ progress: 0.05, message: "Finding cuts" });
  const cuts = await detectShots(file);
  const bounds = [0, ...cuts, seconds];
  const shots = bounds.slice(1).map((t, i) => t - bounds[i]).filter((d) => d > 0.05);
  const m: StyleMeasurement = {
    seconds: r2(seconds),
    shots: {
      count: shots.length, cutsPerMinute: r2(seconds ? (cuts.length / seconds) * 60 : 0),
      medianShot: r2(quant(shots, 0.5)), p25Shot: r2(quant(shots, 0.25)), p75Shot: r2(quant(shots, 0.75)), firstCut: cuts.length ? r2(cuts[0]) : null,
    },
  };
  if (opts.transcribe !== false) {
    try {
      const t = await transcribeFile(file, { onProgress: (p) => opts.onProgress?.({ progress: 0.2 + p.progress * 0.8, message: p.message }), signal: opts.signal });
      if (t.words.length >= 8) {
        const gaps = t.words.slice(1).map((w, i) => w.start - t.words[i].end).filter((g) => g > 0.01);
        const span = t.words[t.words.length - 1].end - t.words[0].start;
        m.speech = { words: t.words.length, wordsPerMinute: Math.round((t.words.length / Math.max(1, span)) * 60), medianGap: r2(quant(gaps, 0.5)), p90Gap: r2(quant(gaps, 0.9)), longestPause: r2(Math.max(0, ...gaps)) };
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      /* no audio track or transcription unavailable: pacing alone */
    }
  }
  return m;
};

// ---------------------------------------------------------------- edit styles (the reusable "my editing style")

export type CaptionLook = { style?: "karaoke" | "pop" | "box" | "bounce" | "clean"; wordsPerPage?: number; uppercase?: boolean; fontSize?: number; color?: string; highlightColor?: string; font?: string; position?: "lower" | "center" | "upper" };
export type EditStyle = {
  name: string;
  createdAt: string;
  updatedAt: string;
  /** what was measured from the references (if any) */
  references?: { name: string; measured: StyleMeasurement }[];
  edit: Pick<EditOptions, "maxPause" | "pad" | "removeFillers" | "removeStutters" | "removeRetakes">;
  /** alternate a zoomed framing every N cuts (jump-cut punch-in); false = never */
  punchIn?: { every: number; scale: number } | false;
  captions?: CaptionLook | false;
  /** free-text craft notes the director follows when layering graphics: transitions, b-roll habits, overlays, sound… */
  notes?: string;
};

const STYLES_DIR = path.join(LIBRARY_DIR, "edit-styles");
export const styleSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "style";

export const listEditStyles = (): EditStyle[] => {
  if (!fs.existsSync(STYLES_DIR)) return [];
  return fs.readdirSync(STYLES_DIR).filter((f) => f.endsWith(".json")).flatMap((f) => {
    try { return [JSON.parse(fs.readFileSync(path.join(STYLES_DIR, f), "utf8")) as EditStyle]; } catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const getEditStyle = (name: string): EditStyle => {
  const f = path.join(STYLES_DIR, `${styleSlug(name)}.json`);
  if (!fs.existsSync(f)) throw new Error(`No edit style "${name}". Saved styles: ${listEditStyles().map((s) => s.name).join(", ") || "none yet (use save_edit_style)"}`);
  return JSON.parse(fs.readFileSync(f, "utf8")) as EditStyle;
};

export const saveEditStyle = (style: Omit<EditStyle, "createdAt" | "updatedAt">): EditStyle => {
  fs.mkdirSync(STYLES_DIR, { recursive: true });
  const f = path.join(STYLES_DIR, `${styleSlug(style.name)}.json`);
  const prev = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as EditStyle) : null;
  const now = new Date().toISOString();
  const out: EditStyle = { ...prev, ...style, createdAt: prev?.createdAt ?? now, updatedAt: now };
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
  fs.renameSync(tmp, f);
  return out;
};

/** Edit settings implied by measured references: pause tolerance from the speaker's own gaps, punch-ins from cut rate. */
export const suggestFromMeasurements = (ms: StyleMeasurement[]): Pick<EditStyle, "edit" | "punchIn" | "captions"> => {
  const gaps = ms.flatMap((m) => (m.speech ? [m.speech.p90Gap] : []));
  const shot = quant(ms.map((m) => m.shots.medianShot).filter((x) => x > 0), 0.5);
  const maxPause = gaps.length ? Math.min(0.6, Math.max(0.12, quant(gaps, 0.5))) : 0.3;
  const wpm = quant(ms.flatMap((m) => (m.speech ? [m.speech.wordsPerMinute] : [])), 0.5);
  return {
    edit: { maxPause: r2(maxPause), pad: maxPause < 0.2 ? 0.05 : 0.08, removeFillers: true, removeStutters: true, removeRetakes: true },
    // fast-cut references (median shot < 3s) read as punch-in every cut; slower ones every few cuts; very long shots none
    punchIn: !shot ? { every: 2, scale: 1.12 } : shot < 3 ? { every: 1, scale: 1.12 } : shot < 7 ? { every: 2, scale: 1.1 } : false,
    captions: { style: "pop", wordsPerPage: wpm > 190 ? 2 : wpm && wpm < 130 ? 4 : 3, uppercase: false, position: "lower" },
  };
};

// ---------------------------------------------------------------- plan + compile

export const planFootage = async (file: string, opts: EditOptions & { model?: WhisperModel; language?: string; onProgress?: Progress; signal?: AbortSignal } = {}): Promise<{ plan: EditPlan; transcript: Transcript; text: string }> => {
  const transcript = await transcribeFile(file, { model: opts.model, language: opts.language, onProgress: opts.onProgress, signal: opts.signal });
  if (!transcript.words.length) throw new Error("No speech found in this file (the transcript is empty), so there is nothing to cut by speech. Use trimStart/duration on a media layer instead.");
  opts.onProgress?.({ progress: 0.97, message: "Finding pauses" });
  const silences = await detectSilences(file).catch(() => []);
  const plan = planEdit(transcript.words, transcript.seconds || (await mediaSeconds(file)), opts, silences);
  return { plan, transcript, text: describePlan(plan) };
};

const fingerprint = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 6);

/**
 * Compile a plan into a Scene Spec: one scene per kept stretch (footage trimmed to it, audio on), word-timed captions,
 * and optional alternating punch-in framing so jump cuts read as intentional.
 */
export const footageSpec = (plan: EditPlan, o: {
  src: string; format: keyof typeof FORMATS; fps?: number; title?: string; captions?: CaptionLook | false; punchIn?: EditStyle["punchIn"];
}) => {
  const [W, H] = FORMATS[o.format];
  const portrait = H > W;
  const cap = o.captions === false ? null : { style: "pop" as const, wordsPerPage: 3, position: "lower" as const, ...(o.captions ?? {}) };
  const capY = !cap ? 0 : cap.position === "upper" ? -H * 0.3 : cap.position === "center" ? 0 : H * (portrait ? 0.22 : 0.32);
  const punch = o.punchIn === undefined ? { every: 2, scale: 1.1 } : o.punchIn;
  const scenes = plan.keep.map((k, i) => {
    const dur = Math.round((k.end - k.start) * 1000) / 1000;
    const zoomed = !!punch && punch.every > 0 && i % (punch.every + 1) === punch.every;
    const layers: Record<string, unknown>[] = [{
      type: "media", id: "footage", src: o.src, kind: "video", trimStart: k.start, volume: 1, fit: "cover", width: W, height: H,
      ...(zoomed && punch ? { scale: punch.scale } : {}),
    }];
    if (cap) {
      const words = k.words
        .map((w) => ({ text: w.text.trim(), start: Math.max(0, Math.round((w.start - k.start) * 1000) / 1000), end: Math.min(dur, Math.round((w.end - k.start) * 1000) / 1000) }))
        .filter((w) => w.text && w.end > w.start);
      if (words.length) {
        layers.push({
          type: "captions", id: "captions", words, style: cap.style, wordsPerPage: cap.wordsPerPage, y: Math.round(capY),
          ...(cap.uppercase != null ? { uppercase: cap.uppercase } : {}), ...(cap.fontSize ? { fontSize: cap.fontSize } : {}),
          ...(cap.color ? { color: cap.color } : {}), ...(cap.highlightColor ? { highlightColor: cap.highlightColor } : {}), ...(cap.font ? { font: cap.font } : {}),
        });
      }
    }
    return { id: `cut-${String(i + 1).padStart(2, "0")}`, duration: dur, transition: { type: "cut" }, layers, notes: `src ${k.start.toFixed(2)}–${k.end.toFixed(2)}s · ${k.text.slice(0, 160)}` };
  });
  return {
    title: o.title ?? `Edit of ${path.basename(o.src)}`,
    format: o.format,
    fps: o.fps ?? 30,
    theme: { colors: { bg: "#000000", fg: "#ffffff", accent: cap?.highlightColor ?? "#FFD43B" } },
    scenes,
    edit: { source: o.src, plan: fingerprint(JSON.stringify(plan.keep.map((k) => [k.start, k.end]))), sourceSeconds: plan.sourceSeconds, editedSeconds: plan.editedSeconds },
  };
};

// ---------------------------------------------------------------- reference download (yt-dlp, local mode)

/** Download a public video page (YouTube, Instagram, X, Vimeo…) with yt-dlp, if it is installed. Returns the file path. */
export const downloadWithYtDlp = async (url: string, outDir: string, signal?: AbortSignal): Promise<string> => {
  if (!/^https:\/\//i.test(url)) throw new Error("Only https links are supported");
  fs.mkdirSync(outDir, { recursive: true });
  const template = path.join(outDir, "ref-%(id)s.%(ext)s");
  const args = ["--no-playlist", "--max-filesize", "300M", "-f", "mp4/bestvideo[ext=mp4][height<=1920]+bestaudio[ext=m4a]/best", "--merge-output-format", "mp4",
    "--restrict-filenames", "--no-progress", "--print", "after_move:filepath", "-o", template, url];
  return new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", args, { signal });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => reject((e as NodeJS.ErrnoException).code === "ENOENT"
      ? new Error("yt-dlp is not installed. Install it (macOS: brew install yt-dlp · pip: pip install -U yt-dlp), or download the video yourself and upload it with add_asset.")
      : e));
    p.on("close", (code) => {
      const file = out.trim().split("\n").filter(Boolean).pop();
      if (code === 0 && file && fs.existsSync(file)) resolve(file);
      else reject(new Error(`yt-dlp could not download this link: ${err.trim().split("\n").slice(-2).join(" ") || `exit ${code}`}`));
    });
  });
};
