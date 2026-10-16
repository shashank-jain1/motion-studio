# Deploying Motion Studio

Run Motion Studio as a hosted product: accounts, per-user projects, a render-job queue and a remote MCP connector
that claude.ai and Claude Code can use. The stack is one Docker image (the app) behind Caddy (automatic HTTPS).

## Requirements

- A Linux VPS with Docker Engine and the Compose plugin. For local rendering, plan on **4+ vCPU and 8 GB RAM**
  (each render runs headless Chrome and FFmpeg, and the server renders one job at a time). With Lambda rendering,
  2 vCPU and 4 GB is enough.
- A domain name, e.g. `studio.example.com`.
- Ports 80 and 443 open (Caddy uses them for Let's Encrypt and HTTPS).
- Optional: an Anthropic API key (powers the in-app AI director chat) and an AWS account (Lambda rendering).

## 1. DNS

Point an `A` record (and an `AAAA` record if the server has IPv6) for your domain at the server, and wait until
`dig +short studio.example.com` returns the server's IP. Caddy can only get a certificate once DNS resolves.

## 2. Configure

```bash
git clone <your fork> motion-studio && cd motion-studio
cat > .env <<'EOF'
DOMAIN=studio.example.com
ANTHROPIC_API_KEY=sk-ant-...        # optional: in-app director chat (all users share this key)
MOTION_STUDIO_SIGNUP=open           # "closed" after you have created your account
EOF
```

| Variable | Default | Meaning |
|---|---|---|
| `DOMAIN` | (required) | Public hostname. Compose derives `MOTION_STUDIO_PUBLIC_URL=https://$DOMAIN`. |
| `MOTION_STUDIO_MODE` | `hosted` in the image, `local` otherwise | `hosted`: accounts required, local-path assets and custom components disabled. |
| `MOTION_STUDIO_PUBLIC_URL` | `http://127.0.0.1:<port>` | Public origin, used for the OAuth issuer, the MCP URL, deep links and the cookie `Secure` flag. |
| `MOTION_STUDIO_SIGNUP` | `open` | `closed` blocks sign-up once the first account (the owner) exists. |
| `MOTION_STUDIO_SECRET` | generated into `data/secret` | Signing secret. Set it only if you need it to be stable across data volumes. |
| `MOTION_STUDIO_DATA` | `/app/data` | SQLite DB (`motion-studio.db`), `secret`, `lambda.json`, app settings. Back it up. |
| `MOTION_STUDIO_PROJECTS` | `/app/projects` | Project folders: specs, assets, renders. Back it up. |
| `MOTION_STUDIO_TRUST_PROXY` | `1` in compose | Read the client IP (for login rate limits) from Caddy's `X-Forwarded-For`. |
| `MOTION_STUDIO_MAX_DOWNLOAD_MB` | `200` | Size cap for assets imported from a URL. |
| `MOTION_STUDIO_ALLOWED_HOSTS` / `_ORIGINS` | none | Extra Host headers / browser origins to accept (comma-separated). |
| `ANTHROPIC_API_KEY` | none | Key for the in-app director. Only the owner (the first account) can change settings in the UI. |
| `RENDER_BACKEND` | `local` | `lambda` renders on AWS Lambda (see below). |
| `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY` / `REMOTION_AWS_REGION` | none / none / `us-east-1` | AWS credentials for Lambda. |
| `LAMBDA_CONCURRENCY` | `4` | Lambda render jobs that run at the same time. |

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f app        # wait for "server on http://0.0.0.0:4310 · mode hosted"
```

Open `https://studio.example.com`. Caddy fetches the certificate on the first request.
The app's health check is `GET /api/health`.

## 4. First sign-up

The **first account you create becomes the owner**. It adopts any project folders already in the projects volume,
and it is the only account that can change settings (model, effort, API key). Create your account right away, then
set `MOTION_STUDIO_SIGNUP=closed` in `.env` and run `docker compose up -d` if the server is just for you or your team.

## 5. Connect Claude

- **claude.ai**: Settings → Connectors → **Add custom connector**, then paste `https://studio.example.com/mcp`.
  Click Connect and approve on the Motion Studio consent screen (OAuth 2.1 with PKCE and dynamic client registration).
- **Claude Code**:
  ```bash
  claude mcp add --transport http motion-studio https://studio.example.com/mcp
  ```
  Claude Code runs the OAuth flow in your browser the first time. To use a token instead, create a personal
  access token under Account → API tokens and add
  `--header "Authorization: Bearer ms_pat_..."`.

The Account page in the app shows the same URL, the steps and a JSON config snippet.
Renders over MCP go through the job queue. If a render takes more than about 45 seconds, `render_video` answers
"Still rendering, job …" and Claude polls `render_status`.

## Lambda rendering (optional)

Lambda renders in parallel on AWS, so the VPS never runs Chrome.

1. In AWS IAM, create a user with the Remotion Lambda policy and a role named `remotion-lambda-role`. Remotion's
   guide lists the exact steps and policies: <https://www.remotion.dev/docs/lambda/setup> (run
   `npx remotion lambda policies user` / `role` to print them).
