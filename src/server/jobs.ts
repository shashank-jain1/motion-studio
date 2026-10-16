/**
 * Persistent render-job queue (SQLite `jobs`). Jobs survive restarts: queued jobs resume on boot, jobs that were running
 * when the server died are marked `error: "server restarted"`. Each backend runs `backend.concurrency` jobs at once
 * (local: 1, and the local backend additionally holds the machine-wide render lock from src/core/tools.ts).
 * Cancel: queued → canceled at once; running → AbortSignal into the backend (renderVideo's cancelSignal / Lambda cancel).
 */
import { HTTPException } from "hono/http-exception";
import { loadSpec, readSpec } from "../core/projects";
import { assertSpecSafe } from "../core/tools";
import type { Spec } from "../engine/spec/schema";
import type { Format } from "../engine/spec/reflow";
import { IS_HOSTED, type BackendName } from "./config";
import { db, newId, nowIso } from "./db";
import type { User } from "./auth";
import { BACKENDS, backendError, defaultBackend, type RenderInfo, type RenderOutput } from "./render";

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";
export type Job = {
  id: string;
  projectId: string;
  kind: "render" | "preview";
  quality: "draft" | "final";
  /** output format when reflowed (absent = the spec's master format) */
  format?: Format;
  backend: BackendName;
  status: JobStatus;
  progress: number;
  stage?: string;
  /** 1-based place in its backend's queue (queued jobs only). */
  position?: number;
  output?: RenderOutput;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type JobEvent = { type: "progress"; progress: number; stage?: string; job: Job } | { type: "done"; job: Job } | { type: "error"; job: Job };

type Row = {
  id: string;
  user_id: string;
  project_id: string;
  kind: string;
  quality: string;
  format: string | null;
  backend: string;
  status: string;
  progress: number;
  stage: string | null;
  output: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const TERMINAL = new Set<JobStatus>(["done", "error", "canceled"]);
export const isTerminal = (j: Pick<Job, "status">) => TERMINAL.has(j.status);

const getRow = (id: string) => db.prepare("SELECT rowid AS _rowid, * FROM jobs WHERE id = ?").get(id) as (Row & { _rowid: number }) | undefined;

const queuePosition = (r: Row & { _rowid: number }): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND backend = ? AND rowid <= ?").get(r.backend, r._rowid) as { n: number }).n;

const toJob = (r: Row & { _rowid?: number }): Job => {
  const j: Job = {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind as Job["kind"],
    quality: r.quality as Job["quality"],
    backend: r.backend as BackendName,
    status: r.status as JobStatus,
    progress: r.progress,
    createdAt: r.created_at,
  };
  if (r.format) j.format = r.format as Format;
  if (r.stage) j.stage = r.stage;
  if (r.status === "queued" && r._rowid !== undefined) j.position = queuePosition(r as Row & { _rowid: number });
  if (r.output) {
    try {
      j.output = JSON.parse(r.output) as RenderOutput;
    } catch {
      /* ignore */
    }
  }
  if (r.error) j.error = r.error;
  if (r.started_at) j.startedAt = r.started_at;
  if (r.finished_at) j.finishedAt = r.finished_at;
  return j;
};

export const getJob = (id: string): Job | null => {
  const r = getRow(id);
  return r ? toJob(r) : null;
};

/** The job if `user` owns it, else 404. */
export const getJobFor = (user: User, id: string): Job => {
  const r = getRow(id);
  if (!r || r.user_id !== user.id) throw new HTTPException(404, { message: `Job "${id}" not found` });
  return toJob(r);
};

export const listJobs = (user: User, projectId?: string, limit = 100): Job[] => {
  const rows = (
    projectId
      ? db.prepare("SELECT rowid AS _rowid, * FROM jobs WHERE user_id = ? AND project_id = ? ORDER BY rowid DESC LIMIT ?").all(user.id, projectId, limit)
      : db.prepare("SELECT rowid AS _rowid, * FROM jobs WHERE user_id = ? ORDER BY rowid DESC LIMIT ?").all(user.id, limit)
  ) as (Row & { _rowid: number })[];
  return rows.map(toJob);
};

// ---------------------------------------------------------------- events

const listeners = new Map<string, Set<(e: JobEvent) => void>>();

export const subscribe = (id: string, fn: (e: JobEvent) => void): (() => void) => {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(id);
  };
};

const emit = (job: Job) => {
  const set = listeners.get(job.id);
  if (!set?.size) return;
  const ev: JobEvent =
    job.status === "done" ? { type: "done", job } : job.status === "error" || job.status === "canceled" ? { type: "error", job } : { type: "progress", progress: job.progress, stage: job.stage, job };
  for (const fn of [...set]) {
    try {
      fn(ev);
    } catch {
      /* listener gone */
    }
  }
};

const emitId = (id: string) => {
  const j = getJob(id);
  if (j) emit(j);
};

/** Queue positions shift whenever a job leaves the queue: tell everyone still waiting. */
const emitQueued = (backend: string) => {
  const rows = db.prepare("SELECT id FROM jobs WHERE status = 'queued' AND backend = ?").all(backend) as { id: string }[];
  for (const r of rows) if (listeners.has(r.id)) emitId(r.id);
};

// ---------------------------------------------------------------- queue

const running = new Map<string, AbortController>();
const active: Record<string, number> = {};
let booted = false;

/** Boot: running jobs from a previous process are dead; queued ones resume. Idempotent. */
export const initJobs = (): void => {
  if (booted) return;
  booted = true;
  const n = db
    .prepare("UPDATE jobs SET status = 'error', error = 'server restarted', stage = NULL, finished_at = ? WHERE status = 'running'")
    .run(nowIso()).changes;
  if (n) console.error(`[motion-studio] marked ${n} interrupted job(s) as failed (server restarted)`);
  setImmediate(kick);
};

export const enqueueRenderJob = (input: { user: User; projectId: string; quality: "draft" | "final"; format?: Format; backend?: BackendName }): Job => {
  const backend = input.backend ?? defaultBackend();
  const err = backendError(backend);
  if (err) throw new HTTPException(503, { message: err });
  const id = newId(9);
  db.prepare(
    "INSERT INTO jobs (id, user_id, project_id, kind, quality, format, backend, status, progress, stage, created_at) VALUES (?, ?, ?, 'render', ?, ?, ?, 'queued', 0, 'queued', ?)",
  ).run(id, input.user.id, input.projectId, input.quality, input.format ?? null, backend, nowIso());
  setImmediate(kick);
  return getJob(id)!;
};

const finish = (id: string, patch: { status: JobStatus; output?: RenderOutput; error?: string }) => {
  db.prepare("UPDATE jobs SET status = ?, output = ?, error = ?, progress = CASE WHEN ? = 'done' THEN 1 ELSE progress END, stage = NULL, finished_at = ? WHERE id = ?").run(
    patch.status,
    patch.output ? JSON.stringify(patch.output) : null,
    patch.error ?? null,
    patch.status,
    nowIso(),
    id,
  );
  emitId(id);
};

export const cancelJob = (id: string): Job | null => {
  const r = getRow(id);
  if (!r) return null;
  if (r.status === "queued") {
    finish(id, { status: "canceled", error: "Canceled" });
    emitQueued(r.backend);
  } else if (r.status === "running") {
    running.get(id)?.abort();
  }
  return getJob(id);
};

/** Cancel every unfinished job of a project (project deleted). */
export const cancelProjectJobs = (projectId: string) => {
  const rows = db.prepare("SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued', 'running')").all(projectId) as { id: string }[];
  for (const r of rows) cancelJob(r.id);
};

function kick(): void {
  for (const [name, backend] of Object.entries(BACKENDS)) {
    while ((active[name] ?? 0) < backend.concurrency) {
      const next = db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND backend = ? ORDER BY rowid ASC LIMIT 1").get(name) as Row | undefined;
      if (!next) break;
      start(next);
    }
  }
}

function start(r: Row): void {
  const backend = BACKENDS[r.backend as BackendName];
  const ac = new AbortController();
  running.set(r.id, ac);
  active[r.backend] = (active[r.backend] ?? 0) + 1;
  db.prepare("UPDATE jobs SET status = 'running', stage = 'starting', progress = 0, started_at = ? WHERE id = ?").run(nowIso(), r.id);
  emitId(r.id);
  emitQueued(r.backend);

  let lastWrite = 0;
  let lastPct = -1;
  let lastStage = "";
  const onProgress = (p: { progress: number; stage: string }) => {
    if (ac.signal.aborted) return;
    const pct = Math.floor(Math.max(0, Math.min(1, p.progress)) * 100);
    const now = Date.now();
    if (p.stage === lastStage && (pct === lastPct || now - lastWrite < 400)) return;
    lastPct = pct;
    lastStage = p.stage;
    lastWrite = now;
    db.prepare("UPDATE jobs SET progress = ?, stage = ? WHERE id = ? AND status = 'running'").run(Math.max(0, Math.min(1, p.progress)), p.stage, r.id);
    emitId(r.id);
  };

  (async () => {
    if (!backend) throw new Error(`Unknown render backend "${r.backend}"`);
    const err = backendError(r.backend as BackendName);
    if (err) throw new Error(err);
    let spec: Spec;
    try {
      spec = loadSpec(r.project_id);
    } catch (e) {
      throw new Error((e as Error).message);
    }
    if (IS_HOSTED) await assertSpecSafe(readSpec(r.project_id));
    return backend.render({ id: r.id, projectId: r.project_id, quality: r.quality as "draft" | "final", ...(r.format ? { format: r.format as Format } : {}) }, spec, onProgress, ac.signal);
  })()
    .then((output) => finish(r.id, { status: "done", output }))
    .catch((e: unknown) => {
      const aborted = ac.signal.aborted || (e as Error)?.name === "AbortError";
      if (!aborted) console.error(`[motion-studio] job ${r.id} (${r.project_id}) failed: ${e instanceof Error ? e.stack : String(e)}`);
      finish(r.id, aborted ? { status: "canceled", error: "Canceled" } : { status: "error", error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      running.delete(r.id);
      active[r.backend] = Math.max(0, (active[r.backend] ?? 1) - 1);
      setImmediate(kick);
    });
}

/**
 * Wait for a job to finish (for the chat agent / remote MCP render_video). Resolves with the terminal job.
 * Aborting `signal` cancels the job.
 */
export const waitForJob = (id: string, opts: { signal?: AbortSignal; onUpdate?: (job: Job) => void } = {}): Promise<Job> =>
  new Promise((resolve, reject) => {
    const first = getJob(id);
    if (!first) return reject(new Error(`Job "${id}" not found`));
    if (isTerminal(first)) return resolve(first);
    const onAbort = () => cancelJob(id);
    const unsub = subscribe(id, (e) => {
      if (e.type === "progress") opts.onUpdate?.(e.job);
      else {
        unsub();
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(e.job);
      }
    });
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
    opts.onUpdate?.(first);
  });

export type { RenderInfo };
