// «دستیار هوش مصنوعی» — the service member that event- and schedule-triggered skills run as (catalogue AI-154). Never
// the system context: the member has exactly the ITSM roles an administrator chose for it, so a triggered skill reads
// only what those roles read, and everything it produces is a proposal on the record (visible only to people who may
// read the record and every field involved) unless the skill's auto-apply list names the field — and then the write
// goes through the record service with the member's own access.
// The account cannot sign in (no password; an address that receives no mail), appears in the members list like any
// member, and is switched off by deactivating its membership.
// AI agents (../agents) reuse the same machinery with a `key`: each agent gets a service member of its own («عامل: …»),
// so its roles — and so what it reads and may change — are chosen agent by agent.
import { createHash } from "node:crypto";
import type { Ctx, ServerConfig } from "../../../context";
import type { Queryable } from "../../../db";
import { insertRow } from "../../../db/sql";
import { uuidv7 } from "@shared/id";
import { forbidden } from "../../../http/errors";
import { audit } from "../../data/crud";
import { memberCtx, saveMemberAccess } from "../../../access/service";

export const PRINCIPAL_NAME = "دستیار هوش مصنوعی";

/**
 * The service member's address (one per organisation, and one per agent with a `key`; `.invalid` never receives mail).
 */
export const principalEmail = (orgId: string, key?: string | null) =>
  key ? `ai-agent+${orgId}.${createHash("sha256").update(key).digest("hex").slice(0, 10)}@service.invalid` : `ai-assistant+${orgId}@service.invalid`;

/** Is this an address of an AI service member (the assistant's or an agent's)? */
export const isServiceEmail = (email: string | null | undefined) => /^ai-(assistant|agent)\+[0-9a-f-]{36}(\.[0-9a-f]{10})?@service\.invalid$/i.test(String(email ?? ""));

export interface PrincipalState {
  user_id: string | null;
  name: string | null;
  roles: string[];
  active: boolean;
}

/** The organisation's service member (an agent's with its `key`), if one was set up. */
export async function principalOf(q: Queryable, orgId: string, key?: string | null): Promise<PrincipalState> {
  const r = await q.one<{ id: string; full_name: string; active: boolean }>(
    `select u.id, u.full_name, (m.is_active and m.deleted_at is null and not u.disabled) as active
     from sm_users u join sm_org_members m on m.user_id = u.id and m.org_id = $1
     where lower(u.email) = lower($2)`,
    [orgId, principalEmail(orgId, key)],
  );
  if (!r) return { user_id: null, name: null, roles: [], active: false };
  const p = await q.one<{ roles: unknown }>(`select roles from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [orgId, r.id]);
  const roles = Array.isArray(p?.roles) ? (p!.roles as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { user_id: r.id, name: r.full_name, roles, active: !!r.active };
}

/** A context of the service member (its own access), or null when there is none or it is switched off. */
export async function principalCtx(cfg: ServerConfig, orgId: string, key?: string | null): Promise<Ctx | null> {
  const p = await principalOf(cfg.db, orgId, key);
  if (!p.user_id || !p.active) return null;
  return memberCtx(cfg, orgId, p.user_id).catch(() => null);
}

/**
 * Set up (or change) the service member: created on first use, its ITSM roles set through the access service — so the
 * usual rules hold: only an owner grants roles, nobody grants more than they have. `active: false` switches it off.
 */
export async function setPrincipal(ctx: Ctx, input: { roles: string[]; active?: boolean; name?: string }, key?: string | null): Promise<PrincipalState> {
  ctx.need("ai", "full");
  ctx.need("users", "edit");
  if (ctx.actor === "support") throw forbidden("حساب دستیار هوش مصنوعی را مدیر خود سازمان می‌سازد");
  const email = principalEmail(ctx.org.id, key);
  const name = (input.name ?? PRINCIPAL_NAME).slice(0, 120);
  const userId = await ctx.write(async (tx) => {
    let user = await tx.one<{ id: string }>(`select id from sm_users where lower(email) = lower($1)`, [email]);
    if (!user) user = await insertRow<{ id: string }>(tx, "sm_users", { id: uuidv7(), email, full_name: name, password_hash: null }, "id");
    else if (key && input.name) await tx.query(`update sm_users set full_name = $2 where id = $1`, [user.id, name]);
    const m = await tx.one<{ id: string; deleted_at: string | null }>(`select id, deleted_at from sm_org_members where org_id = $1 and user_id = $2`, [ctx.org.id, user.id]);
    const active = input.active !== false;
    if (!m) {
      await insertRow(tx, "sm_org_members", { id: uuidv7(), org_id: ctx.org.id, user_id: user.id, role: "member", title: "حساب خدمت هوش مصنوعی", origin: ctx.cfg.origin, is_active: active }, "id");
    } else {
      await tx.query(`update sm_org_members set deleted_at = null, is_active = $2, role = 'member' where id = $1`, [m.id, active]);
    }
    await audit(tx, ctx, "ai_principal", "member", user.id, `${name}: ${active ? `نقش‌ها ${input.roles.join("، ") || "—"}` : "خاموش"}`, { roles: input.roles, active, ...(key ? { agent: key } : {}) });
    return user.id;
  });
  if (input.active !== false) await saveMemberAccess(ctx, userId, { roles: input.roles, persona: "agent" });
  return principalOf(ctx.db, ctx.org.id, key);
}
