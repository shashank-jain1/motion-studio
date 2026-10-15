import React, { createContext, useContext } from "react";
import { staticFile } from "remotion";
import { ensureFont } from "./fonts";

export type RuntimeContext = {
  colors: Record<string, string>;
  fonts: { display: string; body: string; mono: string };
  /** Base URL for project assets during headless renders (served by the MCP/CLI asset server). */
  assetBase?: string;
  /** Project folder name, used with Remotion Studio's --public-dir=projects. */
  projectId?: string;
  width: number;
  height: number;
  fps: number;
};

const Ctx = createContext<RuntimeContext | null>(null);
export const RuntimeProvider = Ctx.Provider;

export const useRuntime = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRuntime outside RuntimeProvider");
  return c;
};

/** Resolve "$token" colors against the theme. Works inside gradients too: "linear-gradient($accent, $bg)". */
export const resolveColor = (rt: RuntimeContext, c: string | undefined, fallback = "$fg"): string => {
  const v = c ?? fallback;
  return v.replace(/\$([a-zA-Z0-9_-]+)/g, (_, k) => rt.colors[k] ?? "#ff00ff");
};

export const useColor = () => {
  const rt = useRuntime();
  return (c: string | undefined, fallback?: string) => resolveColor(rt, c, fallback);
};

/** Resolve "$display" / "$body" / "$mono" or a concrete family into a loaded CSS font stack. */
export const useFont = () => {
  const rt = useRuntime();
  return (name: string | undefined, fallback: "display" | "body" | "mono" = "body") => {
    let n = name ?? `$${fallback}`;
    if (n.startsWith("$")) n = rt.fonts[n.slice(1) as "display" | "body" | "mono"] ?? rt.fonts.body;
    return ensureFont(n);
  };
};

export const isEmoji = (s: string) => /\p{Extended_Pictographic}/u.test(s) && !s.includes("/") && s.length <= 16;

export const useAsset = () => {
  const rt = useRuntime();
  return (src: string) => {
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    const clean = src.replace(/^\.?\//, "");
    if (rt.assetBase) return rt.assetBase.replace(/\/$/, "") + "/" + clean;
    if (rt.projectId) return staticFile(`${rt.projectId}/${clean}`);
    return staticFile(clean);
  };
};

export const isVideoSrc = (src: string) => /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(src);

export const SHADOW_PREMIUM =
  "0 2px 4px rgba(0,0,0,0.06), 0 12px 24px rgba(0,0,0,0.10), 0 40px 80px rgba(0,0,0,0.18)";
