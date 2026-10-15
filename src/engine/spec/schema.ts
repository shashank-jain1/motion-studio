/**
 * Scene Spec: the JSON "language" an AI (or a human) writes videos in.
 * All times are in SECONDS. Positions are in px relative to the canvas CENTER (0,0 = middle).
 * Colors may be any CSS color or a theme token like "$accent".
 */
import { z } from "zod";

export const EASES = [
  "linear", "in", "out", "inOut",
  "outBack", "inBack", "inOutBack",
  "outExpo", "inExpo", "inOutExpo",
  "outQuint", "inOutQuint", "outCirc",
  "outElastic", "outBounce",
  "spring", "snappy", "bouncy", "smooth",
] as const;
export const Ease = z.enum(EASES);

/** One keyframe of a layer/camera animation. `t` is seconds relative to the layer/scene start. */
export const Keyframe = z.object({
  t: z.number().min(0),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  scale: z.number().optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  rotate: z.number().optional(),
  rotateX: z.number().optional(),
  rotateY: z.number().optional(),
  skewX: z.number().optional(),
  opacity: z.number().optional(),
  blur: z.number().optional(),
  ease: Ease.optional().describe("Easing used to arrive at this keyframe from the previous one"),
});
export type Keyframe = z.infer<typeof Keyframe>;

export const ENTER_PRESETS = [
  "none", "fade", "rise", "drop", "slide-left", "slide-right", "slide-up", "slide-down",
  "zoom-in", "zoom-out", "blur-in", "pop", "flip-up", "flip-side", "swing", "spin-in",
  "whip-left", "whip-right", "whip-up", "whip-down", "clip-up", "clip-down", "clip-left", "clip-right",
  "iris", "stretch", "fly-in-3d", "drop-bounce",
] as const;

export const Motion = z.object({
  type: z.enum(ENTER_PRESETS),
  duration: z.number().positive().optional().describe("seconds, default 0.6"),
  delay: z.number().min(0).optional(),
  ease: Ease.optional(),
  distance: z.number().optional().describe("px for slides/whips, default depends on preset"),
});

export const Loop = z.object({
  type: z.enum(["float", "pulse", "wiggle", "spin", "sway", "breathe", "bob", "shake", "orbit"]),
  amplitude: z.number().optional(),
  speed: z.number().optional().describe("cycles per second, default ~0.5"),
});

const commonLayer = {
  id: z.string().optional(),
  start: z.number().min(0).optional().describe("seconds after scene start, default 0"),
  duration: z.number().positive().optional().describe("seconds, default until scene end"),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional().describe("translateZ px (needs camera/group perspective)"),
  width: z.number().optional(),
  height: z.number().optional(),
  scale: z.number().optional(),
  rotate: z.number().optional(),
  rotateX: z.number().optional(),
  rotateY: z.number().optional(),
  opacity: z.number().optional(),
  blur: z.number().optional(),
  origin: z.string().optional().describe("CSS transform-origin, default center"),
  zIndex: z.number().optional(),
  depth: z.number().optional().describe("parallax factor for camera moves: 0 = fixed, 1 = normal (default), 2 = foreground"),
  blendMode: z.string().optional(),
  shadow: z.union([z.boolean(), z.string()]).optional().describe("true = soft premium drop shadow, or CSS box/drop shadow"),
  enter: Motion.optional(),
  exit: Motion.optional(),
  animate: z.array(Keyframe).optional().describe("keyframes, t relative to layer start; applied on top of base transform"),
  loop: Loop.optional(),
  motionBlur: z.union([z.boolean(), z.object({ samples: z.number().int().min(2).max(16).optional(), shutter: z.number().optional() })]).optional(),
  css: z.record(z.string(), z.any()).optional().describe("raw CSS escape hatch for the layer wrapper"),
};

export const TEXT_PRESETS = [
  "none", "blur-rise", "mask-up", "pop", "flip", "typewriter", "scramble", "wave", "stretch",
  "tracking", "slide-words", "zoom-from-camera", "gradient-sweep", "drop-in", "skew-in", "glitch", "split-reveal",
] as const;

