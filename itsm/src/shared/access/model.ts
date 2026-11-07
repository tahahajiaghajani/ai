// The ITSM access model's vocabulary — scopes, grants, roles — and the pure functions that turn a member's roles into
// their effective access (docs/spec/ACCESS.md). The server evaluates rows with it (src/server/access), the UI shows
// and edits it (the permission matrix, the access checker). Imported by the UI: keep it free of server imports.
import type { FieldGroup } from "../model/types";
import { FIELD_GROUPS } from "../model/types";
import { LEVEL_ORDER, type Area, type Level, type Role as MembershipRole } from "../permissions";
import { areas, isArea, MEMBERSHIP_AREAS, isMembershipArea } from "./areas";

// ----- scopes -------------------------------------------------------------------------------------------------

/** How far a grant reaches, ordered: none < own < group < unit < unit_tree < domain < all. */
export type Scope = "none" | "own" | "group" | "unit" | "unit_tree" | "domain" | "all";
export const SCOPES: Scope[] = ["none", "own", "group", "unit", "unit_tree", "domain", "all"];
export const SCOPE_LABELS: Record<Scope, string> = {
  none: "هیچ",
  own: "مال خودم",
  group: "گروه‌های من",
  unit: "واحد من",
  unit_tree: "واحد من و زیرمجموعه‌ها",
  domain: "دامنهٔ من",
  all: "همه",
};
export const SCOPE_HINTS: Record<Scope, string> = {
  none: "هیچ رکوردی",
  own: "رکوردهایی که درخواست‌دهنده، ذی‌نفع، ثبت‌کننده، کارشناس یا پیگیری‌کنندهٔ آن‌هاست",
  group: "به‌علاوهٔ رکوردهای ارجاع‌شده به گروه‌هایش",
  unit: "به‌علاوهٔ رکوردهای افراد واحد سازمانی‌اش",
  unit_tree: "به‌علاوهٔ رکوردهای واحدش و همهٔ زیرمجموعه‌های آن",
  domain: "همهٔ رکوردهای دامنهٔ او (در جداسازی دامنه‌ها)",
  all: "همهٔ رکوردهای سازمان",
};
export const scopeRank = (s: Scope | undefined | null): number => SCOPES.indexOf(s ?? "none");
export const maxScope = (a: Scope, b: Scope): Scope => (scopeRank(a) >= scopeRank(b) ? a : b);
export const isScope = (s: unknown): s is Scope => typeof s === "string" && (SCOPES as string[]).includes(s);

// ----- grants -------------------------------------------------------------------------------------------------

/** Operations of an area: three scoped ones and three flags. */
export type Op = "read" | "create" | "write" | "delete" | "approve" | "admin";
export const OPS: Op[] = ["read", "create", "write", "delete", "approve", "admin"];
export const SCOPED_OPS = ["read", "write", "delete"] as const;
export const FLAG_OPS = ["create", "approve", "admin"] as const;
export type ScopedOp = (typeof SCOPED_OPS)[number];
export type FlagOp = (typeof FLAG_OPS)[number];
export const OP_LABELS: Record<Op, string> = {
  read: "مشاهده",
  create: "ایجاد",
  write: "ویرایش",
  delete: "حذف",
  approve: "تأیید",
  admin: "مدیریت",
};

/** What a role grants in one area (missing keys = nothing). */
export interface Grant {
  read?: Scope;
  create?: boolean;
  write?: Scope;
  delete?: Scope;
  approve?: boolean;
  admin?: boolean;
}

/** Grants per area key; the key "*" applies to every area a role does not name (tenant_admin, auditor). */
export type Grants = Record<string, Grant>;

/** A grant with every operation spelled out. */
export interface FullGrant {
  read: Scope;
  create: boolean;
  write: Scope;
  delete: Scope;
  approve: boolean;
  admin: boolean;
}

export const NO_GRANT: Readonly<FullGrant> = Object.freeze({ read: "none", create: false, write: "none", delete: "none", approve: false, admin: false });

/**
 * A grant with defaults filled in and made coherent: what one may change or delete one may also read (read is
 * raised to the write/delete scope) and whoever may create reads at least their own records.
 */
export function fullGrant(g: Grant | undefined | null): FullGrant {
  if (!g) return { ...NO_GRANT };
  const write = isScope(g.write) ? g.write : "none";
  const del = isScope(g.delete) ? g.delete : "none";
  let read = maxScope(maxScope(isScope(g.read) ? g.read : "none", write), del);
  if (g.create && read === "none") read = "own";
  return { read, create: !!g.create, write, delete: del, approve: !!g.approve, admin: !!g.admin };
}

