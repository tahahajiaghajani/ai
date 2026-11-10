// Day-one defaults of IT asset management for an organisation (Persian, idempotent — every item is created only when no
// live row with its natural key exists; once added, a second run adds nothing unless forced):
//   · the settings row (itam_config, `seeded`), depreciation rules, label templates (A4 sheets)
//   · manufacturers and publishers (supplier rows), asset models — laptops, desktops, monitors, phones, servers,
//     keyboards and toner — with CI classes, standard costs, warranty and useful life; hardware standards
//   · stockrooms (central, on-site, disposal) and stock rules with reorder points
//   · software models (Windows, Windows Server, Office, Microsoft 365, antivirus, Acrobat, SQL Server, AutoCAD, 7-Zip,
//     Chrome) with normalisation patterns and metrics, sample entitlements and a SaaS subscription
//   · catalogue items of the request module bound to models (new laptop, phone) when they exist
//   · the bank layer (version 2): bank device models (ATM, CRS, kiosk, POS, passbook printer, cheque scanner, signature
//     pad, HSM, NVR, UPS, branch network, storage) and their depreciation classes, the roles «مسئول اموال شعبه»,
//     «مدیر اموال منطقه» and «رئیس شعبه», the transfer approval and receipt SLA, the ATM maintenance group and the
//     notifications of transfers and attestations
//   · the procurement group and the «مدیر تدارکات» role, approval rules (requisitions, disposal), SLAs (a decision on a
//     requisition in two working days, repairs in ten), notification rules for the module's events, and an inactive
//     flow template for missing assets
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJalaliMonths } from "@shared/supplier/logic";
import { addDays, todayISO } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import { createIn, orgTz, updateIn } from "../../engine";
import { seedCalendarsIn } from "../sla";
import { triggerOf } from "../flows/service";
import { eqAll, liveRows, sysOf, type Row } from "./common";

export const ITAM_SEED_VERSION = 2;

export interface SeedCounts {
  skipped: boolean;
  created: Record<string, number>;
}

/** Create `values` in `table` unless a live row matches `key`; returns the existing or new row. */
export async function ensure(tx: Tx, sys: Ctx, out: SeedCounts, table: string, key: Record<string, unknown>, values: Row): Promise<Row> {
  const [found] = await liveRows(tx, sys, table, eqAll(key), { limit: 1 });
  if (found) return found;
  const row = await createIn(tx, sys, table, { ...key, ...values }, { trusted: true });
  out.created[table] = (out.created[table] ?? 0) + 1;
  return row;
}

/** The organisation's default (office) calendar, created with the SLA service's seed when missing. */
export async function officeCalendar(tx: Tx, sys: Ctx, out: SeedCounts): Promise<string | null> {
  let rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  if (!rows.length) {
    const r = await seedCalendarsIn(tx, sys, { years: [] });
    out.created.calendar = (out.created.calendar ?? 0) + r.calendars;
    rows = await liveRows(tx, sys, "calendar", null, { order: "t.created_at" });
  }
  return String((rows.find((r) => r.is_default && r.active !== false) ?? rows[0])?.id ?? "") || null;
}

const FULL = { read: "all", create: true, write: "all", delete: "all", approve: true, admin: false };
const READ = { read: "all", create: false, write: "none", delete: "none", approve: false, admin: false };

const DEPRECIATION = [
  { name: "رایانه و تلفن — ۳ سال خط مستقیم", method: "straight_line", life_months: 36, salvage_percent: "5" },
  { name: "سرور و تجهیز شبکه — ۵ سال خط مستقیم", method: "straight_line", life_months: 60, salvage_percent: "5" },
  { name: "نمایشگر و چاپگر — ۴ سال نزولی", method: "declining_balance", life_months: 48, salvage_percent: "10" },
  // bank device classes (the organisation's finance policy decides; these are starting points)
  { name: "خودپرداز، CRS و کیوسک — ۷ سال خط مستقیم", method: "straight_line", life_months: 84, salvage_percent: "5", start_convention: "next_month", device_classes: ["atm", "crs", "kiosk"] },
  { name: "پایانه و تجهیزات باجه — ۴ سال خط مستقیم", method: "straight_line", life_months: 48, salvage_percent: "0", start_convention: "next_month", device_classes: ["pos", "passbook_printer", "cheque_scanner", "signature_pad"] },
  { name: "امنیت و زیرساخت شعبه — ۵ سال نزولی", method: "declining_balance", life_months: 60, salvage_percent: "5", start_convention: "next_month", device_classes: ["hsm", "cctv", "ups", "network"] },
];

