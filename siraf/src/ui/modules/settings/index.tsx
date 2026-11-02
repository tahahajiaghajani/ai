import { lazy } from "react";
import type { NavGroup, AppRoute } from "../registry";

const OrgSettings = lazy(() => import("./OrgSettings"));
const Members = lazy(() => import("./Members"));
const Account = lazy(() => import("./Account"));
const Desktop = lazy(() => import("./Desktop"));
const Audit = lazy(() => import("./Audit"));
const Integrations = lazy(() => import("./Integrations"));
const Help = lazy(() => import("./Help"));

export const settingsNav: Omit<NavGroup, "icon"> = {
  key: "settings",
  label: "تنظیمات",
  items: [
    { key: "org-settings", label: "اطلاعات و تنظیمات کسب‌وکار", path: "settings/org", area: "settings", keywords: "مالیات ارزش افزوده لوگو ماژول" },
    { key: "members", label: "کاربران و دسترسی‌ها", path: "settings/users", area: "users" },
    { key: "integrations", label: "اتصال به فروشگاه اینترنتی و API", path: "settings/integrations", area: "integrations", keywords: "ووکامرس شاپیفای وبهوک سایت" },
    { key: "desktop", label: "نسخه‌ی ویندوز: پشتیبان، شبکه، همگام‌سازی", path: "settings/desktop", desktopOnly: true, keywords: "بکاپ LAN شبکه ابری" },
    { key: "audit", label: "گزارش رویدادها", path: "settings/audit", area: "settings" },
    { key: "account", label: "حساب کاربری من", path: "settings/account" },
    { key: "help", label: "راهنما و میانبرها", path: "help", keywords: "کمک آموزش کلید میانبر" },
  ],
};

export const settingsRoutes: AppRoute[] = [
  { path: "settings/org", element: <OrgSettings /> },
  { path: "settings/users", element: <Members /> },
  { path: "settings/account", element: <Account /> },
  { path: "settings/desktop", element: <Desktop /> },
  { path: "settings/audit", element: <Audit /> },
  { path: "settings/integrations", element: <Integrations /> },
  { path: "help", element: <Help /> },
];
