/**
 * Motion Studio web server (Hono on Node): the HTTP API of docs/WEB_API.md + docs/PLATFORM.md (accounts, tokens,
 * render jobs, connect info), user-scoped /files serving for project folders, the in-app AI director (SSE), the remote
 * MCP connector (src/server/mcp-remote.ts, when present) and the built web app (web/dist) with SPA fallback.
 *   pnpm server   →   http://127.0.0.1:${MOTION_STUDIO_PORT ?? 4310}
 *   MOTION_STUDIO_MODE=hosted → accounts required (see docs/DEPLOY.md)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { ROOT, PROJECTS_DIR, LIBRARY_DIR } from "../core/paths";
import { ensureSfxLibrary } from "../../scripts/gen-sfx";
import { ensureBaked } from "../../scripts/sfx-bake";
import { FORMATS, type SpecInput } from "../engine/spec/schema";
import { addAsset, createProject, deleteProject, getAssetInfo, getProject, listAssets, listProjects, readSpec, validateSpec, writeSpec, type ValidationResult } from "../core/projects";
import { ensureLogoAnalysis, isLogoJson, logoJsonPath, logoSummary, renderLogoPreviewPng } from "../core/logo";
import { assertSpecSafe, listRenders, runPreview, specTimeline, type RenderRecord, type Timeline } from "../core/tools";
import { clearChat, fileUrl, getChat, isRunning, runChat, stopChat, type ChatEvent, type RenderInfo } from "./agent";
import { fileResponse, safeResolve } from "./files";
import { HttpError, parseMultipart } from "./multipart";
import { getSettings, putSettings } from "./settings";
import { HOST, IS_HOSTED, MODE, PORT, PUBLIC_HOST, PUBLIC_ORIGIN, PUBLIC_URL, RENDER_BACKEND, SIGNUP } from "./config";
import {
  assertProjectOwner,
  authenticate,
  createToken,
  createUser,
  currentUser,
  deleteToken,
  endSession,
  forgetProject,
  isAdmin,
  listTokens,
  listUserProjectIds,
  rateLimit,
  recordProjectOwner,
  requireUser,
  startSession,
  syncProjectOwnership,
  userCount,
  validateSignup,
  type User,
} from "./auth";
import { adaptTargets, type Format } from "../engine/spec/reflow";
import { createProjectFromTemplate, getTemplate, listTemplates, templateFile } from "../core/templates";
import { cancelJob, cancelProjectJobs, enqueueRenderJob, getJobFor, initJobs, isTerminal, listJobs, subscribe, type Job, type JobEvent } from "./jobs";
import { backendError } from "./render";
import { toolPolicyFor } from "./scope";
import { sseWriter } from "./sse";

const WEB_DIST = path.resolve(process.env.MOTION_STUDIO_WEB_DIST || path.join(ROOT, "web", "dist"));
const UPLOAD_TMP = path.join(PROJECTS_DIR, ".uploads");
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const extraList = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1", PUBLIC_HOST, ...extraList(process.env.MOTION_STUDIO_ALLOWED_HOSTS)]);
/** Hosted: state-changing browser requests must come from the public origin. Local: any local origin (Vite on :5173). */
const ALLOWED_ORIGINS = new Set([PUBLIC_ORIGIN, ...extraList(process.env.MOTION_STUDIO_ALLOWED_ORIGINS)]);
/** Bearer-authenticated, non-cookie endpoints (remote MCP / OAuth token endpoints): no Origin check. */
const ORIGIN_EXEMPT = /^\/(mcp|oauth\/(token|register|revoke))(\/|$)/;

const app = new Hono();

// ---------------------------------------------------------------- remote MCP + OAuth (mounted first)

/**
 * src/server/mcp-remote.ts (`mountRemoteMcp(app)`) brings /mcp, /oauth/* and /.well-known/* with their own Host guard,
 * CORS (claude.ai calls discovery / token / register from the browser) and CSRF checks, so it is mounted BEFORE the
 * app-wide guard below. Guarded dynamic import: the server still boots (without the connector) if the file is absent
 * or fails to load.
 */