const MAKERS: [string, string[]][] = [
  ["Lenovo", ["manufacturer"]], ["HP", ["manufacturer"]], ["Dell", ["manufacturer"]], ["Samsung", ["manufacturer"]], ["Apple", ["manufacturer"]],
  ["Hewlett Packard Enterprise", ["manufacturer"]], ["LG", ["manufacturer"]], ["Logitech", ["manufacturer"]], ["Microsoft", ["publisher", "cloud"]],
  ["ESET", ["publisher"]], ["Adobe", ["publisher"]], ["Autodesk", ["publisher"]], ["Google", ["publisher"]], ["Igor Pavlov (7-Zip)", ["publisher"]],
  ["فن‌آوران نمونه (فروشندهٔ سخت‌افزار)", ["reseller", "maintenance"]],
  // bank devices
  ["NCR Atleos", ["manufacturer"]], ["Diebold Nixdorf", ["manufacturer"]], ["GRG Banking", ["manufacturer"]], ["Hyosung TNS", ["manufacturer"]], ["PAX Technology", ["manufacturer"]],
  ["Verifone", ["manufacturer"]], ["Thales", ["manufacturer"]], ["Olivetti", ["manufacturer"]], ["Panini", ["manufacturer"]], ["Wacom", ["manufacturer"]], ["Hikvision", ["manufacturer"]],
  ["APC by Schneider Electric", ["manufacturer"]], ["Cisco", ["manufacturer"]],
];

interface ModelSeed {
  name: string;
  maker: string;
  model_number: string;
  category: string;
  asset_class?: string;
  tracking?: "individual" | "quantity";
  ci_class?: string | null;
  unit_cost: string;
  warranty_months: number;
  useful_life_months: number;
  dep: number;
  data_bearing?: boolean;
  ack?: boolean;
  specs?: string;
}

const ACK_TERMS = "با تحویل این دارایی می‌پذیرم که:\n\n1. آن را فقط برای کارهای سازمان به کار ببرم.\n2. از آن و اطلاعات روی آن نگهداری کنم و گم شدن یا آسیب را فوراً گزارش دهم.\n3. نرم‌افزار غیرمجاز نصب نکنم و تنظیمات امنیتی را تغییر ندهم.\n4. هنگام جابه‌جایی یا خروج از سازمان، آن را سالم بازگردانم.";

const MODELS: ModelSeed[] = [
  { name: "لنوو ThinkPad E14 Gen 5", maker: "Lenovo", model_number: "21JK", category: "laptop", ci_class: "laptop", unit_cost: "650000000", warranty_months: 24, useful_life_months: 36, dep: 0, data_bearing: true, ack: true, specs: "Core i5، ۱۶ گیگابایت، SSD ۵۱۲" },
  { name: "اچ‌پی ProBook 450 G10", maker: "HP", model_number: "85B03EA", category: "laptop", ci_class: "laptop", unit_cost: "720000000", warranty_months: 12, useful_life_months: 36, dep: 0, data_bearing: true, ack: true, specs: "Core i7، ۱۶ گیگابایت، SSD ۵۱۲" },
  { name: "اچ‌پی ProDesk 400 G9", maker: "HP", model_number: "6U4P8EA", category: "desktop", ci_class: "desktop", unit_cost: "480000000", warranty_months: 12, useful_life_months: 48, dep: 0, data_bearing: true },
  { name: "دل OptiPlex 7010", maker: "Dell", model_number: "OPT7010", category: "desktop", ci_class: "desktop", unit_cost: "520000000", warranty_months: 36, useful_life_months: 48, dep: 0, data_bearing: true },
  { name: "سامسونگ ۲۴ اینچ S24C360", maker: "Samsung", model_number: "LS24C360", category: "monitor", ci_class: null, unit_cost: "95000000", warranty_months: 24, useful_life_months: 48, dep: 2 },
  { name: "ال‌جی ۲۷ اینچ 27MP400", maker: "LG", model_number: "27MP400-B", category: "monitor", ci_class: null, unit_cost: "120000000", warranty_months: 24, useful_life_months: 48, dep: 2 },
  { name: "سامسونگ Galaxy A54", maker: "Samsung", model_number: "SM-A546E", category: "phone", ci_class: "mobile_device", unit_cost: "220000000", warranty_months: 18, useful_life_months: 24, dep: 0, data_bearing: true, ack: true },
  { name: "اپل iPhone 15", maker: "Apple", model_number: "A3090", category: "phone", ci_class: "mobile_device", unit_cost: "650000000", warranty_months: 12, useful_life_months: 36, dep: 0, data_bearing: true, ack: true },
  { name: "اچ‌پی‌ای ProLiant DL380 Gen10", maker: "Hewlett Packard Enterprise", model_number: "868703-B21", category: "server", ci_class: "server", unit_cost: "4500000000", warranty_months: 36, useful_life_months: 60, dep: 1, data_bearing: true },
  { name: "دل PowerEdge R750", maker: "Dell", model_number: "R750", category: "server", ci_class: "server", unit_cost: "5200000000", warranty_months: 36, useful_life_months: 60, dep: 1, data_bearing: true },
  { name: "لاجیتک MK270 (صفحه‌کلید و موشواره)", maker: "Logitech", model_number: "920-004518", category: "peripheral", asset_class: "accessory", tracking: "quantity", ci_class: null, unit_cost: "9500000", warranty_months: 12, useful_life_months: 36, dep: 2 },
  { name: "کارتریج تونر HP 85A", maker: "HP", model_number: "CE285A", category: "consumable", asset_class: "consumable", tracking: "quantity", ci_class: null, unit_cost: "6500000", warranty_months: 0, useful_life_months: 12, dep: 2 },
];

