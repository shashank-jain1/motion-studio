/**
 * SSRF-safe URL download for hosted mode: http(s) only, every hop (redirects included) must resolve to public IP
 * addresses only (loopback / private / link-local / CGNAT / multicast / reserved are refused), the connection is pinned
 * to the vetted address (no DNS-rebinding window), size cap and timeouts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import type { LookupFunction } from "node:net";

const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [
  ["::", 96], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001:db8::", 32], ["2001::", 32], ["2002::", 16],
] as const) blocked.addSubnet(a, p, "ipv6");

/** True for any address that must never be fetched server-side. */
export const isPrivateAddress = (ip: string): boolean => {
  const fam = net.isIP(ip);
  if (fam === 4) return blocked.check(ip, "ipv4");
  // BlockList matches IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:7f00:1) against the IPv4 rules.
  if (fam === 6) return blocked.check(ip, "ipv6");
  return true;
};

const stripBrackets = (h: string) => h.replace(/^\[|\]$/g, "");

/** Resolve a hostname and fail unless every address is public. */
export const resolvePublic = async (hostname: string): Promise<{ address: string; family: number }[]> => {
  const host = stripBrackets(hostname);
  if (!host || /^localhost$/i.test(host) || /\.localhost$/i.test(host)) throw new Error(`Refusing to fetch from ${hostname} (local address)`);
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Refusing to fetch from ${hostname} (private or reserved address)`);
    return [{ address: host, family: net.isIP(host) }];
  }
  const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new Error(`Could not resolve ${hostname}`);
  const bad = addrs.find((a) => isPrivateAddress(a.address));
  if (bad) throw new Error(`Refusing to fetch from ${hostname}: it resolves to a private or reserved address (${bad.address})`);
  return addrs;
};

/** Throws unless `raw` is an http(s) URL whose host resolves only to public addresses. */
export const assertPublicUrl = async (raw: string): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http(s) URLs are supported, got ${url.protocol}`);
  if (url.username || url.password) throw new Error("URLs with credentials are not supported");
  await resolvePublic(url.hostname);
  return url;
};

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/avif": ".avif",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/flac": ".flac",
  "application/json": ".json",
};

export type SafeDownload = { file: string; filename: string; contentType: string; size: number; cleanup: () => void };

/**
 * Download `raw` into a fresh temp dir. `filename` = opts.name ?? URL basename (+ extension from Content-Type when missing).
 * Call `cleanup()` when done with the file.
 */
export const safeDownload = async (
  raw: string,
  opts: { maxBytes: number; timeoutMs?: number; idleMs?: number; name?: string; signal?: AbortSignal; maxRedirects?: number },
): Promise<SafeDownload> => {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 120_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let url = await assertPublicUrl(raw);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-dl-"));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    for (let hop = 0; ; hop++) {
      const addrs = await resolvePublic(url.hostname);
      // Pin the connection to the vetted addresses (the hostname is still used for TLS SNI / Host).
      const lookup: LookupFunction = (_host, options, cb) => {
        const all = (options as { all?: boolean }).all;
        if (all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, addrs);
        else cb(null, addrs[0].address, addrs[0].family);
      };
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const mod = url.protocol === "https:" ? https : http;
        const req = mod.request(url, { method: "GET", lookup, signal, headers: { "user-agent": "MotionStudio/1.0", accept: "*/*" } }, resolve);
        req.setTimeout(opts.idleMs ?? 20_000, () => req.destroy(new Error("Download timed out (no data)")));
        req.on("error", reject);
        req.end();
      });
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= (opts.maxRedirects ?? 5)) throw new Error("Too many redirects");
        url = await assertPublicUrl(new URL(res.headers.location, url).toString());
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new Error(`Download failed: HTTP ${status} for ${url}`);
      }
      const len = Number(res.headers["content-length"] ?? 0);
      if (len > opts.maxBytes) {
        res.destroy();
        throw new Error(`File too large (${len} bytes; limit ${opts.maxBytes})`);
      }
      const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      let filename = (opts.name ?? (() => {
        try {
          return decodeURIComponent(path.posix.basename(url.pathname));
        } catch {
          return path.posix.basename(url.pathname);
        }
      })()).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 100) || `download-${crypto.randomBytes(3).toString("hex")}`;
      if (!path.extname(filename) && EXT_FOR_TYPE[contentType]) filename += EXT_FOR_TYPE[contentType];
      const file = path.join(dir, filename);
      let size = 0;
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(file);
        const fail = (e: Error) => {
          res.destroy();
          out.destroy();
          reject(e);
        };
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) fail(new Error(`Download exceeded ${opts.maxBytes} bytes`));
        });
        res.on("error", fail);
        out.on("error", fail);
        out.on("finish", () => resolve());
        res.pipe(out);
      });
      return { file, filename, contentType, size, cleanup };
    }
  } catch (e) {
    cleanup();
    if (timeout.aborted) throw new Error("Download timed out");
    throw e;
  }
};
