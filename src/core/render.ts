/**
 * Rendering: one cached Remotion bundle, still frames + contact sheet for previews, MP4 renders.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import {
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
  type ChromiumOptions,
  type LogLevel,
  type RenderMediaProgress,
} from "@remotion/renderer";
import { BUNDLE_CACHE_DIR, ENGINE_DIR, ENGINE_ENTRY, ROOT } from "./paths";
import { getProject, loadSpec } from "./projects";
import { startAssetServer } from "./assetServer";

const execFileP = promisify(execFile);

/** OpenGL backend for headless Chrome. "angle" is fastest where supported; try "swangle" if WebGL fails. */
export const RENDER_GL: NonNullable<ChromiumOptions["gl"]> = (process.env.MOTION_STUDIO_GL as ChromiumOptions["gl"]) || "angle";
export const RENDER_LOG_LEVEL: LogLevel = "warn";
export const RENDER_CONCURRENCY = Math.max(1, Math.floor(os.cpus().length / 3));
export const COMPOSITION_ID = "Spec";

const chromiumOptions: ChromiumOptions = { gl: RENDER_GL };

// ---------------------------------------------------------------- bundle

/** Cheap fingerprint of src/engine (paths + mtimes + sizes) plus the lockfile. */
export const engineHash = (): string => {
  const h = crypto.createHash("sha1");
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const st = fs.statSync(p);
        h.update(`${path.relative(ENGINE_DIR, p)}:${st.mtimeMs}:${st.size}\n`);
      }
    }
  };
  walk(ENGINE_DIR);
  for (const f of ["package.json", "pnpm-lock.yaml"]) {
    try {
      const st = fs.statSync(path.join(ROOT, f));
      h.update(`${f}:${st.mtimeMs}:${st.size}\n`);
    } catch {
      /* ignore */
    }
  }
  return h.digest("hex").slice(0, 16);
};

let bundleMemo: { hash: string; promise: Promise<string> } | null = null;

/** Forget the in-memory bundle (the next getBundle() re-checks the engine hash). */
export const invalidateBundle = (): void => {
  bundleMemo = null;
};

/** Bundle ENGINE_ENTRY once per engine version; reused across calls and processes via .cache/bundle/<hash>. */
export const getBundle = (opts: { onProgress?: (p: number) => void } = {}): Promise<string> => {
  const hash = engineHash();
  if (bundleMemo && bundleMemo.hash === hash) return bundleMemo.promise;
  const outDir = path.join(BUNDLE_CACHE_DIR, hash);
  const promise = (async () => {
    if (fs.existsSync(path.join(outDir, "index.html")) && fs.existsSync(path.join(outDir, ".complete"))) return outDir;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(BUNDLE_CACHE_DIR, { recursive: true });
    const t0 = Date.now();
    console.error(`[motion-studio] bundling engine (${hash})...`);
    let lastPct = -1;
    const location = await bundle({
      entryPoint: ENGINE_ENTRY,
      outDir,
      rootDir: ROOT,
      enableCaching: true,
      onProgress: (p) => {
        opts.onProgress?.(p);
        const pct = Math.floor(p / 25) * 25;
        if (pct !== lastPct) {
          lastPct = pct;
          console.error(`[motion-studio] bundling ${p}%`);
        }
      },
    });
    fs.writeFileSync(path.join(outDir, ".complete"), new Date().toISOString());
    console.error(`[motion-studio] bundled in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${location}`);
    // Drop stale bundles.
    for (const d of fs.readdirSync(BUNDLE_CACHE_DIR)) {
      if (d !== hash) fs.rmSync(path.join(BUNDLE_CACHE_DIR, d), { recursive: true, force: true });
    }
    return location;
  })();
  bundleMemo = { hash, promise };
  promise.catch(() => {
    if (bundleMemo?.promise === promise) bundleMemo = null;
  });
  return promise;
};

// ---------------------------------------------------------------- helpers

const inputPropsFor = async (projectId: string) => {
  const spec = loadSpec(projectId);
  const server = await startAssetServer();
  return { spec, assetBase: server.baseUrlFor(projectId), projectId };
};

const fmtTime = (t: number) => t.toFixed(2);

// ---------------------------------------------------------------- stills

export type PreviewFrame = { time: number; frame: number; path: string };
export type PreviewResult = { frames: PreviewFrame[]; sheet: string | null; columns: number; rows: number; width: number; height: number; fps: number; durationSeconds: number };

/**
 * Render stills at the given times (seconds) into previews/, plus a labelled contact sheet (previews/sheet.jpg).
 * Previous preview images are removed first.
 */
