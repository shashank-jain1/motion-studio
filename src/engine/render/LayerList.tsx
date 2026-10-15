import React, { useId, useMemo } from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import type { Layer } from "../spec/schema";
import { type Stretch, type Transform, toCssTransform } from "../core/animate";
import {
  type PhysicsCtx, REPEAT_DEFAULT_DELAY, buildLayerIndex, computeLayerTransform, layerVelocity, quantizeTime,
  repeatCopy, resolveVelocityFx, velocityLook,
} from "../core/physics";
import { SHADOW_PREMIUM, useColor } from "../core/context";
import { useCamera, useContainer } from "../core/container";
import { renderLayerContent } from "./registry";

type Index = ReturnType<typeof buildLayerIndex>;
type HostProps = { layer: Layer; duration: number; index: number; start: number; layerIndex: Index };

/** Repeat copies beyond this many don't get their own velocity blur (each blur is a filter pass). */
const MAX_BLURRED_COPIES = 6;

type InstanceProps = {
  layer: Layer;
  tr: Transform;
  /** content time (already stepRate-quantized) */
  t: number;
  duration: number;
  /** directional velocity blur: sigma px along angle deg (screen space) */
  vblur?: { angle: number; sigma: number };
  stretch?: Stretch;
  fid: string;
  /** repeat copies: skip rendering content while fully transparent */
  isCopy?: boolean;
};

/**
 * One rendered copy of a layer.
 *   vblur wrapper (rotated by the motion angle, SVG blur along its local x) → counter-rotated perspective box → transformed layer.
 * The wrappers are always present (stable DOM, no remounts); they only get a transform/filter while moving fast.
 */
