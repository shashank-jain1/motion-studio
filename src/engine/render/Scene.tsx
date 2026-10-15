import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { CameraMotionBlur } from "@remotion/motion-blur";
import type { Scene } from "../spec/schema";
import { ease, lerp } from "../core/animate";
import { CameraProvider, ContainerProvider } from "../core/container";
import { BackgroundView } from "../kit/Background";
import { FxOverlay } from "../kit/Fx";
import { LayerList } from "./LayerList";

type CamKf = NonNullable<NonNullable<Scene["camera"]>["keyframes"]>[number];
const CAM_PROPS = ["zoom", "x", "y", "rotate", "rotateX", "rotateY"] as const;
const CAM_DEFAULT = { zoom: 1, x: 0, y: 0, rotate: 0, rotateX: 0, rotateY: 0 };

const evalCamera = (kfs: CamKf[] | undefined, t: number) => {
  const out = { ...CAM_DEFAULT };
  if (!kfs?.length) return out;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  for (const prop of CAM_PROPS) {
    const pts = sorted.filter((k) => k[prop] !== undefined);
    if (!pts.length) continue;
    if (t <= pts[0].t) { out[prop] = pts[0][prop]!; continue; }
    const last = pts[pts.length - 1];
    if (t >= last.t) { out[prop] = last[prop]!; continue; }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (t >= a.t && t <= b.t) {
        out[prop] = lerp(a[prop]!, b[prop]!, ease(b.ease, (t - a.t) / Math.max(1e-6, b.t - a.t), "inOutQuint"));
        break;
      }
    }
  }
  return out;
};

const SceneBody: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const cam = evalCamera(scene.camera?.keyframes, t);

  // Zoom punches (beat hits): quick in, smooth settle
  for (const at of scene.camera?.punch ?? []) {
    const dt = t - at;
    if (dt >= 0 && dt < 0.45) cam.zoom *= 1 + 0.09 * Math.exp(-dt * 10) * Math.min(1, dt * 30);
  }
  // Handheld / impact shake
  const sh = scene.camera?.shake;
  if (sh) {
    const s0 = sh.start ?? 0, s1 = s0 + (sh.duration ?? scene.duration);
    if (t >= s0 && t <= s1) {
      const amt = sh.amount ?? 6, sp = sh.speed ?? 3;
      cam.x += noise2D("sx", t * sp, 0) * amt;
      cam.y += noise2D("sy", t * sp, 0) * amt;
      cam.rotate += noise2D("sr", t * sp, 0) * amt * 0.06;
    }
  }

  const rot3d = cam.rotateX || cam.rotateY || cam.rotate
    ? `rotateX(${cam.rotateX}deg) rotateY(${cam.rotateY}deg) rotate(${cam.rotate}deg)` : undefined;
  const bgDepth = 0.15;
  const bgZoom = 1 + (cam.zoom - 1) * bgDepth;

  return (
    <ContainerProvider value={{ width, height, nested: false }}>
    <AbsoluteFill style={{ overflow: "hidden", perspective: scene.camera?.perspective ?? 2200 }}>
      <AbsoluteFill style={{ transform: rot3d, transformStyle: "preserve-3d" }}>
        <AbsoluteFill style={{ transform: `scale(${bgZoom * (rot3d ? 1.15 : 1)}) translate(${-cam.x * bgDepth}px, ${-cam.y * bgDepth}px)` }}>
          <BackgroundView bg={scene.background} t={t} duration={scene.duration} />
        </AbsoluteFill>
        <CameraProvider value={{ x: cam.x, y: cam.y, zoom: cam.zoom }}>
          <LayerList layers={scene.layers} sceneDuration={scene.duration} />
        </CameraProvider>
      </AbsoluteFill>
      <FxOverlay fx={scene.fx} t={t} duration={scene.duration} />
    </AbsoluteFill>
    </ContainerProvider>
  );
};

export const SceneView: React.FC<{ scene: Scene }> = ({ scene }) => {
  const mb = scene.motionBlur;
  if (!mb) return <SceneBody scene={scene} />;
  const o = typeof mb === "object" ? mb : {};
  return (
    <CameraMotionBlur samples={o.samples ?? 6} shutterAngle={o.shutter ?? 180}>
      <SceneBody scene={scene} />
    </CameraMotionBlur>
  );
};
