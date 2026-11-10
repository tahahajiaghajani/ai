// Day-one content of enterprise service management (ESM-002 content packs; Persian, idempotent, as the system):
//   · four department workspaces — «منابع انسانی» and «حقوقی» secure (explicit members only), «پشتیبانی و تدارکات»
//     and «مالی» — with their groups (their members hold the departments' roles through the group) and departments
//   · the organisation roles «کارشناس خدمات سازمانی» (the business agent of ESM-005), «کارشناس مالی», «مشاور حقوقی»
//     and «مدیر خدمات واحد» (delegated department administration, ESM-004)
//   · case types: the category trees of every department case table, bound to the department's workspace and groups
//   · services per department with their catalogue (one catalogue per department, record producers that file the case
//     with the service) — HR: leave, mission, payslip, employment certificate, loan and advance, confidential
//     complaint; facilities: maintenance, cleaning, room set-up, access card, parking, desk; procurement: purchase;
//     finance: payment enquiry, expense claim, vendor set-up; legal: contract review, legal advice
//   · SLAs per department (and an OLA for journey work and a UC for contractors), the purchase approvals by amount
//     bands of the delegation-of-authority matrix, expense-claim approvals, a UI policy, notification rules
//   · the journey templates «ورود کارمند جدید» (laptop and account from the IT catalogue, HR documents, a desk from
//     facilities, the manager's welcome, orientation, first-month review, survey) and «خروج کارمند»
//   · department knowledge bases (HR's for everyone, contributors the department's group) and department KPIs
import type { Cond } from "@shared/model/conditions";
import { FULL_HOURS } from "@shared/sla/calendar";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, orgTz, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla/calendars";
import { draftSchema, snapshotIn } from "../request/definition";
import { triggerOf } from "../flows";
import { eqAll, liveRow, liveRows, sysOf, type Row } from "./common";

export const ESM_SEED_VERSION = 1;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

const H = 3600;
const DAY = 8 * H; // a working day of the office calendar

export const ESM_ROLES: Row[] = [
  {
    key: "esm_agent", name: "کارشناس خدمات سازمانی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "کارشناس واحدهای غیرفناوری (مالی، حقوقی، تدارکات، منابع انسانی، تأسیسات): پرونده‌ها و کارهای گروه‌های خود، کاتالوگ، دانش و گزارش‌ها؛ بی مشکل، تغییر و دارایی",
    grants: {
      request: { read: "group", create: true, write: "group" }, work: { read: "group", create: true, write: "group" }, esm: { read: "all" },
      knowledge: { read: "all", create: true, write: "own" }, catalog: { read: "all" }, service: { read: "all" }, sla: { read: "all" }, reports: { read: "all" }, org: { read: "all" }, users: { read: "all" },
    },
    field_groups: ["internal", "personal"], contains: ["requester"],
  },
  {
    key: "finance_agent", name: "کارشناس مالی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "پرونده‌های مالی گروه‌های خود با اطلاعات مالی (شماره‌های بانکی، مبالغ پرداخت)",
    grants: { financial: { read: "all" } }, field_groups: ["internal", "personal", "financial"], contains: ["esm_agent"],
  },
  {
    key: "legal_counsel", name: "مشاور حقوقی", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "درخواست‌های حقوقی گروه‌های خود در فضای کاری امن حقوقی؛ «محرمانهٔ وکیل و موکل» بیرون از این فضا دیده نمی‌شود",
    grants: { compliance: { read: "all" } }, field_groups: ["internal", "personal"], contains: ["esm_agent"],
  },
  {
    key: "esm_admin", name: "مدیر خدمات واحد", persona: "agent", workspaces: "member", domains: "own", active: true,
    description: "تعریف خدمت‌ها و الگوهای سفر واحدهایی که مدیر تفویض‌شدهٔ آن‌هاست، بی دسترسی مدیر کل سامانه",
    grants: { esm: { read: "all", create: true, write: "own" } }, field_groups: ["internal", "personal"], contains: ["esm_agent"],
  },
];

interface WsSeed { key: string; name: string; secure: boolean; icon: string; color: string; description: string }
const WORKSPACES: WsSeed[] = [
  { key: "hr", name: "منابع انسانی", secure: true, icon: "users", color: "magenta", description: "پرونده‌ها، سفرها و نمایه‌های کارکنان؛ امن: فقط اعضای صریح، حتی نه مدیر سامانه" },
  { key: "facilities", name: "پشتیبانی و تدارکات", secure: false, icon: "building-2", color: "teal", description: "تأسیسات، فضا و رزرو، پذیرش میهمانان، ایمنی و درخواست‌های خرید" },
  { key: "finance", name: "مالی", secure: false, icon: "landmark", color: "green", description: "پرداخت‌ها، هزینه و بازپرداخت، تأمین‌کنندگان و بودجه" },
  { key: "legal", name: "حقوقی", secure: true, icon: "scale", color: "indigo", description: "قراردادها، مشاوره و دعاوی؛ امن و محرمانهٔ وکیل و موکل" },
];

interface GroupSeed { key: string; name: string; ws: string; roles: string[]; restricted?: boolean; description: string }
const GROUPS: GroupSeed[] = [
  { key: "hr_desk", name: "کارشناسان منابع انسانی", ws: "hr", roles: ["hr_agent", "esm_agent"], description: "میز خدمت منابع انسانی: درخواست‌ها، گواهی‌ها، مرخصی و سفرهای کارکنان" },
  { key: "payroll", name: "حقوق و دستمزد", ws: "hr", roles: ["hr_agent", "esm_agent"], description: "فیش حقوقی، وام و مساعده، حقوق و مزایا" },
  { key: "er", name: "روابط کار و رسیدگی", ws: "hr", roles: ["hr_agent", "esm_agent"], restricted: true, description: "شکایت‌ها و رسیدگی‌های محرمانه؛ گروه محدود: فقط اعضا" },
  { key: "facilities", name: "پشتیبانی و تأسیسات", ws: "facilities", roles: ["facilities_agent", "esm_agent"], description: "تعمیر و نگهداری، نظافت، جابه‌جایی و چیدمان" },
  { key: "procurement", name: "تدارکات", ws: "facilities", roles: ["facilities_agent", "esm_agent"], description: "درخواست‌های خرید، سفارش و تحویل" },
  { key: "reception", name: "پذیرش و میهمانان", ws: "facilities", roles: ["facilities_agent", "esm_agent"], description: "ورود و خروج میهمانان و کارت تردد" },
  { key: "hse", name: "ایمنی و بهداشت کار", ws: "facilities", roles: ["facilities_agent", "esm_agent"], description: "حوادث و شبه‌حوادث، بازرسی و اقدام اصلاحی" },
  { key: "finance", name: "خدمات مالی", ws: "finance", roles: ["finance_agent"], description: "پرداخت‌ها، هزینه و بازپرداخت، تأمین‌کنندگان و بودجه" },
  { key: "legal", name: "امور حقوقی", ws: "legal", roles: ["legal_counsel"], description: "بررسی قرارداد، مشاوره و دعاوی" },
];

