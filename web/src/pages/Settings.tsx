import { useEffect, useState } from "react";
import { api, type Settings } from "../api";
import { Dialog } from "../components/ui";
import { IconKey, Spinner } from "../components/Icons";
import { useToast } from "../components/Toast";

const EFFORTS = ["low", "medium", "high", "max"];
const KEY_SOURCE: Record<Settings["keySource"], string> = {
  env: "Using ANTHROPIC_API_KEY from the server environment — it takes priority over any key saved here",
  profile: "Using the key from your Claude profile",
  settings: "Using the key saved in Motion Studio settings",
  none: "No API key configured — the director can't run yet",
};

export const SettingsDialog = ({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (s: Settings) => void }) => {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setKey("");
    api.settings().then((r) => { setS(r); setModel(r.model); setEffort(r.effort); }).catch((e) => setErr(e.message));
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveSettings({ model, effort, ...(key.trim() ? { apiKey: key.trim() } : {}) });
      setS(r);
      setKey("");
      onSaved?.(r);
      toast.success("Settings saved", r.hasApiKey ? undefined : "No API key yet — the director stays offline until you add one.");
      onClose();
    } catch (e) {
      toast.error("Couldn't save settings", (e as Error).message);
    } finally { setSaving(false); }
  };

  const models = s ? Array.from(new Set([...(s.models ?? []), s.model])) : [];
  return (
    <Dialog open={open} onClose={onClose} title="Settings" subtitle="The AI director that writes your scene specs."
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!s || saving}>{saving && <Spinner />}Save</button>
      </>}>
      {err && <div className="callout error">{err}</div>}
      {!s && !err && <div className="dialog-loading"><Spinner size={18} /></div>}
      {s && (
        <div className="form">
          <div className="form-row two">
            <label className="field">
              <span className="field-label">Model</span>
              <div className="select-wrap">
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Effort</span>
              <div className="segmented">
                {Array.from(new Set([...EFFORTS, s.effort])).map((e) => (
                  <button key={e} type="button" className={effort === e ? "is-active" : ""} onClick={() => setEffort(e)}>{e}</button>
                ))}
              </div>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Anthropic API key</span>
            <div className="input-icon">
              <IconKey size={14} />
              <input type="password" autoComplete="off" spellCheck={false} autoFocus={!s.hasApiKey} placeholder={s.hasApiKey ? "•••••••••••• (leave blank to keep)" : "sk-ant-…"}
                value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
            <span className={`key-status ${s.hasApiKey ? "ok" : "none"}`}><i />{KEY_SOURCE[s.keySource] ?? s.keySource}</span>
            {s.keySource === "env" && <span className="callout warn">A key saved here is ignored while ANTHROPIC_API_KEY is set in the server's environment. Unset it to use this one.</span>}
            <span className="field-hint">Bring your own key: it's stored only on this machine (~/.config/motion-studio, mode 600) and sent straight to Anthropic — never back to the browser.</span>
          </label>
        </div>
      )}
    </Dialog>
  );
};
