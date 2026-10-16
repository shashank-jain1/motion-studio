import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mockApi } from "./mock-api.ts";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");
const target = `http://127.0.0.1:${process.env.MOTION_STUDIO_PORT ?? 4310}`;
/** `MOCK_API=1 pnpm web` serves a dev-only in-memory API (reads ../projects) when the real server isn't running. */
const useMock = !!process.env.MOCK_API;

// SSE must stream through the proxy: never buffer / compress event streams.
const streaming: ProxyOptions = {
  target,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (req) => req.setHeader("accept-encoding", "identity"));
    proxy.on("proxyRes", (res) => {
      if (String(res.headers["content-type"] ?? "").includes("text/event-stream")) {
        res.headers["cache-control"] = "no-cache, no-transform";
        res.headers["x-accel-buffering"] = "no";
      }
    });
  },
};

// OAuth decision is session-authenticated and CSRF-checked by Origin, so keep the browser's Origin (no changeOrigin).
const proxy: Record<string, ProxyOptions> = {
  "/api": streaming,
  "/files": { target, changeOrigin: true },
  "/library": { target, changeOrigin: true },
  "/templates": { target, changeOrigin: true },
  "/oauth": { target },
  "/mcp": { target },
  "/.well-known": { target },
};

export default defineConfig({
  root: webRoot,
  plugins: [react(), ...(useMock ? [mockApi(repoRoot)] : [])],
  resolve: { dedupe: ["react", "react-dom", "remotion", "@remotion/player", "zod"] },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: useMock ? undefined : proxy,
  },
  preview: { proxy },
  build: { outDir: path.join(webRoot, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
