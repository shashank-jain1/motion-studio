/**
 * "three" layer: a logo / wordmark / library shape / primitive as a studio-lit 3D object, a MoGraph cloner, or a
 * particle-to-logo formation — with camera moves, kinetic type, deformers and a frame-local post stack.
 *
 *   source → geometry.ts (extrude + bevel, cached)    scene → rig.ts (object | cloner | particles)
 *   camera → camera.ts (orbit + moves + spline + shake) post → post.ts (bloom · DOF · CA · vignette · grain · blur)
 *
 * Rendering (3D v2): ONE shared WebGL context per page (renderer.ts). Each layer poses its rig for `t`, renders
 * into the shared offscreen canvas and copies the pixels into its own 2D <canvas> — synchronously in the layout
 * effect, so every frame is a pure function of t (Remotion may render frames in any order / several tabs).
 * The canvas is transparent unless `background` is set; layer transforms (enter/exit/keyframes) still apply.
 */
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useCurrentFrame } from "remotion";
import type { z } from "zod";
import type { ThreeLayer } from "../../spec/schema";
import { useColor, useRuntime } from "../../core/context";
import { useContainer } from "../../core/container";
import { clamp01, ease } from "../../core/animate";
import { resolveRaw, sourceAssets, useFontKey, useJsonAssets } from "../../shapes/resolve";
import { type Model3D, buildModel, buildPrimitive, parsePrimitive } from "./geometry";
import type { Lighting } from "./environment";
import { type MaterialName, NATURAL, safeColor } from "./materials";
import type { Animation3D } from "./motion";
import { Rig, type PartPaint } from "./rig";
import { PostStack, type PostOpts } from "./post";
import { blit, getRenderer, isSoftwareGL, rendererGeneration, sizeRenderer } from "./renderer";

type Layer = z.infer<typeof ThreeLayer>;
type Props = { layer: Layer; t: number; duration: number };

export const DEFAULTS_3D = { material: "chrome" as MaterialName, lighting: "studio" as Lighting, animation: "spin-in" as Animation3D, depth: 0.18, bevel: 0.02 };

/** Diagnostics only (scripts/tests/perf-3d.ts sets MS_PERF3D): logs the layer's CPU+GPU ms per frame. Never affects pixels. */
const PERF = typeof window !== "undefined" && /MS_PERF3D/.test(String((window as unknown as { remotion_envVariables?: string }).remotion_envVariables ?? ""));

const modelIds = new WeakMap<Model3D, number>();
let nextModelId = 1;
const modelId = (m: Model3D) => {
  let id = modelIds.get(m);
  if (!id) { id = nextModelId++; modelIds.set(m, id); }
  return id;
};

type FocusSpec = number | { t: number; z: number; ease?: string }[] | undefined;
type ResolvedPost = PostOpts & { focus: FocusSpec; blur: { samples: number; shutter: number; threshold: number } | null };

/** Normalize layer.post (+ implied motion blur for whips) into PostStack options; null = render direct. */
const resolvePost = (layer: Layer, exposure: number, draft: boolean): ResolvedPost | null => {
  const p = layer.post;
  const whip = layer.camera?.move === "whip-pan" || layer.camera?.move === "whip-out";
  if (!p && !whip) return null;
  const bl = p?.bloom;
  const bloom = bl === undefined || bl === 0 ? null
    : typeof bl === "number" ? { strength: bl, threshold: 0.8, radius: 0.7 }
    : { strength: bl.strength ?? 0.6, threshold: bl.threshold ?? 0.8, radius: bl.radius ?? 0.7 };
  const dof = p?.dof ? { aperture: p.dof.aperture ?? 0.6, maxBlur: p.dof.maxBlur ?? 0.02 } : null;
  const mb = p?.motionBlur ?? (whip ? true : undefined);
  const blur = mb === undefined || mb === false ? null
    : mb === true ? { samples: draft ? 7 : 17, shutter: whip ? 1 : 0.5, threshold: 1.2 }
    : { samples: Math.max(3, Math.min(25, Math.round(mb.samples ?? (draft ? 7 : 17)))), shutter: mb.shutter ?? (whip ? 1 : 0.5), threshold: mb.threshold ?? 1.2 };
  return { bloom, dof, ca: p?.ca, vignette: p?.vignette, grain: p?.grain, exposure, draft, focus: p?.dof?.focus as FocusSpec, blur };
};

