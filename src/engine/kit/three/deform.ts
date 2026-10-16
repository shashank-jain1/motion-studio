/**
 * Vertex deformer stack (up to 4): twist · bend · taper · wave · squash · jiggle. Applied in the object group's
 * space (logo units: 1 = shape height, centered) via onBeforeCompile on the PBR materials, so lighting stays
 * physical; normals are re-derived from the deformation's numeric Jacobian (n' = J^-T n). Amounts are evaluated
 * on the CPU per frame (keys / damped springs), uploaded as uniforms. Needs tessellated geometry
 * (buildModel(..., { tess: true })): more extrusion steps, subdivided contours and caps.
 */
import * as THREE from "three";
import { clamp01, ease } from "../../core/animate";
import type { EaseName } from "../../core/animate";

export const DEFORMERS = ["twist", "bend", "taper", "wave", "squash", "jiggle"] as const;
export type DeformerType = (typeof DEFORMERS)[number];
export type DeformSpec = {
  type: DeformerType;
  /** twist: degrees across the shape height · bend: degrees across the width · taper: top scale delta (0.5 = +50%)
   *  · wave: amplitude (fraction of height) · squash: compression 0..1 · jiggle: squash-stretch amplitude */
  amount?: number;
  keys?: { t: number; amount: number; ease?: EaseName }[];
  /** jiggle: impact time (s) */
  at?: number;
  /** wave: waves across the width; jiggle: oscillations per second */
  freq?: number;
  /** wave: cycles per second */
  speed?: number;
  /** jiggle: damping */
  decay?: number;
};

const TYPE_ID: Record<DeformerType, number> = { twist: 1, bend: 2, taper: 3, wave: 4, squash: 5, jiggle: 5 };
const D2R = Math.PI / 180;

export const deformAmount = (d: DeformSpec, t: number): number => {
  if (d.type === "jiggle") {
    const tau = t - (d.at ?? 0.5);
    if (tau < 0) return 0;
    const A = d.amount ?? 0.3;
    // impact compresses first, then stretches and settles (volume preserved in the shader)
    return A * Math.exp(-(d.decay ?? 4.5) * tau) * Math.cos(2 * Math.PI * (d.freq ?? 3.2) * tau);
  }
  const ks = (d.keys ?? []).slice().sort((a, b) => a.t - b.t);
  if (!ks.length) return d.amount ?? 0;
  if (t <= ks[0].t) return ks[0].amount;
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i].t) {
      const u = ease(ks[i].ease, clamp01((t - ks[i - 1].t) / Math.max(1e-6, ks[i].t - ks[i - 1].t)), "inOutQuint");
      return ks[i - 1].amount + (ks[i].amount - ks[i - 1].amount) * u;
    }
  }
  return ks[ks.length - 1].amount;
};

export type DeformUniforms = {
  uGroup: { value: THREE.Matrix4 };
  uGroupInv: { value: THREE.Matrix4 };
  uDef: { value: THREE.Vector4[] };
  uBox: { value: THREE.Vector4 };
};

export const makeDeformUniforms = (box: { w: number; h: number }): DeformUniforms => ({
  uGroup: { value: new THREE.Matrix4() },
  uGroupInv: { value: new THREE.Matrix4() },
  uDef: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
  uBox: { value: new THREE.Vector4(box.w, box.h, 0, 0) },
});

/** Write this frame's deformer values (type, amount, p1, p2) into the uniforms. */
export const updateDeform = (u: DeformUniforms, defs: DeformSpec[], t: number, group: THREE.Object3D) => {
  group.updateMatrixWorld(true);
  u.uGroup.value.copy(group.matrixWorld);
  u.uGroupInv.value.copy(group.matrixWorld).invert();
  u.uBox.value.z = t;
  for (let i = 0; i < 4; i++) {
    const d = defs[i];
    const v = u.uDef.value[i];
    if (!d) { v.set(0, 0, 0, 0); continue; }
    let a = deformAmount(d, t);
    if (d.type === "twist" || d.type === "bend") a *= D2R;
    v.set(TYPE_ID[d.type], a, d.freq ?? 1.5, d.speed ?? 0.5);
  }
};

