import React from "react";
import type { z } from "zod";
import type { ShaderLayer } from "../spec/schema";
import { useColor } from "../core/context";
import { useContainer } from "../core/container";
import { ShaderCanvas } from "./ShaderCanvas";

type Props = { layer: z.infer<typeof ShaderLayer>; t: number; duration: number };

/** Palette convention: [accent A, accent B, base/backdrop, highlight]. */
export const DEFAULT_SHADER_COLORS = ["$accent", "$accent2", "$bg", "$fg"];

/** A shader layer: a GPU-rendered animated field sized to the layer (or its container). */
export const ShaderView: React.FC<Props> = ({ layer, t }) => {
  const color = useColor();
  const box = useContainer();
  const W = layer.width ?? box.width;
  const H = layer.height ?? box.height;
  const colors = (layer.colors?.length ? layer.colors : DEFAULT_SHADER_COLORS).map((c) => color(c));
  return (
    <ShaderCanvas
      shader={layer.shader}
      colors={colors}
      speed={layer.speed}
      intensity={layer.intensity}
      width={W}
      height={H}
      t={t}
    />
  );
};