export const TextLayer = z.object({
  ...commonLayer,
  type: z.literal("text"),
  text: z.string().describe("use \\n for line breaks"),
  preset: z.enum(TEXT_PRESETS).optional(),
  by: z.enum(["char", "word", "line"]).optional().describe("animation unit, default depends on preset"),
  stagger: z.number().optional().describe("seconds between units, default 0.035 for chars, 0.08 for words"),
  unitDuration: z.number().optional().describe("seconds each unit animates, default 0.6"),
  fontSize: z.number().optional(),
  font: z.string().optional().describe("font family name or $display/$body/$mono"),
  weight: z.number().optional(),
  italic: z.boolean().optional(),
  color: z.string().optional(),
  gradient: z.array(z.string()).optional().describe("text gradient colors"),
  letterSpacing: z.number().optional().describe("em"),
  lineHeight: z.number().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  maxWidth: z.number().optional().describe("wrap width in px; without it text never wraps and auto-fits to 90% of the frame"),
  fit: z.boolean().optional().describe("auto-shrink to fit the frame width (default true when no width/maxWidth)"),
  uppercase: z.boolean().optional(),
  stroke: z.object({ color: z.string(), width: z.number() }).optional(),
  glow: z.union([z.boolean(), z.string()]).optional(),
  highlight: z.object({
    words: z.array(z.string()),
    color: z.string().optional(),
    style: z.enum(["color", "marker", "underline", "box"]).optional(),
    at: z.number().optional().describe("seconds after layer start when the highlight animates"),
  }).optional(),
  exitPreset: z.enum(["none", "fade", "blur-out", "rise-out", "drop-out", "scatter", "mask-down"]).optional(),
  exitAt: z.number().optional().describe("seconds after layer start when the text exit animation starts; default = end - 0.5"),
});

export const MediaLayer = z.object({
  ...commonLayer,
  type: z.literal("media"),
  src: z.string().describe("assets/<file>, or an https URL"),
  kind: z.enum(["image", "video", "auto"]).optional(),
  fit: z.enum(["cover", "contain", "fill"]).optional(),
  radius: z.number().optional(),
  border: z.string().optional(),
  mask: z.enum(["none", "circle", "rounded", "blob", "arch", "diamond"]).optional(),
  reveal: z.enum(["none", "wipe-left", "wipe-right", "wipe-up", "wipe-down", "circle", "blinds", "split"]).optional(),
  revealDuration: z.number().optional(),
  kenBurns: z.object({ from: z.number().optional(), to: z.number().optional(), x: z.number().optional(), y: z.number().optional() }).optional(),
  filter: z.string().optional().describe("CSS filter, e.g. 'grayscale(1) contrast(1.2)'"),
  volume: z.number().optional(),
  muted: z.boolean().optional(),
  trimStart: z.number().optional().describe("seconds into the video to start from"),
  playbackRate: z.number().optional(),
  loopVideo: z.boolean().optional(),
});

export const ShapeLayer = z.object({
  ...commonLayer,
  type: z.literal("shape"),
  shape: z.enum(["rect", "circle", "ring", "line", "blob", "star", "polygon", "triangle"]),
  color: z.string().optional(),
  gradient: z.array(z.string()).optional(),
  radius: z.number().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  sides: z.number().optional(),
  glow: z.union([z.boolean(), z.string()]).optional(),
  draw: z.boolean().optional().describe("animate the outline drawing on (ring/polygon/star/line)"),
  drawDuration: z.number().optional(),
});

export const PathLayer = z.object({
  ...commonLayer,
  type: z.literal("path"),
  d: z.string().optional().describe("SVG path data in a 1000x1000 box (scaled to width/height)"),
  preset: z.enum(["swoosh", "arc", "wave", "loop", "zigzag", "spiral", "underline", "circle-scribble", "s-curve"]).optional(),
  color: z.string().optional(),
  gradient: z.array(z.string()).optional(),
  strokeWidth: z.number().optional(),
  drawStart: z.number().optional().describe("seconds after layer start, default 0"),
  drawDuration: z.number().optional().describe("seconds, default 1.2"),
  ease: Ease.optional(),
  trail: z.number().optional().describe("0..1: if set, only a comet segment of this length is visible"),
  glow: z.union([z.boolean(), z.string()]).optional(),
  dashed: z.boolean().optional(),
  follower: z.object({
    src: z.string().optional().describe("image asset that rides the path"),
    emoji: z.string().optional(),
    text: z.string().optional(),
    size: z.number().optional(),
    rotate: z.boolean().optional().describe("align to path tangent, default true"),
    rotateOffset: z.number().optional(),
  }).optional(),
});

