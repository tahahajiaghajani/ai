// Tables of the integration hub (docs/modules/integration_FA.md; catalogue module «integration»), area «integrations»:
//   · integration_user — a service member of the organisation that other programs act as: its ITSM roles (chosen by
//     an owner through the access service) bound everything its API keys, webhooks and endpoints read and write
//   · webhook_subscription — record events of a table delivered to a URL, signed, projected through the subscriber's
//     integration user (only what it may read), retried and paused after repeated failures
//   · inbound_endpoint — a URL other systems post JSON to; mapped to records of a table (create, or update by a
//     correlation field) as its integration user
//   · directory_source — LDAP / Active Directory synchronisation and SCIM provisioning (Microsoft Entra ID): attribute
//     and group mappings, preview and dry run, the member who approved it (scheduled runs act as them); and «ورود با
//     حساب سازمانی» (people sign in with their domain account: domain controllers, TLS and the root CA, login names,
//     nested groups, just-in-time members) and Windows single sign-on (Kerberos on the server, or a trusted IIS proxy)
//   · issue_connection / external_ref — Jira and GitHub: issues made from records, their keys, state and notes
//   · export_schedule — table data sent on a schedule (to a file on a «خروجی داده» row, or POSTed to a URL)
// Secrets (webhook signing secrets, tokens, bind passwords) are sealed fields: never returned, never synced.
// Imported by the UI: keep it free of server imports.
import type { Option, TableDef } from "../model/types";
import { HOOK_EVENTS } from "../integration/webhooks";

const MAIN = "اصلی";
const STATUS = "وضعیت";
const MAP = "نگاشت";

export const INTEGRATION_HEALTH: Option[] = [
  { value: "unknown", label: "نامشخص", color: "gray" },
  { value: "ok", label: "سالم", color: "green" },
  { value: "failing", label: "خطا", color: "red" },
  { value: "paused", label: "متوقف", color: "gold" },
];

const integrationUser: TableDef = {
  key: "integration_user",
  table: "sm_integration_users",
  label: "کاربر یکپارچه‌سازی",
  plural: "کاربران یکپارچه‌سازی",
  icon: "bot",
  module: "integration",
  area: "integrations",
  description: "حساب خدمتی که برنامه‌های دیگر با کلیدهای API، وب‌هوک‌ها و نقطه‌های دریافت با دسترسی نقش‌های آن کار می‌کنند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, sort: true, span: 12, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "rate_limit", label: "سقف درخواست در دقیقه", type: "int", min: 1, max: 100_000, default: 120, span: 6, section: MAIN },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", list: true, filter: true, span: 12, section: MAIN, help: "کسی که دربارهٔ این حساب پاسخ می‌دهد و هشدارهایش را می‌گیرد" },
    { name: "ip_allowlist", label: "نشانی‌های مجاز", type: "text", maxLength: 2000, ltr: true, span: 12, section: MAIN, help: "هر خط یک نشانی IP یا شبکه (مثلاً 10.0.0.0/8)؛ خالی: همه" },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24, section: MAIN },
    { name: "user_id", label: "حساب عضو", type: "user", system: true, list: true, span: 12, section: STATUS },
    { name: "last_used_at", label: "آخرین استفاده", type: "datetime", system: true, audit: false, list: true, sort: true, span: 12, section: STATUS },
  ],
  scope: { own: ["owner_id"] },
  form: { sections: [MAIN, STATUS] },
  list: { columns: ["name", "owner_id", "user_id", "last_used_at", "active"], order: "name" },
};

