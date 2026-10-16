/**
 * reflowSpec tests (one spec → every platform). Run: npx tsx scripts/tests/reflow.test.ts
 * Real films from projects/ × every format, plus synthetic layouts for the restack / two-column / grid rules.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FORMATS, SpecSchema, type Spec } from "../../src/engine/spec/schema";
import { preprocessSpec } from "../../src/engine/spec/preprocess";
import { FORMAT_LIST, SAFE_ZONES, adaptTargets, estimateBox, layoutBoxes, masterFormat, reflowSpec, type Format } from "../../src/engine/spec/reflow";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROJECTS = ["brew-film-f96a", "loopa-reel-049c", "orbit-pay-demo-0086", "neon-drop-test-6aa4", "test-logo-morph"];

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n${(e as Error).stack}`);
    process.exitCode = 1;
  }
};

const parse = (raw: unknown): Spec => {
  const r = SpecSchema.safeParse(preprocessSpec(raw));
  if (!r.success) throw new Error(r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};
const load = (id: string): Spec => {
  const dir = path.join(ROOT, "projects", id);
  const spec = parse(JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")));
  if (!spec.format) spec.format = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).format;
  return spec;
};
const shape = (s: Spec) => s.scenes.map((sc) => sc.layers.map((l) => l.type).join(","));
const TOL = 3;

const loadTemplate = (slug: string): Spec => parse(JSON.parse(fs.readFileSync(path.join(ROOT, "templates", slug, "spec.json"), "utf8")));
const TEMPLATES = fs.existsSync(path.join(ROOT, "templates"))
  ? fs.readdirSync(path.join(ROOT, "templates")).filter((d) => fs.existsSync(path.join(ROOT, "templates", d, "spec.json"))).sort()
  : [];

console.log("reflow: real projects + gallery templates × formats");
for (const id of [...PROJECTS, ...TEMPLATES.map((t) => `template:${t}`)]) {
  const isTpl = id.startsWith("template:");
  if (!isTpl && !fs.existsSync(path.join(ROOT, "projects", id, "spec.json"))) { console.log(`  skip ${id} (not present)`); continue; }
  const spec = isTpl ? loadTemplate(id.slice(9)) : load(id);
  const master = masterFormat(spec);
  for (const f of FORMAT_LIST) {
    test(`${id} → ${f}`, () => {
      const out = reflowSpec(spec, f);
      // valid, right format, no stale explicit size
      parse(out);
      assert.equal(out.format, f);
      assert.equal(out.width, undefined);
      assert.equal(out.height, undefined);
      // deterministic + pure
      assert.equal(JSON.stringify(reflowSpec(spec, f)), JSON.stringify(out));
      assert.notEqual(out, spec);
      // structure, order and z untouched
      assert.deepEqual(shape(out), shape(spec));
      assert.deepEqual(out.scenes.map((s) => s.layers.map((l) => l.zIndex ?? null)), spec.scenes.map((s) => s.layers.map((l) => l.zIndex ?? null)));
      assert.equal(out.scenes.length, spec.scenes.length);
      if (f === master) {
        // the master is authored natively: identity
        assert.deepEqual(JSON.parse(JSON.stringify({ ...out, format: spec.format })), JSON.parse(JSON.stringify(spec)));
        return;
      }
      // critical content inside the target's universal safe zone
      const S = SAFE_ZONES[f];
      for (const b of layoutBoxes(out)) {
        if (!b.critical) continue;
        const where = `scene ${b.scene} ${b.actor ? `actor ${b.actor}` : `layer ${b.layer}`} (${b.type}) at ${b.x},${b.y} ${Math.round(b.w)}×${Math.round(b.h)}`;
        if (b.type === "text" && Math.abs(b.w - 0.9 * FORMATS[f][0]) < 1) continue; // at the floor and auto-fit by the engine to 90% of the frame
        assert.ok(b.x - b.w / 2 >= S.l - TOL && b.x + b.w / 2 <= S.r + TOL, `x outside safe: ${where}`);
        assert.ok(b.y - b.h / 2 >= S.t - TOL && b.y + b.h / 2 <= S.b + TOL, `y outside safe: ${where}`);
      }
      // readable type on verticals: hook ≥ 80, body ≥ 48 (unless authored as micro-type)
      const vertical = f === "9:16" || f === "4:5";
      spec.scenes.forEach((sc, si) => sc.layers.forEach((l, li) => {
        const o = out.scenes[si].layers[li];
        if ((l.type === "text" || l.type === "counter") && (o.type === "text" || o.type === "counter")) {
          const fs0 = l.fontSize ?? (l.type === "text" ? 120 : 140);
          const fs1 = o.fontSize ?? fs0;
          if (vertical && fs0 >= 28) assert.ok(fs1 >= 48, `scene ${si} layer ${li}: ${fs0}px → ${fs1}px is below the 48px body floor`);
          if (!vertical) assert.ok(fs1 >= Math.min(fs0, 48) - 0.5, `scene ${si} layer ${li}: ${fs0}px shrank to ${fs1}px`);
        }
      }));
      // snapTo poses are left to the engine
      spec.actors?.forEach((a, ai) => a.poses.forEach((p, pi) => {
        if (p.snapTo) assert.deepEqual(out.actors![ai].poses[pi], p);
      }));
    });
  }
}

console.log("reflow: rules");

const base = (format: Format, layers: unknown[], extra: Record<string, unknown> = {}) =>
  parse({ format, fps: 30, scenes: [{ id: "a", duration: 3, background: { type: "solid", color: "#111" }, layers }], ...extra });

test("adaptTargets: master first, deduped, valid only", () => {
  assert.deepEqual(adaptTargets({ format: "9:16", formats: ["16:9", "9:16", "1:1", "16:9"] } as never), ["9:16", "16:9", "1:1"]);
  assert.deepEqual(adaptTargets({} as never), ["16:9"]);
  assert.equal(masterFormat({ width: 1080, height: 1350 } as never), "4:5");
});

test("16:9 row of three cards restacks into a centered column on 9:16 (left→top)", () => {
  const spec = base("16:9", [
    { type: "card", variant: "stat", id: "a", title: "One", width: 480, x: -620, y: 0 },
    { type: "card", variant: "stat", id: "b", title: "Two", width: 480, x: 0, y: 0 },
    { type: "card", variant: "stat", id: "c", title: "Three", width: 480, x: 620, y: 0 },
  ]);
  const out = reflowSpec(spec, "9:16");
  const [a, b, c] = out.scenes[0].layers as { x?: number; y?: number; width?: number }[];
  // the three equal peers wrap into lines (grid) or a column: never left side by side off-frame
  const ys = [a.y ?? 0, b.y ?? 0, c.y ?? 0];
  assert.ok(new Set(ys.map((y) => Math.round(y))).size >= 2, `still one row: ${ys}`);
  assert.ok(ys[0] <= ys[1] && ys[1] <= ys[2], `reading order lost: ${ys}`);
  for (const l of [a, b, c]) assert.ok(Math.abs(l.x ?? 0) + (l.width ?? 0) / 2 <= 420 + TOL, `card outside safe x: ${l.x} w ${l.width}`);
});

test("16:9 phone with side satellites: notification above, badge below, both tucked onto the phone", () => {
  const spec = base("16:9", [
    { type: "device", model: "iphone", height: 860, y: 40 },
    { type: "card", variant: "notification", title: "Pay", body: "Received", width: 600, x: 560, y: -300 },
    { type: "card", variant: "pill", title: "Face ID verified", x: -560, y: 260 },
  ]);
  const out = reflowSpec(spec, "9:16");
  const [phone, note, pill] = out.scenes[0].layers as { x?: number; y?: number; scale?: number }[];
  assert.ok((note.y ?? 0) < (phone.y ?? 0) && (phone.y ?? 0) < (pill.y ?? 0), "order notification / phone / pill");
  const k = phone.scale ?? 1;
  assert.ok(k >= 0.85, `phone shrank too much (${k})`);
  const phoneTop = (phone.y ?? 0) - (860 * k) / 2;
  assert.ok((note.y ?? 0) + 47 > phoneTop, "notification tucks onto the phone's top edge");
});

test("9:16 tall column with a dominant visual spreads into two columns on 16:9", () => {
  const spec = base("9:16", [
    { type: "text", text: "Split it\nin one tap.", fontSize: 130, y: -560 },
    { type: "device", model: "iphone", height: 900, y: 120 },
    { type: "text", text: "Get the app", fontSize: 70, y: 700 },
  ]);
  const out = reflowSpec(spec, "16:9");
  const [t1, dev, t2] = out.scenes[0].layers as { x?: number; y?: number }[];
  assert.ok((dev.x ?? 0) > 200, `visual should move right: ${dev.x}`);
  assert.ok((t1.x ?? 0) < -200 && (t2.x ?? 0) < -200, `copy should stack left: ${t1.x}, ${t2.x}`);
  assert.ok((t1.y ?? 0) < (t2.y ?? 0), "copy keeps its order");
});

test("row of 8 peers wraps into a balanced grid (not a long column)", () => {
  const spec = base("16:9", Array.from({ length: 8 }, (_, i) => ({ type: "shape", shape: "circle", width: 160, x: -770 + i * 220, y: 0 })));
  const out = reflowSpec(spec, "9:16");
  const rows = new Map<number, number>();
  for (const l of out.scenes[0].layers as { y?: number }[]) rows.set(Math.round(l.y ?? 0), (rows.get(Math.round(l.y ?? 0)) ?? 0) + 1);
  assert.ok(rows.size >= 2 && rows.size <= 4, `rows: ${[...rows.entries()]}`);
  assert.ok([...rows.values()].every((n) => n >= 2), `unbalanced: ${[...rows.values()]}`);
});

test("hook text floors on verticals; fills fill; camera and transition origins follow their element", () => {
  const spec = parse({
    format: "16:9", fps: 30,
    scenes: [
      { id: "a", duration: 2, layers: [
        { type: "text", text: "Money, at the speed of thought.", fontSize: 90 },
        { type: "shape", id: "dot", shape: "circle", width: 120, x: 700, y: -300 },
        { type: "shader", shader: "aurora", width: 1920, height: 1080 },
      ], camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 2, zoom: 2.2, x: 700, y: -300 }] } },
      { id: "b", duration: 2, transition: { type: "expand", x: 700, y: -300, duration: 0.5 }, layers: [{ type: "text", text: "Hi", fontSize: 160 }] },
    ],
  });
  const out = reflowSpec(spec, "9:16");
  const [txt, dot, shader] = out.scenes[0].layers as { fontSize?: number; x?: number; y?: number; width?: number; height?: number }[];
  assert.ok((txt.fontSize ?? 0) >= 80, `hook floor: ${txt.fontSize}`);
  assert.equal(shader.width, 1080);
  assert.equal(shader.height, 1920);
  const cam = out.scenes[0].camera!.keyframes![1];
  assert.equal(Math.round(cam.x!), Math.round(dot.x!), "camera keeps looking at the dot (x)");
  assert.equal(Math.round(cam.y!), Math.round(dot.y!), "camera keeps looking at the dot (y)");
  const tr = out.scenes[1].transition!;
  assert.equal(Math.round(tr.x!), Math.round(dot.x!), "expand grows from the dot (x)");
  assert.equal(Math.round(tr.y!), Math.round(dot.y!), "expand grows from the dot (y)");
});

test("actor poses follow the layout; snapTo untouched; explicit adapt overrides win last", () => {
  const spec = parse({
    format: "9:16", fps: 30,
    actors: [{ id: "coin", layer: { type: "morph", width: 400, height: 400, shapes: [{ at: 0, shape: "coin" }] }, poses: [
      { scene: "a", x: 0, y: -500, scale: 1 },
      { scene: "b", snapTo: "logo#icon" },
    ] }],
    scenes: [
      { id: "a", duration: 2, layers: [{ type: "text", text: "Who owes what?", fontSize: 120, y: 200, adapt: { "16:9": { y: 333, fontSize: 99 } } }] },
      { id: "b", duration: 2, layers: [{ type: "logo", id: "logo", src: "assets/logo.svg", parts: "wordmark", frame: "full", height: 200 }] },
    ],
  });
  const out = reflowSpec(spec, "16:9");
  const pose = out.actors![0].poses[0];
  const text = out.scenes[0].layers[0] as { y?: number; fontSize?: number };
  assert.equal(text.y, 333);
  assert.equal(text.fontSize, 99);
  assert.ok((pose.y ?? 0) > -460 && (pose.y ?? 0) < 0, `pose stays above the copy, inside the frame: ${pose.y}`);
  assert.deepEqual(out.actors![0].poses[1], spec.actors![0].poses[1]);
  // master target: adapt for another format is ignored, adapt for the master applies
  assert.equal((reflowSpec(spec, "9:16").scenes[0].layers[0] as { y?: number }).y, 200);
});

test("estimateBox mirrors engine defaults", () => {
  assert.deepEqual(estimateBox({ type: "device" }, 1920, 1080), { w: 780 * 0.488, h: 780 });
  assert.deepEqual(estimateBox({ type: "morph" }, 1920, 1080), { w: 400, h: 400 });
  assert.equal(estimateBox({ type: "text", text: "x".repeat(200), fontSize: 100 }, 1080, 1920).w, 1080 * 0.9);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
