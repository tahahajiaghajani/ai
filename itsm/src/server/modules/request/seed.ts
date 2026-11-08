// Day-one defaults of service requests for an organisation (Persian, idempotent — REQ-052 content pack):
//   · the settings row (request_config: auto-confirmation, reminders, the default fulfilment group) — it also
//     records that the defaults were added (`seeded`, `seed_version`)
//   · fulfilment groups («پشتیبانی کاربران»، «شبکه و زیرساخت»، «هویت و دسترسی»، «تدارکات فناوری»)
//   · approval rules on requested items bound to the items that name them (manager; manager then security;
//     manager then IT procurement)
//   · the IT catalogue «فناوری اطلاعات» with categories and published items, each with questions, form policies, an
//     approval rule and a fulfilment flow bound to its code: new laptop, software installation, access request,
//     password reset (zero-touch), VPN, mailbox, phone; an ad-hoc «درخواست دیگر», the order guide «ورود کارمند
//     جدید» and the record producer «گزارش مشکل»
//   · SLA definitions (fulfilment of items by priority, the approval OLA, the task OLA) on the office calendar
//   · notification rules on top of the platform's built-ins, and a UI policy for blocked tasks
// Every row is created only when no live row with its natural key exists; once seeded, a second run adds nothing
// unless forced (an administrator's «افزودن پیش‌فرض‌ها» re-adds what was deleted).
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { eqAll, liveRows, sysOf, type Row } from "./common";
import { draftSchema, snapshotIn } from "./definition";
import { boundCondition, fulfilmentGraph, type TaskStep } from "./builder";
import { triggerOf } from "../flows";

export const REQUEST_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

const H = 3600;

/** Create `values` in `table` unless a live row matches `key`; returns the existing or new row. */
async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

/** The organisation's default (office) calendar, created with the SLA service's seed when there is none. */
async function officeCalendar(tx: Tx, sys: Ctx, out: SeedCounts): Promise<string | null> {
  let rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!rows.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  const active = rows.filter((r) => r.active !== false);
  return ((active.find((r) => r.is_default) ?? active[0])?.id as string) ?? null;
}

const state = (v: string | string[]): Cond => (Array.isArray(v) ? { f: "state", op: "in", v } : { f: "state", op: "eq", v });

function slaDefinitions(office: string | null): Row[] {
  return [
    {
      table_key: "request_item", name: "انجام قلم درخواست‌شده", type: "sla", target: "resolution", calendar_id: office, sort_order: 10,
      duration_mode: "priority", priority_field: "priority", durations: { "1": 4 * H, "2": 8 * H, "3": 16 * H, "4": 24 * H, "5": 40 * H },
      start_condition: state(["in_fulfilment", "awaiting_info", "backordered"]),
      pause_condition: state(["awaiting_info", "backordered"]),
      stop_condition: state(["delivered", "closed_complete", "closed_incomplete"]),
      cancel_condition: state(["cancelled", "rejected"]),
      warn_percents: [50, 75, 90],
      description: "از آغاز انجام تا تحویل، در ساعات اداری؛ در انتظار درخواست‌کننده یا تأمین متوقف می‌شود",
    },
    {
      table_key: "request_item", name: "تأیید قلم درخواست‌شده", type: "ola", target: "custom", calendar_id: office, sort_order: 20,
      duration_mode: "fixed", duration: 16 * H,
      start_condition: state("awaiting_approval"),
      stop_condition: state(["in_fulfilment", "rejected", "delivered", "closed_complete", "closed_incomplete"]),
      cancel_condition: state("cancelled"),
      warn_percents: [50, 90],
      description: "تأییدکنندگان در دو روز کاری تصمیم بگیرند",
    },
    {
      table_key: "request_task", name: "انجام وظیفه", type: "ola", target: "resolution", calendar_id: office, sort_order: 30,
      duration_mode: "fixed", duration: 16 * H,
      start_condition: state(["open", "work_in_progress", "on_hold"]),
      pause_condition: state("on_hold"),
      stop_condition: state(["closed_complete", "closed_incomplete"]),
      cancel_condition: state(["cancelled", "skipped"]),
      warn_percents: [75],
      description: "هر وظیفه در دو روز کاری از رسیدن نوبتش",
    },
  ];
}