const mountRemote = async (): Promise<boolean> => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = ["mcp-remote.ts", "mcp-remote.js"].map((f) => path.join(here, f)).find((f) => fs.existsSync(f));
  if (!file) {
    console.error("[motion-studio] remote MCP connector not installed (src/server/mcp-remote.ts missing): /mcp disabled");
    return false;
  }
  try {
    const mod = (await import(pathToFileURL(file).href)) as { mountRemoteMcp?: (app: Hono) => void | Promise<void> };
    if (typeof mod.mountRemoteMcp !== "function") throw new Error("mcp-remote does not export mountRemoteMcp(app)");
    await mod.mountRemoteMcp(app);
    return true;
  } catch (e) {
    console.error(`[motion-studio] remote MCP connector failed to load, /mcp disabled: ${e instanceof Error ? e.stack : String(e)}`);
    return false;
  }
};
const remoteMcp = await mountRemote();

// ---------------------------------------------------------------- guards & errors

/** DNS-rebinding / CSRF guard: only known Host headers; state-changing requests from foreign origins are refused. */
app.use("*", async (c, next) => {
  const hostOk = (h: string | undefined | null) => {
    if (!h) return false;
    try {
      return ALLOWED_HOSTS.has(new URL(`http://${h}`).hostname);
    } catch {
      return false;
    }
  };
  if (!hostOk(c.req.header("host"))) return c.json({ error: "Forbidden host" }, 403);
  const origin = c.req.header("origin");
  if (origin && c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS" && !ORIGIN_EXEMPT.test(c.req.path)) {
    let ok = false;
    try {
      const u = new URL(origin);
      ok = IS_HOSTED ? ALLOWED_ORIGINS.has(u.origin) : ALLOWED_HOSTS.has(u.hostname) || ALLOWED_ORIGINS.has(u.origin);
    } catch {
      ok = false;
    }
    if (!ok) return c.json({ error: "Forbidden origin" }, 403);
  }
  await next();
  if (IS_HOSTED) {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!c.res.headers.has("X-Frame-Options")) c.header("X-Frame-Options", "DENY");
  }
});

