// A 9:16 hype edit exercising the neon style, shaders, glitch cuts, captions and chromatic FX.
import { createProject, writeSpec, listProjects } from "../src/core/projects";

const name = "Neon drop test";
const existing = (await listProjects()).find((p: any) => p.name === name);
const id = existing?.id ?? (await createProject({ name, format: "9:16" })).id;
const res = await writeSpec(id, {
  format: "9:16", style: "neon",
  scenes: [
    { duration: 1.8, background: { type: "shader", shader: "warp", colors: ["$accent", "$accent2", "#05040a", "#ffffff"] },
      camera: { punch: [0.15, 0.9], shake: { amount: 8, duration: 0.5 } },
      layers: [{ type: "text", text: "DROP\nDAY", preset: "stretch", fontSize: 300, glow: true, uppercase: true }] },
    { duration: 2.2, transition: { type: "glitch", duration: 0.35 },
      background: { type: "grid", perspective: true, color: "$accent", base: "#05040a", speed: 2 },
      layers: [
        { type: "text", text: "10.24", preset: "scramble", fontSize: 260, font: "Orbitron", gradient: ["$accent2", "$accent"], y: -200 },
        { type: "shape", shape: "ring", width: 520, color: "$accent2", draw: true, glow: true, y: -200, loop: { type: "spin", speed: 0.2 } },
        { type: "particles", preset: "embers", colors: ["$accent", "$accent2"] },
        { type: "captions", text: "the wait is finally over", style: "box", y: 520, start: 0.2, highlightColor: "$accent" } ] },
    { duration: 2.0, transition: { type: "flash", color: "$accent", duration: 0.3 },
      background: { type: "shader", shader: "aurora" },
      fx: { flashes: [{ at: 1.2 }] },
      layers: [
        { type: "text", text: "SET YOUR\nALARMS", preset: "zoom-from-camera", fontSize: 200, weight: 900, font: "Unbounded" },
        { type: "particles", preset: "burst", start: 0.4 } ] },
  ],
});
console.log(id, JSON.stringify(res));
