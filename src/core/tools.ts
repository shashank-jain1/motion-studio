/**
 * Transport-neutral tool layer: every tool the AI director can call, used by
 *   - the MCP server (src/mcp/server.ts) — all tools, projectId passed explicitly;
 *   - the in-app agent (src/server/agent.ts) — bound to ONE project via ctx.projectId: the `projectId` input is removed
 *     from the schemas and injected, and project-management tools (scope "unbound") are hidden.
 *
 * A handler returns MCP-shaped content (text / base64 image) plus optional `summary` (one human line for UIs) and
 * `events` (side effects: spec saved, preview rendered, render done, asset added) so transports can react.
 *
 * Also hosts helpers shared with the HTTP server: the machine-wide render lock, the timeline (+ actor spans),
 * preview runs with labels, and render records (renders/<file>.mp4.json sidecars).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod/v4";
import { FORMATS, type SpecInput } from "../engine/spec/schema";
import { STYLES, DEFAULT_STYLE } from "../engine/spec/styles";
import { preprocessSpec, sceneIndexOf } from "../engine/spec/preprocess";
import { DOCS_DIR, PROJECTS_DIR } from "./paths";
import { FONT_NAMES } from "./fontNames";
import {
  addAsset,
  computeTimeline,
  createProject,
  getAssetInfo,
  getProject,
  listAssets,
  listProjects,
  loadSpec,
  readSpec,
  updateScene,
  writeSpec,
  type ValidationResult,
} from "./projects";
import { thumbnail, type AssetInfo } from "./probe";
import { ensureLogoAnalysis, logoJsonPath, logoSummary, renderLogoPreviewPng, LOGO_ORDERS, type LogoBrief } from "./logo";
import { analyzeAudio } from "./audio";
import { renderFrames, renderVideo, type PreviewResult, type RenderQuality, type RenderVideoResult } from "./render";
import { listCustomComponents, readCustomComponent, writeCustomComponent } from "./custom";
import { resolvePublic, safeDownload } from "./safe-download";

// ---------------------------------------------------------------- types

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export type Timeline = {
  total: number;
  scenes: { index: number; id?: string; start: number; end: number; duration: number; overlapIn: number; transition?: string }[];
  actors?: { id: string; from: number; until: number }[];
};

export type RenderRecord = {
  /** project-relative, e.g. "renders/2026-01-01_10-00-00-draft.mp4" */
  file: string;
  quality: RenderQuality;
  createdAt: string;
  sizeBytes: number;
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  renderSeconds?: number;
};

export type PreviewFrameInfo = { time: number; frame: number; path: string; label: string };
export type PreviewRun = {
  frames: PreviewFrameInfo[];
  /** absolute path of the contact sheet (null when individual) */
  sheet: string | null;
  columns: number;
  rows: number;
  width: number;
  height: number;
  durationSeconds: number;
  seconds: number;
};

export type ToolEvent =
  | { type: "spec"; projectId: string; spec: SpecInput; timeline: Timeline; validation: ValidationResult }
  | { type: "preview"; projectId: string; preview: PreviewRun }
  | { type: "render"; projectId: string; render: RenderRecord }
  | { type: "asset"; projectId: string; asset: Omit<AssetInfo, "file"> };

export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
  /** One short human line for UIs, e.g. "Saved spec · 5 scenes · 14.2s · 2 warnings". */
  summary?: string;
  events?: ToolEvent[];
};

export type ToolProgress = { progress: number; message?: string };

export type ToolContext = {
  /** Bind every tool to this project: `projectId` disappears from input schemas and is injected. */
  projectId?: string;
  signal?: AbortSignal;
  /** Long tools (render_video, preview_frames) report progress here (progress 0..1). */
  onProgress?: (p: ToolProgress) => void;
  /** User / mode scoping (web server, remote MCP). Absent = trusted local caller (MCP stdio, CLI): everything allowed. */
  policy?: ToolPolicy;
};

/**
 * Scoping hooks injected by multi-user transports (src/server/scope.ts → toolPolicyFor(user)).
 * - hosted: local-path add_asset and write_custom_component / open_studio_hint are removed, URL downloads are SSRF-safe,
 *   specs may not reference "../" paths or private hosts, results don't reveal server paths.
 * - canAccessProject: every project-scoped call is checked (false → "Project not found", no existence leak).
 * - listProjectIds / onProjectCreated: list_projects shows only these; create_project records ownership.
 * - renderVideo: render_video goes through this (the job queue) instead of rendering in-process.
 * - projectLink: appended to results of project tools ("Open in Motion Studio: <url>").
 */
export type ToolPolicy = {
  hosted?: boolean;
  canAccessProject?: (projectId: string) => boolean;
  listProjectIds?: () => Iterable<string>;
  onProjectCreated?: (projectId: string) => void;
  renderVideo?: (projectId: string, quality: RenderQuality, ctx: ToolContext) => Promise<RenderRecord | PendingRender>;
  /** render_status: a job of this project (latest when jobId is omitted), null if none. */
  renderStatus?: (projectId: string, jobId?: string) => RenderJobStatus | null;
  projectLink?: (projectId: string) => string | null | undefined;
  /** Max bytes for add_asset URL downloads in hosted mode (default 200 MB). */
  maxDownloadBytes?: number;
};

/** render_video returned before the job finished (remote MCP waits ~45s at most); poll with render_status. */
export type PendingRender = { pending: true; jobId: string; status: string; progress: number; stage?: string; position?: number };
export type RenderJobStatus = {
  jobId: string;
  status: "queued" | "running" | "done" | "error" | "canceled";
  quality: RenderQuality;
  progress: number;
  stage?: string;
  position?: number;
  error?: string;
  render?: RenderRecord;
  createdAt: string;
  finishedAt?: string;
};

const isHosted = (ctx: Pick<ToolContext, "policy">) => !!ctx.policy?.hosted;

type Shape = Record<string, z.ZodType>;

/**
 * - "project": acts on a project (takes `projectId`, injected when bound)
 * - "global": no project (styles, guide, custom components)
 * - "unbound": project management / IDE hints — hidden when the context is bound to a project
 */
export type ToolScope = "project" | "global" | "unbound";

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  scope: ToolScope;
  /** Hosted mode: "hidden" removes the tool; an object removes input fields and swaps the description. */
  hosted?: "hidden" | { omit: string[]; description: string };
  /** Full input shape (including projectId for project tools) — what MCP registers. */
  shape: Shape;
  /** Human line for a tool call about to run, e.g. "Writing spec · 5 scenes". */
  startSummary: (input: Record<string, unknown>) => string;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

