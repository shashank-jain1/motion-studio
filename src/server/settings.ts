/**
 * App settings in ~/.config/motion-studio/config.json (mode 600): model, effort, optional API key.
 * The key is never returned over HTTP. Credential precedence for the agent:
 *   ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env ("env") → settings key ("settings") → an `ant auth login` profile ("profile").
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export const DEFAULT_MODEL = "claude-opus-5-5";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = "high";

/** Models that accept server-side refusal fallback (`fallbacks: "default"`). Claude Haiku 5.5 has none. */
export const FALLBACK_MODELS = new Set<string>(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export type KeySource = "env" | "profile" | "settings" | "none";
type Stored = { model?: string; effort?: Effort; apiKey?: string };

export const CONFIG_DIR = process.env.MOTION_STUDIO_CONFIG_DIR || path.join(os.homedir(), ".config", "motion-studio");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const read = (): Stored => {
  try {
    const v = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Stored;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

const write = (s: Stored) => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, CONFIG_FILE);
};

const envKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let profileMemo: { at: number; value: boolean } | null = null;

/** Best effort: would the SDK find an `ant auth login` profile (config file / federation env)? Cached 30s, never throws. */
const hasProfile = async (): Promise<boolean> => {
  if (profileMemo && Date.now() - profileMemo.at < 30_000) return profileMemo.value;
  let value = false;
  try {
    const { loadConfigWithSource } = await import("@anthropic-ai/sdk/core/credentials");
    const loaded = await Promise.race([loadConfigWithSource(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    value = !!loaded;
  } catch {
    value = false;
  }
  profileMemo = { at: Date.now(), value };
  return value;
};

export const keySource = async (): Promise<KeySource> => {
  if (envKey()) return "env";
  if (read().apiKey) return "settings";
  if (await hasProfile()) return "profile";
  return "none";
};

export type PublicSettings = { model: string; effort: Effort; hasApiKey: boolean; keySource: KeySource; models: string[] };

export const getSettings = async (): Promise<PublicSettings> => {
  const s = read();
  const src = await keySource();
  return {
    model: s.model || DEFAULT_MODEL,
    effort: s.effort && (EFFORTS as readonly string[]).includes(s.effort) ? s.effort : DEFAULT_EFFORT,
    hasApiKey: src !== "none",
    keySource: src,
    models: [...MODELS],
  };
};

/** Update settings. `apiKey: ""` (or null) removes the stored key. Unknown models are accepted (free-form ids). */
export const putSettings = async (patch: { model?: unknown; effort?: unknown; apiKey?: unknown }): Promise<PublicSettings> => {
  const s = read();
  if (patch.model !== undefined) {
    if (typeof patch.model !== "string" || !/^[a-z0-9][a-z0-9.\-]{2,80}$/.test(patch.model)) throw new Error("model must be a model id like claude-opus-5-5");
    s.model = patch.model;
  }
  if (patch.effort !== undefined) {
    if (typeof patch.effort !== "string" || !(EFFORTS as readonly string[]).includes(patch.effort)) throw new Error(`effort must be one of ${EFFORTS.join(", ")}`);
    s.effort = patch.effort as Effort;
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey === null || patch.apiKey === "") delete s.apiKey;
    else if (typeof patch.apiKey !== "string" || patch.apiKey.trim().length < 10 || /\s/.test(patch.apiKey.trim())) throw new Error("apiKey looks invalid");
    else s.apiKey = patch.apiKey.trim();
  }
  write(s);
  return getSettings();
};

/** Anthropic client using the same precedence as keySource(). */
export const makeClient = async (): Promise<Anthropic> => {
  if (envKey()) return new Anthropic();
  const key = read().apiKey;
  if (key) return new Anthropic({ apiKey: key });
  return new Anthropic(); // profile (or nothing → AuthenticationError on first request)
};

export const agentSettings = async (): Promise<{ model: string; effort: Effort }> => {
  const s = await getSettings();
  return { model: s.model, effort: s.effort };
};
