# Motion and sound direction

Premium motion needs a designed action, not a series of entrances. Begin with brand typography, contrast, materials and one transformation the viewer can describe. Pick a motion verb for each shot and a single hero. Use `motion_recipes` to browse and `build_motion_scene` to obtain editable scene JSON. Compose it into the existing film with `set_spec` / `update_scene`; the recipe tool does not save or choose the story for you.

## Shot grammar

| Recipe | Motion | Sound intent |
|---|---|---|
| magnetic-deck | Staggered cards anticipate, accelerate and converge | One material contact for the whole group |
| orbit-hero | An image/card follows a perspective arc | Air at the rush, a light contact on landing |
| type-impact | Oversized type drops, compresses and releases | One layered hero slam on compression |
| vortex-tunnel | Outline echoes turn and contract around type | One spatial transformation accent |
| hinge-editorial | Panels unfold with offset timing | One paper gesture; silent supporting panels |
| ribbon-flight | Curved travel with delayed, shrinking echoes | Whoosh at measured speed peak; arrival pop |
| particle-forge | Seeded 3D vortex forms type or an SVG silhouette | Explicit accent at formation + particle spread |
| chrome-echo | Extruded type, depth echoes and camera orbit | Sparse metal/air accents at authored times |

Change the font, spacing, composition, copy, material and colors to fit the brand. The recipes accept canvas width/height and a minimum 2.4-second duration, reserving time to read. Use a real image for a product page in deck/orbit. Use an SVG for a 3D source. A short word works best for particle/chrome. Start the film in motion, build variety, and reserve the most complex treatment for the climax. Leave a clear reading hold after the transformation.

## A common motion/contact clock

Every layer accepts `gesture: {preset, delay?, duration?, distance?, direction?, strength?}`. Presets: `magnetic`, `orbit-land`, `elastic-slam`, `vortex`, `hinge`, `rubber-stamp`. They contain anticipation, a main rush, contact, recoil and a final settled pose. Contact is at `delay + 0.64 * duration`; settle is at `delay + duration`. The rendering physics and audio planner use the same clock. Apply a gesture to a **group** to animate a finished layout together. Avoid stacking another entrance on the same hero unless that combination is deliberate.

`accents` explicitly replaces that layer's inferred SFX, while its children remain independently soundable. `accents: []` silences only that layer. `sound: false` suppresses the subtree. Gesture layers receive one contact cue by default; ordinary significant keyframe/path moves receive a whoosh at measured peak transform velocity. Slow breathing holds stay silent. Internal 3D/shader/custom actions require numeric accents because their geometry is not described by wrapper transforms.

```json
{
  "type": "group", "id": "product", "width": 1000, "height": 560,
  "gesture": {"preset": "orbit-land", "duration": 1.4},
  "accents": [
    {"at": "rush", "role": "move", "material": "air"},
    {"at": "contact", "role": "impact", "importance": "hero", "material": "glass"}
  ],
  "layers": []
}
```

`at` accepts a local second, a preprocessed beat expression, or `rush` / `contact` / `settle`. Optional `offset` adds seconds. For several separate keyframe moves, symbolic landmarks refer to the segment with the greatest measured travel; use explicit local times to score each individual action. Significant movement is measured by the exact wrapper transform function used for rendering, including scale and rotation. Source motion windows exclude continuous loops. Group/scene starts are rounded independently to frames, matching nested Remotion Sequences. Offsets and gesture contacts are rounded onto the local frame grid; stepped animation (`stepRate`) waits for the content tick that can actually display the contact. Picture-locked accents are never pulled onto a nearby beat: move the picture if you want a different beat.

Roles: `move`, `impact`, `slam`, `click`, `morph`, `shimmer`, `riser`, `logoHit`, `glitch`, `ding`, `pop`. Add `importance`, `material`, `volume`, or `src` for direction. Imported sounds can carry `sourcePeak` (internal transient time) and `sourceDuration` so a slow-attack sound lands on the action rather than starting there. Built-in sounds already carry peak metadata. Set `spec.sound` to enable planned sound; `sound.auto: false` disables it. Manual `spec.sfx` wins collisions. Clashing authored accents still obey the planner's 80 ms apex / 220 ms impact spacing and are reported as dropped; do not force every movement to make noise.

