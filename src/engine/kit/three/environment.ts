/**
 * Procedural studio environments — no HDRI downloads, fully deterministic.
 *
 * An environment is an analytic radiance function of direction: a sky/horizon/floor gradient plus up to 8
 * rectangular softboxes / strip lights (HDR intensities). The same GLSL drives:
 *   1. the PMREM environment map (rendered once per renderer+preset via PMREMGenerator.fromScene) that every
 *      material reflects — this is what makes chrome/gold/glass read as "studio product shot";
 *   2. the glass refraction backdrop (a sphere visible ONLY inside three's transmission pass, so glass bends
 *      a real studio instead of a flat white haze, while the canvas stays transparent).
 * Directions: +z = toward the default camera, +y = up, +x = screen right.
 */
import * as THREE from "three";

export const LIGHTINGS = ["studio", "softbox", "sunset", "neon", "rim", "dramatic"] as const;
export type Lighting = (typeof LIGHTINGS)[number];

type Box = {
  /** direction from the object toward the light (normalized internally) */
  dir: [number, number, number];
  /** half extent in tangent units (tan of half-angle): [w, h] */
  size: [number, number];
  /** linear HDR color (already × intensity) */
  color: [number, number, number];
  /** roll of the panel around its axis (deg) */
  roll?: number;
  /** edge softness 0..1 (fraction of the half extent) */
  soft?: number;
};

type DirLight = { pos: [number, number, number]; color: string; intensity: number };

export type EnvPreset = {
  top: [number, number, number];
  horizon: [number, number, number];
  bottom: [number, number, number];
  boxes: Box[];
  /** direct lights (shape/form for diffuse materials + crisp speculars) */
  lights: DirLight[];
  ambient: number;
  exposure: number;
  /** contact-shadow strength multiplier */
  shadow: number;
};

const g = (v: number, tint: [number, number, number] = [1, 1, 1]): [number, number, number] => [v * tint[0], v * tint[1], v * tint[2]];
const WARM: [number, number, number] = [1, 0.94, 0.86];
const COOL: [number, number, number] = [0.86, 0.93, 1];

