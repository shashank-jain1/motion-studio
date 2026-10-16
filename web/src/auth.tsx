import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, type Me, type User } from "./api";
import { BootSlate } from "./components/BootSlate";

type AuthApi = {
  me: Me | null;
  error: string | null;
  user: User | null;
  hosted: boolean;
  refresh: () => Promise<Me | null>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthApi | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m); setError(null);
      return m;
    } catch (e) {
      // Older servers (Phase 2) have no auth routes: behave like local mode.
      const status = (e as { status?: number }).status;
      if (status === 404) { const m: Me = { user: { id: "local", email: "local@motion.studio", name: "Local owner" }, mode: "local" }; setMe(m); return m; }
      setError((e as Error).message);
      return null;
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // any 401 from the API in hosted mode → back to /login
  useEffect(() => {
    const on = () => {
      if (me?.mode !== "hosted") return;
      setMe((m) => (m ? { ...m, user: null } : m));
      if (!/^\/(login|signup)/.test(loc.pathname)) nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
    };
    window.addEventListener("ms:unauthorized", on);
    return () => window.removeEventListener("ms:unauthorized", on);
  }, [me?.mode, loc, nav]);

  const value = useMemo<AuthApi>(() => ({
    me, error, user: me?.user ?? null, hosted: me?.mode === "hosted", refresh,
    setUser: (u) => setMe((m) => (m ? { ...m, user: u } : { user: u, mode: "hosted" })),
    logout: async () => {
      try { await api.logout(); } catch { /* */ }
      setMe((m) => (m ? { ...m, user: null } : m));
      nav("/login", { replace: true });
    },
  }), [me, error, refresh, nav]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
};

/** Hosted mode + signed out → /login?next=… . Local mode always passes. */
export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { me, error, refresh } = useAuth();
  const loc = useLocation();
  if (!me && error) return <BootSlate title="Can't reach the studio" detail={error} action={{ label: "Retry", onClick: () => void refresh() }} />;
  if (!me) return <BootSlate />;
  if (me.mode === "hosted" && !me.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
};