app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message }, e.status as 400);
  if (e instanceof HTTPException) {
    const retry = (e.cause as { retryAfter?: number } | undefined)?.retryAfter;
    if (retry) c.header("Retry-After", String(retry));
    return c.json({ error: e.message || "Error" }, e.status);
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[motion-studio] ${c.req.method} ${c.req.path}: ${e instanceof Error ? e.stack : msg}`);
  return c.json({ error: msg }, 500);
});

app.notFound((c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

// ---------------------------------------------------------------- health + auth (public)

app.get("/api/health", (c) => c.json({ ok: true, mode: MODE, backend: RENDER_BACKEND }));

const signupOpen = () => IS_HOSTED && (SIGNUP === "open" || userCount() === 0);

app.get("/api/auth/me", (c) => {
  const user = currentUser(c);
  return c.json({ user, mode: MODE, publicUrl: PUBLIC_URL, signup: signupOpen(), admin: user ? isAdmin(user) : false });
});

app.post("/api/auth/signup", async (c) => {
  if (!IS_HOSTED) throw new HttpError(403, "Sign-up is only available in hosted mode (local mode has a single built-in owner).");
  rateLimit(c, "signup");
  if (!signupOpen()) throw new HttpError(403, "Sign-up is closed on this server.");
  const input = validateSignup(await readJson(c));
  const user = await createUser(input);
  startSession(c, user);
  return c.json({ user });
});

app.post("/api/auth/login", async (c) => {
  if (!IS_HOSTED) return c.json({ user: currentUser(c) });
  rateLimit(c, "login");
  const body = await readJson<{ email?: unknown; password?: unknown }>(c);
  const user = await authenticate(body.email, body.password);
  if (!user) throw new HttpError(401, "Invalid email or password");
  startSession(c, user);
  return c.json({ user });
});

app.post("/api/auth/logout", (c) => {
  if (IS_HOSTED) endSession(c);
  return c.json({ ok: true });
});

// Everything else under /api and /files needs a user (local mode: always the local owner).
app.use("/api/*", async (c, next) => {
  requireUser(c);
  await next();
});
app.use("/files/*", async (c, next) => {
  requireUser(c);
  await next();
});

const userOf = (c: Context): User => requireUser(c);

/** The project if the current user owns it; 404 otherwise (same answer for "missing" and "not yours"). */
const requireProject = (c: Context, id: string = c.req.param("id") ?? "") => {
  if (!ID_RE.test(id)) throw new HttpError(404, `Project "${id}" not found`);
  assertProjectOwner(userOf(c), id);
  try {
    return getProject(id);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
};

/** Hosted mode: refuse specs that reach outside the project or at private hosts. */
const specSafetyErrors = async (spec: unknown): Promise<string[]> => {
  if (!IS_HOSTED) return [];
  try {
    await assertSpecSafe(spec);
    return [];
  } catch (e) {
    return [(e as Error).message];
  }
};

const readJson = async <T = Record<string, unknown>>(c: Context): Promise<T> => {
  try {
    const v = await c.req.json();
    if (!v || typeof v !== "object") throw new Error("not an object");
    return v as T;
  } catch {
    throw new HttpError(400, "Body must be a JSON object");
  }
};

const versioned = (url: string, abs: string) => {
  try {
    return `${url}?v=${Math.round(fs.statSync(abs).mtimeMs)}`;
  } catch {
    return url;
  }
};

// ---------------------------------------------------------------- shapes

type ProjectCard = { id: string; name: string; format: string; createdAt: string; updatedAt: string; hasSpec: boolean; thumbnail?: string; durationSeconds?: number };

const cleanValidation = (v: ValidationResult) => {
  const { written: _w, ...rest } = v;
  return rest;
};

const safeTimeline = (spec: SpecInput | null): Timeline | null => {
  if (!spec) return null;
  try {
    return specTimeline(spec);
  } catch {
    return null;
  }
};

const card = (p: { id: string; name: string; format: string; createdAt: string; updatedAt: string; hasSpec: boolean; dir: string }): ProjectCard => {
  const out: ProjectCard = { id: p.id, name: p.name, format: p.format, createdAt: p.createdAt, updatedAt: p.updatedAt, hasSpec: p.hasSpec };
  const thumb = path.join(p.dir, "thumb.jpg");
  if (fs.existsSync(thumb)) out.thumbnail = versioned(fileUrl(p.id, "thumb.jpg"), thumb);
  if (p.hasSpec) {
    try {
      const tl = safeTimeline(readSpec(p.id));
      if (tl) out.durationSeconds = tl.total;
    } catch {
      /* unreadable spec */
    }
  }
  return out;
};

const renderInfo = (projectId: string, r: RenderRecord): RenderInfo => ({
  file: r.file,
  url: fileUrl(projectId, r.file),
  quality: r.quality,
  createdAt: r.createdAt,
  sizeBytes: r.sizeBytes,
  ...(r.seconds !== undefined ? { seconds: r.seconds } : {}),
  ...(r.width !== undefined ? { width: r.width } : {}),
  ...(r.height !== undefined ? { height: r.height } : {}),
  ...(r.format ? { format: r.format } : {}),
});

const assetOut = (projectId: string, a: { file?: string; path: string } & Record<string, unknown>) => {
  const { file: _abs, ...rest } = a;
  return { ...rest, url: fileUrl(projectId, a.path) };
};

// ---------------------------------------------------------------- projects

app.get("/api/projects", (c) => {
  const mine = new Set(listUserProjectIds(userOf(c)));
  return c.json(listProjects().filter((p) => mine.has(p.id)).map(card));
});

app.post("/api/projects", async (c) => {
  const body = await readJson<{ name?: unknown; format?: unknown; template?: unknown }>(c);
  if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "name is required");
  if (body.format !== undefined && (typeof body.format !== "string" || !(body.format in FORMATS))) {
    throw new HttpError(400, `format must be one of ${Object.keys(FORMATS).join(", ")}`);
  }
  if (body.template !== undefined) {
    // Start from a template: its spec + assets are copied in (reflowed when another canvas was picked).
    if (typeof body.template !== "string" || !getTemplate(body.template)) throw new HttpError(400, `Unknown template "${String(body.template)}"`);
    let p;
    try {
      p = await createProjectFromTemplate({ name: body.name.trim(), template: body.template, format: body.format as Format | undefined });
    } catch (e) {
      throw new HttpError(500, (e as Error).message);
    }
    recordProjectOwner(userOf(c), p.id);
    const meta = listProjects().find((x) => x.id === p.id);
    return c.json(card({ ...p, updatedAt: meta?.updatedAt ?? p.createdAt, hasSpec: true }), 201);
  }
  const p = createProject({ name: body.name.trim(), format: body.format as keyof typeof FORMATS | undefined });
  recordProjectOwner(userOf(c), p.id);
  return c.json(card({ ...p, updatedAt: p.createdAt, hasSpec: false }), 201);
});

// ---------------------------------------------------------------- templates

app.get("/api/templates", (c) => c.json(listTemplates()));

app.get("/api/templates/:slug", (c) => {
  const t = getTemplate(c.req.param("slug"));
  if (!t) throw new HttpError(404, `Template "${c.req.param("slug")}" not found`);
  return c.json({ ...t.meta, spec: t.spec });
});

app.get("/api/projects/:id", async (c) => {
  const p = requireProject(c);
  const meta = listProjects().find((x) => x.id === p.id);
  const spec = readSpec(p.id);
  let validation: ReturnType<typeof cleanValidation> | null = null;
  if (spec) {
    try {
      validation = cleanValidation(validateSpec(p.id, spec));
    } catch (e) {
      validation = { ok: false, errors: [(e as Error).message], warnings: [] };
    }
  }
  const assets = (await listAssets(p.id)).map((a) => assetOut(p.id, a));
  return c.json({
    project: { id: p.id, name: p.name, format: p.format, createdAt: p.createdAt, updatedAt: meta?.updatedAt ?? p.createdAt },
    spec,
    assets,
    renders: listRenders(p.id).map((r) => renderInfo(p.id, r)),
    timeline: safeTimeline(spec),
    validation,
  });
});

app.delete("/api/projects/:id", (c) => {
  const p = requireProject(c);
  stopChat(p.id);
  cancelProjectJobs(p.id);
  deleteProject(p.id);
  forgetProject(p.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- spec

const specBody = async (c: Context) => {
  const body = await readJson<{ spec?: unknown }>(c);
  if (body.spec === undefined || body.spec === null) throw new HttpError(400, "spec is required");
  let spec = body.spec;
  if (typeof spec === "string") {
    try {
      spec = JSON.parse(spec);
    } catch (e) {
      throw new HttpError(400, `spec is a string but not valid JSON: ${(e as Error).message}`);
    }
  }
  return spec;
};

app.put("/api/projects/:id/spec", async (c) => {
  const p = requireProject(c);
  const spec = await specBody(c);
  const unsafe = await specSafetyErrors(spec);
  if (unsafe.length) return c.json({ ok: false, errors: unsafe, warnings: [] });
  const res = await writeSpec(p.id, spec);
  const out: Record<string, unknown> = cleanValidation(res);
  if (res.ok) {
    const tl = safeTimeline(readSpec(p.id));
    if (tl) out.timeline = tl;
  }
  return c.json(out);
});

app.post("/api/projects/:id/validate", async (c) => {
  const p = requireProject(c);
  const spec = await specBody(c);
  const unsafe = await specSafetyErrors(spec);
  if (unsafe.length) return c.json({ ok: false, errors: unsafe, warnings: [] });
  const res = validateSpec(p.id, spec);
  const out: Record<string, unknown> = cleanValidation(res);
  if (res.ok) {
    const tl = safeTimeline(spec as SpecInput);
    if (tl) out.timeline = tl;
  }
  return c.json(out);
});

// ---------------------------------------------------------------- assets

app.post("/api/projects/:id/assets", async (c) => {
  const p = requireProject(c);
  const mp = await parseMultipart(c.req.raw, UPLOAD_TMP, { maxBytes: MAX_UPLOAD_BYTES });
  try {
    const f = mp.files.find((x) => x.field === "file") ?? mp.files[0];
    if (!f) throw new HttpError(400, 'multipart field "file" is required');
    const original = path.basename(f.filename || "upload");
    let name = (mp.fields.name ?? "").trim() || original;
    if (!path.extname(name) && path.extname(original)) name += path.extname(original);
    const info = await addAsset(p.id, { path: f.path, name });
    const out: Record<string, unknown> = assetOut(p.id, info);
    if (path.extname(info.file).toLowerCase() === ".svg") {
      try {
        const a = ensureLogoAnalysis(info.file, info.path);
        out.logo = logoSummary(a, {}, path.relative(p.dir, logoJsonPath(info.file)));
      } catch (e) {
        out.logoError = (e as Error).message;
      }
    }
    return c.json(out, 201);
  } finally {
    mp.cleanup();
  }
});

const assetFile = (projectDir: string, raw: string) => {
  const file = decodeURIComponent(raw).replace(/^assets\//, "");
  if (!file || file !== path.basename(file) || file.startsWith(".") || file.includes("\0")) throw new HttpError(400, `Invalid asset name "${file}"`);
  const abs = path.join(projectDir, "assets", file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, `Asset "assets/${file}" not found`);
  return { file, abs };
};

app.delete("/api/projects/:id/assets/:file", (c) => {
  const p = requireProject(c);
  const { file, abs } = assetFile(p.dir, c.req.param("file"));
  if (isLogoJson(file)) throw new HttpError(400, "Delete the SVG asset itself; its .logo.json goes with it");
  fs.rmSync(abs, { force: true });
  fs.rmSync(logoJsonPath(abs), { force: true });
  const metaFile = path.join(p.dir, "assets.meta.json");
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    if (file in meta) {
      delete meta[file];
      const tmp = `${metaFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + "\n");
      fs.renameSync(tmp, metaFile);
    }
  } catch {
    /* no cache yet */
  }
  const stem = file.replace(/[^a-zA-Z0-9._-]/g, "_");
  fs.rmSync(path.join(p.dir, "previews", `logo-${stem}.png`), { force: true });
  return c.json({ ok: true });
});

