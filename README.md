# Motion Studio

AI-directed motion graphics on [Remotion](https://remotion.dev). An AI (Claude, Codex, Cursor, …) connects over
MCP, writes a JSON **Scene Spec**, *looks* at preview frames to critique its own work, and renders MP4s.

```
AI client ──MCP──▶ src/mcp/server.ts ──▶ src/core (projects, assets, render, audio)
                                              │ bundle + headless Chrome + FFmpeg
                                              ▼
                                   src/engine (Remotion composition "Spec")
                                   ├─ spec/      Scene Spec schema (zod) + style presets
                                   ├─ render/    SpecVideo → scenes → layers, camera rig, transitions
                                   ├─ kit/       Motion Kit: kinetic text, 3D devices, shaders, particles,
                                   │             paths, cards, counters, captions, clouds, FX…
                                   └─ custom/    AI-written components (escape hatch)
```

## Quick start

```bash
pnpm install
```

**Use from Claude Code:** `.mcp.json` registers the `motion-studio` server for this folder. Open Claude Code here and ask
for a video, e.g. *"Make a 15s Instagram reel launching our cold brew; logo is ~/Downloads/logo.png"*.

**Use from Claude Desktop / Codex / Cursor:** add a stdio MCP server with command
`/home/shashank/motion-studio/node_modules/.bin/tsx` and arg `/home/shashank/motion-studio/src/mcp/server.ts`.

**CLI:**

```bash
pnpm cli list
pnpm cli preview <projectId> 1.2,3.4,6
pnpm cli render <projectId> --final
```

**Studio (scrub the timeline live):** `pnpm studio`, then set the `Spec` composition's props to `{ "projectId": "<id>" }`.

## MCP tools

`get_guide`, `list_styles`, `create_project`, `list_projects`, `get_project`, `add_asset`, `analyze_logo`, `analyze_audio`, `set_spec`,
`get_spec`, `update_scene`, `preview_frames`, `render_video`, `write_custom_component`, `list_custom_components`,
`open_studio_hint`.

The AI's craft knowledge lives in [docs/DIRECTOR_GUIDE.md](docs/DIRECTOR_GUIDE.md) and the spec format in
[docs/KIT_REFERENCE.md](docs/KIT_REFERENCE.md); both are served by `get_guide`.

## Notes

- Rendering is local: no API keys, no cloud cost. Draft (540p) ≈ 1.5× real time; final 1080p is slower.
- Set `MOTION_STUDIO_GL=swangle` if WebGL shaders/transitions fail on a machine without a GPU.
- Remotion license: free for individuals and companies of up to 3 people; larger companies need a
  [company license](https://www.remotion.pro/license).
