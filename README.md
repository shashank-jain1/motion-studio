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
`/Users/shashank/motion-studio/node_modules/.bin/tsx` and arg `/Users/shashank/motion-studio/src/mcp/server.ts`.

**CLI:**

```bash
pnpm cli list
pnpm cli preview <projectId> 1.2,3.4,6
pnpm cli render <projectId> --final
```

**Studio (scrub the timeline live):** `pnpm studio`, then set the `Spec` composition's props to `{ "projectId": "<id>" }`.

## Visual editing (Phase 4)

The studio's **Edit** tab (key `1`) edits the film directly, without the chat or the raw JSON. Pick a scene, then a layer. Its
fields come from the engine schema, so every layer type is covered: content, transform, timing, enter/exit motion and
type-specific style. Drag a field's label to scrub its value. In the viewer, drag the selected layer's handle to move it
(⇧ locks the axis; it snaps to the frame's center lines). On the timeline, drag a clip's right edge to change the scene's
duration. ⌘Z / ⇧⌘Z undo and redo, ⌥+arrows nudge the layer, ⌫ deletes it and Esc deselects. Scenes can be duplicated,
added, reordered and deleted, and the film palette (`$tokens`) can be recolored.

Visual edits rewrite the Spec editor's text, so Save, validation and the director-conflict prompt behave exactly as they
do for typed edits. Nothing is written to disk until you save. The model lives in `web/src/lib/specEdit.ts` and is tested by
`npm run test:edit`.

## Version history (Phase 5)

Every save that changes a film is kept: studio saves, the in-app director, external MCP clients (named, e.g. "Claude Code"),
templates and font registration. Each version records who made it and what changed, scene by scene and layer by layer. The
studio's **History** tab (key `4`) lists the versions. You can **preview** one in the viewer (Esc exits), **compare** it with
what is in the editor, and **restore** it. Restoring saves a new version, so a restore can be undone too. When the AI made the
last change, a one-click **Undo it** appears at the top. AI clients get the same abilities through `list_versions` and
`restore_version` ("undo that" → restore the previous version).

History lives in `projects/<id>/versions/` (gitignored): one JSON file per version plus an append-only `index.jsonl`. It is
safe when the web server and a stdio MCP server write the same project, and the newest 200 versions are kept. A project
that already had a spec gets it saved as a "Before version history" baseline on its first tracked change. Code:
`src/core/versions.ts`, `src/engine/spec/diff.ts`; tests: `npm run test:versions`.

CI (`.github/workflows/ci.yml`) runs `verify:motion` and `test:server` (the remote-MCP OAuth flow and the director loop
against a fake Claude) on every push and pull request.

## MCP tools

`get_guide`, `list_styles`, `create_project`, `list_projects`, `get_project`, `add_asset`, `analyze_logo`, `analyze_audio`, `set_spec`,
`get_spec`, `update_scene`, `preview_frames`, `render_video`, `write_custom_component`, `list_custom_components`,
`open_studio_hint`, `list_versions`, `restore_version`, `motion_recipes`, `build_motion_scene`, `build_motion_sequence`, `build_design_film`, `inspect_video_reference`, `inspect_sound`, `inspect_render_sound`, `list_fonts`, `import_font`, `register_font`.

The AI's craft knowledge lives in [docs/DIRECTOR_GUIDE.md](docs/DIRECTOR_GUIDE.md) and the spec format in
[docs/KIT_REFERENCE.md](docs/KIT_REFERENCE.md); both are served by `get_guide`.

## Notes

Premium motion workflow: [Motion and sound playbook](docs/MOTION_PLAYBOOK.md). The director can compose eight editable shot recipes, author six shared-clock gestures, pin sound to contact/velocity landmarks and inspect the cue plan. The editor shows clickable SFX apex markers. Research and capability gaps are recorded in the [skills audit](docs/research/07-motion-skills-upgrade.md).

Run `npm run test:motion` for timing contracts and `npm run showcase:motion` for an eight-shot motion/audio lab (new project, draft MP4, frames and cue report).

Continuous films: `npm run showcase:continuity` builds a persistent 3D hero with connected sonic phrases and an isolated/connected audio comparison. [Studio research](docs/research/08-studio-motion-and-sonic-continuity.md) explains the family-cohesion, sound bridges and continuous spline motion. `npm run verify:motion` includes the continuity regression suite.

Editorial films: `npm run showcase:design` creates an original 20-second design film with native cursor/selection/toggle layers, pen tracing, draw-to-fill vectors, contrast compositing and linked sound. `inspect_video_reference` examines imported footage at chosen timestamps before planning a comparable film. [Reference analysis and coverage](docs/research/09-editorial-reference-upgrade.md) documents the comparison and its limits.

Typography: put your font files in [`fonts/inbox/`](fonts/inbox/). `list_fonts` discovers them; `import_font` copies and registers selected faces in a project. Fonts can also be uploaded in Assets and registered with `register_font`. Five cinematic pairings and four style presets are built in. `npm run showcase:design -- --cinematic` renders the serif/body revision separately. See [typography guidance](docs/TYPOGRAPHY.md) for formats, weight/style handling, custom outlines and the Instagram reference.

- Rendering is local: no API keys, no cloud cost. Draft (540p) ≈ 1.5× real time; final 1080p is slower.
- Set `MOTION_STUDIO_GL=swangle` if WebGL shaders/transitions fail on a machine without a GPU.
- Remotion license: free for individuals and companies of up to 3 people; larger companies need a
  [company license](https://www.remotion.pro/license).
