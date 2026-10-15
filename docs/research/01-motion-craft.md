# 01 — Motion Craft: what separates top-studio motion from "basic motion graphics"

Research brief for the motion-studio engine (Remotion/React, JSON scene specs). Goal: turn studio craft into **engine features** and **director rules**.

Sourcing note: studios rarely publish frame-level breakdowns. Some claims below are documented (linked inline). Others are craft observations from watching the work and from standard After Effects practice; those are labelled *(observed)*.

---

## 0. Diagnosis: why our output reads as "basic"

Our engine (`src/engine/core/animate.ts`, `render/transitions.tsx`) shows the usual signs of template motion:

1. **Every enter preset is tied to opacity.** `rise`, `slide-*`, `zoom-in`, `pop` and the rest all fade, so everything "materializes". Premium work almost never fades a hero element in. Things get **revealed** (a mask or crop), **arrive** from off-frame, or are **built** from something already on screen.
2. **Scenes are sealed boxes.** `TransitionSeries` presentations swap whole scenes, so no element can live through a cut. Top studios get continuity from objects that persist and transform across the scene boundary.
3. **Keyframes are per-property and straight-line.** Each property eases to zero velocity at every keyframe, and x and y interpolate on their own. The result is stop-start, straight-line, "PowerPoint" motion. Pros use **spatial arcs**, **continuous velocity** through intermediate keys (roving keyframes), and **one master timing** that drives several properties.
4. **There's no hierarchy between layers.** No parenting, no follow-through lag and no overlap, so things move as rigid, independent sprites.
5. **Transitions are generic (fade/slide/wipe/glitch) and ignore content.** A premium transition is made from the content: a shape in scene A becomes the frame of scene B.
6. **No shape topology.** We draw paths with `PathDraw`, but there's no morph, merge, offset, repeater or trim with offset, which are the AE shape-layer tools behind most "designed" 2D motion.
7. **Nothing checks frames mid-motion.** The director previews at rest. Studios design the in-between frames too ("every frame is a styleframe").

---

## 1. What top studios and brands actually do

