// Pure logic of IT asset management for banks (docs/modules/itam_bank_gap.md, itam_FA.md «بانک»): the bank device
// classes and their attributes, depreciation by Jalali fiscal year, the transfer («حواله و رسید») rules, the
// reconciliation of a physical audit, device availability and maintenance penalties, the ATM failure-risk score and
// the asset-tag pattern. Imported by the UI and the server alike: no server imports, money as decimal strings.
import { D, type Num } from "../money";
import { addDays, fromJalali, jalaliYearRange, monthLength, toJalali } from "../jalali";
import { depreciationSchedule, type DepMethod } from "./logic";

// ---------------------------------------------------------------------------------------------------------------
// Device classes and their attributes

export type AttrType = "string" | "int" | "choice" | "bool" | "date";

export interface AttrDef {
  key: string;
  label: string;
  type: AttrType;
  options?: string[];
  ltr?: boolean;
  unit?: string;
}

export interface DeviceClass {
  /** the asset model category («asset_model.category») */
  key: string;
  label: string;
  /** short code for asset tags ({class}) */
  code: string;
  /** the CI class its assets get in the CMDB (null: none) */
  ci_class: string | null;
  /** stores or processes customer data: disposal needs a wipe certificate */
  data_bearing: boolean;
  /** followed in the fleet view (status, availability, maintenance) */
  fleet: boolean;
  /** default useful life (months) for the seeded depreciation class */
  life_months: number;
  attributes: AttrDef[];
}

const s = (key: string, label: string, ltr = false): AttrDef => ({ key, label, type: "string", ...(ltr ? { ltr } : {}) });
const n = (key: string, label: string, unit?: string): AttrDef => ({ key, label, type: "int", ...(unit ? { unit } : {}) });
const c = (key: string, label: string, options: string[]): AttrDef => ({ key, label, type: "choice", options });
const b = (key: string, label: string): AttrDef => ({ key, label, type: "bool" });
const d = (key: string, label: string): AttrDef => ({ key, label, type: "date" });

