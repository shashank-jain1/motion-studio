/**
 * Remote MCP connector (docs/PLATFORM.md → "Remote MCP"): MCP Streamable HTTP on `/mcp` for claude.ai custom connectors
 * (and any MCP client), authenticated with OAuth 2.1 access tokens (src/server/oauth.ts) or personal access tokens.
 *
 * Sessions are stateful: `initialize` creates an McpServer + WebStandardStreamableHTTPServerTransport bound to the
 * authenticated user and keyed by the `Mcp-Session-Id` it returns. Every request is still re-authenticated (bearer must
 * resolve to the session's user), so revoking a token cuts a session off immediately. Idle sessions expire; an unknown
 * session id gets 404 so clients re-initialize transparently (e.g. after a server restart).
 *
 * The tools are the shared registry (src/core/tools.ts) scoped to the user: project ownership is checked on every
 * projectId, create_project records ownership, list_projects only lists the user's projects, and in hosted mode
 * add_asset is https-url-only and write_custom_component is absent. Results that touch a project end with
 * "Open in Motion Studio: <PUBLIC_URL>/p/<id>".
 */
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { PROJECTS_DIR } from "../core/paths";
import { listProjects } from "../core/projects";
import { TOOLS, callTool, type ToolContent, type ToolDef, type ToolResult } from "../core/tools";
import { listUserProjectIds, ownsProject, recordProjectOwner, userFromBearer, type User } from "./auth";
import { IS_HOSTED } from "./config";
import { toolPolicyFor } from "./scope";

/** render_video over MCP answers after at most this long; the job keeps rendering (poll render_status). */
const REMOTE_RENDER_WAIT_MS = 45_000;
import { OAUTH_SCOPE, hostAllowed, mcpResource, mountOAuth, oauthAccessTokenFor, publicUrl, resourceMetadataUrl } from "./oauth";

const SESSION_IDLE_MS = 30 * 60_000;
const MAX_SESSIONS_PER_USER = 8;
const MAX_SESSIONS = 2000;

const INSTRUCTIONS =
  "Motion Studio directs motion-graphics videos from a JSON Scene Spec. Call get_guide first (once per conversation) for the spec " +
  "schema and craft rules. Then: create_project → add_asset (https URLs of logos, screenshots, music) → set_spec → preview_frames " +
  "(look at the frames, critique, fix with set_spec/update_scene) → render_video draft, then final. Share the " +
  '"Open in Motion Studio" link from tool results so the user can watch and edit the video.';

// ---------------------------------------------------------------- auth

type Authed = { user: User; authInfo: AuthInfo };

const bearerOf = (c: Context): string | null => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("authorization") ?? "");
  return m ? m[1] : null;
};

/** PAT or OAuth access token; OAuth tokens must be live and issued for this MCP server (resource = PUBLIC_URL/mcp). */
const authenticate = (token: string): Authed | null => {
  const r = userFromBearer(token);
  if (!r) return null;
  if (r.via === "oauth") {
    const row = oauthAccessTokenFor(token);
    if (!row || row.user_id !== r.user.id) return null;
    return {
      user: r.user,
      authInfo: { token, clientId: row.client_id, scopes: r.scope, expiresAt: Math.floor(Date.parse(row.expires_at) / 1000), resource: new URL(mcpResource()), extra: { userId: r.user.id } },
    };
  }
  return { user: r.user, authInfo: { token, clientId: "personal-access-token", scopes: r.scope, extra: { userId: r.user.id } } };
};

const challenge = (error?: { code: string; description: string }) =>
  [`resource_metadata="${resourceMetadataUrl()}"`, `scope="${OAUTH_SCOPE}"`, ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : [])].join(", ");

const unauthorized = (c: Context, error?: { code: string; description: string }) =>
  c.json(
    { error: error?.code ?? "unauthorized", error_description: error?.description ?? "Authorization required: connect Motion Studio with OAuth or send a personal access token" },
    401,
    { "WWW-Authenticate": `Bearer ${challenge(error)}`, "Cache-Control": "no-store" },
  );

const jsonRpcError = (c: Context, status: 400 | 404, code: number, message: string) => c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

// ---------------------------------------------------------------- tool scoping

const text = (t: string): ToolContent => ({ type: "text", text: t });
const errorResult = (msg: string): ToolResult => ({ content: [text(msg)], isError: true });
const projectLink = (id: string) => `${publicUrl()}/p/${encodeURIComponent(id)}`;
const notFoundMsg = (id: string) => `Project "${id}" not found. Use list_projects to see your projects.`;

/** Hosted mode: server paths in tool output become studio URLs (the /files route is owner-scoped). */
const projectsPrefix = PROJECTS_DIR.endsWith(path.sep) ? PROJECTS_DIR : PROJECTS_DIR + path.sep;
const rewritePaths = (t: string) => (IS_HOSTED ? t.split(projectsPrefix).join(`${publicUrl()}/files/`) : t);

const isPrivateAddress = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
};

