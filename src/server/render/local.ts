/** Local backend: the existing renderVideo (headless Chrome + FFmpeg) under the machine-wide render lock. */
import { runRender } from "../../core/tools";
import { toRenderOutput, type RenderBackend } from "./types";

export const localBackend: RenderBackend = {
  name: "local",
  concurrency: 1,
  async render(job, _spec, onProgress, signal) {
    onProgress({ progress: 0, stage: "starting" });
    const { record } = await runRender(job.projectId, {
      quality: job.quality,
      signal,
      onWait: () => onProgress({ progress: 0, stage: "waiting for renderer" }),
      onProgress: (p) => onProgress({ progress: p.progress, stage: p.stage === "muxing" ? "muxing" : "rendering" }),
    });
    return toRenderOutput(job.projectId, record);
  },
};
