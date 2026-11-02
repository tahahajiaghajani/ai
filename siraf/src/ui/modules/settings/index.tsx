import { lazy } from "react";
import { Building2, UserCog, Plug, Monitor, ScrollText, CircleUser, CircleHelp, Sparkles } from "lucide-react";
import type { NavGroup, AppRoute } from "../registry";

const OrgSettings = lazy(() => import("./OrgSettings"));
const Members = lazy(() => import("./Members"));
const Account = lazy(() => import("./Account"));
const Desktop = lazy(() => import("./Desktop"));
const Audit = lazy(() => import("./Audit"));
const Integrations = lazy(() => import("./Integrations"));
const Help = lazy(() => import("./Help"));
const AiSettings = lazy(() => import("../../ai/settings/AiSettings"));

export const settingsNav: Omit<NavGroup, "icon" | "space"> = {
  key: "settings",
  label: "تنظیمات",
  items: [
    { key: "org-settings", label: "کسب‌وکار", path: "settings/org", area: "settings", icon: Building2, keywords: "اطلاعات و تنظیمات کسب‌وکار مالیات ارزش افزوده لوگو ماژول" },
    { key: "members", label: "کاربران و دسترسی‌ها", path: "settings/users", area: "users", icon: UserCog },
    { key: "ai", label: "هوش مصنوعی", path: "settings/ai", area: "ai", level: "full", icon: Sparkles, keywords: "دستیار کلید API مدل Claude Gemini OpenAI هوش مصنوعی مصرف بودجه" },
    { key: "integrations", label: "اتصال‌ها و API", path: "settings/integrations", area: "integrations", icon: Plug, keywords: "اتصال به فروشگاه اینترنتی ووکامرس شاپیفای وبهوک سایت" },
    { key: "desktop", label: "نسخهٔ ویندوز", path: "settings/desktop", desktopOnly: true, icon: Monitor, keywords: "پشتیبان شبکه همگام‌سازی بکاپ LAN ابری" },
    { key: "audit", label: "گزارش رویدادها", path: "settings/audit", area: "settings", icon: ScrollText },
    { key: "account", label: "حساب کاربری من", path: "settings/account", icon: CircleUser, section: "شما", keywords: "رمز عبور" },
    { key: "help", label: "راهنما و میانبرها", path: "help", icon: CircleHelp, section: "شما", keywords: "کمک آموزش کلید میانبر" },
  ],
};

export const settingsRoutes: AppRoute[] = [
  { path: "settings/org", element: <OrgSettings /> },
  { path: "settings/users", element: <Members /> },
  { path: "settings/account", element: <Account /> },
  { path: "settings/desktop", element: <Desktop /> },
  { path: "settings/audit", element: <Audit /> },
  { path: "settings/integrations", element: <Integrations /> },
  { path: "settings/ai", element: <AiSettings /> },
  { path: "help", element: <Help /> },
];