export const ParticlesLayer = z.object({
  ...commonLayer,
  type: z.literal("particles"),
  preset: z.enum(["confetti", "sparkles", "dust", "bokeh", "snow", "embers", "burst", "stars", "rain", "bubbles", "warp"]),
  count: z.number().int().optional(),
  colors: z.array(z.string()).optional(),
  seed: z.number().optional(),
  size: z.number().optional(),
  speed: z.number().optional(),
  originX: z.number().optional().describe("burst/confetti origin, px from center"),
  originY: z.number().optional(),
});

export const CardLayer = z.object({
  ...commonLayer,
  type: z.literal("card"),
  variant: z.enum(["notification", "notification-dark", "glass", "solid", "pill", "toast", "chat-left", "chat-right", "stat", "quote", "button", "search"]),
  icon: z.string().optional().describe("asset path, URL, or emoji"),
  title: z.string().optional(),
  body: z.string().optional(),
  meta: z.string().optional().describe("e.g. 'now'"),
  accent: z.string().optional(),
  background: z.string().optional(),
  color: z.string().optional(),
  fontSize: z.number().optional(),
  font: z.string().optional(),
  press: z.number().optional().describe("seconds after layer start: plays a tap/press animation (buttons)"),
});

export const CounterLayer = z.object({
  ...commonLayer,
  type: z.literal("counter"),
  from: z.number().optional(),
  to: z.number(),
  countDuration: z.number().optional(),
  countDelay: z.number().optional(),
  decimals: z.number().int().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  locale: z.string().optional().describe("e.g. en-IN for lakh grouping"),
  ease: Ease.optional(),
  fontSize: z.number().optional(),
  font: z.string().optional(),
  weight: z.number().optional(),
  color: z.string().optional(),
  gradient: z.array(z.string()).optional(),
});

export const CaptionsLayer = z.object({
  ...commonLayer,
  type: z.literal("captions"),
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })).optional()
    .describe("word timings in seconds relative to layer start"),
  text: z.string().optional().describe("if no word timings, text is spread evenly over the layer"),
  wordsPerPage: z.number().int().optional(),
  style: z.enum(["karaoke", "pop", "box", "bounce", "clean"]).optional(),
  fontSize: z.number().optional(),
  font: z.string().optional(),
  color: z.string().optional(),
  highlightColor: z.string().optional(),
  uppercase: z.boolean().optional(),
});

export const CloudLayer = z.object({
  ...commonLayer,
  type: z.literal("cloud"),
  items: z.array(z.object({ src: z.string().optional(), text: z.string().optional(), emoji: z.string().optional(), background: z.string().optional() })),
  arrangement: z.enum(["scatter", "orbit", "grid", "marquee", "burst", "arc"]).optional(),
  itemSize: z.number().optional(),
  tile: z.boolean().optional().describe("render items as rounded app-icon tiles, default true"),
  radius: z.number().optional().describe("orbit/arc radius"),
  avoidCenter: z.object({ width: z.number(), height: z.number() }).optional(),
  stagger: z.number().optional(),
  seed: z.number().optional(),
  columns: z.number().optional(),
  speed: z.number().optional(),
});

export const ShaderLayer = z.object({
  ...commonLayer,
  type: z.literal("shader"),
  shader: z.enum(["aurora", "liquid", "plasma", "silk", "warp", "tunnel", "waves", "dots", "rays", "noise", "grid-floor", "blobs"]),
  colors: z.array(z.string()).optional(),
  speed: z.number().optional(),
  intensity: z.number().optional(),
});

export const LottieLayer = z.object({
  ...commonLayer,
  type: z.literal("lottie"),
  src: z.string(),
  speed: z.number().optional(),
  loopAnim: z.boolean().optional(),
});

export const CustomLayer = z.object({
  ...commonLayer,
  type: z.literal("custom"),
  component: z.string().describe("name of a custom component written with write_custom_component"),
  props: z.record(z.string(), z.any()).optional(),
});

