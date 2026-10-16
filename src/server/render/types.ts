/** Render backends (docs/PLATFORM.md → "Render backends"). */
import type { Spec } from "../../engine/spec/schema";
import type { RenderRecord } from "../../core/tools";

export type RenderInfo = { file: string; url: string; quality: "draft" | "final"; createdAt: string; sizeBytes: number; seconds?: number; width?: number; height?: number };

/** What a backend returns: the RenderInfo plus the extra record fields (fps, render time) the tools report. */
export type RenderOutput = RenderInfo & { fps?: number; renderSeconds?: number };

export type RenderProgressUpdate = { progress: number; stage: string };

/** The slice of a Job a backend needs. */
export type RenderJob = { id: string; projectId: string; quality: "draft" | "final" };

export type RenderBackend = {
  name: "local" | "lambda";
  /** Jobs this backend runs at once (local: 1 — one machine, one Chrome). */
  concurrency: number;
  render(job: RenderJob, spec: Spec, onProgress: (p: RenderProgressUpdate) => void, signal: AbortSignal): Promise<RenderOutput>;
};

export const fileUrl = (projectId: string, rel: string) => `/files/${encodeURIComponent(projectId)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

export const toRenderOutput = (projectId: string, r: RenderRecord): RenderOutput => ({
  file: r.file,
  url: fileUrl(projectId, r.file),
  quality: r.quality,
  createdAt: r.createdAt,
  sizeBytes: r.sizeBytes,
  ...(r.seconds !== undefined ? { seconds: r.seconds } : {}),
  ...(r.width !== undefined ? { width: r.width } : {}),
  ...(r.height !== undefined ? { height: r.height } : {}),
  ...(r.fps !== undefined ? { fps: r.fps } : {}),
  ...(r.renderSeconds !== undefined ? { renderSeconds: r.renderSeconds } : {}),
});
