/**
 * Template gallery generator: scripts/templates/<slug>.ts → templates/<slug>/{template.json, spec.json, assets/, glyphs.json, poster.jpg}.
 *
 *   npx tsx scripts/build-templates.ts                       build every template (logos + analyses, spec, meta, glyphs)
 *   npx tsx scripts/build-templates.ts app-launch --preview  + contact sheet of the master (and --format=9:16 for a reflow)
 *   npx tsx scripts/build-templates.ts --poster              + render templates/<slug>/poster.jpg
 *   flags: --format=<f> --times=1,2.5 --scale=0.35 --out=<dir for sheets> --no-build
 *
 * Renders go through a scratch project folder (.cache/template-previews/<slug>), never into projects/.
 * Wrap renders in `flock /tmp/claude-1000/ms-render.lock …` on shared machines.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = path.join(ROOT, ".cache", "template-previews");
process.env.MOTION_STUDIO_PROJECTS ??= SCRATCH;

const { SpecSchema } = await import("../src/engine/spec/schema");
const { preprocessSpec } = await import("../src/engine/spec/preprocess");
const { adaptTargets } = await import("../src/engine/spec/reflow");
const { computeTimeline } = await import("../src/core/projects");
const { ensureLogoAnalysis } = await import("../src/core/logo");
const { syncGlyphs } = await import("../src/core/glyphs");
const { renderFrames } = await import("../src/core/render");
const { TEMPLATES_DIR } = await import("../src/core/templates");
type TemplateDef = import("./templates/_kit").TemplateDef;
type Format = import("../src/engine/spec/reflow").Format;

const argv = process.argv.slice(2);
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const has = (n: string) => argv.includes(`--${n}`);
const only = argv.filter((a) => !a.startsWith("--"));

const SRC = path.join(ROOT, "scripts", "templates");
const defs: TemplateDef[] = [];
for (const f of fs.readdirSync(SRC).sort()) {
  if (!f.endsWith(".ts") || f.startsWith("_")) continue;
  const mod = (await import(pathToFileURL(path.join(SRC, f)).href)) as { default: TemplateDef };
  if (!only.length || only.includes(mod.default.slug)) defs.push(mod.default);
}
if (!defs.length) throw new Error(`No templates matched ${only.join(", ")}`);

const writeJson = (file: string, v: unknown) => fs.writeFileSync(file, JSON.stringify(v, null, 2) + "\n");

const build = async (t: TemplateDef) => {
  const dir = path.join(TEMPLATES_DIR, t.slug);
  const assets = path.join(dir, "assets");
  fs.rmSync(assets, { recursive: true, force: true });
  fs.mkdirSync(assets, { recursive: true });
  for (const l of t.logos) {
    const abs = path.join(assets, l.file);
    fs.writeFileSync(abs, await l.build());
    const a = ensureLogoAnalysis(abs, `assets/${l.file}`, { force: true });
    if (!a.groups.icon.length || !a.groups.wordmark.length) console.warn(`  ! ${l.file}: icon ${a.groups.icon.length} / wordmark ${a.groups.wordmark.length} parts`);
  }
  const spec = { ...t.spec, format: t.format };
  const r = SpecSchema.safeParse(preprocessSpec(spec));
  if (!r.success) throw new Error(`${t.slug}: invalid spec\n${r.error.issues.slice(0, 8).map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  const durationSeconds = Math.round(computeTimeline(spec as never).total * 100) / 100;
  writeJson(path.join(dir, "spec.json"), spec);
  writeJson(path.join(dir, "template.json"), {
    title: t.title, niche: t.niche, description: t.description, format: t.format, durationSeconds, tags: t.tags, order: t.order,
    formats: adaptTargets(r.data),
  });
  fs.rmSync(path.join(dir, "glyphs.json"), { force: true });
  const g = await syncGlyphs(dir, spec as never);
  for (const w of g.warnings) console.warn(`  ! ${w}`);
  console.log(`built ${t.slug}: ${t.format} · ${durationSeconds}s · ${(r.data.scenes ?? []).length} scenes · formats ${adaptTargets(r.data).join(" ")}`);
};

/** Mirror a template into the scratch projects dir so the renderer (asset server = PROJECTS_DIR) can load it. */
const stage = (t: TemplateDef) => {
  const src = path.join(TEMPLATES_DIR, t.slug);
  const dir = path.join(SCRATCH, t.slug);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const sub of ["assets", "renders", "previews"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  writeJson(path.join(dir, "project.json"), { id: t.slug, name: t.title, createdAt: new Date(0).toISOString(), format: t.format });
  fs.copyFileSync(path.join(src, "spec.json"), path.join(dir, "spec.json"));
  if (fs.existsSync(path.join(src, "glyphs.json"))) fs.copyFileSync(path.join(src, "glyphs.json"), path.join(dir, "glyphs.json"));
  for (const f of fs.readdirSync(path.join(src, "assets"))) fs.copyFileSync(path.join(src, "assets", f), path.join(dir, "assets", f));
  return dir;
};

for (const t of defs) {
  if (!has("no-build")) await build(t);
  if (has("preview")) {
    stage(t);
    const format = flag("format") as Format | undefined;
    const spec = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, t.slug, "spec.json"), "utf8"));
    const tl = computeTimeline(spec);
    const times = flag("times")?.split(",").map(Number) ?? t.previewTimes ?? tl.scenes.map((s) => Math.round((s.start + s.overlapIn + (s.duration - s.overlapIn) * 0.6) * 100) / 100);
    const res = await renderFrames(t.slug, times, { scale: Number(flag("scale") ?? 0.35), format });
    const out = flag("out");
    if (out && res.sheet) {
      fs.mkdirSync(out, { recursive: true });
      const dest = path.join(out, `${t.slug}-${(format ?? t.format).replace(":", "x")}.jpg`);
      fs.copyFileSync(res.sheet, dest);
      console.log(`sheet ${dest}`);
    } else console.log(`sheet ${res.sheet}`);
  }
  if (has("poster")) {
    stage(t);
    const res = await renderFrames(t.slug, [t.posterTime], { scale: 0.5, sheet: false });
    fs.copyFileSync(res.frames[0].path, path.join(TEMPLATES_DIR, t.slug, "poster.jpg"));
    console.log(`poster ${t.slug} @ ${t.posterTime}s`);
  }
}
process.exit(0);
