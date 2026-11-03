/**
 * v9 layers — chart, diagram, code, visualizer: schema, pure models (timing, layout, tokenizer, typing), linter,
 * auto sound, reflow boxes. `--render` also renders one frame of every layer type in headless Chrome.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { SpecSchema, type Layer, type Spec } from "../../src/engine/spec/schema";
import { chartBox, chartDomain, chartTiming, highlightIndex, type ChartL } from "../../src/engine/kit/chart/model";
import { diagramModel, focusLevels, sampleAt, type DiagramL } from "../../src/engine/kit/diagram/model";
import { tokenize } from "../../src/engine/kit/code/highlight";
import { codeBox, typingSchedule, visibleCount, type CodeL } from "../../src/engine/kit/code/typing";
import { formatter, niceScale, isDark } from "../../src/engine/kit/surface";
import { estimateBox } from "../../src/engine/spec/reflow";
import { inspectSound } from "../../src/engine/audio/inspect";
import { craftWarnings } from "../../src/core/craft";

const parse = (layers: unknown[], format = "16:9", duration = 6): Spec =>
  SpecSchema.parse({ fps: 30, format, concept: { truth: "t", motif: "m" }, scenes: [{ id: "s", duration, layers }] });
const layer = <T extends Layer["type"]>(spec: Spec, i = 0) => spec.scenes[0].layers[i] as Extract<Layer, { type: T }>;

// --- schema ------------------------------------------------------------------------------------------------------------
const all = parse([
  { type: "chart", kind: "bar", data: [{ label: "A", value: 3 }, { label: "B", value: 7 }], highlight: "B" },
  { type: "diagram", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] },
  { type: "code", code: "const a = 1;" },
  { type: "visualizer", style: "orb" },
]);
assert.equal(all.scenes[0].layers.length, 4);
assert.throws(() => parse([{ type: "chart", kind: "radar", data: [] }]), /kind/, "unknown chart kind is rejected");
assert.throws(() => parse([{ type: "diagram", nodes: [] }]), "a diagram needs nodes");
assert.throws(() => parse([{ type: "visualizer" }]), "visualizer needs a style");

// --- surface helpers ---------------------------------------------------------------------------------------------------
assert.deepEqual(niceScale(0, 4380).ticks, [0, 2000, 4000, 6000]);
assert.deepEqual(niceScale(0, 4380, 5).ticks, [0, 1000, 2000, 3000, 4000, 5000]);
assert.equal(niceScale(0, 97).max, 100);
assert.equal(formatter({ format: "compact" }, [1200])(4380), "4.4K");
assert.equal(formatter({ format: "percent" }, [0.42])(0.42), "42%");
assert.equal(formatter({ prefix: "₹", locale: "en-IN" }, [1234567])(1234567), "₹12,34,567");
assert.equal(formatter({ suffix: "s" }, [42])(41.6), "42s");
assert.equal(isDark("#09090b"), true);
assert.equal(isDark("#f5f5f7"), false);

// --- chart model --------------------------------------------------------------------------------------------------------
const bar = layer<"chart">(parse([{ type: "chart", kind: "bar", data: [10, 20, 30, 40].map((v, i) => ({ label: `W${i + 1}`, value: v })), highlight: "W4", stagger: 0.1, growDuration: 0.8 }]));
assert.equal(highlightIndex(bar as ChartL), 3);
const bt = chartTiming(bar as ChartL);
assert.deepEqual(bt.items.map((s) => Math.round(s.start * 100) / 100), [0.28, 0.38, 0.48, 0.58]);
assert.equal(Math.round(bt.land * 100) / 100, 1.38);
assert.ok(chartDomain(bar as ChartL).max >= 40);
const donut = layer<"chart">(parse([{ type: "chart", kind: "donut", data: [{ value: 50 }, { value: 25 }, { value: 25 }] }]));
const dt = chartTiming(donut as ChartL);
assert.ok(dt.items.every((s, i) => i === 0 || s.start >= dt.items[i - 1].start), "donut segments start in sweep order");
assert.ok(Math.abs(dt.items[1].start - (0.28 + 1.6 * 0.5)) < 0.05, "half the total is swept at half the (eased) sweep time");
assert.deepEqual(chartBox({ kind: "pie" }), { w: 860, h: 520 });

// --- diagram model ------------------------------------------------------------------------------------------------------
const flow = layer<"diagram">(parse([{ type: "diagram", nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
  edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }, { from: "d", to: "a" }] }]));
const m = diagramModel(flow as DiagramL);
const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
assert.deepEqual([by.a.rank, by.b.rank, by.c.rank, by.d.rank], [0, 1, 1, 2], "longest-path ranks; the back edge d→a is ignored");
assert.ok(by.a.x < by.b.x && by.b.x === by.c.x && by.c.x < by.d.x, "flow goes left → right");
assert.ok(Math.abs(by.b.y - by.c.y) >= by.b.h, "nodes in a rank don't overlap");
for (const e of m.edges.filter((x) => x.from !== "d")) assert.ok(e.end <= by[e.to].appear + 0.5, `edge ${e.from}→${e.to} lands as its target arrives`);
assert.ok(m.land >= Math.max(...m.nodes.map((n) => n.appear)));
assert.deepEqual(sampleAt([[0, 0], [10, 0]], 0.5), [5, 0]);
const hub = diagramModel(layer<"diagram">(parse([{ type: "diagram", layout: "radial", nodes: [{ id: "x", label: "x" }, { id: "hub", label: "hub" }, { id: "y", label: "y" }],
  edges: [{ from: "hub", to: "x" }, { from: "hub", to: "y" }] }])) as DiagramL);
assert.deepEqual([hub.nodes.find((n) => n.id === "hub")!.x, hub.nodes.find((n) => n.id === "hub")!.y].map((v) => Math.round(v) + 0), [0, 0], "radial: the busiest node is the hub");
const focus = { ...flow, focus: [{ at: 1, nodes: ["b"] }, { at: 3, nodes: ["d"] }] } as DiagramL;
assert.equal(focusLevels(focus, 0.5)[0].level, 0);
assert.equal(focusLevels(focus, 2)[0].level, 1);
assert.equal(focusLevels(focus, 3.5)[0].level, 0, "a focus beat hands over to the next one");
assert.equal(focusLevels(focus, 3.5)[1].level, 1);

// --- tokenizer ------------------------------------------------------------------------------------------------------------
const kinds = (code: string, lang: string) => tokenize(code, lang).flat().filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text.trim()}`);
const ts = kinds(`import { make } from "./x"; // go\nexport async function run(n: number): Promise<Film> { return make(n); }`, "ts");
for (const k of ["keyword:import", "string:\"./x\"", "comment:// go", "keyword:async", "function:run", "type:Promise", "type:Film", "function:make"]) assert.ok(ts.includes(k), `ts: ${k} in ${ts.join(" ")}`);
const py = kinds(`@app.route("/x")\ndef go(self):\n    """doc"""\n    return len(self.items)  # n`, "python");
for (const k of ["meta:@app.route", "keyword:def", "function:go", "string:\"\"\"doc\"\"\"", "builtin:len", "comment:# n"]) assert.ok(py.includes(k), `py: ${k} in ${py.join(" ")}`);
const sh = kinds(`npx motion render --final $HOME | grep ok`, "bash");
for (const k of ["function:npx", "attr:--final", "variable:$HOME", "function:grep"]) assert.ok(sh.includes(k), `bash: ${k} in ${sh.join(" ")}`);
const js = kinds(`{"name": "x", "n": 2, "ok": true}`, "json");
for (const k of ["property:\"name\"", "string:\"x\"", "number:2", "constant:true"]) assert.ok(js.includes(k), `json: ${k}`);
const multi = tokenize("/* a\nb */ x", "ts");
assert.equal(multi.length, 2, "tokens split on lines");
assert.equal(multi[1][0].kind, "comment", "a block comment keeps its kind on the next line");
const jsx = kinds(`<Button onClick={go}>Ship</Button>`, "tsx");
assert.ok(jsx.includes("tag:<Button") && jsx.includes("attr:onClick"), `tsx: ${jsx.join(" ")}`);

