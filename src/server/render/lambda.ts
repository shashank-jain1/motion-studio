/**
 * AWS Lambda backend (@remotion/lambda 4.0.532).
 *
 * Setup (once, and again after engine changes): `pnpm deploy:lambda` → deployFunction + getOrCreateBucket +
 * deploySiteFromBundle, written to data/lambda.json.
 * Per job: the project's assets/ and glyphs.json are synced to the site bucket under an unguessable
 * `projects/<id>-<hmac>/` prefix (public-read, so Lambda's Chrome can load them) and passed as `assetBase`;
 * renderMediaOnLambda + getRenderProgress (polled); the MP4 is downloaded into projects/<id>/renders/ with the usual
 * .mp4.json sidecar. Cancel → cancelRenderOnLambda (renders start with enableCancellation).
 *
 * Enabled when RENDER_BACKEND=lambda, AWS credentials are set (REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY,
 * or the AWS_* equivalents) and data/lambda.json exists. Otherwise every job fails fast with a clear message.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getProject } from "../../core/projects";
import { FORMATS, type Spec } from "../../engine/spec/schema";
import { masterFormat, reflowSpec } from "../../engine/spec/reflow";
import { computeTimeline } from "../../core/projects";
import type { RenderRecord } from "../../core/tools";
import { getSecret, LAMBDA_CONFIG_FILE } from "../config";
import { LIBRARY_DIR } from "../../core/paths";
import { SFX_DIR, ensureSfxLibrary } from "../../../scripts/gen-sfx";
import { soundFilesForSpec } from "../../../scripts/sfx-bake";
import { contentType } from "../files";
import { toRenderOutput, type RenderBackend } from "./types";

export type LambdaConfig = {
  region: string;
  functionName: string;
  bucketName: string;
  serveUrl: string;
  siteName: string;
  deployedAt?: string;
  remotionVersion?: string;
};

const POLL_MS = 1500;
const COMPOSITION_ID = "Spec";

export const hasAwsCredentials = () =>
  !!(
    (process.env.REMOTION_AWS_ACCESS_KEY_ID && process.env.REMOTION_AWS_SECRET_ACCESS_KEY) ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
    process.env.REMOTION_AWS_PROFILE ||
    process.env.AWS_PROFILE
  );

export const readLambdaConfig = (): LambdaConfig | null => {
  try {
    const v = JSON.parse(fs.readFileSync(LAMBDA_CONFIG_FILE, "utf8")) as LambdaConfig;
    if (v && v.region && v.functionName && v.bucketName && v.serveUrl) return v;
  } catch {
    /* missing */
  }
  return null;
};

/** Why the Lambda backend can't run right now (null = ready). */
export const lambdaConfigError = (): string | null => {
  if (!hasAwsCredentials()) {
    return "Lambda rendering is not configured: set REMOTION_AWS_ACCESS_KEY_ID, REMOTION_AWS_SECRET_ACCESS_KEY and REMOTION_AWS_REGION (see docs/DEPLOY.md), or unset RENDER_BACKEND to render locally.";
  }
  if (!readLambdaConfig()) return `Lambda rendering is not deployed: run \`pnpm deploy:lambda\` (writes ${LAMBDA_CONFIG_FILE}).`;
  return null;
};

const abortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Unguessable, stable S3 prefix for a project's assets. */
export const assetPrefix = (projectId: string) =>
  `projects/${projectId}-${crypto.createHmac("sha256", getSecret()).update(`lambda-assets:${projectId}`).digest("hex").slice(0, 24)}`;

/** Files Lambda's Chrome may load: assets/* (incl. *.logo.json) and glyphs.json. */
const projectUploadFiles = (dir: string): string[] => {
  const out: string[] = [];
  const assets = path.join(dir, "assets");
  try {
    for (const e of fs.readdirSync(assets, { withFileTypes: true })) if (e.isFile() && !e.name.startsWith(".")) out.push(`assets/${e.name}`);
  } catch {
    /* no assets */
  }
  if (fs.existsSync(path.join(dir, "glyphs.json"))) out.push("glyphs.json");
  return out;
};

/** Built-in SFX ("sfx:" cues / auto sound), uploaded next to the assets under `_library/` (HEAD-cached like assets):
 * the library files the spec references plus every planned cue, pre-baked (scripts/sfx-bake.ts). */
const librarySfxFiles = (spec: Spec): string[] => {
  if (!spec.sound && !spec.sfx?.some((s) => s.src.startsWith("sfx:"))) return [];
  ensureSfxLibrary();
  try {
    return soundFilesForSpec(spec).map((rel) => `_library/${rel}`);
  } catch (e) {
    console.error(`[motion-studio] sound pre-bake failed: ${(e as Error).message}`);
    return fs.readdirSync(SFX_DIR).filter((f) => f.endsWith(".wav")).map((f) => `_library/sfx/${f}`);
  }
};

const specSize = (spec: Spec, scale: number) => {
  const s = spec as Spec & { width?: number; height?: number; format?: keyof typeof FORMATS };
  const [w, h] = s.width && s.height ? [s.width, s.height] : FORMATS[s.format ?? "16:9"];
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
};

