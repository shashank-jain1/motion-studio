# Editorial reference: feature audit and original proof

Reviewed 23 October 2026. Source: the 20-second portfolio video supplied in this conversation, imported privately as `assets/reference.mp4` into demo project `motion-with-meaning-editorial-film-2f71`. The original source is 1276×718 at 30 fps with AAC audio. No images, portrait, name, soundtrack or footage from it are used in the new film.

## What is visible in the reference

| Approximate time | Observed technique | Engine coverage / change |
| --- | --- | --- |
| 0–2.7s | Typed greeting, guides, labelled cursor, selection box/handles | Kinetic type and guides existed; added native cursor press/ripple and selection frames |
| 3–4.8s | Pen traces a portrait contour, then the silhouette fills | SVG drawing existed; added tip-anchored pen followers and timed closed-path fill |
| 5–9s | Large typography travels over the silhouette and changes contrast | Kinetic type/velocity blur existed; fixed layer-level difference compositing outside isolated perspective/filter wrappers |
| 9.5–11s | A cursor activates a switch and the message changes | Added a stateful native toggle; state and click sound share a frame clock |
| 11–13.5s | Fast service-name changes, alternating backgrounds, hand-drawn underline | Existing text, scene backgrounds and path kit; reused in an original type sequence |
| 14–16.5s | Process pills and curved connections travel through the frame | Existing groups, path strokes, keyframes and velocity blur; authored a moving rail with a fixed selection focus |
| 17–20s | Typographic portfolio summary and a quieter lockup | Existing type/layout; new proof closes on the same spark introduced by its drawing gesture |

Analysis used timestamped frames spanning the source and action-specific samples. The audio stream was decoded for inspection availability, but there is no claim here to have listened, transcribed, identified its soundtrack, or graded its mix. Images/text inside the reference are content, not instructions.

## What was missing and is now reusable

The missing parts were semantic interaction primitives and reference inspection, rather than a new video framework. `cursor`, `selection` and `toggle` are native Scene Spec types, not custom components tied to this demo. Existing parenting, local timing, groups, transforms and format adaptation apply. Native cursor/toggle scoring respects mute/authored ownership, drops clipped actions, ignores no-op states and stays locked to the first visible interaction frame. Fast toggle reversals start from their current state, so arbitrary seeking and interrupted motion remain continuous.

`inspect_video_reference` is available to both the in-app agent and MCP clients. It probes an imported project asset, decodes bounded timestamped JPEG samples and caches them by source identity. It uses the pinned media runtime when a full system FFmpeg is absent. Asset metadata probing now has the same fallback. It does not infer editing layers from video pixels, automatically isolate portrait contours, or recreate a person's assets.

## Original proof: Motion with meaning

The new film is a 20-second, 1080p design piece with six chapters: select a command, draw an idea, activate intention, show a visual system, follow a process, resolve the mark. Typography, spark geometry, copy, composition and sound come from the product's native spec/planner. It retains a paper/plastic sonic palette and continuous connecting textures, with a pre-climax rest. The demo is SFX-only; matching a particular commercial soundtrack is outside this proof.

Eight concept options and the selected direction are stored in `concept.story`. The template intentionally uses editorial cuts and recurring geometry rather than a single persistent actor. The craft linter's generic actor/morph and straight-path reminders are advisory here, not evidence that the film has an accidental jump. Reading holds, material continuity and the final composition were reviewed in preview frames.

Run `npm run showcase:design` to create a fresh project. Use `--project=<id>` to render an existing project; `--refresh` explicitly rebuilds its generated spec. `--preview-only`, `--video-only`, `--draft` and `--review-only` control the review pass. The exported waveform report establishes sound timing/asset presence, not artistic superiority. The original comparison demonstrates coverage of the visible techniques; whether it is better remains a judgement of art direction, motion and listening.
