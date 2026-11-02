import { createContext, useContext } from "react";
import type { Asset, ProjectState, RenderInfo, Settings, Timeline, ValidationResult } from "../api";
import type { ParsedInfo } from "../lib/specInfo";
import type { PlayerBus } from "./bus";
import type { LayerSel } from "../lib/specEdit";

export type RightTab = "edit" | "assets" | "spec" | "history" | "renders";
export type VersionPreview = { n: number; spec: Record<string, unknown>; summary: string };

export type StudioApi = {
  id: string;
  project: ProjectState["project"];
  bus: PlayerBus;

  /** Raw spec currently shown in the Player (may be an unsaved but valid editor draft). */
  liveSpec: Record<string, unknown> | null;
  /** Parsed info of the last spec that parsed successfully (drives Player + Timeline). */
  info: ParsedInfo | null;
  /** Engine parse error of liveSpec (overlay), if any. */
  parseError: string | null;
  serverTimeline: Timeline | null;
  validation: ValidationResult | null;

  /** Text in the Spec editor and whether it differs from the saved spec. */
  editorText: string;
  setEditorText: (t: string) => void;
  dirty: boolean;
  /** The director saved a new spec while the editor had unsaved edits. */
  conflict: boolean;
  resolveConflict: (keepMine: boolean) => void;
  saveEditor: () => Promise<boolean>;
  setDraftSpec: (spec: Record<string, unknown> | null, validation?: ValidationResult | null) => void;
  /** A spec arrived from the server (chat `spec` event). `force` replaces unsaved edits instead of raising a conflict. */
  applyServerSpec: (spec: Record<string, unknown>, timeline?: Timeline | null, opts?: { force?: boolean }) => void;
  /** Bumped whenever the saved spec changes (save, director, restore) — history views refetch on it. */
  specNonce: number;
  /** Viewer is showing a past version instead of the editor's spec (read-only). */
  versionPreview: VersionPreview | null;
  setVersionPreview: (v: VersionPreview | null) => void;

  assets: Asset[];
  setAssets: (fn: (a: Asset[]) => Asset[]) => void;
  renders: RenderInfo[];
  addRender: (r: RenderInfo) => void;
  refreshSide: () => void;

  /**
   * Visual edit: clone the current editor spec, let `fn` mutate the draft, write it back to the editor text and preview it
   * immediately. Edits sharing a `coalesce` key within a short window (a drag, typing in one field) are one undo step.
   * Returns false when the editor text is not valid JSON (visual edits pause until it is fixed).
   */
  editSpec: (fn: (draft: Record<string, unknown>) => void, coalesce?: string) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedLayer: LayerSel | null;
  selectLayer: (sel: LayerSel | null, opts?: { seek?: boolean }) => void;

  selectedScene: number | null;
  selectScene: (i: number | null, opts?: { scrollEditor?: boolean }) => void;
  sceneFocus: { index: number; nonce: number } | null;

  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  openUploader: () => void;
  uploaderNonce: number;
  insertIntoChat: (text: string) => void;
  registerChatInsert: (fn: (text: string) => void) => void;
  /** Director settings (null while loading); hasApiKey drives the no-key card. */
  settings: Settings | null;
  refreshSettings: () => void;
  openSettings: () => void;
  chatRunning: boolean;
  setChatRunning: (r: boolean) => void;
};

export const StudioContext = createContext<StudioApi | null>(null);
export const useStudio = () => {
  const v = useContext(StudioContext);
  if (!v) throw new Error("useStudio outside Studio");
  return v;
};
