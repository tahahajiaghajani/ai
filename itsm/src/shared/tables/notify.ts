// The notification service's tables (docs/spec/services/notify.md). Configuration — rules, templates, outside
// channels (messengers, webhooks, SMS gateways) and e-mail channels — lives in area «اعلان‌ها» (notifications); a
// person's inbox items and preferences are personal rows (area «کارها» for some read grant every role has, held to
// the owner by the row rule) that travel to the Windows app with the rest of the person's data.
// Delivery logs and the e-mail message log are local tables of each runtime (src/server/db/migrations/0010_notify.ts).
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { CHANNEL_KINDS, DIGEST_MODES, INBOX_KINDS, NOTIFY_CHANNELS, NOTIFY_EVENTS } from "../notify";

const options = (o: Record<string, string | { label: string }>): Option[] =>
  Object.entries(o).map(([value, l], i) => ({ value, label: typeof l === "string" ? l : l.label, order: i + 1 }));

export const NOTIFY_EVENT_OPTIONS = options(NOTIFY_EVENTS);
export const NOTIFY_CHANNEL_OPTIONS = options(NOTIFY_CHANNELS);
export const CHANNEL_KIND_OPTIONS = options(CHANNEL_KINDS);
/** Journal entries a «commented» or «mentioned» rule may be limited to. */
export const ENTRY_KIND_OPTIONS: Option[] = [
  { value: "comment", label: "پاسخ", order: 1 },
  { value: "work_note", label: "یادداشت داخلی", order: 2 },
  { value: "email_in", label: "ایمیل دریافتی", order: 3 },
];

/** The person's own rows: read and changed only by them (the system delivers and reads everyone's). */
const OWN = { f: "user_id", op: "is_me" } as const;

const rule: TableDef = {
  key: "notification_rule",
  table: "sm_notification_rules",
  label: "قانون اعلان",
  plural: "قانون‌های اعلان",
  icon: "bell-ring",
  module: "notify",
  area: "notifications",
  description: "چه رویدادی، با چه شرطی، به چه کسانی و از چه راهی خبر داده شود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "mandatory", label: "اجباری", type: "bool", default: false, filter: true, span: 6, help: "گیرندگان نمی‌توانند آن را خاموش کنند و بی‌درنگ فرستاده می‌شود" },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, list: true, filter: true, ltr: true, span: 12 },
    { name: "event", label: "رویداد", type: "choice", choices: NOTIFY_EVENT_OPTIONS, required: true, default: "updated", list: true, filter: true, span: 12 },
    { name: "custom_event", label: "نام رویداد سفارشی", type: "string", maxLength: 80, ltr: true, span: 12 },
    { name: "entry_kinds", label: "نوع یادداشت", type: "multichoice", choices: ENTRY_KIND_OPTIONS, span: 12, help: "برای «پاسخ یا یادداشت تازه» و «نام بردن»؛ خالی: همه" },
    { name: "condition", label: "شرط", type: "json", span: 24, help: "روی رکورد پس از تغییر؛ «تغییر کرد به» با مقدار پیشین مقایسه می‌کند" },
    { name: "recipients", label: "گیرندگان", type: "json", span: 24 },
    { name: "notify_actor", label: "به انجام‌دهندهٔ تغییر هم خبر داده شود", type: "bool", default: false, span: 12 },
    { name: "channels", label: "راه‌های ارسال", type: "multichoice", choices: NOTIFY_CHANNEL_OPTIONS, default: ["in_app"], list: true, span: 12 },
    { name: "targets", label: "کانال‌های بیرونی", type: "refs", ref: "notification_channel", span: 12 },
    { name: "template_id", label: "الگو", type: "ref", ref: "notification_template", list: true, span: 12 },
    { name: "digest", label: "در خلاصهٔ ایمیلی گیرنده بیاید", type: "bool", default: true, span: 12 },
    { name: "builtin", label: "جایگزین قانون پیش‌فرض", type: "string", maxLength: 60, ltr: true, hidden: true, span: 12 },
    { name: "description", label: "توضیح", type: "text", maxLength: 2000, span: 24 },
  ],
  unique: [["builtin"]],
  scope: {},
  list: { columns: ["name", "table_key", "event", "channels", "active"], order: "table_key,name" },
};

