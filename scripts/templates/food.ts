import { circ, lockupLogo, rrect, type TemplateDef } from "./_kit";

// Ember — wood-fired pizza, delivered. "Still glowing": heat shown as colour. A frost-blue city at 2°C; one warm box
// crosses it (the camera rides with it). At every corner the cold closes in on it like a ring of frost, and is pushed
// back. At the door the lid lifts and the warmth floods the whole city. The open box, seen from above, IS the Ember mark:
// a glowing round pie with three char spots in a kraft square.

const KRAFT = "#d9954f", AMBER = "#ff7a2f", CHAR = "#7a2a0c";
// open box (the mark): kraft square + glowing pie + three leopard char spots
const ICON = `<path fill="${KRAFT}" d="${rrect(14, 14, 252, 252, 40)}"/>
  <path fill="${AMBER}" d="${circ(140, 140, 96)}"/>
  <path fill="${CHAR}" d="${circ(112, 116, 13)}"/>
  <path fill="${CHAR}" d="${circ(170, 128, 10)}"/>
  <path fill="${CHAR}" d="${circ(132, 176, 11)}"/>`;
// closed box (top-down): kraft square, lid seam, the small printed stamp that grows into the pie
const BOX = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 280">
  <path fill="${KRAFT}" d="${rrect(14, 14, 252, 252, 40)}"/>
  <path fill="#b97536" d="${rrect(30, 196, 220, 10, 5)}"/>
  <path fill="${AMBER}" d="${circ(140, 120, 34)}"/>
  <path fill="#b97536" d="${rrect(96, 222, 88, 8, 4)}"/>
</svg>
`;

// ---- the city (world px): streets every 330 (x) / 320 (y), 70 wide; blocks between them
const SX = [-990, -660, -330, 0, 330, 660, 990], SY = [-1580, -1260, -940, -620, -300, 20, 340, 660, 980, 1300, 1620];
// The city is ONE flat SVG backdrop (a fill: every format scales it per axis, exactly like the camera path), placed far
// off-centre at WORLD so no camera point ever lands inside an on-screen content box during reflow.
const WORLD = { x: 1700, y: 1700 };
const CITY_SIZE = 3600;
const blockRect = (x0: number, y0: number, x1: number, y1: number, r = 22) => `<path fill="#10233d" d="${rrect(x0, y0, x1 - x0, y1 - y0, r)}"/>`;
const BLOCKS: string[] = [];
for (let i = 0; i < SX.length - 1; i++) for (let j = 0; j < SY.length - 1; j++) BLOCKS.push(blockRect(SX[i] + 35, SY[j] + 35, SX[i + 1] - 35, SY[j + 1] - 35));
const CITY_SVG = (doorY: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-CITY_SIZE / 2} ${-CITY_SIZE / 2} ${CITY_SIZE} ${CITY_SIZE}" preserveAspectRatio="none">
  ${BLOCKS.join("\n  ")}
  <path fill="#1b3558" d="${rrect(-110, doorY + 80, 220, 70, 14)}"/>
</svg>
`;

// ---- the ride: the box stays at screen BOX_S while the camera follows the route at constant speed
const ROUTE: [number, number][] = [[-330, -700], [-330, -300], [330, -300], [330, 340], [0, 340], [0, 470]];
const RIDE = 6.0;
const BOX_S = 70; // box screen y
const segLen = ROUTE.slice(1).map((p, i) => Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]));
const total = segLen.reduce((a, b) => a + b, 0);
const AT = ROUTE.map((_, i) => +(RIDE * segLen.slice(0, i).reduce((a, b) => a + b, 0) / total).toFixed(3));
const ATTACKS = [1, 2, 3]; // the three corners: the cold closes in on the box and is pushed back (the prior)
const DOOR = RIDE; // arrival
const PEAK = 7.6; // the lid lifts: warmth floods the city

