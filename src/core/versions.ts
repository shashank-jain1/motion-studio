/**
 * Spec version history: projects/<id>/versions/{index.jsonl, 000001.json, …}.
 *
 * Every successful writeSpec records the spec as written, with who wrote it (you in the studio, the in-app director,
 * an external MCP client, a template, a script) and what changed relative to the previous version. Identical saves
 * are not recorded twice. Version numbers only grow; the oldest versions beyond MAX_VERSIONS are pruned.
 *
 * Several processes may write one project (the web server and a stdio MCP server): a version file is created with
 * O_EXCL so two writers can never take the same number, and index lines are appended (O_APPEND) in one write.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { diffSpecs, stable } from "../engine/spec/diff";

export type AuthorKind = "you" | "director" | "mcp" | "template" | "system";
export type SpecAuthor = { kind: AuthorKind; /** e.g. the MCP client name, or the user's display name */ name?: string };

export type VersionMeta = {
  n: number;
  at: string;
  author: SpecAuthor;
  /** One line: what this save changed relative to the previous version. */
  summary: string;
  /** Up to 12 detail lines (scene / layer level). */
  changes: string[];
  scenes: number;
  seconds?: number;
  hash: string;
  bytes: number;
  /** This save restored version N. */
  restoredFrom?: number;
  /** Optional free-text label from the writer ("approved cut", "before recolor"). */
  label?: string;
};

export const MAX_VERSIONS = 200;
const PAD = 6;

const versionsDir = (projectDir: string) => path.join(projectDir, "versions");
const indexFile = (projectDir: string) => path.join(versionsDir(projectDir), "index.jsonl");
const versionFile = (projectDir: string, n: number) => path.join(versionsDir(projectDir), `${String(n).padStart(PAD, "0")}.json`);

export const specHash = (spec: unknown) => crypto.createHash("sha256").update(stable(spec)).digest("hex").slice(0, 16);

/** All versions, newest first. Lines whose file was pruned or is unreadable are skipped. */
export const listVersions = (projectDir: string): VersionMeta[] => {
  const file = indexFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const out = new Map<number, VersionMeta>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line) as VersionMeta;
      if (Number.isInteger(m.n) && m.n > 0) out.set(m.n, m);
    } catch { /* torn line from a crash: ignore */ }
  }
  return [...out.values()].filter((m) => fs.existsSync(versionFile(projectDir, m.n))).sort((a, b) => b.n - a.n);
};

export const readVersion = (projectDir: string, n: number): { meta: VersionMeta; spec: Record<string, unknown> } | null => {
  if (!Number.isInteger(n) || n < 1) return null;
  const file = versionFile(projectDir, n);
  if (!fs.existsSync(file)) return null;
  const body = JSON.parse(fs.readFileSync(file, "utf8")) as { meta: VersionMeta; spec: Record<string, unknown> };
  return body;
};

const highest = (projectDir: string): number => {
  const dir = versionsDir(projectDir);
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) { const m = /^(\d+)\.json$/.exec(f); if (m) n = Math.max(n, Number(m[1])); }
  return n;
};

/** Claim the next number by creating its file exclusively; retries if another process got there first. */
const writeExclusive = (projectDir: string, build: (n: number) => string): number => {
  fs.mkdirSync(versionsDir(projectDir), { recursive: true });
  let n = highest(projectDir) + 1;
  for (let attempt = 0; attempt < 20; attempt++, n++) {
    try {
      fs.writeFileSync(versionFile(projectDir, n), build(n), { flag: "wx" });
      return n;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("could not allocate a version number");
};

const append = (projectDir: string, meta: VersionMeta) => fs.appendFileSync(indexFile(projectDir), JSON.stringify(meta) + "\n");

const record = (projectDir: string, spec: Record<string, unknown>, prev: unknown, info: Omit<VersionMeta, "n" | "hash" | "bytes" | "summary" | "changes" | "scenes"> & { summary?: string }) => {
  const d = diffSpecs(prev, spec);
  const json = JSON.stringify(spec);
  let meta!: VersionMeta;
  const n = writeExclusive(projectDir, (n) => {
    meta = {
      ...info,
      n,
      summary: info.summary ?? (prev ? d.summary || "No visible changes" : `First cut · ${countScenes(spec)} scene${countScenes(spec) === 1 ? "" : "s"}`),
      changes: prev ? d.lines.slice(0, 12) : [],
      scenes: countScenes(spec),
      hash: specHash(spec),
      bytes: json.length,
    };
    return JSON.stringify({ meta, spec }) + "\n";
  });
  append(projectDir, meta);
  return { ...meta, n };
};

const countScenes = (spec: Record<string, unknown>) => (Array.isArray(spec.scenes) ? spec.scenes.length : 0);

/**
 * Record `spec` (as just written) as a new version. `prev` is the spec that was on disk before the write.
 * When the project has no history yet but had a spec, that spec is kept first as the baseline, so the very first
 * tracked change can still be undone. Returns null when the spec is identical to the latest version.
 */
export const recordVersion = (projectDir: string, spec: Record<string, unknown>, prev: Record<string, unknown> | null, info: {
  author: SpecAuthor; seconds?: number; summary?: string; restoredFrom?: number; label?: string;
}): VersionMeta | null => {
  const latest = listVersions(projectDir)[0];
  const hash = specHash(spec);
  if (latest && latest.hash === hash) return null;
  if (!latest && prev && specHash(prev) !== hash) {
    record(projectDir, prev, null, { at: new Date().toISOString(), author: { kind: "system" }, summary: "Before version history" });
  }
  const base = latest ? readVersion(projectDir, latest.n)?.spec ?? prev : prev;
  const meta = record(projectDir, spec, base, { at: new Date().toISOString(), ...info });
  prune(projectDir);
  return meta;
};

/** Keep the newest MAX_VERSIONS: delete older files and rewrite the index (only when well past the limit). */
const prune = (projectDir: string) => {
  const all = listVersions(projectDir);
  if (all.length <= MAX_VERSIONS + 20) return;
  const keep = all.slice(0, MAX_VERSIONS);
  for (const m of all.slice(MAX_VERSIONS)) fs.rmSync(versionFile(projectDir, m.n), { force: true });
  const tmp = `${indexFile(projectDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, keep.slice().reverse().map((m) => JSON.stringify(m)).join("\n") + "\n");
  fs.renameSync(tmp, indexFile(projectDir));
};

export const authorLabel = (a: SpecAuthor) =>
  a.kind === "you" ? (a.name ? a.name : "You") : a.kind === "director" ? "Director" : a.kind === "mcp" ? (a.name ? `${a.name} (MCP)` : "AI client (MCP)") : a.kind === "template" ? "Template" : "System";
