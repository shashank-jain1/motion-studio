/**
 * Per-user tool scoping for the shared tool layer (src/core/tools.ts): the in-app director and the remote MCP build
 * their ToolContext.policy with toolPolicyFor(user).
 */
import type { ToolPolicy, RenderRecord, PendingRender, RenderJobStatus } from "../core/tools";
import { IS_HOSTED, MAX_URL_DOWNLOAD_BYTES, PUBLIC_URL } from "./config";
import { listUserProjectIds, ownsProject, recordProjectOwner, type User } from "./auth";
import { enqueueRenderJob, getJobFor, isTerminal, listJobs, waitForJob, type Job } from "./jobs";

/** Deep link to a project in the web app. */
export const projectUrl = (projectId: string) => `${PUBLIC_URL}/p/${encodeURIComponent(projectId)}`;

const recordOf = (job: Job): RenderRecord | undefined => {
  if (!job.output) return undefined;
  const { url: _url, ...record } = job.output;
  return record;
};

const statusOf = (job: Job): RenderJobStatus => ({
  jobId: job.id,
  status: job.status,
  quality: job.quality,
  progress: job.progress,
  ...(job.stage ? { stage: job.stage } : {}),
  ...(job.position ? { position: job.position } : {}),
  ...(job.error ? { error: job.error } : {}),
  ...(job.output ? { render: recordOf(job) } : {}),
  createdAt: job.createdAt,
  ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
});

export type ScopeOptions = {
  /** Append "Open in Motion Studio: <PUBLIC_URL>/p/<id>" to project tool results. */
  links?: boolean;
  /**
   * render_video waits at most this long, then answers "Still rendering, job <id>" (poll with render_status) and the job
   * keeps going even if the caller aborts. Unset (in-app director): wait until done; aborting cancels the job.
   */
  maxRenderWaitMs?: number;
};

/**
 * - hosted mode follows MOTION_STUDIO_MODE (local-path add_asset / write_custom_component off, SSRF-safe URLs, spec checks).
 * - every projectId must be owned by `user`; list_projects is filtered; create_project records ownership.
 * - render_video runs through the job queue (progress → ctx.onProgress); render_status reads the user's jobs.
 */
export const toolPolicyFor = (user: User, opts: ScopeOptions = {}): ToolPolicy => ({
  hosted: IS_HOSTED,
  canAccessProject: (id) => ownsProject(user, id),
  listProjectIds: () => listUserProjectIds(user),
  onProjectCreated: (id) => recordProjectOwner(user, id),
  maxDownloadBytes: MAX_URL_DOWNLOAD_BYTES,
  ...(opts.links ? { projectLink: projectUrl } : {}),
  renderStatus: (projectId, jobId) => {
    if (jobId) {
      try {
        const j = getJobFor(user, jobId);
        return j.projectId === projectId ? statusOf(j) : null;
      } catch {
        return null;
      }
    }
    const latest = listJobs(user, projectId, 1)[0];
    return latest ? statusOf(latest) : null;
  },
  renderVideo: async (projectId, quality, ctx): Promise<RenderRecord | PendingRender> => {
    const job = enqueueRenderJob({ user, projectId, quality });
    const capped = opts.maxRenderWaitMs !== undefined;
    // Capped callers (remote MCP) detach on abort / timeout instead of canceling the render.
    const waitAc = new AbortController();
    const timer = capped ? setTimeout(() => waitAc.abort(), opts.maxRenderWaitMs) : null;
    const onCallerAbort = () => waitAc.abort();
    if (capped) ctx.signal?.addEventListener("abort", onCallerAbort, { once: true });
    let lastPct = -1;
    let lastStage = "";
    let latest: Job = job;
    try {
      const done = await Promise.race([
        waitForJob(job.id, {
          signal: capped ? undefined : ctx.signal,
          onUpdate: (j) => {
            latest = j;
            if (j.status === "queued") {
              const key = `queued:${j.position ?? ""}`;
              if (key === lastStage) return;
              lastStage = key;
              ctx.onProgress?.({ progress: 0, message: `Waiting in the render queue${j.position && j.position > 1 ? ` (#${j.position})` : ""}…` });
              return;
            }
            const pct = Math.floor(j.progress * 100);
            if (pct === lastPct && j.stage === lastStage) return;
            lastPct = pct;
            lastStage = j.stage ?? "";
            ctx.onProgress?.({ progress: j.progress, message: j.stage });
          },
        }),
        new Promise<null>((resolve) => waitAc.signal.addEventListener("abort", () => resolve(null), { once: true })),
      ]);
      if (!done || !isTerminal(done)) {
        const now = (() => {
          try {
            return getJobFor(user, job.id);
          } catch {
            return latest;
          }
        })();
        if (!isTerminal(now)) return { pending: true, jobId: now.id, status: now.status, progress: now.progress, ...(now.stage ? { stage: now.stage } : {}), ...(now.position ? { position: now.position } : {}) };
        return finishOf(now);
      }
      return finishOf(done);
    } finally {
      if (timer) clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onCallerAbort);
    }
  },
});

const finishOf = (done: Job): RenderRecord => {
  if (done.status === "canceled") throw Object.assign(new Error("Aborted"), { name: "AbortError" });
  const rec = recordOf(done);
  if (done.status !== "done" || !rec) throw new Error(done.error ?? "Render failed");
  return rec;
};
