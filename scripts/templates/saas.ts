import { circ, lockupLogo, type TemplateDef } from "./_kit";

// Flowline — workflow automation (SaaS). "The invoice that waited": Invoice #4471 has spent nine days hopping between
// grey inbox, sheet and chat windows ("who owns this?"). A small blue dot waits at the edge of frame the whole time —
// where the invoice is trying to get to. One blue line draws itself through every window; the invoice snaps onto it and
// zips through all four approvals in under a second (four checks, a rising run) into the dot. The dot is Flowline.

const ICON = `<path fill="#2f6bff" d="${circ(64, 80, 44)}"/>
  <path fill="#2f6bff" d="${circ(216, 200, 44)}"/>
  <path fill="#7aa2ff" d="M64 112 C64 190 216 90 216 168 L216 232 C216 154 64 254 64 176 Z"/>`;

// the work: four app windows in a 2×2 grid (group coords). The line snakes through them like the mark's S.
const G = { x: 170, y: 90 }; // the work group's centre (canvas)
const WIN = [
  { x: -250, y: -150, icon: "✉️", title: "Inbox", body: "14 unread" },
  { x: 250, y: -150, icon: "📊", title: "Sheet", body: "v3_FINAL(2).xlsx" },
  { x: -250, y: 170, icon: "💬", title: "Chat", body: "#finance-ops" },
  { x: 250, y: 170, icon: "🗂️", title: "Approvals", body: "queue: 31" },
];
const SEAT = (k: number): [number, number] => [WIN[k].x, WIN[k].y - 6]; // where the invoice sits on a window
const DOT_G: [number, number] = [560, 170]; // the waiting dot (group coords)
const DOT = { x: G.x + DOT_G[0], y: G.y + DOT_G[1] };
const PEAK = 8.0; // the invoice snaps onto the line and zips
const ZIP = 0.95;

// hops: [t, window] — Inbox → Sheet → Chat → Approvals → back to the Inbox (comic); arcs, never long straight moves
const HOPS: [number, number][] = [[0, 0], [1.3, 1], [2.6, 2], [3.9, 3], [5.2, 0]];
const hopKeys = () => {
  const [hx, hy] = SEAT(0);
  const out: Record<string, unknown>[] = [{ t: 0, x: 0, y: 0, rotate: 0 }];
  for (let i = 1; i < HOPS.length; i++) {
    const [x0, y0] = SEAT(HOPS[i - 1][1]), [x1, y1] = SEAT(HOPS[i][1]);
    const t1 = HOPS[i][0], dist = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(dist / 220));
    const start = t1 - 0.6;
    out.push({ t: start, x: x0 - hx, y: y0 - hy, rotate: -3 * i });
    for (let k = 1; k <= n; k++) {
      const f = k / n, arc = Math.sin(Math.PI * f) * 130;
      out.push({ t: start + 0.6 * f, x: x0 + (x1 - x0) * f - hx, y: y0 + (y1 - y0) * f - arc - hy, rotate: (i % 2 ? 9 : -9) * Math.sin(Math.PI * f) - 3 * i, ease: k === n ? "outBack" : "linear" });
    }
  }
  out.push({ t: 6.6, x: 0, y: 14, rotate: -14, ease: "inOut" }); // slumps, tired
  return out;
};
// what each window says when the invoice lands there
const GRIPES = [
  { at: 1.35, k: 1, text: "Re: Re: Fwd: invoice?" },
  { at: 2.65, k: 2, text: "who owns this?" },
  { at: 3.95, k: 3, text: "needs a 2nd sign-off" },
  { at: 5.25, k: 0, text: "bump 👋" },
];
// the line: centripetal-ish Catmull-Rom through every seat to the dot (same points the zip path uses)
const ROUTE: [number, number][] = [SEAT(0), SEAT(1), SEAT(2), SEAT(3), DOT_G];
const LINE_BOX = 1400;
const lb = ([x, y]: [number, number]) => `${(500 + (x * 1000) / LINE_BOX).toFixed(1)} ${(500 + (y * 1000) / LINE_BOX).toFixed(1)}`;
const catmull = (pts: [number, number][]) => {
  let d = `M${lb(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${lb(c1)} ${lb(c2)} ${lb(p2)}`;
  }
  return d;
};
// the zip passes window k at (roughly) its share of the route length
const segL = ROUTE.slice(1).map((p, i) => Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]));
const totL = segL.reduce((a, b) => a + b, 0);
const PASS = WIN.map((_, k) => PEAK + 0.05 + ZIP * Math.pow(segL.slice(0, k).reduce((a, b) => a + b, 0) / totL, 0.6));

