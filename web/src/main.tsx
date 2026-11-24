import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { ToastProvider } from "./components/Toast";
import { ErrorBoundary } from "./components/ui";
import { AuthProvider, RequireAuth, useAuth } from "./auth";
import { BootSlate } from "./components/BootSlate";
import { Home } from "./pages/Home";
import { AuthPage } from "./pages/Auth";
import { NotFound } from "./pages/NotFound";
const Studio = lazy(() => import("./studio/Studio").then((m) => ({ default: m.Studio })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const Consent = lazy(() => import("./pages/Consent").then((m) => ({ default: m.Consent })));
const Landing = lazy(() => import("./site/Landing"));

const guard = (el: React.ReactNode) => <RequireAuth><Suspense fallback={<BootSlate />}>{el}</Suspense></RequireAuth>;
const site = <Suspense fallback={<BootSlate />}><Landing /></Suspense>;

/** `/`: your projects when signed in (always in local mode); the product site for visitors, or when the API is down. */
const Root = () => {
  const { me, error } = useAuth();
  if (!me && !error) return <BootSlate />;
  if (me && (me.mode === "local" || me.user)) return guard(<Home />);
  return site;
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary label="Motion Studio">
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/signup" element={<AuthPage mode="signup" />} />
              <Route path="/" element={<Root />} />
              <Route path="/about" element={site} />
              <Route path="/p/:id" element={guard(<Studio />)} />
              <Route path="/account" element={guard(<Account />)} />
              <Route path="/connect/authorize" element={guard(<Consent />)} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
