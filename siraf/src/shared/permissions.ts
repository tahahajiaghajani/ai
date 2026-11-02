// Roles and permissions. A member has a role (default levels per area) and optional
// per-area overrides. Levels are ordered: none < view < edit < full (full = delete/approve).

export type Level = "none" | "view" | "edit" | "full";
export const LEVEL_ORDER: Level[] = ["none", "view", "edit", "full"];

export const AREAS = {
  accounting: "حسابداری و اسناد",
  treasury: "خزانه‌داری (دریافت، پرداخت، چک)",
  parties: "اشخاص",
  sales: "فروش",
  purchases: "خرید",
  inventory: "انبار و کالا",
  gold: "طلا و جواهر",
  fx: "صرافی و ارز",
  reports: "گزارش‌ها",
  settings: "تنظیمات",
  users: "کاربران و دسترسی‌ها",
  integrations: "اتصال‌ها و API",
  ai: "هوش مصنوعی و دستیار",
} as const;
export type Area = keyof typeof AREAS;

export type Role = "owner" | "admin" | "accountant" | "sales" | "cashier" | "warehouse" | "viewer";

/**
 * Access levels. The platform super admin (the creator, tz_users.is_platform_admin) stands above
 * every business; inside a business there are three main levels — owner, accountant (full
 * operations and viewing, may manage AI keys) and viewer (read only) — plus "more roles": presets
 * for common jobs that an owner can still adjust area by area.
 */
export const CORE_ROLES = ["owner", "accountant", "viewer"] as const satisfies readonly Role[];
export const PRESET_ROLES = ["admin", "sales", "cashier", "warehouse"] as const satisfies readonly Role[];

export const ROLES: Record<Role, { title: string; levels: Partial<Record<Area, Level>>; all?: Level; kind: "core" | "preset"; about: string }> = {
  owner: { title: "مالک", kind: "core", about: "همهٔ کارها، از جمله کاربران، تنظیمات و کلیدهای هوش مصنوعی", levels: {}, all: "full" },
  accountant: {
    title: "حسابدار",
    kind: "core",
    about: "همهٔ عملیات و گزارش‌ها، اتصال‌ها و کلیدهای هوش مصنوعی؛ کاربران را فقط می‌بیند",
    levels: {
      accounting: "full", treasury: "full", parties: "full", sales: "full", purchases: "full",
      inventory: "full", gold: "full", fx: "full", reports: "full", settings: "edit", users: "view", integrations: "full", ai: "full",
    },
  },
  viewer: {
    title: "ناظر",
    kind: "core",
    about: "فقط مشاهدهٔ عملیات و گزارش‌ها و پرسش از دستیار؛ بدون تغییر",
    levels: {
      accounting: "view", treasury: "view", parties: "view", sales: "view", purchases: "view",
      inventory: "view", gold: "view", fx: "view", reports: "view", settings: "view", users: "none", integrations: "none", ai: "view",
    },
  },
  admin: { title: "مدیر", kind: "preset", about: "مانند مالک، جز تغییر مالکان", levels: {}, all: "full" },
  sales: {
    title: "فروشنده",
    kind: "preset",
    about: "فروش، دریافت و اشخاص؛ مشاهدهٔ انبار و گزارش‌ها",
    levels: { parties: "edit", sales: "edit", inventory: "view", gold: "edit", fx: "edit", reports: "view", treasury: "edit", ai: "view" },
  },
  cashier: {
    title: "صندوقدار",
    kind: "preset",
    about: "صندوق، دریافت و پرداخت و فروش پیشخوان",
    levels: { treasury: "edit", parties: "edit", sales: "edit", gold: "edit", fx: "edit", reports: "view", ai: "view" },
  },
  warehouse: {
    title: "انباردار",
    kind: "preset",
    about: "انبار و کالا؛ مشاهدهٔ خرید و فروش",
    levels: { inventory: "full", parties: "view", purchases: "view", sales: "view", reports: "view", ai: "view" },
  },
};

export function levelOf(role: Role, area: Area, overrides?: Partial<Record<Area, Level>> | null): Level {
  const o = overrides?.[area];
  if (o) return o;
  const r = ROLES[role] ?? ROLES.viewer;
  if (r.all) return area === "users" && role !== "owner" && role !== "admin" ? "none" : r.all;
  return r.levels[area] ?? "none";
}

export function can(role: Role, area: Area, need: Level, overrides?: Partial<Record<Area, Level>> | null): boolean {
  return LEVEL_ORDER.indexOf(levelOf(role, area, overrides)) >= LEVEL_ORDER.indexOf(need);
}

export function permissionMap(role: Role, overrides?: Partial<Record<Area, Level>> | null): Record<Area, Level> {
  const out = {} as Record<Area, Level>;
  for (const a of Object.keys(AREAS) as Area[]) out[a] = levelOf(role, a, overrides);
  return out;
}

/** The areas in which `a` gives more than `b` (e.g. a grant above the granter's own access). */
export function areasAbove(a: Record<Area, Level>, b: Record<Area, Level>): Area[] {
  return (Object.keys(AREAS) as Area[]).filter((k) => LEVEL_ORDER.indexOf(a[k] ?? "none") > LEVEL_ORDER.indexOf(b[k] ?? "none"));
}
