import { createContext, useContext } from "react";
import type { Layer } from "../spec/schema";

/** Size of the box layers are positioned in (canvas, device screen, group). */
export type ContainerInfo = { width: number; height: number; nested: boolean };
const Ctx = createContext<ContainerInfo>({ width: 1920, height: 1080, nested: false });
export const ContainerProvider = Ctx.Provider;
export const useContainer = () => useContext(Ctx);

/** Camera state of the current scene, used for per-layer parallax. */
export type CameraState = { x: number; y: number; zoom: number };
const CamCtx = createContext<CameraState | null>(null);
export const CameraProvider = CamCtx.Provider;
export const useCamera = () => useContext(CamCtx);

/** Sibling lookup inside one LayerList: another layer's evaluated transform at a list time (seconds from the list start). */
export type Siblings = {
  transformAt: (id: string, listT: number) => { x: number; y: number; scale: number } | null;
  layerOf: (id: string) => { layer: Layer; start: number } | null;
};
const SibCtx = createContext<Siblings>({ transformAt: () => null, layerOf: () => null });
export const SiblingsProvider = SibCtx.Provider;
export const useSiblings = () => useContext(SibCtx);
