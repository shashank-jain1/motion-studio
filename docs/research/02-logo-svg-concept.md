# 02 — Logo × Idea: concept-driven logo motion, SVG morphing, vectorizing, 3D

Research brief for the motion-studio engine (Remotion 4 / React / SVG / WebGL, AI-written JSON specs). Goal: stop logos from "just appearing". The logo should be the **payoff of a visual idea**: built from, or transformed out of, graphics that relate to the brand's meaning.

Sourcing note: studios rarely publish frame-level breakdowns. Claims backed by a source are linked inline. Craft conventions and inferences are marked *(observed)*. Library facts come from reading the published packages (npm, Oct 2026).

---

## 0. TL;DR for the engine

1. **Add a logo analyzer** (`analyzeLogo(svg)`). It produces parts, islands/holes, bbox, centroid, area, colors, a "geometry kit" and stagger orders. Every reveal mode below runs on that output.
2. **Add a `LogoStory` layer with a `mode`**: draw, build, morph-from, assemble, mask, negative-space, extrude-3d, liquid, glitch, cascade, window, born-from-product. Add a **motif** that is seeded early and becomes the logo at the end.
3. **Morph stack (MIT only):** `svg-path-commander@2.3.3` `equalizePaths()` handles multi-subpath matching, holes and rotation. Precompute it once, then lerp numbers per frame. `flubber@0.4.2` handles polygon split/combine (one→many, many→one). `@remotion/paths` covers draw, length and cut. **Do not ship GSAP MorphSVG inside the product** without a legal check (see §3.2).
4. **The director's method:** brand truth → metaphor (choose juxtaposition, fusion or replacement) → motion verb. **One thread element** survives every cut and ends as (part of) the logo.

---

## 1. Concept-driven logo animation

### 1.1 What the reference brands actually do