2. Put its keys in `.env`:
   `RENDER_BACKEND=lambda`, `REMOTION_AWS_ACCESS_KEY_ID=…`, `REMOTION_AWS_SECRET_ACCESS_KEY=…`, `REMOTION_AWS_REGION=us-east-1`.
3. Deploy the function and the site once (run it again after every engine upgrade):
   ```bash
   docker compose run --rm app node_modules/.bin/tsx scripts/deploy-lambda.ts   # = pnpm deploy:lambda
   docker compose up -d
   ```
   This writes `data/lambda.json` with the function name, bucket and serve URL. Tune it with `LAMBDA_MEMORY_MB`,
   `LAMBDA_DISK_MB` and `LAMBDA_TIMEOUT_SEC`.

For each render, the project's `assets/` and `glyphs.json` are synced to the Remotion bucket under an unguessable
`projects/<id>-<hmac>/` prefix (public-read, so Lambda's Chrome can load them). The MP4 is then downloaded into the
project's `renders/`. If Lambda is selected but not configured, render requests fail at once with an error that says
what is missing.

## Updating and backups

```bash
git pull && docker compose up -d --build
docker run --rm -v motion-studio_motion_data:/d -v "$PWD":/b busybox tar czf /b/data-$(date +%F).tgz -C /d .
docker run --rm -v motion-studio_motion_projects:/p -v "$PWD":/b busybox tar czf /b/projects-$(date +%F).tgz -C /p .
```

On restart, queued render jobs resume, and jobs that were mid-render are marked `error: "server restarted"`.

## Security notes

- **Accounts.** Passwords are hashed with scrypt (N=2^15, r=8, p=1). Sessions, personal access tokens and OAuth
  codes and tokens are stored only as SHA-256 hashes. The session cookie `ms_session` is HttpOnly, SameSite=Lax and
  Secure over https, and expires after 30 days (sliding). Login and sign-up are rate-limited per IP.
- **Isolation.** Every project route, `/files/<project>/…`, job and MCP tool call is checked against the project's
  owner. Another user's project returns 404, so its existence never leaks.
- **CSRF and DNS rebinding.** Only the public Host is accepted, and state-changing browser requests must come from
  the public origin. User files are served with `Content-Security-Policy: sandbox`.
- **Hosted restrictions.** Assets cannot be imported from server paths, and `write_custom_component` (arbitrary
  code in renders) is disabled. Assets come from uploads or from public http(s) URLs. URL downloads re-check every
  redirect hop, refuse loopback, private, link-local, CGNAT and reserved IPv4/IPv6 targets (including IPv4-mapped
  addresses), pin the connection to the checked IP, and are capped in size and time. Specs may not contain `..`
  paths or URLs that point at private hosts.
- **Remaining risk.** A spec can still point the renderer's Chrome at a public hostname whose DNS later changes to
  a private address (DNS rebinding between the check and the render). For stricter isolation, run the container in
  a network without access to internal services, which is the Docker default with no extra networks.
- **Costs.** With `MOTION_STUDIO_SIGNUP=open`, anyone can create an account, render on your CPU or Lambda bill, and
  chat with your Anthropic key. Close sign-up unless you want that.
- **Licensing.** Remotion needs a company license for companies with more than 3 people.
