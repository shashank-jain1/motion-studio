/**
 * Accounts, sessions, personal access tokens and project ownership (docs/PLATFORM.md → "Auth interface").
 *
 * - local mode: a built-in owner (local@motion.studio, no password) is always the current user.
 * - hosted mode: session cookie `ms_session` (random 32B, stored as SHA-256), 30-day sliding expiry; `requireUser`
 *   everywhere. `Authorization: Bearer <PAT>` is accepted by the HTTP API too (scripts / CLI).
 * - Passwords: scrypt N=2^15 r=8 p=1, 32B salt, timing-safe compare.
 * - Ownership: projects(id = folder name, owner_id). Unowned folders are assigned to the first user (local: the owner).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import { PROJECTS_DIR } from "../core/paths";
import { IS_HOSTED, MODE, SECURE_COOKIES, TRUST_PROXY } from "./config";
import { db, hashSecret, isoIn, newId, nowIso, randomSecret, tx } from "./db";

export type User = { id: string; email: string; name: string };

export const SESSION_COOKIE = "ms_session";
const SESSION_MS = 30 * 24 * 3600 * 1000;
/** Re-extend a session (and re-send the cookie) at most once a day. */
const SESSION_REFRESH_MS = 24 * 3600 * 1000;
export const LOCAL_OWNER_EMAIL = "local@motion.studio";
export const PAT_PREFIX = "ms_pat_";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

type UserRow = { id: string; email: string; name: string; password_hash: string | null; created_at: string };
const toUser = (r: Pick<UserRow, "id" | "email" | "name">): User => ({ id: r.id, email: r.email, name: r.name });

const notFound = (projectId: string) => new HTTPException(404, { message: `Project "${projectId}" not found` });

// ---------------------------------------------------------------- passwords

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

const scrypt = (password: string, salt: Buffer, opts: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password.normalize("NFKC"), salt, KEYLEN, { ...opts, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** `scrypt$N$r$p$<salt b64url>$<hash b64url>` */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(32);
  const key = await scrypt(password, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
};

export const verifyPassword = async (password: string, stored: string | null): Promise<boolean> => {
  // Always spend the hashing time, even for unknown users (no account-existence timing oracle).
  const parts = (stored ?? "").split("$");
  const valid = parts.length === 6 && parts[0] === "scrypt";
  const N = valid ? Number(parts[1]) : SCRYPT.N;
  const r = valid ? Number(parts[2]) : SCRYPT.r;
  const p = valid ? Number(parts[3]) : SCRYPT.p;
  const salt = valid ? Buffer.from(parts[4], "base64url") : crypto.randomBytes(32);
  const expected = valid ? Buffer.from(parts[5], "base64url") : crypto.randomBytes(KEYLEN);
  let key: Buffer;
  try {
    key = await scrypt(password, salt, { N, r, p });
  } catch {
    return false;
  }
  return valid && key.length === expected.length && crypto.timingSafeEqual(key, expected);
};

// ---------------------------------------------------------------- users

export const getUserById = (id: string): User | null => {
  const r = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
};

const getUserRowByEmail = (email: string): UserRow | undefined =>
  db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email.trim()) as UserRow | undefined;

export const userCount = (): number => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE email != ?").get(LOCAL_OWNER_EMAIL) as { n: number }).n;

/** The operator: local owner in local mode, the first account in hosted mode. */
export const adminUser = (): User | null => {
  if (!IS_HOSTED) return localOwner();
  const r = db.prepare("SELECT id, email, name FROM users WHERE email != ? ORDER BY created_at ASC, rowid ASC LIMIT 1").get(LOCAL_OWNER_EMAIL) as UserRow | undefined;
  return r ? toUser(r) : null;
};
export const isAdmin = (user: User): boolean => adminUser()?.id === user.id;

let localOwnerMemo: User | null = null;
export const localOwner = (): User => {
  if (localOwnerMemo) return localOwnerMemo;
  const existing = getUserRowByEmail(LOCAL_OWNER_EMAIL);
  if (existing) return (localOwnerMemo = toUser(existing));
  const u: User = { id: newId(), email: LOCAL_OWNER_EMAIL, name: "Local" };
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, NULL, ?)").run(u.id, u.email, u.name, nowIso());
  return (localOwnerMemo = u);
};

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const validateSignup = (body: { email?: unknown; password?: unknown; name?: unknown }) => {
  if (typeof body.email !== "string" || !EMAIL_RE.test(body.email.trim())) throw new HTTPException(400, { message: "A valid email is required" });
  if (typeof body.password !== "string" || body.password.length < 8) throw new HTTPException(400, { message: "Password must be at least 8 characters" });
  if (body.password.length > 256) throw new HTTPException(400, { message: "Password is too long" });
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const email = body.email.trim().toLowerCase();
  if (email === LOCAL_OWNER_EMAIL) throw new HTTPException(400, { message: "That email is reserved" });
  return { email, password: body.password, name: name || email.split("@")[0] };
};

