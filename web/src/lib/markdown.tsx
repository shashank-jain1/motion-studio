/**
 * Tiny, safe markdown → React renderer (no innerHTML anywhere): paragraphs, #-headings, **bold**, *italic* or _italic_,
 * `code`, ``` fenced blocks ```, "-", "*" and "1." lists, > quotes, [links](https://…) (http/https only).
 * Robust to partial input while streaming (unclosed markers render as plain text).
 */
import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "ul" | "ol"; items: string[]; start: number }
  | { kind: "quote"; text: string }
  | { kind: "hr" };

const parseBlocks = (src: string): Block[] => {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) out.push({ kind: "p", text: para.join("\n") }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      out.push({ kind: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushPara(); out.push({ kind: "h", level: h[1].length, text: h[2] }); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flushPara(); out.push({ kind: "hr" }); continue; }
    const li = /^\s*([-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const kind = li[2] ? "ol" : "ul";
      const items = [li[3]];
      const start = li[2] ? Number(li[2]) : 1;
      while (i + 1 < lines.length) {
        const n = /^\s*([-*+]|(\d+)[.)])\s+(.*)$/.exec(lines[i + 1]);
        if (n && (n[2] ? "ol" : "ul") === kind) { items.push(n[3]); i++; continue; }
        // continuation line (indented, non-empty)
        if (/^\s{2,}\S/.test(lines[i + 1])) { items[items.length - 1] += " " + lines[i + 1].trim(); i++; continue; }
        break;
      }
      out.push({ kind, items, start });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      const body = [q[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ""));
      out.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out;
};

const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export const renderInline = (text: string, keyBase = "i"): ReactNode[] => {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const key = `${keyBase}-${k++}`;
    if (m[2] != null) out.push(<code key={key} className="md-code">{m[2]}</code>);
    else if (m[3] != null || m[4] != null) out.push(<strong key={key}>{renderInline(m[3] ?? m[4], key)}</strong>);
    else if (m[5] != null || m[6] != null) out.push(<em key={key}>{renderInline(m[5] ?? m[6], key)}</em>);
    else if (m[7] != null) out.push(<a key={key} href={m[8]} target="_blank" rel="noopener noreferrer">{renderInline(m[7], key)}</a>);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  // soft line breaks
  return out.flatMap((n, i): ReactNode[] => (typeof n === "string" && n.includes("\n") ? n.split("\n").flatMap((s, j): ReactNode[] => (j ? [<br key={`${keyBase}-br-${i}-${j}`} />, s] : [s])) : [n]));
};

export const Markdown = ({ text, className }: { text: string; className?: string }) => (
  <div className={`md ${className ?? ""}`}>
    {parseBlocks(text).map((b, i) => {
      const key = `b${i}`;
      switch (b.kind) {
        case "p": return <p key={key}>{renderInline(b.text, key)}</p>;
        case "h": { const H = (`h${Math.min(6, b.level + 2)}`) as "h3"; return <H key={key}>{renderInline(b.text, key)}</H>; }
        case "code": return <pre key={key} className="md-pre"><code>{b.text}</code></pre>;
        case "ul": return <ul key={key}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${key}-${j}`)}</li>)}</ul>;
        case "ol": return <ol key={key} start={b.start}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${key}-${j}`)}</li>)}</ol>;
        case "quote": return <blockquote key={key}>{renderInline(b.text, key)}</blockquote>;
        case "hr": return <hr key={key} />;
        default: return <Fragment key={key} />;
      }
    })}
  </div>
);