export const BANK_DEVICE_CLASSES: DeviceClass[] = [
  {
    key: "atm", label: "خودپرداز (ATM)", code: "ATM", ci_class: "computer", data_bearing: true, fleet: true, life_months: 84,
    attributes: [
      n("cassettes", "تعداد کاست اسکناس"), c("dispenser", "نوع دیسپنسر", ["اصطکاکی", "خلائی"]), b("deposit", "پذیرش وجه نقد"), b("cheque_deposit", "پذیرش چک"),
      b("contactless", "کارت‌خوان بی‌تماس"), b("epp_pci", "صفحه‌کلید رمزنگار (EPP) با گواهی PCI"), s("xfs_version", "نسخهٔ XFS", true), s("agent_version", "نسخهٔ عامل پایش", true),
      c("connection", "ارتباط", ["فیبر", "ADSL", "4G", "ماهواره"]), b("anti_skimming", "ضد اسکیمر"),
    ],
  },
  {
    key: "crs", label: "خودپرداز بازیافتی (CRS)", code: "CRS", ci_class: "computer", data_bearing: true, fleet: true, life_months: 84,
    attributes: [n("cassettes", "تعداد کاست"), n("recycle_cassettes", "کاست‌های بازیافتی"), n("capacity_notes", "ظرفیت", "برگ اسکناس"), s("xfs_version", "نسخهٔ XFS", true), b("epp_pci", "صفحه‌کلید رمزنگار (EPP) با گواهی PCI")],
  },
  {
    key: "kiosk", label: "کیوسک بانکی", code: "KSK", ci_class: "computer", data_bearing: true, fleet: true, life_months: 60,
    attributes: [c("services", "خدمات", ["صورت‌حساب", "صدور کارت", "پرداخت قبض", "چندمنظوره"]), b("card_issuing", "صدور کارت فوری"), b("printer", "چاپگر رسید"), n("screen_inch", "اندازهٔ صفحه", "اینچ")],
  },
  {
    key: "pos", label: "پایانهٔ فروش (POS)", code: "POS", ci_class: null, data_bearing: false, fleet: false, life_months: 36,
    attributes: [c("connection", "ارتباط", ["GPRS/4G", "LAN", "Wi-Fi", "Dial-up"]), s("sim_serial", "سریال سیم‌کارت", true), s("shop_name", "نام فروشگاه"), b("contactless", "بی‌تماس"), d("install_date", "تاریخ نصب نزد پذیرنده")],
  },
  {
    key: "passbook_printer", label: "چاپگر دفترچه", code: "PBP", ci_class: null, data_bearing: false, fleet: false, life_months: 60,
    attributes: [b("mag_stripe", "خواندن و نوشتن نوار مغناطیسی"), c("interface", "اتصال", ["USB", "LAN", "Serial"])],
  },
  {
    key: "cheque_scanner", label: "اسکنر چک", code: "CHS", ci_class: null, data_bearing: false, fleet: false, life_months: 60,
    attributes: [n("speed_dpm", "سرعت (برگ در دقیقه)"), b("micr", "خواندن MICR"), b("inkjet", "چاپ پشت چک"), b("sayad_ready", "سازگار با چکاوک و صیاد")],
  },
  {
    key: "signature_pad", label: "پد امضای دیجیتال", code: "SGP", ci_class: null, data_bearing: false, fleet: false, life_months: 48,
    attributes: [n("screen_inch", "اندازهٔ صفحه", "اینچ"), b("biometric", "امضای بیومتریک")],
  },
  {
    key: "hsm", label: "ماژول امنیت سخت‌افزاری (HSM)", code: "HSM", ci_class: null, data_bearing: true, fleet: false, life_months: 60,
    attributes: [c("fips_level", "سطح FIPS 140", ["Level 2", "Level 3", "Level 4"]), n("partitions", "تعداد پارتیشن"), s("firmware_cert", "گواهی فرم‌ور", true), c("role", "کاربرد", ["پرداخت (PIN/EMV)", "عمومی", "امضای دیجیتال"]), b("dual_control", "کنترل دوگانه کلیدها")],
  },
  {
    key: "cctv", label: "دوربین و ضبط‌کنندهٔ تصویر (CCTV/NVR)", code: "CTV", ci_class: null, data_bearing: true, fleet: false, life_months: 60,
    attributes: [n("channels", "تعداد کانال"), n("retention_days", "نگهداری تصویر", "روز"), n("storage_tb", "ذخیره‌سازی", "ترابایت"), b("atm_coverage", "پوشش خودپرداز")],
  },
  {
    key: "ups", label: "منبع تغذیهٔ اضطراری (UPS)", code: "UPS", ci_class: "ups", data_bearing: false, fleet: false, life_months: 60,
    attributes: [n("capacity_va", "توان", "ولت‌آمپر"), n("autonomy_min", "زمان پشتیبانی", "دقیقه"), d("battery_date", "تاریخ نصب باتری‌ها"), c("topology", "فناوری", ["Online", "Line-interactive", "Offline"])],
  },
  { key: "network", label: "تجهیز شبکهٔ شعبه", code: "NET", ci_class: "network_device", data_bearing: true, fleet: false, life_months: 60, attributes: [n("ports", "تعداد درگاه"), s("mgmt_ip", "نشانی مدیریت", true), s("ios_version", "نسخهٔ سیستم‌عامل", true)] },
  { key: "server", label: "سرور", code: "SRV", ci_class: "server", data_bearing: true, fleet: false, life_months: 60, attributes: [n("cores", "هستهٔ پردازنده"), n("ram_gb", "حافظه", "گیگابایت"), s("rack", "رک و جایگاه")] },
  { key: "storage", label: "ذخیره‌ساز", code: "STG", ci_class: "storage", data_bearing: true, fleet: false, life_months: 60, attributes: [n("capacity_tb", "ظرفیت", "ترابایت"), c("kind", "گونه", ["SAN", "NAS", "Backup"])] },
];

export const deviceClass = (category: unknown): DeviceClass | undefined => BANK_DEVICE_CLASSES.find((x) => x.key === category);
export const isFleetCategory = (category: unknown): boolean => !!deviceClass(category)?.fleet;

