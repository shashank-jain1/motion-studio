import { useEffect, useState } from "react";
import { api, type Settings } from "../api";
import { Dialog, Segmented, Select } from "../components/ui";
import { IconCheck, IconKey, Spinner } from "../components/Icons";
import { useToast } from "../components/Toast";

const EFFORTS = ["low", "medium", "high", "max"];
const KEY_SOURCE: Record<Settings["keySource"], string> = {
  env: "ANTHROPIC_API_KEY from the server environment (takes priority over a saved key)",
  profile: "Key from your Claude profile",
  settings: "Key saved in Motion Studio settings",
  none: "No key — the director is offline",
};

/** Director settings form (model · effort · key). Used inline on /account and in the studio dialog. */
export const SettingsForm = ({ onSaved, onCancel, compact }: { onSaved?: (s: Settings) => void; onCancel?: () => void; compact?: boolean }) => {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then((r) => { setS(r); setModel(r.model); setEffort(r.effort); }).catch((e) => setErr(e.message));
  }, []);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const r = await api.saveSettings({ model, effort, ...(key.trim() ? { apiKey: key.trim() } : {}) });
      setS(r);
      setKey("");
      onSaved?.(r);
      toast.success("Director settings saved", r.hasApiKey ? `${r.model} · ${r.effort}` : "No API key yet — the director stays offline.");
    } catch (e2) {
      toast.error("Couldn't save settings", (e2 as Error).message);
    } finally { setSaving(false); }
  };

  if (err) return <div className="callout error"><span className="mono">{err}</span></div>;
  if (!s) return <div className="form-loading"><Spinner size={16} /><span className="label">Reading settings</span></div>;
  const models = Array.from(new Set([...(s.models ?? []), s.model]));
  const dirty = model !== s.model || effort !== s.effort || !!key.trim();
  return (
    <form className={`form settings-form ${compact ? "compact" : ""}`} onSubmit={save}>
      <div className="form-row two">
        <div className="field">
          <span className="label">Model</span>
          <Select label="Model" mono value={model} onChange={setModel} options={models.map((m) => ({ value: m }))} />
        </div>
        <div className="field">
          <span className="label">Effort</span>
          <Segmented label="Effort" value={effort} onChange={setEffort} options={Array.from(new Set([...EFFORTS, s.effort])).map((e) => ({ value: e, label: e }))} />
        </div>
      </div>
      <label className="field">
        <span className="label">Anthropic API key</span>
        <div className="input-icon">
          <IconKey size={14} />
          <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder={s.hasApiKey ? "•••••••••••••••• leave blank to keep" : "sk-ant-…"}
            value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <span className={`key-status ${s.hasApiKey ? "ok" : "none"}`}><i />{KEY_SOURCE[s.keySource] ?? s.keySource}</span>
        {s.keySource === "env" && <span className="callout warn">A key saved here is ignored while ANTHROPIC_API_KEY is set on the server.</span>}
        <span className="field-hint">Stored only on the server (~/.config/motion-studio, mode 600) and sent straight to Anthropic — never back to the browser.</span>
      </label>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn primary" disabled={saving || !dirty}>{saving ? <Spinner /> : <IconCheck size={14} />}Save settings</button>
      </div>
    </form>
  );
};

export const SettingsDialog = ({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (s: Settings) => void }) => (
  <Dialog open={open} onClose={onClose} title="Director" label="Settings" subtitle="The model that writes and revises your Scene Specs." width={560}>
    {open && <SettingsForm compact onCancel={onClose} onSaved={(s) => { onSaved?.(s); onClose(); }} />}
  </Dialog>
);
