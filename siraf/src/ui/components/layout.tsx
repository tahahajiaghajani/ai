// App frame: right-hand sidebar (RTL), header with business switcher, fiscal year, search,
// sync status and user menu; page headers; the command palette (Ctrl+K).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Layout, Menu, Dropdown, Button, Select, Tooltip, Modal, Input, Badge, Avatar, Grid, Drawer } from "antd";
import {
  MenuFoldOutlined, MenuUnfoldOutlined, SearchOutlined, MoonOutlined, SunOutlined, UserOutlined, LogoutOutlined,
  SwapOutlined, CloudSyncOutlined, CloudOutlined, DesktopOutlined, KeyOutlined, WarningOutlined, ArrowRightOutlined,
} from "@ant-design/icons";
import { Link, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NAV, type NavGroup, type NavItem } from "../modules/registry";
import { useOrg } from "../lib/org";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { APP_NAME } from "@shared/constants";
import { useTheme } from "../lib/theme";

const { Sider, Header, Content } = Layout;

export function Logo({ collapsed, light }: { collapsed?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg" />
      {!collapsed ? (
        <div className="leading-tight">
          <div className={`text-lg font-extrabold ${light ? "text-white" : "text-ink"}`}>{APP_NAME}</div>
          <div className={`text-[10px] ${light ? "text-[var(--tz-sidebar-text)]" : "text-muted"}`}>حسابداری و مدیریت کسب‌وکار</div>
        </div>
      ) : null}
    </div>
  );
}

function useVisibleNav(): NavGroup[] {
  const { can, has } = useOrg();
  const { meta } = useSession();
  return useMemo(
    () =>
      NAV.filter((g) => !g.module || has(g.module))
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) =>
              (!i.module || has(i.module)) &&
              (!i.area || can(i.area, i.level ?? "view")) &&
              (!i.desktopOnly || meta?.mode === "desktop") &&
              (!i.cloudOnly || meta?.mode === "cloud"),
          ),
        }))
        .filter((g) => g.items.length),
    [can, has, meta?.mode],
  );
}

function SideMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { orgId } = useOrg();
  const loc = useLocation();
  const groups = useVisibleNav();
  const rel = loc.pathname.replace(`/${orgId}`, "").replace(/^\//, "");
  const selected = useMemo(() => {
    let best: { key: string; len: number } = { key: "dashboard", len: -1 };
    for (const g of groups)
      for (const i of g.items) {
        if ((i.path === "" && rel === "") || (i.path && (rel === i.path || rel.startsWith(`${i.path}/`)))) {
          if (i.path.length > best.len) best = { key: i.key, len: i.path.length };
        }
      }
    return best.key;
  }, [groups, rel]);
  const openGroup = groups.find((g) => g.items.some((i) => i.key === selected))?.key;
  const [open, setOpen] = useState<string[]>(openGroup ? [openGroup] : []);
  useEffect(() => {
    if (openGroup) setOpen((o) => (o.includes(openGroup) ? o : [...o, openGroup]));
  }, [openGroup]);
  return (
    <Menu
      mode="inline"
      theme="dark"
      selectedKeys={[selected]}
      openKeys={open}
      onOpenChange={(k) => setOpen(k as string[])}
      style={{ background: "transparent", borderInlineEnd: 0 }}
      items={groups.map((g) =>
        g.items.length === 1 && g.key === "home"
          ? { key: g.items[0].key, icon: g.icon, label: <Link to={`/${orgId}`} onClick={onNavigate}>{g.items[0].label}</Link> }
          : {
              key: g.key,
              icon: g.icon,
              label: g.label,
              children: g.items.map((i) => ({ key: i.key, label: <Link to={`/${orgId}/${i.path}`} onClick={onNavigate}>{i.label}</Link> })),
            },
      )}
    />
  );
}

