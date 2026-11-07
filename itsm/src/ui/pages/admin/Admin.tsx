// «مدیریت سامانه» — the platform admin's console, in its own frame (no business is open here):
// پیشخوان، سازمان‌ها، کاربران، هوش مصنوعی، رویدادهای امنیتی، سلامت سامانه. Every section lives at
// /admin/<section>; a business opens at /admin/orgs/<id>, an account at /admin/users/<id>.
import "./admin.css";
import { lazy, Suspense, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { Activity, ArrowRight, Building2, Gauge, HeartPulse, LogOut, ShieldAlert, Users } from "lucide-react";
import { AiIcon } from "../../components/shell/icons";
import { Link, useLocation, useNavigate } from "react-router";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/brand";
import { Loader } from "../../components/display";
import { PlainFrame, ThemeToggle, initials } from "../kit";
import { ICON, useAdminQuery } from "./ui";

const Overview = lazy(() => import("./Overview"));
const Orgs = lazy(() => import("./Orgs"));
const OrgDetail = lazy(() => import("./OrgDetail"));
const UsersPage = lazy(() => import("./Users"));
const Ai = lazy(() => import("./Ai"));
const Security = lazy(() => import("./Security"));
const Health = lazy(() => import("./Health"));

const NAV = [
  { key: "", title: "پیشخوان", icon: Gauge },
  { key: "orgs", title: "سازمان‌ها", icon: Building2 },
  { key: "users", title: "کاربران", icon: Users },
  { key: "ai", title: "هوش مصنوعی", icon: AiIcon },
  { key: "security", title: "رویدادهای امنیتی", icon: ShieldAlert },
  { key: "health", title: "سلامت سامانه", icon: HeartPulse },
] as const;

/** "/admin/orgs/<id>" → ["orgs", "<id>"] */
function useSection(): [string, string | null] {
  const { pathname } = useLocation();
  const [, , section = "", id = null] = pathname.replace(/\/+$/, "").split("/");
  return [section, id];
}

function Nav({ support }: { support: number }) {
  const [section] = useSection();
  return (
    <nav className="ad-nav" aria-label="بخش‌های مدیریت سامانه">
      {NAV.map((n) => (
        <Link key={n.key} to={n.key ? `/admin/${n.key}` : "/admin"} aria-current={section === n.key ? "page" : undefined}>
          <n.icon {...ICON} aria-hidden />
          {n.title}
          {n.key === "orgs" && support ? (
            <Tooltip title="حالت پشتیبانی در جریان">
              <span className="ad-nav-badge ds-num">{support}</span>
            </Tooltip>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const live = useAdminQuery<{ sessions: unknown[] }>(["support", "live"], "/admin/support", { active: 1 });
  const support = live.data?.sessions.length ?? 0;
  const user = me!.user;
  return (
    <div className="ad-app">
      <aside className="ad-side">
        <Link to="/admin" className="ad-brand" aria-label="پیشخوان مدیریت سامانه">
          <Logo size={20} />
          <span className="ad-brand-t">مدیریت سامانه</span>
        </Link>
        <Nav support={support} />
        <div className="ad-side-foot">
          <Button type="text" icon={<ArrowRight {...ICON} />} className="!justify-start" onClick={() => nav("/orgs")}>
            سازمان‌های من
          </Button>
          <div className="ad-me">
            <span className="ad-av" aria-hidden>
              {initials(user.full_name)}
            </span>
            <span className="ad-me-n">{user.full_name}</span>
            <span className="ms-auto inline-flex">
              <ThemeToggle />
              <Tooltip title="خروج">
                <Button type="text" aria-label="خروج" icon={<LogOut {...ICON} />} onClick={logout} />
              </Tooltip>
            </span>
          </div>
        </div>
      </aside>
      <div className="ad-main">
        <header className="ad-top">
          <div className="ad-top-row">
            <Link to="/admin" aria-label="پیشخوان مدیریت سامانه" className="inline-flex items-center gap-2">
              <Logo size={18} />
              <span className="ad-brand-t">مدیریت سامانه</span>
            </Link>
            <span className="ad-top-end">
              <Tooltip title="سازمان‌های من">
                <Button type="text" aria-label="سازمان‌های من" icon={<Building2 {...ICON} />} onClick={() => nav("/orgs")} />
              </Tooltip>
              <ThemeToggle />
              <Tooltip title="خروج">
                <Button type="text" aria-label="خروج" icon={<LogOut {...ICON} />} onClick={logout} />
              </Tooltip>
            </span>
          </div>
          <Nav support={support} />
        </header>
        <main className="ad-page" id="main">
          <Suspense
            fallback={
              <div className="grid min-h-60 place-items-center">
                <Loader />
              </div>
            }
          >
            {children}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function Section() {
  const [section, id] = useSection();
  if (section === "orgs") return id ? <OrgDetail key={id} id={id} /> : <Orgs />;
  if (section === "users") return <UsersPage openId={id} />;
  if (section === "ai") return <Ai />;
  if (section === "security") return <Security />;
  if (section === "health") return <Health />;
  return <Overview />;
}

export default function Admin() {
  const { me } = useSession();
  const nav = useNavigate();
  if (!me?.user.is_platform_admin)
    return (
      <PlainFrame>
        <div className="pg-list">
          <div className="pg-empty">
            <span className="pg-empty-tile">
              <Activity size={28} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
            </span>
            <h2>این بخش فقط برای مدیر سامانه است.</h2>
            <Button onClick={() => nav("/orgs")}>بازگشت به سازمان‌ها</Button>
          </div>
        </div>
      </PlainFrame>
    );
  return (
    <Frame>
      <Section />
    </Frame>
  );
}
