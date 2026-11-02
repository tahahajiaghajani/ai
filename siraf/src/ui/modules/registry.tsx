// Menu and routes of the signed-in app. Each business module contributes its own groups and
// routes (src/ui/modules/<module>/index.tsx); this file only assembles them.
//
// Navigation model (components.md §1.2): the sidebar's segmented control picks a *space*
// («حساب · خزانه · کالا · طلا · صرافی», only the enabled ones) and the nav below lists that space's
// items, with small section labels («گزارش‌ها»، «تعریف‌ها»…). Items marked `common` (پیشخوان، اشخاص)
// sit at the top of every space. Settings and help form their own space, opened from the sidebar
// footer. Every route stays reachable from the nav and from the command palette (Ctrl K).
import type { ReactNode } from "react";
import { House, BookOpenText, Wallet, Package, Gem, ArrowLeftRight, Settings, type LucideIcon } from "lucide-react";
import type { Area, Level } from "@shared/permissions";
import type { ModuleKey } from "@shared/constants";
import { accountingNav, accountingRoutes } from "./accounting";
import { partiesNav, partiesRoutes } from "./parties";
import { reportsNav, reportsRoutes } from "./reports";
import { settingsNav, settingsRoutes } from "./settings";
import { treasuryNav, treasuryRoutes } from "./treasury";
import { commerceNav, inventoryNav, goodsRoutes } from "./goods";
import { goldNav, goldRoutes } from "./gold";
import { fxNav, fxRoutes } from "./fx";
import { dashboardRoutes } from "./dashboard";

/** A sidebar space: the segmented control's items, plus the settings space opened from the footer. */
export type SpaceKey = "accounting" | "treasury" | "goods" | "gold" | "fx" | "settings";

/** Live counts the shell can show at the end of a nav row (fetched by the shell, cheap queries only). */
export type NavCount = "draft-vouchers" | "overdue-cheques";

export interface NavItem {
  key: string;
  label: string;
  path: string; // relative to /:org/
  area?: Area;
  level?: Level;
  module?: ModuleKey;
  desktopOnly?: boolean;
  cloudOnly?: boolean;
  keywords?: string;
  /** Lucide icon (16 px, stroke 1.4 in the shell). */
  icon?: LucideIcon;
  /** Section label inside the space («گزارش‌ها»، «تعریف‌ها»…); no section = the space's main list. */
  section?: string;
  /** Shown at the top of every space (پیشخوان، اشخاص). */
  common?: boolean;
  /** Starts something new: listed under «کارها» in the command palette. */
  action?: boolean;
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
}

/** In the order of the segmented control. «تنظیمات» is not a segment: the footer's gear opens it. */
export const SPACES: Space[] = [
  { key: "accounting", label: "حساب", title: "حسابداری", icon: BookOpenText },
  { key: "treasury", label: "خزانه", title: "خزانه‌داری", icon: Wallet },
  { key: "goods", label: "کالا", title: "کالا و بازرگانی", icon: Package, module: "goods" },
  { key: "gold", label: "طلا", title: "طلا و جواهر", icon: Gem, module: "gold" },
  { key: "fx", label: "صرافی", title: "صرافی و ارز دیجیتال", icon: ArrowLeftRight, module: "fx" },
];
export const SETTINGS_SPACE: Space = { key: "settings", label: "تنظیمات", title: "تنظیمات", icon: Settings };

/** The first path segment → space, for routes that are not nav items (editors, detail pages). */
export const SPACE_OF_SEGMENT: Record<string, SpaceKey | undefined> = {
  accounting: "accounting",
  reports: "accounting",
  treasury: "treasury",
  sales: "goods",
  purchases: "goods",
  inventory: "goods",
  gold: "gold",
  fx: "fx",
  settings: "settings",
  help: "settings",
};

export const NAV: NavGroup[] = [
  { key: "home", label: "پیشخوان", space: "accounting", items: [{ key: "dashboard", label: "پیشخوان", path: "", icon: House, common: true, keywords: "داشبورد خلاصه" }] },
  { ...accountingNav, space: "accounting" },
  { ...partiesNav, space: "accounting" },
  { ...reportsNav, space: "accounting" },
  { ...treasuryNav, space: "treasury" },
  { ...commerceNav, space: "goods" },
  { ...inventoryNav, space: "goods" },
  { ...goldNav, space: "gold" },
  { ...fxNav, space: "fx" },
  { ...settingsNav, space: "settings" },
];

export const ROUTES: AppRoute[] = [
  ...dashboardRoutes,
  ...accountingRoutes,
  ...partiesRoutes,
  ...treasuryRoutes,
  ...goodsRoutes,
  ...goldRoutes,
  ...fxRoutes,
  ...reportsRoutes,
  ...settingsRoutes,
];