/** The more permissive of two grants, operation by operation. */
export function mergeGrants(a: FullGrant, b: FullGrant): FullGrant {
  return {
    read: maxScope(a.read, b.read),
    create: a.create || b.create,
    write: maxScope(a.write, b.write),
    delete: maxScope(a.delete, b.delete),
    approve: a.approve || b.approve,
    admin: a.admin || b.admin,
  };
}

export const sameGrant = (a: FullGrant, b: FullGrant) => OPS.every((op) => a[op] === b[op]);

/** A grant written the short way (only what it gives), for storage and diffs. */
export function compactGrant(g: FullGrant): Grant {
  const out: Grant = {};
  for (const op of SCOPED_OPS) if (g[op] !== "none") out[op] = g[op];
  for (const op of FLAG_OPS) if (g[op]) out[op] = true;
  return out;
}

// ----- roles --------------------------------------------------------------------------------------------------

export type Persona = "requester" | "agent" | "admin";
export const PERSONAS: Record<Persona, string> = { requester: "درخواست‌دهنده", agent: "کارشناس", admin: "مدیر" };

export interface RoleDef {
  key: string;
  name: string;
  description?: string;
  persona: Persona;
  grants: Grants;
  field_groups: FieldGroup[];
  /** roles whose grants this one includes (a cycle-free graph) */
  contains: string[];
  /** "member": records of the workspaces the member belongs to (and global ones); "all": every workspace but secure ones */
  workspaces: "member" | "all";
  /** "own": the member's domain subtree when the organisation separates domains; "all": every domain */
  domains: "own" | "all";
  active?: boolean;
}

export const ROLE_KEY = /^[a-z][a-z0-9_]{1,40}$/;

/** The roles `keys` stand for, with every role they contain (unknown and inactive roles are skipped; cycles are harmless). */
export function roleClosure(keys: Iterable<string>, catalog: ReadonlyMap<string, RoleDef>): string[] {
  const out = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    const r = catalog.get(k);
    if (!r || r.active === false) continue;
    out.add(k);
    for (const c of r.contains ?? []) stack.push(c);
  }
  return [...out].sort();
}

/**
 * Would role `key` containing `contains` close a loop? Returns the loop as role keys ("a → b → a") or null.
 * `catalog` is the organisation's roles before the change.
 */
export function containmentCycle(key: string, contains: string[], catalog: ReadonlyMap<string, RoleDef>): string[] | null {
  const seen = new Set<string>();
  const walk = (k: string, path: string[]): string[] | null => {
    if (k === key) return [...path, k];
    if (seen.has(k)) return null;
    seen.add(k);
    for (const c of catalog.get(k)?.contains ?? []) {
      const loop = walk(c, [...path, k]);
      if (loop) return loop;
    }
    return null;
  };
  for (const c of contains) {
    const loop = walk(c, [key]);
    if (loop) return loop;
  }
  return null;
}

/** The effective access of a subject: every operation is the most permissive of their roles'. */
export interface Effective {
  /** role keys (containment resolved), sorted */
  roles: string[];
  /** per area key, plus "*" for every other area */
  grants: Record<string, FullGrant>;
  fieldGroups: FieldGroup[];
  workspacesAll: boolean;
  domainsAll: boolean;
  /** no ITSM roles assigned: the membership role's areas keep the membership role's levels */
  legacy: boolean;
}

/** The grant of `area` in an effective access. */
export function grantIn(eff: Pick<Effective, "grants">, area: string): FullGrant {
  return eff.grants[area] ?? eff.grants["*"] ?? NO_GRANT;
}

/** Combine roles (already a closure): per area the most permissive grant; field groups, workspaces, domains united. */
export function combineRoles(roles: RoleDef[]): Pick<Effective, "grants" | "fieldGroups" | "workspacesAll" | "domainsAll"> {
  const keys = new Set<string>();
  for (const r of roles) for (const k of Object.keys(r.grants ?? {})) keys.add(k);
  const grants: Record<string, FullGrant> = {};
  for (const k of keys) {
    let g: FullGrant = { ...NO_GRANT };
    for (const r of roles) {
      const own = r.grants?.[k] ?? (k === "*" ? undefined : r.grants?.["*"]);
      if (own) g = mergeGrants(g, fullGrant(own));
    }
    grants[k] = g;
  }
  const groups = new Set<FieldGroup>();
  for (const r of roles) for (const g of r.field_groups ?? []) if (g in FIELD_GROUPS) groups.add(g);
  return {
    grants,
    fieldGroups: [...groups].sort(),
    workspacesAll: roles.some((r) => r.workspaces === "all"),
    domainsAll: roles.some((r) => r.domains === "all"),
  };
}

