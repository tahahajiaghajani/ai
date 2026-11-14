// The upgrade check of design F §6.5 (package F4b): acting from a Windows app needs `work` read and create (the pull
// brings the person's task rows; the push creates their submission). Every built-in role has both but «ممیز» and
// «کارشناس پیمانکار»; an organisation's own roles may lack them. The hub lists those roles with
// «۲ نقش سفارشی حق ثبت در «کارها» را ندارند؛ …» and offers the administrator «افزودن حق» — nothing is granted silently.
// Members who hold only such roles still act online: the service checks the task's person, not a grant.
import { combineRoles, grantIn, roleClosure, scopeRank, type Grant, type RoleDef } from "@shared/access";
import { faDigits } from "@shared/format";
import type { Ctx } from "../../../context";
import { notFound } from "../../../http/errors";
import { listRoles, saveRole, type RoleView } from "../../../access";

const WORK = "work";

export interface RoleWithoutWork {
  key: string;
  name: string;
  /** members holding it (directly, through a group, or through a role containing it) */
  holders: number;
  /** a built-in role the organisation changed (else a role of its own) */
  builtin: boolean;
}

/** Does the role, with the roles it contains, let its members create in `work` (and read their own rows there)? */
export function grantsWorkCreate(key: string, catalog: ReadonlyMap<string, RoleDef>): boolean {
  const g = grantIn(combineRoles(roleClosure([key], catalog).map((k) => catalog.get(k)!).filter(Boolean)), WORK);
  return g.create && scopeRank(g.read) >= scopeRank("own");
}

/** The message of the hub (null when no customised role lacks the grant). */
export function rolesWithoutWorkMessage(roles: readonly Pick<RoleWithoutWork, "name">[]): string | null {
  if (!roles.length) return null;
  if (roles.length === 1) return `نقش سفارشی «${roles[0].name}» حق ثبت در «کارها» را ندارد؛ اعضای آن مرحله‌ها را فقط برخط انجام می‌دهند`;
  return `${faDigits(roles.length)} نقش سفارشی حق ثبت در «کارها» را ندارند؛ اعضای آن‌ها مرحله‌ها را فقط برخط انجام می‌دهند`;
}

/**
 * The organisation's customised roles (its own, and built-ins it changed) that are active and do not grant `work`
 * read and create, with the hub's message. Needs the access view (`users` read all), like the roles page.
 */
export async function rolesWithoutWorkCreate(ctx: Ctx): Promise<{ roles: RoleWithoutWork[]; message: string | null }> {
  const { roles } = await listRoles(ctx);
  const catalog = new Map<string, RoleDef>(roles.map((r) => [r.key, r]));
  const out = roles
    .filter((r) => (!r.builtin || r.modified) && r.active !== false && !grantsWorkCreate(r.key, catalog))
    .map((r) => ({ key: r.key, name: r.name, holders: r.holders, builtin: r.builtin }));
  return { roles: out, message: rolesWithoutWorkMessage(out) };
}

/**
 * «افزودن حق»: role `key` gains `work` create, and read of at least the member's own rows; nothing else changes. An
 * explicit, audited change of the role (the roles page's save: `users` admin).
 */
export async function addWorkCreate(ctx: Ctx, key: string): Promise<RoleView> {
  const { roles } = await listRoles(ctx);
  const role = roles.find((r) => r.key === key);
  if (!role) throw notFound("نقش پیدا نشد");
  // an area the role does not name takes its "*" grant: start from it, so nothing it gave in `work` is lost
  const was: Grant = role.grants[WORK] ?? role.grants["*"] ?? {};
  const work: Grant = { ...was, create: true, read: scopeRank(was.read) >= scopeRank("own") ? was.read : "own" };
  return saveRole(ctx, key, {
    name: role.name,
    description: role.description ?? null,
    persona: role.persona,
    grants: { ...role.grants, [WORK]: work },
    field_groups: role.field_groups,
    contains: role.contains,
    workspaces: role.workspaces,
    domains: role.domains,
    active: role.active !== false,
    version: role.version,
  });
}
