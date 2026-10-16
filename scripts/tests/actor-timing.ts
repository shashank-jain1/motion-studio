// Replicates Actors.resolveActor keyframe building (DOM-free) and samples the actor's transform over time.
import { loadSpec } from "../../src/core/projects";
import { sceneTimeline, sceneIndexOf } from "../../src/engine/spec/preprocess";
import { evalKeyframes } from "../../src/engine/core/animate";
import { computeLayerTransform } from "../../src/engine/core/physics";
const spec = loadSpec(process.argv[2]);
const slots = sceneTimeline(spec.scenes, spec.fps).scenes;
const a = spec.actors![0];
const poses = a.poses.map((p) => ({ p, g: slots[sceneIndexOf(spec.scenes, p.scene)].start + (p.t ?? 0) })).sort((x, y) => x.g - y.g);
const start = slots[sceneIndexOf(spec.scenes, a.from!)].start;
const kfs: any[] = [];
poses.forEach(({ p, g }, i) => {
  const t = g - start;
  if (i > 0) { const prevT = kfs[kfs.length - 1].t; const holdT = t - Math.min(p.move ?? 1, t - prevT);
    if (holdT > prevT + 1e-3) { const h: any = evalKeyframes([...kfs], holdT); const hold: any = { t: holdT }; for (const k of ["x", "y", "scale"]) if ((p as any)[k] !== undefined) hold[k] = h[k]; kfs.push(hold); } }
  const kf: any = { t, ease: p.ease ?? "expoOut" }; for (const k of ["x", "y", "scale"]) if ((p as any)[k] !== undefined) kf[k] = (p as any)[k]; kfs.push(kf);
});
console.log(JSON.stringify(kfs));
const layer: any = { type: "group", layers: [], animate: kfs };
for (const t of [1.8, 2.5, 3.0, 3.9, 4.15, 4.5, 4.8]) {
  const tr = computeLayerTransform(layer, t - start, 12, { fps: 30 } as any);
  console.log(t, "scale", tr.scale.toFixed(3), "y", tr.y.toFixed(1), "| evalKf scale", (evalKeyframes(kfs, t - start).scale ?? 1).toFixed(3));
}
