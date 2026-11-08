// Sign-in-free pages (/p/…; this folder is not named "public": that is the build output): what an organisation published on purpose — the service status page by its secret link,
// next public knowledge. Modules add their pages with `ModuleUi.publicRoutes` (paths under /p/); a page reads only the
// sign-in-free API (`publicGet`, /api/public, rate limited) — never an organisation's API, which needs a session. The
// frame is quiet: the product's mark, the page, a line that says it is a published page. RTL, tokens only.
import { Suspense, type ReactNode } from "react";
import { Routes, Route } from "react-router";
import { Compass } from "lucide-react";
import { Logo } from "../../components/brand";
import { PUBLIC_ROUTES } from "../../modules/registry";
import { Loading } from "../../App";
import "./public.css";

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pub-shell" dir="rtl">
      <header className="pub-head">
        <Logo size={20} />
      </header>
      <main className="pub-main">{children}</main>
      <footer className="pub-foot">این صفحه برای همگان منتشر شده است؛ برای کار با سامانه وارد شوید.</footer>
    </div>
  );
}

function PublicNotFound() {
  return (
    <div className="sh-empty" role="status">
      <span className="sh-empty-tile" aria-hidden>
        <Compass size={28} strokeWidth={1.4} absoluteStrokeWidth />
      </span>
      <h1 className="sh-empty-t">این صفحه پیدا نشد</h1>
      <p className="sh-empty-d">پیوند منتشرشده عوض شده یا انتشار آن متوقف شده است.</p>
    </div>
  );
}

export default function PublicArea() {
  return (
    <PublicFrame>
      <Suspense fallback={<Loading />}>
        <Routes>
          {PUBLIC_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<PublicNotFound />} />
        </Routes>
      </Suspense>
    </PublicFrame>
  );
}
