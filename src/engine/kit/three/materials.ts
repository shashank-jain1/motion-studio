/**
 * Premium material recipes (MeshPhysicalMaterial + the procedural studio environment).
 * Colors are sRGB CSS strings; three converts them to linear. All textures are generated procedurally with a
 * seeded PRNG (no Math.random, no network) and cached at module level.
 */
import * as THREE from "three";

export const MATERIAL_NAMES = ["chrome", "glass", "clay", "matte", "gold", "plastic", "neon", "brushed", "pearl"] as const;
export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** Natural colors for materials that have one (used when neither the layer nor the logo gives a color). */
export const NATURAL: Partial<Record<MaterialName, string>> = {
  chrome: "#f4f5f7",
  gold: "#f2c46d",
  brushed: "#c3c7cd",
  pearl: "#e9e1d9",
  glass: "#eaf4ff",
};
/** metals: brand colors from the logo are lifted toward the metal's natural color by this much */
const METAL_LIFT: Partial<Record<MaterialName, number>> = { chrome: 0.35, brushed: 0.3 };
/** dark inks (espresso browns, navies) would read as black chrome: lift them harder */
const liftFor = (kind: MaterialName, c: THREE.Color) => {
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  return Math.min(0.8, (METAL_LIFT[kind] ?? 0) + 0.4 * (1 - Math.min(1, lum / 0.05)));
};

export const safeColor = (c: string | null | undefined): THREE.Color | null => {
  if (!c) return null;
  const s = c.trim();
  if (!/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(s)) return null;
  try {
    const col = new THREE.Color();
    col.setStyle(s.length === 9 && s.startsWith("#") ? s.slice(0, 7) : s);
    return col;
  } catch {
    return null;
  }
};

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const dataTexture = (data: Uint8Array, w: number, h: number, repeat: [number, number]) => {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
};

