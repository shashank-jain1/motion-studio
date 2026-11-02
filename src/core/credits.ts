/**
 * Credits a render must publish: the music's attribution when its license requires it (CC BY, Free To Use), written
 * next to the MP4 as <file>.mp4.credits.txt and returned so tools can show it. Nothing is written when no credit is due.
 */
import fs from "node:fs";
import path from "node:path";
import { getProject, readSpec } from "./projects";
import { creditsText, readTrackLicense } from "./musicLibrary";

type AudioCredit = { title?: string; artist?: string; source?: string; license: string; commercial: boolean; attribution?: string; url?: string };

export const filmCredits = (projectId: string): string | null => {
  const spec = readSpec(projectId) as { audio?: { src?: string; credit?: AudioCredit } } | null;
  const a = spec?.audio;
  if (!a?.src) return null;
  const sidecar = /^assets\//.test(a.src) ? readTrackLicense(path.join(getProject(projectId).dir, a.src)) : null;
  const fromSidecar = creditsText(sidecar);
  if (fromSidecar) return fromSidecar;
  return a.credit?.attribution ? a.credit.attribution : null;
};

/** Write <mp4>.credits.txt (or remove a stale one). Never throws. */
export const writeRenderCredits = (projectId: string, mp4Abs: string): string | null => {
  try {
    const text = filmCredits(projectId);
    const f = `${mp4Abs}.credits.txt`;
    if (text) fs.writeFileSync(f, `${text}\n`);
    else if (fs.existsSync(f)) fs.rmSync(f);
    return text;
  } catch (e) {
    console.error(`[motion-studio] credits skipped: ${(e as Error).message}`);
    return null;
  }
};
