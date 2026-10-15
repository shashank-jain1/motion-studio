/**
 * Projects on disk: projects/<id>/{project.json, spec.json, assets/, renders/, previews/}.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ZodIssue } from "zod";
import { FORMATS, SceneSchema, SpecSchema, type Spec, type SpecInput } from "../engine/spec/schema";
import { STYLES } from "../engine/spec/styles";
import { PROJECTS_DIR, CUSTOM_DIR } from "./paths";
import { FONT_NAMES, isKnownFont } from "./fontNames";
import { probeAsset, type AssetInfo } from "./probe";

export type Format = keyof typeof FORMATS;

export type ProjectInfo = {
  id: string;
  name: string;
  createdAt: string;
  format: Format;
  dir: string;
};

export type ValidationResult =
  | { ok: true; durationSeconds: number; warnings: string[]; written: boolean }
  | { ok: false; errors: string[]; warnings: string[]; written: false };

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const DEFAULT_TRANSITION_SECONDS = 0.5;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const projectDir = (id: string): string => {
  if (!ID_RE.test(id)) throw new Error(`Invalid project id "${id}" (expected lowercase letters, digits and dashes)`);
  return path.join(PROJECTS_DIR, id);
};

const slugify = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const writeJson = (file: string, data: unknown) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
};

// ---------------------------------------------------------------- projects

export const createProject = (opts: { name: string; format?: Format }): ProjectInfo => {
  const format: Format = opts.format ?? "16:9";
  if (!(format in FORMATS)) throw new Error(`Unknown format "${format}". Use one of: ${Object.keys(FORMATS).join(", ")}`);
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  let id = "";
  for (let i = 0; i < 20; i++) {
    id = `${slugify(opts.name)}-${crypto.randomBytes(2).toString("hex")}`;
    if (!fs.existsSync(path.join(PROJECTS_DIR, id))) break;
  }
  const dir = projectDir(id);
  for (const sub of ["assets", "renders", "previews"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const meta = { id, name: opts.name, createdAt: new Date().toISOString(), format };
  writeJson(path.join(dir, "project.json"), meta);
  return { ...meta, dir };
};

export const getProject = (id: string): ProjectInfo => {
  const dir = projectDir(id);
  const file = path.join(dir, "project.json");
  if (!fs.existsSync(file)) throw new Error(`Project "${id}" not found. Use list_projects to see existing projects.`);
  const meta = readJson<Omit<ProjectInfo, "dir">>(file);
  return { ...meta, id, dir };
};

export const listProjects = (): (ProjectInfo & { hasSpec: boolean; updatedAt: string })[] => {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const out: (ProjectInfo & { hasSpec: boolean; updatedAt: string })[] = [];
  for (const ent of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || !ID_RE.test(ent.name)) continue;
    const file = path.join(PROJECTS_DIR, ent.name, "project.json");
    if (!fs.existsSync(file)) continue;
    try {
      const p = getProject(ent.name);
      const specFile = path.join(p.dir, "spec.json");
      const hasSpec = fs.existsSync(specFile);
      const updatedAt = new Date(fs.statSync(hasSpec ? specFile : file).mtimeMs).toISOString();
      out.push({ ...p, hasSpec, updatedAt });
    } catch {
      /* skip broken project */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

// ---------------------------------------------------------------- spec

export const specPath = (id: string) => path.join(projectDir(id), "spec.json");

/** Raw spec as written (input form, defaults not applied). null if none yet. */
export const readSpec = (id: string): SpecInput | null => {
  getProject(id);
  const file = specPath(id);
  if (!fs.existsSync(file)) return null;
  return readJson<SpecInput>(file);
};

/** Parsed spec (defaults applied), with the project's format filled in if the spec has no size. Throws if missing/invalid. */
export const loadSpec = (id: string): Spec => {
  const raw = readSpec(id);
  if (!raw) throw new Error(`Project "${id}" has no spec yet. Write one with set_spec.`);
  const parsed = SpecSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`spec.json is invalid:\n${formatIssues(parsed.error.issues).join("\n")}`);
  const spec = parsed.data;
  if (!spec.format && !(spec.width && spec.height)) spec.format = getProject(id).format;
  return spec;
};

const transitionSeconds = (t: { type: string; duration?: number } | undefined): number => {
  if (!t || t.type === "none" || t.type === "cut") return 0;
  return t.duration ?? DEFAULT_TRANSITION_SECONDS;
};

export type TimelineScene = { index: number; id?: string; start: number; end: number; duration: number; overlapIn: number };