- **Google (2015).** The identity is a *system* of states: the full logotype, the "G", and four dots that act as the "dynamic and perpetually moving state of the logo". The dots have named expressions: listening, thinking, replying, incomprehension, confirmation. They move on geometric arcs with a standard set of snappy easing curves ([Google Design: Evolving the Google identity](https://design.google/library/evolving-google-identity)). In voice search, the waveform collapses back into dots that spin while results load ([Fast Company](https://www.fastcompany.com/3050613/how-google-designed-its-new-logo)). The launch Doodle *wiped the old wordmark and drew the new one* ([DesignCurial](https://www.designcurial.com/news/new-google-logo-2015-4661827)). **Lesson:** the logo has a **reduced primitive form** (dots) that does the "work". The full mark is the resolved state. Primitive → logo is the reveal.
- **Netflix (2019 ident).** The N ribbon flies toward camera and breaks into spectrum light bands. Netflix says the bands stand for the spectrum of stories, emotions and fans, and the black background evokes a darkening cinema ([Hypebeast](https://hypebeast.com/2019/2/netflix-new-logo-animation), [Creative Bloq](https://creativebloq.com/news/netflix-channels-the-magic-of-the-cinema-in-new-ident)). The beams started as "show thumbnails turned sideways, like records on a shelf". Imaginary Forces describes the ribbon as a storyline ([IF](https://imaginaryforces.com/project/netflix)). **Lesson:** a geometric property of the mark (a ribbon, which is a strip) is extended into a metaphor (stories as strips of light). Motion = **logo as portal / explode into content**.
- **Slack (2019, Pentagram).** The new mark has 8 separate shapes built from two primitives, a **speech bubble** and a **capsule**, in 4 colours. It replaced an octothorpe that was easy to get wrong ([Design Week](https://www.designweek.co.uk/pentagrams-michael-bierut-gives-slack-its-first-ever-rebrand/), [Slack blog](https://slack.com/intl/en-ca/blog/news/say-hello-new-logo)). Slack's launch GIF morphs old → new. **Lesson:** a modular mark of separate primitives invites **assemble/converge**, which is literally "people coming together".
- **Airbnb Bélo (2014, DesignStudio).** It was designed so "anyone can draw it", and it reads as a person, a location pin, an upside-down heart and an "A" ([Dezeen](https://www.dezeen.com/2014/07/16/airbnb-rebrand-designstudio-logo-belo/amp/), [Design Week](https://www.designweek.co.uk/designstudio-creates-symbol-of-belonging-for-airbnb-rebrand/)). Secondary sources describe it as one continuous line ([brandkit](https://brandkit.pro/brand/airbnb), unconfirmed). **Lesson:** monoline marks with multiple readings call for a **single-stroke draw**, and the stroke can *pass through* the other readings (pin → heart → A) on the way.
- **Mastercard (Pentagram 2016; wordless 2019).** The mark is two interlocking circles, a solid overlap, and two primary colours ([Pentagram](https://www.pentagram.com/work/mastercard/story), [Dezeen](https://www.dezeen.com/2019/01/10/mastercard-rebrand-pentagram-design/)). The sonic logo was positioned as the "sound equivalent" of the circles ([The Drum](https://www.thedrum.com/news/2019/02/08/fresh-revamping-its-brand-mastercard-unveils-sonic-logo)). I found no documented official motion. *(observed)* The geometry dictates it anyway: two circles approach, overlap, and the intersection fills on the beat. That is "connection" made visible.
- **FedEx (Landor, 1994).** The hidden arrow sits in the E–x counter. Lindon Leader says it was not intended and fewer than 1 in 5 people notice it ([CNN](https://edition.cnn.com/style/article/hidden-designs-famous-logos)). **Lesson:** a **negative-space reveal** can *make the viewer see* the hidden idea. Animate a moving arrow (speed, logistics) that comes to rest exactly in the counter, then let the letters close around it.
- **Instagram (2016).** Staff drew the old icon from memory, and nearly all of them drew the rainbow, lens and viewfinder. Those three survived roughly 300 iterations into the new glyph ([Dezeen](https://www.dezeen.com/2016/05/11/instagram-new-logo-graphic-design-camera-rainbow/amp/), [SiliconANGLE](https://siliconangle.com/blog/2016/05/11/instagram-gets-a-makeover-including-new-logo-and-design-changes/)). **Lesson:** **reduction** works as a reveal. Start from the literal object (a camera), strip it to the memorable features, and land on the glyph.
- **Duolingo (Johnson Banks, 2019).** The wordmark was drawn *from the shapes of the owl mascot*, and the custom Feather Bold face came out of it ([Creative Review](https://www.creativereview.co.uk/duolingo-rebrand-johnson-banks/), [Creative Bloq](https://www.creativebloq.com/news/feather-bold)). **Lesson:** a mascot ↔ letterform shape rhyme makes it legitimate to **morph the mascot into the wordmark**.
- **Back Market.** Circular movement and fluid transitions express circularity and sustainability, so motion encodes the value rather than decorating it ([Creative Boom](https://www.creativeboom.com/insight/why-motion-is-the-future-of-brand-identity-and-how-to-do-it-right/)). DixonBaxi starts identity work by writing a "motion theory" of principles ([Creative Pool](https://creativepool.com/aporvabaxi/projects/dixonbaxi-motion-theory-r-and-d/who-pooled)).

### 1.2 Archetypal reveal patterns (catalog)

Each entry gives: what it says, the geometry it needs (from the analyzer), and how to build it.

| # | Pattern | Says | Needs | Build |
|---|---|---|---|---|
| 1 | **Line draw → fill** | craft, precision, "drawn by hand", journey | monoline or outline-friendly shapes; low part count | `evolvePath` per subpath, staggered; fill fades/wipes in at 70–90% of the draw (§3.5) |
| 2 | **Build from primitives** | engineering, systems, modularity | parts ≈ circles/rects/capsules (circularity, rectangularity scores) | spawn `@remotion/shapes` primitives at part centroids, then morph each to its part |
| 3 | **Morph from a related object** | transformation, "our product becomes you" | a concept object SVG (bean, leaf, drop, pin, bubble) | `equalizePaths(objectD, logoIslandD)`, then lerp; overshoot with a spring |
| 4 | **Assemble / converge** (or explode → regroup) | collaboration, community, aggregation | ≥3 separable islands | parts fly in on arcs from radial or offscreen positions, with ordered stagger and settle overshoot |
| 5 | **Mask reveal** (wipe, iris, slit, light sweep) | premium, calm, confidence | anything; best for complex or raster logos | `<clipPath>` or `<mask>` animated rect/circle/feathered gradient |
| 6 | **Negative-space reveal** | wit, "look closer", hidden meaning | holes or counters with meaning (analyzer: holes) | animate an object *into* the hole, then the positive shape closes around it; or zoom out from inside the counter |
| 7 | **3D extrude / rotate** | solidity, tech, scale | any closed shape | three.js extrude (§5); rotate from edge-on (invisible) to front |
| 8 | **Liquid / gooey fill** | food, beverage, fluidity, friendliness | rounded shapes | gooey filter (§3.7) or rising wave clipped by the logo |
| 9 | **Glitch / digital resolve** | security, gaming, AI, "signal" | any | RGB-split slices, posterized jumps, then a clean frame lock |
| 10 | **Kinetic letter cascade** | voice, energy, media | a wordmark (glyph parts on a baseline) | per-glyph stagger rise/rotate/scale from baseline (glyph paths via opentype, §3.4) |
| 11 | **Logo as container/window** | platform, "inside us is…", content | large closed shape or counter | the logo shape is a clip for footage or the scene; scale out to reveal the mark, or push in *through* the counter into the next scene |
| 12 | **Born from the product** | product-led brands | product image or UI screenshot with a matching feature | match cut: zoom into a product detail (a button, a cap, a screen element) that has the logo's silhouette and morph it |
| 13 | **Reduction (literal → glyph)** | heritage + modernity | an icon that abstracts a real object | illustrated object → fewer parts → glyph (Instagram logic) |
| 14 | **Trace a path / journey** | logistics, travel, growth | a stroke-like part or arrow | a dot travels a route (map, chart line), and its trail *becomes* the logo stroke |

### 1.3 The 3-step method: concept → metaphor → motion

1. **Brand truth (one sentence).** "<Brand> helps <who> <verb> <object>, feeling <adjective>." Extract the **verb** and the **object**. Example: "Brew helps busy people *wake up* with *coffee*, feeling *warm*."
2. **Visual metaphor.** Brainstorm 10–20 *concrete, drawable* nouns linked to the verb, the object and the feeling (word association; see §2). Keep the ones whose **silhouette rhymes** with a logo part: similar aspect ratio, a hole, a curve, symmetry. Then choose the metaphor structure from advertising research (Phillips & McQuarrie; Forceville): **juxtaposition** (side by side, easiest to read), **fusion** (merged into one form, which means a morph), or **replacement** (the logo *stands in* for the object, the hardest and most rewarding read). "Source in target context" scored highest for fluency and pleasure ([Frontiers in Psychology 2023](https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1131387/full)). For motion, fusion → morph, juxtaposition → split or match-cut, replacement → the logo sits where the object should be (logo as window, born from product).
3. **Motion verb.** Map the brand verb to a motion primitive. *Connect* → lines join, circles overlap. *Grow* → sprout, scale from seed, stroke extends. *Protect* → enclose, shield closes. *Fast* → streaks, smear, arrow lands. *Clarify* → blur → sharp, noise → signal. *Transform* → morph. *Gather* → converge. *Open* → split, iris. *Wake* → a spark ignites a glow. *Flow* → gooey, liquid. The verb picks the transition, the metaphor picks stage 1, and the logo is stage 2.

### 1.4 Decision framework (AI-followable)

```
inputs: brandName, industry, values[] (adjectives), oneLineTruth, logo: LogoAnalysis, assets[]
1. verb, object, feeling = parse(oneLineTruth)
2. candidates = []
3. geometry-driven (always add, scored by fit):
   - monoline/outline-y (thinness>0.6) or script wordmark  → DRAW (+2)
   - parts are circles/rects/capsules (primitiveScore>0.7) → BUILD (+2)
   - islands ≥ 3 and similar sizes                          → ASSEMBLE (+2)
   - meaningful hole (holeArea/area > 0.08)                 → NEGATIVE_SPACE (+1), WINDOW (+1)
   - wordmark present (glyphCount ≥ 3)                      → CASCADE for wordmark (secondary beat)
   - single compact silhouette                              → MORPH_FROM (+2 if an object rhymes)
   - raster-only/low-quality trace                          → MASK or EXTRUDE-from-raster (plane) only
4. meaning-driven (from verb/values):
   connect/together → ASSEMBLE/overlap; grow → DRAW/BUILD; speed → TRACE/mask-slit;
   secure/solid → EXTRUDE; playful → BUILD w/ bounce, GOOEY; luxury → MASK/light-sweep, slow;
   tech/AI → GLITCH-resolve, particles→logo; food/drink → LIQUID, MORPH_FROM ingredient
5. industry priors: fintech→build/mask; food→liquid/morph; logistics→trace/negative-space;
   media→window/cascade; SaaS→assemble/born-from-UI; fashion/luxury→mask/draw.
6. pick top score; tie-break: fewer moving parts wins (clarity), and must be renderable
   (complexity budget: ≤ 40 animated subpaths for morph; else fall back to mask).
7. storyline = { motif (the thread object), stage1 (metaphor scene), bridge (motion verb),
   stage2 (logo resolve), lockup (logo + wordmark + tagline, hold ≥ 1.5 s) }
```

*(observed)* Hard rules: the logo must end **pixel-exact** in the brand colours. The finished mark holds still for ≥ 1.5 s (≥ 2.5 s in 15–30 s spots). Never distort letterforms in the *final* frame. Morph only in the in-between frames.

---

## 2. Visual metaphor & concept development

### 2.1 Brainstorming techniques creative directors use
- **Word association / mind-map.** List words, phrases and ideas around what the brand does, and keep digging until one "sets off a light bulb". School of Motion's own process landed on a teaching philosophy and then translated it into a visual idea ([School of Motion 5-step blueprint](https://www.schoolofmotion.com/blog/5-step-blueprint-motion-designers-use)). For the AI, generate three columns (verb, object, feeling) × 8 associations, then filter for *drawable silhouettes*.
- **Metaphor mapping (source → target).** Name the target (brand attribute) and a source with that property (toothpaste ↔ diamond = whiteness). Then choose juxtaposition, fusion or replacement ([Frontiers 2023](https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1131387/full)). Complexity rises in that order, so short spots (≤ 10 s) should prefer juxtaposition or fusion.
- **Show, don't tell.** Never animate the word "fast". Show an arrow that outruns the frame. Copy carries the *what*, and graphics carry the *feeling*.
- **Juxtaposition / before-after.** Split screen or a match cut between the problem state and the brand state. Tension comes from contrast: chaos ↔ order, grey ↔ colour, many ↔ one.
- **Shape rhyme / match cut.** Find a form that exists in both worlds (a circle = coin = dot = O in the wordmark). That is the hinge for every transition.
- **Brand geometry kit** *(observed)*. Derive a design grammar from the logo itself: corner radius, stroke weight, dominant angle (e.g. Slack's slant), primary curve radius, colour ratios. Then build **all** scene graphics with it. This is what makes "graphics relate to each other". The analyzer should output `{strokeWeight, cornerRadius, angles[], curvature, palette[]}`.

### 2.2 Narrative arc for 10–30 s pieces
*(observed; standard ad/ident structure)*

| Beat | 10 s | 15 s | 30 s | Job |
|---|---|---|---|---|
| Hook | 0–1 s | 0–1.5 s | 0–2 s | arresting motion of the **motif** (a dot, line or shape), no logo |
| Tension | 1–3 s | 1.5–5 s | 2–10 s | the problem/world: motif in chaos, scattered, grey, multiplied |
| Transformation | 3–7 s | 5–11 s | 10–22 s | the motion verb acts: motif connects/grows/morphs; scenes hand off by match cuts |
| Payoff | 7–8 s | 11–12.5 s | 22–26 s | motif **becomes** the logo (stage 1 → stage 2) |
| Lockup | 8–10 s | 12.5–15 s | 26–30 s | logo + wordmark (cascade) + tagline/CTA, held, small settle |

- **One thread element.** Pick one motif and let it persist across every cut. It ends as a part of the logo (Google's dots, Netflix's ribbon). Seed the logo's own primitives in the first 2 s (foreshadowing), so the resolve feels inevitable rather than appended.
- **Examples (templates for the AI):**
  - *Coffee brand, bean-shaped "O".* Hook: a bean drops. Tension: a grey morning, the bean multiplies into a pile. Transformation: one bean splits along its crease → the crease line draws the steam curve. Payoff: the bean morphs into the "O" of the wordmark, letters cascade beside it.
  - *Fintech with a grid/cube mark.* Scattered dots (transactions) → snap to a grid (order) → grid cells fuse into the cube (build) → extrude 3D with a quarter-turn → lockup.
  - *Logistics with an arrow.* A dot travels a map route (trace) → its trail becomes the arrow → the arrow lands in the letter counter (negative space) → letters close.
  - *Collaboration SaaS with 4 coloured parts.* Four UI cards (born-from-UI) float apart → each shrinks into a coloured primitive → they converge on arcs (assemble) → overlap flash → lockup.

---

## 3. SVG morphing & manipulation (implementation)

### 3.1 Library facts (npm, checked 2026-10-15)

| Package | Version | License | Use / notes |
|---|---|---|---|
| `svg-path-commander` | 2.3.3 | MIT | **Primary.** Parse, normalize, transform (2D/3D), reverse, `getPathArea`, `getDrawDirection`, `getPathBBox`, `splitPath`, `pathToCurve`, `getTotalLength`, `pathsIntersection`, `optimizePath`. **New `equalizePaths` / `equalizeSegments`** for morph prep |
| `flubber` | 0.4.2 | MIT | polygon morph; `interpolate`, `toCircle/fromCircle`, `toRect/fromRect`, `separate`, `combine`, `interpolateAll` ([repo](https://github.com/veltman/flubber)). Unmaintained since 2017-ish |
| `@remotion/paths` | 4.0.535 (repo pins 4.0.532) | MIT | `evolvePath`, `getLength`, `getPointAtLength`, `getTangentAtLength`, `cutPath`, `getSubpaths`, `reversePath`, `interpolatePath`, `interpolatePaths`, `getBoundingBox`, `centerPath`, `scalePath`, `translatePath`, `warpPath`, `normalizePath`, `reduceInstructions` |
| `@remotion/shapes` | 4.0.535 | MIT | `makeCircle/Rect/Star/Polygon/Triangle/Pie/Heart…` return `{path}`, which are morph sources |
| `gsap` (MorphSVGPlugin) | 3.15.0 | GSAP Standard "no charge" | best-in-class quality, but see the license warning below |
| `polymorph-js` | 1.0.2 | MIT | 6 KB, handles holes by sorting subpaths by perimeter and padding with collapsed subpaths; abandoned |
| `kute.js` | 2.2.6 | MIT | `svgMorph` (polygon) / `svgCubicMorph` (built on svg-path-commander) |
| `opentype.js` | 2.0.0 | MIT | text → glyph paths (ESM `dist/opentype.mjs`) |
| `paper` / `paper-jsdom` | 0.12.18 | MIT | booleans, `simplify`, `smooth`, `flatten`; Node via `paper-jsdom` |
| `paperjs-offset` | 2.2.1 | MIT | `PaperOffset.offset(path, d, {join, limit})`, `offsetStroke` (outline a stroke) |
| `js-angusj-clipper` | 1.3.1 | MIT | Clipper1 (WASM) offset/booleans on polygons |
| `clipper2-wasm` / `@countertype/clipper2-ts` | 0.4.0 / 1.5.4 | BSL-1.0 | Clipper2 (polygons only, so flatten curves first) |
| `svgpath` | 2.6.0 | MIT | chainable `.abs().unarc().unshort().matrix(m).round(n)`, good for baking transforms |
| `svg-pathdata` | 9.0.0 | MIT | alternative parser/transformer |
| `svgson` | 5.3.1 | MIT | SVG XML ↔ JSON tree |
| `svgo` | 4.1.0 | MIT | preflight cleanup |
| `potrace` | 2.1.8 | **GPL-2.0** | bitmap → SVG (Node, Jimp) |
| `esm-potrace-wasm` | 0.5.1 | **GPL-2.0** | Potrace WASM (browser) |
| `imagetracerjs` | 1.2.6 | Unlicense | colour tracer, lower quality |
| `@visioncortex/vtracer` | 1.0.0-alpha.4 | MIT/Apache-2.0 | colour tracer WASM ([repo](https://github.com/visioncortex/vtracer)) |
| `three` / `@react-three/fiber` / `@remotion/three` | 0.186.1 / 9.8.2 / 4.0.535 | MIT | 3D |

### 3.2 How each morph engine handles the hard cases

- **`@remotion/paths` `interpolatePath(t, a, b)`** is a port of d3-interpolate-path. It reduces both to M/L/C/Q/Z and **extends the shorter command list by splitting segments**. There is **no start-point rotation, no winding fix and no subpath matching**: commands are paired in order. It is good for same-structure paths (charts, two versions of one icon) and causes twisting on arbitrary shapes. `interpolatePaths(input, inputRange, outputRange, {easing})` gives multi-keyframe morphs.
- **flubber** polygonizes curves (`maxSegmentLength`, default 10 px; use 2–4 at 1080p), adds points to the shorter ring and **rotates the start index to minimize squared distance**. `interpolate()` **uses only the first subpath** and does **not** support holes or open lines. `separate(oneShape, [shapes])` / `combine([shapes], oneShape)` triangulate one shape into N pieces, which is the most useful trick for "one object → multi-part logo". Output is polygons, so curves are lost (fine for motion, wrong for the final frame: **swap to the real path at t=1**).
- **svg-path-commander `equalizePaths(a, b, cfg)`** (read from source, v2.3.3):
  1. normalize; if neither is multi-path → `equalizeSegments`;
  2. reverse each path whose global signed area is negative;
  3. `splitPath` → `classifyPaths`: signed area > 0 → **outer**, else **inner (hole)**;
  4. `matchPaths(outers1, outers2)` and `matchPaths(inners1, inners2)`: sort by bbox size descending; for each source pick the target whose bbox **overlaps** and has the **nearest centre**; unmatched paths get a **0.001-px placeholder square at their bbox centre** (the "zero-size dummy shape" technique);
  5. per pair `equalizeSegments`: convert to cubics (or keep polylines if both are polygons), fix winding, split both to a common segment `target` (≤ 3× the larger count), then `getRotatedPath` (**start-point rotation minimisation**).
  - Returns two `PathArray`s with identical command structure, so you can lerp every number.
  - **Pitfalls:** (a) `Object.assign(defaults, cfg)` **mutates module defaults**, so always pass a full config `{mode:'auto', sampleSize:10, roundValues:4, close:false}`. (b) Hole detection relies on **opposite winding**. Logos authored with `fill-rule="evenodd"` and same-direction holes get misclassified. Pre-pass: containment test (point-in-polygon of a sample point) → force holes to the opposite orientation with `reversePath`. (c) If nothing overlaps, everything pairs with placeholders (grow-from-centre), which looks fine for "assemble" but not for "morph". Pre-align (translate/scale the source onto the logo bbox) before equalizing.
- **GSAP MorphSVG** converts to cubics and subdivides to equal counts. Its options are `shapeIndex` (start-point offset, `"auto"`, or an array per subpath), `map: "size"|"position"|"complexity"` (subpath pairing), `type:"rotational"` (interpolates angle and length of handles, which reduces kinks), `origin`, `curveMode` (3.14+), `smooth`, `precompile`, `render`, `updateTarget:false`. It also offers `MorphSVGPlugin.normalizeStrings(a, b, {shapeIndex, map})`, which returns equal-structure strings you can lerp yourself ([docs](https://gsap.com/docs/v3/Plugins/MorphSVGPlugin)). It became free (commercial use allowed) after the Webflow acquisition ([CodePen blog](https://blog.codepen.io/2025/05/05/chris-corner-gsap-more-like-freesap/)). **However,** the Standard License prohibits use "in tools that allow users to build visual animations without code" that compete with Webflow's animation building ([GSAP standard license](https://gsap.com/community/standard-license/)). An AI-driven motion generator is arguably exactly that. **Use MIT libraries in the product.** GSAP is fine only for one-off authoring if counsel agrees.

### 3.3 Multi-part logo morph recipe (TypeScript sketch)

```ts
import { equalizePaths, pathToString, getPathBBox, splitPath, getPathArea, reversePath } from 'svg-path-commander/util';
// 1) precompute ONCE (useMemo / at analyze time), never per frame
const CFG = { mode: 'auto', sampleSize: 10, roundValues: 3, close: false } as const;
export function prepMorph(fromD: string, toD: string) {
  const [A, B] = equalizePaths(fromD, toD, { ...CFG });          // same structure
  const flatA = A.flatMap(seg => seg.slice(1) as number[]);
  const flatB = B.flatMap(seg => seg.slice(1) as number[]);
  const cmds = A.map(seg => [seg[0], seg.length - 1] as const);  // letter + arg count
  return (t: number) => {                                         // pure, deterministic
    let k = 0; let d = '';
    for (const [c, n] of cmds) { d += c;
      for (let i = 0; i < n; i++, k++) d += (i ? ',' : '') + (flatA[k] + (flatB[k] - flatA[k]) * t).toFixed(2);
    }
    return d;
  };
}
```

- **Explicit pairing when the AI controls the story** (beats automatic matching). Split each side into **islands** (outer + its holes). Compute `area`, `centroid` and `bbox`. Then:
  - **Equal counts:** run Hungarian assignment on cost = `w1·|Δcentroid| + w2·|log(areaA/areaB)|`.
  - **Source has fewer pieces:** `flubber.separate(source, targets)` (one bean → 3 letters), or duplicate the source N times and morph each copy to one target (with stagger).
  - **Source has more pieces:** `flubber.combine`, or let extras collapse to zero-size at the nearest target centroid while fading.
  - **Holes:** morph the outer contour first; holes **grow from a point** (dummy) at 40–80% of the timeline. That reads as "the counter opens".
- **Rotation minimisation for polygons:** for ring A of n points and B resampled to n, choose offset `k` minimizing Σ|A[i] − B[(i+k)%n]|² and also test reversed B (flubber does this). For `M`-split cubic paths, svg-path-commander's `getRotatedPath` does it.
- **Quality tips** *(observed)*. Morph between **similar sizes** (pre-scale the source to the logo bbox). Ease with a slow-in/fast-middle curve and a small overshoot. Add a 1–2 frame motion-blur or scale pulse mid-morph to hide kinks. Swap to the exact logo path at the final frame. Cap complexity at about 40 subpaths × 64 segments for render speed.

### 3.4 Text → SVG path (so letters can morph/cascade)

```ts
import opentype from 'opentype.js';            // 2.0.0, ESM
const font = opentype.parse(await fs.readFile('Inter-Bold.ttf'));   // TTF/OTF/WOFF; WOFF2 needs wawoff2 decompress
const glyphPaths = font.getPaths('Brew', 0, 200, 200, { kerning: true }); // one Path per glyph
const parts = glyphPaths.map(p => ({ d: p.toPathData(2), bbox: p.getBoundingBox() }));
// whole word: font.getPath(text,x,y,size).toPathData(2); advance: font.getAdvanceWidth(text,size)
```
- Y is baseline-down in opentype's path coordinates, already SVG-oriented. Ligatures/shaping are limited, so use `fontkit` (MIT) for complex scripts. WOFF2 is not parsed without decompression ([opentype README](https://github.com/opentypejs/opentype.js)). Google Fonts: fetch TTF files (the repo already uses `@remotion/google-fonts` for CSS; keep a local TTF cache for path extraction).
- Per-glyph parts feed **cascade** (stagger by x) and **morph** (glyph ↔ icon part via `equalizePaths`). For **wordmark logos supplied as SVG**, glyphs are already paths. Detect them as same-height islands sharing a baseline.

### 3.5 Stroke-drawing a filled logo ("fill after stroke")
- **Outline draw.** Use the fill path itself as a stroke (`fill:none; stroke:brandColor; stroke-width≈1.5–3px`). Animate with `evolvePath(p, d)` → `{strokeDasharray, strokeDashoffset}` *per subpath* (from `getSubpaths`), staggered by order (§3.8). Then crossfade or wipe the fill in from 70% → 100% and fade the stroke out. Alternative: set `pathLength="1"` and `strokeDasharray="1 1"`, `strokeDashoffset=1-p`.
- **Handwriting / brush reveal.** You need a **centerline**, which outlines don't have. Either (a) have the AI draw a rough centerline polyline, or (b) skeletonize the raster (Zhang-Suen thinning on a rendered mask, then trace). Draw that centerline with a thick stroke (≥ 2× max stroke width) **inside a `<mask>`** over the filled logo. The fill appears exactly where the "pen" has passed.
- **Pitfalls:** dashes on transformed paths. Compute lengths in the same coordinate space (bake transforms with `svgpath(d).matrix(m)`), or use `pathLength`. Open subpaths, tiny dots and i-dots should *pop* (scale) rather than draw. `vector-effect="non-scaling-stroke"` when the logo scales.

### 3.6 Offset / simplify / outline
- **Inline/outline rings, glows, "echo" outlines:** `PaperOffset.offset(path, ±d, {join:'round'})`. In Node use `paper-jsdom` + `paper.setup(new paper.Size(w,h))`. Clipper (`js-angusj-clipper`) is more robust but polygon-only: flatten curves (`paper` `path.flatten(0.25)`) and scale to integers (×100).
- **Simplify** traced or noisy paths: `paper` `path.simplify(tolerance≈1–2.5)` refits Béziers; `simplify-js` (BSD-2) for polylines.
- **Booleans** (unite all parts into a silhouette for mask/extrude, subtract to find the negative space): `paper` `a.unite(b)`, `subtract`, `intersect`. **Negative space = bboxRect − unite(all parts)**, then keep islands fully inside the bbox (the FedEx arrow becomes an extractable shape).

### 3.7 Gooey / metaball
```html
<filter id="goo" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur"/>
  <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo"/>
  <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
</filter>
```
The alpha row (×18, −7) re-thresholds the blur, so nearby shapes fuse ([CSS-Tricks](https://css-tricks.com/?p=195076), [Codrops](https://tympanus.net/codrops/2015/03/10/creative-gooey-effects/)). Apply it to the **group**, not each shape. Scale `stdDeviation` with the composition size. Single-colour only (colours bleed). Animate `stdDeviation` → 0 at the end so the logo resolves crisp. It is heavy on 4K frames, so keep the filter region tight.

### 3.8 Automatic SVG analysis (`analyzeLogo`)

Pipeline (Node, at `add_asset` time; cache JSON next to the asset):
1. **Preflight:** `svgo` with `convertShapeToPath`, `convertStyleToAttrs`/`inlineStyles`, `removeDimensions:false`, keep IDs. Then `svgson` parse.
2. **Flatten:** walk the tree, accumulate `transform` matrices (including `<use>` and nested `<g>`), resolve `fill`/`stroke`/`opacity`/`fill-rule` through inheritance, and bake with `svgpath(d).matrix(m).abs().unarc()`. Convert stroked-only paths to outlines (`PaperOffset.offsetStroke`) if they are needed as fills. Gradients: record stops, use the average colour for palette weighting. *Alternative:* render in headless Chromium (Remotion already ships it) and use `getBBox()`/`getCTM()`/`getComputedStyle`. That is more faithful for CSS-styled SVGs.
3. **Islands:** `splitPath` each path into subpaths. For each, compute a polygon (sample ~1 pt/px), **signed area** (`getPathArea`), bbox, **centroid** (area-weighted polygon centroid; `polylabel` for a label/pivot point inside concave shapes). Assign holes to their smallest containing outer (point-in-polygon), respecting `fill-rule`.
4. **Features per island:** `area`, `bbox`, `centroid`, `color`, `holeCount`, `circularity = 4πA/P²`, `rectangularity = A/bboxArea`, `thinness = 1 − A/(P·maxWidth)` (stroke-like), `aspect`.
5. **Groups:** icon vs wordmark. Cluster by horizontal/vertical bbox gaps (a gap > 0.5× median glyph height splits clusters). A cluster of ≥3 islands with similar heights and an aligned bottom = wordmark. Also group by colour.
6. **Orders for stagger** (store all, let the AI pick): `leftToRight` (bbox.x), `topToBottom`, `reading` (rows then x), `bySizeDesc` (big shapes first, details last; the default for build), `radialOut` (distance from logo centroid), `angular` (atan2 around centroid, for clockwise sweeps), `document` (z-order), `byColor`.
7. **Palette:** area-weighted fill colours. Merge within ΔE(OKLab) < 3 (`culori`, MIT). Mark the dominant, accent and dark/light role. Contrast against the planned background.
8. **Geometry kit:** dominant stroke weight (median of thin islands' widths), corner radius (curvature peaks), dominant angles (edge direction histogram), symmetry (mirror IoU), primitive fit (circle/capsule/rect scores).

Output type (sketch):
```ts
type LogoAnalysis = { viewBox:[number,number,number,number]; parts: Part[]; groups:{icon:number[];wordmark:number[]};
  orders: Record<'leftToRight'|'bySizeDesc'|'radialOut'|'angular'|'reading'|'document', number[]>;
  palette:{hex:string;weight:number;role:'primary'|'accent'|'dark'|'light'}[];
  kit:{strokeWeight:number;cornerRadius:number;angles:number[];symmetry:'x'|'y'|'radial'|null};
  holes:{partId:number;d:string;areaRatio:number}[]; negativeSpace:{d:string;area:number}[] };
type Part = { id:number; d:string; fill:string; area:number; bbox:{x:number;y:number;w:number;h:number};
  centroid:[number,number]; circularity:number; thinness:number; holeIds:number[]; length:number };
```

---

## 4. Raster logos → vector

- **Preferred:** ask for an SVG/PDF/AI. Brand-guideline PDFs usually embed vectors (extract with `pdftocairo -svg`).
- **Pipeline:**
  1. `sharp` (Apache-2.0): `.trim()`, flatten alpha onto the detected background, **upscale 4× (lanczos3)** before tracing, slight median denoise for JPEGs.
  2. **Background:** for logos, sample the 4 corners and border. If uniform, colour-key with tolerance plus flood fill from the edges, which beats ML for flat art. ML fallback: `rembg` (Python, MIT) with **BiRefNet (MIT)** or u2net. Avoid **BRIA RMBG-1.4/2.0** (non-commercial, CC BY-NC) and `@imgly/background-removal(-node)` (**AGPL-3.0**) unless licensed ([imgly repo](https://github.com/imgly/background-removal-js), [BiRefNet](https://www.promptlayer.com/models/birefnet)).
  3. **Colour quantize:** k-means in OKLab, k = 2–8 (stop when ΔE between clusters < 6). Snap to the brand palette if known.
  4. **Trace:** single colour → `potrace` (`turdSize` 2–10, `alphaMax` **0.5–0.8 for geometric logos**, since the default 1.0 rounds corners; `optTolerance` 0.2; `threshold` auto) ([node-potrace](https://github.com/tooolbox/node-potrace)). Multi-colour → trace **one mask per colour** with potrace, then stack in luminance or area order. Or use **vtracer** (`hierarchical: cutout` gives seam-free non-overlapping parts, best for per-part animation; `stacked` is more compact; `filter_speckle`, `color_precision`, `mode: spline`, `corner_threshold` 60) ([vtracer](https://github.com/visioncortex/vtracer)). `imagetracerjs` is the zero-dependency fallback with noticeably blobbier curves.
  5. `paper` `simplify(1–2)` → `analyzeLogo`.
- **Quality caveats:** sharp corners round off, and straight edges wobble at low resolution (< ~300 px tall). Thin strokes and small text (< ~20 px cap height) break or merge. Gradients, shadows, photographic or 3D-rendered logos **cannot** be traced faithfully. JPEG ringing creates speckles. Antialiasing halos shift colours at edges. Stacked traces leave hairline seams between colours (use cutout, or a 0.5 px same-colour stroke). **Rule:** compute a trace-fidelity score (IoU of the re-rasterized trace vs the original alpha at the original resolution). If IoU < 0.97, use the trace only for *in-between* motion (morph/draw/particles) and **cross-dissolve to the original raster for the final lockup**.
- **Licenses:** potrace is GPL-2.0. It is fine as a server-side tool (no distribution), but problematic if bundled into a distributed app. For a clean MIT/Apache stack, use vtracer.

---

## 5. 3D logo

- **Geometry (three r186):**
```ts
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
const data = new SVGLoader().parse(svgText);
for (const p of data.paths) {
  const shapes = p.toShapes();                 // r185+: SVGLoader.createShapes() is deprecated; toShapes honors fill-rule (nonzero|evenodd)
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: 20, curveSegments: 24, bevelEnabled: true,
    bevelThickness: 2, bevelSize: 1.5, bevelSegments: 6 });   // defaults: depth 1, bevel ON (0.2/0.1/3)
  const mesh = new THREE.Mesh(geo, materialFor(p.userData.style.fill));
  group.add(mesh);                                           // one mesh per part → explode/assemble in 3D
}
group.scale.y = -1;   // SVG y-down → three y-up; then center via new Box3().setFromObject(group)
```
  Stroke-only paths: `SVGLoader.pointsToStroke(points, SVGLoader.getStrokeStyle(w, color, join, cap))`, or outline first (§3.6). Use **one mesh per analyzer part** so the 2D reveal modes carry over into 3D. To animate the extrusion, scale `z` 0 → 1 (never rebuild geometry per frame).
- **Premium materials:**
  - **Chrome:** `MeshPhysicalMaterial({metalness:1, roughness:0.08–0.2, clearcoat:1})` + environment `new PMREMGenerator(gl).fromScene(new RoomEnvironment()).texture` on `scene.environment`. Metal with no environment renders black ([three docs: RoomEnvironment](https://threejs.org/docs/pages/RoomEnvironment.html)).
  - **Glass:** `transmission:1, thickness:5–20, ior:1.45–1.5, roughness:0.02–0.1, attenuationColor` ([sbcode glass](https://sbcode.net/threejs/glass-transmission/)). It is expensive (extra render pass) and needs something behind it to refract (a gradient or logo-coloured shapes).
  - **Matcap:** `MeshMatcapMaterial({matcap})` looks premium with zero lights, is cheapest, and is fully deterministic. **Best default for CPU renders.**
  - Brand-colour satin: `MeshStandardMaterial({color, roughness:0.35, metalness:0.1})` + env. A light sweep is a moving `RectAreaLight` or an animated env rotation.
- **Remotion headless:** `@remotion/three` `<ThreeCanvas width height>` drives everything with `useCurrentFrame()` (no `useFrame`). Wrap `<Sequence layout="none">`. Three.js needs a GL backend: `--gl=angle` on desktop, **`swangle` on GPU-less Linux/Lambda (works but slow)**, `angle-egl` on GPU cloud. Pass `chromiumOptions:{gl}` to `renderMedia()`/`selectComposition()`, because the config file doesn't apply to SSR. `angle` leaks memory on long renders, so chunk them ([Remotion three](https://www.remotion.dev/docs/three), [GL options](https://www.remotion.dev/docs/gl-options)). Under `swangle`, avoid transmission, high bevelSegments and shadows. Prefer matcap/env metal. Use `<ThreeWebGPUCanvas>` only where WebGPU exists.
- *(observed)* 3D logo choreography that reads premium: start edge-on (90° Y), rotate to front with a long ease-out (1.2–2 s), a specular sweep crossing at the moment it faces camera, a tiny settle (±2°), then **cut or crossfade to the flat 2D logo** for the lockup (brand-exact colours).

---

## 6. Engine changes this implies (priority order)

1. `src/core/logo.ts` — `analyzeLogo()` (§3.8) runs in `add_asset` for SVGs and traced PNGs. It returns the analysis plus a preview with part IDs overlaid, so the director can *see* the parts.
2. `src/engine/kit/LogoStory.tsx` — `mode` ∈ catalog §1.2, `order`, `stagger`, `motif` (a primitive or an object SVG), `from` (morph source), `holdFrames`. Built on a shared `useMorph(fromD, toD)` (memoized `prepMorph`) and `evolvePath`.
3. A **`motif` / persistent element** across scenes (complements 01-motion-craft §0.2): a layer with `persist: true` and a keyed shape that morphs between scene states and finally into a logo part.
4. A small **concept object library** (bean, leaf, drop, pin, bubble, spark, arrow, coin, heart, globe, chart line) as clean single-subpath SVGs sized to a 100-unit box. These are morph sources.
5. DIRECTOR_GUIDE additions: the 3-step method (§1.3), the decision framework (§1.4), the arc table (§2.2), and hard rules (exact final frame, hold ≥ 1.5 s, one thread element).
6. Raster ingest: `sharp` + colour key + vtracer (MIT) + fidelity score with raster fallback (§4).
7. Optional: `@remotion/three` `Logo3D` with matcap/chrome presets; enable only when the render host has `--gl` configured.