interface DeptSeed { key: string; name: string; kind: string; ws: string; table: string; group: string; icon: string; color: string; order: number; sensitive?: boolean; intro: string }
const DEPARTMENTS: DeptSeed[] = [
  { key: "hr", name: "منابع انسانی", kind: "hr", ws: "hr", table: "hr_case", group: "hr_desk", icon: "users", color: "magenta", order: 10, intro: "مرخصی، مأموریت، فیش حقوقی، گواهی اشتغال، وام و مساعده و هر پرسش دربارهٔ کار و همکاری. پرونده‌های شما را فقط کارشناسان منابع انسانی می‌بینند." },
  { key: "facilities", name: "پشتیبانی و تدارکات", kind: "facilities", ws: "facilities", table: "facility_request", group: "facilities", icon: "building-2", color: "teal", order: 20, intro: "تعمیر و نگهداری، نظافت، چیدمان اتاق جلسه، کارت تردد، پارکینگ، میز کار و خرید." },
  { key: "finance", name: "مالی", kind: "finance", ws: "finance", table: "finance_case", group: "finance", icon: "landmark", color: "green", order: 30, intro: "پیگیری پرداخت‌ها، هزینه و بازپرداخت، تعریف تأمین‌کننده و پرسش‌های بودجه." },
  { key: "legal", name: "حقوقی", kind: "legal", ws: "legal", table: "legal_request", group: "legal", icon: "scale", color: "indigo", order: 40, sensitive: true, intro: "بررسی قرارداد و مشاورهٔ حقوقی؛ همهٔ درخواست‌ها محرمانه است." },
];

/** Case types: the category tree of each department table, bound to its workspace and groups. */
const CATEGORIES: { table: string; ws: string; items: [string, string, string?][] }[] = [
  { table: "hr_case", ws: "hr", items: [["leave", "مرخصی"], ["mission", "مأموریت اداری"], ["payroll", "حقوق و دستمزد", "payroll"], ["certificate", "گواهی‌ها و نامه‌ها"], ["loan", "وام و مساعده", "payroll"], ["benefits", "رفاه و بیمه", "payroll"], ["employee_relations", "روابط کار و شکایت", "er"], ["onboarding", "ورود کارکنان"], ["offboarding", "خروج کارکنان"], ["other", "سایر"]] },
  { table: "facility_request", ws: "facilities", items: [["maintenance", "تعمیر و نگهداری"], ["services", "خدمات عمومی"], ["space", "فضا و جابه‌جایی"], ["access", "تردد و پارکینگ", "reception"], ["other", "سایر"]] },
  { table: "purchase_request", ws: "facilities", items: [["goods", "کالا", "procurement"], ["services", "خدمات", "procurement"]] },
  { table: "hse_event", ws: "facilities", items: [["incident", "حادثه", "hse"], ["near_miss", "شبه‌حادثه", "hse"], ["hazard", "شرایط ناایمن", "hse"]] },
  { table: "finance_case", ws: "finance", items: [["payments", "پرداخت‌ها"], ["expenses", "هزینه و بازپرداخت"], ["vendors", "تأمین‌کنندگان"], ["budget", "بودجه"]] },
  { table: "legal_request", ws: "legal", items: [["contracts", "قراردادها"], ["advice", "مشاوره"], ["disputes", "دعاوی"]] },
];

interface VarSeed { name: string; label: string; type: string; required?: boolean; choices?: [string, string][]; map_to?: string; max_length?: number; default_value?: string; help?: string }
interface ServiceSeed {
  code: string; dept: string; name: string; category: string; case_table: string; case_category?: string; group?: string; icon: string; description: string;
  keywords: string[]; vars: VarSeed[]; title: string; sensitive?: boolean; confidential?: boolean; subject_visible?: boolean; on_behalf?: string; priority?: string; journey?: string;
}

