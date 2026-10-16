import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { Decoration, EditorSelection, EditorView, keymap, Prec, RangeSetBuilder, ViewPlugin, type DecorationSet, type ReactCodeMirrorRef, type ViewUpdate } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { api, type ValidationResult } from "../api";
import { useStudio } from "./context";
import { sceneRanges } from "../lib/specInfo";
import { IconAlert, IconBulb, IconCheck, IconInfo, Spinner } from "../components/Icons";

/** Editor chrome on top of the one-dark highlight style. */
const chrome = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "#ECE8DF", fontSize: "12px", height: "100%" },
  ".cm-scroller": { fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.7" },
  ".cm-content": { padding: "8px 0", caretColor: "#FF3D1F" },
  ".cm-gutters": { backgroundColor: "transparent", color: "#56534B", border: "none", borderRight: "1px solid #2A2925", paddingLeft: "4px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#ECE8DF" },
  ".cm-activeLine": { backgroundColor: "rgba(236,232,223,0.035)" },
  ".cm-cursor": { borderLeftColor: "#FF3D1F", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(236,232,223,0.16) !important" },
  ".cm-foldGutter .cm-gutterElement": { color: "#56534B" },
  ".cm-foldPlaceholder": { backgroundColor: "#1C1C18", border: "1px solid #2A2925", color: "#8E897D", borderRadius: "2px", padding: "0 6px" },
  ".cm-matchingBracket": { backgroundColor: "rgba(236,232,223,0.14) !important", outline: "1px solid #56534B" },
  ".cm-tooltip": { backgroundColor: "#1C1C18", border: "1px solid #2A2925", borderRadius: "2px" },
  ".cm-panels": { backgroundColor: "#151512", color: "#ECE8DF", borderColor: "#2A2925" },
  ".cm-searchMatch": { backgroundColor: "rgba(255,61,31,0.25)" },
  ".cm-scene-flash": { backgroundColor: "rgba(255,61,31,0.12)", transition: "background-color 600ms ease-out" },
}, { dark: true });

/** Two-ink JSON highlighting (keys Bone, strings warm, numbers Tally-ish, punctuation Smoke) via a tiny tokenizer. */
const MARK = {
  key: Decoration.mark({ class: "tk-key" }), str: Decoration.mark({ class: "tk-str" }), num: Decoration.mark({ class: "tk-num" }),
  lit: Decoration.mark({ class: "tk-lit" }), punc: Decoration.mark({ class: "tk-punc" }),
};
const TOKEN = /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
const buildMarks = (view: EditorView): DecorationSet => {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(TOKEN)) {
      const at = from + (m.index ?? 0);
      if (m[1]) b.add(at, at + m[1].length, m[2] ? MARK.key : MARK.str);
      else if (m[3]) b.add(at, at + m[3].length, MARK.num);
      else if (m[4]) b.add(at, at + m[4].length, MARK.lit);
      else if (m[5]) b.add(at, at + 1, MARK.punc);
    }
  }
  return b.finish();
};
const inks = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = buildMarks(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = buildMarks(u.view); }
}, { decorations: (v) => v.decorations });

type Lint = { kind: "json" | "engine" | "server"; errors: string[]; warnings: string[]; ok: boolean; seconds?: number } | null;

