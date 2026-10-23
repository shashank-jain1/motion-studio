/**
 * Node-safe font names from the shared catalog. Browser loader coverage is checked by TypeScript.
 */
import { FONT_NAMES } from "../engine/core/fontCatalog";
export { FONT_NAMES } from "../engine/core/fontCatalog";
import { facesForFamily, type FontFaceDefinition } from "../engine/core/fontIdentity";

/** Theme tokens that resolve to the spec/style fonts. */
export const FONT_TOKENS = ["$display", "$body", "$mono"] as const;

export const isKnownFont = (name: string, faces: readonly FontFaceDefinition[] = []): boolean => {
  const n = name.trim();
  if ((FONT_TOKENS as readonly string[]).includes(n)) return true;
  // Allow CSS stacks like "Inter, sans-serif": judge by the first family.
  const first = n.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
  return FONT_NAMES.some((f) => f.toLowerCase() === first) || facesForFamily(name, faces).length > 0;
};