const SERVICES: ServiceSeed[] = [
  // HR (ESM-025: Iranian HR self-service)
  { code: "hr_leave", dept: "hr", name: "مرخصی", category: "حضور و غیاب", case_table: "hr_case", case_category: "leave", icon: "calendar-days", keywords: ["مرخصی", "استحقاقی", "استعلاجی", "تعطیلی"], title: "مرخصی {{leave_type}} از {{from}} تا {{to}}",
    description: "درخواست مرخصی استحقاقی، استعلاجی یا بدون حقوق با تاریخ شروع و پایان.",
    vars: [{ name: "leave_type", label: "نوع مرخصی", type: "select", required: true, choices: [["annual", "استحقاقی"], ["sick", "استعلاجی"], ["unpaid", "بدون حقوق"], ["hourly", "ساعتی"]] }, { name: "from", label: "از تاریخ", type: "date", required: true, map_to: "effective_date" }, { name: "to", label: "تا تاریخ", type: "date", required: true }, { name: "reason", label: "توضیح", type: "text", max_length: 1000 }] },
  { code: "hr_mission", dept: "hr", name: "مأموریت اداری", category: "حضور و غیاب", case_table: "hr_case", case_category: "mission", icon: "plane", keywords: ["مأموریت", "ماموریت", "سفر", "فوق‌العاده"], title: "مأموریت به {{destination}} از {{from}} تا {{to}}",
    description: "ثبت مأموریت با مقصد، تاریخ‌ها، وسیلهٔ سفر و هزینهٔ اقامت (فوق‌العادهٔ مأموریت).",
    vars: [{ name: "destination", label: "مقصد", type: "string", required: true, max_length: 120 }, { name: "from", label: "از تاریخ", type: "date", required: true, map_to: "effective_date" }, { name: "to", label: "تا تاریخ", type: "date", required: true }, { name: "transport", label: "وسیلهٔ سفر", type: "radio", choices: [["air", "هواپیما"], ["train", "قطار"], ["bus", "اتوبوس"], ["car", "خودروی سازمانی"]], default_value: "car" }, { name: "per_diem", label: "فوق‌العادهٔ مأموریت لازم است", type: "bool", default_value: "true" }] },
  { code: "hr_payslip", dept: "hr", name: "فیش حقوقی", category: "حقوق و دستمزد", case_table: "hr_case", case_category: "payroll", group: "payroll", icon: "receipt", sensitive: true, keywords: ["فیش", "حقوق", "دستمزد", "کسورات"], title: "فیش حقوقی {{period}}",
    description: "دریافت فیش حقوقی یک ماه یا پرسش دربارهٔ اقلام آن.",
    vars: [{ name: "period", label: "ماه (مثلاً مهر ۱۴۰۵)", type: "string", required: true, max_length: 40 }, { name: "question", label: "پرسش دربارهٔ فیش", type: "text", max_length: 1000 }] },
  { code: "hr_certificate", dept: "hr", name: "گواهی اشتغال به کار", category: "گواهی‌ها", case_table: "hr_case", case_category: "certificate", icon: "file-badge", keywords: ["گواهی", "اشتغال", "نامه", "معرفی‌نامه", "کسر از حقوق"], title: "گواهی اشتغال برای {{addressee}}",
    description: "گواهی اشتغال به کار یا معرفی‌نامه برای بانک، سفارت یا هر سازمان دیگر.",
    vars: [{ name: "addressee", label: "خطاب به", type: "string", required: true, max_length: 160 }, { name: "with_salary", label: "مبلغ حقوق در گواهی بیاید", type: "bool", default_value: "false" }, { name: "language", label: "زبان", type: "radio", choices: [["fa", "فارسی"], ["en", "انگلیسی"]], default_value: "fa" }] },
  { code: "hr_loan", dept: "hr", name: "وام و مساعده", category: "حقوق و دستمزد", case_table: "hr_case", case_category: "loan", group: "payroll", icon: "hand-coins", sensitive: true, keywords: ["وام", "مساعده", "قرض", "قسط"], title: "درخواست {{loan_type}}",
    description: "درخواست وام قرض‌الحسنه یا مساعدهٔ حقوق با مبلغ و تعداد اقساط.",
    vars: [{ name: "loan_type", label: "نوع", type: "radio", required: true, choices: [["advance", "مساعده"], ["loan", "وام"]], default_value: "advance" }, { name: "amount", label: "مبلغ (ریال)", type: "money", required: true }, { name: "installments", label: "تعداد اقساط", type: "int" }] },
  { code: "hr_complaint", dept: "hr", name: "شکایت و رسیدگی محرمانه", category: "روابط کار", case_table: "hr_case", case_category: "employee_relations", group: "er", icon: "shield-alert", sensitive: true, confidential: true, subject_visible: false, on_behalf: "self", priority: "2", keywords: ["شکایت", "آزار", "تبعیض", "رفتار", "محرمانه"], title: "گزارش محرمانه",
    description: "گزارش رفتار نامناسب، آزار یا تبعیض. فقط گروه محدود روابط کار آن را می‌بیند.",
    vars: [{ name: "details", label: "شرح رویداد", type: "text", required: true, max_length: 5000 }, { name: "when", label: "زمان رویداد", type: "date" }] },
  // facilities
  { code: "fac_maintenance", dept: "facilities", name: "تعمیر و نگهداری", category: "تأسیسات", case_table: "facility_request", case_category: "maintenance", icon: "wrench", keywords: ["خرابی", "تعمیر", "برق", "آب", "سرمایش", "گرمایش", "کولر", "آسانسور"], title: "تعمیر: {{what}}",
    description: "خرابی برق، لوله‌کشی، سرمایش و گرمایش، در و پنجره یا آسانسور.",
    vars: [{ name: "what", label: "چه چیزی خراب است", type: "string", required: true, max_length: 160 }, { name: "location", label: "مکان (ساختمان، طبقه، اتاق)", type: "location", map_to: "location_id" }, { name: "details", label: "توضیح", type: "text", max_length: 2000 }] },
  { code: "fac_cleaning", dept: "facilities", name: "نظافت", category: "خدمات عمومی", case_table: "facility_request", case_category: "services", icon: "sparkles", keywords: ["نظافت", "تمیز", "زباله"], title: "نظافت: {{where}}",
    description: "نظافت اتاق، سالن یا پس از جلسه.", vars: [{ name: "where", label: "کجا", type: "string", required: true, max_length: 160 }] },
  { code: "fac_room_setup", dept: "facilities", name: "چیدمان و پذیرایی جلسه", category: "خدمات عمومی", case_table: "facility_request", case_category: "services", icon: "presentation", keywords: ["چیدمان", "پذیرایی", "جلسه", "همایش"], title: "چیدمان و پذیرایی: {{event}}",
    description: "چیدمان اتاق، پذیرایی و صوت و تصویر برای جلسه یا همایش.", vars: [{ name: "event", label: "جلسه", type: "string", required: true, max_length: 160 }, { name: "when", label: "زمان", type: "datetime", required: true, map_to: "preferred_at" }, { name: "people", label: "تعداد نفرات", type: "int" }] },
  { code: "fac_access_card", dept: "facilities", name: "کارت تردد", category: "تردد", case_table: "facility_request", case_category: "access", group: "reception", icon: "id-card", keywords: ["کارت", "تردد", "ورود", "گیت"], title: "کارت تردد",
    description: "صدور، تعویض یا گم‌شدن کارت تردد.", vars: [{ name: "reason", label: "دلیل", type: "radio", required: true, choices: [["new", "صدور"], ["lost", "گم‌شدن"], ["damaged", "خرابی"]], default_value: "new" }] },
  { code: "fac_parking", dept: "facilities", name: "جای پارک", category: "تردد", case_table: "facility_request", case_category: "access", group: "reception", icon: "car", keywords: ["پارکینگ", "پارک", "خودرو"], title: "جای پارک برای {{plate}}",
    description: "اختصاص جای پارک دائم یا موقت.", vars: [{ name: "plate", label: "شمارهٔ پلاک", type: "string", required: true, max_length: 30 }] },
  { code: "fac_desk", dept: "facilities", name: "میز و فضای کار", category: "فضا", case_table: "facility_request", case_category: "space", icon: "armchair", keywords: ["میز", "صندلی", "جابه‌جایی", "اتاق"], title: "میز و فضای کار",
    description: "آماده‌سازی میز کار، جابه‌جایی یا اثاث.", vars: [{ name: "details", label: "چه لازم است", type: "text", required: true, max_length: 1000 }] },
  { code: "proc_purchase", dept: "facilities", name: "درخواست خرید", category: "تدارکات", case_table: "purchase_request", case_category: "goods", group: "procurement", icon: "shopping-cart", on_behalf: "manager", keywords: ["خرید", "تدارکات", "کالا", "سفارش"], title: "خرید: {{items_title}}",
    description: "خرید کالا یا خدمت با تأیید بر پایهٔ سقف اختیارات (مبلغ).",
    vars: [{ name: "items_title", label: "عنوان خرید", type: "string", required: true, max_length: 160 }, { name: "items", label: "اقلام و مشخصات", type: "text", required: true, map_to: "items", max_length: 5000 }, { name: "amount", label: "مبلغ برآوردی (ریال)", type: "money", required: true, map_to: "amount" }, { name: "needed_by", label: "نیاز تا", type: "date", map_to: "needed_by" }, { name: "receiver", label: "تحویل‌گیرنده", type: "user", map_to: "receiver_id" }] },
  // finance
  { code: "fin_payment", dept: "finance", name: "پیگیری پرداخت", category: "پرداخت‌ها", case_table: "finance_case", case_category: "payments", icon: "banknote", keywords: ["پرداخت", "صورتحساب", "فاکتور", "واریز"], title: "پیگیری پرداخت صورتحساب {{invoice}}",
    description: "وضعیت پرداخت صورتحساب تأمین‌کننده یا پیمانکار.", vars: [{ name: "invoice", label: "شمارهٔ صورتحساب", type: "string", required: true, max_length: 60, map_to: "invoice_no" }, { name: "vendor", label: "تأمین‌کننده", type: "string", max_length: 160, map_to: "vendor_name" }] },
  { code: "fin_expense", dept: "finance", name: "هزینه و بازپرداخت", category: "هزینه‌ها", case_table: "finance_case", case_category: "expenses", icon: "receipt-text", keywords: ["هزینه", "بازپرداخت", "تنخواه", "رسید"], title: "بازپرداخت هزینهٔ {{what}}",
    description: "بازپرداخت هزینه‌های کاری با رسید؛ بالای سقف، تأیید مدیر و مالی لازم است.", vars: [{ name: "what", label: "هزینهٔ چه", type: "string", required: true, max_length: 160 }, { name: "amount", label: "مبلغ (ریال)", type: "money", required: true, map_to: "amount" }] },
  { code: "fin_vendor", dept: "finance", name: "تعریف تأمین‌کننده", category: "تأمین‌کنندگان", case_table: "finance_case", case_category: "vendors", icon: "building", keywords: ["تأمین‌کننده", "پیمانکار", "فروشنده"], title: "تعریف تأمین‌کننده: {{vendor}}",
    description: "افزودن تأمین‌کنندهٔ تازه به فهرست پرداخت.", vars: [{ name: "vendor", label: "نام تأمین‌کننده", type: "string", required: true, max_length: 160, map_to: "vendor_name" }] },
  // legal
  { code: "legal_contract", dept: "legal", name: "بررسی قرارداد", category: "قراردادها", case_table: "legal_request", case_category: "contracts", icon: "file-signature", keywords: ["قرارداد", "تفاهم‌نامه", "بند", "حقوقی"], title: "بررسی قرارداد با {{counterparty}}",
    description: "بررسی حقوقی پیش‌نویس قرارداد پیش از امضا.", vars: [{ name: "counterparty", label: "طرف قرارداد", type: "string", required: true, max_length: 160, map_to: "counterparty" }, { name: "deadline", label: "مهلت", type: "date", map_to: "deadline" }] },
  { code: "legal_advice", dept: "legal", name: "مشاورهٔ حقوقی", category: "مشاوره", case_table: "legal_request", case_category: "advice", icon: "messages-square", keywords: ["مشاوره", "حقوقی", "قانون", "دعوا"], title: "مشاورهٔ حقوقی",
    description: "پرسش حقوقی دربارهٔ کار سازمان.", vars: [{ name: "question", label: "پرسش", type: "text", required: true, max_length: 5000 }] },
  // journeys
  { code: "hr_onboarding", dept: "hr", name: "ورود کارمند جدید", category: "سفر کارکنان", case_table: "hr_case", case_category: "onboarding", icon: "user-plus", on_behalf: "manager", keywords: ["ورود", "استخدام", "کارمند جدید", "روز نخست"], title: "ورود کارمند جدید", journey: "onboarding_standard",
    description: "مدیر یا منابع انسانی ورود کارمند تازه را آغاز می‌کند: قرارداد، مدارک، لپ‌تاپ، حساب کاربری و میز، با پیگیری آمادگی روز نخست.", vars: [] },
  { code: "hr_offboarding", dept: "hr", name: "خروج کارمند", category: "سفر کارکنان", case_table: "hr_case", case_category: "offboarding", icon: "user-minus", on_behalf: "manager", keywords: ["خروج", "استعفا", "تسویه", "پایان همکاری"], title: "خروج کارمند", journey: "offboarding_standard",
    description: "تحویل کار و دانش، بازپس‌گیری دارایی‌ها، قطع دسترسی‌ها و تسویه حساب نسبت به آخرین روز کاری.", vars: [] },
];

