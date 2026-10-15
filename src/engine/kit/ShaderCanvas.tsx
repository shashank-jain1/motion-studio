import React, { useLayoutEffect, useRef } from "react";
import { FRAGMENT_SHADERS, SHADER_RES_SCALE, VERTEX_SHADER, cssToRgb, type ShaderName } from "./shaders";

/**
 * WebGL1 full-screen fragment shader renderer.
 * Draws synchronously in useLayoutEffect on every render, so the frame Remotion screenshots is always
 * the one for the current `t` (no async work, no delayRender needed). Time comes ONLY from props.
 *
 * The <canvas> is created imperatively inside a host div: this survives React StrictMode's
 * mount/unmount/mount cycle (a canvas whose context was released can never get a new one).
 */
export type ShaderCanvasProps = {
  shader: ShaderName;
  /** Already-resolved CSS colors (hex / rgb / any CSS color). Missing ones are padded by cycling. */
  colors: string[];
  speed?: number;
  intensity?: number;
  width: number;
  height: number;
  /** seconds */
  t: number;
  /** Optional override of the internal render scale (0.25..1). Defaults per shader. */
  quality?: number;
  style?: React.CSSProperties;
};

type ProgramInfo = {
  program: WebGLProgram;
  aPos: number;
  uTime: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uInt: WebGLUniformLocation | null;
  uCols: (WebGLUniformLocation | null)[];
};

type GLState = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  buffer: WebGLBuffer;
  programs: Map<ShaderName, ProgramInfo | null>;
};

const FALLBACK_COLORS = ["#7c5cff", "#00d4ff", "#0b0b12", "#ffffff"];

const compile = (gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null => {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("[ShaderCanvas] compile error:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

const buildProgram = (gl: WebGLRenderingContext, name: ShaderName): ProgramInfo | null => {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADERS[name]);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[ShaderCanvas] link error (${name}):`, gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    aPos: gl.getAttribLocation(program, "a_pos"),
    uTime: gl.getUniformLocation(program, "u_time"),
    uRes: gl.getUniformLocation(program, "u_resolution"),
    uInt: gl.getUniformLocation(program, "u_intensity"),
    uCols: [0, 1, 2, 3].map((i) => gl.getUniformLocation(program, `u_color${i}`)),
  };
};

const initGL = (host: HTMLDivElement): GLState | null => {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  const gl = canvas.getContext("webgl", {
    preserveDrawingBuffer: true,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const buffer = gl.createBuffer();
  if (!buffer) return null;
  // One oversized triangle covering the viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  host.appendChild(canvas);
  return { canvas, gl, buffer, programs: new Map() };
};

const dispose = (s: GLState | null) => {
  if (!s) return;
  const { gl } = s;
  s.programs.forEach((p) => p && gl.deleteProgram(p.program));
  gl.deleteBuffer(s.buffer);
  // Free the context right away: browsers cap live WebGL contexts (~16).
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  s.canvas.remove();
};

const fallbackBackground = (colors: string[]) =>
  `linear-gradient(135deg, ${(colors.length >= 2 ? colors : FALLBACK_COLORS).join(", ")})`;

export const ShaderCanvas: React.FC<ShaderCanvasProps> = ({
  shader, colors, speed = 1, intensity = 1, width, height, t, quality, style,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GLState | null>(null);
  const failedRef = useRef(false);

  // Draw on every render (no deps): t changes every frame.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!stateRef.current && !failedRef.current) {
      stateRef.current = initGL(host);
      if (!stateRef.current) {
        failedRef.current = true;
        console.error("[ShaderCanvas] WebGL unavailable; using CSS gradient fallback. Try chromiumOptions.gl = 'angle' or 'swangle'.");
      }
    }
    const s = stateRef.current;
    if (!s) {
      host.style.background = fallbackBackground(colors);
      return;
    }
    const { gl, canvas } = s;
    if (!s.programs.has(shader)) s.programs.set(shader, buildProgram(gl, shader));
    const prog = s.programs.get(shader);
    if (!prog) {
      host.style.background = fallbackBackground(colors);
      canvas.style.visibility = "hidden";
      return;
    }
    canvas.style.visibility = "visible";
    host.style.background = "";

    const scale = Math.min(1, Math.max(0.2, quality ?? SHADER_RES_SCALE[shader] ?? 1));
    const cw = Math.max(1, Math.round(width * scale));
    const ch = Math.max(1, Math.round(height * scale));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const palette = colors.length ? colors : FALLBACK_COLORS;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(prog.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buffer);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(prog.uTime, t * speed);
    gl.uniform2f(prog.uRes, cw, ch);
    gl.uniform1f(prog.uInt, intensity);
    for (let i = 0; i < 4; i++) {
      const [r, g, b] = cssToRgb(palette[i % palette.length]);
      gl.uniform3f(prog.uCols[i], r, g, b);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
  });

  // Release the GL context on unmount.
  useLayoutEffect(() => () => {
    dispose(stateRef.current);
    stateRef.current = null;
    failedRef.current = false;
  }, []);

  return <div ref={hostRef} style={{ width, height, overflow: "hidden", ...style }} />;
};
