# Motion Kit — Spec Reference

```jsonc
{
  "title": "…", "format": "16:9" | "9:16" | "1:1" | "4:5" | "21:9", "fps": 30,
  "style": "apple" | "neon" | "editorial" | "brutal" | "luxury" | "pastel-pop" | "cinematic" | "minimal-dark" | "y2k-chrome",
  "theme": { "fonts": { "display": "Inter", "body": "Inter", "mono": "JetBrains Mono" },
             "colors": { "bg": "#…", "fg": "#…", "accent": "#…", "accent2": "#…", "muted": "#…", "card": "#…" } },
  "audio": { "src": "assets/track.mp3", "volume": 0.8, "trimStart": 0, "fadeIn": 0.5, "fadeOut": 1 },
  "sfx": [{ "src": "assets/whoosh.mp3", "at": 2.4 }],
  "fx": { "grain": 0.1, "vignette": 0.4, "chromatic": 2, "lightLeak": 0.3, "letterbox": 0.1, "scanlines": 0.2,
          "flashes": [{ "at": 3.0, "color": "#fff" }] },
  "concept": { "truth": "…", "metaphor": "…", "motif": "…", "verb": "…", "hook": "…", "arc": ["…"], "colorScript": ["…"] },
  "bpm": 120, "beatOffset": 0.0, "beats": [0.48, 0.98, …],     // enables "beat:N" / "bar:N" / "beats:N" time strings
  "actors": [ Actor, … ],                                        // persistent elements above all scenes
  "formats": ["16:9", "1:1"],                                    // extra formats to adapt to (master = "format"); see reflow
  "sound": { "palette": "cinematic", "intensity": 0.6 },         // auto sound design (see Sound)
  "scenes": [ Scene, … ]
}
```

**Beat times.** Anywhere a time in seconds is expected you may write `"beat:N"` (global beat, 0-based, fractional ok) or
`"bar:N"` (= beat 4N). The engine converts them to the right local time. Scene `duration` may be `"beats:8"` (8 beats long).
`"beat:N@apex"` on `enter.delay`/`start`/`at` shifts the move so it *lands* on the beat.

**Actor** (shared element, survives cuts):
```jsonc
{ "id": "bean", "from": "hook", "until": "lockup",
  "layer": { "type": "morph", "width": 220, "height": 220, "shapes": [ { "at": 0, "shape": "bean" }, { "at": 6.2, "shape": "cup" } ] },
  "poses": [ { "scene": "hook", "t": 0, "x": 0, "y": -200, "scale": 1 },
             { "scene": "pile", "t": 0.5, "x": -300, "y": 120, "scale": 0.6, "ease": "expoOut" },
             { "scene": "lockup", "t": 0, "x": -260, "y": 0, "scale": 1.2 } ] }
```
Times inside `layer` are relative to the start of the `from` scene. Each pose's `move` (default 1.0s) is how long the move INTO it
takes, ending at its `t`; before that the actor holds the previous pose (hold → decisive move). Use a large `move` to glide the whole gap.

