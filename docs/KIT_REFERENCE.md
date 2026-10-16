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
`motionBlur: true | {samples, shutter}` · `css` (raw CSS for the layer wrapper).

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
