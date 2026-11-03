// App frame (components.md §1): the canvas sidebar on the right (RTL) with the business and space switchers,
// the glass top bar, the content panel and the command palette (Ctrl K); plus PageHeader and Section.
// The parts live in ./shell/ (Sidebar, Topbar, CommandPalette, model, shell.css).
import { Children, isValidElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Drawer, Badge } from "antd";
import { useLocation, useNavigate } from "react-router";
import { ArrowRight, Moon, Sun, PanelRight, Pin, House, Info, SquarePen } from "lucide-react";
import { APP_NAME } from "@shared/constants";
import { useOrg } from "../lib/org";
import { useTheme } from "../lib/theme";
import { Logo as BrandLogo } from "./brand";
import { Sidebar, SIDEBAR_W, SIDEBAR_MIN, SIDEBAR_MAX } from "./shell/Sidebar";
import { Topbar, type Crumb } from "./shell/Topbar";
import { CommandPalette as Palette, type PaletteCommand } from "./shell/CommandPalette";
import { ShellCtx, usePageTitle, type ShellApi } from "./shell/context";
import { SupportBanner } from "./shell/SupportBanner";
import { AssistantHost } from "../ai/assistant/AssistantHost";
import { openAssistant } from "../ai/assistant/bus";
import { Ic, AiIcon } from "./shell/icons";
import { inSidebar, matchItem, pushRecent, routeSpace, spaceOf, useRelPath, useShellItems, useSpaceMemory, useSpaces, useStored } from "./shell/model";
import type { SpaceKey } from "../modules/registry";
import "./shell/shell.css";
import { useSession } from "../lib/session";
import { useLivePulse } from "../lib/live";

export function Logo({ collapsed, light }: { collapsed?: boolean; light?: boolean }) {
  return <BrandLogo size={22} tone={light ? "white" : "ink"} compact={collapsed} />;
}

/** The command palette (kept as an export for screens that open it themselves). */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Palette open={open} onClose={onClose} />;
}

function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * The Windows app with a hidden title bar (`titleBarOverlay`, enabled by the desktop app through its preload
 * bridge): the shell keeps a 40 px drag strip and leaves the caption buttons' corner (the top right in RTL) clear.
 */
function hasTitleBarOverlay(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { siraf?: { titleBarOverlay?: boolean } }).siraf;
  return !!bridge?.titleBarOverlay;
}

