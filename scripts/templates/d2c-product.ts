import { getTextOutline } from "../../src/core/glyphs";
import { circ, lockupLogo, type TemplateDef } from "./_kit";

// Dewy — a hydrating serum (D2C). "The straw": the word skın — hairline-thin and tired at 4 p.m. — drinks the serum
// through a striped straw, sip by sip, and plumps from Bricolage 200 to 800. On the last slurp it inflates and its
// i-dot pops off like a cork: the dot is Dewy's glossy bead mark.

// ---- the protagonist: "skın" (dotless ı; the dot is the brand bead actor) at any weight between 200 and 800.
// Bricolage Grotesque is variable, so the 200 and 800 outlines share every command: lerping the numbers = a real weight.
const WORD = "skın";
const [thin, fat] = await Promise.all([getTextOutline("Bricolage Grotesque", 200, WORD), getTextOutline("Bricolage Grotesque", 800, WORD)]);
const S = 920 / fat.width; // font units → 1000-box units (the fat word spans 920)
const BASE = 610; // baseline in the 1000 box
const nums = (d: string) => (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
const cmds = (d: string) => d.match(/[A-Za-z][^A-Za-z]*/g) ?? [];
/** the word at weight fraction f (0 = 200, 1 = 800), centred in the 1000 box */
const wordAt = (f: number) => {
  const w = thin.width + (fat.width - thin.width) * f;
  const out: string[] = [];
  thin.glyphs.forEach((g, gi) => {
    const a = cmds(g.d), b = cmds(fat.glyphs[gi].d);
    a.forEach((c, ci) => {
      const na = nums(c), nb = nums(b[ci]);
      const v = na.map((x, k) => x + (nb[k] - x) * f);
      // absolute commands with x,y pairs (M L Q C) — map x and y separately
      out.push(c[0] + v.map((x, k) => (k % 2 === 0 ? (x - w / 2) * S + 500 : x * S + BASE).toFixed(1)).join(" "));
    });
  });
  return out.join("");
};
/** where the ı's dot sits at weight f (1000-box coords): centred over the stem, a gap above its top */
const dotAt = (f: number) => {
  const gi = thin.glyphs.findIndex((g) => g.char === "ı");
  const ys = (d: string) => nums(d).filter((_, k) => k % 2 === 1);
  const xs = (d: string) => nums(d).filter((_, k) => k % 2 === 0);
  const lerp = (p: number, q: number) => p + (q - p) * f;
  const w = lerp(thin.width, fat.width);
  const x0 = lerp(Math.min(...xs(thin.glyphs[gi].d)), Math.min(...xs(fat.glyphs[gi].d)));
  const x1 = lerp(Math.max(...xs(thin.glyphs[gi].d)), Math.max(...xs(fat.glyphs[gi].d)));
  const top = lerp(Math.min(...ys(thin.glyphs[gi].d)), Math.min(...ys(fat.glyphs[gi].d)));
  const stem = (x1 - x0) * S;
  return { x: ((x0 + x1) / 2 - w / 2) * S + 500, y: top * S + BASE - stem * 0.75 - 40, stem };
};

// ---- layout (4:5 master, 1080×1350, px from centre)
const WORD_W = 880; // morph box px (1000 box → 880 px)
const WORD_Y = -150;
const px = (p: { x: number; y: number }) => ({ x: Math.round((p.x - 500) * (WORD_W / 1000)), y: Math.round(WORD_Y + (p.y - 500) * (WORD_W / 1000)) });
const BEAD = 92; // bead actor box px (the logo icon is fit into it)
const beadScale = (f: number) => Math.max(0.42, (dotAt(f).stem * (WORD_W / 1000) * 1.25) / (BEAD * 0.82));

const BOTTLE = { x: 360, y: 330 };
// straw: bottle mouth → up → bend → down into the bottom of the "n". Drawn in a 1000 box (600 px) centred at STRAW.
const STRAW = { x: 360, y: 40, size: 400 };
const toBox = (x: number, y: number) => `${(500 + ((x - STRAW.x) * 1000) / STRAW.size).toFixed(1)} ${(500 + ((y - STRAW.y) * 1000) / STRAW.size).toFixed(1)}`;
const STRAW_D = `M${toBox(BOTTLE.x, BOTTLE.y - 205)} L${toBox(BOTTLE.x, 40)} C${toBox(BOTTLE.x, 0)} ${toBox(BOTTLE.x + 15, -12)} ${toBox(BOTTLE.x + 15, -48)}`;

const SIPS = [1.55, 2.75, 3.95]; // three sips teach the prior: sip → a little plumper
const SLURP = 5.15; // the long slurp
const PEAK = 7.2; // the inflate + the dot pops off
const W = [0, 0.2, 0.4, 0.58, 0.8, 1];

// the bottle+straw group is centred on GROUP; children are placed relative to it
const GROUP = { x: BOTTLE.x, y: 216 };
const rel = (p: { x: number; y: number }) => ({ x: p.x - GROUP.x, y: p.y - GROUP.y });
const straw = { type: "path", d: STRAW_D, width: STRAW.size, height: STRAW.size, ...rel(STRAW) };
const pulse = (at: number, i: number) => ({
  ...straw, strokeWidth: 15, color: "$accent", trail: 0.35,
  start: at, duration: 0.6, drawDuration: 0.5, ease: "in", sound: `sfx:bubble-${i + 1}`,
});

const ICON = `<path fill="#ff7a9c" d="${circ(140, 150, 108)}"/>
  <path fill="#ffffff" fill-opacity="0.9" d="M88 118 C92 92 116 74 142 72 C126 84 112 100 106 122 C102 134 86 132 88 118 Z"/>`;

const t: TemplateDef = {
  slug: "d2c-product",
  order: 3,
  title: "D2C product: the straw",
  niche: "D2C product",
  description: "The word 'skin', hairline-thin at 4 p.m., drinks your product through a straw and plumps up sip by sip — then its i-dot pops off and becomes your mark.",
  tags: ["d2c", "beauty", "product", "kinetic type", "morph", "pastel", "humour"],
  format: "4:5",
  posterTime: 8.4,
  previewTimes: [0.3, 1.2, 1.8, 3.3, 5.6, 6.8, 7.3, 7.7, 8.6, 11],
  logos: [{
    file: "dewy-logo.svg",
    build: () => lockupLogo({ icon: ICON, word: "dewy", font: "Bricolage Grotesque", weight: 700, color: "#3a1d33", gap: 120 }),
  }],
  spec: {
    title: "Dewy — skin that actually drinks",
    fps: 30,
    style: "pastel-pop",
    formats: ["9:16", "1:1", "16:9"],
    sound: {
      brief: { voice: "playful", realism: "mixed", materials: ["liquid", "plastic"], space: "room", avoid: ["digital", "gamey"] },
      restraint: 0.5, signature: "auto",
    },
    theme: {
      fonts: { display: "Bricolage Grotesque", body: "Outfit" },
      colors: { bg: "#fff1f4", fg: "#3a1d33", muted: "#9a7a90", accent: "#ff7a9c", accent2: "#7c6cff", card: "#ffffff", blush: "#ffe1ea", plum: "#3a1d33", tired: "#b7a6b1" },
    },
    // the peak: the inflate lands soft, the dot pops like a cork
    sfx: [{ src: "sfx:impact-soft", at: +(PEAK + 0.12 - 0.006).toFixed(3), volume: 0.8 }, { src: "sfx:bubble-pop-2", at: +(PEAK + 0.16 - 0.07).toFixed(3), volume: 1 }],
    fx: { grain: 0.05, flashes: [{ at: PEAK + 0.1, color: "#ffd0dc", duration: 0.14, intensity: 0.3 }] },
    concept: {
      niche: "beauty",
      truth: "Dewy helps tired skin actually drink, feeling plump and awake again.",
      metaphor: "extreme situation — the word skın literally sips the serum through a straw and plumps from hairline to heavy; its i-dot is the brand bead",
      motif: "the pink bead (actor): the i's dot from frame 0, the cork that pops at the peak, then the logo",
      verb: "plump / drink",
      hook: "'Skin, 4 p.m.' — a hairline-thin, sagging word, and a striped straw sliding into it",
      arc: ["hook: 4 p.m. skin, hairline thin", "prior ×3: sip, sip, sip — a little plumper each time", "slurp: the bottle drains", "hold: empty, sputter, silence", "wow: the word inflates and its dot pops off", "lockup: the dot is the mark"],
      colorScript: ["blush + tired mauve, pink only on the bead and the serum", "mauve → plum as it drinks", "pink bloom at the pop", "blush lockup"],
      story: {
        insight: "Tired skin doesn't need ten more steps; it needs one thing it actually drinks.",
        audienceTension: "I drink my two litres and still look like 4 p.m.",
        inherentDrama: "the second a serum disappears into skin: it's absorbed, gone, and the surface fills out",
        orthodoxy: ["water beading on a cheek", "a bottle turning on a pastel plinth", "leaves and botanicals for 'natural'", "a model touching her face", "floating ingredient molecules"],
        structure: "pattern-break",
        template: "extreme-situation",
        clicheControl: {
          obvious: "Water beads on glowing skin, a bottle turns on a pastel pedestal between floating leaves: 'Deep hydration you can feel.'",
          banned: ["droplet", "pedestal", "leaf", "botanical", "molecule", "glow", "deep hydration"],
        },
        candidates: [
          { title: "Control: beads on skin, pedestal", technique: "control", logline: "Water beads on glowing skin, a bottle turns on a pastel pedestal between floating leaves: 'Deep hydration you can feel.'", typicality: 0.92,
            scores: { hook: 2, surprise: 0, emotionalPeak: 1, payoff: 2, brandLinkage: 2, clarity: 5, uniqueness: 0, feasibility: 5 } },
          { title: "Gone in a second", technique: "inherent-drama", logline: "A bead of serum lands on a surface and vanishes into it with a gulp; the surface fills out like a pillow.", typicality: 0.3,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "The straw", technique: "exaggeration (extreme situation) + benign humour, sound-led slurp", logline: "The word skın, hairline-thin at 4 p.m., drinks the serum through a straw, plumping sip by sip; on the last slurp it inflates and its i-dot pops off like a cork — the dot is the brand's bead mark.", typicality: 0.06,
            scores: { hook: 4, surprise: 5, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 5, uniqueness: 5, feasibility: 4 } },
          { title: "The sponge", technique: "metaphor-mining (household, pictorial analogy)", logline: "A dry compressed sponge tablet gets one press of the dropper and swells ten times its size, oddly satisfying, then squeezes into the bead.", typicality: 0.2,
            scores: { hook: 4, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "No shine", technique: "inversion", logline: "Beauty ads sell shine; this one is matte, typographic, and never shows a face — only what the skin says.", typicality: 0.15,
            scores: { hook: 3, surprise: 3, emotionalPeak: 2, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 5 } },
          { title: "Shelf gossip", technique: "perspective-shift, comic", logline: "Nine half-used bottles on a bathroom shelf gossip about the new one that actually got finished.", typicality: 0.18,
            scores: { hook: 4, surprise: 4, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 3 } },
          { title: "Ten steps, one", technique: "cultural-tension", logline: "Everyone sells a ten-step routine; you secretly know you'll do one — nine bottles topple like dominoes, one stays standing.", typicality: 0.25,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "9 a.m. vs 4 p.m.", technique: "consequence / time-leap", logline: "The word 'fresh' wilts letter by letter across a working day; one press and it stands back up.", typicality: 0.22,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
        ],
        chosen: 2,
        beats: [
          { t: 0, beat: "hook: 'Skin, 4 p.m.' — a hairline word sags as a striped straw slides into it", emotion: "curiosity", intensity: 6, sound: "soft plastic tap as the straw lands" },
          { t: 1.55, beat: "prior ×3: sip, sip, sip — each a little plumper", emotion: "amusement", intensity: 5, to: 7, sound: "three bubble sips, rising" },
          { t: SLURP, beat: "the big slurp: the bottle drains, the word swells", emotion: "anticipation", intensity: 7, to: 8.5, sound: "long slurp" },
          { t: 6.7, beat: "hold: empty bottle, the straw sputters, freeze", emotion: "suspense", intensity: 4, sound: "silence 0.5s" },
          { t: PEAK, beat: "peak: the word inflates and its dot pops off like a cork", emotion: "delight", intensity: 10, wow: "the word skın inflates to full weight with a bounce and its i-dot pops off like a cork — the flying dot is the brand's bead mark", sound: "pop + hero hit" },
          { t: 8.7, beat: "payoff: the dot lands as the logo", emotion: "satisfaction", intensity: 9, sound: "Dewy signature" },
          { t: 9.6, beat: "lock + CTA: Skin that actually drinks.", emotion: "warmth", intensity: 8.5 },
        ],
        peakAt: PEAK,
        mnemonic: { visual: "the pink bead: the i-dot that pops off and becomes the mark", sonic: "Dewy's auto signature on the bead landing (same 3 notes every film)", loop: false },
      },
    },
    actors: [{
      id: "bead",
      from: "sip",
      until: "lockup",
      layer: {
        type: "morph", width: BEAD, height: BEAD, inertia: true,
        enter: { type: "pop", duration: 0.35 },
        shapes: [{ at: 0, shape: "svg:assets/dewy-logo.svg#icon" }],
      },
      poses: [
        { scene: "sip", t: 0, ...px(dotAt(0)), scale: beadScale(0) },
        ...SIPS.map((s, i) => ({ scene: "sip", t: s + 0.75, ...px(dotAt(W[i + 1])), scale: beadScale(W[i + 1]), move: 0.3, ease: "expoOut" })),
        { scene: "sip", t: 6.6, ...px(dotAt(W[4])), scale: beadScale(W[4]), move: 1.2, ease: "inOut" },
        { scene: "sip", t: PEAK + 0.12, ...px(dotAt(1)), scale: beadScale(1), move: 0.12, ease: "expoOut" },
        // the cork pop: up and out on an arc, spinning bigger
        { scene: "sip", t: PEAK + 0.5, x: px(dotAt(1)).x + 110, y: px(dotAt(1)).y - 190, scale: 2.0, move: 0.38, ease: "expoOut" },
        { scene: "sip", t: PEAK + 1.1, x: px(dotAt(1)).x + 40, y: px(dotAt(1)).y - 150, scale: 2.2, move: 0.6, ease: "inOut" },
        { scene: "lockup", t: 0.75, snapTo: "lockup-logo", move: 0.75, ease: "expoOut" },
      ],
    }],
    scenes: [
      {
        id: "sip", duration: 8.7,
        background: [{ type: "solid", color: "$bg" }, { type: "spotlight", base: "transparent", color: "#ffffff", y: WORD_Y }],
        camera: { keyframes: [{ t: 0, zoom: 1.0 }, { t: 6.7, zoom: 1.07, ease: "inOut" }, { t: PEAK, zoom: 1.07 }, { t: 8.7, zoom: 1.0, ease: "expoOut" }], punch: [PEAK + 0.1] },
        layers: [
          { type: "text", text: "Skin, 4 p.m.", preset: "blur-rise", fontSize: 72, weight: 600, font: "$body", color: "$muted", y: -470, duration: 5.0, exitPreset: "blur-out", exitAt: 4.6 },
          // pink bloom behind the word at the pop
          { type: "shape", shape: "circle", width: 1100, height: 1100, color: "#ffd0dc", y: WORD_Y, start: PEAK, duration: 1.2, opacity: 0.9, animate: [{ t: 0, scale: 0.1, opacity: 0.9 }, { t: 1.2, scale: 1.4, opacity: 0, ease: "expoOut" }], sound: false },
          // the bottle + straw travel as ONE group (so every format keeps the straw in the bottle): body, serum level, label, cap, straw
          {
            type: "group", id: "bottle", x: GROUP.x, y: GROUP.y, width: 300, height: 540,
            layers: [
              { type: "shape", shape: "rect", width: 210, height: 300, radius: 54, color: "#ffffff", x: rel(BOTTLE).x, y: rel(BOTTLE).y, shadow: "premium", enter: { type: "rise", duration: 0.5 }, inertia: true },
              {
                type: "shape", shape: "rect", width: 170, height: 230, radius: 38, color: "$accent", x: rel(BOTTLE).x, y: rel(BOTTLE).y + 15, origin: "50% 100%", enter: { type: "rise", duration: 0.5 }, sound: false,
                animate: [
                  { t: 0, scaleY: 1 },
                  ...SIPS.map((s, i) => ({ t: s + 0.55, scaleY: 1 - 0.13 * (i + 1), ease: "expoOut" })),
                  { t: SLURP + 1.3, scaleY: 0.04, ease: "inOut" },
                ],
              },
              { type: "text", text: "SERUM", preset: "none", fontSize: 26, weight: 700, font: "$body", color: "#ffffff", letterSpacing: 0.2, x: rel(BOTTLE).x, y: rel(BOTTLE).y + 40, sound: false },
              { type: "shape", shape: "rect", width: 110, height: 70, radius: 18, color: "$plum", x: rel(BOTTLE).x, y: rel(BOTTLE).y - 175, enter: { type: "rise", duration: 0.5 }, sound: false },
              { ...straw, strokeWidth: 36, color: "#f2c3cf", drawDuration: 0.7, ease: "expoOut", start: 0.15, sound: false },
              { ...straw, strokeWidth: 30, color: "#ffffff", drawDuration: 0.7, ease: "expoOut", start: 0.15, sound: "sfx:tap-generic-1" },
              { ...straw, strokeWidth: 30, color: "#ffc2d1", dashed: true, drawDuration: 0.7, ease: "expoOut", start: 0.15, sound: false },
              ...SIPS.map(pulse),
              // the long slurp: serum fills the whole straw, then empties at the dip
              { ...straw, strokeWidth: 15, color: "$accent", start: SLURP, duration: 6.75 - SLURP, drawDuration: 0.45, ease: "out", sound: "sfx:goo-1" },
            ],
          },
          ...SIPS.map((s, i) => ({ type: "text", text: "sip.", preset: "pop", fontSize: 46, weight: 700, color: "$accent", x: BOTTLE.x - 200 - i * 14, y: 80 + i * 60, start: s + 0.1, duration: SLURP - s + 0.3, exitPreset: "fade", exitAt: SLURP - s, sound: false })),
          { type: "text", text: "slurrrp.", preset: "stretch", fontSize: 76, weight: 800, color: "$plum", x: -170, y: 150, start: SLURP + 0.15, duration: 1.4, exitPreset: "fade", exitAt: 1.2, sound: false },
          // the protagonist: hairline → heavy
          {
            type: "morph", id: "word", width: WORD_W, height: WORD_W, y: WORD_Y,
            enter: { type: "reveal-up", duration: 0.45 },
            shapes: [
              { at: 0, shape: `path:${wordAt(W[0])}`, fill: "$tired" },
              ...SIPS.map((s, i) => ({ at: s + 0.7, shape: `path:${wordAt(W[i + 1])}`, fill: ["#ad8fa3", "#9a6f8c", "#7d4a6e"][i], morph: 0.25, ease: "expoOut" })),
              { at: 6.6, shape: `path:${wordAt(W[4])}`, fill: "#5e2f52", morph: 1.2, ease: "inOut" },
              { at: PEAK + 0.12, shape: `path:${wordAt(1)}`, fill: "$plum", morph: 0.12, ease: "expoOut", scale: 1.14 },
              { at: PEAK + 0.6, shape: `path:${wordAt(1)}`, fill: "$plum", morph: 0.45, ease: "outBack", scale: 1 },
            ],
            animate: [
              { t: 0, y: 0, scaleY: 0.96 },
              { t: 1.2, y: 10, scaleY: 0.93, ease: "inOut" },
              { t: SIPS[2] + 0.8, y: 0, scaleY: 1, ease: "inOut" },
            ],
            sound: false,
          },
          { type: "text", text: "Plumped.", preset: "mask-up", fontSize: 84, weight: 800, color: "$plum", x: -170, y: 170, start: PEAK + 0.25, sound: false },
        ],
      },
      {
        id: "lockup", duration: 3.0,
        transition: { type: "match" },
        background: { type: "mesh", colors: ["#ffd6e0", "#fff1f4", "#ffe9d6"], base: "#fff1f4" },
        camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 3.0, zoom: 1, ease: "outQuint" }] },
        layers: [
          { type: "logo", id: "lockup-logo", src: "assets/dewy-logo.svg", parts: "wordmark", frame: "full", mode: "cascade", height: 190, y: -170, start: 0.4 },
          { type: "text", text: "Skin that actually drinks.", preset: "mask-up", fontSize: 72, weight: 700, color: "$plum", y: 20, start: 0.95 },
          { type: "card", variant: "button", title: "Shop the launch →", accent: "$accent", color: "#ffffff", fontSize: 44, y: 190, start: 1.35, press: 2.5, enter: { type: "grow", duration: 0.5 }, inertia: true },
        ],
      },
    ],
  },
};
export default t;
