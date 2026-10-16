/**
 * Motion Studio web server (Hono on Node): the HTTP API of docs/WEB_API.md, /files static serving for project
 * folders, the in-app AI director (SSE), and the built web app (web/dist) with SPA fallback.
 *   pnpm server   →   http://127.0.0.1:${MOTION_STUDIO_PORT ?? 4310}
 */
import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { serve } from "@hono/node-server";
import { ROOT, PROJECTS_DIR } from "../core/paths";
import { FORMATS, type SpecInput } from "../engine/spec/schema";
import { addAsset, createProject, deleteProject, getAssetInfo, getProject, listAssets, listProjects, readSpec, validateSpec, writeSpec, type ValidationResult } from "../core/projects";
import { ensureLogoAnalysis, isLogoJson, logoJsonPath, logoSummary, renderLogoPreviewPng } from "../core/logo";
import { listRenders, runPreview, runRender, specTimeline, type RenderRecord, type Timeline } from "../core/tools";
import { clearChat, fileUrl, getChat, isRunning, runChat, stopChat, type ChatEvent, type RenderInfo } from "./agent";
import { fileResponse, safeResolve } from "./files";
import { HttpError, parseMultipart } from "./multipart";
import { getSettings, putSettings } from "./settings";

const PORT = Number(process.env.MOTION_STUDIO_PORT ?? 4310);
const HOST = "127.0.0.1";
const WEB_DIST = path.resolve(process.env.MOTION_STUDIO_WEB_DIST || path.join(ROOT, "web", "dist"));
const UPLOAD_TMP = path.join(PROJECTS_DIR, ".uploads");
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1", ...(process.env.MOTION_STUDIO_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);

const app = new Hono();

// ---------------------------------------------------------------- guards & errors

/** DNS-rebinding / CSRF guard: only local Host headers; state-changing requests from foreign origins are refused. */
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
  if (origin && c.req.method !== "GET" && c.req.method !== "HEAD") {
    let ok = false;
    try {
      ok = ALLOWED_HOSTS.has(new URL(origin).hostname);
    } catch {
      ok = false;
    }
    if (!ok) return c.json({ error: "Forbidden origin" }, 403);
  }
  await next();
});