export const DEVICE_MODELS = ["iphone", "android", "browser", "tablet"] as const;

/** Recursive layer types (device screens and groups hold child layers). */
export type Layer =
  | z.infer<typeof TextLayer> | z.infer<typeof MediaLayer> | z.infer<typeof ShapeLayer> | z.infer<typeof PathLayer>
  | z.infer<typeof ParticlesLayer> | z.infer<typeof CardLayer> | z.infer<typeof CounterLayer> | z.infer<typeof CaptionsLayer>
  | z.infer<typeof CloudLayer> | z.infer<typeof ShaderLayer> | z.infer<typeof LottieLayer> | z.infer<typeof CustomLayer>
  | DeviceLayerT | GroupLayerT;

const commonLayerSchema = z.object(commonLayer);
type Common = z.infer<typeof commonLayerSchema>;

export type ScreenT = {
  src?: string;
  background?: string;
  at?: number;
  scroll?: { to: number; start?: number; duration?: number; ease?: z.infer<typeof Ease> };
  layers?: Layer[];
  transition?: "fade" | "slide" | "push" | "zoom" | "none";
};

export type DeviceLayerT = Common & {
  type: "device";
  model?: (typeof DEVICE_MODELS)[number];
  frameColor?: string;
  screens?: ScreenT[];
  statusBar?: boolean;
  glare?: boolean;
  thickness?: number;
  url?: string;
  island?: { activity?: "faceid" | "faceid-success" | "pay" | "music" | "timer"; at?: number; duration?: number };
};

export type GroupLayerT = Common & {
  type: "group";
  layers: Layer[];
  perspective?: number;
};

export const LayerSchema: z.ZodType<Layer> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TextLayer, MediaLayer, ShapeLayer, PathLayer, ParticlesLayer, CardLayer, CounterLayer,
    CaptionsLayer, CloudLayer, ShaderLayer, LottieLayer, CustomLayer, DeviceLayer, GroupLayer,
  ]),
) as z.ZodType<Layer>;

const Screen = z.object({
  src: z.string().optional().describe("screenshot / screen recording asset"),
  background: z.string().optional(),
  at: z.number().optional().describe("seconds after device layer start when this screen appears"),
  scroll: z.object({ to: z.number().describe("0..1 fraction of the overflow to scroll"), start: z.number().optional(), duration: z.number().optional(), ease: Ease.optional() }).optional(),
  layers: z.array(z.lazy(() => LayerSchema)).optional().describe("UI built from layers inside the screen (coordinates relative to screen center)"),
  transition: z.enum(["fade", "slide", "push", "zoom", "none"]).optional(),
});

const DeviceLayer = z.object({
  ...commonLayer,
  type: z.literal("device"),
  model: z.enum(DEVICE_MODELS).optional(),
  frameColor: z.string().optional().describe("titanium | black | silver | deep-red | blue | gold, or a CSS color"),
  screens: z.array(Screen).optional(),
  statusBar: z.boolean().optional(),
  glare: z.boolean().optional(),
  thickness: z.number().optional().describe("3D edge depth in px, default 14"),
  url: z.string().optional().describe("browser model: URL bar text"),
  island: z.object({
    activity: z.enum(["faceid", "faceid-success", "pay", "music", "timer"]).optional(),
    at: z.number().optional(),
    duration: z.number().optional(),
  }).optional(),
});

const GroupLayer = z.object({
  ...commonLayer,
  type: z.literal("group"),
  layers: z.array(z.lazy(() => LayerSchema)),
  perspective: z.number().optional(),
});

