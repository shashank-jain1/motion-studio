import React from "react";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { SpecVideo, parseSpec, resolveSize, specSeconds, type SpecVideoProps } from "./render/SpecVideo";
import { DEMO_SPEC } from "./demo-spec";

const calculateMetadata: CalculateMetadataFunction<SpecVideoProps> = async ({ props }) => {
  // Studio mode: `projectId` without `assetBase` → load projects/<id>/spec.json via --public-dir=projects
  if (props.projectId && !props.assetBase) {
    const res = await fetch(staticFile(`${props.projectId}/spec.json`) + `?t=${Date.now()}`);
    if (res.ok) props = { ...props, spec: await res.json() };
  }
  try {
    const spec = parseSpec(props.spec);
    const { width, height } = resolveSize(spec);
    return { props, width, height, fps: spec.fps, durationInFrames: Math.max(1, Math.round(specSeconds(spec) * spec.fps)) };
  } catch {
    return { props, width: 1920, height: 1080, fps: 30, durationInFrames: 90 };
  }
};

export const Root: React.FC = () => (
  <Composition
    id="Spec"
    component={SpecVideo}
    defaultProps={{ spec: DEMO_SPEC } as SpecVideoProps}
    calculateMetadata={calculateMetadata}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={300}
  />
);