const webhook: TableDef = {
  key: "webhook_subscription",
  table: "sm_webhook_subscriptions",
  label: "وب‌هوک خروجی",
  plural: "وب‌هوک‌های خروجی",
  icon: "send",
  module: "integration",
  area: "integrations",
  description: "رویدادهای رکوردهای یک جدول، امضاشده با HMAC، به نشانی یک سامانهٔ دیگر؛ فقط آنچه کاربر یکپارچه‌سازی می‌بیند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "paused", label: "متوقف پس از خطا", type: "bool", default: false, system: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "url", label: "نشانی", type: "url", required: true, span: 24, section: MAIN },
    { name: "secret", label: "راز امضا", type: "secret", span: 12, section: MAIN, help: "امضای HMAC-SHA256 بدنه در سرآیند X-Signature" },
    { name: "principal_id", label: "کاربر یکپارچه‌سازی", type: "ref", ref: "integration_user", required: true, list: true, span: 12, section: MAIN, help: "پیام فقط رکوردها و فیلدهایی را دارد که این کاربر می‌بیند" },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 12, section: MAIN },
    { name: "events", label: "رویدادها", type: "multichoice", choices: HOOK_EVENTS, required: true, default: ["created", "updated", "transitioned"], list: true, span: 12, section: MAIN },
    { name: "condition", label: "شرط", type: "conditions", condTableField: "table_key", span: 24, section: MAIN, help: "خالی: همهٔ رکوردها" },
    { name: "fields", label: "فیلدهای پیام", type: "tags", span: 24, section: MAIN, help: "خالی: همهٔ فیلدهایی که کاربر یکپارچه‌سازی می‌بیند" },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24, section: MAIN },
    { name: "health", label: "سلامت", type: "choice", choices: INTEGRATION_HEALTH, default: "unknown", system: true, list: true, filter: true, span: 8, section: STATUS },
    { name: "failures", label: "خطاهای پیاپی", type: "int", default: 0, system: true, audit: false, span: 8, section: STATUS },
    { name: "last_delivery_at", label: "آخرین ارسال", type: "datetime", system: true, audit: false, list: true, span: 8, section: STATUS },
    { name: "last_status", label: "آخرین نتیجه", type: "string", maxLength: 300, system: true, audit: false, span: 24, section: STATUS },
  ],
  scope: { own: ["created_by"] },
  form: { sections: [MAIN, STATUS] },
  list: { columns: ["name", "table_key", "events", "health", "last_delivery_at", "active"], order: "name" },
};

const inbound: TableDef = {
  key: "inbound_endpoint",
  table: "sm_inbound_endpoints",
  label: "نقطهٔ دریافت",
  plural: "نقطه‌های دریافت",
  icon: "inbox",
  module: "integration",
  area: "integrations",
  description: "نشانی‌ای که سامانه‌های پایش، فرم‌ها یا شرکا JSON به آن می‌فرستند؛ هر پیام رکوردی می‌سازد یا رکورد هم‌شناسه را به‌روز می‌کند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "auth", label: "احراز", type: "choice", choices: [{ value: "token", label: "توکن (Bearer)" }, { value: "hmac", label: "امضای HMAC" }], default: "token", span: 6, section: MAIN },
    { name: "token", label: "توکن یا راز", type: "secret", span: 12, section: MAIN, help: "در ساخت یک بار نمایش داده می‌شود" },
    { name: "principal_id", label: "کاربر یکپارچه‌سازی", type: "ref", ref: "integration_user", required: true, list: true, span: 12, section: MAIN, help: "رکوردها با دسترسی این کاربر ساخته و به‌روز می‌شوند" },
    { name: "target_table", label: "جدول مقصد", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 12, section: MAP },
    { name: "action", label: "کار", type: "choice", choices: [{ value: "create", label: "همیشه رکورد تازه" }, { value: "upsert", label: "ساخت یا به‌روزرسانی با شناسهٔ هم‌بستگی" }], default: "create", span: 12, section: MAP },
    { name: "match_field", label: "فیلد هم‌بستگی", type: "string", maxLength: 64, ltr: true, span: 12, section: MAP, help: "فیلدی از جدول که شناسهٔ سامانهٔ فرستنده در آن نگه داشته می‌شود" },
    { name: "match_path", label: "مسیر شناسه در پیام", type: "string", maxLength: 200, ltr: true, span: 12, section: MAP, help: "مثلاً $.alert.id" },
    { name: "mapping", label: "نگاشت فیلدها", type: "json", default: [], span: 24, section: MAP, help: "[{ \"path\": \"$.alert.title\", \"field\": \"short_description\" }]" },
    { name: "defaults", label: "مقدارهای پیش‌فرض", type: "json", default: {}, span: 24, section: MAP },
    { name: "description", label: "شرح", type: "text", maxLength: 2000, span: 24, section: MAIN },
    { name: "received", label: "دریافت‌شده", type: "int", default: 0, system: true, audit: false, span: 8, section: STATUS },
    { name: "failed", label: "ناموفق", type: "int", default: 0, system: true, audit: false, span: 8, section: STATUS },
    { name: "last_received_at", label: "آخرین دریافت", type: "datetime", system: true, audit: false, list: true, span: 8, section: STATUS },
  ],
  scope: { own: ["created_by"] },
  form: { sections: [MAIN, MAP, STATUS] },
  list: { columns: ["name", "target_table", "action", "last_received_at", "active"], order: "name" },
};

