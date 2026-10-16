/**
 * Tiny static file server for PROJECTS_DIR so headless Chrome can load project assets during renders.
 * `/_library/…` serves LIBRARY_DIR (SFX library + baked sound cues, see scripts/gen-sfx.ts / sfx-bake.ts); project ids can't start with "_".
 * 127.0.0.1 only, random port, CORS *, HTTP Range (video seeking), path traversal protection.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { LIBRARY_DIR, PROJECTS_DIR } from "./paths";
import { ensureBaked } from "../../scripts/sfx-bake";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".flac": "audio/flac",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".html": "text/html; charset=utf-8",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
};

export type AssetServer = { port: number; origin: string; baseUrlFor: (projectId: string) => string; /** `${origin}/_library` */ libraryBase: string; close: () => Promise<void> };

let serverPromise: Promise<AssetServer> | null = null;

const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" }).end();
    return;
  }

  let rel: string;
  try {
    rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (rel.includes("\0")) {
    res.writeHead(400).end("Bad request");
    return;
  }
  const lib = rel.startsWith("/_library/");
  // planned sound cues: `/_library/bake/<hash>.wav?r=<recipe>` is rendered on first request (scripts/sfx-bake.ts)
  if (lib && rel.startsWith("/_library/bake/")) {
    try {
      ensureBaked(rel.slice("/_library".length), new URL(req.url ?? "/", "http://x").searchParams);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end(`Bad sound recipe: ${(e as Error).message}`);
      return;
    }
  }
  const root = lib ? LIBRARY_DIR : PROJECTS_DIR;
  const abs = path.resolve(root, "." + path.posix.normalize("/" + (lib ? rel.slice("/_library".length) : rel)));
  if (!abs.startsWith(root + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
    const size = st.size;
    const common = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      "Last-Modified": st.mtime.toUTCString(),
    };

    const range = req.headers.range;
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === "" && m[2] === "")) {
        res.writeHead(416, { ...common, "Content-Range": `bytes */${size}` }).end();
        return;
      }
      if (m[1] === "") {
        // suffix range: last N bytes
        const n = Number(m[2]);
        start = Math.max(0, size - n);
      } else {
        start = Number(m[1]);
        if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
      }
      if (start >= size || start > end) {
        res.writeHead(416, { ...common, "Content-Range": `bytes */${size}` }).end();
        return;
      }
      status = 206;
    }

    const headers: Record<string, string | number> = { ...common, "Content-Length": size === 0 ? 0 : end - start + 1 };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(abs, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
};

/** Start (once) and return the asset server. The server is unref'd so it never keeps a CLI process alive. */
export const startAssetServer = (): Promise<AssetServer> => {
  if (serverPromise) return serverPromise;
  serverPromise = new Promise<AssetServer>((resolve, reject) => {
    const server = http.createServer(handler);
    server.keepAliveTimeout = 5000;
    server.on("error", (e) => {
      serverPromise = null;
      reject(e);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const port = (server.address() as AddressInfo).port;
      const origin = `http://127.0.0.1:${port}`;
      resolve({
        port,
        origin,
        baseUrlFor: (projectId: string) => `${origin}/${encodeURIComponent(projectId)}`,
        libraryBase: `${origin}/_library`,
        close: () =>
          new Promise<void>((r) => {
            serverPromise = null;
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
  return serverPromise;
};
