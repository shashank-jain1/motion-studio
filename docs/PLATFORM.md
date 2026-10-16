# Motion Studio Platform (Phase 3): contract

Phase 3 turns the local studio into a hostable product: accounts, per-user projects, a persistent render-job queue
with pluggable backends, and a **remote MCP connector** (Streamable HTTP + OAuth 2.1) that claude.ai can use.

## Modes

`MOTION_STUDIO_MODE`:
- `local` (default): single user. A built-in owner account (`local@motion.studio`) is auto-signed-in, so the studio works with no
  login. All features are on, including local-path asset import and custom components.
- `hosted`: accounts are required, every route is user-scoped, local-path asset import is **disabled** and
  `write_custom_component` is **disabled** (arbitrary code execution in renders). Assets come from upload or https URL only.

Other env: `MOTION_STUDIO_PUBLIC_URL` (e.g. `https://studio.example.com`, used for OAuth issuer, MCP resource URL and
deep links), `MOTION_STUDIO_DATA` (default `<repo>/data`; holds `motion-studio.db`), `MOTION_STUDIO_PROJECTS`,
`MOTION_STUDIO_SECRET` (signing secret; generated into `data/secret` if unset), `RENDER_BACKEND` = `local` | `lambda`.

## Database (node:sqlite, `src/server/db.ts`)

```sql
users(id TEXT PK, email TEXT UNIQUE, name TEXT, password_hash TEXT, created_at TEXT)
sessions(id TEXT PK /* random 32B b64url, stored hashed */, user_id, created_at, expires_at)
projects(id TEXT PK /* = folder name */, owner_id, created_at)
api_tokens(id TEXT PK, user_id, name, token_hash, prefix /* first 8 chars for display */, created_at, last_used_at)
jobs(id TEXT PK, user_id, project_id, kind /* render|preview */, quality, backend, status /* queued|running|done|error|canceled */,
     progress REAL, stage TEXT, output TEXT /* JSON: RenderInfo */, error TEXT, created_at, started_at, finished_at)
oauth_clients(client_id PK, client_secret_hash NULL, redirect_uris JSON, client_name, created_at)
oauth_codes(code_hash PK, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
oauth_tokens(token_hash PK, kind /* access|refresh */, client_id, user_id, scope, resource, expires_at, revoked INT)
```
Passwords: `crypto.scrypt` (N=2^15, r=8, p=1, 32B salt), constant-time compare. Every secret (sessions, PATs, OAuth
codes and tokens) is stored as a SHA-256 hash only. Unowned project folders found on boot are assigned to the first user
(local mode: the local owner).

## Auth interface (`src/server/auth.ts`, used by every route and by the remote MCP)

```ts
export type User = { id: string; email: string; name: string };
export function currentUser(c: Context): User | null;              // session cookie `ms_session` (local mode → local owner)
export function requireUser(c: Context): User;                      // throws HTTPException(401)
export function userFromBearer(token: string): { user: User; scope: string[]; via: "pat" | "oauth" } | null;
export function assertProjectOwner(user: User, projectId: string): void;   // 404 if not owned (no existence leak)
export function listUserProjectIds(user: User): string[];
export function recordProjectOwner(user: User, projectId: string): void;
```

## HTTP API additions (the existing `docs/WEB_API.md` routes become user-scoped)

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/auth/me` | — | `{ user: User \| null, mode: "local" \| "hosted", publicUrl }` |
| `POST /api/auth/signup` | `{ email, password, name }` | `{ user }` + session cookie (hosted mode; 403 in local) |
| `POST /api/auth/login` | `{ email, password }` | `{ user }` + session cookie |
| `POST /api/auth/logout` | — | `{ ok: true }` |
| `GET /api/tokens` | — | `{ id, name, prefix, createdAt, lastUsedAt }[]` |
| `POST /api/tokens` | `{ name }` | `{ token /* shown once */, id, name, prefix }` |
| `DELETE /api/tokens/:id` | — | `{ ok: true }` |
| `GET /api/jobs?projectId=` | — | `Job[]` newest first |
| `GET /api/jobs/:id` | — | `Job` |
| `GET /api/jobs/:id/events` | — | **SSE**: `progress {progress, stage}` · `done {job}` · `error {job}` (sends the current state first) |
| `POST /api/jobs/:id/cancel` | — | `Job` |
| `POST /api/projects/:id/render` | `{ quality }` | **changed**: `{ job: Job }` immediately (no SSE); follow `/api/jobs/:id/events` |
| `GET /api/connect` | — | `{ mcpUrl, publicUrl, claudeCodeConfig /* JSON snippet using a PAT placeholder */, steps: string[] }` |

```ts
type Job = { id, projectId, kind: "render"|"preview", quality: "draft"|"final", backend: "local"|"lambda",
  status: "queued"|"running"|"done"|"error"|"canceled", progress: number, stage?: string, position?: number /* in queue */,
  output?: RenderInfo, error?: string, createdAt, startedAt?, finishedAt? };
