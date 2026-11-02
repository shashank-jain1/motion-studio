import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useStudio } from "./context";
import { Segmented, Select } from "../components/ui";
import { IconAlert, IconArrowLeft, IconArrowRight, IconChevronDown, IconCopy, IconLayers, IconPlus, IconTrash, Spinner } from "../components/Icons";
import { splitErrors } from "../lib/specInfo";
import {
  ENTER_OPTIONS, TRANSITION_OPTIONS, allSceneIds, assign, cloneWithFreshIds, getLayer, layerForm, layerLabel, newLayer, num, parentList,
  samePath, sceneLayerIds, scenesOf, selKey, toHex, uniqueId, type FieldDef, type Json, type LayerSel, type RawLayer, type RawScene,
} from "../lib/specEdit";

/**
 * Visual inspector: scene → layers → properties. Every edit goes through `editSpec`, which rewrites the editor text
 * (so the Spec tab, Save, conflict handling and validation all keep working) and previews the draft immediately.
 */
export const EditPanel = ({ active }: { active: boolean }) => {
  const s = useStudio();
  const { editorText, liveSpec, info, selectedScene, selectScene, selectedLayer, selectLayer, editSpec, dirty, saveEditor, undo, redo, canUndo, canRedo, parseError, bus } = s;

  // The inspector reads the editor text (what edits apply to); while it is broken JSON, show the last good spec read-only.
  const { raw, jsonBroken } = useMemo(() => {
    try { const v = JSON.parse(editorText); if (v && typeof v === "object") return { raw: v as Json, jsonBroken: false }; } catch { /* fall through */ }
    return { raw: liveSpec, jsonBroken: !!editorText.trim() };
  }, [editorText, liveSpec]);

  const scenes = scenesOf(raw);
  const sceneIdx = scenes.length ? Math.max(0, Math.min(scenes.length - 1, selectedScene ?? 0)) : -1;
  const scene = sceneIdx >= 0 ? scenes[sceneIdx] : null;
  const layerSel = selectedLayer && selectedLayer.scene === sceneIdx ? selectedLayer : null;
  const layer = getLayer(raw, layerSel);
  const theme = useMemo(() => ((raw?.theme as Json | undefined)?.colors ?? {}) as Record<string, string>, [raw]);
  const [saving, setSaving] = useState(false);

  // keep the selected layer row in view (selection can come from the viewer or keyboard)
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !layerSel) return;
    listRef.current?.querySelector(`[data-sel="${selKey(layerSel)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, layerSel && selKey(layerSel)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!raw || !scene) {
    return (
      <div className="edit-panel">
        <div className="edit-empty">
          <IconLayers size={20} />
          <p className="serif-line sm">Nothing to edit yet</p>
          <p className="dim small">Ask the director for a first cut, or start from a template. Scenes and layers appear here once the film has a spec.</p>
        </div>
      </div>
    );
  }

  const goScene = (i: number) => {
    selectScene(i);
    const slot = info?.timeline.scenes[i];
    if (slot) { bus.player?.pause(); bus.seek(slot.start * (info?.fps ?? 30)); }
  };
  const editScene = (fn: (sc: RawScene, d: Json) => void, key?: string) =>
    editSpec((d) => { const sc = scenesOf(d)[sceneIdx]; if (sc) fn(sc, d); }, key && `scene:${sceneIdx}:${key}`);

  const doSave = async () => { setSaving(true); try { await saveEditor(); } finally { setSaving(false); } };

  return (
    <div className="edit-panel">
      <div className="spec-toolbar">
        <span className={`save-state ${dirty ? "is-dirty" : ""}`}><i /><span className="mono">{dirty ? "UNSAVED" : "SAVED"}</span></span>
        <div className="spacer" />
        <button className="btn xs ghost" onClick={undo} disabled={!canUndo} title="Undo visual edit (⌘Z)">Undo</button>
        <button className="btn xs ghost" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
        <button className={`btn xs ${dirty ? "primary" : ""}`} onClick={doSave} disabled={!dirty || saving || jsonBroken} title="Save (⌘/Ctrl+S)">
          {saving ? <Spinner size={12} /> : null}Save <kbd className="kbd">⌘S</kbd>
        </button>
      </div>

      <div className="edit-scroll">
        {jsonBroken && <div className="callout warn edit-callout"><IconAlert size={14} /><span>The Spec editor has a JSON syntax error. Visual edits are paused until it is fixed.</span></div>}
        {!jsonBroken && parseError && (
          <div className="callout warn edit-callout"><IconAlert size={14} /><span>The viewer is holding the last valid film: <code>{splitErrors(parseError)[0]}</code></span></div>
        )}

        {/* ---------------- scene */}
        <section className="edit-sec">
          <header className="edit-sec-head">
            <span className="label">Scene</span>
            <span className="mono edit-scene-n">{String(sceneIdx + 1).padStart(2, "0")}<span className="dim"> / {String(scenes.length).padStart(2, "0")}</span></span>
            <span className="spacer" />
            <button className="icon-btn ghost xs" onClick={() => goScene(sceneIdx - 1)} disabled={sceneIdx <= 0} aria-label="Previous scene" title="Previous scene"><IconArrowLeft size={14} /></button>
            <button className="icon-btn ghost xs" onClick={() => goScene(sceneIdx + 1)} disabled={sceneIdx >= scenes.length - 1} aria-label="Next scene" title="Next scene"><IconArrowRight size={14} /></button>
            <SceneMenu sceneIdx={sceneIdx} count={scenes.length} />
          </header>
          <div className="edit-rows">
            <Row label="Name"><StrInput value={scene.id} placeholder={`scene ${sceneIdx + 1}`} onChange={(v) => editScene((sc) => assign(sc, "id", v || undefined), "id")} /></Row>
            <Row label="Duration"><NumInput value={scene.duration} step={0.1} min={0.1} unit="s" onChange={(v) => editScene((sc) => assign(sc, "duration", v ?? 1), "duration")} /></Row>
            {sceneIdx > 0 && (
              <Row label="Transition in">
                <div className="edit-pair">
                  <Select label="Transition" mono value={String(scene.transition?.type ?? "")}
                    options={[{ value: "", label: "Default cut" }, ...TRANSITION_OPTIONS.map((t) => ({ value: t }))]}
                    onChange={(v) => editScene((sc) => { if (!v) delete sc.transition; else sc.transition = { ...(sc.transition ?? {}), type: v }; })} />
                  {!!scene.transition?.type && !["none", "cut"].includes(String(scene.transition.type)) && (
                    <NumInput value={scene.transition.duration} placeholder="0.5" step={0.05} min={0.05} unit="s" title="Transition seconds"
                      onChange={(v) => editScene((sc) => { if (sc.transition) assign(sc.transition, "duration", v); }, "tr-dur")} />
                  )}
                </div>
              </Row>
            )}
            <BackgroundRows scene={scene} theme={theme} onEdit={editScene} />
            <Row label="Notes"><StrInput multiline value={scene.notes} placeholder="Director notes (not rendered)" onChange={(v) => editScene((sc) => assign(sc, "notes", v || undefined), "notes")} /></Row>
          </div>
        </section>

        {/* ---------------- layers */}
        <section className="edit-sec">
          <header className="edit-sec-head">
            <span className="label">Layers</span>
            <span className="mono dim">{countLayers(scene.layers)}</span>
            <span className="spacer" />
            <AddLayerMenu sceneIdx={sceneIdx} />
          </header>
          <div className="layer-list" ref={listRef} role="tree" aria-label="Layers">
            {!scene.layers?.length && <div className="layer-empty dim small">No layers in this scene.</div>}
            <LayerRows layers={scene.layers ?? []} sceneIdx={sceneIdx} path={[]} depth={0} sel={layerSel} onSelect={(p) => selectLayer({ scene: sceneIdx, path: p }, { seek: true })} />
          </div>
        </section>

        {/* ---------------- layer properties */}
        {layer && layerSel && <LayerInspector key={selKey(layerSel)} sel={layerSel} layer={layer} theme={theme} />}

        {/* ---------------- film */}
        <ThemeSection theme={theme} />
      </div>
    </div>
  );
};

const countLayers = (ls: RawLayer[] | undefined): number => (ls ?? []).reduce((n, l) => n + 1 + countLayers(l.layers), 0);

// ------------------------------------------------------------------------------------------------ scene pieces

const SceneMenu = ({ sceneIdx, count }: { sceneIdx: number; count: number }) => {
  const { editSpec, selectScene, selectLayer } = useStudio();
  const move = (dir: -1 | 1) => {
    const j = sceneIdx + dir;
    if (j < 0 || j >= count) return;
    if (editSpec((d) => { const sc = scenesOf(d); [sc[sceneIdx], sc[j]] = [sc[j], sc[sceneIdx]]; })) { selectScene(j); selectLayer(null); }
  };
  return (
    <Menu label="Scene actions" items={[
      { label: "Duplicate scene", onClick: () => {
        if (editSpec((d) => {
          const sc = scenesOf(d);
          const taken = new Set([...sc.flatMap((_, i) => [...sceneLayerIds(d, i)])]);
          const copy = cloneWithFreshIds(sc[sceneIdx], taken);
          if (typeof copy.id === "string") copy.id = uniqueId(allSceneIds(d), copy.id);
          sc.splice(sceneIdx + 1, 0, copy);
        })) { selectScene(sceneIdx + 1); selectLayer(null); }
      } },
      { label: "Add empty scene after", onClick: () => {
        if (editSpec((d) => { scenesOf(d).splice(sceneIdx + 1, 0, { duration: 3, layers: [] }); })) { selectScene(sceneIdx + 1); selectLayer(null); }
      } },
      { label: "Move earlier", disabled: sceneIdx === 0, onClick: () => move(-1) },
      { label: "Move later", disabled: sceneIdx >= count - 1, onClick: () => move(1) },
      { label: "Delete scene", danger: true, disabled: count <= 1, onClick: () => {
        if (editSpec((d) => { scenesOf(d).splice(sceneIdx, 1); })) { selectScene(Math.max(0, sceneIdx - 1)); selectLayer(null); }
      } },
    ]} />
  );
};

type BgEdit = (fn: (sc: RawScene, d: Json) => void, key?: string) => void;
const BackgroundRows = ({ scene, theme, onEdit }: { scene: RawScene; theme: Record<string, string>; onEdit: BgEdit }) => {
  const bg = scene.background as Json | Json[] | undefined;
  const kind = !bg ? "default" : Array.isArray(bg) ? "layered" : String(bg.type);
  const editable = kind === "default" || kind === "solid" || kind === "gradient" || kind === "mesh";
  const colorsOf = (b: Json | Json[] | undefined): string[] => {
    if (!b || Array.isArray(b)) return [];
    if (Array.isArray(b.colors)) return b.colors as string[];
    return typeof b.color === "string" ? [b.color] : [];
  };
  const setKind = (k: string) => onEdit((sc) => {
    const cur = colorsOf(sc.background as Json | undefined);
    if (k === "default") delete sc.background;
    else if (k === "solid") sc.background = { type: "solid", color: cur[0] ?? "$bg" };
    else if (k === "gradient") sc.background = { type: "gradient", colors: [cur[0] ?? "$bg", cur[1] ?? "$accent"], angle: 135 };
  });
  const b = bg && !Array.isArray(bg) ? bg : null;
  return (
    <>
      <Row label="Background">
        {editable ? (
          <Segmented size="sm" label="Background type" value={kind === "mesh" ? "gradient" : kind}
            options={[{ value: "default", label: "Theme" }, { value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient" }]} onChange={setKind} />
        ) : <span className="mono dim small">{kind.toUpperCase()} · edit in Spec</span>}
      </Row>
      {b?.type === "solid" && (
        <Row label="Color"><ColorInput value={b.color} theme={theme} onChange={(v) => onEdit((sc) => { (sc.background as Json).color = v ?? "$bg"; }, "bg-color")} /></Row>
      )}
      {(b?.type === "gradient" || b?.type === "mesh") && Array.isArray(b.colors) && (
        <>
          {(b.colors as string[]).map((c, i) => (
            <Row key={i} label={i === 0 ? "Colors" : ""}>
              <div className="edit-pair">
                <ColorInput value={c} theme={theme} onChange={(v) => onEdit((sc) => { ((sc.background as Json).colors as string[])[i] = v ?? "#000000"; }, `bg-c${i}`)} />
                <button className="icon-btn ghost xs" disabled={(b.colors as string[]).length <= 2} aria-label="Remove color" title="Remove color"
                  onClick={() => onEdit((sc) => { ((sc.background as Json).colors as string[]).splice(i, 1); })}><IconTrash size={13} /></button>
              </div>
            </Row>
          ))}
          <Row label="">
            <div className="edit-pair">
              <button className="btn xs ghost" onClick={() => onEdit((sc) => { const cs = (sc.background as Json).colors as string[]; cs.push(cs[cs.length - 1] ?? "$accent"); })}><IconPlus size={12} />Color</button>
              {b.type === "gradient" && <NumInput value={b.angle} placeholder="180" step={5} unit="°" title="Angle"
                onChange={(v) => onEdit((sc) => assign(sc.background as Json, "angle", v), "bg-angle")} />}
            </div>
          </Row>
        </>
      )}
    </>
  );
};

// ------------------------------------------------------------------------------------------------ layer list

const LayerRows = ({ layers, sceneIdx, path, depth, sel, onSelect }: {
  layers: RawLayer[]; sceneIdx: number; path: number[]; depth: number; sel: LayerSel | null; onSelect: (p: number[]) => void;
}) => (
  <>
    {/* top of the list = front-most (last in the array draws on top), like every layer panel */}
    {layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => {
      const p = [...path, i];
      const on = !!sel && samePath(sel.path, p);
      const start = num(l.start), dur = num(l.duration);
      return (
        <div key={i} role="treeitem" aria-selected={on}>
          <button className={`layer-row ${on ? "is-selected" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} data-sel={selKey({ scene: sceneIdx, path: p })}
            onClick={() => onSelect(p)} title={`${l.type} · ${layerLabel(l)}`}>
            <span className="layer-type mono">{String(l.type ?? "?").slice(0, 5)}</span>
            <span className="layer-name ellipsis">{layerLabel(l)}</span>
            <span className="layer-time mono">{start != null || dur != null ? `${(start ?? 0).toFixed(1)}${dur != null ? `+${dur.toFixed(1)}` : "→"}` : ""}</span>
          </button>
          {Array.isArray(l.layers) && l.layers.length > 0 && (
            <LayerRows layers={l.layers} sceneIdx={sceneIdx} path={p} depth={depth + 1} sel={sel} onSelect={onSelect} />
          )}
        </div>
      );
    })}
  </>
);

