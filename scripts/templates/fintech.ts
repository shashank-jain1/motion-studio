import { circ, lockupLogo, type TemplateDef } from "./_kit";

// Kova — automatic round-up savings. "Watch the corners": every purchase rounds up and its price tag loses a corner;
// the four mint offcuts wrap around the now-round tag, and that IS the Kova mark (a disc ringed by four arcs).

// ---- geometry (1000×1000 morph box; the tag is the square 100..900, centre 500,500)
const C = 500, HALF = 400, R0 = 48;
const P = (r: number, deg: number, cx = C, cy = C) => {
  const a = (deg * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
};
/** The price tag with any corners rounded off to the inscribed circle (all four = a circle). Same command count always. */
const tag = (tl: boolean, tr: boolean, br: boolean, bl: boolean) => {
  const [a, b] = [C - HALF, C + HALF]; // 100, 900
  const arc = (x: number, y: number) => `A${HALF} ${HALF} 0 0 1 ${x} ${y}`;
  return [
    `M${C} ${a}`,
    tr ? arc(b, C) : `H${b - R0} A${R0} ${R0} 0 0 1 ${b} ${a + R0} V${C}`,
    br ? arc(C, b) : `V${b - R0} A${R0} ${R0} 0 0 1 ${b - R0} ${b} H${C}`,
    bl ? arc(a, C) : `H${a + R0} A${R0} ${R0} 0 0 1 ${a} ${b - R0} V${C}`,
    tl ? arc(C, a) : `V${a + R0} A${R0} ${R0} 0 0 1 ${a + R0} ${a} H${C}`,
    "Z",
  ].join(" ");
};
/** The offcut a rounded corner leaves behind (k: 0 TL, 1 TR, 2 BR, 3 BL), as a rotation of the TL piece. */
const offcut = (k: number) => {
  const rot = (x: number, y: number) => {
    const a = (k * Math.PI) / 2, dx = x - C, dy = y - C;
    return `${(C + dx * Math.cos(a) - dy * Math.sin(a)).toFixed(1)} ${(C + dx * Math.sin(a) + dy * Math.cos(a)).toFixed(1)}`;
  };
  return `M${rot(100, 148)} A${R0} ${R0} 0 0 1 ${rot(148, 100)} L${rot(500, 100)} A${HALF} ${HALF} 0 0 0 ${rot(100, 500)} Z`;
};
// the mark: disc + four arcs. In the morph box the arcs' outer edge = the box edge (that is how svg:#icon is fit).
const RO = 500, RI = 391, SPAN = 78;
const MID = [225, 315, 45, 135]; // TL, TR, BR, BL diagonals (SVG angles, y down)
const arcSeg = (k: number, ro = RO, ri = RI, cx = C, cy = C) => {
  const a0 = MID[k] - SPAN / 2, a1 = MID[k] + SPAN / 2;
  return `M${P(ro, a0, cx, cy)} A${ro} ${ro} 0 0 1 ${P(ro, a1, cx, cy)} L${P(ri, a1, cx, cy)} A${ri} ${ri} 0 0 0 ${P(ri, a0, cx, cy)} Z`;
};
// logo icon (280 box): Ro 128 / Ri 100 / disc 78 — the same proportions as RO/RI and the settled disc
const ICON = [0, 1, 2, 3].map((k) => `<path fill="#19e6a1" d="${arcSeg(k, 128, 100, 140, 140)}"/>`).join("\n  ")
  + `\n  <path fill="#19e6a1" d="${circ(140, 140, 78)}"/>`;

const PEAK_AT = 7.45;
const TAG_W = 660; // px: the tag is 528px wide (800/1000 of the box)
const TAG_Y = -110;
const SETTLE = PEAK_AT + 0.75; // the disc settles and the arcs lock: the mark is complete
const HANDOFF = SETTLE + 0.5; // the actor takes over from the scene layers
const MINT = "#19e6a1";
// purchase timings (scene "corners", seconds): the price rolls up, then the corner snips off at `snip`
const BUYS = [
  { label: "COFFEE", from: 4.6, to: 5, at: 0, snip: 1.25, add: "+40¢" },
  { label: "BUS FARE", from: 2.75, to: 3, at: 1.85, snip: 2.95, add: "+25¢" },
  { label: "LUNCH", from: 11.2, to: 12, at: 3.5, snip: 4.5, add: "+80¢" },
  { label: "GROCERIES", from: 38.1, to: 39, at: 5.1, snip: 7.45, add: "" },
];
const PEAK = PEAK_AT; // the last snip = the wow
// where each offcut parks after its snip (offset from home) and its little label
const PARK: [number, number, number][] = [[-110, -70, -16], [110, -70, 16], [110, 70, -16], [-110, 70, 16]];

const cutLayer = (k: number) => {
  const snip = BUYS[k].snip;
  const [px, py, pr] = PARK[k];
  const last = k === 3;
  return {
    type: "morph", id: `cut-${k}`, width: TAG_W, height: TAG_W, y: TAG_Y, start: snip - 0.02, duration: HANDOFF - snip + 0.05,
    fill: MINT, sound: false,
    shapes: [{ at: 0, shape: `path:${offcut(k)}` }, { at: SETTLE - snip, shape: `path:${arcSeg(k)}`, morph: 0.6, ease: "inOutQuint" }],
    animate: last
      ? [{ t: 0, x: 0, y: 0 }, { t: 0.18, x: px * 0.5, y: py * 0.5, rotate: pr, ease: "expoOut" }, { t: SETTLE - snip, x: 0, y: 0, rotate: 0, ease: "inOutQuint" }]
      : [
        { t: 0, x: 0, y: 0, rotate: 0 },
        { t: 0.45, x: px, y: py, rotate: pr, ease: "expoOut" },
        { t: PEAK - snip, x: px * 1.08, y: py * 1.08, rotate: pr * 1.2, ease: "inOut" },
        { t: SETTLE - snip, x: 0, y: 0, rotate: 0, ease: "inOutQuint" },
      ],
    inertia: true,
  };
};

const t: TemplateDef = {
  slug: "fintech",
  order: 2,
  title: "Fintech round-ups",
  niche: "Fintech",
  description: "Watch the corners: every purchase rounds up and its price tag loses a corner. The four offcuts wrap around the now-round tag and become your mark.",
  tags: ["fintech", "savings", "round-ups", "counter", "morph", "geometric"],
  format: "9:16",
  posterTime: 8.95,
  previewTimes: [0.4, 1.4, 3.2, 5.6, 7.2, 7.6, 8.0, 8.5, 9.4, 11.5],
  logos: [{
    file: "kova-logo.svg",
    build: () => lockupLogo({ icon: ICON, word: "kova", font: "Space Grotesk", weight: 700, color: "#eafff6", gap: 80 }),
  }],
  spec: {
    title: "Kova — saving, without the sharp edges",
    fps: 30,
    style: "minimal-dark",
    formats: ["16:9", "1:1", "4:5"],
    sound: {
      brief: { voice: "precise", realism: "mixed", materials: ["paper", "metal-thin"], space: "room", avoid: ["gamey", "cartoon"] },
      restraint: 0.55, signature: "auto",
    },
    theme: {
      fonts: { display: "Space Grotesk", body: "Inter" },
      colors: { bg: "#0c1218", fg: "#eafff6", muted: "#7d8b96", accent: MINT, accent2: "#4cc9ff", card: "#151d25", tag: "#d9e0e5", ink: "#0c1218", slate: "#3a4650" },
    },
    fx: { grain: 0.06, vignette: 0.4, flashes: [{ at: PEAK + 0.12, color: MINT, duration: 0.14, intensity: 0.28 }] },
    // the snips: one dry switch-snap exactly on each corner's cut (apex = event; switch-snap-1 peaks at 0.105s)
    sfx: [
      ...BUYS.map((b, i) => ({ src: `sfx:switch-snap-${(i % 2) + 1}`, at: +(b.snip - (i % 2 ? 0 : 0.105)).toFixed(3), volume: i === 3 ? 1 : 0.8 })),
      // the peak: the round tag lands soft, then the ring locks with a bright chime
      { src: "sfx:impact-soft", at: +(PEAK + 0.12 - 0.006).toFixed(3), volume: 0.8 },
      { src: "sfx:chime-bright", at: +(SETTLE - 0.004).toFixed(3), volume: 0.7 },
    ],
    concept: {
      niche: "fintech",
      truth: "Kova helps young earners save from every purchase without deciding to, feeling unbothered.",
      metaphor: "fusion — rounding up is literal: each purchase rounds a corner off the price tag; the offcuts are the savings and wrap the round tag into the Kova mark",
      motif: "a grey price tag (actor) that loses its corners one purchase at a time and ends as the Kova disc; its four mint offcuts become the ring",
      verb: "round off / save",
      hook: "'Watch the corners.' — a price ticks from $4.60 to $5.00 and a corner snips off in mint",
      arc: ["hook: watch the corners", "prior ×3: coffee, bus, lunch — each rounds up, each loses a corner", "hold: the last corner trembles", "wow: the tag goes perfectly round and the offcuts wrap it into the mark", "lockup: saving, without the sharp edges"],
      colorScript: ["slate grey world, mint offcuts only", "grey + 3 mint offcuts", "near-black hold", "mint bloom", "ink + mint lockup"],
      story: {
        insight: "Nobody misses forty cents. Everybody misses the moment they decided to save.",
        audienceTension: "I want savings, but saving feels like a diet I have to choose every day.",
        inherentDrama: "the round-up itself: $4.60 quietly becomes $5.00 and the difference slips away",
        orthodoxy: ["a rising green line or arrow", "coins into a jar", "a shield or padlock for 'secure'", "a balance counter slamming up", "'grow your wealth'"],
        structure: "pattern-break",
        template: "interactive-experiment",
        clicheControl: {
          obvious: "A gold coin drops onto a rising green line chart, then locks into a shield: 'Locked down. Always yours.'",
          banned: ["coin", "shield", "lock", "arrow", "chart", "jar", "grow", "locked down"],
        },
        candidates: [
          { title: "Control: coin, rising line, shield", technique: "control", logline: "A gold coin drops onto a rising green line chart and locks into a shield: 'Locked down. Always yours.'", typicality: 0.9,
            scores: { hook: 2, surprise: 0, emotionalPeak: 1, payoff: 2, brandLinkage: 2, clarity: 5, uniqueness: 0, feasibility: 5 } },
          { title: "Watch the corners", technique: "inherent-drama + interactive-experiment (Goldenberg)", logline: "'Watch the corners': each purchase rounds up and its grey price tag loses a corner; at the 4th the tag is perfectly round and the four mint offcuts wrap around it — the Kova mark.", typicality: 0.08,
            scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 5, brandLinkage: 5, clarity: 4, uniqueness: 4, feasibility: 4 } },
          { title: "The tailor", technique: "metaphor-mining (tailoring)", logline: "Kova as a tailor: every purchase gets its hem trimmed and the offcut threads are spooled into a savings reel that becomes the logo.", typicality: 0.12,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 3 } },
          { title: "No peeking", technique: "inversion (don't watch your money)", logline: "Every finance ad says watch your money grow; Kova throws a sheet over the balance and asks you to look away; when it lifts, the savings quietly happened.", typicality: 0.15,
            scores: { hook: 4, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 4 } },
          { title: "Willpower vs Kova", technique: "exaggeration + competition, benign humour", logline: "A willpower battery drains by Thursday and faints face-down, comic, while Kova's ring keeps filling without trying.", typicality: 0.25,
            scores: { hook: 4, surprise: 4, emotionalPeak: 3, payoff: 4, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "Forty cents talks", technique: "perspective-shift", logline: "The forgotten 40¢ narrates its escape from a till drawer to the one place it finally counts.", typicality: 0.18,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 3, feasibility: 3 } },
          { title: "A month of ticks", technique: "sensory-transposition (sound-led)", logline: "Every round-up plays one tick note; a month of coffees composes Kova's three-note sonic signature.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 4, brandLinkage: 4, clarity: 3, uniqueness: 3, feasibility: 4 } },
          { title: "Saving is a diet", technique: "cultural-tension", logline: "Everyone says 'build wealth'; young earners secretly feel saving is a diet — Kova serves the full plate and skims the crumbs.", typicality: 0.22,
            scores: { hook: 3, surprise: 3, emotionalPeak: 2, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
        ],
        chosen: 1,
        beats: [
          { t: 0, beat: "hook: 'Watch the corners.' — $4.60 rolls to $5.00 and a corner snips off in mint", emotion: "curiosity", intensity: 6, sound: "tick-roll + one dry snip" },
          { t: 1.85, beat: "prior ×2: bus fare, lunch — same roll, same snip, offcuts park in the dark", emotion: "intrigue", intensity: 5, to: 7, sound: "snip per corner, rising pitch" },
          { t: 5.1, beat: "groceries: the last corner trembles", emotion: "anticipation", intensity: 7, to: 8 },
          { t: 6.95, beat: "hold: freeze", emotion: "suspense", intensity: 4, sound: "silence 0.5s" },
          { t: 7.45, beat: "peak: last snip — the tag is round and the offcuts wrap it", emotion: "satisfaction", intensity: 10, wow: "the fourth snip makes the tag a perfect circle and all four mint offcuts swing in and bend into a ring around it: the Kova mark, built from your change", sound: "hero hit on the closure" },
          { t: 8.75, beat: "payoff: the mark lifts and snaps into the lockup", emotion: "relief", intensity: 9, sound: "Kova signature" },
          { t: 9.8, beat: "lock + CTA: Saving, without the sharp edges.", emotion: "calm confidence", intensity: 8.5 },
        ],
        peakAt: 7.45,
        mnemonic: { visual: "a disc ringed by four arcs: the price, rounded, wrapped in its own change", sonic: "Kova's auto signature (3 notes, same in every film)", loop: false },
      },
    },
    actors: [{
      // the finished mark: takes over from the scene's tag + offcuts once they have locked into it, then flies to the lockup
      id: "mark",
      from: "corners",
      until: "lockup",
      layer: { type: "morph", width: TAG_W, height: TAG_W, start: HANDOFF, shapes: [{ at: 0, shape: "svg:assets/kova-logo.svg#icon" }] },
      poses: [
        { scene: "corners", t: 0, x: 0, y: TAG_Y, scale: 1 },
        { scene: "lockup", t: 0.8, snapTo: "lockup-logo", move: 0.8, ease: "expoOut" },
      ],
    }],
    scenes: [
      {
        id: "corners", duration: 9.0,
        background: [{ type: "solid", color: "$bg" }, { type: "spotlight", base: "transparent", color: "#18232c", y: TAG_Y }],
        camera: {
          keyframes: [{ t: 0, zoom: 1.0 }, { t: 6.9, zoom: 1.1, ease: "inOut" }, { t: 7.45, zoom: 1.1 }, { t: 9.0, zoom: 0.98, ease: "expoOut" }],
          punch: [PEAK + 0.1],
          shake: { amount: 2, speed: 9, start: 6.2, duration: 0.7 },
        },
        layers: [
          { type: "text", text: "Watch the corners.", preset: "mask-up", fontSize: 96, weight: 700, color: "$fg", y: -620, duration: 3.4, exitPreset: "blur-out", exitAt: 3.0, adapt: { "1:1": { y: -410, fontSize: 64 }, "4:5": { y: -520, fontSize: 80 } } },
          { type: "text", text: "Every purchase, rounded up.", preset: "slide-words", fontSize: 66, weight: 600, font: "$body", color: "$muted", y: -620, start: 3.3, duration: 3.5, exitPreset: "blur-out", exitAt: 3.1, adapt: { "1:1": { y: -410, fontSize: 48 }, "4:5": { y: -520, fontSize: 54 } } },
          // the motif: a grey price tag that loses a corner per purchase, goes round at the peak and settles into the disc
          {
            type: "morph", id: "tag", width: TAG_W, height: TAG_W, y: TAG_Y, duration: HANDOFF + 0.05, inertia: true, sound: false,
            enter: { type: "grow", duration: 0.35 },
            shapes: [
              { at: 0, shape: `path:${tag(false, false, false, false)}`, fill: "$tag" },
              { at: BUYS[0].snip + 0.12, shape: `path:${tag(true, false, false, false)}`, fill: "$tag", morph: 0.14, ease: "expoOut" },
              { at: BUYS[1].snip + 0.12, shape: `path:${tag(true, true, false, false)}`, fill: "$tag", morph: 0.14, ease: "expoOut" },
              { at: BUYS[2].snip + 0.12, shape: `path:${tag(true, true, true, false)}`, fill: "$tag", morph: 0.14, ease: "expoOut" },
              { at: PEAK + 0.12, shape: `path:${tag(true, true, true, true)}`, fill: "$accent", morph: 0.14, ease: "expoOut" },
              { at: SETTLE, shape: `path:${circ(500, 500, 305)}`, fill: "$accent", morph: 0.6, ease: "inOutQuint" },
            ],
            animate: [{ t: 0, scale: 1 }, { t: 6.9, scale: 1.02, ease: "inOut" }, { t: PEAK, scale: 1.02 }, { t: PEAK + 0.25, scale: 1.06, ease: "expoOut" }, { t: SETTLE, scale: 1, ease: "inOutQuint" }],
          },
          // purchases: label + rolling price on the tag
          ...BUYS.flatMap((b, i) => {
            const end = i < 3 ? BUYS[i + 1].at : PEAK;
            const dur = end - b.at;
            return [
              { type: "text", text: b.label, preset: "tracking", fontSize: 40, weight: 600, font: "$body", color: "$slate", y: TAG_Y - 120, start: b.at + 0.05, duration: dur - 0.05, exitPreset: "fade", exitAt: dur - 0.3 },
              { type: "counter", from: b.from, to: b.to, decimals: 2, prefix: "$", countDelay: i === 3 ? 0.9 : 0.55, countDuration: i === 3 ? 0.8 : 0.5, ease: "inOutQuint", fontSize: 150, weight: 700, color: "$ink", y: TAG_Y + 20, start: b.at, duration: dur, enter: { type: "slide-up", duration: 0.35 }, exit: { type: "fade", duration: 0.2 }, sound: false },
            ];
          }),
          // what each offcut was worth, next to where it parks
          ...BUYS.slice(0, 3).map((b, k) => ({
            type: "text", text: b.add, preset: "pop", fontSize: 50, weight: 700, color: "$accent",
            x: [-330, 330, 330][k], y: [-520, -520, 250][k], start: b.snip + 0.3, duration: PEAK - b.snip - 0.5, exitPreset: "fade", exitAt: PEAK - b.snip - 0.8, sound: false,
          })),
          ...[0, 1, 2, 3].map(cutLayer),
          // the closure: shockwave + a little mint dust at the peak
          { type: "shape", shape: "ring", width: 820, height: 820, stroke: "$accent", strokeWidth: 5, y: TAG_Y, start: PEAK + 0.5, duration: 0.9, opacity: 0.8, animate: [{ t: 0, scale: 0.9, opacity: 0.9 }, { t: 0.9, scale: 1.45, opacity: 0, ease: "expoOut" }], sound: false },
          { type: "particles", preset: "sparkles", start: PEAK + 0.5, duration: 1.4, count: 26, colors: [MINT, "#eafff6"], originY: TAG_Y, sound: false },
          { type: "text", text: "Saved. Without noticing.", preset: "blur-rise", fontSize: 64, weight: 600, font: "$body", color: "$fg", y: 285, start: PEAK + 0.35, sound: false, adapt: { "16:9": { y: 395, fontSize: 48 }, "1:1": { y: 420, fontSize: 52 }, "4:5": { y: 500, fontSize: 56 } } },
        ],
      },
      {
        id: "lockup", duration: 3.0,
        transition: { type: "match" },
        background: [{ type: "solid", color: "$bg" }, { type: "spotlight", base: "transparent", color: "#0f3a32", y: -160 }],
        camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 3.0, zoom: 1, ease: "outQuint" }] },
        layers: [
          { type: "logo", id: "lockup-logo", src: "assets/kova-logo.svg", parts: "wordmark", frame: "full", mode: "cascade", height: 200, y: -170, start: 0.6 },
          { type: "text", text: "Saving, without\nthe sharp edges.", preset: "mask-up", fontSize: 76, weight: 700, color: "$fg", y: 30, start: 1.0, lineHeight: 1.05 },
          { type: "card", variant: "button", title: "Open an account", accent: "$accent", color: "#0c1218", fontSize: 44, y: 230, start: 1.4, press: 2.6, enter: { type: "grow", duration: 0.5 }, inertia: true },
        ],
      },
    ],
  },
};
export default t;
