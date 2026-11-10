// «اعلان‌ها» (docs/spec/services/notify.md). The bell and the notification center live in the top bar (Bell.tsx);
// this module adds to the settings space the rules (built-ins and the organisation's), the templates, the e-mail
// channels (SMTP out, IMAP in), the messaging channels (messengers, webhooks, SMS gateways) and the delivery log, and
// under «شما» the person's own preferences. Rules and templates have their own editors; the channel tables use the
// generic record pages with test buttons. Links to these records (search, references) open these pages.
import { lazy } from "react";
import { BellDot, BellRing, FileText, Mail, ScrollText, Send } from "lucide-react";
import { recordModule, recordSearch, RecordListRoute } from "../../records/module";
import { registerRecordExtensions } from "../../records/extensions";
import { channelExtensions, emailChannelExtensions } from "./channels";

const Rules = lazy(() => import("./Rules"));
const RuleEditor = lazy(() => import("./RuleEditor"));
const TemplateEditor = lazy(() => import("./TemplateEditor"));
const Preferences = lazy(() => import("./Preferences"));
const Log = lazy(() => import("./Log"));

// rules and templates open in their own editors
registerRecordExtensions("notification_rule", { path: "notify/rules" });
registerRecordExtensions("notification_template", { path: "notify/templates" });

const S = "اعلان‌ها";

export const notifyUi = recordModule({
  key: "notify",
  spaceKey: "settings",
  group: { key: "notify", label: "اعلان‌ها" },
  tables: [
    {
      table: "email_channel",
      path: "notify/email",
      label: "کانال‌های ایمیل",
      noun: "کانال ایمیل",
      icon: Mail,
      section: S,
      area: "settings",
      keywords: "ایمیل SMTP IMAP صندوق دریافت ارسال فرستنده امضا ایمیل به رکورد",
      extensions: emailChannelExtensions,
    },
    {
      table: "notification_channel",
      path: "notify/channels",
      label: "پیام‌رسان‌ها و پیامک",
      noun: "کانال پیام",
      icon: Send,
      section: S,
      area: "settings",
      keywords: "تلگرام بله اسلک تیمز مترموست وب‌هوک پیامک کاوه‌نگار قاصدک درگاه",
      extensions: channelExtensions,
    },
  ],
  nav: [
    { key: "notify:rules", label: "قانون‌های اعلان", path: "notify/rules", icon: BellRing, section: S, area: "settings", keywords: "اعلان رویداد گیرنده ارجاع پاسخ نام بردن هشدار" },
    { key: "notify:rules:new", label: "قانون اعلان تازه", path: "notify/rules/new", icon: BellRing, area: "settings", level: "edit", action: true },
    { key: "notify:templates", label: "الگوهای اعلان", path: "notify/templates", icon: FileText, section: S, area: "settings", keywords: "متن موضوع ایمیل جای‌نگهدار" },
    { key: "notify:templates:new", label: "الگوی اعلان تازه", path: "notify/templates/new", icon: FileText, area: "settings", level: "edit", action: true },
    { key: "notify:log", label: "گزارش ارسال", path: "notify/log", icon: ScrollText, section: S, area: "settings", keywords: "ارسال شده ناموفق ایمیل رسیده تحویل" },
    { key: "notify:prefs", label: "اعلان‌های من", path: "notify/prefs", icon: BellDot, section: "شما", keywords: "اعلان خاموش ساعت سکوت خلاصه ایمیل پیامک" },
  ],
  routes: [
    { path: "notify/rules", element: <Rules /> },
    { path: "notify/rules/new", element: <RuleEditor mode="new" /> },
    { path: "notify/rules/builtin/:key", element: <RuleEditor mode="builtin" /> },
    { path: "notify/rules/:id", element: <RuleEditor mode="row" /> },
    { path: "notify/templates", element: <RecordListRoute table="notification_template" /> },
    { path: "notify/templates/new", element: <TemplateEditor /> },
    { path: "notify/templates/:id", element: <TemplateEditor /> },
    { path: "notify/log", element: <Log /> },
    { path: "notify/prefs", element: <Preferences /> },
  ],
  searches: [
    recordSearch("notification_rule", { group: "قانون‌های اعلان", icon: BellRing, area: "settings" }),
    recordSearch("notification_template", { group: "الگوهای اعلان", icon: FileText, area: "settings" }),
  ],
  segments: { notify: "settings" },
});
