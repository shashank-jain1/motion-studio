/**
 * Visual-editing model tests (web/src/lib/specEdit.ts). Run: npx tsx scripts/tests/visual-edit.test.ts
 * Schema introspection must cover every layer type; layer addressing, ids and structural edits must keep real films valid.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SpecSchema } from "../../src/engine/spec/schema";
import { preprocessSpec } from "../../src/engine/spec/preprocess";
import {
  assign, cloneWithFreshIds, getLayer, layerForm, layerLabel, layerTypes, newLayer, parentList, parentOffset, sceneLayerIds, scenesOf, toHex,
  type Json, type RawLayer,
} from "../../web/src/lib/specEdit";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${(e as Error).stack}`); process.exitCode = 1; }
};
const valid = (raw: unknown) => {
  const r = SpecSchema.safeParse(preprocessSpec(raw));
  assert.ok(r.success, r.success ? "" : r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
};
const films = fs.readdirSync(path.join(ROOT, "projects"))
  .map((d) => path.join(ROOT, "projects", d, "spec.json"))
  .filter((f) => fs.existsSync(f))
  .map((f) => ({ name: path.basename(path.dirname(f)), spec: JSON.parse(fs.readFileSync(f, "utf8")) as Json }))
  .filter(({ spec }) => SpecSchema.safeParse(preprocessSpec(spec)).success);

test("introspection covers every layer type", () => {
  const types = layerTypes();
  assert.ok(types.length >= 20, `only ${types.length} layer types`);
  for (const t of types) {
    const f = layerForm(t)!;
    assert.ok(f, t);
    assert.deepEqual(f.transform.map((x) => x.key), ["x", "y", "width", "height", "scale", "rotate", "opacity", "zIndex"], t);
    assert.deepEqual(f.timing.map((x) => x.key), ["start", "duration"], t);
    assert.deepEqual(f.motion.map((x) => x.kind), ["motion", "motion"], t);
    for (const x of [...f.content, ...f.style, ...f.more]) assert.notEqual(x.kind, "complex", `${t}.${x.key}`);
  }
});

test("text layer form: content, enums, colors, booleans", () => {
  const f = layerForm("text")!;
  const all = [...f.content, ...f.style];
  const by = (k: string) => all.find((x) => x.key === k);
  assert.equal(by("text")?.kind, "string");
  assert.ok(by("text")?.kind === "string" && by("text")!.kind === "string" && (by("text") as { multiline: boolean }).multiline);
  assert.equal(by("preset")?.kind, "enum");
  assert.ok((by("color") as { color: boolean }).color, "color detected");
  assert.equal(by("uppercase")?.kind, "boolean");
  assert.equal(by("fontSize")?.kind, "number");
  assert.ok(f.complex.includes("highlight") && f.complex.includes("animate"));
});

test("counter `to` is a content number; device frameColor is a color", () => {
  assert.equal(layerForm("counter")!.content.find((x) => x.key === "to")?.kind, "number");
  assert.ok((layerForm("device")!.style.find((x) => x.key === "frameColor") as { color?: boolean } | undefined)?.color);
});

test("toHex resolves tokens, short hex and rgb", () => {
  const theme = { bg: "#0a0b0c", accent: "$hot", hot: "#F00" };
  assert.equal(toHex("$bg", theme), "#0a0b0c");
  assert.equal(toHex("$accent", theme), "#ff0000");
  assert.equal(toHex("rgba(255, 128, 0, 0.5)", theme), "#ff8000");
  assert.equal(toHex("linear-gradient(red, blue)", theme), null);
  assert.equal(toHex("$missing", theme), null);
});

const nested: Json = {
  fps: 30, format: "16:9",
  scenes: [{
    duration: 3, layers: [
      { type: "text", id: "a", text: "Hi" },
      { type: "group", id: "g", x: 100, y: -50, layers: [{ type: "shape", id: "s", shape: "rect", x: 10 }, { type: "group", x: 5, y: 5, layers: [{ type: "text", text: "deep" }] }] },
    ],
  }],
};

test("addressing nested group layers and offsets", () => {
  assert.equal(getLayer(nested, { scene: 0, path: [1, 0] })?.id, "s");
  assert.equal(getLayer(nested, { scene: 0, path: [1, 1, 0] })?.text, "deep");
  assert.equal(getLayer(nested, { scene: 0, path: [9] }), null);
  assert.equal(getLayer(nested, { scene: 4, path: [0] }), null);
  assert.deepEqual(parentOffset(nested, { scene: 0, path: [1, 1, 0] }), { x: 105, y: -45 });
  assert.deepEqual(parentOffset(nested, { scene: 0, path: [0] }), { x: 0, y: 0 });
  const p = parentList(nested, { scene: 0, path: [1, 1] })!;
  assert.equal(p.index, 1);
  assert.equal(p.list.length, 2);
});

test("labels and assign", () => {
  assert.equal(layerLabel({ type: "text", text: "  Hello\n  world " }), "Hello world");
  assert.equal(layerLabel({ type: "media", src: "assets/hero.png" }), "hero.png");
  assert.equal(layerLabel({ type: "counter", to: 98, suffix: "%" }), "98%");
  const o: Json = { a: 1 };
  assign(o, "a", undefined);
  assign(o, "b", 0);
  assert.deepEqual(o, { b: 0 });
});

test("duplicates get unique ids (whole subtree)", () => {
  const taken = sceneLayerIds(nested, 0);
  const copy = cloneWithFreshIds(getLayer(nested, { scene: 0, path: [1] }) as RawLayer, taken);
  assert.equal(copy.id, "g-2");
  assert.equal((copy.layers as RawLayer[])[0].id, "s-2");
  assert.equal(getLayer(nested, { scene: 0, path: [1] })?.id, "g", "original untouched");
});

test(`edits keep ${films.length} real films valid`, () => {
  assert.ok(films.length >= 3, "expected sample films in projects/");
  for (const { name, spec } of films) {
    const d = structuredClone(spec);
    const scenes = scenesOf(d);
    // every layer: move, rescale, retime; every scene: retime; then add + duplicate + delete
    scenes.forEach((sc, si) => {
      sc.duration = Math.max(0.5, (typeof sc.duration === "number" ? sc.duration : 2) + 0.25);
      (sc.layers ?? []).forEach((_, li) => {
        const l = getLayer(d, { scene: si, path: [li] })!;
        assign(l, "x", ((typeof l.x === "number" ? l.x : 0) + 12));
        assign(l, "opacity", 0.9);
        assign(l, "enter", { type: "rise", duration: 0.5 });
      });
    });
    const sc0 = scenes[0];
    sc0.layers = [...(sc0.layers ?? []), newLayer("text", { width: 1080, height: 1920 }), newLayer("shape", { width: 1080, height: 1920 })];
    const p = parentList(d, { scene: 0, path: [0] })!;
    p.list.splice(1, 0, cloneWithFreshIds(p.list[0], sceneLayerIds(d, 0)));
    p.list.splice(0, 1);
    try { valid(d); } catch (e) { throw new Error(`${name}: ${(e as Error).message}`); }
  }
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
