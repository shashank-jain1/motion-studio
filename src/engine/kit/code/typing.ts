/**
 * When each character of a code layer appears (seconds after layer start). Human rhythm: jittered keystrokes,
 * auto-indent (leading whitespace lands at once, like an editor), small pauses after punctuation and at line ends.
 * Terminal: the prompt appears, the command is typed, Enter, then its output prints line by line.
 * Pure — the Code component, the sound planner (key clicks) and the linter all use it.
 */
import type { z } from "zod";
import type { CodeLayer } from "../../spec/schema";

export type CodeL = z.infer<typeof CodeLayer>;
export type Schedule = {
  /** time each char index of `code` becomes visible (newlines included) */
  charAt: Float64Array;
  /** first char index of each line, and the time the line starts */
  lineStart: number[]; lineAt: number[];
  /** terminal: Enter presses (seconds) */
  enters: number[];
  /** keystroke times actually typed (for sound) */
  keys: number[];
  end: number;
};

/** Deterministic 0..1 noise per index. */
const rnd = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const isPromptLine = (line: string, prompt: string) => line.trimStart().startsWith(prompt + " ") || line.trimStart() === prompt;

export const typingSchedule = (l: CodeL): Schedule => {
  const code = l.code;
  const n = code.length;
  const charAt = new Float64Array(n);
  const lines = code.split("\n");
  const lineStart: number[] = [];
  const lineAt: number[] = [];
  const enters: number[] = [];
  const keys: number[] = [];
  const reveal = l.reveal ?? "type";
  const terminal = (l.variant ?? "editor") === "terminal";
  const prompt = l.prompt ?? "$";
  let t = reveal === "none" ? 0 : l.typingStart ?? 0.35;
  let idx = 0;

  if (reveal === "none" || reveal === "lines") {
    lines.forEach((line, li) => {
      const at = reveal === "none" ? 0 : t + li * 0.085;
      lineStart.push(idx); lineAt.push(at);
      for (let k = 0; k <= line.length && idx < n; k++, idx++) charAt[idx] = at;
    });
    return { charAt, lineStart, lineAt, enters, keys, end: reveal === "none" ? 0 : t + lines.length * 0.085 };
  }

  const cps = l.speed ?? (terminal ? 40 : 60);
  lines.forEach((line, li) => {
    lineStart.push(idx);
    lineAt.push(t);
    const isCmd = terminal && isPromptLine(line, prompt);
    if (terminal && !isCmd) {
      // output prints at once, a beat after the previous line
      for (let k = 0; k <= line.length && idx < n; k++, idx++) charAt[idx] = t;
      t += line.trim() ? 0.07 : 0.04;
      return;
    }
    let k = 0;
    // leading indentation (and the prompt marker) lands at once
    const lead = isCmd ? line.indexOf(prompt) + prompt.length + 1 : (line.match(/^\s*/)?.[0].length ?? 0);
    for (; k < Math.min(lead, line.length); k++, idx++) charAt[idx] = t;
    if (isCmd) t += 0.28;
    for (; k < line.length; k++, idx++) {
      const ch = line[k];
      let dt = (1 / cps) * (0.55 + 0.9 * rnd(idx));
      if (ch === " ") dt *= 0.7;
      if (/[,;]/.test(line[k - 1] ?? "")) dt += 0.05;
      if (/[{}()[\]]/.test(ch)) dt += 0.02;
      t += dt;
      charAt[idx] = t;
      keys.push(t);
    }
    // the newline itself
    if (idx < n) { charAt[idx] = t; idx++; }
    if (isCmd) { t += 0.32; enters.push(t); t += 0.12; }
    else t += line.trim() ? (/[{([]\s*$/.test(line) ? 0.16 : 0.12) : 0.08;
  });
  return { charAt, lineStart, lineAt, enters, keys, end: t };
};

/** Number of characters visible at time t (charAt is non-decreasing). */
export const visibleCount = (s: Schedule, t: number): number => {
  let lo = 0, hi = s.charAt.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s.charAt[m] <= t) lo = m + 1; else hi = m; }
  return lo;
};

/** Box of a code layer (px): chrome, padding, gutter and line height from the font size; width from the longest line. */
export const codeBox = (l: CodeL) => {
  const fs = l.fontSize ?? 26;
  const lines = l.code.split("\n");
  const variant = l.variant ?? "editor";
  const chrome = variant === "editor" || variant === "terminal" ? fs * 1.85 : 0;
  const pad = variant === "plain" ? 0 : fs * 0.95;
  const gutter = variant === "editor" && l.lineNumbers !== false ? Math.max(2, String(lines.length).length) * fs * 0.6 + fs * 1.3 : 0;
  const lh = fs * 1.55;
  const cols = Math.max(...lines.map((s) => s.length), 10);
  const rows = l.maxLines ? Math.min(lines.length, l.maxLines) : lines.length;
  const w = l.width ?? Math.round(Math.min(1500, pad * 2 + gutter + cols * fs * 0.6 + fs * 1.2));
  const h = l.height ?? Math.round(chrome + pad * 2 + rows * lh);
  return { fs, chrome, pad, gutter, lh, w, h, lines };
};
