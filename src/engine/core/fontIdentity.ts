import { FONT_NAMES } from "./fontCatalog";
export type FontFaceDefinition = { family: string; src: string; weight?: number | string; style?: "normal" | "italic" | "oblique" };
export const firstFontFamily = (name: string) => name.split(",")[0].trim().replace(/^["']|["']$/g, "");
export const facesForFamily = (name: string, faces: readonly FontFaceDefinition[] = []) => {
  const n = firstFontFamily(name).toLowerCase();
  return faces.filter((f) => f.family.trim().toLowerCase() === n);
};
export const canonicalFontFamily = (name: string) => {
  const first = firstFontFamily(name);
  return FONT_NAMES.find((f) => f.toLowerCase() === first.toLowerCase()) ?? first;
};
const fingerprint = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
/** Include every face descriptor and source identity; imported source filenames contain a content hash. */
export const customFontIdentity = (faces: readonly FontFaceDefinition[], resolve = (src: string) => src) =>
  fingerprint(JSON.stringify(faces.map((f) => [f.family.trim().toLowerCase(), resolve(f.src), String(f.weight ?? 400), f.style ?? "normal"]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
export const glyphFontFamily = (name: string, definitions: readonly FontFaceDefinition[] = []) => {
  const faces = facesForFamily(name, definitions);
  return faces.length ? `${faces[0].family}@font-${customFontIdentity(faces)}` : canonicalFontFamily(name);
};
