import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorSelection, EditorView, keymap, Prec, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { api, type ValidationResult } from "../api";
import { useStudio } from "./context";
import { sceneRanges } from "../lib/specInfo";
import { IconAlert, IconBulb, IconCheck, IconInfo, Spinner } from "../components/Icons";

/** Editor chrome on top of the one-dark highlight style. */
const chrome = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "#d9d9e3", fontSize: "12.5px", height: "100%" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.65" },
  ".cm-content": { padding: "10px 0", caretColor: "#a68bff" },
  ".cm-gutters": { backgroundColor: "transparent", color: "#4b4b5a", border: "none", paddingLeft: "6px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#9a9aab" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.025)" },
  ".cm-cursor": { borderLeftColor: "#a68bff", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(124,92,255,0.28) !important" },
  ".cm-foldGutter .cm-gutterElement": { color: "#5a5a6a" },
  ".cm-foldPlaceholder": { backgroundColor: "rgba(255,255,255,0.06)", border: "none", color: "#9a9aab", borderRadius: "4px", padding: "0 6px" },
  ".cm-matchingBracket": { backgroundColor: "rgba(124,92,255,0.25) !important", outline: "none" },
  ".cm-tooltip": { backgroundColor: "#1b1b22", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px" },
  ".cm-panels": { backgroundColor: "#131318", color: "#d9d9e3" },
  ".cm-searchMatch": { backgroundColor: "rgba(255,95,162,0.25)" },
  ".cm-scene-flash": { backgroundColor: "rgba(124,92,255,0.12)", transition: "background-color 600ms ease-out" },
}, { dark: true });

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
          <i />{dirty ? "Unsaved changes" : "Saved"}
        </span>
        <div className="spacer" />
        {checking && <Spinner size={12} />}
        <button className="btn sm" onClick={() => { const v = cm.current?.view; if (!v) return; try { setEditorText(JSON.stringify(JSON.parse(v.state.doc.toString()), null, 2)); } catch { /* invalid */ } }} title="Format JSON">Format</button>
        <button className={`btn sm ${dirty ? "primary" : ""}`} onClick={doSave} disabled={!dirty || saving} title="Save (⌘/Ctrl+S)">
          {saving ? <Spinner size={12} /> : null}Save <kbd>⌘S</kbd>
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
        <CodeMirror ref={cm} value={editorText} onChange={setEditorText} theme="dark" extensions={extensions} height="100%"
          basicSetup={{ highlightActiveLine: true, foldGutter: true, bracketMatching: true, autocompletion: false, searchKeymap: true, lintKeymap: false }} />
      </div>
      <div className="lint">
        {!lint && <div className="lint-row muted"><Spinner size={12} />Checking…</div>}
        {lint && lint.ok && !warnings.length && (
          <div className="lint-row ok"><IconCheck size={13} />Valid spec{lint.seconds != null ? ` · ${+lint.seconds.toFixed(2)}s` : ""}</div>
        )}
        {lint && lint.ok && !!warnings.length && (
          <div className="lint-row ok"><IconCheck size={13} />Valid{lint.seconds != null ? ` · ${+lint.seconds.toFixed(2)}s` : ""} · {warnings.length} note{warnings.length === 1 ? "" : "s"}</div>
        )}
        {lint?.errors.map((e, i) => <div key={`e${i}`} className="lint-row error"><IconAlert size={13} /><code>{e}</code></div>)}
        {warns.map((w, i) => <div key={`w${i}`} className="lint-row warn"><IconInfo size={13} /><span>{w}</span></div>)}
        {tips.map((w, i) => (
          <div key={`t${i}`} className="lint-row tip"><IconBulb size={13} /><span><b>{w.match(/^craft\/[\w-]+/)?.[0].slice(6)}</b>{w.replace(/^craft\/[\w-]+:?\s*/, " ")}</span></div>
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
