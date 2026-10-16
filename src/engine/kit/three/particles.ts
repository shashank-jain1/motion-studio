/**
 * Particle-to-logo: N points start in chaos / an explosion / a vortex / a galaxy / rain / a stream and converge
 * onto points sampled evenly inside the logo silhouette (colored by logo part), optionally dispersing again.
 * Every particle follows a CLOSED-FORM path in the vertex shader (start(t) → target, eased per particle with a
 * seeded delay, divergence-free "curl" turbulence that dies out as it locks) — no simulation state, so any frame
 * renders independently (out-of-order safe). Ghost passes at t−δ give cheap trails.
 */
import * as THREE from "three";
import type { Model3D } from "./geometry";
import { mulberry32, samplePoints, silhouette } from "./sampler";

export const PARTICLE_FROMS = ["chaos", "explosion", "vortex", "galaxy", "rain", "stream"] as const;
export type ParticleFrom = (typeof PARTICLE_FROMS)[number];

export type ParticleSpec = {
  count?: number;
  from?: ParticleFrom;
  /** formation start / duration (s) */
  start?: number;
  duration?: number;
  /** extra per-particle delay spread (s) */
  spread?: number;
  /** particle size (fraction of the logo height) */
  size?: number;
  turbulence?: number;
  /** ghost trail copies (0..4) */
  trail?: number;
  blending?: "additive" | "normal";
  /** seconds: disperse (blow away left→right) starting here */
  disperseAt?: number;
  disperseDuration?: number;
  /** fade the solid extruded logo in under the settled particles at this time */
  solidAt?: number;
  seed?: number;
  colors?: string[];
  /** brightness multiplier (HDR: > 1 feeds bloom) */
  intensity?: number;
};

