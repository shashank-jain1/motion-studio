import { useSyncExternalStore } from "react";
import type { PlayerRef } from "@remotion/player";

/**
 * Tiny external store bridging the Remotion Player and everything that follows it (timeline playhead, time readouts).
 * High-frequency consumers (the playhead) subscribe and write to the DOM directly; low-frequency ones use the hooks.
 */
export class PlayerBus {
  player: PlayerRef | null = null;
  frame = 0;
  fps = 30;
  durationInFrames = 1;
  playing = false;
  muted = false;
  loop = true;
  private subs = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  emit = () => { this.version++; this.subs.forEach((f) => f()); };
  getVersion = () => this.version;

  seek = (frame: number) => {
    const f = Math.max(0, Math.min(this.durationInFrames - 1, Math.round(frame)));
    this.frame = f;
    this.player?.seekTo(f);
    this.emit();
  };
  step = (delta: number) => { this.player?.pause(); this.seek(this.frame + delta); };
  toggle = () => {
    const p = this.player;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else {
      if (this.frame >= this.durationInFrames - 1) p.seekTo(0);
      p.play();
    }
  };
  setMuted = (m: boolean) => { m ? this.player?.mute() : this.player?.unmute(); this.muted = m; this.emit(); };
}

export const useBus = <T,>(bus: PlayerBus, select: (b: PlayerBus) => T): T =>
  useSyncExternalStore(bus.subscribe, () => select(bus));
