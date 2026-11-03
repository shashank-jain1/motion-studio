/**
 * Small, dependency-free syntax highlighter (deterministic, sync — safe inside a render). Covers the languages people
 * show in product films; it aims for "looks like your editor", not a full parser. tokenize() returns tokens per line.
 */
export type TokKind =
  | "plain" | "keyword" | "string" | "number" | "comment" | "function" | "type" | "property" | "tag" | "attr"
  | "operator" | "punct" | "constant" | "variable" | "builtin" | "meta";
export type Token = { text: string; kind: TokKind };

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const KW: Record<string, Set<string>> = {
  js: words(`const let var function return if else for while do switch case break continue new class extends implements interface type enum
    import export from default as async await yield try catch finally throw typeof instanceof in of void delete this super static public
    private protected readonly declare namespace keyof infer is satisfies get set abstract override`),
  go: words("func package import var const type struct interface map chan go defer select range return if else for switch case break continue fallthrough default"),
  rust: words("fn let mut pub struct enum impl trait use mod crate self Self match if else for while loop return async await move ref where dyn as unsafe const static type in"),
  swift: words("func let var struct class enum protocol extension import return if else guard for in while switch case default break continue self Self init deinit throws try await async some any"),
  kotlin: words("fun val var class object interface data sealed when is in return if else for while import package override private public internal suspend companion"),
  java: words("public private protected class interface extends implements static final void new return if else for while switch case break continue import package try catch finally throw throws this super int boolean double float long char var record"),
  c: words("int char float double void struct typedef return if else for while do switch case break continue include define const static unsigned signed long short auto class template typename namespace using public private protected virtual new delete"),
  python: words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await global nonlocal assert del"),
  bash: words("if then else elif fi for do done while until case esac function in export local return sudo source alias unset readonly"),
  sql: words(`select from where join left right inner outer full cross on group by order limit offset insert into values update set delete create table index
    view and or not null as distinct count sum avg max min having union all case when then else end in is like between exists primary key references default returning with`),
};
const CONST = words("true false null undefined None True False nil NaN Infinity");
const PY_BUILTIN = words("print len range int str float list dict set tuple open self cls super isinstance enumerate zip map filter sorted sum min max any all");
const C_LIKE = new Set(["ts", "tsx", "js", "jsx", "go", "rust", "swift", "kotlin", "java", "c", "cpp"]);

type Rule = [TokKind | "ident", RegExp];

