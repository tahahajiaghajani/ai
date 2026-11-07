// The access areas: what a role grants rights in. Every TableDef names its `area`; modules declare the areas they
// add with `registerArea` (next to their tables), so the permission matrix, the access checker and the docs list
// them without a central edit. The platform's six areas of the provisional model (settings, users, integrations,
// ai, reports, work) keep their keys: `work` is «کارها» (the generic `todo` table and saved views) and `reports` the
// report area. Imported by the UI: keep it free of server imports.
import { AREAS as PLATFORM_AREAS, type Area } from "../permissions";

export type AreaGroup = "service" | "operations" | "assets" | "business" | "platform";

export interface AreaInfo {
  key: string;
  label: string;
  group: AreaGroup;
  /** owning module (informational) */
  module?: string;
  /** shown last in the matrix, never offered to requesters by the presets */
  platform?: boolean;
}

export const AREA_GROUPS: Record<AreaGroup, string> = {
  service: "خدمت و پشتیبانی",
  operations: "عملیات و تغییر",
  assets: "پیکربندی و دارایی",
  business: "کسب‌وکار و سازمان",
  platform: "سکو و پیکربندی",
};

const BUILTIN: AreaInfo[] = [
  { key: "incident", label: "رخدادها", group: "service" },
  { key: "request", label: "درخواست‌های خدمت", group: "service" },
  { key: "catalog", label: "کاتالوگ خدمات", group: "service" },
  { key: "knowledge", label: "دانش", group: "service" },
  { key: "problem", label: "مشکلات", group: "service" },
  { key: "sla", label: "توافق سطح خدمت", group: "service" },
  { key: "survey", label: "نظرسنجی", group: "service" },
  { key: "csm", label: "خدمات مشتریان", group: "service" },
  { key: "work", label: "کارها", group: "service" },
  { key: "change", label: "تغییرها", group: "operations" },
  { key: "release", label: "انتشارها", group: "operations" },
  { key: "event", label: "رویدادهای پایش", group: "operations" },
  { key: "oncall", label: "آماده‌به‌کار", group: "operations" },
  { key: "security", label: "امنیت", group: "operations" },
  { key: "continuity", label: "تداوم کسب‌وکار", group: "operations" },
  { key: "cmdb", label: "پیکربندی (CMDB)", group: "assets" },
  { key: "asset", label: "دارایی‌ها", group: "assets" },
  { key: "software", label: "نرم‌افزار و مجوزها", group: "assets" },
  { key: "contract", label: "قراردادها", group: "assets" },
  { key: "procurement", label: "تدارکات", group: "assets" },
  { key: "vendor", label: "تأمین‌کنندگان", group: "assets" },
  { key: "service", label: "سبد خدمات", group: "business" },
  { key: "risk", label: "ریسک", group: "business" },
  { key: "compliance", label: "انطباق", group: "business" },
  { key: "financial", label: "مالی", group: "business" },
  { key: "project", label: "پروژه‌ها", group: "business" },
  { key: "workforce", label: "نیروی کار", group: "business" },
  { key: "hr", label: "منابع انسانی", group: "business" },
  { key: "facilities", label: "پشتیبانی و تأسیسات", group: "business" },
  { key: "reports", label: "گزارش‌ها", group: "business" },
  { key: "org", label: "ساختار سازمانی", group: "platform", platform: true },
  { key: "users", label: "کاربران و نقش‌ها", group: "platform", platform: true },
  { key: "settings", label: "تنظیمات سازمان", group: "platform", platform: true },
  { key: "integrations", label: "اتصال‌ها و API", group: "platform", platform: true },
  { key: "ai", label: "هوش مصنوعی", group: "platform", platform: true },
  { key: "flows", label: "گردش‌کارها", group: "platform", platform: true },
  { key: "notifications", label: "اعلان‌ها", group: "platform", platform: true },
  { key: "audit", label: "ممیزی", group: "platform", platform: true },
];

const registry = new Map<string, AreaInfo>(BUILTIN.map((a) => [a.key, a]));

/** Add an area (a module's own, e.g. `registerArea({ key: "fsm", label: "خدمات میدانی", group: "service" })`). */
export function registerArea(info: AreaInfo): AreaInfo {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(info.key)) throw new Error(`area key "${info.key}" must be [a-z][a-z0-9_]*`);
  registry.set(info.key, { ...info });
  return info;
}

export function areaInfo(key: string): AreaInfo | undefined {
  return registry.get(key);
}

/** Every area, in matrix order (group, then registration order). */
export function areas(): AreaInfo[] {
  const order = Object.keys(AREA_GROUPS);
  return [...registry.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

export const isArea = (key: string) => registry.has(key);

export const areaLabel = (key: string) => registry.get(key)?.label ?? key;

/**
 * The membership role's areas (`@shared/permissions`: settings, users, integrations, ai, reports, work): a member
 * without ITSM roles keeps exactly the access the membership role gave in these (docs/spec/ACCESS.md § Legacy mode).
 */
export const MEMBERSHIP_AREAS = Object.keys(PLATFORM_AREAS) as Area[];
export const isMembershipArea = (key: string): key is Area => (MEMBERSHIP_AREAS as string[]).includes(key);