app.get("/api/projects/:id/logo/:file", async (c) => {
  const p = requireProject(c);
  const { file, abs } = assetFile(p.dir, c.req.param("file"));
  if (path.extname(file).toLowerCase() !== ".svg") throw new HttpError(400, `assets/${file} is not an SVG logo`);
  const info = await getAssetInfo(p.id, file);
  let a;
  try {
    a = ensureLogoAnalysis(abs, info.path);
  } catch (e) {
    throw new HttpError(422, `Logo analysis failed: ${(e as Error).message}`);
  }
  const summary = logoSummary(a, {}, path.relative(p.dir, logoJsonPath(abs)));
  const rel = `previews/logo-${file.replace(/[^a-zA-Z0-9._-]/g, "_")}.png`;
  const png = path.join(p.dir, rel);
  let partMapUrl: string | undefined;
  try {
    const fresh = fs.existsSync(png) && fs.statSync(png).mtimeMs >= fs.statSync(logoJsonPath(abs)).mtimeMs;
    if (!fresh) {
      fs.mkdirSync(path.dirname(png), { recursive: true });
      fs.writeFileSync(png, await renderLogoPreviewPng(a, "bySizeDesc", 768));
    }
    partMapUrl = versioned(fileUrl(p.id, rel), png);
  } catch (e) {
    console.error(`[motion-studio] part map failed for ${info.path}: ${(e as Error).message}`);
  }
  return c.json({ summary, ...(partMapUrl ? { partMapUrl } : {}) });
});