interface ActSeed { code: string; name: string; phase: string; kind: string; assignee: string; start_offset: number | null; duration_days: number; after?: string[]; day_one?: boolean; catalog_item_code?: string; order_answers?: Row; case_table?: string; case_dept?: string; instructions: string; condition?: Cond }
const ONBOARDING: ActSeed[] = [
  { code: "contract", name: "تنظیم قرارداد و پروندهٔ استخدامی", phase: "pre_start", kind: "task", assignee: "hr", start_offset: -6, duration_days: 2, day_one: true, instructions: "قرارداد را تنظیم و پروندهٔ استخدامی را در سامانهٔ منابع انسانی باز کنید." },
  { code: "documents", name: "بارگذاری مدارک استخدامی", phase: "pre_start", kind: "upload", assignee: "subject", start_offset: -6, duration_days: 3, day_one: true, instructions: "تصویر کارت ملی، شناسنامه، آخرین مدرک تحصیلی و عکس پرسنلی را پیوست کنید." },
  { code: "policies", name: "امضای تعهدنامهٔ محرمانگی و آیین‌نامه‌ها", phase: "pre_start", kind: "sign", assignee: "subject", start_offset: -3, duration_days: 2, after: ["documents"], day_one: true, instructions: "آیین‌نامهٔ انضباطی، تعهدنامهٔ محرمانگی و سیاست استفادهٔ مجاز از فناوری را بخوانید و امضا کنید." },
  { code: "laptop", name: "لپ‌تاپ کارمند", phase: "pre_start", kind: "order", assignee: "hr", start_offset: -6, duration_days: 4, day_one: true, catalog_item_code: "new_laptop", order_answers: { model: "standard", ram: "16", os: "windows", reason: "کارمند جدید" }, instructions: "لپ‌تاپ از کاتالوگ فناوری اطلاعات برای کارمند سفارش داده می‌شود." },
  { code: "account", name: "حساب کاربری و صندوق پست", phase: "pre_start", kind: "order", assignee: "hr", start_offset: -4, duration_days: 2, day_one: true, catalog_item_code: "mailbox", order_answers: { mailbox_type: "personal" }, instructions: "صندوق پست و حساب کاربری از کاتالوگ فناوری اطلاعات سفارش داده می‌شود." },
  { code: "desk", name: "آماده‌سازی میز و کارت تردد", phase: "pre_start", kind: "case", assignee: "hr", start_offset: -5, duration_days: 3, day_one: true, case_table: "facility_request", case_dept: "facilities", instructions: "میز، صندلی، تلفن رومیزی و کارت تردد کارمند تازه را پیش از روز نخست آماده کنید." },
  { code: "welcome", name: "خوشامدگویی و معرفی به تیم", phase: "day_one", kind: "task", assignee: "manager", start_offset: 0, duration_days: 0, instructions: "کارمند را به تیم معرفی کنید و برنامهٔ هفتهٔ نخست را با او مرور کنید." },
  { code: "buddy", name: "تعیین همراه برای کارمند", phase: "first_week", kind: "task", assignee: "manager", start_offset: 0, duration_days: 2, instructions: "یکی از همکاران را همراه (بادی) کارمند تازه کنید." },
  { code: "orientation", name: "دورهٔ آشنایی با سازمان", phase: "first_week", kind: "learning", assignee: "subject", start_offset: 1, duration_days: 4, instructions: "دورهٔ آشنایی با سازمان، ایمنی و امنیت اطلاعات را بگذرانید." },
  { code: "probation", name: "تأیید ارزیابی ماه نخست", phase: "first_month", kind: "approval", assignee: "manager", start_offset: 20, duration_days: 3, after: ["orientation"], instructions: "پایان ماه نخست: کار کارمند تازه را ارزیابی و تأیید کنید." },
  { code: "survey", name: "نظرسنجی تجربهٔ ورود", phase: "first_month", kind: "survey", assignee: "subject", start_offset: 21, duration_days: 3, instructions: "تجربهٔ ورودتان به سازمان چطور بود؟ پیشنهادهای خود را بنویسید." },
];
const OFFBOARDING: ActSeed[] = [
  { code: "handover", name: "تحویل کارها و دانش", phase: "before_end", kind: "task", assignee: "manager", start_offset: -10, duration_days: 8, instructions: "کارهای باز، دسترسی‌ها و دانش کارمند را به جانشین تحویل دهید و در پایگاه دانش ثبت کنید." },
  { code: "exit_interview", name: "مصاحبهٔ خروج", phase: "before_end", kind: "task", assignee: "hr", start_offset: -5, duration_days: 3, instructions: "مصاحبهٔ خروج را انجام دهید و نتیجه را ثبت کنید." },
  { code: "assets", name: "بازپس‌گیری دارایی‌ها", phase: "last_day", kind: "task", assignee: "hr", start_offset: -1, duration_days: 1, instructions: "لپ‌تاپ، گوشی، کارت تردد و کلیدها را تحویل بگیرید و در صورت‌جلسه ثبت کنید." },
  { code: "access", name: "هماهنگی قطع دسترسی‌ها", phase: "last_day", kind: "task", assignee: "hr", start_offset: 0, duration_days: 0, instructions: "در پایان آخرین روز کاری، قطع حساب‌ها و دسترسی‌ها را با فناوری اطلاعات هماهنگ کنید." },
  { code: "confidentiality", name: "یادآوری تعهد محرمانگی پس از همکاری", phase: "last_day", kind: "acknowledge", assignee: "subject", start_offset: -1, duration_days: 1, instructions: "تعهد محرمانگی پس از پایان همکاری هم برقرار است." },
  { code: "final_pay", name: "تسویه حساب و آخرین حقوق", phase: "after", kind: "task", assignee: "hr", start_offset: 1, duration_days: 10, after: ["assets"], instructions: "تسویه حساب، آخرین حقوق و گواهی پایان کار را آماده کنید." },
  { code: "exit_survey", name: "نظرسنجی خروج", phase: "last_day", kind: "survey", assignee: "subject", start_offset: -2, duration_days: 2, instructions: "پیش از رفتن، تجربهٔ کار خود را با ما در میان بگذارید." },
];

