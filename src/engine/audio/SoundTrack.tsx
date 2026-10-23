/**
 * The film's audio: music bed (spec.audio) + manual cues (spec.sfx) + auto sound design v2 (planSoundV2, when
 * spec.sound is set and sound.auto !== false). Uses Remotion 4's <Html5Audio> (the renamed, non-deprecated <Audio>).
 *
 * - Planned cues are layered stacks baked into ONE file each ("bake:<recipe>" → `${libraryBase}/bake/<hash>.wav?r=…`,
 *   rendered + cached by the host on first request), so a 4-layer hero still uses a single audio tag and pitch / pan /
 *   reverb are identical in the Player and in renders.
 * - "sfx:<name>" sources resolve under `libraryBase` (library/sfx/<file>); anything else through the asset resolver.
 * - Music stopdowns (MixEvent) before hero moments dip the music by `depth` and bring it back on the hit.
 * - Music ducks under hits: a sidechain-style envelope (80 ms attack before the apex, 120 ms hold, ~0.5 s release)
 *   built from each cue's `duck` depth, applied through the music's volume callback.
 * - Voice allocation: at most MAX_VOICES SFX are mounted at once (the Player has 5 shared audio tags by default and
 *   one is the music). When all voices are busy, the oldest tail is cut with a short fade — never the new hit.
 */
import React, { useEffect, useMemo } from "react";
import { Html5Audio, Sequence, getRemotionEnvironment, interpolate, prefetch, useVideoConfig } from "remotion";
import type { Spec } from "../spec/schema";
import type { SceneSlot } from "../spec/preprocess";
import { planSoundV2, type Cue, type MixEvent } from "./autoSound";
import { defaultLibraryBase, resolveSfx, sfxInfo } from "./library";

const MAX_VOICES = 4;
const EMPTY: Cue[] = [];
const NO_MIX: MixEvent[] = [];
const FADE_FRAMES = 3;

type Voice = { key: string; url: string; from: number; frames: number; trim: number; volume: number; rate?: number; fadeOut: boolean; name: string; priority: number };

const duckFor = (src: string) => {
  const c = sfxInfo(src)?.category.split(".")[0];
  return c === "impact" || c === "sub" ? 0.5 : c === "whoosh" || c === "riser" ? 0.25 : c ? 0.12 : 0.3;
};

/** Music gain multiplier for the pre-hero stopdowns at time t (40 ms fade down, `release` back up after `to`). */
export const stopdownGain = (mix: MixEvent[], t: number) => {
  let g = 1;
  for (const m of mix) {
    if (t < m.from || t > m.to + m.release) continue;
    const down = Math.min(1, (t - m.from) / 0.04);
    const up = t > m.to ? 1 - (t - m.to) / m.release : 1;
    g = Math.min(g, 1 - m.depth * Math.max(0, Math.min(down, up)));
  }
  return g;
};

/** Music gain multiplier at time t (seconds) for the given ducking cues. */
export const duckGain = (cues: Pick<Cue, "peak" | "duck" | "volume">[], t: number) => {
  let g = 1;
  for (const c of cues) {
    if (!c.duck) continue;
    const dt = t - c.peak;
    if (dt < -0.08 || dt > 1.2) continue;
    const env = dt < 0 ? 1 + dt / 0.08 : dt < 0.12 ? 1 : Math.exp(-(dt - 0.12) / 0.17);
    g = Math.min(g, 1 - c.duck * Math.min(1, c.volume * 1.25) * env);
  }
  return Math.max(0.2, g);
};

let warned = false;

/** Shared, ref-counted prefetches (a page may hold a Player plus several Thumbnails of the same film). */
const prefetched = new Map<string, { n: number; free: () => void }>();
const retain = (url: string) => {
  const p = prefetched.get(url);
  if (p) { p.n++; return; }
  const h = prefetch(url, { method: "blob-url" });
  h.waitUntilDone().catch(() => undefined);
  prefetched.set(url, { n: 1, free: h.free });
};
const release = (url: string) => {
  const p = prefetched.get(url);
  if (p && --p.n <= 0) { prefetched.delete(url); p.free(); }
};