/**
 * Scene start times on the global timeline. A transition on scene i (i > 0) overlaps it with scene i-1
 * by the transition duration (default 0.5s; "cut"/"none" = 0). Scene 0's transition is ignored.
 */
export const computeTimeline = (spec: Pick<SpecInput, "scenes">): { total: number; scenes: TimelineScene[] } => {
  const scenes: TimelineScene[] = [];
  let cursor = 0;
  spec.scenes.forEach((s, index) => {
    // Same math as the engine's specSeconds (src/engine/render/SpecVideo.tsx) — keep them in sync.
    const overlapIn = index === 0 ? 0 : transitionSeconds(s.transition);
    const start = Math.max(0, cursor - overlapIn);
    scenes.push({ index, id: s.id, start, end: start + s.duration, duration: s.duration, overlapIn });
    cursor = start + s.duration;
  });
  return { total: Math.round(cursor * 1000) / 1000, scenes };
};

export const specDurationSeconds = (spec: Pick<SpecInput, "scenes">): number => computeTimeline(spec).total;

/** Readable zod issues with JSON paths, e.g. `scenes[0].layers[2].type: Invalid discriminator value...` */
export const formatIssues = (issues: ZodIssue[]): string[] => {
  const out: string[] = [];
  const fmtPath = (p: (string | number)[]) =>
    p.reduce<string>((acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg)), "") || "(root)";
  const walk = (list: ZodIssue[], prefix: (string | number)[] = []) => {
    for (const iss of list) {
      const p = fmtPath([...prefix, ...iss.path]);
      if (iss.code === "invalid_union" && iss.unionErrors?.length) {
        // Show the branch that got furthest (fewest issues) instead of every alternative.
        const best = [...iss.unionErrors].sort((a, b) => a.issues.length - b.issues.length)[0];
        walk(best.issues, []);
        continue;
      }
      let msg = iss.message;
      if (iss.code === "invalid_union_discriminator") msg = `invalid "type". Expected one of: ${iss.options.map(String).join(", ")}`;
      else if (iss.code === "invalid_enum_value") msg = `got ${JSON.stringify(iss.received)}; expected one of: ${iss.options.join(", ")}`;
      else if (iss.code === "unrecognized_keys") msg = `unknown key(s) ${iss.keys.map((k) => `"${k}"`).join(", ")}`;
      else if (iss.code === "invalid_type") msg = `expected ${iss.expected}, got ${iss.received}`;
      out.push(`${p}: ${msg}`);
    }
  };
  walk(issues);
  return [...new Set(out)];
};

const ASSET_REF_KEYS = new Set(["src", "icon"]);

