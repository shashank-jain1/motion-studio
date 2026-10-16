/**
 * DEV-ONLY mock of the Phase 2 server (docs/WEB_API.md), enabled with `MOCK_API=1 pnpm web`.
 * Reads the real ../projects folder (read-only); every mutation lives in memory. The chat endpoint streams a
 * scripted director run so the SSE UI can be exercised without an API key. Never used in production builds.
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { SpecSchema } from "../src/engine/spec/schema.ts";
import { preprocessSpecDetailed, sceneTimeline, sceneIndexOf } from "../src/engine/spec/preprocess.ts";

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
  const mem = {
    created: new Map<string, Json>(),
    deleted: new Set<string>(),
    specs: new Map<string, Json>(),
    uploads: new Map<string, Map<string, { buf: Buffer; type: string }>>(),
    deletedAssets: new Set<string>(),
    chats: new Map<string, Json[]>(),
    running: new Map<string, { stop: boolean }>(),
    settings: { model: "claude-opus-4-5", effort: "high", apiKey: "" },
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

  const serveFile = (req: IncomingMessage, res: ServerResponse, id: string, rel: string) => {
    const up = mem.uploads.get(id)?.get(rel.replace(/^assets\//, ""));
    if (up && rel.startsWith("assets/")) { res.setHeader("content-type", up.type); res.end(up.buf); return; }
    const file = path.resolve(root, id, rel);
    if (!file.startsWith(path.join(root, id) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: "not found" });
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
      if (!p.startsWith("/api/")) return next();
      await sleep(120 + Math.random() * 160); // feel the loading states
      if (p === "/api/settings") {
        if (m === "PUT") {
          const b = JSON.parse((await body(req)).toString() || "{}");
          Object.assign(mem.settings, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
        }
        const s = mem.settings;
        return send(res, 200, { model: s.model, effort: s.effort, hasApiKey: !!s.apiKey, keySource: s.apiKey ? "settings" : "none", models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"] });
      }
      if (p === "/api/projects") {
        if (m === "POST") {
          const b = JSON.parse((await body(req)).toString() || "{}");
          const id = `${String(b.name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Math.random().toString(16).slice(2, 6)}`;
          const now = new Date().toISOString();
          mem.created.set(id, { id, name: b.name || "Untitled", format: b.format ?? "16:9", createdAt: now, updatedAt: now });
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
      if (sub === "/render" && m === "POST") {
        const emit = sse(res);
        for (let i = 1; i <= 24; i++) { emit("progress", { progress: i / 25 }); await sleep(150); }
        const r = rendersOf(id)[0];
        if (r) emit("done", { render: { ...r, createdAt: new Date().toISOString(), seconds: 11.8, width: 1080, height: 1920 } });
        else emit("error", { message: "Render failed: Chrome exited with code 1" });
        return res.end();
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
