/** Default box of a visualizer layer (pure: shared by the component, reflow and the linter). */
export const visualizerBox = (l: { style: string; width?: number; height?: number }) => {
  const round = l.style === "circle" || l.style === "orb";
  return { w: l.width ?? (round ? 640 : 960), h: l.height ?? (round ? 640 : l.style === "dots" ? 380 : 320) };
};
