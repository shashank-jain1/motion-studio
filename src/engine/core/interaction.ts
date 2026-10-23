/** Pure, seek-safe interaction state. Interrupted moves start at their current value, without jumping. */
export type ToggleState = { at: number; on: boolean };
export const interactionFrame = (at: number, fps: number) => Math.ceil(at * fps - 1e-8) / fps;
export const toggleAt = (states: ToggleState[], t: number, initial = false, duration = 0.28): number => {
  const d = Math.max(0.001, duration);
  let from = initial ? 1 : 0, target = from, start = -Infinity;
  const value = (time: number) => {
    const u = Math.max(0, Math.min(1, (time - start) / d));
    return from + (target - from) * (u * u * (3 - 2 * u));
  };
  for (const state of [...states].sort((a, b) => a.at - b.at)) {
    if (state.at > t) break;
    from = value(state.at); target = state.on ? 1 : 0; start = state.at;
  }
  return value(t);
};

export const clickAt = (clicks: number[], t: number) => {
  const elapsed = clicks.filter((at) => at <= t).map((at) => t - at);
  const dt = elapsed.length ? Math.min(...elapsed) : Infinity;
  return { press: Math.max(0, 1 - dt / 0.16), ripple: dt < 0.45 ? dt / 0.45 : null };
};