### Apple (keynote and product films)
- **Hidden camera hand-offs.** For WWDC 2023 the team tracked each filmed location and joined them with an extra "middleman" CG camera that hands off between them, built in Cinema 4D, Redshift, After Effects and Nuke ([9to5mac / Adam Grasso analysis](https://9to5mac.com/2023/06/21/apple-keynote-videos-transitions-and-editing/), [Vimeo: WWDC 2023 transitions](https://vimeo.com/926341788)). One example moves from a close-up of the iPhone camera module to an approach on Apple Park with no visible cut. **Engine meaning:** a camera move into an object, where the object's interior *is* the next scene.
- **Icon becomes object.** In the 2024 iPad film, the Final Cut Pro clapperboard icon turns into a physical clapperboard, a graphic match between a UI asset and the real thing ([hugo.blog](https://hugo.blog/2024/05/11/ipad-launch/)).
- **Restraint.** One short statement carries a scene, the rest of the runtime shows the product, and there's one typeface (SF) with no outlines or shadows ([Linearity: kinetic typography](https://www.linearity.io/blog/kinetic-typography/)).
- *(observed)* Slow, heavy camera moves with long ease-outs (roughly 1.5–3 s), with the product rotating on a single axis against black or a single color. Type arrives with a mask-up or a soft blur-to-sharp and tight tracking. Big type, small type and nothing in between: extreme scale contrast. Light sweeps or specular glints move across surfaces to "reveal" material. Cuts are timed to musical downbeats.

### Linear / Vercel / Arc / Stripe (tech launch language)
- **Linear:** no voiceover, no stock footage and no abstract 3D. The camera moves through the real product one action at a time, and you understand the feature in about 20 seconds ([Lago write-up](https://getlago.com/blog/we-killed-our-motion-design-job)). *(observed)* Dark UI, a virtual camera that pans and zooms with real velocity across a large UI canvas, focus pulls (blur on non-focal UI), cursor-led choreography, and glowing rim-light gradients behind hero type.
- **Vercel Ship 2025 (Basement Studio):** a "liquid" concept and a custom Blender material that turns every object into a black silhouette. Animation was hand-keyed pose by pose (master keys first) and **animated on twos** (12 fps poses inside 24 fps) for a crafted feel. Built with EXR multipass, Cryptomatte and a Resolve grade ([Basement: Behind the Ship](https://basement.studio/post/behind-the-ship)).
- **Stripe:** there's no published breakdown of Sessions films. Their job listings describe in-house motion that covers title sequences and event content, working with outside studios ([Stripe careers](https://stripe.com/careers/listing/motion-designer-experiential/8047129)). *(observed)* The signature is the animated mesh gradient (WebGL) used as a living background, precise isometric or 3D UI cards that slide on a shared axis with staggered depth, numbers that count with tabular figures, and a grid that is never broken.
- **Arc / The Browser Company:** the motion identity is personality-led: vlog-style, playful UI, with color as a personal element ([Tella](https://www.tella.com/blog/the-browser-company-video)). *(observed)* Squishy, spring-heavy UI motion with clear overshoot. Windows and tabs behave like physical objects.

### Character/2D design studios
- **Buck, "Good Books: Metamorphosis":** a 2:42 film that never cuts. It morphs continuously from scene to scene. The technique was chosen per shot (3D for one morph, pencil tests and Flash/AE for the rest), with sound designed to carry the visual morphs ([Motionographer interview](https://motionographer.com/2012/03/26/interview-buck-good-books-metamorphosis/)). Lesson: **continuity can be the entire concept.**
- **Ordinary Folk (Jorge R. Canedo Estrada, ex-Buck/Giant Ant):** detail-oriented keyframing, a strong link to audio, simple shapes ([School of Motion podcast](https://schoolofmotion.com/podcast/ordinary-folk-interview)). *(observed)* Graph-editor-driven: strong anticipation, deliberate overshoot, offsets on every secondary part, and shapes that squash at contact and stretch along velocity.
- **Giant Ant:** hand-crafted, emotive 2D/mixed media. In the DOXA trailers, restraint (one shot, one object, a solid background) builds suspense through slow anticipation and sound ([Motion Array spotlight](https://motionarray.com/blog/industry-spotlight-giant-ant)).
- **Oddfellows:** mixed media. Cel animation and motion design are combined with live-action product ([Motion Array spotlight](https://motionarray.com/blog/industry-spotlight-oddfellows)).
- **Gunner** *(observed; no written source found)*: bold flat 2D with thick, saturated shapes. Transitions come from the objects themselves: a character's arm or a ribbon sweeps across and becomes the wipe. Elastic overshoot is part of the house style.

### Design-system / 3D studios
- **ManvsMachine:** for Nike Air Max, "kinetic machines" made of minimal industrial devices. For Squarespace "Make the Next", type, 3D vignettes and live action share **one design system** ([Motion Array](https://motionarray.com/learn/motion-design/studio-spotlight-manvsmachine/), [Creative Review](https://www.creativereview.co.uk/squarespace-make-the-next-motion-graphics/)). *(observed)* Perfectly looping mechanical cause and effect: one object's motion triggers the next (Rube Goldberg logic). Studio-lit, minimal 3D.
- **Tendril:** a whole image library built from the three shapes of its logo, a black/white/gray palette, and modular typographic animations ([Stash](https://www.stashmedia.tv/tendril-brand-refresh/), [Abduzeedo: Deserve](https://abduzeedo.com/motion-design-graphics-language-deserve-cards)). Lesson: **a small vocabulary of primitives, recombined.**
- **DIA:** kinetic type *systems*. Motion is foundational to the identity, and generative tools ship with the guidelines ([Creative Review](https://www.creativereview.co.uk/dia-agency-typography-motion-design/), [It's Nice That](https://www.itsnicethat.com/features/dia-mitch-paone-meg-donohoe-graphic-design-animation-typography-180918)). *(observed)* Letters are stretched, sliced, repeated and slid along the grid. Type behaves like a mechanical object, and words are often staged as repeated rows with phase offsets.

### Award-level signals
- Motion Awards 2025 judges stressed craft, emotion-led decisions and experimentation ([Motionographer](https://motionographer.com/2025/12/08/the-motion-awards-2025-winners/)). The 2025 trend pieces point to particle systems, polyrhythmic visual systems, and taste over technique ([Animation Magazine](https://www.animationmagazine.net/2025/03/state-of-the-art-focus-on-five-major-motion-design-trends-in-2025)).

**Recurring techniques across all of the above:** (1) a persistent object or continuous camera across cuts; (2) a small, consistent vocabulary of shapes, transitions and eases; (3) hand-shaped velocity curves, never default eases; (4) offsets and overlap everywhere; (5) motion timed to audio; (6) restraint: one focal idea per frame and long holds next to fast hits.

---

## 2. Transformation and continuity techniques (the "stage 1 → stage 2" problem)

Film theory calls the umbrella term the **graphic match**: shape, color or movement matches across a transition, as opposed to a plain continuity cut ([Wikipedia: Match cut](https://en.wikipedia.org/wiki/Match_cut)). The UI-motion version is Material's **container transform** and **shared axis** ([Material motion system](https://material.io/design/motion/the-motion-system.html)). The rule that matters: the matched element must agree in **position, scale, color and motion direction** at the hand-off frame.

Each entry gives: **what it is**, **why it reads as premium**, **AE build**, and **engine hint**.

1. **Graphic match cut**
   - *What:* a hard cut where the outgoing and incoming frames share silhouette and position (the logo circle cuts to the sun, the coin to the planet).
   - *Why:* the eye stays locked on one spot, and the brain enjoys the rhyme.
   - *AE:* align anchor points, match scale and position on the cut frame, keep velocity through the cut.
   - *Engine:* a `matchCut: {from: layerId, to: layerId}` rule that solves the incoming layer's transform so its bbox center and size equal the outgoing one at the cut, then carries velocity (continue the outgoing ease for 4–6 frames into the new scene).

2. **Shape morph (A becomes B)**
   - *What:* one vector shape interpolates into another (square to phone outline, dot to logo).
   - *Why:* it shows a causal relationship, so the change feels like transformation rather than replacement.
   - *AE:* convert both to Bezier paths, match vertex counts, keyframe Path, Easy Ease ([Noble Desktop](https://www.nobledesktop.com/learn/after-effects/shape-morphing)). Mismatched vertex counts give ugly in-betweens ([Skillshare](https://www.skillshare.com/en/classes/art-of-morphing-in-adobe-after-effects/256851221)).
   - *Engine:* `flubber.interpolate(a, b, {maxSegmentLength: 4})`. It resamples and normalizes point counts and has `toCircle`/`toRect`/`separate`/`combine` for one-to-many shapes ([flubber](https://npmjs.com/package/flubber)). Use points.js `autoNormalise`/`autoIndex` to fix start-point rotation ([points.js](https://libraries.io/npm/points.js)). GSAP's MorphSVG `shapeIndex` handles the same mapping ([GSAP](https://gsap.com/docs/v3/Plugins/MorphSVGPlugin)). Precompute the interpolator once per layer and evaluate it at eased `t`. Add a slight rotation (10–30°) during the morph so it doesn't look like a crossfade.

3. **Shared-element continuity across scenes**
   - *What:* an object (phone, card, logo, product) persists across a scene change and re-lays out into its new position while the surroundings change.
   - *Why:* this is what "one continuous film" means. It's the core of Linear-style product films.
   - *AE:* the layer lives in the parent comp above both scene precomps.
   - *Engine:* a **persistent layer track** rendered *outside* `TransitionSeries`, keyed by `id`. Each scene declares a target `pose` for that id, and the engine interpolates pose to pose across the transition window (FLIP-style, like GSAP Flip's `data-flip-id` ([GSAP Flip](https://gsap.com/docs/v3/Plugins/Flip))). **This is the single biggest architectural upgrade.**

4. **"One object never leaves the frame"**
   - *What:* the camera follows a hero object (a ball or line) through every scene, and the backgrounds change behind it.
   - *Why:* it gives total continuity and an easy focal point, so the cuts disappear.
   - *Engine:* the persistent track (3) plus a camera rig in `follow: layerId` mode with lag (critically damped spring on camera position).

5. **Camera fly-through into an object** (zoom into a letter, dot, screen or lens until it becomes the next scene)
   - *Why:* it reads as one camera move, and the Apple keynote hand-offs are built this way ([9to5mac](https://9to5mac.com/2023/06/21/apple-keynote-videos-transitions-and-editing/)).
   - *AE:* the next scene is precomped *inside* the object (a track matte on the letter's shape). Scale the parent 1→40× with an exponential ease. Scale the shape, not the footage, to avoid resolution limits ([Droste/infinite zoom, Envato](https://photography.tutsplus.com/tutorials/endlessly-zoom-into-your-own-droste-effect--ae-12897)).
   - *Engine:* a `zoom-into` transition taking `{targetLayer, glyphIndex?}`. Render scene B clipped by the target's path (SVG `clipPath` from the glyph outline, via opentype.js), then animate a **logarithmic** scale (`scale = exp(lerp(ln s0, ln s1, ease(t)))`) so perceived speed stays constant. Pick the zoom origin at the target's bbox center. Once the clip covers the frame, drop it.

6. **Infinite zoom / Droste**
   - *What:* each scene is nested inside the previous one at a fixed scale ratio, and the zoom loops seamlessly.
   - *Why:* it creates hypnotic depth and continuity ([Vimeo trend reel](https://vimeo.com/201150328)).
   - *Engine:* N scenes, each at scale `k^i` around a shared focal point. Render the visible pair with log-space scale. Constant velocity (linear in log-space) for the body, with ease only at the ends.

7. **Mask/matte reveals: text as a window**
   - *What:* letterforms act as windows onto footage or the next scene, then scale up until the window becomes the frame.
   - *Why:* type and image fuse into one designed object.
   - *AE:* alpha track matte. *Engine:* SVG `<clipPath><text/></clipPath>` or CSS `mask-image` with an SVG data URL. `background-clip: text` covers gradients and images.

8. **Shape grows to become the next background**
   - *What:* a button, dot or card expands (circle/rounded-rect clip grows from the element's center) and fills the frame, and its color *is* scene B's background.
   - *Why:* it's a container transform: the content has a reason to move.
   - *Engine:* `clip-path: circle(r at cx cy)` with `r` up to `hypot(W,H)`, or a rounded-rect `inset()` with an animated `round` radius. Scene B mounts inside it. Ease: expo in-out. Add a 2–4 frame overlap where scene B's content enters with a slight scale (1.05→1).

9. **Liquid / goo merge**
   - *What:* blobs merge and split like metaballs (dots join into a pill and then a card).
   - *Why:* organic and tactile. This was Vercel Ship's motif.
   - *Engine:* SVG filter `feGaussianBlur` → `feColorMatrix` (alpha contrast, e.g. `0 0 0 18 -7`) → `feComposite` ([CSS-Tricks, Lucas Bebber](https://css-tricks.com/?p=195076), [Codrops](https://tympanus.net/codrops/2015/03/10/creative-gooey-effects/)). For crisp, resolution-independent results, use a metaball SDF fragment shader (we already have shaders).

10. **Split and reassemble**
    - *What:* an object slices into strips or fragments that slide apart (revealing the next scene in the gaps) or regroup into a new form (letters to a logo).
    - *Engine:* N clones of the layer, each with an `inset()` clip for one slice and per-slice staggered offsets (alternate directions). Use a delaunay or voronoi tessellation for shatter.

11. **Object-as-transition (object wipe)**
    - *What:* a ribbon, hand, card, phone or big letter sweeps across and wipes scene A to scene B. The wipe edge is the object's silhouette.
    - *Why:* the transition becomes part of the content.
    - *Engine:* a `wipeBy: layerId` transition. Scene B is clipped by a half-plane that follows the object's trailing edge (path offset by the object's bbox), and the object itself gets motion blur.

12. **Line becomes shape**
    - *What:* a stroke draws on (trim path), closes, and fills to become a solid shape, the next container or a chart.
    - *AE:* Trim Paths start/end/offset, with end trailing start for a "travelling" segment ([Motion Array](https://blog.motionarray.com/learn/software/animatedshapes/)).
    - *Engine:* `stroke-dasharray` / `stroke-dashoffset` with an animated `offset` (a moving segment, not just a draw-on). Fill opacity is delayed until the stroke closes. Add line caps and a "head dot".

13. **Dot → circle → planet (scale-chain metaphor)**
    - *What:* a primitive grows through semantic stages. Each stage adds detail (ring, texture, 3D shading).
    - *Engine:* chain morph (2) with a layered-detail fade and a camera push. Swap the SVG for WebGL at full size.

14. **Repeater / offset echo**
    - *What:* a shape repeats radially or linearly with time offsets, giving bursts, tunnels and stepped trails.
    - *AE:* Repeater (copies, offset, transform per copy) and Offset Paths with Copies Offset ([Adobe: Offset Paths](https://helpx.adobe.com/after-effects/using/use-offset-paths.html)).
    - *Engine:* a `repeat: {count, offsetTime, transformPerCopy, opacityFalloff}` modifier on any layer, rendered as N copies evaluated at `t - i*offsetTime`.

15. **Merge / boolean shapes**
    - *What:* shapes subtract or intersect live (a circle cuts a hole in a card that becomes a window).
    - *Engine:* SVG masks with `fill-rule="evenodd"`, or a path boolean library (paper.js, `path-bool`) precomputed per frame for simple shapes.

16. **Whip pan with a matched direction**
    - *What:* the outgoing scene whips out and the incoming one continues in the same direction with blur. Our `whip` exists but needs direction continuity *with layer motion* (the last-moving element's velocity should set the whip direction).

17. **Match-on-action / velocity hand-off**
    - *What:* a movement started in A completes in B (a card flicked up in A lands in B).
    - *Engine:* export the exit velocity vector from A and seed B's entrance spring with it.

---

## 3. Animation craft that creates a "premium feel"

### 3.1 The 12 principles, translated to motion graphics
From *The Illusion of Life* (Thomas and Johnston). Follow-through and overlap are the most impactful for mograph ([GarageFarm](https://garagefarm.net/blog/follow-through-and-overlapping-action-in-animation), [CG Wire](https://blog.cg-wire.com/follow-through-overlapping-action)).

- **Anticipation:** a 4–8 frame counter-move of about 5–10% before a big move (pull left before shooting right; scale 1→0.94 before a pop). *Engine:* `anticipate: {amount, frames}` that prepends a reverse ease-in-out keyframe.
- **Follow-through and overlapping action:** child parts lag the parent by 2–4 frames and settle after it (text under a card, the shadow after the object, an icon inside a button). AE: delayed parenting, `parent.transform.position.valueAtTime(time - d)`. *Engine:* `parent: id` plus `lag: frames` in the layer graph.
- **Squash and stretch:** scale along the velocity vector, volume-preserving (`sx = 1 + k·|v|`, `sy = 1/sx`, rotated to the direction of motion), plus a squash on impact. Keep it subtle in UI work (3–8%).
- **Slow in / slow out:** never linear, except for constant drifts and log-space zooms.
- **Arcs:** organic motion travels on curves. Position should follow a bezier motion path (AE spatial bezier), not independent x/y tweens. *Engine:* `path: "M..."` with `offsetDistance`-style evaluation, and auto-orient optional.
- **Secondary action:** small motion that supports the hero (a glint sweep across the device as it lands, particles kicked up at impact, background shapes drifting the opposite way).
- **Timing and spacing:** weight is shown by spacing. Heavy objects have long ease-outs and tiny overshoot. Light ones are fast with bigger overshoot.
- **Exaggeration, staging, appeal, solid drawing:** one focal action at a time (staging), and clean, well-proportioned shapes (appeal).

### 3.2 Easing: the numbers professionals use
Community tables from Penner's equations ([gist](https://gist.github.com/kossnocorp/9e7f4f3afed44616d07b), [Flutter](https://api.flutter.dev/flutter/animation/Curves/easeOutExpo-constant.html)):
- Expo out `cubic-bezier(0.19, 1, 0.22, 1)` · Quint out `(0.23, 1, 0.32, 1)` · Quart out `(0.165, 0.84, 0.44, 1)` · Circ out `(0.075, 0.82, 0.165, 1)` · Back out `(0.175, 0.885, 0.32, 1.275)` · Expo in-out `(1, 0, 0, 1)`.
- Material 3: standard `(0.2, 0, 0, 1)`, emphasized decelerate (enter) `(0.05, 0.7, 0.1, 1)`, emphasized accelerate (exit) `(0.3, 0, 0.8, 0.15)` ([MDC-Android Motion](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md)).
- IBM Carbon *expressive* (for hero moments): standard `(0.4, 0.14, 0.3, 1)`, entrance `(0, 0, 0.3, 1)`, exit `(0.4, 0.14, 1, 1)`. *Productive* standard is `(0.2, 0, 0.38, 0.9)` ([@carbon/motion](https://cdn.jsdelivr.net/npm/@carbon/motion@11.45.0/index.scss)).
- **AE influence → bezier.** With zero speed at both keys on a 1D value graph, `cubic-bezier(outInfluence, 0, 1 − inInfluence, 1)`. "Easy Ease" ≈ `(0.33, 0, 0.67, 1)`. The pro "snappy" pattern is a **short out-influence (~10–25%) and a long in-influence (~75–90%)** → about `(0.15, 0, 0.1, 1)`: it leaves fast and settles long. Influence sets how long it takes to reach top speed ([Creative Cow](https://creativecow.net/?p=177751)). Ben Marriott credits graph-editor control over plugin eases as his biggest jump in skill ([transcript](https://jp.voicetube.com/videos/123011)).
- **Asymmetry is the tell.** Premium curves are almost never symmetric. Enter = long decelerate. Exit = short accelerate, roughly 60–70% of the enter duration. Camera = slow in, slower out.
- **Springs (Remotion):** default mass 1 / damping 10 / stiffness 100 bounces. `damping: 200` = no bounce. `overshootClamping` is available ([Remotion spring](https://www.remotion.dev/docs/spring)). Recommended presets: *settle* `{damping: 200}`, *premium-overshoot* `{mass: 1, damping: 14, stiffness: 140}` (about 4–6% overshoot), *playful* `{damping: 9, stiffness: 180}`. Allow `easing: Easing[]` per segment ([Remotion interpolate](https://www.remotion.dev/docs/interpolate)).
- **Inertial bounce (Dan Ebberts):** after the last keyframe, add `v · sin(freq·t·2π)/exp(decay·t)/(freq·2π)` using the velocity going into the key. Typical values: amp 0.05, freq 4, decay 8 ([Adobe Community](https://community.adobe.com/t5/after-effects-discussions/error-in-line-11-ae-inertial-bounce-created-by-dan-ebberts-at-motionscript-com/m-p/9289049), [thoughtbot](https://thoughtbot.com/blog/using-expressions-in-after-effects)). Its key property is that **overshoot scales with incoming speed**: fast moves wobble more and slow moves don't. *Engine:* an `inertia` modifier that reads finite-difference velocity at the keyframe.

### 3.3 Timing
- **Durations at 30 fps:** micro UI 6–10 f · element entrance 12–20 f (0.4–0.7 s) · hero reveal 20–36 f · camera move 45–90 f · full-frame transition 10–20 f (fast) or 24–40 f (elegant).
- **Holds:** let a resolved frame breathe for at least 0.5 s plus reading time (about 3–4 words/s for headlines). Studios hold longer than amateurs and move faster in between: **the 80/20 rhythm**, where most of the screen time is near-still and moves are quick.
- **"Breathing" holds:** during a hold, keep about 1–3% drift (camera push 1→1.03, tracking or weight breathing on type) so the frame stays alive without being busy.
- **Animate on twos:** step poses at 12 fps inside a 24/30 fps render to get a crafted or hand-made feel (Vercel Ship). AE Posterize Time or a 12 fps precomp ([Adobe Community](https://community.adobe.com/questions-529/after-effects-why-set-posterize-time-to-12-fps-in-24fps-comp-54684)). *Engine:* `stepRate: 12` per layer, which quantizes `t` to `floor(t*12)/12` for that layer only, while the camera stays on ones.
- **Music sync:** frames per beat = 60/BPM × fps (120 BPM @ 24 fps = 12 f). Compute beat frames cumulatively (`round(n·fpb)`) to avoid drift. Put the biggest visual moment on downbeats or phrase boundaries (4/8 beats) ([Animator Island](https://www.animatorisland.com/?p=174), [silvermansound calc](https://www.silvermansound.com/bpm-to-fps-calculator)). Place the **apex** of a move (impact or settle), not its start, on the beat: start the move `duration × ~0.6` before the beat for ease-out moves.
- **Contrast of fast and slow:** follow a fast hit with a held moment, and keep big and small moves apart in time. Use speed ramps on camera (a slow push, then a 6–8 frame expo whip, then a slow settle).

### 3.4 Staggering and offsets
- 2–4 frames between siblings (0.06–0.12 s). **Cap the total cascade** at about 0.4–0.6 s whatever the count: `stagger = min(base, maxSpread/(n-1))`.
- **Order by meaning or space**, not DOM order: radial from the focal point, along the reading direction, or random-with-seed for organic clusters. Ease the stagger itself so delays bunch at the start (`delay_i = maxSpread · easeOut(i/n)`).
- Stagger *properties* on a single element too: position leads, scale follows by 2 f, opacity or blur finishes first. This is "overlap within an object".

### 3.5 Depth, blur and finish
- **Layered parallax:** 3–5 depth planes moving at different rates under one camera (we have `depth`). Add depth-of-field blur on the far plane during focus moments.
- **Motion blur:** 180° shutter is the film standard. Blur scales with per-frame displacement, so it's free on slow moves and heavy on whips. Remotion offers `<CameraMotionBlur shutterAngle samples>` (realistic, but costly and color-destructive) and `<Trail>` (stylized) ([Remotion motion blur](https://www.remotion.dev/docs/motion-blur-guide)). *Engine:* a cheap analytic directional blur. Compute the velocity vector from `transform(t) - transform(t - 1/fps)` and apply a directional blur along it, only when |v| > threshold.
- **Smears:** for 2D shape work, stretch the shape along its path for 1–2 frames (an elongated in-between) or echo copies ([Smear frame](https://en.wikipedia.org/wiki/Smear_frame), [Motion Design School echo](https://motiondesign.school/blog/smears-with-echo-effect/)). *Engine:* a velocity-driven `scaleAlongVelocity` (the squash/stretch modifier) plus `repeat` echo with opacity falloff.
- **Overshoot and settle:** a hero element lands with a 2–6% overshoot and settles over 8–14 frames. Secondary elements don't overshoot, or overshoot less.

---

## 4. Kinetic typography at a high level

Beyond fade and slide:

1. **Mask-line reveals with overlap:** each line rises out of its own overflow-hidden box (we have `mask-up`). The premium version: lines overlap in time (60–70% of the previous line's duration), use an expo-out curve, add a slight y-rotation or skew (3–6°) that settles to 0, and keep the *baseline grid locked*.
2. **Word swap / slot roll:** one word cycles through alternatives in a masked box, and the box width animates to fit each word (measure the text and spring the width). *Engine:* `swap: {words[], interval}` with width interpolation and a vertical roll. Easing: expo in-out, 10–14 f per swap.
3. **Split-flap / scramble with structure:** each char flips through a charset (rotateX halves) and settles left-to-right. Use tabular, monospace figures.
4. **Variable-font axis animation:** animate `wght`, `wdth`, `slnt`, `opsz` through `font-variation-settings`. It's animatable on any axis within the font's range ([Val Head](https://valhead.com/2020/11/15/animating-variable-fonts-with-css/), [CSS-IRL](https://css-irl.info/variable-font-animation-with-css-and-splitting-js/)). Use cases: weight "pulse" on the beat, a word getting heavier as it's emphasized, a wave of weight travelling across characters (per-char phase offset), width stretching to fill a line exactly. Fonts: Roboto Flex, Inter (wght/opsz), Fraunces, Recursive. **Must be computed per frame from `t`, never CSS transitions.**
5. **Tracking / kerning animation:** letter-spacing tightens from about 0.3em to −0.02em while a word scales slightly. This is a luxury and editorial staple (we have `tracking`). The pro detail: animate tracking over the *whole hold* (slow, 2–3 s) rather than as an entrance only.
6. **Text becomes object:** convert glyphs to outlines (opentype.js `getPath`) and then morph (flubber) into an icon or shape, or explode to particles sampled from the glyph path. Morphing the "O" into the product's camera lens is the canonical move.
7. **Text as window / matte:** large type clips footage or the next scene (§2.7), then scales until the window fills the frame.
8. **Type on a path:** SVG `<textPath>` with an animated `startOffset` so text flows along a curve or around a circle. Pair it with `PathDraw`.
9. **Scale contrast and hierarchy:** one hero word at 4–8× the supporting text. Mixed weights (Black + Light) or mixed families (sans + serif italic) inside one line. Build the line as a *typographic composition* on a grid with fixed baselines and optical-margin alignment, not as centered text.
10. **Repetition / stacked echoes (DIA style):** the same word repeated in 5–9 rows with phase-shifted horizontal slides or outline/fill alternation. A single row resolves while the rest clear away.
11. **Stretch / slice:** slice a word into horizontal bands. Each band slides with an offset, or the middle band stretches vertically (scaleY 1→4) and snaps back.
12. **Per-glyph physics:** chars land with an inertia bounce scaled by entry velocity, plus a rotation that settles (−8°→0). Use a seeded random per glyph for organic variance (±15% timing, ±3° rotation).
13. **Kinetic emphasis inside a sentence:** the sentence is static, and one keyword gets a highlight sweep, a weight change or a color change on the beat (we have `highlight`, so add beat-locking).

Rules: at most 3–6 words on screen; reading-time holds; one typeface family plus at most one accent face; and never animate the reading line while it is being read (move the *container* or camera instead).

---

## 5. Composition and design

- **Every frame is a styleframe.** Studios pitch with styleframes and then animate *between designed states*. **Director rule:** preview frames at 25/50/75% of every transition and every hero move, not only at rest, and reject frames with arbitrary overlap, half-faded mush or empty dead space.
- **Grid systems:** a 12-column grid with fixed margins (about 5–8% of width), a baseline grid for type, and **shared alignment lines across scenes** (the headline's left edge sits on the same x in scenes 2, 3 and 5, so cuts feel continuous). *Engine:* `theme.grid` tokens, with layer positions in grid units (`col: 2, row: 3`) as well as pixels.
- **Mid-motion design:** motion should travel *along grid axes* (horizontal and vertical), so moving elements stay aligned with their resting neighbors. Diagonal motion is reserved for energy beats. In-betweens should pass through designed intermediate states (split screen, stacked cards), not random overlaps.
- **Negative space:** 40–60% empty canvas in hero frames, and one focal point per frame (staging). Apple-style product frames often hold the product at about 30–45% of frame height.
- **Hierarchy:** scale ratio of at least 3:1 between primary and secondary type. Value contrast: the hero is the highest-contrast element. Use motion priority too: the hero moves first and biggest, secondaries follow smaller.
- **Small vocabulary of primitives:** derive shapes from the logo or brand marks (Tendril) and reuse 2–3 transition types (we already say this in the director guide). Consistency reads as intentional.
- **Color script:** plan color across the whole video, one swatch per scene or board, showing the emotional arc (cool/low → warm/saturated at the payoff) ([StudioBinder](https://www.studiobinder.com/blog/what-is-a-color-script-definition/), [Peachpit](https://peachpit.com/articles/article.aspx?p=2461896)). Palette budget is about 1 primary, 1 accent and 2–3 neutrals. **Engine:** `colorScript: [{scene, bg, accent}]`, with background color *animating* between scenes (often via the shape-grows-to-background transition) instead of cutting.
- **Light as a design element:** specular sweeps, rim gradients, glow behind type. Studios "reveal" with light as often as with motion.
- **Texture and finish:** grain, a subtle vignette, chromatic fringe only on fast moves. Basement graded toward warm ([Behind the Ship](https://basement.studio/post/behind-the-ship)).

---

## 6. Engine and director-rule mapping (summary table)

| Craft feature | Engine primitive | Director rule |
|---|---|---|
| Shared element across cuts | persistent track outside `TransitionSeries`, per-scene `pose` by id | every video has ≥1 persistent hero object |
| Morph | `morph: {to: path/glyph/shape}` via flubber | use morphs for "becomes" story beats |
| Zoom-into | `transition: zoom-into {target}` with log-scale and glyph clip | prefer over `cross-zoom` when an object exists |
| Grow-to-background | `transition: expand {from: layerId}` | color script driven by expansions |
| Reveal without fade | enter presets with `opacity: false`; mask/crop reveals | hero elements never fade in |
| Arcs | spatial `path` motion | position moves > 300 px must arc |
| Follow-through | `parent` + `lag` | children lag 2–4 f |
| Inertia | velocity-aware overshoot modifier | hero lands with inertia, secondaries settle |
| Anticipation | `anticipate` modifier | moves > 50% of frame get anticipation |
| Velocity blur/stretch | auto dir-blur and stretch from velocity | always on above a speed threshold |
| Stagger | spatial/eased stagger, capped spread | cascade ≤ 0.6 s |
| Beat lock | `on: "beat:n"` that aligns apex to beat | apex on beat, not start |
| Twos | per-layer `stepRate` | for illustrative and handmade styles |
| Variable fonts | per-frame axis keyframes | emphasis by weight, not only color |
| Grid | grid-unit positioning, shared alignment lines | headline x consistent across scenes |
| Mid-motion QA | preview at 25/50/75% of transitions | critique in-betweens |

---

## 7. Prioritized top 15 upgrades (highest impact first)

Assumes we already have enter/exit presets, kinetic text, a camera rig, scene transitions, particles, shaders, 3D phone mockups and SVG path drawing.

1. **Persistent / shared-element layers across scenes.** Render a top-level track keyed by `id` outside `TransitionSeries`, and let each scene declare that element's target pose. The engine tweens pose to pose through the transition. This unlocks match cuts, "one object never leaves the frame", Linear/Apple continuity and match-on-action.
2. **Shape and glyph morphing.** A `morph` layer and modifier using flubber, with sources from SVG paths, kit shapes and text glyph outlines (opentype.js). Includes one-to-many split/combine and a rotation-during-morph option.
3. **Content-aware transitions: `zoom-into` and `expand`.** Scene B is clipped by a layer's shape or glyph and grows from it (log-space scale for zoom, circle/rounded-rect clip for expand). Transitions are built *from* scene content, not laid over it.
4. **Decouple opacity from motion and add mask/crop reveals as the default.** Add `fade: false` variants of every preset and make clip, mask and off-frame arrivals the default for hero elements. Director rule: "hero elements never fade in".
5. **Velocity-aware physics modifiers:** `inertia` (Ebberts-style overshoot scaled by incoming speed), `anticipate`, and automatic squash/stretch plus directional motion blur from per-frame velocity. Together these give "premium feel" on every existing preset.
6. **Spatial arcs and continuous-velocity keyframes:** a bezier motion path for position, optional auto-orient, "roving" intermediate keys (no zero-velocity stops), per-segment easing arrays, and named pro curves (expo/quint/M3/Carbon-expressive, asymmetric "snap" `(0.15,0,0.1,1)`).
7. **Layer parenting with follow-through lag:** `parent: id` and `lag: frames`, where children evaluate the parent at `t - lag`. Gives overlapping action for free on cards, text blocks, shadows and icons.
8. **Smart stagger engine:** radial/spatial/semantic ordering, eased delay distribution, total-spread cap, and per-property offsets within one element (position leads, scale follows).
9. **Beat-locked choreography:** the spec says `at: "beat:12"` or `on: "downbeat"`, and the engine shifts the move so its **apex** lands on the beat (cumulative rounding). Plus camera punch, weight pulse and cuts on phrases. `analyze_audio` already exists, so this is wiring.
10. **Text-as-matte and type-on-path:** SVG `clipPath` text windows into media or scene B (scaling up into a transition), plus `<textPath>` with animated offset.
11. **Variable-font axis animation plus word-swap / slot-roll:** per-frame `font-variation-settings` keyframes (weight waves, emphasis on the beat) and a masked word cycler with measured width springs. Bundle Roboto Flex or Inter variable.
12. **Shape-layer operators:** trim paths with animated *offset* (travelling segments), a `repeat` modifier (copies, time offset, transform per copy, falloff), offset/echo outlines, and goo merge (SVG filter or SDF shader). These are the core AE mograph vocabulary.
13. **Object-wipe and split/slice transitions:** a moving layer's silhouette or trailing edge is the wipe boundary, and multi-slice `inset()` clones with alternating offsets reveal scene B in the gaps.
14. **Grid, color-script and alignment-continuity system:** grid-unit positioning, shared alignment lines across scenes, a `colorScript` that animates background and accent between scenes, and director rules for negative space and hierarchy (≥3:1 scale).
15. **Mid-motion QA and "twos" stylization:** extend `preview_frames` to sample 25/50/75% of every transition and hero move and teach the critique checklist for in-betweens. Add a per-layer `stepRate` (animate on twos) for illustrative styles.

Cheap wins to bundle with the above: default every camera to a slow push or breathing drift (already advised), log-space for all large zooms, an exit duration of about 0.65× the enter duration with accelerate curves, and a "hold ≥ reading time + 0.5 s" validator in the spec linter.

---

### Key sources
- Apple transitions: https://9to5mac.com/2023/06/21/apple-keynote-videos-transitions-and-editing/ · https://vimeo.com/926341788 · https://hugo.blog/2024/05/11/ipad-launch/
- Vercel Ship / Basement: https://basement.studio/post/behind-the-ship
- Linear style: https://getlago.com/blog/we-killed-our-motion-design-job
- Buck Metamorphosis: https://motionographer.com/2012/03/26/interview-buck-good-books-metamorphosis/
- Ordinary Folk: https://schoolofmotion.com/podcast/ordinary-folk-interview
- ManvsMachine: https://motionarray.com/learn/motion-design/studio-spotlight-manvsmachine/
- Tendril: https://www.stashmedia.tv/tendril-brand-refresh/
- DIA: https://www.creativereview.co.uk/dia-agency-typography-motion-design/
- Material motion: https://material.io/design/motion/the-motion-system.html
- Carbon motion tokens: https://cdn.jsdelivr.net/npm/@carbon/motion@11.45.0/index.scss
- Remotion spring/interpolate/motion blur: https://www.remotion.dev/docs/spring · https://www.remotion.dev/docs/interpolate · https://www.remotion.dev/docs/motion-blur-guide
- flubber: https://npmjs.com/package/flubber · GSAP Flip/MorphSVG: https://gsap.com/docs/v3/Plugins/Flip · https://gsap.com/docs/v3/Plugins/MorphSVGPlugin
- Gooey: https://css-tricks.com/?p=195076 · https://tympanus.net/codrops/2015/03/10/creative-gooey-effects/
- Variable fonts: https://valhead.com/2020/11/15/animating-variable-fonts-with-css/
- Beat math: https://www.animatorisland.com/?p=174
- Color script: https://www.studiobinder.com/blog/what-is-a-color-script-definition/
- Six essential transitions (School of Motion): https://www.schoolofmotion.com/blog/six-essential-motion-design-transitions-tutorial
