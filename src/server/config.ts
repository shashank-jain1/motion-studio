/**
 * Platform configuration (docs/PLATFORM.md): mode, public URL, data dir, render backend. Read once from the environment.
 * No side effects at import time except computing values (the secret is created lazily).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "../core/paths";

export type Mode = "local" | "hosted";

export const MODE: Mode = process.env.MOTION_STUDIO_MODE === "hosted" ? "hosted" : "local";
export const IS_HOSTED = MODE === "hosted";

export const PORT = Number(process.env.MOTION_STUDIO_PORT ?? 4310);
/** Bind address. 127.0.0.1 by default; the Docker image sets 0.0.0.0 (Caddy terminates TLS in front). */
export const HOST = process.env.MOTION_STUDIO_HOST || "127.0.0.1";

/** Public origin, no trailing slash (OAuth issuer, MCP resource URL, deep links). */
export const PUBLIC_URL = (process.env.MOTION_STUDIO_PUBLIC_URL || `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`).replace(/\/+$/, "");
export const PUBLIC_ORIGIN = (() => {
  try {
    return new URL(PUBLIC_URL).origin;
  } catch {
    throw new Error(`MOTION_STUDIO_PUBLIC_URL is not a valid URL: ${PUBLIC_URL}`);
  }
})();
export const PUBLIC_HOST = new URL(PUBLIC_URL).hostname;
export const SECURE_COOKIES = PUBLIC_URL.startsWith("https://");

export const DATA_DIR = path.resolve(process.env.MOTION_STUDIO_DATA || path.join(ROOT, "data"));
export const DB_FILE = path.join(DATA_DIR, "motion-studio.db");
export const LAMBDA_CONFIG_FILE = path.join(DATA_DIR, "lambda.json");

export type BackendName = "local" | "lambda";
export const RENDER_BACKEND: BackendName = process.env.RENDER_BACKEND === "lambda" ? "lambda" : "local";

/** "open" (default): anyone can sign up in hosted mode. "closed": only the very first account (the operator). */
export const SIGNUP: "open" | "closed" = process.env.MOTION_STUDIO_SIGNUP === "closed" ? "closed" : "open";

/** Trust the rightmost X-Forwarded-For hop for the client IP (set when running behind Caddy / a reverse proxy). */
export const TRUST_PROXY = process.env.MOTION_STUDIO_TRUST_PROXY === "1" || process.env.MOTION_STUDIO_TRUST_PROXY === "true";

/** Max size of an asset downloaded from a URL in hosted mode (MB). */
export const MAX_URL_DOWNLOAD_BYTES = Number(process.env.MOTION_STUDIO_MAX_DOWNLOAD_MB ?? 200) * 1024 * 1024;

let secretMemo: string | null = null;
/** Signing secret: MOTION_STUDIO_SECRET, else generated once into data/secret (mode 600). */
export const getSecret = (): string => {
  if (secretMemo) return secretMemo;
  if (process.env.MOTION_STUDIO_SECRET) return (secretMemo = process.env.MOTION_STUDIO_SECRET);
  const file = path.join(DATA_DIR, "secret");
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    if (s.length >= 32) return (secretMemo = s);
  } catch {
    /* create below */
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const s = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(file, s + "\n", { mode: 0o600 });
  return (secretMemo = s);
};
