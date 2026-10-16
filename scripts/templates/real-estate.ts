import { circ, lockupLogo, type TemplateDef } from "./_kit";

// Aster Residences — homes designed around how a family lives. "Your day, drawn": we start with your Tuesday. Each stop
// of the day lights a gold point, your movements join them, then the walls are drawn around them. The last connection —
// dinner, all of you — completes the figure: the day was an A all along. Aster's mark is that constellation.

// ---- the A-asterism (icon units, 280 box): apex, crossbar L/R, feet L/R
const PT = { apex: [140, 30], cbL: [76.4, 170], cbR: [203.6, 170], footL: [40, 250], footR: [240, 250] } as const;
type K = keyof typeof PT;
const DOT_R: Record<K, number> = { apex: 13, cbL: 11, cbR: 11, footL: 11, footR: 11 };
const LINE_W = 4.5;
const bar = (a: K, b: K, w = LINE_W) => {
  const [x1, y1] = PT[a], [x2, y2] = PT[b];
  const len = Math.hypot(x2 - x1, y2 - y1), nx = (-(y2 - y1) / len) * (w / 2), ny = ((x2 - x1) / len) * (w / 2);
  return `M${(x1 + nx).toFixed(2)} ${(y1 + ny).toFixed(2)} L${(x2 + nx).toFixed(2)} ${(y2 + ny).toFixed(2)} L${(x2 - nx).toFixed(2)} ${(y2 - ny).toFixed(2)} L${(x1 - nx).toFixed(2)} ${(y1 - ny).toFixed(2)} Z`;
};
const GOLD = "#d4b373";
const ICON = [bar("apex", "footL"), bar("apex", "footR"), bar("cbL", "cbR")].map((d) => `<path fill="${GOLD}" d="${d}"/>`).join("\n  ")
  + "\n  " + (Object.keys(PT) as K[]).map((k) => `<path fill="${GOLD}" d="${circ(PT[k][0], PT[k][1], DOT_R[k])}"/>`).join("\n  ");

// ---- the figure on the 16:9 canvas: icon unit → px
const F = 2.545, CX = 400, CY = 20;
const cv = (k: K) => ({ x: Math.round(CX + (PT[k][0] - 140) * F), y: Math.round(CY + (PT[k][1] - 140) * F) });
// icon bbox (the actor's box, so svg:#icon lands exactly on the scene's dots + lines)
const BB = { x0: 40 - 11, x1: 240 + 11, y0: 30 - 13, y1: 250 + 11 };
const ACTOR = { w: (BB.x1 - BB.x0) * F, h: (BB.y1 - BB.y0) * F, x: CX + ((BB.x0 + BB.x1) / 2 - 140) * F, y: CY + ((BB.y0 + BB.y1) / 2 - 140) * F };

// one segment of the figure as a path layer (box = the figure's 760 px square around CX, CY)
const SEG_BOX = 760;
const toSeg = (k: K) => { const p = cv(k); return `${(500 + ((p.x - CX) * 1000) / SEG_BOX).toFixed(1)} ${(500 + ((p.y - CY) * 1000) / SEG_BOX).toFixed(1)}`; };
const seg = (a: K, b: K, at: number, dur = 0.55, extra: Record<string, unknown> = {}) => ({
  type: "path", d: `M${toSeg(a)} L${toSeg(b)}`, width: SEG_BOX, height: SEG_BOX, x: CX, y: CY, strokeWidth: LINE_W * F, color: "$accent",
  start: at, drawDuration: dur, ease: "inOut", duration: HANDOFF - at + 0.05, sound: false, ...extra,
});
const dot = (k: K, at: number) => ({
  type: "shape", shape: "circle", width: DOT_R[k] * 2 * F, height: DOT_R[k] * 2 * F, color: "$accent", glow: true, ...cv(k),
  start: at, duration: HANDOFF - at + 0.05, enter: { type: "pop", duration: 0.4 }, inertia: true,
});
const label = (text: string, k: K, at: number, side: 1 | -1, dy = 0) => ({
  type: "text", text, preset: "blur-rise", fontSize: 30, weight: 500, font: "$body", color: "$muted", align: side > 0 ? "left" : "right",
  x: cv(k).x + side * (DOT_R[k] * F + 30) + side * (side > 0 ? 150 : 110), y: cv(k).y + dy, start: at + 0.15, duration: PEAK - at - 0.05, exitPreset: "fade", exitAt: PEAK - at - 0.45, sound: false,
});