const ch = (xs: [string, string][]) => xs.map(([value, label]) => ({ value, label }));

async function officeCalendar(tx: Tx, sys: Ctx, out: SeedCounts): Promise<{ office: string | null; always: string | null }> {
  let rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!rows.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  const active = rows.filter((r) => r.active !== false);
  const office = active.find((r) => r.is_default) ?? active[0] ?? null;
  const full = JSON.stringify(FULL_HOURS);
  let always = active.find((r) => r.name === "شبانه‌روزی") ?? active.find((r) => JSON.stringify(r.hours) === full) ?? null;
  if (!always) always = await createIn(tx, sys, "calendar", { name: "شبانه‌روزی", timezone: orgTz(sys), hours: FULL_HOURS, holiday_sets: [], description: "همهٔ ساعت‌های همهٔ روزها" }, { trusted: true });
  return { office: (office?.id as string) ?? null, always: (always?.id as string) ?? null };
}

const prio = (v: string[]): Cond => ({ f: "priority", op: "in", v });
const DONE: Cond = { f: "state", op: "in", v: ["resolved", "closed_complete", "closed_incomplete"] };
const CANCELLED: Cond = { f: "state", op: "eq", v: "cancelled" };
const WAITING: Cond = { f: "state", op: "in", v: ["awaiting_info", "awaiting_third_party", "suspended"] };

function slaDefinitions(table: string, label: string, ws: string | null, cal: string | null, response: Record<string, number>, resolution: Record<string, number>): Row[] {
  const common = { table_key: table, type: "sla", duration_mode: "priority", priority_field: "priority", calendar_id: cal, workspace_id: ws, retroactive: true, retroactive_field: "opened_at", warn_percents: [50, 75, 90], active: true };
  return [
    { ...common, name: `پاسخ ${label}`, target: "response", sort_order: 10, durations: response, start_condition: { f: "state", op: "eq", v: "new" }, stop_condition: { or: [{ f: "state", op: "ne", v: "new" }, { f: "first_response_at", op: "nempty" }] }, cancel_condition: CANCELLED, description: `نخستین پاسخ ${label} در ساعات اداری` },
    { ...common, name: `انجام ${label}`, target: "resolution", sort_order: 20, durations: resolution, start_condition: null, pause_condition: { f: "state", op: "eq", v: "awaiting_info" }, stop_condition: DONE, cancel_condition: CANCELLED, breach_actions: [{ type: "notify", fields: ["assigned_to"] }], description: `رسیدگی کامل ${label}؛ «منتظر اطلاعات» زمان را نگه می‌دارد` },
  ];
}