/** Attribute values kept to the class's definitions (unknown keys dropped, types coerced; invalid values refused). */
export function cleanAttributes(category: unknown, values: unknown): { values: Record<string, unknown>; problem: string | null } {
  const cls = deviceClass(category);
  const src = values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  if (!cls) return { values: src, problem: null };
  const out: Record<string, unknown> = {};
  for (const a of cls.attributes) {
    const v = src[a.key];
    if (v === null || v === undefined || v === "") continue;
    if (a.type === "int") {
      const x = Number(v);
      if (!Number.isFinite(x) || !Number.isInteger(x) || x < 0) return { values: out, problem: `«${a.label}» باید عدد صحیح نامنفی باشد` };
      out[a.key] = x;
    } else if (a.type === "bool") out[a.key] = v === true || v === "true";
    else if (a.type === "choice") {
      if (!a.options?.includes(String(v))) return { values: out, problem: `«${String(v)}» از گزینه‌های «${a.label}» نیست` };
      out[a.key] = String(v);
    } else if (a.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return { values: out, problem: `«${a.label}» تاریخ معتبر نیست` };
      out[a.key] = String(v);
    } else out[a.key] = String(v).slice(0, 200);
  }
  return { values: out, problem: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Depreciation by Jalali fiscal year (1 Farvardin – the last day of Esfand)

export type StartConvention = "same_month" | "next_month";

export interface FyInput {
  cost: Num;
  salvage?: Num;
  lifeMonths: number;
  method: DepMethod;
  ratePercent?: Num | null;
  /** the in-service (or purchase) date */
  start: string | null;
  /** «از ماه بعد از بهره‌برداری»: the first charged month is the one after the start */
  convention?: StartConvention;
  /** disposal or retirement: no charge after this date's month */
  end?: string | null;
}

export interface FyResult {
  fiscal_year: number;
  /** acquired during the year (its cost is an addition, not an opening balance) */
  acquired_in_year: boolean;
  /** disposed during the year */
  disposed_in_year: boolean;
  opening_cost: string;
  additions: string;
  disposals: string;
  opening_accumulated: string;
  charge: string;
  closing_accumulated: string;
  closing_book: string;
  months_charged: number;
}

/** The first day of the Jalali month after the date's month. */
export function nextJalaliMonthStart(iso: string): string {
  const j = toJalali(iso);
  return j.jm === 12 ? fromJalali(j.jy + 1, 1, 1) : fromJalali(j.jy, j.jm + 1, 1);
}

const period = (jy: number, jm: number) => `${jy}-${String(jm).padStart(2, "0")}`;
const periodOf = (iso: string) => {
  const j = toJalali(iso);
  return period(j.jy, j.jm);
};

/** One asset's depreciation in Jalali fiscal year `fy` (rounded to the Rial; uses the module's monthly schedule). */
export function fiscalYearDepreciation(input: FyInput, fy: number): FyResult {
  const cost = D(input.cost ?? 0);
  const zero = "0";
  const { start: fyStart, end: fyEnd } = jalaliYearRange(fy);
  const acquired = !!input.start && input.start >= fyStart && input.start <= fyEnd;
  const before = !!input.start && input.start < fyStart;
  const disposedIn = !!input.end && input.end >= fyStart && input.end <= fyEnd;
  const disposedBefore = !!input.end && input.end < fyStart;
  const base: FyResult = {
    fiscal_year: fy, acquired_in_year: acquired, disposed_in_year: disposedIn,
    opening_cost: before && !disposedBefore ? cost.toString() : zero, additions: acquired ? cost.toString() : zero, disposals: zero,
    opening_accumulated: zero, charge: zero, closing_accumulated: zero, closing_book: zero, months_charged: 0,
  };
  if (!input.start || input.start > fyEnd || disposedBefore) return base;
  const first = input.convention === "next_month" ? nextJalaliMonthStart(input.start) : input.start;
  const schedule = depreciationSchedule({ cost: input.cost, salvage: input.salvage, lifeMonths: input.lifeMonths, method: input.method, ratePercent: input.ratePercent, start: first });
  const lastPeriod = input.end && disposedIn ? periodOf(input.end) : period(fy, 12);
  let opening = D(0);
  let charge = D(0);
  let months = 0;
  for (const m of schedule) {
    if (m.period < period(fy, 1)) opening = D(m.accumulated);
    else if (m.period <= lastPeriod) {
      charge = charge.plus(m.charge);
      months++;
    }
  }
  const closing = opening.plus(charge);
  const out: FyResult = {
    ...base,
    opening_accumulated: before ? opening.toString() : zero,
    charge: charge.toString(),
    closing_accumulated: disposedIn ? zero : closing.toString(),
    closing_book: disposedIn ? zero : cost.minus(closing).toString(),
    disposals: disposedIn ? cost.toString() : zero,
    months_charged: months,
  };
  return out;
}

/** The fiscal years an asset register can show (the current one and the four before it). */
export const registerYears = (today: string): number[] => {
  const jy = toJalali(today).jy;
  return [jy, jy - 1, jy - 2, jy - 3, jy - 4];
};

// ---------------------------------------------------------------------------------------------------------------
// Transfers («حواله و رسید انتقال»)

export type TransferItemResult = "pending" | "received" | "damaged" | "missing";

/** Why a transfer cannot be sent for approval or dispatched (null: it can). */
export function transferProblem(t: { from_branch_id?: unknown; to_branch_id?: unknown }, items: { asset_id?: unknown }[]): string | null {
  if (!t.from_branch_id || !t.to_branch_id) return "شعبهٔ مبدأ و مقصد را مشخص کنید";
  if (String(t.from_branch_id) === String(t.to_branch_id)) return "مبدأ و مقصد انتقال یکی است";
  if (!items.length) return "حواله هیچ قلمی ندارد";
  return null;
}

/** The receipt of a transfer from the result of each item: the next state and the counts. */
export function receiptOutcome(results: TransferItemResult[]): { state: "received" | "received_partial"; received: number; damaged: number; missing: number; discrepancies: number } {
  const received = results.filter((r) => r === "received").length;
  const damaged = results.filter((r) => r === "damaged").length;
  const missing = results.filter((r) => r === "missing" || r === "pending").length;
  const discrepancies = damaged + missing;
  return { state: discrepancies ? "received_partial" : "received", received: received + damaged, damaged, missing, discrepancies };
}

// ---------------------------------------------------------------------------------------------------------------
// Physical audit reconciliation

export type AuditResult = "pending" | "found" | "moved" | "missing" | "unexpected";
export type AuditResolution = "none" | "confirmed_missing" | "found" | "transferred" | "registered" | "written_off" | "ignored";

/** The resolutions a discrepancy of each result may take. */
export const RESOLUTIONS_FOR: Record<AuditResult, AuditResolution[]> = {
  pending: [],
  found: [],
  missing: ["confirmed_missing", "found", "written_off", "ignored"],
  moved: ["transferred", "found", "ignored"],
  unexpected: ["registered", "ignored"],
};

/** Is an item a discrepancy (after the audit is completed, an unseen expected asset counts as missing)? */
export const isDiscrepancy = (result: unknown): boolean => result === "missing" || result === "moved" || result === "unexpected" || result === "pending";

/** Open discrepancies of an audit's items. */
export function openDiscrepancies(items: { result?: unknown; resolution?: unknown }[]): number {
  return items.filter((i) => isDiscrepancy(i.result) && (!i.resolution || i.resolution === "none")).length;
}

// ---------------------------------------------------------------------------------------------------------------
// Availability, maintenance penalties, failure risk

export type DeviceStatus = "in_service" | "out_of_service" | "out_of_cash" | "maintenance" | "offline";
export const DOWN_STATUSES: DeviceStatus[] = ["out_of_service", "out_of_cash", "offline", "maintenance"];

export interface StatusPeriod {
  status: string;
  from_at: string;
  to_at?: string | null;
}

export interface Availability {
  window_minutes: number;
  up_minutes: number;
  down: Record<string, number>;
  /** percent with two decimals, «100.00» for a device without recorded downtime */
  availability: string;
}

const minutesBetween = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60_000));

