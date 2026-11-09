// «دستیار هوش مصنوعی» — the service member that event- and schedule-triggered skills run as (catalogue AI-154). Never
// the system context: the member has exactly the ITSM roles an administrator chose for it, so a triggered skill reads
// only what those roles read, and everything it produces is a proposal on the record (visible only to people who may
// read the record and every field involved) unless the skill's auto-apply list names the field — and then the write
// goes through the record service with the member's own access.
// The account cannot sign in (no password; an address that receives no mail), appears in the members list like any
// member, and is switched off by deactivating its membership.
// It is found by its membership, never by an address: each one gets a random address in the reserved domain
// `service.invalid` (sign-up and invitations refuse every `.invalid` address — `isReservedEmail`), and an account
// with such an address that can sign in (a password, a recovery code or a session) is never taken for it.
// AI agents (../agents) reuse the same machinery with a `key`: each agent gets a service member of its own («عامل: …»,
// address `ai-agent+<key tag>.<random>@service.invalid`), so its roles — and so what it reads and may change — are
// chosen agent by agent.
import { createHash, randomUUID } from "node:crypto";
import type { Ctx, ServerConfig } from "../../../context";
import type { Queryable } from "../../../db";
import { insertRow } from "../../../db/sql";
import { uuidv7 } from "@shared/id";
import { conflict, forbidden } from "../../../http/errors";
import { audit } from "../../data/crud";
import { memberCtx, saveMemberAccess } from "../../../access/service";

export const PRINCIPAL_NAME = "دستیار هوش مصنوعی";

/** The reserved domain of service accounts (`.invalid` never receives mail; nobody signs up or is invited in it). */
export const SERVICE_DOMAIN = "service.invalid";

/** An agent's tag in its service member's address (the key's hash: the address never spells the key). */
const agentTag = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 10);

/** The address prefix of a service member: the assistant's, or an agent's with its `key`. */
const servicePrefix = (key?: string | null) => (key ? `ai-agent+${agentTag(key)}.` : "ai-assistant+");

/** A new service member's address: random, so nobody can sign it up ahead of the organisation. */
export const newPrincipalEmail = (key?: string | null) => `${servicePrefix(key)}${randomUUID()}@${SERVICE_DOMAIN}`;

/** Is this an address of an AI service member (the assistant's or an agent's)? Only the account's sign-in state tells
 * whether it really is one — see `isServiceMember` of ../agents/triggers. */
export const isServiceEmail = (email: string | null | undefined) =>
  /^ai-(assistant\+|agent\+[0-9a-f]{10}\.)[0-9a-f-]{36}@service\.invalid$/i.test(String(email ?? ""));

export interface PrincipalState {
  user_id: string | null;
  name: string | null;
  roles: string[];
  active: boolean;
}

interface ServiceAccount {
  id: string;
  full_name: string;
  active: boolean;
  /** a password, a recovery code or a session: someone signs in with it — never the service member */
  can_sign_in: boolean;
  removed: boolean;
}

/** The organisation's members whose account has a service address (its service member, and anything posing as one). */
async function serviceAccounts(q: Queryable, orgId: string, key?: string | null): Promise<ServiceAccount[]> {
  return q.query<ServiceAccount>(
    `select u.id, u.full_name, (m.is_active and m.deleted_at is null and not u.disabled) as active,
            (u.password_hash is not null or u.recovery_hash is not null
              or exists (select 1 from sm_sessions s where s.user_id = u.id)) as can_sign_in,
            (m.deleted_at is not null) as removed
     from sm_users u join sm_org_members m on m.user_id = u.id and m.org_id = $1
     where lower(u.email) like $2
     order by m.created_at, m.id`,
    [orgId, `${servicePrefix(key)}%@${SERVICE_DOMAIN}`],
  );
}

/** The organisation's service member (an agent's with its `key`), if one was set up. */
export async function principalOf(q: Queryable, orgId: string, key?: string | null): Promise<PrincipalState> {
  const r = (await serviceAccounts(q, orgId, key)).find((a) => !a.can_sign_in);
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
 * Never adopts an existing account: the member is the organisation's own (found by its membership) or a new account.
 */
export async function setPrincipal(ctx: Ctx, input: { roles: string[]; active?: boolean; name?: string }, key?: string | null): Promise<PrincipalState> {
  ctx.need("ai", "full");
  ctx.need("users", "edit");
  if (ctx.actor === "support") throw forbidden("حساب دستیار هوش مصنوعی را مدیر خود سازمان می‌سازد");
  const name = (input.name ?? PRINCIPAL_NAME).slice(0, 120);
  const userId = await ctx.write(async (tx) => {
    const accounts = await serviceAccounts(tx, ctx.org.id, key);
    // a member with a service address that someone signs in with (made before such addresses were reserved) is
    // never given the service member's roles: the owner removes it first
    if (accounts.some((a) => a.can_sign_in && !a.removed)) {
      throw conflict("عضوی با نشانی حساب خدمت در سازمان هست که می‌تواند وارد سامانه شود؛ نخست او را از اعضا بردارید");
    }
    const own = accounts.find((a) => !a.can_sign_in);
    const user = own
      ? { id: own.id }
      : await insertRow<{ id: string }>(tx, "sm_users", { id: uuidv7(), email: newPrincipalEmail(key), full_name: name, password_hash: null }, "id");
    if (own && key && input.name) await tx.query(`update sm_users set full_name = $2 where id = $1`, [own.id, name]);
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