const template: TableDef = {
  key: "notification_template",
  table: "sm_notification_templates",
  label: "الگوی اعلان",
  plural: "الگوهای اعلان",
  icon: "file-text",
  module: "notify",
  area: "notifications",
  description: "موضوع و متن اعلان با جای‌نگهدارهایی مانند {{record.number}} و {{link}}",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "event", label: "برای رویداد", type: "choice", choices: NOTIFY_EVENT_OPTIONS, list: true, filter: true, span: 6 },
    { name: "table_key", label: "جدول نمونه", type: "string", maxLength: 60, ltr: true, list: true, filter: true, span: 6 },
    { name: "subject", label: "موضوع", type: "string", required: true, maxLength: 300, span: 24, help: "عنوان اعلان درون برنامه و موضوع ایمیل" },
    { name: "body", label: "متن", type: "markdown", maxLength: 20000, span: 24 },
    { name: "short_text", label: "متن کوتاه", type: "text", maxLength: 500, span: 24, help: "برای پیامک و پیام‌رسان‌ها؛ خالی: موضوع" },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "description", label: "توضیح", type: "text", maxLength: 2000, span: 24 },
  ],
  scope: {},
  list: { columns: ["name", "event", "table_key", "active", "updated_at"], order: "name" },
};

const channel: TableDef = {
  key: "notification_channel",
  table: "sm_notification_channels",
  label: "کانال پیام",
  plural: "کانال‌های پیام",
  icon: "send",
  module: "notify",
  area: "notifications",
  description: "پیام‌رسان‌ها (تلگرام، بله، اسلک، تیمز، مترموست)، وب‌هوک JSON و درگاه پیامک",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: CHANNEL_KIND_OPTIONS, required: true, default: "webhook", list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "principal_id", label: "پیام‌ها با دسترسی", type: "user", list: true, span: 12, help: "پیام فقط آنچه این عضو می‌تواند ببیند را دارد؛ اگر او رکوردی را نبیند، پیامی فرستاده نمی‌شود" },
    { name: "endpoint", label: "نشانی وب‌هوک", type: "secret", span: 24, help: "اسلک، تیمز، مترموست و وب‌هوک JSON" },
    { name: "token", label: "توکن یا کلید", type: "secret", span: 12, help: "توکن ربات تلگرام و بله، کلید درگاه پیامک، یا رمز امضای وب‌هوک" },
    { name: "chat_id", label: "شناسهٔ گفتگو", type: "string", maxLength: 100, ltr: true, span: 12, help: "تلگرام و بله: شناسهٔ کانال یا گروه" },
    { name: "sms_url", label: "نشانی درگاه پیامک", type: "string", maxLength: 2048, ltr: true, span: 24, section: "درگاه پیامک", help: "جای‌نگهدارها: {{to}}، {{text}}، {{sender}}، {{token}}" },
    { name: "sms_method", label: "روش", type: "choice", choices: [{ value: "POST", label: "POST" }, { value: "GET", label: "GET" }], default: "POST", span: 6, section: "درگاه پیامک" },
    { name: "sms_content_type", label: "قالب بدنه", type: "choice", choices: [{ value: "form", label: "فرم (urlencoded)" }, { value: "json", label: "JSON" }], default: "form", span: 6, section: "درگاه پیامک" },
    { name: "sms_sender", label: "شمارهٔ فرستنده", type: "string", maxLength: 40, ltr: true, span: 12, section: "درگاه پیامک" },
    { name: "sms_body", label: "بدنهٔ درخواست", type: "text", maxLength: 2000, ltr: true, span: 24, section: "درگاه پیامک" },
    { name: "sms_headers", label: "سرآیندها", type: "json", span: 24, section: "درگاه پیامک" },
    { name: "description", label: "توضیح", type: "text", maxLength: 2000, span: 24 },
  ],
  scope: {},
  form: { sections: ["اصلی", "درگاه پیامک"] },
  list: { columns: ["name", "kind", "principal_id", "active"], order: "name" },
};

