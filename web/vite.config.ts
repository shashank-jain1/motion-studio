import fs from "node:fs";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
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

/**
 * The product site plays the starter templates without the API (it must work while the server is down), so their public
 * files (poster.jpg, glyphs.json, assets/*: the same set /templates/<slug>/* serves) ship with the web app under
 * /site/templates/<slug>/. Specs and metadata are bundled by web/src/site/films.ts.
 */
const siteTemplates = (): Plugin => {
  const root = path.join(repoRoot, "templates");
  const files = () => fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
    const dir = path.join(root, d.name);
    const assets = fs.existsSync(path.join(dir, "assets")) ? fs.readdirSync(path.join(dir, "assets")).map((f) => `assets/${f}`) : [];
    return ["poster.jpg", "glyphs.json", ...assets].filter((rel) => fs.existsSync(path.join(dir, rel))).map((rel) => `${d.name}/${rel}`);
  });
  return {
    name: "site-templates",
    configureServer(server) {
      server.middlewares.use("/site/templates/", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!files().includes(rel)) return next();
        res.setHeader("Content-Type", rel.endsWith(".jpg") ? "image/jpeg" : rel.endsWith(".svg") ? "image/svg+xml" : "application/json");
        fs.createReadStream(path.join(root, rel)).pipe(res);
      });
    },
    generateBundle() {
      for (const rel of files()) this.emitFile({ type: "asset", fileName: `site/templates/${rel}`, source: fs.readFileSync(path.join(root, rel)) });
    },
  };
};

export default defineConfig({
  root: webRoot,
  plugins: [react(), siteTemplates(), ...(useMock ? [mockApi(repoRoot)] : [])],
  resolve: { dedupe: ["react", "react-dom", "remotion", "@remotion/player", "zod"] },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    fs: { allow: [repoRoot] },
    proxy: useMock ? undefined : proxy,
  },
  preview: { proxy },
  build: { outDir: path.join(webRoot, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