function SyncBadge() {
  const { meta } = useSession();
  const desktop = meta?.mode === "desktop";
  const q = useQuery({
    queryKey: ["local-sync"],
    queryFn: () => api.get("/local/sync"),
    enabled: desktop,
    refetchInterval: 8000,
  });
  if (!desktop) {
    return (
      <Tooltip title="نسخه‌ی وب — داده‌ها مستقیم در فضای ابری ذخیره می‌شوند">
        <span className="hidden items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand sm:flex">
          <CloudOutlined /> ابری
        </span>
      </Tooltip>
    );
  }
  const s = q.data as { linked: boolean; running: boolean; online: boolean | null; pending: number; last_sync_at: string | null; last_error: string | null } | undefined;
  if (!s?.linked) {
    return (
      <Tooltip title="روی همین رایانه ذخیره می‌شود؛ برای هم‌گامی با نسخه‌ی وب از تنظیمات ← همگام‌سازی وصل شوید">
        <span className="hidden items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted sm:flex">
          <DesktopOutlined /> محلی
        </span>
      </Tooltip>
    );
  }
  const tone = s.last_error ? "bg-[color-mix(in_srgb,var(--tz-warning)_15%,transparent)] text-warn" : "bg-brand-soft text-brand";
  return (
    <Tooltip
      title={
        <div className="text-xs">
          {s.last_error ? <div>{s.last_error}</div> : <div>هم‌گام با نسخه‌ی وب</div>}
          {s.last_sync_at ? <div>آخرین هم‌گامی: {formatJalaliDateTime(s.last_sync_at)}</div> : null}
          {s.pending ? <div>{faDigits(s.pending)} تغییر در صف ارسال</div> : null}
        </div>
      }
    >
      <button
        type="button"
        onClick={() => api.post("/local/sync").then(() => q.refetch())}
        className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs sm:flex ${tone}`}
      >
        {s.last_error ? <WarningOutlined /> : <CloudSyncOutlined spin={s.running} />}
        {s.pending ? `${faDigits(s.pending)} در صف` : "هم‌گام"}
      </button>
    </Tooltip>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = useVisibleNav();
  const { orgId } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const all = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))), [groups]);
  const list = useMemo(() => {
    const s = q.trim();
    if (!s) return all.slice(0, 40);
    return all.filter((i) => `${i.label} ${i.group} ${i.keywords ?? ""}`.includes(s)).slice(0, 40);
  }, [all, q]);
  useEffect(() => setIdx(0), [q, open]);
  const go = (i: NavItem) => {
    nav(`/${orgId}/${i.path}`);
    onClose();
    setQ("");
  };
  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={560} styles={{ body: { padding: 0 } }} destroyOnHidden>
      <div className="border-b border-line p-3">
        <Input
          autoFocus
          size="large"
          variant="borderless"
          prefix={<SearchOutlined className="text-muted" />}
          placeholder="جستجوی صفحه یا کار… (مثلاً «فاکتور فروش»، «تراز»)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(i + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && list[idx]) go(list[idx]);
          }}
        />
      </div>
      <div className="max-h-[420px] overflow-auto p-2">
        {list.map((i, n) => (
          <button
            key={`${i.group}-${i.key}`}
            type="button"
            onMouseEnter={() => setIdx(n)}
            onClick={() => go(i)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm ${n === idx ? "bg-brand-soft text-brand" : ""}`}
          >
            <span>{i.label}</span>
            <span className="text-xs text-muted">{i.group}</span>
          </button>
        ))}
        {!list.length ? <div className="p-6 text-center text-sm text-muted">چیزی پیدا نشد</div> : null}
      </div>
    </Modal>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.lg;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("taraz.sider") === "1";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const { org, info, fy, setFy } = useOrg();
  const { me, logout, meta } = useSession();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K" || e.key === "ك" || e.key === "ن")) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sider = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-4">
        <Logo collapsed={collapsed && !mobile} light />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <SideMenu onNavigate={() => setDrawer(false)} />
      </div>
      {!collapsed || mobile ? (
        <div className="shrink-0 border-t border-white/10 px-4 py-3 text-[11px] text-[var(--tz-sidebar-text)]">
          {meta?.mode === "desktop" ? "نسخه‌ی ویندوز" : "نسخه‌ی وب"} · {faDigits(meta?.version ?? "")}
        </div>
      ) : null}
    </div>
  );

  return (
    <Layout className="min-h-screen" hasSider>
      {mobile ? (
        <Drawer open={drawer} onClose={() => setDrawer(false)} placement="right" size={272} closable={false} styles={{ body: { padding: 0, background: "var(--tz-sidebar)" } }}>
          {sider}
        </Drawer>
      ) : (
        <Sider
          width={256}
          collapsedWidth={72}
          collapsed={collapsed}
          trigger={null}
          className="no-print"
          style={{ background: "linear-gradient(180deg, var(--tz-sidebar) 0%, var(--tz-sidebar-2) 100%)", position: "sticky", top: 0, height: "100vh", overflow: "hidden" }}
        >
          {sider}
        </Sider>
      )}
      <Layout style={{ background: "var(--tz-bg)" }}>
        <Header className="tz-header no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line !bg-[color-mix(in_srgb,var(--tz-surface)_88%,transparent)] !px-3 backdrop-blur md:!px-5" style={{ lineHeight: "normal" }}>
          <Button
            type="text"
            icon={mobile ? <MenuUnfoldOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => {
              if (mobile) setDrawer(true);
              else {
                setCollapsed(!collapsed);
                try {
                  localStorage.setItem("taraz.sider", collapsed ? "0" : "1");
                } catch {
                  /* ignore */
                }
              }
            }}
            aria-label="منو"
          />
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                ...(me?.orgs ?? []).map((o) => ({ key: o.id, label: o.name, onClick: () => nav(`/${o.id}`) })),
                { type: "divider" as const },
                { key: "new", label: "کسب‌وکار جدید / همه", icon: <SwapOutlined />, onClick: () => nav("/orgs") },
              ],
            }}
          >
            <button type="button" className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
              {org.logo ? <img src={org.logo} alt="" className="h-7 w-7 rounded-md object-cover" /> : <span className="grid h-7 w-7 place-content-center rounded-md bg-brand-soft text-sm font-bold text-brand">{org.name.slice(0, 1)}</span>}
              <span className="max-w-[180px] truncate text-sm font-semibold">{org.name}</span>
            </button>
          </Dropdown>
          {info.fiscal_years.length ? (
            <Select
              size="small"
              value={fy?.id}
              onChange={(id) => {
                setFy(id);
                qc.invalidateQueries();
              }}
              popupMatchSelectWidth={false}
              className="hidden min-w-[130px] md:block"
              options={info.fiscal_years.map((f) => ({ value: f.id, label: `${f.title}${f.status === "closed" ? " (بسته)" : ""}` }))}
            />
          ) : null}
          <div className="flex-1" />
          <button type="button" onClick={() => setPalette(true)} className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-muted md:flex">
            <SearchOutlined /> جستجو در برنامه… <span className="ms-auto tz-kbd ltr">Ctrl K</span>
          </button>
          <Button className="md:!hidden" type="text" icon={<SearchOutlined />} onClick={() => setPalette(true)} aria-label="جستجو" />
          <SyncBadge />
          <Tooltip title={dark ? "حالت روشن" : "حالت تیره"}>
            <Button type="text" icon={dark ? <SunOutlined /> : <MoonOutlined />} onClick={toggle} aria-label="تم" />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "me", label: <div className="py-1"><div className="font-semibold">{me?.user.full_name}</div><div className="text-xs text-muted ltr">{me?.user.email}</div></div>, disabled: true },
                { type: "divider" as const },
                { key: "profile", icon: <KeyOutlined />, label: "حساب کاربری و رمز", onClick: () => nav(`/${org.id}/settings/account`) },
                { key: "logout", icon: <LogoutOutlined />, label: "خروج", danger: true, onClick: () => logout() },
              ],
            }}
          >
            <Avatar size={32} className="cursor-pointer !bg-brand" icon={<UserOutlined />}>
              {me?.user.full_name?.slice(0, 1)}
            </Avatar>
          </Dropdown>
        </Header>
        <Content className="p-3 md:p-5">{children}</Content>
      </Layout>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </Layout>
  );
}

export function PageHeader({ title, subtitle, actions, back, extra }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string | boolean; extra?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-3">
      {back ? <Button type="text" icon={<ArrowRightOutlined />} onClick={() => (typeof back === "string" ? nav(back) : nav(-1))} aria-label="بازگشت" /> : null}
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-bold">{title}</h1>
        {subtitle ? <div className="mt-0.5 text-xs text-muted">{subtitle}</div> : null}
      </div>
      {extra}
      <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Section({ title, extra, children, className, bodyClass }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`tz-card ${className ?? ""}`}>
      {title || extra ? (
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="m-0 text-sm font-bold">{title}</h2>
          <div className="ms-auto">{extra}</div>
        </div>
      ) : null}
      <div className={bodyClass ?? "p-4"}>{children}</div>
    </section>
  );
}

export { Badge };