const focusAt = (focus: FocusSpec, t: number): number => {
  if (focus === undefined) return 0;
  if (typeof focus === "number") return focus;
  const ks = [...focus].sort((a, b) => a.t - b.t);
  if (!ks.length) return 0;
  if (t <= ks[0].t) return ks[0].z;
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i].t) {
      const u = ease(ks[i].ease as never, clamp01((t - ks[i - 1].t) / Math.max(1e-6, ks[i].t - ks[i - 1].t)), "inOutQuint");
      return ks[i - 1].z + (ks[i].z - ks[i - 1].z) * u;
    }
  }
  return ks[ks.length - 1].z;
};

export const ThreeView: React.FC<Props> = ({ layer, t }) => {
  const box = useContainer();
  const color = useColor();
  const rt = useRuntime();
  const frame = useCurrentFrame();
  const W = Math.max(2, Math.round(layer.width ?? box.width));
  const H = Math.max(2, Math.round(layer.height ?? box.height));

  const mode = layer.mode ?? "object";
  const material: MaterialName = layer.material ?? (mode === "cloner" ? "plastic" : DEFAULTS_3D.material);
  const lighting: Lighting = layer.lighting ?? (material === "neon" ? "neon" : DEFAULTS_3D.lighting);
  const animation: Animation3D = layer.animation ?? (mode === "object" ? DEFAULTS_3D.animation : "none");
  const depth = Math.max(0.01, Math.min(2, layer.depth ?? DEFAULTS_3D.depth));
  const bevel = Math.max(0, Math.min(0.2, layer.bevel ?? DEFAULTS_3D.bevel));
  const tess = mode === "object" && !!layer.deform?.length;

  const prim = parsePrimitive(layer.source);
  const { family, weight } = useFontKey(layer.font, layer.weight);
  const needs = useMemo(() => (prim ? [] : sourceAssets(layer.source)), [prim, layer.source]);
  const assets = useJsonAssets(needs);

  const model = useMemo<Model3D | null>(() => {
    if (prim) return buildPrimitive(prim);
    if (!assets.ready) return null;
    const raw = resolveRaw(layer.source, { get: assets.get, family, weight });
    if (raw.kind === "missing") console.warn(`[three] could not resolve "${layer.source}", using a circle`);
    // cloner: the model is a silhouette + (for logo-of-logos) a clone shape drawn hundreds of times → draft tessellation
    return buildModel(`${rt.assetBase ?? ""}|${rt.projectId ?? ""}|${layer.source}|${family}|${weight}`, raw, { depth, bevel, tess, draft: mode === "cloner" });
  }, [prim, assets.ready, layer.source, family, weight, depth, bevel, tess, mode, rt.assetBase, rt.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // colors: layer.color > logo part fill > material's natural color > $accent
  const explicit = layer.color ? safeColor(color(layer.color)) : null;
  const fallback = safeColor(NATURAL[material] ?? color("$accent")) ?? new THREE.Color(0.8, 0.8, 0.8);
  const paintKey = model ? model.parts.map((p) => p.fill ?? "").join("|") : "";
  const paints = useMemo<PartPaint[]>(() => {
    if (!model) return [];
    return model.parts.map((p) => {
      if (explicit) return { color: explicit, fromLogo: false, key: `x${explicit.getHexString()}` };
      const c = model.kind === "svg" ? safeColor(p.fill) : null;
      if (c) return { color: c, fromLogo: true, key: `l${c.getHexString()}` };
      return { color: fallback, fromLogo: false, key: `n${fallback.getHexString()}` };
    });
  }, [model, paintKey, explicit?.getHexString(), fallback.getHexString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const glowId = `glow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const glowR = Math.max(3, Math.min(W, H) * 0.01);
  const glow = material === "neon" && !layer.post?.bloom;

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const pw = Math.max(2, Math.round(W * dpr)), ph = Math.max(2, Math.round(H * dpr));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ rig: Rig | null; rigKey: string; post: PostStack | null; postKey: string; gen: number }>({ rig: null, rigKey: "", post: null, postKey: "", gen: -1 });

  // anything that changes the scene graph rebuilds the rig (poses are per frame)
  const rigKey = useMemo(() => {
    if (!model) return "";
    const { x, y, start, duration, animate, enter, exit, keyframes, ...rest } = layer as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    return `${modelId(model)}|${material}|${lighting}|${animation}|${paints.map((p) => p.key).join(",")}|${JSON.stringify(rest)}`;
  }, [model, material, lighting, animation, paints, layer]);

  const bgColor = useMemo(() => {
    if (!layer.background) return null;
    const c = safeColor(color(layer.background));
    if (!c) return null;
    const o = { r: 0, g: 0, b: 0 };
    c.getRGB(o, THREE.SRGBColorSpace);
    return new THREE.Color(o.r, o.g, o.b); // raw sRGB components
  }, [layer.background, color]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!model || !canvas) return;
    const t0 = PERF ? performance.now() : 0;
    const r = getRenderer();
    const s = state.current;
    const gen = rendererGeneration();
    if (s.gen !== gen) {
      // fresh context: GPU resources of the old one are gone
      s.rig = null; s.post = null; s.rigKey = ""; s.postKey = ""; s.gen = gen;
    }
    const resolveColor = (c: string | undefined) => (c ? safeColor(color(c)) : null);
    const software = isSoftwareGL();
    const q = layer.post?.quality ?? "auto";
    const draft = q === "draft" || (q === "auto" && software);
    const post = resolvePost(layer, 1, draft);
    if (!s.rig || s.rigKey !== rigKey + (draft ? "|lite" : "")) {
      s.rig?.dispose();
      s.rig = new Rig(r, { layer, model, paints, material, lighting, animation, color: resolveColor, depthWrite: !!post?.dof, lite: draft });
      s.rigKey = rigKey + (draft ? "|lite" : "");
    }
    const rig = s.rig;
    if (post) post.exposure = rig.exposure;
    const postKey = post ? `${pw}x${ph}|${draft}|${!!post.bloom}|${!!post.dof}` : "";
    if (s.postKey !== postKey) {
      s.post?.dispose();
      s.post = post ? new PostStack(pw, ph, post) : null;
      s.postKey = postKey;
    }
    sizeRenderer(r, pw, ph);
    r.setViewport(0, 0, pw, ph);
    const aspect = W / H;
    rig.update(t, aspect, ph);
    if (!post || !s.post) {
      r.toneMapping = THREE.NeutralToneMapping;
      r.toneMappingExposure = rig.exposure;
      rig.prepass(r);
      r.setRenderTarget(null);
      if (bgColor) r.setClearColor(new THREE.Color().setRGB(bgColor.r, bgColor.g, bgColor.b, THREE.SRGBColorSpace), 1);
      else r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(rig.scene, rig.camera);
      r.setClearColor(0x000000, 0);
    } else {
      s.post.setOpts(post);
      r.toneMapping = THREE.NoToneMapping;
      const fps = rt.fps || 30;
      const focusDist = rig.focusDistance(focusAt(post.focus, t));
      let k = 1;
      if (post.blur) {
        // adaptive: enough sub-frames that consecutive ones are ≤ ~0.3° apart, capped by `samples`
        const deg = rig.motion(t, 1 / fps);
        if (deg > post.blur.threshold) k = Math.min(post.blur.samples, Math.max(3, Math.ceil((deg * post.blur.shutter) / 0.3))) | 1;
      }
      const center = (k - 1) / 2;
      const orderIdx = (i: number) => (i < center ? i : i < k - 1 ? i + 1 : center);
      s.post.render(r, rig.scene, rig.camera, { frame, focusDist, near: rig.camera.near, far: rig.camera.far, background: bgColor }, k, (i, kk) => {
        if (kk > 1) {
          const j = orderIdx(i);
          rig.update(t + ((j / (kk - 1)) - 0.5) * (post.blur!.shutter / fps), aspect, ph);
        }
        rig.prepass(r);
      });
      r.toneMapping = THREE.NeutralToneMapping;
    }
    blit(r, canvas, pw, ph);
    if (PERF) {
      const gl = r.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // wait for the GPU
      console.log(`[perf3d] ${(performance.now() - t0).toFixed(2)}`);
    }
  });

  useEffect(() => () => {
    state.current.rig?.dispose();
    state.current.post?.dispose();
    state.current.rig = null;
    state.current.post = null;
  }, []);

  return (
    <div style={{ position: "relative", width: W, height: H, background: layer.background ? color(layer.background) : undefined, filter: glow ? `url(#${glowId})` : undefined }}>
      {glow ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation={glowR.toFixed(1)} result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation={(glowR * 4).toFixed(1)} result="b2" />
            <feColorMatrix in="b2" type="matrix" values="1.6 0 0 0 0  0 1.6 0 0 0  0 0 1.6 0 0  0 0 0 1.3 0" result="b2s" />
            <feMerge>
              <feMergeNode in="b2s" />
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </svg>
      ) : null}
      {model ? <canvas ref={canvasRef} width={pw} height={ph} style={{ width: W, height: H, display: "block" }} /> : null}
    </div>
  );
};