const SECURITY: Option[] = [
  { value: "starttls", label: "STARTTLS" },
  { value: "tls", label: "TLS/SSL" },
  { value: "none", label: "بدون رمزنگاری" },
];

const email: TableDef = {
  key: "email_channel",
  table: "sm_email_channels",
  label: "کانال ایمیل",
  plural: "کانال‌های ایمیل",
  icon: "mail",
  module: "notify",
  area: "notifications",
  description: "صندوق ایمیل سازمان: ارسال اعلان‌ها (SMTP) و ساختن رکورد از ایمیل‌های رسیده (IMAP)",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "is_default", label: "پیش‌فرض ارسال", type: "bool", default: false, list: true, span: 6 },
    { name: "from_name", label: "نام فرستنده", type: "string", maxLength: 120, span: 12 },
    { name: "from_address", label: "نشانی فرستنده", type: "email", required: true, list: true, span: 12 },
    { name: "reply_to", label: "نشانی پاسخ", type: "email", span: 12 },
    { name: "smtp_host", label: "سرور SMTP", type: "string", maxLength: 255, ltr: true, span: 12, section: "ارسال (SMTP)" },
    { name: "smtp_port", label: "درگاه", type: "int", min: 1, max: 65535, default: 587, span: 6, section: "ارسال (SMTP)" },
    { name: "smtp_security", label: "رمزنگاری", type: "choice", choices: SECURITY, default: "starttls", span: 6, section: "ارسال (SMTP)" },
    { name: "smtp_user", label: "نام کاربری", type: "string", maxLength: 255, ltr: true, span: 12, section: "ارسال (SMTP)" },
    { name: "smtp_password", label: "رمز", type: "secret", span: 12, section: "ارسال (SMTP)" },
    { name: "inbound", label: "دریافت ایمیل", type: "bool", default: false, list: true, span: 6, section: "دریافت (IMAP)", help: "هر دقیقه صندوق را می‌خواند و از ایمیل‌های تازه رکورد یا پاسخ می‌سازد" },
    { name: "imap_host", label: "سرور IMAP", type: "string", maxLength: 255, ltr: true, span: 12, section: "دریافت (IMAP)" },
    { name: "imap_port", label: "درگاه", type: "int", min: 1, max: 65535, default: 993, span: 6, section: "دریافت (IMAP)" },
    { name: "imap_security", label: "رمزنگاری", type: "choice", choices: SECURITY, default: "tls", span: 6, section: "دریافت (IMAP)" },
    { name: "imap_user", label: "نام کاربری", type: "string", maxLength: 255, ltr: true, span: 12, section: "دریافت (IMAP)" },
    { name: "imap_password", label: "رمز", type: "secret", span: 12, section: "دریافت (IMAP)" },
    { name: "imap_folder", label: "پوشه", type: "string", maxLength: 120, default: "INBOX", ltr: true, span: 12, section: "دریافت (IMAP)" },
    { name: "target_table", label: "رکورد تازه در", type: "string", maxLength: 60, default: "todo", ltr: true, span: 12, section: "دریافت (IMAP)", help: "کلید جدول رکوردهایی که از ایمیل تازه ساخته می‌شوند" },
    { name: "allow_list", label: "فقط از این فرستنده‌ها", type: "tags", span: 12, section: "دریافت (IMAP)", help: "نشانی یا دامنه (@example.com)؛ خالی: همه" },
    { name: "deny_list", label: "نپذیرفتن از", type: "tags", span: 12, section: "دریافت (IMAP)", help: "نشانی یا دامنه (@example.com)" },
    { name: "signature", label: "امضا", type: "markdown", maxLength: 4000, span: 24, section: "امضا" },
    { name: "description", label: "توضیح", type: "text", maxLength: 2000, span: 24, section: "امضا" },
  ],
  scope: {},
  form: { sections: ["اصلی", "ارسال (SMTP)", "دریافت (IMAP)", "امضا"] },
  list: { columns: ["name", "from_address", "inbound", "is_default", "active"], order: "name" },
};

