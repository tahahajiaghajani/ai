// «تنظیمات»: the organisation, members and roles, AI, integrations, the Windows app, the audit log, the design
// system's living style guide (admins), the person's own account and help — the settings space of the sidebar (opened from its footer), plus the palette's member search.
import { lazy } from "@ui/lib/lazy";
import { Building2, UserCog, Plug, Monitor, ScrollText, CircleUser, CircleHelp, User, ShieldCheck, Palette } from "lucide-react";
import { normalizeFa } from "../../lib/fa";
import { AiIcon } from "../../components/shell/icons";
import type { ModuleUi } from "../registry";

const OrgSettings = lazy(() => import("./OrgSettings"));
const Members = lazy(() => import("./Members"));
const Account = lazy(() => import("./Account"));
const Desktop = lazy(() => import("./Desktop"));
const Audit = lazy(() => import("./Audit"));
const Integrations = lazy(() => import("./Integrations"));
const Help = lazy(() => import("./Help"));
const Security = lazy(() => import("./Security"));
const StyleGuide = lazy(() => import("./StyleGuide"));
const AiSettings = lazy(() => import("../../ai/settings/AiSettings"));

export const settingsUi: ModuleUi = {
  nav: [
    {
      key: "settings",
      label: "تنظیمات",
      space: "settings",
      items: [
        { key: "org-settings", label: "سازمان", path: "settings/org", area: "settings", icon: Building2, keywords: "اطلاعات و تنظیمات سازمان منطقه زمانی لوگو نشانی" },
        { key: "members", label: "کاربران و دسترسی‌ها", path: "settings/users", area: "users", icon: UserCog, keywords: "اعضا نقش دسترسی کاربر جدید رمز" },
        { key: "ai", label: "هوش مصنوعی", path: "settings/ai", area: "ai", level: "full", icon: AiIcon, keywords: "دستیار کلید API مدل Claude Gemini OpenAI هوش مصنوعی مصرف بودجه" },
        { key: "integrations", label: "اتصال‌ها و API", path: "settings/integrations", area: "integrations", icon: Plug, keywords: "وب‌هوک webhook کلید API رویداد سامانهٔ دیگر" },
        { key: "security", label: "امنیت ورود و نشست‌ها", path: "settings/security", area: "settings", icon: ShieldCheck, keywords: "نشست ورود SSO اکتیو دایرکتوری قفل گذرواژه خروج همه کوکی بیکاری حساب اضطراری" },
        { key: "desktop", label: "نسخهٔ ویندوز", path: "settings/desktop", desktopOnly: true, icon: Monitor, keywords: "پشتیبان شبکه همگام‌سازی بکاپ LAN ابری" },
        { key: "audit", label: "گزارش رویدادها", path: "settings/audit", area: "settings", icon: ScrollText, keywords: "تاریخچه تغییرات" },
        { key: "style-guide", label: "راهنمای طراحی", path: "settings/style-guide", area: "settings", level: "full", icon: Palette, keywords: "برند نشانه لوگو رنگ قلم حروف حرکت نماد سامانهٔ طراحی کاریز style guide design system" },
        { key: "account", label: "حساب کاربری من", path: "settings/account", icon: CircleUser, section: "شما", keywords: "رمز عبور نشست دستگاه" },
        { key: "help", label: "راهنما و میانبرها", path: "help", icon: CircleHelp, section: "شما", keywords: "کمک آموزش کلید میانبر درباره" },
      ],
    },
  ],
  routes: [
    { path: "settings/org", element: <OrgSettings /> },
    { path: "settings/users", element: <Members /> },
    { path: "settings/account", element: <Account /> },
    { path: "settings/desktop", element: <Desktop /> },
    { path: "settings/audit", element: <Audit /> },
    { path: "settings/integrations", element: <Integrations /> },
    { path: "settings/security", element: <Security /> },
    { path: "settings/ai", element: <AiSettings /> },
    { path: "help", element: <Help /> },
    { path: "settings/style-guide", element: <StyleGuide /> },
  ],
  segments: { settings: "settings", help: "settings" },
  searches: [
    {
      key: "members",
      group: "اعضا",
      icon: User,
      area: "users",
      async run(api, q) {
        const n = normalizeFa(q);
        const r = await api.get<{ members: { id: string; full_name: string; email: string; role: string; is_active: boolean }[] }>("/members");
        return r.members
          .filter((m) => normalizeFa(`${m.full_name} ${m.email}`).includes(n))
          .slice(0, 5)
          .map((m) => ({ id: m.id, label: m.full_name || m.email, meta: m.is_active ? m.email : "غیرفعال", path: `settings/users?q=${encodeURIComponent(m.full_name || m.email)}` }));
      },
    },
  ],
};
