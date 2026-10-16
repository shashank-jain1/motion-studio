/**
 * Story check over every template (templates/<id>/spec.json): niche, timeline, brand presence and story issues.
 * Run: npx tsx scripts/tests/story-templates.ts [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import { SpecSchema, type SpecInput } from "../../src/engine/spec/schema";
import { preprocessSpec, sceneTimeline } from "../../src/engine/spec/preprocess";
import { ROOT } from "../../src/core/paths";
import { storyReport, walkLayers } from "../../src/core/story";

const verbose = process.argv.includes("--verbose");
const dir = path.join(ROOT, "templates");
let failing = 0;
for (const id of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, id, "spec.json");
  if (!fs.existsSync(file)) continue;
  const spec = SpecSchema.parse(preprocessSpec(JSON.parse(fs.readFileSync(file, "utf8")) as SpecInput));
  if (!spec.format) spec.format = "9:16";
  const r = storyReport(spec);
  const blocking = r.issues.filter((i) => i.severity !== "info");
  if (blocking.length) failing++;
  console.log(`\n=== ${id} ${blocking.length ? `✗ ${blocking.length} issue(s)` : "✓ passes"}`);
  if (verbose) {
    const tl = sceneTimeline(spec.scenes, spec.fps);
    tl.scenes.forEach((s) => console.log(`  scene ${s.index} ${s.id ?? ""} ${s.start.toFixed(2)}–${s.end.toFixed(2)}s`));
    walkLayers(spec, (l, where, at) => {
      const t = l.type === "text" ? l.text : l.type === "card" ? l.title : l.type === "morph" ? l.shapes.map((s) => `${s.shape}@${s.at}`).join(",") : l.type === "logo" ? l.mode : "";
      console.log(`    ${at.toFixed(2)}s ${l.type} ${where} ${String(t ?? "").replace(/\n/g, " ").slice(0, 70)}`);
    });
  }
  console.log(r.text);
}
console.log(`\n${failing} template(s) with story issues`);