// --- typing ---------------------------------------------------------------------------------------------------------------
const code = layer<"code">(parse([{ type: "code", code: "function a() {\n    return 1;\n}" }]));
const sch = typingSchedule(code as CodeL);
for (let i = 1; i < sch.charAt.length; i++) assert.ok(sch.charAt[i] >= sch.charAt[i - 1], "keystrokes never go back in time");
const indent = code.code.indexOf("    return");
assert.equal(sch.charAt[indent], sch.charAt[indent + 3], "auto-indent: leading spaces land at once");
assert.ok(sch.end > 0.35 && sch.end < 2, `~30 chars at 60 cps (+ line pauses) types in under 2 s (got ${sch.end.toFixed(2)})`);
assert.equal(visibleCount(sch, -1), 0);
assert.equal(visibleCount(sch, 99), code.code.length);
const term = layer<"code">(parse([{ type: "code", variant: "terminal", code: "$ npm test\n✓ 12 passed\n✓ done\n$ ls" }]));
const ts2 = typingSchedule(term as CodeL);
assert.equal(ts2.enters.length, 2, "Enter after each command");
const outStart = term.code.indexOf("✓ 12");
assert.ok(ts2.charAt[outStart] >= ts2.enters[0], "output prints after Enter");
assert.equal(ts2.charAt[outStart], ts2.charAt[outStart + 5], "an output line prints at once");
const lines = typingSchedule({ ...code, reveal: "lines" } as CodeL);
assert.ok(lines.lineAt[1] > lines.lineAt[0] && lines.keys.length === 0);
const box = codeBox({ ...code, fontSize: 20 } as CodeL);
assert.ok(box.w > 0 && box.h > box.chrome, "code box has chrome + rows");

