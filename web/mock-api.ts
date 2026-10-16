/**
 * DEV-ONLY mock of the server (docs/WEB_API.md + docs/PLATFORM.md), enabled with `MOCK_API=1 pnpm web`.
 * `MOCK_MODE=hosted` requires sign-in (seeded account: demo@motion.studio / motion-demo); default is `local`
 * (auto-signed-in owner). Phase 3 routes: auth, tokens, jobs (+SSE), connect, OAuth consent decision.
 * Reads the real ../projects folder (read-only); every mutation lives in memory. The chat endpoint streams a
 * scripted director run so the SSE UI can be exercised without an API key. Never used in production builds.
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { SpecSchema } from "../src/engine/spec/schema.ts";
import { preprocessSpecDetailed, sceneTimeline, sceneIndexOf } from "../src/engine/spec/preprocess.ts";
import { adaptTargets, reflowSpec, type Format } from "../src/engine/spec/reflow.ts";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".json": "application/json",
};
const kindOf = (f: string) => {
  const e = path.extname(f).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(e)) return "image";
  if ([".mp4", ".webm", ".mov"].includes(e)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(e)) return "audio";
  if (e === ".json" || e === ".lottie") return "lottie";
  return "other";
};

export const mockApi = (repoRoot: string): Plugin => {
  const root = path.join(repoRoot, "projects");
  const tplRoot = path.join(repoRoot, "templates");
  /** projects created from a template: id → slug (their assets are served from templates/<slug>/) */
  const fromTemplate = new Map<string, string>();
  const mem = {
    created: new Map<string, Json>(),
    deleted: new Set<string>(),
    specs: new Map<string, Json>(),
    uploads: new Map<string, Map<string, { buf: Buffer; type: string }>>(),
    deletedAssets: new Set<string>(),
    chats: new Map<string, Json[]>(),
    running: new Map<string, { stop: boolean }>(),
    settings: { model: "claude-opus-4-5", effort: "high", apiKey: process.env.MOCK_KEY ? "sk-mock" : "" },
  };
  // ---- Phase 3 state
  const mode: "local" | "hosted" = process.env.MOCK_MODE === "hosted" ? "hosted" : "local";
  const publicUrl = "http://localhost:5173";
  type User = { id: string; email: string; name: string; password: string };
  const users = new Map<string, User>();
  const LOCAL: User = { id: "u_local", email: "local@motion.studio", name: "Local owner", password: "" };
  users.set("u_demo", { id: "u_demo", email: "demo@motion.studio", name: "Dana Reyes", password: "motion-demo" });
  const sessions = new Map<string, string>();
  const tokens: { id: string; userId: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }[] = [
    { id: "tok_1", userId: "u_demo", name: "Claude Code — laptop", prefix: "ms_pat_7f", createdAt: new Date(Date.now() - 86400e3 * 9).toISOString(), lastUsedAt: new Date(Date.now() - 3600e3 * 3).toISOString() },
    { id: "tok_2", userId: LOCAL.id, name: "CI preview bot", prefix: "ms_pat_c2", createdAt: new Date(Date.now() - 86400e3 * 30).toISOString(), lastUsedAt: null },
  ];
  type Job = Json;
  const jobs = new Map<string, Job>();
  const jobSubs = new Map<string, Set<(ev: string, data: unknown) => void>>();
  const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name });
  const cookieSid = (req: IncomingMessage) => /(?:^|;\s*)ms_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  const currentUser = (req: IncomingMessage): User | null => {
    if (mode === "local") return LOCAL;
    const sid = cookieSid(req);
    const uid = sid ? sessions.get(sid) : undefined;
    return uid ? users.get(uid) ?? null : null;
  };
  const startSession = (res: ServerResponse, u: User) => {
    const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.set(sid, u.id);
    res.setHeader("set-cookie", `ms_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  };
  const jobEmit = (j: Job, ev: string) => jobSubs.get(j.id)?.forEach((f) => f(ev, ev === "progress" ? { progress: j.progress, stage: j.stage, position: j.position, status: j.status } : { job: j }));
  const queuePositions = () => {
    let n = 0;
    for (const j of [...jobs.values()].filter((x) => x.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))) { j.position = ++n; jobEmit(j, "progress"); }
  };
  let working = false;
  const pump = async () => {
    if (working) return;
    const next = [...jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return;
    working = true;
    next.status = "running"; next.startedAt = new Date().toISOString(); delete next.position; next.stage = "bundling";
    queuePositions();
    jobEmit(next, "progress");
    const steps = next.quality === "final" ? 60 : 32;
    for (let i = 1; i <= steps && next.status === "running"; i++) {
      await sleep(220);
      if (next.status !== "running") break;
      next.progress = i / (steps + 1);
      next.stage = i < 4 ? "bundling" : i < steps - 3 ? "rendering frames" : "encoding";
      jobEmit(next, "progress");
    }
    if (next.status === "running") {
      const r = rendersOf(next.projectId)[0];
      next.finishedAt = new Date().toISOString();
      if (r && !/fail/i.test(next.projectId)) {
        next.status = "done"; next.progress = 1; next.stage = "done";
        const dims: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "21:9": [2520, 1080] };
        const [w, h] = dims[next.format ?? "9:16"] ?? [1080, 1920];
        const k = next.quality === "final" ? 1 : 0.5;
        next.output = { ...r, quality: next.quality, createdAt: next.finishedAt, seconds: 11.8, width: w * k, height: h * k, ...(next.format ? { format: next.format } : {}) };
        jobEmit(next, "done");
      } else {
        next.status = "error"; next.error = "Render failed: Chrome exited with code 1";
        jobEmit(next, "error");
      }
    }
    working = false;
    void pump();
  };

  const readJson = (p: string) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const ls = (p: string) => { try { return fs.readdirSync(p); } catch { return []; } };
  const projectIds = () => [...ls(root).filter((d) => fs.existsSync(path.join(root, d, "project.json"))), ...mem.created.keys()].filter((id) => !mem.deleted.has(id));
  const meta = (id: string) => mem.created.get(id) ?? readJson(path.join(root, id, "project.json"));
  const specOf = (id: string) => (mem.specs.has(id) ? mem.specs.get(id) : readJson(path.join(root, id, "spec.json")));

  const validate = (spec: Json) => {
    const pre = preprocessSpecDetailed(spec);
    const r = SpecSchema.safeParse(pre.spec);
    if (!r.success || pre.errors.length) {
      return { ok: false, errors: [...pre.errors, ...(r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`))], warnings: [] };
    }
    const s = r.data;
    const tl = sceneTimeline(s.scenes, s.fps);
    const slots = tl.scenes;
    const total = tl.totalFrames / s.fps;
    const warnings: string[] = [];
    s.scenes.forEach((sc, i) => {
      if (sc.duration > 4) warnings.push(`craft/pacing: scene ${sc.id ?? i} holds ${sc.duration}s — reels feel tighter under 3.5s per beat`);
      if (!sc.layers.length) warnings.push(`scenes.${i}: scene has no layers`);
    });
    if (!s.audio) warnings.push("craft/sound: no music track — motion lands harder on a beat grid (add audio + analyze_audio)");
    const timeline = {
      total,
      scenes: slots.map((sl) => ({ index: sl.index, id: sl.id, start: sl.start, end: sl.end, duration: sl.end - sl.start, overlapIn: sl.overlapIn, transition: s.scenes[sl.index].transition?.type })),
      actors: (s.actors ?? []).map((a) => {
        const fi = Math.max(0, sceneIndexOf(s.scenes, a.from ?? a.poses[0].scene));
        const ui = a.until == null ? slots.length - 1 : Math.max(0, sceneIndexOf(s.scenes, a.until));
        return { id: a.id, from: slots[fi].start, until: slots[ui].end };
      }),
    };
    return { ok: true, durationSeconds: total, warnings, timeline };
  };

  const assetsOf = (id: string) => {
    const dir = path.join(root, id, "assets");
    const m = readJson(path.join(root, id, "assets.meta.json")) ?? {};
    const out: Json[] = [];
    for (const f of ls(dir)) {
      if (f.endsWith(".logo.json") || mem.deletedAssets.has(`${id}/${f}`)) continue;
      const st = fs.statSync(path.join(dir, f));
      if (!st.isFile()) continue;
      out.push({ path: `assets/${f}`, kind: kindOf(f), sizeBytes: st.size, ...(m[f]?.info ?? {}), url: `/files/${id}/assets/${f}` });
    }
    for (const [f, u] of mem.uploads.get(id) ?? []) out.push({ path: `assets/${f}`, kind: kindOf(f), sizeBytes: u.buf.length, url: `/files/${id}/assets/${f}`, ...(kindOf(f) === "audio" ? { duration: 31.4 } : {}) });
    return out.map(({ file: _f, ...a }) => a);
  };
  const rendersOf = (id: string) =>
    ls(path.join(root, id, "renders")).filter((f) => f.endsWith(".mp4")).sort().reverse().map((f) => {
      const st = fs.statSync(path.join(root, id, "renders", f));
      const m = /^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)-(draft|final)/.exec(f);
      return { file: `renders/${f}`, url: `/files/${id}/renders/${f}`, quality: m?.[5] ?? "final", createdAt: m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`).toISOString() : st.mtime.toISOString(), sizeBytes: st.size };
    });
  const card = (id: string) => {
    const m = meta(id);
    const spec = specOf(id);
    const v = spec ? validate(spec) : null;
    const prev = ls(path.join(root, id, "previews")).filter((f) => f.endsWith(".jpg"));
    const thumb = prev.find((f) => f.startsWith("frame-")) ?? prev[0];
    let updatedAt = m.updatedAt ?? m.createdAt;
    try { updatedAt = fs.statSync(path.join(root, id, "spec.json")).mtime.toISOString(); } catch { /* new */ }
    return { id, name: m.name, format: m.format ?? spec?.format ?? "16:9", createdAt: m.createdAt, updatedAt, hasSpec: !!spec, ...(thumb ? { thumbnail: `/files/${id}/previews/${thumb}` } : {}), ...(v?.ok ? { durationSeconds: v.durationSeconds } : {}) };
  };

  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  const body = (req: IncomingMessage) => new Promise<Buffer>((ok) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const sse = (res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ---- template gallery (templates/<slug>/{template.json, spec.json, assets/, poster.jpg})
  const templateMeta = (slug: string) => {
    const m = readJson(path.join(tplRoot, slug, "template.json"));
    const spec = readJson(path.join(tplRoot, slug, "spec.json"));
    if (!m || !spec) return null;
    const poster = fs.existsSync(path.join(tplRoot, slug, "poster.jpg")) ? `/templates/${slug}/poster.jpg` : undefined;
    return { slug, title: m.title, niche: m.niche, description: m.description, format: m.format, formats: adaptTargets({ format: m.format, formats: spec.formats }), durationSeconds: m.durationSeconds, tags: m.tags ?? [], order: m.order ?? 999, ...(poster ? { poster } : {}) };
  };
  const templates = () => ls(tplRoot).filter((d) => /^[a-z0-9][a-z0-9-]*$/.test(d)).map(templateMeta).filter(Boolean)
    .sort((a: Json, b: Json) => a.order - b.order).map(({ order: _o, ...m }: Json) => m);

  const serveFile = (req: IncomingMessage, res: ServerResponse, id: string, rel: string, base = path.join(root, id)) => {
    const up = mem.uploads.get(id)?.get(rel.replace(/^assets\//, ""));
    if (up && rel.startsWith("assets/")) { res.setHeader("content-type", up.type); res.end(up.buf); return; }
    if (fromTemplate.has(id) && base === path.join(root, id)) base = path.join(tplRoot, fromTemplate.get(id)!);
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: "not found" });
    const size = fs.statSync(file).size;
    res.setHeader("content-type", TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("accept-ranges", "bytes");
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.setHeader("content-length", size);
      fs.createReadStream(file).pipe(res);
    }
  };

  const runChat = async (id: string, message: string, res: ServerResponse) => {
    const emit = sse(res);
    const ctl = { stop: false };
    mem.running.set(id, ctl);
    const hist = mem.chats.get(id) ?? [];
    hist.push({ id: `u${Date.now()}`, role: "user", createdAt: new Date().toISOString(), parts: [{ type: "text", text: message }] });
    const asst: Json = { id: `a${Date.now()}`, role: "assistant", createdAt: new Date().toISOString(), parts: [] };
    hist.push(asst);
    mem.chats.set(id, hist);
    const say = async (text: string, kind: "text" | "thinking" = "text") => {
      const last = asst.parts[asst.parts.length - 1];
      const part = last?.type === kind ? last : (asst.parts.push({ type: kind, text: "" }), asst.parts[asst.parts.length - 1]);
      for (const w of text.match(/\S+\s*/g) ?? []) {
        if (ctl.stop) return;
        part.text += w;
        emit(kind, { type: kind, delta: w });
        await sleep(28);
      }
    };
    const tool = async (tid: string, name: string, start: string, end: string, ms: number, images?: string[]) => {
      if (ctl.stop) return;
      emit("tool_start", { type: "tool_start", id: tid, name, summary: start });
      await sleep(ms);
      asst.parts.push({ type: "tool", name, summary: end, ok: true, ...(images ? { images } : {}) });
      emit("tool_end", { type: "tool_end", id: tid, ok: true, summary: end, ...(images ? { images } : {}) });
    };
    emit("status", { type: "status", text: "Thinking…" });
    await sleep(500);
    await say("The brief wants energy up front and a clean brand payoff. I'll keep the coin as the motif actor and tighten the hook to land on the first downbeat.", "thinking");
    await tool("t1", "get_spec", "Reading spec", "Read spec · 4 scenes · 11.8s", 600);
    const spec = specOf(id);
    if (spec && !ctl.stop) {
      emit("status", { type: "status", text: "Writing spec…" });
      await tool("t2", "set_spec", `Writing spec · ${spec.scenes?.length ?? 0} scenes`, `Spec saved · ${spec.scenes?.length ?? 0} scenes`, 900);
      const v = validate(spec);
      if (v.ok) emit("spec", { type: "spec", spec, timeline: v.timeline });
      const prev = ls(path.join(root, id, "previews")).filter((f) => f.startsWith("frame-")).slice(0, 3).map((f) => `/files/${id}/previews/${f}`);
      emit("status", { type: "status", text: "Rendering preview…" });
      await tool("t3", "preview_frames", "Previewing 3 frames", "Looked at 3 frames", 1400, prev);
    }
    await say(`Here's the pass:\n\n- **Hook** now lands at \`0.4s\` — the coin slams in with *drop-in-3d* and inertia.\n- The **split** uses an \`expand\` transition from the coin, so the cut feels like one continuous move.\n- Lockup cascades the wordmark after the icon snaps into place.\n\nWant me to render a draft, or push the color script warmer first?`);
    if (ctl.stop) emit("error", { type: "error", message: "Stopped" });
    emit("done", { type: "done" });
    mem.running.delete(id);
    res.end();
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const m = req.method ?? "GET";
    let g: RegExpExecArray | null;
    try {
      if ((g = /^\/files\/([^/]+)\/(.+)$/.exec(p))) return serveFile(req, res, decodeURIComponent(g[1]), decodeURIComponent(g[2]));
      if ((g = /^\/templates\/([a-z0-9-]+)\/(.+)$/.exec(p))) return serveFile(req, res, `tpl:${g[1]}`, decodeURIComponent(g[2]), path.join(tplRoot, g[1]));
      if (p === "/oauth/authorize/decision" && m === "POST") {
        const u = currentUser(req);
        if (!u) return send(res, 401, { error: "login_required" });
        if (req.headers.authorization) return send(res, 400, { error: "invalid_request", error_description: "Authorization header not accepted here" });
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { error: "invalid_request", error_description: "Origin mismatch" });
        const b = JSON.parse((await body(req)).toString() || "{}");
        if (!b.redirect_uri) return send(res, 400, { error: "redirect_uri is required" });
        const target = new URL(b.redirect_uri);
        if (b.approve) target.searchParams.set("code", `mock_code_${Date.now().toString(36)}`);
        else target.searchParams.set("error", "access_denied");
        if (b.state) target.searchParams.set("state", b.state);
        return send(res, 200, { redirect: target.toString() });
      }
      if (!p.startsWith("/api/")) return next();
      // job events stream immediately (no artificial latency)
      if ((g = /^\/api\/jobs\/([^/]+)\/events$/.exec(p))) {
        const j = jobs.get(decodeURIComponent(g[1]));
        if (!j) return send(res, 404, { error: "No such job" });
        const emit = sse(res);
        const fin = j.status === "done" ? "done" : j.status === "error" || j.status === "canceled" ? "error" : null;
        emit("progress", { progress: j.progress, stage: j.stage, position: j.position, status: j.status });
        if (fin) { emit(fin, { job: j }); return res.end(); }
        const subs = jobSubs.get(j.id) ?? new Set();
        const f = (ev: string, data: unknown) => { emit(ev, data); if (ev !== "progress") { subs.delete(f); res.end(); } };
        subs.add(f);
        jobSubs.set(j.id, subs);
        req.on("close", () => subs.delete(f));
        return;
      }
      await sleep(120 + Math.random() * 160); // feel the loading states
      if (p === "/api/auth/me") { const u = currentUser(req); return send(res, 200, { user: u ? publicUser(u) : null, mode, publicUrl }); }
      if (p === "/api/auth/login" && m === "POST") {
        if (mode === "local") return send(res, 200, { user: publicUser(LOCAL) });
        const b = JSON.parse((await body(req)).toString() || "{}");
        const u = [...users.values()].find((x) => x.email.toLowerCase() === String(b.email ?? "").trim().toLowerCase());
        await sleep(300);
        if (!u || u.password !== b.password) return send(res, 401, { error: "Email or password is incorrect" });
        startSession(res, u);
        return send(res, 200, { user: publicUser(u) });
      }
      if (p === "/api/auth/signup" && m === "POST") {
        if (mode === "local") return send(res, 403, { error: "Sign-up is disabled in local mode" });
        const b = JSON.parse((await body(req)).toString() || "{}");
        const email = String(b.email ?? "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: "Enter a valid email address" });
        if (String(b.password ?? "").length < 8) return send(res, 400, { error: "Password must be at least 8 characters" });
        if ([...users.values()].some((x) => x.email === email)) return send(res, 409, { error: "An account with this email already exists" });
        const u: User = { id: `u_${Date.now().toString(36)}`, email, name: String(b.name ?? "").trim() || email.split("@")[0], password: String(b.password) };
        users.set(u.id, u);
        startSession(res, u);
        return send(res, 200, { user: publicUser(u) });
      }
      if (p === "/api/auth/logout" && m === "POST") {
        const sid = cookieSid(req);
        if (sid) sessions.delete(sid);
        res.setHeader("set-cookie", "ms_session=; Path=/; HttpOnly; Max-Age=0");
        return send(res, 200, { ok: true });
      }
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: "Sign in required" });
      if (p === "/api/tokens") {
        if (m === "POST") {
          const b = JSON.parse((await body(req)).toString() || "{}");
          const secret = `ms_pat_${[...Array(40)].map(() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")}`;
          const t = { id: `tok_${Date.now().toString(36)}`, userId: user.id, name: String(b.name || "Untitled token").slice(0, 60), prefix: secret.slice(0, 9), createdAt: new Date().toISOString(), lastUsedAt: null };
          tokens.unshift(t);
          return send(res, 200, { token: secret, id: t.id, name: t.name, prefix: t.prefix });
        }
        return send(res, 200, tokens.filter((t) => t.userId === user.id).map(({ userId: _u, ...t }) => t));
      }
      if ((g = /^\/api\/tokens\/([^/]+)$/.exec(p)) && m === "DELETE") {
        const i = tokens.findIndex((t) => t.id === decodeURIComponent(g![1]) && t.userId === user.id);
        if (i < 0) return send(res, 404, { error: "No such token" });
        tokens.splice(i, 1);
        return send(res, 200, { ok: true });
      }
      if (p === "/api/connect") {
        return send(res, 200, {
          mcpUrl: `${publicUrl}/mcp`, publicUrl,
          claudeCodeConfig: JSON.stringify({ mcpServers: { "motion-studio": { type: "http", url: `${publicUrl}/mcp`, headers: { Authorization: "Bearer <YOUR_TOKEN>" } } } }, null, 2),
          steps: [
            "Open claude.ai → Settings → Connectors.",
            "Choose “Add custom connector”.",
            `Paste ${publicUrl}/mcp as the URL and name it Motion Studio.`,
            "Click Connect, then Approve on the Motion Studio consent screen.",
            "In a chat, enable Motion Studio from the tools menu and brief it.",
          ],
        });
      }
      if (p === "/api/jobs") {
        const pid = url.searchParams.get("projectId");
        return send(res, 200, [...jobs.values()].filter((j) => !pid || j.projectId === pid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }
      if ((g = /^\/api\/jobs\/([^/]+)(\/cancel)?$/.exec(p))) {
        const j = jobs.get(decodeURIComponent(g[1]));
        if (!j) return send(res, 404, { error: "No such job" });
        if (g[2] && m === "POST" && (j.status === "queued" || j.status === "running")) {
          j.status = "canceled"; j.finishedAt = new Date().toISOString(); delete j.position;
          jobEmit(j, "error");
          queuePositions();
        }
        return send(res, 200, j);
      }
      if (p === "/api/settings") {
        if (m === "PUT") {
          const b = JSON.parse((await body(req)).toString() || "{}");
          Object.assign(mem.settings, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
        }
        const s = mem.settings;
        return send(res, 200, { model: s.model, effort: s.effort, hasApiKey: !!s.apiKey, keySource: s.apiKey ? "settings" : "none", models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"] });
      }
      if (p === "/api/templates") return send(res, 200, templates());
      if ((g = /^\/api\/templates\/([a-z0-9-]+)$/.exec(p))) {
        const t = templateMeta(g[1]);
        if (!t) return send(res, 404, { error: `Template "${g[1]}" not found` });
        const { order: _o, ...meta } = t;
        return send(res, 200, { ...meta, spec: readJson(path.join(tplRoot, g[1], "spec.json")) });
      }
      if (p === "/api/projects") {
        if (m === "POST") {
          const b = JSON.parse((await body(req)).toString() || "{}");
          const id = `${String(b.name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Math.random().toString(16).slice(2, 6)}`;
          const now = new Date().toISOString();
          const tpl = b.template ? templateMeta(String(b.template)) : null;
          if (b.template && !tpl) return send(res, 400, { error: `Unknown template "${b.template}"` });
          const format = b.format ?? tpl?.format ?? "16:9";
          mem.created.set(id, { id, name: b.name || "Untitled", format, createdAt: now, updatedAt: now });
          if (tpl) {
            // copy the template film in (reflowed when another canvas was picked), assets served from templates/<slug>
            let spec = readJson(path.join(tplRoot, tpl.slug, "spec.json"));
            if (format !== tpl.format) {
              const parsed = SpecSchema.parse(preprocessSpecDetailed({ ...spec, format: tpl.format }).spec);
              spec = { ...reflowSpec(parsed, format as Format), formats: tpl.formats.filter((f: string) => f !== format) };
            }
            mem.specs.set(id, spec);
            fromTemplate.set(id, tpl.slug);
          }
          return send(res, 200, card(id));
        }
        return send(res, 200, projectIds().map(card).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      }
      if (!(g = /^\/api\/projects\/([^/]+)(\/.*)?$/.exec(p))) return send(res, 404, { error: "not found" });
      const id = decodeURIComponent(g[1]);
      const sub = g[2] ?? "";
      if (!projectIds().includes(id)) return send(res, 404, { error: `No project ${id}` });
      if (sub === "") {
        if (m === "DELETE") { mem.deleted.add(id); return send(res, 200, { ok: true }); }
        const spec = specOf(id);
        const v = spec ? validate(spec) : null;
        const { timeline, ...validation } = (v ?? {}) as Json;
        const mt = meta(id);
        return send(res, 200, { project: { id, name: mt.name, format: mt.format, createdAt: mt.createdAt, updatedAt: card(id).updatedAt }, spec, assets: assetsOf(id), renders: rendersOf(id), timeline: timeline ?? null, validation: v ? validation : null });
      }
      if (sub === "/spec" || sub === "/validate") {
        const b = JSON.parse((await body(req)).toString() || "{}");
        const v = validate(b.spec);
        if (sub === "/spec" && v.ok) mem.specs.set(id, b.spec);
        return send(res, 200, v);
      }
      if (sub === "/assets" && m === "POST") {
        const buf = await body(req);
        const boundary = /boundary=(.+)$/.exec(req.headers["content-type"] ?? "")?.[1];
        if (!boundary) return send(res, 400, { error: "multipart expected" });
        const head = buf.indexOf("\r\n\r\n");
        const header = buf.subarray(0, head).toString();
        const name = /filename="([^"]+)"/.exec(header)?.[1] ?? "upload.bin";
        const type = /Content-Type: (.+)/i.exec(header)?.[1]?.trim() ?? "application/octet-stream";
        const end = buf.indexOf(Buffer.from(`\r\n--${boundary}`), head);
        const data = buf.subarray(head + 4, end);
        const ups = mem.uploads.get(id) ?? new Map();
        ups.set(name, { buf: data, type });
        mem.uploads.set(id, ups);
        await sleep(400);
        return send(res, 200, { path: `assets/${name}`, kind: kindOf(name), sizeBytes: data.length });
      }
      if ((g = /^\/assets\/(.+)$/.exec(sub)) && m === "DELETE") {
        const f = decodeURIComponent(g[1]).replace(/^assets\//, "");
        mem.uploads.get(id)?.delete(f);
        mem.deletedAssets.add(`${id}/${f}`);
        return send(res, 200, { ok: true });
      }
      if ((g = /^\/logo\/(.+)$/.exec(sub))) {
        const f = decodeURIComponent(g[1]).replace(/^assets\//, "");
        const a = readJson(path.join(root, id, "assets", `${f}.logo.json`));
        if (!a) return send(res, 404, { error: "no logo analysis" });
        return send(res, 200, {
          summary: {
            source: a.source, viewBox: a.viewBox, parts: a.parts.length, subpaths: a.parts.length + a.holes.length, strokeOnlyParts: 0,
            groups: a.groups, holes: a.holes.map((h: Json) => ({ partId: h.partId, areaRatio: h.areaRatio })), palette: a.palette, kit: a.kit,
            suggestedModes: [
              { mode: "draw-fill", score: 0.92, why: "strong strokes and closed counters read well when traced" },
              { mode: "assemble", score: 0.81, parts: "icon", why: "two interlocking parts can fly together" },
              { mode: "cascade", score: 0.74, order: "leftToRight", why: `${a.groups.wordmark.length} wordmark glyphs` },
            ],
          },
        });
      }
      if (sub === "/preview") {
        await sleep(1600);
        const prev = ls(path.join(root, id, "previews"));
        if (!prev.includes("sheet.jpg")) return send(res, 500, { error: "preview failed: no frames" });
        return send(res, 200, { sheetUrl: `/files/${id}/previews/sheet.jpg?t=${Date.now()}`, frames: prev.filter((f) => f.startsWith("frame-")).map((f) => ({ time: parseFloat(f.slice(6)), url: `/files/${id}/previews/${f}`, label: f.slice(6, -4) })) });
      }
      const newJob = (quality: unknown, format?: string): Job => {
        const j: Job = { id: `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, projectId: id, kind: "render", quality: quality === "final" ? "final" : "draft", ...(format ? { format } : {}), backend: "local", status: "queued", progress: 0, stage: "queued", createdAt: new Date(Date.now() + jobs.size).toISOString() };
        jobs.set(j.id, j);
        return j;
      };
      if (sub === "/render" && m === "POST") {
        const b = JSON.parse((await body(req)).toString() || "{}");
        const j = newJob(b.quality, b.format);
        queuePositions();
        setTimeout(() => void pump(), 400);
        return send(res, 200, { job: j });
      }
      if (sub === "/render-all" && m === "POST") {
        const b = JSON.parse((await body(req)).toString() || "{}");
        const spec = specOf(id);
        if (!spec) return send(res, 409, { error: "Project has no spec yet" });
        const formats = adaptTargets({ ...spec, format: spec.format ?? meta(id).format });
        const js = formats.map((f) => newJob(b.quality, f));
        queuePositions();
        setTimeout(() => void pump(), 400);
        return send(res, 202, { jobs: js, formats });
      }
      if (sub === "/chat") {
        if (m === "GET") return send(res, 200, { messages: mem.chats.get(id) ?? [], running: mem.running.has(id) });
        if (m === "DELETE") { mem.chats.delete(id); return send(res, 200, { ok: true }); }
        const b = JSON.parse((await body(req)).toString() || "{}");
        return runChat(id, String(b.message ?? ""), res);
      }
      if (sub === "/chat/stop") { const r = mem.running.get(id); if (r) r.stop = true; return send(res, 200, { ok: true }); }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 500, { error: (e as Error).message });
    }
  };

  return {
    name: "motion-studio-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => { void handle(req, res, next); });
    },
  };
};