const pref: TableDef = {
  key: "notification_pref",
  table: "sm_notification_prefs",
  label: "تنظیم اعلان",
  plural: "تنظیمات اعلان",
  icon: "sliders-horizontal",
  module: "notify",
  area: "work",
  description: "اعلان‌هایی که هر کس خاموش کرده، خلاصهٔ ایمیلی و ساعت‌های سکوت",
  display: "user_id",
  fields: [
    { name: "user_id", label: "عضو", type: "user", required: true, readonly: true, unique: true, default: "$me", list: true, span: 12 },
    { name: "optouts", label: "اعلان‌های خاموش", type: "json", span: 24 },
    { name: "digest", label: "ایمیل‌ها", type: "choice", choices: options(DIGEST_MODES), default: "none", list: true, span: 12 },
    { name: "digest_hour", label: "ساعت خلاصهٔ روزانه", type: "int", min: 0, max: 23, default: 8, span: 6 },
    { name: "quiet_from", label: "آغاز سکوت", type: "string", maxLength: 5, ltr: true, span: 6 },
    { name: "quiet_to", label: "پایان سکوت", type: "string", maxLength: 5, ltr: true, span: 6 },
    { name: "read_before", label: "همه خوانده شده تا", type: "datetime", readonly: true, span: 12 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { read: OWN, write: OWN },
  features: { history: false },
  list: { columns: ["user_id", "digest"], order: "-updated_at" },
};

const inbox: TableDef = {
  key: "notification",
  table: "sm_notifications",
  label: "اعلان",
  plural: "اعلان‌ها",
  icon: "bell",
  module: "notify",
  area: "work",
  description: "اعلان‌های درون برنامهٔ هر عضو",
  display: "title",
  fields: [
    { name: "user_id", label: "گیرنده", type: "user", required: true, readonly: true, list: true, filter: true, span: 12 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "body", label: "متن", type: "markdown", maxLength: 8000, span: 24 },
    { name: "link", label: "پیوند", type: "string", maxLength: 500, ltr: true, span: 24 },
    { name: "table_key", label: "جدول", type: "string", maxLength: 60, ltr: true, filter: true, span: 8 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "record_number", label: "شمارهٔ رکورد", type: "string", maxLength: 40, ltr: true, search: true, span: 8 },
    { name: "event", label: "رویداد", type: "choice", choices: NOTIFY_EVENT_OPTIONS, list: true, filter: true, span: 8 },
    { name: "kind", label: "دسته", type: "choice", choices: options(INBOX_KINDS), default: "direct", list: true, filter: true, span: 8 },
    { name: "actor_id", label: "انجام‌دهنده", type: "user", span: 8 },
    { name: "rule_key", label: "قانون", type: "string", maxLength: 80, ltr: true, span: 8 },
    { name: "read_at", label: "خوانده‌شده", type: "datetime", readonly: true, list: true, filter: true, span: 8 },
    { name: "snoozed_until", label: "به تعویق تا", type: "datetime", readonly: true, filter: true, span: 8 },
  ],
  scope: { own: ["user_id"], requester: ["user_id"] },
  rowAccess: { read: OWN, write: OWN },
  features: { history: false },
  list: { columns: ["title", "event", "kind", "created_at", "read_at"], order: "-created_at" },
};

export const NOTIFY_TABLES: TableDef[] = [rule, template, channel, email, pref, inbox];

/** Tables of the service itself: never the subject of a notification rule (a rule could otherwise feed itself). */
export const NOTIFY_TABLE_KEYS = new Set(NOTIFY_TABLES.map((t) => t.key));