/** Bank device models (BANK_DEVICE_CLASSES: CI class, data-bearing, depreciation class) — prices are placeholders. */
export const BANK_MODELS: ModelSeed[] = [
  { name: "ان‌سی‌آر SelfServ 22e (خودپرداز)", maker: "NCR Atleos", model_number: "6622e", category: "atm", ci_class: "computer", unit_cost: "45000000000", warranty_months: 12, useful_life_months: 84, dep: 3, data_bearing: true, specs: "خودپرداز دیواری، ۴ کاست، صفحه‌کلید رمزنگار با گواهی PCI، کارت‌خوان بی‌تماس" },
  { name: "جی‌آر‌جی H68N (خودپرداز)", maker: "GRG Banking", model_number: "H68N", category: "atm", ci_class: "computer", unit_cost: "38000000000", warranty_months: 12, useful_life_months: 84, dep: 3, data_bearing: true, specs: "خودپرداز داخل شعبه، ۴ کاست" },
  { name: "هیوسونگ MX8800 (CRS)", maker: "Hyosung TNS", model_number: "MX8800", category: "crs", ci_class: "computer", unit_cost: "60000000000", warranty_months: 12, useful_life_months: 84, dep: 3, data_bearing: true, specs: "خودپرداز بازیافتی با پذیرش وجه نقد" },
  { name: "دیبولد نیکسدورف DN Series 200V (CRS)", maker: "Diebold Nixdorf", model_number: "DN200V", category: "crs", ci_class: "computer", unit_cost: "65000000000", warranty_months: 12, useful_life_months: 84, dep: 3, data_bearing: true },
  { name: "کیوسک خدمات بانکی ۲۱ اینچ", maker: "GRG Banking", model_number: "K21", category: "kiosk", ci_class: "computer", unit_cost: "18000000000", warranty_months: 12, useful_life_months: 60, dep: 3, data_bearing: true, specs: "صورت‌حساب، پرداخت قبض و صدور کارت فوری" },
  { name: "پکس S90 (پایانهٔ فروش)", maker: "PAX Technology", model_number: "S90", category: "pos", ci_class: null, unit_cost: "150000000", warranty_months: 12, useful_life_months: 48, dep: 4 },
  { name: "پکس A920 (پایانهٔ فروش اندرویدی)", maker: "PAX Technology", model_number: "A920", category: "pos", ci_class: null, unit_cost: "280000000", warranty_months: 12, useful_life_months: 48, dep: 4 },
  { name: "وریفون VX675 (پایانهٔ سیار)", maker: "Verifone", model_number: "VX675", category: "pos", ci_class: null, unit_cost: "170000000", warranty_months: 12, useful_life_months: 48, dep: 4 },
  { name: "اولیوتی PR2 Plus (چاپگر دفترچه)", maker: "Olivetti", model_number: "PR2 Plus", category: "passbook_printer", ci_class: null, unit_cost: "900000000", warranty_months: 12, useful_life_months: 60, dep: 4 },
  { name: "پانینی Vision X (اسکنر چک)", maker: "Panini", model_number: "Vision X", category: "cheque_scanner", ci_class: null, unit_cost: "1500000000", warranty_months: 12, useful_life_months: 60, dep: 4 },
  { name: "واکام STU-540 (پد امضا)", maker: "Wacom", model_number: "STU-540", category: "signature_pad", ci_class: null, unit_cost: "250000000", warranty_months: 12, useful_life_months: 48, dep: 4 },
  { name: "تالس payShield 10K (HSM)", maker: "Thales", model_number: "payShield 10K", category: "hsm", ci_class: null, unit_cost: "35000000000", warranty_months: 36, useful_life_months: 60, dep: 5, data_bearing: true, specs: "HSM پرداخت با گواهی FIPS 140-2 سطح ۳" },
  { name: "هایک‌ویژن DS-7716NI (NVR شانزده‌کاناله)", maker: "Hikvision", model_number: "DS-7716NI-K4", category: "cctv", ci_class: null, unit_cost: "600000000", warranty_months: 24, useful_life_months: 60, dep: 5, data_bearing: true },
  { name: "ای‌پی‌سی Smart-UPS SRT 3000", maker: "APC by Schneider Electric", model_number: "SRT3KXLI", category: "ups", ci_class: "ups", unit_cost: "1800000000", warranty_months: 24, useful_life_months: 60, dep: 5 },
  { name: "سیسکو ISR 1111 (مسیریاب شعبه)", maker: "Cisco", model_number: "C1111-4P", category: "network", ci_class: "network_device", unit_cost: "900000000", warranty_months: 12, useful_life_months: 60, dep: 5, data_bearing: true },
  { name: "سیسکو Catalyst 1000 (سوئیچ شعبه)", maker: "Cisco", model_number: "C1000-24T", category: "network", ci_class: "network_device", unit_cost: "650000000", warranty_months: 12, useful_life_months: 60, dep: 5 },
  { name: "اچ‌پی‌ای MSA 2060 (ذخیره‌ساز مرکز داده)", maker: "Hewlett Packard Enterprise", model_number: "MSA 2060", category: "storage", ci_class: "storage", unit_cost: "25000000000", warranty_months: 36, useful_life_months: 60, dep: 1, data_bearing: true },
];