export const renderFrames = async (
  projectId: string,
  times: number[],
  opts: { scale?: number; sheet?: boolean } = {},
): Promise<PreviewResult> => {
  const project = getProject(projectId);
  const scale = opts.scale ?? 0.5;
  if (times.length === 0) throw new Error("No times given");
  const inputProps = await inputPropsFor(projectId);
  const serveUrl = await getBundle();

  const previewsDir = path.join(project.dir, "previews");
  fs.mkdirSync(previewsDir, { recursive: true });
  for (const f of fs.readdirSync(previewsDir)) if (/^(frame-.*|sheet)\.(jpe?g|png)$/.test(f)) fs.rmSync(path.join(previewsDir, f), { force: true });

  const browser = await openBrowser("chrome", { chromiumOptions, logLevel: RENDER_LOG_LEVEL });
  try {
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      puppeteerInstance: browser,
      chromiumOptions,
      logLevel: RENDER_LOG_LEVEL,
    });
    const frames: PreviewFrame[] = [];
    const seen = new Set<number>();
    for (const t of times) {
      const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(t * composition.fps)));
      if (seen.has(frame)) continue;
      seen.add(frame);
      const time = frame / composition.fps;
      const output = path.join(previewsDir, `frame-${fmtTime(time)}s.jpg`);
      await renderStill({
        composition,
        serveUrl,
        output,
        frame,
        inputProps,
        imageFormat: "jpeg",
        jpegQuality: 85,
        scale,
        puppeteerInstance: browser,
        chromiumOptions,
        logLevel: RENDER_LOG_LEVEL,
        overwrite: true,
      });
      frames.push({ time, frame, path: output });
    }
    const width = Math.round(composition.width * scale);
    const height = Math.round(composition.height * scale);
    let sheet: string | null = null;
    let columns = 1;
    let rows = 1;
    if (opts.sheet !== false && frames.length > 0) {
      const res = await makeContactSheet(
        frames.map((f) => f.path),
        path.join(previewsDir, "sheet.jpg"),
        { labels: frames.map((f) => `${fmtTime(f.time)}s`), tileWidth: width, tileHeight: height },
      );
      sheet = res.path;
      columns = res.columns;
      rows = res.rows;
    }
    return { frames, sheet, columns, rows, width, height, fps: composition.fps, durationSeconds: composition.durationInFrames / composition.fps };
  } finally {
    await browser.close({ silent: true }).catch(() => undefined);
  }
};

let cachedFontFile: string | null | undefined;
const findFontFile = async (): Promise<string | null> => {
  if (cachedFontFile !== undefined) return cachedFontFile;
  cachedFontFile = null;
  try {
    const { stdout } = await execFileP("fc-match", ["-f", "%{file}", "DejaVu Sans:bold"]);
    if (stdout && fs.existsSync(stdout.trim())) cachedFontFile = stdout.trim();
  } catch {
    for (const f of ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Helvetica.ttc", "C:\\Windows\\Fonts\\arial.ttf"]) {
      if (fs.existsSync(f)) {
        cachedFontFile = f;
        break;
      }
    }
  }
  return cachedFontFile;
};

/** ffmpeg filter-string escaping for a value inside a filter option. */
const escFilter = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");

/**
 * Tile images into one JPEG (row-major), each labelled with its text (if drawtext is available).
 * Tiles are scaled so the whole sheet fits within ~2000px on its longest side.
 */