const defineTool = <S extends Shape>(def: {
  name: string;
  title: string;
  description: string;
  scope: ToolScope;
  hosted?: ToolDef["hosted"];
  shape: S;
  startSummary?: (input: z.infer<z.ZodObject<S>>) => string;
  handler: (input: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolResult>;
}): ToolDef => ({
  name: def.name,
  title: def.title,
  description: def.description,
  scope: def.scope,
  ...(def.hosted ? { hosted: def.hosted } : {}),
  shape: def.shape,
  startSummary: (def.startSummary ?? (() => def.title)) as ToolDef["startSummary"],
  handler: def.handler as ToolDef["handler"],
});

// ---------------------------------------------------------------- content helpers

const text = (t: string): ToolContent => ({ type: "text", text: t });
const json = (v: unknown): ToolContent => text(JSON.stringify(v, null, 2));
const image = (buf: Buffer, mimeType = "image/jpeg"): ToolContent => ({ type: "image", data: buf.toString("base64"), mimeType });

/** "projectId, " in hints for unbound callers; nothing when the tool layer injects it. */
const pidArg = (ctx: ToolContext) => (ctx.projectId ? "" : "projectId, ");

/** Some clients send nested objects as JSON strings; accept both. */
const parseMaybeJson = (v: unknown, what: string): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    throw new Error(`${what} is a string but not valid JSON: ${(e as Error).message}`);
  }
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtSecs = (s: number) => `${Math.round(s * 10) / 10}s`;
const stripAssets = (s: string) => s.replace(/^\.?\/?assets\//, "");

export const formatValidation = (res: ValidationResult): string => {
  if (!res.ok) {
    return ["INVALID — spec was NOT saved. Fix these and call again:", ...res.errors.map((e) => `  • ${e}`)].join("\n");
  }
  return [
    `OK — spec ${res.written ? "saved" : "is valid"}. Total duration: ${res.durationSeconds.toFixed(2)}s.`,
    res.warnings.length ? `Warnings (${res.warnings.length}):\n${res.warnings.map((w) => `  • ${w}`).join("\n")}` : "No warnings.",
    res.written ? "Next: preview_frames to look at it." : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const readDoc = (name: string): string => {
  const file = path.join(DOCS_DIR, name);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return `(${name} not found at ${file})`;
  }
};

// ---------------------------------------------------------------- timeline

/** Scene timeline of a raw spec (beat strings resolved) with transition names and actor spans. Throws on unusable input. */
export const specTimeline = (raw: SpecInput): Timeline => {
  const tl = computeTimeline(raw);
  const scenes = tl.scenes.map((s) => {
    const tr = raw.scenes[s.index]?.transition as { type?: string } | undefined;
    return { ...s, ...(tr?.type ? { transition: tr.type } : {}) };
  });
  const out: Timeline = { total: tl.total, scenes };
  const pre = preprocessSpec(raw) as { scenes?: { id?: string }[]; actors?: { id: string; from?: unknown; until?: unknown; poses?: { scene: unknown; t?: number }[] }[] };
  if (Array.isArray(pre.actors) && pre.actors.length && Array.isArray(pre.scenes)) {
    const sc = pre.scenes;
    out.actors = [];
    for (const a of pre.actors) {
      const poseTimes = (a.poses ?? [])
        .map((p) => {
          const si = sceneIndexOf(sc, p.scene);
          return si < 0 ? null : { si, g: tl.scenes[si].start + (typeof p.t === "number" ? p.t : 0) };
        })
        .filter((x): x is { si: number; g: number } => !!x);
      if (!poseTimes.length) continue;
      const fromIdx = a.from !== undefined ? sceneIndexOf(sc, a.from) : -1;
      const firstPose = poseTimes.reduce((m, p) => (p.g < m.g ? p : m));
      const from = fromIdx >= 0 ? tl.scenes[fromIdx].start : Math.min(firstPose.g, tl.scenes[firstPose.si].start);
      const untilIdx = a.until !== undefined ? sceneIndexOf(sc, a.until) : -1;
      const until = Math.max(from + 0.05, untilIdx >= 0 ? tl.scenes[untilIdx].end : tl.total);
      out.actors.push({ id: String(a.id), from: round3(from), until: round3(until) });
    }
  }
  return out;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const specSummary = (spec: SpecInput | null) => {
  if (!spec) return null;
  const tl = computeTimeline(spec);
  return {
    title: spec.title,
    format: spec.format,
    size: spec.width && spec.height ? `${spec.width}x${spec.height}` : undefined,
    fps: spec.fps ?? 30,
    style: spec.style,
    audio: spec.audio?.src,
    totalSeconds: tl.total,
    scenes: spec.scenes.map((s, i) => ({
      index: i,
      id: s.id,
      start: Math.round(tl.scenes[i].start * 100) / 100,
      duration: s.duration,
      transition: s.transition?.type,
      layers: (s.layers ?? []).map((l) => l.type + (l.id ? `#${l.id}` : "")).join(", "),
      notes: s.notes,
    })),
  };
};

// ---------------------------------------------------------------- hosted spec safety

const TRAVERSAL_RE = /(^|[\\/])\.\.([\\/]|$)/;
const URL_IN_TEXT_RE = /\b(?:https?:)?\/\/[^\s"'()<>\\]+/gi;

/**
 * Hosted mode: a spec may not reach outside its project ("../other-project/assets/x.png" would be served by the render
 * asset server) nor make the headless browser fetch private / loopback hosts. Throws with every offending value.
 */
export const assertSpecSafe = async (spec: unknown): Promise<void> => {
  const bad: string[] = [];
  const hosts = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 64) return;
    if (typeof v === "string") {
      if (TRAVERSAL_RE.test(v)) bad.push(`"${v.slice(0, 80)}": paths may not contain ".." (assets must be inside the project)`);
      for (const m of v.matchAll(URL_IN_TEXT_RE)) {
        try {
          hosts.add(new URL(m[0].startsWith("//") ? `https:${m[0]}` : m[0]).hostname);
        } catch {
          /* not a URL */
        }
      }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(spec, 0);
  if (hosts.size > 40) bad.push(`too many distinct external hosts (${hosts.size}); upload the assets instead`);
  else {
    for (const h of hosts) {
      try {
        await resolvePublic(h);
      } catch (e) {
        bad.push((e as Error).message);
      }
    }
  }
  if (bad.length) throw new Error(`The spec references resources this server will not load:\n${bad.slice(0, 12).map((b) => `  • ${b}`).join("\n")}`);
};

// ---------------------------------------------------------------- render lock

/**
 * Renders and previews are serialized machine-wide (RAM is the bottleneck): an in-process queue plus, where the
 * `flock` binary exists, an exclusive lock on MOTION_STUDIO_RENDER_LOCK (default <tmpdir>/ms-render.lock) so the MCP
 * server, the web server and CLI scripts never render at the same time. The lock is held by a `flock … cat` child
 * whose stdin we keep open; closing it (or our process dying) releases the lock.
 */
export const RENDER_LOCK_FILE = process.env.MOTION_STUDIO_RENDER_LOCK || path.join(os.tmpdir(), "ms-render.lock");

let queueTail: Promise<void> = Promise.resolve();
let flockAvailable: boolean | undefined;

const hasFlock = (): boolean => {
  if (flockAvailable !== undefined) return flockAvailable;
  flockAvailable = (process.env.PATH ?? "").split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, "flock")));
  return flockAvailable;
};

const abortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });

