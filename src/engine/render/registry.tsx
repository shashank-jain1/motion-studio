/** Maps a layer `type` to its Motion Kit component. */
import React from "react";
import type { Layer } from "../spec/schema";
import { KineticText } from "../kit/KineticText";
import { Media } from "../kit/Media";
import { Shape } from "../kit/Shape";
import { PathDraw } from "../kit/PathDraw";
import { Device } from "../kit/Device";
import { Particles } from "../kit/Particles";
import { ShaderView } from "../kit/Shader";
import { Card } from "../kit/Card";
import { Counter } from "../kit/Counter";
import { Captions } from "../kit/Captions";
import { Cloud } from "../kit/Cloud";
import { LottieView } from "../kit/Lottie";
import { Morph } from "../kit/Morph";
import { Logo } from "../kit/Logo";
import { ThreeView } from "../kit/three";
import { ContainerProvider, useContainer } from "../core/container";
import { CUSTOM } from "../custom";
import { LayerList } from "./LayerList";

const Group: React.FC<{ layer: Extract<Layer, { type: "group" }>; duration: number }> = ({ layer, duration }) => {
  const box = useContainer();
  const w = layer.width ?? box.width;
  const h = layer.height ?? box.height;
  return (
    <div style={{ position: "relative", width: w, height: h, transformStyle: "preserve-3d" }}>
      <ContainerProvider value={{ width: w, height: h, nested: true }}>
        <LayerList layers={layer.layers} sceneDuration={duration} />
      </ContainerProvider>
    </div>
  );
};

const Custom: React.FC<{ layer: Extract<Layer, { type: "custom" }>; t: number; duration: number }> = ({ layer, t, duration }) => {
  const box = useContainer();
  const C = CUSTOM[layer.component];
  if (!C) {
    return <div style={{ color: "#f0f", fontSize: 40, fontFamily: "monospace" }}>Unknown custom component: {layer.component}</div>;
  }
  return <C t={t} duration={duration} width={layer.width ?? box.width} height={layer.height ?? box.height} {...(layer.props ?? {})} />;
};

export const renderLayerContent = (layer: Layer, t: number, duration: number): React.ReactNode => {
  switch (layer.type) {
    case "text": return <KineticText layer={layer} t={t} duration={duration} />;
    case "media": return <Media layer={layer} t={t} duration={duration} />;
    case "shape": return <Shape layer={layer} t={t} duration={duration} />;
    case "path": return <PathDraw layer={layer} t={t} duration={duration} />;
    case "device": return <Device layer={layer} t={t} duration={duration} />;
    case "particles": return <Particles layer={layer} t={t} duration={duration} />;
    case "shader": return <ShaderView layer={layer} t={t} duration={duration} />;
    case "card": return <Card layer={layer} t={t} duration={duration} />;
    case "counter": return <Counter layer={layer} t={t} duration={duration} />;
    case "captions": return <Captions layer={layer} t={t} duration={duration} />;
    case "cloud": return <Cloud layer={layer} t={t} duration={duration} />;
    case "lottie": return <LottieView layer={layer} t={t} duration={duration} />;
    case "group": return <Group layer={layer} duration={duration} />;
    case "custom": return <Custom layer={layer} t={t} duration={duration} />;
    case "morph": return <Morph layer={layer} t={t} duration={duration} />;
    case "logo": return <Logo layer={layer} t={t} duration={duration} />;
    case "three": return <ThreeView layer={layer} t={t} duration={duration} />;
  }
};
