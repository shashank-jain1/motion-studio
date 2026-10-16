/**
 * Remote MCP connector end to end (docs/PLATFORM.md → "Remote MCP"): boots the Hono app on a random port in hosted mode
 * with temp data/projects dirs, signs up users, then runs the full OAuth 2.1 flow the way claude.ai does
 * (401 → protected-resource metadata → AS metadata → DCR → /oauth/authorize → consent decision → code → token with PKCE)
 * and drives /mcp with the SDK's StreamableHTTPClientTransport: tools/list, create_project, set_spec, get_project,
 * user isolation, refresh rotation + reuse detection, revocation, audience binding, PATs, and the SDK's own
 * OAuthClientProvider flow. No renders.
 * Run: npx tsx scripts/tests/remote-mcp.test.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type CallRes = { content: Content[]; isError?: boolean };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const b64url = (b: Buffer) => b.toString("base64url");
const pkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
};

const main = async () => {
  // ------------------------------------------------------------ environment (before any server module is imported)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-remote-mcp-"));
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  Object.assign(process.env, {
    MOTION_STUDIO_DATA: path.join(tmp, "data"),
    MOTION_STUDIO_PROJECTS: path.join(tmp, "projects"),
    MOTION_STUDIO_MODE: "hosted",
    MOTION_STUDIO_PUBLIC_URL: BASE,
    MOTION_STUDIO_PORT: String(port),
    MOTION_STUDIO_SECRET: "test-secret-test-secret-test-secret-123",
  });
  fs.mkdirSync(process.env.MOTION_STUDIO_PROJECTS!, { recursive: true });

  const { Hono } = await import("hono");
  const { serve } = await import("@hono/node-server");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
  const auth = await import("../../src/server/auth");
  const { db, hashSecret, isoIn } = await import("../../src/server/db");
  const { mountRemoteMcp } = await import("../../src/server/mcp-remote");

  // The real app when it already mounts the connector; otherwise a bare app with just mountRemoteMcp.
  let target: { fetch: (r: Request) => Response | Promise<Response> };
  let usingMainApp = false;
  try {
    const { app } = await import("../../src/server/index");
    const probe = await app.request(`${BASE}/.well-known/oauth-protected-resource`, { headers: { host: `localhost:${port}` } });
    if (probe.status === 200 && (probe.headers.get("content-type") ?? "").includes("application/json")) {
      target = app;
      usingMainApp = true;
    } else throw new Error("not mounted");
  } catch {
    const bare = new Hono();
    mountRemoteMcp(bare);
    target = bare;
  }
  // Test-only signup fallback (used when /api/auth/signup is not available).
  const root = new Hono();
  root.post("/__test/signup", async (c) => {
    const body = await c.req.json();
    const user = await auth.createUser(auth.validateSignup(body));
    auth.startSession(c, user);
    return c.json({ user });
  });
  root.all("*", (c) => target.fetch(c.req.raw));
  const server = serve({ fetch: root.fetch, port, hostname: "127.0.0.1" });
  console.log(`server on ${BASE} (${usingMainApp ? "src/server/index.ts app" : "bare app + mountRemoteMcp"}), data in ${tmp}`);

  const clients: { close: () => Promise<void> }[] = [];
  let failed = false;
  try {
    const signup = async (email: string) => {
      const body = JSON.stringify({ email, password: "correct horse battery", name: email.split("@")[0] });
      const headers = { "content-type": "application/json", origin: BASE };
      let r = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers, body });
      if (r.status === 404 || r.status === 405) r = await fetch(`${BASE}/__test/signup`, { method: "POST", headers, body });
      assert.equal(r.status, 200, `signup ${email}: ${r.status} ${await r.clone().text()}`);
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith("ms_session="));
      assert.ok(cookie, "session cookie set");
      const { user } = (await r.json()) as { user: { id: string; email: string; name: string } };
      return { user, cookie: cookie.split(";")[0] };
    };
    const alice = await signup("alice@example.com");
    const bob = await signup("bob@example.com");

    // ------------------------------------------------------------ discovery
    const unauth = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    assert.equal(unauth.status, 401);
    const wwwa = unauth.headers.get("www-authenticate") ?? "";
    assert.match(wwwa, /^Bearer /);
    const rm = /resource_metadata="([^"]+)"/.exec(wwwa)?.[1];
    assert.equal(rm, `${BASE}/.well-known/oauth-protected-resource`);
    assert.doesNotMatch(wwwa, /error=/, "no error= when no token was sent");

    const badTok = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" }, body: "{}" });
    assert.equal(badTok.status, 401);
    assert.match(badTok.headers.get("www-authenticate") ?? "", /error="invalid_token"/);

    const prm = (await (await fetch(rm!)).json()) as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
    assert.equal(prm.resource, `${BASE}/mcp`);
    assert.deepEqual(prm.authorization_servers, [BASE]);
    assert.deepEqual(prm.scopes_supported, ["studio"]);
    assert.equal((await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).status, 200, "path-suffixed PRM");

    const asmRes = await fetch(`${BASE}/.well-known/oauth-authorization-server`, { headers: { origin: "https://claude.ai" } });
    assert.equal(asmRes.headers.get("access-control-allow-origin"), "*", "CORS on AS metadata");
    const asm = (await asmRes.json()) as Record<string, unknown>;
    assert.equal(asm.issuer, BASE);
    assert.equal(asm.authorization_endpoint, `${BASE}/oauth/authorize`);
    assert.equal(asm.token_endpoint, `${BASE}/oauth/token`);
    assert.equal(asm.registration_endpoint, `${BASE}/oauth/register`);
    assert.equal(asm.revocation_endpoint, `${BASE}/oauth/revoke`);
    assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);

    const pre = await fetch(`${BASE}/oauth/token`, { method: "OPTIONS", headers: { origin: "https://claude.ai", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    assert.ok(pre.status === 204 || pre.status === 200, `token preflight ${pre.status}`);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");

    // ------------------------------------------------------------ dynamic client registration
    const REDIRECT = "http://localhost:53682/callback";
    const reg = async (body: unknown) => fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const badReg = await reg({ redirect_uris: ["http://evil.example.com/cb"], client_name: "Evil" });
    assert.equal(badReg.status, 400);
    assert.equal(((await badReg.json()) as { error: string }).error, "invalid_redirect_uri");
    assert.equal((await reg({ redirect_uris: ["https://ok.example.com/cb#frag"] })).status, 400, "fragment rejected");
    const regRes = await reg({ redirect_uris: [REDIRECT, "https://claude.ai/api/mcp/auth_callback"], client_name: "Test Client", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.headers.get("cache-control"), "no-store");
    const client = (await regRes.json()) as { client_id: string; client_secret?: string };
    assert.ok(client.client_id && !client.client_secret, "public client");

    // ------------------------------------------------------------ authorize → consent → code
    const authorizeUrl = (p: Record<string, string | undefined>) => {
      const u = new URL(`${BASE}/oauth/authorize`);
      for (const [k, v] of Object.entries(p)) if (v !== undefined) u.searchParams.set(k, v);
      return u.toString();
    };
    const baseParams = (challenge: string, state: string) => ({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: "studio",
      resource: `${BASE}/mcp`,
    });
    const get = (url: string, cookie?: string) => fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });

    // fatal errors are shown, never redirected
    assert.equal((await get(authorizeUrl({ ...baseParams("x".repeat(43), "s"), client_id: "unknown" }), alice.cookie)).status, 400);
    assert.equal((await get(authorizeUrl({ ...baseParams("x".repeat(43), "s"), redirect_uri: "http://localhost:1/other" }), alice.cookie)).status, 400);
    // other errors go back to the client
    const noPkce = await get(authorizeUrl({ ...baseParams("x".repeat(43), "s1"), code_challenge: undefined }), alice.cookie);
    assert.equal(noPkce.status, 302);
    const noPkceLoc = new URL(noPkce.headers.get("location")!);
    assert.equal(noPkceLoc.searchParams.get("error"), "invalid_request");
    assert.equal(noPkceLoc.searchParams.get("state"), "s1");
    const plain = new URL((await get(authorizeUrl({ ...baseParams("x".repeat(43), "s"), code_challenge_method: "plain" }), alice.cookie)).headers.get("location")!);
    assert.equal(plain.searchParams.get("error"), "invalid_request");
    const wrongRes = new URL((await get(authorizeUrl({ ...baseParams("x".repeat(43), "s"), resource: "https://other.example.com/mcp" }), alice.cookie)).headers.get("location")!);
    assert.equal(wrongRes.searchParams.get("error"), "invalid_target");

    // not signed in → login first, then back to the consent page
    const p1 = pkce();
    const anon = await get(authorizeUrl(baseParams(p1.challenge, "st-1")));
    assert.equal(anon.status, 302);
    const anonLoc = anon.headers.get("location")!;
    assert.ok(anonLoc.startsWith("/login?next="), anonLoc);
    assert.ok(decodeURIComponent(anonLoc.slice("/login?next=".length)).startsWith("/connect/authorize?"));

    const consent = await get(authorizeUrl(baseParams(p1.challenge, "st-1")), alice.cookie);
    assert.equal(consent.status, 302);
    const consentUrl = new URL(consent.headers.get("location")!, BASE);
    assert.equal(consentUrl.pathname, "/connect/authorize");
    assert.equal(consentUrl.searchParams.get("client_name"), "Test Client");
    assert.equal(consentUrl.searchParams.get("state"), "st-1");

    // The consent page posts the params it received back with approve.
    const decide = (params: URLSearchParams, approve: boolean, opts: { cookie?: string; origin?: string | null; bearer?: string } = {}) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.cookie) headers.cookie = opts.cookie;
      if (opts.origin !== null) headers.origin = opts.origin ?? BASE;
      if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
      return fetch(`${BASE}/oauth/authorize/decision`, { method: "POST", headers, body: JSON.stringify({ ...Object.fromEntries(params), approve }) });
    };
    assert.equal((await decide(consentUrl.searchParams, true, { cookie: alice.cookie, origin: null })).status, 403, "no Origin → CSRF refusal");
    assert.equal((await decide(consentUrl.searchParams, true, { cookie: alice.cookie, origin: "https://evil.example.com" })).status, 403, "foreign Origin");
    assert.equal((await decide(consentUrl.searchParams, true, {})).status, 401, "no session");
    const denied = (await (await decide(consentUrl.searchParams, false, { cookie: alice.cookie })).json()) as { redirect: string };
    assert.equal(new URL(denied.redirect).searchParams.get("error"), "access_denied");
    assert.equal(new URL(denied.redirect).searchParams.get("state"), "st-1");

    const approve = async (params: URLSearchParams, cookie: string) => {
      const r = await decide(params, true, { cookie });
      assert.equal(r.status, 200, await r.clone().text());
      const red = new URL(((await r.json()) as { redirect: string }).redirect);
      assert.equal(`${red.origin}${red.pathname}`, params.get("redirect_uri"));
      assert.equal(red.searchParams.get("state"), params.get("state"));
      assert.equal(red.searchParams.get("iss"), BASE);
      return red.searchParams.get("code")!;
    };
    const code1 = await approve(consentUrl.searchParams, alice.cookie);
    assert.ok(code1);

    // ------------------------------------------------------------ token endpoint
    const token = (form: Record<string, string>) =>
      fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
    type Tok = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string; error?: string };
    const codeForm = (code: string, verifier: string) => ({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id, resource: `${BASE}/mcp` });

    const jsonCt = await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(codeForm(code1, p1.verifier)) });
    assert.equal(jsonCt.status, 400, "token endpoint requires form encoding");

    // wrong verifier (burns that code)
    const pBad = pkce();
    const consentBad = new URL((await get(authorizeUrl(baseParams(pBad.challenge, "st-bad")), alice.cookie)).headers.get("location")!, BASE);
    const codeBad = await approve(consentBad.searchParams, alice.cookie);
    const wrongVerifier = await token(codeForm(codeBad, pkce().verifier));
    assert.equal(wrongVerifier.status, 400);
    assert.equal(((await wrongVerifier.json()) as Tok).error, "invalid_grant");
    // wrong redirect_uri
    const pR = pkce();
    const consentR = new URL((await get(authorizeUrl(baseParams(pR.challenge, "st-r")), alice.cookie)).headers.get("location")!, BASE);
    const codeR = await approve(consentR.searchParams, alice.cookie);
    assert.equal(((await (await token({ ...codeForm(codeR, pR.verifier), redirect_uri: "https://claude.ai/api/mcp/auth_callback" })).json()) as Tok).error, "invalid_grant");

    const t1Res = await token(codeForm(code1, p1.verifier));
    assert.equal(t1Res.status, 200);
    assert.equal(t1Res.headers.get("cache-control"), "no-store");
    const t1 = (await t1Res.json()) as Tok;
    assert.equal(t1.token_type, "Bearer");
    assert.equal(t1.expires_in, 3600);
    assert.equal(t1.scope, "studio");
    assert.ok(t1.access_token && t1.refresh_token);
    assert.equal(((await (await token(codeForm(code1, p1.verifier))).json()) as Tok).error, "invalid_grant", "codes are single-use");
    // stored hashed only
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM oauth_tokens WHERE token_hash = ?").get(t1.access_token) as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM oauth_tokens WHERE token_hash = ?").get(hashSecret(t1.access_token)) as { n: number }).n, 1);

    // ------------------------------------------------------------ MCP over Streamable HTTP with the access token
    const connect = async (bearer: string) => {
      const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
      const c = new Client({ name: "remote-mcp-test", version: "0" });
      await c.connect(transport);
      clients.push(c);
      const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as unknown as CallRes;
      return { client: c, transport, call };
    };
    const textOf = (r: CallRes) => r.content.filter((x): x is { type: "text"; text: string } => x.type === "text").map((x) => x.text).join("\n");

    const a = await connect(t1.access_token);
    assert.ok(a.transport.sessionId, "stateful session id");
    assert.match(a.client.getInstructions() ?? "", /get_guide/);
    const tools = (await a.client.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of ["get_guide", "create_project", "list_projects", "get_project", "set_spec", "add_asset", "preview_frames", "render_video"]) assert.ok(names.includes(n), `tool ${n}`);
    assert.ok(!names.includes("write_custom_component"), "hosted: no write_custom_component");
    const addAsset = tools.find((t) => t.name === "add_asset")!;
    assert.ok(!("path" in ((addAsset.inputSchema as { properties?: object }).properties ?? {})), "hosted add_asset has no local path");

    const created = await a.call("create_project", { name: "Remote test", format: "16:9" });
    assert.ok(!created.isError, textOf(created));
    const projectId = JSON.parse((created.content[0] as { text: string }).text).projectId as string;
    assert.ok(textOf(created).includes(`Open in Motion Studio: ${BASE}/p/${projectId}`));
    assert.ok(!textOf(created).includes(process.env.MOTION_STUDIO_PROJECTS!), "server paths rewritten to URLs");
    assert.equal((db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId) as { owner_id: string }).owner_id, alice.user.id, "ownership recorded");

    const SPEC = { scenes: [{ id: "hello", duration: 1.5, background: { type: "solid", color: "#101010" }, layers: [{ type: "text", text: "Hello", fontSize: 160 }] }] };
    const setSpec = await a.call("set_spec", { projectId, spec: SPEC });
    assert.ok(!setSpec.isError, textOf(setSpec));
    assert.match(textOf(setSpec), /spec saved/);
    assert.ok(textOf(setSpec).includes(`${BASE}/p/${projectId}`));
    const gp = await a.call("get_project", { projectId });
    assert.ok(!gp.isError, textOf(gp));
    assert.match(textOf(gp), /"hello"/);
    const lp = await a.call("list_projects");
    assert.ok(textOf(lp).includes(projectId));
    const hosted = await a.call("add_asset", { projectId, url: "http://127.0.0.1:1/logo.png" });
    assert.ok(hosted.isError && /https/.test(textOf(hosted)), textOf(hosted));
    const ssrf = await a.call("add_asset", { projectId, url: "https://127.0.0.1/logo.png" });
    assert.ok(ssrf.isError && /private/.test(textOf(ssrf)), textOf(ssrf));
    const guide = await a.call("get_guide");
    assert.ok(!guide.isError && textOf(guide).length > 1000);

    // ------------------------------------------------------------ PAT + isolation (Bob)
    const pat = auth.createToken({ id: bob.user.id, email: bob.user.email, name: bob.user.name }, "test pat");
    const b = await connect(pat.token);
    const bList = await b.call("list_projects");
    assert.ok(!textOf(bList).includes(projectId), "bob does not see alice's project");
    for (const [tool, args] of [
      ["get_project", { projectId }],
      ["get_spec", { projectId }],
      ["set_spec", { projectId, spec: SPEC }],
      ["update_scene", { projectId, index: 0, scene: SPEC.scenes[0] }],
      ["preview_frames", { projectId }],
      ["render_video", { projectId }],
    ] as const) {
      const r = await b.call(tool, args);
      assert.ok(r.isError && /not found/.test(textOf(r)), `${tool}: ${textOf(r)}`);
    }
    const bobProj = await b.call("create_project", { name: "Bob's" });
    const bobId = JSON.parse((bobProj.content[0] as { text: string }).text).projectId as string;
    assert.ok(!textOf(await a.call("list_projects")).includes(bobId), "alice does not see bob's project");
    // Bob cannot ride Alice's session
    const hijack = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${pat.token}`, "mcp-session-id": a.transport.sessionId!, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    assert.equal(hijack.status, 404, "another user's session id is unknown to you");
    const unknown = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${pat.token}`, "mcp-session-id": "nope", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    assert.equal(unknown.status, 404);

    // audience binding: an access token for another resource is refused
    const foreign = `msa_${b64url(crypto.randomBytes(32))}`;
    db.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, resource, expires_at, revoked) VALUES (?, 'access', ?, ?, 'studio', ?, ?, 0)").run(
      hashSecret(foreign),
      client.client_id,
      alice.user.id,
      "https://other.example.com/mcp",
      isoIn(3600_000),
    );
    const foreignRes = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${foreign}`, "content-type": "application/json" }, body: "{}" });
    assert.equal(foreignRes.status, 401, "token for another resource");
    // a refresh token is not a bearer token
    assert.equal((await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t1.refresh_token}` }, body: "{}" })).status, 401);
    // consent cannot be granted with a bearer token
    const pB = pkce();
    const consentB = new URL((await get(authorizeUrl(baseParams(pB.challenge, "st-b")), alice.cookie)).headers.get("location")!, BASE);
    assert.equal((await decide(consentB.searchParams, true, { bearer: t1.access_token })).status, 403);

    // ------------------------------------------------------------ refresh rotation, grace retry, revocation, reuse detection
    const refresh = (rt: string) => token({ grant_type: "refresh_token", refresh_token: rt, client_id: client.client_id, resource: `${BASE}/mcp` });
    const t2 = (await (await refresh(t1.refresh_token)).json()) as Tok;
    assert.ok(t2.access_token && t2.refresh_token && t2.refresh_token !== t1.refresh_token, JSON.stringify(t2));
    const t2again = (await (await refresh(t1.refresh_token)).json()) as Tok;
    assert.equal(t2again.refresh_token, t2.refresh_token, "immediate retry of a just-rotated token gets the same pair");
    const t3 = (await (await refresh(t2.refresh_token)).json()) as Tok;
    assert.ok(t3.access_token, JSON.stringify(t3));
    const a3 = await connect(t3.access_token);
    assert.ok((await a3.client.listTools()).tools.length > 5);
    // the session keeps working when the client switches to a refreshed token of the same user
    assert.ok((await a.call("list_projects")).content.length);

    // revoke t3's access token → 401 on the next request
    const rv = await fetch(`${BASE}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: t3.access_token, client_id: client.client_id }).toString() });
    assert.equal(rv.status, 200);
    const afterRevoke = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${t3.access_token}`, "mcp-session-id": a3.transport.sessionId!, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(afterRevoke.status, 401, "revoked token refused even inside a live session");
    assert.match(afterRevoke.headers.get("www-authenticate") ?? "", /error="invalid_token"/);

    // reuse of t1's refresh token (its successor was itself rotated) → whole grant revoked
    const reuse = await refresh(t1.refresh_token);
    assert.equal(reuse.status, 400);
    assert.equal(((await reuse.json()) as Tok).error, "invalid_grant");
    assert.equal(((await (await refresh(t3.refresh_token)).json()) as Tok).error, "invalid_grant", "family revoked: newest refresh token dead");
    assert.equal((await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t2.access_token}` }, body: "{}" })).status, 401, "family revoked: access tokens dead");
    assert.equal((await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t1.access_token}` }, body: "{}" })).status, 401);

    // PAT still fine after all that
    assert.ok(!(await b.call("get_project", { projectId: bobId })).isError);
    // session termination
    await b.transport.terminateSession();

    // ------------------------------------------------------------ the SDK's own OAuth client (closest to claude.ai)
    const store: { client?: unknown; tokens?: { access_token: string; refresh_token?: string }; verifier?: string; authUrl?: URL } = {};
    const provider = {
      get redirectUrl() {
        return "https://claude.ai/api/mcp/auth_callback";
      },
      get clientMetadata() {
        return { client_name: "SDK Client", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
      },
      state: () => "sdk-state",
      clientInformation: () => store.client as never,
      saveClientInformation: (ci: unknown) => void (store.client = ci),
      tokens: () => store.tokens as never,
      saveTokens: (t: { access_token: string; refresh_token?: string }) => void (store.tokens = t),
      redirectToAuthorization: (u: URL) => void (store.authUrl = u),
      saveCodeVerifier: (v: string) => void (store.verifier = v),
      codeVerifier: () => store.verifier!,
    };
    const sdkTransport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { authProvider: provider as never });
    const sdkClient = new Client({ name: "sdk-oauth", version: "0" });
    await assert.rejects(sdkClient.connect(sdkTransport), (e: unknown) => e instanceof UnauthorizedError, "first connect needs authorization");
    assert.ok(store.authUrl, "SDK built an authorization URL");
    assert.equal(store.authUrl!.searchParams.get("resource"), `${BASE}/mcp`);
    assert.equal(store.authUrl!.searchParams.get("code_challenge_method"), "S256");
    const sdkConsent = new URL((await get(store.authUrl!.toString(), bob.cookie)).headers.get("location")!, BASE);
    assert.equal(sdkConsent.pathname, "/connect/authorize");
    assert.equal(sdkConsent.searchParams.get("client_name"), "SDK Client");
    const sdkCode = await approve(sdkConsent.searchParams, bob.cookie);
    await sdkTransport.finishAuth(sdkCode);
    assert.ok(store.tokens?.access_token && store.tokens.refresh_token);
    const sdkTransport2 = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { authProvider: provider as never });
    const sdkClient2 = new Client({ name: "sdk-oauth", version: "0" });
    await sdkClient2.connect(sdkTransport2);
    clients.push(sdkClient2);
    const sdkList = (await sdkClient2.callTool({ name: "list_projects", arguments: {} })) as unknown as CallRes;
    assert.ok(textOf(sdkList).includes(bobId) && !textOf(sdkList).includes(projectId), "SDK-authorized client acts as bob");

    console.log("remote-mcp: all assertions passed");
  } catch (e) {
    failed = true;
    console.error(e);
  } finally {
    for (const c of clients) await c.close().catch(() => undefined);
    server.close();
    try {
      db.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
