# 05: 3D styles and "wow". How premium 3D motion is made, why it blows minds, and what to build next

Research brief for the `three` layer (`src/engine/kit/three/*`, KIT_REFERENCE "3D"). The current state is 9 materials, 6 lighting presets, 7 object animations, camera orbit keyframes and a contact shadow. Everything is a pure function of `t`, each layer gets one `ThreeCanvas`, and the canvas is transparent so it composites over the scene. The budget is about 57 ms per frame at 1080p on an Intel iGPU via ANGLE. Lambda uses `swangle` (SwiftShader), which is several times slower.

How to read this: documented claims carry a link. Claims marked *(observed)* are craft knowledge from watching the work. Claims marked *(est.)* are our engineering estimates, not measurements.

---

## 0. TL;DR

1. **The biggest missing primitive is the cloner, not another material.** Most premium C4D/Houdini motion is *many simple things moving under one rule* (MoGraph cloner, effectors, fields). A logo built from 2,000–50,000 instances that ripple, sweep, scatter and lock is the most reusable "wow" engine we can add. One `InstancedMesh` covers it, one draw call, deterministic.
2. **Physics is the second unlock: fake it analytically, or bake it.** Springs, bounces, squash and jiggle have closed forms. Shatter piles, cloth and dominoes can be simulated once at load (seeded, fixed timestep), stored as per-frame transforms and cached by spec hash. Rapier ships a cross-platform deterministic WASM build ([rapier.rs determinism](https://rapier.rs/docs/user_guides/javascript/determinism)).
3. **Post adds a lot of perceived value and is feasible.** `postprocessing@6.39.5` declares `three >=0.168 <0.187`, so it fits our r186. `@react-three/postprocessing@3.2.0` needs fiber ≥9.7 (we have 9.8.1); both versions were checked on npm. Use only *spatial* effects (bloom, DOF, CA, vignette, grain seeded by frame). Avoid temporal ones (TAA, SSR/SSGI accumulation, velocity motion blur).
4. **The context limit (about 16 WebGL contexts per page) is the structural risk** ([explainer](https://bugnet.io/blog/how-to-fix-too-many-active-webgl-contexts-oldest-context-will-be-lost)). Before adding many 3D layers, move to **one shared renderer per scene** (drei `<View>`/scissor, or offscreen render plus blit). The three.js manual recommends this for exactly this reason ([three.js multiple scenes](https://threejs.org/manual/en/multiple-scenes.html)).
5. **"Mind-blowing" is mostly structure, not polygons.** The structures are continuity (one thing becomes another), scale shift, perfect fit and sync, density then calm, and occlusion or light reveals. The 46 moments in §2 are recipes the director can compose.

---

## 1. How Blender, C4D and Houdini artists make premium 3D motion

### 1.1 Cinema 4D MoGraph: the motion-designer's core grammar

| Tool | What it does | Why pros love it | Our equivalent |
|---|---|---|---|
| **Cloner** (grid / radial / linear / object / honeycomb) | Copies one object N times in a pattern or onto a mesh's points, surface or volume | One rule animates 10k things, so you get complexity for free | `InstancedMesh` with per-instance seed, rank and rest-position attributes |
| **Plain effector + Fields** | Applies a transform/scale/color offset, weighted by a field. Maxon notes many field-based looks now need only Plain + Fields instead of Shader/Formula/Step/Volume effectors ([Maxon: Plain](https://help.maxon.net/c4d/s22/us/html/OEPLAIN-FALLOFF_GROUPFALLOFF.html)) | One sweeping falloff gives the classic "wave of transformation" | Field function `w(i,t)` ∈ [0,1] × parameter deltas, done in the vertex shader |
| **Random effector** | Seeded per-clone offsets ([Maxon: Random](https://help.maxon.net/c4d/s22/us/html/OERANDOMIZE-FALLOFF_GROUPFALLOFF.html)) | Organic variety | `hash(seed, i)` |
| **Step effector** | Sequential 0→1 values across clones ([Maxon: Step](https://help.maxon.net/c4d/s22/us/html/OESTEP-FALLOFF_GROUPFALLOFF.html)) | Cascades and gradients by index | `i/(n-1)` remapped |
| **Delay effector** | Clones lag behind effector changes (blend/spring) | Gives follow-through to every clone | Per-clone time offset `t - k·rank` plus the analytic spring we already have |
| **Spline effector** | Moves clones along a spline ([Maxon: Spline](https://help.maxon.net/c4d/r21/us/html/7443.html)) | Letters on rails, conveyor loops | `CatmullRomCurve3.getPointAt(u)` precomputed to a LUT |
| **Shader / Formula** | Texture or math drives the parameters | Noise-driven organic fields | GLSL noise in the vertex shader |
| **Fields** (linear, spherical, box, cone, random, shader, formula) + **remapping** | Blend into one 0–1 weight. Remap curves, clamps and quantizes it ([Maxon: Fields remap](https://help.maxon.net/c4d/s22/us/html/FLINEAR-ID_FIELDCONTROLS.html)) | Spatial control of *where* the effect happens | `field(p,t)`: linear plane, sphere radius, noise, combined with min/max/mult |
| **Voronoi Fracture** (R18+) + **MoText** | Shatters any object into clone-able pieces. MoText makes every letter a clone ([LinkedIn Learning](https://origin-www.lynda.com/After-Effects-tutorials/Shatter-objects-Voronoi-Fracture/548716/738873-4.html), [Packt: logo shatter + Plain effector reassembly](https://www.packtpub.com/en-gb/learning/how-to-tutorials/animating-capabilities-cinema-4d)) | Shatter→reassemble logo stings | `@dgreenheck/three-pinata@2.0.1` (Voronoi + plane fracture, needs manifold meshes) ([three-pinata](https://www.jsdelivr.com/package/npm/@dgreenheck/three-pinata)) |
| **Volume Builder + Fracture** | Procedural logo reveals ([Pixel Lab](https://www.thepixellab.net/?p=29824)) | Melting and growing reveals | SDF raymarch (§3.5) |

The key insight *(observed)* is that a MoGraph shot is usually **clone layout × field sweep × per-clone spring**. The field moves, and each clone eases to the field's target with its own delay. That one pattern produces wipes, ripples, flips, inflations and scatter→assemble.

### 1.2 Blender Geometry Nodes

- **Instancing on points** (Distribute Points on Faces → Instance on Points) scatters objects over a logo. **Curve → Resample → Curve to Mesh** sweeps a profile along a path. Animate the **Trim Curve** factor and the path "grows" ([BlenderNation curves guide](https://www.blendernation.com/2025/09/12/beginner-tutorial-your-guide-to-curves-in-geonodes/)). Noise texture plus scene time gives organic wobble.
- **Our equivalent:** `MeshSurfaceSampler` (three addon) for scattering, `TubeGeometry` and `drawRange` for growth, and a shader-side `uGrow` uniform that discards fragments with `u > grow`.

### 1.3 Simulations

| Sim | Signature motion-design uses | Artists/tools | Feasible here? |
|---|---|---|---|
| Soft body / jiggle | Gummy letters land with squash and wobble. Wannerstedt's "Gummy Tron" ([designwanted](https://designwanted.com/andreas-wannerstedt-interview/)) | Houdini Vellum (few params: stiffness/damping) ([Doxia](https://www.patreon.com/posts/33775247)) | Yes, analytically: a damped oscillator on squash amplitude plus vertex shader |
| Cloth | Drape over a hidden logo, then pull it off. A whole template genre ([Vellum cloth reveal scene](https://attic.gumroad.com/l/mtvomb)) | Vellum, C4D cloth | Yes, baked: 48×48 Verlet grid, as in the three.js cloth example ([three.js cloth refs](https://offscreencanvas.com/issues/cloth-simulation-in-threejs/)) |
| Rigid bodies | Letters pile up. Domino runs. Ball-run contraptions | Bullet/C4D Dynamics, Houdini RBD | Yes, baked with Rapier deterministic, or analytic for dominoes |
| Fluids | Liquid logo, splash crown, pours | Houdini FLIP, RealFlow | Fake it: SDF metaballs + noise; true FLIP is out of scope |
| Particles / flocking | Swarms forming a logo. Murmurations | X-Particles, Houdini POPs | Yes: analytic per-particle paths in the shader, 50k–300k points |
| Smoke / volumetrics | God rays, dissolves | Houdini Pyro, EmberGen | Partly: raymarched noise volume at half res, or sprite smoke. Expensive |

### 1.4 Deformers

Bend, twist, taper, wave, squash/stretch, FFD and shatter. ManvsMachine's Nike Air Max Day 2016 "kinetic sculptures" morphed the shoe with C4D surface and mesh deformers, built to defy physics ([It's Nice That](https://itsnicethat.com/articles/man-vs-machine-nike-air-max-day-2016-060416), [Stash](https://www.stashmedia.tv/manvsmachine-nike-air-max-2017/)).
**Our blocker:** `geometry.ts` extrudes with `steps: 1` and caps are big triangles, so vertex deformers have nothing to bend. Fix it with `steps: 12–24` along depth and `TessellateModifier` (three addon) on caps, both only when a deformer is active.

### 1.5 Procedural noise displacement

Blobby, breathing and organic morphs use 3D simplex or curl noise in the vertex shader, displacing along the normal (the classic "noise blob"). Use it for idle "alive" states and for morphs (sphere↔logo via SDF lerp).

### 1.6 "Satisfying" loops and kinetic sculptures

- **Andreas Wannerstedt** (Stockholm) works with "flawless synchronisations", loops built from simple geometric shapes, and tolerances, friction and gravity pushed past real limits ([designwanted](https://designwanted.com/andreas-wannerstedt-interview/)). Recurring motifs are pendulums that *narrowly miss* each other, jelly strands and Rube Goldberg contraptions ([Creative Review](https://www.creativereview.co.uk/meet-the-artists-behind-the-webs-most-satisfying-videos/)). He says he anchors the work in nature and simple maths ([Scandinavian Mind](https://scandinavianmind.com/how-andreas-wannerstedt-became-a-forerunner-for-oddly-satisfying-art/)). Clients include Google, Adidas, Ikea, Audi, Omega and Red Bull.
- Other grammar from the genre *(observed)*: gears meshing, Penrose/infinite stairs under an orthographic camera, conveyor belts, objects passing through exact-fit holes, marble runs, and rotating rings that align into a shape at one angle.

### 1.7 Product-shot language (Apple / ManvsMachine)

- **Turntable on one axis** against black or one color, with slow long eases. **Macro passes** glide along an edge with a shallow DOF. A **rim-light reveal** brings the silhouette out of black. A **light sweep** moves a hot specular streak across chrome or glass. **Hero lighting** uses large softboxes and a reflection card on the screen. Recreations of Apple's look use five lights, motorized slider pull-backs, and fans behind the product for controlled motion ([DIYPhotography/Syrp](https://www.diyphotography.net/?p=139467), [Manfrotto](https://www.manfrotto.com/global-en/stories/how-to-shoot-cinematic-videos-secrets-from-the-best-in-class/)). Apple mixes CG with handmade practical props, as in the MacBook Neo film ([PetaPixel 2026](https://petapixel.com/2026/04/24/how-apple-filmed-its-flashy-macbook-neo-video-using-handmade-props/)). WWDC 2023 used hidden CG "middleman" cameras between locations ([9to5mac](https://9to5mac.com/2023/06/21/apple-keynote-videos-transitions-and-editing/)).
- **ManvsMachine:** C4D-centric (Arnold, V-Ray, Houdini for complex sims) ([MotionArray](https://motionarray.com/learn/motion-design/studio-spotlight-manvsmachine/)). Their iMac Pro film is a monolithic algorithmic structure with photographic textures and a procedural detail system ([mvsm.com](https://mvsm.com/project/imac-pro)). Air Max 2017 is an abstract CG piece "about air itself", with sound built from foot strikes and breath ([Stash](https://www.stashmedia.tv/manvsmachine-nike-air-max-2017/)).

### 1.8 Look-dev (Octane/Redshift looks and their three.js equivalents)

| Look | Octane/Redshift | three r186 |
|---|---|---|
| Glass with rainbow edges | Dispersion (Abbe) | `MeshPhysicalMaterial.transmission + thickness + dispersion` (dispersion only affects transmissive objects) ([three docs](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)); drei `MeshTransmissionMaterial` adds chromatic aberration, anisotropic blur and samples, at the cost of an extra scene render ([drei](https://drei.docs.pmnd.rs/shaders/mesh-transmission-material)) |
| Iridescent / holographic foil | Thin film | `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange`, plus a custom fresnel+scanline shader for "hologram" |
| Subsurface (wax, jelly, skin) | SSS | Fake it with `transmission` + `thickness` + `attenuationColor`, or `sheen`, or a wrap-lighting `onBeforeCompile` |
| Caustics | Path-traced | drei `Caustics` (a projected caustics plane). Expensive; or a baked caustic texture on the floor |
| Car paint / candy | Clearcoat + flakes | `clearcoat`, `clearcoatRoughness`, plus a flake normal map (seeded DataTexture like `brushedMap`) |
| Velvet / fabric | Sheen | `sheen`, `sheenRoughness`, `sheenColor` |

### 1.9 Camera language

The core moves are dolly zoom, rack focus, whip pan, orbit, push-in, top-down "god shot", macro and handheld micro-shake. Dolly zoom math is to hold the frustum height `h = 2d·tan(fov/2)` constant, so `fov = 2·atan(h/(2d))` ([Unity manual](https://docs.unity3d.com/2018.3/Documentation/Manual/DollyZoom.html), [three forum](https://discourse.threejs.org/t/how-do-i-do-dolly-hitchcock-vertigo-zoom-using-perspective-camera/31894)). All of these are pure functions of `t` and slot into `cameraAt()`.

### 1.10 Post

Bloom, DOF, chromatic aberration, film grain, vignette, light leaks, glow, LUT/color grade. pmndrs postprocessing has bloom, DOF, SSAO, god rays, CA/noise, vignette, LUT, tone mapping and HalfFloat buffers for HDR ([GitHub](https://github.com/pmndrs/postprocessing)).

### 1.11 Artists and pieces to study

- **Beeple** (Everydays 2007–2021): C4D + Octane, built straight in 3D without sketches, often kitbashed stock models ([OWC interview](https://eshop.macsales.com/owc-radio/beeple-breaks-worldwide-records-for-digital-art/), [Behance](https://www.behance.net/gallery/150063657/BEEPLE-EVERYDAYS-THE-FIRST-5000-DAYS-(20072021))). Lesson: scale contrast and surreal juxtaposition.
- **ManvsMachine:** Nike Air Max Day '16/'17/'18 and Apple iMac Pro ([It's Nice That '18](https://www.itsnicethat.com/news/manvsmachine-air-max-day-2018-graphic-design-160418)).
- **Buck:** 400+ people, brand systems and product film for Apple, Google, Nike and Netflix ([moonb](https://www.moonb.io/blog/best-motion-graphics-companies)).
- **Andreas Wannerstedt:** "The Conveyor Belt", "Slalom", "Double Served", "Gummy Tron".
- **Ash Thorp:** design direction on Prometheus, "Project 2501" (Ghost in the Shell homage), OFFF 2014 titles ([Wikipedia](https://en.wikipedia.org/wiki/Ash_Thorp)).
- **Universal Everything:** generative, playful figures ([mattrunks](https://mattrunks.com/en/blog/studios/universal-everything-pencil-to-generative-art)).
- **Tendril**, **Gunner**: product and brand 3D.
- **Shinjuku 3D cat** (2021): an anamorphic billboard built for one viewing angle, where occlusion and distance cues sell the illusion ([Wimba case study](https://journals.itb.ac.id/index.php/wimba/article/view/21442), [designboom](https://www.designboom.com/design/3d-cat-cross-shinjuku-vision-tokyo-07-07-2021/)).

---

## 2. What makes motion "mind-blowing"

### 2.1 The mechanisms

Evidence is thin and mostly journalistic. Wikipedia notes the "oddly satisfying" literature cites no peer-reviewed studies ([Wikipedia](https://en.wikipedia.org/wiki/Oddly_satisfying_videos)). The best-supported ideas are discomfort with incompleteness and the "just right" feeling of completion ([Discover](https://www.discovermagazine.com/why-are-oddly-satisfying-videos-sosatisfying-218)), and the calming effect of predictable repetition with small variations ([Live Science](https://www.livescience.com/62091-oddlysatisfying-videos-satisfying.html)). Combined with craft observation:

1. **Completion and perfect fit.** Pieces lock, gaps close and things align. The payoff is a tension curve that resolves exactly.
2. **Impossible physics that stays physically plausible.** Real materials and real gravity, then one rule broken (Wannerstedt, ManvsMachine "defy physics").
3. **Continuity and transformation.** No cuts: A *becomes* B. The brain tracks the object and is rewarded when identity is preserved.
4. **Scale shift.** Macro ↔ cosmic. A grain of a thing is revealed to be part of a giant thing.
5. **Density burst → calm.** 10,000 elements collapse into one clean mark. Contrast in complexity is what the eye notices.
6. **Precision synced to sound.** Hits land on transients. This is perceived as craft, and we have `analyze_audio`.
7. **Reveal mechanics.** Occlusion (cloth, door), light (rim sweep, flashlight), assembly and growth. The viewer gets to discover it.
8. **Anticipation → payoff.** Wind-up (twist, compress) before release. Classic animation principle.
9. **Tactile materials.** Jelly, chrome, glass, clay and fabric. Viewers simulate touch.
10. **"How did they do that?"** Perspective tricks (anamorphic alignment, Penrose loop), shadows that differ from their object, impossible geometry.
11. **Seamless loops.** The end frame equals the start frame and the seam is hidden by symmetry (rotate 360/n for n-fold symmetry).

### 2.2 Wow-moment catalog (46 recipes)

Cost classes *(est.)*, per frame at 1080p on our iGPU: **L** < 10 ms, **M** 10–30 ms, **H** 30–60 ms, **B** = needs a bake at load (seconds), then L/M per frame. SwiftShader is roughly 3–10× slower; avoid H on Lambda.

| # | Moment | Why it works | Build in our stack | Cost |
|---|---|---|---|---|
| 1 | **Particle swarm → logo** | Density → order; completion | Sample N points in the logo volume (rasterize SVG, then rejection-sample interior × depth). Per-particle `start` = seeded sphere/galaxy. Position `mix(start, target, e(t - delay_i)) + (1-e)·curlish(seed,t)` in the vertex shader. `THREE.Points` or instanced quads, additive, then bloom | L (100k pts) |
| 2 | **Voronoi shatter → reassemble** | Destruction reversed = completion | three-pinata at build time (cached by geometry key). Each shard gets seeded v/ω. Analytic ballistic + spin, reversed with expoOut so shards "fly home" and lock | L + B (fracture ~100–500 ms) |
| 3 | **Shatter into a physical pile** | Real gravity reads expensive | Rapier deterministic bake of shards on the floor, stored as a per-frame transform buffer | B (1–3 s) + L |
| 4 | **Cloth pull-off reveal** | Occlusion reveal + tactile fabric | Verlet 48×48 grid baked: drape over the logo's bounding SDF, then corner pins move off-frame. Cloth shaded with `sheen` | B (~0.5 s) + L |
| 5 | **Cloth drape silhouette** | Mystery shape, then a guessable reveal | Same bake: the cloth settles over the logo (collide against an extruded-logo SDF) | B + L |
| 6 | **Liquid metaball logo** | Blobs coalesce into crisp type | Raymarch `smin(logoSDF3D, blobs)`, with smin per Inigo Quilez ([iq smin](https://iquilezles.org/articles/smin)). Blob radius → 0 as the logo settles. Chrome env reflections from our PMREM | M–H (half-res helps) |
| 7 | **Chrome drip / melt** | Material transforms; impossible | SDF logo with y-dependent smin to drips, and noise | H |
| 8 | **Rim-light reveal from black** | Light *discovers* the form | `rim`/`dramatic` preset with light intensity keyed 0→1 and a moving directional light. Already 80% there | L |
| 9 | **Specular light sweep across chrome** | Signals "premium material" | Animate the env-map rotation (`scene.environmentRotation`, r162+) or a bright strip in the procedural env. A cheaper alternative is a screen-space gloss band masked by normal·view | L |
| 10 | **Macro pass → hero pull-out** | Scale shift; detail then context | Camera starts 0.15× distance at the bevel edge with strong DOF and flies out along a spline. Needs a near-plane fix and DOF | M |
| 11 | **Infinite zoom (Droste)** | Endless scale | Logo counter/hole contains a scaled copy. Camera distance follows exponential zoom `d = d0·k^(-t)`, wrapped every factor-k | L |
| 12 | **Cloner wave field** | Hypnotic regularity | Grid of N rounded boxes. `y = A·sin(k·r - ωt)`. Logo mask lifts or recolors the inside cells | L |
| 13 | **Field sweep tile flip** | A wave of change reads as "system" | Linear field `w = smooth(x - v·t)`. Each tile rotates 180° on spring, logo on the back faces | L |
| 14 | **Domino cascade → logo** | Causality + completion | Domino positions along a curve tracing the logo. Tip time `t_i = i·Δ`, fall angle via a tuned analytic curve (no sim needed) | L |
| 15 | **Letters drop and pile into a word** | Gravity + order emerging | Analytic: per-letter parabola with restitution bounces (closed-form sequence), then the spring settle | L |
| 16 | **Jelly landing** | Tactile, funny, alive | Vertex shader squash `s(t)=1+A·e^(-ζt)·sin(ωt)` along the impact axis, volume preserved (xz = 1/√s). Needs tessellation | L |
| 17 | **Perfect-fit pass-through** | Precision, tension | Object traverses a cut-out matching its silhouette with ~1% margin. The camera lingers on the near-miss | L |
| 18 | **Near-miss pendulums** | Anticipated collision that never happens | Phase-offset pendulums `θ_i = A·sin(ωt + φ_i)` with designed clearances | L |
| 19 | **Meshing gears loop** | Mechanical satisfaction | Gear profiles extruded. Angular speeds by tooth ratio; loop length = LCM period | L |
| 20 | **Penrose / infinite stairs** | Impossible geometry | Orthographic camera at a precise iso angle. The geometry is open but aligns in projection. A walker loops | L |
| 21 | **Anamorphic alignment** | "How did they do that" | Logo shards scattered in depth, each scaled by `d/d_ref` so they align only from camera pose P. The orbit passes through P | L |
| 22 | **Breaks the frame** | Shinjuku cat effect | Render the 3D layer above a 2D "screen" frame layer, with the object's z crossing the frame plane and a fake frame occluder | L |
| 23 | **Dolly zoom on hero** | Unease → focus | `cameraAt` adds `dollyZoom: true`, fov computed per frame | L |
| 24 | **Rack focus** | Directs attention | DOF focusDistance keyed from the foreground text to the product | M |
| 25 | **Whip pan + motion blur** | Energy, transition glue | Fast yaw in the orbit plus in-canvas sub-frame accumulation (6–8 renders averaged) only during the whip | H (during whip only) |
| 26 | **God shot → 3/4** | Reveal of layout | Pitch 89° to 7°, with distance and roll eased | L |
| 27 | **Exploded view with callouts** | Shows inner value | Existing `explode`, plus HTML callouts projected from 3D points (expose screen coords to the 2D layer) | L |
| 28 | **Sphere → logo morph** | Continuity | Raymarch `mix(sphereSDF, logoSDF, e)`, or a mesh morph via SDF-resampled vertices | M |
| 29 | **2D logo extrudes into 3D** | Continuity with our 2D logo layer | Start at depth 0 (scale z=0.001, front cap only, orthographic) matching the 2D layer pixel-for-pixel. Grow depth, then rotate | L |
| 30 | **Split-flap cascade** | Retro precision + sound | Clones = flaps; each flips through N glyphs to its target with a staggered stop | L |
| 31 | **Cube shuffle assembles logo** | Puzzle completion | Voxelized logo cubes on grid paths. Manhattan moves on beats | L |
| 32 | **Ribbon writes the logo** | Growth, handwriting | Curve-to-mesh `TubeGeometry` along the logo outline, `drawRange` grown, chrome or neon | L |
| 33 | **Inflate / puffy** | Tactile, trendy "puffy 3D" | Bevel ↑ plus vertex inflate along normal `k·smoothstep`, with spring overshoot | L |
| 34 | **Glass with dispersion** | Rainbow edges = premium | `transmission:1, thickness, dispersion:0.3–1, ior 1.5`. Rotate a high-contrast backdrop behind it | M |
| 35 | **Holographic foil tilt** | Color shift on movement | `iridescence:1` + a thin-film range, small tilt oscillation; or a custom hologram shader | L |
| 36 | **Coin stack / gold rain** | Abundance, value | Instanced coins, analytic fall + spin, stacking by index | L |
| 37 | **Twist wind-up → release** | Anticipation, payoff | Twist deformer angle `θ(y) = k(t)·y`, where k ramps up and then springs to 0 | L (tessellated) |
| 38 | **Wave/flag deformer through text** | Organic life | `z += A·sin(kx - ωt)` with recomputed normals (analytic derivative) | L |
| 39 | **Orbiting satellites/rings** | Planetary grandeur | Torus rings plus instanced moons on Keplerian-ish ellipses, light trails via `TubeGeometry` drawRange | L |
| 40 | **Portal / window logo** | World inside the mark | Stencil buffer: logo mesh writes stencil, interior scene renders where stencil=1 | M |
| 41 | **Neon flicker-on** | Electric anticipation | Seeded flicker table per tube with intensity × glow. Existing neon + SVG glow, or bloom | L |
| 42 | **Seamless loop** | Infinite watch, replays | Turntable 360/n for n-fold symmetric logos. All periodic terms share an LCM period; `loop: true` validates it | L |
| 43 | **Burst → collapse to one** | Density then calm | 20k instances explode from a point (noise ballistic), then implode to a single hero mark | L |
| 44 | **"Pixel" was part of a giant logo** | Scale reveal | Camera starts inside one instance of a cloner; pulling out reveals the logo of logos | L–M |
| 45 | **Beat-reactive field** | Sync = craft | Field amplitude keyed from `analyze_audio` beats (spec-time constants, no runtime audio) | L |
| 46 | **Shadow-play reveal** | "How?": random junk casts the logo's shadow | Shadow-only light from a fixed direction. Geometry scattered so its projection equals the logo (extrude projected cells at random depths along light rays) | M (needs a shadow map, which we don't have yet) |

---

## 3. 3D animation styles to add

Each must be `f(spec, t)`: no clocks, `mulberry32`/hash seeding only, and any sim baked with a fixed step and a fixed iteration order.

### 3.1 MoGraph cloner + fields (highest impact)

- **Approach:** a new `mode: "cloner"`. The clone layout comes from the source (rasterize the logo to a mask, then a grid, hex, surface sample via `MeshSurfaceSampler`, or volume). The clone shape is `rounded-box | sphere | cylinder | glyph | logo` (the logo-of-logos look).
  - One `InstancedMesh` with instanced attributes `aRest(vec3)`, `aSeed(float)`, `aRank(float)`, `aColor`.
  - The motion lives in the vertex shader via `onBeforeCompile` on `MeshPhysicalMaterial`, so lighting stays PBR, or via `three-custom-shader-material@6.4.0` ([npm, peer three ≥0.159]).
  - Fields are evaluated in the shader with `uT` and field uniforms. The per-clone spring is the closed form from our `spring()`.
- **Performance** *(est.)*: one draw call. An instanced rounded box at ~200 tris × 10k = 2M tris, fine on an iGPU. For 50k+, use a 12-tri box or flatShaded icosahedron. Computing matrices in the shader avoids CPU `setMatrixAt` (an InstancedMesh replacing ~19.6k meshes cut render CPU 28.5→0.5 ms in one report ([threejs-perf](https://www.typingmind.com/skills/playableintelligence-threejs-perf))). Disable frustum culling or set a manual bounding sphere.
- **API:**

```json
{ "type": "three", "source": "svg:assets/logo.svg", "mode": "cloner",
  "cloner": { "layout": "grid|hex|surface|volume|scatter", "density": 60, "shape": "rounded-box", "gap": 0.1, "seed": 7 },
  "fields": [
    { "kind": "linear", "axis": "x", "from": 0, "to": 1.6, "width": 0.3, "ease": "inOutQuint",
      "effect": { "scale": [0, 1], "rotateY": [180, 0], "z": [-0.6, 0] }, "spring": 0.6 },
    { "kind": "noise", "amount": 0.05, "speed": 0.4, "effect": { "z": 1 } }
  ] }
```

### 3.2 Soft-body squash / jiggle

- **Approach:** a vertex-shader deformer stack (`deform: [{type:"squash", at:1.2, axis:"y", amount:0.35, decay:6, freq:3.2}]`) driven by an analytic damped sinusoid with volume preservation. Add secondary wobble from low-frequency noise weighted by height. Landing times can be derived from the analytic drop (`animation: "drop-jiggle"`).
- **Prerequisite:** tessellation (`steps: 16`, `TessellateModifier` on caps, max edge about 1/30 height), and normals recomputed analytically or by finite differences in the shader.
- **Cost:** L. Geometry grows roughly 5–10×, which is still small.

### 3.3 Voronoi shatter → reassemble

- **Approach:** `three-pinata` fracture at model build, seeded, with 20–80 shards per part. Inner faces get an interior material (darker, or emissive for a "hot core"). Choreography: `shatter-in` (shards fly in from a sphere and lock), `shatter-out`, `shatter-pile` (Rapier bake).
- **Determinism:** pinata uses random seeds, so pass our seeded points or patch the RNG. Cache fragments by `(geometryKey, seed, count)`.
- **API:** `"animation": "shatter-in", "fracture": { "pieces": 40, "seed": 3, "interior": "#ff5a1f" }`.

### 3.4 Cloth-like reveal

- **Approach:** a Verlet grid (48² to 64²), with structural and shear constraints, 8–15 iterations, a fixed 1/120 s step, and collision against the logo's bounding rounded box or SDF. It is baked from t=0 to the end at load inside `delayRender`, into a `Float32Array(frames × verts × 3)`: 64² × 3 × 4 B × 300 f ≈ 15 MB, or store every 2nd frame and lerp. The render updates the position attribute per frame and recomputes normals (~4k verts, trivial).
- **Determinism:** use only `+ − × ÷ sqrt` in the sim (IEEE-exact), seeded perturbation and fixed loop order. Cache module-level by spec hash. Each Remotion tab re-bakes (~0.2–1 s), or the server pre-bakes into a project asset `bake/<hash>.bin` served by `assetServer`.
- **API:** `"reveal": { "kind": "cloth", "pull": "up-right", "at": 0.6, "duration": 1.4, "color": "#111", "sheen": 0.8 }`.

### 3.5 Liquid / metaball logo (raymarched SDF)

- **Approach:** generate a 2D SDF of the logo once (rasterize SVG to 512², then a JS Euclidean distance transform, ~50 ms) and upload it as a texture. 3D SDF = IQ's extrusion `opExtrusion(d2(p.xy), p.z, h)` minus rounding for the bevel. Blobs are spheres on analytic orbits, joined by `smin`. Raymarch a box proxy mesh (not fullscreen) so it composites with depth.
  - Shading samples our PMREM env for chrome. `gl_FragDepth` is written so contact shadows and other meshes intersect correctly.
- **Performance** *(est.)*: 64–96 steps at 1080p, about 10–25 ms on an iGPU when the proxy covers ~40% of the frame. Offer `quality: "half"` (render to a half-res target and upscale with FXAA). On SwiftShader expect 100+ ms, so a draft-only fallback is needed. Codrops covers R3F liquid raymarching and metaballs ([Codrops liquid](https://tympanus.net/codrops/?p=78977), [Codrops droplets](https://tympanus.net/codrops/2025/06/09/how-to-create-interactive-droplet-like-metaballs-with-three-js-and-glsl/)). The alternative is three's built-in `MarchingCubes` addon (CPU polygonize at res 48–64, then a normal mesh with any material), which is cheaper on SwiftShader.
- **API:** `"mode": "liquid", "liquid": { "blobs": 8, "merge": 0.12, "settle": 1.8, "wobble": 0.3 }`.

### 3.6 3D kinetic typography

- **Approach:** `text:` sources already produce per-glyph parts, so add per-glyph choreography:
  - `rail` (glyphs travel a `CatmullRomCurve3` LUT and snap into the baseline)
  - `cascade-flip` (each glyph rotates X by 360° with Step delay)
  - `extrude-grow` (depth 0 → full)
  - `stack` (drop + pile)
  - `wave`
  - `split-flap`
  These generalize `partPose(anim, t, rank, …)` with `stagger`, `from: "left|center|random"`.
- **API:** `"animation": "cascade-flip", "stagger": 0.06, "order": "center-out"`.

### 3.7 Orbiting satellites / rings

Torus rings (`thin chrome`, `neon`) tilted at `[a, b]`, with instanced satellites at angle `θ_i = θ0 + ω t + 2πi/n` and optional trails (TubeGeometry with drawRange). API: `"rings": [{ "radius": 1.4, "tilt": [70, 15], "speed": 20, "satellites": 3 }]`. Cost: L.

### 3.8 Product showcase rigs

`rig: "float"` (hover with a soft shadow that scales inversely with height), `"exploded"` (axis-aligned layered with callout anchors), `"pedestal"` (cylinder plinth plus reflective floor via `MeshReflectorMaterial` from drei, M cost) and `"light-sweep"` (§2 #9). Expose `anchors` (projected 2D points per part) to the 2D layer system for callout lines. This pairs well with our device layers.

### 3.9 Infinite loops

`loop: { period: 4 }` forces all periodic generators (turntable, field speeds, orbits) to integer multiples. Turntable step = 360/n for n-fold symmetry. A validator warns if a non-periodic animation is used.

### 3.10 Particle-to-logo formation

As in §2 #1, with `THREE.Points` and a round-sprite fragment (or instanced tiny icosahedrons for chrome particles, ≤30k). Options:
- start distribution: `sphere | galaxy | offscreen-left | text:<other word>`, for particle morphs from word A to word B
- `turbulence`
- `trail` (render 3 ghost copies at t−δ with decaying alpha: cheap fake motion blur)
Codrops covers GPGPU particle techniques ([Codrops GPGPU](https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/)), but **we should not use GPGPU feedback textures**, which are stateful and frame-order dependent. Closed-form per-particle paths are deterministic and seekable.

### 3.11 DOF and bloom (post stack)

See §4. API: `"post": { "bloom": { "strength": 0.6, "threshold": 0.8 }, "dof": { "focus": "object|<0–1>", "aperture": 0.6 }, "grain": 0.04, "ca": 0.0015, "vignette": 0.25 }`.

### 3.12 Isometric diorama

Orthographic camera (`camera: "ortho"`) at 35.264°/45° iso. Low-poly voxel or blocks build up with Step-delayed rise and spring, warm key + cool fill, and a `ShadowMaterial` ground with a real directional-light shadow map. Very on-trend for explainer scenes. Cost: L–M.

### 3.13 Low-poly

`flatShading: true` + `toNonIndexed()` + optional `SimplifyModifier` decimation (three addon) + a pastel palette. Cost: L.

### 3.14 Claymation look

The `clay` material plus a procedural fingerprint normal map, vertex "boil" (noise displacement re-seeded every 2 frames at 12 fps, `seed = floor(t·12)`), stepped animation (quantize `t` to 1/12 s), and soft warm key light. Very cheap and very charming.

### 3.15 Glass and holographic shaders

- **Glass+:** add `dispersion`, `iridescence` and an animated backdrop texture (gradient stripes) so refraction has something to bend. Our current refraction backdrop is static. Note that transmission renders opaque objects into a transmission target, which is one extra pass.
- **Hologram:** a custom ShaderMaterial with fresnel rim, scanlines in world y moving with t, additive blending, slight vertex glitch on a seeded schedule, and bloom.

---

## 4. Feasibility notes

### 4.1 Versions (npm, checked 2026-10-16)

| Package | Version | Peer | Fit with three 0.186.1 / fiber 9.8.1 / drei 10.7.9 |
|---|---|---|---|
| `postprocessing` | 6.39.5 | `three >=0.168 <0.187` | ✅ (pin; the next three bump needs a postprocessing bump) |
| `@react-three/postprocessing` | 3.2.0 | fiber ≥9.7.0, react 19, postprocessing ^6.36 | ✅ (older 3.0.x hit `LuminanceFormat` removal on r176+ ([forum](https://discourse.threejs.org/t/error-in-react-post-processing/83537)), so use 3.2) |
| `n8ao` | 2.0.1 | postprocessing ≥6.30 | ✅ (SSAO alternative) |
| `three-custom-shader-material` | 6.4.0 | three ≥0.159 | ✅ |
| `@dgreenheck/three-pinata` | 2.0.1 | three ≥0.158 | ✅ |
| `@dimforge/rapier3d-deterministic-compat` | 0.21.0 | n/a | ✅ (deterministic build; standard builds don't guarantee it ([README](https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-deterministic@0.19.3/README.md))) |
| `three-mesh-bvh` / `three-bvh-csg` | 0.9.16 / 0.0.18 | three ≥0.179 | ✅ (CSG for cut-outs, "perfect fit" holes) |
| `maath` | 0.10.8 | n/a | ✅ (easing/random helpers; we have our own) |
| three addons already in `node_modules` | n/a | n/a | `MarchingCubes`, `UnrealBloomPass`, `BokehPass`, `GTAOPass`, `SAOPass`, `SSAOPass`, `OutputPass`, `TessellateModifier`, `SimplifyModifier`, `MeshSurfaceSampler` |

### 4.2 Post in headless Chrome (ANGLE / SwiftShader)

- **Deterministic:** bloom (mip-chain blur), DOF (CoC from depth), chromatic aberration, vignette, LUT, tone mapping, SMAA/FXAA, SSAO/GTAO/N8AO, outline and god rays. These are pure functions of the current frame's buffers.
- **Not deterministic or not seekable:** TAA/TRAA, SSR/SSGI with temporal accumulation (`realism-effects`, last published 2023), velocity-buffer motion blur, `AfterimagePass`, and anything using `composer.render(delta)` time. pmndrs `NoiseEffect` grain should be replaced with our own grain seeded from the frame index.
- **Wiring:** `ThreeCanvas` forces `frameloop="never"` and re-renders on advance ([Remotion ThreeCanvas](https://www.remotion.dev/docs/three-canvas)). `@react-three/postprocessing`'s `EffectComposer` takes over the render via `useFrame` priority, so it rides the same `advance()`. Verify there's exactly one composer render per frame.
- **Gotchas:**
  1. **Use HalfFloat buffers.** Use `frameBufferType: HalfFloatType` and keep tone mapping in the composer, not the renderer. Wrong buffers lead to the classic white or black frames ([forum](https://discourse.threejs.org/t/post-processing-bloom-effect-composer-only-creating-white-screen/77008)).
  2. **Alpha.** Our canvases are transparent. Bloom over transparent pixels has no alpha to live in, so glows get clipped or premultiplied wrong. Options: (a) when post is on, render the scene background inside the canvas (the director passes the scene bg color or gradient), or (b) keep using the SVG-filter glow trick (`ThreeView` neon) for glow on transparent layers. Plan for (a) as the default for post-heavy shots.
  3. **MSAA.** Set `antialias:false` on the renderer, then `multisampling: 4` on the composer.
  4. **SwiftShader.** Each fullscreen pass at 1080p is CPU-shaded. Bloom (~10 passes) + DOF can add 100+ ms per frame on Lambda *(est.)*. Ship `post.quality: "draft"` (bloom only at half res) and enable full post only on GPU renders. Remotion recommends `angle` on desktop, `angle-egl` on GPU cloud, and `swangle` without a GPU, and notes **angle memory leaks on long renders**, so split long renders ([Remotion gl options](https://www.remotion.dev/docs/gl-options)).
- **Motion blur:** Remotion's `<CameraMotionBlur>` renders children `samples` times ([docs](https://www.remotion.dev/docs/motion-blur/camera-motion-blur)). With a ThreeCanvas child that means N WebGL contexts, so **don't**. Instead, accumulate inside the canvas: render k sub-frames (t + i·shutter/k) into a float target and average. Cost ×k, so only enable it when angular velocity is above a threshold (whips, fast spins).

### 4.3 Instancing limits

There's no hard instance cap. The limits are vertex throughput and attribute memory. *(est.)*:
- iGPU budget about 2–5M triangles per frame with PBR + env and one light.
- 100k–300k `Points` is fine.
- Use `InstancedMesh` for one geometry and `BatchedMesh` for mixed geometries (e.g., different glyphs), both one draw call ([forum](https://discourse.threejs.org/t/how-to-choose-between-instancedmesh-and-batchedmesh/81221)).
- Instances aren't individually frustum-culled, so set a correct bounding sphere.
- Per-instance color uses `instanceColor`.

### 4.4 WebGL context limits (we hit ~16 per page)

Chrome caps active contexts (commonly 16) and silently drops the oldest. Every `three` layer is a canvas, and Remotion premounting plus transitions mean two scenes can be alive at once. Fixes, in order:

1. **Release contexts on unmount.** Call `gl.dispose()` + `gl.forceContextLoss()` on unmount, which is cheap. Also count live contexts in dev and warn.
2. **Share a renderer across a scene's 3D layers.** Give each scene one `ThreeCanvas`, and render every `three` layer in it via drei `<View>` (scissor regions). Same draw cost, with shared shaders, PMREM and textures ([three.js manual](https://threejs.org/manual/en/multiple-scenes.html), [forum](https://discourse.threejs.org/t/canvases-vs-views/55858)). Caveat: layer z-order relative to 2D layers is lost if one canvas spans the scene.
3. **Alternative: a page-singleton offscreen renderer.** Render each layer into it, then `drawImage` into a per-layer 2D canvas. This keeps arbitrary DOM z-order and layer transforms at the cost of one readback/copy per layer per frame (~1–3 ms at 1080p *(est.)*). **Recommended**, because it preserves our layer model, and one context per tab also avoids the leaky-angle multiplication.

### 4.5 Precomputing physics deterministically

- **Rule:** a sim is a function `bake(specSubset, seed) → Float32Array frames`. Use a fixed dt (1/120 or 1/240 s) and substep to the composition fps. Never use `Math.random`, `performance.now` or `Date`.
- **Arithmetic:** stick to IEEE-exact ops (+ − × ÷ sqrt). Rapier warns that transcendental functions can differ across platforms ([rapier determinism](https://rapier.rs/docs/user_guides/javascript/determinism)), so precompute any sin/cos initial values from tables or as exact constants.
- **Caching:**
  - Module-level `Map<hash, Float32Array>` per tab. Remotion renders frames concurrently in several tabs, and each tab bakes once inside `delayRender`.
  - For bakes over ~1 s, add a pre-render step in `src/core/render.ts` that bakes in Chrome once and writes `projects/<id>/bake/<hash>.bin`. Tabs then fetch it via `useJsonAssets`-style loading.
  - Hash the canonical JSON of the sim-relevant fields plus the engine version.
- **Analytic first:** bounces (closed-form parabola chain with restitution e: the k-th bounce peak is `h·e^(2k)`), springs (we have `spring()`), dominoes (staggered tip times), pendulums and orbits need no bake.

---

## 5. Prioritized roadmap (top 12)

Effort is in engineer-days for someone who knows the codebase, *(est.)*. Impact is how much it changes what the director can make.

| # | Item | Impact | Effort | Notes |
|---|---|---|---|---|
| 1 | **Context hygiene + shared offscreen renderer** (§4.4) | Unblocks everything (multiple 3D layers, transitions) | 3–4 d | dispose/forceContextLoss now (0.5 d), singleton renderer + blit next |
| 2 | **Cloner + fields engine** (§3.1): grid/hex/surface/volume layouts, linear/spherical/noise fields, per-clone spring, logo mask | Huge: the MoGraph look, ~12 wow moments (#12, 13, 30, 31, 36, 43, 44, 45) | 5–7 d | InstancedMesh + onBeforeCompile; director presets `wave`, `sweep-flip`, `scatter-assemble`, `ripple` |
| 3 | **Particle-to-logo formation** (§3.10) incl. word→word morph | Huge, viral-proven | 2–3 d | Shares the sampler with #2 |
| 4 | **Post stack v1**: bloom, DOF (focus on object), vignette, seeded grain, CA; scene background inside canvas when on; draft/final quality | High: instantly "Octane-ish" | 3–4 d | postprocessing 6.39.5 + @react-three/postprocessing 3.2.0; test on angle + swangle |
| 5 | **Camera language**: dolly zoom, rack focus keys, god-shot, macro start, spline camera paths, handheld micro-shake (seeded) | High, cheap | 2 d | All in `cameraAt()`; DOF from #4 |
| 6 | **Kinetic 3D type set** (§3.6): cascade-flip, rail, extrude-grow, drop-pile (analytic bounce), split-flap, wave; `stagger`/`order` | High for text-heavy videos | 3 d | Generalize `partPose` |
| 7 | **Tessellation + deformer stack**: squash/jiggle, twist, bend, taper, wave, inflate | High (tactile, playful) | 4 d | `steps>1`, TessellateModifier, shader normals |
| 8 | **Shatter → reassemble** (three-pinata, analytic flight) | High logo-sting value | 3 d | Rapier pile later |
| 9 | **Material pack v2**: glass+dispersion, iridescent/holo foil, car-paint flakes, velvet/sheen, hologram shader, claymation boil; light-sweep env rotation | Medium-high | 3 d | Mostly MeshPhysicalMaterial flags |
| 10 | **Product rigs + loops**: float/pedestal/reflector floor, exploded with projected anchors for 2D callouts, `loop.period` validator, rings/satellites | Medium-high for SaaS/product | 4 d | Anchor projection API to 2D layers is the novel bit |
| 11 | **Bake infrastructure + cloth reveal + Rapier piles** | High wow, higher risk | 6–8 d | Bake hashing/cache/asset; Verlet cloth first, Rapier second |
| 12 | **Liquid/metaball SDF logo** (+ sphere→logo morph, chrome melt) | Very high wow, highest cost | 5–7 d | 2D EDT → texture, box-proxy raymarch, half-res option; MarchingCubes fallback for swangle |

**Suggested sequencing:** 1 → 2 → 3 → 4 → 5 (about 3 weeks) gives the director cloner logos, particle formations, cinematic post and camera moves. Then 6–8 for tactile and type, and 9–12 as "premium" features. Every feature should ship with (a) director-facing presets in DIRECTOR_GUIDE, (b) a `preview_frames` mid-motion test (per 01-motion-craft §0.7), and (c) a determinism test that renders frame N twice, out of order, and diffs.

### Director heuristics to add

- Open with **density or mystery** (swarm, cloth, darkness), resolve to the **clean mark** by 40–60% of the shot, then hold with micro-life (holdDrift).
- One **"how did they do that"** per video, max. More becomes noise.
- Sync the lock or impact frame to the strongest audio transient ±1 frame.
- Prefer **continuity** (2D logo → extrude → 3D) over a cut whenever the 2D and 3D layers share a shot.
- Loops: pick symmetric logos and n-fold turntables, and make the last frame equal the first.
