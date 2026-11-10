import { Fragment, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useParams, useLocation, useNavigate } from "react-router";
import { Result, Button } from "antd";
import { Compass } from "lucide-react";
import { useSession } from "./lib/session";
import { OrgProvider, useOrgQuery } from "./lib/org";
import { AppShell } from "./components/layout";
import { BrandMark } from "./components/brand";
import { ROUTES } from "./modules/registry";
import { errorText } from "./lib/api";

const Login = lazy(() => import("./pages/auth/Login"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const Recover = lazy(() => import("./pages/auth/Recover"));
const Setup = lazy(() => import("./pages/auth/Setup"));
const Orgs = lazy(() => import("./pages/orgs/Orgs"));
const OrgWizard = lazy(() => import("./pages/orgs/OrgWizard"));
const Admin = lazy(() => import("./pages/admin/Admin"));
const PublicArea = lazy(() => import("./pages/published/PublicArea"));
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
    last = localStorage.getItem("itsm.lastOrg");
  } catch {
    /* ignore */
  }
  const target = me.orgs.find((o) => o.id === last) ?? (me.orgs.length === 1 ? me.orgs[0] : null);
  if (target) return <Navigate to={`/${target.id}`} replace />;
  return <Navigate to={me.orgs.length ? "/orgs" : "/orgs/new"} replace />;
}

/**
 * A page of the signed-in app, mounted afresh for every path. Routes such as <module>/<records>/:id
 * and <module>/<records>/new render the same component at the same place, so React would otherwise
 * keep the open record's state (record #12's fields in the «تازه» form). Only the path counts: a
 * page changing its own query string keeps its state.
 */
function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // the page enters with the shared motion (opacity + an 8 px rise; opacity only under reduced motion)
  return (
    <Fragment key={pathname}>
      <div className="ds-enter">{children}</div>
    </Fragment>
  );
}

/** A route of the organisation that does not exist: the empty state of components.md §7. */
function NotFound({ org }: { org: string }) {
  const nav = useNavigate();
  return (
    <div className="sh-empty ds-enter" role="status">
      <span className="sh-empty-tile" aria-hidden>
        <Compass size={28} strokeWidth={1.4} absoluteStrokeWidth />
      </span>
      <h1 className="sh-empty-t">این صفحه پیدا نشد</h1>
      <p className="sh-empty-d">نشانی را بررسی کنید، یا از منو و جست‌وجو به صفحهٔ دیگری بروید.</p>
      <Button type="primary" className="sh-empty-a" onClick={() => nav(`/${org}`)}>
        بازگشت به پیشخوان
      </Button>
    </div>
  );
}

function OrgArea() {
  const { org } = useParams();
  const q = useOrgQuery(org ?? "");
  if (q.isLoading) return <Loading full />;
  if (q.error || !q.data)
    return (
      <Result
        status="warning"
        title="دسترسی به این سازمان ممکن نیست"
        subTitle={q.error ? errorText(q.error) : undefined}
        extra={<Button href="/orgs">فهرست سازمان‌ها</Button>}
      />
    );
  return (
    <OrgProvider orgId={org!} info={q.data}>
      <AppShell>
        <Suspense fallback={<Loading />}>
          <Routes>
            {ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={<Page>{r.element}</Page>} />
            ))}
            <Route path="*" element={<NotFound org={org!} />} />
          </Routes>
        </Suspense>
      </AppShell>
    </OrgProvider>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading full />}>
      <Suspense fallback={null}>
        <ReauthGate />
      </Suspense>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/orgs" element={<RequireAuth><Orgs /></RequireAuth>} />
        <Route path="/orgs/new" element={<RequireAuth><OrgWizard /></RequireAuth>} />
        <Route path="/admin/*" element={<RequireAuth><Admin /></RequireAuth>} />
        {/* sign-in-free pages an organisation published (no session needed) */}
        <Route path="/p/*" element={<PublicArea />} />
        <Route path="/:org/*" element={<RequireAuth><OrgArea /></RequireAuth>} />
      </Routes>
    </Suspense>
  );
}
