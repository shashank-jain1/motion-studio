# Studio motion systems and sonic continuity

Reviewed 23 October 2026. These are observations from studios' public descriptions and case studies. They do not reveal proprietary production tools or establish that our implementation reproduces a studio's finish.

## What the studios actually describe

**Ordinary Folk:** its [process](https://www.ordinaryfolk.co/process) connects message, design and animation, while considering sound, score and voice throughout. It moves from a designed animatic to a composed mix that supports the story. The useful implication for our director is to sketch a whole motion/sound arc before choosing individual effects.

**Antfood:** [its sonic identity article](https://www.antfood.com/labs/the-foundation-of-a-high-impact-sonic-brand) treats a mnemonic as a starting point for a larger identity, including texture, timbre and related touchpoints. Our takeaway is a small sonic vocabulary with variations, not a new material or instrument for every event.

**BUCK:** the [Circle Portal case study](https://www.buck.co/work/circle-hq-screen) describes a modular visual system organized around recurring brand metaphors, evolving materials and a curated sequence. Our takeaway is to preserve an object's identity and motion language across chapters, using material, scale and viewpoint to create variation.

**Zelig Sound / Future Deluxe:** [Universal TV branding credits](https://www.zeligsound.com/universal-tv-channel-branding) distinguish music, sound design and mix from motion design. This supports treating sound composition and final mixing as deliberate production stages. The credits alone do not explain their specific mixing technique.

## Diagnosis of our previous result

The earlier upgrade improved contact sync, but correct sync is only one part of continuity. The generated showcase was still a sequence of discrete treatments. In sound, the chooser banned the last three source files per slot and strongly discouraged recently used families. That promoted variety even when the sequence needed a stable timbre. Each event was scored independently, with no explicit representation of the relationship to the following event.

Existing shared key/reverb and frame-locked contacts remain useful. They do not by themselves create a phrase: a metal hit, liquid pop and unrelated airy rise can all be in key and still feel disconnected. This is an inference from the implementation and the user's feedback, not a claim that objective measurements can grade taste.

## Implemented changes

- Film-wide family cohesion biases related groups, materials and spectral character. Consecutive exact-file repetition remains discouraged; sibling variations can recur. Gain/pitch jitter narrows as cohesion increases.
- The planner groups neighboring accents into phrases that can cross scene cuts. A cut does not restart the sonic identity.
- Bridge recipes carry the actual preceding material's decay, prepare the next recorded material in reverse, and share a quiet, deterministic texture with a global phase and common tonal center. They are separate from foreground accents and do not move picture-sync points.
- Pre-climax silence, long rests, manual sound ownership and music headroom constrain bridges. Low-priority connecting textures cannot interrupt foreground picture accents in the four-voice Player pool. The same baked assets are pre-uploaded for Lambda.
- `motion: "flow"` lets a persistent actor travel through scene boundaries on a cubic spline with continuous velocity. Scale/opacity/blur remain bounded; default pose-hold behavior is retained for existing actors. Snap-to-logo actors retain their existing tracking behavior.
- Two sequence treatments use one persistent hero, shared typography/materials, staged transformation and linked sound: a 3D sculpture and a vector metamorphosis. This is a film-level starting point, complementary to the individual shot recipes.
- 3D exposure can be adjusted independently to preserve highlight detail. The continuous demo uses reduced exposure and framing that leaves reading space around the hero.
- `inspect_sound` exposes phrases, bridges and source families. The SFX track displays the connecting spans. Export review correlates foreground cues and reports bridge waveform evidence separately.

## Review and limits

The continuity tests verify deterministic phrase planning, carried source tails, phase consistency, pre-hero silence, cloud asset coverage, an A/B that preserves identical foreground effects, spline derivative continuity and both treatments across five formats. The full motion/audio/layout regression suite remains part of `npm run verify:motion`.

The new showcase includes an isolated and connected WAV rendered from the same foreground cues at the same gain. Listen to the spaces between actions, especially around chapter changes. A bridge can improve the connection while still being the wrong texture for a brand; the controls exist to tune or disable it. Long rests stay quiet intentionally. Generated bridges are not a substitute for a composed score, source recording or a listening review.