export const BackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: z.string() }),
  z.object({ type: z.literal("gradient"), colors: z.array(z.string()).min(2), angle: z.number().optional(), spin: z.number().optional().describe("deg per second"), radial: z.boolean().optional() }),
  z.object({ type: z.literal("mesh"), colors: z.array(z.string()).min(2), speed: z.number().optional(), base: z.string().optional() }),
  z.object({ type: z.literal("shader"), shader: ShaderLayer.shape.shader, colors: z.array(z.string()).optional(), speed: z.number().optional(), intensity: z.number().optional() }),
  z.object({ type: z.literal("grid"), color: z.string().optional(), base: z.string().optional(), size: z.number().optional(), perspective: z.boolean().optional(), speed: z.number().optional() }),
  z.object({ type: z.literal("media"), src: z.string(), blur: z.number().optional(), dim: z.number().optional(), kenBurns: z.boolean().optional() }),
  z.object({ type: z.literal("spotlight"), color: z.string().optional(), base: z.string().optional(), x: z.number().optional(), y: z.number().optional(), size: z.number().optional() }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const CameraSchema = z.object({
  keyframes: z.array(z.object({
    t: z.number().min(0),
    zoom: z.number().optional(),
    x: z.number().optional().describe("camera position: positive x pans the view to the right"),
    y: z.number().optional(),
    rotate: z.number().optional(),
    rotateX: z.number().optional(),
    rotateY: z.number().optional(),
    ease: Ease.optional(),
  })).optional(),
  shake: z.object({ amount: z.number().optional(), speed: z.number().optional(), start: z.number().optional(), duration: z.number().optional() }).optional(),
  punch: z.array(z.number()).optional().describe("seconds at which to do a quick zoom punch (great on beats)"),
  perspective: z.number().optional(),
});

export const TRANSITIONS = [
  "none", "cut", "fade", "slide", "wipe", "flip", "clock-wipe", "iris", "book-flip",
  "zoom-blur", "dreamy-zoom", "film-burn", "linear-blur", "zoom-in-out", "dissolve", "ripple",
  "crosswarp", "cross-zoom", "swap", "push-cut", "blur-slide",
  "whip", "zoom-through", "flash", "glitch",
] as const;

export const TransitionSchema = z.object({
  type: z.enum(TRANSITIONS),
  duration: z.number().positive().optional().describe("seconds, default 0.5"),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  color: z.string().optional().describe("flash color"),
  ease: Ease.optional(),
});

export const FxSchema = z.object({
  grain: z.number().optional().describe("0..1 film grain amount"),
  vignette: z.number().optional().describe("0..1"),
  chromatic: z.number().optional().describe("px of RGB split"),
  lightLeak: z.number().optional().describe("0..1"),
  letterbox: z.number().optional().describe("bar height as fraction of height, e.g. 0.1"),
  scanlines: z.number().optional(),
  flashes: z.array(z.object({ at: z.number(), color: z.string().optional(), duration: z.number().optional(), intensity: z.number().optional() })).optional(),
});

export const SceneSchema = z.object({
  id: z.string().optional(),
  duration: z.number().positive().describe("seconds"),
  background: z.union([BackgroundSchema, z.array(BackgroundSchema)]).optional(),
  camera: CameraSchema.optional(),
  layers: z.array(LayerSchema).default([]),
  transition: TransitionSchema.optional().describe("transition INTO this scene from the previous one"),
  motionBlur: z.union([z.boolean(), z.object({ samples: z.number().int().optional(), shutter: z.number().optional() })]).optional(),
  fx: FxSchema.optional(),
  notes: z.string().optional().describe("director notes, ignored by the renderer"),
});
export type Scene = z.infer<typeof SceneSchema>;

export const FORMATS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "21:9": [2520, 1080] } as const;

export const ThemeSchema = z.object({
  fonts: z.object({ display: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).optional(),
  colors: z.record(z.string(), z.string()).optional().describe("named colors referenced as $name, e.g. bg, fg, accent, accent2, muted"),
});

export const SpecSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string().optional(),
  format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS, ...(keyof typeof FORMATS)[]]).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().int().min(12).max(60).default(30),
  style: z.string().optional().describe("style preset name (see list_kit)"),
  theme: ThemeSchema.optional(),
  audio: z.object({
    src: z.string(),
    volume: z.number().optional(),
    trimStart: z.number().optional(),
    fadeIn: z.number().optional(),
    fadeOut: z.number().optional(),
  }).optional(),
  sfx: z.array(z.object({ src: z.string(), at: z.number(), volume: z.number().optional() })).optional(),
  fx: FxSchema.optional(),
  scenes: z.array(SceneSchema).min(1),
});
export type Spec = z.infer<typeof SpecSchema>;
export type SpecInput = z.input<typeof SpecSchema>;