/** The grant a membership-role level stands for in its area (view: read all; edit: + create and change; full: everything). */
export function levelGrant(level: Level): FullGrant {
  const rank = LEVEL_ORDER.indexOf(level);
  return {
    read: rank >= 1 ? "all" : "none",
    create: rank >= 2,
    write: rank >= 2 ? "all" : "none",
    delete: rank >= 3 ? "all" : "none",
    approve: rank >= 3,
    admin: rank >= 3,
  };
}

/** The field groups the membership role carries while a member has no ITSM roles (viewers: none, like before). */
export const MEMBERSHIP_FIELD_GROUPS: Record<MembershipRole, FieldGroup[]> = {
  owner: ["admin", "ai_private", "financial", "internal", "personal"],
  admin: ["admin", "ai_private", "financial", "internal", "personal"],
  member: ["internal", "personal"],
  viewer: [],
};

/** Field groups a support session does not read (restricted data needs a member's explicit role). */
export const SUPPORT_EXCLUDED_GROUPS: FieldGroup[] = ["hr", "security", "ai_private"];

/** The ITSM role a member without ITSM roles works as in the ITSM areas (legacy mode). */
export const MEMBERSHIP_FALLBACK: Record<MembershipRole, string> = {
  owner: "tenant_admin",
  admin: "tenant_admin",
  member: "agent",
  viewer: "auditor",
};

export interface ComposeInput {
  /** the membership role (null in a support session) */
  role: MembershipRole | null;
  /** the levels of the membership-role areas (the member's permission map, or the support session's) */
  levels: Partial<Record<Area, Level>>;
  /** ITSM roles assigned to the member: on their profile and through their groups */
  explicit: string[];
  catalog: ReadonlyMap<string, RoleDef>;
  /** a platform administrator's support session */
  support?: "view" | "edit" | null;
}

/**
 * A subject's effective access.
 * - Members with ITSM roles: the closure of their roles (owners and the membership role «مدیر» also hold
 *   tenant_admin).
 * - Members without ITSM roles (legacy mode, every member of an organisation that has not assigned roles yet): in the
 *   membership-role areas exactly the membership role's levels (and its field groups); elsewhere the role it maps to
 *   (owner/admin → tenant_admin, member → agent, viewer → auditor).
 * - Support sessions: «مشاهده» reads everything, «مشاهده و اصلاح» works like tenant_admin; in the membership-role
 *   areas both keep the session's levels (members are never changed, keys only seen). Like a tenant admin, a session
 *   does not read the HR, security and AI-private field groups (nor, in the subject, secure workspaces and restricted
 *   groups).
 */
export function composeEffective(input: ComposeInput): Effective {
  const { catalog } = input;
  const membership = (eff: Effective) => {
    for (const a of MEMBERSHIP_AREAS) eff.grants[a] = levelGrant(input.levels[a] ?? "none");
    return eff;
  };
  if (input.support) {
    const admin = catalog.get("tenant_admin");
    const base: Effective =
      input.support === "edit" && admin
        ? { roles: ["tenant_admin"], ...combineRoles([admin]), legacy: false }
        : { roles: [], grants: { "*": fullGrant({ read: "all" }) }, fieldGroups: [], workspacesAll: true, domainsAll: true, legacy: false };
    // like a tenant admin: every field group but the HR and security ones, which take an explicit role
    base.fieldGroups = (Object.keys(FIELD_GROUPS) as FieldGroup[]).filter((g) => !SUPPORT_EXCLUDED_GROUPS.includes(g)).sort();
    base.workspacesAll = true;
    base.domainsAll = true;
    return membership(base);
  }
  const role = input.role ?? "viewer";
  const elevated = role === "owner" || role === "admin";
  const explicit = input.explicit.filter((k) => catalog.has(k));
  if (!explicit.length) {
    const keys = roleClosure([MEMBERSHIP_FALLBACK[role]], catalog);
    const c = combineRoles(keys.map((k) => catalog.get(k)!));
    const grants: Record<string, FullGrant> = {};
    for (const [k, g] of Object.entries(c.grants)) if (!isMembershipArea(k)) grants[k] = g;
    return membership({ roles: keys, grants, fieldGroups: [...MEMBERSHIP_FIELD_GROUPS[role]], workspacesAll: true, domainsAll: true, legacy: true });
  }
  const keys = roleClosure(elevated ? [...explicit, "tenant_admin"] : explicit, catalog);
  return { roles: keys, ...combineRoles(keys.map((k) => catalog.get(k)!)), legacy: false };
}

// ----- validation and diffs -----------------------------------------------------------------------------------