/** The bank roles (organisation rows: the access matrix shows and edits them). */
const BANK_ROLES = [
  {
    key: "branch_asset_officer", name: "مسئول اموال شعبه", persona: "agent",
    description: "دارایی‌های شعبه یا واحد خود را می‌بیند و تغییر می‌دهد، حوالهٔ انتقال صادر می‌کند، رسید می‌گیرد و شمارش شعبه را انجام می‌دهد؛ بدون اطلاعات مالی",
    grants: { asset: { read: "unit", create: true, write: "unit", delete: "none", approve: false, admin: false } }, field_groups: [] as string[],
  },
  {
    key: "regional_asset_manager", name: "مدیر اموال منطقه", persona: "agent",
    description: "دارایی‌های همهٔ شعبه‌های منطقه (درخت واحد): تأیید حواله‌ها، شمارش‌ها، تأییدهای رؤسای شعبه و دفتر اموال با اطلاعات مالی",
    grants: { asset: { read: "unit_tree", create: true, write: "unit_tree", delete: "none", approve: true, admin: false }, reports: READ }, field_groups: ["financial"],
  },
  {
    key: "branch_manager", name: "رئیس شعبه", persona: "agent",
    description: "دارایی‌های شعبه را می‌بیند و فهرست اموال شعبه را دوره‌ای تأیید می‌کند",
    grants: { asset: { read: "unit", create: false, write: "own", delete: "none", approve: false, admin: false } }, field_groups: [] as string[],
  },
];

interface SoftwareSeed {
  name: string;
  publisher: string;
  category: string;
  metric: string;
  patterns: string[];
  excludes?: string[];
  list_price?: string;
  is_saas?: boolean;
  status?: string;
}

const SOFTWARE: SoftwareSeed[] = [
  { name: "Windows 11 Pro", publisher: "Microsoft", category: "os", metric: "per_device", patterns: ["Windows 11"], list_price: "95000000" },
  { name: "Windows 10 Pro", publisher: "Microsoft", category: "os", metric: "per_device", patterns: ["Windows 10"], list_price: "85000000" },
  { name: "Windows Server 2022 Standard", publisher: "Microsoft", category: "os", metric: "per_core", patterns: ["Windows Server 2022"], list_price: "45000000" },
  { name: "Microsoft Office 2021 Professional Plus", publisher: "Microsoft", category: "office", metric: "per_device", patterns: ["Office Professional Plus 2021", "Office 2021"], list_price: "160000000" },
  { name: "Microsoft 365 Apps for enterprise", publisher: "Microsoft", category: "office", metric: "subscription", patterns: ["Microsoft 365 Apps", "Microsoft 365 -"], list_price: "55000000", is_saas: true },
  { name: "ESET Endpoint Security", publisher: "ESET", category: "security", metric: "per_device", patterns: ["ESET Endpoint Security", "ESET Endpoint Antivirus"], list_price: "4500000" },
  { name: "Adobe Acrobat Pro", publisher: "Adobe", category: "office", metric: "per_user", patterns: ["Adobe Acrobat Pro", "Adobe Acrobat DC"], excludes: ["Reader"], list_price: "120000000" },
  { name: "Microsoft SQL Server 2022 Standard", publisher: "Microsoft", category: "database", metric: "per_core", patterns: ["SQL Server 2022"], excludes: ["Management Studio", "Native Client", "ODBC"], list_price: "260000000" },
  { name: "AutoCAD 2024", publisher: "Autodesk", category: "design", metric: "per_user", patterns: ["AutoCAD 2024"], list_price: "380000000" },
  { name: "7-Zip", publisher: "Igor Pavlov (7-Zip)", category: "utility", metric: "open_source", patterns: ["7-Zip"] },
  { name: "Google Chrome", publisher: "Google", category: "utility", metric: "free", patterns: ["Google Chrome"] },
  { name: "uTorrent", publisher: "Google", category: "utility", metric: "free", patterns: ["uTorrent", "µTorrent"], status: "prohibited" },
];

const LABELS = [
  { name: "A4 — ۳ × ۸ (۶۳٫۵ × ۳۳٫۹ میلی‌متر)", cols_count: 3, rows_count: 8, label_width_mm: "63.5", label_height_mm: "33.9", margin_top_mm: "13", margin_side_mm: "7", gap_x_mm: "2.5", gap_y_mm: "0", is_default: true },
  { name: "A4 — ۲ × ۷ (۹۹٫۱ × ۳۸٫۱ میلی‌متر)", cols_count: 2, rows_count: 7, label_width_mm: "99.1", label_height_mm: "38.1", margin_top_mm: "15.1", margin_side_mm: "4.6", gap_x_mm: "2.5", gap_y_mm: "0", is_default: false },
  { name: "A4 — ۴ × ۱۰ (۴۸٫۵ × ۲۵٫۴ میلی‌متر)", cols_count: 4, rows_count: 10, label_width_mm: "48.5", label_height_mm: "25.4", margin_top_mm: "21.5", margin_side_mm: "8", gap_x_mm: "0", gap_y_mm: "0", is_default: false },
];