export function approvalRules(groups: Record<string, string>): Row[] {
  const manager = { name: "مدیر مستقیم", sources: [{ kind: "manager" }], rule: "any" };
  const finance = { name: "خدمات مالی", sources: [{ kind: "groups", groups: [groups.finance] }], rule: "any" };
  const finance2 = { name: "خدمات مالی (دو امضا)", sources: [{ kind: "groups", groups: [groups.finance] }], rule: "count", threshold: 2 };
  const amount = (op: "lt" | "gte", v: number): Cond => ({ f: "amount", op, v: String(v) });
  const base = { table_key: "purchase_request", mode: "sequential", remind_every: 24 * H, expire_after: 7 * 24 * H, expire_action: "reject", active: true, allow_self_approval: false };
  return [
    { ...base, name: "خرید تا ۵۰ میلیون ریال ← مدیر", sort_order: 10, condition: amount("lt", 50_000_000), levels: [manager], description: "سقف اختیارات ۱: مدیر مستقیم" },
    { ...base, name: "خرید ۵۰ تا ۵۰۰ میلیون ریال ← مدیر و مالی", sort_order: 20, condition: { and: [amount("gte", 50_000_000), amount("lt", 500_000_000)] }, levels: [manager, finance], description: "سقف اختیارات ۲: مدیر مستقیم، سپس یکی از خدمات مالی" },
    { ...base, name: "خرید بالای ۵۰۰ میلیون ریال ← مدیر و دو امضای مالی", sort_order: 30, condition: amount("gte", 500_000_000), levels: [manager, finance2], description: "سقف اختیارات ۳: مدیر مستقیم، سپس دو نفر از خدمات مالی" },
    { ...base, table_key: "finance_case", name: "هزینه و بازپرداخت ← مدیر", sort_order: 10, condition: { and: [{ f: "case_kind", op: "eq", v: "expense_claim" }, amount("lt", 100_000_000)] }, levels: [manager], description: "بازپرداخت هزینه با تأیید مدیر مستقیم" },
    { ...base, table_key: "finance_case", name: "هزینه و بازپرداخت بالای ۱۰۰ میلیون ریال ← مدیر و مالی", sort_order: 20, condition: { and: [{ f: "case_kind", op: "eq", v: "expense_claim" }, amount("gte", 100_000_000)] }, levels: [manager, finance], description: "بازپرداخت بالای سقف: مدیر، سپس خدمات مالی" },
  ];
}

export function notificationRules(): Row[] {
  return [
    { table_key: "visit", name: "میهمان شما رسید", event: "custom", custom_event: "visit_arrived", recipients: { event_users: true }, channels: ["in_app", "email", "sms"] },
    { table_key: "reservation", name: "رزرو شما از فهرست انتظار قطعی شد", event: "custom", custom_event: "reservation_promoted", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "reservation", name: "رزرو شما آزاد شد (حاضر نشدید)", event: "state_changed", condition: { f: "state", op: "changes_to", v: "no_show" }, recipients: { requester: true }, channels: ["in_app"] },
    { table_key: "journey", name: "سفر کارمند تکمیل شد", event: "state_changed", condition: { f: "state", op: "changes_to", v: "completed" }, recipients: { fields: ["manager_id", "hr_owner_id"] }, channels: ["in_app", "email"] },
    { table_key: "hr_task", name: "کار تازه در سفر ورود یا خروج", event: "created", condition: { f: "journey_id", op: "nempty" }, recipients: { fields: ["assigned_to"] }, channels: ["in_app", "email"] },
    { table_key: "purchase_request", name: "خرید تأییدشده آمادهٔ سفارش", event: "updated", condition: { f: "approval", op: "changes_to", v: "approved" }, recipients: { assignment_group: true }, channels: ["in_app"] },
  ].map((r) => ({ active: true, notify_actor: false, digest: false, mandatory: false, ...r }));
}

/** A published flow: when an offboarding journey completes, the manager is reminded to confirm access was removed. */
async function seedFlow(tx: Tx, sys: Ctx, out: SeedCounts): Promise<void> {
  const name = "پایان سفر خروج: یادآوری بستن دسترسی‌ها";
  const [found] = await liveRows(tx, sys, "flow", eqAll({ name }), { limit: 1 });
  if (found) return;
  const graph = {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      {
        id: "n1", type: "notify", label: "یادآوری به مدیر", position: { x: 0, y: 140 },
        config: { to: { fields: ["manager_id", "hr_owner_id"] }, subject: "سفر خروج {{trigger.record.number}} پایان یافت", body: "همهٔ فعالیت‌های خروج انجام شد. لطفاً بسته‌شدن همهٔ دسترسی‌ها و تحویل دارایی‌ها را تأیید کنید." },
      },
    ],
    edges: [{ id: "trigger-out-n1", source: "trigger", target: "n1" }],
    layout: { direction: "TB" },
  };
  const flow = await createIn(tx, sys, "flow", {
    name, active: false, description: "نمونهٔ گردش‌کار خدمات سازمانی: پس از تکمیل سفر خروج، مدیر و منابع انسانی یادآوری می‌گیرند",
    trigger: "record", trigger_table: "journey", trigger_events: ["state_changed"],
    trigger_condition: { and: [{ f: "state", op: "eq", v: "completed" }, { f: "type", op: "eq", v: "offboarding" }] }, run_as: "system", graph,
  }, { trusted: true });
  const version = await createIn(tx, sys, "flow_version", { flow_id: flow.id, version_no: 1, title: `${name} — نسخهٔ ۱`, note: "نسخهٔ نخست", trigger: triggerOf(flow), graph }, { trusted: true });
  await updateIn(tx, sys, "flow", String(flow.id), { version_id: version.id, version_no: 1, published_at: new Date().toISOString(), dirty: false, active: true }, { trusted: true });
  out.created.flow = (out.created.flow ?? 0) + 1;
}

