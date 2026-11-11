import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { useSession } from "./lib/session";
import { BrandMark } from "./components/brand";
import { PageBoundary } from "./components/crash";
import { loadOrgArea, preloadApp } from "./lib/preload";

// The signed-in app — the shell, every module's menu, routes and table definitions — is its own chunk: the sign-in
// page and the boot screen never wait for it, and it starts loading as soon as someone is signed in (or about to be)
const OrgArea = lazy(loadOrgArea);

const Login = lazy(() => import("./pages/auth/Login"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const Recover = lazy(() => import("./pages/auth/Recover"));
const Setup = lazy(() => import("./pages/auth/Setup"));
const ServerSetup = lazy(() => import("./pages/auth/ServerSetup"));
const Orgs = lazy(() => import("./pages/orgs/Orgs"));
const OrgWizard = lazy(() => import("./pages/orgs/OrgWizard"));
const Admin = lazy(() => import("./pages/admin/Admin"));
const PublicArea = lazy(() => import("./pages/published/PublicArea"));
// «آماده‌سازی پایگاه داده»: the web version prepares its database (or cannot reach it) — never a raw server error
const Preparing = lazy(() => import("./pages/auth/Preparing").then((m) => ({ default: m.Preparing })));
// «تأیید دوبارهٔ هویت» before sensitive administration (src/ui/lib/api.ts retries the request once it is confirmed)
const ReauthGate = lazy(() => import("./pages/auth/Reauth").then((m) => ({ default: m.ReauthGate })));

/** True once `ms` have passed since mount: quick loads never flash a loader (components.md §8). */
function useAfter(ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return on;
}

/**
 * Waiting states. `full` (the session, an organisation, the first chunk of a route outside the shell) is
 * the boot screen: the mark at 48 px on the canvas, its nuqtas setting beside the alef (static under
 * reduced motion), shown only after 200 ms. Inside the shell a page that takes over a second shows the
 * three rhombic nuqtas; never a spinner.
 */
export function Loading({ full }: { full?: boolean }) {
  const shown = useAfter(full ? 200 : 1000);
  if (full)
    return (
      <div className="sh-boot" role="status" aria-busy="true" aria-label="در حال بارگذاری">
        {shown ? <BrandMark size={48} launch title="" className="sh-boot-mark" /> : null}
      </div>
    );
  return (
    <div className="sh-wait" role="status" aria-busy="true" aria-label="در حال بارگذاری">
      {shown ? (
        <span className="sh-loader" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </div>
  );
}

/** First run: the Windows app's choices, or the server edition's one-time setup (/setup?token=…). */
function SetupRoute() {
  const { meta, loading } = useSession();
  if (loading && !meta) return <Loading full />;
  return meta?.edition === "server" ? <ServerSetup /> : <Setup />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, meta, loading } = useSession();
  const loc = useLocation();
  // signed in: the app's chunk loads alongside the session's own requests, not after them
  useEffect(() => {
    if (me) preloadApp();
  }, [me]);
  if (loading) return <Loading full />;
  if (meta?.first_run) return <Navigate to="/setup" replace />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

function Home() {
  const { me } = useSession();
  if (!me) return <Navigate to="/login" replace />;
  let last: string | null = null;
  try {
    last = localStorage.getItem("itsm.lastOrg");
  } catch {
    /* ignore */
  }
  const target = me.orgs.find((o) => o.id === last) ?? (me.orgs.length === 1 ? me.orgs[0] : null);
  if (target) return <Navigate to={`/${target.id}`} replace />;
  return <Navigate to={me.orgs.length ? "/orgs" : "/orgs/new"} replace />;
}

export function App() {
  const { serverError } = useSession();
  if (serverError)
    return (
      <PageBoundary>
        <Suspense fallback={<Loading full />}>
          <Preparing error={serverError} />
        </Suspense>
      </PageBoundary>
    );
  return (
    <PageBoundary>
      <Suspense fallback={<Loading full />}>
        <Suspense fallback={null}>
          <ReauthGate />
        </Suspense>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/recover" element={<Recover />} />
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
          <Route path="/orgs" element={<RequireAuth><Orgs /></RequireAuth>} />
          <Route path="/orgs/new" element={<RequireAuth><OrgWizard /></RequireAuth>} />
          <Route path="/admin/*" element={<RequireAuth><Admin /></RequireAuth>} />
          {/* sign-in-free pages an organisation published (no session needed) */}
          <Route path="/p/*" element={<PublicArea />} />
          <Route path="/:org/*" element={<RequireAuth><OrgArea /></RequireAuth>} />
        </Routes>
      </Suspense>
    </PageBoundary>
  );
}
