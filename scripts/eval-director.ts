/**
 * Director evaluation harness (docs/research/10-direction-briefs.md).
 *
 *   tsx scripts/eval-director.ts run [--only id,id] [--effort low|medium|high] [--model id]
 *       runs the in-app director on each brief in evals/briefs.json (needs an Anthropic API key), then scores it
 *   tsx scripts/eval-director.ts score <projectId|dir> [...]
 *       scores existing projects offline (no key needed)
 *
 * Writes evals/results/<stamp>/report.md + report.json and a contact sheet per film. Scores come from
 * src/core/evalScore.ts (linter penalties + motion habits) so runs are comparable across director/engine changes.
 */
import fs from "node:fs";
import path from "node:path";
import { createProject, getProject, listProjects, readSpec } from "../src/core/projects";
import { renderFrames } from "../src/core/render";
import { scoreSpec, type EvalScore } from "../src/core/evalScore";
import { runChat, type ChatEvent } from "../src/server/agent";

type Brief = { id: string; tag: string; format: string; seconds: number; brief: string; direction?: Record<string, unknown> };
type Row = { id: string; tag?: string; projectId: string; score: EvalScore; sheet?: string; errors: string[]; tools: number; minutes?: number };

const ROOT = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(ROOT, "evals", "results", stamp);

/** The brief as the director sees it: inputs are given, so it must not stop to ask. */
const prompt = (b: Brief) => [
  b.brief,
  "",
  `Format ${b.format}, about ${b.seconds} seconds.`,
  `Hard rules — write them into concept.direction exactly: ${JSON.stringify(b.direction ?? {})}.`,
  "All inputs are provided: do not ask questions. Storyboard, set_spec, preview_frames and fix until the linter is clean.",
  "Do not render the final video.",
].join("\n");

/** One contact sheet of ~9 frames across the film. */
const sheetFor = async (projectId: string): Promise<string | undefined> => {
  try {
    const secs = scoreSpec(readSpec(projectId)).seconds;
    if (!secs) return undefined;
    const times = Array.from({ length: 9 }, (_, i) => Math.min(secs - 1 / 30, (secs * (i + 0.5)) / 9));
    const r = await renderFrames(projectId, times, { scale: 0.25, sheet: true });
    const sheet = r.sheet;
    if (!sheet) return undefined;
    const dest = path.join(outDir, `${projectId}.jpg`);
    fs.copyFileSync(sheet, dest);
    return path.relative(outDir, dest);
  } catch (e) {
    console.warn(`  sheet failed: ${(e as Error).message}`);
    return undefined;
  }
};

const runOne = async (b: Brief): Promise<Row> => {
  const project = createProject({ name: `eval ${b.id} ${stamp.slice(5, 16)}`, format: b.format as never });
  const errors: string[] = [];
  let tools = 0;
  const t0 = Date.now();
  console.log(`▶ ${b.id} → ${project.id}`);
  await runChat(project.id, prompt(b), (e: ChatEvent) => {
    if (e.type === "tool_start") { tools++; process.stdout.write(`  · ${e.name}\n`); }
    if (e.type === "error") errors.push(e.message);
  }, { effort: flag("effort"), model: flag("model") });
  let spec: unknown = null;
  try { spec = readSpec(project.id); } catch { /* no spec written */ }
  const score = spec ? scoreSpec(spec) : scoreSpec({});
  return { id: b.id, tag: b.tag, projectId: project.id, score, errors, tools, minutes: +((Date.now() - t0) / 60000).toFixed(1), sheet: spec ? await sheetFor(project.id) : undefined };
};

const scoreOne = async (ref: string): Promise<Row> => {
  const id = listProjects().find((p) => p.id === ref || p.name === ref || p.dir === path.resolve(ref))?.id ?? ref;
  getProject(id);
  const score = scoreSpec(readSpec(id));
  return { id, projectId: id, score, errors: [], tools: 0, sheet: argv.includes("--no-sheet") ? undefined : await sheetFor(id) };
};

const report = (rows: Row[], mode: string) => {
  const avg = rows.length ? rows.reduce((a, r) => a + r.score.score, 0) / rows.length : 0;
  const L = [`# Director eval — ${mode} — ${stamp}`, "", `Average score **${avg.toFixed(1)}** over ${rows.length} film(s).`, "",
    "| Film | Tag | Score | Direction | Story err | Craft | Springs | Continuity | Longest gap | Changes/s |",
    "|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows) {
    const s = r.score, m = s.motion;
    L.push(`| ${r.id} | ${r.tag ?? ""} | ${s.score} | ${s.warnings.direction} | ${s.storyErrors} | ${s.warnings.craft} | ${Math.round(m.springShare * 100)}% | ${m.continuity ? "yes" : "no"} | ${m.longestGap}s | ${m.density} |`);
  }
  for (const r of rows) {
    L.push("", `## ${r.id}`, "", `Project \`${r.projectId}\`${r.minutes !== undefined ? ` · ${r.minutes} min · ${r.tools} tool calls` : ""}`);
    if (r.sheet) L.push("", `![${r.id}](${r.sheet})`);
    if (r.errors.length) L.push("", "Errors:", ...r.errors.map((e) => `- ${e}`));
    if (r.score.breakdown.length) L.push("", "Score:", ...r.score.breakdown.map((b) => `- ${b}`));
    if (r.score.warnings.list.length) L.push("", "Warnings:", ...r.score.warnings.list.slice(0, 12).map((w) => `- ${w}`));
  }
  fs.writeFileSync(path.join(outDir, "report.md"), L.join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ mode, stamp, average: avg, rows }, null, 1));
  console.log(`\nAverage ${avg.toFixed(1)} · report: ${path.relative(ROOT, path.join(outDir, "report.md"))}`);
};

const main = async () => {
  const [mode, ...rest] = argv;
  fs.mkdirSync(outDir, { recursive: true });
  if (mode === "run") {
    const only = flag("only")?.split(",");
    const briefs = (JSON.parse(fs.readFileSync(path.join(ROOT, "evals", "briefs.json"), "utf8")).briefs as Brief[]).filter((b) => !only || only.includes(b.id));
    const rows: Row[] = [];
    for (const b of briefs) rows.push(await runOne(b));
    report(rows, "run");
  } else if (mode === "score") {
    const refs = rest.filter((a) => !a.startsWith("--"));
    if (!refs.length) throw new Error("score: give one or more project ids");
    const rows: Row[] = [];
    for (const ref of refs) rows.push(await scoreOne(ref));
    report(rows, "score");
  } else {
    console.log("usage: tsx scripts/eval-director.ts run [--only id,id] [--effort medium] | score <projectId...> [--no-sheet]");
    process.exitCode = 1;
  }
};
await main();
