/**
 * Visual-editing model: addressing layers inside a raw spec, mutating drafts, and reading the engine's zod schema so
 * the inspector can render a field for every primitive property of any layer type without a hand-written form per type.
 * Everything here works on the RAW spec (what the editor text holds), never on the parsed/preprocessed one, so a visual
 * edit changes exactly one key and leaves musical time strings, theme tokens and unknown keys untouched.
 */
import { z } from "zod";
import { LayerSchema, TRANSITIONS, ENTER_PRESETS } from "../../../src/engine/spec/schema";

export type Json = Record<string, unknown>;
export type RawLayer = Json & { type?: string; layers?: RawLayer[] };
export type RawScene = Json & { layers?: RawLayer[]; duration?: unknown; transition?: Json; background?: unknown };

/** A layer address: scene index + indices through nested group `layers` arrays. */
export type LayerSel = { scene: number; path: number[] };

export const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
export const selKey = (s: LayerSel) => `${s.scene}:${s.path.join(".")}`;

export const scenesOf = (spec: Json | null | undefined): RawScene[] => (Array.isArray(spec?.scenes) ? (spec!.scenes as RawScene[]) : []);

export const getLayer = (spec: Json | null | undefined, sel: LayerSel | null): RawLayer | null => {
  if (!sel) return null;
  let list = scenesOf(spec)[sel.scene]?.layers;
  let l: RawLayer | undefined;
  for (const i of sel.path) {
    if (!Array.isArray(list)) return null;
    l = list[i];
    if (!l || typeof l !== "object") return null;
    list = l.layers;
  }
  return l ?? null;
};

/** The array that holds the addressed layer (for reorder / delete / duplicate) and its index there. */
export const parentList = (spec: Json, sel: LayerSel): { list: RawLayer[]; index: number } | null => {
  const scene = scenesOf(spec)[sel.scene];
  if (!scene || !sel.path.length) return null;
  let list = scene.layers;
  for (const i of sel.path.slice(0, -1)) {
    const g = Array.isArray(list) ? list[i] : undefined;
    if (!g) return null;
    list = g.layers;
  }
  return Array.isArray(list) ? { list, index: sel.path[sel.path.length - 1] } : null;
};

/** Sum of ancestor group x/y: children of a group are positioned relative to the group's offset (SpecVideo findLayer). */
export const parentOffset = (spec: Json | null | undefined, sel: LayerSel): { x: number; y: number } => {
  let list = scenesOf(spec)[sel.scene]?.layers;
  let x = 0, y = 0;
  for (const i of sel.path.slice(0, -1)) {
    const g = Array.isArray(list) ? list[i] : undefined;
    if (!g) break;
    x += num(g.x) ?? 0; y += num(g.y) ?? 0;
    list = g.layers;
  }
  return { x, y };
};

export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Assign or (for undefined) delete a key so cleared fields fall back to engine defaults instead of being written as null. */
export const assign = (o: Json, key: string, v: unknown) => { if (v === undefined) delete o[key]; else o[key] = v; };

export const layerLabel = (l: RawLayer): string => {
  if (typeof l.id === "string" && l.id) return l.id;
  for (const k of ["text", "title", "body", "label"]) {
    const v = l[k];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim().slice(0, 40);
  }
  if (typeof l.src === "string") return l.src.split("/").pop() ?? l.src;
  if (l.type === "counter") return `${l.prefix ?? ""}${l.to ?? ""}${l.suffix ?? ""}`;
  if (l.type === "code" && typeof l.code === "string") return (l.code.split("\n").find((x: string) => x.trim()) ?? "code").trim().slice(0, 40);
  if (l.type === "chart") return `${l.kind ?? ""} chart`.trim();
  if (l.type === "diagram" && Array.isArray(l.nodes)) return l.nodes.map((n: { label?: string }) => n.label).filter(Boolean).slice(0, 3).join(" → ") || "diagram";
  if (l.type === "visualizer") return `${l.style ?? ""} visualizer`.trim();
  if (l.type === "shape" && typeof l.shape === "string") return l.shape;
  return String(l.type ?? "layer");
};