/** The share of a window the device was in service (time without a recorded period counts as in service). */
export function availabilityOf(periods: StatusPeriod[], from: string, to: string, now = Date.now()): Availability {
  const a = Date.parse(from);
  const z = Math.min(Date.parse(to), now);
  const total = minutesBetween(a, z);
  const down: Record<string, number> = {};
  for (const p of periods) {
    if (p.status === "in_service") continue;
    const s0 = Math.max(a, Date.parse(p.from_at));
    const e0 = Math.min(z, p.to_at ? Date.parse(p.to_at) : now);
    const m = minutesBetween(s0, e0);
    if (m > 0) down[p.status] = (down[p.status] ?? 0) + m;
  }
  const downTotal = Math.min(total, Object.values(down).reduce((x, y) => x + y, 0));
  const up = total - downTotal;
  return { window_minutes: total, up_minutes: up, down, availability: total ? D(up).mul(100).div(total).toFixed(2) : "100.00" };
}

export interface SlaTerms {
  restore_hours: number;
  penalty_per_hour?: Num | null;
  penalty_cap?: Num | null;
  counts_maintenance?: boolean | null;
  availability_target?: Num | null;
}

export interface Penalty {
  breaches: number;
  late_hours: number;
  amount: string;
}

/** Penalty hours beyond the restore time of each downtime period that started in the window. */
export function penaltyOf(periods: StatusPeriod[], sla: SlaTerms, from: string, to: string, now = Date.now()): Penalty {
  const a = Date.parse(from);
  const z = Math.min(Date.parse(to), now);
  let breaches = 0;
  let late = 0;
  for (const p of periods) {
    if (p.status === "in_service") continue;
    if (p.status === "maintenance" && !sla.counts_maintenance) continue;
    const s0 = Date.parse(p.from_at);
    if (s0 < a || s0 > z) continue;
    const e0 = p.to_at ? Date.parse(p.to_at) : now;
    const hours = (e0 - s0) / 3_600_000;
    if (hours > sla.restore_hours) {
      breaches++;
      late += Math.ceil(hours - sla.restore_hours);
    }
  }
  let amount = D(sla.penalty_per_hour ?? 0).mul(late);
  if (sla.penalty_cap !== null && sla.penalty_cap !== undefined && D(sla.penalty_cap).gt(0) && amount.gt(sla.penalty_cap)) amount = D(sla.penalty_cap);
  return { breaches, late_hours: late, amount: amount.toFixed(0) };
}