const acquireFileLock = (signal?: AbortSignal): Promise<() => void> =>
  new Promise((resolve, reject) => {
    if (!hasFlock()) return resolve(() => undefined);
    if (signal?.aborted) return reject(abortError());
    const child = spawn("flock", ["-x", RENDER_LOCK_FILE, "sh", "-c", "echo locked; exec cat >/dev/null"], { stdio: ["pipe", "pipe", "ignore"] });
    let acquired = false;
    const onAbort = () => {
      if (!acquired) child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => {
      if (acquired || !d.toString().includes("locked")) return;
      acquired = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(() => {
        child.stdin.end();
        setTimeout(() => child.kill("SIGTERM"), 2000).unref();
      });
    });
    child.on("error", () => {
      // flock vanished: fall back to the in-process queue only
      if (!acquired) resolve(() => undefined);
    });
    child.on("exit", () => {
      signal?.removeEventListener("abort", onAbort);
      if (!acquired) (signal?.aborted ? reject(abortError()) : resolve(() => undefined));
    });
    child.stdin.on("error", () => undefined);
  });

/** Run `fn` while holding the render lock. `onWait` fires if we have to queue behind another render. */
export const withRenderLock = async <T>(fn: () => Promise<T>, opts: { signal?: AbortSignal; onWait?: () => void } = {}): Promise<T> => {
  const prev = queueTail;
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  // The next caller waits for BOTH prev and us, so bailing out early (abort) never lets it overtake prev.
  queueTail = prev.then(() => mine);
  // Only report waiting when the lock is not free almost immediately.
  const timer = setTimeout(() => opts.onWait?.(), 300);
  try {
    if (opts.signal) {
      const sig = opts.signal;
      await new Promise<void>((resolve, reject) => {
        if (sig.aborted) return reject(abortError());
        const onAbort = () => reject(abortError());
        sig.addEventListener("abort", onAbort, { once: true });
        prev.then(() => {
          sig.removeEventListener("abort", onAbort);
          resolve();
        });
      });
    } else await prev;
    const unlockFile = await acquireFileLock(opts.signal);
    clearTimeout(timer);
    try {
      if (opts.signal?.aborted) throw abortError();
      return await fn();
    } finally {
      unlockFile();
    }
  } finally {
    clearTimeout(timer);
    release();
  }
};

// ---------------------------------------------------------------- previews

/** Default preview times: settled moments after each scene's entrance, plus late-in-scene moments and mid-transitions. */
export const autoPreviewTimes = (projectId: string): { times: number[]; labels: Map<number, string> } => {
  const spec = loadSpec(projectId);
  const tl = computeTimeline(spec);
  const fps = spec.fps;
  const end = Math.max(0, tl.total - 1 / fps);
  const pts: { t: number; label: string }[] = [];
  const sceneName = (i: number) => `scene ${i}${spec.scenes[i].id ? ` "${spec.scenes[i].id}"` : ""}`;
  if (tl.scenes.length === 1) {
    for (const f of [0.08, 0.25, 0.42, 0.6, 0.78, 0.95]) pts.push({ t: tl.total * f, label: `${sceneName(0)} @${Math.round(f * 100)}%` });
  } else if (tl.scenes.length <= 4) {
    for (const s of tl.scenes) {
      const settled = s.start + s.overlapIn + Math.min(0.8, (s.duration - s.overlapIn) * 0.3);
      pts.push({ t: settled, label: `${sceneName(s.index)} early` });
      pts.push({ t: s.start + s.duration * 0.75, label: `${sceneName(s.index)} late` });
    }
  } else {
    let list = tl.scenes;
    if (list.length > 9) list = Array.from({ length: 9 }, (_, i) => tl.scenes[Math.round((i * (tl.scenes.length - 1)) / 8)]);
    for (const s of list) pts.push({ t: s.start + s.overlapIn + (s.duration - s.overlapIn) * 0.5, label: `${sceneName(s.index)} mid` });
  }
  // In-betweens are where craft shows: sample the middle of every transition (up to 6).
  const trans = tl.scenes.filter((s) => s.index > 0 && s.overlapIn > 0).slice(0, 6);
  for (const s of trans) pts.push({ t: s.start + s.overlapIn * 0.5, label: `transition into ${sceneName(s.index)} @50%` });
  pts.sort((a, b) => a.t - b.t);
  const labels = new Map<number, string>();
  const times: number[] = [];
  for (const p of pts) {
    const t = Math.round(Math.max(0, Math.min(end, p.t)) * 100) / 100;
    if (!labels.has(t)) {
      labels.set(t, p.label);
      times.push(t);
    }
  }
  return { times, labels };
};

const sceneAt = (projectId: string, t: number): string => {
  try {
    const spec = loadSpec(projectId);
    const tl = computeTimeline(spec);
    const hits = tl.scenes.filter((s) => t >= s.start - 1e-6 && t < s.end - 1e-6);
    if (!hits.length) return "";
    return hits.map((s) => `scene ${s.index}${spec.scenes[s.index].id ? ` "${spec.scenes[s.index].id}"` : ""} +${(t - s.start).toFixed(2)}s`).join(" / ");
  } catch {
    return "";
  }
};

/**
 * Render preview stills (under the render lock) with human labels; also refreshes <project>/thumb.jpg
 * (a mid-video frame used as the project card thumbnail).
 */
