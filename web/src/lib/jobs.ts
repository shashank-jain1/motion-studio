import { useCallback, useEffect, useRef, useState } from "react";
import { api, followJob, type Job, type RenderInfo } from "../api";

const active = (j: Job) => j.status === "queued" || j.status === "running";

/**
 * Render-queue state: GET /api/jobs (optionally per project), live updates over GET /api/jobs/:id/events for every
 * queued/running job, plus a slow poll so jobs started elsewhere (the director, MCP) show up.
 */
export const useJobs = (projectId?: string, opts: { onDone?: (job: Job, out: RenderInfo) => void; onError?: (job: Job | null, msg: string) => void } = {}) => {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streams = useRef(new Map<string, () => void>());
  const cb = useRef(opts);
  cb.current = opts;

  const upsert = useCallback((j: Partial<Job> & { id: string }) => {
    setJobs((list) => {
      const cur = list ?? [];
      const i = cur.findIndex((x) => x.id === j.id);
      if (i < 0) return "projectId" in j ? [j as Job, ...cur] : cur;
      const next = [...cur];
      next[i] = { ...next[i], ...j };
      return next;
    });
  }, []);

  const follow = useCallback((j: Job) => {
    if (streams.current.has(j.id) || !active(j)) return;
    const close = followJob(j.id, {
      onProgress: (p) => upsert({ id: j.id, progress: p.progress ?? 0, stage: p.stage, position: p.position, ...(p.status ? { status: p.status } : {}) }),
      onDone: (job) => {
        streams.current.delete(j.id);
        if (job) { upsert(job); if (job.output) cb.current.onDone?.(job, job.output); }
      },
      onError: (job, msg) => {
        streams.current.delete(j.id);
        if (job) upsert(job);
        else upsert({ id: j.id, status: "error", error: msg });
        if (job?.status !== "canceled") cb.current.onError?.(job, msg);
      },
    });
    streams.current.set(j.id, close);
  }, [upsert]);

  const load = useCallback(async () => {
    try {
      const list = await api.jobs(projectId);
      setJobs((prev) => {
        // keep live-updated fields for jobs we're streaming
        const byId = new Map((prev ?? []).map((j) => [j.id, j]));
        return list.map((j) => (streams.current.has(j.id) && byId.get(j.id) ? { ...j, ...byId.get(j.id)! } : j));
      });
      setError(null);
      list.forEach(follow);
    } catch (e) {
      const st = (e as { status?: number }).status;
      setError(st === 404 ? "The render queue isn't available on this server yet." : (e as Error).message);
      setJobs((j) => j ?? []);
    }
  }, [projectId, follow]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 6000);
    const s = streams.current;
    return () => { clearInterval(t); s.forEach((c) => c()); s.clear(); };
  }, [load]);

  const start = useCallback(async (id: string, quality: "draft" | "final") => {
    const { job } = await api.render(id, quality);
    upsert(job);
    follow(job);
    return job;
  }, [upsert, follow]);

  /** Export all formats: one job per adapt target, each followed live. */
  const startAll = useCallback(async (id: string, quality: "draft" | "final") => {
    const { jobs: js } = await api.renderAll(id, quality);
    for (const j of [...js].reverse()) upsert(j);
    js.forEach(follow);
    return js;
  }, [upsert, follow]);

  const cancel = useCallback(async (jid: string) => {
    const j = await api.cancelJob(jid);
    upsert(j);
    streams.current.get(jid)?.();
    streams.current.delete(jid);
    return j;
  }, [upsert]);

  return { jobs, error, start, startAll, cancel, reload: load };
};

export const isActive = active;