export interface RiskInput {
  incidents_90d: number;
  downtime_minutes_30d: number;
  age_months: number | null;
  life_months: number | null;
  /** days to the OS end of support (negative: past it) */
  eos_days: number | null;
  status: string | null;
}

export interface Risk {
  score: number;
  level: "low" | "medium" | "high";
  reasons: string[];
}

/** «پیش‌بینی خرابی»: a rule-based failure-risk score of a self-service device (0–100) with its reasons. */
export function failureRisk(r: RiskInput): Risk {
  let score = 0;
  const reasons: string[] = [];
  if (r.incidents_90d > 0) {
    score += Math.min(40, r.incidents_90d * 8);
    reasons.push(`${r.incidents_90d} رخداد در ۹۰ روز گذشته`);
  }
  if (r.downtime_minutes_30d > 0) {
    score += Math.min(25, Math.round(r.downtime_minutes_30d / 120));
    if (r.downtime_minutes_30d >= 240) reasons.push(`${Math.round(r.downtime_minutes_30d / 60)} ساعت ازکارافتادگی در ۳۰ روز گذشته`);
  }
  if (r.age_months !== null && r.life_months) {
    const ratio = r.age_months / r.life_months;
    if (ratio >= 1) {
      score += 20;
      reasons.push("عمر مفید دستگاه گذشته است");
    } else if (ratio >= 0.8) {
      score += 10;
      reasons.push("دستگاه به پایان عمر مفید نزدیک است");
    }
  }
  if (r.eos_days !== null) {
    if (r.eos_days < 0) {
      score += 15;
      reasons.push("پشتیبانی سیستم‌عامل پایان یافته است");
    } else if (r.eos_days <= 180) {
      score += 7;
      reasons.push("پشتیبانی سیستم‌عامل تا شش ماه دیگر پایان می‌یابد");
    }
  }
  if (r.status === "out_of_service") score += 10;
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", reasons };
}

/** Days from `today` to `date` (negative when past); null without a date. */
export const daysTo = (today: string, date: unknown): number | null => {
  if (!date || typeof date !== "string") return null;
  return Math.round((Date.parse(date.slice(0, 10)) - Date.parse(today)) / 86_400_000);
};

/** Whole months between two dates (Jalali months). */
export function monthsBetween(from: string, to: string): number {
  const a = toJalali(from);
  const z = toJalali(to);
  return Math.max(0, (z.jy - a.jy) * 12 + (z.jm - a.jm) - (z.jd < a.jd ? 1 : 0));
}

