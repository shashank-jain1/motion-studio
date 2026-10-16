/**
 * 3D layer unit tests (Node, no browser): geometry extrusion, holes, flat caps, caching, motion purity,
 * glyph collection for "three" layers.
 * Run: npx tsx scripts/tests/three.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { buildModel, buildPrimitive, parsePrimitive, PRIMITIVES } from "../../src/engine/kit/three/geometry";
import { ANIMATIONS_3D, cameraAt, objectPose, partPose } from "../../src/engine/kit/three/motion";
import { resolveRaw, type LogoAnalysis } from "../../src/engine/shapes/resolve";
import { collectTextShapes } from "../../src/core/glyphs";
import { rasterize, samplePoints, silhouette } from "../../src/engine/kit/three/sampler";
import { CLONER_PRESETS, arrivalTimes, buildClones, expandPreset, fieldRaw, fieldWeight, noise3 } from "../../src/engine/kit/three/cloner";
import { KINETIC_3D } from "../../src/engine/kit/three/motion";
import { bounceY, kineticPose, orderIndex } from "../../src/engine/kit/three/kinetic";
import { CAMERA_MOVES, cameraPose } from "../../src/engine/kit/three/camera";
import { deformAmount } from "../../src/engine/kit/three/deform";
import { ThreeLayer } from "../../src/engine/spec/schema";

const logo = JSON.parse(fs.readFileSync("projects/loopa-reel-049c/assets/loopa-logo.svg.logo.json", "utf8")) as LogoAnalysis;
const ctx = { get: <T,>(p: string) => (p.endsWith(".logo.json") ? (logo as T) : null), family: "Inter", weight: 700 };

// --- svg logo → one mesh per part, normalized to 1 unit tall, centered -------------------------
const raw = resolveRaw("svg:assets/loopa-logo.svg", ctx);
assert.equal(raw.kind, "svg");
const model = buildModel("test|loopa", raw, { depth: 0.18, bevel: 0.02 });
assert.equal(model.parts.length, logo.parts.length, "one mesh per logo part");
assert.ok(Math.abs(model.height - 1) < 1e-6, "normalized to height 1");
assert.ok(model.width > 3 && model.width < 5, `wordmark aspect kept (w=${model.width})`);
assert.equal(buildModel("test|loopa", raw, { depth: 0.18, bevel: 0.02 }), model, "cached per (source, depth, bevel)");
assert.notEqual(buildModel("test|loopa", raw, { depth: 0.3, bevel: 0.02 }), model, "depth is part of the cache key");

const union = new THREE.Box3();
for (const p of model.parts) {
  const bb = p.geometry.boundingBox!.clone().translate(p.center);
  union.union(bb);
  assert.ok(p.fill && p.fill.startsWith("#"), "svg parts keep their brand color");
}
const c = new THREE.Vector3();
union.getCenter(c);
assert.ok(Math.abs(c.x) < 0.02 && Math.abs(c.y) < 0.02, `model centered (${c.x.toFixed(3)}, ${c.y.toFixed(3)})`);
const size = new THREE.Vector3();
union.getSize(size);
assert.ok(Math.abs(size.z - 0.18) < 0.03, `extrusion depth ≈ 0.18 (got ${size.z.toFixed(3)})`);

// --- counters are holes: the ring part's front cap has far less area than its bbox disc ------------
const capArea = (g: THREE.BufferGeometry) => {
  const pos = g.attributes.position;
  let area = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (const gr of g.groups) {
    if (gr.materialIndex !== 0) continue;
    for (let i = gr.start; i + 2 < gr.start + gr.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
      if (a.z + b.z + d.z <= 0) continue; // front cap only
      area += Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / 2;
    }
  }
  return area;
};
const ring = model.parts[0];
const disc = Math.PI * (ring.w / 2) * (ring.h / 2);
const ringArea = capArea(ring.geometry);
assert.ok(ringArea < disc * 0.75 && ringArea > disc * 0.2, `ring has its counter cut out (cap ${ringArea.toFixed(3)} vs disc ${disc.toFixed(3)})`);

// --- caps are perfectly flat (chrome would show any tilt), side normals are unit length -------------
for (const p of model.parts) {
  const nor = p.geometry.attributes.normal;
  for (const gr of p.geometry.groups) {
    for (let i = gr.start; i < gr.start + gr.count; i += 7) {
      const n = new THREE.Vector3().fromBufferAttribute(nor, i);
      assert.ok(Math.abs(n.length() - 1) < 1e-3, "unit normals");
      if (gr.materialIndex === 0) assert.ok(Math.abs(Math.abs(n.z) - 1) < 1e-6, "flat cap normal");
    }
  }
}

// --- overlapping parts (the two rings) are layered in z, no coplanar faces ----------------------
assert.notEqual(model.parts[0].center.z, model.parts[1].center.z, "overlapping rings are z-layered");

// --- primitives ------------------------------------------------------------------------------------
for (const p of PRIMITIVES) {
  const m = buildPrimitive(p);
  assert.equal(m.kind, "primitive");
  assert.ok(m.height > 0.5 && m.height < 1.2, `${p} ~1 unit tall`);
}
assert.equal(parsePrimitive("primitive:knot"), "knot");
assert.equal(parsePrimitive("primitive:nope"), "sphere");
assert.equal(parsePrimitive("svg:assets/x.svg"), null);

// --- motion: pure, settles exactly ---------------------------------------------------------------
for (const a of ANIMATIONS_3D) {
  const p1 = objectPose(a, 1.234), p2 = objectPose(a, 1.234);
  assert.deepEqual(p1, p2, `${a} pure`);
  for (const v of Object.values(objectPose(a, 0))) assert.ok(Number.isFinite(v), `${a} finite at t=0`);
}
const settled = objectPose("spin-in", 2.0);
assert.ok(Math.abs(settled.ry) < 1e-9 && Math.abs(settled.s - 1) < 1e-9, "spin-in lands exactly on front at T");
assert.ok(Math.abs(objectPose("spin-in", 0).ry + Math.PI / 2) < 1e-9, "spin-in starts edge-on");
const pp = partPose("assemble", 10, 2, 7, 0.4, 0, 3)!;
assert.ok(Math.abs(pp.x) + Math.abs(pp.y) + Math.abs(pp.z) < 1e-9, "assemble locks parts at rest");
assert.equal(partPose("turntable", 1, 0, 3, 0, 0, 3), null);
const cam = cameraAt([{ t: 0, yaw: -40 }, { t: 2, yaw: 20, ease: "linear" }], "none", 1);
assert.ok(Math.abs(cam.yaw + 10) < 1e-9, "orbit yaw interpolates");
assert.equal(cam.pitch, 7, "missing orbit props fall back to the default camera");

// --- "text:" sources on three layers get glyph outlines on writeSpec --------------------------------
const refs = collectTextShapes({
  scenes: [{ duration: 2, layers: [{ type: "three", source: "text:Brew", font: "Inter", weight: 800 }, { type: "three", source: "primitive:box" }] }],
} as never);
assert.equal(refs.length, 1);
assert.equal(refs[0].text, "Brew");
assert.equal(refs[0].weight, 800);

// =====================================================================================================
// 3D v2

// --- silhouette sampling: points land inside the logo, counters stay empty, deterministic ----------------
const sil = silhouette(model);
assert.ok(sil.area > 0.5 && sil.area < model.width, `silhouette area plausible (${sil.area.toFixed(3)})`);
const pts = samplePoints(sil, 5000, 3);
assert.ok(pts.count > 4000 && pts.count < 6500, `~5000 even samples (got ${pts.count})`);
assert.equal(samplePoints(sil, 5000, 3), pts, "samples cached");
const fine = rasterize(sil, 0.01, 0);
let outside = 0;
for (let i = 0; i < pts.count; i++) {
  const c = Math.floor((pts.x[i] - fine.x0) / fine.cell), r = Math.floor((pts.y[i] - fine.y0) / fine.cell);
  const near = [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => fine.part[(r + dr) * fine.cols + c + dc] >= 0));
  if (!near) outside++;
}
assert.ok(outside / pts.count < 0.01, `samples inside the silhouette (${outside} strays)`);
// the ring counter (center of part 0) is a hole
const ringC = model.parts[0].center;
const holeR = Math.min(ring.w, ring.h) * 0.15;
let inHole = 0;
for (let i = 0; i < pts.count; i++) if (pts.part[i] === 0 && Math.hypot(pts.x[i] - ringC.x, pts.y[i] - ringC.y) < holeR) inHole++;
assert.equal(inHole, 0, "no ring samples inside the ring's own counter (the other ring overlaps it)");

// --- cloner: presets expand, layouts build, fields are pure & monotonic sweeps arrive in order -----------
for (const p of CLONER_PRESETS) {
  const plan = expandPreset({ preset: p }, undefined);
  const cl = buildClones(model, plan.cloner);
  assert.ok(cl.count > 50 && cl.count <= 40000, `${p}: ${cl.count} clones`);
}
const sweep = expandPreset(undefined, undefined);
assert.equal(sweep.fields[0].kind, "linear", "default cloner preset = sweep");
const cl = buildClones(model, sweep.cloner);
assert.ok(cl.part.every((q) => q >= 0), "logo-masked grid: every clone inside the logo");
const ctx3 = { clones: cl, extent: 4, center: [0, 0, 0] as [number, number, number] };
const lf = { kind: "linear" as const, axis: "x" as const, start: 0, end: 2, width: 0.2, effect: { scale: [0, 1] as [number, number] } };
let left = 0, right = 0;
for (let i = 1; i < cl.count; i++) { if (cl.nrm[i * 3] < cl.nrm[left * 3]) left = i; if (cl.nrm[i * 3] > cl.nrm[right * 3]) right = i; }
assert.ok(fieldRaw(lf, ctx3, left, 1) > fieldRaw(lf, ctx3, right, 1), "a +x sweep reaches the left clones first");
assert.equal(fieldRaw(lf, ctx3, right, -1), 0);
assert.equal(fieldRaw(lf, ctx3, right, 5), 1, "sweep completes");
const arr = arrivalTimes({ ...lf, spring: 0.6 }, ctx3)!;
assert.ok(arr[left] < arr[right], "spring arrival order follows the sweep");
const settle = fieldWeight({ ...lf, spring: 0.6 }, ctx3, right, 10, arr);
assert.ok(Math.abs(settle - 1) < 1e-9, "spring settles exactly at 1");
assert.equal(noise3(1.3, 2.7, 0.5, 4), noise3(1.3, 2.7, 0.5, 4), "noise is pure");

// --- kinetic type: every glyph lands exactly at rest ----------------------------------------------------------
for (const a of KINETIC_3D) {
  if (a === "wave") continue; // loops forever by design
  for (let rank = 0; rank < 5; rank++) {
    const p = kineticPose(a, 8, { rank, n: 5, cx: rank - 2, cy: 0, w: 5, h: 1, depth: 0.18 }, { order: "center-out" })!;
    const off = Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) + Math.abs(p.rx) + Math.abs(p.ry) + Math.abs(p.rz) + Math.abs(p.s - 1) + Math.abs((p.sz ?? 1) - 1) + Math.abs((p.sy ?? 1) - 1);
    assert.ok(off < 1e-6, `${a} rank ${rank} rests at t=8 (off ${off})`);
  }
}
assert.deepEqual([0, 1, 2, 3, 4].map((r) => orderIndex("center-out", r, 5)), [4, 2, 0, 2, 4]);
assert.ok(Math.abs(bounceY(0, 1).y - 1) < 1e-9 && bounceY(10, 1).y === 0, "bounce chain starts at h0, ends at rest");
const ext0 = kineticPose("extrude-grow", 0, { rank: 0, n: 3, cx: 0, cy: 0, w: 3, h: 1, depth: 0.2 })!;
assert.ok((ext0.sz ?? 1) < 0.05, "extrude-grow starts flat");

// --- camera moves: pure, finite, dolly zoom keeps the subject's frustum height ------------------------------
for (const move of CAMERA_MOVES) {
  for (const t of [0, 0.7, 1.9, 5]) {
    const p = cameraPose({ anim: "none", cam: { move }, t, fitDist: 10, size: { w: 4, h: 1 } });
    assert.ok([p.pos.x, p.pos.y, p.pos.z, p.fov, p.roll].every(Number.isFinite), `${move} finite at ${t}`);
  }
}
const dz0 = cameraPose({ anim: "none", cam: { move: "dolly-zoom", amount: 1.5 }, t: 0, fitDist: 10, size: { w: 4, h: 1 } });
const dz1 = cameraPose({ anim: "none", cam: { move: "dolly-zoom", amount: 1.5 }, t: 9, fitDist: 10, size: { w: 4, h: 1 } });
const hgt = (p: typeof dz0) => 2 * p.pos.distanceTo(p.target) * Math.tan((p.fov * Math.PI) / 360);
assert.ok(dz1.pos.distanceTo(dz1.target) > 2 * dz0.pos.distanceTo(dz0.target), "dolly zoom pulls back");
assert.ok(Math.abs(hgt(dz0) - hgt(dz1)) < 1e-6, "dolly zoom keeps the frustum height at the subject");
const path = cameraPose({ anim: "none", cam: { path: [{ t: 0, pos: [0, 0, 1] }, { t: 2, pos: [1, 0, 1] }, { t: 4, pos: [1, 1, 1] }] }, t: 2, fitDist: 10, size: { w: 4, h: 1 } });
assert.ok(path.pos.distanceTo(new THREE.Vector3(10, 0, 10)) < 1e-6, "spline path hits its key at the key time");

// --- deformers -----------------------------------------------------------------------------------------------------
assert.equal(deformAmount({ type: "twist", keys: [{ t: 0, amount: 0 }, { t: 1, amount: 90 }] }, 1), 90);
assert.equal(deformAmount({ type: "jiggle", at: 1, amount: 0.3 }, 0.5), 0, "jiggle is silent before impact");
assert.ok(Math.abs(deformAmount({ type: "jiggle", at: 1, amount: 0.3 }, 1) - 0.3) < 1e-9, "jiggle compresses on impact");
const tess = buildModel("test|loopa", raw, { depth: 0.18, bevel: 0.02, tess: true });
const vcount = (m: typeof model) => m.parts.reduce((n, p) => n + p.geometry.attributes.position.count, 0);
assert.ok(vcount(tess) > vcount(model) * 3, `tessellated model is denser (${vcount(model)} → ${vcount(tess)} verts)`);

// --- schema: v2 fields validate, old layers still do -------------------------------------------------------------
const ok = (l: unknown) => ThreeLayer.safeParse(l).success;
assert.ok(ok({ type: "three", source: "svg:assets/x.svg" }), "v1 layer still valid");
assert.ok(ok({
  type: "three", source: "text:Hi", mode: "cloner", cloner: { preset: "tile-flip", colors: { inside: "#f00" } },
  fields: [{ kind: "linear", axis: 30, spring: 0.6, effect: { rotateY: [0, 180], color: "reveal" } }],
  post: { bloom: 0.5, dof: { focus: [{ t: 0, z: 1 }, { t: 2, z: -1 }] }, motionBlur: true, quality: "draft" },
  camera: { move: "dolly-zoom", amount: 1.2, path: [{ t: 0, pos: [0, 0, 1] }] }, deform: [{ type: "twist", amount: 90 }],
}), "v2 layer valid");
assert.ok(ok({ type: "three", source: "text:Hi", mode: "particles", particles: { from: "vortex", count: 30000, trail: 2 } }), "particles layer valid");

console.log("three tests: all passed");