const AddLayerMenu = ({ sceneIdx }: { sceneIdx: number }) => {
  const { editSpec, selectLayer, info, assets } = useStudio();
  const frame = { width: info?.width ?? 1920, height: info?.height ?? 1080 };
  const add = (l: RawLayer) => {
    let index = -1;
    const ok = editSpec((d) => {
      const sc = scenesOf(d)[sceneIdx];
      if (!sc) return;
      sc.layers = Array.isArray(sc.layers) ? sc.layers : [];
      sc.layers.push(l);
      index = sc.layers.length - 1;
    });
    if (ok && index >= 0) selectLayer({ scene: sceneIdx, path: [index] }, { seek: true });
  };
  const images = assets.filter((a) => a.kind === "image" || a.kind === "video");
  return (
    <Menu label="Add layer" trigger={<><IconPlus size={12} />Add</>} items={[
      { label: "Text", onClick: () => add(newLayer("text", frame)) },
      { label: "Shape", onClick: () => add(newLayer("shape", frame)) },
      ...images.slice(0, 12).map((a) => ({ label: `Media · ${a.path.split("/").pop()}`, onClick: () => add(newLayer("media", frame, a.path)) })),
      ...(images.length ? [] : [{ label: "Media (upload in Assets first)", disabled: true, onClick: () => {} }]),
    ]} />
  );
};