/** Unique id among siblings/whole scene: "hero" → "hero-2". */
export const uniqueId = (taken: Set<string>, base: string) => {
  const stem = base.replace(/-\d+$/, "");
  for (let n = 2; ; n++) { const id = `${stem}-${n}`; if (!taken.has(id)) return id; }
};

const collectIds = (ls: RawLayer[] | undefined, out = new Set<string>()) => {
  for (const l of ls ?? []) { if (typeof l.id === "string") out.add(l.id); collectIds(l.layers, out); }
  return out;
};

/** Deep copy with every layer id made unique within `taken` (ids are referenced by transitions/actors, so dupes would be ambiguous). */
export const cloneWithFreshIds = <T extends RawLayer | RawScene>(node: T, taken: Set<string>): T => {
  const c = structuredClone(node);
  const walk = (ls: RawLayer[] | undefined) => {
    for (const l of ls ?? []) {
      if (typeof l.id === "string") { l.id = uniqueId(taken, l.id); taken.add(l.id as string); }
      walk(l.layers);
    }
  };
  if ((c as RawLayer).type) walk([c as RawLayer]); else walk((c as RawScene).layers);
  return c;
};

export const sceneLayerIds = (spec: Json, scene: number) => collectIds(scenesOf(spec)[scene]?.layers);
export const allSceneIds = (spec: Json) => new Set(scenesOf(spec).map((s) => s.id).filter((x): x is string => typeof x === "string"));

/** Resolve a CSS color or `$token` to a hex for the native color well (null if not representable). */
export const toHex = (v: unknown, theme: Record<string, string>): string | null => {
  let s = typeof v === "string" ? v.trim() : "";
  for (let i = 0; i < 4 && s.startsWith("$"); i++) s = theme[s.slice(1)] ?? "";
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + [...s.slice(1)].map((c) => c + c).join("")).toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, "0")).join("");
  return null;
};

// ---------------------------------------------------------------------------------------------------------------
// Schema introspection

export type FieldKind =
  | { kind: "number"; min?: number; max?: number; int?: boolean }
  | { kind: "string"; color: boolean; multiline: boolean }
  | { kind: "boolean" }
  | { kind: "enum"; options: string[] }
  | { kind: "motion" }
  | { kind: "complex" };

export type FieldDef = { key: string; doc?: string } & FieldKind;

const unwrap = (t: z.ZodTypeAny): { t: z.ZodTypeAny; doc?: string } => {
  let doc = t.description;
  for (let i = 0; i < 8; i++) {
    if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) t = t.unwrap();
    else if (t instanceof z.ZodDefault) t = t._def.innerType;
    else if (t instanceof z.ZodEffects) t = t.innerType();
    else break;
    doc ??= t.description;
  }
  return { t, doc };
};

const COLOR_KEY = /(^|[a-z])(color|Color)$|^(background|accent|fill|stroke|frameColor|thumbColor|offColor|base)$/;
const MULTILINE = new Set(["text", "body", "notes"]);

export const describeField = (key: string, type: z.ZodTypeAny): FieldDef => {
  const { t, doc } = unwrap(type);
  if (t instanceof z.ZodNumber) {
    const checks = (t._def.checks ?? []) as { kind: string; value?: number }[];
    return { key, doc, kind: "number", min: checks.find((c) => c.kind === "min")?.value, max: checks.find((c) => c.kind === "max")?.value, int: checks.some((c) => c.kind === "int") };
  }
  if (t instanceof z.ZodString) return { key, doc, kind: "string", color: COLOR_KEY.test(key), multiline: MULTILINE.has(key) };
  if (t instanceof z.ZodBoolean) return { key, doc, kind: "boolean" };
  if (t instanceof z.ZodEnum) return { key, doc, kind: "enum", options: [...t.options] as string[] };
  if ((key === "enter" || key === "exit") && t instanceof z.ZodObject) return { key, doc, kind: "motion" };
  return { key, doc, kind: "complex" };
};