/** Hosted add_asset: https only, and not pointing into the server's own network. */
const checkAssetUrl = async (raw: unknown): Promise<string | null> => {
  if (typeof raw !== "string") return "Pass the asset as an https `url` (local file paths aren't available on hosted Motion Studio; upload files in the studio instead).";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "`url` is not a valid URL.";
  }
  if (u.protocol !== "https:") return "Only https URLs can be imported on hosted Motion Studio.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  try {
    const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (!addrs.length || addrs.some(isPrivateAddress)) return `Refusing to download from ${u.hostname}: it resolves to a private address.`;
  } catch {
    return `Could not resolve ${u.hostname}.`;
  }
  return null;
};

const projectIdFromCreate = (res: ToolResult): string | null => {
  for (const c of res.content) {
    if (c.type !== "text") continue;
    try {
      const v = JSON.parse(c.text) as { projectId?: unknown };
      if (typeof v.projectId === "string") return v.projectId;
    } catch {
      /* not JSON */
    }
  }
  return null;
};

type RunCtx = { signal: AbortSignal; onProgress?: (p: { progress: number; message?: string }) => void };

/** Run one registry tool on behalf of `user` with ownership checks and remote-specific behaviour. */
const runScoped = async (def: ToolDef, args: Record<string, unknown>, user: User, ctx: RunCtx): Promise<ToolResult> => {
  const projectId = typeof args.projectId === "string" ? args.projectId : undefined;

  if (def.name === "list_projects") {
    const mine = new Set(listUserProjectIds(user));
    const list = listProjects()
      .filter((p) => mine.has(p.id))
      .map((p) => ({ projectId: p.id, name: p.name, format: p.format, createdAt: p.createdAt, updatedAt: p.updatedAt, hasSpec: p.hasSpec, url: projectLink(p.id) }));
    return { content: [text(list.length ? JSON.stringify(list, null, 2) : "No projects yet. Use create_project.")] };
  }

  if (def.name === "open_studio_hint") {
    if (projectId && ownsProject(user, projectId)) return { content: [text(`Open in Motion Studio: ${projectLink(projectId)} (live preview, timeline, spec editor and renders).`)] };
    return { content: [text(`Motion Studio: ${publicUrl()}/ — your projects, each with a live preview, timeline, spec editor and renders.`)] };
  }

  if (def.scope === "project" && projectId !== undefined && !ownsProject(user, projectId)) return errorResult(notFoundMsg(projectId));

  if (def.name === "add_asset" && IS_HOSTED) {
    const problem = await checkAssetUrl(args.url);
    if (problem) return errorResult(problem);
    args = { ...args, path: undefined };
  }

  // Shared scoping policy (src/server/scope.ts): hosted-mode safety, ownership, render_video through the job queue with a
  // 45s cap ("Still rendering, job <id>" → render_status), so a long render never hits the client's tool timeout.
  const res = await callTool(def.name, args, { signal: ctx.signal, onProgress: ctx.onProgress, policy: toolPolicyFor(user, { maxRenderWaitMs: REMOTE_RENDER_WAIT_MS }) });

  let linkId = def.scope === "project" ? projectId : undefined;
  if (def.name === "create_project" && !res.isError) {
    const id = projectIdFromCreate(res);
    if (!id) return errorResult("Project was created but its id could not be read; try list_projects.");
    recordProjectOwner(user, id);
    linkId = id;
  }

  const content = res.content.map((c) => (c.type === "text" ? text(rewritePaths(c.text)) : c));
  if (linkId && !res.isError) content.push(text(`Open in Motion Studio: ${projectLink(linkId)}`));
  return { ...res, content };
};

type Extra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
};

/** Hosted builds hide/reshape some tools; local mode exposes the whole registry. */
const remoteToolDefs = (): { def: ToolDef; description: string; shape: ToolDef["shape"] }[] =>
  TOOLS.filter((d) => !(IS_HOSTED && d.name === "write_custom_component")).map((def) => {
    if (IS_HOSTED && def.name === "add_asset") {
      const { path: _localPath, ...shape } = def.shape;
      return {
        def,
        shape,
        description:
          "Import an ingredient (logo, product shot, screenshot, screen recording, music, sfx, Lottie JSON) into the project from an https URL " +
          "(files on the user's computer: ask them to upload in the studio, then use get_project). " +
          def.description.replace(/^[^.]*\.\s*/, ""),
      };
    }
    if (def.name === "open_studio_hint") {
      return { def, shape: def.shape, description: "Link to open a project (or the project list) in the Motion Studio web app, where the user can watch, scrub and edit it." };
    }
    return { def, shape: def.shape, description: def.description };
  });

