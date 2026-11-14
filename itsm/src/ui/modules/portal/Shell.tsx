// The requester's portal in its own light shell (PTL-001, PTL-004, PTL-031): a branded header (logo or the portal's
// mark, its name), five destinations — home, services, my requests, knowledge, my tasks — with the assistant and the
// person's menu at the end, a tab bar at the bottom of a phone, and the portal's footer. It covers the app's shell
// (drawn over it and the shell made inert, so focus, the keyboard and screen readers stay in the portal); «میز کار»
// leads agents back. `?embed=1` shows the chat alone (the website widget's window), `?preview=1` an administrator's
// draft home page. The routes below `portal/` are the portal's pages; each loads with its page.
import { useEffect, useMemo, type ReactNode } from "react";
import { lazy, Suspense } from "@ui/lib/lazy";
import { createPortal } from "react-dom";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { Dropdown, type MenuProps } from "antd";
import { Bell, BookOpen, Briefcase, CircleUser, House, LayoutGrid, LogOut, MessageCircle, MessageSquareHeart, Activity, Settings2, ListChecks } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { usePageTitle, useShell } from "../../components/shell/context";
import { Loader } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { usePortalConfig, usePortalTodo, type PortalConfig } from "./api";
import { accentOf, portalPath } from "./model";
import "./portal.css";

const Home = lazy(() => import("./Home"));
const Search = lazy(() => import("./Search"));
const Catalog = lazy(() => import("./Catalog"));
const Item = lazy(() => import("./Item"));
const Report = lazy(() => import("./Report"));
const Requests = lazy(() => import("./Requests"));
const Ticket = lazy(() => import("./Ticket"));
const Todo = lazy(() => import("./Todo"));
const Approval = lazy(() => import("./Approval"));
const Knowledge = lazy(() => import("./Knowledge"));
const Article = lazy(() => import("./Article"));
const ByNumber = lazy(() => import("./Article").then((m) => ({ default: m.ByNumber })));
const Survey = lazy(() => import("./Survey"));
const Profile = lazy(() => import("./Profile"));
const Chat = lazy(() => import("./Chat"));
const Status = lazy(() => import("./Status"));
const Feedback = lazy(() => import("./Feedback"));
const Topic = lazy(() => import("./Topic"));

const I = { size: 18, strokeWidth: 1.5, absoluteStrokeWidth: true } as const;

/**
 * Keep the app's shell beneath out of focus and of the accessibility tree while the portal is open — its command
 * palette (Ctrl K) and assistant too, which live outside `.sh-app` (the shell's `cover`).
 */
function useInertShell() {
  const shell = useShell();
  useEffect(() => {
    shell?.cover(true);
    const app = document.querySelector<HTMLElement>(".sh-app");
    app?.setAttribute("inert", "");
    app?.setAttribute("aria-hidden", "true");
    return () => {
      shell?.cover(false);
      app?.removeAttribute("inert");
      app?.removeAttribute("aria-hidden");
    };
  }, [shell]);
}

/** The portal's configuration for its pages (also passed as a prop where a page needs it). */
export interface PortalPageProps {
  cfg: PortalConfig;
}

function NavLinks({ cfg, todo }: { cfg: PortalConfig; todo: number }) {
  const { orgId } = useOrg();
  const loc = useLocation();
  const rel = loc.pathname.slice(portalPath(orgId).length).replace(/^\/+/, "");
  const at = (key: string) => (key === "" ? rel === "" : rel === key || rel.startsWith(`${key}/`) || (key === "requests" && rel.startsWith("t/")) || (key === "catalog" && rel.startsWith("items/")));
  const links: [string, string, ReactNode][] = [
    ["", "خانه", <House key="i" {...I} />],
    ...(cfg.can.order ? ([["catalog", "خدمات", <LayoutGrid key="i" {...I} />]] as [string, string, ReactNode][]) : []),
    ["requests", "درخواست‌های من", <Briefcase key="i" {...I} />],
    ["kb", "دانش", <BookOpen key="i" {...I} />],
    ["todo", todo ? `کارهای من (${todo.toLocaleString("fa-IR")})` : "کارهای من", <ListChecks key="i" {...I} />],
  ];
  return (
    <nav className="pt-nav" aria-label="بخش‌های درگاه">
      {links.map(([key, label, icon]) => (
        <Link key={key} to={portalPath(orgId, key)} className="pt-navlink" aria-current={at(key) ? "page" : undefined}>
          {icon}
          {label}
        </Link>
      ))}
    </nav>
  );
}

