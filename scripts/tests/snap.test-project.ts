// Visual test for actor snapTo: an actor (coin → logo icon) snaps onto a half-transparent FULL logo layer while the
// camera zooms and punches. Exact snapping = the actor's rings sit perfectly on the ghost rings (no doubling).
import path from "node:path";
import { addAsset, createProject, deleteProject, listProjects, writeSpec } from "../../src/core/projects";
for (const p of await listProjects()) if (p.name === "test-snap") await deleteProject(p.id);
const { id } = await createProject({ name: "test-snap", format: "9:16" });
await addAsset(id, { path: path.resolve("projects/loopa-reel-049c/assets/loopa-logo.svg") });
const res = await writeSpec(id, {
  format: "9:16",
  concept: { truth: "test", motif: "coin" },
  actors: [{
    id: "coin", from: "a", until: "b",
    layer: { type: "morph", width: 420, height: 420, shapes: [{ at: 0, shape: "coin", fill: "#ffd166" }, { at: 1.6, shape: "svg:assets/loopa-logo.svg#icon", morph: 0.8 }] },
    poses: [
      { scene: "a", t: 0, x: 0, y: -300, scale: 1 },
      { scene: "b", t: 0.8, snapTo: "ghost#icon", move: 0.8 },
    ],
  }],
  scenes: [
    { id: "a", duration: 1.5, background: { type: "solid", color: "#fff7ef" }, layers: [] },
    { id: "b", duration: 3.5, transition: { type: "match" }, background: { type: "solid", color: "#fff7ef" },
      camera: { keyframes: [{ t: 0, zoom: 1.15, x: 60 }, { t: 3.5, zoom: 0.9, x: -40, ease: "inOut" }], punch: [2.0] },
      layers: [{ id: "ghost", type: "logo", src: "assets/loopa-logo.svg", mode: "pop", height: 220, x: 40, y: 80, opacity: 0.45, depth: 1.3 }] },
  ],
});
console.log(id, JSON.stringify(res.warnings ?? res));