export const runPreview = async (
  projectId: string,
  opts: { times?: number[]; scale?: number; individual?: boolean; signal?: AbortSignal; onWait?: () => void } = {},
): Promise<PreviewRun> => {
  const project = getProject(projectId);
  let labels = new Map<number, string>();
  let ts = opts.times;
  if (!ts || ts.length === 0) {
    const auto = autoPreviewTimes(projectId);
    ts = auto.times;
    labels = auto.labels;
  } else loadSpec(projectId); // fail fast with a clear message when there is no / an invalid spec
  const t0 = Date.now();
  const res: PreviewResult = await withRenderLock(() => renderFrames(projectId, ts!, { scale: opts.scale ?? 0.5, sheet: !opts.individual }), {
    signal: opts.signal,
    onWait: opts.onWait,
  });
  const frames = res.frames.map((f) => {
    const where = sceneAt(projectId, f.time);
    const lab = labels.get(Math.round(f.time * 100) / 100);
    const label = `t=${f.time.toFixed(2)}s (frame ${f.frame})${where ? ` — ${where}` : ""}${lab && !where.includes(lab) ? ` [${lab}]` : ""}`;
    return { ...f, label };
  });
  if (frames.length) {
    try {
      fs.copyFileSync(frames[Math.floor((frames.length - 1) / 2)].path, path.join(project.dir, "thumb.jpg"));
    } catch {
      /* thumbnail is best effort */
    }
  }
  return {
    frames,
    sheet: res.sheet,
    columns: res.columns,
    rows: res.rows,
    width: res.width,
    height: res.height,
    durationSeconds: res.durationSeconds,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
};

// ---------------------------------------------------------------- renders

const RENDER_RE = /-(draft|final)\.mp4$/;

/** Render an MP4 under the render lock and record its metadata in renders/<file>.mp4.json. */
export const runRender = async (
  projectId: string,
  opts: {
    quality?: RenderQuality;
    signal?: AbortSignal;
    onWait?: () => void;
    onProgress?: (p: { progress: number; renderedFrames: number; encodedFrames: number; stage: string }) => void;
  } = {},
): Promise<{ result: RenderVideoResult; record: RenderRecord }> => {
  const project = getProject(projectId);
  loadSpec(projectId);
  const result = await withRenderLock(() => renderVideo(projectId, { quality: opts.quality ?? "draft", signal: opts.signal, onProgress: opts.onProgress }), {
    signal: opts.signal,
    onWait: opts.onWait,
  });
  const record: RenderRecord = {
    file: path.relative(project.dir, result.path).split(path.sep).join("/"),
    quality: result.quality,
    createdAt: new Date().toISOString(),
    sizeBytes: result.sizeBytes,
    seconds: result.seconds,
    width: result.width,
    height: result.height,
    fps: result.fps,
    renderSeconds: result.renderSeconds,
  };
  try {
    fs.writeFileSync(`${result.path}.json`, JSON.stringify(record, null, 2) + "\n");
  } catch {
    /* metadata is best effort */
  }
  return { result, record };
};

/** All MP4 renders of a project, newest first (metadata from sidecars when present). */
export const listRenders = (projectId: string): RenderRecord[] => {
  const dir = path.join(getProject(projectId).dir, "renders");
  if (!fs.existsSync(dir)) return [];
  const out: RenderRecord[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".mp4") || f.startsWith(".")) continue;
    const abs = path.join(dir, f);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let meta: Partial<RenderRecord> = {};
    try {
      meta = JSON.parse(fs.readFileSync(`${abs}.json`, "utf8")) as Partial<RenderRecord>;
    } catch {
      /* no sidecar (older render) */
    }
    out.push({
      ...meta,
      file: `renders/${f}`,
      quality: (meta.quality ?? (RENDER_RE.exec(f)?.[1] as RenderQuality | undefined) ?? "draft") as RenderQuality,
      createdAt: meta.createdAt ?? st.mtime.toISOString(),
      sizeBytes: st.size,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

// ---------------------------------------------------------------- spec events

const specEvent = (projectId: string, res: ValidationResult): ToolEvent[] => {
  if (!res.ok || !res.written) return [];
  const spec = readSpec(projectId);
  if (!spec) return [];
  try {
    return [{ type: "spec", projectId, spec, timeline: specTimeline(spec), validation: res }];
  } catch {
    return [];
  }
};

const specResultSummary = (verb: string, res: ValidationResult, projectId: string): string => {
  if (!res.ok) return `Spec invalid · ${plural(res.errors.length, "error")} · not saved`;
  let scenes = "";
  try {
    const n = readSpec(projectId)?.scenes?.length;
    if (n !== undefined) scenes = ` · ${plural(n, "scene")}`;
  } catch {
    /* ignore */
  }
  return `${verb}${scenes} · ${fmtSecs(res.durationSeconds)}${res.warnings.length ? ` · ${plural(res.warnings.length, "warning")}` : ""}`;
};

// ---------------------------------------------------------------- tools

const FORMAT_KEYS = Object.keys(FORMATS) as [keyof typeof FORMATS, ...(keyof typeof FORMATS)[]];
const projectIdField = z.string().describe("project id (from create_project / list_projects)");

export const TOOLS: ToolDef[] = [
  defineTool({
    name: "get_guide",
    title: "Director guide",
    scope: "global",
    description:
      "Read this FIRST. Returns the Director Guide (how to plan and art-direct a video, pacing, the self-critique loop) and the Kit Reference (every layer type, preset, transition and option in the Scene Spec). All spec times are seconds; positions are px from the canvas center.",
    shape: {},
    startSummary: () => "Reading the director guide",
    handler: async () => ({ content: [text(readDoc("DIRECTOR_GUIDE.md")), text(readDoc("KIT_REFERENCE.md"))], summary: "Read the director guide" }),
  }),

  defineTool({
    name: "list_styles",
    title: "List style presets",
    scope: "global",
    description:
      "List style presets (fonts, palette, finishing FX). Put one in spec.style to get a coherent look; override with spec.theme. Also lists the available fonts and canvas formats.",
    shape: {},
    startSummary: () => "Looking at style presets",
    handler: async () => ({
      content: [
        json({
          default: DEFAULT_STYLE,
          styles: Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, { description: s.description, fonts: s.fonts, colors: s.colors, fx: s.fx }])),
          fonts: FONT_NAMES,
          formats: Object.fromEntries(Object.entries(FORMATS).map(([k, [w, h]]) => [k, `${w}x${h}`])),
        }),
      ],
      summary: `${plural(Object.keys(STYLES).length, "style")} · ${plural(FONT_NAMES.length, "font")}`,
    }),
  }),

  defineTool({
    name: "create_project",
    title: "Create project",
    scope: "unbound",
    description:
      "Create a new video project (a folder with assets/, renders/, previews/). Returns the projectId to use with every other tool. format: 16:9 (YouTube/landscape, default), 9:16 (Reels/TikTok/Shorts), 1:1, 4:5 (feed), 21:9.",
    shape: { name: z.string().min(1).describe("human-readable project name"), format: z.enum(FORMAT_KEYS).optional() },
    startSummary: (i) => `Creating project "${i.name}"`,
    handler: async ({ name, format }, ctx) => {
      const p = createProject({ name, format });
      ctx.policy?.onProjectCreated?.(p.id);
      const link = ctx.policy?.projectLink?.(p.id);
      return {
        content: [
          json({ projectId: p.id, name: p.name, format: p.format, ...(isHosted(ctx) ? {} : { dir: p.dir }) }),
          text("Next: add_asset for any logos/screenshots/music, then set_spec."),
          ...(link ? [text(`Open in Motion Studio: ${link}`)] : []),
        ],
        summary: `Created ${p.id} (${p.format})`,
      };
    },
  }),

  defineTool({
    name: "list_projects",
    title: "List projects",
    scope: "unbound",
    description: "List existing projects (most recently edited first).",
    shape: {},
    startSummary: () => "Listing projects",
    handler: async (_input, ctx) => {
      const allowed = ctx.policy?.listProjectIds ? new Set(ctx.policy.listProjectIds()) : null;
      const list = listProjects()
        .filter((p) => !allowed || allowed.has(p.id))
        .map((p) => ({ projectId: p.id, name: p.name, format: p.format, createdAt: p.createdAt, updatedAt: p.updatedAt, hasSpec: p.hasSpec }));
      const none = isHosted(ctx) ? "No projects yet. Use create_project." : `No projects yet in ${PROJECTS_DIR}. Use create_project.`;
      return { content: [list.length ? json(list) : text(none)], summary: plural(list.length, "project") };
    },
  }),

  defineTool({
    name: "get_project",
    title: "Get project",
    scope: "project",
    description:
      "Project info, its assets (kind, size, duration, dominant palette — reference them in the spec as their `path`), the current spec summary (scenes with start times) and recent renders.",
    shape: { projectId: projectIdField },
    startSummary: () => "Checking the project",
    handler: async ({ projectId }, ctx) => {
      const p = getProject(projectId);
      const assets = (await listAssets(projectId)).map(({ file: _file, ...a }) => a);
      const hosted = isHosted(ctx);
      const renders = listRenders(projectId).slice(0, 5).map((r) => (hosted ? r.file : path.join(p.dir, r.file)));
      return {
        content: [json({ projectId: p.id, name: p.name, format: p.format, createdAt: p.createdAt, ...(hosted ? {} : { dir: p.dir }), assets, spec: specSummary(readSpec(projectId)), renders })],
        summary: `${plural(assets.length, "asset")} · ${plural(renders.length, "render")}`,
      };
    },
  }),

  defineTool({
    name: "add_asset",
    title: "Add asset",
    scope: "project",
    hosted: {
      omit: ["path"],
      description:
        "Import an ingredient (logo, product shot, screenshot, screen recording, music, sfx, Lottie JSON) into the project from a public http(s) URL (the user can also upload files in the Motion Studio web app). Returns its spec path (e.g. \"assets/logo.png\"), kind, dimensions, duration, hasAudio and dominant palette (use it to pick theme colors that match the brand). Images and videos also come back as a small preview image so you can see them.",
    },
    description:
      "Import an ingredient (logo, product shot, screenshot, screen recording, music, sfx, Lottie JSON) into the project from an absolute local path or an http(s) URL. Returns its spec path (e.g. \"assets/logo.png\"), kind, dimensions, duration, hasAudio and dominant palette (use it to pick theme colors that match the brand). Images and videos also come back as a small preview image so you can see them.",
    shape: {
      projectId: projectIdField,
      path: z.string().optional().describe("absolute path of a local file"),
      url: z.string().url().optional().describe("http(s) URL to download (max 500MB)"),
      name: z.string().optional().describe("optional filename to store it as, e.g. logo.png"),
    },
    startSummary: (i) => `Adding asset ${i.name ?? path.basename(i.path ?? i.url ?? "")}`,
    handler: async ({ projectId, path: p, url, name }, ctx) => {
      let info: AssetInfo;
      if (isHosted(ctx)) {
        if (p) throw new Error("Local file paths are disabled on this server. Pass a public https `url`, or upload the file in the Motion Studio web app.");
        if (!url) throw new Error("Provide `url` (a public http(s) URL).");
        const dl = await safeDownload(url, { maxBytes: ctx.policy?.maxDownloadBytes ?? 200 * 1024 * 1024, name, signal: ctx.signal });
        try {
          info = await addAsset(projectId, { path: dl.file, name: dl.filename });
        } finally {
          dl.cleanup();
        }
      } else info = await addAsset(projectId, { path: p, url, name });
      const { file, ...rest } = info;
      const content: ToolContent[] = [json(rest)];
      if (info.kind === "image" || info.kind === "video") {
        try {
          const seek = info.kind === "video" && info.duration ? Math.min(1, info.duration * 0.1) : 0;
          content.push(image(await thumbnail(file, { size: 384, seek })));
        } catch (e) {
          console.error(`[motion-studio] thumbnail failed: ${(e as Error).message}`);
        }
      }
      if (info.kind === "audio") content.push(text(`Tip: call analyze_audio {${pidArg(ctx)}asset: "${info.path}"} to get BPM, beats and the drop for beat-synced cuts.`));
      if (path.extname(file).toLowerCase() === ".svg") {
        try {
          const a = ensureLogoAnalysis(file, info.path);
          content.push(
            text(
              `Logo analysis (saved as ${info.path}.logo.json; use {"type":"logo","src":"${info.path}"} layers):\n` +
                JSON.stringify(logoSummary(a), null, 2) +
                `\nCall analyze_logo {${pidArg(ctx)}asset: "${info.path}"} for a numbered part map and brand-aware mode ranking.`,
            ),
          );
        } catch (e) {
          content.push(text(`Logo analysis failed: ${(e as Error).message}. The SVG can still be used as an image or with logo mode mask/pop/glitch.`));
        }
      }
      const dims = info.width && info.height ? ` ${info.width}×${info.height}` : "";
      const dur = info.duration ? ` ${fmtSecs(info.duration)}` : "";
      return { content, summary: `Added ${info.path} (${info.kind}${dims}${dur})`, events: [{ type: "asset", projectId, asset: rest }] };
    },
  }),

  defineTool({
    name: "analyze_logo",
    title: "Analyze logo",
    scope: "project",
    description:
      "Break an SVG logo asset into animatable parts: islands with holes (counters), icon vs wordmark groups, stagger orders, " +
      "palette with roles, geometry kit (stroke weight, corner radius, angles, symmetry) and a ranked list of logo reveal modes " +
      "(LogoLayer.mode) with reasons. Pass the brand's verb/values/industry to add meaning-driven scoring. Also returns an image " +
      "of the parts colored by `order` (red = first … violet = last) and labelled with their part ids (\"svg:assets/x.svg#<id>\").",
    shape: {
      projectId: projectIdField,
      asset: z.string().describe('SVG asset path like "assets/logo.svg" (or just the filename)'),
      order: z.enum(LOGO_ORDERS).optional().describe("order used to color the preview, default bySizeDesc"),
      verb: z.string().optional().describe("brand motion verb, e.g. connect, grow, protect, flow"),
      values: z.array(z.string()).optional().describe("brand adjectives, e.g. playful, premium, secure"),
      industry: z.string().optional().describe("e.g. fintech, food, logistics, media, saas, fashion"),
      force: z.boolean().optional().describe("re-analyze even if a cached .logo.json exists"),
    },
    startSummary: (i) => `Analyzing logo ${stripAssets(i.asset)}`,
    handler: async ({ projectId, asset, order, verb, values, industry, force }) => {
      const info = await getAssetInfo(projectId, stripAssets(asset));
      if (path.extname(info.file).toLowerCase() !== ".svg") {
        throw new Error(`${info.path} is not an SVG. Raster logos only support logo modes mask/pop/glitch (vectorize it to SVG to unlock the rest).`);
      }
      const a = ensureLogoAnalysis(info.file, info.path, { force });
      const brief: LogoBrief = { verb, values, industry };
      const summary = logoSummary(a, brief, path.relative(getProject(projectId).dir, logoJsonPath(info.file)));
      const content: ToolContent[] = [json(summary)];
      try {
        content.push(text(`Part map colored by ${order ?? "bySizeDesc"} (red first → violet last); dashed outline = wordmark glyph:`));
        content.push(image(await renderLogoPreviewPng(a, order ?? "bySizeDesc", 640), "image/png"));
      } catch (e) {
        console.error(`[motion-studio] logo preview failed: ${(e as Error).message}`);
      }
      const top = summary.suggestedModes[0]?.mode;
      return { content, summary: `${plural(summary.parts, "part")}${top ? ` · best mode: ${top}` : ""}` };
    },
  }),

  defineTool({
    name: "analyze_audio",
    title: "Analyze music",
    scope: "project",
    description:
      "Analyze an audio (or video) asset for beat-synced editing: bpm, beatConfidence, beats (seconds), strongest onsets (hits/accents), energyCurve (0..1 loudness every 0.5s — find quiet intros, builds and drops) and dropAt. Cut scenes on beats (scene durations = multiples of 60/bpm), put camera.punch / fx.flashes on onsets, start the hero reveal at dropAt.",
    shape: { projectId: projectIdField, asset: z.string().describe('asset path like "assets/song.mp3" (or just the filename)') },
    startSummary: (i) => `Analyzing music ${stripAssets(i.asset)}`,
    handler: async ({ projectId, asset }) => {
      const info = await getAssetInfo(projectId, stripAssets(asset));
      if (info.kind !== "audio" && !(info.kind === "video" && info.hasAudio)) throw new Error(`${info.path} is a ${info.kind} without audio`);
      const a = await analyzeAudio(info.file);
      const beatLen = a.bpm ? 60 / a.bpm : 0;
      const summary = a.bpm
        ? `bpm ≈ ${a.bpm} (beat = ${beatLen.toFixed(3)}s, bar of 4 = ${(beatLen * 4).toFixed(3)}s), confidence ${a.beatConfidence}${a.dropAt !== null ? `, likely drop at ${a.dropAt}s` : ""}.`
        : "No tempo found.";
      return { content: [text(summary), json({ asset: info.path, ...a })], summary: a.bpm ? `${a.bpm} bpm${a.dropAt !== null ? ` · drop at ${a.dropAt}s` : ""}` : "No tempo found" };
    },
  }),

  defineTool({
    name: "set_spec",
    title: "Set scene spec",
    scope: "project",
    description:
      "Validate and save the whole Scene Spec (JSON object) for a project. If invalid nothing is saved and you get precise errors with JSON paths (e.g. scenes[1].layers[0].preset). If valid you get the total duration and warnings (missing assets, unknown fonts, layers that start after their scene ends). See get_guide for the schema.",
    shape: {
      projectId: projectIdField,
      spec: z.union([z.record(z.string(), z.any()), z.string()]).describe("the full Scene Spec object (a JSON string is accepted too)"),
    },
    startSummary: (i) => {
      const s = (() => {
        try {
          return parseMaybeJson(i.spec, "spec") as { scenes?: unknown[] };
        } catch {
          return null;
        }
      })();
      return `Writing spec${Array.isArray(s?.scenes) ? ` · ${plural(s.scenes.length, "scene")}` : ""}`;
    },
    handler: async ({ projectId, spec }, ctx) => {
      const value = parseMaybeJson(spec, "spec");
      if (isHosted(ctx)) await assertSpecSafe(value);
      const res = await writeSpec(projectId, value);
      return { content: [text(formatValidation(res))], isError: !res.ok, summary: specResultSummary("Saved spec", res, projectId), events: specEvent(projectId, res) };
    },
  }),

  defineTool({
    name: "get_spec",
    title: "Get scene spec",
    scope: "project",
    description: "Return the project's current Scene Spec JSON exactly as saved.",
    shape: { projectId: projectIdField },
    startSummary: () => "Reading the spec",
    handler: async ({ projectId }) => {
      const spec = readSpec(projectId);
      return { content: [spec ? json(spec) : text("No spec yet. Use set_spec.")], summary: spec ? `Spec · ${plural(spec.scenes?.length ?? 0, "scene")}` : "No spec yet" };
    },
  }),

  defineTool({
    name: "update_scene",
    title: "Update one scene",
    scope: "project",
    description:
      "Replace a single scene (0-based index) in the saved spec — cheaper than resending the whole spec when iterating. index === number of scenes appends a new scene. The whole spec is re-validated; nothing is saved if invalid.",
    shape: {
      projectId: projectIdField,
      index: z.number().int().min(0),
      scene: z.union([z.record(z.string(), z.any()), z.string()]).describe("the full scene object (a JSON string is accepted too)"),
    },
    startSummary: (i) => `Updating scene ${i.index}`,
    handler: async ({ projectId, index, scene }, ctx) => {
      const value = parseMaybeJson(scene, "scene");
      if (isHosted(ctx)) await assertSpecSafe(value);
      const res = await updateScene(projectId, index, value);
      return {
        content: [text(formatValidation(res))],
        isError: !res.ok,
        summary: specResultSummary(`Updated scene ${index}`, res, projectId),
        events: specEvent(projectId, res),
      };
    },
  }),

  defineTool({
    name: "preview_frames",
    title: "Preview frames",
    scope: "project",
    description:
      "Render still frames of the current spec and return them as an image so you can SEE the video. Use it after every meaningful change and critique honestly: hierarchy, legibility, spacing/safe margins, overlap, contrast, empty or cluttered frames, brand fit. Default: ~6 auto-picked moments (just after each scene settles, and late in each scene) as one labelled contact sheet (tile numbers match the listing). Pass `times` (seconds) to inspect specific moments, e.g. mid-transition or a beat. individual: true returns each frame as its own larger image instead of a sheet.",
    shape: {
      projectId: projectIdField,
      times: z.array(z.number().min(0)).max(16).optional().describe("seconds on the global timeline"),
      scale: z.number().min(0.1).max(1).optional().describe("render scale, default 0.5 (0.35 for many frames, 1 for fine detail)"),
      individual: z.boolean().optional().describe("return separate images instead of a contact sheet"),
    },
    startSummary: (i) => `Rendering preview${i.times?.length ? ` · ${plural(i.times.length, "frame")}` : ""}`,
    handler: async ({ projectId, times, scale, individual }, ctx) => {
      if (isHosted(ctx)) await assertSpecSafe(readSpec(projectId));
      const run = await runPreview(projectId, { times, scale, individual, signal: ctx.signal, onWait: () => ctx.onProgress?.({ progress: 0, message: "Waiting for another render to finish…" }) });
      const lines = run.frames.map((f, i) => `${i + 1}. ${f.label}`);
      const header = `Rendered ${run.frames.length} frame(s) of a ${run.durationSeconds.toFixed(2)}s video at ${run.width}x${run.height} in ${run.seconds.toFixed(1)}s.`;
      const content: ToolContent[] = [];
      if (individual || !run.sheet) {
        content.push(text(`${header}\n${lines.join("\n")}`));
        run.frames.forEach((f, i) => {
          content.push(text(lines[i]));
          content.push(image(fs.readFileSync(f.path)));
        });
      } else {
        content.push(text(`${header} Contact sheet is ${run.columns} column(s) x ${run.rows} row(s), read left-to-right, top-to-bottom:\n${lines.join("\n")}`));
        content.push(image(fs.readFileSync(run.sheet)));
      }
      return { content, summary: `Rendered ${plural(run.frames.length, "frame")} (${run.seconds.toFixed(1)}s)`, events: [{ type: "preview", projectId, preview: run }] };
    },
  }),

  defineTool({
    name: "render_video",
    title: "Render MP4",
    scope: "project",
    description:
      "Render the project to an MP4 (H.264). quality \"draft\" = half resolution, fast (use to check timing/motion); \"final\" = full resolution, high quality. Takes from seconds to minutes depending on length. Returns the file path, duration, size and render time. Only render after preview_frames looks right. On a hosted/remote Motion Studio renders run in a job queue: if the render takes longer than ~45s this returns \"Still rendering\" with a jobId — then poll render_status until it is done.",
    shape: { projectId: projectIdField, quality: z.enum(["draft", "final"]).optional() },
    startSummary: (i) => `Rendering ${i.quality ?? "draft"} video`,
    handler: async ({ projectId, quality }, ctx) => {
      if (ctx.policy?.renderVideo) {
        const out = await ctx.policy.renderVideo(projectId, quality ?? "draft", ctx);
        if ("pending" in out) {
          const pct = Math.round(out.progress * 100);
          const state = out.status === "queued" ? `queued${out.position ? ` (#${out.position} in line)` : ""}` : `${out.stage ?? "rendering"} · ${pct}%`;
          return {
            content: [
              text(
                `Still rendering — job ${out.jobId} is ${state}. The render continues in the background: call render_status {${pidArg(ctx)}jobId: "${out.jobId}"} in ~30s to check (the finished MP4 also shows up in get_project).`,
              ),
              json(out),
            ],
            summary: `Render ${out.jobId} ${out.status} · ${pct}%`,
          };
        }
        const r = out;
        const dims = r.width && r.height ? `${r.width}x${r.height}` : "";
        const where = isHosted(ctx) ? r.file : path.join(getProject(projectId).dir, r.file);
        return {
          content: [
            text(
              `Rendered ${r.quality} video: ${where}\n${[dims, r.fps ? `${r.fps}fps` : "", r.seconds !== undefined ? `${r.seconds.toFixed(2)}s` : "", `${(r.sizeBytes / 1e6).toFixed(2)} MB`, r.renderSeconds !== undefined ? `took ${r.renderSeconds}s` : ""].filter(Boolean).join(", ")}.`,
            ),
            json(r),
          ],
          summary: `Rendered ${r.quality}${r.seconds !== undefined ? ` · ${fmtSecs(r.seconds)}` : ""} · ${(r.sizeBytes / 1e6).toFixed(1)} MB`,
          events: [{ type: "render", projectId, render: r }],
        };
      }
      let last = -1;
      const { result: res, record } = await runRender(projectId, {
        quality: quality ?? "draft",
        signal: ctx.signal,
        onWait: () => ctx.onProgress?.({ progress: 0, message: "Waiting for another render to finish…" }),
        onProgress: (p) => {
          const pct = Math.floor(p.progress * 100);
          if (pct === last || (pct % 5 !== 0 && pct !== 100)) return;
          last = pct;
          console.error(`[motion-studio] render ${projectId}: ${pct}% (${p.renderedFrames} rendered, ${p.encodedFrames} encoded)`);
          ctx.onProgress?.({ progress: p.progress, message: `${p.stage}: ${p.renderedFrames} frames` });
        },
      });
      return {
        content: [
          text(`Rendered ${res.quality} video: ${res.path}\n${res.width}x${res.height} @ ${res.fps}fps, ${res.seconds.toFixed(2)}s, ${(res.sizeBytes / 1e6).toFixed(2)} MB, took ${res.renderSeconds}s.`),
          json(res),
        ],
        summary: `Rendered ${res.quality} · ${fmtSecs(res.seconds)} · ${(res.sizeBytes / 1e6).toFixed(1)} MB`,
        events: [{ type: "render", projectId, render: record }],
      };
    },
  }),

  defineTool({
    name: "render_status",
    title: "Render status",
    scope: "project",
    description:
      "Status of a render job started by render_video (queued / running with progress / done with the file / error / canceled). Omit jobId for the project's latest job. Use it after render_video answered \"Still rendering\".",
    shape: { projectId: projectIdField, jobId: z.string().optional().describe("job id from render_video; default: latest job of the project") },
    startSummary: () => "Checking the render",
    handler: async ({ projectId, jobId }, ctx) => {
      if (!ctx.policy?.renderStatus) {
        const latest = listRenders(projectId)[0];
        return {
          content: [text(latest ? `Renders run synchronously on this server (no job queue). Latest render: ${JSON.stringify(latest)}` : "Renders run synchronously on this server (no job queue); no renders yet.")],
          summary: latest ? `Latest render ${latest.quality}` : "No renders",
        };
      }
      const st = ctx.policy.renderStatus(projectId, jobId);
      if (!st) return { content: [text(jobId ? `No render job "${jobId}" in this project.` : "No render jobs for this project yet. Use render_video.")], isError: !!jobId, summary: "No job" };
      const pct = Math.round(st.progress * 100);
      const line =
        st.status === "done"
          ? `Done: ${st.render?.file ?? "(file)"}${st.render?.seconds !== undefined ? `, ${st.render.seconds.toFixed(2)}s` : ""}${st.render ? `, ${(st.render.sizeBytes / 1e6).toFixed(2)} MB` : ""}.`
          : st.status === "queued"
            ? `Queued${st.position ? ` (#${st.position} in line)` : ""}. Check again in ~30s.`
            : st.status === "running"
              ? `Running: ${st.stage ?? "rendering"} · ${pct}%. Check again in ~30s.`
              : st.status === "canceled"
                ? "Canceled."
                : `Failed: ${st.error ?? "unknown error"}`;
      return {
        content: [text(`Job ${st.jobId} (${st.quality}): ${line}`), json(st)],
        isError: st.status === "error",
        summary: `Render ${st.status}${st.status === "running" ? ` · ${pct}%` : ""}`,
      };
    },
  }),

  defineTool({
    name: "write_custom_component",
    title: "Write custom component",
    scope: "global",
    hosted: "hidden",
    description:
      "Escape hatch when the kit can't express an idea: write a React (TSX) component that becomes usable in specs as {\"type\":\"custom\",\"component\":\"<Name>\",\"props\":{...}}. The file must `export default` a component receiving { t, duration, width, height, ...props } where t = seconds since the layer started — derive ALL animation from t (no CSS animations, timers, Math.random or useEffect-driven state; it must be deterministic per frame). You may import from \"remotion\" (interpolate, spring, Easing, Img, staticFile...) and \"react\". Size it to fill its layer (width/height). Syntax is checked before saving. Re-writing the same name replaces it.",
    shape: {
      name: z.string().describe("PascalCase, e.g. OrbitingLogos"),
      code: z.string().describe("full TSX source with a default export"),
    },
    startSummary: (i) => `Writing custom component ${i.name}`,
    handler: async ({ name, code }) => {
      const res = writeCustomComponent(name, code);
      return {
        content: [
          text(`${res.replaced ? "Replaced" : "Created"} custom component ${res.name} (${res.path}). Use it with {"type":"custom","component":"${res.name}","props":{...}} and preview_frames to check it. Available: ${res.components.join(", ")}`),
        ],
        summary: `${res.replaced ? "Replaced" : "Created"} component ${res.name}`,
      };
    },
  }),

  defineTool({
    name: "list_custom_components",
    title: "List custom components",
    scope: "global",
    description: "List custom components available to {\"type\":\"custom\"} layers. Pass name to get one component's source.",
    shape: { name: z.string().optional() },
    startSummary: (i) => (i.name ? `Reading component ${i.name}` : "Listing custom components"),
    handler: async ({ name }) => {
      if (name) return { content: [text(readCustomComponent(name))], summary: `Source of ${name}` };
      const list = listCustomComponents();
      return { content: [text(list.length ? list.join("\n") : "No custom components yet.")], summary: plural(list.length, "component") };
    },
  }),

  defineTool({
    name: "open_studio_hint",
    title: "How to open Remotion Studio",
    scope: "unbound",
    hosted: "hidden",
    description: "Explains how a human can open the live Remotion Studio to scrub through a project interactively.",
    shape: { projectId: z.string().optional() },
    startSummary: () => "Studio hint",
    handler: async ({ projectId }) => ({
      content: [
        text(
          [
            "Run in the repo root:  pnpm studio",
            "",
            "This starts Remotion Studio on src/engine/index.ts with --public-dir=projects, so project files are served as static files",
            '(staticFile("<projectId>/assets/...")). In the Studio, select the "Spec" composition and set the input prop',
            `projectId to ${projectId ? `"${projectId}"` : "your project id"} — the engine then loads projects/<projectId>/spec.json and its assets.`,
            "Studio hot-reloads engine code; re-select the composition / refresh after set_spec to see spec changes.",
          ].join("\n"),
        ),
      ],
      summary: "pnpm studio",
    }),
  }),
];

// ---------------------------------------------------------------- registry API

export type BoundTool = {
  name: string;
  title: string;
  description: string;
  /** Visible input shape (projectId removed when bound, hosted-omitted fields removed) — what an MCP server registers. */
  shape: Shape;
  /** Input schema as seen by the caller (projectId removed when bound). */
  inputSchema: z.ZodObject<Shape>;
  /** JSON Schema of inputSchema (for the Claude API `input_schema`). */
  jsonSchema: Record<string, unknown>;
  def: ToolDef;
};

type Visibility = Pick<ToolContext, "projectId" | "policy">;

const isBound = (ctx: Pick<ToolContext, "projectId">) => !!ctx.projectId;

const isVisible = (def: ToolDef, ctx: Visibility) => !(isBound(ctx) && def.scope === "unbound") && !(isHosted(ctx) && def.hosted === "hidden");

const hostedOmit = (def: ToolDef, hosted: boolean): string[] => (hosted && def.hosted && def.hosted !== "hidden" ? def.hosted.omit : []);

const visibleShape = (def: ToolDef, bound: boolean, hosted: boolean): Shape => {
  const omit = new Set(hostedOmit(def, hosted));
  if (bound && def.scope === "project") omit.add("projectId");
  if (!omit.size) return def.shape;
  return Object.fromEntries(Object.entries(def.shape).filter(([k]) => !omit.has(k)));
};

const cleanJsonSchema = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(cleanJsonSchema);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "$schema") continue;
    if ((k === "maximum" || k === "minimum") && typeof val === "number" && Math.abs(val) >= Number.MAX_SAFE_INTEGER) continue;
    out[k] = cleanJsonSchema(val);
  }
  return out;
};

