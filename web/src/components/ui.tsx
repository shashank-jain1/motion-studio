import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconAlert, IconClose } from "./Icons";

/** Modal dialog: portal, focus trap-lite, Esc / backdrop to close, enter/exit animation. */
export const Dialog = ({ open, onClose, title, subtitle, children, footer, width = 480 }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) => {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 180);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      if (ref.current?.contains(document.activeElement)) return;
      const el = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.dialog-close)");
      el?.focus();
    }, 20);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className={`dialog-backdrop ${open ? "is-open" : "is-closing"}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" style={{ width }}>
        <header className="dialog-head">
          <div>
            <h2 className="dialog-title">{title}</h2>
            {subtitle && <p className="dialog-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn ghost dialog-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

/** Full-screen image viewer with ←/→ through a set. */
export const Lightbox = ({ images, index, onClose, onIndex }: { images: { url: string; label?: string }[]; index: number; onClose: () => void; onIndex: (i: number) => void }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex((index + 1) % images.length);
      else if (e.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, images.length, onClose, onIndex]);
  const img = images[index];
  if (!img) return null;
  return createPortal(
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <img key={img.url} src={img.url} alt={img.label ?? "Preview"} className="lightbox-img" />
      <div className="lightbox-bar">
        {img.label && <span>{img.label}</span>}
        {images.length > 1 && <span className="muted">{index + 1} / {images.length}</span>}
      </div>
      {images.length > 1 && (
        <div className="lightbox-strip">
          {images.map((im, i) => (
            <button key={im.url + i} className={`lightbox-thumb ${i === index ? "is-active" : ""}`} onClick={() => onIndex(i)}>
              <img src={im.url} alt="" />
            </button>
          ))}
        </div>
      )}
      <button className="icon-btn lightbox-close" onClick={onClose} aria-label="Close"><IconClose /></button>
    </div>,
    document.body,
  );
};

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[${this.props.label ?? "ui"}]`, error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`error-card ${this.props.compact ? "compact" : ""}`} role="alert">
        <IconAlert size={18} />
        <div>
          <div className="error-title">{this.props.label ? `${this.props.label} crashed` : "Something went wrong"}</div>
          <pre className="error-msg">{this.state.error.message}</pre>
          <button className="btn sm" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}

export const Skeleton = ({ w, h, r, className }: { w?: number | string; h?: number | string; r?: number; className?: string }) => (
  <div className={`skeleton ${className ?? ""}`} style={{ width: w, height: h, borderRadius: r }} />
);

export const FormatGlyph = ({ format, size = 14 }: { format: string; size?: number }) => {
  const [w, h] = format.split(":").map(Number);
  const s = size / Math.max(w || 1, h || 1);
  return <span className="format-glyph" style={{ width: Math.max(4, (w || 1) * s), height: Math.max(4, (h || 1) * s) }} />;
};

export const FormatBadge = ({ format }: { format: string }) => (
  <span className="badge"><FormatGlyph format={format} size={10} />{format}</span>
);

/** Hook: true while `value` is held for at least `ms` (delayed spinners avoid flashes). */
export const useDelayed = (value: boolean, ms = 200) => {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (!value) { setV(false); return; }
    const t = setTimeout(() => setV(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};
