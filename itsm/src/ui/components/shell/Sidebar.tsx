// The canvas sidebar (components.md §1.2): organisation switcher, space switcher, command entry, the
// space's nav with section labels and counts, «نشان‌شده‌ها», and the footer with the sync state.
// `rail` draws the 60 px icon rail (collapsed, or windows narrower than 1100 px).
import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Dropdown, Tooltip, type MenuProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, ChevronDown, Search, Settings, CircleHelp, ArrowRight, Check, Plus, Building2, Pin, PinOff } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { fa } from "../../lib/fa";
import { ROLES, type Role } from "@shared/permissions";
import type { Space, SpaceKey } from "../../modules/registry";
import { BrandTile } from "../brand";
import { Ic, Keys } from "./icons";
import { sectionsOf, spaceOf, useStored, type ShellItem } from "./model";
import { SyncLine, SyncNuqta, useSyncState } from "./sync";
import { registerLiveTables } from "../../lib/live";

export const SIDEBAR_W = 244;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
const MAX_PINS = 5;

export interface SidebarProps {
  items: ShellItem[];
  spaces: Space[];
  /** The space whose nav is shown. */
  space: SpaceKey;
  /** The nav item of the current route (highlighted). */
  active: ShellItem | null;
  onSpace: (s: SpaceKey) => void;
  onSettings: () => void;
  onLeaveSettings: () => void;
  onPalette: () => void;
  /** Called after any navigation (closes the mobile drawer). */
  onNavigate?: () => void;
  rail?: boolean;
  width: number;
  onResize?: (w: number) => void;
  pins: string[];
  onPins: (pins: string[]) => void;
}

// ---------------------------------------------------------------- counts