const boundCache = new Map<string, BoundTool>();

const bindTool = (def: ToolDef, bound: boolean, hosted: boolean): BoundTool => {
  const key = `${def.name}|${bound}|${hosted}`;
  const hit = boundCache.get(key);
  if (hit) return hit;
  const shape = visibleShape(def, bound, hosted);
  const inputSchema = z.object(shape);
  const jsonSchema = cleanJsonSchema(z.toJSONSchema(inputSchema)) as Record<string, unknown>;
  const description = hosted && def.hosted && def.hosted !== "hidden" ? def.hosted.description : def.description;
  const bt: BoundTool = { name: def.name, title: def.title, description, shape, inputSchema, jsonSchema, def };
  boundCache.set(key, bt);
  return bt;
};

/** Tools visible in this context, in a stable order (keep it deterministic: it is part of the prompt-cache prefix). */
export const toolsFor = (ctx: Visibility = {}, opts: { exclude?: string[] } = {}): BoundTool[] =>
  TOOLS.filter((t) => isVisible(t, ctx) && !opts.exclude?.includes(t.name)).map((t) => bindTool(t, isBound(ctx), isHosted(ctx)));

export const getTool = (name: string, ctx: Visibility = {}): BoundTool | undefined => {
  const def = TOOLS.find((t) => t.name === name);
  if (!def || !isVisible(def, ctx)) return undefined;
  return bindTool(def, isBound(ctx), isHosted(ctx));
};