const VERT = /* glsl */ `
attribute vec3 aTarget;
attribute vec4 aSeed;
attribute vec3 aColor;
uniform float uT; uniform float uStart; uniform float uDur; uniform float uSpread; uniform int uFrom;
uniform float uExtent; uniform float uTurb; uniform float uSize; uniform float uViewH; uniform float uLag;
uniform float uDispAt; uniform float uDispDur; uniform float uIntensity; uniform vec2 uXRange;
varying vec3 vColor; varying float vAlpha;
const float TAU = 6.2831853;
vec3 curlish(vec3 p, float t) {
  // each component independent of its own axis → divergence-free (swirls, no sinks)
  return vec3(sin(p.y * 1.7 + t * 0.9) + 0.5 * sin(p.z * 2.3 - t * 0.7),
              sin(p.z * 1.9 - t * 0.8) + 0.5 * sin(p.x * 2.1 + t * 0.6),
              sin(p.x * 1.3 + t * 1.1) + 0.5 * sin(p.y * 2.7 - t * 0.5));
}
vec3 sphereDir(vec4 s) {
  float a = s.x * TAU; float z = s.y * 2.0 - 1.0; float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(cos(a) * r, sin(a) * r, z);
}
vec3 startPos(vec4 s, float t) {
  float R = uExtent;
  if (uFrom == 1) { // explosion: everything erupts from the center, decelerating
    return sphereDir(s) * R * (0.35 + 1.1 * s.z) * (1.0 - exp(-3.2 * max(t, 0.0)));
  }
  if (uFrom == 2) { // vortex: a tornado around the vertical axis
    float r = R * (0.12 + 0.6 * s.z * s.z);
    float a = s.x * TAU + t * (2.2 / (0.35 + r / R));
    return vec3(cos(a) * r, (s.y - 0.5) * R * 1.3 + 0.08 * R * sin(t * 1.3 + s.w * 6.0), sin(a) * r);
  }
  if (uFrom == 3) { // galaxy: three spiral arms in a tilted disc
    float r = R * pow(s.z, 0.7) * 1.1;
    float arm = floor(s.w * 3.0);
    float a = arm * TAU / 3.0 + r / R * 4.0 + t * 0.6 / (0.25 + r / R) + (s.x - 0.5) * 0.7;
    vec3 p = vec3(cos(a) * r, (s.y - 0.5) * 0.08 * R, sin(a) * r);
    return vec3(p.x, p.y * 0.7 + p.z * 0.45, p.z * 0.7 - p.y * 0.45);
  }
  if (uFrom == 4) { // rain: falls from above
    return vec3((s.x - 0.5) * R * 2.2, R * (0.8 + 1.6 * s.y) - t * R * 0.9, (s.z - 0.5) * R * 0.8);
  }
  if (uFrom == 5) { // stream from the left
    return vec3(-R * (1.6 + s.x * 1.4) + t * R * 0.5, (s.y - 0.5) * R * 0.25, (s.z - 0.5) * R * 0.5);
  }
  // chaos: a slowly churning cloud, denser toward the middle
  return sphereDir(s) * R * 0.95 * pow(s.z, 0.6) * vec3(1.25, 0.75, 0.9) + curlish(sphereDir(s) * 2.0, t * 0.6) * R * 0.1;
}
void main() {
  float t = uT - uLag;
  vec4 s = aSeed;
  float nx = (aTarget.x - uXRange.x) / max(1e-3, uXRange.y - uXRange.x);
  float delay = uSpread * (0.7 * s.w + 0.3 * nx);
  float u = clamp((t - uStart - delay) / uDur, 0.0, 1.0);
  float e = u * u * u * (u * (u * 6.0 - 15.0) + 10.0); // smootherstep: leaves gently, lands crisp
  vec3 S = startPos(s, t);
  vec3 p = mix(S, aTarget, e);
  float loose = pow(1.0 - e, 1.5);
  p += curlish(p * (2.5 / uExtent) + s.xyz * 3.0, t * 0.8) * uTurb * uExtent * 0.12 * loose;
  // micro-life once settled
  p += vec3(sin(t * 2.1 + s.x * 40.0), cos(t * 1.7 + s.y * 40.0), 0.0) * uSize * 0.06 * (1.0 - loose);
  float alpha = 1.0;
  if (uDispDur > 0.0) {
    float d = clamp((t - uDispAt - nx * uDispDur * 0.6 - s.w * 0.25) / (uDispDur * 0.6), 0.0, 1.0);
    float dd = d * d;
    p += (vec3(0.9, 0.35, 0.2) + sphereDir(s) * 0.6) * uExtent * 1.4 * dd + curlish(p * 2.0, t) * uExtent * 0.15 * d;
    alpha *= 1.0 - smoothstep(0.55, 1.0, d);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.55 + 0.9 * s.w) * mix(1.25, 1.0, e);
  float px = sz * uViewH * 0.5 * projectionMatrix[1][1] / max(1e-3, -mv.z);
  // sub-2px points would alias to near-nothing: draw at 2px and keep (most of) their energy
  gl_PointSize = max(2.0, px);
  alpha *= clamp((px * px) / 4.0, 0.45, 1.0);
  // hot while flying, true color when locked
  vColor = aColor * uIntensity * (1.0 + 0.9 * loose);
  vAlpha = alpha;
}`;

