/** Style presets: a coherent look (fonts, palette, finishing FX) the director can start from. */
import type { z } from "zod";
import type { FxSchema } from "./schema";

export type StylePreset = {
  description: string;
  fonts: { display: string; body: string; mono: string };
  colors: Record<string, string>;
  fx?: z.infer<typeof FxSchema>;
};

export const STYLES: Record<string, StylePreset> = {
  "cinematic-editorial": {
    description: "Expressive editorial film titles: sculptural serif, warm paper, aubergine ink; pair italic moments with restrained sans labels.",
    fonts: { display: "Cormorant Garamond", body: "Space Grotesk", mono: "JetBrains Mono" },
    colors: { bg: "#eee7db", fg: "#241c2b", muted: "#817681", accent: "#9b4c48", accent2: "#bdab8b", card: "#f6f0e6" },
    fx: { grain: 0.08, vignette: 0.16 },
  },
  "cinematic-monumental": {
    description: "Monumental film titles: restrained Roman capitals, wide tracking, warm gold on ink. Use medium weights and generous holds.",
    fonts: { display: "Cinzel", body: "Manrope", mono: "JetBrains Mono" },
    colors: { bg: "#111310", fg: "#e9dfc7", muted: "#a29a87", accent: "#c8aa72", accent2: "#616d5e", card: "#1b1d19" },
    fx: { grain: 0.08, vignette: 0.35 },
  },
  "cinematic-fashion": {
    description: "High-contrast fashion titles: large Bodoni letterforms, ivory and oxblood, fine rules and spacious pacing.",
    fonts: { display: "Bodoni Moda", body: "Manrope", mono: "JetBrains Mono" },
    colors: { bg: "#eae4da", fg: "#341a20", muted: "#8c7577", accent: "#7e233a", accent2: "#ad9e84", card: "#f2ede6" },
    fx: { grain: 0.07 },
  },
  "cinematic-condensed": {
    description: "Contemporary title sequence: tall condensed type, acid accents on charcoal, decisive cuts and quiet supporting labels.",
    fonts: { display: "League Gothic", body: "DM Sans", mono: "JetBrains Mono" },
    colors: { bg: "#171717", fg: "#ece9df", muted: "#8e8c86", accent: "#d9f77a", accent2: "#998bb6", card: "#252525" },
    fx: { grain: 0.08 },
  },
  apple: {
    description: "Clean Apple-keynote look: white/soft-grey, tight sans, deep shadows, restrained color. Product launches, fintech, SaaS.",
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    colors: { bg: "#f5f5f7", fg: "#0b0b0f", muted: "#6e6e73", accent: "#0071e3", accent2: "#5e5ce6", card: "#ffffff" },
  },
  neon: {
    description: "Dark cyber/neon: black, electric magenta/cyan glow, chromatic aberration. Gaming, tech drops, crypto, music.",
    fonts: { display: "Unbounded", body: "Space Grotesk", mono: "JetBrains Mono" },
    colors: { bg: "#05040a", fg: "#f4f1ff", muted: "#8b86a8", accent: "#ff2bd6", accent2: "#22e1ff", card: "#12101c" },
    fx: { grain: 0.15, vignette: 0.5, chromatic: 2 },
  },
  editorial: {
    description: "Magazine editorial: cream paper, big serif display, ink black, a single warm accent. Fashion, culture, storytelling.",
    fonts: { display: "Instrument Serif", body: "Inter", mono: "JetBrains Mono" },
    colors: { bg: "#f3eee6", fg: "#141210", muted: "#7a7268", accent: "#d2502c", accent2: "#2c4bd2", card: "#fffaf2" },
    fx: { grain: 0.25 },
  },
  brutal: {
    description: "Neo-brutalist: heavy condensed type, hard black outlines, acid yellow. Hype edits, streetwear, bold claims.",
    fonts: { display: "Anton", body: "Space Grotesk", mono: "JetBrains Mono" },
    colors: { bg: "#e8ff3a", fg: "#0a0a0a", muted: "#3a3a3a", accent: "#ff3b1f", accent2: "#1f4bff", card: "#ffffff" },
  },
  luxury: {
    description: "Luxury: deep black, champagne gold, wide-tracked serif, slow elegant motion. Real estate, jewelry, premium brands.",
    fonts: { display: "Playfair Display", body: "Manrope", mono: "JetBrains Mono" },
    colors: { bg: "#0b0a08", fg: "#f6efe2", muted: "#9b927f", accent: "#d4b373", accent2: "#8c6d3f", card: "#16140f" },
    fx: { grain: 0.12, vignette: 0.6 },
  },
  "pastel-pop": {
    description: "Playful pastel: soft lilac/peach/mint, rounded geometric type, bouncy motion. D2C, kids, lifestyle, food.",
    fonts: { display: "Bricolage Grotesque", body: "Outfit", mono: "JetBrains Mono" },
    colors: { bg: "#fff4ec", fg: "#2a1f3d", muted: "#8a7fa0", accent: "#ff7ab6", accent2: "#7c6cff", accent3: "#4fd1a5", card: "#ffffff" },
  },
  cinematic: {
    description: "Film trailer: letterbox, teal/orange grade, huge tracked titles, flashes, grain. Trailers, announcements, epics.",
    fonts: { display: "Bebas Neue", body: "Inter", mono: "JetBrains Mono" },
    colors: { bg: "#07090c", fg: "#f2efe9", muted: "#7d8590", accent: "#ff8a3d", accent2: "#2ec4c4", card: "#11151b" },
    fx: { grain: 0.3, vignette: 0.7, letterbox: 0.1 },
  },
  "minimal-dark": {
    description: "Minimal dark product: near-black, crisp white type, one gradient accent. Dev tools, AI products.",
    fonts: { display: "Geist", body: "Geist", mono: "JetBrains Mono" },
    colors: { bg: "#09090b", fg: "#fafafa", muted: "#71717a", accent: "#8b5cf6", accent2: "#06b6d4", card: "#18181b" },
    fx: { grain: 0.08 },
  },
  "y2k-chrome": {
    description: "Y2K chrome: holographic gradients, wide display type, sparkles. Music drops, fashion, Gen-Z.",
    fonts: { display: "Syne", body: "Outfit", mono: "JetBrains Mono" },
    colors: { bg: "#0d0d18", fg: "#ffffff", muted: "#a9a6c9", accent: "#b9f3ff", accent2: "#ff9ef0", accent3: "#c6ff8f", card: "#1a1a2e" },
    fx: { grain: 0.1, chromatic: 1.5 },
  },
};

export const DEFAULT_STYLE = "apple";
