// Who may change a membership. One rule for the members page (routes/org.ts), member rows pushed by
// a Windows app (routes/sync.ts) and the members page's own offer (the rule itself lives in
// @shared/permissions as `memberChangeRule`):
// - only an owner gives, changes or takes the owner role;
// - below the owner, nobody changes their own role or per-area access, nobody touches a member
//   who has more access than they do, and nobody gives more access than they have (a member with
//   «کاربران: ویرایش» cannot make anyone, himself included, a manager «مدیر»);
// - an organisation resets the password only of an account it created itself (see `createdHere`).
import type { Queryable } from "../../db";
import type { Ctx } from "../../context";
import { memberChangeRule, permissionMap, type MemberGrant } from "@shared/permissions";

export { OWNER_ONLY_MESSAGE, sameGrant, type MemberGrant } from "@shared/permissions";

/** The acting member, for `memberChangeRule`. */
export const memberActor = (ctx: Ctx) => ({
  user_id: ctx.user.id,
  role: ctx.member.role,
  permissions: permissionMap(ctx.member.role, ctx.member.overrides),
  support: !!ctx.support,
});

/**
 * Why `ctx` may not turn the membership `before` (null: a new one) into `after` (null: deactivated
 * or removed); null when the change is allowed. The caller has already checked users:edit.
 */
export function memberChangeProblem(ctx: Ctx, before: MemberGrant | null, after: MemberGrant | null): string | null {
  return memberChangeRule(memberActor(ctx), before, after);
}

/**
 * True when this organisation made the account itself (the members page created it, with a password
 * the organisation set). Accounts are global: anyone can add an existing account to their own organisation
 * by its e-mail, so only an account made here may have its password reset here or its password
 * hash handed to the organisation's Windows apps. Recorded in the organisation's audit row «member_add»:
 * data.new_account since the review fixes; older rows have no data, but the account and that row
 * were written in the same transaction, so their timestamps (both now()) are equal.
 */
export const CREATED_HERE_SQL = (orgParam: string, userExpr: string) =>
  `exists (select 1 from sm_audit a where a.org_id = ${orgParam} and a.action = 'member_add' and a.entity_id = ${userExpr}
     and (a.data @> '{"new_account": true}'::jsonb
       or (a.data is null and a.at = (select cu.created_at from sm_users cu where cu.id = ${userExpr}))))`;

export async function createdHere(q: Queryable, orgId: string, userId: string): Promise<boolean> {
  return !!(await q.one(`select 1 where ${CREATED_HERE_SQL("$1", "$2::uuid")}`, [orgId, userId]));
}

/**
 * Whether the organisation may set a password for these members (POST /members/:id/password): an
 * account it made, that works for no other organisation and is not a platform admin. One SQL boolean
 * per row, for the members list.
 */
export const RESETTABLE_SQL = (orgParam: string, userAlias: string) =>
  `(${CREATED_HERE_SQL(orgParam, `${userAlias}.id`)} and not ${userAlias}.is_platform_admin
     and not exists (select 1 from sm_org_members o where o.user_id = ${userAlias}.id and o.org_id <> ${orgParam} and o.deleted_at is null))`;
