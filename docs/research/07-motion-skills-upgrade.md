# Motion skills audit and implemented upgrade

Research date: 23 October 2026. These are source reviews, not endorsements of install counts as visual quality, and not a claim that every upstream feature has been ported. External skills were researched as references; their code/assets were not installed, copied or executed.

## Sources reviewed

- [Official Remotion skills](https://github.com/remotion-dev/skills) and [directory listing](https://www.skills.sh/remotion-dev/skills/remotion-best-practices): framework knowledge covering composition, deterministic animation, assets, audio, transitions and specialist features. The directory displayed about 667K installs / 5.5K repository stars at review time. This is the strongest compatibility reference for the existing Remotion engine.
- [Video Shotcraft](https://github.com/Vincentwei1021/video-shotcraft), its [skill](https://github.com/Vincentwei1021/video-shotcraft/blob/main/SKILL.md), [sound workflow](https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/sound-design.md) and [beat workflow](https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/music-beat-sync.md): a shot-card library, product capture and staged production/review workflow. Its useful lesson here is to make a small number of designed action arcs repeatable and keep audio apexes tied to the action. The repository displayed about 13.1K stars. Counts in its README/skill changed between revisions, so they are not treated as a parity checklist.
- [Claude Remotion Skill](https://github.com/haidrrrry/claude-remotion-skill): examples and a render/inspect/revise workflow for kinetic type, promos and sound. The repository displayed about 590 stars. Reviewed as a secondary craft reference, not a replacement rendering engine.
- [VideoZero skills](https://github.com/VideoZero/skills): Motion Canvas framework guidance, editor control (seek, screenshots, scene inspection and rendering) and animation principles. About 74 stars at review time; use cautiously as a smaller ecosystem reference. Its framework is different from this studio's Remotion renderer, so direct installation would not make our Scene Spec more expressive.

Popularity is a discovery signal, not a quality guarantee. We kept the established renderer and created original code around the missing contracts.

## Baseline findings

The project already had kinetic type, paths, repeaters, velocity blur, physics, actors, logo morphs, shaders, 3D cloners/particles, material-aware layered SFX, beat strings, preview contact sheets and audio mastering. Replacing this with a generic starter would discard useful capability.

The important gaps were execution and observability: sound guessed from preset labels; arbitrary `animate`/`path` movement was largely unscored; internal 3D movement had no general accent vocabulary; shot choices were unstructured; the agent could not inspect the sound plan through its own tools; editor tracks showed picture and actors but no sound apexes. Final de-duplication silently discarded some cues.

## Coverage map

| Capability from the reviewed workflows | Existing coverage | Upgrade / remaining gap |
|---|---|---|
| Deterministic frame-based video | Remotion + seeded physics/particles | New gestures and recipes preserve out-of-order evaluation |
| Action arcs, anticipation, follow-through | Lower-level physics controls | Six shared-clock gestures and eight editable shot recipes |
| Curated shot vocabulary | Generic kit and vertical templates | `motion_recipes` + `build_motion_scene`, exposed to all transports |
| Exact SFX apex placement | Preset heuristics + library peak metadata | Picture-locked semantic accents, imported transient offsets, nested frame rounding |
| Score arbitrary movement | Sparse | Transform velocity analysis for custom keyframes and curves |
| Internal 3D sound | No general schema | Explicit timed accents for 3D/shader/custom actions; automatic internal-geometry analysis remains future work |
| Material/brand sound, variation, layering, silence | Already in v2 sound planner | Reused by the new accents; collision reasons now inspectable |
| Beat-aware editing | Analysis + frame-rounded beat expressions | Reused; locked contacts do not drift to adjacent beats |
| Review sound and picture together | Preview + render tools | `inspect_sound`, contact preview suggestions, clickable SFX timeline |
| Render/inspect/refine workflow | Director guide | Motion playbook injected into in-app and MCP guidance |
| Capture real product UI and brand tokens automatically | Assets can be imported | Automated webpage capture/layout extraction still unimplemented |
| Drum-stem classification and fitted tempo-grid QA | General onsets / tempo only | Still unimplemented; do not imply parity with specialized beat tools |
| Dual BGM/SFX export, audio stems, external editor interchange | Single mixed MP4 | Still unimplemented |
| Hundreds of reference shots, web workbench / gallery | Existing studio + templates | Eight original recipes; no bulk copy of upstream assets or gallery |
| Independent review / export waveform sync audit | Manual visual workflow | `inspect_render_sound` correlates decoded audio against baked cues and measures loudness; imported cues, long films and independent taste review remain separate |

The implemented extension goes beyond descriptive skill instructions by adding a shared executable contact clock, measured wrapper velocity, imported transient alignment, collision diagnostics, a visible sound-apex track and actual exported-waveform sync checks. Audio mastering now works with Remotion's bundled media binaries if system FFmpeg is absent; previews fall back to individual frames if sheet creation is unavailable. It does not make the system universally superior to the source projects or guarantee a premium result from every brief. Art direction, strong source assets, restrained sound and rendered review remain necessary.