const LOGIN = "ورود با حساب سازمانی";
const SSO = "ورود خودکار ویندوز (SSO)";

/** How a source's connection is protected: LDAPS, StartTLS, or nothing (tests only). */
export const DIRECTORY_TLS: Option[] = [
  { value: "ldaps", label: "LDAPS (درگاه ۶۳۶)", color: "green" },
  { value: "starttls", label: "StartTLS (درگاه ۳۸۹)", color: "green" },
  { value: "none", label: "بدون رمزنگاری — فقط برای آزمایش", color: "red" },
];

/** The attribute a bare login name («ali») is looked up by. */
export const DIRECTORY_LOGIN_ATTRS: Option[] = [
  { value: "sAMAccountName", label: "نام کاربری ویندوز (sAMAccountName)" },
  { value: "userPrincipalName", label: "نام اصلی (userPrincipalName)" },
  { value: "mail", label: "ایمیل (mail)" },
];

/** Windows single sign-on of a source. */
export const DIRECTORY_SSO: Option[] = [
  { value: "off", label: "خاموش", color: "gray" },
  { value: "negotiate", label: "Kerberos روی همین سرور (Negotiate)", color: "blue" },
  { value: "proxy", label: "از راه IIS یا پراکسی معتمد", color: "indigo" },
];

export const DIRECTORY_KINDS: Option[] = [
  { value: "ldap", label: "LDAP / Active Directory", color: "blue" },
  { value: "scim", label: "SCIM (Microsoft Entra ID و دیگر IdPها)", color: "indigo" },
];

