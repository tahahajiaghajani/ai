// The glass top bar (components.md §1.3): sidebar toggle and breadcrumb at the start; the fiscal year,
// the Windows-app badge, the theme and the account menu at the end. No page title: the page owns it.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Dropdown, Tooltip, type MenuProps } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { PanelRight, Menu, Search, ChevronLeft, ChevronDown, Calendar, Sun, Moon, SunMoon, Check, Monitor, KeyRound, LogOut, Building2, CircleHelp, ShieldCheck } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useTheme, type ThemePref } from "../../lib/theme";
import { Ic } from "./icons";

export interface Crumb {
  label: string;
  to?: string;
  current?: boolean;
  /** Top-level pages: the current item fades in only once the page's H1 has scrolled under the bar. */
  reveal?: boolean;
}

/** True once the page header's H1 has scrolled under the top bar (window scroll). */
function useH1Hidden(dep: unknown) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const h1 = document.querySelector(".sf-ph h1");
      const bar = document.querySelector(".sh-topbar");
      if (!h1 || !bar) return setHidden(false);
      setHidden(h1.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 2);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    const t = window.setTimeout(check, 300); // the lazy page renders after the route changes
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      window.clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [dep]);
  return hidden;
}

function Crumbs({ crumbs, pathKey }: { crumbs: Crumb[]; pathKey: string }) {
  const h1Hidden = useH1Hidden(pathKey);
  return (
    <nav className="sh-crumbs" aria-label="مسیر">
      {crumbs.map((c, i) => {
        const sep = i > 0 ? <Ic icon={ChevronLeft} size={14} className="sh-crumb-sep" /> : null;
        if (c.reveal)
          return (
            <span key={i} className={`sh-crumb-reveal ${h1Hidden ? "is-shown" : ""}`} aria-hidden={!h1Hidden}>
              {sep}
              <span className="sh-crumb-cur" aria-current="page">
                {c.label}
              </span>
            </span>
          );
        return (
          <span key={i} className={`sh-crumb ${i > 0 && i < crumbs.length - 1 ? "sh-crumb-mid" : ""}`}>
            {sep}
            {c.current ? (
              <span className="sh-crumb-cur" aria-current="page">
                {c.label}
              </span>
            ) : c.to ? (
              <Link to={c.to} className="sh-crumb-link">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------- fiscal year
function FiscalYear() {
  const { info, fy, setFy } = useOrg();
  const qc = useQueryClient();
  if (!info.fiscal_years.length || !fy) return null;
  const closed = (s: string) => s === "closed";
  const menu: MenuProps = {
    items: [
      {
        key: "g",
        type: "group",
        label: "سال مالی",
        children: info.fiscal_years.map((f) => ({
          key: f.id,
          label: (
            <span className="sh-menu-row">
              <span>{f.title}</span>
              {closed(f.status) ? <span className="sh-menu-meta">بسته</span> : null}
              {f.id === fy.id ? <Ic icon={Check} className="sh-menu-check" /> : null}
            </span>
          ),
          onClick: () => {
            if (f.id === fy.id) return;
            setFy(f.id);
            qc.invalidateQueries();
          },
        })),
      },
    ],
  };
  return (
    <Dropdown trigger={["click"]} menu={menu} rootClassName="sf-glass sh-menu" placement="bottomLeft">
      <button type="button" className="sh-fy" aria-label={`سال مالی: ${fy.title}، تغییر سال مالی`}>
        <Ic icon={Calendar} />
        <span className="sh-fy-t">
          {/^سال مالی/.test(fy.title) || !/^سال/.test(fy.title) ? <span className="sh-fy-pre">سال مالی </span> : null}
          {fy.title.replace(/^سال مالی\s*/, "")}
        </span>
        {closed(fy.status) ? <span className="sh-fy-closed">(بسته)</span> : null}
        <Ic icon={ChevronDown} size={14} className="sh-fy-chev" />
      </button>
    </Dropdown>
  );
}

// ---------------------------------------------------------------- theme
const THEMES: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "روشن", icon: Sun },
  { key: "dark", label: "تیره", icon: Moon },
  { key: "system", label: "هماهنگ با سیستم", icon: SunMoon },
];

function ThemeSwitch() {
  const { pref, setPref, dark } = useTheme();
  const menu: MenuProps = {
    items: [
      {
        key: "g",
        type: "group",
        label: "پوسته",
        children: THEMES.map((t) => ({
          key: t.key,
          icon: <Ic icon={t.icon} />,
          label: (
            <span className="sh-menu-row">
              <span>{t.label}</span>
              {t.key === pref ? <Ic icon={Check} className="sh-menu-check" /> : null}
            </span>
          ),
          onClick: () => setPref(t.key),
        })),
      },
    ],
  };
  const icon = pref === "system" ? SunMoon : dark ? Moon : Sun;
  return (
    <Dropdown trigger={["click"]} menu={menu} rootClassName="sf-glass sh-menu" placement="bottomLeft">
      <button type="button" className="sh-icon-btn" aria-label={`پوسته: ${THEMES.find((t) => t.key === pref)?.label}`}>
        <Ic icon={icon} />
      </button>
    </Dropdown>
  );
}

// ---------------------------------------------------------------- Windows app badge
function DesktopBadge() {
  const { meta } = useSession();
  const { orgId } = useOrg();
  if (meta?.mode !== "desktop") return null;
  const d = meta.desktop;
  return (
    <Tooltip title={[d?.computer, d?.version ? `نسخهٔ ${d.version}` : null].filter(Boolean).join("، ") || "نسخهٔ ویندوز"}>
      <Link to={`/${orgId}/settings/desktop`} className="sh-badge" aria-label="نسخهٔ ویندوز: پشتیبان، شبکه و هم‌گامی">
        <Ic icon={Monitor} size={14} />
        <span>ویندوز</span>
      </Link>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- account
export function initials(name: string | undefined | null): string {
  const w = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "؟";
  return w.length === 1 ? w[0].slice(0, 1) : `${w[0].slice(0, 1)}‌${w[w.length - 1].slice(0, 1)}`;
}

function Account() {
  const { me, logout } = useSession();
  const { orgId } = useOrg();
  const nav = useNavigate();
  const items: MenuProps["items"] = [
    {
      key: "me",
      disabled: true,
      className: "sh-menu-me",
      label: (
        <span className="sh-me">
          <span className="sh-me-name">{me?.user.full_name}</span>
          <bdi dir="ltr" className="sh-me-mail">
            {me?.user.email}
          </bdi>
        </span>
      ),
    },
    { type: "divider" as const },
    { key: "profile", icon: <Ic icon={KeyRound} />, label: "حساب کاربری و رمز", onClick: () => nav(`/${orgId}/settings/account`) },
    { key: "orgs", icon: <Ic icon={Building2} />, label: "کسب‌وکارها", onClick: () => nav("/orgs") },
    { key: "help", icon: <Ic icon={CircleHelp} />, label: "راهنما و میانبرها", onClick: () => nav(`/${orgId}/help`) },
    ...(me?.user.is_platform_admin ? [{ key: "admin", icon: <Ic icon={ShieldCheck} />, label: "مدیریت سامانه", onClick: () => nav("/admin") }] : []),
    { type: "divider" as const },
    { key: "logout", icon: <Ic icon={LogOut} />, label: "خروج", danger: true, onClick: () => logout() },
  ];
  return (
    <Dropdown trigger={["click"]} menu={{ items }} rootClassName="sf-glass sh-menu" placement="bottomLeft">
      <button type="button" className="sh-avatar" aria-label={`حساب کاربری: ${me?.user.full_name ?? ""}`}>
        {initials(me?.user.full_name)}
      </button>
    </Dropdown>
  );
}

// ---------------------------------------------------------------- bar
export function Topbar({ crumbs, pathKey, onToggle, toggleLabel, onSearch, drawer }: { crumbs: Crumb[]; pathKey: string; onToggle: () => void; toggleLabel: string; onSearch?: () => void; drawer?: boolean }) {
  return (
    <header className="sh-topbar no-print">
      <Tooltip title={toggleLabel}>
        <button type="button" className="sh-icon-btn" aria-label={toggleLabel} onClick={onToggle}>
          <Ic icon={drawer ? Menu : PanelRight} />
        </button>
      </Tooltip>
      <Crumbs crumbs={crumbs} pathKey={pathKey} />
      <div className="sh-tb-end">
        {onSearch ? (
          <button type="button" className="sh-icon-btn" aria-label="جست‌وجو یا فرمان" onClick={onSearch}>
            <Ic icon={Search} />
          </button>
        ) : null}
        <FiscalYear />
        <DesktopBadge />
        <ThemeSwitch />
        <Account />
      </div>
    </header>
  );
}
