// Integration users and their API keys (catalogue INT-003/004, ACC-080). An integration user is a service member of the
// organisation — an account that cannot sign in (no password, an address in the reserved `service.invalid` domain,
// never adopted from an existing account), created with its `integration_user` row and switched off with it. Its ITSM
// roles are chosen by an owner through the access service (nobody grants above their own); until it has roles it can
// do nothing. Its API keys are `sm_<prefix>_<secret>`: only the SHA-256 is stored, the key is shown once, and each key
// names the tables and operations it may use — the integration user's own access still decides every call.
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { insertRow } from "../../db/sql";
import { uuidv7 } from "@shared/id";
import { cleanScopes, type TableScope } from "@shared/integration/scopes";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { randomToken, sha256 } from "../../auth/password";
import { audit } from "../data/crud";
import { securityEvent } from "../platform/security";
import { saveMemberAccess } from "../../access";
import { needWithinLimit } from "../admin/common";
import { liveRow, needIntegrations, sysOf, type Row } from "./common";

export const INTEGRATION_DOMAIN = "service.invalid";
export const newIntegrationEmail = () => `integration+${randomUUID()}@${INTEGRATION_DOMAIN}`;
export const isIntegrationEmail = (email: string | null | undefined) => /^integration\+[0-9a-f-]{36}@service\.invalid$/i.test(String(email ?? ""));

/** Create the service account and membership of a new integration user (inside its create; same transaction). */
export async function createServiceMember(tx: Tx, ctx: Ctx, name: string): Promise<string> {
  await needWithinLimit(tx, ctx.cfg, ctx.org.id, "integration_users", 1);
  const user = await insertRow<{ id: string }>(tx, "sm_users", { id: uuidv7(), email: newIntegrationEmail(), full_name: `یکپارچه‌سازی: ${name}`.slice(0, 120), password_hash: null }, "id");
  // «ناظر» on the platform's own pages; what it may do with records comes only from its ITSM roles
  await insertRow(tx, "sm_org_members", { id: uuidv7(), org_id: ctx.org.id, user_id: user.id, role: "viewer", title: "حساب یکپارچه‌سازی", origin: ctx.cfg.origin }, "id");
  return user.id;
}

/** Keep the service account in step with its row (name, active; switched off when the row is removed). */
export async function syncServiceMember(tx: Tx, ctx: Ctx, row: Row, removed = false): Promise<void> {
  if (!row.user_id) return;
  const active = !removed && row.active !== false;
  await tx.query(`update sm_users set full_name = $2 where id = $1 and lower(email) like 'integration+%@service.invalid'`, [row.user_id, `یکپارچه‌سازی: ${row.name}`.slice(0, 120)]);
  await tx.query(`update sm_org_members set is_active = $3 where org_id = $1 and user_id = $2`, [ctx.org.id, row.user_id, active]);
  if (!active) await tx.query(`update sm_api_keys set revoked_at = coalesce(revoked_at, now()) where org_id = $1 and integration_user_id = $2 and revoked_at is null`, [ctx.org.id, row.id]);
}

async function userRow(ctx: Ctx, id: string): Promise<Row> {
  const row = await liveRow(ctx.db, ctx, "integration_user", id);
  if (!row) throw notFound("کاربر یکپارچه‌سازی پیدا نشد");
  return row;
}

/** The integration user's ITSM roles (an owner's decision, through the access service). */
export async function setIntegrationRoles(ctx: Ctx, id: string, roles: string[]): Promise<{ roles: string[] }> {
  needIntegrations(ctx, "full");
  ctx.need("users", "edit");
  if (ctx.actor === "support") throw forbidden("نقش‌های کاربر یکپارچه‌سازی را مدیر خود سازمان تعیین می‌کند");
  const row = await userRow(ctx, id);
  if (!row.user_id) throw conflict("این کاربر یکپارچه‌سازی حساب ندارد");
  const clean = [...new Set(roles.filter((r) => /^[a-z][a-z0-9_]{0,40}$/.test(r)))];
  await saveMemberAccess(ctx, String(row.user_id), { roles: clean, persona: "agent" });
  await audit(ctx.db, ctx, "integration_roles", "integration_user", id, `نقش‌های «${row.name}»: ${clean.join("، ") || "—"}`, { roles: clean });
  return { roles: clean };
}

