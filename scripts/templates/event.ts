import { circ, lockupLogo, type TemplateDef } from "./_kit";

// PULSAR — a one-night event / music drop, beat-locked at 128 BPM. "Most nights blur": every weekend date smears past
// on the kick, grey and out of focus, with PULSAR's ring pulsing blurred behind them. The stream stops; on the drop the
// ring snaps into razor focus and the NEXT date in the sequence — SAT 10.24 — lands pin-sharp: "This one won't."

const BEAT = 60 / 128;
// Saturday 10.24 is the night. The stream is every Fri/Sat before it, oldest first; the last slots come on half-beats.
const DATES = ["FRI 08.28", "SAT 08.29", "FRI 09.04", "SAT 09.05", "FRI 09.11", "SAT 09.12", "FRI 09.18", "SAT 09.19", "FRI 09.25", "SAT 09.26", "FRI 10.02", "SAT 10.03", "FRI 10.09", "SAT 10.10", "FRI 10.16", "SAT 10.17", "FRI 10.23"];
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12.5, 13, 13.5, 14];
const STREAM_END = 14.5; // beats: the stream stops here → the stopdown
const DROP = 16; // beats: the focus snap (7.5s)
const ROWS = [-430, 90, -200, 330, -560, -40, 200, -330, 420];

const smear = (date: string, i: number) => {
  const b0 = SLOTS[i], b1 = SLOTS[i + 1] ?? STREAM_END;
  const dir = i % 2 ? "whip-right" : "whip-left";
  const drift = i % 2 ? -90 : 90;
  return {
    // graphic, not copy: glyph outlines (morph text:) so the smear reads as texture; echoes trail it like a long exposure
    type: "morph", shapes: [{ at: 0, shape: `text:${date}` }], font: "$display", weight: 800, fill: "$smear", width: 980, height: 220,
    opacity: 0.85, blur: 11, repeat: { count: 3, x: -drift * 0.55, opacity: 0.45 },
    x: (i % 3 - 1) * 60, y: ROWS[i % ROWS.length], start: `beat:${b0}`, duration: (b1 - b0) * BEAT + 0.05,
    enter: { type: dir, duration: 0.22 }, exit: { type: "fade", duration: 0.12 },
    animate: [{ t: 0, x: 0 }, { t: (b1 - b0) * BEAT, x: drift, ease: "linear" }],
    sound: i % 2 ? false : undefined,
  };
};

