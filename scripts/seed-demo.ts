// Creates (or refreshes) the "demo" project from the built-in showreel spec.
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "../src/core/paths";
import { createProject, writeSpec, listProjects } from "../src/core/projects";
import { DEMO_SPEC } from "../src/engine/demo-spec";

const existing = (await listProjects()).find((p: any) => p.name === "Orbit Pay demo");
const id = existing?.id ?? (await createProject({ name: "Orbit Pay demo", format: "16:9" })).id;
const res = await writeSpec(id, DEMO_SPEC);
console.log(id, JSON.stringify(res, null, 1));
console.log(fs.existsSync(path.join(PROJECTS_DIR, id, "spec.json")));
