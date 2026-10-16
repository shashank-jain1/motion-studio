// Validate + save a spec JSON file into a project (same path as the MCP set_spec tool): tsx scripts/set-spec.ts <projectId> <spec.json>
import fs from "node:fs";
import { writeSpec } from "../src/core/projects";
const [id, file] = process.argv.slice(2);
const res = await writeSpec(id, JSON.parse(fs.readFileSync(file, "utf8")));
console.log(JSON.stringify(res, null, 1));