/** Readable zod issues: `times[2]: Too small: expected number to be >=0`. */
export const formatToolIssues = (issues: z.core.$ZodIssue[]): string =>
  issues.map((i) => `${i.path.length ? i.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "[") : "(input)"}: ${i.message}`).join("\n");

/** Validate the raw input against the tool's schema (in this context). */
export const parseToolInput = (
  name: string,
  input: unknown,
  ctx: Visibility = {},
): { ok: true; tool: BoundTool; input: Record<string, unknown> } | { ok: false; error: string } => {
  const tool = getTool(name, ctx);
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
  const raw = (input ?? {}) as Record<string, unknown>;
  const omitted = hostedOmit(tool.def, isHosted(ctx)).filter((k) => raw && typeof raw === "object" && raw[k] !== undefined);
  if (omitted.length) return { ok: false, error: `${omitted.join(", ")}: not available on this server${name === "add_asset" ? " (local file paths are disabled; pass a public https url)" : ""}` };
  const parsed = tool.inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: formatToolIssues(parsed.error.issues) };
  const data = parsed.data as Record<string, unknown>;
  if (ctx.projectId && tool.def.scope === "project") data.projectId = ctx.projectId;
  return { ok: true, tool, input: data };
};

/** Human line for a call that is about to run (never throws). */
export const describeToolCall = (name: string, input: unknown): string => {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return name;
  try {
    return def.startSummary((input ?? {}) as Record<string, unknown>);
  } catch {
    return def.title;
  }
};

