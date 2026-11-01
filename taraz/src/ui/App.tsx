import { Suspense, lazy, type ReactNode } from "react";
import { Routes, Route, Navigate, useParams, useLocation } from "react-router";
import { Spin, Result, Button } from "antd";
import { useSession } from "./lib/session";
import { OrgProvider, useOrgQuery } from "./lib/org";
import { AppShell } from "./components/layout";
import { ROUTES } from "./modules/registry";
import { errorText } from "./lib/api";

const Login = lazy(() => import("./pages/auth/Login"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const Recover = lazy(() => import("./pages/auth/Recover"));
const Setup = lazy(() => import("./pages/auth/Setup"));
const Orgs = lazy(() => import("./pages/orgs/Orgs"));
const OrgWizard = lazy(() => import("./pages/orgs/OrgWizard"));

export function Loading({ full }: { full?: boolean }) {
  return (
    <div className={`grid place-content-center ${full ? "h-screen" : "h-64"}`}>
      <Spin size="large" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, meta, loading } = useSession();
  const loc = useLocation();
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
    last = localStorage.getItem("taraz.lastOrg");
  } catch {
    /* ignore */
  }
  const target = me.orgs.find((o) => o.id === last) ?? (me.orgs.length === 1 ? me.orgs[0] : null);
  if (target) return <Navigate to={`/${target.id}`} replace />;
  return <Navigate to={me.orgs.length ? "/orgs" : "/orgs/new"} replace />;
}

function OrgArea() {
  const { org } = useParams();
  const q = useOrgQuery(org ?? "");
  if (q.isLoading) return <Loading full />;
  if (q.error || !q.data)
    return (
      <Result
        status="warning"
        title="دسترسی به این کسب‌وکار ممکن نیست"
        subTitle={q.error ? errorText(q.error) : undefined}
        extra={<Button href="/orgs">فهرست کسب‌وکارها</Button>}
      />
    );
  return (
    <OrgProvider orgId={org!} info={q.data}>
      <AppShell>
        <Suspense fallback={<Loading />}>
          <Routes>
            {ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="*" element={<Result status="404" title="این صفحه پیدا نشد" extra={<Button href={`/${org}`}>بازگشت به پیشخوان</Button>} />} />
          </Routes>
        </Suspense>
      </AppShell>
    </OrgProvider>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading full />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/orgs" element={<RequireAuth><Orgs /></RequireAuth>} />
        <Route path="/orgs/new" element={<RequireAuth><OrgWizard /></RequireAuth>} />
        <Route path="/:org/*" element={<RequireAuth><OrgArea /></RequireAuth>} />
      </Routes>
    </Suspense>
  );
}
