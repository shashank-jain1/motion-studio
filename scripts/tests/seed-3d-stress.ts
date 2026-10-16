// Context-limit stress project (projects/test-3d-stress): 24 "three" layers in one scene (Chrome keeps ~16 WebGL
// contexts per page; with one canvas per layer the oldest ones were lost). Used by perf-3d.ts before/after.
//   node_modules/.bin/tsx scripts/tests/seed-3d-stress.ts && flock /tmp/claude-1000/ms-heavy.lock node_modules/.bin/tsx scripts/tests/perf-3d.ts --project=test-3d-stress
import fs from "node:fs";
import path from "node:path";
import { projectDir, writeSpec } from "../../src/core/projects";

const id = "test-3d-stress";
const dir = projectDir(id);
for (const sub of ["assets", "renders", "previews"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
if (!fs.existsSync(path.join(dir, "project.json")))
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id, name: "3D stress", createdAt: new Date().toISOString(), format: "16:9" }, null, 2) + "\n");
const PR = ["sphere", "box", "torus", "capsule", "cylinder", "knot"];
const MATS = ["chrome", "gold", "clay", "plastic", "pearl", "brushed"];
const layers = Array.from({ length: 24 }, (_, i) => ({
  type: "three", source: `primitive:${PR[i % 6]}`, material: MATS[(i + Math.floor(i / 6)) % 6], lighting: "studio", animation: "turntable",
  width: 300, height: 220, x: ((i % 6) - 2.5) * 310, y: (Math.floor(i / 6) - 1.5) * 240, shadow3d: false,
}));
const res = await writeSpec(id, {
  title: "3D stress", format: "16:9", fps: 30, style: "minimal-dark",
  scenes: [{ id: "stress-24", duration: 1, background: { type: "solid", color: "#101218" }, layers }],
});
console.log(id, res.ok === false ? JSON.stringify(res) : "ok");
