/** Filesystem locations used by the Node side (MCP server, CLI, renderer). */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives at <root>/src/core/paths.ts). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where projects live. Override with env MOTION_STUDIO_PROJECTS. */
export const PROJECTS_DIR = path.resolve(process.env.MOTION_STUDIO_PROJECTS || path.join(ROOT, "projects"));

export const ENGINE_DIR = path.join(ROOT, "src", "engine");
export const ENGINE_ENTRY = path.join(ENGINE_DIR, "index.ts");
export const CUSTOM_DIR = path.join(ENGINE_DIR, "custom");
export const CACHE_DIR = path.join(ROOT, ".cache");
export const BUNDLE_CACHE_DIR = path.join(CACHE_DIR, "bundle");
export const DOCS_DIR = path.join(ROOT, "docs");
