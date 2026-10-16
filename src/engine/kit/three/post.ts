/**
 * Post stack v1 — frame-local effects only (no temporal accumulation, nothing reads previous frames):
 *   scene → HalfFloat MSAA target (+ depth texture)            [sub-frame motion blur: k renders averaged]
 *         → DOF (single-pass scatter-as-gather, half res; CoC from linear depth, rack-focus via focus distance)
 *         → bloom (soft-knee prefilter + 13-tap mip-chain down / tent up, CoD-style; half res and below)
 *         → composite: DOF mix, chromatic aberration, bloom, PBR-Neutral tone map, sRGB, vignette,
 *           grain seeded by the frame index.
 * Transparency: buffers are premultiplied. The object is unpremultiplied → tone mapped → re-premultiplied; bloom
 * is ADDED with alpha untouched (premultiplied "additive light"), so glow composites over the scene behind the
 * canvas. With an opaque in-canvas background (layer.background solid color) everything is alpha 1.
 */
import * as THREE from "three";

export type PostOpts = {
  bloom?: { strength: number; threshold: number; radius: number } | null;
  dof?: { aperture: number; maxBlur: number } | null;
  ca?: number;
  vignette?: number;
  grain?: number;
  exposure: number;
  /** draft: no MSAA, smaller bloom chain, coarser DOF */
  draft: boolean;
};

export type PostFrame = {
  /** frame index (grain seed) */
  frame: number;
  /** focus distance (world units from the camera, along the view axis) */
  focusDist: number;
  near: number;
  far: number;
  /** opaque in-canvas background, sRGB (null = transparent canvas) */
  background: THREE.Color | null;
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const LIN_DEPTH = /* glsl */ `
uniform float uNear; uniform float uFar;
float linDepth(float d) { float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }`;

const COC = /* glsl */ `
uniform float uFocus; uniform float uAperture; uniform float uMaxCoc; // CoC in full-res pixels
float cocPx(float z) { return clamp(uAperture * uMaxCoc * abs(1.0 - uFocus / max(z, 1e-4)), 0.0, uMaxCoc); }`;

// --- bloom ------------------------------------------------------------------------------------------
const PREFILTER = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  // 13-tap downsample (Jimenez 2014), then a soft-knee threshold on brightness
  vec3 a = tap(vec2(-2.,2.)), b = tap(vec2(0.,2.)), c = tap(vec2(2.,2.));
  vec3 d = tap(vec2(-2.,0.)), e = tap(vec2(0.,0.)), f = tap(vec2(2.,0.));
  vec3 g = tap(vec2(-2.,-2.)), h = tap(vec2(0.,-2.)), i = tap(vec2(2.,-2.));
  vec3 j = tap(vec2(-1.,1.)), k = tap(vec2(1.,1.)), l = tap(vec2(-1.,-1.)), m = tap(vec2(1.,-1.));
  vec3 col = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(col * w, vec3(64.0)), 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = tap(vec2(-2.,2.)), b = tap(vec2(0.,2.)), c = tap(vec2(2.,2.));
  vec3 d = tap(vec2(-2.,0.)), e = tap(vec2(0.,0.)), f = tap(vec2(2.,0.));
  vec3 g = tap(vec2(-2.,-2.)), h = tap(vec2(0.,-2.)), i = tap(vec2(2.,-2.));
  vec3 j = tap(vec2(-1.,1.)), k = tap(vec2(1.,1.)), l = tap(vec2(-1.,-1.)), m = tap(vec2(1.,-1.));
  gl_FragColor = vec4(e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel * uRadius).rgb; }
void main() {
  vec3 s = tap(vec2(0.)) * 4.0 + (tap(vec2(-1.,0.)) + tap(vec2(1.,0.)) + tap(vec2(0.,-1.)) + tap(vec2(0.,1.))) * 2.0
         + tap(vec2(-1.,-1.)) + tap(vec2(1.,-1.)) + tap(vec2(-1.,1.)) + tap(vec2(1.,1.));
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s / 16.0, 1.0);
}`;

// --- DOF (Gustafsson 2018 "Bokeh depth of field in a single pass", at half res) ------------------------
const DOF = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uRadScale; uniform float uScale;
varying vec2 vUv;
${LIN_DEPTH}
${COC}
const float GOLDEN = 2.39996323;
void main() {
  vec4 center = texture2D(tColor, vUv);
  float cz = linDepth(texture2D(tDepth, vUv).x);
  float cs = cocPx(cz) * uScale;
  vec4 col = center; float tot = 1.0;
  float maxR = uMaxCoc * uScale;
  float radius = uRadScale;
  float ang = 0.0;
  for (int it = 0; it < 160; it++) {
    if (radius >= maxR) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec4 sc = texture2D(tColor, tc);
    float sz = linDepth(texture2D(tDepth, tc).x);
    float ss = cocPx(sz) * uScale;
    if (sz > cz) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    col += mix(col / tot, sc, m);
    tot += 1.0;
    radius += uRadScale / radius;
    ang += GOLDEN;
  }
  gl_FragColor = col / tot;
}`;

