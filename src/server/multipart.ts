/**
 * Streaming multipart/form-data → files on disk, without buffering uploads in RAM (videos can be hundreds of MB).
 * The raw body is streamed to a temp file, then the boundaries are located by a chunked scan and each file part is
 * copied out by byte range.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type UploadedFile = { field: string; filename: string; contentType?: string; path: string; size: number };
export type MultipartResult = { fields: Record<string, string>; files: UploadedFile[]; cleanup: () => void };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const CHUNK = 1 << 20;

/** Byte offsets of every occurrence of `needle` in the file (chunked scan with overlap). */
const findAll = (fd: number, size: number, needle: Buffer): number[] => {
  const out: number[] = [];
  const buf = Buffer.alloc(CHUNK + needle.length);
  let pos = 0;
  while (pos < size) {
    const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
    if (n <= 0) break;
    const view = buf.subarray(0, n);
    let i = view.indexOf(needle);
    while (i !== -1) {
      const abs = pos + i;
      if (!out.length || out[out.length - 1] !== abs) out.push(abs);
      i = view.indexOf(needle, i + 1);
    }
    if (pos + n >= size) break;
    pos += n - (needle.length - 1);
  }
  return out;
};

const readRange = (fd: number, start: number, len: number): Buffer => {
  const b = Buffer.alloc(Math.max(0, len));
  const n = fs.readSync(fd, b, 0, b.length, start);
  return b.subarray(0, n);
};

const parseDisposition = (h: string): { name?: string; filename?: string } => {
  const name = /\bname="([^"]*)"/i.exec(h)?.[1];
  const filenameStar = /\bfilename\*=(?:UTF-8'')?([^;\r\n]+)/i.exec(h)?.[1];
  const filename = filenameStar ? decodeURIComponent(filenameStar.replace(/^"|"$/g, "")) : /\bfilename="([^"]*)"/i.exec(h)?.[1];
  return { name, filename };
};

export const parseMultipart = async (req: Request, tmpDir: string, opts: { maxBytes: number }): Promise<MultipartResult> => {
  const ctype = req.headers.get("content-type") ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ctype);
  if (!/^multipart\/form-data/i.test(ctype) || !m) throw new HttpError(400, "Expected multipart/form-data with a boundary");
  if (!req.body) throw new HttpError(400, "Empty body");
  const boundary = m[1] ?? m[2];
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > opts.maxBytes) throw new HttpError(413, `Upload too large (limit ${Math.round(opts.maxBytes / 1e6)} MB)`);

  fs.mkdirSync(tmpDir, { recursive: true });
  const id = crypto.randomBytes(6).toString("hex");
  const raw = path.join(tmpDir, `.upload-${id}.raw`);
  const created: string[] = [raw];
  const cleanup = () => {
    for (const f of created) fs.rmSync(f, { force: true });
  };

  try {
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > opts.maxBytes) cb(new HttpError(413, `Upload too large (limit ${Math.round(opts.maxBytes / 1e6)} MB)`));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), limiter, fs.createWriteStream(raw));

    const size = fs.statSync(raw).size;
    const fd = fs.openSync(raw, "r");
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    try {
      const dash = Buffer.from(`--${boundary}`);
      const delim = Buffer.from(`\r\n--${boundary}`);
      // Delimiter positions (pointing at the "--boundary" bytes).
      const positions: number[] = [];
      if (readRange(fd, 0, dash.length).equals(dash)) positions.push(0);
      for (const p of findAll(fd, size, delim)) positions.push(p + 2);
      if (positions.length < 2) throw new HttpError(400, "Malformed multipart body");

      for (let k = 0; k + 1 < positions.length; k++) {
        const partStart = positions[k] + dash.length;
        const after = readRange(fd, partStart, 2).toString("latin1");
        if (after === "--") break; // closing delimiter
        const bodyEnd = positions[k + 1] - 2; // strip the CRLF before the next delimiter
        const headBuf = readRange(fd, partStart + 2, Math.min(16 * 1024, bodyEnd - partStart - 2));
        const sep = headBuf.indexOf("\r\n\r\n");
        if (sep < 0) throw new HttpError(400, "Malformed multipart part headers");
        const headers = headBuf.subarray(0, sep).toString("utf8");
        const dataStart = partStart + 2 + sep + 4;
        const disp = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
        const { name, filename } = parseDisposition(disp);
        if (!name) continue;
        const len = Math.max(0, bodyEnd - dataStart);
        if (filename !== undefined) {
          const out = path.join(tmpDir, `.upload-${id}-${files.length}`);
          created.push(out);
          if (len > 0) await pipeline(fs.createReadStream(raw, { start: dataStart, end: bodyEnd - 1 }), fs.createWriteStream(out));
          else fs.writeFileSync(out, "");
          files.push({ field: name, filename, contentType: /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim(), path: out, size: len });
        } else {
          fields[name] = readRange(fd, dataStart, Math.min(len, 64 * 1024)).toString("utf8");
        }
      }
    } finally {
      fs.closeSync(fd);
      fs.rmSync(raw, { force: true });
    }
    return { fields, files, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
};
