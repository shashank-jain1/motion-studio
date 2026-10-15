import type { SpecInput } from "./spec/schema";

/** A showreel spec for a fictional fintech app. Uses no external assets, so it renders anywhere. */
export const DEMO_SPEC: SpecInput = {
  title: "Orbit Pay — launch teaser",
  format: "16:9",
  fps: 30,
  style: "apple",
  theme: { colors: { accent: "#5b5bf7", accent2: "#ff5fa2", accent3: "#22c7a9" } },
  fx: { grain: 0.06 },
  scenes: [
    {
      id: "hook",
      duration: 2.6,
      background: { type: "mesh", colors: ["#c9c8ff", "#ffd1e6", "#d4f5ec"], base: "#f7f7fb" },
      camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 2.6, zoom: 1.08, ease: "inOut" }] },
      layers: [
        { type: "text", text: "Money,", preset: "zoom-from-camera", fontSize: 210, weight: 800, y: -70, stagger: 0.05 },
        { type: "text", text: "at the speed of thought.", preset: "blur-rise", start: 0.7, fontSize: 84, weight: 600, y: 90, color: "$muted",
          highlight: { words: ["thought."], color: "$accent", at: 1.0 } },
      ],
    },
    {
      id: "phone",
      duration: 4.6,
      transition: { type: "zoom-through", duration: 0.6 },
      background: { type: "spotlight", base: "#eef0f6", color: "#ffffff", y: -100, size: 1.1 },
      camera: { keyframes: [{ t: 0, zoom: 0.95 }, { t: 4.6, zoom: 1.06, ease: "inOut" }] },
      layers: [
        {
          type: "device", model: "iphone", frameColor: "deep-red", height: 860, y: 40, shadow: true,
          enter: { type: "fly-in-3d", duration: 1.1, ease: "outExpo" },
          animate: [{ t: 0, rotateY: -28, rotateX: 14 }, { t: 2.2, rotateY: -8, rotateX: 4, ease: "inOutQuint" }, { t: 4.6, rotateY: 6, rotateX: 0, ease: "inOut" }],
          island: { activity: "faceid-success", at: 2.6, duration: 1.6 },
          screens: [{
            background: "#f4f5fb",
            layers: [
              { type: "text", text: "Good morning, Asha", preset: "blur-rise", start: 0.6, fontSize: 22, weight: 600, font: "$body", y: -300, x: -70, color: "$muted" },
              { type: "counter", from: 0, to: 124500, prefix: "₹", locale: "en-IN", start: 0.8, countDuration: 1.6, fontSize: 60, y: -245, x: -40 },
              { type: "card", variant: "solid", icon: "☕", title: "Blue Tokai", body: "Today, 9:12 AM", meta: "-₹340", width: 330, fontSize: 17, y: -130, start: 1.2, enter: { type: "rise", duration: 0.5 } },
              { type: "card", variant: "solid", icon: "🛒", title: "Zepto", body: "Yesterday", meta: "-₹1,280", width: 330, fontSize: 17, y: -30, start: 1.35, enter: { type: "rise", duration: 0.5 } },
              { type: "card", variant: "solid", icon: "✈️", title: "IndiGo", body: "Mon", meta: "-₹8,671", width: 330, fontSize: 17, y: 70, start: 1.5, enter: { type: "rise", duration: 0.5 } },
              { type: "card", variant: "button", title: "Pay with Orbit", width: 340, fontSize: 24, y: 290, start: 1.8, press: 2.3, enter: { type: "pop", duration: 0.5 } },
            ],
          }],
        },
        { type: "card", variant: "notification", icon: "💸", title: "Orbit Pay", body: "₹2,400 received from Rahul 🎉", meta: "now", width: 600, x: 560, y: -300, start: 1.4,
          enter: { type: "drop", duration: 0.7, ease: "spring" }, loop: { type: "float", amplitude: 6, speed: 0.4 }, depth: 1.6 },
        { type: "card", variant: "pill", icon: "🔒", title: "Face ID verified", x: -560, y: 260, start: 3.2, enter: { type: "pop", duration: 0.5 }, depth: 1.4 },
      ],
    },
    {
      id: "anywhere",
      duration: 3.4,
      transition: { type: "whip", direction: "left", duration: 0.5 },
      background: { type: "gradient", colors: ["#ffffff", "#eef0ff"], angle: 160 },
      layers: [
        { type: "path", preset: "swoosh", width: 1700, height: 800, strokeWidth: 8, gradient: ["$accent2", "$accent"], drawDuration: 2.2, dashed: false,
          follower: { emoji: "✈️", size: 90, rotateOffset: 45 } },
        { type: "text", text: "Send it anywhere.", preset: "mask-up", fontSize: 150, weight: 800, y: 40, start: 0.5 },
        { type: "particles", preset: "sparkles", count: 40, colors: ["$accent", "$accent2"], start: 0.8 },
      ],
    },
    {
      id: "scale",
      duration: 3.4,
      transition: { type: "cross-zoom", duration: 0.6 },
      background: { type: "shader", shader: "liquid", colors: ["#1b1464", "#5b5bf7", "#ff5fa2", "#0b0b1a"], speed: 0.25 },
      camera: { punch: [0.6] },
      layers: [
        { type: "counter", from: 0, to: 10000000, suffix: "+", countDelay: 0.2, countDuration: 1.8, fontSize: 200, color: "#ffffff", y: -40 },
        { type: "text", text: "payments every single day", preset: "tracking", start: 0.9, fontSize: 48, weight: 500, color: "#ffffffcc", y: 100, font: "$body" },
      ],
    },
    {
      id: "everywhere",
      duration: 3.6,
      transition: { type: "flash", duration: 0.4 },
      background: { type: "solid", color: "#f7f7fb" },
      camera: { keyframes: [{ t: 0, zoom: 1.12 }, { t: 3.6, zoom: 1, ease: "outQuint" }] },
      layers: [
        { type: "cloud", arrangement: "burst", itemSize: 120, avoidCenter: { width: 1000, height: 320 }, seed: 7,
          items: [{ emoji: "🛍️" }, { emoji: "🍕" }, { emoji: "🚕" }, { emoji: "🎬" }, { emoji: "🏨" }, { emoji: "💊" }, { emoji: "🎧" }, { emoji: "🧾" }, { emoji: "🚆" }, { emoji: "🥦" }] },
        { type: "text", text: "Works everywhere\nyou already shop.", preset: "slide-words", fontSize: 110, weight: 800, start: 0.4 },
      ],
    },
    {
      id: "endcard",
      duration: 3.2,
      transition: { type: "blur-slide", direction: "up", duration: 0.6 },
      background: { type: "mesh", colors: ["#5b5bf7", "#ff5fa2", "#22c7a9"], base: "#0b0b1a" },
      layers: [
        { type: "text", text: "Orbit Pay", preset: "gradient-sweep", fontSize: 220, weight: 800, y: -60, gradient: ["#ffffff", "#c9c8ff", "#ffd1e6", "#ffffff"] },
        { type: "card", variant: "button", title: "Get the app →", y: 140, start: 0.6, press: 1.8, accent: "#ffffff", color: "#0b0b1a", fontSize: 44, enter: { type: "pop", duration: 0.5 } },
        { type: "particles", preset: "confetti", start: 1.8, originY: 120, colors: ["#ffffff", "$accent2", "#22c7a9", "#ffd166"] },
      ],
    },
  ],
};