export const lambdaBackend: RenderBackend = {
  name: "lambda",
  concurrency: Math.max(1, Number(process.env.LAMBDA_CONCURRENCY ?? 4)),
  async render(job, master, onProgress, signal) {
    const spec = job.format ? reflowSpec(master, job.format) : master;
    const format = job.format ?? masterFormat(master);
    const err = lambdaConfigError();
    if (err) throw new Error(err);
    const cfg = readLambdaConfig()!;
    const region = cfg.region as import("@remotion/lambda/client").AwsRegion;
    const { getAwsClient, renderMediaOnLambda, getRenderProgress, cancelRenderOnLambda } = await import("@remotion/lambda/client");
    const project = getProject(job.projectId);
    const t0 = Date.now();

    // 1) sync assets to S3
    onProgress({ progress: 0, stage: "uploading assets" });
    const { client: s3, sdk } = getAwsClient({ region, service: "s3" });
    const prefix = assetPrefix(job.projectId);
    const files = [...projectUploadFiles(project.dir), ...librarySfxFiles(spec)];
    for (const [i, rel] of files.entries()) {
      if (signal.aborted) throw abortError();
      const abs = rel.startsWith("_library/") ? path.join(LIBRARY_DIR, rel.slice("_library/".length)) : path.join(project.dir, rel);
      const st = fs.statSync(abs);
      const Key = `${prefix}/${rel}`;
      const mtime = String(Math.round(st.mtimeMs));
      let fresh = false;
      try {
        const head = await s3.send(new sdk.HeadObjectCommand({ Bucket: cfg.bucketName, Key }));
        fresh = head.ContentLength === st.size && head.Metadata?.mtime === mtime;
      } catch {
        fresh = false;
      }
      if (!fresh) {
        await s3.send(
          new sdk.PutObjectCommand({
            Bucket: cfg.bucketName,
            Key,
            Body: fs.createReadStream(abs),
            ContentLength: st.size,
            ContentType: contentType(abs),
            ACL: "public-read",
            Metadata: { mtime },
          }),
          { abortSignal: signal },
        );
      }
      onProgress({ progress: (0.05 * (i + 1)) / Math.max(1, files.length), stage: "uploading assets" });
    }
    const assetBase = `https://${cfg.bucketName}.s3.${region}.amazonaws.com/${prefix}`;

    // 2) start the render
    const quality = job.quality;
    const scale = quality === "final" ? 1 : 0.5;
    onProgress({ progress: 0.05, stage: "starting Lambda" });
    const { renderId, bucketName } = await renderMediaOnLambda({
      region,
      functionName: cfg.functionName,
      serveUrl: cfg.serveUrl,
      composition: COMPOSITION_ID,
      inputProps: { spec, assetBase, projectId: job.projectId, libraryBase: `${assetBase}/_library` },
      codec: "h264",
      crf: quality === "final" ? 18 : 28,
      scale,
      x264Preset: quality === "final" ? "medium" : "veryfast",
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: quality === "final" ? 95 : 80,
      privacy: "private",
      chromiumOptions: { gl: "swangle" },
      maxRetries: 1,
      enableCancellation: true,
      downloadBehavior: { type: "play-in-browser" },
      logLevel: "warn",
    });

    // 3) poll
    let canceled = false;
    const cancel = () => {
      if (canceled) return;
      canceled = true;
      cancelRenderOnLambda({ region, bucketName, renderId }).catch((e) => console.error(`[motion-studio] lambda cancel ${renderId}: ${(e as Error).message}`));
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        await sleep(POLL_MS, signal);
        const p = await getRenderProgress({ renderId, bucketName, functionName: cfg.functionName, region });
        if (p.fatalErrorEncountered) {
          const e = p.errors.find((x) => x.isFatal) ?? p.errors[0];
          throw new Error(`Lambda render failed: ${e?.message ?? "unknown error"}${e?.stack ? `\n${e.stack.split("\n").slice(0, 3).join("\n")}` : ""}`);
        }
        if (p.done) break;
        onProgress({ progress: 0.05 + 0.9 * Math.min(1, p.overallProgress), stage: p.encodingStatus ? "encoding on Lambda" : "rendering on Lambda" });
      }
    } finally {
      signal.removeEventListener("abort", cancel);
    }

    // 4) download into renders/
    onProgress({ progress: 0.96, stage: "downloading" });
    const { downloadMedia } = await import("@remotion/lambda");
    const rendersDir = path.join(project.dir, "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const outPath = path.join(rendersDir, `${stamp}-${quality}-${format.replace(":", "x")}.mp4`);
    const { sizeInBytes } = await downloadMedia({ region, bucketName, renderId, outPath, signal });
    const { width, height } = specSize(spec, scale);
    const record: RenderRecord = {
      file: path.relative(project.dir, outPath).split(path.sep).join("/"),
      quality,
      createdAt: new Date().toISOString(),
      sizeBytes: sizeInBytes,
      seconds: computeTimeline(spec).total,
      width,
      height,
      fps: spec.fps,
      renderSeconds: Math.round((Date.now() - t0) / 100) / 10,
      format,
    };
    try {
      fs.writeFileSync(`${outPath}.json`, JSON.stringify(record, null, 2) + "\n");
    } catch {
      /* metadata is best effort */
    }
    onProgress({ progress: 1, stage: "done" });
    return toRenderOutput(job.projectId, record);
  },
};
