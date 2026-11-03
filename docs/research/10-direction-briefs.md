# 10 — Direction briefs: what makes code-driven motion read as "cinematic"

Source: a study of the public gallery at prompt-motion.com (236 entries, all made with Claude Opus 5.5 as code-driven video —
HTML/Remotion/Three.js — 231 prompt entries and 5 skill entries), from the owner's export in `data/prompt-motion/` (local,
gitignored). **The videos and prompts belong to their creators.** Nothing from the gallery is copied into the product: this
document records aggregate patterns, in our own words, and the engine/linter features they led to. Use the export only as a
local reference and evaluation set.

## What the data says

| Signal | Share of prompts |
|---|---|
| The same generic one-line "showreel" prompt | 39% |
| Mentions beats / BPM | 8.5% |
| Mentions the camera | 8.5% |
| Has a banned list | 7.6% |
| 3D / Three.js | 6.8% |
| Requires every frame to be a pure function of time (`seek(t)`) | 5.9% |
| Fully structured brief (inputs → direction → structure → build → gotchas → start) | 5.1% |
| Springs · never-cut / one take · cursor-driven · sound placed by measured peak | ~4.7% each |
| Sub-frame motion blur | 4.2% |
| Loop (last frame = first) | 3.0% |

Tags: Product UI 105 · Kinetic type 96 · Music 50 · Particles 43 · Shapes 42 · Charts 34 · Diagrams 31 · Characters 27 ·
Photos 23 · Phone 22 · Code 21. Median prompt: ~150 characters.

**The headline:** four in ten of the most-liked films came from the *same vague one-liner*. The look is not in the wording of
the prompt; it is in the model's build discipline (determinism, springs, motion blur, sound on the grid, probing frames) plus a
few strong constraints. The best structured briefs are almost entirely constraints.

## The anatomy of a strong brief

1. **Inputs** — ask only for what can't be invented (words, one accent color, the hero element, the track), with a default
   for each so the film never stalls.
2. **Direction** — one register, stated tightly: canvas color, one accent, one or two faces (a clean grotesk, sometimes a serif
   italic tail), the camera language, and a **banned list**.
3. **Structure** — the film as a chain of states on a beat grid ("something happens on every beat"), usually *one element
   transforming*, not a sequence of scenes.
4. **Build** — every visual a pure function of time; closed-form springs (a value that is retargeted many times is a sum of
   springs); one world with one camera (position + log-space zoom); sub-frame motion blur; beat grid measured from the track;
   SFX placed by measured peak; loudness normalised.
5. **Gotchas** — hard-won rendering traps (blurry text under camera scale, overlapping text inside a morphing container, a loop
   that stutters because the cursor's speed differs at the seam).
6. **Start** — show a storyboard with every timing on the grid *before* building; probe one frame per beat before the full render.

## Most-banned techniques (counted across banned lists)

glows (incl. neon / on UI text) · particle bursts and particles · "anything that looks like a template" · crossfades · bouncy
easing · gradients (esp. on UI chrome) · dead time / holds over ~1 s · blur-ins · stock footage / stock UI kits · mismatched
icon strokes · random numbers (non-deterministic) · camera shake · RGB split · lens flares · grid floors · shockwave rings ·
3D flips.

Note the overlap with the "current product look" (DIRECTOR_GUIDE §14: glows, mesh gradients, blur → sharp). Both are valid;
they are different registers, and the restrained one is what reads as cinematic.

## The motion language (techniques that recur in the best entries)

- **Never cut.** One shape morphs through every state, or one camera glides through one world. Continuity replaces editing.
- **One hero element** (a dot, a ball, a shape) causes every change and survives every state.
- **Springs everywhere, tiny overshoot.** Leading and trailing edges of an indicator ride different springs so it stretches.
- **Direct manipulation.** A cursor clicks and drags; values follow the cursor while held and spring back on release.
- **Camera moves through one layout** so each interaction fills the frame; razor-thin focus in 3D fly-overs.
- **Beat grid.** Cuts on downbeats, UI hits on beats; sound effects aligned by their measured peak, quiet under the music.
- **Loop seam.** The last frame equals the first — positions, states and even velocities.
- **Probe before render.** Render one frame per beat, fix anything off-grid, cramped or unreadable.

## What we built from it

| Pattern | Motion Studio |
|---|---|
| Closed-form springs, sum of springs | `ease: "physical" \| "physicalLoose"` on layer and camera keys; `settle` lets the next key retarget mid-flight with velocity carried (`springTrackValue`, `src/engine/core/animate.ts`) |
| Log-space camera zoom | camera zoom always interpolates `log(zoom)` (`evalCamera`, `src/engine/render/Scene.tsx`) |
| Banned list, never-cut, hero element, loop, every beat | `concept.direction` + the direction linter (`src/core/direction.ts`), reported by `set_spec` as `direction/*` warnings |
| Inputs → storyboard on the grid → probe per beat | DIRECTOR_GUIDE §15 |
| Already present | beat-time strings (`"beat:N"`), cursor/selection/toggle layers, morph + actors (continuity), motion blur, sound placed by peak with restraint, `story.mnemonic.loop` |
| Two-edge stretch (indicators, toggle knobs) | shape `glide` (`glideBox`), toggle thumb |
| Direct-manipulation drags | cursor `drags` + `slider` bound to the cursor (`sliderAt`: follow, rubber band, spring back) |

| Measuring the director | `scripts/eval-director.ts` + `src/core/evalScore.ts` + `evals/briefs.json` (below) |

## Evaluating the director

`evals/briefs.json` holds ten original briefs (written for Motion Studio, one per category: UI, kinetic type, charts,
diagrams, code, music, shapes, phone, 3D, photos), each with its hard rules for `concept.direction`.

```bash
pnpm eval run                      # director on every brief (needs an Anthropic API key) → score + contact sheet each
pnpm eval run --only chart-proof   # one brief
pnpm eval score <projectId> ...    # score existing projects offline
```

Reports land in `evals/results/<stamp>/` (gitignored): `report.md` (table + sheets + score breakdown) and `report.json`.
The score starts at 100 and subtracts: 8 per direction-rule break, 5 per story error, 2 per craft warning, 1 per story
warning (each capped), up to 10 for a dead stretch over 2 s, 6 for no continuity, 4 for under one change per second. It
also reports the share of keys on physical springs. Compare averages before/after a guide or engine change.

Baseline (offline, existing showcase films, 2026-11-03): average 82.2 over six films; none used physical springs yet.
