/**
 * Code on screen the way it looks in a modern editor: window chrome with a file tab (or a shell title), line numbers,
 * syntax colors, human typing with a caret, auto-scroll that follows the caret, focus beats that light lines and dim
 * the rest, +/- diff rows, and terminal sessions (typed commands, printed output, ✓ / ✗ lines tinted).
 */
import React, { useMemo } from "react";
import { clamp01, ease, lerp, progress } from "../core/animate";
import { useColor, useFont } from "../core/context";
import { alpha, isDark } from "./surface";
import { CODE_THEME, LANG_DOT, LANG_EXT, tokenize, type CodeTheme, type Token } from "./code/highlight";
import { codeBox, isPromptLine, typingSchedule, visibleCount, type CodeL } from "./code/typing";

type Props = { layer: CodeL; t: number; duration: number };

const GREEN = "#3ddc84", RED = "#ff6b6b", AMBER = "#f5c26b";

/** Which focus beat(s) light a line: crossfaded levels (0..1). */
const focusOf = (l: CodeL, t: number) => {
  const beats = [...(l.focus ?? [])].sort((a, b) => a.at - b.at);
  return beats.map((f, i) => {
    const end = f.until ?? beats[i + 1]?.at ?? Infinity;
    const a = clamp01((t - f.at) / 0.3), b = end === Infinity ? 1 : 1 - clamp01((t - end) / 0.3);
    const lines = new Set<number>();
    const ls = f.lines;
    if (ls.length === 2 && ls[1] > ls[0] + 1) for (let k = ls[0]; k <= ls[1]; k++) lines.add(k);
    else ls.forEach((k) => lines.add(k));
    return { lines, level: ease("inOut", a * b), color: f.color };
  });
};

