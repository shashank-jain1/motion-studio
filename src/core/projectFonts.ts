import fs from "node:fs";
import path from "node:path";
import { FontFaceSchema } from "../engine/spec/schema";
import { firstFontFamily } from "../engine/core/fontIdentity";
import { addAsset, getAssetInfo, getProject, readSpec, writeSpec } from "./projects";
import { inspectFontAsset, localFontPath } from "./fontAssets";

type FontOptions = { family?: string; weight?: number | string; style?: "normal" | "italic" | "oblique"; role?: "display" | "body" | "mono" };

export const registerProjectFont = async (projectId: string, asset: string, opts: FontOptions = {}) => {
  const info = await getAssetInfo(projectId, asset.replace(/^assets\//, ""));
  const metadata = inspectFontAsset(info.file);
  const face = FontFaceSchema.parse({ family: opts.family ?? metadata.family, src: info.path, weight: opts.weight ?? metadata.weight, style: opts.style ?? metadata.style });
  const current = readSpec(projectId);
  if (!current) return { face, saved: false, outlineSupport: metadata.outlineSupport, warnings: metadata.note ? [metadata.note] : [], instruction: "Add this face to spec.fontFaces and use its family in theme.fonts/layer.font when creating the spec." };
  const faces = (current.fontFaces ?? []).filter((f) => !(firstFontFamily(f.family).toLowerCase() === face.family.toLowerCase() && String(f.weight ?? 400) === String(face.weight) && (f.style ?? "normal") === face.style));
  const next = { ...current, fontFaces: [...faces, face], ...(opts.role ? { theme: { ...current.theme, fonts: { ...current.theme?.fonts, [opts.role]: face.family } } } : {}) };
  const result = await writeSpec(projectId, next);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { face, saved: true, outlineSupport: metadata.outlineSupport, warnings: [...(metadata.note ? [metadata.note] : []), ...result.warnings] };
};

export const importLibraryFont = async (projectId: string, file: string, opts: FontOptions = {}) => {
  const source = localFontPath(file), meta = inspectFontAsset(source);
  const name = `font-${meta.hash}-${path.basename(source).replace(/[^A-Za-z0-9._-]/g, "-")}`;
  if (!fs.existsSync(path.join(getProject(projectId).dir, "assets", name))) await addAsset(projectId, { path: source, name });
  return registerProjectFont(projectId, name, opts);
};