export const SpecPanel = ({ active }: { active: boolean }) => {
  const s = useStudio();
  const { id, editorText, setEditorText, dirty, saveEditor, setDraftSpec, conflict, resolveConflict, sceneFocus, selectScene, validation } = s;
  const cm = useRef<ReactCodeMirrorRef>(null);
  const [lint, setLint] = useState<Lint>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(saveEditor);
  saveRef.current = saveEditor;

  // debounce → JSON parse → POST /validate (lint) and live-preview valid drafts in the Player
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      let parsed: unknown;
      try { parsed = JSON.parse(editorText); } catch (e) {
        setLint({ kind: "json", ok: false, errors: [jsonError(e as Error, editorText)], warnings: [] });
        return;
      }
      if (!parsed || typeof parsed !== "object") { setLint({ kind: "json", ok: false, errors: ["The spec must be a JSON object"], warnings: [] }); return; }
      setDraftSpec(parsed as Record<string, unknown>);
      setChecking(true);
      try {
        const r = await api.validate(id, parsed, ctl.signal);
        setLint(r.ok ? { kind: "server", ok: true, errors: [], warnings: r.warnings ?? [], seconds: r.durationSeconds } : { kind: "server", ok: false, errors: r.errors, warnings: r.warnings ?? [] });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setLint((l) => l ?? null);
      } finally { if (!ctl.signal.aborted) setChecking(false); }
    }, 500);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [editorText, id, setDraftSpec]);

  // initial lint = server's validation of the saved spec
  useEffect(() => {
    if (!lint && validation) setLint(validation.ok ? { kind: "server", ok: true, errors: [], warnings: validation.warnings, seconds: validation.durationSeconds } : { kind: "server", ok: false, errors: validation.errors, warnings: validation.warnings });
  }, [validation]); // eslint-disable-line react-hooks/exhaustive-deps

  // scroll to a scene selected in the timeline (applied when the tab is visible)
  const applied = useRef(0);
  useEffect(() => {
    const view = cm.current?.view;
    if (!active || !view || !sceneFocus || applied.current === sceneFocus.nonce) return;
    applied.current = sceneFocus.nonce;
    const r = sceneRanges(view.state.doc.toString())[sceneFocus.index];
    if (!r) return;
    requestAnimationFrame(() => {
      view.dispatch({ selection: EditorSelection.cursor(r.from), effects: EditorView.scrollIntoView(r.from, { y: "start", yMargin: 24 }) });
    });
  }, [sceneFocus, active]);

  const extensions = useMemo(() => [
    json(),
    chrome,
    inks,
    EditorView.lineWrapping,
    Prec.highest(keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { void doSave(); return true; } }])),
    // cursor → timeline scene highlight
    EditorView.updateListener.of((u) => {
      if (!u.selectionSet || !u.view.hasFocus) return;
      const pos = u.state.selection.main.head;
      const idx = sceneRanges(u.state.doc.toString()).findIndex((r) => pos >= r.from && pos <= r.to);
      if (idx >= 0) selectScene(idx);
    }),
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doSave() {
    setSaving(true);
    try { await saveRef.current(); } finally { setSaving(false); }
  }

  const warnings = lint?.warnings ?? [];
  const tips = warnings.filter((w) => /^craft\//.test(w));
  const warns = warnings.filter((w) => !/^craft\//.test(w));

  return (
    <div className="spec-panel">
      <div className="spec-toolbar">
        <span className={`save-state ${dirty ? "is-dirty" : ""}`}>
          <i /><span className="mono">{dirty ? "UNSAVED" : "SAVED"}</span>
        </span>
        <div className="spacer" />
        {checking && <Spinner size={12} />}
        <button className="btn xs" onClick={() => { const v = cm.current?.view; if (!v) return; try { setEditorText(JSON.stringify(JSON.parse(v.state.doc.toString()), null, 2)); } catch { /* invalid */ } }} title="Format JSON">Format</button>
        <button className={`btn xs ${dirty ? "primary" : ""}`} onClick={doSave} disabled={!dirty || saving} title="Save (⌘/Ctrl+S)">
          {saving ? <Spinner size={12} /> : null}Save <kbd className="kbd">⌘S</kbd>
        </button>
      </div>
      {conflict && (
        <div className="callout warn conflict">
          <span>The director saved a new version while you were editing.</span>
          <div className="row gap">
            <button className="btn xs" onClick={() => resolveConflict(false)}>Load theirs</button>
            <button className="btn xs ghost" onClick={() => resolveConflict(true)}>Keep mine</button>
          </div>
        </div>
      )}
      <div className="editor-wrap">
        <CodeMirror ref={cm} value={editorText} onChange={setEditorText} theme="none" extensions={extensions} height="100%"
          basicSetup={{ syntaxHighlighting: false, highlightActiveLine: true, foldGutter: true, bracketMatching: true, autocompletion: false, searchKeymap: true, lintKeymap: false }} />
      </div>
      <div className="lint">
        {!lint && <div className="lint-row dim"><Spinner size={12} /><span className="mono">CHECKING</span></div>}
        {lint && lint.ok && !warnings.length && (
          <div className="lint-row ok"><IconCheck size={14} /><span className="mono">VALID{lint.seconds != null ? ` · ${lint.seconds.toFixed(2)}S` : ""}</span></div>
        )}
        {lint && lint.ok && !!warnings.length && (
          <div className="lint-row ok"><IconCheck size={14} /><span className="mono">VALID{lint.seconds != null ? ` · ${lint.seconds.toFixed(2)}S` : ""} · {warnings.length} NOTE{warnings.length === 1 ? "" : "S"}</span></div>
        )}
        {lint?.errors.map((e, i) => <div key={`e${i}`} className="lint-row error"><IconAlert size={14} /><code>{e}</code></div>)}
        {warns.map((w, i) => <div key={`w${i}`} className="lint-row warn"><IconInfo size={14} /><span>{w}</span></div>)}
        {tips.map((w, i) => (
          <div key={`t${i}`} className="lint-row tip"><IconBulb size={14} /><span><b>{w.match(/^craft\/[\w-]+/)?.[0].slice(6)}</b>{w.replace(/^craft\/[\w-]+:?\s*/, " ")}</span></div>
        ))}
      </div>
    </div>
  );
};

const jsonError = (e: Error, text: string) => {
  const m = /position (\d+)/.exec(e.message);
  if (!m) return e.message;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return `JSON syntax error at line ${line}, column ${col}: ${e.message.replace(/ in JSON at position \d+.*$/, "").replace(/\s*\(line \d+ column \d+\)/, "")}`;
};
