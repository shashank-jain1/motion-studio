/**
 * Film clock: the absolute film frame for anything that must line up with the soundtrack (audio-reactive layers).
 * Every Sequence resets useCurrentFrame() to 0, so each level (scene in the TransitionSeries, layer Sequence) adds its
 * own start offset here; filmFrame = offset + useCurrentFrame().
 */
import React, { createContext, useContext } from "react";
import { useCurrentFrame } from "remotion";

const Offset = createContext(0);

export const FilmOffset: React.FC<{ add: number; children: React.ReactNode }> = ({ add, children }) => {
  const parent = useContext(Offset);
  return <Offset.Provider value={parent + add}>{children}</Offset.Provider>;
};

/** Absolute frame on the film timeline (0 = first frame of the video). */
export const useFilmFrame = (): number => useContext(Offset) + useCurrentFrame();