export const createUser = async (input: { email: string; password: string; name: string }): Promise<User> => {
  const hash = await hashPassword(input.password);
  const u: User = { id: newId(), email: input.email, name: input.name };
  const first = tx(() => {
    if (getUserRowByEmail(input.email)) throw new HTTPException(409, { message: "An account with this email already exists" });
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(u.id, u.email, u.name, hash, nowIso());
    return userCount() === 1;
  });
  // The first hosted account becomes the owner of any pre-existing project folders.
  if (first) syncProjectOwnership();
  return u;
};

export const authenticate = async (email: unknown, password: unknown): Promise<User | null> => {
  if (typeof email !== "string" || typeof password !== "string") return null;
  const row = email.trim().toLowerCase() === LOCAL_OWNER_EMAIL ? undefined : getUserRowByEmail(email);
  const ok = await verifyPassword(password, row?.password_hash ?? null);
  return ok && row ? toUser(row) : null;
};

// ---------------------------------------------------------------- sessions

const cookieOpts = (maxAgeSec: number) => ({ path: "/", httpOnly: true, sameSite: "Lax" as const, secure: SECURE_COOKIES, maxAge: maxAgeSec });

export const startSession = (c: Context, user: User): void => {
  const sid = randomSecret();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hashSecret(sid), user.id, nowIso(), isoIn(SESSION_MS));
  setCookie(c, SESSION_COOKIE, sid, cookieOpts(SESSION_MS / 1000));
  memo.set(c.req.raw, user);
  // Opportunistic cleanup.
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
};

export const endSession = (c: Context): void => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(hashSecret(sid));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: SECURE_COOKIES });
  memo.set(c.req.raw, null);
};

const sessionUser = (c: Context): User | null => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid || sid.length > 200) return null;
  const h = hashSecret(sid);
  const r = db
    .prepare("SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?")
    .get(h) as (UserRow & { expires_at: string }) | undefined;
  if (!r) return null;
  const exp = Date.parse(r.expires_at);
  if (!(exp > Date.now())) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(h);
    return null;
  }
  // Sliding expiry: extend (and re-send the cookie) once a day of use.
  if (exp - Date.now() < SESSION_MS - SESSION_REFRESH_MS) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(isoIn(SESSION_MS), h);
    setCookie(c, SESSION_COOKIE, sid, cookieOpts(SESSION_MS / 1000));
  }
  return toUser(r);
};

// ---------------------------------------------------------------- personal access tokens + bearer

export type TokenInfo = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export const listTokens = (user: User): TokenInfo[] =>
  (db.prepare("SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as {
    id: string;
    name: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
  }[]).map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at }));

export const createToken = (user: User, name: string): { token: string; id: string; name: string; prefix: string } => {
  const token = `${PAT_PREFIX}${randomSecret()}`;
  const id = newId(9);
  // Display prefix: the first 8 characters after the fixed "ms_pat_" marker would all look alike, so show those of the secret.
  const prefix = token.slice(PAT_PREFIX.length, PAT_PREFIX.length + 8);
  db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(
    id,
    user.id,
    name,
    hashSecret(token),
    prefix,
    nowIso(),
  );
  return { token, id, name, prefix };
};

export const deleteToken = (user: User, id: string): boolean => db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, user.id).changes > 0;

/**
 * Resolve a bearer token: a personal access token (`ms_pat_…`) or an OAuth access token (oauth_tokens, kind "access",
 * not revoked, not expired). Returns null when unknown. OAuth scope is the stored space-separated scope.
 */
export function userFromBearer(token: string): { user: User; scope: string[]; via: "pat" | "oauth" } | null {
  if (!token || token.length > 512) return null;
  const h = hashSecret(token);
  if (token.startsWith(PAT_PREFIX)) {
    const r = db.prepare("SELECT t.id AS token_id, u.id, u.email, u.name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?").get(h) as
      | (UserRow & { token_id: string })
      | undefined;
    if (!r) return null;
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(nowIso(), r.token_id);
    return { user: toUser(r), scope: ["studio"], via: "pat" };
  }
  // Accept hex (hashSecret) and base64url SHA-256 encodings of the stored hash.
  const h64 = crypto.createHash("sha256").update(token).digest("base64url");
  const r = db
    .prepare(
      "SELECT u.id, u.email, u.name, o.scope, o.expires_at FROM oauth_tokens o JOIN users u ON u.id = o.user_id WHERE o.token_hash IN (?, ?) AND o.kind = 'access' AND o.revoked = 0",
    )
    .get(h, h64) as (UserRow & { scope: string | null; expires_at: string }) | undefined;
  if (!r || !(Date.parse(r.expires_at) > Date.now())) return null;
  return { user: toUser(r), scope: (r.scope ?? "").split(/\s+/).filter(Boolean), via: "oauth" };
}

