/**
 * Spec version history + diff tests. Run: npx tsx scripts/tests/versions.test.ts
 * Uses a throwaway projects directory (MOTION_STUDIO_PROJECTS), so real projects are never touched.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-versions-"));
process.env.MOTION_STUDIO_PROJECTS = tmp;
const { createProject, writeSpec, readSpec, listSpecVersions, getSpecVersion, restoreSpecVersion, updateScene, projectDir } = await import("../../src/core/projects");
const { recordVersion, listVersions, MAX_VERSIONS } = await import("../../src/core/versions");
const { diffSpecs } = await import("../../src/engine/spec/diff");
const { callTool } = await import("../../src/core/tools");

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${(e as Error).stack}`); process.exitCode = 1; }
};

const film = (title = "Hello", dur = 2) => ({
  fps: 30,
  theme: { colors: { bg: "#111111", fg: "#ffffff", accent: "#ff3d1f" } },
  scenes: [
    { id: "hook", duration: dur, layers: [{ type: "text", text: title, preset: "blur-rise" }, { type: "shape", id: "dot", shape: "circle", width: 80, height: 80, color: "$accent" }] },
    { id: "end", duration: 2, transition: { type: "fade" }, layers: [{ type: "text", text: "Bye" }] },
  ],
});

try {
  await test("diff: identical, key order ignored", () => {
    const a = film();
    const b = JSON.parse(JSON.stringify(a, Object.keys(a).reverse()));
    const d = diffSpecs(a, { ...b, ...a });
    assert.ok(d.identical, d.summary);
    assert.equal(d.summary, "");
  });

  await test("diff: layer edit, added scene, removed layer, palette", () => {
    const a = film();
    const b = film("Hi there");
    b.scenes[0].layers[1] = { ...b.scenes[0].layers[1], x: 120 } as never;
    b.scenes.push({ id: "cta", duration: 1.5, layers: [] } as never);
    b.scenes[1].layers = [];
    b.theme.colors.accent = "#00ff00";
    const d = diffSpecs(a, b);
    assert.ok(!d.identical);
    assert.deepEqual(d.film, ["theme"]);
    const by = Object.fromEntries(d.scenes.map((s) => [s.label, s]));
    assert.equal(by["Scene 3 “cta”"].status, "added");
    assert.ok(by["Scene 1 “hook”"].details.some((x) => x.startsWith("text “Hi there”: text")), by["Scene 1 “hook”"].details.join(" | "));
    assert.ok(by["Scene 1 “hook”"].details.includes("shape dot: x"));
    assert.ok(by["Scene 2 “end”"].details.includes("removed text “Bye”"));
    assert.match(d.summary, /scene added/);
  });

  await test("diff: reorder detected as move, duration shown", () => {
    const a = film(), b = film("Hello", 3.5);
    b.scenes.reverse();
    const d = diffSpecs(a, b);
    assert.ok(d.scenes.find((s) => s.label.includes("end"))?.status === "moved");
    assert.ok(d.scenes.find((s) => s.label.includes("hook"))?.details.includes("duration 2s → 3.5s"));
  });

  const p = createProject({ name: "versions test", format: "9:16" });

  await test("first save = v1 'First cut' by author; identical save adds nothing", async () => {
    const r = await writeSpec(p.id, film(), { author: { kind: "you" } });
    assert.ok(r.ok && r.version, JSON.stringify(r));
    assert.equal(r.version!.n, 1);
    assert.match(r.version!.summary, /^First cut · 2 scenes/);
    const again = await writeSpec(p.id, film(), { author: { kind: "director" } });
    assert.ok(again.ok);
    assert.equal(again.version, null);
    assert.equal(listSpecVersions(p.id).length, 1);
  });

  await test("a change records author, summary and details", async () => {
    const r = await writeSpec(p.id, film("Wake up"), { author: { kind: "director" } });
    assert.ok(r.ok);
    const [v2] = listSpecVersions(p.id);
    assert.equal(v2.n, 2);
    assert.deepEqual(v2.author, { kind: "director" });
    assert.match(v2.summary, /Scene 1 “hook”: text “Wake up”: text/);
    assert.equal(v2.scenes, 2);
    assert.ok(v2.seconds! > 3);
  });

  await test("update_scene path records too; versions hold the spec as written (format filled)", async () => {
    const r = await updateScene(p.id, 1, { id: "end", duration: 2.5, layers: [] }, { author: { kind: "mcp", name: "Claude Code" } });
    assert.ok(r.ok);
    const v3 = getSpecVersion(p.id, 3);
    assert.equal(v3.meta.author.name, "Claude Code");
    assert.equal(v3.spec.format, "9:16");
    assert.deepEqual(v3.spec, readSpec(p.id));
  });

  await test("restore writes a NEW version equal to the old one", async () => {
    const r = await restoreSpecVersion(p.id, 1, { kind: "you" });
    assert.ok(r.ok && r.version);
    assert.equal(r.version!.n, 4);
    assert.equal(r.version!.restoredFrom, 1);
    assert.equal(r.version!.summary, "Restored v1");
    assert.deepEqual(readSpec(p.id), getSpecVersion(p.id, 1).spec);
    assert.throws(() => getSpecVersion(p.id, 99), /Version 99 not found/);
  });

  await test("existing spec without history is kept as a baseline before the first tracked change", async () => {
    const q = createProject({ name: "legacy", format: "16:9" });
    fs.writeFileSync(path.join(q.dir, "spec.json"), JSON.stringify({ ...film("Legacy"), format: "16:9" }));
    const r = await writeSpec(q.id, { ...film("New"), format: "16:9" }, { author: { kind: "director" } });
    assert.ok(r.ok);
    const vs = listSpecVersions(q.id);
    assert.deepEqual(vs.map((v) => v.n), [2, 1]);
    assert.equal(vs[1].summary, "Before version history");
    assert.equal((getSpecVersion(q.id, 1).spec.scenes as { layers: { text?: string }[] }[])[0].layers[0].text, "Legacy");
  });

  await test("another writer took the next number: allocation skips it, no overwrite", () => {
    const dir = projectDir(p.id);
    const squatter = path.join(dir, "versions", "000005.json");
    fs.writeFileSync(squatter, JSON.stringify({ meta: { n: 5 }, spec: { other: true } }));
    const m = recordVersion(dir, { ...film("race") }, null, { author: { kind: "system" } });
    assert.equal(m!.n, 6);
    assert.deepEqual(JSON.parse(fs.readFileSync(squatter, "utf8")).spec, { other: true });
  });

  await test("torn index line is ignored", () => {
    const dir = projectDir(p.id);
    fs.appendFileSync(path.join(dir, "versions", "index.jsonl"), '{"n": 7, "at": "trunc');
    assert.equal(listVersions(dir)[0].n, 6);
    fs.appendFileSync(path.join(dir, "versions", "index.jsonl"), "\n");
  });

  await test(`prune keeps the newest ${MAX_VERSIONS}`, () => {
    const r = createProject({ name: "prune", format: "1:1" });
    for (let i = 0; i < MAX_VERSIONS + 25; i++) recordVersion(r.dir, { ...film(`t${i}`) }, null, { author: { kind: "system" } });
    const vs = listVersions(r.dir);
    assert.ok(vs.length <= MAX_VERSIONS + 20 && vs.length >= MAX_VERSIONS, String(vs.length));
    assert.equal(vs[0].n, MAX_VERSIONS + 25);
    const files = fs.readdirSync(path.join(r.dir, "versions")).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, vs.length);
  });

  await test("MCP tools: list_versions + restore_version carry the caller as author", async () => {
    const list = await callTool("list_versions", { projectId: p.id, limit: 3 });
    const txt = (list.content[0] as { text: string }).text;
    assert.match(txt, /^5 versions \(v6 is current\)/);
    assert.match(txt, /v4 · .* · You · restored v1/);
    const res = await callTool("restore_version", { projectId: p.id, version: 2 }, { author: { kind: "mcp", name: "Cursor" } });
    assert.ok(!res.isError, JSON.stringify(res.content));
    assert.match((res.content[0] as { text: string }).text, /saved as version 7 \(Restored v2\)/);
    assert.equal(listSpecVersions(p.id)[0].author.name, "Cursor");
    assert.equal(res.events?.[0]?.type, "spec");
    const bad = await callTool("restore_version", { projectId: p.id, version: 999 });
    assert.ok(bad.isError);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