/** Department KPIs for the analytics module (when it is installed): read as each viewer, so HR's figures stay HR's. */
function indicators(): Row[] {
  const roles = ["esm_admin", "hr_agent", "tenant_admin"];
  const shares = roles.map((id) => ({ kind: "role", id, right: "view" }));
  return [
    {
      key: "esm.day_one_readiness", name: "آمادگی روز نخست", practice: "other", unit: "percent", direction: "up", grain: "month", target: "95", warn: "85", crit: "70",
      description: "سهم کارکنان تازه‌ای که همهٔ کارهای لازم روز نخستشان پیش از تاریخ شروع انجام شد.",
      formula: "ready / hires * 100",
      parts: [
        { name: "ready", table: "journey", fn: "count", date_field: "anchor_date", filter: { and: [{ f: "type", op: "eq", v: "onboarding" }, { f: "day_one_ready", op: "eq", v: true }] } },
        { name: "hires", table: "journey", fn: "count", date_field: "anchor_date", filter: { f: "type", op: "eq", v: "onboarding" } },
      ],
      breakdowns: ["location_id"], score_shares: shares,
    },
    {
      key: "esm.journey_cycle_time", name: "مدت سفر کارکنان", practice: "other", unit: "duration", direction: "down", grain: "month",
      description: "میانگین زمان از آغاز تا پایان سفرهای کارکنان (ورود، خروج، جابه‌جایی) که در دوره پایان یافتند.",
      formula: "cycle", parts: [{ name: "cycle", table: "journey", fn: "avg", field: "cycle_time", date_field: "completed_at", filter: { f: "state", op: "eq", v: "completed" } }],
      breakdowns: ["type"], score_shares: shares,
    },
    {
      key: "esm.reservation_no_show", name: "رزروهای بی‌حضور", practice: "other", unit: "percent", direction: "down", grain: "month", target: "5", warn: "10", crit: "20",
      description: "سهم رزروهایی که کسی برای آن‌ها حاضر نشد و آزاد شدند.",
      formula: "no_show / booked * 100",
      parts: [
        { name: "no_show", table: "reservation", fn: "count", date_field: "start_at", filter: { f: "state", op: "eq", v: "no_show" } },
        { name: "booked", table: "reservation", fn: "count", date_field: "start_at", filter: { f: "state", op: "in", v: ["checked_in", "completed", "no_show", "released"] } },
      ],
      breakdowns: ["space_id"], score_shares: [{ kind: "role", id: "facilities_agent", right: "view" }, ...shares],
    },
    {
      key: "esm.hr_backlog", name: "پرونده‌های باز منابع انسانی", practice: "other", unit: "count", direction: "down", grain: "day",
      description: "پرونده‌های منابع انسانی که هنوز باز است (فقط کسانی که پرونده‌ها را می‌بینند عدد را می‌بینند).",
      formula: "open", parts: [{ name: "open", table: "hr_case", fn: "count", filter: { f: "active", op: "eq", v: true } }],
      // HR's secure cases: stored counts only for HR (never the IT or tenant administrator; live values follow each viewer's access)
      breakdowns: ["coe", "assignment_group_id"], score_shares: [{ kind: "role", id: "hr_agent", right: "view" }],
    },
  ].map((k) => ({ active: true, collect: true, certified: false, decimals: null, ...k, library_key: k.key }));
}