let brushedTex: THREE.Texture | null = null;
/** Horizontal hairline streaks (roughness + bump) for brushed metal. */
const brushedMap = () => {
  if (brushedTex) return brushedTex;
  const W = 512, H = 512;
  const data = new Uint8Array(W * H * 4);
  const rnd = mulberry32(1337);
  const rows = new Float32Array(H);
  for (let y = 0; y < H; y++) rows[y] = rnd();
  for (let y = 0; y < H; y++) {
    const r = 0.55 * rows[y] + 0.25 * rows[(y + 1) % H] + 0.2 * rows[(y + H - 1) % H];
    for (let x = 0; x < W; x++) {
      const streak = r + 0.18 * (rnd() - 0.5) * (rnd() < 0.08 ? 1 : 0.25);
      const v = Math.max(0, Math.min(255, Math.round(255 * (0.55 + 0.6 * (streak - 0.5)))));
      const i = (y * W + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  brushedTex = dataTexture(data, W, H, [0.6, 2.2]);
  return brushedTex;
};

let clayTex: THREE.Texture | null = null;
/** Very fine value noise used as a bump map: hand-made clay surfaces are never perfectly smooth. */
const clayBump = () => {
  if (clayTex) return clayTex;
  const N = 256;
  const rnd = mulberry32(4242);
  const grid = new Float32Array(N * N).map(() => rnd());
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += grid[((y + dy + N) % N) * N + ((x + dx + N) % N)];
    const b = Math.round((v / 9) * 255);
    const i = (y * N + x) * 4;
    data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
  }
  clayTex = dataTexture(data, N, N, [3, 3]);
  return clayTex;
};

export type MaterialOpts = {
  kind: MaterialName;
  /** resolved color */
  color: THREE.Color;
  /** the color came from the logo artwork (metals get lifted so dark brand inks still read as metal) */
  fromLogo: boolean;
  envMap: THREE.Texture;
  /** model depth (for glass thickness/absorption) */
  depth: number;
  envIntensity?: number;
};

const lighten = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color(1, 1, 1), k);

/** Returns [capMaterial, sideMaterial] (ExtrudeGeometry groups 0 = caps, 1 = sides; primitives use the first). */
export const makeMaterials = (o: MaterialOpts): [THREE.Material, THREE.Material] => {
  const env = o.envMap;
  const ei = o.envIntensity ?? 1;
  const c = o.color.clone();
  switch (o.kind) {
    case "chrome": {
      const col = o.fromLogo ? c.clone().lerp(safeColor(NATURAL.chrome)!, liftFor("chrome", c)) : c;
      const m = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 1, roughness: 0.09, envMap: env, envMapIntensity: 1.15 * ei,
        clearcoat: 0.6, clearcoatRoughness: 0.04,
      });
      return [m, m];
    }
    case "gold": {
      const col = o.fromLogo ? safeColor(NATURAL.gold)! : c; // gold IS the color: logo inks are ignored
      const m = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 1, roughness: 0.12, envMap: env, envMapIntensity: 1.2 * ei,
        clearcoat: 0.35, clearcoatRoughness: 0.08,
      });
      return [m, m];
    }
    case "brushed": {
      const col = o.fromLogo ? c.clone().lerp(safeColor(NATURAL.brushed)!, liftFor("brushed", c)) : c;
      const map = brushedMap();
      // anisotropy stretches highlights along the cap UVs' x (= horizontal hairlines on logo faces)
      const m = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 1, roughness: 0.34, roughnessMap: map, envMap: env, envMapIntensity: 1.3 * ei,
        anisotropy: 1, anisotropyRotation: 0, bumpMap: map, bumpScale: 0.06,
      });
      const side = new THREE.MeshPhysicalMaterial({ color: col, metalness: 1, roughness: 0.2, envMap: env, envMapIntensity: 1.2 * ei });
      return [m, side];
    }
    case "glass": {
      const tint = c.clone();
      const m = new THREE.MeshPhysicalMaterial({
        color: lighten(tint, 0.55), metalness: 0, roughness: 0.04, transmission: 1, thickness: Math.max(0.05, o.depth * 1.4),
        ior: 1.5, attenuationColor: lighten(tint, 0.2), attenuationDistance: Math.max(0.12, o.depth * 4),
        specularIntensity: 1, envMap: env, envMapIntensity: 1.0 * ei, dispersion: 0.35, side: THREE.DoubleSide,
      });
      return [m, m];
    }
    case "clay": {
      const bump = clayBump();
      const m = new THREE.MeshPhysicalMaterial({
        color: c, metalness: 0, roughness: 0.68, envMap: env, envMapIntensity: 0.85 * ei,
        sheen: 0.9, sheenRoughness: 0.55, sheenColor: lighten(c, 0.55), bumpMap: bump, bumpScale: 0.35,
      });
      return [m, m];
    }
    case "matte": {
      const m = new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.88, envMap: env, envMapIntensity: 0.8 * ei });
      return [m, m];
    }
    case "plastic": {
      const m = new THREE.MeshPhysicalMaterial({
        color: c, metalness: 0, roughness: 0.3, envMap: env, envMapIntensity: 1.0 * ei,
        clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 0.7,
      });
      return [m, m];
    }
    case "neon": {
      // white-hot face, saturated tube sides; the halo is added outside WebGL (CSS drop-shadow on the canvas).
      // Dark brand inks can't glow: force a luminous, saturated version of the hue.
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.max(hsl.s, hsl.s < 0.08 ? 0 : 0.75), Math.max(hsl.l, 0.5));
      const cap = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0, 0, 0), emissive: lighten(c, 0.45), emissiveIntensity: 2.2, roughness: 0.3, metalness: 0, envMap: env, envMapIntensity: 0.4,
      });
      const side = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0, 0, 0), emissive: c, emissiveIntensity: 1.6, roughness: 0.35, metalness: 0, envMap: env, envMapIntensity: 0.4,
      });
      return [cap, side];
    }
    case "pearl": {
      // nacre: cream base, satin sheen, thin-film specular, plus an angle-driven pastel hue shift on the diffuse
      // (three's iridescence alone only tints the 4% specular lobe, which vanishes on a bright base)
      const col = o.fromLogo ? lighten(c, 0.6) : c;
      const m = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 0.2, roughness: 0.24, envMap: env, envMapIntensity: 1.1 * ei,
        iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [380, 980],
        clearcoat: 0.8, clearcoatRoughness: 0.06, sheen: 0.7, sheenColor: new THREE.Color(1, 0.8, 0.93), sheenRoughness: 0.3,
      });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          {
            float pv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            float fr = pow(1.0 - pv, 1.25);
            vec3 nacre = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + fr * 1.35 + 0.08 + 0.12 * normal.y));
            diffuseColor.rgb *= mix(vec3(1.0), 0.55 + 0.75 * nacre, 0.25 + 0.55 * fr);
          }`,
        );
      };
      m.customProgramCacheKey = () => "ms-pearl-v1";
      return [m, m];
    }
  }
};