/** The live counts of the rows that have one (modules' cheap queries), by count key; refreshed every two minutes. */
function useCounts(items: ShellItem[]): Record<string, number> | undefined {
  const { api, orgId } = useOrg();
  const defs = useMemo(() => {
    const seen = new Map<string, NonNullable<ShellItem["count"]>>();
    for (const i of items) if (i.count && !seen.has(i.count.key)) seen.set(i.count.key, i.count);
    return [...seen.values()];
  }, [items]);
  // «زنده» asks about the tables the counts count (src/ui/lib/live.ts)
  useEffect(() => registerLiveTables("shell-counts", defs.flatMap((d) => d.tables ?? [`module:${d.key.split(":")[0]}`])), [defs]);
  const q = useQuery({
    queryKey: ["shell-counts", orgId, defs.map((d) => d.key).join(",")],
    queryFn: async () => Object.fromEntries(await Promise.all(defs.map(async (d) => [d.key, await d.load(api).catch(() => 0)] as const))),
    enabled: defs.length > 0,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  return q.data;
}

// ---------------------------------------------------------------- organisation switcher
function initial(name: string) {
  return name.trim().slice(0, 1);
}

function BizSwitcher({ rail, onNavigate }: { rail?: boolean; onNavigate?: () => void }) {
  const { org, info } = useOrg();
  const { me } = useSession();
  const nav = useNavigate();
  const role = info.member.title || ROLES[info.member.role as Role]?.title || "";
  const sub = [org.city || org.settings?.city, role].filter(Boolean).join("، ");
  const items: MenuProps["items"] = [
    {
      key: "orgs",
      type: "group",
      label: "سازمان‌ها",
      children: (me?.orgs ?? []).map((o) => ({
        key: o.id,
        label: (
          <span className="sh-menu-org">
            <span className="sh-menu-org-i" aria-hidden>
              {initial(o.name)}
            </span>
            <span className="sh-menu-org-n">{o.name}</span>
            {o.id === org.id ? <Ic icon={Check} className="sh-menu-check" /> : null}
          </span>
        ),
        onClick: () => {
          onNavigate?.();
          if (o.id !== org.id) nav(`/${o.id}`);
        },
      })),
    },
    { type: "divider" as const },
    {
      key: "all",
      icon: <Ic icon={Building2} />,
      label: "همهٔ سازمان‌ها",
      onClick: () => (onNavigate?.(), nav("/orgs")),
    },
    {
      key: "new",
      icon: <Ic icon={Plus} />,
      label: "سازمان تازه",
      onClick: () => (onNavigate?.(), nav("/orgs/new")),
    },
  ];
  const tile = org.logo ? <img src={org.logo} alt="" className="sh-tile-img" /> : <BrandTile size={30} />;
  return (
    <Dropdown trigger={["click"]} menu={{ items }} rootClassName="ds-glass sh-menu" placement={rail ? "bottomRight" : "bottom"}>
      {rail ? (
        <Tooltip title={org.name} placement="left">
          <button type="button" className="sh-biz sh-biz-rail" aria-label={`سازمان: ${org.name}`}>
            {tile}
          </button>
        </Tooltip>
      ) : (
        <button type="button" className="sh-biz" aria-label={`سازمان: ${org.name}، تغییر سازمان`}>
          {tile}
          <span className="sh-biz-t">
            <span className="sh-biz-name">{org.name}</span>
            {sub ? <span className="sh-biz-sub">{sub}</span> : null}
          </span>
          <Ic icon={ChevronsUpDown} className="sh-biz-chev" />
        </button>
      )}
    </Dropdown>
  );
}

// ---------------------------------------------------------------- space switcher
function SpaceSwitcher({ spaces, space, onSpace, rail, select }: { spaces: Space[]; space: SpaceKey; onSpace: (s: SpaceKey) => void; rail?: boolean; select?: boolean }) {
  const cur = spaceOf(space);
  if (spaces.length < 2) return null;
  const menu: MenuProps = {
    items: spaces.map((s) => ({
      key: s.key,
      icon: <Ic icon={s.icon} />,
      label: (
        <span className="sh-menu-row">
          <span>{s.title}</span>
          {s.key === space ? <Ic icon={Check} className="sh-menu-check" /> : null}
        </span>
      ),
      onClick: () => onSpace(s.key),
    })),
  };
  if (rail)
    return (
      <Dropdown trigger={["click"]} menu={menu} rootClassName="ds-glass sh-menu" placement="bottomRight">
        <Tooltip title={`بخش: ${cur.title}`} placement="left">
          <button type="button" className="sh-rail-btn sh-rail-space" aria-label={`بخش: ${cur.title}، تغییر بخش`}>
            <Ic icon={cur.icon} />
          </button>
        </Tooltip>
      </Dropdown>
    );
  if (select)
    return (
      <Dropdown trigger={["click"]} menu={menu} rootClassName="ds-glass sh-menu sh-menu-space" placement="bottom">
        <button type="button" className="sh-space-select" aria-label={`بخش: ${cur.title}، تغییر بخش`}>
          <span className="sh-space-ic" aria-hidden>
            <Ic icon={cur.icon} />
          </span>
          <span className="sh-space-t">{cur.title}</span>
          <Ic icon={ChevronsUpDown} className="sh-biz-chev" />
        </button>
      </Dropdown>
    );
  return (
    <div className="sh-seg" role="group" aria-label="بخش">
      {spaces.map((s) => (
        <button key={s.key} type="button" aria-pressed={s.key === space} title={s.title} data-label={s.label} onClick={() => onSpace(s.key)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- nav rows
function NavRow({
  item,
  active,
  rail,
  count,
  pinned,
  canPin,
  onTogglePin,
  onNavigate,
  bookmark,
  meta,
}: {
  item: ShellItem;
  active: boolean;
  rail?: boolean;
  count?: number;
  pinned: boolean;
  canPin: boolean;
  onTogglePin: () => void;
  onNavigate?: () => void;
  bookmark?: boolean;
  /** Small trailing text (a bookmark's space when it lies in another one). */
  meta?: string;
}) {
  const { orgId } = useOrg();
  const to = `/${orgId}${item.path ? `/${item.path}` : ""}`;
  const link = (
    <Link to={to} className={`sh-item ${bookmark ? "sh-item-bm" : ""}`} aria-current={active ? "page" : undefined} onClick={onNavigate} aria-label={rail ? item.label : undefined}>
      {item.icon ? <Ic icon={item.icon} /> : <span className="sh-dot" aria-hidden />}
      {rail ? null : <span className="sh-label">{item.label}</span>}
      {!rail && count ? (
        <span className="sh-count ds-num" title={item.count ? `${fa(count)} ${item.count.hint}` : undefined}>
          {fa(count)}
        </span>
      ) : null}
      {!rail && meta && !count ? <span className="sh-bm-meta">{meta}</span> : null}
      {rail && count ? <span className="sh-rail-dot" aria-hidden /> : null}
    </Link>
  );
  const menu: MenuProps = {
    items: [
      pinned
        ? {
            key: "unpin",
            icon: <Ic icon={PinOff} />,
            label: "برداشتن از نشان‌شده‌ها",
            onClick: onTogglePin,
          }
        : {
            key: "pin",
            icon: <Ic icon={Pin} />,
            label: "نشان کردن",
            disabled: !canPin,
            onClick: onTogglePin,
          },
    ],
  };
  const row = (
    <Dropdown trigger={["contextMenu"]} menu={menu} rootClassName="ds-glass sh-menu">
      {link}
    </Dropdown>
  );
  return rail ? (
    <Tooltip title={count ? `${item.label} (${fa(count)})` : item.label} placement="left" mouseEnterDelay={0.25}>
      <div>{row}</div>
    </Tooltip>
  ) : (
    row
  );
}

// ---------------------------------------------------------------- footer
function Footer({ rail, onSettings, onNavigate, settingsActive }: { rail?: boolean; onSettings: () => void; onNavigate?: () => void; settingsActive: boolean }) {
  const sync = useSyncState();
  const { orgId } = useOrg();
  const { meta } = useSession();
  const nav = useNavigate();
  // on Windows the state opens «نسخهٔ ویندوز» (backup, network and sync)
  const desktop = meta?.mode === "desktop";
  const openDesktop = desktop
    ? () => {
        onNavigate?.();
        nav(`/${orgId}/settings/desktop`);
      }
    : undefined;
  const help = () => {
    onNavigate?.();
    nav(`/${orgId}/help`);
  };
  if (rail)
    return (
      <div className="sh-foot sh-foot-rail">
        <Tooltip title={[sync.word, sync.meta].filter(Boolean).join("، ")} placement="left">
          {openDesktop ? (
            <button type="button" className="sh-rail-sync" aria-label={`${sync.word}، نسخهٔ ویندوز`} onClick={openDesktop}>
              <SyncNuqta tone={sync.tone} />
            </button>
          ) : (
            <span className="sh-rail-sync" tabIndex={0} aria-label={sync.word}>
              {sync.tone === "web" ? <span className="ds-nuqta sh-nuqta sh-nuqta-web" aria-hidden /> : <SyncNuqta tone={sync.tone} />}
            </span>
          )}
        </Tooltip>
        <Tooltip title="تنظیمات" placement="left">
          <button type="button" className="sh-icon-btn" aria-label="تنظیمات" aria-pressed={settingsActive} onClick={onSettings}>
            <Ic icon={Settings} />
          </button>
        </Tooltip>
      </div>
    );
  return (
    <div className="sh-foot">
      <SyncLine state={sync} onOpen={openDesktop} />
      <span className="sh-foot-tools">
        <Tooltip title="راهنما و میانبرها">
          <button type="button" className="sh-icon-btn sh-icon-sm" aria-label="راهنما" onClick={help}>
            <Ic icon={CircleHelp} />
          </button>
        </Tooltip>
        <Tooltip title="تنظیمات">
          <button type="button" className="sh-icon-btn sh-icon-sm" aria-label="تنظیمات" aria-pressed={settingsActive} onClick={onSettings}>
            <Ic icon={Settings} />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- sidebar
export function Sidebar(p: SidebarProps) {
  const { items, spaces, space, active, rail, pins } = p;
  const counts = useCounts(items);
  const [closed, setClosed] = useStored<string[]>("itsm.nav.closed", []);
  const { common, sections } = useMemo(() => sectionsOf(items, space), [items, space]);
  const pinned = useMemo(() => pins.map((k) => items.find((i) => i.key === k)).filter((i): i is ShellItem => !!i), [pins, items]);
  const togglePin = (key: string) => p.onPins(pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key].slice(0, MAX_PINS));
  const settings = space === "settings";

  const row = (i: ShellItem, bookmark?: boolean) => (
    <NavRow
      key={`${bookmark ? "bm-" : ""}${i.key}`}
      item={i}
      active={active?.key === i.key && !bookmark}
      rail={rail}
      count={i.count ? counts?.[i.count.key] : undefined}
      pinned={pins.includes(i.key)}
      canPin={pins.length < MAX_PINS}
      onTogglePin={() => togglePin(i.key)}
      onNavigate={p.onNavigate}
      bookmark={bookmark}
      meta={bookmark && !i.common && i.space !== space ? spaceOf(i.space).label : undefined}
    />
  );

  return (
    <aside className={`sh-side no-print ${rail ? "sh-rail" : ""}`} aria-label="ناوبری">
      <div className="sh-side-head">
        <BizSwitcher rail={rail} onNavigate={p.onNavigate} />
        {settings ? (
          rail ? (
            <Tooltip title="بازگشت" placement="left">
              <button type="button" className="sh-rail-btn" aria-label="بازگشت از تنظیمات" onClick={p.onLeaveSettings}>
                <Ic icon={ArrowRight} />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className="sh-back" onClick={p.onLeaveSettings}>
              <Ic icon={ArrowRight} />
              <span>تنظیمات</span>
            </button>
          )
        ) : (
          <SpaceSwitcher spaces={spaces} space={space} onSpace={p.onSpace} rail={rail} select={spaces.length >= 5} />
        )}
        {rail ? (
          <Tooltip
            title={
              <span>
                جست‌وجو یا فرمان <Keys keys={["Ctrl", "K"]} className="sh-keys-tip" />
              </span>
            }
            placement="left"
          >
            <button type="button" className="sh-rail-btn" aria-label="جست‌وجو یا فرمان" onClick={p.onPalette}>
              <Ic icon={Search} />
            </button>
          </Tooltip>
        ) : (
          <button type="button" className="sh-search" onClick={p.onPalette} aria-keyshortcuts="Control+K">
            <Ic icon={Search} />
            <span className="sh-search-ph">جست‌وجو یا فرمان</span>
            <span className="ds-end">
              <Keys keys={["Ctrl", "K"]} />
            </span>
          </button>
        )}
      </div>

      <div className="sh-scroll">
        {/* the nav swaps with a 100 ms fade when the space changes (components.md §13.2) */}
        <div key={space} className="sh-swap">
          {common.length ? (
            <nav className="sh-nav" aria-label="عمومی">
              {common.map((i) => row(i))}
            </nav>
          ) : null}
          {common.length && sections[0] && sections[0].label === null ? <div className="sh-div" role="separator" /> : null}
          {sections.map((s) => {
            const id = `${space}:${s.label ?? ""}`;
            const hasActive = s.items.some((i) => i.key === active?.key);
            const isClosed = !!s.label && closed.includes(id) && !hasActive;
            if (rail)
              return (
                <nav key={id} className="sh-nav sh-nav-rail-sec" aria-label={s.label ?? spaceOf(space).title}>
                  {s.items.map((i) => row(i))}
                </nav>
              );
            return (
              <SectionBlock
                key={id}
                label={s.label}
                closed={isClosed}
                onToggle={s.label ? () => setClosed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])) : undefined}
                first={!common.length && s === sections[0]}
              >
                {s.items.map((i) => row(i))}
              </SectionBlock>
            );
          })}
        </div>
        {pinned.length ? (
          rail ? (
            <nav className="sh-nav sh-nav-rail-sec" aria-label="نشان‌شده‌ها">
              {pinned.map((i) => row(i, true))}
            </nav>
          ) : (
            <SectionBlock label="نشان‌شده‌ها">{pinned.map((i) => row(i, true))}</SectionBlock>
          )
        ) : null}
      </div>

      <Footer rail={rail} onSettings={p.onSettings} onNavigate={p.onNavigate} settingsActive={settings} />
      {!rail && p.onResize ? <Resizer width={p.width} onResize={p.onResize} /> : null}
    </aside>
  );
}

function SectionBlock({ label, closed, onToggle, first, children }: { label: string | null; closed?: boolean; onToggle?: () => void; first?: boolean; children: ReactNode }) {
  if (!label) return <nav className={`sh-nav ${first ? "sh-nav-first" : ""}`}>{children}</nav>;
  return (
    <div className="sh-sec">
      {onToggle ? (
        <button type="button" className="sh-sec-label" aria-expanded={!closed} onClick={onToggle}>
          <span>{label}</span>
          <Ic icon={ChevronDown} size={14} className="sh-sec-chev" />
        </button>
      ) : (
        <div className="sh-sec-label">
          <span>{label}</span>
        </div>
      )}
      {closed ? null : (
        <nav className="sh-nav" aria-label={label}>
          {children}
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- resize handle (inner edge, 200–320, double-click resets)
function Resizer({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    // RTL: the sidebar is on the right, its inner edge on the left — moving left widens it
    const w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, start.current.w + (start.current.x - e.clientX))));
    onResize(w);
  };
  const up = () => {
    start.current = null;
    setDrag(false);
  };
  return (
    <div
      className={`sh-resize ${drag ? "is-drag" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="پهنای نوار کناری"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={-1}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onResize(SIDEBAR_W)}
    />
  );
}
