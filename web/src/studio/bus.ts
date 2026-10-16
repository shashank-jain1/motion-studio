import { useSyncExternalStore } from "react";
import type { PlayerRef } from "@remotion/player";

/**
 * Tiny external store bridging the Remotion Player and everything that follows it (timeline playhead, time readouts).
 * High-frequency consumers (the playhead) subscribe and write to the DOM directly; low-frequency ones use the hooks.
 */
export type SafeMode = "off" | "core" | "title" | "tiktok" | "reels" | "shorts";

export class PlayerBus {
  player: PlayerRef | null = null;
  frame = 0;
  fps = 30;
  durationInFrames = 1;
  playing = false;
  muted = false;
  loop = true;
  /** Shuttle rate (J/K/L): negative plays in reverse. The Player reads it as its playbackRate. */
  rate = 1;
  safe: SafeMode = "off";
  /** Viewer format (null = the film's master format); other formats play the reflowed film. */
  viewFormat: string | null = null;
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
    if (this.rate !== 1) { this.rate = 1; this.emit(); }
    if (p.isPlaying()) p.pause();
    else {
      if (this.frame >= this.durationInFrames - 1) p.seekTo(0);
      p.play();
    }
  };
  /** J/L: start shuttling in `dir`; pressing again in the same direction doubles the speed (1→2→4). */
  shuttle = (dir: 1 | -1) => {
    const p = this.player;
    if (!p) return;
    const same = Math.sign(this.rate) === dir && p.isPlaying();
    this.rate = same ? Math.max(-4, Math.min(4, this.rate * 2)) : dir;
    this.emit();
    if (!p.isPlaying()) {
      if (dir > 0 && this.frame >= this.durationInFrames - 1) p.seekTo(0);
      if (dir < 0 && this.frame <= 0) p.seekTo(this.durationInFrames - 1);
      p.play();
    }
  };
  /** K: stop and reset the shuttle. */
  halt = () => { this.player?.pause(); if (this.rate !== 1) { this.rate = 1; this.emit(); } };
  setMuted = (m: boolean) => { m ? this.player?.mute() : this.player?.unmute(); this.muted = m; this.emit(); };
}

export const useBus = <T,>(bus: PlayerBus, select: (b: PlayerBus) => T): T =>
  useSyncExternalStore(bus.subscribe, () => select(bus));