```

The chat agent's `render_video` tool also goes through the job queue.

## Render backends (`src/server/render/`)

`RenderBackend = { name; render(job, spec, onProgress, signal): Promise<RenderInfo> }`.
- **local**: the existing `renderVideo` under the machine render lock (one at a time).
- **lambda**: `@remotion/lambda` (pin 4.0.532). `deploySite`/`getOrCreateBucket` via `pnpm deploy:lambda` (stores
  serveUrl/function name in `data/lambda.json`), then `renderMediaOnLambda` + `getRenderProgress`. The output is downloaded into
  `projects/<id>/renders/`. Assets must be reachable by Lambda, so the job uploads the project's `assets/`, `glyphs.json` and `*.logo.json` to
  the site bucket under `projects/<id>/` and passes that https base as `assetBase`. Enabled when `RENDER_BACKEND=lambda` and
  AWS credentials (`REMOTION_AWS_ACCESS_KEY_ID`/`REMOTION_AWS_SECRET_ACCESS_KEY`/`REMOTION_AWS_REGION`) exist.

## Remote MCP (`src/server/mcp-remote.ts` + `src/server/oauth.ts`) → `mountRemoteMcp(app)`

- `POST|GET|DELETE /mcp`: MCP Streamable HTTP via the SDK's `WebStandardStreamableHTTPServerTransport`
  (stateless or session-mapped). It exposes the shared tool registry (`src/core/tools.ts`) **scoped to the authenticated user**:
  `create_project` records ownership, `list_projects` lists only theirs, every projectId is ownership-checked, and in hosted mode
  `add_asset` accepts `url` only and `write_custom_component` is absent. Tool results that touch a project append
  `Open in Motion Studio: ${PUBLIC_URL}/p/<id>`.
- Auth: `Authorization: Bearer <token>`, where the token is an OAuth access token or a personal access token. A missing or invalid token gets
  `401` with `WWW-Authenticate: Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`.
- OAuth 2.1 authorization server (for claude.ai custom connectors):
  - `GET /.well-known/oauth-protected-resource` → `{ resource: ${PUBLIC_URL}/mcp, authorization_servers: [PUBLIC_URL], scopes_supported: ["studio"] }`
  - `GET /.well-known/oauth-authorization-server` → RFC 8414 metadata (`issuer`, `authorization_endpoint: /oauth/authorize`,
    `token_endpoint: /oauth/token`, `registration_endpoint: /oauth/register`, `revocation_endpoint: /oauth/revoke`,
    `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code","refresh_token"]`,
    `response_types_supported: ["code"]`, `token_endpoint_auth_methods_supported: ["none","client_secret_post"]`)
  - `POST /oauth/register`: RFC 7591 dynamic client registration (public clients, https or localhost redirect URIs)
  - `GET /oauth/authorize`: validates the params and redirects to the web consent screen `/connect/authorize?...` (requires login,
    and sends the user to `/login?next=` first if needed)
  - `POST /oauth/authorize/decision` `{ ...params, approve: boolean }` (session-authenticated, CSRF-checked via an Origin match) →
    `{ redirect: url }` carrying `code`+`state` or `error=access_denied`
  - `POST /oauth/token`: `authorization_code` (PKCE S256 required, redirect_uri match, 60s single-use code) and
    `refresh_token` (rotating). Access tokens last 1h, refresh tokens 30d, and both are bound to the `resource`.
  - `POST /oauth/revoke`

## Web routes the UI must provide

`/login`, `/signup` (hosted only), `/` (projects), `/p/:id` (studio), `/account` (profile, API tokens, "Connect to Claude"
panel with the MCP URL, claude.ai steps and the Claude Code config snippet, render queue), `/connect/authorize` (OAuth consent screen:
"<client_name> wants to direct videos in your Motion Studio", Approve/Deny → POST /oauth/authorize/decision → navigate to `redirect`).

## Deployment

`Dockerfile` (node:22-bookworm-slim, Chromium deps for Remotion, ffmpeg, pnpm, build web, `MOTION_STUDIO_MODE=hosted`),
`docker-compose.yml` (app + Caddy for automatic HTTPS, volume for `data/` and `projects/`), `Caddyfile`, and `docs/DEPLOY.md`
(VPS steps, env vars, Lambda setup, and "Add to claude.ai: Settings → Connectors → Add custom connector → `${PUBLIC_URL}/mcp`").

## One spec → every platform
- `spec.format` is the master format. `spec.formats[]` lists the extra formats to adapt to. `layer.adapt["9:16"] = {...}` overrides are applied last.
- `reflowSpec(spec, target)` (src/engine/spec/reflow.ts) re-lays out each scene:
  - fill layers stretch to the new canvas;
  - content clusters restack: going 16:9 → 9:16, rows become a column or a balanced grid; going 9:16 → 16:9, tall stacks become [copy | visual] columns;
  - on verticals, text keeps hooks ≥80px and body text ≥48px;
  - critical content is clamped into SAFE_ZONES.
- The renderer, the Player and the tests all use this same function.

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/projects` | `{ name, format?, template? }` | card. With `template`, the template's spec and assets are copied in; a different `format` gives a reflowed master |
| `GET /api/templates` | — | `TemplateMeta[]` `{slug,title,niche,description,format,formats,durationSeconds,tags,poster}` |
| `GET /api/templates/:slug` | — | `TemplateMeta & { spec }` |
| `GET /templates/:slug/{poster.jpg,glyphs.json,assets/*}` | — | public files (template thumbnails use `assetBase=/templates/<slug>`) |
| `POST /api/projects/:id/render` | `{ quality, format? }` | `{ job }`. With `format`, the reflowed film is rendered |
| `POST /api/projects/:id/render-all` | `{ quality }` | `{ jobs: Job[], formats }`, one job per format |

- `Job.format?` and `RenderInfo.format?` are set on every format-aware render. Filenames are `<stamp>-<quality>-<aspect>.mp4`, e.g. `…-draft-9x16.mp4`.
- DB migration 3 adds `jobs.format`; NULL means the master format.
- MCP: `preview_frames { format? }` and `render_video { format?, all_formats? }`.
- CLI: `--format=16:9`.
