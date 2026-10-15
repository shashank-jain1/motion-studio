import React, { useId } from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import type { Layer } from "../spec/schema";
import { type EaseName, combine, evalKeyframes, loopTransform, presetTransform, progress, toCssTransform } from "../core/animate";
import { SHADOW_PREMIUM, useColor } from "../core/context";
import { useCamera, useContainer } from "../core/container";
import { renderLayerContent } from "./registry";

type HostProps = { layer: Layer; duration: number; index: number };

const ENTER_DEFAULT_EASE: Record<string, EaseName> = { pop: "outBack", "drop-bounce": "outBounce", swing: "spring", "spin-in": "outBack" };

const LayerInner: React.FC<HostProps> = ({ layer, duration, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const color = useColor();
  const cam = useCamera();
  const box = useContainer();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Enter / exit ----------------------------------------------------------------
  let enter = {};
  if (layer.enter && layer.enter.type !== "none") {
    const e = layer.enter;
    const p = progress(t, e.delay ?? 0, e.duration ?? 0.6, e.ease, ENTER_DEFAULT_EASE[e.type] ?? "outQuint");
    enter = presetTransform(e.type, 1 - p, e.distance, 1);
  }
  let exit = {};
  if (layer.exit && layer.exit.type !== "none") {
    const e = layer.exit;
    const d = e.duration ?? 0.5;
    const start = duration - d - (e.delay ?? 0);
    const p = progress(t, start, d, e.ease, "in");
    exit = presetTransform(e.type, p, e.distance, -1);
  }

  const base = {
    x: layer.x ?? 0, y: layer.y ?? 0, z: layer.z ?? 0, scale: layer.scale ?? 1,
    rotate: layer.rotate ?? 0, rotateX: layer.rotateX ?? 0, rotateY: layer.rotateY ?? 0,
    opacity: layer.opacity ?? 1, blur: layer.blur ?? 0,
  };
  const tr = combine(base, evalKeyframes(layer.animate, t), loopTransform(layer.loop, t), enter, exit);

  // Camera parallax (top-level scene layers only) -------------------------------
  let camStyle: React.CSSProperties | undefined;
  if (cam && !box.nested) {
    const depth = layer.depth ?? 1;
    const zoom = 1 + (cam.zoom - 1) * depth;
    camStyle = { transform: `scale(${zoom}) translate(${-cam.x * depth}px, ${-cam.y * depth}px)`, transformOrigin: "50% 50%" };
  }

  const filters: string[] = [];
  const dir = tr.dirBlurX > 0.5 || tr.dirBlurY > 0.5;
  if (dir) filters.push(`url(#db${uid})`);
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
    transform: `translate(-50%, -50%) ${toCssTransform(tr)}`,
    transformOrigin: layer.origin ?? "50% 50%",
    transformStyle: "preserve-3d",
    opacity: Math.max(0, Math.min(1, tr.opacity)),
    filter: filters.length ? filters.join(" ") : undefined,
    clipPath: tr.clip,
    mixBlendMode: layer.blendMode as React.CSSProperties["mixBlendMode"],
    boxShadow,
    ...((layer.css ?? {}) as React.CSSProperties),
  };

  const content = renderLayerContent(layer, t, duration);
  const perspective = layer.type === "group" ? (layer.perspective ?? 1600) : 2000;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: layer.zIndex ?? index, pointerEvents: "none", perspective, ...camStyle }}>
      {dir && (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={`db${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={`${tr.dirBlurX} ${tr.dirBlurY}`} />
          </filter>
        </svg>
      )}
      <div style={inner}>{content}</div>
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
 */
export const LayerList: React.FC<{ layers: Layer[]; sceneDuration?: number }> = ({ layers, sceneDuration }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {layers.map((layer, i) => {
        const start = layer.start ?? 0;
        const dur = layer.duration ?? (sceneDuration !== undefined ? Math.max(0.05, sceneDuration - start) : 3600);
        return (
          <Sequence key={layer.id ?? i} from={Math.round(start * fps)} durationInFrames={Math.max(1, Math.round(dur * fps))} layout="none" name={layer.id ?? `${layer.type}-${i}`}>
            <LayerHost layer={layer} duration={dur} index={i} />
          </Sequence>
        );
      })}
    </>
  );
};