// --- linter -----------------------------------------------------------------------------------------------------------------
const crowded = parse([{ type: "chart", kind: "bar", data: Array.from({ length: 14 }, (_, i) => ({ label: `${i}`, value: i + 1 })) },
  { type: "code", code: "x".repeat(90) + "\n" + "const y = 2;".repeat(1), duration: 1 },
  { type: "diagram", nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })), edges: Array.from({ length: 11 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) }], "16:9", 3);
const w = craftWarnings(crowded);
assert.ok(w.some((x) => /craft\/chart .*14 items/.test(x)), "too many bars");
assert.ok(w.some((x) => /craft\/chart .*no `highlight`/.test(x)), "chart without a point");
assert.ok(w.some((x) => /craft\/code .*90-character line/.test(x)), "long code line");
assert.ok(w.some((x) => /craft\/code .*typing ends/.test(x)), "typing longer than the layer");
assert.ok(w.some((x) => /craft\/diagram .*12 nodes/.test(x)), "dense diagram");
const vertical = parse([{ type: "chart", kind: "bar", data: [{ value: 1 }], highlight: 0, width: 1000, height: 700, y: 700 }], "9:16");
assert.ok(craftWarnings(vertical).some((x) => /safe-zone .*the chart spans/.test(x)), "panel edges are checked against the safe zone");

// --- auto sound -------------------------------------------------------------------------------------------------------------
const sound = SpecSchema.parse({ fps: 30, format: "16:9", sound: {}, scenes: [{ id: "s", duration: 6, layers: [
  { type: "chart", kind: "bar", data: [1, 2, 3, 4].map((v) => ({ value: v })), highlight: 3, annotate: [{ at: 3, text: "Up" }] },
  { type: "code", variant: "terminal", code: "$ npm run ship\n✓ shipped", start: 2 },
  { type: "diagram", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }], focus: [{ at: 1.5, nodes: ["b"] }], start: 3.5 },
] }] });
const cues = inspectSound(sound).cues;
const reasons = cues.map((c) => c.reason).join(" | ");
assert.ok(/chart item lands/.test(reasons), `bars tick: ${reasons}`);
assert.ok(/chart lands|chart callout/.test(reasons), "the highlight / callout is marked");
assert.ok(/code typing/.test(reasons) && /terminal enter/.test(reasons), "typing + Enter");
assert.ok(/diagram node|diagram focus/.test(reasons), "diagram arrivals");

// --- reflow boxes ----------------------------------------------------------------------------------------------------------
assert.deepEqual(estimateBox({ type: "chart", kind: "bar" }, 1920, 1080), { w: 880, h: 560 });
assert.deepEqual(estimateBox({ type: "visualizer", style: "circle" }, 1920, 1080), { w: 640, h: 640 });
assert.ok(estimateBox({ type: "code", code: "a\nb\nc" }, 1920, 1080).h > 100);
assert.ok(estimateBox({ type: "diagram", nodes: [{ id: "a", label: "A" }] }, 1920, 1080).w > 100);

console.log("v9 layers: schema, number formats, chart timing/domains, diagram ranks/layout/focus, 6-language tokenizer, typing rhythm + terminal, linter, auto sound and reflow passed.");

if (process.argv.includes("--render")) {
  const { createProject, writeSpec, deleteProject } = await import("../../src/core/projects");
  const { renderFrames } = await import("../../src/core/render");
  const p = createProject({ name: `v9-render-${process.pid}`, format: "16:9" });
  try {
    const spec = { fps: 30, format: "16:9", theme: { colors: { bg: "#09090b", fg: "#fafafa", accent: "#8b5cf6", accent2: "#22d3ee", card: "#141418" } },
      scenes: [{ id: "all", duration: 4, background: { type: "solid", color: "#09090b" }, layers: [
        { type: "chart", kind: "line", x: -480, y: -270, width: 800, height: 440, surface: "glass", labels: ["a", "b", "c", "d"], series: [{ values: [1, 3, 2, 5] }] },
        { type: "diagram", x: 480, y: -270, width: 800, height: 440, nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] },
        { type: "code", x: -480, y: 260, code: "const film = make('one line');", fontSize: 22 },
        { type: "visualizer", style: "bars", x: 480, y: 260, width: 700, height: 260 },
      ] }] };
    assert.ok((await writeSpec(p.id, spec)).ok);
    const proof = await renderFrames(p.id, [2.5], { scale: 0.5, sheet: false });
    assert.ok(fs.statSync(proof.frames[0].path).size > 10_000, "rendered a real frame");
    console.log("v9 render: chart + diagram + code + visualizer frame rendered.");
  } finally { deleteProject(p.id); }
  process.exit(0);
}
