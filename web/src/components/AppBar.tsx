import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import { IconLogout, IconUser, Logo } from "./Icons";

export const Wordmark = ({ compact }: { compact?: boolean }) => (
  <span className="wordmark"><Logo size={20} />{!compact && <span className="wordmark-text">MOTION<i>/</i>STUDIO</span>}</span>
);

/** Global 44px bar: brand · crumbs · right-side readouts · nav · user. */
export const AppBar = ({ crumbs, right, nav = true, compact }: { crumbs?: ReactNode; right?: ReactNode; nav?: boolean; compact?: boolean }) => (
  <header className="appbar">
    <div className="appbar-left">
      <Link to="/" className="brand-link" aria-label="Motion Studio — projects"><Wordmark compact={compact} /></Link>
      {crumbs && <span className="appbar-sep" aria-hidden />}
      {crumbs}
    </div>
    <div className="appbar-right">
      {right}
      {nav && (
        <nav className="appbar-nav" aria-label="Primary">
          <NavLink to="/" end className={({ isActive }) => `navlink ${isActive ? "is-active" : ""}`}>Projects</NavLink>
          <NavLink to="/account" className={({ isActive }) => `navlink ${isActive ? "is-active" : ""}`}>Account</NavLink>
        </nav>
      )}
      <UserMenu />
    </div>
  </header>
);

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const UserMenu = () => {
  const { user, hosted, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", off); window.removeEventListener("keydown", esc); };
  }, [open]);
  if (!user) return null;
  return (
    <div className="usermenu" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${user.name}`}>
        {initials(user.name)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <div className="menu-name">{user.name}</div>
            <div className="menu-email mono">{user.email}</div>
            <div className="label">{hosted ? "Hosted workspace" : "Local studio"}</div>
          </div>
          <Link role="menuitem" className="menu-item" to="/account" onClick={() => setOpen(false)}><IconUser size={14} />Account &amp; tokens</Link>
          {hosted && <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); void logout(); }}><IconLogout size={14} />Sign out</button>}
        </div>
      )}
    </div>
  );
};
