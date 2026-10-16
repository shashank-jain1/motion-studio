/** SSE writer that never throws once the client is gone, plus a keep-alive comment every 15s. */
import type { SSEStreamingApi } from "hono/streaming";

export const sseWriter = (stream: SSEStreamingApi, opts: { pingMs?: number } = {}) => {
  let closed = false;
  let chain: Promise<void> = Promise.resolve();
  const closers: (() => void)[] = [];
  stream.onAbort(() => {
    closed = true;
    for (const f of closers.splice(0)) f();
  });
  const ping = setInterval(() => {
    if (!closed) chain = chain.then(() => stream.write(": ping\n\n").then(() => undefined)).catch(() => undefined);
  }, opts.pingMs ?? 15_000);
  return {
    send: (event: string, data: object) => {
      if (closed) return;
      chain = chain.then(() => stream.writeSSE({ event, data: JSON.stringify(data) })).catch(() => {
        closed = true;
      });
    },
    get closed() {
      return closed;
    },
    /** Run `f` when the client disconnects. */
    onClose: (f: () => void) => {
      if (closed) f();
      else closers.push(f);
    },
    flush: async () => {
      clearInterval(ping);
      await chain;
    },
  };
};
