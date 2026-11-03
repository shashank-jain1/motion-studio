/** Shared browser/Node catalog: compile-time checked against the actual browser loaders. */
export const FONT_NAMES = [
  "Anton", "Archivo Black", "Bebas Neue", "Bodoni Moda", "Bricolage Grotesque", "Bungee", "Caveat", "Cinzel", "Cormorant Garamond", "DM Sans",
  "DM Serif Display", "Fraunces", "Geist", "Instrument Sans", "Instrument Serif", "Inter", "Italiana", "JetBrains Mono", "League Gothic", "Lora", "Manrope", "Monoton", "Montserrat", "Orbitron", "Oswald", "Outfit",
  "Permanent Marker", "Playfair Display", "Poppins", "Press Start 2P", "Righteous", "Sora", "Space Grotesk", "Syne", "Unbounded",
  "Newsreader", "IBM Plex Mono", "Tiro Devanagari Hindi", "Mukta",
  // Devanagari display + text faces (all also carry Latin, so a Hindi/Hinglish line never falls back mid-word)
  "Rozha One", "Yatra One", "Teko", "Eczar", "Kalam", "Baloo 2", "Anek Devanagari", "Khand",
] as const;

export const CINEMATIC_PAIRINGS = [
  { id: "monumental", display: "Cinzel", body: "Manrope", weight: 500, tracking: 0.12, use: "Monumental title cards; spaced capitals, deliberate reveals." },
  { id: "editorial-film", display: "Cormorant Garamond", body: "Space Grotesk", weight: 500, tracking: -0.02, use: "Expressive serif titles; occasional italic emphasis, generous leading." },
  { id: "fashion", display: "Bodoni Moda", body: "Manrope", weight: 500, tracking: -0.025, use: "High-contrast fashion/editorial titles; keep fine strokes large." },
  { id: "contemporary-trailer", display: "League Gothic", body: "DM Sans", weight: 400, tracking: 0.035, use: "Tall condensed titles; strong scale contrast and fast decisive movement." },
  { id: "quiet-drama", display: "Italiana", body: "Instrument Sans", weight: 400, tracking: 0.035, use: "Restrained dramatic titles; longer reading holds and minimal effects." },
  // Hindi / Hinglish films: Devanagari display + a Latin partner that shares its stroke contrast
  { id: "hindi-cinema", display: "Rozha One", body: "Anek Devanagari", weight: 400, tracking: 0, use: "Devanagari headline in high-contrast serif (poster/film-title feel); Latin accents in Fraunces or Newsreader italic; body/captions in Anek Devanagari. Line height ≥ 1.35 for Devanagari." },
  { id: "bazaar-poster", display: "Yatra One", body: "Teko", weight: 400, tracking: 0.02, use: "Hand-painted bazaar-sign energy for Hindi hooks; pair with condensed Teko caps for numbers/dates. Local, warm, loud." },
  { id: "hindi-trailer", display: "Teko", body: "Eczar", weight: 600, tracking: 0.04, use: "Condensed trailer caps that work in Hindi AND English at once; Eczar for the reflective lines. Big scale contrast." },
  { id: "street-note", display: "Kalam", body: "Mukta", weight: 700, tracking: 0, use: "Handwritten Hindi asides ('arre bhai…') over clean Mukta text — conversational, Bhopali, never for the main title." },
] as const;
