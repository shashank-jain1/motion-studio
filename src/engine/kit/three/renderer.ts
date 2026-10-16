/**
 * One WebGL context per page (3D v2). Every `three` layer renders into this shared offscreen renderer and copies
 * the result into its own 2D <canvas> (drawImage, "copy" composite) inside the same task, so:
 *   - Chrome's ~16-active-contexts limit can't drop layers (24 layers in one scene: 8 were lost before, 0 now);
 *   - shaders, the PMREM studio environments and geometry uploads are shared between layers;
 *   - each layer is still its own DOM element (CSS stacking with 2D layers, enter/exit transforms, filters).
 * Rendering is synchronous in the layer's layout effect, so it is a pure function of the frame (out-of-order safe).
 */
import * as THREE from "three";

let renderer: THREE.WebGLRenderer | null = null;
let generation = 0;
let software: boolean | null = null;

/** Bumped whenever the shared renderer is (re)created: GPU-side caches keyed on it must rebuild. */
export const rendererGeneration = () => generation;

export const getRenderer = (): THREE.WebGLRenderer => {
  if (renderer) return renderer;
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (renderer === r) {
      renderer = null; // next frame recreates it (and every layer rebuilds its GPU resources)
      software = null;
    }
  });
  renderer = r;
  generation++;
  return r;
};

/** SwiftShader / software GL (Lambda "swangle"): post and sub-frame blur default to draft there. */
export const isSoftwareGL = (): boolean => {
  if (software !== null) return software;
  const r = getRenderer();
  const gl = r.getContext();
  let name = "";
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    name = "";
  }
  software = /swiftshader|llvmpipe|software/i.test(name);
  return software;
};

/** Size the shared drawing buffer (device pixels) only when it changes. */
export const sizeRenderer = (r: THREE.WebGLRenderer, w: number, h: number) => {
  const c = r.domElement;
  if (c.width !== w || c.height !== h) r.setSize(w, h, false);
};

/** Copy the shared canvas into a layer's 2D canvas (must run in the same task as the render). */
export const blit = (r: THREE.WebGLRenderer, target: HTMLCanvasElement, w: number, h: number) => {
  if (target.width !== w) target.width = w;
  if (target.height !== h) target.height = h;
  const ctx = target.getContext("2d", { alpha: true });
  if (!ctx) return;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(r.domElement, 0, 0, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
};
