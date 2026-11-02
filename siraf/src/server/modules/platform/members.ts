// Who may change a membership. One rule for the members page (routes/org.ts) and for member rows
// pushed by a Windows app (routes/sync.ts):
// - only an owner gives, changes or takes the owner role;
// - below the owner, nobody changes their own role or per-area access, nobody touches a member
//   who has more access than they do, and nobody gives more access than they have (a member with
//   «کاربران: ویرایش» cannot make anyone, himself included, a manager «مدیر»);
// - a business resets the password only of an account it created itself (see `createdHere`).
import type { Queryable } from "../../db";
import type { Ctx } from "../../context";
import { AREAS, areasAbove, permissionMap, type Area, type Level, type Role } from "@shared/permissions";

export interface MemberGrant {
  user_id: string;
  role: Role;
  overrides: Partial<Record<Area, Level>> | null;
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
 * Why `ctx` may not turn the membership `before` (null: a new one) into `after` (null: deactivated
 * or removed); null when the change is allowed. The caller has already checked users:edit.
 */
export function memberChangeProblem(ctx: Ctx, before: MemberGrant | null, after: MemberGrant | null): string | null {
  if ((before?.role === "owner" || after?.role === "owner") && (ctx.member.role !== "owner" || ctx.support)) return OWNER_ONLY_MESSAGE;
  if (ctx.support) return "اعضای کسب‌وکار را خود کسب‌وکار تغییر می‌دهد";
  if (before && after && after.user_id && before.user_id !== after.user_id) return "عضویت به حساب دیگری منتقل نمی‌شود";
  if (ctx.member.role === "owner") return null;
  if (before && before.user_id === ctx.user.id && (!after || !sameGrant(before, after)))
    return "نقش و دسترسی‌های خودتان را نمی‌توانید تغییر دهید؛ این کار با مالک است";
  const mine = permissionMap(ctx.member.role, ctx.member.overrides);
  if (before) {
    const above = areasAbove(permissionMap(before.role, before.overrides), mine);
    if (above.length) return `دسترسی این عضو در «${AREAS[above[0]]}» از شما بیشتر است؛ تغییر آن با مالک است`;
  }
  if (after) {
    const above = areasAbove(permissionMap(after.role, after.overrides), mine);
    if (above.length) return `نمی‌توانید در «${AREAS[above[0]]}» دسترسی‌ای بیشتر از دسترسی خودتان بدهید`;
  }
  return null;
}

/**
 * True when this business made the account itself (the members page created it, with a password
 * the business set). Accounts are global: anyone can add an existing account to their own business
 * by its e-mail, so only an account made here may have its password reset here or its password
 * hash handed to the business's Windows apps. Recorded in the business's audit row «member_add».
 */
export const CREATED_HERE_SQL = (orgParam: string, userExpr: string) =>
  `exists (select 1 from tz_audit a where a.org_id = ${orgParam} and a.action = 'member_add' and a.entity_id = ${userExpr}
     and a.data @> '{"new_account": true}'::jsonb)`;

export async function createdHere(q: Queryable, orgId: string, userId: string): Promise<boolean> {
  return !!(await q.one(`select 1 where ${CREATED_HERE_SQL("$1", "$2::uuid")}`, [orgId, userId]));
}