/**
 * Published end-of-support dates of the operating systems that run self-service devices (the vendor's lifecycle
 * pages; a starting value for `asset.os_eos_date` — the organisation checks and corrects it). Most specific first.
 */
export const OS_LIFECYCLE: { match: RegExp; label: string; eos: string }[] = [
  { match: /windows\s*11.*iot.*ltsc\s*2024|windows\s*11.*ltsc\s*2024/i, label: "Windows 11 IoT Enterprise LTSC 2024", eos: "2034-10-10" },
  { match: /windows\s*10.*iot.*(ltsc\s*2021|2021\s*ltsc)/i, label: "Windows 10 IoT Enterprise LTSC 2021", eos: "2032-01-13" },
  { match: /windows\s*10.*(ltsc\s*2021|2021\s*ltsc)/i, label: "Windows 10 Enterprise LTSC 2021", eos: "2027-01-12" },
  { match: /windows\s*10.*(ltsc\s*2019|2019\s*ltsc)/i, label: "Windows 10 Enterprise LTSC 2019", eos: "2029-01-09" },
  { match: /windows\s*10.*(ltsb\s*2016|2016\s*ltsb)/i, label: "Windows 10 Enterprise LTSB 2016", eos: "2026-10-13" },
  { match: /windows\s*10.*(ltsb\s*2015|2015\s*ltsb)/i, label: "Windows 10 Enterprise LTSB 2015", eos: "2025-10-14" },
  { match: /embedded\s*standard\s*7|windows\s*7\s*embedded|wes\s*7/i, label: "Windows Embedded Standard 7", eos: "2020-10-13" },
  { match: /windows\s*7/i, label: "Windows 7", eos: "2020-01-14" },
  { match: /windows\s*xp/i, label: "Windows XP", eos: "2014-04-08" },
];

/** The published end of support of an operating system name, or null. */
export function osEndOfSupport(name: unknown): string | null {
  const text = String(name ?? "").trim();
  if (!text) return null;
  return OS_LIFECYCLE.find((o) => o.match.test(text))?.eos ?? null;
}

/** End-of-support buckets of a device (today, within 180 days, later, unknown). */
export function eosBucket(today: string, eos: unknown): "past" | "soon" | "ok" | "unknown" {
  const days = daysTo(today, eos);
  if (days === null) return "unknown";
  return days < 0 ? "past" : days <= 180 ? "soon" : "ok";
}

// ---------------------------------------------------------------------------------------------------------------
// Asset tags («پلاک اموال») and attestation periods

/** An asset tag from the organisation's pattern: {prefix}, {branch}, {class}, {year}, {seq}; null when nothing fits. */
export function tagFromPattern(pattern: string, v: { prefix?: string | null; branch?: string | null; cls?: string | null; year?: number | null; number?: string | null }): string | null {
  const seq = String(v.number ?? "").replace(/\D/g, "");
  if (!pattern || !seq) return null;
  const out = pattern
    .replaceAll("{prefix}", v.prefix ?? "")
    .replaceAll("{branch}", (v.branch ?? "").replace(/\s+/g, ""))
    .replaceAll("{class}", v.cls ?? "")
    .replaceAll("{year}", v.year ? String(v.year) : "")
    .replaceAll("{seq}", seq)
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return out.slice(0, 60) || null;
}

/** The attestation period that contains `today` when attestations run every `months` months from 1 Farvardin. */
export function attestationPeriod(today: string, months: number): { label: string; start: string; end: string; key: string } | null {
  if (!months || months < 1) return null;
  const j = toJalali(today);
  const index = Math.floor((j.jm - 1) / months);
  const firstMonth = index * months + 1;
  const lastMonth = Math.min(12, firstMonth + months - 1);
  const start = fromJalali(j.jy, firstMonth, 1);
  const end = fromJalali(j.jy, lastMonth, monthLength(j.jy, lastMonth));
  const label = months === 12 ? `سال ${j.jy}` : months === 6 ? `${j.jy} — نیمهٔ ${index === 0 ? "نخست" : "دوم"}` : months === 3 ? `${j.jy} — فصل ${index + 1}` : `${j.jy} — دورهٔ ${index + 1}`;
  return { label, start, end, key: `${j.jy}-${months}-${index + 1}` };
}

/** The due date of an attestation opened on `today`. */
export const attestationDue = (today: string, days: number): string => addDays(today, Math.max(1, days));
