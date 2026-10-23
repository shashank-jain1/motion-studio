/** Shared browser/Node catalog: compile-time checked against the actual browser loaders. */
export const FONT_NAMES = [
  "Anton", "Archivo Black", "Bebas Neue", "Bodoni Moda", "Bricolage Grotesque", "Bungee", "Caveat", "Cinzel", "Cormorant Garamond", "DM Sans",
  "DM Serif Display", "Fraunces", "Geist", "Instrument Sans", "Instrument Serif", "Inter", "Italiana", "JetBrains Mono", "League Gothic", "Lora", "Manrope", "Monoton", "Montserrat", "Orbitron", "Oswald", "Outfit",
  "Permanent Marker", "Playfair Display", "Poppins", "Press Start 2P", "Righteous", "Sora", "Space Grotesk", "Syne", "Unbounded",
] as const;

export const CINEMATIC_PAIRINGS = [
  { id: "monumental", display: "Cinzel", body: "Manrope", weight: 500, tracking: 0.12, use: "Monumental title cards; spaced capitals, deliberate reveals." },
  { id: "editorial-film", display: "Cormorant Garamond", body: "Space Grotesk", weight: 500, tracking: -0.02, use: "Expressive serif titles; occasional italic emphasis, generous leading." },
  { id: "fashion", display: "Bodoni Moda", body: "Manrope", weight: 500, tracking: -0.025, use: "High-contrast fashion/editorial titles; keep fine strokes large." },
  { id: "contemporary-trailer", display: "League Gothic", body: "DM Sans", weight: 400, tracking: 0.035, use: "Tall condensed titles; strong scale contrast and fast decisive movement." },
  { id: "quiet-drama", display: "Italiana", body: "Instrument Sans", weight: 400, tracking: 0.035, use: "Restrained dramatic titles; longer reading holds and minimal effects." },
] as const;
