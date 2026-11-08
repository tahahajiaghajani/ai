// One place for a module to plug its tables into the shell: `recordModule()` turns a short description — the tables,
// their paths, labels, icons, sections, access, list presets and record-page extensions — into the `ModuleUi` the
// registry assembles (nav items, list / new / record routes, palette searches and «… تازه» actions) and registers
// the extensions (with the table's path, so every link to its records lands on the module's pages). The generic
// routes `r/:table`, `r/:table/new` and `r/:table/:id` serve every other table.
import { lazy, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { Area, Level } from "@shared/permissions";
import type { AccessGate } from "@shared/access";
import type { AppRoute, ModuleUi, NavCount, NavGroup, NavItem, PaletteSearch, Space, SpaceKey } from "../modules/registry";
import { recordsApi } from "./data/api";
import { displayText } from "./model/schema";
import type { RecordRow, TableMeta } from "./model/types";
import { recordPath, registerRecordExtensions, type ListPreset, type RecordExtensions } from "./extensions";

const ListRoute = lazy(() => import("./routes").then((m) => ({ default: m.ListRoute })));
const PageRoute = lazy(() => import("./routes").then((m) => ({ default: m.PageRoute })));

export interface RecordTableEntry {
  /** the engine table */
  table: string;
  /** org-relative base path: the list; `<path>/new` and `<path>/:id` are generated */
  path: string;
  /** nav label (usually the table's plural) */
  label: string;
  icon?: LucideIcon;
  /** nav section inside the space («تعریف‌ها»…) */
  section?: string;
  /** the sidebar space (default: the module's) */
  space?: SpaceKey;
  area?: Area;
  level?: Level;
  /** the member's ITSM access the table's nav item needs (its «… تازه» needs create in the same area) */
  access?: AccessGate;
  keywords?: string;
  /** routes only, no nav item */
  hidden?: boolean;
  /** a screen people work in all day (queues, boards) */
  workspace?: boolean;
  count?: NavCount;
  /** the command palette's search of this table (on by default; `false` turns it off) */
  search?: false | { group?: string; minLength?: number };
  /** «<label> تازه» in the palette's «کارها» (default true) */
  newAction?: boolean;
  /** the record noun for «… تازه» (default: label) */
  noun?: string;
  /** list page: title, preset, header actions */
  list?: { title?: ReactNode; preset?: ListPreset; actions?: ReactNode };
  /** record page widgets, composer slots, UI policies… (registered with the table's path) */
  extensions?: RecordExtensions;
}

export interface RecordModuleSpec {
  /** the module key (nav items, keys of generated entries) */
  key: string;
  /** a space of the sidebar the module adds (its key is used as the tables' default space) */
  space?: Space;
  /** the space of the module's nav group when it adds none («home», «settings» or another module's) */
  spaceKey?: SpaceKey;
  group: { key: string; label: string };
  tables: RecordTableEntry[];
  /** anything else the module adds, as in a plain ModuleUi */
  nav?: NavItem[];
  routes?: AppRoute[];
  searches?: PaletteSearch[];
  segments?: Record<string, SpaceKey>;
}

/** The list page of a table bound to a route (`table`, or the route's `:table`); loaded on first use. */
export function RecordListRoute(p: { table?: string; title?: ReactNode; preset?: ListPreset; actions?: ReactNode }) {
  return <ListRoute {...p} />;
}

/** The record page of a table bound to a route (`:id`, or «new»); loaded on first use. */
export function RecordPageRoute(p: { table?: string; id?: string; extensions?: RecordExtensions }) {
  return <PageRoute {...p} />;
}

/** A command-palette search of a table: number or words, five hits, each opening its record. */
export function recordSearch(table: string, o: { key?: string; group: string; icon: LucideIcon; area?: Area; level?: Level; access?: AccessGate; minLength?: number }): PaletteSearch {
  return {
    key: o.key ?? `records:${table}`,
    group: o.group,
    icon: o.icon,
    area: o.area,
    level: o.level,
    access: o.access,
    minLength: o.minLength ?? 2,
    async run(api, q) {
      const meta = await recordsApi.table(api, table).catch(() => null);
      const def = meta?.table as TableMeta | undefined;
      if (!def) return [];
      const r = await recordsApi.list(api, table, { q, size: 5, fields: ["number", def.display, ...(def.states ? [def.states.field] : [])], total: false });
      const stateLabel = (row: RecordRow) => (def.states ? (def.states.states.find((s) => s.value === row[def.states!.field])?.label ?? "") : "");
      return r.rows.map((row) => ({
        id: row.id,
        label: displayText(def, row) || String(row.number ?? ""),
        meta: [row.number, stateLabel(row)].filter(Boolean).join("، "),
        path: recordPath(table, row.id),
      }));
    },
  };
}

/** The ModuleUi of a module built on engine tables (see RecordModuleSpec). */
export function recordModule(spec: RecordModuleSpec): ModuleUi {
  const space = spec.space?.key ?? spec.spaceKey ?? "home";
  const items: NavItem[] = [];
  const routes: AppRoute[] = [];
  const searches: PaletteSearch[] = [];
  for (const t of spec.tables) {
    registerRecordExtensions(t.table, { ...(t.extensions ?? {}), path: t.path });
    if (!t.hidden)
      items.push({ key: `${spec.key}:${t.table}`, label: t.label, path: t.path, icon: t.icon, section: t.section, area: t.area, level: t.level, access: t.access, keywords: t.keywords, workspace: t.workspace, count: t.count });
    if (t.newAction !== false)
      items.push({ key: `${spec.key}:${t.table}:new`, label: `${t.noun ?? t.label} تازه`, path: `${t.path}/new`, icon: t.icon, area: t.area, level: "edit", access: t.access ? { area: t.access.area, op: "create" } : undefined, action: true, keywords: t.keywords });
    routes.push(
      { path: t.path, element: <RecordListRoute table={t.table} title={t.list?.title} preset={t.list?.preset} actions={t.list?.actions} /> },
      { path: `${t.path}/new`, element: <RecordPageRoute table={t.table} id="new" /> },
      { path: `${t.path}/:id`, element: <RecordPageRoute table={t.table} /> },
    );
    if (t.search !== false && t.icon) searches.push(recordSearch(t.table, { group: t.search?.group ?? t.label, icon: t.icon, area: t.area, level: t.level, access: t.access, minLength: t.search?.minLength }));
  }
  const groups: NavGroup[] = [{ key: spec.group.key, label: spec.group.label, space, items: [...items, ...(spec.nav ?? [])] }];
  return {
    spaces: spec.space ? [spec.space] : undefined,
    nav: groups,
    routes: [...routes, ...(spec.routes ?? [])],
    searches: [...searches, ...(spec.searches ?? [])],
    segments: spec.segments,
  };
}