const t: TemplateDef = {
  slug: "saas",
  order: 7,
  title: "SaaS: the invoice that waited",
  niche: "SaaS explainer",
  description: "An invoice spends nine days hopping between grey inbox, sheet and chat windows. One blue line appears, and it zips through every approval in a second — into the dot that is your logo.",
  tags: ["saas", "b2b", "explainer", "workflow", "character", "humour"],
  format: "16:9",
  posterTime: 9.0,
  previewTimes: [0.4, 1.0, 2.7, 4.2, 5.6, 6.6, 7.7, 8.25, 8.6, 9.2, 10.4, 12.6],
  logos: [{
    file: "flowline-logo.svg",
    build: () => lockupLogo({ icon: ICON, word: "flowline", font: "Geist", weight: 700, color: "#0d1530", gap: 90 }),
  }],
  spec: {
    title: "Flowline — handoffs that happen by themselves",
    fps: 30,
    style: "apple",
    formats: ["9:16", "1:1"],
    sound: {
      brief: { voice: "precise", realism: "mixed", materials: ["paper", "glass"], space: "room", avoid: ["gamey", "cartoon"] },
      restraint: 0.55, signature: "auto",
    },
    theme: {
      fonts: { display: "Geist", body: "Inter" },
      colors: { bg: "#eef1f6", fg: "#0d1530", muted: "#6b7390", accent: "#2f6bff", accent2: "#7aa2ff", accent3: "#16c79a", card: "#ffffff", warn: "#ff5d5d", grey: "#c9cfdb" },
    },
    fx: { grain: 0.03, flashes: [{ at: PEAK + ZIP, color: "#7aa2ff", duration: 0.12, intensity: 0.2 }] },
    // every landing in limbo is a small paper slap (card-place-3 peaks at 0.32s)
    sfx: [
      ...HOPS.slice(1).map(([t]) => ({ src: "sfx:card-place-3", at: +(t - 0.32).toFixed(3), volume: 0.6 })),
      // the peak: the invoice lands in the dot
      { src: "sfx:impact-soft", at: +(PEAK + ZIP - 0.006).toFixed(3), volume: 0.8 },
    ],
    concept: {
      niche: "saas",
      truth: "Flowline helps ops teams move work between tools without anyone chasing it, feeling in control.",
      metaphor: "perspective shift + time compression — nine days of an invoice's limbo against one second on a single blue line; the line's end dot is the logo",
      motif: "the blue dot (actor) waiting at the edge of frame from frame 0 — the destination — which becomes the Flowline mark",
      verb: "connect / flow",
      hook: "'Every handoff is someone waiting.' — Invoice #4471 hops between grey app windows while a counter reads Day 1",
      arc: ["hook: the invoice and Day 1", "prior ×4: hop, gripe, hop — Day 9, back at the inbox", "a blue line draws through every window", "hold: freeze", "wow: it zips through four approvals in a second", "lockup: the dot is the mark"],
      colorScript: ["cool grey windows, blue only on the waiting dot", "grey + red day counter", "one blue line", "white hold", "green checks + blue", "light lockup"],
      story: {
        insight: "Every handoff is a person waiting for another person.",
        audienceTension: "My job title says operations; my job is chasing things between fourteen tools.",
        inherentDrama: "the handoff: the gap between 'done' and someone noticing it's done",
        orthodoxy: ["floating glassy dashboards", "a node network connecting team avatars", "gears turning", "a cursor clicking 'Get started'", "people high-fiving at a laptop"],
        structure: "contrast",
        template: "dimensionality-alteration",
        clicheControl: {
          obvious: "Floating glass dashboards, a node network connecting smiling avatars, gears turning, a cursor clicks 'Get started': 'Boost productivity.'",
          banned: ["dashboard", "gears", "get started", "high-five", "boost productivity", "puzzle", "all-in-one"],
        },
        candidates: [
          { title: "Control: dashboards, nodes, gears", technique: "control", logline: "Floating glass dashboards, a node network connecting smiling avatars, gears turning, a cursor clicks 'Get started': 'Boost productivity.'", typicality: 0.9,
            scores: { hook: 2, surprise: 0, emotionalPeak: 1, payoff: 1, brandLinkage: 2, clarity: 4, uniqueness: 0, feasibility: 5 } },
          { title: "The invoice that waited", technique: "perspective-shift + dimensionality-alteration (time compression)", logline: "Invoice #4471 spends nine days hopping between grey inbox, sheet and chat windows ('who owns this?') while a blue dot waits at the edge of frame; one blue line appears and it zips through all four approvals in a second into the dot — the Flowline mark.", typicality: 0.1,
            scores: { hook: 4, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 5, uniqueness: 4, feasibility: 4 } },
          { title: "The gap", technique: "inherent-drama", logline: "A task falls into the gap between two apps and lies there, unseen.", typicality: 0.25,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "Leaky pipes", technique: "metaphor-mining (plumbing)", logline: "Work drips through a tangle of leaky pipes between tools; Flowline swaps it for one clean pipe.", typicality: 0.28,
            scores: { hook: 3, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 4, clarity: 4, uniqueness: 3, feasibility: 4 } },
          { title: "Human glue", technique: "exaggeration, comic", logline: "One exhausted cursor drags cards between fourteen windows faster and faster until it wobbles; then the work moves itself and the cursor finally leans back.", typicality: 0.2,
            scores: { hook: 4, surprise: 4, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 4, uniqueness: 4, feasibility: 4 } },
          { title: "Quantized", technique: "sensory-transposition (sound-led)", logline: "Random notification pings snap onto a beat — the chaos becomes a rhythm, the dots line up on one line, and the last notes are the sonic mnemonic.", typicality: 0.12,
            scores: { hook: 3, surprise: 4, emotionalPeak: 4, payoff: 4, brandLinkage: 4, clarity: 3, uniqueness: 4, feasibility: 4 } },
          { title: "Nothing happens", technique: "inversion", logline: "SaaS ads show busy screens; this one shows a calm, empty desk while the work quietly moves off-screen.", typicality: 0.15,
            scores: { hook: 2, surprise: 3, emotionalPeak: 3, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 4, feasibility: 5 } },
          { title: "You are the integration", technique: "cultural-tension", logline: "Everyone sells 'all-in-one'; ops people secretly know they ARE the connector — a person-shaped cable between apps finally gets unplugged.", typicality: 0.2,
            scores: { hook: 3, surprise: 3, emotionalPeak: 4, payoff: 3, brandLinkage: 3, clarity: 3, uniqueness: 3, feasibility: 3 } },
        ],
        chosen: 1,
        beats: [
          { t: 0, beat: "hook: 'Every handoff is someone waiting.' — the invoice hops, Day 1", emotion: "recognition", intensity: 6, sound: "paper hop" },
          { t: 1.3, beat: "prior ×4: hop, gripe, hop — Day 9, sent back to the inbox", emotion: "frustration (comic)", intensity: 5, to: 7, sound: "paper hops, a tick per day" },
          { t: 6.0, beat: "a blue line draws itself through every window; the invoice looks at it", emotion: "anticipation", intensity: 7, to: 8 },
          { t: 7.5, beat: "hold: freeze", emotion: "suspense", intensity: 4.5, sound: "silence 0.5s" },
          { t: PEAK, beat: "peak: it zips through all four approvals in a second", emotion: "relief / delight", intensity: 10, wow: "the invoice snaps onto the blue line and zips through all four windows in under a second — four green checks in a rising run — into the waiting dot: the Flowline mark", sound: "four rising glass pings → hero" },
          { t: 9.8, beat: "payoff: the dot becomes the Flowline mark", emotion: "satisfaction", intensity: 9, sound: "Flowline signature" },
          { t: 10.6, beat: "lock + CTA: Handoffs that happen by themselves.", emotion: "confidence", intensity: 8.5 },
        ],
        peakAt: PEAK,
        mnemonic: { visual: "the blue dot at the end of one line: the Flowline mark", sonic: "four rising pings resolving into Flowline's auto signature", loop: false },
      },
    },
    actors: [{
      id: "dot",
      from: "limbo",
      until: "lockup",
      layer: {
        type: "morph", width: 120, height: 120, inertia: true,
        loop: { type: "breathe", amplitude: 0.08, speed: 0.6 },
        enter: { type: "pop", duration: 0.4 },
        shapes: [
          { at: 0, shape: "circle", fill: "$accent" },
          { at: 10.3, shape: "svg:assets/flowline-logo.svg#icon", morph: 0.5, ease: "inOutQuint" },
        ],
      },
      poses: [
        { scene: "limbo", t: 0, x: DOT.x, y: DOT.y, scale: 0.55 },
        { scene: "limbo", t: PEAK + ZIP - 0.05, x: DOT.x, y: DOT.y, scale: 0.55 },
        { scene: "limbo", t: PEAK + ZIP + 0.2, x: DOT.x, y: DOT.y, scale: 1.0, move: 0.25, ease: "outBack" },
        { scene: "lockup", t: 0.8, snapTo: "lockup-logo", move: 0.8, ease: "expoOut" },
      ],
    }],
    scenes: [
      {
        id: "limbo", duration: 9.8,
        background: [{ type: "solid", color: "$bg" }, { type: "spotlight", base: "transparent", color: "#ffffff", y: 0 }],
        camera: { keyframes: [{ t: 0, zoom: 1.0 }, { t: 7.5, zoom: 1.05, ease: "inOut" }, { t: PEAK, zoom: 1.05 }, { t: 9.8, zoom: 1.0, ease: "expoOut" }], punch: [PEAK + ZIP] },
        layers: [
          { type: "text", text: "Every handoff is\nsomeone waiting.", preset: "mask-up", fontSize: 78, weight: 700, color: "$fg", align: "left", x: -560, y: -390, duration: 6.0, exitPreset: "blur-out", exitAt: 5.6, lineHeight: 1.05 },
          { type: "text", text: "One line.", preset: "mask-up", fontSize: 78, weight: 700, color: "$accent", align: "left", x: -520, y: -380, start: 6.1, duration: PEAK - 6.2, exitPreset: "blur-out", exitAt: PEAK - 6.55 },
          { type: "text", text: "Approved. Paid. Filed.", preset: "slide-words", fontSize: 78, weight: 700, color: "$fg", align: "left", x: -400, y: -380, start: PEAK + 0.3, duration: 9.8 - PEAK - 0.3, highlight: { words: ["Filed."], color: "$accent3", at: 0.6 }, sound: false, adapt: { "1:1": { fontSize: 64 } } },
          { type: "counter", from: 1, to: 9, prefix: "Day ", countDuration: 5.2, countDelay: 0.2, ease: "linear", fontSize: 54, weight: 700, font: "$mono", color: "$warn", x: 700, y: -400, duration: PEAK, exit: { type: "fade", duration: 0.2 }, sound: false },
          // the work: four windows, the invoice, the gripes, the line, the checks — one rigid group so every format keeps it intact
          {
            type: "group", id: "work", x: G.x, y: G.y, width: 1260, height: 720,
            layers: [
              // the line: threads behind every window toward the waiting dot
              { type: "path", d: catmull(ROUTE), width: LINE_BOX, height: LINE_BOX, strokeWidth: 9, color: "$accent", start: 6.0, drawDuration: 1.2, ease: "inOutQuint" },
              ...WIN.map((w) => ({ type: "card", variant: "solid", icon: w.icon, title: w.title, body: w.body, width: 420, fontSize: 32, background: "#ffffff", color: "$fg", x: w.x, y: w.y, enter: { type: "rise", duration: 0.5 }, sound: false })),
              ...GRIPES.map((g) => ({ type: "card", variant: "chat-left", title: g.text, fontSize: 30, width: 420, x: WIN[g.k].x + 60, y: WIN[g.k].y - 150, start: g.at, duration: 1.25, enter: { type: "pop", duration: 0.3 }, exit: { type: "fade", duration: 0.2 }, inertia: true, sound: false })),
              // the invoice in limbo (hops, then slumps)
              { type: "card", id: "invoice", variant: "notification", icon: "🧾", title: "Invoice #4471", body: "Needs approval", width: 420, fontSize: 28, x: SEAT(0)[0], y: SEAT(0)[1], duration: PEAK + 0.02, enter: { type: "drop", duration: 0.4 }, animate: [...hopKeys(), { t: 7.0, x: 0, y: 6, rotate: -6, ease: "inOut" }, { t: 7.5, x: 0, y: 0, rotate: 0, ease: "outBack" }] },
              // the zip: the same invoice on the line, through every window into the dot
              { type: "card", variant: "notification", icon: "🧾", title: "Invoice #4471", body: "Approved · paid", width: 420, fontSize: 28, start: PEAK, duration: ZIP + 0.15, path: { points: ROUTE, start: 0, duration: ZIP, ease: "inOutQuint" }, velocityFx: { blur: 1, stretch: 0.6 }, animate: [{ t: ZIP - 0.12, scale: 1, opacity: 1 }, { t: ZIP + 0.08, scale: 0.12, opacity: 0, ease: "in" }] },
              ...WIN.map((w, k) => ({ type: "shape", shape: "circle", width: 66, height: 66, color: "$accent3", x: w.x + 185, y: w.y - 62, start: PASS[k], enter: { type: "pop", duration: 0.25 }, inertia: true, sound: `sfx:glass-ping-${(k % 3) + 1}` })),
              ...WIN.map((w, k) => ({ type: "text", text: "✓", preset: "none", fontSize: 42, weight: 800, color: "#ffffff", x: w.x + 185, y: w.y - 64, start: PASS[k], enter: { type: "pop", duration: 0.25 }, sound: false })),
            ],
          },
        ],
      },
      {
        id: "lockup", duration: 3.2,
        transition: { type: "match" },
        background: { type: "mesh", colors: ["#e3ebff", "#f6f7fb", "#e1fbf3"], base: "#f6f7fb" },
        camera: { keyframes: [{ t: 0, zoom: 1.04 }, { t: 3.2, zoom: 1, ease: "outQuint" }] },
        layers: [
          { type: "logo", id: "lockup-logo", src: "assets/flowline-logo.svg", parts: "wordmark", frame: "full", mode: "cascade", height: 180, y: -120, start: 0.6 },
          { type: "text", text: "Handoffs that happen by themselves.", preset: "blur-rise", fontSize: 58, maxWidth: 1400, adapt: { "9:16": { text: "Handoffs that happen\nby themselves.", y: 80 }, "4:5": { text: "Handoffs that happen\nby themselves.", y: 70 }, "1:1": { text: "Handoffs that happen\nby themselves.", y: 70 } }, weight: 600, font: "$body", color: "$muted", y: 60, start: 1.0 },
          { type: "card", variant: "button", title: "Start free trial", accent: "$accent", color: "#ffffff", fontSize: 40, y: 190, start: 1.4, press: 2.5, enter: { type: "grow", duration: 0.5 }, inertia: true },
        ],
      },
    ],
  },
};
export default t;