/** Walk any value; call fn for every string under a key named src/icon that points at assets/. */
const collectAssetRefs = (value: unknown, at: string, out: { path: string; at: string }[]) => {
  if (Array.isArray(value)) value.forEach((v, i) => collectAssetRefs(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const here = at ? `${at}.${k}` : k;
      if (ASSET_REF_KEYS.has(k) && typeof v === "string" && /^\.?\/?assets\//.test(v)) out.push({ path: v.replace(/^\.?\//, ""), at: here });
      else collectAssetRefs(v, here, out);
    }
  }
};

const collectFonts = (value: unknown, at: string, out: { font: string; at: string }[]) => {
  if (Array.isArray(value)) value.forEach((v, i) => collectFonts(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const here = at ? `${at}.${k}` : k;
      if (k === "font" && typeof v === "string") out.push({ font: v, at: here });
      else collectFonts(v, here, out);
    }
  }
};

const listCustomNames = (): string[] => {
  if (!fs.existsSync(CUSTOM_DIR)) return [];
  return fs.readdirSync(CUSTOM_DIR).filter((f) => /^[A-Z][A-Za-z0-9]*\.tsx$/.test(f)).map((f) => f.replace(/\.tsx$/, ""));
};

const specWarnings = (id: string, spec: Spec): string[] => {
  const warnings: string[] = [];
  const dir = projectDir(id);

  // Missing assets
  const refs: { path: string; at: string }[] = [];
  collectAssetRefs(spec, "", refs);
  for (const r of refs) {
    const abs = path.resolve(dir, r.path);
    if (!abs.startsWith(dir + path.sep) || !fs.existsSync(abs)) {
      warnings.push(`${r.at}: asset "${r.path}" does not exist in the project (add it with add_asset; list with get_project)`);
    }
  }

  // Fonts
  const fonts: { font: string; at: string }[] = [];
  collectFonts(spec, "", fonts);
  const themeFonts = spec.theme?.fonts ?? {};
  for (const [k, v] of Object.entries(themeFonts)) if (typeof v === "string") fonts.push({ font: v, at: `theme.fonts.${k}` });
  for (const f of fonts) {
    if (!isKnownFont(f.font)) {
      warnings.push(`${f.at}: unknown font "${f.font}" — it will fall back to a system font. Available: ${FONT_NAMES.join(", ")} (or $display/$body/$mono)`);
    }
  }

  // Style preset
  if (spec.style && !(spec.style in STYLES)) {
    warnings.push(`style: unknown style "${spec.style}". Available: ${Object.keys(STYLES).join(", ")}`);
  }

  // Custom components
  const customs = listCustomNames();
  const checkCustom = (layers: unknown[] | undefined, at: string) => {
    (layers ?? []).forEach((l, i) => {
      if (!l || typeof l !== "object") return;
      const layer = l as Record<string, unknown>;
      const here = `${at}[${i}]`;
      if (layer.type === "custom" && typeof layer.component === "string" && !customs.includes(layer.component)) {
        warnings.push(`${here}.component: custom component "${layer.component}" does not exist (write it with write_custom_component)`);
      }
      if (Array.isArray(layer.layers)) checkCustom(layer.layers, `${here}.layers`);
      if (Array.isArray(layer.screens)) layer.screens.forEach((s, j) => checkCustom((s as { layers?: unknown[] })?.layers, `${here}.screens[${j}].layers`));
    });
  };

  // Layer timing vs scene duration
  spec.scenes.forEach((scene, si) => {
    checkCustom(scene.layers, `scenes[${si}].layers`);
    scene.layers.forEach((layer, li) => {
      const start = layer.start ?? 0;
      if (start >= scene.duration) {
        warnings.push(`scenes[${si}].layers[${li}]: start ${start}s is >= scene duration ${scene.duration}s, so it never appears`);
      } else if (layer.duration !== undefined && start + layer.duration > scene.duration + 1e-6) {
        warnings.push(`scenes[${si}].layers[${li}]: start+duration (${start + layer.duration}s) exceeds scene duration ${scene.duration}s; it will be cut off`);
      }
    });
    if (si > 0 && scene.transition) {
      const tr = transitionSeconds(scene.transition);
      if (tr > Math.min(scene.duration, spec.scenes[si - 1].duration)) {
        warnings.push(`scenes[${si}].transition: duration ${tr}s is longer than one of the scenes it joins`);
      }
    }
  });
  if (spec.scenes[0]?.transition && transitionSeconds(spec.scenes[0].transition) > 0) {
    warnings.push(`scenes[0].transition: a transition on the first scene has nothing to transition from and is ignored`);
  }
  return warnings;
};

/** Validate without writing. */
export const validateSpec = (id: string, input: unknown): ValidationResult => {
  getProject(id);
  const parsed = SpecSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues), warnings: [], written: false };
  return { ok: true, durationSeconds: specDurationSeconds(parsed.data), warnings: specWarnings(id, parsed.data), written: false };
};

/**
 * Validate and, if valid, write spec.json (stored as given — defaults are applied at render time),
 * except that the project's format is filled in when the spec specifies no format/size.
 */
export const writeSpec = (id: string, input: unknown): ValidationResult => {
  const res = validateSpec(id, input);
  if (!res.ok) return res;
  const spec = { ...(input as Record<string, unknown>) };
  if (!spec.format && !(spec.width && spec.height)) {
    // Put format right after version/title for readability.
    const { version, title, ...rest } = spec;
    const ordered: Record<string, unknown> = {};
    if (version !== undefined) ordered.version = version;
    if (title !== undefined) ordered.title = title;
    ordered.format = getProject(id).format;
    writeJson(specPath(id), { ...ordered, ...rest });
    return { ...res, written: true };
  }
  writeJson(specPath(id), spec);
  return { ...res, written: true };
};

/** Replace scene `index` (0-based; index === scenes.length appends) and validate the whole spec before writing. */
export const updateScene = (id: string, index: number, scene: unknown): ValidationResult => {
  const raw = readSpec(id);
  if (!raw) throw new Error(`Project "${id}" has no spec yet. Write one with set_spec first.`);
  const scenes = [...(raw.scenes ?? [])];
  if (!Number.isInteger(index) || index < 0 || index > scenes.length) {
    throw new Error(`Scene index ${index} out of range (spec has ${scenes.length} scenes; use ${scenes.length} to append)`);
  }
  const sceneCheck = SceneSchema.safeParse(scene);
  if (!sceneCheck.success) {
    return {
      ok: false,
      errors: formatIssues(sceneCheck.error.issues.map((i) => ({ ...i, path: ["scenes", index, ...i.path] }))),
      warnings: [],
      written: false,
    };
  }
  scenes[index] = scene as SpecInput["scenes"][number];
  return writeSpec(id, { ...raw, scenes });
};