export const ENV_PRESETS: Record<Lighting, EnvPreset> = {
  // classic product studio: bright cyc wall + dark floor (faces read top-bright / bottom-dark like real chrome),
  // a hot overhead key, tall strips on both sides (edge highlights), two kickers behind (rims)
  studio: {
    top: g(0.45), horizon: g(0.3), bottom: g(0.01),
    boxes: [
      { dir: [0.15, 0.21, 1], size: [1.6, 0.32], color: g(1.5), soft: 0.45 },
      { dir: [0.05, -0.16, 1], size: [1.8, 0.012], color: g(4), soft: 0.5 },
      { dir: [-0.3, 1, 0.25], size: [0.8, 0.45], color: g(6, WARM), soft: 0.35 },
      { dir: [-1, 0.12, 0.2], size: [0.09, 1.3], color: g(8), soft: 0.25 },
      { dir: [1, 0.15, 0.35], size: [0.12, 1.2], color: g(4, COOL), soft: 0.3 },
      { dir: [0.6, 0.3, -0.8], size: [0.08, 0.9], color: g(9), soft: 0.2 },
      { dir: [-0.6, 0.3, -0.8], size: [0.08, 0.9], color: g(7), soft: 0.2 },
    ],
    lights: [
      { pos: [-3, 5, 4], color: "#fff6ea", intensity: 1.6 },
      { pos: [4, 1.5, 2], color: "#e8f0ff", intensity: 0.35 },
      { pos: [1.5, 3, -5], color: "#ffffff", intensity: 1.8 },
    ],
    ambient: 0.05, exposure: 1.0, shadow: 1,
  },
  // high-key, wrap-around soft light (e-commerce white), a soft grey floor so metals still have contrast
  softbox: {
    top: g(0.8), horizon: g(0.55), bottom: g(0.06),
    boxes: [
      { dir: [-0.8, 0.45, 0.6], size: [0.7, 0.9], color: g(2.2), soft: 0.7 },
      { dir: [0.85, 0.4, 0.55], size: [0.7, 0.9], color: g(1.6), soft: 0.7 },
      { dir: [0, 1, 0.1], size: [1.2, 1.2], color: g(1.6), soft: 0.7 },
      { dir: [0.1, 0.25, 1], size: [1.4, 0.3], color: g(0.9), soft: 0.8 },
      { dir: [0, 0.2, -1], size: [1.0, 0.7], color: g(1.2), soft: 0.6 },
    ],
    lights: [
      { pos: [-3, 4, 5], color: "#ffffff", intensity: 1.2 },
      { pos: [3, 3, 4], color: "#ffffff", intensity: 0.7 },
    ],
    ambient: 0.35, exposure: 1.0, shadow: 0.7,
  },
  // golden hour: low warm sun + glowing horizon, violet sky, near-black ground
  sunset: {
    top: [0.09, 0.08, 0.26], horizon: [0.95, 0.38, 0.16], bottom: [0.02, 0.01, 0.012],
    boxes: [
      { dir: [-0.9, 0.1, 0.4], size: [0.14, 0.11], color: [30, 13, 4], soft: 0.9 },
      { dir: [0, 0.035, 1], size: [2.2, 0.06], color: [6, 2.4, 0.7], soft: 0.8 },
      { dir: [0, -0.12, 1], size: [2.2, 0.012], color: [3, 1.3, 0.5], soft: 0.6 },
      { dir: [0.8, 0.5, -0.4], size: [0.12, 0.8], color: [2.0, 1.2, 3.2], soft: 0.3 },
      { dir: [0.3, 0.9, 0.3], size: [1.2, 0.8], color: [0.6, 0.4, 1.1], soft: 0.7 },
    ],
    lights: [
      { pos: [-5, 1.2, 2.5], color: "#ffae6b", intensity: 2.4 },
      { pos: [3, 3, -3], color: "#a98cff", intensity: 1.1 },
    ],
    ambient: 0.05, exposure: 1.0, shadow: 0.9,
  },
  // dark stage, magenta + cyan tubes (one crossing the front so faces pick up a colored line)
  neon: {
    top: [0.02, 0.015, 0.05], horizon: [0.05, 0.02, 0.08], bottom: [0.004, 0.003, 0.008],
    boxes: [
      { dir: [-0.9, 0.2, 0.4], size: [0.05, 1.1], color: [10, 0.6, 5.5], soft: 0.3 },
      { dir: [0.9, 0.15, 0.45], size: [0.05, 1.1], color: [0.3, 5.5, 10], soft: 0.3 },
      { dir: [0, 0.9, 0.4], size: [1.2, 0.04], color: [2.5, 1.2, 6], soft: 0.4 },
      { dir: [0.1, 0.12, 1], size: [1.6, 0.025], color: [7, 1.2, 6], soft: 0.4 },
      { dir: [0.1, -0.12, 1], size: [1.6, 0.02], color: [0.8, 5, 8], soft: 0.4 },
      { dir: [0.3, 0.3, -0.9], size: [0.05, 0.8], color: [6, 0.8, 4], soft: 0.3 },
      { dir: [-0.3, 0.3, -0.9], size: [0.05, 0.8], color: [0.4, 4, 7], soft: 0.3 },
    ],
    lights: [
      { pos: [-4, 1.5, 2], color: "#ff3fb4", intensity: 1.6 },
      { pos: [4, 1.0, 2], color: "#38d6ff", intensity: 1.6 },
    ],
    ambient: 0.02, exposure: 1.05, shadow: 0.6,
  },
  // silhouette + edge light: dark front with one dim scrim line, hot strips behind
  rim: {
    top: g(0.08), horizon: g(0.05), bottom: g(0.006),
    boxes: [
      { dir: [-0.75, 0.25, -0.6], size: [0.08, 1.0], color: g(16), soft: 0.2 },
      { dir: [0.75, 0.25, -0.6], size: [0.08, 1.0], color: g(16, COOL), soft: 0.2 },
      { dir: [0, 1, -0.3], size: [0.9, 0.12], color: g(7), soft: 0.3 },
      { dir: [0.05, -0.09, 1], size: [1.4, 0.07], color: g(1.4), soft: 0.8 },
      { dir: [-1, 0.1, 0.05], size: [0.05, 1.2], color: g(6), soft: 0.2 },
    ],
    lights: [
      { pos: [-3, 2, -4], color: "#ffffff", intensity: 2.6 },
      { pos: [3, 2, -4], color: "#dfe9ff", intensity: 2.6 },
      { pos: [0, 2, 5], color: "#ffffff", intensity: 0.25 },
    ],
    ambient: 0.02, exposure: 1.0, shadow: 0.8,
  },
  // one hard key from above-left, a single specular slash across the faces, everything else falls to black
  dramatic: {
    top: g(0.04), horizon: g(0.02), bottom: g(0.003),
    boxes: [
      { dir: [-0.55, 0.8, 0.3], size: [0.28, 0.5], color: g(16, WARM), soft: 0.25 },
      { dir: [0.0, -0.1, 1], size: [1.8, 0.03], color: g(7, WARM), soft: 0.5, roll: -10 },
      { dir: [0.7, 0.2, -0.7], size: [0.05, 0.7], color: g(6), soft: 0.2 },
      { dir: [-1, 0.3, 0.1], size: [0.05, 1.0], color: g(4), soft: 0.2 },
    ],
    lights: [
      { pos: [-3, 5, 2], color: "#fff1dc", intensity: 2.6 },
      { pos: [3, 1.5, -4], color: "#ffffff", intensity: 1.0 },
    ],
    ambient: 0.0, exposure: 1.0, shadow: 1.1,
  },
};