export async function integrationRoles(ctx: Ctx, id: string): Promise<string[]> {
  const row = await userRow(ctx, id);
  if (!row.user_id) return [];
  const p = await ctx.db.one<{ roles: unknown }>(`select roles from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, row.user_id]);
  return Array.isArray(p?.roles) ? (p!.roles as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------- keys

export interface KeyView {
  id: string;
  name: string;
  prefix: string;
  integration_user_id: string | null;
  table_scopes: TableScope[] | null;
  rate_limit: number | null;
  expires_at: string | null;
  ip_allowlist: string[] | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  calls: number;
}

export async function listKeys(ctx: Ctx, integrationUserId?: string | null): Promise<KeyView[]> {
  needIntegrations(ctx, "view");
  const params: unknown[] = [ctx.org.id];
  const rows = await ctx.db.query<KeyView>(
    `select id, name, prefix, integration_user_id, table_scopes, rate_limit, expires_at, ip_allowlist, created_at, last_used_at, revoked_at, calls::int as calls
     from sm_api_keys where org_id = $1 and integration_user_id is not null ${integrationUserId ? `and integration_user_id = $${params.push(integrationUserId)}` : ""}
     order by created_at desc`,
    params,
  );
  return rows;
}

export interface KeyInput {
  name: string;
  scopes: TableScope[];
  rate_limit?: number | null;
  expires_at?: string | null;
  ip_allowlist?: string[] | null;
}

/** A new key of an integration user (shown once). */
export async function createKey(ctx: Ctx, integrationUserId: string, input: KeyInput): Promise<{ key: string; prefix: string; id: string }> {
  needIntegrations(ctx, "full");
  const user = await userRow(ctx, integrationUserId);
  if (user.active === false) throw bad("کاربر یکپارچه‌سازی غیرفعال است");
  const scopes = cleanScopes(input.scopes);
  if (!scopes.length) throw bad("دست‌کم یک جدول و یک کار برای کلید انتخاب کنید");
  if (input.expires_at && Date.parse(input.expires_at) <= Date.now()) throw bad("تاریخ انقضا باید در آینده باشد");
  const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).padEnd(8, "x");
  const key = `sm_${prefix}_${randomToken(24)}`;
  const id = uuidv7();
  await ctx.write(async (tx) => {
    await insertRow(
      tx,
      "sm_api_keys",
      {
        id,
        org_id: ctx.org.id,
        name: input.name.trim().slice(0, 120),
        prefix,
        key_hash: sha256(key),
        scopes: JSON.stringify(["read", "write"]),
        created_by: ctx.user.id,
        integration_user_id: integrationUserId,
        table_scopes: JSON.stringify(scopes),
        rate_limit: input.rate_limit ?? null,
        expires_at: input.expires_at ?? null,
      },
      "id",
    );
    await audit(tx, ctx, "api_key_create", "integration_user", integrationUserId, `کلید API «${input.name}» برای «${user.name}»`, { prefix, scopes, expires_at: input.expires_at ?? null });
  });
  await securityEvent(ctx.db, { kind: "api_key", org_id: ctx.org.id, user_id: ctx.user.id, email: ctx.user.email, data: { action: "added", prefix, integration_user: integrationUserId } });
  return { key, prefix, id };
}

/** Revoke a key (allowed even while the organisation is read-only: it closes a door). */
export async function revokeKey(ctx: Ctx, keyId: string): Promise<void> {
  needIntegrations(ctx, "full");
  const r = await ctx.db.one<{ prefix: string; integration_user_id: string | null }>(
    `update sm_api_keys set revoked_at = now(), revoked_by = $3 where id = $1 and org_id = $2 and revoked_at is null returning prefix, integration_user_id`,
    [keyId, ctx.org.id, ctx.user.id],
  );
  if (!r) throw notFound("کلید فعالی با این شناسه پیدا نشد");
  await audit(ctx.db, ctx, "api_key_revoke", "integration_user", r.integration_user_id, `باطل کردن کلید ${r.prefix}`);
  await securityEvent(ctx.db, { kind: "api_key", org_id: ctx.org.id, user_id: ctx.user.id, email: ctx.user.email, data: { action: "removed", prefix: r.prefix } });
}

export interface ResolvedKey {
  id: string;
  org_id: string;
  prefix: string;
  integration_user_id: string | null;
  table_scopes: TableScope[];
  rate_limit: number | null;
  ip_allowlist: string[] | null;
}

/** The key a request carries, if it is valid (hash compared in constant time; revoked and expired keys refused). */
export async function resolveKey(q: Ctx["db"], key: string | null | undefined): Promise<ResolvedKey | null> {
  if (!key || !/^sm_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const prefix = key.split("_")[1];
  const rows = await q.query<ResolvedKey & { key_hash: string; revoked_at: string | null; expires_at: string | null }>(
    `select id, org_id, prefix, key_hash, revoked_at, expires_at, integration_user_id, table_scopes, rate_limit, ip_allowlist from sm_api_keys where prefix = $1`,
    [prefix],
  );
  const want = Buffer.from(sha256(key));
  for (const r of rows) {
    const have = Buffer.from(r.key_hash);
    if (have.length !== want.length || !timingSafeEqual(have, want)) continue;
    if (r.revoked_at) return null;
    if (r.expires_at && Date.parse(String(r.expires_at)) <= Date.now()) return null;
    return { id: r.id, org_id: r.org_id, prefix: r.prefix, integration_user_id: r.integration_user_id, table_scopes: cleanScopes(r.table_scopes), rate_limit: r.rate_limit, ip_allowlist: r.ip_allowlist };
  }
  return null;
}

export { sysOf };