type AnyObj = z.ZodObject<z.ZodRawShape>;
let unionCache: Map<string, AnyObj> | null = null;
const layerSchemas = (): Map<string, AnyObj> => {
  if (unionCache) return unionCache;
  const union = (LayerSchema as unknown as z.ZodLazy<z.ZodTypeAny>).schema as unknown as { optionsMap: Map<unknown, AnyObj> };
  unionCache = new Map([...union.optionsMap.entries()].map(([k, v]) => [String(k), v]));
  return unionCache;
};
export const layerTypes = () => [...layerSchemas().keys()];

/** Keys every layer shares (commonLayer) — used to separate "this type's own properties" from generic ones. */
const COMMON = new Set([
  "id", "start", "duration", "x", "y", "z", "width", "height", "scale", "rotate", "rotateX", "rotateY", "opacity", "blur", "origin",
  "zIndex", "depth", "blendMode", "shadow", "enter", "exit", "animate", "loop", "gesture", "accents", "motionBlur", "css",
]);
const CONTENT = ["text", "title", "body", "meta", "label", "prefix", "to", "from", "suffix", "src", "icon", "url", "variant", "shape", "model", "mode", "preset"];
const TRANSFORM = ["x", "y", "width", "height", "scale", "rotate", "opacity", "zIndex"];
const TIMING = ["start", "duration"];
const MORE = ["z", "rotateX", "rotateY", "blur", "depth", "origin", "blendMode"];

export type LayerForm = {
  content: FieldDef[]; style: FieldDef[]; transform: FieldDef[]; timing: FieldDef[]; motion: FieldDef[]; more: FieldDef[];
  /** Keys present on this layer (or meaningful for its type) that need the JSON editor: arrays, nested objects, unions. */
  complex: string[];
};

const formCache = new Map<string, LayerForm>();
export const layerForm = (type: string): LayerForm | null => {
  const hit = formCache.get(type);
  if (hit) return hit;
  const schema = layerSchemas().get(type);
  if (!schema) return null;
  const shape = schema.shape;
  const def = (k: string) => (shape[k] ? describeField(k, shape[k] as z.ZodTypeAny) : null);
  const pick = (keys: string[]) => keys.map(def).filter((f): f is FieldDef => !!f && f.kind !== "complex");
  const own = Object.keys(shape).filter((k) => k !== "type" && !COMMON.has(k));
  const content = pick(CONTENT.filter((k) => own.includes(k)));
  const style = pick(own.filter((k) => !CONTENT.includes(k)));
  const complex = [...own, "animate", "loop", "gesture", "accents", "shadow", "motionBlur", "css"].filter((k) => shape[k] && def(k)?.kind === "complex");
  const form: LayerForm = {
    content, style, transform: pick(TRANSFORM), timing: pick(TIMING), more: pick(MORE),
    motion: ["enter", "exit"].map(def).filter((f): f is FieldDef => !!f),
    complex,
  };
  formCache.set(type, form);
  return form;
};

export const ENTER_OPTIONS: string[] = [...ENTER_PRESETS];
export const TRANSITION_OPTIONS: string[] = [...TRANSITIONS];

/** Starter layers for the "+ Add" menu. Positions are frame-center relative; sizes are relative to the frame. */
export const newLayer = (kind: "text" | "shape" | "media", frame: { width: number; height: number }, src?: string): RawLayer => {
  const short = Math.min(frame.width, frame.height);
  switch (kind) {
    case "text": return { type: "text", text: "New title", preset: "blur-rise", fontSize: Math.round(short * 0.09), color: "$fg" };
    case "shape": return { type: "shape", shape: "rect", width: Math.round(short * 0.4), height: Math.round(short * 0.24), radius: 24, color: "$accent", enter: { type: "pop" } };
    case "media": return { type: "media", src: src ?? "", width: Math.round(short * 0.6), height: Math.round(short * 0.6), fit: "cover", radius: 16, enter: { type: "reveal-up" } };
  }
};