const directory: TableDef = {
  key: "directory_source",
  table: "sm_directory_sources",
  label: "منبع فهرست کاربران",
  plural: "منبع‌های فهرست کاربران",
  icon: "folder-sync",
  module: "integration",
  area: "integrations",
  description: "همگام‌سازی اعضا، واحدها و گروه‌ها از LDAP / Active Directory یا تأمین با SCIM؛ همیشه با پیش‌نمایش، و هیچ نقشی بی‌صدا داده نمی‌شود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12, section: MAIN },
    { name: "kind", label: "گونه", type: "choice", choices: DIRECTORY_KINDS, required: true, default: "ldap", list: true, filter: true, span: 6, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "mode", label: "حالت", type: "choice", choices: [{ value: "preview", label: "فقط پیش‌نمایش (آزمایشی)" }, { value: "apply", label: "اعمال" }], default: "preview", list: true, span: 12, section: MAIN, help: "در حالت پیش‌نمایش هیچ تغییری ثبت نمی‌شود؛ SCIM درخواست‌ها را فقط گزارش می‌کند" },
    { name: "default_role", label: "نقش اعضای تازه", type: "string", maxLength: 41, default: "requester", ltr: true, span: 12, section: MAIN, help: "نقش ITSM هر عضو تازه (پیش‌فرض: درخواست‌دهنده)" },
    { name: "membership_role", label: "عضویت پایه", type: "choice", choices: [{ value: "viewer", label: "ناظر" }, { value: "member", label: "عضو" }], default: "viewer", span: 12, section: MAIN },
    { name: "auto_roles", label: "نقش‌های نگاشت‌شده خودکار داده شود", type: "bool", default: false, span: 12, section: MAIN, help: "خاموش: نقش‌های گروه‌ها فقط پس از تأیید شما در «اعمال» داده می‌شوند" },
    { name: "deactivate_missing", label: "غیرفعال کردن کسانی که دیگر در فهرست نیستند", type: "bool", default: true, span: 12, section: MAIN },
    { name: "unit_from", label: "واحد سازمانی از", type: "choice", choices: [{ value: "none", label: "هیچ" }, { value: "department", label: "ویژگی department" }], default: "none", span: 12, section: MAIN },
    { name: "schedule_hours", label: "تکرار هر چند ساعت", type: "int", min: 0, max: 720, default: 0, span: 12, section: MAIN, help: "۰: فقط با دست (LDAP)" },
    { name: "approved_by", label: "تأییدکنندهٔ همگام‌سازی", type: "user", system: true, span: 12, section: MAIN, help: "اجرای زمان‌بندی‌شده و SCIM با دسترسی این عضو انجام می‌شود" },
    { name: "ldap_url", label: "نشانی LDAP", type: "string", maxLength: 300, ltr: true, span: 12, section: "LDAP", help: "ldap://dc1.corp.local:389 یا ldaps://…:636" },
    { name: "bind_dn", label: "حساب اتصال (Bind DN)", type: "string", maxLength: 300, ltr: true, span: 12, section: "LDAP" },
    { name: "bind_password", label: "گذرواژهٔ اتصال", type: "secret", span: 12, section: "LDAP" },
    { name: "base_dn", label: "ریشهٔ جست‌وجو (Base DN)", type: "string", maxLength: 300, ltr: true, span: 12, section: "LDAP" },
    { name: "user_filter", label: "پالایهٔ کاربران", type: "string", maxLength: 500, ltr: true, default: "(&(objectCategory=person)(objectClass=user))", span: 24, section: "LDAP" },
    { name: "attr_map", label: "نگاشت ویژگی‌ها", type: "json", default: {}, span: 24, section: "LDAP", help: "{ \"email\": \"mail\", \"name\": \"displayName\", \"department\": \"department\" }" },
    { name: "scim_token", label: "توکن SCIM", type: "secret", span: 12, section: "SCIM", help: "Secret Token در تنظیم تأمین Entra ID" },
    { name: "group_map", label: "نگاشت گروه‌ها", type: "json", default: [], span: 24, section: MAP, help: "[{ \"source\": \"CN=Kariz-Agents,OU=Groups,DC=corp,DC=local\", \"group_id\": \"…\", \"role\": \"agent\", \"unit_id\": \"…\", \"workspace_id\": \"…\" }]" },
    { name: "login_enabled", label: "ورود با حساب سازمانی", type: "bool", default: false, list: true, filter: true, span: 12, section: LOGIN, help: "اعضا با نام کاربری و گذرواژهٔ دامنه وارد می‌شوند؛ گذرواژه فقط به سرور دامنه فرستاده می‌شود" },
    { name: "login_domains", label: "دامنه‌ها", type: "tags", span: 12, section: LOGIN, help: "نام NetBIOS و DNS دامنه (مانند CORP و corp.bank.ir) برای ورود با CORP\\ali یا ali@corp.bank.ir" },
    { name: "tls_mode", label: "رمزنگاری اتصال", type: "choice", choices: DIRECTORY_TLS, default: "ldaps", span: 12, section: LOGIN, help: "گذرواژه‌ها فقط روی LDAPS یا StartTLS فرستاده می‌شوند" },
    { name: "login_attr", label: "نام ورود", type: "choice", choices: DIRECTORY_LOGIN_ATTRS, default: "sAMAccountName", span: 12, section: LOGIN, help: "نامی که بدون دامنه نوشته می‌شود (ali) با این ویژگی جست‌وجو می‌شود" },
    { name: "dc_urls", label: "کنترل‌کننده‌های دامنهٔ دیگر", type: "text", maxLength: 2000, ltr: true, span: 24, section: LOGIN, help: "هر خط یک نشانی (ldaps://dc2.corp.local:636)؛ اگر نشانی اصلی پاسخ ندهد، به ترتیب امتحان می‌شوند" },
    { name: "ca_cert", label: "گواهی ریشهٔ سازمان (PEM)", type: "text", maxLength: 30000, ltr: true, span: 24, section: LOGIN, help: "گواهی مرجع صدور داخلی که گواهی کنترل‌کننده‌های دامنه را امضا کرده است (Base-64)؛ خالی: مرجع‌های شناخته‌شدهٔ سیستم‌عامل" },
    { name: "group_base_dn", label: "ریشهٔ جست‌وجوی گروه‌ها", type: "string", maxLength: 300, ltr: true, span: 12, section: LOGIN, help: "خالی: همان ریشهٔ جست‌وجو" },
    { name: "timeout_seconds", label: "زمان انتظار هر سرور (ثانیه)", type: "int", min: 2, max: 60, default: 10, span: 12, section: LOGIN },
    { name: "nested_groups", label: "گروه‌های تودرتو", type: "bool", default: true, span: 12, section: LOGIN, help: "عضویت غیرمستقیم (گروه درون گروه) هم برای نگاشت‌ها شمرده می‌شود" },
    { name: "jit", label: "ساخت عضو در نخستین ورود", type: "bool", default: true, span: 12, section: LOGIN, help: "خاموش: فقط کسانی وارد می‌شوند که پیش‌تر همگام‌سازی یا افزوده شده‌اند" },
    { name: "sso_mode", label: "ورود خودکار ویندوز", type: "choice", choices: DIRECTORY_SSO, default: "off", span: 12, section: SSO },
    { name: "sso_auto", label: "تلاش خودکار در صفحهٔ ورود", type: "bool", default: false, span: 12, section: SSO, help: "رایانه‌های عضو دامنه بی‌آنکه چیزی بنویسند وارد می‌شوند" },
    { name: "sso_host", label: "نام میزبان سامانه", type: "string", maxLength: 200, ltr: true, span: 12, section: SSO, help: "همان نامی که کاربران در مرورگر می‌زنند، مانند kariz.bank.ir" },
    { name: "sso_account", label: "حساب سرویس سامانه", type: "string", maxLength: 200, ltr: true, span: 12, section: SSO, help: "حساب ویندوزی که سرویس با آن اجرا می‌شود (BANK\\svc-kariz)؛ برای حساب Network Service نام رایانه با $ (KARIZ-SRV01$)" },
    { name: "ntlm", label: "پذیرش NTLM", type: "bool", default: false, span: 12, section: SSO, help: "فقط Kerberos پیشنهاد می‌شود؛ NTLM برای رایانه‌های بیرون از دامنه است" },
    { name: "proxy_header", label: "سرآیند کاربر پراکسی", type: "string", maxLength: 80, ltr: true, default: "X-Remote-User", span: 12, section: SSO },
    { name: "proxy_ips", label: "نشانی‌های پراکسی معتمد", type: "text", maxLength: 2000, ltr: true, span: 12, section: SSO, help: "هر خط یک نشانی IP یا شبکه (10.0.0.5 یا 10.0.0.0/24)؛ سرآیند کاربر فقط از این نشانی‌ها پذیرفته می‌شود" },
    { name: "proxy_secret", label: "راز مشترک پراکسی", type: "secret", span: 12, section: SSO, help: "پراکسی همین راز را در سرآیند X-ITSM-Proxy-Secret می‌فرستد" },
    { name: "health", label: "سلامت", type: "choice", choices: INTEGRATION_HEALTH, default: "unknown", system: true, list: true, span: 8, section: STATUS },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", system: true, audit: false, list: true, span: 8, section: STATUS },
    { name: "next_run_at", label: "اجرای بعد", type: "datetime", system: true, audit: false, span: 8, section: STATUS },
    { name: "last_summary", label: "خلاصهٔ آخرین اجرا", type: "text", system: true, audit: false, span: 24, section: STATUS },
    { name: "approved_map_hash", label: "اثر نگاشت‌های تأییدشده", type: "string", maxLength: 64, system: true, hidden: true, audit: false, span: 12, section: STATUS },
  ],
  scope: { own: ["created_by"] },
  form: { sections: [MAIN, "LDAP", LOGIN, SSO, "SCIM", MAP, STATUS] },
  list: { columns: ["name", "kind", "mode", "login_enabled", "health", "last_run_at", "active"], order: "name" },
};

