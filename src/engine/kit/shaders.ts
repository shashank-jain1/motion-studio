/**
 * GLSL (WebGL1 / GLSL ES 1.00) fragment shaders for ShaderCanvas.
 *
 * Every shader shares the same uniforms:
 *   u_time        seconds (already multiplied by speed), the ONLY source of motion -> deterministic
 *   u_resolution  canvas size in px
 *   u_color0..3   palette (vec3 0..1). Convention: 0/1 = primary accents, 2 = base/backdrop, 3 = highlight
 *   u_intensity   1 = default look; 0 = flat base color; >1 = punchier
 *
 * Shaders are written to look good with the default theme palette ($accent, $accent2, $bg, $fg)
 * and with any 4 vivid colors.
 */
import { interpolateColors } from "remotion";
import type { z } from "zod";
import type { ShaderLayer } from "../spec/schema";

export type ShaderName = z.infer<typeof ShaderLayer>["shader"];

export const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Shared header: uniforms, hashing, gradient noise, fbm, palette helpers, finishing (intensity + dither). */
const PRELUDE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_color0;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform float u_intensity;
#define PI 3.14159265
#define TAU 6.28318531

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Quintic gradient noise, roughly -0.7..0.7
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i) * 2.0 - 1.0, f);
  float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fbm remapped to ~0..1 (mean 0.5)
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * gnoise(p);
    p = m * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return 0.5 + v * 1.1;
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) {
    v += a * gnoise(p);
    p = m * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return 0.5 + v * 1.2;
}
// Cyclic palette through all 4 colors
vec3 pal(float t) {
  t = fract(t) * 4.0;
  float f = smoothstep(0.0, 1.0, fract(t));
  if (t < 1.0) return mix(u_color0, u_color1, f);
  if (t < 2.0) return mix(u_color1, u_color2, f);
  if (t < 3.0) return mix(u_color2, u_color3, f);
  return mix(u_color3, u_color0, f);
}
// Ramp through the accent colors only (0 -> 1 -> 3), skipping the base
vec3 accent(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.5) return mix(u_color0, u_color1, smoothstep(0.0, 1.0, t * 2.0));
  return mix(u_color1, u_color3, smoothstep(0.0, 1.0, t * 2.0 - 1.0) * 0.6);
}
// Cyclic accent ramp 0 -> 1 -> 0
vec3 accentCycle(float t) {
  return mix(u_color0, u_color1, 0.5 - 0.5 * cos(t * TAU));
}
vec3 screenBlend(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 tonemap(vec3 c) { return 1.0 - exp(-c * 1.25); }
// Apply intensity (relative to a base color) + tiny dither against 8-bit banding.
vec3 finish(vec3 col, vec3 base) {
  col = mix(base, col, u_intensity);
  col += (hash12(gl_FragCoord.xy + fract(u_time * 0.618) * 97.0) - 0.5) * (1.5 / 255.0);
  return clamp(col, 0.0, 1.0);
}
`;

const main = (body: string) => `${PRELUDE}\nvoid main() {\n${body}\n}\n`;

/** Centered, aspect-correct coords (y up, -0.5..0.5 vertically). */
const P = `vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float px = 1.0 / u_resolution.y;`;

export const FRAGMENT_SHADERS: Record<ShaderName, string> = {
  // Northern lights: layered curtains with a sharp lower edge, soft upward fade and vertical ray structure.
  aurora: main(`
  ${P}
  float t = u_time * 0.25;
  vec3 sky = mix(u_color2 * 1.1 + 0.025, u_color2 * 0.55, uv.y);
  sky += mix(u_color1, u_color0, 0.5) * 0.06 * (1.0 - uv.y);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = p.x * (0.75 + fi * 0.2) + fi * 3.1;
    float wave = fbm3(vec2(x * 0.6 + t * (0.45 + 0.15 * fi), fi * 4.7 + t * 0.2));
    float yb = -0.12 + fi * 0.11 + (wave - 0.5) * 0.55 + 0.05 * sin(x * 2.1 + t * 1.5 + fi);
    float d = p.y - yb;
    // sharp glowing lower edge, quick soft fade upwards
    float curtain = smoothstep(-0.025, 0.01, d) * exp(-max(d, 0.0) * (6.0 + fi * 2.0));
    curtain += exp(-abs(d) * 45.0) * 0.5;
    float rays = fbm3(vec2(x * 9.0 + wave * 5.0, t * 0.6 + fi * 9.0));
    rays = 0.2 + 1.4 * smoothstep(0.3, 0.85, rays);
    vec3 c = mix(u_color0, u_color1, clamp(d * 5.0 + fi * 0.3, 0.0, 1.0));
    acc += c * curtain * rays * (0.9 - fi * 0.2);
  }
  // faint stars above the lights
  vec2 sc = floor(gl_FragCoord.xy / 3.0);
  float star = step(0.996, hash12(sc)) * (0.5 + 0.5 * sin(u_time * 2.0 + hash12(sc + 7.0) * 30.0)) * smoothstep(0.2, 0.8, uv.y);
  acc += u_color3 * star * 0.35;
  // soft bloom of the brightest band
  acc += mix(u_color0, u_color1, 0.4) * 0.08 * exp(-abs(p.y + 0.02) * 5.0);
  vec3 col = screenBlend(sky, tonemap(acc * 1.2));
  col *= 1.0 - 0.35 * dot(p * vec2(0.6, 1.0), p * vec2(0.6, 1.0));
  gl_FragColor = vec4(finish(col, sky), 1.0);`),

  // Domain-warped fbm: flowing liquid silk with sheen bands.
  liquid: main(`
  ${P}
  vec2 q0 = p * 0.85;
  float t = u_time * 0.1;
  vec2 q = vec2(fbm3(q0 + vec2(0.0, 0.0) + t), fbm3(q0 + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm3(q0 + 2.2 * q + vec2(1.7, 9.2) + t * 1.3), fbm3(q0 + 2.2 * q + vec2(8.3, 2.8) - t * 1.1));
  float f = fbm(q0 + 2.4 * r + t * 0.4);
  vec3 col = mix(u_color2, u_color0, smoothstep(0.25, 0.75, f));
  col = mix(col, u_color1, smoothstep(0.55, 0.95, length(q - 0.5) * 2.2 + r.x * 0.4) * 0.85);
  col = mix(col, u_color3, smoothstep(0.62, 0.9, r.y) * 0.45);
  float sheen = pow(0.5 + 0.5 * sin(f * 14.0 + r.x * 7.0 - u_time * 0.3), 8.0);
  col += sheen * 0.22 * mix(vec3(1.0), u_color3, 0.5) * smoothstep(0.3, 0.7, f);
  col *= 0.7 + 0.55 * smoothstep(0.15, 0.85, f);
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Classic plasma, domain-warped and run through the palette with glossy highlights.
  plasma: main(`
  ${P}
  vec2 q = p * 3.6;
  float t = u_time * 0.6;
  q += 0.4 * vec2(sin(q.y * 1.3 + t * 0.7), cos(q.x * 1.1 - t * 0.5));
  float v = sin(q.x * 2.1 + t)
          + sin(q.y * 1.7 - t * 0.8)
          + sin((q.x + q.y) * 1.4 + t * 0.6)
          + sin(length(q - vec2(sin(t * 0.4), cos(t * 0.33)) * 1.4) * 3.0 - t * 1.2);
  float ph = v * 0.13 + t * 0.04;
  vec3 col = mix(accentCycle(ph), u_color2, smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(ph * TAU * 1.5 + 1.0)) * 0.75);
  col = mix(col, u_color3, smoothstep(0.85, 1.0, 0.5 + 0.5 * sin(ph * TAU * 1.5 - 2.0)) * 0.6);
  float g = 0.5 + 0.5 * cos(v * PI * 0.8);
  col *= 0.72 + 0.4 * g;
  col += pow(g, 10.0) * 0.18 * mix(vec3(1.0), u_color3, 0.5);
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Silk cloth: analytic height field lit with diffuse + specular sheen.
  silk: main(`
  ${P}
  vec2 q = mat2(0.8776, 0.4794, -0.4794, 0.8776) * p * 1.5;
  float t = u_time * 0.5;
  q.y += 0.05 * sin(7.0 * q.x - t * 1.3);
  float s = 5.0 * (q.x + q.y + cos(3.0 * q.x + 5.0 * q.y) + 0.4 * t) + sin(20.0 * (q.x + q.y - 0.1 * t));
  float pat = 0.5 + 0.5 * sin(s);
  float broad = 0.5 + 0.5 * sin(q.x * 1.3 - q.y * 0.7 + t * 0.4 + sin(q.y * 1.1 + t * 0.3) * 1.5);
  vec3 cloth = mix(u_color0, u_color1, broad);
  vec3 col = mix(u_color2, cloth, smoothstep(0.0, 1.0, pat) * 0.85 + 0.08);
  col += pow(pat, 14.0) * 0.4 * mix(vec3(1.0), u_color3, 0.5) * (0.4 + 0.6 * broad);
  col *= 0.7 + 0.4 * broad;
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Hyperspace: star streaks radiating from the center, accelerating with perspective.
  warp: main(`
  ${P}
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = u_time;
  vec3 base = u_color2 * (0.55 + 0.45 * smoothstep(0.9, 0.0, r));
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float N = 110.0 + fl * 80.0;
    float s = (a / TAU + 0.5) * N;
    float id = floor(s);
    float da = fract(s) - 0.5;
    float h = hash12(vec2(id, fl * 17.3 + 1.0));
    if (h < 0.3) continue;
    float spd = 0.35 + 0.65 * hash12(vec2(id * 1.7, fl + 3.1));
    float z = fract(h * 13.7 + t * spd * 0.45);
    float head = 0.035 / (1.04 - z);
    float len = 0.015 + head * (0.15 + 0.6 * z);
    float along = clamp((r - (head - len)) / len, 0.0, 1.0) * step(r, head);
    float w = abs(da) * TAU / N * r;
    float th = px * (0.6 + 2.2 * z);
    float line = 1.0 - smoothstep(th, th + px * 1.5, w);
    vec3 c = mix(accentCycle(h * 3.0 + fl * 0.3), u_color3, 0.1 + 0.4 * z * z);
    acc += c * line * along * along * (0.15 + 1.7 * z * z) * smoothstep(0.02, 0.18, r);
  }
  acc += u_color0 * exp(-r * 5.0) * 0.55;
  acc += u_color3 * exp(-r * 22.0) * 0.8;
  acc += u_color1 * exp(-r * 2.0) * 0.12;
  vec3 col = screenBlend(base, tonemap(acc));
  gl_FragColor = vec4(finish(col, base), 1.0);`),

  // Neon grid tunnel flying forward, fogged into a bright vanishing point.
  tunnel: main(`
  ${P}
  float t = u_time;
  p += 0.07 * vec2(sin(t * 0.45), cos(t * 0.37));
  float r = max(length(p), 0.0015);
  float a = atan(p.y, p.x);
  float depth = 0.32 / r;
  vec2 tuv = vec2(a / PI + t * 0.03, depth + t * 0.7);
  float segs = 16.0;
  vec2 g = vec2(tuv.x * segs * 0.5, tuv.y * 4.0);
  vec2 f = abs(fract(g) - 0.5);
  float wx = segs * 0.5 / PI * px / r * 1.4;
  float wy = 4.0 * 0.32 * px / (r * r) * 1.4;
  float lx = (1.0 - smoothstep(0.025, 0.025 + wx, 0.5 - f.x)) * (1.0 - smoothstep(0.1, 0.45, wx));
  float ly = (1.0 - smoothstep(0.025, 0.025 + wy, 0.5 - f.y)) * (1.0 - smoothstep(0.1, 0.45, wy));
  float lines = max(lx, ly);
  float glow = exp(-(0.5 - f.x) * 7.0) * 0.35 * (1.0 - smoothstep(0.1, 0.45, wx))
             + exp(-(0.5 - f.y) * 7.0) * 0.35 * (1.0 - smoothstep(0.1, 0.45, wy));
  vec3 lineC = accentCycle(tuv.y * 0.12 + tuv.x * 0.5);
  float checker = mod(floor(g.x) + floor(g.y), 2.0);
  vec3 col = mix(u_color2, accentCycle(tuv.y * 0.08 + 0.3), 0.12 + 0.12 * checker);
  col += (lines * 1.1 + glow) * lineC;
  float fog = smoothstep(0.02, 0.5, r);
  col = mix(mix(u_color2, u_color0, 0.35), col, fog);
  col += u_color3 * exp(-r * 13.0) * 0.9 + u_color0 * exp(-r * 4.0) * 0.25;
  col = tonemap(col * 1.1);
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Flowing sine ribbons: many thin glowing lines with constant screen thickness.
  waves: main(`
  ${P}
  float t = u_time * 0.5;
  vec3 base = mix(u_color2 * 1.05, u_color2 * 0.7, uv.y) + u_color0 * 0.04;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    float fi = float(i) / 31.0;
    float o = fi - 0.5;
    float x = p.x;
    // shared swell + per-line spread that breathes along x (ribbon twist)
    float a1 = x * 1.5 + t;
    float a2 = x * 1.2 - t * 0.7 + 1.3;
    float a3 = x * 3.1 - t * 1.2 + fi * 2.0;
    float spread = 0.32 * sin(a2);
    float y = 0.12 * sin(a1) + o * spread + 0.025 * sin(a3);
    float dy = 0.12 * 1.5 * cos(a1) + o * 0.32 * 1.2 * cos(a2) + 0.025 * 3.1 * cos(a3);
    float d = abs(p.y - y) / sqrt(1.0 + dy * dy);
    float line = 1.0 - smoothstep(px * 0.9, px * 2.2, d);
    float glow = px * 3.0 / (d + px * 3.0);
    acc += accent(fi) * (line * 0.85 + glow * 0.06);
  }
  float edge = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x);
  vec3 col = screenBlend(base, tonemap(acc) * (0.35 + 0.65 * edge));
  gl_FragColor = vec4(finish(col, base), 1.0);`),

  // Halftone dot grid whose dot radius follows interfering waves.
  dots: main(`
  vec2 fc = gl_FragCoord.xy;
  float cell = u_resolution.y / 34.0;
  vec2 id = floor(fc / cell);
  vec2 c = (id + 0.5) * cell;
  vec2 pc = (c - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;
  float w1 = 0.5 + 0.5 * sin(length(pc - vec2(-0.3, -0.1)) * 10.0 - t * 2.0);
  float w2 = 0.5 + 0.5 * sin(pc.x * 4.0 + t * 1.3) * sin(pc.y * 3.5 - t * 0.9);
  float v = smoothstep(0.08, 0.95, mix(w1, w2, 0.45));
  float rad = cell * 0.5 * (0.1 + 0.85 * v);
  float d = length(fc - c);
  float dotm = 1.0 - smoothstep(rad - 0.8, rad + 0.8, d);
  vec3 dc = accent(clamp(v * 0.6 + (pc.x + 0.8) * 0.25, 0.0, 1.0));
  vec3 col = mix(u_color2, dc, dotm);
  col += dc * 0.1 * v * exp(-d / cell * 2.5) * (1.0 - dotm);
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Rotating volumetric god rays from the center with a hot core.
  rays: main(`
  ${P}
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = u_time;
  vec2 d1 = vec2(cos(a + t * 0.08), sin(a + t * 0.08));
  vec2 d2 = vec2(cos(a - t * 0.055), sin(a - t * 0.055));
  float rays1 = smoothstep(0.42, 0.82, fbm(d1 * 3.2 + vec2(11.0, t * 0.05)));
  float rays2 = smoothstep(0.45, 0.85, fbm(d2 * 5.5 + vec2(3.0, -t * 0.04)));
  float burst = pow(0.5 + 0.5 * sin(a * 16.0 + t * 0.25), 6.0) * 0.35;
  float fall = exp(-r * 1.5) * smoothstep(0.0, 0.08, r);
  vec3 acc = u_color0 * (rays1 + burst) * fall * 0.95;
  acc += u_color1 * rays2 * fall * 0.75;
  acc += mix(u_color0, u_color1, 0.5) * exp(-r * 2.2) * 0.3;
  acc += u_color3 * exp(-r * 7.0) * 0.85;
  vec3 col = screenBlend(u_color2, tonemap(acc));
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Trendy grainy gradient: large soft color fields with film-like grain (intensity = grain amount).
  noise: main(`
  ${P}
  float t = u_time * 0.08;
  float n1 = fbm3(p * 0.9 + vec2(t, -t * 0.7));
  float n2 = fbm3(p * 0.7 + vec2(-t * 0.6, t) + 7.3);
  float n3 = fbm3(p * 1.1 + vec2(t * 0.4, t * 0.5) + 3.1);
  vec3 col = mix(u_color0, u_color1, smoothstep(0.3, 0.7, n1));
  col = mix(col, u_color3, smoothstep(0.55, 0.8, n2) * 0.45);
  col = mix(col, u_color2, smoothstep(0.35, 0.75, n3 * 0.7 + (1.0 - uv.y) * 0.45) * 0.75);
  float g = hash12(gl_FragCoord.xy + floor(u_time * 24.0) * vec2(13.1, 7.7)) - 0.5;
  col += g * 0.11 * u_intensity;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);`),

  // Synthwave: perspective grid floor rushing toward the camera, striped sun, glowing horizon.
  "grid-floor": main(`
  ${P}
  float t = u_time;
  float hz = 0.04;
  vec3 col;
  if (p.y < hz) {
    float dy = hz - p.y;
    float camH = 0.22;
    float z = camH / dy;
    vec2 w = vec2(p.x * z * 5.0, z * 3.0 + t * 2.0);
    vec2 cl = abs(fract(w) - 0.5);
    float fx = z * px * 5.0 * 1.3;
    float fz = 3.0 * z * z / camH * px * 1.3;
    float lw = 0.022;
    float lx = (1.0 - smoothstep(lw, lw + fx, 0.5 - cl.x)) * (1.0 - smoothstep(0.12, 0.5, fx));
    float lz = (1.0 - smoothstep(lw, lw + fz, 0.5 - cl.y)) * (1.0 - smoothstep(0.12, 0.5, fz));
    float grid = max(lx, lz);
    float glow = (exp(-(0.5 - cl.x) * 16.0) * (1.0 - smoothstep(0.1, 0.4, fx))
               + exp(-(0.5 - cl.y) * 16.0) * (1.0 - smoothstep(0.1, 0.4, fz))) * 0.3;
    float fog = 1.0 - smoothstep(0.0, 0.3, dy);
    vec3 floorC = u_color2 * 0.75 + u_color1 * 0.05;
    col = floorC + u_color0 * (grid * 1.2 + glow) * (1.0 - fog * 0.9);
    col = mix(col, mix(u_color1, u_color2, 0.3), fog * 0.55);
  } else {
    float sy = p.y - hz;
    col = mix(mix(u_color1, u_color2, 0.35), u_color2 * 0.8, smoothstep(0.0, 0.42, sy));
    vec2 sp = p - vec2(0.0, hz + 0.17);
    float sr = 0.21;
    float sd = length(sp);
    vec3 sunC = mix(u_color0, mix(u_color3, u_color1, 0.25), smoothstep(-sr, sr, sp.y));
    float sun = 1.0 - smoothstep(sr - px * 1.5, sr, sd);
    float k = (sp.y + sr) / sr;
    float band = fract(sp.y * 20.0 - t * 0.4);
    float gap = clamp(0.55 - k * 0.55, 0.0, 0.55);
    float cut = (1.0 - smoothstep(gap - 0.06, gap, band)) * step(k, 1.0) * step(0.02, gap);
    col += sunC * exp(-max(sd - sr, 0.0) * 7.0) * 0.35;
    col = mix(col, sunC, sun * (1.0 - cut));
  }
  col += u_color0 * exp(-abs(p.y - hz) * 70.0) * 0.6;
  col += u_color1 * exp(-abs(p.y - hz) * 9.0) * 0.12;
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),

  // Metaball-ish soft gradient blobs (lava lamp / glassy gradient orbs).
  blobs: main(`
  ${P}
  float t = u_time * 0.35;
  float aspect = u_resolution.x / u_resolution.y;
  float field = 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(0.42 * aspect * sin(t * (0.6 + 0.13 * fi) + fi * 2.1),
                  0.3 * cos(t * (0.5 + 0.17 * fi) + fi * 1.3));
    float rad = 0.17 + 0.05 * sin(fi * 3.7 + t * 1.3);
    vec2 dd = p - c;
    float f = rad * rad / (dot(dd, dd) + 0.0008);
    float mi = mod(fi, 3.0);
    vec3 bc = mi < 0.5 ? u_color0 : (mi < 1.5 ? u_color1 : mix(u_color0, u_color3, 0.35));
    field += f;
    acc += bc * f;
  }
  vec3 blobC = acc / max(field, 1e-4);
  float m = smoothstep(0.75, 1.35, field);
  float core = smoothstep(1.3, 4.0, field);
  vec3 col = u_color2 + blobC * smoothstep(0.15, 0.9, field) * 0.18;
  col = mix(col, blobC, m);
  col = mix(col, blobC * 1.15 + u_color3 * 0.08, core * 0.6);
  col += pow(clamp(1.0 - abs(field - 1.05) * 3.0, 0.0, 1.0), 3.0) * 0.12 * mix(vec3(1.0), u_color3, 0.5);
  gl_FragColor = vec4(finish(col, u_color2), 1.0);`),
};

