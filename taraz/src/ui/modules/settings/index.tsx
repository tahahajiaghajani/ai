import { lazy } from "react";
import type { NavGroup, AppRoute } from "../registry";

const OrgSettings = lazy(() => import("./OrgSettings"));
const Members = lazy(() => import("./Members"));
const Account = lazy(() => import("./Account"));
const Desktop = lazy(() => import("./Desktop"));
const Audit = lazy(() => import("./Audit"));

export const settingsNav: Omit<NavGroup, "icon"> = {
  key: "settings",
  label: "تنظیمات",
  items: [
    { key: "org-settings", label: "اطلاعات و تنظیمات کسب‌وکار", path: "settings/org", area: "settings", keywords: "مالیات ارزش افزوده لوگو ماژول" },
    { key: "members", label: "کاربران و دسترسی‌ها", path: "settings/users", area: "users" },
    { key: "desktop", label: "نسخه‌ی ویندوز: پشتیبان، شبکه، همگام‌سازی", path: "settings/desktop", desktopOnly: true, keywords: "بکاپ LAN شبکه ابری" },
    { key: "audit", label: "گزارش رویدادها", path: "settings/audit", area: "settings" },
    { key: "account", label: "حساب کاربری من", path: "settings/account" },
  ],
};

export const settingsRoutes: AppRoute[] = [
  { path: "settings/org", element: <OrgSettings /> },
  { path: "settings/users", element: <Members /> },
  { path: "settings/account", element: <Account /> },
  { path: "settings/desktop", element: <Desktop /> },
  { path: "settings/audit", element: <Audit /> },
];