// --- composite -------------------------------------------------------------------------------------------
const COMPOSITE = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tDof; uniform sampler2D tBloom;
uniform vec2 uTexel; uniform vec2 uRes;
uniform float uUseDof; uniform float uBloom; uniform float uCa; uniform float uVignette; uniform float uGrain; uniform float uFrame;
uniform float uExposure; uniform float uScale; uniform vec3 uBg; uniform float uHasBg;
varying vec2 vUv;
${LIN_DEPTH}
${COC}

vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  color *= uExposure;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1. - startCompression;
  float newPeak = 1. - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1. - 1. / (desaturation * (peak - newPeak) + 1.);
  return mix(color, vec3(newPeak), g);
}
vec3 srgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c)); }

float mixAt(vec2 uv) {
  float z = linDepth(texture2D(tDepth, uv).x);
  float c = cocPx(z);
  // near-field dilation: blurry foreground spills over a sharp background (8 taps on a ring)
  float r = uMaxCoc * 0.5;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
    float sz = linDepth(texture2D(tDepth, uv + o).x);
    if (sz < z) c = max(c, cocPx(sz) * 0.75);
  }
  return smoothstep(0.75, 2.5, c);
}
vec4 scene(vec2 uv) {
  vec4 s = texture2D(tColor, uv);
  if (uUseDof > 0.5) s = mix(s, texture2D(tDof, uv), mixAt(uv));
  return s;
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec4 c;
  if (uCa > 0.0) {
    vec2 dir = (vUv - 0.5);
    vec2 o = dir * uCa;
    vec4 r = scene(vUv + o), g = scene(vUv), b = scene(vUv - o);
    c = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
  } else c = scene(vUv);
  float a = clamp(c.a, 0.0, 1.0);
  vec3 col = a > 1e-4 ? srgb(neutral(c.rgb / a)) * a : vec3(0.0);
  if (uBloom > 0.0) {
    vec3 bl = texture2D(tBloom, vUv).rgb * uBloom;
    if (uCa > 0.0) { vec2 o = (vUv - 0.5) * uCa * 2.0; bl.r = texture2D(tBloom, vUv + o).r * uBloom; bl.b = texture2D(tBloom, vUv - o).b * uBloom; }
    // glow added in display space (premultiplied additive light; alpha untouched)
    col += srgb(neutral(bl)) * (1.0 - 0.5 * a);
  }
  if (uHasBg > 0.5) { col += uBg * (1.0 - a); a = 1.0; }
  if (uVignette > 0.0) {
    vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float v = 1.0 - uVignette * smoothstep(0.25, 1.05, length(q) / (0.5 * length(vec2(uRes.x / uRes.y, 1.0))) * 1.0);
    col *= v;
  }
  if (uGrain > 0.0) {
    float n = hash(floor(vUv * uRes) + vec2(uFrame * 17.31, uFrame * 91.7)) + hash(floor(vUv * uRes) * 1.37 + uFrame * 3.1) - 1.0;
    col += n * uGrain * max(a, 0.0);
  }
  gl_FragColor = vec4(max(col, 0.0), a);
}`;

const COPY = /* glsl */ `
uniform sampler2D tSrc; uniform float uWeight; varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv) * uWeight; }`;

const mat = (frag: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });

const halfTarget = (w: number, h: number) =>
  new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

export class PostStack {
  readonly w: number;
  readonly h: number;
  private opts: PostOpts;
  private sceneRT: THREE.WebGLRenderTarget;
  private accumRT: THREE.WebGLRenderTarget | null = null;
  private dofRT: THREE.WebGLRenderTarget | null = null;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private m: Record<"pre" | "down" | "up" | "dof" | "comp" | "copy", THREE.ShaderMaterial>;

  constructor(w: number, h: number, opts: PostOpts) {
    this.w = w;
    this.h = h;
    this.opts = opts;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: opts.draft ? 0 : 4,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
    const u = () => ({ uNear: { value: 0.1 }, uFar: { value: 100 }, uFocus: { value: 1 }, uAperture: { value: 0 }, uMaxCoc: { value: 10 } });
    this.m = {
      pre: mat(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } }),
      down: mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      up: mat(UP, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }),
      dof: mat(DOF, { ...u(), tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadScale: { value: 0.6 }, uScale: { value: 0.5 } }),
      comp: mat(COMPOSITE, {
        ...u(), tColor: { value: null }, tDepth: { value: null }, tDof: { value: null }, tBloom: { value: null },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) }, uRes: { value: new THREE.Vector2(w, h) },
        uUseDof: { value: 0 }, uBloom: { value: 0 }, uCa: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uFrame: { value: 0 },
        uExposure: { value: 1 }, uScale: { value: 1 }, uBg: { value: new THREE.Color() }, uHasBg: { value: 0 },
      }),
      copy: mat(COPY, { tSrc: { value: null }, uWeight: { value: 1 } }, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }),
    };
    if (opts.dof) this.dofRT = halfTarget(Math.ceil(w / 2), Math.ceil(h / 2));
    if (opts.bloom) {
      const levels = opts.draft ? 4 : 6;
      let bw = Math.ceil(w / 2), bh = Math.ceil(h / 2);
      for (let i = 0; i < levels && bw >= 4 && bh >= 4; i++) {
        this.down.push(halfTarget(bw, bh));
        this.up.push(halfTarget(bw, bh));
        bw = Math.ceil(bw / 2);
        bh = Math.ceil(bh / 2);
      }
    }
  }

  setOpts(o: PostOpts) {
    this.opts = o;
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear = true) {
    this.quad.material = m;
    r.setRenderTarget(target);
    if (clear) {
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
    }
    r.render(this.qScene, this.qCam);
  }

  /**
   * Render one frame. `draw(i, k)` must pose the scene for sub-frame i of k (k = 1 without motion blur; the last
   * sub-frame should be the frame time itself, its depth feeds DOF) and is followed by a scene render.
   */
  render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, f: PostFrame, subframes: number, draw: (i: number, k: number) => void) {
    const o = this.opts;
    const prevAuto = r.autoClear;
    r.autoClear = false; // passes clear explicitly (the motion-blur accumulation must not be wiped per pass)
    const k = Math.max(1, subframes);
    let color: THREE.Texture = this.sceneRT.texture;
    if (k > 1 && !this.accumRT) this.accumRT = halfTarget(this.w, this.h);
    for (let i = 0; i < k; i++) {
      draw(i, k);
      r.setRenderTarget(this.sceneRT);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(scene, camera);
      if (k > 1) {
        this.m.copy.uniforms.tSrc.value = this.sceneRT.texture;
        this.m.copy.uniforms.uWeight.value = 1 / k;
        this.pass(r, this.m.copy, this.accumRT, i === 0);
      }
    }
    if (k > 1) color = this.accumRT!.texture;
    const depth = this.sceneRT.depthTexture!;
    const H = this.h;
    const coc = (mm: THREE.ShaderMaterial) => {
      mm.uniforms.uNear.value = f.near;
      mm.uniforms.uFar.value = f.far;
      mm.uniforms.uFocus.value = f.focusDist;
      mm.uniforms.uAperture.value = o.dof ? o.dof.aperture : 0;
      mm.uniforms.uMaxCoc.value = o.dof ? Math.max(1, o.dof.maxBlur * H) : 1;
    };
    // DOF
    if (o.dof && this.dofRT) {
      const d = this.m.dof;
      coc(d);
      d.uniforms.tColor.value = color;
      d.uniforms.tDepth.value = depth;
      d.uniforms.uTexel.value.set(1 / this.dofRT.width, 1 / this.dofRT.height);
      d.uniforms.uScale.value = this.dofRT.height / H;
      d.uniforms.uRadScale.value = o.draft ? 1.2 : 0.6;
      this.pass(r, d, this.dofRT);
    }
    // bloom
    let bloomTex: THREE.Texture | null = null;
    if (o.bloom && this.down.length) {
      const p = this.m.pre;
      p.uniforms.tSrc.value = color;
      p.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      p.uniforms.uThreshold.value = o.bloom.threshold;
      p.uniforms.uKnee.value = Math.max(0.05, o.bloom.threshold * 0.5);
      this.pass(r, p, this.down[0]);
      for (let i = 1; i < this.down.length; i++) {
        this.m.down.uniforms.tSrc.value = this.down[i - 1].texture;
        this.m.down.uniforms.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
        this.pass(r, this.m.down, this.down[i]);
      }
      let prev = this.down[this.down.length - 1];
      for (let i = this.down.length - 2; i >= 0; i--) {
        const u = this.m.up;
        u.uniforms.tSrc.value = prev.texture;
        u.uniforms.tBase.value = this.down[i].texture;
        u.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
        u.uniforms.uRadius.value = o.bloom.radius;
        this.pass(r, u, this.up[i]);
        prev = this.up[i];
      }
      bloomTex = prev.texture;
    }
    // composite → screen
    const c = this.m.comp;
    coc(c);
    c.uniforms.tColor.value = color;
    c.uniforms.tDepth.value = depth;
    c.uniforms.tDof.value = this.dofRT ? this.dofRT.texture : color;
    c.uniforms.tBloom.value = bloomTex ?? color;
    c.uniforms.uUseDof.value = o.dof && this.dofRT ? 1 : 0;
    // levels are summed on the way up: normalize so `strength` reads the same at any chain length
    c.uniforms.uBloom.value = bloomTex && o.bloom ? o.bloom.strength / Math.max(1, this.down.length * 0.5) : 0;
    c.uniforms.uCa.value = o.ca ?? 0;
    c.uniforms.uVignette.value = o.vignette ?? 0;
    c.uniforms.uGrain.value = o.grain ?? 0;
    c.uniforms.uFrame.value = f.frame % 9973;
    c.uniforms.uExposure.value = o.exposure;
    c.uniforms.uHasBg.value = f.background ? 1 : 0;
    if (f.background) (c.uniforms.uBg.value as THREE.Color).copy(f.background);
    this.pass(r, c, null);
    r.autoClear = prevAuto;
  }

  dispose() {
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.accumRT?.dispose();
    this.dofRT?.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.quad.geometry.dispose();
    for (const m of Object.values(this.m)) m.dispose();
  }
}
