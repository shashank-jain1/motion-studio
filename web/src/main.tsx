import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { ToastProvider } from "./components/Toast";
import { ErrorBoundary } from "./components/ui";
import { Home } from "./pages/Home";
const Studio = lazy(() => import("./studio/Studio").then((m) => ({ default: m.Studio })));
import { NotFound } from "./pages/NotFound";
import { Spinner } from "./components/Icons";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary label="Motion Studio">
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/p/:id" element={<Suspense fallback={<div className="boot"><Spinner size={18} /></div>}><Studio /></Suspense>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
