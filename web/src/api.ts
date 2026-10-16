/** Typed client for docs/WEB_API.md. */

export type Format = "16:9" | "9:16" | "1:1" | "4:5" | "21:9";

export type ProjectCard = {
  id: string; name: string; format: Format; createdAt: string; updatedAt: string;
  hasSpec: boolean; thumbnail?: string; durationSeconds?: number;
};
export type AssetInfo = {
  path: string; kind: "image" | "video" | "audio" | "lottie" | "other"; sizeBytes: number;
  width?: number; height?: number; duration?: number; hasAudio?: boolean; palette?: string[];
};
export type Asset = AssetInfo & { url: string };
export type RenderInfo = {
  file: string; url: string; quality: "draft" | "final"; createdAt: string; sizeBytes: number;
  seconds?: number; width?: number; height?: number;
  /** output format (absent on renders made before formats existed) */
  format?: Format;
};
/** A starter film from the template gallery (GET /api/templates). */
export type TemplateMeta = {
  slug: string; title: string; niche: string; description: string; format: Format; formats: Format[];
  durationSeconds: number; tags: string[]; poster?: string;
};
export type TimelineScene = { index: number; id?: string; start: number; end: number; duration: number; overlapIn: number; transition?: string };
export type Timeline = { total: number; scenes: TimelineScene[]; actors?: { id: string; from: number; until: number }[] };
export type ValidationResult =
  | { ok: true; durationSeconds: number; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };
export type LogoSummary = {
  source?: string; parts?: number; subpaths?: number; strokeOnlyParts?: number;
  groups?: { icon?: number[]; wordmark?: number[] }; holes?: { partId: number | string; areaRatio: number }[];
  palette?: (string | { hex: string; weight?: number; role?: string })[]; kit?: Record<string, unknown>;
  secondaryBeat?: { mode: string; parts?: string; order?: string; why?: string };
  suggestedModes?: { mode: string; score?: number; order?: string; parts?: string; why?: string }[];
  warnings?: string[]; [k: string]: unknown;
};
export type ProjectState = {
  project: { id: string; name: string; format: Format; createdAt: string; updatedAt: string };
  spec: Record<string, unknown> | null;
  assets: Asset[];
  renders: RenderInfo[];
  timeline: Timeline | null;
  validation: ValidationResult | null;
};
export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; ok: boolean; summary: string; images?: string[] }
  | { type: "spec"; spec: Record<string, unknown>; timeline: Timeline }
  | { type: "render"; render: RenderInfo }
  | { type: "error"; message: string }
  | { type: "done" };
export type UiPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id?: string; name: string; summary: string; ok?: boolean; images?: string[] };
export type UiMessage = { id: string; role: "user" | "assistant"; createdAt: string; parts: UiPart[] };
export type Settings = {
  model: string; effort: string; hasApiKey: boolean;
  keySource: "env" | "profile" | "settings" | "none"; models: string[];
};

export type User = { id: string; email: string; name: string };
export type Me = { user: User | null; mode: "local" | "hosted"; publicUrl?: string; signup?: boolean };
export type ApiToken = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string | null };
export type NewToken = { token: string; id: string; name: string; prefix: string };
export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";
export type Job = {
  id: string; projectId: string; kind: "render" | "preview"; quality: "draft" | "final"; format?: Format; backend: "local" | "lambda";
  status: JobStatus; progress: number; stage?: string; position?: number; output?: RenderInfo; error?: string;
  createdAt: string; startedAt?: string; finishedAt?: string;
};
export type ConnectInfo = { mcpUrl: string; publicUrl: string; claudeCodeConfig: string; steps: string[] };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, signal, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)["content-type"] = "application/json"; }
  let res: Response;
  try { res = await fetch(url, init); } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the Motion Studio server — is `pnpm server` running?", 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event("ms:unauthorized"));
    const msg = (data as { error?: string } | null)?.error ?? (res.status === 502 || res.status === 504 ? "Server unavailable (proxy error)" : `HTTP ${res.status}`);
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

const P = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const base = (p: string) => p.split("/").pop() ?? p;