**Handing an actor off to the logo (seamless payoff): `snapTo`.** Give the lockup logo layer an `id`, and end the actor on a pose
`{ "scene": "lockup", "t": 0.9, "snapTo": "<logoLayerId>#icon", "move": 0.9 }`. The engine computes x/y/scale so the actor lands
pixel-exactly on that part slot (`#icon`, `#wordmark`, `#<partId>`; omit `#…` to use whatever logo subset the actor's morph is showing),
then keeps following it through the scene's camera moves (`follow: false` to stop). Typical lockup:
```jsonc
// actor's last morph shape: { "at": 5.7, "shape": "svg:assets/logo.svg#icon" }   (no fill → keeps brand colors)
{ "id": "lockup-logo", "type": "logo", "src": "assets/logo.svg", "parts": "wordmark", "frame": "full", "mode": "cascade", "height": 200, "y": -120 }
```
`frame: "full"` lays a partial logo layer out as the whole logo, so you position the complete lockup once and the icon slot is where the actor snaps.

Colors: any CSS color or a theme token `$bg $fg $accent $accent2 $accent3 $muted $card`.
Fonts: `$display`, `$body`, `$mono`, or one of: Anton, Archivo Black, Bebas Neue, Bricolage Grotesque, Bungee,
Caveat, DM Sans, DM Serif Display, Fraunces, Geist, Instrument Sans, Instrument Serif, Inter, JetBrains Mono,
Lora, Manrope, Monoton, Montserrat, Orbitron, Oswald, Outfit, Permanent Marker, Playfair Display, Poppins,
Press Start 2P, Righteous, Sora, Space Grotesk, Syne, Unbounded.

## Scene

```jsonc
{ "id": "hook", "duration": 2.5,
  "transition": { "type": "whip", "direction": "left", "duration": 0.5, "ease": "inOutQuint" },   // INTO this scene
  "background": Background | [Background, …],
  "camera": { "keyframes": [{ "t": 0, "zoom": 1, "x": 0, "y": 0, "rotate": 0, "rotateX": 0, "rotateY": 0 },
                            { "t": 2.5, "zoom": 1.1, "ease": "inOut" }],
              "punch": [0.5, 1.0],                       // zoom hits (use on beats)
              "shake": { "amount": 6, "speed": 3, "start": 0, "duration": 0.6 } },
  "motionBlur": true,                                    // whole-scene motion blur (expensive)
  "fx": { … per-scene fx … },
  "layers": [ Layer, … ] }
```

**Content-aware transitions (preferred when an object exists):**
`expand` (`from: "<layerId in previous scene>"` or `x/y`, `shape: circle|rounded|rect`, optional `color` = solid that expands first, the color script),
`zoom-into` (log-space fly-through into `from`'s position; the next scene appears in a growing window),
`slice` (`slices`, `direction`), and `match` (a hard graphic-match cut with 0 duration; align positions and sizes across the cut).

**Transitions:** `cut` `fade` `slide` `wipe` `flip` `clock-wipe` `iris` `book-flip` `blur-slide` `push-cut` `swap`
(CSS) · `zoom-blur` `dreamy-zoom` `film-burn` `linear-blur` `zoom-in-out` `dissolve` `ripple` `crosswarp`
`cross-zoom` (WebGL) · `whip` `zoom-through` `flash` (+`color`) `glitch` (custom). `direction` applies to slide/wipe/flip/book-flip/blur-slide/whip.

**Backgrounds:**
- `{ "type": "solid", "color": "$bg" }`
- `{ "type": "gradient", "colors": [...], "angle": 135, "spin": 10, "radial": false }`
- `{ "type": "mesh", "colors": [3-5 colors], "base": "#fff", "speed": 1 }`: premium drifting mesh gradient
- `{ "type": "shader", "shader": ShaderName, "colors": [...], "speed": 0.5, "intensity": 1 }`
- `{ "type": "grid", "color": "…", "base": "…", "size": 80, "perspective": true, "speed": 1 }`: retro floor when perspective
- `{ "type": "media", "src": "assets/x.jpg", "blur": 20, "dim": 0.4, "kenBurns": true }`
- `{ "type": "spotlight", "base": "…", "color": "…", "x": 0, "y": -100, "size": 1 }`

**Shaders:** aurora, liquid, plasma, silk, warp (hyperspace), tunnel, waves, dots (halftone), rays, noise, grid-floor, blobs.

**Eases:** linear in out inOut outBack inBack inOutBack outExpo inExpo inOutExpo outQuint inOutQuint outCirc outElastic outBounce spring snappy bouncy smooth,
plus pro curves: `expoOut` (0.19,1,0.22,1) · `quintOut` · `snap` (0.15,0,0.1,1) · `m3Enter` · `m3Exit` · `carbonExpressive`.

## Common layer fields (every layer)

`id, start, duration` (s, relative to scene) · `x, y` (px from center) `z` · `width, height` · `scale, rotate, rotateX, rotateY, opacity, blur` ·
`origin` · `zIndex` (default = order) · `depth` (camera parallax, default 1) · `blendMode` · `shadow: true | "premium" | css` ·
`enter`/`exit`: `{ "type": preset, "duration": 0.6, "delay": 0, "ease": "outExpo", "distance": 300 }` ·
`animate`: keyframes `[{ "t": 0, "x": 0, "scale": 1, "rotateY": -20, "opacity": 1, "blur": 0, "ease": "inOutQuint" }, …]` ·
`loop`: `{ "type": "float|pulse|wiggle|spin|sway|breathe|bob|shake|orbit", "amplitude": 12, "speed": 0.5 }` ·
`motionBlur: true | {samples, shutter}` · `css` (raw CSS for the layer wrapper) ·
`sound: "sfx:<name>" | false` (this layer's sound) · `adapt: { "9:16": { "y": 300, "fontSize": 140 } }` (per-format overrides, applied last).

**Motion craft (v2, on every layer):**
- `inertia: true | {amplitude, frequency, decay}`: velocity-aware overshoot when the enter or keyframes land. Fast moves wobble more.
- `anticipate: 0.1`: counter-move before the enter or a big keyframe move.
- `velocityFx: true | {blur, stretch}`: directional motion blur is ON by default above a speed threshold. `stretch` adds squash and stretch along velocity.
- `path: { points: [[x,y], …], start, duration, ease, orient }`: travel on a smooth arc through points (use for any move > 300px).
- `parent: "<id>"`, `lag: 0.08`: follow-through. This layer inherits the parent's animated offset, delayed.
- `repeat: { count, delay, x, y, scale, rotate, opacity }`: echoes, trails, tunnels, bursts.
- `stepRate: 12`: animate on twos (handmade feel).

**Enter/exit presets:** none fade rise drop slide-left slide-right slide-up slide-down zoom-in zoom-out blur-in pop flip-up flip-side swing spin-in
whip-left whip-right whip-up whip-down (directional blur) clip-up clip-down clip-left clip-right iris stretch fly-in-3d drop-bounce,
and premium no-fade reveals: **reveal-up reveal-down reveal-left reveal-right grow unfold-x unfold-y drop-in-3d** (use these for hero elements).

## Layer types

**text**: `text` (\n for lines), `preset`: blur-rise mask-up pop flip typewriter scramble wave stretch tracking slide-words
zoom-from-camera gradient-sweep drop-in skew-in glitch split-reveal none, **slot** (needs `swap: {words, every}`; the last word rolls through alternatives),
**slice** (bands lock together), **echo** (DIA stacked repeats, `echoCount`), **physics** (per-glyph drop and bounce), **cascade-3d**, **weight-wave** ·
`fill: "assets/x.jpg|mp4"` (footage seen through the letters) · `by`: char|word|line · `stagger`, `unitDuration` ·
`fontSize` (default 120), `font`, `weight`, `italic`, `color`, `gradient: [..]`, `letterSpacing` (em), `lineHeight`, `align`, `maxWidth`,
`uppercase`, `stroke: {color,width}`, `glow`, `highlight: { words: [..], color, style: color|marker|underline|box, at }`,
`exitPreset`: fade blur-out rise-out drop-out scatter mask-down, `exitAt`.

**media**: `src`, `kind` image|video, `fit`, `width`, `height`, `radius`, `border`, `mask`: circle|rounded|blob|arch|diamond,
`reveal`: wipe-left|wipe-right|wipe-up|wipe-down|circle|split, `revealDuration`, `kenBurns: {from:1, to:1.15, x, y}`, `filter` (CSS),
video: `volume`, `muted`, `trimStart`, `playbackRate`, `loopVideo`.

**device**: `model` iphone|android|tablet|browser, `frameColor` black|titanium|silver|deep-red|blue|gold|purple|green|css, `height` (phone ~800 at 1080p),
`screens: [{ src?, background?, at?, scroll?: {to: 0..1, start, duration, ease}, layers?: [Layer…] (UI built inside the screen, coords from screen center), transition?: fade|slide|push|zoom }]`,
`island: { activity: faceid|faceid-success|pay|music|timer, at, duration }`, `statusBar`, `glare`, `thickness`, `url` (browser).
Screen sizes: iPhone at height 800 ≈ 390×800 → inner screen ≈ 363×773.

**card**: `variant` notification|notification-dark|glass|solid|pill|toast|chat-left|chat-right|stat|quote|button|search,
`icon` (asset/emoji), `title`, `body`, `meta`, `accent`, `background`, `color`, `fontSize`, `font`, `width`, `press` (s, buttons).

**counter**: `from`, `to`, `countDuration`, `countDelay`, `decimals`, `prefix`, `suffix`, `locale` (en-IN → lakh grouping), `ease`, `fontSize`, `font`, `weight`, `color`, `gradient`.

**shape**: `shape` rect|circle|ring|line|blob|star|polygon|triangle, `color`, `gradient`, `radius`, `stroke`, `strokeWidth`, `sides`, `glow`, `draw` (animate outline), `drawDuration`.

**path**: `preset` swoosh|arc|wave|loop|zigzag|spiral|underline|circle-scribble|s-curve or `d` (SVG path in a 1000×1000 box), `width/height` (box it is scaled to; default canvas),
`color`, `gradient`, `strokeWidth`, `drawStart`, `drawDuration`, `ease`, `trail` (0..1 comet), `glow`, `dashed`, `follower: { emoji|src|text, size, rotate, rotateOffset }`.

**particles**: `preset` confetti|sparkles|dust|bokeh|snow|embers|burst|stars|rain|bubbles|warp, `count`, `colors`, `seed`, `size`, `speed`, `originX/originY`.

**cloud**: `items: [{src|emoji|text, background}]`, `arrangement` scatter|orbit|grid|marquee|burst|arc, `itemSize`, `tile`, `radius`, `avoidCenter: {width,height}`, `stagger`, `seed`, `columns`, `speed`.

**captions**: `words: [{text,start,end}]` or `text`, `wordsPerPage`, `style` karaoke|pop|box|bounce|clean, `fontSize`, `font`, `color`, `highlightColor`, `uppercase`.

**shader**: `shader`, `colors`, `speed`, `intensity` (layer version of the shader background; sized by width/height).

**lottie**: `src` (assets/x.json), `speed`, `loopAnim`.

**morph**: `shapes: [{ at, shape, fill?, stroke?, strokeWidth?, morph: 0.7, ease?, twist?, scale? }]`, plus `fill`, `gradient`, `stroke`, `strokeWidth`,
`draw` (first shape strokes on, then fills), `goo` (0..1 liquid merge), `font`/`weight` (for `text:` shapes), `width`/`height` (box, default 400).
**Shape sources:** library objects: circle square rounded-square pill triangle star heart hexagon ring drop leaf bean pin bubble bolt arrow cloud
shield check plus sparkle flame house cup globe lock bag card coin phone play music eye sun moon wave spiral ·
`path:<d>` (1000×1000 box) · `svg:assets/logo.svg` (all parts) `#icon` `#wordmark` `#<partId>` · `text:Word` (glyph outlines).

**logo**: `src: "assets/logo.svg"`, `mode`: draw | build | assemble | morph-from (`from: <shape source>`) | mask | cascade | glitch | liquid |
window (`windowSrc`) | split | trace | pop · `order`: leftToRight topToBottom reading bySizeDesc radialOut angular document byColor ·
`revealDuration` (default 1.4) · `stagger` · `parts`: all|icon|wordmark · `color` (override fill) · `strokeColor` · `exitMode`: explode|collapse|draw-out|fade ·
`height` (default 300), `frame: "full"|"parts"` (lay out as the whole logo even when showing a subset, for actor snapTo). The final frame is pixel-exact brand art. Run `analyze_logo` to get suggested modes for a given logo.

**group**: `layers: [...]`, `perspective`: transform several layers together (e.g. a 3D-tilted cluster).

**custom**: `component` (name from write_custom_component), `props`.

## Minimal example

```json
{ "format": "9:16", "style": "neon", "scenes": [
  { "duration": 2, "background": { "type": "shader", "shader": "warp" }, "camera": { "punch": [0.4] },
    "layers": [ { "type": "text", "text": "DROP\nDAY", "preset": "stretch", "fontSize": 260, "glow": true } ] },
  { "duration": 2.5, "transition": { "type": "glitch", "duration": 0.4 },
    "layers": [ { "type": "media", "src": "assets/shoe.png", "fit": "contain", "width": 800, "height": 800, "enter": { "type": "zoom-out" }, "loop": { "type": "float" } } ] } ] }
```

## Sound

### spec.sound — intent-driven auto sound design (v2)
`"sound": { "brief": { "voice": "precise", "materials": ["glass", "metal-thin"], "space": "plate" }, "restraint": 0.5, "variation": 0.5, "signature": "auto", "volume": 0.8 }`
- Setting `sound` turns it on; `auto: false` keeps only manual `sfx`. Everything is optional: missing brief fields are inferred from `palette`, style, concept and the layers on screen.
- `brief` (the film's sonic identity — one per film, keep it consistent):
  - `voice`: precise | warm | playful | epic | luxury | raw | calm → brightness, envelope, the timbre of tonal sounds and the sonic logo. Legacy `palette` maps onto it (cinematic→epic, tech→precise, minimal→calm, hype→raw).
  - `realism`: `hyper-real` (recorded material foley: devices, cards, product, 3D objects) | `abstract` (synthetic / tonal: shapes, data, light) | `mixed`.
  - `materials`: 1–2 primary + 1 accent from glass, metal-thin, metal, paper, cardboard, wood, ceramic, plastic, cloth, leather, liquid, digital, air, stone, body, coins. Every body / landing / transition is drawn from them.
  - `space`: dry | room | plate | hall — ONE shared reverb for the whole film.
  - `avoid`: "not this" list — categories (`digital`, `whoosh.long`), materials, names or tags (`gamey`, `cartoon`).
  - `key`: e.g. `"F# minor"`. Default: the music's key (`sound.music.key`, filled from analyze_audio at render), else a stable per-brand key.
- `restraint` 0..1 (default 0.5): how much stays silent — per-scene density budget, length of the silence + music stopdown before each hero (0.35–0.8 s), aftershock after it.
- `variation` 0..1 (default 0.5): pitch / gain jitter and round-robin spread (no file ever repeats back to back).
- `signature`: sonic logo on the final logo resolve — `"auto"` (a 3–4-note mnemonic in key, same for every film of the brand), `"sfx:<name>"` / `"assets/x.wav"`, or `false` (plain hit).
- `stereo` (default true): pan by on-screen x, sweeps on lateral moves, subs centred, subtler on 9:16. `intensity` scales the density budget. `volume` = SFX master (0.8). `duck` = music dips under hits + pre-hero stopdowns (true).
- `music`: `{ key, keyConfidence, bpm, beats, onsets }` from analyze_audio. Renders fill it automatically when `audio` is set; set `key` (or `brief.key`) yourself so the Player preview matches.

### How the planner decides (so you can steer it)
1. Events: transitions, text slams, camera punches/shakes/moves, counters, morph steps, logo reveals, cards, particles, entrances, actor moves. Ambient motion is never sounded.
2. Importance: **hero** (the final logo resolve + at most one big slam/flash ≥ 2.5 s away) > **structural** (transitions, punches, slams) > **supporting** (entrances, pops, notifications) > **micro** (ticks, keys).
3. Restraint first: one gesture = one sound (cascades collapse), silence + music stopdown before each hero, nothing on its aftershock, onsets the music already hits are thinned, density budget per scene by energy, soft consecutive transitions alternate with silence.
4. Picture is master: a sound slides onto a beat only within −1/+2 frames; on-beat events win the budget.
5. Layers by importance: micro = 1 light layer; supporting = transient + body (or one fitted whoosh); structural = + air / material whoosh / tuned sub (sub only when the scene is hot); hero = transient + material body + tuned sub + tail + reverse swell into it (logo: mnemonic + brand-material body + sub + air).
6. Every cue is baked into ONE file (layers pitched by varispeed, panned, through the shared space) whose apex lands on the event frame.

### Overrides
- `layer.sound`: `"sfx:<name>"` or `"assets/x.wav"` replaces that layer's sound on its main moment (played whole, apex on the event). `false` silences the layer, including a group's children.
- `transition.sound`: the same, on the transition apex. `false` makes a silent transition.

### spec.sfx — manual cues
`{ "src": "sfx:glass-tap-2", "at": 4.996, "volume": 0.9, "rate": 1.1 }`
- `at` is when the FILE starts. To land a sound's apex on an event at time E, use `at = E − peakAt` (the manifest lists `peakAt` per sound).
- `rate` is speed: a time-stretch that keeps pitch (planned cues pitch for real; manual cues don't).

### spec.audio — music
`{ "src": "assets/music.mp3", "volume": 0.8, "trimStart": 0, "fadeIn": 0.5, "fadeOut": 1 }`. Music ducks under hits and stops down before heroes; renders are mastered to −14 LUFS (true peak ≤ −1 dBTP). analyze_audio returns bpm, beats, onsets, energyCurve, dropAt and **key / keyConfidence**.

### Library (`sfx:<name>`): 289 recorded CC0 sounds + 36 synthesized
Recorded (library/sfx/recorded, 48 kHz, −16 LUFS, provenance in library/LICENSES.json), by category — 3–6 round-robin variants per family (`<family>-1…n`):
- `impact.light` — glass-tap, glass-clink, glass-ting, metal-tick, wood-tap, wood-block, wood-snap, ceramic-tap, soft-thud, tap-generic, card-place, book-place, chip-lay, stone-tick, soft-thump, hand-drum, leather
- `impact.medium` — glass-knock, metal-knock, metal-clang, clank, wood-knock, wood-hit, ceramic-knock, punch, thud, glass-shatter
- `impact.heavy` — glass-thud, metal-hit, metal-slam, bell-strike, wood-thud, ceramic-hit, soft-boom, punch-heavy, scifi-metal, crunch, gong · `sub.boom` — sub-boom
- `whoosh.*` — micro: swish, blade-swipe, card-shove, page-flick, zip-up/-down, air-puff, zipper · paper: page-flip, page-turn, paper-slide · cloth: cloth-swish, cloth-flap · medium/long: air-swell, air-pass · in/out: air-suck, air-hiss · burst: air-release
- `ui.*` — click, ui-click, ui-tap, ui-snap, ui-knock, ui-tick, ui-select, chip-click, toggle, finger-snap, glass-ping, bell-small, confirm, error, bloop, pluck · `mech.*` — switch-snap, ui-switch, wall-switch, latch, lock-click, key-turn, lock-open, toaster-click
- `foley.*` — paper: card-slide, card-fan, paper-rustle, crumple · desk-tick · plastic-crinkle · keys-jingle · shutter · key (typing) · coins: coin, coin-clink, coin-drop
- `liquid.*` — bubble, bubble-pop, goo, plop, slime, splash · `magic.chime` — chime, ding-bell · `digital.*` — glitch, blip, power-up, zap (gamey: kept out of luxury / calm / epic / warm films)
Synthesized (wholly ours, always available): whoosh-short/long/air/deep, swoosh-up/down, impact-deep/punch/soft, thud-soft, hit-slam, boom-sub, drop-bass, riser-short/long, reverse-swell, click-ui, tap-soft, pop-bubble, pop-snap, notification-ping, tick-mech, tick-digital, ding-success, chime-bright, glitch-crackle/stutter, data-burst, shimmer, sparkle-up, morph-wobble, slide-paper, typewriter-key, camera-shutter, heartbeat-low, cash-register.
Plus tunable synth LAYERS the planner generates in key on demand: sub, boom, air (fitted to the move), riser, reverse swell, shimmer, ping (glass / bell / soft / marimba / metal), blip.

## 3D (`type: "three"`)

`{ "type": "three", "source": "svg:assets/logo.svg#icon", "material": "chrome", "lighting": "studio", "animation": "spin-in", "orbit": [...], "depth": 0.18, "bevel": 0.02, "width": 1000, "height": 700 }`

Three modes share the same source, materials, lighting, camera and post:
- `mode: "object"` (default): the extruded logo / word / shape.
- `mode: "cloner"`: MoGraph-style clones (thousands, one draw call) laid out on or around the logo and driven by fields.
- `mode: "particles"`: particles that converge onto the logo silhouette.

**source**
- `"svg:assets/logo.svg"`, or `#icon`, `#wordmark` or `#N` for part of a logo. Every part keeps its brand color and becomes its own mesh.
- `"text:Word"` for glyph outlines, using `font`/`weight` (default `$display`/700). Each glyph is a part, which kinetic type animates.
- Any library shape name.
- `"primitive:sphere|box|torus|capsule|cylinder|knot"`.

**material** (default `chrome`; cloner default `plastic`): chrome · glass · clay · matte · gold · plastic · neon · brushed · pearl.
- Color precedence: `color` → logo part fills → the material's natural color → `$accent`.
- `gold` is always gold. Chrome and brushed tint toward the brand inks. Neon brightens dark inks and adds a glow.

**lighting** (default `studio`): studio · softbox (high-key, for light backgrounds) · sunset · neon · rim · dramatic. Rim and dramatic keep faces dark and light the edges, so use them for silhouettes and reveals.

**animation** (object mode, timed from the layer's start):
- Whole object: `turntable` (30°/s) · `spin-in` (edge-on to front over 2 s) · `flip-in` (1.4 s) · `float` · `assemble` (parts fly in, lock at about 1.5 s) · `explode` · `rise` (camera tilts up) · `none`.
- 3D kinetic type, per glyph or part, with `stagger` (s) and `order` (`left` · `right` · `center-out` · `edges-in` · `random`):
  - `rail`: the word drives in along a track from deep right, round a 90° bend, and pulls into place (about 2.2 s).
  - `extrude-grow`: flat 2D glyphs grow their depth with a springy settle, front face fixed. This gives continuity from a flat 2D logo.
  - `cascade-flip`: each glyph pops in with a full 360° flip.
  - `stack-echo`: retro stacked copies behind the word that breathe. `echo: { count: 6, gap: 1, color }`, where color is what the deepest copy fades to.
  - `orbit-ring`: glyphs spin on a ring, then unroll into the word (about 3 s).
  - `drop`: glyphs fall and bounce with a squash.
  - `wave`: a travelling wave that loops.

**orbit:** `[{ t, yaw?, pitch?, distance?, ease? }]` in degrees, with distance as a multiplier. The default camera is yaw −14, pitch 7, distance 1, a three-quarter product angle. The subject is auto-framed to fill about 66% of the canvas.

**camera** (on top of orbit): `{ move, at?, duration?, amount?, path?, fov?, shake?, roll?, target? }`
- `dolly-zoom` (vertigo): distance × (1 + amount) while the fov keeps the subject the same size. Use a negative amount to push in and widen.
- `god-shot`: top-down, then descends to the orbit pitch while rolling out. Use it with `cloner.plane: "floor"` or flat layouts.
- `macro-push` / `macro-pull`: hero ↔ extreme close-up on a detail. The cloner targets the most central clone. amount 1.25 is inside a single clone; pair it with `post.dof`.
- `whip-pan` / `whip-out`: a fast pan onto or off the subject, default 40° over 0.5 s. Sub-frame motion blur turns on automatically.
- `push-in` · `pull-out` · `crane-up` · `orbit` (360° × amount).
- `path`: a spline camera, `[{ t, pos: [x,y,z], target?, fov?, ease? }]`. pos is in fit units (`[0,0,1]` is the default framing distance straight on) and target is in model units.
- `shake`: 0..1 seeded handheld micro-shake.

**cloner** (`mode: "cloner"`): `cloner: { preset?, layout?, mask?, density?, count?, shape?, size?, depth?, pad?, plane?, seed?, colors? }`
- Presets:
  - `sweep` (default): a field sweeps the logo in from the left, each clone springing in.
  - `tile-flip`: a board of tiles flips, wave by wave, to reveal the logo.
  - `split-flap`: tiles flip through a palette and land on the logo.
  - `cube-shuffle`: scrambled cubes walk home in grid-aligned hops.
  - `burst-collapse`: clones explode from the center, then implode onto the logo.
  - `ripple`: a pin-board ripple, then the logo lifts out.
  - `wave-field`: a floor of pillars ripples, then the logo rises.
  - `logo-of-logos`: the logo is made of tiny logos. Pair it with `camera.move: "macro-pull"`.
- `layout`: `grid` · `grid3d` (with `layers`) · `honeycomb` · `radial` (`count`, `radius`, `rings`) · `linear` · `surface` (`count` even points inside the logo) · `outline` · `volume`.
- `mask`: `logo` keeps only the cells inside the silhouette. `none` fills the rectangle around it, with `pad` cells of margin.
- `density`: cells across the shape height, default 28 (14–20 for tiles and cubes). Clones are capped at 40k.
- `shape`: box · rounded-box · sphere · cylinder · tile · logo. `size` is a fraction of the cell. `depth` is clone depth as a fraction of the cell.
- `plane: "floor"` lays the layout on the ground, so z effects become height.
- `colors`:
  - `inside`: logo cells. The default is the logo's own colors.
  - `outside`: cells outside the logo.
  - `base`: the color before a reveal.
  - `palette`: the colors split-flap cycles through.

**fields** (cloner effectors; they replace the preset's own): `[{ kind, …timing, effect, spring? }]`
- kind:
  - `linear`: a sweep along `axis` (`x`, `-y`, etc., or an angle in degrees), with `width` as a fraction of the layout.
  - `spherical`: a radius that grows from `center`.
  - `radial`: a clock wipe.
  - `time`: an eased 0→1, optionally with a per-clone `stagger`.
  - `step`: a 0→1 ramp by index.
  - `random`: per-clone values, animated if you set `speed`.
  - `noise`: seeded 3D noise, with `scale` and `speed`.
  - `wave`: a ripple, with `freq` and `speed`, from the center or along `axis`.
  - `beat`: pulses at `beats: [s…]`, rippling outward by `spread`.
  - `mask`: 1 inside the logo.
- Shared options: `start`, `end`, `ease`, `strength`, `invert`, `pulse` (w → sin πw, a bump while the field passes) and `spring` (seconds of per-clone follow-through, the C4D Delay effector, settling exactly).
- effect:
  - `x`, `y`, `z`, `rotateX`, `rotateY`, `rotateZ`, `scale`, `scaleX`, `scaleY`, `scaleZ`: a number is applied × weight. `[from, to]` is lerped by weight, and scale ranges are absolute factors. Positions are in model units, where the logo height is 1.
  - `color`: `"reveal"` switches base→final at 0.5, which suits tile flips. `"blend"` lerps between them. Any CSS color tints toward that color.
- Example: `{ "kind": "linear", "axis": 20, "start": 0.3, "end": 2.2, "width": 0.2, "spring": 0.8, "effect": { "rotateY": [0, 180], "color": "reveal" } }`.

**particles** (`mode: "particles"`): `particles: { from, count, start, duration, spread, size, turbulence, trail, blending, disperseAt, disperseDuration, solidAt, colors, intensity, seed }`
- `from`: `chaos` · `explosion` · `vortex` · `galaxy` · `rain` · `stream`. Particles converge onto even samples of the logo between `start` and `start + duration` (defaults 0.3 and 2.2), with a per-particle delay `spread`.
- `count`: default 24k, up to 200k.
- `trail`: 0–4 ghost passes.
- `disperseAt`: blows the logo away left→right.
- `solidAt`: crossfades into the solid extruded logo in `material`.
- `blending`: `additive` (default) glows, and dark inks are lifted so they still read. `normal` is for light backgrounds.
- Every path is closed-form in the shader, so particles are seekable and identical in any frame order.

**post** (frame-local only): `post: { bloom, dof, ca, vignette, grain, motionBlur, quality }`
- `bloom`: a number (strength), or `{ strength 0.6, threshold 0.8, radius 0.7 }`. 0.3–0.6 is tasteful; 1 is neon.
- `dof`: `{ aperture 0.6, maxBlur 0.02, focus }`.
  - `focus` is the world z of the focus plane relative to the subject: 0 is the subject and + is toward the camera.
  - Keyframes `[{ t, z }]` give a rack focus. Aperture 1.5–2 reads as macro.
- `ca`: chromatic aberration, 0.002–0.008. `vignette`: 0.2–0.45. `grain`: 0.02–0.05, seeded by frame.
- `motionBlur`: `true` or `{ samples, shutter, threshold }`. Defaults: samples is a max of 17 (7 in draft), shutter is 0.5 frames (1.0 for whips) and threshold is 1.2. It averages sub-frames inside the canvas, and only on frames that move faster than the threshold (in degrees per frame). The sub-frame count adapts to the speed.
- `quality`: `auto` (draft on software GL / Lambda) · `draft` (no MSAA, shorter bloom chain, coarser DOF, low-poly clones) · `final`.
- With post, set a solid `background` so bloom and DOF see it inside the canvas. On a transparent canvas, the glow is added over whatever lies behind.

**deform** (object mode, up to 4; the geometry is tessellated automatically): `[{ type, amount?, keys?: [{ t, amount, ease? }], at?, freq?, speed?, decay? }]`
- `twist`: degrees across the height.
- `bend`: degrees across the width. 200 curls a wordmark into a ring.
- `taper`: top scale delta.
- `wave`: amplitude in heights, with `freq` across the width and `speed` in cycles per second.
- `squash`: 0..1 compression, volume preserved.
- `jiggle`: a damped squash-stretch after impact time `at`.

**Other fields**
- `depth` / `bevel`: fractions of the shape's height. The bevel is clamped on thin strokes.
- `shadow3d`: soft contact shadow. The default is true; for the cloner it is on only for logo-shaped layouts.
- `background`: the default is transparent, so the layer composites over the scene.
- The layer's own enter, exit, keyframes and rotate still move the canvas.

**Performance** (1080p, in-page 3D ms per frame on the dev iGPU via ANGLE; the frame budget is about 57 ms):
- Object: 3–5.
- Kinetic: 5–9.
- Deformers: 9–12.
- Cloner: 7–28. logo-of-logos is about 45.
- Particles (30–40k): 12–22.
- Post: bloom + DOF is 10–30.
- Motion-blur frames: × samples.

SwiftShader (Lambda) is about 15–40× slower and runs draft automatically.

**Limits**
- All 3D layers on a page share ONE WebGL context, so many 3D layers are fine. A 24-layer stress scene renders with zero context loss. It's still a centrepiece, though: keep 1–2 per scene.
- Glass refracts a built-in studio backdrop, not the scene behind it.
- Neon clones don't take per-clone colors. Use plastic or chrome for colored clones.
- Deformers bend the mesh, not its contact shadow. DOF on particles uses their cores only.
- No `repeat` or `motionBlur` layer options on 3D layers. Use `post.motionBlur`.