// ---------------------------------------------------------------- preview & render

app.post("/api/projects/:id/preview", async (c) => {
  const p = requireProject(c);
  const body = await readJson<{ times?: unknown; scale?: unknown; individual?: unknown }>(c).catch(() => ({}) as Record<string, unknown>);
  let times: number[] | undefined;
  if (body.times !== undefined) {
    if (!Array.isArray(body.times) || body.times.length > 16 || !body.times.every((t) => typeof t === "number" && Number.isFinite(t) && t >= 0)) {
      throw new HttpError(400, "times must be an array of up to 16 non-negative numbers (seconds)");
    }
    times = body.times as number[];
  }
  let scale: number | undefined;
  if (body.scale !== undefined) {
    if (typeof body.scale !== "number" || !(body.scale >= 0.1 && body.scale <= 1)) throw new HttpError(400, "scale must be a number in 0.1..1");
    scale = body.scale;
  }
  if (!readSpec(p.id)) throw new HttpError(409, "Project has no spec yet");
  const unsafe = await specSafetyErrors(readSpec(p.id));
  if (unsafe.length) throw new HttpError(400, unsafe.join("\n"));
  const run = await runPreview(p.id, { times, scale, individual: body.individual === true, signal: c.req.raw.signal });
  const v = Date.now();
  const rel = (abs: string) => path.relative(p.dir, abs).split(path.sep).join("/");
  return c.json({
    sheetUrl: run.sheet ? `${fileUrl(p.id, rel(run.sheet))}?v=${v}` : null,
    frames: run.frames.map((f) => ({ time: f.time, url: `${fileUrl(p.id, rel(f.path))}?v=${v}`, label: f.label })),
  });
});