const MAX_BOXES = 8;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform vec3 uDir[${MAX_BOXES}]; uniform vec3 uRight[${MAX_BOXES}]; uniform vec3 uUp[${MAX_BOXES}];
uniform vec2 uSize[${MAX_BOXES}]; uniform vec3 uColor[${MAX_BOXES}]; uniform float uSoft[${MAX_BOXES}];
uniform int uCount;
uniform float uGain;
varying vec3 vDir;
vec3 radiance(vec3 d) {
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-y, 0.0, 1.0), 0.35));
  for (int i = 0; i < ${MAX_BOXES}; i++) {
    if (i >= uCount) break;
    float z = dot(d, uDir[i]);
    if (z <= 0.0) continue;
    vec2 p = vec2(dot(d, uRight[i]), dot(d, uUp[i])) / z;
    vec2 q = abs(p) / uSize[i];
    float s = max(uSoft[i], 0.02);
    float m = (1.0 - smoothstep(1.0 - s, 1.0, q.x)) * (1.0 - smoothstep(1.0 - s, 1.0, q.y));
    // softbox diffusion: slightly hotter center
    m *= 0.8 + 0.2 * (1.0 - min(1.0, dot(q, q)));
    col += uColor[i] * m;
  }
  return max(col, vec3(0.0));
}
void main() {
  gl_FragColor = vec4(radiance(normalize(vDir)) * uGain, 1.0);
}`;

/** ShaderMaterial that paints a preset's radiance onto the inside of a sphere centered at the origin. */
export const makeEnvMaterial = (p: EnvPreset, gain = 1) => {
  const dirs: THREE.Vector3[] = [], rights: THREE.Vector3[] = [], ups: THREE.Vector3[] = [];
  const sizes: THREE.Vector2[] = [], colors: THREE.Vector3[] = [], softs: number[] = [];
  for (let i = 0; i < MAX_BOXES; i++) {
    const b = p.boxes[i];
    if (!b) {
      dirs.push(new THREE.Vector3(0, 0, 1)); rights.push(new THREE.Vector3(1, 0, 0)); ups.push(new THREE.Vector3(0, 1, 0));
      sizes.push(new THREE.Vector2(1, 1)); colors.push(new THREE.Vector3()); softs.push(0.1);
      continue;
    }
    const d = new THREE.Vector3(...b.dir).normalize();
    const worldUp = Math.abs(d.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    let r = new THREE.Vector3().crossVectors(worldUp, d).normalize();
    let u = new THREE.Vector3().crossVectors(d, r).normalize();
    if (b.roll) {
      const q = new THREE.Quaternion().setFromAxisAngle(d, (b.roll * Math.PI) / 180);
      r = r.applyQuaternion(q);
      u = u.applyQuaternion(q);
    }
    dirs.push(d); rights.push(r); ups.push(u);
    sizes.push(new THREE.Vector2(b.size[0], b.size[1]));
    colors.push(new THREE.Vector3(...b.color));
    softs.push(b.soft ?? 0.3);
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Vector3(...p.top) },
      uHorizon: { value: new THREE.Vector3(...p.horizon) },
      uBottom: { value: new THREE.Vector3(...p.bottom) },
      uDir: { value: dirs }, uRight: { value: rights }, uUp: { value: ups },
      uSize: { value: sizes }, uColor: { value: colors }, uSoft: { value: softs },
      uCount: { value: Math.min(MAX_BOXES, p.boxes.length) },
      uGain: { value: gain },
    },
  });
};

// ---------------------------------------------------------------------------------------------
// PMREM cache: one prefiltered env per (renderer, preset)

const pmremCache = new WeakMap<THREE.WebGLRenderer, Map<string, THREE.Texture>>();

export const getEnvMap = (gl: THREE.WebGLRenderer, lighting: Lighting): THREE.Texture => {
  let m = pmremCache.get(gl);
  if (!m) {
    m = new Map();
    pmremCache.set(gl, m);
  }
  const hit = m.get(lighting);
  if (hit) return hit;
  const scene = new THREE.Scene();
  const mat = makeEnvMaterial(ENV_PRESETS[lighting]);
  const geo = new THREE.SphereGeometry(10, 64, 32);
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromScene(scene, 0.012, 0.1, 50, { size: 512 });
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  m.set(lighting, rt.texture);
  return rt.texture;
};

/**
 * What glass refracts. A flat cyc reads as "grey plastic" through glass; glass only reads as glass when there is
 * contrast behind it — so the backdrop is its own design: strip lights + a horizon line behind the object
 * (dark stage), or dark flags on a bright sweep (high-key). Negative box colors are "flags" (subtractive).
 */
const REFRACT_DARK: EnvPreset = {
  top: g(0.1), horizon: g(0.16), bottom: g(0.012),
  boxes: [
    { dir: [0.32, 0.05, -1], size: [0.04, 1.4], color: g(7), soft: 0.35 },
    { dir: [-0.42, 0.05, -1], size: [0.07, 1.4], color: g(4), soft: 0.5 },
    { dir: [0.05, -0.02, -1], size: [2.0, 0.018], color: g(4), soft: 0.5 },
    { dir: [0, 0.6, -0.8], size: [1.4, 0.3], color: g(1.2), soft: 0.8 },
    { dir: [-0.1, -0.35, -1], size: [1.6, 0.25], color: g(0.5, WARM), soft: 0.9 },
  ],
  lights: [], ambient: 0, exposure: 1, shadow: 1,
};
const REFRACT_LIGHT: EnvPreset = {
  top: g(1.5), horizon: g(1.2), bottom: g(0.7),
  boxes: [
    { dir: [0.3, 0.05, -1], size: [0.05, 1.4], color: g(-0.55), soft: 0.6 },
    { dir: [-0.4, 0.05, -1], size: [0.09, 1.4], color: g(-0.45), soft: 0.7 },
    { dir: [0.05, -0.05, -1], size: [2.0, 0.03], color: g(-0.7), soft: 0.6 },
    { dir: [0, 0.6, -0.8], size: [1.4, 0.3], color: g(1.5), soft: 0.8 },
  ],
  lights: [], ambient: 0, exposure: 1, shadow: 1,
};
const REFRACT_TINT: Partial<Record<Lighting, [number, number, number]>> = {
  sunset: [1.25, 0.75, 0.5],
  neon: [1.1, 0.6, 1.4],
};

/**
 * Glass backdrop: a huge sphere painted with the refraction studio that draws ONLY inside the transmission pass
 * (render target ≠ null). In the main pass it writes neither color nor depth, so the canvas stays transparent.
 */
export const makeRefractionBackdrop = (lighting: Lighting): THREE.Mesh => {
  const base = lighting === "softbox" ? REFRACT_LIGHT : REFRACT_DARK;
  const tint = REFRACT_TINT[lighting];
  const p: EnvPreset = tint
    ? { ...base, boxes: base.boxes.map((b) => ({ ...b, color: [b.color[0] * tint[0], b.color[1] * tint[1], b.color[2] * tint[2]] as [number, number, number] })) }
    : base;
  const mat = makeEnvMaterial(p, 1);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (renderer) => {
    mat.colorWrite = renderer.getRenderTarget() !== null;
  };
  return mesh;
};
