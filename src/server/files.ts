/**
 * Static file responses for /files (project folders) and the built web app: HTTP Range, content types,
 * path-traversal + symlink-escape protection.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".flac": "audio/flac",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".map": "application/json",
  ".html": "text/html; charset=utf-8", ".wasm": "application/wasm",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
};

export const contentType = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * Resolve `rel` (URL-decoded, "/"-separated) inside `root`. Returns null for anything that escapes root
 * (.., absolute paths, NUL bytes, symlinks pointing outside).
 */
export const safeResolve = (root: string, rel: string): string | null => {
  if (rel.includes("\0")) return null;
  const abs = path.resolve(root, "." + path.posix.normalize("/" + rel.replace(/\\/g, "/")));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  } catch {
    /* missing file: the caller 404s */
  }
  return abs;
};

/** Serve a file with Range support. Returns null when it is not a regular file. */
export const fileResponse = (abs: string, req: Request, extraHeaders: Record<string, string> = {}): Response | null => {
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const size = st.size;
  const headers: Record<string, string> = {
    "Content-Type": contentType(abs),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Last-Modified": st.mtime.toUTCString(),
    ...extraHeaders,
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get("range");
  if (range && size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === "" && m[2] === "")) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (m[1] === "") start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  if (req.method === "HEAD" || size === 0) return new Response(null, { status, headers });
  const stream = fs.createReadStream(abs, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
};
