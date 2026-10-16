/**
 * SQLite (node:sqlite, Node 22 built-in): one DatabaseSync opened at import, WAL, foreign keys, numbered migrations
 * tracked in `schema_version`. Schema: docs/PLATFORM.md.
 *
 * Every secret (session ids, PATs, OAuth codes / tokens) is stored as `hashSecret(secret)` = SHA-256 hex only.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { DATA_DIR, DB_FILE } from "./config";

// node:sqlite prints "ExperimentalWarning: SQLite is an experimental feature" on first load. Drop exactly that warning
// (everything else still goes through), then load the module.
const origEmitWarning = process.emitWarning;
process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
  const first = rest[0];
  const type = typeof first === "string" ? first : (first as { type?: string } | undefined)?.type;
  const name = type ?? (warning instanceof Error ? warning.name : undefined);
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (name === "ExperimentalWarning" && /SQLite/i.test(msg ?? "")) return;
  return (origEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type DB = DatabaseSyncType;

const MIGRATIONS: string[] = [
  // 1: initial platform schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX projects_owner ON projects(owner_id);
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX api_tokens_user ON api_tokens(user_id);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'render',
    quality TEXT NOT NULL DEFAULT 'draft',
    backend TEXT NOT NULL DEFAULT 'local',
    status TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0,
    stage TEXT,
    output TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX jobs_user ON jobs(user_id, created_at);
  CREATE INDEX jobs_status ON jobs(status, created_at);
  CREATE INDEX jobs_project ON jobs(project_id, created_at);
  CREATE TABLE oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT,
    redirect_uris TEXT NOT NULL,
    client_name TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT,
    resource TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT,
    resource TEXT,
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX oauth_tokens_user ON oauth_tokens(user_id);
  `,
  // 2: refresh-token families (exact revocation of one grant's rotation chain)
  `
  ALTER TABLE oauth_tokens ADD COLUMN family_id TEXT;
  CREATE INDEX oauth_tokens_family ON oauth_tokens(family_id);
  `,
];

const open = (): DB => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(DB_FILE);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  d.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = d.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null } | undefined;
  let version = row?.v ?? 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    d.exec("BEGIN IMMEDIATE");
    try {
      d.exec(MIGRATIONS[i]);
      d.prepare("INSERT INTO schema_version (version) VALUES (?)").run(i + 1);
      d.exec("COMMIT");
      version = i + 1;
    } catch (e) {
      d.exec("ROLLBACK");
      throw new Error(`DB migration ${i + 1} failed: ${(e as Error).message}`);
    }
  }
  try {
    fs.chmodSync(DB_FILE, 0o600);
  } catch {
    /* best effort */
  }
  return d;
};

/** The shared connection (synchronous API; safe to use from any request handler). */
export const db: DB = open();
export const getDb = (): DB => db;

/** Run `fn` in a transaction (BEGIN IMMEDIATE … COMMIT / ROLLBACK). Not re-entrant. */
export const tx = <T>(fn: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};

export const nowIso = () => new Date().toISOString();
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
/** Random id (16 bytes, base64url). */
export const newId = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url");
/** Random secret (32 bytes, base64url) — sessions, tokens, codes. */
export const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
/** How every secret is stored: SHA-256, lowercase hex. */
export const hashSecret = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");