const t: TemplateDef = {
  slug: "event",
  order: 6,
  title: "Event: most nights blur",
  niche: "Event / music drop",
  description: "Beat-locked at 128 BPM: weekend after weekend smears past out of focus; on the drop your ring snaps sharp and the next date lands pin-sharp — this one won't blur.",
  tags: ["event", "music", "nightlife", "beat-synced", "kinetic type", "focus pull", "neon"],
  format: "9:16",
  posterTime: 9.0,
  previewTimes: [0.3, 1.2, 3.4, 6.0, 7.1, 7.55, 7.7, 8.3, 9.6, 11.6],
  logos: [{
    file: "pulsar-logo.svg",
    build: () => lockupLogo({
      icon: `<path fill="#ff2bd6" fill-rule="evenodd" d="${circ(140, 140, 124)} ${circ(140, 140, 96)}"/>
  <path fill="#22e1ff" fill-rule="evenodd" d="${circ(140, 140, 76)} ${circ(140, 140, 52)}"/>
  <path fill="#f4f1ff" d="${circ(140, 140, 26)}"/>`,
      word: "PULSAR", font: "Unbounded", weight: 800, color: "#f4f1ff", size: 120,
    }),
  }],
  spec: {
    title: "PULSAR — this one won't blur",
    fps: 30,
    style: "neon",
    formats: ["16:9", "1:1", "4:5"],
    bpm: 128,
    beatOffset: 0,
    sound: {
      brief: { voice: "raw", realism: "abstract", materials: ["air", "metal"], space: "hall", avoid: ["cartoon"] },
      restraint: 0.4, signature: "auto",
    },
    theme: {
      fonts: { display: "Unbounded", body: "Space Grotesk" },
      colors: { bg: "#05040a", fg: "#f4f1ff", muted: "#8b86a8", accent: "#ff2bd6", accent2: "#22e1ff", card: "#12101c", smear: "#77728c" },
    },
    fx: { grain: 0.14, vignette: 0.5, chromatic: 1.5, flashes: [{ at: DROP * BEAT, color: "#ff2bd6", duration: 0.12, intensity: 0.55 }] },
    concept: {
      niche: "events",
      truth: "PULSAR gives the city's night crowd the one night they'll still talk about, feeling electric.",
      metaphor: "focus pull — weekend after weekend smears past out of focus; the one that matters snaps sharp, and the sharp thing is the PULSAR ring",
      motif: "the PULSAR ring (actor), blurred and pulsing on the kick from frame 0, pulled into focus on the drop, then the logo",
      verb: "clarify (blur → sharp)",
      hook: "grey weekend dates whip past smeared on every kick; crisp over them: 'Most nights blur.'",
      arc: ["hook: most nights blur", "tension: the dates accelerate to half-beats", "stopdown: black, the blurred ring alone", "wow: the drop — the ring snaps sharp, SAT 10.24 lands", "lockup: the ring is the logo + tickets"],
      colorScript: ["black + smeared grey, magenta only as a blur", "grey stream accelerating", "black hold", "magenta flash, everything sharp", "black lockup"],
      story: {
        insight: "You don't remember most Saturdays. You remember the one that was different.",
        audienceTension: "Every flyer promises the best night ever, and every weekend blurs into the last one.",
        inherentDrama: "the drop: one bar of silence, then the whole room snaps into the same second",
        orthodoxy: ["a 3-2-1 countdown", "laser beams over a crowd", "hands in the air in silhouette", "speaker cones pulsing", "confetti cannons and 'See you there'"],
        structure: "abt",
        clicheControl: {
          obvious: "A 3-2-1 countdown tunnels through a pulsing ring, lasers sweep a crowd with hands in the air, speakers pump, confetti: 'See you there.'",
          banned: ["countdown", "laser", "confetti", "see you there", "hands in the air", "link in bio"],
        },
        candidates: [
          { title: "Control: countdown, lasers, confetti", technique: "control", logline: "A 3-2-1 countdown tunnels through a pulsing ring, lasers sweep a crowd with hands up, speakers pump, confetti: 'See you there.'", typicality: 0.9,
            scores: { hook: 3, surprise: 0, emotionalPeak: 1, payoff: 2, brandLinkage: 2, clarity: 5, uniqueness: 0, feasibility: 5 } },
          { title: "Most nights blur", technique: "cultural-tension", logline: "Every flyer says 'best night ever' but the weekends secretly blur together: grey weekend dates smear past on every kick, the stream stops, and on the drop the PULSAR ring snaps into focus with the next date, SAT 10.24, pin-sharp.", typicality: 0.12,
            scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 5, uniqueness: 4, feasibility: 5 } },
          { title: "The oldest DJ", technique: "metaphor-mining (astronomy)", logline: "A pulsar is a dead star that keeps perfect time; its lighthouse sweeps wake a sleeping city window by window at 128 BPM, then collapse into the PULSAR ring.", typicality: 0.08,
            scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 5, clarity: 3, uniqueness: 5, feasibility: 3 } },
          { title: "The flyer can't hold the bass", technique: "exaggeration, benign humour, sound-led", logline: "A tidy Swiss-grid event poster shakes apart on every kick until the drop blows every letter off-screen and only the ring survives.", typicality: 0.25,
            scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "One square in 52", technique: "perspective-shift", logline: "One Saturday on a year-calendar, ignored for 51 weeks, starts pulsing and grows until it fills the screen.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "The Monday after", technique: "consequence (Goldenberg consequences)", logline: "The night's ripple keeps pulsing faintly through Monday, Tuesday, Wednesday — you're still feeling it.", typicality: 0.15,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 4 } },
          { title: "The quietest event ad", technique: "inversion (sound-led silence)", logline: "Six seconds of black and silence with one tiny dot ticking, then the drop.", typicality: 0.18,
            scores: { hook: 2, surprise: 4, emotionalPeak: 4, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 5 } },
          { title: "The city's eyes", technique: "forced-connection (kit shape: eye)", logline: "A tired city's windows blink shut one by one; PULSAR keeps one eye open all night.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 3, feasibility: 4 } },
        ],
        chosen: 1,
        beats: [
          { t: 0, beat: "hook: smeared weekend dates whip past on the kick — 'Most nights blur.'", emotion: "recognition", intensity: 7, sound: "air whip on every kick" },
          { t: 1.9, beat: "tension: the dates accelerate to half-beats, the blurred ring pulses behind them", emotion: "restlessness", intensity: 6, to: 8 },
          { t: 6.8, beat: "stopdown: black, only the blurred ring", emotion: "suspense", intensity: 4, sound: "silence 0.7s" },
          { t: 7.5, beat: "peak: the drop — focus snap", emotion: "exhilaration", intensity: 10, wow: "on the drop the blurred ring snaps into razor focus — it is PULSAR's mark — and the next date in the sequence, SAT 10.24, lands pin-sharp: 'This one won't.'", sound: "hero hit on the drop" },
          { t: 9.4, beat: "payoff: the sharp ring flies into the lockup", emotion: "anticipation", intensity: 9, sound: "PULSAR signature" },
          { t: 10.3, beat: "lock + CTA: Warehouse 9 · Get tickets", emotion: "urgency", intensity: 8.5 },
        ],
        peakAt: 7.5,
        mnemonic: { visual: "the concentric PULSAR ring, blurred → sharp", sonic: "PULSAR's auto signature on the lockup (same notes every film)", loop: false },
      },
    },
    actors: [{
      id: "ring",
      from: "blur",
      until: "lockup",
      layer: {
        type: "morph", width: 640, height: 640, opacity: 0.85,
        loop: { type: "pulse", amplitude: 0.05, speed: 128 / 60 },
        enter: { type: "zoom-out", duration: 0.35 },
        shapes: [{ at: 0, shape: "svg:assets/pulsar-logo.svg#icon" }],
        animate: [
          { t: 0, blur: 34, opacity: 0.55 },
          { t: STREAM_END * BEAT, blur: 34, opacity: 0.55 },
          { t: STREAM_END * BEAT + 0.3, blur: 30, opacity: 0.9, ease: "inOut" },
          { t: DROP * BEAT - 0.02, blur: 30, opacity: 0.9 },
          { t: DROP * BEAT + 0.12, blur: 0, opacity: 1, ease: "expoOut" },
        ],
      },
      poses: [
        { scene: "blur", t: 0, x: 0, y: -60, scale: 1 },
        { scene: "blur", t: STREAM_END * BEAT + 0.6, x: 0, y: -170, scale: 0.92, move: 0.6, ease: "inOut" },
        { scene: "sharp", t: 0.18, x: 0, y: -230, scale: 0.78, move: 0.18, ease: "expoOut" },
        { scene: "lockup", t: 0.6, snapTo: "lockup-logo", move: 0.6, ease: "expoOut" },
      ],
    }],
    scenes: [
      {
        id: "blur", duration: `beats:${DROP}`,
        background: [{ type: "solid", color: "$bg" }, { type: "shader", shader: "warp", colors: ["#2a1030", "#0c1a24", "#05040a"], speed: 0.6, intensity: 0.35 }],
        camera: { keyframes: [{ t: 0, zoom: 1.0 }, { t: STREAM_END * BEAT, zoom: 1.08, ease: "in" }, { t: DROP * BEAT, zoom: 1.08 }], punch: [0, 2, 4, 6, 8, 10, 12, 13, 14].map((b) => `beat:${b}`) },
        layers: [
          ...DATES.map(smear),
          { type: "text", text: "Most nights blur.", preset: "mask-up", fontSize: 104, weight: 800, color: "$fg", y: 250, start: "beat:0.5", duration: 7 * BEAT, exitPreset: "blur-out", exitAt: 6.5 * BEAT, sound: false },
          { type: "text", text: "Into the next one.", preset: "mask-up", fontSize: 84, weight: 700, font: "$body", color: "$muted", y: 250, start: "beat:8", duration: (STREAM_END - 8) * BEAT, exitPreset: "blur-out", exitAt: (STREAM_END - 8.5) * BEAT, sound: false },
        ],
      },
      {
        id: "sharp", duration: "beats:4",
        transition: { type: "match" },
        background: [{ type: "solid", color: "$bg" }, { type: "spotlight", base: "transparent", color: "#3a0a36", y: -230 }],
        camera: { keyframes: [{ t: 0, zoom: 1.1 }, { t: 4 * BEAT, zoom: 1.0, ease: "expoOut" }], punch: ["beat:16", "beat:18"] },
        layers: [
          { type: "shape", shape: "ring", width: 620, height: 620, stroke: "$accent", strokeWidth: 6, y: -230, duration: 0.8, animate: [{ t: 0, scale: 0.85, opacity: 1 }, { t: 0.8, scale: 1.7, opacity: 0, ease: "expoOut" }], sound: false },
          { type: "text", text: "SAT 10.24", preset: "stretch", fontSize: 176, weight: 800, color: "$fg", glow: "$accent", y: 130, start: 0.05 },
          { type: "text", text: "This one won't.", preset: "mask-up", fontSize: 76, weight: 700, font: "$body", color: "$accent2", y: 270, start: "beat:17", sound: false },
        ],
      },
      {
        id: "lockup", duration: "beats:6",
        transition: { type: "match" },
        background: [{ type: "solid", color: "$bg" }, { type: "spotlight", base: "transparent", color: "#2a0a2a", y: -170 }],
        camera: { keyframes: [{ t: 0, zoom: 1.05 }, { t: 6 * BEAT, zoom: 1, ease: "outQuint" }], punch: ["beat:22"] },
        layers: [
          { type: "logo", id: "lockup-logo", src: "assets/pulsar-logo.svg", parts: "wordmark", frame: "full", mode: "glitch", height: 170, y: -170, start: 0.4 },
          { type: "text", text: "SAT 10.24 · WAREHOUSE 9", preset: "tracking", fontSize: 44, weight: 600, font: "$body", color: "$accent2", y: 10, start: 0.8 },
          { type: "card", variant: "button", title: "Get tickets →", accent: "$accent", color: "#ffffff", fontSize: 48, y: 170, start: 1.15, press: 2.2, enter: { type: "pop", duration: 0.4 }, inertia: true },
        ],
      },
    ],
  },
};
export default t;
