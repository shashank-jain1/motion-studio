/** Prefer a full system FFmpeg; fall back to Remotion's version-pinned binaries for audio/probing. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RenderInternals } from "@remotion/renderer";

const execFileP = promisify(execFile);
export const runMediaTool = async (bin: "ffmpeg" | "ffprobe", args: string[], maxBuffer = 32 * 1024 * 1024): Promise<{ stdout: string; stderr: string }> => {
  try {
    return await execFileP(bin, args, { maxBuffer });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // Remotion is pinned in package.json. Its launcher also supplies the required macOS dylib path.
    const result = await RenderInternals.callFf({ bin, args, indent: false, logLevel: "error", binariesDirectory: null,
      cancelSignal: undefined, options: { maxBuffer } });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  }
};
