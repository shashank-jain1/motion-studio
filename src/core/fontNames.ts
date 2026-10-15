/**
 * Font families the engine can load (mirror of src/engine/core/fonts.ts, which imports
 * browser-only modules and so can't be used from Node). Keep the two lists in sync.
 */
export const FONT_NAMES = [
  "Anton", "Archivo Black", "Bebas Neue", "Bricolage Grotesque", "Bungee", "Caveat", "DM Sans",
  "DM Serif Display", "Fraunces", "Geist", "Instrument Sans", "Instrument Serif", "Inter",
  "JetBrains Mono", "Lora", "Manrope", "Monoton", "Montserrat", "Orbitron", "Oswald", "Outfit",
  "Permanent Marker", "Playfair Display", "Poppins", "Press Start 2P", "Righteous", "Sora",
  "Space Grotesk", "Syne", "Unbounded",
] as const;

/** Theme tokens that resolve to the spec/style fonts. */
export const FONT_TOKENS = ["$display", "$body", "$mono"] as const;

export const isKnownFont = (name: string): boolean => {
  const n = name.trim();
  if ((FONT_TOKENS as readonly string[]).includes(n)) return true;
  // Allow CSS stacks like "Inter, sans-serif": judge by the first family.
  const first = n.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
  return FONT_NAMES.some((f) => f.toLowerCase() === first);
};
