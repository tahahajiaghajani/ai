// Menu, routes and palette searches of the signed-in app. Every module describes its part of the shell in its own
// folder (src/ui/modules/<module>/index.tsx exports a `ModuleUi`) and is listed once in UIS below; this file only
// assembles them. The platform has two: «خانه» (home) and «تنظیمات» (settings and help).
//
// Navigation model (components.md §1.2): the sidebar's segmented control picks a *space* — one per area of work that
// modules add («درخواست‌ها»، «دارایی‌ها»…), only those the member may open — and the nav below lists that space's items
// with small section labels («گزارش‌ها»، «تعریف‌ها»…). Items marked `common` («خانه») sit at the top of every space.
// Settings and help form their own space, opened from the sidebar footer. Every route stays reachable from the nav
// and from the command palette (Ctrl K), which also searches the records modules register (`searches`).
import type { ReactNode } from "react";
import { House, Settings, type LucideIcon } from "lucide-react";
import type { Area, Level } from "@shared/permissions";
import type { AccessGate } from "@shared/access";
import type { ModuleKey } from "@shared/constants";
import type { OrgApi } from "../lib/api";
import { homeUi } from "./home";
import { recordsUi } from "./records";
import { settingsUi } from "./settings";
import { accessUi } from "./access";
import { notifyUi } from "./notify";
import { slaUi } from "./sla";
import { flowsUi } from "./flows";
import { incidentUi } from "./incident";
import { problemUi } from "./problem";
import { changeUi } from "./change";
import { requestUi } from "./request";
import { docsUi } from "./docs";
import { cmdbUi } from "./cmdb";
import { servicePortfolioUi } from "./service_portfolio";
import { knowledgeUi } from "./knowledge";
import { securityUi } from "./security";

/** A sidebar space: «خانه», «تنظیمات», or one a module adds (its key, e.g. "service-desk"). */
export type SpaceKey = string;

/** A live count at the end of a nav row (a cheap query of the module, refreshed every two minutes). */
export interface NavCount {
  /** stable key of the count (several rows may share one) */
  key: string;
  /** what the number counts, for the tooltip: «درخواست باز» */
  hint: string;
  load: (api: OrgApi) => Promise<number>;
}

export interface NavItem {
  key: string;
  label: string;
  path: string; // relative to /:org/
  area?: Area;
  level?: Level;
  /** the member's ITSM access this item needs (an area, an operation, the least scope); hidden otherwise */
  access?: AccessGate;
  module?: ModuleKey;
  desktopOnly?: boolean;
  cloudOnly?: boolean;
  keywords?: string;
  /** Lucide icon (16 px, stroke 1.4 in the shell). */
  icon?: LucideIcon;
  /** Section label inside the space («گزارش‌ها»، «تعریف‌ها»…); no section = the space's main list. */
  section?: string;
  /** Shown at the top of every space («خانه»). */
  common?: boolean;
  /** Starts something new: listed under «کارها» in the command palette and kept out of the sidebar (page
   *  headers carry the create buttons), unless it is also a `workspace`. */
  action?: boolean;
  /** A screen people work in all day (a queue, a board): an action that stays in the sidebar. */
  workspace?: boolean;
  /** A live count at the end of the row. */
  count?: NavCount;
}

export interface NavGroup {
  key: string;
  label: string;
  icon?: ReactNode;
  module?: ModuleKey;
  /** The sidebar space this group belongs to. */
  space: SpaceKey;
  items: NavItem[];
}

export interface AppRoute {
  path: string;
  element: ReactNode;
}

export interface Space {
  key: SpaceKey;
  /** Short label of the segmented control. */
  label: string;
  /** Long label (rail popover, palette meta, breadcrumbs of detail pages). */
  title: string;
  icon: LucideIcon;
  module?: ModuleKey;
  /** the member's ITSM access the space needs (besides having an item to show) */
  access?: AccessGate;
}

/** One row a palette search found. */
export interface PaletteHit {
  id: string;
  label: string;
  /** small text after the label (a number, a date, a state) */
  meta?: string;
  /** org-relative path the row opens */
  path: string;
}

/** A module's record search in the command palette (members today; later requests, assets…). */
export interface PaletteSearch {
  key: string;
  /** the group heading of its rows: «اعضا» */
  group: string;
  icon: LucideIcon;
  area?: Area;
  level?: Level;
  access?: AccessGate;
  module?: ModuleKey;
  /** shortest query it runs for (default 2) */
  minLength?: number;
  run: (api: OrgApi, q: string) => Promise<PaletteHit[]>;
}

/** What a module contributes to the shell. */
export interface ModuleUi {
  /** spaces of the segmented control it adds (in order) */
  spaces?: Space[];
  nav: NavGroup[];
  routes: AppRoute[];
  /** first path segment → space, for its routes that are not nav items (editors, detail pages) */
  segments?: Record<string, SpaceKey>;
  searches?: PaletteSearch[];
  /**
   * sign-in-free pages under /p/ (what an organisation published on purpose: the status page by its secret link…);
   * they read only the sign-in-free API (`publicApi`, /api/public)
   */
  publicRoutes?: AppRoute[];
}

/** «خانه»: the space of the home page; the only space until a module adds one. */
export const HOME_SPACE: Space = { key: "home", label: "خانه", title: "خانه", icon: House };
export const SETTINGS_SPACE: Space = { key: "settings", label: "تنظیمات", title: "تنظیمات", icon: Settings };

/** The modules of the app, in menu order. A new module adds its ModuleUi here. */
const UIS: ModuleUi[] = [
  homeUi,
  recordsUi,
  settingsUi,
  accessUi,
  notifyUi,
  slaUi,
  flowsUi,
  incidentUi,
  problemUi,
  changeUi,
  requestUi,
  docsUi,
  cmdbUi,
  servicePortfolioUi,
  knowledgeUi,
  securityUi,
];

/** In the order of the segmented control. «تنظیمات» is not a segment: the footer's gear opens it. */
export const SPACES: Space[] = [HOME_SPACE, ...UIS.flatMap((u) => u.spaces ?? [])];

/** The first path segment → space, for routes that are not nav items (editors, detail pages). */
export const SPACE_OF_SEGMENT: Record<string, SpaceKey | undefined> = Object.assign({}, ...UIS.map((u) => u.segments ?? {}));

export const NAV: NavGroup[] = UIS.flatMap((u) => u.nav);

export const ROUTES: AppRoute[] = UIS.flatMap((u) => u.routes);

export const SEARCHES: PaletteSearch[] = UIS.flatMap((u) => u.searches ?? []);

/** The sign-in-free pages of every module (paths under /p/). */
export const PUBLIC_ROUTES: AppRoute[] = UIS.flatMap((u) => u.publicRoutes ?? []);