const FRAG = /* glsl */ `
uniform float uOpacity; uniform float uHard;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float a = 1.0 - smoothstep(mix(0.18, 0.38, uHard), 0.5, r);
  if (a * vAlpha * uOpacity < 0.01) discard;
  if (uHard > 0.5 && r > 0.3) discard; // depth-writing cores only (DOF needs particle depth)
  gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FROM_ID: Record<ParticleFrom, number> = { chaos: 0, explosion: 1, vortex: 2, galaxy: 3, rain: 4, stream: 5 };

export type ParticleSystem = { group: THREE.Group; update: (t: number, viewH: number) => void; dispose: () => void; extent: number };

/** Lift dark inks so additive particles still read (a navy at 10% luminance would vanish). */
const lift = (c: THREE.Color, additive: boolean) => {
  if (!additive) return c;
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.l < 0.55) c.setHSL(hsl.h, Math.max(hsl.s, hsl.s > 0.1 ? 0.6 : 0), 0.55 + hsl.l * 0.3);
  return c;
};

export const buildParticles = (model: Model3D, o: ParticleSpec, partColors: THREE.Color[], depth: number, depthWrite: boolean): ParticleSystem => {
  const sil = silhouette(model);
  const n = Math.max(200, Math.min(200000, o.count ?? 24000));
  const pts = samplePoints(sil, n, o.seed ?? 5);
  const N = pts.count;
  const rnd = mulberry32((o.seed ?? 5) * 31 + 1);
  const additive = (o.blending ?? "additive") === "additive";
  const target = new Float32Array(N * 3), seed = new Float32Array(N * 4), color = new Float32Array(N * 3);
  const pal = (o.colors ?? []).map((c) => new THREE.Color(c));
  for (let i = 0; i < N; i++) {
    target[i * 3] = pts.x[i];
    target[i * 3 + 1] = pts.y[i];
    target[i * 3 + 2] = (rnd() - 0.5) * depth * 0.5;
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
    const base = (pal.length ? pal[Math.floor(rnd() * pal.length)] : partColors[pts.part[i]] ?? partColors[0] ?? new THREE.Color(1, 1, 1)).clone();
    lift(base, additive);
    color[i * 3] = base.r; color[i * 3 + 1] = base.g; color[i * 3 + 2] = base.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(target, 3)); // bounds only (shader positions)
  geo.setAttribute("aTarget", new THREE.BufferAttribute(target, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
  const extent = Math.max(sil.x1 - sil.x0, sil.y1 - sil.y0) * 0.75;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent * 6);
  const size = (o.size ?? 0.014) * (sil.y1 - sil.y0) * Math.sqrt(24000 / Math.max(2000, N));
  const mkMat = (lag: number, opacity: number, sizeK: number) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uT: { value: 0 }, uStart: { value: o.start ?? 0.3 }, uDur: { value: o.duration ?? 2.2 }, uSpread: { value: o.spread ?? 0.6 },
        uFrom: { value: FROM_ID[o.from ?? "chaos"] }, uExtent: { value: extent }, uTurb: { value: o.turbulence ?? 1 },
        uSize: { value: size * sizeK }, uViewH: { value: 1080 }, uLag: { value: lag },
        uDispAt: { value: o.disperseAt ?? 0 }, uDispDur: { value: o.disperseAt !== undefined ? o.disperseDuration ?? 1.6 : 0 },
        uIntensity: { value: o.intensity ?? (additive ? 0.55 : 1) }, uXRange: { value: new THREE.Vector2(sil.x0, sil.x1) },
        uOpacity: { value: opacity }, uHard: { value: depthWrite ? 1 : 0 },
      },
    });
  const group = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  const trail = Math.max(0, Math.min(4, Math.round(o.trail ?? 0)));
  for (let j = trail; j >= 1; j--) {
    const m = mkMat(j * 0.035, 0.45 * (1 - j / (trail + 1)), 0.85);
    m.depthWrite = false;
    m.uniforms.uHard.value = 0;
    mats.push(m);
    const p = new THREE.Points(geo, m);
    p.frustumCulled = false;
    group.add(p);
  }
  const main = mkMat(0, 1, 1);
  mats.push(main);
  const pts3 = new THREE.Points(geo, main);
  pts3.frustumCulled = false;
  group.add(pts3);
  return {
    group,
    extent,
    update: (t, viewH) => {
      for (const m of mats) {
        m.uniforms.uT.value = t;
        m.uniforms.uViewH.value = viewH;
      }
    },
    dispose: () => {
      geo.dispose();
      mats.forEach((m) => m.dispose());
    },
  };
};