/**
 * Validate + run a tool. Never throws: invalid input and handler errors come back as `isError` results
 * (an aborted signal is reported as "Aborted"). With a policy, project access is checked first and project results get
 * the policy's project link appended.
 */
export const callTool = async (name: string, input: unknown, ctx: ToolContext = {}): Promise<ToolResult> => {
  const parsed = parseToolInput(name, input, ctx);
  if (!parsed.ok) return { content: [text(`Invalid input for ${name}:\n${parsed.error}`)], isError: true, summary: "Invalid input" };
  const projectId = parsed.tool.def.scope === "project" ? (parsed.input.projectId as string | undefined) : undefined;
  if (projectId && ctx.policy?.canAccessProject && !ctx.policy.canAccessProject(projectId)) {
    return { content: [text(`Error: Project "${projectId}" not found. Use list_projects to see your projects.`)], isError: true, summary: "Project not found" };
  }
  try {
    const res = await parsed.tool.def.handler(parsed.input, ctx);
    const link = projectId ? ctx.policy?.projectLink?.(projectId) : undefined;
    return link ? { ...res, content: [...res.content, text(`Open in Motion Studio: ${link}`)] } : res;
  } catch (e) {
    const aborted = ctx.signal?.aborted || (e as Error)?.name === "AbortError";
    const msg = aborted ? "Aborted" : e instanceof Error ? e.message : String(e);
    if (!aborted) console.error(`[motion-studio] tool ${name} error: ${e instanceof Error ? e.stack : msg}`);
    return { content: [text(`Error: ${msg}`)], isError: true, summary: aborted ? "Stopped" : `Error: ${msg.split("\n")[0].slice(0, 120)}` };
  }
};
