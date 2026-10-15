import { analyzeLogoFile } from "../../src/core/logo";
const a = await analyzeLogoFile(process.argv[2]);
console.log(JSON.stringify(a.groups), JSON.stringify(a.parts.map((p) => [p.id, p.kind, Math.round(p.bbox.x), Math.round(p.bbox.y), Math.round(p.bbox.w), Math.round(p.bbox.h)])));