const GLSL = /* glsl */ `
uniform mat4 uGroup; uniform mat4 uGroupInv; uniform vec4 uDef[4]; uniform vec4 uBox;
vec3 msDeform(vec3 p) {
  for (int i = 0; i < 4; i++) {
    vec4 d = uDef[i];
    int ty = int(d.x + 0.5);
    float a = d.y;
    if (ty == 1) { // twist around Y: a radians across the height
      float ang = a * p.y / max(uBox.y, 1e-3);
      float c = cos(ang), s = sin(ang);
      p.xz = vec2(c * p.x + s * p.z, -s * p.x + c * p.z);
    } else if (ty == 2) { // bend the width onto an arc (a radians across the width); a > 0 curls away
      float k = a / max(uBox.x, 1e-3);
      if (abs(k) > 1e-4) {
        float r = 1.0 / k;
        float th = p.x * k;
        float rho = r + p.z;
        p.x = rho * sin(th);
        p.z = rho * cos(th) - r;
      }
    } else if (ty == 3) { // taper: scale x/z linearly with height
      float s = 1.0 + a * (p.y / max(uBox.y, 1e-3));
      p.xz *= max(s, 0.02);
    } else if (ty == 4) { // travelling wave through z (a = amplitude in heights)
      p.z += a * uBox.y * sin(6.2831853 * (d.z * p.x / max(uBox.x, 1e-3) - d.w * uBox.z));
      p.y += 0.25 * a * uBox.y * sin(6.2831853 * (d.z * p.x / max(uBox.x, 1e-3) - d.w * uBox.z) + 1.3);
    } else if (ty == 5) { // squash (a = compression), anchored at the base, volume preserved
      float s = max(0.05, 1.0 - a);
      float y0 = -0.5 * uBox.y;
      p.y = y0 + (p.y - y0) * s;
      p.xz *= inversesqrt(s);
    }
  }
  return p;
}
vec3 msDeformN(vec3 p, vec3 n) {
  float e = 0.002 * max(uBox.y, 1e-3);
  vec3 dx = (msDeform(p + vec3(e, 0., 0.)) - msDeform(p - vec3(e, 0., 0.))) / (2.0 * e);
  vec3 dy = (msDeform(p + vec3(0., e, 0.)) - msDeform(p - vec3(0., e, 0.))) / (2.0 * e);
  vec3 dz = (msDeform(p + vec3(0., 0., e)) - msDeform(p - vec3(0., 0., e))) / (2.0 * e);
  mat3 J = mat3(dx, dy, dz);
  return normalize(transpose(inverse(J)) * n);
}
`;

/** Patch a material (keeps any existing onBeforeCompile) so its vertices go through the deformer stack. */
export const applyDeform = (m: THREE.Material, u: DeformUniforms) => {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${GLSL}`)
      .replace(
        "#include <defaultnormal_vertex>",
        `vec3 transformedNormal;
        {
          mat4 toG = uGroupInv * modelMatrix;
          vec3 gp = (toG * vec4(position, 1.0)).xyz;
          vec3 ng = normalize(mat3(toG) * objectNormal);
          ng = msDeformN(gp, ng);
          transformedNormal = normalize(mat3(viewMatrix) * mat3(uGroup) * ng);
        }
        #ifdef FLIP_SIDED
          transformedNormal = - transformedNormal;
        #endif
        #ifdef USE_TANGENT
          vec3 transformedTangent = ( modelViewMatrix * vec4( objectTangent, 0.0 ) ).xyz;
          #ifdef FLIP_SIDED
            transformedTangent = - transformedTangent;
          #endif
        #endif`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 msG = uGroupInv * modelMatrix * vec4(transformed, 1.0);
        msG.xyz = msDeform(msG.xyz);
        vec4 mvPosition = viewMatrix * (uGroup * msG);
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|ms-deform-v1`;
  m.needsUpdate = true;
};
