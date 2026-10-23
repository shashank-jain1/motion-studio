/**
 * Loudness mastering for finished renders: measure the mix (EBU R128 integrated loudness + true peak) and apply one
 * static gain toward −14 LUFS (social / streaming master), never pushing the true peak above −1 dBTP. A plain gain —
 * no compression or limiting — so the SFX transients and the music's dynamics are kept. Video is stream-copied.
 */
import fs from "node:fs";
import { runMediaTool } from "./mediaTool";

export const MASTER_LUFS = -14;
const CEILING_DBTP = -1;

export type MasterResult = { input: number; truePeak: number; gainDb: number; applied: boolean } | null;

/** Measure integrated loudness (LUFS) and true peak (dBTP) of a media file's audio, or null when it has none. */
export const measureLoudness = async (file: string): Promise<{ lufs: number; truePeak: number } | null> => {
  const { stdout } = await runMediaTool("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  if (!stdout.trim()) return null;
  // loudnorm reports EBU R128 input measurements and exists in both full and Remotion's reduced FFmpeg builds.
  // This pass measures only: its processed output is discarded; mastering below still applies a single static gain.
  const { stderr } = await runMediaTool("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"]);
  const summary = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
  if (!summary) throw new Error("FFmpeg did not return loudness measurements");
  const measured = JSON.parse(summary) as { input_i: string; input_tp: string };
  const lufs = Number(measured.input_i), truePeak = Number(measured.input_tp);
  if (!Number.isFinite(lufs)) return null;
  return { lufs, truePeak: Number.isFinite(truePeak) ? truePeak : -Infinity };
};

/** Normalize the audio of `file` in place toward −14 LUFS (true-peak safe). Never throws: failures leave the file as is. */
export const masterLoudness = async (file: string): Promise<MasterResult> => {
  try {
    const m = await measureLoudness(file);
    if (!m || m.lufs <= -60) return null; // no audio / silence
    const gainDb = Math.round(Math.min(Math.max(MASTER_LUFS - m.lufs, -12), 9, CEILING_DBTP - m.truePeak) * 10) / 10;
    if (Math.abs(gainDb) < 0.5) return { input: m.lufs, truePeak: m.truePeak, gainDb, applied: false };
    const tmp = file.replace(/\.mp4$/i, "") + `.master-${process.pid}.mp4`;
    await runMediaTool("ffmpeg", [
      "-v", "error", "-y", "-i", file, "-map", "0", "-c:v", "copy", "-af", `volume=${gainDb}dB`,
      "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", tmp,
    ], 16 * 1024 * 1024);
    fs.renameSync(tmp, file);
    return { input: m.lufs, truePeak: m.truePeak, gainDb, applied: true };
  } catch (e) {
    console.error(`[motion-studio] loudness mastering skipped: ${(e as Error).message.split("\n")[0]}`);
    return null;
  }
};
