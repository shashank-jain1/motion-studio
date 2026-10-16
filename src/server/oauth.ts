/**
 * OAuth 2.1 authorization server for the remote MCP connector (docs/PLATFORM.md → "Remote MCP").
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 protected resource metadata
 *   GET  /.well-known/oauth-authorization-server       RFC 8414 authorization server metadata
 *   POST /oauth/register                                RFC 7591 dynamic client registration
 *   GET  /oauth/authorize                               validates, then redirects the browser to the web consent page
 *   POST /oauth/authorize/decision                      consent page → { redirect } with code+state (or access_denied)
 *   POST /oauth/token                                   authorization_code (PKCE S256) and refresh_token (rotating)
 *   POST /oauth/revoke                                  RFC 7009
 *
 * Every secret (client secret, code, access/refresh token) is random, opaque and stored as a SHA-256 hash only.
 * Codes live 60s and are single-use; access tokens 1h; refresh tokens 30d, rotated on every use, and a reused
 * (already rotated) refresh token revokes the whole grant (every token of that client for that user).
 */
import crypto from "node:crypto";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { clientIp, currentUser, type User } from "./auth";
import { IS_HOSTED, PUBLIC_URL } from "./config";
import { getDb, hashSecret, nowIso, randomSecret, tx } from "./db";

// ---------------------------------------------------------------- config

export const OAUTH_SCOPE = "studio";
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const CODE_TTL_S = 60;
/** A rotated refresh token presented again within this window gets the same successor pair (lost-response retry). */
const REFRESH_GRACE_MS = 10_000;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Public base URL (config PUBLIC_URL, canonicalized: lowercase scheme/host, no trailing slash): issuer, resource, links. */
const PUBLIC_BASE = (() => {
  const u = new URL(PUBLIC_URL);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
})();
export const publicUrl = (): string => PUBLIC_BASE;
/** Canonical MCP server URI (RFC 8707 resource / RFC 9728 `resource`). */
export const mcpResource = () => `${publicUrl()}/mcp`;
export const resourceMetadataUrl = () => `${publicUrl()}/.well-known/oauth-protected-resource`;