/**
 * Internal render scale per shader. Smooth fields look identical at half resolution
 * (4x fewer fragments, important for software GL in headless renders); line/dot shaders stay crisp.
 */
export const SHADER_RES_SCALE: Record<ShaderName, number> = {
  aurora: 0.5, liquid: 0.5, plasma: 0.5, silk: 0.6, blobs: 0.5,
  warp: 1, tunnel: 1, waves: 1, dots: 1, rays: 0.75, noise: 1, "grid-floor": 1,
};

/** Parse a CSS color into 0..1 rgb. Handles #rgb(a), #rrggbb(aa), rgb()/rgba(); anything else via remotion's color parser. */
export const cssToRgb = (css: string, depth = 0): [number, number, number] => {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length >= 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (v: string | undefined) => {
      if (!v) return 0;
      const n = parseFloat(v);
      return Math.min(1, Math.max(0, v.endsWith("%") ? n / 100 : n / 255));
    };
    return [ch(parts[0]), ch(parts[1]), ch(parts[2])];
  }
  if (depth === 0) {
    try {
      // Named colors, hsl(), etc. -> "rgba(r, g, b, a)"
      return cssToRgb(interpolateColors(0, [0, 1], [s, s]), 1);
    } catch {
      /* fall through */
    }
  }
  return [0.5, 0.5, 0.5];
};
