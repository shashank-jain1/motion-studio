/**
 * Human-readable difference between two raw specs: what a save changed, scene by scene and layer by layer.
 * Pure (no node APIs) so the server (version history) and the web app (compare) share it.
 * Scenes and layers are matched by `id` when they have one, otherwise by position.
 */
type Json = Record<string, unknown>;

export type SceneChange = { label: string; status: "added" | "removed" | "changed" | "moved"; details: string[] };
export type SpecDiff = {
  /** Top-level keys other than scenes that changed (theme, sound, actors, format…). */
  film: string[];
  scenes: SceneChange[];
  /** Short lines for a list ("Scene 2 “hook”: text “Hi” x, y"). */
  lines: string[];
  /** One line ("2 scenes changed · palette"), "" when identical. */
  summary: string;
  identical: boolean;
};

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
/** JSON with sorted keys, so key order never counts as a change. */
export const stable = (v: unknown): string => JSON.stringify(v, (_, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)) ?? "null";

const quote = (s: string, n = 24) => { const t = s.replace(/\s+/g, " ").trim(); return `“${t.length > n ? t.slice(0, n - 1) + "…" : t}”`; };

const layerName = (l: Json): string => {
  const type = String(l.type ?? "layer");
  if (typeof l.id === "string") return `${type} ${l.id}`;
  for (const k of ["text", "title", "body", "label"]) if (typeof l[k] === "string" && (l[k] as string).trim()) return `${type} ${quote(l[k] as string)}`;
  if (typeof l.src === "string") return `${type} ${(l.src as string).split("/").pop()}`;
  return type;
};

const sceneName = (s: Json, i: number) => `Scene ${i + 1}${typeof s.id === "string" ? ` ${quote(s.id, 20)}` : ""}`;

const KEY_LABEL: Record<string, string> = { theme: "palette & fonts", sound: "sound", actors: "actors", music: "music", fonts: "fonts", format: "format", formats: "formats", fps: "fps", style: "style", concept: "concept" };

type Keyed = { key: string; index: number; v: Json };
const keyed = (list: unknown, kind: string): Keyed[] => {
  const arr = Array.isArray(list) ? list.filter(isObj) : [];
  const seen = new Map<string, number>();
  return arr.map((v, index) => {
    // id-less items are matched by type + occurrence, which survives inserting a different-typed item before them
    const base = typeof v.id === "string" ? `id:${v.id}` : `${kind}:${String(v.type ?? "")}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: typeof v.id === "string" ? base : `${base}#${n}`, index, v };
  });
};

const changedKeys = (a: Json, b: Json, skip: string[] = []) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.includes(k) && !same(a[k], b[k]));

const layerChanges = (a: unknown, b: unknown): string[] => {
  const A = keyed(a, "layer"), B = keyed(b, "layer");
  const bMap = new Map(B.map((x) => [x.key, x]));
  const aKeys = new Set(A.map((x) => x.key));
  const out: string[] = [];
  for (const x of A) {
    const y = bMap.get(x.key);
    if (!y) { out.push(`removed ${layerName(x.v)}`); continue; }
    const keys = changedKeys(x.v, y.v, ["layers"]);
    const kids = Array.isArray(x.v.layers) || Array.isArray(y.v.layers) ? layerChanges(x.v.layers, y.v.layers) : [];
    if (keys.length) out.push(`${layerName(y.v)}: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ` +${keys.length - 5}` : ""}`);
    out.push(...kids.map((k) => `${layerName(y.v)} › ${k}`));
  }
  for (const y of B) if (!aKeys.has(y.key)) out.push(`added ${layerName(y.v)}`);
  // same set, different order = restacked
  if (!out.length && A.length === B.length && A.some((x, i) => B[i]?.key !== x.key)) out.push("layers reordered");
  return out;
};

export const diffSpecs = (before: unknown, after: unknown): SpecDiff => {
  const a = isObj(before) ? before : {}, b = isObj(after) ? after : {};
  const film = changedKeys(a, b, ["scenes"]);
  const A = keyed(a.scenes, "scene"), B = keyed(b.scenes, "scene");
  const aMap = new Map(A.map((x) => [x.key, x]));
  const bKeys = new Set(B.map((x) => x.key));
  const scenes: SceneChange[] = [];
  for (const y of B) {
    const x = aMap.get(y.key);
    const label = sceneName(y.v, y.index);
    if (!x) { scenes.push({ label, status: "added", details: [] }); continue; }
    const details = [
      ...changedKeys(x.v, y.v, ["layers", "id"]).map((k) => (k === "duration" ? `duration ${fmt(x.v.duration)} → ${fmt(y.v.duration)}` : k)),
      ...layerChanges(x.v.layers, y.v.layers),
    ];
    if (details.length) scenes.push({ label, status: "changed", details });
    else if (x.index !== y.index) scenes.push({ label, status: "moved", details: [`was scene ${x.index + 1}`] });
  }
  for (const x of A) if (!bKeys.has(x.key)) scenes.push({ label: sceneName(x.v, x.index), status: "removed", details: [] });

  const lines: string[] = [
    ...film.map((k) => `Film: ${KEY_LABEL[k] ?? k} changed`),
    ...scenes.map((s) => `${s.label} ${s.status}${s.details.length ? `: ${s.details.slice(0, 3).join(" · ")}${s.details.length > 3 ? ` · +${s.details.length - 3} more` : ""}` : ""}`),
  ];
  const count = (st: SceneChange["status"]) => scenes.filter((s) => s.status === st).length;
  const parts = [
    ...(["added", "removed", "changed", "moved"] as const).flatMap((st) => {
      const n = count(st);
      if (!n) return [];
      // one or two changed scenes name themselves — "Scene 2 “hook”: text x, y" reads better than "2 scenes changed"
      if (n <= 2 && st === "changed") return scenes.filter((z) => z.status === st).map((s) => `${s.label}: ${s.details[0]}${s.details.length > 1 ? ` +${s.details.length - 1}` : ""}`);
      return [`${n} scene${n === 1 ? "" : "s"} ${st}`];
    }),
    ...film.map((k) => KEY_LABEL[k] ?? k),
  ].filter(Boolean);
  return { film, scenes, lines, summary: parts.slice(0, 3).join(" · ") + (parts.length > 3 ? ` · +${parts.length - 3}` : ""), identical: !parts.length };
};

const fmt = (v: unknown) => (typeof v === "number" ? `${+v.toFixed(2)}s` : String(v ?? "—"));