export const makeContactSheet = async (
  paths: string[],
  outPath: string,
  opts: { labels?: string[]; tileWidth?: number; tileHeight?: number; maxSide?: number } = {},
): Promise<{ path: string; columns: number; rows: number }> => {
  if (paths.length === 0) throw new Error("makeContactSheet: no images");
  const n = paths.length;
  const tw0 = opts.tileWidth ?? 960;
  const th0 = opts.tileHeight ?? 540;
  // Landscape frames stack in fewer columns; portrait frames spread wider.
  const cols = n <= 3 ? n : n === 4 ? 2 : Math.min(n, Math.max(2, Math.ceil(Math.sqrt(n * (th0 / tw0) * 1.2))));
  const rows = Math.ceil(n / cols);
  const maxSide = opts.maxSide ?? 2000;
  const gap = 6;
  const k = Math.min(1, (maxSide - gap * (cols + 1)) / (cols * tw0), (maxSide - gap * (rows + 1)) / (rows * th0));
  const tw = Math.max(16, Math.floor((tw0 * k) / 2) * 2);
  const th = Math.max(16, Math.floor((th0 * k) / 2) * 2);
  const fontSize = Math.max(14, Math.round(th / 14));

  const build = (fontFile: string | null) => {
    const parts: string[] = [];
    paths.forEach((_, i) => {
      let chain = `[${i}:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      const label = opts.labels?.[i];
      if (fontFile && label !== undefined) {
        chain += `,drawtext=fontfile='${escFilter(fontFile)}':text='${escFilter(`${i + 1}  ${label}`)}':x=10:y=10:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`;
      }
      chain += `,pad=${tw + gap}:${th + gap}:${gap}:${gap}:color=0x202020[t${i}]`;
      parts.push(chain);
    });
    const W = cols * (tw + gap) + gap;
    const H = rows * (th + gap) + gap;
    if (n === 1) {
      parts.push(`[t0]pad=${W}:${H}:0:0:color=0x202020[out]`);
    } else {
      const layout = paths.map((_, i) => `${(i % cols) * (tw + gap)}_${Math.floor(i / cols) * (th + gap)}`).join("|");
      parts.push(`${paths.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${n}:layout=${layout}:fill=0x202020,pad=${W}:${H}:0:0:color=0x202020[out]`);
    }
    return [
      "-v", "error", "-y",
      ...paths.flatMap((p) => ["-i", p]),
      "-filter_complex", parts.join(";"),
      "-map", "[out]", "-frames:v", "1", "-q:v", "3", outPath,
    ];
  };

  const fontFile = opts.labels ? await findFontFile() : null;
  try {
    await execFileP("ffmpeg", build(fontFile), { maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    if (!fontFile) throw e;
    console.error(`[motion-studio] contact sheet labels failed, retrying without: ${(e as Error).message.split("\n")[0]}`);
    await execFileP("ffmpeg", build(null), { maxBuffer: 16 * 1024 * 1024 });
  }
  return { path: outPath, columns: cols, rows };
};

// ---------------------------------------------------------------- video

export type RenderQuality = "draft" | "final";
export type RenderVideoResult = {
  path: string;
  /** Video duration in seconds */
  seconds: number;
  sizeBytes: number;
  width: number;
  height: number;
  fps: number;
  renderSeconds: number;
  quality: RenderQuality;
};

export const renderVideo = async (
  projectId: string,
  opts: { quality?: RenderQuality; onProgress?: (p: { progress: number; renderedFrames: number; encodedFrames: number; stage: string }) => void; signal?: AbortSignal } = {},
): Promise<RenderVideoResult> => {
  const project = getProject(projectId);
  const quality = opts.quality ?? "draft";
  const scale = quality === "final" ? 1 : 0.5;
  const crf = quality === "final" ? 18 : 28;
  const inputProps = await inputPropsFor(projectId);
  const serveUrl = await getBundle();
  const rendersDir = path.join(project.dir, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const outputLocation = path.join(rendersDir, `${stamp}-${quality}.mp4`);

  const t0 = Date.now();
  const browser = await openBrowser("chrome", { chromiumOptions, logLevel: RENDER_LOG_LEVEL });
  try {
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      puppeteerInstance: browser,
      chromiumOptions,
      logLevel: RENDER_LOG_LEVEL,
    });
    let cancelSignal: ((cb: () => void) => void) | undefined;
    if (opts.signal) {
      const sig = opts.signal;
      cancelSignal = (cb) => sig.addEventListener("abort", cb, { once: true });
    }
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      crf,
      scale,
      x264Preset: quality === "final" ? "medium" : "veryfast",
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: quality === "final" ? 95 : 80,
      concurrency: RENDER_CONCURRENCY,
      puppeteerInstance: browser,
      chromiumOptions,
      logLevel: RENDER_LOG_LEVEL,
      offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024,
      overwrite: true,
      cancelSignal,
      onProgress: (p: RenderMediaProgress) =>
        opts.onProgress?.({ progress: p.progress, renderedFrames: p.renderedFrames, encodedFrames: p.encodedFrames, stage: p.stitchStage }),
    });
    const sizeBytes = fs.statSync(outputLocation).size;
    return {
      path: outputLocation,
      seconds: composition.durationInFrames / composition.fps,
      sizeBytes,
      width: Math.round(composition.width * scale),
      height: Math.round(composition.height * scale),
      fps: composition.fps,
      renderSeconds: Math.round((Date.now() - t0) / 100) / 10,
      quality,
    };
  } finally {
    await browser.close({ silent: true }).catch(() => undefined);
  }
};
