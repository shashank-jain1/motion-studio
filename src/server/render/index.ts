/** Backend selection: RENDER_BACKEND=lambda → Lambda (fails fast when unconfigured), else local. */
import { RENDER_BACKEND, type BackendName } from "../config";
import { localBackend } from "./local";
import { lambdaBackend, lambdaConfigError } from "./lambda";
import type { RenderBackend } from "./types";

export type { RenderBackend, RenderInfo, RenderOutput, RenderProgressUpdate, RenderJob } from "./types";
export { lambdaConfigError } from "./lambda";

export const BACKENDS: Record<BackendName, RenderBackend> = { local: localBackend, lambda: lambdaBackend };

/** Backend new jobs go to. */
export const defaultBackend = (): BackendName => RENDER_BACKEND;

/** null when the backend can take jobs, else a human reason. */
export const backendError = (name: BackendName): string | null => (name === "lambda" ? lambdaConfigError() : null);