/** scene layer → child of the figure group (positions relative to CX, CY) */
const rel = (l: Record<string, unknown>) => ({ ...l, x: ((l.x as number) ?? CX) - CX, y: ((l.y as number) ?? CY) - CY });
const PEAK = 7.6; // the crossbar connects: it's an A
// camera centred on a stop (shifted right so the left-hand headline column stays clear)
const cam = (k: K, zoom: number) => ({ x: cv(k).x - 360 / zoom, y: cv(k).y, zoom });
const HANDOFF = PEAK + 1.0; // the actor (the mark) takes over from the scene's dots + lines
// floor plan (1000 box): outer walls, room splits, door swings — drawn around the stops
const PLAN = "M80 80 H920 V920 H80 Z M80 470 H330 M330 80 V610 M330 610 H520 M520 610 V920 M650 470 H920 M650 80 V470 M770 470 V920 M180 470 A90 90 0 0 1 270 380 M650 560 A90 90 0 0 0 740 650";

const t: TemplateDef = {
  slug: "real-estate",
  order: 5,
  title: "Real estate: your day, drawn",
  niche: "Real estate",
  description: "We start with your Tuesday: the stops of a day light up as gold points, walls are drawn around them, and the last connection reveals the day was your mark all along.",
  tags: ["real estate", "luxury", "floor plan", "constellation", "path", "serif"],
  format: "16:9",
  posterTime: 9.3,
  previewTimes: [0.4, 1.4, 2.9, 4.6, 6.4, 7.4, 7.9, 8.5, 9.9, 12.0],
  logos: [{
    file: "aster-logo.svg",
    build: () => lockupLogo({ icon: ICON, word: "ASTER", font: "Playfair Display", weight: 700, color: "#f6efe2", tracking: 0.12, gap: 90 }),
  }],
  spec: {
    title: "Aster Residences — homes drawn around your day",
    fps: 30,
    style: "luxury",
    formats: ["9:16", "1:1", "4:5"],
    sound: {
      brief: { voice: "luxury", realism: "abstract", materials: ["glass", "paper"], space: "plate", avoid: ["gamey", "cartoon", "digital"] },
      restraint: 0.7, signature: "auto",
    },
    theme: {
      fonts: { display: "Playfair Display", body: "Manrope" },
      colors: { bg: "#0b0a08", fg: "#f6efe2", muted: "#a39a86", accent: GOLD, accent2: "#8c6d3f", card: "#16140f", ivory: "#f4ede0", ink: "#0b0a08" },
    },
    // the peak: the crossbar connects on one bright chime
    sfx: [{ src: "sfx:chime-bright", at: +(PEAK + 0.3 - 0.004).toFixed(3), volume: 0.7 }],
    fx: { grain: 0.1, vignette: 0.5, flashes: [{ at: PEAK + 0.3, color: GOLD, duration: 0.16, intensity: 0.22 }] },
    concept: {
      niche: "real-estate",
      truth: "Aster helps families find a home designed around how they actually live, feeling understood.",
      metaphor: "volta — the stops of an ordinary day become gold points joined by your movements; the last connection reveals the figure is an A: the Aster mark",
      motif: "the A-asterism: five gold points and three lines (built point by point in the scene, then the actor that becomes the logo)",
      verb: "connect / draw around",
      hook: "'We started with your Tuesday.' — one gold point lights at 6:52, first light",
      arc: ["hook: we started with your Tuesday", "prior: stop, line, stop — the day joins up", "then we drew the walls around it", "hold: the plan dims", "wow: dinner, all of you — the last line makes it an A", "lockup: the A is the mark"],
      colorScript: ["ink + one gold point", "ink + gold constellation, muted labels", "ivory wall lines", "ink hold", "gold bloom", "ink + gold lockup"],
      story: {
        insight: "A floor plan is a map of a life that hasn't happened yet.",
        audienceTension: "Every listing shows perfect empty rooms, and I can't see my own messy Tuesday in any of them.",
        inherentDrama: "the moment lines on a plan stop being walls and start being where your mornings happen",
        orthodoxy: ["a golden-hour drone over the skyline", "keys handed over", "'Your dream home awaits'", "a map pin bouncing", "a house icon with a heart"],
        structure: "volta",
        template: "pictorial-analogy",
        clicheControl: {
          obvious: "A golden-hour drone flyover of the skyline, keys handed over, a house icon with a heart: 'Your dream home awaits.'",
          banned: ["skyline", "keys", "dream home", "map pin", "house", "awaits", "drone"],
        },
        candidates: [
          { title: "Control: drone, keys, dream home", technique: "control", logline: "A golden-hour drone flyover of the skyline, keys handed over, a house icon with a heart: 'Your dream home awaits.'", typicality: 0.92,
            scores: { hook: 2, surprise: 0, emotionalPeak: 1, payoff: 1, brandLinkage: 1, clarity: 5, uniqueness: 0, feasibility: 5 } },
          { title: "Your day, drawn", technique: "inversion (life first, walls second) — Goldenberg pictorial analogy", logline: "Homes are sold walls-first; Aster starts with your Tuesday: each stop of the day lights a gold point, your movements join them, the walls are drawn around them, and the last connection — dinner, all of you — reveals the constellation is an A: the Aster mark.", typicality: 0.07,
            scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 5, brandLinkage: 5, clarity: 4, uniqueness: 4, feasibility: 4 } },
          { title: "Pencil marks", technique: "consequence / time-leap", logline: "Pencil height marks climb a doorframe over ten years: 'Ava, 3', 'Ava, 7', 'Ava, 12'.", typicality: 0.28,
            scores: { hook: 4, surprise: 3, emotionalPeak: 5, payoff: 3, brandLinkage: 2, clarity: 5, uniqueness: 3, feasibility: 4 } },
          { title: "The window's view", technique: "perspective-shift", logline: "A window narrates the four families whose mornings it has watched.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 4, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 3 } },
          { title: "Everything fits", technique: "exaggeration (Goldenberg extreme situation), comic", logline: "A room so precisely planned that the sofa, the piano and the dog's bed slide in with satisfying clicks — the dog approves.", typicality: 0.22,
            scores: { hook: 4, surprise: 4, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "One line", technique: "constraint (one continuous line)", logline: "One gold line never lifts: it draws the plan, the family, the table and finally the logo.", typicality: 0.25,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 4, brandLinkage: 3, clarity: 3, uniqueness: 3, feasibility: 4 } },
          { title: "The house chord", technique: "sensory-transposition (sound-led)", logline: "Every room has a sound — a kettle, a piano note, a laugh, a page — and as the plan lights up they stack into one chord: the sonic mnemonic.", typicality: 0.15,
            scores: { hook: 3, surprise: 3, emotionalPeak: 4, payoff: 4, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 4 } },
          { title: "A corner each", technique: "cultural-tension", logline: "Everyone sells views and square feet; families secretly worry whether each of them gets a corner of their own — every corner lights up for someone.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 4, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
        ],
        chosen: 1,
        beats: [
          { t: 0, beat: "hook: 'We started with your Tuesday.' — a gold point at 6:52, first light", emotion: "curiosity", intensity: 6, sound: "one soft glass ping" },
          { t: 1.4, beat: "prior: stop, line, stop — coffee, the door, home, homework, lights out", emotion: "recognition", intensity: 5, to: 7, sound: "a tuned ping per stop, rising" },
          { t: 5.4, beat: "then we drew the walls around it", emotion: "anticipation", intensity: 7, to: 8 },
          { t: 7.05, beat: "hold: the plan dims, one line missing", emotion: "suspense", intensity: 4.5, sound: "silence 0.5s" },
          { t: PEAK, beat: "peak: dinner, all of you — the last line connects", emotion: "warmth / recognition", intensity: 10, wow: "the last connection — dinner, all of you — draws the crossbar and the day's constellation is revealed as an A: the Aster mark", sound: "hero chord" },
          { t: 9.6, beat: "payoff: the A lifts into the lockup", emotion: "belonging", intensity: 9, sound: "Aster signature" },
          { t: 10.4, beat: "lock + CTA: Homes drawn around your day.", emotion: "calm desire", intensity: 8.5 },
        ],
        peakAt: PEAK,
        mnemonic: { visual: "the A-asterism: five gold points, three lines — your day as a letter", sonic: "Aster's auto signature (same notes every film)", loop: false },
      },
    },
    actors: [{
      id: "asterism",
      from: "day",
      until: "lockup",
      layer: { type: "morph", width: ACTOR.w, height: ACTOR.h, start: HANDOFF, shapes: [{ at: 0, shape: "svg:assets/aster-logo.svg#icon" }] },
      poses: [
        { scene: "day", t: 0, x: ACTOR.x, y: ACTOR.y, scale: 1 },
        { scene: "lockup", t: 0.9, snapTo: "lockup-logo", move: 0.9, ease: "inOutQuint" },
      ],
    }],
    scenes: [
      {
        id: "day", duration: 9.6,
        background: [{ type: "solid", color: "$ink" }, { type: "grid", color: "rgba(212,179,115,0.05)", base: "transparent", size: 90 }, { type: "spotlight", base: "transparent", color: "#2a2116", x: CX, y: CY }],
        // the camera stays close on each stop (so the figure is never seen whole), then pulls back on the peak
        camera: {
          keyframes: [
            { t: 0, ...cam("apex", 1.9) },
            { t: 1.4, ...cam("apex", 1.85) }, { t: 1.95, ...cam("cbR", 1.8), ease: "inOutQuint" },
            { t: 2.5, ...cam("cbR", 1.8) }, { t: 3.05, ...cam("footR", 1.8), ease: "inOutQuint" },
            { t: 3.3, ...cam("footR", 1.8) }, { t: 3.75, ...cam("footL", 1.8), ease: "inOutQuint" },
            { t: 4.1, ...cam("footL", 1.8) }, { t: 4.6, ...cam("cbL", 1.8), ease: "inOutQuint" },
            { t: 5.4, x: 190, y: 200, zoom: 1.55, ease: "inOut" },
            { t: 7.05, x: 180, y: 210, zoom: 1.5, ease: "inOut" },
            { t: PEAK + 0.1, x: 180, y: 210, zoom: 1.5 },
            { t: PEAK + 1.1, x: 0, y: 0, zoom: 1.0, ease: "expoOut" },
            { t: 9.6, x: 0, y: 0, zoom: 0.98, ease: "inOut" },
          ],
        },
        layers: [
          // the figure travels as ONE group (children relative to CX, CY) so every format keeps dots, lines, walls and labels together
          {
            type: "group", id: "figure", x: CX, y: CY, width: 1240, height: 880,
            layers: [
              // the walls, drawn around the stops (then they dim away and leave the figure)
              { type: "path", d: PLAN, width: 820, height: 760, x: CX, y: CY, strokeWidth: 3, color: "$ivory", opacity: 0.55, start: 5.4, duration: PEAK - 5.4 + 0.3, drawDuration: 1.4, ease: "inOut", exitAt: undefined, animate: [{ t: 0, opacity: 1 }, { t: 1.6, opacity: 1 }, { t: 2.1, opacity: 0.35, ease: "inOut" }, { t: PEAK - 5.4 + 0.3, opacity: 0, ease: "in" }], sound: false },
              // the day: points + the movements between them
              dot("apex", 0.2),
              seg("apex", "cbR", 1.4), dot("cbR", 1.9),
              seg("cbR", "footR", 2.5), dot("footR", 3.0),
              dot("footL", 3.6),
              seg("footL", "cbL", 4.1), dot("cbL", 4.55),
              seg("cbL", "apex", 4.9, 0.5),
              // the peak: the crossbar — dinner, all of you
              seg("cbL", "cbR", PEAK, 0.35, { strokeWidth: LINE_W * F, ease: "expoOut", sound: undefined }),
              label("6:52 · first light", "apex", 0.2, 1, -10),
              label("7:10 · coffee by the window", "cbR", 1.9, 1),
              label("7:45 · out the door", "footR", 3.0, 1),
              label("6:15 pm · home", "footL", 3.6, -1),
              label("6:40 pm · homework", "cbL", 4.55, -1),
              { type: "text", text: "8:00 pm · dinner, together", preset: "blur-rise", fontSize: 34, weight: 600, font: "$body", color: "$accent", x: CX, y: cv("footL").y + 75, start: PEAK + 0.2, duration: 9.6 - PEAK - 0.2, sound: false },
            ].map(rel),
          },
          { type: "particles", preset: "sparkles", start: PEAK + 0.3, duration: 1.4, count: 30, colors: [GOLD, "#f6efe2"], originX: CX, originY: CY, sound: false },
          // headlines (left column)
          { type: "text", text: "We started with\nyour Tuesday.", preset: "mask-up", fontSize: 92, weight: 700, color: "$fg", align: "left", x: -470, y: -40, depth: 0, adapt: { "9:16": { x: 0, y: -600, align: "center", fontSize: 84 }, "4:5": { x: 0, y: -470, align: "center", fontSize: 76 }, "1:1": { x: 0, y: -390, align: "center", fontSize: 68 } },  duration: 5.2, exitPreset: "blur-out", exitAt: 4.8, lineHeight: 1.08 },
          { type: "text", text: "Then we drew\nthe walls.", preset: "mask-up", fontSize: 92, weight: 700, color: "$fg", align: "left", x: -470, y: -40, depth: 0, adapt: { "9:16": { x: 0, y: -600, align: "center", fontSize: 84 }, "4:5": { x: 0, y: -470, align: "center", fontSize: 76 }, "1:1": { x: 0, y: -390, align: "center", fontSize: 68 } },  start: 5.3, duration: PEAK - 5.3 - 0.1, exitPreset: "blur-out", exitAt: PEAK - 5.3 - 0.45, lineHeight: 1.08 },
          { type: "text", text: "A home drawn\naround your day.", preset: "mask-up", fontSize: 92, weight: 700, color: "$fg", align: "left", x: -470, y: -40, depth: 0, adapt: { "9:16": { x: 0, y: -600, align: "center", fontSize: 84 }, "4:5": { x: 0, y: -470, align: "center", fontSize: 76 }, "1:1": { x: 0, y: -390, align: "center", fontSize: 68 } },  start: PEAK + 0.2, lineHeight: 1.08, highlight: { words: ["your", "day."], color: "$accent", at: 0.8 }, sound: false },
        ],
      },
      {
        id: "lockup", duration: 2.8,
        transition: { type: "match" },
        background: [{ type: "solid", color: "$ink" }, { type: "spotlight", base: "transparent", color: "#2a2116", y: -100 }],
        camera: { keyframes: [{ t: 0, zoom: 1.03 }, { t: 2.8, zoom: 1, ease: "outQuint" }] },
        layers: [
          { type: "logo", id: "lockup-logo", src: "assets/aster-logo.svg", parts: "wordmark", frame: "full", mode: "mask", height: 200, y: -110, start: 0.6, revealDuration: 1.1 },
          { type: "text", text: "Residences drawn around your day", preset: "tracking", fontSize: 36, weight: 500, font: "$body", color: "$muted", uppercase: true, y: 70, start: 1.0 },
          { type: "card", variant: "button", title: "Book a private viewing", accent: "$accent", color: "#0b0a08", fontSize: 38, y: 200, start: 1.3, press: 2.4, enter: { type: "unfold-x", duration: 0.6 } },
        ],
      },
    ],
  },
};
export default t;