/** Why a role definition is not acceptable (Persian), or null. `catalog` = the organisation's roles before the change. */
export function roleProblem(r: RoleDef, catalog: ReadonlyMap<string, RoleDef>): string | null {
  if (!ROLE_KEY.test(r.key)) return "کلید نقش باید با حرف لاتین کوچک شروع شود و فقط حرف، رقم و _ داشته باشد";
  if (!String(r.name ?? "").trim()) return "نام نقش را وارد کنید";
  if (!(r.persona in PERSONAS)) return "پرسونای نقش معتبر نیست";
  if (r.workspaces !== "member" && r.workspaces !== "all") return "دامنهٔ فضاهای کاری معتبر نیست";
  if (r.domains !== "own" && r.domains !== "all") return "دامنهٔ دامنه‌ها معتبر نیست";
  for (const [area, g] of Object.entries(r.grants ?? {})) {
    if (area !== "*" && !isArea(area)) return `حوزهٔ «${area}» شناخته نیست`;
    if (!g || typeof g !== "object") return `مجوز «${area}» معتبر نیست`;
    for (const op of SCOPED_OPS) if (g[op] !== undefined && !isScope(g[op])) return `دامنهٔ «${OP_LABELS[op]}» در «${area}» معتبر نیست`;
    for (const op of FLAG_OPS) if (g[op] !== undefined && typeof g[op] !== "boolean") return `«${OP_LABELS[op]}» در «${area}» باید بله یا خیر باشد`;
  }
  for (const f of r.field_groups ?? []) if (!(f in FIELD_GROUPS)) return `گروه فیلد «${f}» شناخته نیست`;
  for (const c of r.contains ?? []) {
    if (c === r.key) return "نقش نمی‌تواند خودش را در بر بگیرد";
    if (!catalog.has(c)) return `نقش «${c}» وجود ندارد`;
  }
  const loop = containmentCycle(r.key, r.contains ?? [], catalog);
  if (loop) return `این شمول دور می‌سازد: ${loop.map((k) => catalog.get(k)?.name ?? k).join(" ← ")}`;
  return null;
}

/** One difference between two role definitions. */
export interface RoleChange {
  what: "grant" | "field_groups" | "contains" | "workspaces" | "domains" | "name" | "description" | "persona" | "active";
  area?: string;
  op?: Op;
  from: unknown;
  to: unknown;
}

/** What `role` changes compared with `base` (the built-in default), area by area and operation by operation. */
export function diffRole(base: RoleDef, role: RoleDef): RoleChange[] {
  const out: RoleChange[] = [];
  const areaKeys = new Set([...Object.keys(base.grants ?? {}), ...Object.keys(role.grants ?? {})]);
  for (const area of [...areaKeys].sort()) {
    const a = fullGrant(base.grants?.[area]);
    const b = fullGrant(role.grants?.[area]);
    for (const op of OPS) if (a[op] !== b[op]) out.push({ what: "grant", area, op, from: a[op], to: b[op] });
  }
  const set = (x: string[] | undefined) => [...new Set(x ?? [])].sort().join(",");
  if (set(base.field_groups) !== set(role.field_groups)) out.push({ what: "field_groups", from: [...(base.field_groups ?? [])].sort(), to: [...(role.field_groups ?? [])].sort() });
  if (set(base.contains) !== set(role.contains)) out.push({ what: "contains", from: [...(base.contains ?? [])].sort(), to: [...(role.contains ?? [])].sort() });
  for (const k of ["workspaces", "domains", "name", "description", "persona"] as const) {
    if ((base[k] ?? "") !== (role[k] ?? "")) out.push({ what: k, from: base[k] ?? null, to: role[k] ?? null });
  }
  if ((base.active ?? true) !== (role.active ?? true)) out.push({ what: "active", from: base.active ?? true, to: role.active ?? true });
  return out;
}

/**
 * Areas and operations in which `wanted` gives more than `own` (privilege escalation check: nobody defines or assigns
 * access above their own). Field groups count too.
 */
export function exceeds(wanted: Pick<Effective, "grants" | "fieldGroups" | "workspacesAll" | "domainsAll">, own: Pick<Effective, "grants" | "fieldGroups" | "workspacesAll" | "domainsAll">): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(wanted.grants), ...areas().map((a) => a.key)]);
  for (const area of keys) {
    if (area === "*") continue;
    const w = grantIn(wanted, area);
    const o = grantIn(own, area);
    for (const op of SCOPED_OPS) if (scopeRank(w[op]) > scopeRank(o[op])) out.push(`${area}.${op}`);
    for (const op of FLAG_OPS) if (w[op] && !o[op]) out.push(`${area}.${op}`);
  }
  for (const g of wanted.fieldGroups) if (!own.fieldGroups.includes(g)) out.push(`field:${g}`);
  if (wanted.workspacesAll && !own.workspacesAll) out.push("workspaces:all");
  if (wanted.domainsAll && !own.domainsAll) out.push("domains:all");
  return out;
}