const LayerInstance: React.FC<InstanceProps> = ({ layer, tr, t, duration, vblur, stretch, fid, isCopy }) => {
  const color = useColor();

  const filters: string[] = [];
  const presetDir = tr.dirBlurX > 0.5 || tr.dirBlurY > 0.5;
  if (presetDir) filters.push(`url(#db${fid})`);
  if (tr.blur > 0.05) filters.push(`blur(${tr.blur}px)`);
  if (layer.shadow) {
    filters.push(typeof layer.shadow === "string" && layer.shadow.startsWith("drop-shadow") ? color(layer.shadow) : "drop-shadow(0 18px 30px rgba(0,0,0,0.22)) drop-shadow(0 4px 8px rgba(0,0,0,0.12))");
  }
  const boxShadow = typeof layer.shadow === "string" && !layer.shadow.startsWith("drop-shadow") ? (layer.shadow === "premium" ? SHADOW_PREMIUM : color(layer.shadow)) : undefined;

  const inner: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: layer.width ?? "max-content",
    height: layer.height,
    transform: `translate(-50%, -50%) ${toCssTransform(tr, stretch)}`,
    transformOrigin: layer.origin ?? "50% 50%",
    transformStyle: "preserve-3d",
    opacity: Math.max(0, Math.min(1, tr.opacity)),
    filter: filters.length ? filters.join(" ") : undefined,
    clipPath: tr.clip,
    mixBlendMode: layer.blendMode as React.CSSProperties["mixBlendMode"],
    boxShadow,
    ...((layer.css ?? {}) as React.CSSProperties),
  };

  const perspective = layer.type === "group" ? (layer.perspective ?? 1600) : 2000;
  const vb = vblur && vblur.sigma > 0.25 && !presetDir ? vblur : undefined;
  // Skip invisible copies' content work entirely (the original always renders: stable mounts for media/lottie)
  const visible = !isCopy || tr.opacity > 0.001;

  return (
    <>
      {(presetDir || vb) && (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          {presetDir && (
            <filter id={`db${fid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={`${tr.dirBlurX} ${tr.dirBlurY}`} />
            </filter>
          )}
          {vb && (
            <filter id={`vb${fid}`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={`${vb.sigma.toFixed(2)} 0`} />
            </filter>
          )}
        </svg>
      )}
      <div style={{ position: "absolute", inset: 0, transform: vb ? `rotate(${vb.angle}deg)` : undefined, filter: vb ? `url(#vb${fid})` : undefined }}>
        <div style={{ position: "absolute", inset: 0, perspective, transform: vb ? `rotate(${-vb.angle}deg)` : undefined }}>
          <div style={inner}>{visible ? renderLayerContent(layer, t, duration) : null}</div>
        </div>
      </div>
    </>
  );
};

const LayerInner: React.FC<HostProps> = ({ layer, duration, index, start, layerIndex }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cam = useCamera();
  const box = useContainer();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const ctx: PhysicsCtx = { fps, start, resolve: layerIndex.hasCycle(layer.id) ? undefined : layerIndex.resolve };
  const vfx = resolveVelocityFx(layer.velocityFx);
  const rep = layer.repeat;
  const count = Math.max(1, Math.floor(rep?.count ?? 1));
  const delay = rep?.delay ?? REPEAT_DEFAULT_DELAY;

  // Copies first (behind), original last (on top).
  const instances: React.ReactNode[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ti = t - i * delay;
    let tr = computeLayerTransform(layer, ti, duration, ctx);
    let vblur: InstanceProps["vblur"];
    let stretch: Stretch | undefined;
    if (vfx && (i === 0 || count <= MAX_BLURRED_COPIES)) {
      const v = layerVelocity(layer, ti, duration, ctx, tr);
      const look = velocityLook(v.dx, v.dy, vfx);
      if (look.sigma > 0) vblur = { angle: look.angle, sigma: look.sigma };
      stretch = look.stretch;
    }
    if (i > 0 && rep) tr = repeatCopy(rep, i, tr);
    instances.push(
      <LayerInstance key={i} layer={layer} tr={tr} t={quantizeTime(ti, layer.stepRate)} duration={duration} vblur={vblur} stretch={stretch} fid={`${uid}_${i}`} isCopy={i > 0} />,
    );
  }

  // Camera parallax (top-level scene layers only) -------------------------------
  let camStyle: React.CSSProperties | undefined;
  if (cam && !box.nested) {
    const depth = layer.depth ?? 1;
    const zoom = 1 + (cam.zoom - 1) * depth;
    camStyle = { transform: `scale(${zoom}) translate(${-cam.x * depth}px, ${-cam.y * depth}px)`, transformOrigin: "50% 50%" };
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: layer.zIndex ?? index, pointerEvents: "none", ...camStyle }}>
      {instances}
    </div>
  );
};

const LayerHost: React.FC<HostProps> = (props) => {
  const mb = props.layer.motionBlur;
  const body = <LayerInner {...props} />;
  if (!mb) return body;
  const opts = typeof mb === "object" ? mb : {};
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: props.layer.zIndex ?? props.index }}>
      <CameraMotionBlur samples={opts.samples ?? 8} shutterAngle={opts.shutter ?? 220}>{body}</CameraMotionBlur>
    </div>
  );
};

/**
 * Renders a list of layers, each in its own Sequence so its local frame 0 = its `start`.
 * `sceneDuration` (seconds) bounds layers without an explicit duration.
 * Layers may parent to siblings by id (`parent` + `lag`); cycles are detected and ignored.
 */
export const LayerList: React.FC<{ layers: Layer[]; sceneDuration?: number }> = ({ layers, sceneDuration }) => {
  const { fps } = useVideoConfig();
  const durationOf = (layer: Layer) => {
    const start = layer.start ?? 0;
    return layer.duration ?? (sceneDuration !== undefined ? Math.max(0.05, sceneDuration - start) : 3600);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layerIndex = useMemo(() => buildLayerIndex(layers, durationOf), [layers, sceneDuration]);
  return (
    <>
      {layers.map((layer, i) => {
        const start = layer.start ?? 0;
        const dur = durationOf(layer);
        return (
          <Sequence key={layer.id ?? i} from={Math.round(start * fps)} durationInFrames={Math.max(1, Math.round(dur * fps))} layout="none" name={layer.id ?? `${layer.type}-${i}`}>
            <LayerHost layer={layer} duration={dur} index={i} start={start} layerIndex={layerIndex} />
          </Sequence>
        );
      })}
    </>
  );
};
