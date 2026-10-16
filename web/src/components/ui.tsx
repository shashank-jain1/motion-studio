import { Component, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconAlert, IconCheck, IconChevronDown, IconClose, IconCopy } from "./Icons";

/** Modal dialog: portal, focus trap-lite, Esc / backdrop to close, wipe-in/out. */
export const Dialog = ({ open, onClose, title, subtitle, children, footer, width = 480, label }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; label?: string;
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
      const el = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("input, textarea, button:not(.dialog-close)");
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
            {label && <div className="label">{label}</div>}
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

/** Full-screen frame viewer with ←/→ through a set and a perforated strip of all frames. */
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
      <div className="lightbox-bar">
        <span className="label">Frame</span>
        <span className="mono">{img.label}</span>
        <span className="spacer" />
        {images.length > 1 && <span className="mono dim">{String(index + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>}
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close"><IconClose /></button>
      </div>
      <div className="lightbox-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="crop-frame"><CropMarks /><img key={img.url} src={img.url} alt={img.label ?? "Preview"} className="lightbox-img" /></div>
      </div>
      {images.length > 1 && (
        <div className="lightbox-strip perf">
          {images.map((im, i) => (
            <button key={im.url + i} className={`strip-frame ${i === index ? "is-active" : ""}`} onClick={() => onIndex(i)}>
              <img src={im.url} alt="" />
              <span>{im.label ?? i + 1}</span>
            </button>
          ))}
        </div>
      )}
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
        <IconAlert size={16} />
        <div>
          <div className="label">{this.props.label ? `${this.props.label} — fault` : "Fault"}</div>
          <pre className="error-msg">{this.state.error.message}</pre>
          <button className="btn sm" onClick={() => this.setState({ error: null })}>Reset module</button>
        </div>
      </div>
    );
  }
}

export const Skeleton = ({ w, h, className }: { w?: number | string; h?: number | string; r?: number; className?: string }) => (
  <div className={`skeleton ${className ?? ""}`} style={{ width: w, height: h }} />
);

export const FormatGlyph = ({ format, size = 12 }: { format: string; size?: number }) => {
  const [w, h] = format.split(":").map(Number);
  const s = size / Math.max(w || 1, h || 1);
  return <span className="format-glyph" style={{ width: Math.max(4, Math.round((w || 1) * s)), height: Math.max(4, Math.round((h || 1) * s)) }} />;
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

/** Engraved label over a mono value (hardware status strip). */
export const Readout = ({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) => (
  <div className={`readout ${className ?? ""}`}>
    <span className="label">{label}</span>
    <span className="readout-value">{children}</span>
  </div>
);

/** Rolling digits: each digit is a 0–9 column translated into view (expoOut). Non-digits render static. */
export const Odometer = ({ value, className }: { value: string | number; className?: string }) => {
  const chars = String(value).split("");
  return (
    <span className={`odo ${className ?? ""}`} aria-label={String(value)}>
      {chars.map((c, i) => {
        const key = chars.length - i; // align from the right so columns keep identity
        if (!/\d/.test(c)) return <span key={`s${key}`} className="odo-static" aria-hidden>{c}</span>;
        return (
          <span key={`d${key}`} className="odo-digit" aria-hidden>
            <span className="odo-col" style={{ transform: `translateY(${-Number(c) * 10}%)` }}>
              {"0123456789".split("").map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
};

/** Diagonal clapper stripes (film slate). */
export const SlateStripe = ({ className, tally }: { className?: string; tally?: boolean }) => <div className={`slate-stripe ${tally ? "is-tally" : ""} ${className ?? ""}`} aria-hidden />;

/** Corner registration marks around the parent (parent must be position: relative). */
export const CropMarks = ({ inset = -10 }: { inset?: number }) => (
  <span className="crop-marks" aria-hidden style={{ inset }}>
    <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
  </span>
);

export const TallyDot = ({ live = true, label }: { live?: boolean; label?: string }) => (
  <span className={`tally ${live ? "is-live" : ""}`} role={label ? "status" : undefined} aria-label={label}><i /></span>
);

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export const CopyButton = ({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) => {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* */ } ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  }, [text]);
  return (
    <button type="button" className={`btn sm copy-btn ${done ? "is-done" : ""} ${className ?? ""}`} onClick={copy} aria-live="polite">
      {done ? <IconCheck size={14} /> : <IconCopy size={14} />}<span>{done ? "Copied" : label}</span>
    </button>
  );
};

/** Segmented control (radio group). */
export const Segmented = <T extends string>({ value, options, onChange, label, size }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: "sm";
}) => (
  <div className={`segmented ${size ?? ""}`} role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title}
        className={value === o.value ? "is-active" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
    ))}
  </div>
);

/** Custom select (listbox) — no native control chrome. */
export const Select = ({ value, options, onChange, label, mono }: { value: string; options: { value: string; label?: ReactNode; hint?: ReactNode }[]; onChange: (v: string) => void; label: string; mono?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const cur = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(options[hi].value); setOpen(false); }
  };
  return (
    <div className={`select ${open ? "is-open" : ""}`} ref={ref}>
      <button type="button" className={`select-btn ${mono ? "mono" : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        aria-controls={id} onClick={() => setOpen((o) => !o)} onKeyDown={onKey}>
        <span>{cur?.label ?? cur?.value ?? value}</span><IconChevronDown size={14} />
      </button>
      {open && (
        <ul className="select-list" role="listbox" id={id} aria-label={label}>
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className={`${i === hi ? "is-hi" : ""} ${mono ? "mono" : ""}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}>
              <span>{o.label ?? o.value}</span>{o.hint && <em>{o.hint}</em>}{o.value === value && <IconCheck size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Element is (or has been) on screen. */
export const useInView = <T extends Element>(rootMargin = "200px") => {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen] as const;
};

export const useReducedMotion = () => {
  const [r, setR] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const f = () => setR(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
};
