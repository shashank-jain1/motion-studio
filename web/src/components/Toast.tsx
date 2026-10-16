import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconClose, IconInfo } from "./Icons";

type Kind = "info" | "success" | "error";
type Toast = { id: number; kind: Kind; title: string; body?: string; leaving?: boolean };
type ToastApi = { show: (kind: Kind, title: string, body?: string) => void; success: (t: string, b?: string) => void; error: (t: string, b?: string) => void; info: (t: string, b?: string) => void };

const Ctx = createContext<ToastApi | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 200);
  }, []);
  const show = useCallback((kind: Kind, title: string, body?: string) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-4), { id, kind, title, body }]);
    setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3800);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    show, success: (t, b) => show("success", t, b), error: (t, b) => show("error", t, b), info: (t, b) => show("info", t, b),
  }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind} ${t.leaving ? "is-leaving" : ""}`} role={t.kind === "error" ? "alert" : "status"}>
            <span className="toast-icon">{t.kind === "success" ? <IconCheck size={14} /> : t.kind === "error" ? <IconAlert size={14} /> : <IconInfo size={14} />}</span>
            <div className="toast-text">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button className="icon-btn sm ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss"><IconClose size={13} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
};

export const useToast = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
};