export const SoundTrack: React.FC<{
  spec: Spec;
  slots: SceneSlot[];
  total: number;
  asset: (src: string) => string;
  assetBase?: string;
  libraryBase?: string;
}> = ({ spec, slots, total, asset, assetBase, libraryBase }) => {
  const { fps } = useVideoConfig();
  const libBase = libraryBase ?? defaultLibraryBase(assetBase);
  const master = Math.max(0, spec.sound?.volume ?? 0.8);

  const plan = useMemo(
    () => (spec.sound && spec.sound.auto !== false ? planSoundV2(spec, { scenes: slots }, { fps, total }) : null),
    [spec, slots, fps, total],
  );
  const autoCues = plan?.cues ?? EMPTY;
  const mix = spec.sound?.duck === false ? NO_MIX : plan?.mix ?? NO_MIX;

  const { voices, duckCues } = useMemo(() => {
    const manual: Cue[] = (spec.sfx ?? []).map((s, i) => {
      const info = sfxInfo(s.src);
      const rate = s.rate && s.rate > 0 ? s.rate : undefined;
      return {
        src: s.src, at: s.at, volume: s.volume ?? 1, rate, peak: s.at + (info?.peakAt ?? 0) / (rate ?? 1),
        dur: (info?.durationSec ?? 30) / (rate ?? 1), duck: duckFor(s.src), priority: 3, role: "manual", reason: `spec.sfx[${i}]`,
      };
    });
    const all = [...manual, ...autoCues, ...(plan?.bridges ?? [])]
      .map((c) => ({ c, url: resolveSfx(c.src, libBase) ?? null }))
      .filter((x): x is { c: Cue; url: string } => {
        if (x.url !== null) return true;
        if (!warned) { warned = true; console.warn(`[motion-studio] no libraryBase: "sfx:" sounds are skipped (pass libraryBase to SpecVideo)`); }
        return false;
      })
      .map((x) => ({ ...x, url: x.url === x.c.src ? asset(x.c.src) : x.url }))
      .sort((a, b) => a.c.at - b.c.at);

    const out: Voice[] = [];
    const busy: (number | null)[] = Array(MAX_VOICES).fill(null); // index into `out`
    all.forEach(({ c, url }, i) => {
      const start = Math.round(c.at * fps);
      const end = Math.min(Math.round((c.at + c.dur) * fps) + 1, Math.round(total * fps) + 1);
      if (end <= Math.max(0, start)) return;
      const from = Math.max(0, start);
      // free voices whose sound has ended
      for (let v = 0; v < MAX_VOICES; v++) { const o = busy[v]; if (o !== null && out[o].from + out[o].frames <= from) busy[v] = null; }
      let slot = busy.findIndex((b) => b === null);
      if (slot < 0) {
        // A quiet bridge may never interrupt a picture accent. New accents retire a bridge before a foreground tail.
        if (c.role === "bridge") return;
        slot = busy.reduce<number>((best, b, v) => {
          const a = out[b!], p = out[busy[best]!];
          return a.priority < p.priority || (a.priority === p.priority && a.from + a.frames < p.from + p.frames) ? v : best;
        }, 0);
        const victim = out[busy[slot]!];
        victim.frames = Math.max(1, from - victim.from);
        victim.fadeOut = true;
      }
      busy[slot] = out.length;
      out.push({
        key: `${i}-${c.src}-${start}`, url, from, frames: end - from, trim: Math.max(0, from - start) * (c.rate ?? 1),
        volume: Math.max(0, Math.min(1, c.volume * master)), rate: c.rate, fadeOut: false,
        name: `${c.role === "manual" ? "sfx" : "auto"} ${c.src}`,
        priority: c.priority,
      });
    });
    return { voices: out, duckCues: spec.sound?.duck === false ? [] : [...manual, ...autoCues].map((c) => ({ ...c, volume: c.volume * master })) };
  }, [spec, autoCues, plan, libBase, assetBase, fps, total, master]); // eslint-disable-line react-hooks/exhaustive-deps -- `asset` is rebuilt every render; it only depends on assetBase

  // Player: fetch the SFX ahead of time so short hits are not late on first play
  const urls = useMemo(() => [...new Set(voices.map((v) => v.url))], [voices]);
  useEffect(() => {
    if (!getRemotionEnvironment().isPlayer) return;
    urls.forEach(retain);
    return () => urls.forEach(release);
  }, [urls]);

  const a = spec.audio;
  return (
    <>
      {a && (
        <Html5Audio src={asset(a.src)} name="music" trimBefore={a.trimStart ? Math.round(a.trimStart * fps) : undefined}
          volume={(f) => {
            const s = f / fps;
            const fin = a.fadeIn ? interpolate(s, [0, a.fadeIn], [0, 1], { extrapolateRight: "clamp" }) : 1;
            const fout = a.fadeOut ? interpolate(s, [total - a.fadeOut, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
            return Math.max(0, (a.volume ?? 1) * fin * fout * duckGain(duckCues, s) * stopdownGain(mix, s));
          }} />
      )}
      {voices.map((v) => (
        <Sequence key={v.key} from={v.from} durationInFrames={v.frames} layout="none" name={v.name}>
          <Html5Audio src={v.url} playbackRate={v.rate} trimBefore={v.trim > 0 ? Math.round(v.trim) : undefined}
            volume={v.fadeOut ? (f) => v.volume * Math.max(0, Math.min(1, (v.frames - 1 - f) / FADE_FRAMES)) : v.volume}
            onError={(e) => console.warn(`[motion-studio] sound failed to load: ${v.url}: ${e.message}`)} />
        </Sequence>
      ))}
    </>
  );
};
