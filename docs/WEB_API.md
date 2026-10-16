# Motion Studio Web — API contract (Phase 2)

Server: `src/server` (Hono, Node) on `http://127.0.0.1:${MOTION_STUDIO_PORT ?? 4310}`.
Web app: `web/` (Vite + React) on `:5173` in dev, proxying `/api` and `/files` to the server. In production the server
also serves the built web app (`web/dist`) at `/`.

All JSON. Errors: HTTP 4xx/5xx with `{ "error": string }`.

## Files

`GET /files/:projectId/<path>` — any file inside the project folder (assets, renders, previews, `glyphs.json`,
`assets/*.logo.json`). Supports HTTP Range (video seeking), correct content types, path-traversal safe.
The browser Player uses `assetBase = ${origin}/files/${projectId}`.

## Projects

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/projects` | — | `ProjectCard[]` = `{ id, name, format, createdAt, updatedAt, hasSpec, thumbnail?: url, durationSeconds? }` (newest first) |
| `POST /api/projects` | `{ name, format? }` | `ProjectCard` |
| `GET /api/projects/:id` | — | `ProjectState` (below) |
| `DELETE /api/projects/:id` | — | `{ ok: true }` |
| `PUT /api/projects/:id/spec` | `{ spec }` | `ValidationResult & { timeline? }` — saved only when `ok` |
| `POST /api/projects/:id/validate` | `{ spec }` | `ValidationResult & { timeline? }` — never saves (live editor lint) |
| `POST /api/projects/:id/assets` | multipart: `file`, optional `name` | `AssetInfo & { logo?: LogoSummary }` |
| `DELETE /api/projects/:id/assets/:file` | — | `{ ok: true }` |
| `GET /api/projects/:id/logo/:file` | — | `{ summary: LogoSummary, partMapUrl?: url }` |
| `POST /api/projects/:id/preview` | `{ times?: number[], scale?: number }` | `{ sheetUrl, frames: { time, url, label }[] }` |
| `POST /api/projects/:id/render` | `{ quality: "draft" \| "final" }` | **SSE**: `progress {progress: 0..1}` · `done {render: RenderInfo}` · `error {message}` |

```ts
type ProjectState = {
  project: { id, name, format, createdAt, updatedAt };
  spec: object | null;                 // raw saved spec (as written, may contain "beat:N" strings)
  assets: (AssetInfo & { url: string })[];
  renders: RenderInfo[];               // newest first
  timeline: Timeline | null;
  validation: ValidationResult | null; // of the saved spec (warnings incl. craft/*)
};
type AssetInfo = { path: string /* "assets/x.png" */, kind: "image"|"video"|"audio"|"lottie"|"other", sizeBytes, width?, height?, duration?, hasAudio?, palette?: string[] };
type RenderInfo = { file: string, url: string, quality: "draft"|"final", createdAt: string, sizeBytes: number, seconds?: number, width?, height? };
type Timeline = { total: number, scenes: { index, id?, start, end, duration, overlapIn, transition?: string }[],
                  actors?: { id, from: number, until: number }[] };
type ValidationResult = { ok: true, durationSeconds, warnings: string[] } | { ok: false, errors: string[], warnings: string[] };
type LogoSummary = /* src/core/logo.ts logoSummary() output: parts, groups, holes, palette, kit, suggestedModes */ object;
```

## AI director chat

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/projects/:id/chat` | — | `{ messages: UiMessage[], running: boolean }` |
| `POST /api/projects/:id/chat` | `{ message: string }` | **SSE** stream of `ChatEvent` (one run of the agent loop) |
| `POST /api/projects/:id/chat/stop` | — | `{ ok: true }` — aborts the running turn |
| `DELETE /api/projects/:id/chat` | — | `{ ok: true }` — clears history |

```ts
type ChatEvent =
  | { type: "status", text: string }                         // "Thinking…", "Rendering preview…"
  | { type: "text", delta: string }                          // assistant text delta (markdown)
  | { type: "thinking", delta: string }                      // reasoning summary / progress notes (may be absent)
  | { type: "tool_start", id: string, name: string, summary: string }   // e.g. "Writing spec · 5 scenes"
  | { type: "tool_end", id: string, ok: boolean, summary: string, images?: string[] /* urls */ }
  | { type: "spec", spec: object, timeline: Timeline }       // spec saved → web app reloads the Player
  | { type: "render", render: RenderInfo }
  | { type: "error", message: string }
  | { type: "done" };

type UiMessage = { id: string, role: "user" | "assistant", createdAt: string,
  parts: ({ type: "text", text: string } | { type: "thinking", text: string }
        | { type: "tool", name: string, summary: string, ok?: boolean, images?: string[] })[] };
```

## Settings

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/settings` | — | `{ model, effort, hasApiKey: boolean, keySource: "env"\|"profile"\|"settings"\|"none", models: string[] }` |
| `PUT /api/settings` | `{ model?, effort?, apiKey? }` | same as GET. The key is stored in `~/.config/motion-studio/config.json` (mode 600), never returned. |

## Engine in the browser

```ts
import { SpecVideo, parseSpec, resolveSize, specSeconds } from "../../src/engine/render/SpecVideo";
// <Player component={SpecVideo} inputProps={{ spec, assetBase: `${location.origin}/files/${id}`, projectId: id }}
//         durationInFrames={Math.round(specSeconds(parsed) * parsed.fps)} fps={parsed.fps} compositionWidth/Height={resolveSize(parsed)} />
```
