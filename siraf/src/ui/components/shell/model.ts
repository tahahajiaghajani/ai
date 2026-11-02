// The shell's navigation model: which nav items the member can see, which space (segment) the
// current route belongs to, the remembered page of each space, pins and recent pages.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { NAV, SPACES, SETTINGS_SPACE, SPACE_OF_SEGMENT, type NavGroup, type NavItem, type Space, type SpaceKey } from "../../modules/registry";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";

export type ShellItem = NavItem & { space: SpaceKey; group: string };

// ---------------------------------------------------------------- storage (never required to render)
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or blocked storage */
  }
}

/** A state mirrored to localStorage under `key` (read once, written on change). */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => readJSON(key, fallback));
  // a different key (another organisation) reloads the value
  const [k, setK] = useState(key);
  if (k !== key) {
    setK(key);
    setV(readJSON(key, fallback));
  }
  const set = useCallback(
    (next: T | ((p: T) => T)) =>
      setV((prev) => {
        const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeJSON(key, val);
        return val;
      }),
    [key],
  );
  return [v, set];
}

// ---------------------------------------------------------------- visible nav
export function useVisibleNav(): NavGroup[] {
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

export function useShellItems(): ShellItem[] {
  const groups = useVisibleNav();
  return useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, space: g.space, group: g.label }))), [groups]);
}

/** The segmented control's spaces: enabled modules with at least one non-common item the member may open. */
export function useSpaces(items: ShellItem[]): Space[] {
  return useMemo(() => SPACES.filter((s) => items.some((i) => i.space === s.key && !i.common)), [items]);
}

export const spaceOf = (key: SpaceKey): Space => (key === "settings" ? SETTINGS_SPACE : SPACES.find((s) => s.key === key) ?? SPACES[0]);

/** Path of the org-relative route: `/org/sales/invoices/12` → `sales/invoices/12`. */
export function useRelPath(): string {
  const { orgId } = useOrg();
  const { pathname } = useLocation();
  return pathname.replace(`/${orgId}`, "").replace(/^\/+|\/+$/g, "");
}

/** The nav item a route belongs to (longest path prefix). */
export function matchItem(items: ShellItem[], rel: string): ShellItem | null {
  let best: ShellItem | null = null;
  for (const i of items) {
    const hit = i.path === "" ? rel === "" : rel === i.path || rel.startsWith(`${i.path}/`);
    if (hit && (!best || i.path.length > best.path.length)) best = i;
  }
  return best;
}

/** The space a route belongs to; null for common pages (پیشخوان، اشخاص) that belong to every space. */
export function routeSpace(item: ShellItem | null, rel: string): SpaceKey | null {
  if (item && !item.common) return item.space;
  if (item?.common) return null;
  return SPACE_OF_SEGMENT[rel.split("/")[0]] ?? null;
}

// ---------------------------------------------------------------- sections of a space
export interface NavSection {
  label: string | null; // null = the main list
  items: ShellItem[];
}

const LAST_SECTIONS = ["گزارش‌ها", "تعریف‌ها", "شما"];

export function sectionsOf(items: ShellItem[], space: SpaceKey): { common: ShellItem[]; sections: NavSection[] } {
  const common = space === "settings" ? [] : items.filter((i) => i.common);
  const own = items.filter((i) => i.space === space && !i.common);
  const map = new Map<string | null, ShellItem[]>();
  for (const i of own) {
    const k = i.section ?? null;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  const sections = [...map.entries()].map(([label, its]) => ({ label, items: its }));
  const rank = (s: NavSection) => (s.label === null ? -1 : LAST_SECTIONS.indexOf(s.label));
  sections.sort((a, b) => rank(a) - rank(b));
  return { common, sections };
}

/** Keeps the last page of each space and the last space, per organisation. */
export function useSpaceMemory(orgId: string, current: SpaceKey | null, rel: string, search: string) {
  const [last, setLast] = useStored<SpaceKey>(`siraf.space.${orgId}`, "accounting");
  const [pages, setPages] = useStored<Partial<Record<SpaceKey, string>>>(`siraf.spacePages.${orgId}`, {});
  useEffect(() => {
    if (!current) return;
    if (current !== "settings" && current !== last) setLast(current);
    const path = rel + search;
    setPages((p) => (p[current] === path ? p : { ...p, [current]: path }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, rel, search]);
  return { last, setLast, pages };
}

// ---------------------------------------------------------------- recent pages (command palette «اخیر»)
export interface Recent {
  path: string; // org-relative, with query
  label: string;
  key?: string;
}
export const recentKey = (orgId: string) => `siraf.recent.${orgId}`;
export function pushRecent(orgId: string, r: Recent) {
  const list = readJSON<Recent[]>(recentKey(orgId), []).filter((x) => x.path !== r.path);
  writeJSON(recentKey(orgId), [r, ...list].slice(0, 5));
}
