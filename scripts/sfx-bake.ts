/**
 * Host side of cue baking (Node). The engine describes each planned cue as a recipe (src/engine/audio/bake.ts) and
 * requests `${libraryBase}/bake/<hash>.wav?r=<recipe>`; the host calls `ensureBaked()` which renders the recipe once
 * (pure JS DSP, deterministic) into library/bake/<hash>.wav and serves it from there afterwards.
 *
 *   asset server (CLI / MCP / local renders)   src/core/assetServer.ts  → /_library/bake/<hash>.wav?r=…
 *   web server (Player)                        src/server/index.ts      → /library/bake/<hash>.wav?r=…
 *   Lambda                                     soundFilesForSpec(spec)  → pre-bakes + lists files to upload
 *
 * The cache is bounded (oldest files beyond MAX_CACHE are removed) and recipes are validated (known library names,
 * bounded lengths / gains) because they arrive in URLs.
 */
import fs from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../src/core/paths";
import { decodeWav, encodeWav, type Buf } from "../src/engine/audio/dsp";
import { decodeRecipe, recipeHash, renderRecipe, validateRecipe } from "../src/engine/audio/bake";
import { SFX, resolveSfx } from "../src/engine/audio/library";
import { planSoundV2 } from "../src/engine/audio/autoSound";
import { preprocessSpecDetailed, sceneTimeline } from "../src/engine/spec/preprocess";
import { SpecSchema, type Spec } from "../src/engine/spec/schema";

export const BAKE_DIR = path.join(LIBRARY_DIR, "bake");
const MAX_CACHE = 4000;

const cache = new Map<string, Buf>();
/** Decoded library sound by manifest name (LRU-ish, small). */
const loadSound = (name: string): Buf | null => {
  const e = SFX[name];
  if (!e) return null;
  const hit = cache.get(name);
  if (hit) return hit;
  const file = path.join(LIBRARY_DIR, "sfx", e.file);
  if (!fs.existsSync(file)) return null;
  const buf = decodeWav(new Uint8Array(fs.readFileSync(file)));
  if (cache.size > 120) cache.delete(cache.keys().next().value!);
  cache.set(name, buf);
  return buf;
};

let writes = 0;
const prune = () => {
  if (++writes % 200 !== 0) return;
  try {
    const files = fs.readdirSync(BAKE_DIR).filter((f) => f.endsWith(".wav")).map((f) => ({ f, t: fs.statSync(path.join(BAKE_DIR, f)).mtimeMs }));
    if (files.length <= MAX_CACHE) return;
    files.sort((a, b) => a.t - b.t).slice(0, files.length - MAX_CACHE).forEach((x) => fs.rmSync(path.join(BAKE_DIR, x.f), { force: true }));
  } catch { /* best effort */ }
};

/** Render (if needed) the recipe `enc` and return the cached file path. Throws on an invalid recipe / hash mismatch. */
export const bakeRecipe = (enc: string, expectHash?: string): string => {
  const hash = recipeHash(enc);
  if (expectHash && expectHash !== hash) throw new Error("recipe hash mismatch");
  const out = path.join(BAKE_DIR, `${hash}.wav`);
  if (fs.existsSync(out)) return out;
  const r = decodeRecipe(enc);
  validateRecipe(r, (n) => !!SFX[n]);
  const buf = renderRecipe(r, loadSound);
  fs.mkdirSync(BAKE_DIR, { recursive: true });
  const tmp = `${out}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, encodeWav(buf, parseInt(hash.slice(0, 8), 16)));
  fs.renameSync(tmp, out);
  prune();
  return out;
};

/**
 * For a request under the library route: `rel` like "/bake/<hash>.wav", `query` = URLSearchParams. Returns the
 * absolute file to serve, or null when this is not a bake request. Errors (bad recipe) throw.
 */
export const ensureBaked = (rel: string, query: URLSearchParams): string | null => {
  const m = /^\/?bake\/([0-9a-f]{16})\.wav$/.exec(rel);
  if (!m) return null;
  const out = path.join(BAKE_DIR, `${m[1]}.wav`);
  if (fs.existsSync(out)) return out;
  const r = query.get("r");
  if (!r || r.length > 8192) throw new Error("missing recipe");
  return bakeRecipe(r, m[1]);
};

/** Parse a raw spec exactly like SpecVideo and plan its sound (Node: Lambda pre-bake, tests). */
export const planForSpec = (raw: unknown) => {
  const pre = preprocessSpecDetailed(raw);
  const spec: Spec = SpecSchema.parse(pre.spec);
  const tl = sceneTimeline(spec.scenes, spec.fps);
  const total = tl.totalFrames / spec.fps;
  return { spec, total, plan: spec.sound && spec.sound.auto !== false ? planSoundV2(spec, tl, { fps: spec.fps, total }) : null };
};

/**
 * Library files a render of `raw` needs, relative to LIBRARY_DIR (e.g. "sfx/whoosh-short.wav", "bake/<hash>.wav"),
 * with every bake rendered. Lambda uploads them under `_library/`.
 */
export const soundFilesForSpec = (raw: unknown): string[] => {
  const { spec, plan } = planForSpec(raw);
  const out = new Set<string>();
  const base = "http://x/_library";
  for (const s of [...(spec.sfx ?? []).map((x) => x.src), ...(plan?.cues ?? []).map((c) => c.src)]) {
    const url = resolveSfx(s, base);
    if (!url || !url.startsWith(base)) continue;
    const u = new URL(url);
    const rel = u.pathname.slice("/_library/".length);
    if (rel.startsWith("bake/")) { const r = u.searchParams.get("r"); if (r) bakeRecipe(r); }
    out.add(rel);
  }
  return [...out];
};