export const api = {
  projects: () => req<ProjectCard[]>("GET", "/api/projects"),
  createProject: (name: string, format?: Format, template?: string) => req<ProjectCard>("POST", "/api/projects", { name, format, ...(template ? { template } : {}) }),
  templates: () => req<TemplateMeta[]>("GET", "/api/templates"),
  template: (slug: string) => req<TemplateMeta & { spec: Record<string, unknown> }>("GET", `/api/templates/${encodeURIComponent(slug)}`),
  project: (id: string, signal?: AbortSignal) => req<ProjectState>("GET", P(id), undefined, signal),
  deleteProject: (id: string) => req<{ ok: true }>("DELETE", P(id)),
  saveSpec: (id: string, spec: unknown) => req<ValidationResult & { timeline?: Timeline }>("PUT", `${P(id)}/spec`, { spec }),
  validate: (id: string, spec: unknown, signal?: AbortSignal) => req<ValidationResult & { timeline?: Timeline }>("POST", `${P(id)}/validate`, { spec }, signal),
  deleteAsset: (id: string, assetPath: string) => req<{ ok: true }>("DELETE", `${P(id)}/assets/${encodeURIComponent(base(assetPath))}`),
  logo: (id: string, assetPath: string) => req<{ summary: LogoSummary; partMapUrl?: string }>("GET", `${P(id)}/logo/${encodeURIComponent(base(assetPath))}`),
  preview: (id: string, body: { times?: number[]; scale?: number; individual?: boolean } = {}) => req<{ sheetUrl: string | null; frames: { time: number; url: string; label: string }[] }>("POST", `${P(id)}/preview`, body),
  chat: (id: string) => req<{ messages: UiMessage[]; running: boolean }>("GET", `${P(id)}/chat`),
  stopChat: (id: string) => req<{ ok: true }>("POST", `${P(id)}/chat/stop`),
  clearChat: (id: string) => req<{ ok: true }>("DELETE", `${P(id)}/chat`),
  settings: () => req<Settings>("GET", "/api/settings"),
  me: () => req<Me>("GET", "/api/auth/me"),
  login: (email: string, password: string) => req<{ user: User }>("POST", "/api/auth/login", { email, password }),
  signup: (email: string, password: string, name: string) => req<{ user: User }>("POST", "/api/auth/signup", { email, password, name }),
  logout: () => req<{ ok: true }>("POST", "/api/auth/logout"),
  tokens: () => req<ApiToken[]>("GET", "/api/tokens"),
  createToken: (name: string) => req<NewToken>("POST", "/api/tokens", { name }),
  deleteToken: (tid: string) => req<{ ok: true }>("DELETE", `/api/tokens/${encodeURIComponent(tid)}`),
  jobs: (projectId?: string) => req<Job[]>("GET", `/api/jobs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  job: (jid: string) => req<Job>("GET", `/api/jobs/${encodeURIComponent(jid)}`),
  cancelJob: (jid: string) => req<Job>("POST", `/api/jobs/${encodeURIComponent(jid)}/cancel`),
  render: (id: string, quality: "draft" | "final", format?: Format) => req<{ job: Job }>("POST", `${P(id)}/render`, { quality, ...(format ? { format } : {}) }),
  /** Batch export: one job per adapt target (master + spec.formats). */
  renderAll: (id: string, quality: "draft" | "final") => req<{ jobs: Job[]; formats: Format[] }>("POST", `${P(id)}/render-all`, { quality }),
  connect: () => req<ConnectInfo>("GET", "/api/connect"),
  /** Session + Origin authenticated (no Authorization header). 401 → caller sends the user to /login?next=. */
  oauthDecision: async (params: Record<string, string>, approve: boolean): Promise<{ redirect: string }> => {
    let res: Response;
    try {
      res = await fetch("/oauth/authorize/decision", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...params, approve }) });
    } catch { throw new ApiError("Can't reach the Motion Studio server", 0); }
    const data = await res.json().catch(() => null) as { redirect?: string; error?: string; error_description?: string } | null;
    if (!res.ok || !data?.redirect) throw new ApiError(data?.error_description ?? data?.error ?? `HTTP ${res.status}`, res.status);
    return { redirect: data.redirect };
  },
  saveSettings: (s: { model?: string; effort?: string; apiKey?: string }) => req<Settings>("PUT", "/api/settings", s),
};

/** Multipart upload with progress (XHR — fetch has no upload progress). */
export const uploadAsset = (id: string, file: File, onProgress?: (p: number) => void) =>
  new Promise<AssetInfo & { url?: string; logo?: LogoSummary; logoError?: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${P(id)}/assets`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } | null = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as AssetInfo);
      else reject(new ApiError(data?.error ?? `Upload failed (HTTP ${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Upload failed — server unreachable", 0));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });

/**
 * POST and read a Server-Sent-Events response body (EventSource can't POST).
 * Calls onEvent(eventName, parsedData) per event; resolves when the stream ends.
 */
export async function postSSE(url: string, body: unknown, onEvent: (event: string, data: any) => void, signal?: AbortSignal): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the Motion Studio server", 0);
  }
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* */ }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length) return;
    const raw = data.join("\n");
    let parsed: unknown = raw;
    try { parsed = JSON.parse(raw); } catch { /* plain text */ }
    onEvent(event, parsed);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let m: RegExpExecArray | null;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      flush(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
    }
  }
  buf += dec.decode();
  if (buf.trim()) flush(buf);
}

/**
 * Follow a job's SSE stream (GET /api/jobs/:id/events). The server sends the current state first, then
 * `progress {progress, stage}` until `done {job}` / `error {job}`. Returns a close() function.
 */
export function followJob(jid: string, h: { onProgress?: (p: { progress: number; stage?: string; position?: number; status?: JobStatus }) => void; onDone?: (job: Job) => void; onError?: (job: Job | null, message: string) => void }) {
  const es = new EventSource(`/api/jobs/${encodeURIComponent(jid)}/events`);
  let closed = false;
  const close = () => { closed = true; es.close(); };
  const parse = (e: MessageEvent) => { try { return JSON.parse(e.data); } catch { return null; } };
  es.addEventListener("progress", (e) => { const d = parse(e as MessageEvent); if (d) h.onProgress?.(d); });
  es.addEventListener("state", (e) => { const d = parse(e as MessageEvent); if (d) h.onProgress?.(d.job ?? d); });
  es.addEventListener("done", (e) => { const d = parse(e as MessageEvent); close(); h.onDone?.(d?.job ?? d); });
  es.addEventListener("error", (e) => {
    const d = "data" in e ? parse(e as MessageEvent) : null;
    if (d) { close(); h.onError?.(d.job ?? d, d.job?.error ?? d.error ?? "Render failed"); return; }
    // transport error: EventSource retries by itself; give up only when the server closed for good
    if (!closed && es.readyState === EventSource.CLOSED) { close(); h.onError?.(null, "Lost connection to the render queue"); }
  });
  return close;
}

export const chatUrl = (id: string) => `${P(id)}/chat`;
export const renderUrl = (id: string) => `${P(id)}/render`;
/** Public base URL of a template's files (poster, assets, glyphs) — the Player's assetBase for template thumbnails. */
export const templateBase = (slug: string) => `${location.origin}/templates/${encodeURIComponent(slug)}`;