function notificationRules(): Row[] {
  const base = { active: true, notify_actor: false, digest: false, mandatory: false };
  return [
    { table_key: "asset", name: "پایان ضمانت دارایی نزدیک است", event: "custom", custom_event: "itam.warranty_expiring", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "asset", name: "پایان اجارهٔ دارایی نزدیک است", event: "custom", custom_event: "itam.lease_ending", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "asset", name: "موعد بازگشت دارایی امانی گذشته است", event: "custom", custom_event: "itam.loaner_overdue", recipients: { event_users: true }, channels: ["in_app", "email"] },
    { table_key: "asset_acknowledgement", name: "تعهدنامهٔ دارایی برای پذیرش", event: "created", recipients: { fields: ["user_id"] }, channels: ["in_app", "email"] },
    { table_key: "stock_rule", name: "موجودی به نقطهٔ سفارش رسید", event: "custom", custom_event: "itam.stock_low", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "license_reconcile_run", name: "کمبود مجوز نرم‌افزار", event: "custom", custom_event: "itam.license_shortfall", recipients: { roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "license_entitlement", name: "پایان مجوز نرم‌افزار نزدیک است", event: "custom", custom_event: "itam.entitlement_expiring", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "saas_subscription", name: "تمدید اشتراک SaaS نزدیک است", event: "custom", custom_event: "itam.saas_renewal", recipients: { event_users: true, roles: ["asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "purchase_requisition", name: "درخواست خرید تأیید یا رد شد", event: "state_changed", condition: { or: [{ f: "state", op: "changes_to", v: "approved" }, { f: "state", op: "changes_to", v: "rejected" }] }, recipients: { fields: ["requested_for"] }, channels: ["in_app", "email"] },
    { table_key: "repair_order", name: "تعمیر دارایی انجام شد", event: "state_changed", condition: { or: [{ f: "state", op: "changes_to", v: "repaired" }, { f: "state", op: "changes_to", v: "beyond_repair" }] }, recipients: { fields: ["assigned_to"], roles: ["asset_manager"] }, channels: ["in_app"] },
    { table_key: "disposal_order", name: "دستور اسقاط تازه", event: "created", recipients: { roles: ["asset_manager"] }, channels: ["in_app"] },
    { table_key: "asset_transfer", name: "حوالهٔ انتقال دارایی در راه است", event: "state_changed", condition: { f: "state", op: "changes_to", v: "in_transit" }, recipients: { roles: ["branch_asset_officer", "regional_asset_manager"] }, channels: ["in_app"] },
    { table_key: "asset_transfer", name: "رسید انتقال با مغایرت", event: "custom", custom_event: "itam.transfer_discrepancy", recipients: { fields: ["requested_by"], roles: ["asset_manager", "regional_asset_manager"] }, channels: ["in_app", "email"] },
    { table_key: "branch_attestation", name: "تأیید اموال شعبه منتظر شماست", event: "created", recipients: { fields: ["manager_id"] }, channels: ["in_app", "email"] },
    { table_key: "branch_attestation", name: "تأیید اموال شعبه با استثنا", event: "custom", custom_event: "itam.attestation_exceptions", recipients: { roles: ["asset_manager", "regional_asset_manager"] }, channels: ["in_app", "email"] },
  ].map((r) => ({ ...base, ...r }));
}

/** An inactive flow template: a missing asset is told to its manager and becomes a security incident. */
function missingAssetGraph(): Row {
  return {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } },
      { id: "n1", type: "notify", label: "اطلاع به مسئول دارایی", config: { to: { fields: ["managed_by"] }, subject: "دارایی مفقود شد: {{trigger.record.name}}", body: "دارایی {{trigger.record.number}} ({{trigger.record.name}}) مفقود گزارش شد." }, position: { x: 0, y: 120 } },
      { id: "c1", type: "create_record", label: "ثبت رخداد امنیتی", config: { table: "incident", values: { short_description: "دارایی مفقود: {{trigger.record.name}}", description: "دارایی {{trigger.record.number}} مفقود یا سرقت‌شده گزارش شد؛ دسترسی‌ها و داده‌های آن را بررسی کنید.", urgency: "2" } }, position: { x: 0, y: 240 } },
    ],
    edges: [{ id: "trigger-out-n1", source: "trigger", target: "n1" }, { id: "n1-out-c1", source: "n1", target: "c1" }],
    layout: { direction: "TB" },
  };
}

/** Add the defaults inside `tx` as the system. */
export async function seedItamDefaultsIn(tx: Tx, ctx: Ctx, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = sysOf(ctx);
  const out: SeedCounts = { skipped: false, created: {} };
  const [cfg] = await liveRows(tx, sys, "itam_config", null, { order: "t.created_at", limit: 1 });
  if (cfg && Number(cfg.seeded ?? 0) >= ITAM_SEED_VERSION && !opts.force) {
    await bindCatalogue(tx, sys, out);
    return { ...out, skipped: true };
  }
  const config = cfg ?? (await ensure(tx, sys, out, "itam_config", { config_key: "default" }, { name: "تنظیمات دارایی‌ها" }));
  const today = todayISO(orgTz(sys));

  const deps: Row[] = [];
  for (const d of DEPRECIATION) deps.push(await ensure(tx, sys, out, "depreciation_rule", { name: d.name }, d));
  for (const l of LABELS) await ensure(tx, sys, out, "label_template", { name: l.name }, { ...l, fields: ["tag", "name", "serial"], active: true });

  const makers = new Map<string, Row>();
  for (const [name, kinds] of MAKERS) makers.set(name, await ensure(tx, sys, out, "supplier", { name }, { kinds, state: "active", criticality: "medium" }));
  const models = new Map<string, Row>();
  for (const m of [...MODELS, ...BANK_MODELS]) {
    models.set(m.name, await ensure(tx, sys, out, "asset_model", { name: m.name }, {
      manufacturer_id: makers.get(m.maker)?.id ?? null, model_number: m.model_number, category: m.category, asset_class: m.asset_class ?? "hardware", tracking: m.tracking ?? "individual",
      ci_class: m.ci_class ?? null, unit_cost: m.unit_cost, warranty_months: m.warranty_months, useful_life_months: m.useful_life_months, depreciation_rule_id: deps[m.dep]?.id ?? null,
      data_bearing: !!m.data_bearing, requires_acknowledgement: !!m.ack, acknowledgement_terms: m.ack ? ACK_TERMS : null, specs: m.specs ?? null, status: "approved",
      default_vendor_id: makers.get("فن‌آوران نمونه (فروشندهٔ سخت‌افزار)")?.id ?? null, lifecycle_source: "manual",
    }));
  }
  const model = (name: string) => models.get(name)?.id ?? null;

  const central = await ensure(tx, sys, out, "stockroom", { code: "WH-01" }, { name: "انبار مرکزی فناوری اطلاعات", stockroom_type: "central", active: true });
  await ensure(tx, sys, out, "stockroom", { code: "WH-02" }, { name: "انبارک ساختمان مرکزی", stockroom_type: "onsite", parent_id: central.id, active: true });
  await ensure(tx, sys, out, "stockroom", { code: "WH-90" }, { name: "محل اسقاط", stockroom_type: "disposal", active: true });
  const rules: [string, number, number][] = [["لنوو ThinkPad E14 Gen 5", 3, 10], ["سامسونگ ۲۴ اینچ S24C360", 5, 15], ["سامسونگ Galaxy A54", 2, 6], ["لاجیتک MK270 (صفحه‌کلید و موشواره)", 10, 40], ["کارتریج تونر HP 85A", 6, 24]];
  for (const [name, min, max] of rules) if (model(name)) await ensure(tx, sys, out, "stock_rule", { model_id: model(name), stockroom_id: central.id }, { min_qty: min, max_qty: max, lead_days: 14, active: true });

  const sw = new Map<string, Row>();
  for (const s of SOFTWARE) {
    sw.set(s.name, await ensure(tx, sys, out, "software_model", { name: s.name }, {
      publisher_id: makers.get(s.publisher)?.id ?? null, product: s.name, category: s.category, license_metric: s.metric, status: s.status ?? "approved",
      match_patterns: s.patterns, exclude_patterns: s.excludes ?? [], list_price: s.list_price ?? null, is_saas: !!s.is_saas,
    }));
  }
  const ent = (name: string, model: string, metric: string, quantity: number, unit: string, extra: Row = {}) =>
    ensure(tx, sys, out, "license_entitlement", { name }, { software_model_id: sw.get(model)?.id ?? null, metric, quantity, unit_cost: unit, supplier_id: makers.get(SOFTWARE.find((s) => s.name === model)?.publisher ?? "")?.id ?? null, state: "active", start_date: addDays(today, -200), ...extra });
  await ent("Windows 11 Pro — OEM همراه رایانه‌ها", "Windows 11 Pro", "per_device", 50, "95000000");
  await ent("Office 2021 Professional Plus — حجمی", "Microsoft Office 2021 Professional Plus", "per_device", 30, "160000000");
  await ent("ESET Endpoint Security — اشتراک سالانه", "ESET Endpoint Security", "per_device", 60, "4500000", { end_date: addJalaliMonths(today, 6), true_up_date: addJalaliMonths(today, 5) });
  await ent("Windows Server 2022 Standard — ۳۲ هسته", "Windows Server 2022 Standard", "per_core", 32, "45000000", { min_cores: 16 });
  await ent("Adobe Acrobat Pro — ۱۰ کاربر", "Adobe Acrobat Pro", "per_user", 10, "120000000", { end_date: addJalaliMonths(today, 9) });
  await ent("Microsoft 365 Apps — ۴۰ صندلی", "Microsoft 365 Apps for enterprise", "subscription", 40, "55000000", { end_date: addJalaliMonths(today, 4), allocation_required: false });
  await ensure(tx, sys, out, "saas_subscription", { name: "Microsoft 365 Business" }, {
    supplier_id: makers.get("Microsoft")?.id ?? null, software_model_id: sw.get("Microsoft 365 Apps for enterprise")?.id ?? null, plan: "Business Standard", billing_cycle: "annual",
    seats: 40, cost_per_seat: "55000000", renewal_date: addJalaliMonths(today, 4), auto_renew: true, sso: true, state: "active",
  });

  await ensure(tx, sys, out, "hardware_standard", { name: "کارمند اداری" }, { persona: "office", models: [model("لنوو ThinkPad E14 Gen 5")].filter(Boolean), accessories: [model("سامسونگ ۲۴ اینچ S24C360"), model("لاجیتک MK270 (صفحه‌کلید و موشواره)")].filter(Boolean), software: ["Windows 11 Pro", "Microsoft Office 2021 Professional Plus", "ESET Endpoint Security"].map((n) => sw.get(n)?.id).filter(Boolean), refresh_months: 48, active: true });
  await ensure(tx, sys, out, "hardware_standard", { name: "برنامه‌نویس" }, { persona: "developer", models: [model("اچ‌پی ProBook 450 G10")].filter(Boolean), accessories: [model("ال‌جی ۲۷ اینچ 27MP400"), model("لاجیتک MK270 (صفحه‌کلید و موشواره)")].filter(Boolean), software: ["Windows 11 Pro", "ESET Endpoint Security"].map((n) => sw.get(n)?.id).filter(Boolean), refresh_months: 36, active: true });

  // procurement: its group, the procurement manager's role, approvals, SLAs
  const procurement = await ensure(tx, sys, out, "group", { name: "تدارکات فناوری اطلاعات" }, { types: ["approval", "assignment"], description: "تأیید درخواست‌های خرید بالای سقف و ثبت سفارش" });
  const assetGroup = await ensure(tx, sys, out, "group", { name: "مدیریت دارایی" }, { types: ["assignment", "approval"], description: "انبار، تحویل، شمارش، تعمیر و اسقاط دارایی‌ها" });
  const [role] = await liveRows(tx, sys, "role", eqAll({ key: "procurement_manager" }), { limit: 1 });
  if (!role) {
    await createIn(tx, sys, "role", {
      key: "procurement_manager", name: "مدیر تدارکات", persona: "agent", description: "درخواست‌ها و سفارش‌های خرید، رسید کالا، تأمین‌کنندگان و قراردادها با اطلاعات مالی",
      grants: { procurement: FULL, vendor: { ...FULL, delete: "none" }, contract: { read: "all", create: true, write: "all", delete: "none", approve: false, admin: false }, asset: READ, software: READ, financial: READ, catalog: READ, reports: READ, org: READ, users: READ },
      field_groups: ["financial", "internal"], contains: ["requester"], workspaces: "member", domains: "own", active: true,
    }, { trusted: true });
    out.created.role = (out.created.role ?? 0) + 1;
  }
  await ensure(tx, sys, out, "approval_rule", { table_key: "purchase_requisition", name: "تأیید درخواست خرید" }, {
    condition: { f: "state", op: "eq", v: "pending_approval" } as Cond, mode: "sequential", active: true, expire_after: 7 * 86400, remind_every: 86400,
    levels: [{ name: "مدیر درخواست‌کننده", sources: [{ kind: "manager" }], rule: "any" }],
  });
  await ensure(tx, sys, out, "approval_rule", { table_key: "purchase_requisition", name: "خرید بالای سقف (۲ میلیارد ریال)" }, {
    condition: { and: [{ f: "state", op: "eq", v: "pending_approval" }, { f: "total", op: "gte", v: "2000000000" }] } as Cond, mode: "sequential", active: true, expire_after: 7 * 86400, remind_every: 86400,
    levels: [{ name: "تدارکات", sources: [{ kind: "groups", groups: [procurement.id] }], rule: "any" }],
  });
  await ensure(tx, sys, out, "approval_rule", { table_key: "disposal_order", name: "تأیید اسقاط دارایی" }, {
    condition: { f: "state", op: "eq", v: "requested" } as Cond, mode: "sequential", active: true, expire_after: 14 * 86400,
    levels: [{ name: "مدیریت دارایی", sources: [{ kind: "groups", groups: [assetGroup.id] }], rule: "any" }],
  });
  // bank: roles, the transfer approval, the ATM maintenance group
  for (const r of BANK_ROLES) {
    const [found] = await liveRows(tx, sys, "role", eqAll({ key: r.key }), { limit: 1 });
    if (found) continue;
    await createIn(tx, sys, "role", { ...r, contains: ["requester"], workspaces: "member", domains: "own", active: true }, { trusted: true });
    out.created.role = (out.created.role ?? 0) + 1;
  }
  await ensure(tx, sys, out, "approval_rule", { table_key: "asset_transfer", name: "تأیید حوالهٔ انتقال دارایی" }, {
    condition: { f: "state", op: "eq", v: "pending_approval" } as Cond, mode: "sequential", active: true, expire_after: 7 * 86400, remind_every: 86400,
    levels: [{ name: "مدیریت دارایی", sources: [{ kind: "groups", groups: [assetGroup.id] }], rule: "any" }],
  });
  await ensure(tx, sys, out, "group", { name: "نگهداری خودپردازها" }, { types: ["assignment"], description: "نگهداری پیشگیرانه و تعمیر خودپرداز، CRS و کیوسک" });
  const office = await officeCalendar(tx, sys, out);
  await ensure(tx, sys, out, "sla_definition", { table_key: "purchase_requisition", name: "تصمیم دربارهٔ درخواست خرید" }, {
    type: "ola", target: "custom", duration_mode: "fixed", duration: 2 * 9 * 3600, calendar_id: office, warn_percents: [50, 75],
    start_condition: { f: "state", op: "eq", v: "pending_approval" }, stop_condition: { f: "state", op: "in", v: ["approved", "ordered", "closed", "rejected"] },
    cancel_condition: { f: "state", op: "in", v: ["canceled", "draft"] }, description: "دو روز کاری برای تأیید یا رد درخواست خرید",
  });
  await ensure(tx, sys, out, "sla_definition", { table_key: "repair_order", name: "بازگشت دارایی از تعمیر" }, {
    type: "ola", target: "resolution", duration_mode: "fixed", duration: 10 * 9 * 3600, calendar_id: office, warn_percents: [75, 90],
    stop_condition: { f: "state", op: "in", v: ["repaired", "beyond_repair", "closed"] }, cancel_condition: { f: "state", op: "eq", v: "canceled" },
    description: "ده روز کاری تا تعمیر یا اعلام غیرقابل تعمیر بودن",
  });
  await ensure(tx, sys, out, "sla_definition", { table_key: "asset_transfer", name: "رسید حوالهٔ انتقال دارایی" }, {
    type: "ola", target: "custom", duration_mode: "fixed", duration: 3 * 9 * 3600, calendar_id: office, warn_percents: [50, 75],
    start_condition: { f: "state", op: "eq", v: "in_transit" }, stop_condition: { f: "state", op: "in", v: ["received", "received_partial", "closed"] },
    cancel_condition: { f: "state", op: "eq", v: "canceled" }, description: "سه روز کاری از ارسال تا رسید شعبهٔ گیرنده",
  });
  for (const r of notificationRules()) await ensure(tx, sys, out, "notification_rule", { table_key: r.table_key, name: r.name }, r);

  // the flow template (inactive until the organisation reviews it)
  const [flow] = await liveRows(tx, sys, "flow", eqAll({ name: "دارایی مفقود: اطلاع و رخداد امنیتی" }), { limit: 1 });
  if (!flow && tableDef("incident")) {
    const graph = missingAssetGraph();
    const f = await createIn(tx, sys, "flow", {
      name: "دارایی مفقود: اطلاع و رخداد امنیتی", active: false, description: "وقتی دارایی «مفقود» می‌شود، مسئول آن آگاه و یک رخداد برای بررسی امنیتی ثبت می‌شود (الگو؛ پیش از فعال‌سازی بازبینی کنید)",
      trigger: "record", trigger_table: "asset", trigger_events: ["state_changed"], trigger_condition: { f: "state", op: "eq", v: "missing" }, run_as: "system", graph,
    }, { trusted: true });
    const v = await createIn(tx, sys, "flow_version", { flow_id: f.id, version_no: 1, title: "دارایی مفقود — نسخهٔ ۱", note: "الگوی ماژول دارایی", trigger: triggerOf(f), graph }, { trusted: true });
    await updateIn(tx, sys, "flow", String(f.id), { version_id: v.id, version_no: 1, published_at: new Date().toISOString(), dirty: false }, { trusted: true });
    out.created.flow = (out.created.flow ?? 0) + 1;
  }

  await bindCatalogue(tx, sys, out);
  await updateIn(tx, sys, "itam_config", String(config.id), { seeded: ITAM_SEED_VERSION }, { trusted: true });
  return out;
}

/** Catalogue items of the request module that deliver a model (when the request module seeded them). */
async function bindCatalogue(tx: Tx, sys: Ctx, out: SeedCounts): Promise<void> {
  if (!tableDef("catalog_item")) return;
  const pairs: [string, string][] = [["new_laptop", "لنوو ThinkPad E14 Gen 5"], ["phone", "سامسونگ Galaxy A54"], ["mobile_phone", "سامسونگ Galaxy A54"]];
  for (const [code, modelName] of pairs) {
    const [item] = await liveRows(tx, sys, "catalog_item", eqAll({ code }), { limit: 1 });
    const [model] = await liveRows(tx, sys, "asset_model", eqAll({ name: modelName }), { limit: 1 });
    if (!item || !model) continue;
    await ensure(tx, sys, out, "catalog_item_model", { catalog_item_id: item.id, model_id: model.id }, { consume_stock: true, raise_purchase: true, preference: 1 });
  }
}