function TabBar({ cfg }: { cfg: PortalConfig }) {
  const { orgId } = useOrg();
  const loc = useLocation();
  const rel = loc.pathname.slice(portalPath(orgId).length).replace(/^\/+/, "");
  const all: [string, string, ReactNode][] = [
    ["", "خانه", <House key="i" {...I} />],
    ...(cfg.can.order ? ([["catalog", "خدمات", <LayoutGrid key="i" {...I} />]] as [string, string, ReactNode][]) : []),
    ["requests", "درخواست‌ها", <Briefcase key="i" {...I} />],
    ...(cfg.portal.chat_enabled ? ([["chat", cfg.portal.chat_name, <MessageCircle key="i" {...I} />]] as [string, string, ReactNode][]) : []),
    ["kb", "دانش", <BookOpen key="i" {...I} />],
    ["todo", "کارها", <ListChecks key="i" {...I} />],
  ];
  // five at most: knowledge gives way when the catalogue and the assistant are both there
  const tabs = all.length > 5 ? all.filter(([key]) => key !== "kb") : all;
  return (
    <nav className="pt-tabbar" aria-label="بخش‌های درگاه">
      {tabs.map(([key, label, icon]) => (
        <Link key={key || "home"} to={portalPath(orgId, key)} className="pt-tab" aria-current={(key === "" ? rel === "" : rel === key || rel.startsWith(`${key}/`) || (key === "requests" && rel.startsWith("t/"))) ? "page" : undefined}>
          {icon}
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Header({ cfg, todo }: { cfg: PortalConfig; todo: number }) {
  const { orgId } = useOrg();
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const items: MenuProps["items"] = [
    { key: "profile", icon: <CircleUser {...I} />, label: "نمایه و اعلان‌ها", onClick: () => navigate(portalPath(orgId, "profile")) },
    { key: "status", icon: <Activity {...I} />, label: "وضعیت خدمات", onClick: () => navigate(portalPath(orgId, "status")) },
    ...(cfg.can.feedback ? [{ key: "feedback", icon: <MessageSquareHeart {...I} />, label: "شکایت، قدردانی یا پیشنهاد", onClick: () => navigate(portalPath(orgId, "feedback")) }] : []),
    { type: "divider" as const },
    ...(cfg.can.agent ? [{ key: "desk", icon: <Briefcase {...I} />, label: "رفتن به میز کار", onClick: () => navigate(`/${orgId}`) }] : []),
    ...(cfg.can.admin ? [{ key: "admin", icon: <Settings2 {...I} />, label: "تنظیم درگاه", onClick: () => navigate(`/${orgId}/portal-admin`) }] : []),
    { key: "out", icon: <LogOut {...I} />, label: "خروج", onClick: () => void logout().then(() => navigate("/login")) },
  ];
  const name = me?.user.full_name || me?.user.email || "";
  return (
    <header className="pt-head">
      <div className="pt-wrap pt-head-in">
        <Link to={portalPath(orgId)} className="pt-brand" aria-label={`${cfg.portal.brand_name} — صفحهٔ اول درگاه`}>
          {cfg.portal.logo_url ? <img src={`/api/o/${orgId}/${cfg.portal.logo_url}`} alt="" /> : <span className="pt-brand-mark" aria-hidden>{cfg.portal.brand_name.trim().slice(0, 1)}</span>}
          <span className="pt-brand-name">{cfg.portal.brand_name}</span>
        </Link>
        <NavLinks cfg={cfg} todo={todo} />
        <div className="pt-head-end">
          <Link to={portalPath(orgId, "todo")} className="pt-iconbtn" aria-label={todo ? `کارهای من: ${todo.toLocaleString("fa-IR")} مورد` : "کارهای من"}>
            <Bell {...I} />
            {todo ? <span className="pt-badge">{todo > 99 ? "۹۹+" : todo.toLocaleString("fa-IR")}</span> : null}
          </Link>
          {cfg.portal.chat_enabled ? (
            <Link to={portalPath(orgId, "chat")} className="pt-iconbtn" aria-label={`گفتگو با ${cfg.portal.chat_name}`}>
              <MessageCircle {...I} />
            </Link>
          ) : null}
          <Dropdown menu={{ items }} trigger={["click"]} placement="bottomLeft">
            <button type="button" className="pt-iconbtn" aria-label={`حساب ${name}`}>
              <CircleUser {...I} />
            </button>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}

export default function PortalApp() {
  const { orgId } = useOrg();
  const [sp] = useSearchParams();
  const preview = sp.get("preview") === "1";
  const embed = sp.get("embed") === "1";
  const asked = sp.get("portal");
  const q = usePortalConfig(asked, preview);
  const todo = usePortalTodo();
  useInertShell();
  usePageTitle(q.data?.portal.name ?? "درگاه خدمات");
  const cfg = q.data;
  const todoCount = useMemo(() => (todo.data ? todo.data.approvals.length + todo.data.surveys.length + todo.data.acknowledgements.length + todo.data.waiting_you.length : 0), [todo.data]);

  const body = !cfg ? (
    <div className="pt-root" dir="rtl">
      <Loader />
    </div>
  ) : embed ? (
    <div className="pt-root" dir="rtl" data-accent={accentOf(cfg.portal.accent)}>
      <Suspense fallback={<Loader />}>
        <Chat cfg={cfg} embed />
      </Suspense>
    </div>
  ) : (
    <div className="pt-root" dir="rtl" data-accent={accentOf(cfg.portal.accent)}>
      {cfg.preview ? <div className="pt-preview" role="status">پیش‌نمایش چیدمان پیش‌نویس؛ کاربران هنوز نسخهٔ منتشرشده را می‌بینند.</div> : null}
      <Header cfg={cfg} todo={todoCount} />
      <main className="pt-main" id="portal-main">
        <div className="pt-wrap">
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="" element={<Home cfg={cfg} />} />
              <Route path="search" element={<Search cfg={cfg} />} />
              <Route path="catalog" element={<Catalog cfg={cfg} />} />
              <Route path="catalog/:category" element={<Catalog cfg={cfg} />} />
              <Route path="items/:id" element={<Item cfg={cfg} />} />
              <Route path="report" element={<Report cfg={cfg} />} />
              <Route path="requests" element={<Requests cfg={cfg} />} />
              <Route path="t/:table/:id" element={<Ticket cfg={cfg} />} />
              <Route path="todo" element={<Todo cfg={cfg} />} />
              <Route path="approvals/:id" element={<Approval cfg={cfg} />} />
              <Route path="kb" element={<Knowledge cfg={cfg} />} />
              <Route path="kb/:id" element={<Article cfg={cfg} />} />
              <Route path="kb/n/:number" element={<ByNumber />} />
              <Route path="surveys/:id" element={<Survey cfg={cfg} />} />
              <Route path="profile" element={<Profile cfg={cfg} />} />
              <Route path="chat/*" element={<Chat cfg={cfg} />} />
              <Route path="status" element={<Status cfg={cfg} />} />
              <Route path="feedback" element={<Feedback cfg={cfg} />} />
              <Route path="topics/:id" element={<Topic cfg={cfg} />} />
              <Route path="*" element={<Home cfg={cfg} />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      <footer className="pt-foot">
        <div className="pt-wrap">{cfg.portal.footer ? <RecordMarkdown text={cfg.portal.footer} /> : <p>{cfg.portal.brand_name}</p>}</div>
      </footer>
      <TabBar cfg={cfg} />
    </div>
  );
  return createPortal(body, document.body, `portal-${orgId}`);
}