// ---------------------------------------------------------------- current user

const memo = new WeakMap<Request, User | null>();

/** The signed-in user (local mode → the local owner), or null. Also accepts `Authorization: Bearer <PAT|OAuth token>`. */
export function currentUser(c: Context): User | null {
  if (!IS_HOSTED) return localOwner();
  const req = c.req.raw;
  if (memo.has(req)) return memo.get(req) ?? null;
  let user = sessionUser(c);
  if (!user) {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    if (m) user = userFromBearer(m[1])?.user ?? null;
  }
  memo.set(req, user);
  return user;
}

/** The current user or HTTP 401. */
export function requireUser(c: Context): User {
  const u = currentUser(c);
  if (!u) throw new HTTPException(401, { message: "Sign in required" });
  return u;
}

// ---------------------------------------------------------------- project ownership

const ownerOf = (projectId: string): string | null =>
  (db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId) as { owner_id: string } | undefined)?.owner_id ?? null;

const folderExists = (projectId: string) => ID_RE.test(projectId) && fs.existsSync(path.join(PROJECTS_DIR, projectId, "project.json"));

/** 404 unless `user` owns the project (same error for "missing" and "someone else's": no existence leak). */
export function assertProjectOwner(user: User, projectId: string): void {
  if (!ID_RE.test(projectId)) throw notFound(projectId);
  let owner = ownerOf(projectId);
  // Local mode: folders created outside the server (MCP stdio, CLI) are adopted by the owner on first touch.
  if (!owner && !IS_HOSTED && folderExists(projectId)) {
    recordProjectOwner(user, projectId);
    owner = user.id;
  }
  if (owner !== user.id) throw notFound(projectId);
}

/** Non-throwing variant. */
export const ownsProject = (user: User, projectId: string): boolean => {
  try {
    assertProjectOwner(user, projectId);
    return true;
  } catch {
    return false;
  }
};

export function listUserProjectIds(user: User): string[] {
  if (!IS_HOSTED) syncProjectOwnership();
  return (db.prepare("SELECT id FROM projects WHERE owner_id = ?").all(user.id) as { id: string }[]).map((r) => r.id);
}

export function recordProjectOwner(user: User, projectId: string): void {
  if (!ID_RE.test(projectId)) throw new Error(`Invalid project id "${projectId}"`);
  db.prepare("INSERT INTO projects (id, owner_id, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING").run(projectId, user.id, nowIso());
  const owner = ownerOf(projectId);
  if (owner !== user.id) throw notFound(projectId);
}

export const forgetProject = (projectId: string): void => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
};

/**
 * Assign every unowned project folder to the first user (local mode: the local owner) and drop rows whose folder is
 * gone. Runs on boot, after the first hosted signup, and (local mode) on every project listing.
 */
export const syncProjectOwnership = (): { assigned: string[]; pruned: string[] } => {
  const first = IS_HOSTED ? adminUser() : localOwner();
  const folders = new Set<string>();
  try {
    for (const e of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) if (e.isDirectory() && folderExists(e.name)) folders.add(e.name);
  } catch {
    /* no projects dir yet */
  }
  const rows = new Set((db.prepare("SELECT id FROM projects").all() as { id: string }[]).map((r) => r.id));
  const assigned: string[] = [];
  const pruned: string[] = [];
  tx(() => {
    if (first) {
      const ins = db.prepare("INSERT INTO projects (id, owner_id, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING");
      for (const id of folders) {
        if (!rows.has(id)) {
          ins.run(id, first.id, nowIso());
          assigned.push(id);
        }
      }
    }
    const del = db.prepare("DELETE FROM projects WHERE id = ?");
    for (const id of rows) {
      if (!folders.has(id)) {
        del.run(id);
        pruned.push(id);
      }
    }
  });
  return { assigned, pruned };
};

// ---------------------------------------------------------------- rate limiting (login / signup)

type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();
const RL_CAPACITY = 10;
const RL_REFILL_PER_SEC = 1 / 6; // 10 per minute sustained

export const clientIp = (c: Context): string => {
  if (TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (hops.length) return hops[hops.length - 1];
    }
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
};

/** Token bucket per IP + action; throws 429 with Retry-After when empty. */
export const rateLimit = (c: Context, action: string): void => {
  const key = `${action}|${clientIp(c)}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: RL_CAPACITY, at: now };
  b.tokens = Math.min(RL_CAPACITY, b.tokens + ((now - b.at) / 1000) * RL_REFILL_PER_SEC);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    const retry = Math.ceil((1 - b.tokens) / RL_REFILL_PER_SEC);
    throw new HTTPException(429, { message: `Too many attempts. Try again in ${retry}s.`, res: undefined, cause: { retryAfter: retry } });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.at > 10 * 60_000) buckets.delete(k);
  }
};

export { MODE };