export const ISSUE_KINDS: Option[] = [
  { value: "github", label: "GitHub", color: "gray" },
  { value: "jira", label: "Jira", color: "blue" },
];

const issueConnection: TableDef = {
  key: "issue_connection",
  table: "sm_issue_connections",
  label: "اتصال Jira یا GitHub",
  plural: "اتصال‌های Jira و GitHub",
  icon: "git-pull-request-arrow",
  module: "integration",
  area: "integrations",
  description: "ساخت issue از رکوردها و همگام‌سازی وضعیت و یادداشت‌ها با Jira یا GitHub",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12, section: MAIN },
    { name: "kind", label: "ابزار", type: "choice", choices: ISSUE_KINDS, required: true, default: "github", list: true, filter: true, span: 6, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6, section: MAIN },
    { name: "base_url", label: "نشانی", type: "url", span: 12, section: MAIN, help: "Jira: https://your.atlassian.net — GitHub: خالی (api.github.com) یا نشانی GitHub Enterprise" },
    { name: "repo", label: "مخزن GitHub", type: "string", maxLength: 200, ltr: true, span: 12, section: MAIN, help: "owner/name" },
    { name: "project_key", label: "کلید پروژهٔ Jira", type: "string", maxLength: 40, ltr: true, span: 6, section: MAIN },
    { name: "issue_type", label: "نوع issue در Jira", type: "string", maxLength: 60, default: "Task", ltr: true, span: 6, section: MAIN },
    { name: "auth_user", label: "ایمیل حساب Jira", type: "email", span: 12, section: MAIN },
    { name: "token", label: "توکن API", type: "secret", span: 12, section: MAIN },
    { name: "webhook_secret", label: "راز وب‌هوک", type: "secret", span: 12, section: MAIN, help: "برای پذیرفتن رویدادهای issue (امضای HMAC)" },
    { name: "principal_id", label: "کاربر یکپارچه‌سازی", type: "ref", ref: "integration_user", span: 12, section: MAIN, help: "یادداشت‌ها و تغییر وضعیت‌هایی که از ابزار می‌رسند با دسترسی این کاربر ثبت می‌شوند" },
    { name: "tables", label: "جدول‌ها", type: "tags", default: ["incident", "problem"], span: 12, section: MAIN },
    { name: "sync_comments", label: "فرستادن یادداشت‌ها", type: "choice", choices: [{ value: "none", label: "هیچ" }, { value: "public", label: "فقط پاسخ‌های عمومی" }, { value: "all", label: "همه (یادداشت‌های داخلی هم)" }], default: "none", span: 12, section: MAIN },
    { name: "state_on_close", label: "وضعیت رکورد هنگام بسته شدن issue", type: "string", maxLength: 40, ltr: true, span: 12, section: MAIN, help: "خالی: فقط یادداشت" },
    { name: "health", label: "سلامت", type: "choice", choices: INTEGRATION_HEALTH, default: "unknown", system: true, list: true, span: 8, section: STATUS },
    { name: "last_event_at", label: "آخرین رویداد", type: "datetime", system: true, audit: false, list: true, span: 8, section: STATUS },
    { name: "last_error", label: "آخرین خطا", type: "text", system: true, audit: false, span: 24, section: STATUS },
  ],
  scope: { own: ["created_by"] },
  form: { sections: [MAIN, STATUS] },
  list: { columns: ["name", "kind", "health", "last_event_at", "active"], order: "name" },
};