// ------------------------------------------------------------------------------------------------ layer inspector

const LayerInspector = ({ sel, layer, theme }: { sel: LayerSel; layer: RawLayer; theme: Record<string, string> }) => {
  const { editSpec, selectLayer, setRightTab, selectScene } = useStudio();
  const type = String(layer.type ?? "");
  const form = layerForm(type);
  const base = `layer:${selKey(sel)}`;
  const set = (key: string, v: unknown) => editSpec((d) => { const l = getLayer(d, sel); if (l) assign(l, key, v); }, `${base}:${key}`);
  const [more, setMore] = useState(false);

  const structural = (fn: (list: RawLayer[], i: number, d: Json) => LayerSel | null | void) => {
    let next: LayerSel | null | void = undefined;
    const ok = editSpec((d) => { const p = parentList(d, sel); if (p) next = fn(p.list, p.index, d); });
    if (ok && next !== undefined) selectLayer(next);
  };
  const parentPath = sel.path.slice(0, -1);
  const at = (i: number): LayerSel => ({ scene: sel.scene, path: [...parentPath, i] });

  const presentComplex = form?.complex.filter((k) => layer[k] !== undefined) ?? [];

  return (
    <section className="edit-sec layer-inspector">
      <header className="edit-sec-head">
        <span className="label">Layer</span>
        <span className="tag mono">{type.toUpperCase()}</span>
        <span className="spacer" />
        <button className="icon-btn ghost xs" title="Bring forward" aria-label="Bring forward"
          onClick={() => structural((list, i) => { if (i >= list.length - 1) return; [list[i], list[i + 1]] = [list[i + 1], list[i]]; return at(i + 1); })}><IconArrowUpSmall /></button>
        <button className="icon-btn ghost xs" title="Send backward" aria-label="Send backward"
          onClick={() => structural((list, i) => { if (i <= 0) return; [list[i], list[i - 1]] = [list[i - 1], list[i]]; return at(i - 1); })}><IconArrowDownSmall /></button>
        <button className="icon-btn ghost xs" title="Duplicate layer" aria-label="Duplicate layer"
          onClick={() => structural((list, i, d) => {
            const copy = cloneWithFreshIds(list[i], sceneLayerIds(d, sel.scene));
            copy.x = (num(copy.x) ?? 0) + 24; copy.y = (num(copy.y) ?? 0) + 24;
            list.splice(i + 1, 0, copy);
            return at(i + 1);
          })}><IconCopy size={13} /></button>
        <button className="icon-btn ghost xs danger-hover" title="Delete layer (⌫)" aria-label="Delete layer"
          onClick={() => structural((list, i) => { list.splice(i, 1); return null; })}><IconTrash size={13} /></button>
      </header>

      {!form ? <p className="dim small edit-note">Unknown layer type “{type}”. Edit it in the Spec tab.</p> : (
        <div className="edit-rows">
          <Row label="ID"><StrInput value={layer.id} placeholder="(none)" mono onChange={(v) => set("id", v || undefined)} /></Row>
          {form.content.map((f) => <Field key={f.key} f={f} value={layer[f.key]} theme={theme} onChange={(v) => set(f.key, v)} />)}

          <SubHead>Transform</SubHead>
          <div className="edit-grid">
            {form.transform.map((f) => (
              <NumInput key={f.key} label={SHORT[f.key] ?? f.key} title={`${humanize(f.key)} — drag the label to scrub`} value={layer[f.key]} step={STEP[f.key] ?? 1}
                min={f.kind === "number" ? f.min : undefined} max={f.kind === "number" ? f.max : undefined} placeholder={DEFAULTS[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>

          <SubHead>Timing</SubHead>
          <div className="edit-grid">
            {form.timing.map((f) => (
              <NumInput key={f.key} label={f.key === "start" ? "IN" : "DUR"} title={f.doc ?? f.key} value={layer[f.key]} step={0.05}
                min={f.key === "start" ? 0 : 0.05} unit="s" placeholder={f.key === "start" ? "0" : "scene"} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
          {form.motion.map((f) => <MotionRows key={f.key} label={f.key === "enter" ? "Enter" : "Exit"} value={layer[f.key] as Json | undefined} onChange={(v) => set(f.key, v)} />)}

          {form.style.length > 0 && <SubHead>{type[0].toUpperCase() + type.slice(1)}</SubHead>}
          {form.style.map((f) => <Field key={f.key} f={f} value={layer[f.key]} theme={theme} onChange={(v) => set(f.key, v)} />)}

          <button className="edit-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <IconChevronDown size={12} style={{ transform: more ? "none" : "rotate(-90deg)" }} />3D, depth &amp; blend
          </button>
          {more && form.more.map((f) => <Field key={f.key} f={f} value={layer[f.key]} theme={theme} onChange={(v) => set(f.key, v)} />)}

          {presentComplex.length > 0 && (
            <div className="edit-note">
              <span className="dim small">Also set: <span className="mono">{presentComplex.join(" · ")}</span></span>
              <button className="btn xs ghost" onClick={() => { selectScene(sel.scene, { scrollEditor: true }); setRightTab("spec"); }}>Open in Spec</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const SHORT: Record<string, string> = { x: "X", y: "Y", width: "W", height: "H", scale: "SCL", rotate: "ROT", opacity: "OPA", zIndex: "Z#" };
const STEP: Record<string, number> = { scale: 0.05, opacity: 0.05, rotate: 1 };
const DEFAULTS: Record<string, string> = { x: "0", y: "0", scale: "1", rotate: "0", opacity: "1", width: "auto", height: "auto", zIndex: "0" };

const MotionRows = ({ label, value, onChange }: { label: string; value: Json | undefined; onChange: (v: Json | undefined) => void }) => (
  <Row label={label}>
    <div className="edit-pair">
      <Select label={`${label} preset`} mono value={String(value?.type ?? "")}
        options={[{ value: "", label: "Default" }, ...ENTER_OPTIONS.map((o) => ({ value: o }))]}
        onChange={(v) => onChange(v ? { ...(value ?? {}), type: v } : undefined)} />
      {!!value?.type && value.type !== "none" && (
        <NumInput value={value.duration} placeholder="0.6" step={0.05} min={0.05} unit="s" title={`${label} seconds`}
          onChange={(v) => { const n = { ...value }; assign(n, "duration", v); onChange(n); }} />
      )}
    </div>
  </Row>
);

/** One property row picked by the field's schema kind. */
const Field = ({ f, value, theme, onChange }: { f: FieldDef; value: unknown; theme: Record<string, string>; onChange: (v: unknown) => void }) => {
  const label = humanize(f.key);
  switch (f.kind) {
    case "number": return <Row label={label} title={f.doc}><NumInput value={value} min={f.min} max={f.max} step={f.int ? 1 : stepFor(f.key)} int={f.int} onChange={onChange} /></Row>;
    case "string": return (
      <Row label={label} title={f.doc}>
        {f.color ? <ColorInput value={value} theme={theme} onChange={onChange} />
          : <StrInput value={value} multiline={f.multiline} onChange={(v) => onChange(v === "" && f.key !== "text" ? undefined : v)} />}
      </Row>
    );
    case "boolean": return (
      <Row label={label} title={f.doc}>
        <Segmented size="sm" label={label} value={value === true ? "on" : value === false ? "off" : "default"}
          options={[{ value: "default", label: "Default" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]}
          onChange={(v) => onChange(v === "default" ? undefined : v === "on")} />
      </Row>
    );
    case "enum": return (
      <Row label={label} title={f.doc}>
        <Select label={label} mono value={typeof value === "string" ? value : ""} options={[{ value: "", label: "Default" }, ...f.options.map((o) => ({ value: o }))]}
          onChange={(v) => onChange(v || undefined)} />
      </Row>
    );
    default: return null;
  }
};

const stepFor = (key: string) => (/size|width|height|radius|distance|^x$|^y$/i.test(key) ? 1 : /opacity|amount|intensity|ratio|^scale/i.test(key) ? 0.05 : 0.1);
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

// ------------------------------------------------------------------------------------------------ film / theme

const ThemeSection = ({ theme }: { theme: Record<string, string> }) => {
  const { editSpec } = useStudio();
  const [open, setOpen] = useState(false);
  const keys = Object.keys(theme);
  return (
    <section className="edit-sec">
      <button className="edit-sec-head as-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconChevronDown size={12} style={{ transform: open ? "none" : "rotate(-90deg)" }} />
        <span className="label">Film palette</span>
        <span className="spacer" />
        <span className="theme-chips">{keys.slice(0, 8).map((k) => <i key={k} style={{ background: toHex(theme[k], theme) ?? theme[k] }} />)}</span>
      </button>
      {open && (
        <div className="edit-rows">
          {!keys.length && <p className="dim small edit-note">No theme colors. The director sets them with a style preset.</p>}
          {keys.map((k) => (
            <Row key={k} label={`$${k}`} mono>
              <ColorInput value={theme[k]} theme={theme} noTokens onChange={(v) => editSpec((d) => {
                const t = (d.theme ??= {}) as Json;
                const c = (t.colors ??= {}) as Json;
                c[k] = v ?? theme[k];
              }, `theme:${k}`)} />
            </Row>
          ))}
          <p className="dim small edit-note">Palette colors recolor every layer that uses <span className="mono">$name</span>.</p>
        </div>
      )}
    </section>
  );
};

// ------------------------------------------------------------------------------------------------ controls

const SubHead = ({ children }: { children: ReactNode }) => <div className="edit-subhead label">{children}</div>;

const Row = ({ label, children, title, mono }: { label: string; children: ReactNode; title?: string; mono?: boolean }) => (
  <div className="edit-row" title={title}>
    <span className={`edit-label ${mono ? "mono" : ""}`}>{label}</span>
    <div className="edit-ctl">{children}</div>
  </div>
);

const fmtNum = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : typeof v === "string" ? v : "");

/**
 * Number field: types live, ↑/↓ steps (⇧ ×10, ⌥ ×0.1). Dragging its label (or the grip when it has none) scrubs the value.
 * Empty = unset (engine default, shown as placeholder). Non-numeric spec values (e.g. "beat:4") are shown verbatim.
 */
const NumInput = ({ value, onChange, step = 1, min, max, int, unit, placeholder, title, label }: {
  value: unknown; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; int?: boolean; unit?: string;
  placeholder?: string; title?: string; label?: string;
}) => {
  const [text, setText] = useState(fmtNum(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmtNum(value)); }, [value]);
  const clamp = (n: number) => {
    let v = int ? Math.round(n) : Math.round(n * 1000) / 1000;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  };
  const current = () => (typeof value === "number" ? value : Number(placeholder) || 0);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const scrub = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, v: current(), moved: false }; },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 2) return;
      d.moved = true;
      const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const v = clamp(d.v + Math.round(dx / 3) * step * k);
      setText(fmtNum(v));
      onChange(v);
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  };
  return (
    <span className={`num-input ${label ? "has-label" : ""}`} title={title}>
      {label && <span className="num-label mono" {...scrub}>{label}</span>}
      <input className="input mono" inputMode="decimal" value={text} placeholder={placeholder} aria-label={title}
        onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
        onBlur={() => { focused.current = false; setText(fmtNum(value)); }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (!t.trim()) onChange(undefined);
          else if (Number.isFinite(Number(t))) onChange(clamp(Number(t)));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); return; }
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          const v = clamp(current() + (e.key === "ArrowUp" ? 1 : -1) * step * k);
          setText(fmtNum(v));
          onChange(v);
        }} />
      {unit && <span className="num-unit mono">{unit}</span>}
      {!label && <span className="num-scrub" aria-hidden title="Drag to scrub" {...scrub} />}
    </span>
  );
};

const StrInput = ({ value, onChange, placeholder, multiline, mono }: { value: unknown; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; mono?: boolean }) => {
  const v = typeof value === "string" ? value : value == null ? "" : String(value);
  return multiline
    ? <textarea className={`input edit-textarea ${mono ? "mono" : ""}`} value={v} placeholder={placeholder} rows={Math.min(6, Math.max(2, v.split("\n").length))} onChange={(e) => onChange(e.target.value)} />
    : <input className={`input ${mono ? "mono" : ""}`} value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
};

const ColorInput = ({ value, theme, onChange, noTokens }: { value: unknown; theme: Record<string, string>; onChange: (v: string | undefined) => void; noTokens?: boolean }) => {
  const id = useId();
  const v = typeof value === "string" ? value : "";
  const hex = toHex(v, theme);
  return (
    <span className="color-input">
      <label className="swatch" style={{ background: hex ?? (v || "transparent") }} title="Pick a color">
        <input type="color" value={hex ?? "#000000"} onChange={(e) => onChange(e.target.value)} />
        {!v && <i className="swatch-none" />}
      </label>
      <input className="input mono" value={v} placeholder="default" list={noTokens ? undefined : id} onChange={(e) => onChange(e.target.value || undefined)} />
      {!noTokens && <datalist id={id}>{Object.keys(theme).map((k) => <option key={k} value={`$${k}`} />)}</datalist>}
    </span>
  );
};

type MenuItem = { label: string; onClick: () => void; disabled?: boolean; danger?: boolean };
const Menu = ({ label, items, trigger }: { label: string; items: MenuItem[]; trigger?: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("mousedown", off); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className="edit-menu-wrap" ref={ref}>
      <button className={trigger ? "btn xs ghost" : "icon-btn ghost xs"} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        {trigger ?? <span className="dots" aria-hidden>···</span>}
      </button>
      {open && (
        <ul className="menu edit-menu" role="menu">
          {items.map((it) => (
            <li key={it.label} role="none">
              <button role="menuitem" className={it.danger ? "is-danger" : ""} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const IconArrowUpSmall = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M8 13V3M4 7l4-4 4 4" /></svg>;
const IconArrowDownSmall = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M8 3v10M4 9l4 4 4-4" /></svg>;
