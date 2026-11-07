// Roles and permissions of the platform. A member has a role (default levels per area) and optional
// per-area overrides. Levels are ordered: none < view < edit < full (full = delete/approve/manage).
//
// This is the platform's provisional access model: a handful of areas that every organisation has
// (its settings, its members, integrations, AI and reports). Later modules add their own areas here
// (and to the roles below) and check them with `ctx.need(area, level)` on the server and `can()` in the UI.

export type Level = "none" | "view" | "edit" | "full";
export const LEVEL_ORDER: Level[] = ["none", "view", "edit", "full"];

export const AREAS = {
  settings: "تنظیمات سازمان",
  users: "کاربران و دسترسی‌ها",
  integrations: "اتصال‌ها و API",
  ai: "هوش مصنوعی و دستیار",
  reports: "گزارش‌ها",
} as const;
export type Area = keyof typeof AREAS;

export type Role = "owner" | "admin" | "member" | "viewer";

/**
 * Access levels. The platform super admin (the creator, sm_users.is_platform_admin) stands above every
 * organisation; inside an organisation there are three main levels — owner, member (works in the
 * organisation, sees its members, asks the assistant and prepares drafts) and viewer (read only) — plus
 * "more roles": presets that an owner can still adjust area by area (today the manager «مدیر», the owner's
 * deputy).
 */
export const CORE_ROLES = ["owner", "member", "viewer"] as const satisfies readonly Role[];
export const PRESET_ROLES = ["admin"] as const satisfies readonly Role[];

export const ROLES: Record<Role, { title: string; levels: Partial<Record<Area, Level>>; all?: Level; kind: "core" | "preset"; about: string }> = {
  owner: { title: "مالک", kind: "core", about: "همهٔ کارها، از جمله کاربران، تنظیمات و کلیدهای هوش مصنوعی", levels: {}, all: "full" },
  member: {
    title: "عضو",
    kind: "core",
    about: "کار در سازمان، دیدن اعضا و گزارش‌ها، پرسش از دستیار و آماده کردن پیش‌نویس؛ بدون تغییر تنظیمات",
    levels: { settings: "view", users: "view", integrations: "none", ai: "edit", reports: "view" },
  },
  viewer: {
    title: "ناظر",
    kind: "core",
    about: "فقط مشاهده و پرسش از دستیار؛ بدون تغییر",
    levels: { settings: "view", users: "none", integrations: "none", ai: "view", reports: "view" },
  },
  admin: { title: "مدیر", kind: "preset", about: "مانند مالک، جز تغییر مالکان", levels: {}, all: "full" },
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

/** A membership's role and per-area access, for the rule below. */
export interface MemberGrant {
  user_id: string;
  role: Role;
  overrides: Partial<Record<Area, Level>> | null;
}

/** Who is changing memberships: their account, role and effective levels; `support` for a support session. */
export interface MemberActor {
  user_id: string;
  role: Role;
  permissions: Record<Area, Level>;
  support?: boolean;
}

export const OWNER_ONLY_MESSAGE = "فقط مالک می‌تواند نقش مالک را تغییر دهد";

const sameOverrides = (a: MemberGrant["overrides"], b: MemberGrant["overrides"]) => {
  const norm = (o: MemberGrant["overrides"]) =>
    JSON.stringify(Object.entries(o ?? {}).filter(([, v]) => !!v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return norm(a) === norm(b);
};

/** True when two grants give the same role and per-area access. */
export const sameGrant = (a: MemberGrant, b: MemberGrant) => a.role === b.role && sameOverrides(a.overrides, b.overrides);

/**
 * Who may change a membership — one rule for the members API, member rows pushed by a Windows app
 * and the members page (which offers only what this allows):
 * - only an owner gives, changes or takes the owner role;
 * - below the owner, nobody changes their own role or per-area access, nobody touches a member who
 *   has more access than they do, and nobody gives more access than they have.
 * Returns why `actor` may not turn `before` (null: a new membership) into `after` (null: deactivated
 * or removed), or null when the change is allowed. The caller has already checked users:edit.
 */
export function memberChangeRule(actor: MemberActor, before: MemberGrant | null, after: MemberGrant | null): string | null {
  if ((before?.role === "owner" || after?.role === "owner") && (actor.role !== "owner" || actor.support)) return OWNER_ONLY_MESSAGE;
  if (actor.support) return "اعضای سازمان را خود سازمان تغییر می‌دهد";
  if (before && after && after.user_id && before.user_id !== after.user_id) return "عضویت به حساب دیگری منتقل نمی‌شود";
  if (actor.role === "owner") return null;
  if (before && before.user_id === actor.user_id && (!after || !sameGrant(before, after)))
    return "نقش و دسترسی‌های خودتان را نمی‌توانید تغییر دهید؛ این کار با مالک است";
  if (before) {
    const above = areasAbove(permissionMap(before.role, before.overrides), actor.permissions);
    if (above.length) return `دسترسی این عضو در «${AREAS[above[0]]}» از شما بیشتر است؛ تغییر آن با مالک است`;
  }
  if (after) {
    const above = areasAbove(permissionMap(after.role, after.overrides), actor.permissions);
    if (above.length) return `نمی‌توانید در «${AREAS[above[0]]}» دسترسی‌ای بیشتر از دسترسی خودتان بدهید`;
  }
  return null;
}