const externalRef: TableDef = {
  key: "external_ref",
  table: "sm_external_refs",
  label: "پیوند بیرونی",
  plural: "پیوندهای بیرونی",
  icon: "external-link",
  module: "integration",
  area: "integrations",
  description: "issue یک ابزار بیرونی که به رکوردی پیوند خورده است: کلید، نشانی، وضعیت و آخرین همگام‌سازی",
  display: "remote_key",
  fields: [
    { name: "remote_key", label: "کلید", type: "string", required: true, maxLength: 80, ltr: true, list: true, search: true, span: 8 },
    { name: "connection_id", label: "اتصال", type: "ref", ref: "issue_connection", required: true, list: true, filter: true, span: 8 },
    { name: "table_key", label: "جدول", type: "string", required: true, maxLength: 60, ltr: true, list: true, filter: true, span: 8 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", required: true, maxLength: 40, ltr: true, span: 12, index: true },
    { name: "record_label", label: "رکورد", type: "string", maxLength: 250, list: true, span: 12 },
    { name: "remote_id", label: "شناسهٔ بیرونی", type: "string", maxLength: 80, ltr: true, span: 8 },
    { name: "remote_url", label: "نشانی", type: "url", span: 16 },
    { name: "remote_state", label: "وضعیت در ابزار", type: "string", maxLength: 80, list: true, span: 8 },
    { name: "sync_state", label: "همگام‌سازی", type: "choice", choices: [{ value: "in_sync", label: "همگام", color: "green" }, { value: "error", label: "خطا", color: "red" }, { value: "unlinked", label: "جداشده", color: "gray" }], default: "in_sync", list: true, filter: true, span: 8 },
    { name: "last_synced_at", label: "آخرین همگام‌سازی", type: "datetime", list: true, span: 8 },
    { name: "error", label: "خطا", type: "text", span: 24 },
  ],
  unique: [["connection_id", "remote_key"]],
  scope: {},
  list: { columns: ["remote_key", "record_label", "remote_state", "sync_state", "last_synced_at"], order: "-updated_at" },
};

const exportSchedule: TableDef = {
  key: "export_schedule",
  table: "sm_export_schedules",
  label: "خروجی زمان‌بندی‌شده",
  plural: "خروجی‌های زمان‌بندی‌شده",
  icon: "calendar-clock",
  module: "integration",
  area: "integrations",
  description: "دادهٔ جدول‌ها، با دسترسی یک کاربر یکپارچه‌سازی، در فاصله‌های منظم به یک فایل یا یک نشانی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12, section: MAIN },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 12, section: MAIN },
    { name: "tables", label: "جدول‌ها", type: "tags", required: true, list: true, span: 24, section: MAIN },
    { name: "format", label: "قالب", type: "choice", choices: [{ value: "json", label: "JSON" }, { value: "csv", label: "CSV" }, { value: "xlsx", label: "اکسل" }], default: "csv", list: true, span: 12, section: MAIN },
    { name: "every_hours", label: "هر چند ساعت", type: "int", min: 1, max: 720, default: 24, span: 12, section: MAIN },
    { name: "principal_id", label: "کاربر یکپارچه‌سازی", type: "ref", ref: "integration_user", required: true, list: true, span: 12, section: MAIN, help: "خروجی فقط آنچه این کاربر می‌بیند را دارد" },
    { name: "destination", label: "مقصد", type: "choice", choices: [{ value: "file", label: "فایل (در «خروجی‌های داده»)" }, { value: "webhook", label: "ارسال به نشانی" }], default: "file", span: 12, section: MAIN },
    { name: "url", label: "نشانی مقصد", type: "url", span: 24, section: MAIN },
    { name: "secret", label: "راز امضا", type: "secret", span: 12, section: MAIN },
    { name: "health", label: "سلامت", type: "choice", choices: INTEGRATION_HEALTH, default: "unknown", system: true, list: true, span: 8, section: STATUS },
    { name: "last_run_at", label: "آخرین اجرا", type: "datetime", system: true, audit: false, list: true, span: 8, section: STATUS },
    { name: "next_run_at", label: "اجرای بعد", type: "datetime", system: true, audit: false, span: 8, section: STATUS },
    { name: "last_status", label: "آخرین نتیجه", type: "string", maxLength: 300, system: true, audit: false, span: 24, section: STATUS },
  ],
  scope: { own: ["created_by"] },
  form: { sections: [MAIN, STATUS] },
  list: { columns: ["name", "tables", "format", "health", "last_run_at", "active"], order: "name" },
};

export const INTEGRATION_TABLES: TableDef[] = [integrationUser, webhook, inbound, directory, issueConnection, externalRef, exportSchedule];