export async function seedEsmDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "esm_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= ESM_SEED_VERSION && !opts.force) return { ...out, skipped: true };
  const config = cfg ?? (await ensure(tx, sys, out, "esm_config", { config_key: "default" }, { name: "تنظیمات خدمات سازمانی" }));
  for (const r of ESM_ROLES) await ensure(tx, sys, out, "role", { key: r.key }, r);
  const cals = await officeCalendar(tx, sys, out);

  const ws: Record<string, string> = {};
  for (const w of WORKSPACES) ws[w.key] = String((await ensure(tx, sys, out, "workspace", { key: w.key }, { name: w.name, secure: w.secure, icon: w.icon, color: w.color, description: w.description, active: true, is_default: false })).id);
  const groups: Record<string, string> = {};
  for (const g of GROUPS) groups[g.key] = String((await ensure(tx, sys, out, "group", { name: g.name }, { types: ["assignment"], workspace_id: ws[g.ws], roles: g.roles, restricted: !!g.restricted, description: g.description, active: true })).id);

  // one catalogue per department (the employees' portal browses them through their audiences)
  const depts: Record<string, Row> = {};
  for (const d of DEPARTMENTS) {
    const catalog = await ensure(tx, sys, out, "catalog", { name: `خدمات ${d.name}` }, { description: d.intro, icon: d.icon, color: d.color, sort_order: 100 + d.order, workspace_id: ws[d.ws] });
    depts[d.key] = await ensure(tx, sys, out, "esm_department", { key: d.key }, {
      name: d.name, kind: d.kind, status: "live", dept_workspace_id: ws[d.ws], case_table: d.table, default_group_id: groups[d.group], calendar_id: cals.office,
      catalog_id: catalog.id, sensitive: !!d.sensitive, portal_visible: true, portal_order: d.order, icon: d.icon, color: d.color, intro: d.intro, pack_key: `ir_${d.kind}`, pack_version: ESM_SEED_VERSION,
    });
  }

  for (const c of CATEGORIES) {
    for (const [i, [value, name, group]] of c.items.entries()) {
      await ensure(tx, sys, out, "category", { table_key: c.table, value }, { name, sort_order: (i + 1) * 10, workspace_id: ws[c.ws], default_group_id: group ? groups[group] : null, active: true });
    }
  }

  // knowledge bases of the departments (HR's for everyone, written by the department's group)
  if (tableDef("kb_base")) {
    for (const d of DEPARTMENTS) {
      const base = await ensure(tx, sys, out, "kb_base", { name: `راهنمای ${d.name}` }, {
        kind: "external", description: `پرسش‌های پرتکرار و راهنماهای ${d.name}`, icon: d.icon, color: d.color, sort_order: 100 + d.order,
        manager_group_id: groups[d.group], read_mode: "everyone", contrib_mode: "named", contrib_groups: [groups[d.group]], classification: "internal",
      });
      if (!depts[d.key].kb_base_id) depts[d.key] = await updateIn(tx, sys, "esm_department", String(depts[d.key].id), { kb_base_id: base.id }, { trusted: true });
    }
  }

  // journey templates (ESM-012…014)
  const templates: Record<string, Row> = {};
  for (const [code, name, type, acts, anchor] of [
    ["onboarding_standard", "ورود کارمند جدید", "onboarding", ONBOARDING, "تاریخ شروع به کار"],
    ["offboarding_standard", "خروج کارمند", "offboarding", OFFBOARDING, "آخرین روز کاری"],
  ] as const) {
    const t = await ensure(tx, sys, out, "journey_template", { code }, { name, type, department_id: depts.hr.id, owner_group_id: groups.hr_desk, anchor_label: anchor, calendar_id: cals.office, active: true, description: `الگوی آمادهٔ «${name}» برای سازمان‌های ایرانی؛ هر فعالیت در واحد مسئول خود ساخته می‌شود.` });
    templates[code] = t;
    for (const [i, a] of acts.entries()) {
      await ensure(tx, sys, out, "journey_template_activity", { template_id: t.id, code: a.code }, {
        name: a.name, phase: a.phase, kind: a.kind, assignee: a.assignee, start_offset: a.start_offset, duration_days: a.duration_days, after: a.after ?? [], day_one: !!a.day_one,
        catalog_item_code: a.catalog_item_code ?? null, order_answers: a.order_answers ?? null, case_table: a.case_table ?? null, case_department_id: a.case_dept ? depts[a.case_dept].id : null,
        instructions: a.instructions, condition: a.condition ?? null, sort_order: (i + 1) * 10, active: true,
      });
    }
  }

  // services and their record producers in the department catalogues (ESM-006, ESM-025)
  for (const [i, s] of SERVICES.entries()) {
    const dept = depts[s.dept];
    const service = await ensure(tx, sys, out, "esm_service", { code: s.code }, {
      name: s.name, department_id: dept.id, category: s.category, case_table: s.case_table, case_category: s.case_category ?? null, group_id: s.group ? groups[s.group] : null,
      priority: s.priority ?? null, journey_template_id: s.journey ? templates[s.journey]?.id ?? null : null, on_behalf: s.on_behalf ?? "manager", confidential: !!s.confidential, sensitive: !!s.sensitive,
      subject_visible: s.subject_visible !== false, keywords: s.keywords, icon: s.icon, sort_order: (i + 1) * 10, active: true, description: s.description,
    });
    if (s.journey || !dept.catalog_id || service.catalog_item_id) continue;
    const catCategory = await ensure(tx, sys, out, "catalog_category", { catalog_id: dept.catalog_id, name: s.category }, { sort_order: (i + 1) * 10 });
    const [existing] = await liveRows(tx, sys, "catalog_item", eqAll({ code: `esm_${s.code}` }), { limit: 1 });
    let item = existing;
    if (!item) {
      item = await createIn(tx, sys, "catalog_item", {
        code: `esm_${s.code}`, name: s.name, type: "record_producer", catalog_id: dept.catalog_id, category_id: catCategory.id, short_description: s.description.slice(0, 300), description: s.description, icon: s.icon,
        sort_order: (i + 1) * 10, target_table: s.case_table, field_map: { dept_service_id: String(service.id), short_description: s.title }, requires_confirmation: false, cart_allowed: false, review_interval_days: 365,
      }, { trusted: true });
      out.created.catalog_item = (out.created.catalog_item ?? 0) + 1;
      for (const [j, v] of s.vars.entries()) {
        await createIn(tx, sys, "catalog_variable", {
          item_id: item.id, name: v.name, label: v.label, type: v.type, sort_order: (j + 1) * 10, required: !!v.required, choices: v.choices ? ch(v.choices) : null,
          default_value: v.default_value ?? null, help: v.help ?? null, width: "full", field_class: "public", map_to: v.map_to ?? null, max_length: v.max_length ?? null,
        }, { trusted: true });
      }
      const fresh = (await liveRow(tx, sys, "catalog_item", item.id)) ?? item;
      await snapshotIn(tx, sys, fresh, await draftSchema(tx, sys, fresh), "نسخهٔ نخست");
    }
    await updateIn(tx, sys, "esm_service", String(service.id), { catalog_item_id: item.id }, { trusted: true });
  }

  // agreements per department (ESM-008), the OLA of journey work and the contractors' UC
  for (const [table, label, wsKey, response, resolution] of [
    ["hr_case", "پروندهٔ منابع انسانی", "hr", { "1": 2 * H, "2": 4 * H, "3": DAY, "4": DAY, "5": 2 * DAY }, { "1": DAY, "2": 2 * DAY, "3": 3 * DAY, "4": 5 * DAY, "5": 10 * DAY }],
    ["facility_request", "درخواست پشتیبانی", "facilities", { "1": H, "2": 2 * H, "3": 4 * H, "4": DAY, "5": DAY }, { "1": 4 * H, "2": DAY, "3": 2 * DAY, "4": 3 * DAY, "5": 5 * DAY }],
    ["finance_case", "پروندهٔ مالی", "finance", { "1": 4 * H, "2": DAY, "3": DAY, "4": 2 * DAY, "5": 2 * DAY }, { "1": 2 * DAY, "2": 3 * DAY, "3": 5 * DAY, "4": 7 * DAY, "5": 10 * DAY }],
    ["legal_request", "درخواست حقوقی", "legal", { "1": 4 * H, "2": DAY, "3": 2 * DAY, "4": 2 * DAY, "5": 3 * DAY }, { "1": 3 * DAY, "2": 5 * DAY, "3": 10 * DAY, "4": 15 * DAY, "5": 20 * DAY }],
    ["purchase_request", "درخواست خرید", "facilities", { "1": DAY, "2": DAY, "3": 2 * DAY, "4": 2 * DAY, "5": 3 * DAY }, { "1": 5 * DAY, "2": 7 * DAY, "3": 10 * DAY, "4": 15 * DAY, "5": 20 * DAY }],
  ] as const) {
    for (const d of slaDefinitions(table, label, ws[wsKey], cals.office, response, resolution)) await ensure(tx, sys, out, "sla_definition", { table_key: table, name: d.name }, d);
  }
  await ensure(tx, sys, out, "sla_definition", { table_key: "facility_request", name: "OLA کارهای سفر کارکنان" }, {
    type: "ola", target: "resolution", duration_mode: "fixed", duration: 3 * DAY, calendar_id: cals.office, workspace_id: ws.facilities, active: true, sort_order: 30,
    start_condition: { f: "journey_id", op: "nempty" }, pause_condition: WAITING, stop_condition: DONE, cancel_condition: CANCELLED, warn_percents: [75],
    description: "کار واحد پشتیبانی برای سفر یک کارمند (میز، کارت تردد) در سه روز کاری",
  });
  await ensure(tx, sys, out, "sla_definition", { table_key: "facility_request", name: "UC پیمانکاران تأسیسات" }, {
    type: "uc", target: "resolution", duration_mode: "fixed", duration: 2 * DAY, calendar_id: cals.office, workspace_id: ws.facilities, active: true, sort_order: 40,
    start_condition: { f: "contractor", op: "nempty" }, stop_condition: DONE, cancel_condition: CANCELLED, warn_percents: [50, 90],
    description: "کار سپرده به پیمانکار تأسیسات در دو روز کاری (قرارداد پشتیبان)",
  });
  for (const r of approvalRules(groups)) await ensure(tx, sys, out, "approval_rule", { table_key: r.table_key, name: r.name }, r);
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);
  await ensure(tx, sys, out, "ui_policy", { table_key: "finance_case", name: "مبلغ برای هزینه، مساعده و وام" }, {
    condition: { f: "case_kind", op: "in", v: ["expense_claim", "advance", "loan"] }, actions: [{ field: "amount", mandatory: true }], sort_order: 100, applies_on: "both", active: true,
  });
  await seedFlow(tx, sys, out);
  if (tableDef("analytics_indicator")) for (const k of indicators()) await ensure(tx, sys, out, "analytics_indicator", { key: k.key }, k);

  await updateIn(tx, sys, "esm_config", String(config.id), { seeded: ESM_SEED_VERSION }, { trusted: true });
  return out;
}
