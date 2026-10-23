/** Original editorial interaction film: native, editable layers; no footage or audio from the reference. */
import { SpecSchema, type Layer, type Spec } from "../spec/schema";
import { pickWinner, type CandidateInput } from "../../core/story";

export type DesignFilmOptions = { title?: string; brand?: string; accent?: string; background?: string; foreground?: string; tagline?: string; typography?: "graphic" | "cinematic" };
export const DESIGN_SPARK = "M500 40 C560 260 740 440 960 500 C740 560 560 740 500 960 C440 740 260 560 40 500 C260 440 440 260 500 40 Z";

export const buildDesignFilm = (o: DesignFilmOptions = {}): Spec => {
  const ink = o.foreground ?? "#17161c", paper = o.background ?? "#f1f0eb", purple = o.accent ?? "#7040ff", lime = "#d5fa65";
  const brand = o.brand ?? "MOTION STUDIO";
  const cinematic = o.typography === "cinematic";
  const text = (s: string, opts: Partial<Extract<Layer, { type: "text" }>> = {}): Layer => ({ type: "text", text: s, preset: "none", fontSize: 120,
    font: (opts.fontSize ?? 120) >= 80 ? "$display" : "$body",
    weight: cinematic ? 500 : 800, letterSpacing: cinematic ? -0.035 : -0.065, lineHeight: cinematic ? 1 : 0.94, color: ink, sound: false, ...opts });
  const rule = (y: number, c = ink): Layer => ({ type: "shape", shape: "line", width: 1660, height: 1, y, color: c, opacity: 0.18, sound: false });
  const chrome = (chapter: string, c = ink): Layer[] => [
    text(brand, { fontSize: 17, weight: 600, letterSpacing: 0.06, x: -698, y: -458, color: c }),
    text(chapter, { fontSize: 16, weight: 500, letterSpacing: 0.04, x: 665, y: -458, color: c }),
    rule(415, c),
    text("DESIGNED IN MOTION / BUILT TO CONNECT", { fontSize: 15, weight: 500, letterSpacing: 0.08, x: -575, y: 448, color: c }),
    text("00:20 / MOTION STUDY 02", { fontSize: 14, weight: 500, letterSpacing: 0.06, x: 670, y: 448, color: c }),
  ];
  const candidates: CandidateInput[] = [
    { title: "Portfolio montage", technique: "control", logline: "Fast typography lists the studio's tools and ends on a logo.", typicality: 0.8, scores: { hook: 2, surprise: 1, emotionalPeak: 2, payoff: 2, brandLinkage: 2, clarity: 4, uniqueness: 1, feasibility: 5 } },
    { title: "The cursor composes", technique: "inherent-drama", logline: "A cursor selects a word, draws an idea and turns a finished design into the studio's mark.", typicality: 0.2, scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 5, uniqueness: 4, feasibility: 5 } },
    { title: "Sound draws the picture", technique: "sound-led / sensory-transposition", logline: "A click becomes a contour, each contour becomes a syllable of the studio's identity.", typicality: 0.22, scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 3, uniqueness: 4, feasibility: 4 } },
    { title: "The ornament resigns", technique: "humour / inversion", logline: "Decorative shapes quit until the cursor gives them a useful job in a design system.", typicality: 0.18, scores: { hook: 4, surprise: 4, emotionalPeak: 3, payoff: 4, brandLinkage: 4, clarity: 3, uniqueness: 4, feasibility: 4 } },
    { title: "Inside the handle", technique: "perspective-shift", logline: "A selection handle becomes a portal into the studio's design process.", typicality: 0.22, scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 4 } },
    { title: "One line only", technique: "constraint", logline: "A single purple line must become every interaction before resolving into a studio signature.", typicality: 0.2, scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 3, uniqueness: 4, feasibility: 3 } },
    { title: "Design is a relay", technique: "forced-connection / pictorial-analogy", logline: "A moving design token passes through research, prototype and delivery as a relay baton.", typicality: 0.25, scores: { hook: 3, surprise: 3, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 4, uniqueness: 3, feasibility: 5 } },
    { title: "Everything is a button", technique: "exaggeration", logline: "A giant switch turns an overloaded canvas into one coherent identity.", typicality: 0.25, scores: { hook: 4, surprise: 3, emotionalPeak: 4, payoff: 4, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 5 } },
  ];
  const ranking = pickWinner(candidates);
  const process: Layer[] = [];
  ["RESEARCH", "SHAPE", "PROTOTYPE", "SHIP IT"].forEach((label, i) => {
    const x = i * 660;
    process.push({ type: "shape", shape: "rect", width: 460, height: 150, radius: 75, x, color: i === 3 ? lime : purple,
      sound: false }, text(label, { x, fontSize: label === "PROTOTYPE" ? 55 : 64, weight: 700, letterSpacing: -0.04, color: i === 3 ? ink : paper }));
    if (i < 3) process.push({ type: "path", d: "M0 500 C300 50 700 950 1000 500 M920 390 L1000 500 L900 570", width: 200, height: 100,
      x: x + 330, color: purple, strokeWidth: 3, drawStart: i * 0.8 + 0.1, drawDuration: 0.5, sound: false });
  });
  return SpecSchema.parse({ title: o.title ?? "Motion with meaning", format: "16:9", fps: 30, style: cinematic ? "cinematic-editorial" : "editorial",
    theme: { fonts: { display: cinematic ? "Cormorant Garamond" : "Inter", body: cinematic ? "Manrope" : "Inter", mono: "JetBrains Mono" }, colors: { bg: paper, fg: ink, accent: purple, accent2: lime, muted: "#7b7984" } },
    concept: { truth: `${brand} helps creators turn ideas into deliberate, connected motion.`, niche: "creator", verb: "connect",
      metaphor: "An editor's cursor gives a moving shape a purpose.", motif: "The purple design gesture becomes the spark mark.",
      hook: "A giant unfinished command is selected and completed by a cursor.", arc: ["select", "shape", "activate", "build", "deliver", "resolve"],
      colorScript: [paper, paper, ink, purple, paper, paper],
      story: { audienceTension: "A film can contain many effects and still feel arbitrary.", insight: "The gesture matters when the next action inherits its intent.",
        inherentDrama: "A cursor turns motion into an explicit design choice.", orthodoxy: ["unrelated effect montage", "claims about quality without a visible example", "generic logo outro"],
        structure: "transformation", candidates: [...ranking.ranked].sort((a, b) => a.index - b.index).map((c) => ({ ...c })), chosen: ranking.winner?.index ?? 1,
        clicheControl: { obvious: "List features over unrelated showreel shots.", banned: ["unrelated effect montage", "borrowed creator identity", "invented client metrics"] },
        beats: [{ t: 0, beat: "hook", intensity: 6, to: 7 }, { t: 3, beat: "tension", intensity: 5, to: 7 },
          { t: 6, beat: "transformation", intensity: 6, to: 8 }, { t: 9, beat: "build", intensity: 7, to: 8 },
          { t: 12.6, beat: "transformation", intensity: 7, to: 5 }, { t: 15.4, beat: "peak", intensity: 10, wow: "The travelling process token reaches SHIP IT; the spark becomes a brand signature." },
          { t: 16, beat: "lock", intensity: 8.5, to: 8.5 }], peakAt: 15.4,
        mnemonic: { visual: "The drawn spark returns as the studio's mark.", sonic: "A related, tuned signature closes the same plastic/paper sonic family.", loop: false } } },
    sound: { volume: 0.74, brief: { voice: "precise", realism: "mixed", materials: ["plastic", "paper"], key: "D minor", space: "room" },
      restraint: 0.45, variation: 0.2, continuity: { cohesion: 0.95, bridgeVolume: 0.16, maxGap: 4.5 } },
    scenes: [
      { id: "select", duration: 3, background: { type: "solid", color: paper }, fx: { grain: 0.025 }, layers: [
        ...chrome("01 / THE GESTURE"),
        ...[-270, 220].map((y) => ({ type: "shape", shape: "line", width: 1920, height: 1, y, color: ink, opacity: 0.13, sound: false })),
        text("MAKE IT", { id: "make", fontSize: 240, y: -150, preset: "mask-up", by: "line", unitDuration: 0.55,
          sound: undefined, accents: [{ at: 0.4, role: "move", importance: "structural", material: "paper" }] }),
        text("MOVE", { id: "move", fontSize: 310, y: 90, preset: "mask-up", start: 0.25, by: "line", unitDuration: 0.6 }),
        { type: "shape", shape: "circle", width: 48, height: 48, x: 510, y: 160, color: purple, start: 1.25, enter: { type: "grow", duration: 0.2 }, sound: false },
        { type: "selection", width: 1080, height: 260, y: 90, start: 1.25, label: "Motion / 01", color: purple, dimensions: true,
          exit: { type: "fade", duration: 0.25 }, sound: false },
        { type: "cursor", id: "select-pointer", size: 40, color: purple, label: "Create", clicks: [1.25],
          animate: [{ t: 0, x: 740, y: 370, opacity: 0 }, { t: 0.5, x: 740, y: 370, opacity: 1 },
            { t: 1.25, x: 485, y: 165, ease: "inOutQuint" }, { t: 2.35, x: 485, y: 165 }, { t: 2.9, x: 820, y: 520, ease: "inExpo" }] },
      ] },
      { id: "shape", duration: 3, transition: { type: "cut", sound: false }, background: { type: "solid", color: paper }, fx: { grain: 0.025 }, layers: [
        ...chrome("02 / GIVE IT PURPOSE"),
        { type: "path", id: "draw-spark", d: DESIGN_SPARK, width: 820, height: 820, x: 330, y: 15,
          color: purple, strokeWidth: 3, drawDuration: 1.1, fill: ink, fillAt: 1.1, fillDuration: 0.18,
          follower: { cursor: "pen", color: purple, size: 35, label: "Shape", hideAfterDraw: true },
          animate: [{ t: 0, rotate: -12, scale: 0.9 }, { t: 2.8, rotate: 18, scale: 1.05, ease: "inOut" }],
          accents: [{ at: 0.5, role: "move", importance: "structural", material: "paper" }, { at: 1.27, role: "impact", importance: "structural", material: "plastic", volume: 0.5 }] },
        text("LESS", { fontSize: 240, y: -130, x: -210, italic: cinematic, color: "white", blendMode: "difference", start: 0.3, preset: "mask-up", by: "line", unitDuration: 0.5 }),
        text("DECORATION.", { fontSize: 178, y: 95, color: "white", blendMode: "difference", start: 0.5, preset: "mask-up", by: "line", unitDuration: 0.5 }),
      ] },
      { id: "activate", duration: 3, transition: { type: "cut", sound: false }, background: { type: "solid", color: ink }, layers: [
        ...chrome("03 / THE DECISION", paper),
        text("MORE INTENTION.", { fontSize: 150, y: -250, color: paper, preset: "mask-up", by: "line", unitDuration: 0.6 }),
        { type: "toggle", id: "intention-switch", width: 360, height: 164, y: -5, color: purple, states: [{ at: 1.3, on: true }], stateDuration: 0.32 },
        text("JUST MOVING", { fontSize: 30, weight: 500, letterSpacing: 0.06, y: 165, color: "#94909d", duration: 1.3 }),
        text("MOVING WITH PURPOSE", { fontSize: 36, weight: 600, letterSpacing: 0.03, y: 165, color: lime, start: 1.3, preset: "mask-up", by: "line", unitDuration: 0.4 }),
        { type: "cursor", size: 40, color: lime, clicks: [1.3], sound: false,
          animate: [{ t: 0, x: 650, y: 300, opacity: 0 }, { t: 0.3, x: 500, y: 250, opacity: 1 }, { t: 1.3, x: -90, y: 0, ease: "inOutQuint" },
            { t: 1.65, x: -90, y: 0 }, { t: 2.4, x: 640, y: 320, ease: "inOutQuint" }, { t: 2.7, opacity: 0 }] },
      ] },
      { id: "build", duration: 3.6, transition: { type: "cut", sound: false }, background: { type: "solid", color: purple }, layers: [
        ...chrome("04 / ONE VISUAL LANGUAGE", paper),
        text("BUILD", { y: -260, fontSize: 36, weight: 500, letterSpacing: 0.16, color: paper }),
        ...["SYSTEMS.", "PRODUCTS.", "EXPERIENCES."].map((word, i) => text(word, { id: `deliverable-${i}`, start: i * 1.2, duration: 1.2,
          color: paper, fontSize: i === 2 ? 185 : 225, preset: "mask-up", by: "line", unitDuration: 0.4, y: -30,
          sound: undefined, accents: [{ at: 0.2, role: "move", importance: "structural", material: "paper", volume: 0.6 }] })),
        { type: "path", preset: "underline", width: 740, height: 40, y: 145, color: lime, strokeWidth: 5, drawStart: 0.3, drawDuration: 0.6, sound: false },
        text("A consistent idea. Across every interaction.", { fontSize: 29, weight: 400, letterSpacing: -0.02, y: 270, color: paper }),
      ] },
      { id: "process", duration: 3.4, transition: { type: "cut", sound: false }, background: { type: "solid", color: paper }, fx: { grain: 0.025 }, layers: [
        ...chrome("05 / FOLLOW THROUGH"),
        text("GOOD MOTION\nGOES SOMEWHERE.", { fontSize: 96, y: -225, lineHeight: 1.05 }),
        { type: "group", id: "process-rail", width: 1920, height: 300, y: 100, layers: process,
          animate: [{ t: 0, x: 0 }, { t: 0.8, x: -660, ease: "inOutQuint" }, { t: 1.6, x: -1320, ease: "inOutQuint" }, { t: 2.8, x: -1980, ease: "inOutQuint" }, { t: 3.4, x: -1980 }],
          accents: [{ at: 0.4, role: "move", importance: "structural", material: "paper", volume: 0.6 }, { at: 1.2, role: "move", importance: "structural", material: "paper", volume: 0.6 },
            { at: 2.8, role: "impact", importance: "hero", material: "plastic", volume: 0.85 }] },
        { type: "selection", id: "process-focus", width: 492, height: 182, y: 100, color: purple, label: "The active idea", handles: "corners", fillOpacity: 0, sound: false },
        { type: "path", d: DESIGN_SPARK, width: 95, height: 95, x: 0, y: 290, color: purple, fill: purple, drawDuration: 0.4,
          fillAt: 0.4, start: 2.8, sound: false, animate: [{ t: 0, scale: 0.3, rotate: -90 }, { t: 0.5, scale: 1, rotate: 0, ease: "outBack" }] },
      ] },
      { id: "resolve", duration: 4, transition: { type: "cut", sound: false }, background: { type: "solid", color: paper }, fx: { grain: 0.025 }, layers: [
        ...chrome("06 / EVERY FRAME CONNECTED"),
        { type: "path", id: "signature", d: DESIGN_SPARK, width: 290, height: 290, x: -565, y: -35, color: purple, fill: purple,
          drawDuration: 0.4, fillAt: 0, fillDuration: 0.1,
          animate: [{ t: 0, x: 565, y: 325, scale: 0.33, rotate: -45 }, { t: 0.6, x: 0, y: 0, scale: 1, rotate: 0, ease: "outQuint" }],
          accents: [{ at: 0.6, role: "logoHit", importance: "structural", material: "plastic", volume: 0.7 }] },
        text(brand.replace(" ", "\n"), { fontSize: 150, lineHeight: 0.95, align: "left", x: 155, y: -40, maxWidth: 1000,
          start: 0.2, preset: "mask-up", by: "line", stagger: 0.08, unitDuration: 0.55 }),
        text(o.tagline ?? "Motion with meaning.", { fontSize: 44, weight: 500, letterSpacing: -0.03, y: 240, start: 0.6, preset: "mask-up", by: "line", unitDuration: 0.5 }),
      ] },
    ],
  });
};
