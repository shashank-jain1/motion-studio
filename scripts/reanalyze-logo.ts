// Re-run the logo analyzer for an asset (e.g. after analyzer improvements): tsx scripts/reanalyze-logo.ts <projectId> <asset>
import path from "node:path";
import { ensureLogoAnalysis } from "../src/core/logo";
import { projectDir } from "../src/core/projects";
const [id, asset] = process.argv.slice(2);
const a = ensureLogoAnalysis(path.join(projectDir(id), asset), asset, { force: true });
console.log(JSON.stringify(a.groups));
