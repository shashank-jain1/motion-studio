/**
 * A Rig owns one layer's three.js scene (built once per layer config) and poses it as a pure function of t:
 *   object    the extruded shape (+ kinetic type per glyph, stack-echo copies, deformers)
 *   cloner    ONE InstancedMesh driven by cloner layout × fields (cloner.ts)
 *   particles closed-form particle paths in a shader (particles.ts), optional solid-logo crossfade
 * Shared by all modes: procedural studio env + direct lights, glass refraction backdrop, contact shadow, camera
 * language (camera.ts). Rendering itself (direct or through the post stack) is done by ThreeView.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { z } from "zod";
import type { ThreeLayer } from "../../spec/schema";
import { clamp01, ease } from "../../core/animate";
import type { Model3D } from "./geometry";
import { ENV_PRESETS, type Lighting, getEnvMap, makeRefractionBackdrop } from "./environment";
import { type MaterialName, makeMaterials } from "./materials";
import { type Animation3D, type Pose, KINETIC_3D, objectPose, partPose } from "./motion";
import { kineticPose, echoOffset, type KineticOpts } from "./kinetic";
import { BASE_FOV, type CameraSpec, applyCamera, cameraPose, viewDelta } from "./camera";
import { ContactShadow } from "./contactShadow";
import {
  type CloneState, type Clones, type FieldCtx, type FieldSpec, applyFields, arrivalTimes, buildClones, burstCollapse, cubeShuffle,
  expandPreset, splitFlap, usesReveal, type ClonerSpec,
} from "./cloner";
import { type ParticleSystem, buildParticles } from "./particles";
import { type DeformSpec, type DeformUniforms, applyDeform, makeDeformUniforms, updateDeform } from "./deform";

export type Layer3D = z.infer<typeof ThreeLayer>;
export type PartPaint = { color: THREE.Color; fromLogo: boolean; key: string };

export type RigInput = {
  layer: Layer3D;
  model: Model3D;
  paints: PartPaint[];
  material: MaterialName;
  lighting: Lighting;
  animation: Animation3D;
  /** resolve a (theme) color string to a THREE.Color, null if unusable */
  color: (c: string | undefined) => THREE.Color | null;
  /** particles write depth (needed by DOF) */
  depthWrite: boolean;
  /** draft / software GL: low-poly clones, smaller shadow target */
  lite?: boolean;
};

const FILL = 0.66;
const D2R = Math.PI / 180;
const KINETIC = new Set<string>(KINETIC_3D);

const disposeMats = (ms: Iterable<THREE.Material>) => {
  for (const m of ms) m.dispose();
};