const t: TemplateDef = {
  slug: "food",
  order: 4,
  title: "Food delivery: still glowing",
  niche: "Food & restaurant",
  description: "A frost-blue city at night; one warm box crosses it and never cools. At the door the lid lifts and its warmth floods the whole city — the open box is your mark.",
  tags: ["food", "restaurant", "delivery", "colour script", "camera ride", "warm"],
  format: "9:16",
  posterTime: 8.4,
  previewTimes: [0.3, 1.2, 2.9, 4.8, 6.4, 7.3, 7.7, 8.0, 8.6, 9.9, 11.8],
  logos: [
    { file: "ember-logo.svg", build: () => lockupLogo({ icon: ICON, word: "ember", font: "Fraunces", weight: 700, color: "#fff1e0", gap: 100 }) },
    { file: "ember-box.svg", build: async () => BOX },
    { file: "ember-city.svg", build: async () => CITY_SVG(ROUTE[5][1]) },
  ],
  spec: {
    title: "Ember — still glowing at your door",
    fps: 30,
    style: "cinematic",
    formats: ["16:9", "1:1", "4:5"],
    sound: {
      brief: { voice: "warm", realism: "mixed", materials: ["cardboard", "wood"], space: "room", avoid: ["digital", "gamey"] },
      restraint: 0.55, signature: "auto",
    },
    theme: {
      fonts: { display: "Fraunces", body: "DM Sans" },
      colors: { bg: "#081322", fg: "#eaf2ff", muted: "#8ea3c2", accent: AMBER, accent2: "#ffc24b", card: "#10233d", cream: "#fff1e0", coal: "#1a0d07", frost: "#9cc4ff", block: "#10233d" },
    },
    fx: { grain: 0.12, vignette: 0.45, letterbox: 0, flashes: [{ at: PEAK + 0.08, color: "#ffb35c", duration: 0.16, intensity: 0.3 }] },
    // the cold closing in: an air-suck whose apex lands as each frost ring touches the box (air-suck-1 peaks at 0.483s)
    sfx: [
      ...ATTACKS.map((k) => ({ src: "sfx:air-suck-1", at: +(AT[k] - 0.483).toFixed(3), volume: 0.55 })),
      // the lid lifts: a soft, warm hit as the warmth bursts out, a shimmer as it spreads
      { src: "sfx:impact-soft", at: +(PEAK + 0.05 - 0.006).toFixed(3), volume: 0.85 },
      { src: "sfx:shimmer", at: +(PEAK + 0.45 - 0.51).toFixed(3), volume: 0.5 },
    ],
    concept: {
      niche: "food",
      truth: "Ember helps hungry neighbours eat real wood-fired pizza at home, feeling looked after.",
      metaphor: "sensory transposition — heat as colour: a frost-blue city, one amber box that never cools; when it opens, its warmth floods everything",
      motif: "the warm box (actor), seen from above: closed it carries a small amber stamp; open, the stamp is a glowing pie with three char spots — the Ember mark",
      verb: "warm / keep",
      hook: "'It's 2°C out.' — snow over a frost-blue city and one glowing box riding through it",
      arc: ["hook: 2°C, one warm box", "prior ×3: at every corner a ring of frost closes in and the box pushes it back", "arrival: knock knock", "hold: silence at the door", "wow: the lid lifts and the warmth floods the city", "lockup: the open box is the mark"],
      colorScript: ["frost blue, amber only on the box", "blue + three frost rings, amber only on the box", "blue hold", "amber flood", "coal + amber lockup"],
      story: {
        insight: "Delivery pizza usually arrives as a rumour of itself.",
        audienceTension: "I want the pizza from the restaurant, not the tired version that turns up half an hour later.",
        inherentDrama: "the lid lift: the second the box opens and the heat reaches your face",
        orthodoxy: ["flames licking an oven", "a slow-motion cheese pull", "rising steam", "ingredients exploding in slo-mo", "a scooter racing a clock"],
        structure: "transformation",
        clicheControl: {
          obvious: "Flames and floating embers around a slow-motion cheese pull with rising steam: 'Fire-baked perfection.'",
          banned: ["flame", "fire", "steam", "cheese pull", "embers", "slow-mo", "scooter"],
        },
        candidates: [
          { title: "Control: flames, cheese pull, steam", technique: "control", logline: "Flames and floating embers swirl around a slow-motion cheese pull with rising steam: 'Fire-baked perfection.'", typicality: 0.9,
            scores: { hook: 3, surprise: 0, emotionalPeak: 2, payoff: 2, brandLinkage: 2, clarity: 5, uniqueness: 0, feasibility: 4 } },
          { title: "Still glowing", technique: "sensory-transposition (heat as colour)", logline: "A frost-blue city at 2°C; one amber box rides through it and never cools — every time the cold closes in, it pushes it back; at the door the lid lifts and its warmth floods the whole city — the open box is the Ember mark.", typicality: 0.1,
            scores: { hook: 4, surprise: 4, emotionalPeak: 5, payoff: 4, brandLinkage: 4, clarity: 4, uniqueness: 4, feasibility: 4 } },
          { title: "Leopard spots", technique: "inherent-drama", logline: "A pale dough disc blisters with dark char spots in the oven's few seconds; the spots arrange themselves into the mark.", typicality: 0.2,
            scores: { hook: 4, surprise: 3, emotionalPeak: 3, payoff: 4, brandLinkage: 4, clarity: 3, uniqueness: 4, feasibility: 4 } },
          { title: "The bus-stop hand-warmer", technique: "metaphor-mining (a hand-warmer), comic", logline: "Strangers at a freezing bus stop huddle round a pizza box like a campfire; it's the warmest thing on the street.", typicality: 0.15,
            scores: { hook: 3, surprise: 4, emotionalPeak: 4, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 3 } },
          { title: "The melted route", technique: "exaggeration (extreme situation)", logline: "The box is so hot it melts a clean path through a snowed-in city; from above, the melted route spells out the delivery.", typicality: 0.15,
            scores: { hook: 4, surprise: 4, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 4, feasibility: 4 } },
          { title: "The box's night shift", technique: "perspective-shift", logline: "The delivery box narrates its job: keep one secret warm across town.", typicality: 0.18,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 3, feasibility: 4 } },
          { title: "Crackle vs silence", technique: "constraint (one slice, two soundtracks) — sound-led competition", logline: "Split screen, same slice: the cold one makes no sound when bent, Ember's crackles; the crackle wins.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 4 } },
          { title: "Fast is not hot", technique: "cultural-tension", logline: "Everyone sells 'fast'; you secretly know fast still arrives lukewarm — Ember refuses to race and wins on warmth.", typicality: 0.25,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
        ],
        chosen: 1,
        beats: [
          { t: 0, beat: "hook: 'It's 2°C out.' — snow, frost-blue city, one glowing box riding through", emotion: "curiosity", intensity: 6, sound: "cold wind air + a soft cardboard tap" },
          { t: 1.1, beat: "prior ×3: at each corner a ring of frost closes in and the box's glow pushes it back", emotion: "tension", intensity: 5, to: 7, sound: "icy closing swell, warm push per corner" },
          { t: DOOR, beat: "arrival: knock knock", emotion: "anticipation", intensity: 7, to: 7.5, sound: "two wood knocks" },
          { t: 7.1, beat: "hold: silence at the door", emotion: "suspense", intensity: 4, sound: "silence 0.5s" },
          { t: PEAK, beat: "peak: the lid lifts and the warmth floods the city", emotion: "comfort / delight", intensity: 10, wow: "the lid lifts and amber warmth floods out of the box across the whole frost-blue city; the open box below is a glowing pie with three char spots — the Ember mark", sound: "hero warm swell" },
          { t: 9.6, beat: "payoff: the open box lifts into the lockup", emotion: "warmth", intensity: 9, sound: "Ember signature" },
          { t: 10.4, beat: "lock + CTA: Still glowing at your door.", emotion: "satisfaction", intensity: 8.5 },
        ],
        peakAt: PEAK,
        mnemonic: { visual: "the open box from above: a glowing pie with three char spots in a kraft square", sonic: "Ember's auto signature on the lockup (same notes every film)", loop: false },
      },
    },
    actors: [{
      id: "box",
      from: "ride",
      until: "lockup",
      layer: {
        type: "morph", width: 150, height: 150, shadow: `drop-shadow(0 0 26px ${AMBER})`,
        enter: { type: "pop", duration: 0.35 },
        shapes: [
          { at: 0, shape: "svg:assets/ember-box.svg" },
          { at: PEAK + 0.55, shape: "svg:assets/ember-logo.svg#icon", morph: 0.55, ease: "inOutQuint" },
        ],
      },
      poses: [
        { scene: "ride", t: 0, x: 0, y: BOX_S, scale: 1 },
        { scene: "ride", t: DOOR, x: 0, y: BOX_S, scale: 1 },
        { scene: "ride", t: 7.25, x: 0, y: BOX_S, scale: 1.12, move: 0.3, ease: "inOut" },
        { scene: "warm", t: 1.0, x: 0, y: -160, scale: 3.6, move: 0.6, ease: "inOutQuint" },
        { scene: "lockup", t: 0.8, snapTo: "lockup-logo", move: 0.8, ease: "expoOut" },
      ],
    }],
    scenes: [
      {
        id: "ride", duration: PEAK + 0.7,
        background: { type: "solid", color: "$bg" },
        camera: {
          keyframes: [
            ...ROUTE.map(([x, y], i) => ({ t: AT[i], x: x + WORLD.x, y: y + WORLD.y - BOX_S, zoom: 1, ease: i === ROUTE.length - 1 ? "outQuint" : "linear" })),
            { t: PEAK + 0.7, x: WORLD.x, y: ROUTE[5][1] + WORLD.y - BOX_S, zoom: 1.0 },
          ],
        },
        layers: [
          { type: "media", src: "assets/ember-city.svg", fit: "fill", width: CITY_SIZE, height: CITY_SIZE, x: WORLD.x, y: WORLD.y, sound: false },
          // the box's own warmth (screen-fixed, depth 0): a steady glow that flares each time it pushes the cold back
          {
            type: "shape", shape: "circle", width: 360, height: 360, color: "rgba(255,122,47,0.45)", blur: 36, y: BOX_S, depth: 0, sound: false,
            animate: [{ t: 0, scale: 0.8, opacity: 0.7 }, ...ATTACKS.flatMap((k) => [{ t: AT[k] - 0.05, scale: 0.75, opacity: 0.6 }, { t: AT[k] + 0.12, scale: 1.25, opacity: 1, ease: "expoOut" }, { t: AT[k] + 0.7, scale: 0.85, opacity: 0.75, ease: "inOut" }])],
          },
          // the cold closes in (an icy ring shrinking onto the box) and is pushed back, three times
          ...ATTACKS.map((k) => ({
            type: "shape", shape: "ring", width: 320, height: 320, color: "#a9cdff", stroke: "#a9cdff", strokeWidth: 10, y: BOX_S, depth: 0, sound: false,
            start: AT[k] - 0.6, duration: 1.3,
            animate: [{ t: 0, scale: 3.2, opacity: 0 }, { t: 0.15, opacity: 0.9 }, { t: 0.6, scale: 0.62, opacity: 1, ease: "in" }, { t: 1.2, scale: 2.2, opacity: 0, ease: "expoOut" }],
          })),
          // where the warmth will burst from (screen-fixed at the box)
          { type: "shape", id: "box-spot", shape: "circle", width: 150, height: 150, color: "rgba(255,122,47,0)", y: BOX_S, depth: 0, sound: false },
          { type: "particles", preset: "snow", count: 90, colors: ["#ffffff", "#cfe3ff"], speed: 0.7, depth: 0, sound: false },
          { type: "text", text: "It's 2°C out.", preset: "blur-rise", fontSize: 96, weight: 700, color: "$fg", y: -620, depth: 0, duration: 2.7, exitPreset: "blur-out", exitAt: 2.35 },
          { type: "text", text: "Most pizza gives up\non the way.", preset: "mask-up", fontSize: 80, weight: 700, color: "$fg", y: -600, depth: 0, start: 2.6, duration: DOOR - 2.6, exitPreset: "blur-out", exitAt: DOOR - 2.95, lineHeight: 1.05 },
          { type: "text", text: "knock knock", preset: "pop", fontSize: 56, weight: 700, font: "$body", color: "$frost", y: 250, depth: 0, start: DOOR + 0.05, duration: 1.3, exitPreset: "fade", exitAt: 1.0, sound: "sfx:wood-knock-1" },
        ],
      },
      {
        id: "warm", duration: 2.0,
        transition: { type: "expand", from: "box-spot", shape: "circle", color: "#ff8a3d", duration: 0.7 },
        background: [{ type: "gradient", colors: ["#ffb35c", "#ff7a2f", "#c2410c"], radial: true }],
        camera: { keyframes: [{ t: 0, zoom: 1.06 }, { t: 2.0, zoom: 1.0, ease: "expoOut" }], punch: [0.05] },
        layers: [
          { type: "particles", preset: "dust", count: 40, colors: ["#fff1e0", "#ffd9a8"], speed: 0.4, sound: false },
          { type: "text", text: "Still glowing.", preset: "mask-up", fontSize: 120, weight: 700, color: "$coal", y: 260, start: 0.35, sound: false },
        ],
      },
      {
        id: "lockup", duration: 2.8,
        transition: { type: "match" },
        background: [{ type: "solid", color: "$coal" }, { type: "spotlight", base: "transparent", color: "#4a1f0a", y: -160 }],
        camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 2.8, zoom: 1, ease: "outQuint" }] },
        layers: [
          { type: "logo", id: "lockup-logo", src: "assets/ember-logo.svg", parts: "wordmark", frame: "full", mode: "cascade", height: 190, y: -170, start: 0.5 },
          { type: "text", text: "Wood-fired. Still glowing\nat your door.", preset: "mask-up", fontSize: 64, weight: 600, font: "$body", color: "$cream", y: 30, start: 0.85, lineHeight: 1.1 },
          { type: "card", variant: "button", title: "Order tonight", accent: "$accent", color: "#ffffff", fontSize: 46, y: 220, start: 1.2, press: 2.3, enter: { type: "grow", duration: 0.5 }, inertia: true },
        ],
      },
    ],
  },
};
export default t;