export const Code: React.FC<Props> = ({ layer: l, t }) => {
  const color = useColor();
  const font = useFont();
  const variant = l.variant ?? "editor";
  const terminal = variant === "terminal";
  const lang = l.language ?? (terminal ? "bash" : "ts");
  const dark = isDark(color("$bg"));
  const themeName = l.theme && l.theme !== "auto" ? l.theme : dark ? "midnight" : "dawn";
  const th: CodeTheme = CODE_THEME[themeName];
  const box = codeBox(l);
  const { fs, chrome, pad, gutter, lh, w: W, h: H, lines } = box;
  const mono = font(l.font, "mono");
  const ui = font(undefined, "body");
  const prompt = l.prompt ?? "$";
  const diff = l.diff || lang === "diff";

  const sched = useMemo(() => typingSchedule(l), [l]);
  // terminal: highlight commands as bash and leave output plain
  const toks = useMemo<Token[][]>(() => {
    if (!terminal) return tokenize(l.code, lang === "diff" ? "text" : lang);
    return lines.map((line) => (isPromptLine(line, prompt) ? tokenize(line.slice(line.indexOf(prompt) + prompt.length), "bash")[0] ?? [] : [{ text: line, kind: "plain" }]));
  }, [l.code, lang, terminal, prompt, diff]); // eslint-disable-line react-hooks/exhaustive-deps

  const vis = visibleCount(sched, t);
  // caret: after the last visible char (a typed newline puts it at the start of the next line)
  let caretLine = 0;
  for (let i = 0; i < sched.lineStart.length; i++) if (sched.lineStart[i] <= vis) caretLine = i;
  const caretCol = Math.max(0, Math.min(lines[caretLine]?.length ?? 0, vis - (sched.lineStart[caretLine] ?? 0)));
  const typing = vis > 0 && vis < l.code.length;
  const lastKey = vis > 0 ? sched.charAt[Math.min(l.code.length - 1, vis - 1)] : 0;
  const idle = t - lastKey > 0.45;
  const caretOn = (l.caret ?? true) && (l.reveal ?? "type") === "type" && (!idle || Math.floor((t - lastKey) * 1.9) % 2 === 0);

  // scroll so the caret line stays in view (smoothly, line by line)
  const bodyH = H - chrome - pad * 2;
  const rows = Math.max(1, Math.floor((bodyH + 1) / lh)); // +1px: the auto height is rounded, it must still hold all its rows (no phantom scroll)
  const maxScroll = Math.max(0, (lines.length - rows) * lh);
  const target = (li: number) => Math.max(0, Math.min(maxScroll, (li - Math.floor(rows * 0.72) + 1) * lh));
  const lineEnter = sched.lineAt[caretLine] ?? 0;
  const scroll = lerp(target(Math.max(0, caretLine - 1)), target(caretLine), progress(t, lineEnter, 0.28, "inOut"));

  const beats = focusOf(l, t);
  const anyFocus = Math.max(0, ...beats.map((b) => b.level));
  const lit = (ln: number) => Math.max(0, ...beats.filter((b) => b.lines.has(ln)).map((b) => b.level));
  const litColor = (ln: number) => beats.find((b) => b.lines.has(ln) && b.color)?.color;

  const shell: React.CSSProperties = variant === "plain" ? {} : {
    background: variant === "card" ? alpha(th.bg, 0.78) : th.bg,
    border: `1px solid ${th.border}`, borderRadius: fs * 0.62, overflow: "hidden",
    boxShadow: `inset 0 1px 0 ${alpha("#ffffff", dark ? 0.06 : 0.6)}, 0 40px 90px -40px rgba(0,0,0,${dark ? 0.75 : 0.28}), 0 30px 120px -50px ${alpha(color("$accent"), 0.35)}`,
    ...(variant === "card" ? { backdropFilter: "blur(20px) saturate(140%)", WebkitBackdropFilter: "blur(20px) saturate(140%)" } : {}),
  };

  return (
    <div style={{ position: "relative", width: W, height: H, ...shell }}>
      {(variant === "editor" || terminal) && <Chrome l={l} th={th} fs={fs} h={chrome} ui={ui} mono={mono} lang={lang} terminal={terminal} />}
      <div style={{ position: "absolute", left: 0, right: 0, top: chrome, bottom: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: pad - scroll, fontFamily: mono, fontSize: fs, lineHeight: `${lh}px`, whiteSpace: "pre", color: th.fg, fontVariantLigatures: "contextual" }}>
          {lines.map((line, li) => {
            const start = sched.lineStart[li] ?? 0;
            const shownN = Math.max(0, Math.min(line.length, vis - start));
            const reveal = l.reveal ?? "type";
            const lineIn = reveal === "lines" ? progress(t, sched.lineAt[li] ?? 0, 0.4, "expoOut") : 1;
            if (reveal === "type" && vis < start) return null;
            if (reveal === "lines" && t < (sched.lineAt[li] ?? 0)) return null;
            const ln = li + 1;
            const lv = lit(ln);
            const sign = diff ? line[0] : "";
            const rowBg = diff && sign === "+" ? alpha(GREEN, 0.11) : diff && sign === "-" ? alpha(RED, 0.11) : lv > 0 ? alpha(litColor(ln) ? color(litColor(ln)) : th.caret, 0.12 * lv) : caretLine === li && typing && variant === "editor" ? th.line : "transparent";
            const isCmd = terminal && isPromptLine(line, prompt);
            const outTint = terminal && !isCmd ? outputColor(line, th) : undefined;
            const dim = 1 - anyFocus * 0.62 * (1 - lv);
            return (
              <div key={li} style={{ position: "relative", height: lh, background: rowBg, opacity: dim * lineIn, transform: lineIn < 1 ? `translateY(${(1 - lineIn) * fs * 0.4}px)` : undefined,
                boxShadow: lv > 0 ? `inset 3px 0 0 ${alpha(litColor(ln) ? color(litColor(ln)) : th.caret, lv)}` : diff && (sign === "+" || sign === "-") ? `inset 3px 0 0 ${sign === "+" ? GREEN : RED}` : undefined }}>
                {gutter > 0 && (
                  <span style={{ position: "absolute", left: 0, width: gutter - fs * 0.8, textAlign: "right", color: caretLine === li && typing ? th.muted : th.gutter, fontSize: fs * 0.86 }}>{ln}</span>
                )}
                <span style={{ position: "absolute", left: pad + gutter }}>
                  {isCmd ? (
                    <>
                      <span style={{ color: themeName === "dawn" ? "#1a7f37" : GREEN, fontWeight: 700 }}>{line.slice(0, line.indexOf(prompt) + prompt.length)}</span>
                      <Tokens toks={toks[li] ?? []} n={Math.max(0, shownN - (line.indexOf(prompt) + prompt.length))} th={th} />
                    </>
                  ) : outTint ? (
                    <span style={{ color: outTint }}>{line.slice(0, shownN)}</span>
                  ) : diff && (sign === "+" || sign === "-") && lang !== "diff" ? (
                    <><span style={{ color: sign === "+" ? GREEN : RED }}>{line[0]}</span><Tokens toks={tokenizeTail(toks[li] ?? [])} n={Math.max(0, shownN - 1)} th={th} /></>
                  ) : (
                    <Tokens toks={toks[li] ?? []} n={shownN} th={th} diffSign={diff && lang === "diff" ? sign : undefined} />
                  )}
                  {caretOn && caretLine === li && (
                    <span style={{ position: "absolute", left: `${caretCol}ch`, top: lh * 0.16, width: Math.max(2, fs * 0.09), height: lh * 0.68, background: th.caret, borderRadius: 1,
                      boxShadow: `0 0 ${fs * 0.4}px ${alpha(th.caret, 0.7)}` }} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** Drop the leading "+"/"-" char from the first token of a diff line tokenized in its own language. */
const tokenizeTail = (toks: Token[]): Token[] => {
  if (!toks.length) return toks;
  const [first, ...rest] = toks;
  return first.text.length > 1 ? [{ ...first, text: first.text.slice(1) }, ...rest] : rest;
};

const Tokens: React.FC<{ toks: Token[]; n: number; th: CodeTheme; diffSign?: string }> = ({ toks, n, th, diffSign }) => {
  let left = n;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < toks.length && left > 0; i++) {
    const tk = toks[i];
    const s = tk.text.slice(0, left);
    left -= s.length;
    const c = diffSign === "+" ? GREEN : diffSign === "-" ? RED : diffSign === "@" ? th.keyword : th[tk.kind];
    out.push(<span key={i} style={{ color: c, fontStyle: tk.kind === "comment" ? "italic" : undefined }}>{s}</span>);
  }
  return <>{out}</>;
};

const outputColor = (line: string, th: CodeTheme): string => {
  const s = line.trim();
  if (/^(✓|✔|√|success|done|ready|passed|ok\b)/i.test(s) || /\b(passed|succeeded|ready in|compiled)\b/i.test(s)) return GREEN;
  if (/^(✗|✖|×|error|err!|failed|fatal)/i.test(s) || /\b(error|failed)\b/i.test(s)) return RED;
  if (/^(⚠|warn)/i.test(s)) return AMBER;
  if (/^(→|➜|›|>)/.test(s) || /https?:\/\//.test(s)) return th.function;
  return th.muted;
};

const Chrome: React.FC<{ l: CodeL; th: CodeTheme; fs: number; h: number; ui: string; mono: string; lang: string; terminal: boolean }> = ({ l, th, fs, h, ui, mono, lang, terminal }) => {
  const dot = fs * 0.42;
  const dots = (
    <div style={{ display: "flex", gap: dot * 0.75, alignItems: "center" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: dot, height: dot, borderRadius: 99, background: c, opacity: 0.88 }} />)}
    </div>
  );
  if (terminal) {
    return (
      <div style={{ position: "relative", height: h, background: th.chrome, borderBottom: `1px solid ${th.border}`, display: "flex", alignItems: "center", padding: `0 ${fs * 0.7}px` }}>
        {dots}
        <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: fs * 0.62, color: th.muted, letterSpacing: "0.02em" }}>{l.title ?? "zsh"}</div>
      </div>
    );
  }
  const name = l.title ?? `index.${LANG_EXT[lang] ?? "ts"}`;
  return (
    <div style={{ height: h, background: th.chrome, borderBottom: `1px solid ${th.border}`, display: "flex", alignItems: "flex-end", gap: fs * 0.9, padding: `0 ${fs * 0.7}px` }}>
      <div style={{ height: h, display: "flex", alignItems: "center" }}>{dots}</div>
      <div style={{ display: "flex", alignItems: "center", gap: fs * 0.38, height: h * 0.74, padding: `0 ${fs * 0.7}px`, borderRadius: `${fs * 0.36}px ${fs * 0.36}px 0 0`,
        background: th.bg, border: `1px solid ${th.border}`, borderBottom: "none", marginBottom: -1 }}>
        <span style={{ width: fs * 0.34, height: fs * 0.34, borderRadius: 3, background: LANG_DOT[lang] ?? "#888" }} />
        <span style={{ fontFamily: ui, fontSize: fs * 0.62, color: th.fg, fontWeight: 550, whiteSpace: "nowrap" }}>{name}</span>
      </div>
    </div>
  );
};