const renderBody = async (c: Context) => {
  const body = await readJson<{ quality?: unknown; format?: unknown }>(c).catch(() => ({}) as Record<string, unknown>);
  const quality = body.quality ?? "draft";
  if (quality !== "draft" && quality !== "final") throw new HttpError(400, 'quality must be "draft" or "final"');
  if (body.format !== undefined && (typeof body.format !== "string" || !(body.format in FORMATS))) {
    throw new HttpError(400, `format must be one of ${Object.keys(FORMATS).join(", ")}`);
  }
  return { quality: quality as "draft" | "final", format: body.format as Format | undefined };
};

const renderableSpec = async (projectId: string) => {
  const spec = readSpec(projectId);
  if (!spec) throw new HttpError(409, "Project has no spec yet");
  const unsafe = await specSafetyErrors(spec);
  if (unsafe.length) throw new HttpError(400, unsafe.join("\n"));
  return spec;
};

app.post("/api/projects/:id/render", async (c) => {
  const p = requireProject(c);
  const { quality, format } = await renderBody(c);
  await renderableSpec(p.id);
  const job = enqueueRenderJob({ user: userOf(c), projectId: p.id, quality, ...(format ? { format } : {}) });
  return c.json({ job }, 202);
});

/** Batch export: one job per adapt target (the master format + spec.formats). */
app.post("/api/projects/:id/render-all", async (c) => {
  const p = requireProject(c);
  const { quality } = await renderBody(c);
  const spec = await renderableSpec(p.id);
  const targets = adaptTargets({ ...spec, format: spec.format ?? p.format } as never);
  const user = userOf(c);
  // every job carries its format (the master's reflow is the identity) so queues and filenames say which is which
  const jobs = targets.map((f) => enqueueRenderJob({ user, projectId: p.id, quality, format: f }));
  return c.json({ jobs, formats: targets }, 202);
});

// ---------------------------------------------------------------- jobs

app.get("/api/jobs", (c) => {
  const projectId = c.req.query("projectId");
  const user = userOf(c);
  if (projectId) assertProjectOwner(user, projectId);
  return c.json(listJobs(user, projectId || undefined));
});

app.get("/api/jobs/:id", (c) => c.json(getJobFor(userOf(c), c.req.param("id"))));

app.post("/api/jobs/:id/cancel", (c) => {
  const job = getJobFor(userOf(c), c.req.param("id"));
  return c.json(cancelJob(job.id) ?? job);
});

const jobEventName = (j: Job) => (j.status === "done" ? "done" : isTerminal(j) ? "error" : "progress");

app.get("/api/jobs/:id/events", (c) => {
  const job = getJobFor(userOf(c), c.req.param("id"));
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    const out = sseWriter(stream);
    let finished: () => void = () => undefined;
    const ended = new Promise<void>((r) => (finished = r));
    const sendJob = (e: JobEvent) => {
      out.send(e.type, e.type === "progress" ? { type: "progress", progress: e.progress, stage: e.stage, status: e.job.status, position: e.job.position, job: e.job } : { type: e.type, job: e.job });
      if (e.type !== "progress") finished();
    };
    const unsub = subscribe(job.id, sendJob);
    out.onClose(finished);
    // Current state first (fresh read after subscribing so nothing is missed in between).
    const now = getJobFor(userOf(c), job.id);
    const ev = jobEventName(now);
    sendJob(ev === "progress" ? { type: "progress", progress: now.progress, stage: now.stage, job: now } : { type: ev, job: now } as JobEvent);
    await ended;
    unsub();
    await out.flush();
  });
});

