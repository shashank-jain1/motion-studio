// Renders the "hero" scene of projects/test-3d on its own (temp project), reports ms/frame for draft and final,
// and copies the final MP4 to showcase/3d-logo.mp4.
//   flock /tmp/claude-1000/ms-render.lock node_modules/.bin/tsx scripts/tests/render-3d-hero.ts [draft|final|both]
import fs from "node:fs";
import path from "node:path";
import { deleteProject, projectDir, readSpec, writeSpec } from "../../src/core/projects";
import { renderVideo } from "../../src/core/render";

const which = process.argv[2] ?? "both";
const src = readSpec("test-3d") as Record<string, any> | null;
if (!src) throw new Error("run scripts/tests/seed-3d.ts first");
const hero = src.scenes.find((s: any) => s.id === "hero");
const id = "test-3d-hero";
const dir = projectDir(id);
for (const sub of ["assets", "renders", "previews"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id, name: "3D hero (temp)", createdAt: new Date().toISOString(), format: "16:9" }));
for (const f of fs.readdirSync(path.join(projectDir("test-3d"), "assets"))) fs.copyFileSync(path.join(projectDir("test-3d"), "assets", f), path.join(dir, "assets", f));
fs.copyFileSync(path.join(projectDir("test-3d"), "glyphs.json"), path.join(dir, "glyphs.json"));
const res = await writeSpec(id, { ...src, title: "Loopa 3D", scenes: [hero] });
if (res.ok === false) throw new Error(JSON.stringify(res));

try {
  for (const q of which === "both" ? (["draft", "final"] as const) : ([which] as ["draft" | "final"])) {
    const t0 = Date.now();
    const out = await renderVideo(id, { quality: q });
    const ms = Date.now() - t0;
    const frames = Math.round(out.seconds * out.fps);
    console.log(`${q}: ${out.width}x${out.height} ${frames} frames in ${(ms / 1000).toFixed(1)}s wall → ${(ms / frames).toFixed(0)} ms/frame (incl. bundle/browser/encode), ${(out.sizeBytes / 1e6).toFixed(2)} MB`);
    if (q === "final") {
      fs.mkdirSync("showcase", { recursive: true });
      fs.copyFileSync(out.path, "showcase/3d-logo.mp4");
      console.log("→ showcase/3d-logo.mp4");
    }
  }
} finally {
  deleteProject(id);
}