interface SidebarPref {
  w: number;
  collapsed: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const vw = useViewportWidth();
  const mobile = vw < 768;
  const narrow = vw < 1100;
  const [pref, setPref] = useStored<SidebarPref>("siraf.sidebar", { w: SIDEBAR_W, collapsed: false });
  const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(pref.w) || SIDEBAR_W));
  const rail = !mobile && (narrow || pref.collapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [title, setTitle] = useState<string | null>(null);

  const { orgId, can } = useOrg();
  const { meta } = useSession();
  // open screens refresh what another device changed (src/ui/lib/live.ts)
  useLivePulse(orgId, meta?.mode === "desktop");
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const rel = useRelPath();

  const allItems = useShellItems();
  // the sidebar's items (create-actions stay in the palette); the route is matched against them so
  // «سند جدید» highlights «اسناد حسابداری» and its breadcrumb reads «اسناد حسابداری › سند جدید»
  const items = useMemo(() => allItems.filter(inSidebar), [allItems]);
  const spaces = useSpaces(items);
  const active = useMemo(() => matchItem(items, rel), [items, rel]);
  const current = routeSpace(active, rel);
  const memory = useSpaceMemory(orgId, current, rel, loc.search);
  const fallback: SpaceKey = spaces.some((s) => s.key === memory.last) ? memory.last : (spaces[0]?.key ?? "accounting");
  const space: SpaceKey = current ?? fallback;
  const [pins, setPins] = useStored<string[]>(`siraf.pins.${orgId}`, []);

  const go = useCallback((path: string) => nav(`/${orgId}${path ? `/${path.replace(/^\//, "")}` : ""}`), [nav, orgId]);
  const firstOf = (s: SpaceKey) => items.find((i) => i.space === s && !i.common)?.path ?? "";
  const onSpace = (s: SpaceKey) => {
    memory.setLast(s);
    // on a page of every space (پیشخوان، اشخاص) the switch only focuses the nav; elsewhere it opens the
    // space's last page (or its first one), so the nav and the page always agree
    if (s === current || current === null) return;
    go(memory.pages[s] ?? firstOf(s));
  };
  const onSettings = () => {
    if (current === "settings") return;
    go(memory.pages.settings ?? (can("settings") ? "settings/org" : "settings/account"));
  };
  const onLeaveSettings = () => go(memory.pages[fallback] ?? "");

  const openPalette = useCallback(() => setPalette(true), []);
  const shell = useMemo<ShellApi>(() => ({ setTitle, openPalette, openAssistant }), [openPalette]);

  // Ctrl K (any keyboard layout: the K key types «ن» on the Persian layout) toggles the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyK" || ["k", "K", "ن", "ك"].includes(e.key))) {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close the drawer on navigation; leave it when the window grows
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);

  // breadcrumb: the space; top-level pages reveal their item once the H1 scrolls away, detail pages show the path
  const detail = !active || rel !== active.path;
  const crumbs: Crumb[] = [];
  const spaceLabel = spaceOf(space).label;
  if (!detail && active?.common) {
    // a page every space shares (پیشخوان، اشخاص) is its own root, never the remembered module: like any
    // top-level page its name would repeat the H1, so «اشخاص» fades in only once the H1 scrolls away
    crumbs.push({ label: active.label, current: true, reveal: true });
  } else if (!detail && active) {
    crumbs.push({ label: spaceLabel });
    crumbs.push({ label: active.label, current: true, reveal: true });
  } else {
    // a record of a page every space shares (a person's file) needs no space in front of it
    if (!active?.common) crumbs.push({ label: spaceLabel });
    if (active) crumbs.push({ label: active.label, to: `/${orgId}${active.path ? `/${active.path}` : ""}` });
    if (title && title !== active?.label) crumbs.push({ label: title, current: true });
  }

  // the window title and the palette's recent pages
  const pageLabel = detail ? (title ?? active?.label ?? null) : (active?.label ?? title);
  useEffect(() => {
    document.title = pageLabel ? `${pageLabel} — ${APP_NAME}` : APP_NAME;
  }, [pageLabel]);
  useEffect(() => {
    if (!pageLabel) return;
    const t = window.setTimeout(() => pushRecent(orgId, { path: rel + loc.search, label: pageLabel, key: detail ? undefined : active?.key }), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, rel, pageLabel]);

  const toggleSidebar = () => {
    if (narrow) setDrawer((d) => !d);
    else setPref((p) => ({ ...p, collapsed: !p.collapsed }));
  };
  const toggleLabel = narrow ? "نمایش منو" : pref.collapsed ? "باز کردن نوار کناری" : "جمع کردن نوار کناری";

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { key: "theme", label: dark ? "پوستهٔ روشن" : "پوستهٔ تیره", icon: dark ? Sun : Moon, keywords: "تم حالت شب روز رنگ", run: toggle },
      { key: "home", label: "رفتن به پیشخوان", icon: House, keywords: "داشبورد خانه", path: "", run: () => go("") },
      { key: "about", label: `دربارهٔ ${APP_NAME}`, icon: Info, keywords: "نسخه درباره سیراف اعتبار", path: "help#about", run: () => go("help#about") },
    ];
    if (can("ai", "view"))
      list.push(
        { key: "assistant", label: `دستیار ${APP_NAME}`, icon: AiIcon, keywords: "هوش مصنوعی دستیار پرسش چت گفتگو ai", meta: "Ctrl J", run: () => openAssistant() },
        { key: "assistant-new", label: "گفت‌وگوی تازه با دستیار", icon: SquarePen, keywords: "هوش مصنوعی دستیار پرسش چت گفتگو جدید", run: () => openAssistant({ fresh: true }) },
      );
    if (!narrow) list.push({ key: "sidebar", label: pref.collapsed ? "باز کردن نوار کناری" : "جمع کردن نوار کناری", icon: PanelRight, keywords: "منو سایدبار", run: () => setPref((p) => ({ ...p, collapsed: !p.collapsed })) });
    if (active && !detail)
      list.push(
        pins.includes(active.key)
          ? { key: "unpin", label: `برداشتن «${active.label}» از نشان‌شده‌ها`, icon: Pin, keywords: "نشان سنجاق", run: () => setPins((p) => p.filter((k) => k !== active.key)) }
          : { key: "pin", label: `نشان کردن «${active.label}»`, icon: Pin, keywords: "نشان سنجاق نشان‌شده", run: () => setPins((p) => (p.includes(active.key) ? p : [...p, active.key].slice(-5))) },
      );
    return list;
  }, [dark, toggle, go, narrow, pref.collapsed, setPref, active, detail, pins, setPins, can]);

  const sidebar = (inDrawer: boolean) => (
    <Sidebar
      items={items}
      spaces={spaces}
      space={space}
      active={active}
      onSpace={onSpace}
      onSettings={onSettings}
      onLeaveSettings={onLeaveSettings}
      onPalette={() => {
        setDrawer(false);
        setPalette(true);
      }}
      onNavigate={inDrawer ? () => setDrawer(false) : undefined}
      rail={!inDrawer && rail}
      width={inDrawer ? 280 : width}
      onResize={inDrawer ? undefined : (w) => setPref((p) => ({ ...p, w }))}
      pins={pins}
      onPins={setPins}
    />
  );

  return (
    <ShellCtx.Provider value={shell}>
      <div
        className={`sh-app ${mobile ? "is-mobile" : ""} ${rail ? "is-rail" : ""} ${hasTitleBarOverlay() ? "has-titlebar" : ""}`}
        style={{ ["--sh-side-w" as string]: `${rail ? 60 : width}px` }}
      >
        {mobile ? null : sidebar(false)}
        <div className="sh-main">
          <SupportBanner />
          <div className="sh-top-wrap no-print">
            <Topbar crumbs={crumbs} pathKey={loc.pathname} onToggle={toggleSidebar} toggleLabel={toggleLabel} onSearch={mobile ? openPalette : undefined} drawer={narrow} />
          </div>
          <main className="sh-panel ant-layout-content" id="main">
            <div className="sh-page">{children}</div>
          </main>
        </div>
        {narrow ? (
          <Drawer
            open={drawer}
            onClose={() => setDrawer(false)}
            placement="right"
            size={280}
            closable={false}
            mask
            rootClassName="sh-drawer no-print"
            styles={{
              wrapper: { margin: 0, borderRadius: 0, boxShadow: "var(--sf-shadow-e4), 0 0 0 1px var(--sf-line-2)" },
              section: { background: "var(--sf-canvas)" },
              body: { padding: 0 },
              mask: { background: "var(--sf-scrim)" },
            }}
          >
            {sidebar(true)}
          </Drawer>
        ) : null}
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <AssistantHost />
    </ShellCtx.Provider>
  );
}

// ---------------------------------------------------------------- page header

/** Plain text of a title (for the breadcrumb, the window title and recent pages). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return Children.toArray(node.props.children).map(textOf).join("");
  return "";
}

/** Arad never sets figures: the digit runs of a string title are drawn by Siraf Num (weight 600, tabular). */
function titleWithFigures(title: ReactNode): ReactNode {
  if (typeof title !== "string" || !/[0-9۰-۹]/.test(title)) return title;
  return title.split(/([0-9۰-۹][0-9۰-۹٫٬/.,-]*)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="sf-ph-num">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function PageHeader({ title, subtitle, actions, back, extra }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string | boolean; extra?: ReactNode }) {
  const nav = useNavigate();
  const text = textOf(title).trim();
  usePageTitle(text || null);
  return (
    <div className="sf-ph no-print">
      {back ? (
        <button type="button" className="sh-icon-btn" onClick={() => (typeof back === "string" ? nav(back) : nav(-1))} aria-label="بازگشت">
          <Ic icon={ArrowRight} />
        </button>
      ) : null}
      <div className="sf-ph-t">
        <h1>{titleWithFigures(title)}</h1>
        {subtitle ? <div className="sf-ph-meta">{subtitle}</div> : null}
      </div>
      {extra}
      {actions ? <div className="sf-ph-actions">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, extra, children, className, bodyClass }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`tz-card sf-section ${className ?? ""}`}>
      {title || extra ? (
        <div className="sf-section-h">
          {title ? <h2>{title}</h2> : null}
          {extra ? <div className="sf-section-x">{extra}</div> : null}
        </div>
      ) : null}
      <div className={bodyClass ?? "sf-section-b"}>{children}</div>
    </section>
  );
}

export { Badge };
