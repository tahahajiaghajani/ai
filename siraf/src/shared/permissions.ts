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
} as const;
export type Area = keyof typeof AREAS;

export type Role = "owner" | "admin" | "accountant" | "sales" | "cashier" | "warehouse" | "viewer";

export const ROLES: Record<Role, { title: string; levels: Partial<Record<Area, Level>>; all?: Level }> = {
  owner: { title: "مالک", levels: {}, all: "full" },
  admin: { title: "مدیر", levels: {}, all: "full" },
  accountant: {
    title: "حسابدار",
    levels: {
      accounting: "full", treasury: "full", parties: "full", sales: "full", purchases: "full",
      inventory: "edit", gold: "edit", fx: "edit", reports: "view", settings: "view", users: "none", integrations: "view",
    },
  },
  sales: {
    title: "فروشنده",
    levels: { parties: "edit", sales: "edit", inventory: "view", gold: "edit", fx: "edit", reports: "view", treasury: "edit" },
  },
  cashier: {
    title: "صندوقدار",
    levels: { treasury: "edit", parties: "edit", sales: "edit", gold: "edit", fx: "edit", reports: "view" },
  },
  warehouse: {
    title: "انباردار",
    levels: { inventory: "full", parties: "view", purchases: "view", sales: "view", reports: "view" },
  },
  viewer: {
    title: "ناظر (فقط مشاهده)",
    levels: {}, all: "view",
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
