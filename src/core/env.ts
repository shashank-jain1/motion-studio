/**
 * Loads `<repo>/.env` (then `.env.local`) into process.env at startup. Imported FIRST by every entry point (web server,
 * MCP server, CLI) so config read at module load sees it. Variables already set in the real environment always win,
 * and a missing file is fine. Format: KEY=value lines (Node's util.parseEnv: quotes, # comments, multiline quotes).
 */
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const loadedEnvFiles: string[] = [];
for (const name of [".env", ".env.local"]) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  try {
    const vars = parseEnv(fs.readFileSync(file, "utf8"));
    for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined && v !== "") process.env[k] = v;
    loadedEnvFiles.push(name);
  } catch (e) {
    console.error(`[motion-studio] could not read ${name}: ${(e as Error).message}`);
  }
}