## Production loop

### Film continuity

Use `build_motion_sequence` when the film should feel like one evolving idea. It returns four editable chapters around a persistent hero, in `sculpture-flow` or `metamorphosis` treatment. Replace its story, headlines, object and brand tokens. Actors accept `motion: "flow"` for a continuous spline through scene boundaries; ordinary actors retain hold-then-move timing. Flow actors with `snapTo` retain the established snap/tracking path. For 3D objects, `exposure` (0.2–2, default 1) helps retain material detail.

Sound continuity is enabled by default whenever auto sound is enabled. `sound.continuity` accepts `cohesion` (default 0.8), `bridges` (true), `bridgeVolume` (0.22), and `maxGap` (4.5 seconds). Closely spaced sounds form phrases across cuts. Quiet bridges carry the previous material's real decay and the next material's anticipation, using a shared texture and tonal center. They leave the cue apices in place and preserve hero silence. They are reduced under music and yield to picture accents if Player voices are exhausted. `continuity: false` restores independent selection; `bridges: false` removes only connecting textures while keeping the chosen foreground cues unchanged for comparison.

`inspect_sound` reports phrase membership, bridge spans and source families; the SFX track draws connecting spans beneath the apex markers. Use this to identify unnecessary texture changes and deliberate rests. `npm run showcase:continuity` creates a new 14-second continuous-motion project plus `continuity-film.mp4`, `continuity-isolated.wav`, `continuity-connected.wav` and inspection reports in `showcase/`. Both WAVs share the same foreground sounds and gain. `--preview-only`, `--video-only`, `--draft`, `--2d` and `--project=<id>` control the showcase; `--refresh` explicitly rebuilds its generated spec.

See the [studio research and diagnosis](research/08-studio-motion-and-sonic-continuity.md) for the rationale. Technical sync and continuity checks support a listening review; they do not establish that a sound palette is aesthetically right.

1. Inspect brand/source assets, choose the concept and energy curve, then storyboard. Use the existing story tools.
2. If music is supplied, run `analyze_audio` first. Use measured beats/onsets and existing `beat:N` expressions, allowing for the audio trim offset. Do not assume a BPM value alone proves good sync.
3. Choose a recipe per visual idea and adapt its design. Use persistent actors / content-aware transitions when a motif needs continuity. Do not string all recipes together by default.
4. `inspect_sound` returns the exact Player/export planner's cue frames, layers, locks, stopdowns, rejected accents, timing warnings and contact ±2-frame preview times. Fix unresolved landmarks and insufficient holds. Keep previews in small batches.
5. Review both settled compositions and moving in-betweens; iterate at least twice. The studio SFX track marks each cue's **apex**, with tails shown behind it. Click a marker to seek exactly to that picture frame. Gold marks hero accents; the beat grid is a timing reference, not a waveform.
6. Render a draft. `inspect_render_sound` decodes a project's MP4 (up to 180s), measures loudness and correlates baked cue waveforms against the current spec. It reports real export offsets with a two-frame tolerance and minimum correlation of 0.65. Imported/manual sounds are not correlated. Low correlation can also mean overlapping cues or an outdated spec. Play the whole MP4 with sound and check texture, loudness, tails, image quality and rhythm. Technical sync checks do not prove perceived sound quality. Export the final only after review.

`npm run showcase:motion` produces a new eight-shot lab project, frames, cue report, MP4 and exported-waveform review under `showcase/`. `--project=<id>` re-renders the same project; `--preview-only`, `--video-only`, `--no-sheet`, `--final` select work; `--review-only` rechecks its saved export. Chrome and font access/cache are needed for rendering and 3D type. Full FFmpeg enables contact sheets; without it previews return individual frames, while audio mastering/review fall back to Remotion's pinned media binaries. `npm run test:motion` verifies timing contracts; `npm run verify:motion` also runs audio mastering, deliberately offset AAC sync cases, existing sound/reflow regressions and the production build.