/** Canonical form of a resource indicator (lowercase scheme/host via URL, no trailing slash) or null when unusable. */
const canonicalResource = (r: string): string | null => {
  try {
    const u = new URL(r);
    if (u.hash || u.search) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- crypto helpers

const sha256 = hashSecret;
const randomToken = (prefix: string, bytes = 32) => `${prefix}${randomSecret(bytes)}`;
const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};
const isoIn = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

// ---------------------------------------------------------------- storage (tables created by db.ts migrations)

type ClientRow = { client_id: string; client_secret_hash: string | null; redirect_uris: string; client_name: string | null; created_at: string };
type CodeRow = { code_hash: string; client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string; expires_at: string };
export type TokenRow = { token_hash: string; kind: "access" | "refresh"; client_id: string; user_id: string; scope: string; resource: string; expires_at: string; revoked: number; family_id?: string | null };

const store = {
  insertClient: (r: ClientRow) =>
    getDb()
      .prepare("INSERT INTO oauth_clients (client_id, client_secret_hash, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(r.client_id, r.client_secret_hash, r.redirect_uris, r.client_name, r.created_at),
  getClient: (id: string) => getDb().prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(id) as ClientRow | undefined,
  insertCode: (r: CodeRow) =>
    getDb()
      .prepare("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.code_hash, r.client_id, r.user_id, r.redirect_uri, r.code_challenge, r.scope, r.resource, r.expires_at),
  /** Single use: the row is deleted as it is read. */
  takeCode: (hash: string) => getDb().prepare("DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *").get(hash) as CodeRow | undefined,
  insertToken: (r: Omit<TokenRow, "revoked">) =>
    getDb()
      .prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, resource, expires_at, revoked, family_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .run(r.token_hash, r.kind, r.client_id, r.user_id, r.scope, r.resource, r.expires_at, r.family_id ?? null),
  getToken: (hash: string) => getDb().prepare("SELECT * FROM oauth_tokens WHERE token_hash = ?").get(hash) as TokenRow | undefined,
  /** Returns true when this call flipped it (i.e. it was live). */
  revokeToken: (hash: string) => Number(getDb().prepare("UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ? AND revoked = 0").run(hash).changes) === 1,
  /**
   * Revoke the grant a token belongs to: its refresh-token family (one authorization and every rotation of it). Rows
   * minted before families existed fall back to every token of that client+user.
   */
  revokeGrant: (row: Pick<TokenRow, "client_id" | "user_id" | "family_id">) =>
    row.family_id
      ? getDb().prepare("UPDATE oauth_tokens SET revoked = 1 WHERE family_id = ?").run(row.family_id)
      : getDb().prepare("UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ? AND user_id = ?").run(row.client_id, row.user_id),
  cleanup: () => {
    const now = nowIso();
    getDb().prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now);
    getDb().prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(now);
  },
};

/** The OAuth access-token row for a bearer token, if it is a live access token bound to this MCP server (RFC 8707 audience). */
export const oauthAccessTokenFor = (token: string): TokenRow | null => {
  const row = store.getToken(sha256(token));
  if (!row || row.kind !== "access" || row.revoked || row.expires_at <= nowIso()) return null;
  return canonicalResource(row.resource) === mcpResource() ? row : null;
};

// ---------------------------------------------------------------- HTTP helpers

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const oauthError = (c: Context, status: 400 | 401 | 403 | 429, error: string, description?: string, headers: Record<string, string> = {}) =>
  c.json({ error, ...(description ? { error_description: description } : {}) }, status, { ...NO_STORE, ...headers });

const htmlEscape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Errors that must NOT redirect (unknown client / bad redirect_uri) are shown to the user. */
const errorPage = (c: Context, message: string) =>
  c.html(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>Can't connect this app</h1><p>${htmlEscape(message)}</p></body>`,
    400,
    NO_STORE,
  );

const withParams = (base: string, params: Record<string, string | undefined>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};

/** Hostnames this sub-app answers on (DNS-rebinding guard): loopback, the public host, MOTION_STUDIO_ALLOWED_HOSTS. */
export const hostAllowed = (host: string | undefined) => {
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (LOOPBACK.has(hostname)) return true;
  try {
    if (new URL(publicUrl()).hostname === hostname) return true;
  } catch {
    /* ignore */
  }
  return (process.env.MOTION_STUDIO_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(hostname);
};

/** CSRF guard for the cookie-authenticated consent decision: the Origin must be the studio itself. */
const originAllowed = (origin: string | undefined) => {
  if (!origin) return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.origin === new URL(publicUrl()).origin) return true;
  // Development: the vite dev server (another localhost port) proxies to us; only when the studio itself is local.
  const devLocal = !IS_HOSTED || LOOPBACK.has(new URL(publicUrl()).hostname);
  return devLocal && LOOPBACK.has(o.hostname);
};

/** Fixed-window limiter for unauthenticated writes (client registration). */
const makeLimiter = (max: number, windowMs: number) => {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    h.n++;
    return h.n <= max;
  };
};
const registerPerIp = makeLimiter(20, 10 * 60_000);
const registerGlobal = makeLimiter(500, 60 * 60_000);

/** Single-valued params: a repeated OAuth parameter is an invalid_request (RFC 6749 §3.1). */
const singleParams = (entries: Iterable<[string, string]>): { params: Record<string, string>; dup?: string } => {
  const params: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (k in params) return { params, dup: k };
    params[k] = v;
  }
  return { params };
};

// ---------------------------------------------------------------- redirect URIs & clients

