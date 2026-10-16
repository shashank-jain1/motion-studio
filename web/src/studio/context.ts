import { createContext, useContext } from "react";
import type { Asset, ProjectState, RenderInfo, Settings, Timeline, ValidationResult } from "../api";
import type { ParsedInfo } from "../lib/specInfo";
import type { PlayerBus } from "./bus";

export type RightTab = "assets" | "spec" | "renders";

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
  /** A spec arrived from the server (chat `spec` event). */
  applyServerSpec: (spec: Record<string, unknown>, timeline?: Timeline | null) => void;

  assets: Asset[];
  setAssets: (fn: (a: Asset[]) => Asset[]) => void;
  renders: RenderInfo[];
  addRender: (r: RenderInfo) => void;
  refreshSide: () => void;

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
