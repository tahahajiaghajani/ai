// Plans, limits and feature flags (catalogue ADM-016, ADM-025, ADM-034): pure rules shared by the platform owner's
// console, the tenant console and the server. A plan names its limits (absent = no ceiling) and the flags it
// includes; an organisation's plan and its own overrides are { plan, <limit>: n } in its platform state. A flag is on
// for an organisation when no gate says no: the organisation switched off or on by name, the plan, the stage and its
// roll-out share, and the tenant administrator's own switch — `flagState` says which gate decided, in Persian.
// Imported by the UI: keep it free of server imports.

export type LimitKey = "members" | "custom_tables" | "custom_fields" | "integration_users" | "api_rate" | "webhooks" | "storage_mb";

export interface LimitInfo {
  key: LimitKey;
  label: string;
  unit: string;
  /** what happens at the ceiling (shown where something is refused) */
  blocks: string;
}

export const LIMITS: LimitInfo[] = [
  { key: "members", label: "اعضای فعال", unit: "نفر", blocks: "عضو تازه از ورود گروهی، فهرست کاربران و SCIM اضافه نمی‌شود" },
  { key: "custom_tables", label: "جدول‌های سفارشی", unit: "جدول", blocks: "جدول سفارشی تازه ساخته نمی‌شود" },
  { key: "custom_fields", label: "فیلدهای سفارشی", unit: "فیلد", blocks: "فیلد سفارشی تازه ساخته نمی‌شود" },
  { key: "integration_users", label: "کاربران یکپارچه‌سازی", unit: "کاربر", blocks: "کاربر یکپارچه‌سازی تازه ساخته نمی‌شود" },
  { key: "api_rate", label: "سقف درخواست API در دقیقه (هر کلید)", unit: "درخواست", blocks: "درخواست‌های بیشتر پاسخ ۴۲۹ می‌گیرند" },
  { key: "webhooks", label: "اشتراک‌های وب‌هوک", unit: "اشتراک", blocks: "اشتراک وب‌هوک تازه ساخته نمی‌شود" },
  { key: "storage_mb", label: "فضای پیوست‌ها", unit: "مگابایت", blocks: "فقط هشدار داده می‌شود" },
];

export const LIMIT_KEYS = LIMITS.map((l) => l.key);
export const limitInfo = (k: string) => LIMITS.find((l) => l.key === k);

export type Limits = Partial<Record<LimitKey, number>>;

export interface PlanRow {
  key: string;
  name: string;
  description: string | null;
  limits: Limits;
  features: string[];
  sort_order: number;
  is_default: boolean;
  active: boolean;
}

/** Only known limit keys with whole, non-negative numbers (null/absent = no ceiling). */
export function cleanLimits(raw: unknown): Limits {
  const out: Limits = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of LIMIT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
  }
  return out;
}

/** An organisation's limits: its plan's, with its own overrides on top (an override may lift or lower one). */
export function effectiveLimits(plan: Pick<PlanRow, "limits"> | null, overrides: Limits = {}): Limits {
  return { ...cleanLimits(plan?.limits ?? {}), ...cleanLimits(overrides) };
}

export type LimitTone = "ok" | "warning" | "danger";

/** How close a count is to its ceiling: warning from 80 %, danger at the ceiling. */
export function limitTone(used: number, limit: number | undefined): LimitTone {
  if (limit === undefined) return "ok";
  if (used >= limit) return "danger";
  return used >= limit * 0.8 ? "warning" : "ok";
}

/** null when `used + adding` stays within the ceiling, else the Persian refusal. */
export function limitProblem(key: LimitKey, used: number, adding: number, limits: Limits): string | null {
  const limit = limits[key];
  if (limit === undefined) return null;
  if (used + adding <= limit) return null;
  const info = limitInfo(key)!;
  return `سقف «${info.label}» در طرح سازمان ${limit.toLocaleString("fa-IR")} ${info.unit} است (اکنون ${used.toLocaleString("fa-IR")})؛ برای افزایش با مدیر سامانه تماس بگیرید`;
}

// ---------------------------------------------------------------- feature flags

export type FlagStage = "off" | "beta" | "on";
export const FLAG_STAGES: Record<FlagStage, string> = { off: "خاموش", beta: "آزمایشی", on: "روشن" };

export interface FlagRow {
  key: string;
  label: string;
  description: string | null;
  stage: FlagStage;
  /** roll-out share of a beta flag, 0–100 */
  percent: number;
  /** plans that include it (empty = every plan) */
  plans: string[];
  orgs_on: string[];
  orgs_off: string[];
  /** tenant administrators may switch it off for their organisation */
  tenant_toggle: boolean;
}

export type FlagGate = "org_off" | "org_on" | "plan" | "stage" | "rollout" | "tenant" | "on";

export interface FlagState {
  key: string;
  label: string;
  on: boolean;
  /** the gate that decided */
  gate: FlagGate;
  /** Persian reason, shown where something is unavailable */
  reason: string;
  /** the tenant administrator may switch it (on and off) */
  toggle: boolean;
}

/** A stable 0–99 bucket of an organisation for a flag (the same organisation always lands in the same bucket). */
export function rolloutBucket(orgId: string, key: string): number {
  let h = 2166136261;
  for (const ch of `${key}:${orgId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100;
}

/**
 * Whether `flag` is on for an organisation: switched off by name > switched on by name > the plan > the stage (and a
 * beta's roll-out share) > the tenant administrator's switch (`tenant`: false = they switched it off).
 */
export function flagState(flag: FlagRow, org: { id: string; plan: string | null; tenant?: boolean | null }): FlagState {
  const base = { key: flag.key, label: flag.label, toggle: false };
  if (flag.orgs_off.includes(org.id)) return { ...base, on: false, gate: "org_off", reason: "مدیر سامانه این قابلیت را برای این سازمان خاموش کرده است" };
  if (!flag.orgs_on.includes(org.id)) {
    if (flag.plans.length && !(org.plan && flag.plans.includes(org.plan)))
      return { ...base, on: false, gate: "plan", reason: "این قابلیت در طرح فعلی سازمان نیست؛ برای ارتقای طرح با مدیر سامانه تماس بگیرید" };
    if (flag.stage === "off") return { ...base, on: false, gate: "stage", reason: "این قابلیت هنوز عرضه نشده است" };
    if (flag.stage === "beta" && rolloutBucket(org.id, flag.key) >= flag.percent)
      return { ...base, on: false, gate: "rollout", reason: "این قابلیت آزمایشی است و هنوز به این سازمان نرسیده؛ برای دسترسی زودهنگام با مدیر سامانه تماس بگیرید" };
  }
  const toggle = flag.tenant_toggle;
  if (toggle && org.tenant === false) return { ...base, toggle, on: false, gate: "tenant", reason: "مدیر سازمان این قابلیت را خاموش کرده است" };
  return { ...base, toggle, on: true, gate: flag.orgs_on.includes(org.id) ? "org_on" : "on", reason: flag.stage === "beta" ? "روشن (آزمایشی)" : "روشن" };
}

/** A flag key: lower-case Latin, digits and _ (the code names them). */
export const FLAG_KEY = /^[a-z][a-z0-9_]{1,40}$/;
/** A plan key. */
export const PLAN_KEY = /^[a-z][a-z0-9_]{1,30}$/;
