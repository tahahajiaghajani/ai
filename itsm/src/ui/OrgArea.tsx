// The signed-in app inside an organisation (its own chunk, loaded by App.tsx when someone is signed in): the shell,
// every module's routes (src/ui/modules/registry.tsx) and, through them, the table definitions.
import { Fragment, type ReactNode } from "react";
import { Suspense } from "@ui/lib/lazy";
import { Routes, Route, useParams, useLocation, useNavigate } from "react-router";
import { Result, Button } from "antd";
import { Compass } from "lucide-react";
import { OrgProvider, useOrgQuery } from "./lib/org";
import { AppShell } from "./components/layout";
import { PageBoundary } from "./components/crash";
import { ROUTES } from "./modules/registry";
import { ApiError, errorText } from "./lib/api";
import { Loading } from "./App";

/** Answers that mean the server could not answer now (src/server/http/errors.ts, src/server/cloud.ts, ./lib/api.ts). */
const SERVER_DOWN = new Set(["db_busy", "db_timeout", "db_locked", "db_unavailable", "timeout", "retry", "gateway_timeout", "unavailable", "network"]);

/**
 * What the organisation page says when the organisation did not load: a server that cannot answer now is not «no
 * access» — it offers to try again; a read-only database says so; anything else (not a member, not found) as before.
 */
export function orgErrorView(code: string | null | undefined): { title: string; retry: boolean } {
  if (code && SERVER_DOWN.has(code)) return { title: "سرور اکنون پاسخ نمی‌دهد", retry: true };
  if (code === "db_read_only") return { title: "پایگاه داده فقط‌خواندنی است", retry: false };
  return { title: "دسترسی به این سازمان ممکن نیست", retry: false };
}

/**
 * A page of the signed-in app, mounted afresh for every path. Routes such as <module>/<records>/:id
 * and <module>/<records>/new render the same component at the same place, so React would otherwise
 * keep the open record's state (record #12's fields in the «تازه» form). Only the path counts: a
 * page changing its own query string keeps its state.
 */
function Page({ org, children }: { org: string; children: ReactNode }) {
  const { pathname } = useLocation();
  // the page enters with the shared motion (opacity + an 8 px rise; opacity only under reduced motion); a page that
  // throws while rendering shows its own error state inside the shell instead of blanking the app
  return (
    <Fragment key={pathname}>
      <div className="ds-enter">
        <PageBoundary home={`/${org}`}>{children}</PageBoundary>
      </div>
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

export default function OrgArea() {
  const { org } = useParams();
  const q = useOrgQuery(org ?? "");
  if (q.isLoading) return <Loading full />;
  if (q.error || !q.data) {
    const view = orgErrorView(q.error instanceof ApiError ? q.error.code : null);
    return (
      <Result
        status="warning"
        title={view.title}
        subTitle={q.error ? errorText(q.error) : undefined}
        extra={
          <>
            {view.retry ? (
              <Button type="primary" loading={q.isFetching} onClick={() => void q.refetch()}>
                دوباره امتحان کنید
              </Button>
            ) : null}
            <Button href="/orgs">فهرست سازمان‌ها</Button>
          </>
        }
      />
    );
  }
  return (
    <OrgProvider orgId={org!} info={q.data}>
      <AppShell>
        <Suspense fallback={<Loading />}>
          <Routes>
            {ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={<Page org={org!}>{r.element}</Page>} />
            ))}
            <Route path="*" element={<NotFound org={org!} />} />
          </Routes>
        </Suspense>
      </AppShell>
    </OrgProvider>
  );
}