// ---------------------------------------------------------------- chat

app.get("/api/projects/:id/chat", (c) => {
  const p = requireProject(c);
  return c.json(getChat(p.id));
});

app.post("/api/projects/:id/chat", async (c) => {
  const p = requireProject(c);
  const body = await readJson<{ message?: unknown }>(c);
  if (typeof body.message !== "string" || !body.message.trim()) throw new HttpError(400, "message is required");
  if (isRunning(p.id)) throw new HttpError(409, "The director is already working on this project");
  const message = body.message;
  const user = userOf(c);
  return streamSSE(c, async (stream) => {
    const out = sseWriter(stream);
    // The run keeps going if the client disconnects (it is persisted); POST /chat/stop aborts it.
    await runChat(p.id, message, (e: ChatEvent) => out.send(e.type, e), { policy: toolPolicyFor(user) });
    await out.flush();
  });
});

app.post("/api/projects/:id/chat/stop", (c) => {
  const p = requireProject(c);
  stopChat(p.id);
  return c.json({ ok: true });
});

app.delete("/api/projects/:id/chat", (c) => {
  const p = requireProject(c);
  if (isRunning(p.id)) throw new HttpError(409, "Stop the director before clearing the chat");
  clearChat(p.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- settings

app.get("/api/settings", async (c) => c.json(await getSettings()));

app.put("/api/settings", async (c) => {
  if (IS_HOSTED && !isAdmin(userOf(c))) throw new HttpError(403, "Only the server owner can change settings");
  const body = await readJson<{ model?: unknown; effort?: unknown; apiKey?: unknown }>(c);
  try {
    return c.json(await putSettings(body));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

// ---------------------------------------------------------------- personal access tokens

app.get("/api/tokens", (c) => c.json(listTokens(userOf(c))));

app.post("/api/tokens", async (c) => {
  const user = userOf(c);
  const body = await readJson<{ name?: unknown }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) throw new HttpError(400, "name is required (max 80 characters)");
  if (listTokens(user).length >= 50) throw new HttpError(400, "Too many tokens; delete some first");
  return c.json(createToken(user, name));
});

app.delete("/api/tokens/:id", (c) => {
  if (!deleteToken(userOf(c), c.req.param("id"))) throw new HttpError(404, "Token not found");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- connect (Claude)

app.get("/api/connect", (c) => {
  userOf(c);
  const mcpUrl = `${PUBLIC_URL}/mcp`;
  const claudeCodeConfig = JSON.stringify(
    { mcpServers: { "motion-studio": { type: "http", url: mcpUrl, headers: { Authorization: "Bearer <YOUR_MOTION_STUDIO_TOKEN>" } } } },
    null,
    2,
  );
  return c.json({
    mcpUrl,
    publicUrl: PUBLIC_URL,
    claudeCodeConfig,
    claudeCodeCommand: `claude mcp add --transport http motion-studio ${mcpUrl}`,
    steps: [
      "Open claude.ai → Settings → Connectors.",
      "Click “Add custom connector”.",
      `Name it “Motion Studio” and paste the URL ${mcpUrl}`,
      "Click Add, then Connect, and approve access on the Motion Studio consent screen.",
      "In a chat, enable Motion Studio from the tools menu and ask for a video.",
    ],
  });
});

app.all("/api/*", (c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

// ---------------------------------------------------------------- built-in library (public)

/** Generated SFX (scripts/gen-sfx.ts) for the web Player: `libraryBase = ${origin}/library`. Not user data → no auth. */
const LIB_HEADERS = { "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };
app.get("/library/sfx/:file{(recorded/)?[a-z0-9-]+\\.(wav|json)}", (c) => {
  const file = c.req.param("file");
  if (!/^(recorded\/)?[a-z0-9-]+\.(wav|json)$/.test(file)) return c.json({ error: "Not found" }, 404);
  const abs = safeResolve(path.join(LIBRARY_DIR, "sfx"), file);
  const res = abs ? fileResponse(abs, c.req.raw, LIB_HEADERS) : null;
  return res ?? c.json({ error: "Not found" }, 404);
});
/** Planned sound cues: rendered from the recipe in `?r=` on first request, then served from the cache (scripts/sfx-bake.ts). */
app.get("/library/bake/:file", (c) => {
  let abs: string | null = null;
  try {
    abs = ensureBaked(`bake/${c.req.param("file")}`, new URL(c.req.url).searchParams);
  } catch (e) {
    return c.json({ error: `Bad sound recipe: ${(e as Error).message}` }, 400);
  }
  const res = abs ? fileResponse(abs, c.req.raw, { ...LIB_HEADERS, "Cache-Control": "public, max-age=31536000, immutable" }) : null;
  return res ?? c.json({ error: "Not found" }, 404);
});

// ---------------------------------------------------------------- templates (public: posters, assets, glyphs)

app.get("/templates/:slug/*", (c) => {
  const slug = c.req.param("slug");
  const prefix = `/templates/${slug}/`;
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(prefix) + prefix.length));
  } catch {
    return c.json({ error: "Bad path" }, 400);
  }
  const abs = templateFile(slug, rel);
  const sandbox: Record<string, string> = { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", ...(IS_HOSTED ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } : {}) };
  return (abs && fileResponse(abs, c.req.raw, sandbox)) || c.json({ error: "Not found" }, 404);
});

// ---------------------------------------------------------------- files

app.get("/files/:projectId/*", (c) => {
  const id = c.req.param("projectId");
  if (!ID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  try {
    assertProjectOwner(userOf(c), id);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
  const prefix = `/files/${id}/`;
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(prefix) + prefix.length));
  } catch {
    return c.json({ error: "Bad path" }, 400);
  }
  const root = path.join(PROJECTS_DIR, id);
  const abs = safeResolve(root, rel);
  if (!abs) return c.json({ error: "Forbidden" }, 403);
  // User files are never rendered as active documents on our origin (an uploaded SVG / HTML can't script the app).
  const sandbox: Record<string, string> = IS_HOSTED ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" } : {};
  return fileResponse(abs, c.req.raw, sandbox) ?? c.json({ error: "Not found" }, 404);
});

// ---------------------------------------------------------------- web app (production build)

app.get("*", (c) => {
  if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) {
    return c.text("Motion Studio API is running. The web app is not built: run `pnpm build:web` (or `pnpm dev` for development).", 404);
  }
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path);
  } catch {
    rel = "/";
  }
  const abs = rel !== "/" ? safeResolve(WEB_DIST, rel) : null;
  if (abs) {
    const immutable: Record<string, string> = rel.startsWith("/assets/") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {};
    const res = fileResponse(abs, c.req.raw, immutable);
    if (res) return res;
    if (path.extname(rel)) return c.json({ error: "Not found" }, 404);
  }
  return fileResponse(path.join(WEB_DIST, "index.html"), c.req.raw) ?? c.text("index.html missing", 500);
});

// ---------------------------------------------------------------- start

export { app };

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isMain) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const owned = syncProjectOwnership();
  if (owned.assigned.length) console.error(`[motion-studio] assigned ${owned.assigned.length} unowned project folder(s) to the ${IS_HOSTED ? "first account" : "local owner"}`);
  initJobs();
  ensureSfxLibrary();
  if (IS_HOSTED && !process.env.MOTION_STUDIO_PUBLIC_URL) console.error(`[motion-studio] WARNING: hosted mode without MOTION_STUDIO_PUBLIC_URL (using ${PUBLIC_URL}); OAuth / links will be wrong`);
  if (IS_HOSTED && !PUBLIC_URL.startsWith("https://")) console.error("[motion-studio] WARNING: hosted mode over plain http: session cookies are not marked Secure");
  const be = backendError(RENDER_BACKEND);
  if (be) console.error(`[motion-studio] WARNING: render backend "${RENDER_BACKEND}" is not usable: ${be}`);
  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.error(
      `[motion-studio] server on http://${HOST}:${info.port} · mode ${MODE} · public ${PUBLIC_URL} · renders ${RENDER_BACKEND}${remoteMcp ? " · remote MCP /mcp" : ""} (projects: ${PROJECTS_DIR}${fs.existsSync(WEB_DIST) ? ", serving web/dist" : ""})`,
    );
  });
  const shutdown = () => {
    console.error("[motion-studio] shutting down");
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