const buildServer = (user: User, onActivity: (busy: 1 | -1) => void): McpServer => {
  const server = new McpServer({ name: "motion-studio", title: "Motion Studio", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  for (const { def, description, shape } of remoteToolDefs()) {
    server.registerTool(def.name, { title: def.title, description, inputSchema: shape }, async (args: Record<string, unknown>, extra: Extra) => {
      const token = extra._meta?.progressToken;
      onActivity(1);
      try {
        const res = await runScoped(def, args, user, {
          signal: extra.signal,
          onProgress:
            token === undefined
              ? undefined
              : (p) => {
                  extra
                    .sendNotification({
                      method: "notifications/progress",
                      params: { progressToken: token, progress: Math.round(p.progress * 100), total: 100, ...(p.message ? { message: p.message } : {}) },
                    })
                    .catch(() => undefined);
                },
        });
        return { content: res.content as ToolContent[], ...(res.isError ? { isError: true } : {}) };
      } catch (e) {
        console.error(`[motion-studio] remote tool ${def.name} failed: ${e instanceof Error ? e.stack : String(e)}`);
        return { content: [text(`Error: ${e instanceof Error ? e.message : String(e)}`)], isError: true };
      } finally {
        onActivity(-1);
      }
    });
  }
  return server;
};

// ---------------------------------------------------------------- sessions

type Session = { id: string; userId: string; transport: WebStandardStreamableHTTPServerTransport; server: McpServer; lastSeen: number; busy: number };
const sessions = new Map<string, Session>();

const closeSession = (s: Session, why: string) => {
  if (!sessions.delete(s.id)) return;
  console.error(`[motion-studio] mcp session ${s.id.slice(0, 8)} closed (${why})`);
  s.server.close().catch(() => undefined);
};

/** Keep at most `max` sessions in `list` (idle ones first, least recently used first). */
const evict = (list: Session[], max: number, why: string) => {
  if (list.length <= max) return;
  const victims = [...list].sort((a, b) => (a.busy > 0 ? 1 : 0) - (b.busy > 0 ? 1 : 0) || a.lastSeen - b.lastSeen).slice(0, list.length - max);
  for (const v of victims) closeSession(v, why);
};

const sweep = () => {
  const now = Date.now();
  for (const s of [...sessions.values()]) if (s.busy === 0 && now - s.lastSeen > SESSION_IDLE_MS) closeSession(s, "idle");
};

/** For tests / diagnostics. */
export const remoteMcpSessionCount = () => sessions.size;

const startSession = async (c: Context, auth: Authed): Promise<Response> => {
  let session: Session | undefined;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      session = { id, userId: auth.user.id, transport, server, lastSeen: Date.now(), busy: 0 };
      sessions.set(id, session);
      evict([...sessions.values()].filter((s) => s.userId === auth.user.id), MAX_SESSIONS_PER_USER, "per-user limit");
      evict([...sessions.values()], MAX_SESSIONS, "server limit");
      console.error(`[motion-studio] mcp session ${id.slice(0, 8)} opened for ${auth.user.email}`);
    },
    onsessionclosed: (id) => {
      const s = sessions.get(id);
      if (s) closeSession(s, "client DELETE");
    },
  });
  const server = buildServer(auth.user, (d) => {
    if (!session) return;
    session.busy += d;
    session.lastSeen = Date.now();
  });
  transport.onclose = () => {
    if (session) sessions.delete(session.id);
  };
  await server.connect(transport);
  const res = await transport.handleRequest(c.req.raw, { authInfo: auth.authInfo });
  // Not an initialize request (the transport answered 400): nothing to keep.
  if (!transport.sessionId) await server.close().catch(() => undefined);
  return res;
};

// ---------------------------------------------------------------- mount

/**
 * Mount the OAuth authorization server and `/mcp`. Call it right after `new Hono()`, before the app-wide Origin guard:
 * these routes implement their own Host guard, CORS (claude.ai calls discovery/token/register from the browser) and
 * CSRF rules (Origin check on the consent decision).
 */
export function mountRemoteMcp(app: Hono): void {
  mountOAuth(app);

  setInterval(sweep, 60_000).unref();

  app.use("/mcp", async (c, next) => {
    if (!hostAllowed(c.req.header("host"))) return c.json({ error: "Forbidden host" }, 403);
    await next();
  });
  app.use(
    "/mcp",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "Accept", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
      exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version", "WWW-Authenticate"],
      maxAge: 86400,
    }),
  );

  app.all("/mcp", async (c) => {
    const token = bearerOf(c);
    if (!token) return unauthorized(c);
    const auth = authenticate(token);
    if (!auth) return unauthorized(c, { code: "invalid_token", description: "The access token is invalid, expired, revoked or not issued for this server" });

    const sid = c.req.header("mcp-session-id");
    if (sid) {
      const s = sessions.get(sid);
      // Another user's session id is indistinguishable from an unknown one.
      if (!s || s.userId !== auth.user.id) return jsonRpcError(c, 404, -32001, "Session not found");
      s.lastSeen = Date.now();
      return s.transport.handleRequest(c.req.raw, { authInfo: auth.authInfo });
    }
    if (c.req.method !== "POST") return jsonRpcError(c, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
    return startSession(c, auth);
  });
}