app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message }, e.status as 400);
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[motion-studio] ${c.req.method} ${c.req.path}: ${e instanceof Error ? e.stack : msg}`);
  return c.json({ error: msg }, 500);
});

app.notFound((c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

const requireProject = (id: string) => {
  if (!ID_RE.test(id)) throw new HttpError(404, `Project "${id}" not found`);
  try {
    return getProject(id);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
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
});

const assetOut = (projectId: string, a: { file?: string; path: string } & Record<string, unknown>) => {
  const { file: _abs, ...rest } = a;
  return { ...rest, url: fileUrl(projectId, a.path) };
};

// ---------------------------------------------------------------- projects

app.get("/api/projects", (c) => c.json(listProjects().map(card)));

app.post("/api/projects", async (c) => {
  const body = await readJson<{ name?: unknown; format?: unknown }>(c);
  if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "name is required");
  if (body.format !== undefined && (typeof body.format !== "string" || !(body.format in FORMATS))) {
    throw new HttpError(400, `format must be one of ${Object.keys(FORMATS).join(", ")}`);
  }
  const p = createProject({ name: body.name.trim(), format: body.format as keyof typeof FORMATS | undefined });
  return c.json(card({ ...p, updatedAt: p.createdAt, hasSpec: false }), 201);
});

app.get("/api/projects/:id", async (c) => {
  const p = requireProject(c.req.param("id"));
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
  const p = requireProject(c.req.param("id"));
  stopChat(p.id);
  deleteProject(p.id);
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
  const p = requireProject(c.req.param("id"));
  const spec = await specBody(c);
  const res = await writeSpec(p.id, spec);
  const out: Record<string, unknown> = cleanValidation(res);
  if (res.ok) {
    const tl = safeTimeline(readSpec(p.id));
    if (tl) out.timeline = tl;
  }
  return c.json(out);
});

app.post("/api/projects/:id/validate", async (c) => {
  const p = requireProject(c.req.param("id"));
  const spec = await specBody(c);
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
  const p = requireProject(c.req.param("id"));
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
  const p = requireProject(c.req.param("id"));
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
  const p = requireProject(c.req.param("id"));
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
  const p = requireProject(c.req.param("id"));
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
  const run = await runPreview(p.id, { times, scale, individual: body.individual === true, signal: c.req.raw.signal });
  const v = Date.now();
  const rel = (abs: string) => path.relative(p.dir, abs).split(path.sep).join("/");
  return c.json({
    sheetUrl: run.sheet ? `${fileUrl(p.id, rel(run.sheet))}?v=${v}` : null,
    frames: run.frames.map((f) => ({ time: f.time, url: `${fileUrl(p.id, rel(f.path))}?v=${v}`, label: f.label })),
  });
});

/** SSE writer that never throws once the client is gone, plus a keep-alive comment every 15s. */
const sseWriter = (stream: SSEStreamingApi) => {
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  stream.onAbort(() => {
    closed = true;
  });
  const ping = setInterval(() => {
    if (!closed) chain = chain.then(() => stream.write(": ping\n\n").then(() => undefined)).catch(() => undefined);
  }, 15_000);
  return {
    send: (event: string, data: object) => {
      if (closed) return;
      chain = chain.then(() => stream.writeSSE({ event, data: JSON.stringify(data) })).catch(() => {
        closed = true;
      });
    },
    get closed() {
      return closed;
    },
    flush: async () => {
      clearInterval(ping);
      await chain;
    },
  };
};

app.post("/api/projects/:id/render", async (c) => {
  const p = requireProject(c.req.param("id"));
  const body = await readJson<{ quality?: unknown }>(c).catch(() => ({}) as Record<string, unknown>);
  const quality = body.quality ?? "draft";
  if (quality !== "draft" && quality !== "final") throw new HttpError(400, 'quality must be "draft" or "final"');
  if (!readSpec(p.id)) throw new HttpError(409, "Project has no spec yet");
  return streamSSE(c, async (stream) => {
    const out = sseWriter(stream);
    // Closing the request (e.g. the UI aborts the fetch) cancels the render.
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    let last = -1;
    out.send("progress", { type: "progress", progress: 0, stage: "starting" });
    try {
      const { record } = await runRender(p.id, {
        quality,
        signal: ac.signal,
        onWait: () => out.send("progress", { type: "progress", progress: 0, stage: "queued" }),
        onProgress: (pr) => {
          const pct = Math.floor(pr.progress * 100);
          if (pct === last) return;
          last = pct;
          out.send("progress", { type: "progress", progress: pr.progress, stage: pr.stage, renderedFrames: pr.renderedFrames, encodedFrames: pr.encodedFrames });
        },
      });
      out.send("done", { type: "done", render: renderInfo(p.id, record) });
    } catch (e) {
      out.send("error", { type: "error", message: ac.signal.aborted ? "Render cancelled" : (e as Error).message });
    }
    await out.flush();
  });
});

// ---------------------------------------------------------------- chat

app.get("/api/projects/:id/chat", (c) => {
  const p = requireProject(c.req.param("id"));
  return c.json(getChat(p.id));
});

app.post("/api/projects/:id/chat", async (c) => {
  const p = requireProject(c.req.param("id"));
  const body = await readJson<{ message?: unknown }>(c);
  if (typeof body.message !== "string" || !body.message.trim()) throw new HttpError(400, "message is required");
  if (isRunning(p.id)) throw new HttpError(409, "The director is already working on this project");
  const message = body.message;
  return streamSSE(c, async (stream) => {
    const out = sseWriter(stream);
    // The run keeps going if the client disconnects (it is persisted); POST /chat/stop aborts it.
    await runChat(p.id, message, (e: ChatEvent) => out.send(e.type, e));
    await out.flush();
  });
});

app.post("/api/projects/:id/chat/stop", (c) => {
  const p = requireProject(c.req.param("id"));
  stopChat(p.id);
  return c.json({ ok: true });
});

app.delete("/api/projects/:id/chat", (c) => {
  const p = requireProject(c.req.param("id"));
  if (isRunning(p.id)) throw new HttpError(409, "Stop the director before clearing the chat");
  clearChat(p.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- settings

app.get("/api/settings", async (c) => c.json(await getSettings()));

app.put("/api/settings", async (c) => {
  const body = await readJson<{ model?: unknown; effort?: unknown; apiKey?: unknown }>(c);
  try {
    return c.json(await putSettings(body));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

app.all("/api/*", (c) => c.json({ error: `Not found: ${c.req.method} ${c.req.path}` }, 404));

// ---------------------------------------------------------------- files

app.get("/files/:projectId/*", (c) => {
  const id = c.req.param("projectId");
  if (!ID_RE.test(id)) return c.json({ error: "Not found" }, 404);
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
  return fileResponse(abs, c.req.raw) ?? c.json({ error: "Not found" }, 404);
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
  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.error(`[motion-studio] server on http://${HOST}:${info.port} (projects: ${PROJECTS_DIR}${fs.existsSync(WEB_DIST) ? ", serving web/dist" : ""})`);
  });
  const shutdown = () => {
    console.error("[motion-studio] shutting down");
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