export const validRedirectUri = (s: unknown): boolean => {
  if (typeof s !== "string" || s.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && LOOPBACK.has(u.hostname);
};

const clientRedirectUris = (client: ClientRow): string[] => {
  try {
    const v = JSON.parse(client.redirect_uris);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const cleanName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  return s || null;
};

// ---------------------------------------------------------------- authorization request validation

type AuthzParams = { client_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string; state?: string };
type AuthzCheck =
  | { ok: true; client: ClientRow; params: AuthzParams }
  /** Unknown client / redirect_uri problems: show an error, never redirect. */
  | { ok: false; fatal: string }
  /** Everything else goes back to the client's redirect_uri. */
  | { ok: false; redirect: string };

const PKCE_RE = /^[A-Za-z0-9._~-]{43,128}$/;

const checkAuthorizeParams = (p: Record<string, unknown>): AuthzCheck => {
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const clientId = str("client_id");
  if (!clientId) return { ok: false, fatal: "Missing client_id." };
  const client = store.getClient(clientId);
  if (!client) return { ok: false, fatal: "Unknown client. Remove the connector and add it again." };
  const registered = clientRedirectUris(client);
  let redirectUri = str("redirect_uri");
  if (!redirectUri) {
    if (registered.length !== 1) return { ok: false, fatal: "Missing redirect_uri." };
    redirectUri = registered[0];
  }
  if (!registered.includes(redirectUri)) return { ok: false, fatal: "redirect_uri does not match a URI registered by this client." };

  const state = str("state");
  const fail = (error: string, description: string) => ({
    ok: false as const,
    redirect: withParams(redirectUri, { error, error_description: description, state, iss: publicUrl() }),
  });
  if (str("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
  const challenge = str("code_challenge");
  if (!challenge) return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256");
  if (str("code_challenge_method") !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
  if (!PKCE_RE.test(challenge)) return fail("invalid_request", "malformed code_challenge");
  const resourceParam = str("resource");
  if (resourceParam !== undefined && canonicalResource(resourceParam) !== mcpResource()) {
    return fail("invalid_target", `resource must be ${mcpResource()}`);
  }
  // One scope exists; unknown scopes are ignored (the token response reports the granted scope).
  return { ok: true, client, params: { client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, scope: OAUTH_SCOPE, resource: mcpResource(), state } };
};

// ---------------------------------------------------------------- client authentication (token / revoke)

type ClientAuth = { ok: true; client: ClientRow } | { ok: false; res: Response };

const authenticateClient = (c: Context, form: Record<string, string>): ClientAuth => {
  let id = form.client_id;
  let secret = form.client_secret;
  let basic = false;
  const authz = c.req.header("authorization");
  if (authz?.toLowerCase().startsWith("basic ")) {
    basic = true;
    try {
      const decoded = Buffer.from(authz.slice(6).trim(), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i < 0) throw new Error("no colon");
      const bid = decodeURIComponent(decoded.slice(0, i).replace(/\+/g, " "));
      const bsecret = decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, " "));
      if (id && id !== bid) return { ok: false, res: oauthError(c, 400, "invalid_request", "client_id mismatch") };
      if (form.client_secret) return { ok: false, res: oauthError(c, 400, "invalid_request", "use only one client authentication method") };
      id = bid;
      secret = bsecret;
    } catch {
      return { ok: false, res: oauthError(c, 401, "invalid_client", "malformed Basic credentials", { "WWW-Authenticate": 'Basic realm="oauth"' }) };
    }
  }
  const invalid = () => ({ ok: false as const, res: oauthError(c, 401, "invalid_client", "client authentication failed", basic ? { "WWW-Authenticate": 'Basic realm="oauth"' } : {}) });
  if (!id) return invalid();
  const client = store.getClient(id);
  if (!client) return invalid();
  if (client.client_secret_hash) {
    if (!secret || !safeEqual(sha256(secret), client.client_secret_hash)) return invalid();
  }
  return { ok: true, client };
};

// ---------------------------------------------------------------- token issuance

type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

/** `familyId`: the grant the pair belongs to — new for an authorization code, inherited on refresh rotation. */
const issueTokens = (clientId: string, userId: string, scope: string, resource: string, familyId: string = randomToken("fam_")): TokenResponse => {
  const access = randomToken("msa_");
  const refresh = randomToken("msr_");
  tx(() => {
    store.insertToken({ token_hash: sha256(access), kind: "access", client_id: clientId, user_id: userId, scope, resource, expires_at: isoIn(ACCESS_TTL_S), family_id: familyId });
    store.insertToken({ token_hash: sha256(refresh), kind: "refresh", client_id: clientId, user_id: userId, scope, resource, expires_at: isoIn(REFRESH_TTL_S), family_id: familyId });
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
};

/** old refresh hash → the pair it was rotated into (for an idempotent retry within REFRESH_GRACE_MS). */
const recentRotations = new Map<string, { at: number; clientId: string; response: TokenResponse }>();

const pkceS256 = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

// ---------------------------------------------------------------- routes

export const mountOAuth = (app: Hono): void => {
  const corsOpen = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version"],
    maxAge: 86400,
  });
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/*", "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/*", "/oauth/*"]) {
    app.use(p, async (c, next) => {
      if (!hostAllowed(c.req.header("host"))) return c.json({ error: "Forbidden host" }, 403);
      await next();
    });
  }
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/*", "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/*", "/oauth/token", "/oauth/register", "/oauth/revoke"]) {
    app.use(p, corsOpen);
  }

  const timer = setInterval(() => {
    try {
      store.cleanup();
    } catch (e) {
      console.error(`[motion-studio] oauth cleanup failed: ${(e as Error).message}`);
    }
  }, 60 * 60_000);
  timer.unref();

  // ---- discovery
  const resourceMetadata = (c: Context) =>
    c.json(
      {
        resource: mcpResource(),
        authorization_servers: [publicUrl()],
        scopes_supported: [OAUTH_SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: "Motion Studio",
        resource_documentation: publicUrl(),
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  app.get("/.well-known/oauth-protected-resource", resourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);

  const asMetadata = (c: Context) => {
    const base = publicUrl();
    return c.json(
      {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        scopes_supported: [OAUTH_SCOPE],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
        authorization_response_iss_parameter_supported: true,
        service_documentation: base,
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  };
  app.get("/.well-known/oauth-authorization-server", asMetadata);

  // ---- dynamic client registration (RFC 7591)
  app.post("/oauth/register", async (c) => {
    if (!registerPerIp(clientIp(c)) || !registerGlobal("*")) return oauthError(c, 429, "too_many_requests", "too many client registrations; try again later", { "Retry-After": "600" });
    if (Number(c.req.header("content-length") ?? 0) > 64 * 1024) return oauthError(c, 400, "invalid_client_metadata", "registration request too large");
    let body: Record<string, unknown>;
    try {
      const v = await c.req.json();
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
      body = v as Record<string, unknown>;
    } catch {
      return oauthError(c, 400, "invalid_client_metadata", "body must be a JSON object");
    }
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) return oauthError(c, 400, "invalid_redirect_uri", "redirect_uris must be a non-empty array (max 10)");
    const bad = uris.find((u) => !validRedirectUri(u));
    if (bad !== undefined) return oauthError(c, 400, "invalid_redirect_uri", `redirect URIs must be https, or http on localhost/127.0.0.1: ${String(bad).slice(0, 200)}`);

    const method = body.token_endpoint_auth_method ?? "none";
    if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
      return oauthError(c, 400, "invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic");
    }
    const grantTypes = body.grant_types ?? ["authorization_code", "refresh_token"];
    if (!Array.isArray(grantTypes) || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
      return oauthError(c, 400, "invalid_client_metadata", "grant_types may only contain authorization_code and refresh_token");
    }
    const responseTypes = body.response_types ?? ["code"];
    if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code")) return oauthError(c, 400, "invalid_client_metadata", "response_types may only contain code");

    const clientId = randomToken("msc_", 16);
    const secret = method === "none" ? null : randomToken("mss_");
    const clientName = cleanName(body.client_name) ?? "MCP client";
    const createdAt = new Date();
    store.insertClient({ client_id: clientId, client_secret_hash: secret ? sha256(secret) : null, redirect_uris: JSON.stringify(uris), client_name: clientName, created_at: createdAt.toISOString() });
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: clientName,
        redirect_uris: uris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: method,
        scope: OAUTH_SCOPE,
      },
      201,
      NO_STORE,
    );
  });

  // ---- authorization endpoint: validate, then hand the browser to the web consent screen
  app.get("/oauth/authorize", (c) => {
    const url = new URL(c.req.url);
    const { params, dup } = singleParams(url.searchParams.entries());
    if (dup) return errorPage(c, `Parameter "${dup}" was sent more than once.`);
    const check = checkAuthorizeParams(params);
    if (!check.ok) return "fatal" in check ? errorPage(c, check.fatal) : c.redirect(check.redirect, 302);
    // Forward the original request (with redirect_uri made explicit) plus the client's display name.
    const fwd = new URLSearchParams(url.searchParams);
    fwd.set("redirect_uri", check.params.redirect_uri);
    fwd.set("client_name", check.client.client_name ?? "An MCP client");
    const consent = `/connect/authorize?${fwd.toString()}`;
    c.header("Cache-Control", "no-store");
    if (!currentUser(c)) return c.redirect(`/login?next=${encodeURIComponent(consent)}`, 302);
    return c.redirect(consent, 302);
  });

  // ---- consent decision (session cookie + Origin check)
  app.post("/oauth/authorize/decision", async (c) => {
    if (!originAllowed(c.req.header("origin"))) return oauthError(c, 403, "forbidden", "cross-origin request refused");
    // Consent is a browser action: a bearer token (which currentUser would also accept) must not be able to mint grants.
    if (c.req.header("authorization")) return oauthError(c, 403, "forbidden", "consent requires a browser session");
    const user: User | null = currentUser(c);
    if (!user) return oauthError(c, 401, "login_required", "sign in to Motion Studio first");
    let body: Record<string, unknown>;
    try {
      const ct = c.req.header("content-type") ?? "";
      if (ct.includes("application/json")) body = (await c.req.json()) as Record<string, unknown>;
      else if (ct.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(await c.req.text()));
      else throw new Error();
      if (!body || typeof body !== "object") throw new Error();
    } catch {
      return oauthError(c, 400, "invalid_request", "body must be a JSON object of the authorization parameters plus approve");
    }
    const check = checkAuthorizeParams(body);
    if (!check.ok) return "fatal" in check ? oauthError(c, 400, "invalid_request", check.fatal) : c.json({ redirect: check.redirect }, 200, NO_STORE);
    const { params } = check;
    const approve = body.approve === true || body.approve === "true";
    if (!approve) {
      return c.json({ redirect: withParams(params.redirect_uri, { error: "access_denied", error_description: "The user denied access", state: params.state, iss: publicUrl() }) }, 200, NO_STORE);
    }
    const code = randomToken("msx_");
    store.insertCode({
      code_hash: sha256(code),
      client_id: params.client_id,
      user_id: user.id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge,
      scope: params.scope,
      resource: params.resource,
      expires_at: isoIn(CODE_TTL_S),
    });
    return c.json({ redirect: withParams(params.redirect_uri, { code, state: params.state, iss: publicUrl() }) }, 200, NO_STORE);
  });

  // ---- token endpoint
  app.post("/oauth/token", async (c) => {
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return oauthError(c, 400, "invalid_request", "content type must be application/x-www-form-urlencoded");
    }
    const { params: form, dup } = singleParams(new URLSearchParams(await c.req.text()).entries());
    if (dup) return oauthError(c, 400, "invalid_request", `parameter ${dup} repeated`);
    const auth = authenticateClient(c, form);
    if (!auth.ok) return auth.res;
    const client = auth.client;
    if (form.resource !== undefined && canonicalResource(form.resource) !== mcpResource()) {
      return oauthError(c, 400, "invalid_target", `resource must be ${mcpResource()}`);
    }

    if (form.grant_type === "authorization_code") {
      if (!form.code || !form.code_verifier) return oauthError(c, 400, "invalid_request", "code and code_verifier are required");
      const row = store.takeCode(sha256(form.code));
      if (!row || row.expires_at <= nowIso()) return oauthError(c, 400, "invalid_grant", "authorization code is invalid or expired");
      if (row.client_id !== client.client_id) return oauthError(c, 400, "invalid_grant", "authorization code was issued to another client");
      if (form.redirect_uri !== row.redirect_uri) return oauthError(c, 400, "invalid_grant", "redirect_uri does not match the authorization request");
      if (!PKCE_RE.test(form.code_verifier) || !safeEqual(pkceS256(form.code_verifier), row.code_challenge)) {
        return oauthError(c, 400, "invalid_grant", "PKCE verification failed");
      }
      return c.json(issueTokens(client.client_id, row.user_id, row.scope, row.resource), 200, NO_STORE);
    }

    if (form.grant_type === "refresh_token") {
      if (!form.refresh_token) return oauthError(c, 400, "invalid_request", "refresh_token is required");
      const hash = sha256(form.refresh_token);
      const row = store.getToken(hash);
      if (!row || row.kind !== "refresh" || row.client_id !== client.client_id) return oauthError(c, 400, "invalid_grant", "refresh token is invalid");
      if (row.expires_at <= nowIso()) return oauthError(c, 400, "invalid_grant", "refresh token expired");
      if (form.scope !== undefined && form.scope.split(" ").some((s) => s && !row.scope.split(" ").includes(s))) {
        return oauthError(c, 400, "invalid_scope", "requested scope exceeds the original grant");
      }
      for (const [k, v] of recentRotations) if (Date.now() - v.at > REFRESH_GRACE_MS) recentRotations.delete(k);
      if (!store.revokeToken(hash)) {
        // Already rotated (or revoked). A retry right after rotation gets the same pair; anything else is reuse.
        const recent = recentRotations.get(hash);
        if (recent && recent.clientId === client.client_id && Date.now() - recent.at <= REFRESH_GRACE_MS) {
          const successor = store.getToken(sha256(recent.response.refresh_token));
          if (successor && !successor.revoked) return c.json(recent.response, 200, NO_STORE);
        }
        store.revokeGrant(row);
        console.error(`[motion-studio] oauth: refresh token reuse for client ${row.client_id} user ${row.user_id}: grant revoked`);
        return oauthError(c, 400, "invalid_grant", "refresh token was already used; the grant has been revoked");
      }
      const response = issueTokens(row.client_id, row.user_id, row.scope, row.resource, row.family_id ?? undefined);
      recentRotations.set(hash, { at: Date.now(), clientId: client.client_id, response });
      return c.json(response, 200, NO_STORE);
    }

    return oauthError(c, 400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  });

  // ---- revocation (RFC 7009): 200 for unknown tokens; a refresh token takes its whole grant with it
  app.post("/oauth/revoke", async (c) => {
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return oauthError(c, 400, "invalid_request", "content type must be application/x-www-form-urlencoded");
    }
    const { params: form } = singleParams(new URLSearchParams(await c.req.text()).entries());
    const auth = authenticateClient(c, form);
    if (!auth.ok) return auth.res;
    if (!form.token) return oauthError(c, 400, "invalid_request", "token is required");
    const row = store.getToken(sha256(form.token));
    if (row && row.client_id === auth.client.client_id) {
      if (row.kind === "refresh") store.revokeGrant(row);
      else store.revokeToken(row.token_hash);
    }
    return c.body(null, 200, NO_STORE);
  });
};
