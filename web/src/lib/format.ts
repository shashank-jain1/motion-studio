export const fmtBytes = (n?: number) => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

/** 12.3 → "0:12.3"; with frames → "00:12:09" (mm:ss:ff). */
export const fmtTime = (sec: number, fps?: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  if (fps) {
    const whole = Math.floor(r + 1e-6);
    const f = Math.round((r - whole) * fps) % fps;
    return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  }
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

export const fmtDuration = (sec?: number) => (sec == null ? "" : sec < 60 ? `${+sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`);

export const fmtRelative = (iso?: string) => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const d = (Date.now() - t) / 1000;
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Deterministic, pleasant gradient for a string (placeholder thumbnails). */
export const gradientFor = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = Math.abs(h) % 360;
  const b = (a + 40 + (Math.abs(h >> 8) % 80)) % 360;
  const ang = Math.abs(h >> 4) % 360;
  return `radial-gradient(120% 90% at 20% 10%, hsl(${a} 70% 58% / .55), transparent 60%), radial-gradient(90% 90% at 90% 100%, hsl(${b} 80% 60% / .45), transparent 55%), linear-gradient(${ang}deg, hsl(${a} 35% 14%), hsl(${b} 40% 10%))`;
};

export const basename = (p: string) => p.split("/").pop() ?? p;

export const ASPECT: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "21:9": 21 / 9 };

/** Broadcast timecode HH:MM:SS:FF. */
export const fmtTC = (sec: number, fps = 30) => {
  const total = Math.max(0, Math.round(sec * fps));
  const f = total % fps;
  const s = Math.floor(total / fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
};
/** Short clock for logs: MM:SS. */
export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};
export const RES: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "21:9": [2520, 1080] };