// ---------------------------------------------------------------- assets

const assetsDir = (id: string) => path.join(projectDir(id), "assets");
const metaCacheFile = (id: string) => path.join(projectDir(id), "assets.meta.json");

const safeFilename = (name: string): string => {
  const base = path.basename(name).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const ext = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  const stem = base
    .slice(0, base.length - path.extname(base).length)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60) || "asset";
  return stem + ext;
};

const uniqueTarget = (dir: string, filename: string): string => {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${stem}-${i}${ext}`;
  return candidate;
};

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/avif": ".avif",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/flac": ".flac",
  "application/json": ".json",
};

type MetaCache = Record<string, { mtimeMs: number; size: number; info: AssetInfo }>;

const readMetaCache = (id: string): MetaCache => {
  try {
    return readJson<MetaCache>(metaCacheFile(id));
  } catch {
    return {};
  }
};

/** Probe an asset file (cached by mtime+size). `file` is the bare filename inside assets/. */
export const getAssetInfo = async (id: string, file: string, cache?: MetaCache): Promise<AssetInfo> => {
  const abs = path.join(assetsDir(id), path.basename(file));
  if (!fs.existsSync(abs)) throw new Error(`Asset "assets/${file}" not found in project "${id}"`);
  const st = fs.statSync(abs);
  const own = cache ?? readMetaCache(id);
  const hit = own[file];
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { ...hit.info, file: abs };
  const info = await probeAsset(abs, `assets/${file}`);
  own[file] = { mtimeMs: st.mtimeMs, size: st.size, info };
  if (!cache) writeJson(metaCacheFile(id), own);
  return info;
};

export const listAssets = async (id: string): Promise<AssetInfo[]> => {
  getProject(id);
  const dir = assetsDir(id);
  if (!fs.existsSync(dir)) return [];
  const cache = readMetaCache(id);
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name).sort();
  const out: AssetInfo[] = [];
  for (const f of files) out.push(await getAssetInfo(id, f, cache));
  // Drop stale cache entries and persist.
  for (const k of Object.keys(cache)) if (!files.includes(k)) delete cache[k];
  writeJson(metaCacheFile(id), cache);
  return out;
};

/** Copy a local file or download a URL into the project's assets/. */
export const addAsset = async (id: string, src: { path?: string; url?: string; name?: string }): Promise<AssetInfo> => {
  getProject(id);
  const dir = assetsDir(id);
  fs.mkdirSync(dir, { recursive: true });
  if (!!src.path === !!src.url) throw new Error("Provide exactly one of `path` (absolute local file) or `url`.");

  if (src.path) {
    const from = path.resolve(src.path);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) throw new Error(`File not found: ${from}`);
    let filename = safeFilename(src.name ?? path.basename(from));
    if (!path.extname(filename)) filename += path.extname(from).toLowerCase();
    filename = uniqueTarget(dir, filename);
    fs.copyFileSync(from, path.join(dir, filename));
    return getAssetInfo(id, filename);
  }

  const url = new URL(src.url!);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http(s) URLs are supported, got ${url.protocol}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText} for ${url}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_DOWNLOAD_BYTES) throw new Error(`File too large (${len} bytes; limit ${MAX_DOWNLOAD_BYTES})`);
  const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  let filename = safeFilename(src.name ?? (decodeURIComponent(path.basename(url.pathname)) || "download"));
  if (!path.extname(filename) && EXT_FOR_TYPE[ctype]) filename += EXT_FOR_TYPE[ctype];
  filename = uniqueTarget(dir, filename);
  const target = path.join(dir, filename);
  const tmp = path.join(dir, `.${filename}.part`);
  let received = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_DOWNLOAD_BYTES) controller.error(new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes`));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body.pipeThrough(limiter) as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return getAssetInfo(id, filename);
};

export const deleteProject = (id: string): void => {
  const dir = projectDir(id);
  if (!fs.existsSync(path.join(dir, "project.json"))) throw new Error(`Project "${id}" not found`);
  fs.rmSync(dir, { recursive: true, force: true });
};