export class Rig {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 400);
  private probe = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 400);
  readonly exposure: number;
  /** subject extents (model units) used for framing */
  readonly size: { w: number; h: number; d: number };
  private inp: RigInput;
  private root = new THREE.Group();
  private shadow: ContactShadow | null = null;
  private hideFromShadow: THREE.Object3D[] = [];
  private disposers: (() => void)[] = [];
  private poseFn: (t: number) => void = () => undefined;
  private objectGroup: THREE.Group | null = null;
  private deformU: DeformUniforms | null = null;
  private deforms: DeformSpec[] = [];
  private aspect = 16 / 9;
  /** a point of interest for macro moves (cloner: the most central clone) */
  private hero: [number, number, number] | null = null;
  private viewH = 1080;

  constructor(r: THREE.WebGLRenderer, inp: RigInput) {
    this.inp = inp;
    const { layer, model, lighting } = inp;
    const preset = ENV_PRESETS[lighting];
    this.exposure = preset.exposure;
    const envMap = getEnvMap(r, lighting);
    this.scene.add(new THREE.AmbientLight(0xffffff, preset.ambient));
    for (const l of preset.lights) {
      const dl = new THREE.DirectionalLight(l.color, l.intensity);
      dl.position.set(...l.pos);
      this.scene.add(dl);
    }
    this.scene.add(this.root);
    const mode = layer.mode ?? "object";
    let floorY: number, span: number, depthSpan: number, shadowOn: boolean;
    if (mode === "cloner") {
      const r0 = this.buildCloner(envMap);
      this.size = r0.size;
      floorY = r0.size.y0 - Math.max(0.03, r0.size.h * 0.06);
      span = Math.max(r0.size.w, r0.size.h);
      depthSpan = Math.max(span * 1.2, 0.5);
      shadowOn = layer.shadow3d ?? r0.shadowDefault;
    } else if (mode === "particles") {
      const r0 = this.buildParticles(envMap);
      this.size = r0.size;
      floorY = -model.height / 2 - 0.05;
      span = Math.max(model.width, model.height);
      depthSpan = span;
      shadowOn = layer.shadow3d ?? false;
    } else {
      this.buildObject(envMap);
      this.size = { w: model.width, h: model.height, d: model.depth };
      floorY = -model.height / 2 - Math.max(0.03, model.height * 0.05);
      span = Math.max(model.width, model.height);
      depthSpan = Math.max(span * 1.2, model.depth * 6);
      shadowOn = layer.shadow3d ?? inp.material !== "neon";
    }
    if (inp.material === "glass" && mode !== "particles") {
      const backdrop = makeRefractionBackdrop(lighting);
      this.scene.add(backdrop);
      this.hideFromShadow.push(backdrop);
      this.disposers.push(() => {
        backdrop.geometry.dispose();
        (backdrop.material as THREE.Material).dispose();
      });
    }
    if (shadowOn) {
      this.shadow = new ContactShadow({
        y: floorY, width: span * 2.2, depth: depthSpan, far: Math.max(0.6, this.size.h * 1.1),
        opacity: Math.min(1, 0.8 * preset.shadow), blur: 2.2, resolution: inp.lite ? 256 : 512,
      });
      this.scene.add(this.shadow.group);
    }
  }

  // ------------------------------------------------------------------------------------------- object

  private buildObject(envMap: THREE.Texture) {
    const { layer, model, paints, material, animation } = this.inp;
    const mats = new Map<string, [THREE.Material, THREE.Material]>();
    const pairFor = (key: string, color: THREE.Color, fromLogo: boolean) => {
      let p = mats.get(key);
      if (!p) {
        p = makeMaterials({ kind: material, color, fromLogo, envMap, depth: model.depth });
        mats.set(key, p);
      }
      return p;
    };
    this.disposers.push(() => mats.forEach(([a, b]) => { a.dispose(); if (b !== a) b.dispose(); }));
    const prim = model.kind === "primitive";
    const group = new THREE.Group();
    this.objectGroup = group;
    this.root.add(group);
    const meshes: THREE.Mesh[] = model.parts.map((p, i) => {
      const pair = pairFor(paints[i].key, paints[i].color, paints[i].fromLogo);
      const m = new THREE.Mesh(p.geometry, prim ? pair[0] : pair);
      group.add(m);
      return m;
    });
    // deformers
    this.deforms = (layer.deform ?? []) as DeformSpec[];
    if (this.deforms.length) {
      this.deformU = makeDeformUniforms({ w: model.width, h: model.height });
      for (const [a, b] of mats.values()) { applyDeform(a, this.deformU); if (b !== a) applyDeform(b, this.deformU); }
    }
    // rank parts left→right
    const order = model.parts.map((p, i) => [p.center.x, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const ranks: number[] = new Array(order.length);
    order.forEach((pi, k) => (ranks[pi] = k));
    const kin: KineticOpts = { stagger: layer.stagger, order: layer.order, echo: layer.echo };
    const n = model.parts.length;
    const partOffset = (i: number, t: number): Pose | null => {
      const p = model.parts[i];
      if (KINETIC.has(animation)) {
        return kineticPose(animation, t, { rank: ranks[i], n, cx: p.center.x, cy: p.center.y, w: model.width, h: model.height, depth: model.depth }, kin);
      }
      return partPose(animation, t, ranks[i], n, p.center.x, p.center.y, model.width);
    };
    const place = (m: THREE.Mesh, i: number, pp: Pose | null, extra?: { x: number; y: number; z: number }) => {
      const c = model.parts[i].center;
      m.position.set(c.x + (pp?.x ?? 0) + (extra?.x ?? 0), c.y + (pp?.y ?? 0) + (extra?.y ?? 0), c.z + (pp?.z ?? 0) + (extra?.z ?? 0));
      m.rotation.set(pp?.rx ?? 0, pp?.ry ?? 0, pp?.rz ?? 0);
      const s = pp?.s ?? 1;
      const sy = pp?.sy ?? 1;
      m.scale.set(s / Math.sqrt(sy), s * sy, s * (pp?.sz ?? 1) / Math.sqrt(sy));
      m.visible = s > 1e-4;
    };
    // stack-echo copies (deepest first so the front word draws on top)
    const echoes: { group: THREE.Group; meshes: THREE.Mesh[]; e: number }[] = [];
    if (animation === "stack-echo") {
      const K = Math.max(1, Math.min(14, Math.round(layer.echo?.count ?? 6)));
      const deep = this.inp.color(layer.echo?.color) ?? null;
      for (let e = K; e >= 1; e--) {
        const g = new THREE.Group();
        const ms = model.parts.map((p, i) => {
          const base = paints[i].color.clone();
          const target = deep ?? base.clone().multiplyScalar(0.18);
          const col = base.clone().lerp(target, Math.pow(e / K, 0.8));
          const pair = pairFor(`${paints[i].key}|echo${e}`, col, false);
          const m = new THREE.Mesh(p.geometry, prim ? pair[0] : pair);
          g.add(m);
          return m;
        });
        group.add(g);
        echoes.push({ group: g, meshes: ms, e });
      }
    }
    this.poseFn = (t: number) => {
      const pose = objectPose(animation, t);
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.set(pose.rx, pose.ry, pose.rz);
      group.scale.setScalar(pose.s);
      meshes.forEach((m, i) => place(m, i, partOffset(i, t)));
      for (const ec of echoes) {
        const off = echoOffset(ec.e, echoes.length, t, model.depth, model.height, layer.echo?.gap ?? 1);
        ec.meshes.forEach((m, i) => place(m, i, partOffset(i, t - off.lag), off));
      }
    };
  }

  // ------------------------------------------------------------------------------------------- cloner

  private buildCloner(envMap: THREE.Texture) {
    const { layer, model, paints, material } = this.inp;
    const plan = expandPreset(layer.cloner as ClonerSpec | undefined, layer.fields as FieldSpec[] | undefined);
    const c = plan.cloner;
    const cl: Clones = buildClones(model, c);
    const shape = c.shape ?? "rounded-box";
    const depthK = c.depth ?? (shape === "tile" ? 0.16 : 1);
    const many = cl.count > 12000 || !!this.inp.lite;
    let geo: THREE.BufferGeometry;
    switch (shape) {
      case "box": geo = new THREE.BoxGeometry(1, 1, 1); break;
      case "sphere": geo = new THREE.IcosahedronGeometry(0.5, many ? 1 : cl.count > 1500 ? 2 : 3); break;
      case "cylinder": geo = new THREE.CylinderGeometry(0.5, 0.5, 1, many ? 12 : 24).rotateX(Math.PI / 2); break;
      case "tile": geo = new RoundedBoxGeometry(1, 1, 1, many ? 1 : 2, 0.08); break;
      case "logo": {
        const parts = model.parts.map((p) => {
          const g = p.geometry.clone();
          g.clearGroups();
          g.translate(p.center.x, p.center.y, p.center.z);
          return g;
        });
        geo = mergeGeometries(parts, false) ?? new THREE.BoxGeometry(1, 1, 1);
        parts.forEach((g) => g.dispose());
        const k = 1 / Math.max(model.width, model.height, 1e-3);
        geo.scale(k, k, k / Math.max(1e-3, depthK) * Math.max(0.2, model.depth));
        break;
      }
      default: geo = new RoundedBoxGeometry(1, 1, 1, many ? 1 : 3, 0.12);
    }
    const white = new THREE.Color(1, 1, 1);
    const [mat] = makeMaterials({ kind: material, color: white, fromLogo: false, envMap, depth: 0.2 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cl.count));
    mesh.count = cl.count;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const holder = new THREE.Group();
    if (c.plane === "floor") holder.rotation.x = -Math.PI / 2; // layout on the ground, clone z = height
    holder.add(mesh);
    this.root.add(holder);
    // the clone nearest the layout center: macro moves dive into it (logo-of-logos)
    {
      let best = Infinity;
      const cx0 = (cl.bounds.x0 + cl.bounds.x1) / 2, cy0 = (cl.bounds.y0 + cl.bounds.y1) / 2;
      for (let i = 0; i < cl.count; i++) {
        const d = (cl.pos[i * 3] - cx0) ** 2 + (cl.pos[i * 3 + 1] - cy0) ** 2;
        if (d < best) { best = d; this.hero = [cl.pos[i * 3], cl.pos[i * 3 + 1], cl.pos[i * 3 + 2]]; }
      }
    }
    this.disposers.push(() => { geo.dispose(); mat.dispose(); mesh.dispose(); });

    // colors: A = base (before a reveal), B = final (logo color inside, `outside` outside)
    const col = (s: string | undefined, fb: string) => this.inp.color(s) ?? new THREE.Color(fb);
    const partCol = paints.map((p) => p.color);
    const inside = c.colors?.inside ? col(c.colors.inside, "#ffffff") : null;
    const outside = col(c.colors?.outside, "#1d2027");
    const base = col(c.colors?.base, "#c9ccd3");
    const palette = (c.colors?.palette ?? []).map((s) => col(s, "#888888"));
    const colB = new Float32Array(cl.count * 3);
    for (let i = 0; i < cl.count; i++) {
      const p = cl.part[i];
      const cc = p >= 0 ? inside ?? partCol[p] ?? partCol[0] ?? white : outside;
      colB[i * 3] = cc.r; colB[i * 3 + 1] = cc.g; colB[i * 3 + 2] = cc.b;
    }
    const fields = plan.fields;
    const tints = fields.map((f) => (f.effect.color && f.effect.color !== "reveal" && f.effect.color !== "blend" ? col(f.effect.color, "#ffffff") : null));
    const ext = Math.max(cl.bounds.x1 - cl.bounds.x0, cl.bounds.y1 - cl.bounds.y0);
    const ctx: FieldCtx = { clones: cl, extent: ext, center: [(cl.bounds.x0 + cl.bounds.x1) / 2, (cl.bounds.y0 + cl.bounds.y1) / 2, 0] };
    const arrivals = fields.map((f) => arrivalTimes(f, ctx));
    const reveal = usesReveal(fields) || plan.special === "split-flap" || plan.special === "burst-collapse";
    const splitPal = palette.length ? palette : [base, outside, ...partCol.slice(0, 3)];
    const cs = cl.cell * (c.size ?? 0.9);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
    const tmpC = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color();
    const st: CloneState = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, colorK: 1, tint: null, tintK: 0 };
    mesh.setColorAt(0, white);
    this.poseFn = (t: number) => {
      for (let i = 0; i < cl.count; i++) {
        st.x = st.y = st.z = st.rx = st.ry = st.rz = 0;
        st.sx = st.sy = st.sz = 1;
        st.colorK = reveal ? 0 : 1;
        st.tint = null; st.tintK = 0;
        let palIdx = -1;
        if (plan.special === "split-flap") palIdx = splitFlap(st, cl, i, t, splitPal.length);
        else if (plan.special === "cube-shuffle") cubeShuffle(st, cl, i, t);
        else if (plan.special === "burst-collapse") burstCollapse(st, cl, i, t, ext);
        applyFields(st, fields, ctx, i, t, arrivals, tints);
        v.set(cl.pos[i * 3] + st.x, cl.pos[i * 3 + 1] + st.y, cl.pos[i * 3 + 2] + st.z);
        e.set(st.rx, st.ry, st.rz);
        q.setFromEuler(e);
        const sx = Math.max(1e-5, st.sx * cs), sy = Math.max(1e-5, st.sy * cs), sz = Math.max(1e-5, st.sz * cs * depthK);
        s3.set(sx, sy, sz);
        m4.compose(v, q, s3);
        mesh.setMatrixAt(i, m4);
        cB.setRGB(colB[i * 3], colB[i * 3 + 1], colB[i * 3 + 2]);
        if (palIdx >= 0) cA.copy(splitPal[palIdx]);
        else cA.copy(base);
        tmpC.copy(cA).lerp(cB, st.colorK);
        if (st.tint) tmpC.lerp(st.tint, st.tintK);
        mesh.setColorAt(i, tmpC);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const b = cl.bounds;
    if (c.plane === "floor") {
      // seen from above: frame the ground footprint (depth becomes the height axis)
      return { size: { w: b.x1 - b.x0, h: (b.y1 - b.y0) * 0.75, d: cs * depthK * 3, y0: -cs }, shadowDefault: false };
    }
    return {
      size: { w: b.x1 - b.x0, h: b.y1 - b.y0, d: Math.max(cs * depthK, b.z1 - b.z0), y0: b.y0 },
      shadowDefault: (c.mask ?? "logo") === "logo" && c.layout !== "radial" && c.layout !== "linear",
    };
  }

  // ------------------------------------------------------------------------------------------- particles

  private buildParticles(envMap: THREE.Texture) {
    const { layer, model, paints, material } = this.inp;
    const ps = layer.particles ?? {};
    const sys: ParticleSystem = buildParticles(model, ps, paints.map((p) => p.color), model.depth, this.inp.depthWrite);
    this.root.add(sys.group);
    this.hideFromShadow.push(sys.group);
    this.disposers.push(() => sys.dispose());
    let solid: { group: THREE.Group; mats: THREE.Material[] } | null = null;
    if (ps.solidAt !== undefined) {
      const g = new THREE.Group();
      const mats: THREE.Material[] = [];
      const cache = new Map<string, [THREE.Material, THREE.Material]>();
      model.parts.forEach((p, i) => {
        let pair = cache.get(paints[i].key);
        if (!pair) {
          pair = makeMaterials({ kind: material, color: paints[i].color, fromLogo: paints[i].fromLogo, envMap, depth: model.depth });
          for (const m of new Set(pair)) { m.transparent = true; mats.push(m); }
          cache.set(paints[i].key, pair);
        }
        const m = new THREE.Mesh(p.geometry, model.kind === "primitive" ? pair[0] : pair);
        m.position.copy(p.center);
        g.add(m);
      });
      this.root.add(g);
      solid = { group: g, mats };
      this.disposers.push(() => disposeMats(mats));
    }
    const at = ps.solidAt ?? 0;
    this.poseFn = (t: number) => {
      sys.update(t, this.viewH);
      if (solid) {
        const k = ease("inOut", clamp01((t - at) / 0.7));
        solid.group.visible = k > 0.001;
        for (const m of solid.mats) {
          m.opacity = k;
          m.depthWrite = k > 0.95;
        }
        sys.group.visible = k < 0.999;
        sys.group.children.forEach((c) => (((c as THREE.Points).material as THREE.ShaderMaterial).uniforms.uOpacity.value = Math.max(0, 1 - k * 1.15) * (c === sys.group.children[sys.group.children.length - 1] ? 1 : 0.45)));
      }
    };
    return { size: { w: model.width, h: model.height, d: model.depth } };
  }

  // ------------------------------------------------------------------------------------------- per frame

  private fitDist(aspect: number) {
    const tanH = Math.tan((BASE_FOV * D2R) / 2);
    const W = Math.max(this.size.w, 0.2), H = Math.max(this.size.h, 0.2);
    return Math.max(H / FILL / 2 / tanH, W / FILL / 2 / (tanH * aspect)) + this.size.d / 2;
  }

  private camAt(cam: THREE.PerspectiveCamera, t: number) {
    const { layer, animation } = this.inp;
    let spec = layer.camera as CameraSpec | undefined;
    if (spec && this.hero && !spec.target && (spec.move === "macro-push" || spec.move === "macro-pull")) spec = { ...spec, target: this.hero };
    const p = cameraPose({
      orbit: layer.orbit, anim: animation, cam: spec, t,
      fitDist: this.fitDist(this.aspect), size: this.size,
    });
    applyCamera(cam, p, this.aspect, Math.max(0.01, this.fitDist(this.aspect) * 0.05));
    return p;
  }

  /** Pose the whole scene for time t. */
  update(t: number, aspect: number, viewH: number) {
    this.aspect = aspect;
    this.viewH = viewH;
    this.poseFn(t);
    this.camAt(this.camera, t);
    this.scene.updateMatrixWorld(true);
    if (this.deformU && this.objectGroup) updateDeform(this.deformU, this.deforms, t, this.objectGroup);
  }

  /** Render-to-texture prepasses that depend on the current poses (contact shadow). */
  prepass(r: THREE.WebGLRenderer) {
    this.shadow?.render(r, this.scene, this.hideFromShadow);
  }

  /** Focus distance (camera → focus plane at world z = focusZ, along the view axis). */
  focusDistance(focusZ: number) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const p = this.camAtTargetCache.set(0, 0, focusZ);
    return Math.max(this.camera.near * 1.5, p.sub(this.camera.position).dot(fwd));
  }
  private camAtTargetCache = new THREE.Vector3();

  /** How much the picture moves between t and t + dt (degrees-ish): drives auto motion blur. */
  motion(t: number, dt: number) {
    this.camAt(this.probe, t);
    const a = this.probe.clone();
    this.camAt(this.probe, t + dt);
    let deg = viewDelta(a, this.probe);
    const dist = Math.max(1e-3, a.position.length());
    deg += (Math.atan(a.position.distanceTo(this.probe.position) / dist) / D2R) * 0.6;
    if ((this.inp.layer.mode ?? "object") === "object") {
      const p0 = objectPose(this.inp.animation, t), p1 = objectPose(this.inp.animation, t + dt);
      deg += (Math.abs(p1.ry - p0.ry) + Math.abs(p1.rx - p0.rx) + Math.abs(p1.rz - p0.rz)) / D2R * 0.5;
    }
    return deg;
  }

  dispose() {
    this.shadow?.dispose();
    for (const d of this.disposers) d();
  }
}