const rulesFor = (lang: string): Rule[] => {
  const num: Rule = ["number", /0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[a-zA-Z%]*/y];
  const ident: Rule = ["ident", /[A-Za-z_$][\w$]*/y];
  const op: Rule = ["operator", /=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\.\.\.|::|->|[+\-*/%=<>!&|^~?:]/y];
  const punct: Rule = ["punct", /[{}()[\];,.]/y];
  switch (lang) {
    case "python": return [
      ["comment", /#[^\n]*/y], ["string", /[rbfu]{0,2}("""[\s\S]*?"""|'''[\s\S]*?''')/y], ["string", /[rbfu]{0,2}("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/y],
      ["meta", /@[\w.]+/y], num, ident, op, punct];
    case "bash": return [
      ["comment", /(?:^|(?<=\s))#[^\n]*/my], ["string", /"(?:\\.|[^"\\])*"|'[^']*'/y], ["variable", /\$\{[^}]*\}|\$[\w@#?*!$-]+/y],
      ["attr", /(?<=\s)--?[\w][\w-]*/y], num, ident, ["operator", /\|\||&&|[|&><=;]/y], punct];
    case "json": return [
      ["property", /"(?:\\.|[^"\\])*"(?=\s*:)/y], ["string", /"(?:\\.|[^"\\])*"/y], num, ident, punct, ["operator", /:/y]];
    case "yaml": return [
      ["comment", /#[^\n]*/y], ["property", /[\w.-]+(?=\s*:(?:\s|$))/y], ["string", /"(?:\\.|[^"\\])*"|'[^']*'/y], num, ident, ["punct", /[-:[\]{},|>]/y]];
    case "html": return [
      ["comment", /<!--[\s\S]*?-->/y], ["tag", /<\/?[A-Za-z][\w:-]*|\/?>/y], ["attr", /[A-Za-z_:][\w:.-]*(?==)/y], ["string", /"[^"]*"|'[^']*'/y], ["operator", /=/y]];
    case "css": return [
      ["comment", /\/\*[\s\S]*?\*\//y], ["keyword", /@[\w-]+/y], ["number", /#[\da-fA-F]{3,8}\b/y], ["property", /[\w-]+(?=\s*:[^:])/y],
      ["type", /[.#][\w-]+/y], ["string", /"[^"]*"|'[^']*'/y], num, ident, ["punct", /[{}();:,>+~*]/y]];
    case "sql": return [
      ["comment", /--[^\n]*/y], ["string", /'(?:''|[^'])*'/y], num, ident, ["operator", /<=|>=|<>|!=|[=<>*+\-/%]/y], punct];
    default: { // C-like
      const jsx = lang === "tsx" || lang === "jsx";
      const r: Rule[] = [["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y], ["string", /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y]];
      if (jsx) r.push(["tag", /<\/?[A-Za-z][\w.]*|\/>/y], ["attr", /[A-Za-z_][\w-]*(?==[{"'])/y]);
      r.push(["meta", /#\[[^\]]*\]|#!?\w+|@\w+/y], num, ident, op, punct);
      return r;
    }
  }
};

const classify = (word: string, lang: string, before: string, after: string): TokKind => {
  const fam = C_LIKE.has(lang) ? (lang === "ts" || lang === "tsx" || lang === "jsx" ? "js" : lang === "cpp" ? "c" : lang) : lang;
  const kw = KW[fam] ?? KW.js;
  if (lang === "sql") return KW.sql.has(word.toLowerCase()) ? "keyword" : CONST.has(word) ? "constant" : /^[A-Z_]+$/.test(word) ? "type" : "plain";
  if (lang === "bash") {
    if (KW.bash.has(word)) return "keyword";
    // the command of a line: first word, or right after a pipe / && / ;
    if (/(^|[|;&]\s*|\n\s*|\$\s+)$/.test(before)) return "function";
    return "plain";
  }
  if (lang === "json" || lang === "yaml") return CONST.has(word) || word === "yes" || word === "no" ? "constant" : "plain";
  if (kw.has(word)) return "keyword";
  if (CONST.has(word)) return "constant";
  if (lang === "python" && PY_BUILTIN.has(word)) return "builtin";
  if (/\.\s*$/.test(before) && !/\.\.\.\s*$/.test(before)) return /^\s*\(/.test(after) ? "function" : "property";
  if (/^\s*\(/.test(after)) return "function";
  if (/^[A-Z][A-Za-z0-9]*$/.test(word) && word.length > 1 && !/^[A-Z0-9_]+$/.test(word)) return "type";
  if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
  if (/^\s*:/.test(after) && /[{,]\s*$/.test(before)) return "property";
  return "plain";
};

/** Tokens per line (lines split on \n; a token never spans lines). */
export const tokenize = (code: string, language = "ts"): Token[][] => {
  const lang = language === "js" || language === "jsx" || language === "ts" || language === "tsx" ? language : language;
  if (lang === "text" || lang === "diff") return code.split("\n").map((l) => (l ? [{ text: l, kind: "plain" as TokKind }] : []));
  const rules = rulesFor(lang);
  const flat: Token[] = [];
  const push = (text: string, kind: TokKind) => {
    const last = flat[flat.length - 1];
    if (last && last.kind === kind && kind === "plain") last.text += text;
    else flat.push({ text, kind });
  };
  let i = 0;
  outer: while (i < code.length) {
    for (const [kind, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i && m[0].length > 0) {
        const text = m[0];
        if (kind === "ident") push(text, classify(text, lang, code.slice(Math.max(0, i - 40), i), code.slice(i + text.length, i + text.length + 3)));
        else push(text, kind);
        i += text.length;
        continue outer;
      }
    }
    push(code[i], "plain");
    i++;
  }
  // split into lines
  const lines: Token[][] = [[]];
  for (const tk of flat) {
    const parts = tk.text.split("\n");
    parts.forEach((p, k) => {
      if (k > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, kind: tk.kind });
    });
  }
  return lines;
};

export type CodeTheme = { bg: string; chrome: string; border: string; fg: string; muted: string; gutter: string; line: string; caret: string } & Record<TokKind, string>;

/** Editor palettes (dark: midnight / carbon / neon; light: dawn). */
export const CODE_THEME: Record<"midnight" | "carbon" | "dawn" | "neon", CodeTheme> = {
  midnight: {
    bg: "#0c0f17", chrome: "#10131d", border: "rgba(255,255,255,0.08)", fg: "#e4e7f2", muted: "#7f88a8", gutter: "#3f4663", line: "rgba(130,170,255,0.06)", caret: "#82aaff",
    plain: "#e4e7f2", keyword: "#c792ea", string: "#a6da95", number: "#f5a97f", comment: "#5f6a8a", function: "#82aaff", type: "#ffcb6b", property: "#89ddff",
    tag: "#f07178", attr: "#ffcb6b", operator: "#89ddff", punct: "#9aa4c4", constant: "#f5a97f", variable: "#e4e7f2", builtin: "#7dcfff", meta: "#c3e88d",
  },
  carbon: {
    bg: "#0a0a0a", chrome: "#111111", border: "rgba(255,255,255,0.09)", fg: "#ededed", muted: "#8f8f8f", gutter: "#444444", line: "rgba(255,255,255,0.04)", caret: "#ededed",
    plain: "#ededed", keyword: "#ff7aa8", string: "#7ee2b8", number: "#f5c26b", comment: "#6b6b6b", function: "#c4a7ff", type: "#62c8ff", property: "#b4b4b4",
    tag: "#ff7aa8", attr: "#c4a7ff", operator: "#9a9a9a", punct: "#8a8a8a", constant: "#f5c26b", variable: "#ededed", builtin: "#62c8ff", meta: "#7ee2b8",
  },
  dawn: {
    bg: "#fbfaf7", chrome: "#f3f1ec", border: "rgba(0,0,0,0.08)", fg: "#24292f", muted: "#7a7f88", gutter: "#b9bdc4", line: "rgba(9,105,218,0.06)", caret: "#0969da",
    plain: "#24292f", keyword: "#cf222e", string: "#0a3069", number: "#0550ae", comment: "#8c959f", function: "#8250df", type: "#953800", property: "#0550ae",
    tag: "#116329", attr: "#953800", operator: "#cf222e", punct: "#57606a", constant: "#0550ae", variable: "#24292f", builtin: "#8250df", meta: "#116329",
  },
  neon: {
    bg: "#07060e", chrome: "#0d0b18", border: "rgba(255,43,214,0.18)", fg: "#edebff", muted: "#8a84b8", gutter: "#3b3566", line: "rgba(34,225,255,0.07)", caret: "#22e1ff",
    plain: "#edebff", keyword: "#ff2bd6", string: "#22e1ff", number: "#ffe14d", comment: "#6b6690", function: "#8bff5c", type: "#ff9f43", property: "#9ab4ff",
    tag: "#ff2bd6", attr: "#ff9f43", operator: "#ff7ae8", punct: "#9a92c9", constant: "#ffe14d", variable: "#edebff", builtin: "#22e1ff", meta: "#8bff5c",
  },
};

/** Dot color of the file-type badge in the editor tab. */
export const LANG_DOT: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#f7df1e", jsx: "#61dafb", python: "#3776ab", bash: "#4eaa25", json: "#cbcb41", html: "#e34c26", css: "#663399",
  go: "#00add8", rust: "#dea584", sql: "#e38c00", yaml: "#cb171e", swift: "#f05138", kotlin: "#a97bff", java: "#b07219", c: "#555555", cpp: "#f34b7d", diff: "#41b883", text: "#888888",
};
export const LANG_EXT: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", python: "py", bash: "sh", json: "json", html: "html", css: "css", go: "go", rust: "rs", sql: "sql",
  yaml: "yml", swift: "swift", kotlin: "kt", java: "java", c: "c", cpp: "cpp", diff: "diff", text: "txt",
};
