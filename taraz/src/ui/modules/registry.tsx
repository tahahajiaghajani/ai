// Menu and routes of the signed-in app. Each business module contributes its own group and
// routes (src/ui/modules/<module>/index.tsx); this file only assembles them.
import type { ReactNode } from "react";
import {
  DashboardOutlined, BookOutlined, TeamOutlined, BankOutlined, ShoppingCartOutlined, InboxOutlined,
  GoldOutlined, DollarOutlined, BarChartOutlined, SettingOutlined,
} from "@ant-design/icons";
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
}

export interface NavGroup {
  key: string;
  label: string;
  icon: ReactNode;
  module?: ModuleKey;
  items: NavItem[];
}

export interface AppRoute {
  path: string;
  element: ReactNode;
}

export const NAV: NavGroup[] = [
  { key: "home", label: "پیشخوان", icon: <DashboardOutlined />, items: [{ key: "dashboard", label: "پیشخوان", path: "" }] },
  { ...accountingNav, icon: <BookOutlined /> },
  { ...partiesNav, icon: <TeamOutlined /> },
  { ...treasuryNav, icon: <BankOutlined /> },
  { ...commerceNav, icon: <ShoppingCartOutlined /> },
  { ...inventoryNav, icon: <InboxOutlined /> },
  { ...goldNav, icon: <GoldOutlined /> },
  { ...fxNav, icon: <DollarOutlined /> },
  { ...reportsNav, icon: <BarChartOutlined /> },
  { ...settingsNav, icon: <SettingOutlined /> },
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