function notificationRules(): Row[] {
  const base = { active: true, notify_actor: false, digest: false, mandatory: false };
  return [
    { ...base, table_key: "request", name: "سفارش ثبت شد", event: "created", recipients: { requester: true }, channels: ["in_app", "email"] },
    { ...base, table_key: "request_item", name: "قلم تحویل شد؛ تأیید کنید", event: "state_changed", condition: { and: [{ f: "state", op: "changes_to", v: "delivered" }, { f: "requires_confirmation", op: "eq", v: true }] }, recipients: { requester: true }, channels: ["in_app", "email"] },
    { ...base, table_key: "request_item", name: "اطلاعات بیشتر لازم است", event: "state_changed", condition: { f: "state", op: "changes_to", v: "awaiting_info" }, recipients: { requester: true }, channels: ["in_app", "email"] },
    { ...base, table_key: "request_item", name: "قلم درخواست‌شده رد شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "rejected" }, recipients: { requester: true }, channels: ["in_app", "email"] },
    { ...base, table_key: "request_item", name: "یادآوری: منتظر پاسخ شما", event: "custom", custom_event: "request.info_reminder", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { ...base, table_key: "request_item", name: "مهلت دسترسی به پایان رسید", event: "custom", custom_event: "request.access_expired", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { ...base, table_key: "request_item", name: "قلم درخواست‌شده نزدیک موعد", event: "sla_warning", recipients: { assignee: true, assignment_group: true }, channels: ["in_app"] },
    { ...base, table_key: "request_task", name: "نوبت وظیفهٔ انجام رسید", event: "state_changed", condition: { and: [{ f: "state", op: "changes_from", v: "pending" }, { f: "state", op: "changes_to", v: "open" }] }, recipients: { assignee: true, assignment_group: true }, channels: ["in_app"] },
  ];
}

type Choice = [string, string, string?];
interface VarSeed {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  hidden?: boolean;
  choices?: Choice[];
  default_value?: string;
  help?: string;
  placeholder?: string;
  width?: "half" | "full";
  field_class?: string;
  map_to?: string;
  regex?: string;
  regex_message?: string;
  max_length?: number;
}
interface PolicySeed {
  name: string;
  when: Cond;
  actions: { variable: string; visible?: boolean; mandatory?: boolean; readonly?: boolean }[];
}
interface ItemSeed {
  code: string;
  name: string;
  type: string;
  category: string;
  short: string;
  description: string;
  icon: string;
  price?: string;
  recurring_price?: string;
  recurring_frequency?: string;
  creates_subscription?: boolean;
  delivery_days?: number;
  approval?: string | null;
  group: string;
  multi_user?: boolean;
  quantity_allowed?: boolean;
  requires_confirmation?: boolean;
  requester_cancel?: string;
  title_template?: string;
  stages?: string[];
  featured?: boolean;
  ad_hoc?: boolean;
  target_table?: string;
  vars: VarSeed[];
  policies?: PolicySeed[];
  flow?: { steps: TaskStep[]; notify?: { subject: string; body: string }; deliver?: boolean } | null;
}

const ch = (xs: Choice[]) => xs.map(([value, label, price]) => ({ value, label, ...(price ? { price } : {}) }));
const yes = (f: string): Cond => ({ f, op: "eq", v: true });
const is = (f: string, v: string): Cond => ({ f, op: "eq", v });

/** The starter IT catalogue (codes are stable keys: flows and the API use them). */
function itCatalogue(): ItemSeed[] {
  return [
    {
      code: "new_laptop", name: "لپ‌تاپ جدید", type: "hardware", category: "hardware", icon: "laptop", featured: true,
      short: "لپ‌تاپ سازمانی با سیستم‌عامل و نرم‌افزارهای پایهٔ نصب‌شده",
      description: "لپ‌تاپ سازمانی آماده به کار تحویل می‌شود: سیستم‌عامل، ضدویروس، مجموعهٔ آفیس و اتصال به دامنه. اگر جایگزین دستگاه فعلی است، دستگاه قبلی هنگام تحویل جمع‌آوری می‌شود.",
      price: "650000000", delivery_days: 5, approval: "procurement", group: "desktop",
      title_template: "لپ‌تاپ {{model}} برای {{requested_for}}",
      stages: ["submitted", "approval", "sourcing", "fulfilment", "delivery", "completed"],
      vars: [
        { name: "model", label: "مدل", type: "select", required: true, choices: [["standard", "اداری استاندارد"], ["performance", "سبک و پرقدرت", "150000000"], ["design", "طراحی و گرافیک", "400000000"]], default_value: "standard", width: "half" },
        { name: "ram", label: "حافظه", type: "radio", choices: [["16", "۱۶ گیگابایت"], ["32", "۳۲ گیگابایت", "60000000"]], default_value: "16", width: "half" },
        { name: "os", label: "سیستم‌عامل", type: "radio", required: true, choices: [["windows", "ویندوز ۱۱"], ["linux", "لینوکس"]], default_value: "windows", width: "half" },
        { name: "delivery_location", label: "محل تحویل", type: "location", width: "half" },
        { name: "replace_old", label: "جایگزین دستگاه فعلی است", type: "bool", default_value: "false" },
        { name: "old_asset", label: "شمارهٔ اموال دستگاه فعلی", type: "string", hidden: true, max_length: 40 },
        { name: "reason", label: "دلیل نیاز", type: "text", required: true, max_length: 1000, placeholder: "مثلاً کارمند جدید، خرابی دستگاه فعلی، نیاز پروژه" },
      ],
      policies: [{ name: "جایگزینی دستگاه", when: yes("replace_old"), actions: [{ variable: "old_asset", visible: true, mandatory: true }] }],
      flow: {
        steps: [
          { title: "تأمین و آماده‌سازی لپ‌تاپ", group: "procurement", instructions: "مدل و حافظهٔ خواسته‌شده را از انبار یا خرید تأمین کنید." },
          { title: "نصب سیستم‌عامل و نرم‌افزارهای پایه", group: "desktop", instructions: "سیستم‌عامل، ضدویروس و آفیس را نصب و دستگاه را به دامنه وصل کنید." },
          { title: "تحویل لپ‌تاپ به کاربر", group: "desktop", requester_visible: true, instructions: "هنگام تحویل، رسید اموال را امضا بگیرید." },
          { title: "جمع‌آوری دستگاه قبلی", group: "desktop", when: { answer: "replace_old", equals: "true" }, instructions: "دستگاه قبلی را تحویل بگیرید و داده‌های آن را پاک کنید." },
        ],
      },
    },
    {
      code: "software_install", name: "نصب نرم‌افزار", type: "software", category: "software", icon: "app-window",
      short: "نصب نرم‌افزارهای مجاز روی رایانهٔ سازمانی",
      description: "نرم‌افزارهای فهرست مجاز پس از تأیید مدیر و بررسی مجوز نصب می‌شوند. برای نرم‌افزاری که در فهرست نیست «سایر» را انتخاب کنید.",
      delivery_days: 2, approval: "manager", group: "desktop",
      title_template: "نصب {{software}} برای {{requested_for}}",
      vars: [
        { name: "software", label: "نرم‌افزار", type: "select", required: true, choices: [["office", "مجموعهٔ آفیس"], ["autocad", "اتوکد", "120000000"], ["vscode", "ویژوال استودیو کد"], ["accounting", "نرم‌افزار حسابداری"], ["other", "سایر"]] },
        { name: "other_name", label: "نام نرم‌افزار", type: "string", hidden: true, max_length: 120 },
        { name: "computer_name", label: "نام یا شمارهٔ اموال رایانه", type: "string", required: true, max_length: 60, regex: "^[A-Za-z0-9._-]+$", regex_message: "فقط حروف لاتین، رقم، نقطه، خط تیره و _" },
        { name: "justification", label: "کاربرد", type: "text", max_length: 1000 },
      ],
      policies: [{ name: "نرم‌افزار دیگر", when: is("software", "other"), actions: [{ variable: "other_name", visible: true, mandatory: true }, { variable: "justification", mandatory: true }] }],
      flow: {
        steps: [
          { title: "بررسی مجوز نرم‌افزار", group: "desktop", instructions: "پیش از نصب، مجوز آزاد را بررسی کنید؛ اگر مجوزی نیست خرید را پیگیری کنید." },
          { title: "نصب نرم‌افزار", group: "desktop", requester_visible: true },
        ],
      },
    },
    {
      code: "access_request", name: "درخواست دسترسی", type: "access", category: "access", icon: "key-round", multi_user: true,
      short: "دسترسی به سامانه‌ها و پوشه‌های سازمان، دائم یا موقت",
      description: "دسترسی پس از تأیید مدیر و تیم هویت و دسترسی داده می‌شود. دسترسی موقت در تاریخ پایان خودبه‌خود برداشته می‌شود. می‌توانید برای چند نفر هم‌زمان درخواست دهید.",
      delivery_days: 2, approval: "security", group: "identity",
      title_template: "دسترسی {{access_level}} به {{system}} برای {{requested_for}}",
      vars: [
        { name: "system", label: "سامانه", type: "select", required: true, choices: [["finance", "سامانهٔ مالی"], ["hr", "سامانهٔ منابع انسانی"], ["shares", "پوشه‌های اشتراکی"], ["reports", "پایگاه دادهٔ گزارش‌ها"]] },
        { name: "access_level", label: "سطح دسترسی", type: "radio", required: true, choices: [["read", "فقط خواندن"], ["write", "خواندن و نوشتن"], ["admin", "مدیر"]], default_value: "read" },
        { name: "temporary", label: "دسترسی موقت است", type: "bool", default_value: "false" },
        { name: "end_date", label: "تا تاریخ", type: "date", hidden: true, map_to: "access_until" },
        { name: "reason", label: "دلیل نیاز", type: "text", required: true, max_length: 1000 },
      ],
      policies: [{ name: "دسترسی موقت", when: yes("temporary"), actions: [{ variable: "end_date", visible: true, mandatory: true }] }],
      flow: { steps: [{ title: "اعطای دسترسی", group: "identity", instructions: "سطح دسترسی خواسته‌شده را بدهید و اگر موقت است تاریخ پایان را ثبت کنید." }] },
    },
    {
      code: "password_reset", name: "بازنشانی گذرواژه", type: "standard", category: "access", icon: "lock-keyhole-open", featured: true,
      short: "گذرواژهٔ موقت برای حساب قفل‌شده یا فراموش‌شده",
      description: "گذرواژهٔ موقت بی‌درنگ و بدون دخالت کارشناس فرستاده می‌شود. گام «فراخوانی HTTP» گردش‌کار این قلم را به سامانهٔ هویت سازمان وصل کنید.",
      delivery_days: 0, approval: null, group: "identity", requires_confirmation: false, requester_cancel: "never",
      title_template: "بازنشانی گذرواژهٔ {{account}}",
      vars: [
        { name: "account", label: "حساب", type: "select", required: true, choices: [["domain", "حساب ویندوز (دامنه)"], ["email", "ایمیل"], ["finance", "سامانهٔ مالی"]], default_value: "domain" },
        { name: "username", label: "نام کاربری", type: "string", required: true, max_length: 80, regex: "^[A-Za-z0-9._@-]+$", regex_message: "نام کاربری را با حروف لاتین بنویسید" },
        { name: "contact_phone", label: "تلفن همراه برای پیامک", type: "phone", required: true, field_class: "personal" },
      ],
      flow: {
        steps: [],
        notify: { subject: "گذرواژهٔ موقت فرستاده شد", body: "گذرواژهٔ موقت حساب شما به تلفن همراهتان پیامک شد. پس از ورود، آن را عوض کنید." },
        deliver: true,
      },
    },
    {
      code: "vpn_access", name: "دسترسی VPN", type: "access", category: "access", icon: "shield-check",
      short: "اتصال امن به شبکهٔ سازمان از بیرون",
      description: "حساب VPN برای مدت مشخص ساخته می‌شود و در تاریخ پایان خودبه‌خود غیرفعال می‌شود. راهنمای اتصال پس از ساخت حساب برایتان فرستاده می‌شود.",
      delivery_days: 1, approval: "security", group: "network",
      title_template: "دسترسی VPN برای {{requested_for}}",
      vars: [
        { name: "device", label: "دستگاه", type: "radio", required: true, choices: [["company", "رایانهٔ سازمانی"], ["personal", "دستگاه شخصی"]], default_value: "company" },
        { name: "personal_note", label: "دستگاه شخصی باید ضدویروس به‌روز و سیستم‌عامل پشتیبانی‌شده داشته باشد.", type: "label", hidden: true },
        { name: "os", label: "سیستم‌عامل", type: "select", required: true, choices: [["windows", "ویندوز"], ["macos", "مک"], ["linux", "لینوکس"], ["android", "اندروید"], ["ios", "iOS"]] },
        { name: "end_date", label: "تا تاریخ", type: "date", required: true, map_to: "access_until" },
        { name: "reason", label: "دلیل نیاز", type: "text", required: true, max_length: 1000 },
      ],
      policies: [{ name: "دستگاه شخصی", when: is("device", "personal"), actions: [{ variable: "personal_note", visible: true }] }],
      flow: {
        steps: [{ title: "ساخت حساب VPN", group: "network", instructions: "حساب را تا تاریخ پایان خواسته‌شده بسازید." }],
        notify: { subject: "دسترسی VPN شما آماده است", body: "حساب VPN شما ساخته شد. راهنمای اتصال در پایگاه دانش است؛ اگر مشکلی بود همین‌جا پاسخ دهید." },
      },
    },
    {
      code: "mailbox", name: "صندوق پست الکترونیک", type: "standard", category: "messaging", icon: "mail",
      short: "صندوق ایمیل شخصی یا مشترک برای یک تیم",
      description: "صندوق شخصی برای کارمند یا صندوق مشترک برای تیم‌ها (مانند پشتیبانی یا فروش).",
      delivery_days: 1, approval: "manager", group: "network",
      title_template: "صندوق ایمیل {{mailbox_type}}",
      vars: [
        { name: "mailbox_type", label: "نوع صندوق", type: "radio", required: true, choices: [["personal", "شخصی"], ["shared", "مشترک (گروهی)"]], default_value: "personal" },
        { name: "mailbox_name", label: "نشانی صندوق مشترک", type: "string", hidden: true, max_length: 64, regex: "^[a-z0-9._-]+$", regex_message: "فقط حروف لاتین کوچک، رقم، نقطه، خط تیره و _", placeholder: "support" },
        { name: "members", label: "اعضای صندوق مشترک", type: "users", hidden: true },
        { name: "quota", label: "فضا", type: "select", choices: [["5", "۵ گیگابایت"], ["20", "۲۰ گیگابایت", "20000000"]], default_value: "5" },
      ],
      policies: [{ name: "صندوق مشترک", when: is("mailbox_type", "shared"), actions: [{ variable: "mailbox_name", visible: true, mandatory: true }, { variable: "members", visible: true, mandatory: true }] }],
      flow: {
        steps: [
          { title: "ساخت صندوق", group: "network" },
          { title: "افزودن اعضای صندوق مشترک", group: "network", when: { answer: "mailbox_type", equals: "shared" } },
        ],
      },
    },
    {
      code: "phone", name: "گوشی تلفن", type: "hardware", category: "messaging", icon: "phone",
      short: "تلفن رومیزی IP یا گوشی همراه سازمانی با خط",
      description: "تلفن رومیزی با شمارهٔ داخلی، یا گوشی همراه سازمانی با سیم‌کارت. هزینهٔ ماهانهٔ خط و نگهداری به مرکز هزینهٔ واحد شما منظور می‌شود.",
      delivery_days: 3, approval: "manager", group: "network", recurring_price: "1500000", recurring_frequency: "monthly", creates_subscription: true,
      title_template: "{{phone_type}} برای {{requested_for}}",
      vars: [
        { name: "phone_type", label: "نوع", type: "radio", required: true, choices: [["desk", "تلفن رومیزی IP"], ["mobile", "گوشی همراه سازمانی", "180000000"]], default_value: "desk" },
        { name: "extension", label: "شمارهٔ داخلی دلخواه", type: "string", max_length: 10, regex: "^[0-9۰-۹]*$", regex_message: "فقط رقم", width: "half" },
        { name: "sim", label: "سیم‌کارت سازمانی لازم است", type: "bool", hidden: true, default_value: "true" },
        { name: "install_location", label: "محل نصب یا تحویل", type: "location", required: true, width: "half" },
      ],
      policies: [{ name: "گوشی همراه", when: is("phone_type", "mobile"), actions: [{ variable: "sim", visible: true }, { variable: "extension", visible: false }] }],
      flow: {
        steps: [
          { title: "تأمین دستگاه", group: "procurement" },
          { title: "نصب و پیکربندی", group: "network", instructions: "شمارهٔ داخلی یا سیم‌کارت را فعال کنید." },
          { title: "تحویل به کاربر", group: "desktop", requester_visible: true },
        ],
      },
    },
    {
      code: "other_request", name: "درخواست دیگر", type: "standard", category: "general", icon: "message-circle-question", ad_hoc: true,
      short: "درخواستی که در کاتالوگ نیست",
      description: "اگر خدمت مورد نیازتان را در کاتالوگ پیدا نکردید، آن را شرح دهید؛ کارشناس میز خدمت آن را بررسی و هدایت می‌کند.",
      approval: null, group: "desktop",
      title_template: "{{subject}}",
      vars: [
        { name: "subject", label: "موضوع", type: "string", required: true, max_length: 150 },
        { name: "details", label: "شرح", type: "text", required: true, max_length: 4000 },
        { name: "needed_by", label: "تا چه تاریخی لازم است", type: "date", width: "half" },
      ],
      flow: null,
    },
  ];
}

/** The groups the starter catalogue routes to (by key). */
const GROUPS: Record<string, { name: string; description: string }> = {
  desktop: { name: "پشتیبانی کاربران", description: "رایانه‌ها، نرم‌افزارها و تحویل تجهیزات به کاربران" },
  network: { name: "شبکه و زیرساخت", description: "شبکه، VPN، ایمیل و تلفن" },
  identity: { name: "هویت و دسترسی", description: "حساب‌ها، گذرواژه‌ها و دسترسی به سامانه‌ها" },
  procurement: { name: "تدارکات فناوری", description: "تأمین و خرید تجهیزات و مجوزهای نرم‌افزار" },
};

const CATEGORIES: [string, string, string, string][] = [
  ["hardware", "سخت‌افزار", "laptop", "رایانه، گوشی و تجهیزات جانبی"],
  ["software", "نرم‌افزار", "app-window", "نصب و مجوز نرم‌افزار"],
  ["access", "دسترسی و حساب کاربری", "key-round", "حساب، گذرواژه، VPN و دسترسی به سامانه‌ها"],
  ["messaging", "ایمیل و ارتباطات", "mail", "صندوق ایمیل و تلفن"],
  ["general", "عمومی", "layout-grid", "راهنمای سفارش و درخواست‌های دیگر"],
];

/** Add the defaults inside `tx` as the system. */
export async function seedRequestDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "request_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seed_version ?? 0) >= REQUEST_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "request_config", { name: "تنظیمات درخواست خدمت" }, {}));
  const office = await officeCalendar(tx, sys, out);

  const groups: Record<string, string> = {};
  for (const [k, g] of Object.entries(GROUPS)) groups[k] = String((await ensure(tx, sys, out, "group", { name: g.name }, { types: ["assignment"], description: g.description })).id);

  // approval rules bound to the requested items that name them
  const rule = async (name: string, levels: Row[], description: string): Promise<string> => {
    const row = await ensure(tx, sys, out, "approval_rule", { table_key: "request_item", name }, {
      mode: "sequential", levels, remind_every: 24 * H, expire_after: 5 * 24 * H, expire_action: "reject", active: true, description,
    });
    if (!row.condition || !JSON.stringify(row.condition).includes(String(row.id))) {
      await updateIn(tx, sys, "approval_rule", String(row.id), { condition: boundCondition(String(row.id)) }, { trusted: true });
    }
    return String(row.id);
  };
  const manager = { name: "مدیر مستقیم", sources: [{ kind: "manager" }], rule: "any" };
  const rules: Record<string, string> = {
    manager: await rule("تأیید مدیر (کاتالوگ)", [manager], "مدیر مستقیم درخواست‌کننده سفارش را تأیید می‌کند"),
    security: await rule("تأیید مدیر و هویت و دسترسی", [manager, { name: "هویت و دسترسی", sources: [{ kind: "groups", groups: [groups.identity] }], rule: "any" }], "نخست مدیر مستقیم، سپس یکی از اعضای «هویت و دسترسی»"),
    procurement: await rule("تأیید مدیر و تدارکات فناوری", [manager, { name: "تدارکات فناوری", sources: [{ kind: "groups", groups: [groups.procurement] }], rule: "any" }], "نخست مدیر مستقیم، سپس بودجه در «تدارکات فناوری»"),
  };

  const catalog = await ensure(tx, sys, out, "catalog", { name: "فناوری اطلاعات" }, {
    description: "خدمات فناوری اطلاعات: تجهیزات، نرم‌افزار، دسترسی و ارتباطات", icon: "monitor", color: "blue", sort_order: 10,
  });
  const cats: Record<string, string> = {};
  for (const [i, [key, name, icon, description]] of CATEGORIES.entries()) {
    cats[key] = String((await ensure(tx, sys, out, "catalog_category", { catalog_id: catalog.id, name }, { icon, description, sort_order: (i + 1) * 10 })).id);
  }

  const items: Record<string, Row> = {};
  for (const [i, s] of itCatalogue().entries()) {
    items[s.code] = await seedItem(tx, sys, out, s, { catalog: String(catalog.id), category: cats[s.category], group: groups[s.group], rule: s.approval ? rules[s.approval] : null, groups, order: (i + 1) * 10 });
  }

  // the order guide «ورود کارمند جدید» (bundle: mailbox always; laptop, phone and VPN on the answers)
  const guide = await seedItem(tx, sys, out, {
    code: "new_hire", name: "ورود کارمند جدید", type: "order_guide", category: "general", icon: "user-plus", featured: true, group: "desktop", approval: null,
    short: "همهٔ آنچه کارمند تازه‌وارد لازم دارد، در یک سفارش",
    description: "به چند پرسش پاسخ دهید تا اقلام لازم (صندوق ایمیل، لپ‌تاپ، گوشی و VPN) با پاسخ‌های شما پر شوند؛ هر قلم جداگانه تأیید و انجام می‌شود.",
    vars: [
      { name: "start_date", label: "تاریخ شروع کار", type: "date", required: true, width: "half" },
      { name: "job_title", label: "سمت", type: "string", required: true, max_length: 120, width: "half" },
      { name: "needs_laptop", label: "لپ‌تاپ لازم دارد", type: "bool", default_value: "true" },
      { name: "needs_phone", label: "تلفن لازم دارد", type: "bool", default_value: "false" },
      { name: "needs_vpn", label: "دورکاری دارد (VPN)", type: "bool", default_value: "false" },
      { name: "reason", label: "شرح کار و نیازها", type: "text", required: true, max_length: 1000, help: "به اقلام انتخاب‌شده منتقل می‌شود" },
    ],
    flow: null,
  }, { catalog: String(catalog.id), category: cats.general, group: groups.desktop, rule: null, groups, order: 5, rules: [
    { item: items.mailbox, mandatory: true, condition: null, order: 10 },
    { item: items.new_laptop, mandatory: false, condition: yes("needs_laptop"), order: 20 },
    { item: items.phone, mandatory: false, condition: yes("needs_phone"), order: 30 },
    { item: items.vpn_access, mandatory: false, condition: yes("needs_vpn"), order: 40 },
  ] });
  void guide;

  // the record producer «گزارش مشکل»: an incident when incident management is installed, else a «کار»
  const target = tableDef("incident") ? "incident" : "todo";
  await seedItem(tx, sys, out, {
    code: "report_issue", name: "گزارش مشکل", type: "record_producer", category: "general", icon: "life-buoy", group: "desktop", approval: null, target_table: target,
    short: "چیزی کار نمی‌کند؟ آن را گزارش دهید",
    description: "برای خرابی‌ها و اختلال‌ها؛ گزارش شما مستقیم به میز خدمت می‌رسد.",
    vars: [
      { name: "subject", label: "چه چیزی کار نمی‌کند؟", type: "string", required: true, max_length: 150, map_to: "short_description" },
      { name: "details", label: "شرح", type: "text", required: true, max_length: 4000, map_to: "description" },
      { name: "urgency", label: "فوریت", type: "radio", choices: [["1", "کار من کاملاً متوقف است"], ["2", "کارم کند شده است"], ["3", "مشکل جزئی است"]], default_value: "3", map_to: "urgency" },
    ],
    flow: null,
  }, { catalog: String(catalog.id), category: cats.general, group: groups.desktop, rule: null, groups, order: 1 });

  for (const d of slaDefinitions(office)) await ensure(tx, sys, out, "sla_definition", { table_key: d.table_key, name: d.name }, d);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  await ensure(tx, sys, out, "ui_policy", { table_key: "request_task", name: "وظیفهٔ مسدود علت می‌خواهد" }, {
    condition: { f: "blocked", op: "eq", v: true }, actions: [{ field: "blocked_reason", mandatory: true }], sort_order: 100,
  });

  const patch: Row = { seeded: true, seed_version: REQUEST_SEED_VERSION };
  if (!config.default_group_id) patch.default_group_id = groups.desktop;
  if (!config.calendar_id && office) patch.calendar_id = office;
  await updateIn(tx, sys, "request_config", String(config.id), patch, { trusted: true });
  return out;
}

/** One item with its questions, policies, guide rules and fulfilment flow, published once. */
async function seedItem(
  tx: Tx,
  sys: Ctx,
  out: SeedCounts,
  s: ItemSeed,
  at: { catalog: string; category: string; group: string; rule: string | null; groups: Record<string, string>; order: number; rules?: { item: Row; mandatory: boolean; condition: Cond | null; order: number }[] },
): Promise<Row> {
  const [existing] = await liveRows(tx, sys, "catalog_item", eqAll({ code: s.code }), { limit: 1 });
  if (existing) return existing;
  const item = await createIn(tx, sys, "catalog_item", {
    code: s.code, name: s.name, type: s.type, catalog_id: at.catalog, category_id: at.category, short_description: s.short, description: s.description, icon: s.icon,
    sort_order: at.order, featured: !!s.featured, ad_hoc: !!s.ad_hoc, price: s.price ?? null, recurring_price: s.recurring_price ?? null,
    recurring_frequency: s.recurring_frequency ?? null, creates_subscription: !!s.creates_subscription, delivery_days: s.delivery_days ?? null,
    fulfilment_group_id: at.group, approval_rule_id: at.rule, multi_user: !!s.multi_user, quantity_allowed: !!s.quantity_allowed,
    requires_confirmation: s.requires_confirmation !== false, requester_cancel: s.requester_cancel ?? "before_fulfilment",
    title_template: s.title_template ?? null, stages: s.stages ?? [], target_table: s.target_table ?? null,
    cart_allowed: s.type !== "record_producer" && s.type !== "order_guide", review_interval_days: 180,
  }, { trusted: true });
  out.created.catalog_item = (out.created.catalog_item ?? 0) + 1;
  for (const [i, v] of s.vars.entries()) {
    await createIn(tx, sys, "catalog_variable", {
      item_id: item.id, name: v.name, label: v.label, type: v.type, sort_order: (i + 1) * 10, required: !!v.required, hidden: !!v.hidden,
      choices: v.choices ? ch(v.choices) : null, default_value: v.default_value ?? null, help: v.help ?? null, placeholder: v.placeholder ?? null,
      width: v.width ?? "full", field_class: v.field_class ?? "public", map_to: v.map_to ?? null, regex: v.regex ?? null, regex_message: v.regex_message ?? null,
      max_length: v.max_length ?? null,
    }, { trusted: true });
    out.created.catalog_variable = (out.created.catalog_variable ?? 0) + 1;
  }
  for (const [i, p] of (s.policies ?? []).entries()) {
    await createIn(tx, sys, "catalog_ui_policy", { item_id: item.id, name: p.name, condition: p.when, actions: p.actions, sort_order: (i + 1) * 10, applies_to: "both" }, { trusted: true });
  }
  for (const r of at.rules ?? []) {
    await createIn(tx, sys, "order_guide_rule", { guide_id: item.id, item_id: r.item.id, name: String(r.item.name), mandatory: r.mandatory, selected: true, cascade: true, condition: r.condition, sort_order: r.order }, { trusted: true });
  }
  if (s.flow) {
    const steps = s.flow.steps.map((t) => ({ ...t, group: t.group ? at.groups[t.group] ?? null : null }));
    const graph = fulfilmentGraph(steps, { notify: s.flow.notify ?? null, deliver: !!s.flow.deliver });
    const flow = await createIn(tx, sys, "flow", {
      name: `انجام: ${s.name}`, active: true, description: `انجام سفارش‌های «${s.name}» (کاتالوگ فناوری اطلاعات)`,
      trigger: "catalog", trigger_table: "request_item", catalog_item: s.code, run_as: "system", graph,
    }, { trusted: true });
    const version = await createIn(tx, sys, "flow_version", { flow_id: flow.id, version_no: 1, title: `انجام: ${s.name} — نسخهٔ ۱`, note: "نسخهٔ نخست", trigger: triggerOf(flow), graph }, { trusted: true });
    await updateIn(tx, sys, "flow", String(flow.id), { version_id: version.id, version_no: 1, published_at: new Date().toISOString(), dirty: false }, { trusted: true });
    await updateIn(tx, sys, "catalog_item", String(item.id), { flow_id: flow.id }, { trusted: true });
    out.created.flow = (out.created.flow ?? 0) + 1;
  }
  const fresh = (await liveRows(tx, sys, "catalog_item", eqAll({ id: item.id }), { limit: 1 }))[0] ?? item;
  await snapshotIn(tx, sys, fresh, await draftSchema(tx, sys, fresh), "نسخهٔ نخست");
  return (await liveRows(tx, sys, "catalog_item", eqAll({ id: item.id }), { limit: 1 }))[0] ?? item;
}

export { ensure as ensureRow };
