/** Asset probing via ffprobe/ffmpeg (execFile, never a shell). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);

export type AssetKind = "image" | "video" | "audio" | "lottie" | "other";

export type AssetInfo = {
  /** Path to use in specs, e.g. "assets/logo.png" */
  path: string;
  file: string;
  kind: AssetKind;
  sizeBytes: number;
  width?: number;
  height?: number;
  /** seconds (video/audio) */
  duration?: number;
  fps?: number;
  hasAudio?: boolean;
  hasAlpha?: boolean;
  /** Dominant colors, most frequent first (images and video). */
  palette?: string[];
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".svg", ".tif", ".tiff"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".flac", ".opus"]);

/** Run a binary and return stdout as a Buffer. */
export const runBinary = async (bin: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<Buffer> => {
  const { stdout } = await execFileP(bin, args, { encoding: "buffer", maxBuffer, windowsHide: true });
  return stdout as Buffer;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  nb_frames?: string;
};
type FfprobeOut = { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } };

export const ffprobe = async (file: string): Promise<FfprobeOut> => {
  const out = await runBinary("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  return JSON.parse(out.toString("utf8")) as FfprobeOut;
};

const parseRate = (r?: string): number | undefined => {
  if (!r) return undefined;
  const [a, b] = r.split("/").map(Number);
  if (!b || !Number.isFinite(a / b) || a / b <= 0) return undefined;
  return Math.round((a / b) * 100) / 100;
};

const STILL_CODECS = new Set(["png", "mjpeg", "webp", "bmp", "tiff", "gif", "av1", "jpegls", "svg"]);

export const probeAsset = async (absPath: string, specPath?: string): Promise<AssetInfo> => {
  const stat = fs.statSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const info: AssetInfo = {
    path: specPath ?? `assets/${path.basename(absPath)}`,
    file: absPath,
    kind: "other",
    sizeBytes: stat.size,
  };

  if (ext === ".json") {
    try {
      const j = JSON.parse(fs.readFileSync(absPath, "utf8"));
      if (j && typeof j === "object" && "layers" in j && ("fr" in j || "ip" in j)) {
        info.kind = "lottie";
        if (typeof j.w === "number") info.width = j.w;
        if (typeof j.h === "number") info.height = j.h;
        if (typeof j.fr === "number" && typeof j.op === "number") {
          info.fps = j.fr;
          info.duration = Math.round(((j.op - (j.ip ?? 0)) / j.fr) * 1000) / 1000;
        }
      }
    } catch {
      /* not JSON */
    }
    return info;
  }

  let probe: FfprobeOut | null = null;
  try {
    probe = await ffprobe(absPath);
  } catch {
    probe = null;
  }

  const streams = probe?.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const fmtDuration = Number(probe?.format?.duration);

  if (IMAGE_EXT.has(ext)) info.kind = "image";
  else if (VIDEO_EXT.has(ext)) info.kind = v ? "video" : a ? "audio" : "video";
  else if (AUDIO_EXT.has(ext)) info.kind = "audio";
  else if (v) {
    const still = STILL_CODECS.has(v.codec_name ?? "") && (!Number.isFinite(fmtDuration) || fmtDuration < 0.1);
    info.kind = still || /image2|_pipe$/.test(probe?.format?.format_name ?? "") ? "image" : "video";
  } else if (a) info.kind = "audio";

  if (v && (info.kind === "image" || info.kind === "video")) {
    info.width = v.width;
    info.height = v.height;
    info.hasAlpha = /rgba|argb|bgra|abgr|yuva|gbrap|ya8|ya16|pal8/.test(v.pix_fmt ?? "");
  }
  if (info.kind === "video" || info.kind === "audio") {
    const d = Number.isFinite(fmtDuration) ? fmtDuration : Number(v?.duration ?? a?.duration);
    if (Number.isFinite(d)) info.duration = Math.round(d * 1000) / 1000;
  }
  if (info.kind === "video") {
    info.fps = parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate);
    info.hasAudio = Boolean(a);
  }
  if (info.kind === "audio") info.hasAudio = true;

  if (info.kind === "image" || info.kind === "video") {
    try {
      const seek = info.kind === "video" && info.duration ? Math.min(1, info.duration * 0.1) : 0;
      info.palette = await dominantPalette(absPath, { seek });
    } catch {
      /* palette is best-effort (e.g. SVG without a decoder) */
    }
  }
  return info;
};

/** Decode one frame to 64x64 RGBA and k-means it into up to k hex colors, most frequent first. */
export const dominantPalette = async (file: string, opts: { seek?: number; k?: number } = {}): Promise<string[]> => {
  const k = opts.k ?? 5;
  const args = ["-v", "error"];
  if (opts.seek && opts.seek > 0) args.push("-ss", String(opts.seek));
  args.push("-i", file, "-frames:v", "1", "-vf", "scale=64:64:flags=area", "-f", "rawvideo", "-pix_fmt", "rgba", "-");
  const raw = await runBinary("ffmpeg", args);
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 3 < raw.length; i += 4) {
    if (raw[i + 3] < 128) continue; // ignore transparent pixels (logos, cutouts)
    pts.push([raw[i], raw[i + 1], raw[i + 2]]);
  }
  if (pts.length === 0) return [];
  return kmeans(pts, k);
};

const kmeans = (pts: [number, number, number][], k: number): string[] => {
  // Deterministic init: centroids at luminance quantiles.
  const lum = (p: [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const sorted = [...pts].sort((a, b) => lum(a) - lum(b));
  let cents: [number, number, number][] = [];
  for (let c = 0; c < k; c++) {
    const p = sorted[Math.min(sorted.length - 1, Math.floor(((c + 0.5) / k) * sorted.length))];
    cents.push([p[0], p[1], p[2]]);
  }
  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 15; iter++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < cents.length; c++) {
        const dr = p[0] - cents[c][0], dg = p[1] - cents[c][1], db = p[2] - cents[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const s = sums[assign[i]];
      s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    cents = cents.map((c, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c));
    if (!changed && iter > 0) break;
  }
  const counts = new Array(cents.length).fill(0);
  for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  const out: string[] = [];
  cents
    .map((c, j) => ({ c, n: counts[j] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .forEach(({ c }) => {
      const h = `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
      if (!out.includes(h)) out.push(h);
    });
  return out;
};

/** Small JPEG thumbnail (longest side `size`) of an image or a video frame, as a Buffer. */
export const thumbnail = async (file: string, opts: { size?: number; seek?: number } = {}): Promise<Buffer> => {
  const size = opts.size ?? 384;
  const args = ["-v", "error"];
  if (opts.seek && opts.seek > 0) args.push("-ss", String(opts.seek));
  args.push(
    "-i", file, "-frames:v", "1",
    // Composite onto mid-grey so transparent logos stay visible.
    "-filter_complex",
    `[0:v]scale='if(gt(iw,ih),min(${size},iw),-2)':'if(gt(iw,ih),-2,min(${size},ih))',format=rgba,split[a][b];` +
      `[a]drawbox=x=0:y=0:w=iw:h=ih:color=0x8a8a8a@1:t=fill[bg];[bg][b]overlay=format=auto,format=yuvj420p`,
    "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-",
  );
  return runBinary("ffmpeg", args);
};
