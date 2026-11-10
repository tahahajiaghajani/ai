// Directory synchronisation (catalogue INT-013, ACC-077): LDAP / Active Directory read on demand or on a schedule,
// always planned first — «پیش‌نمایش» computes and stores the plan (who is created, updated, switched off, which group
// memberships change, which units are created, which roles directory groups would grant) and nothing is written until
// an administrator applies that exact plan. Roles are never granted silently: new members get the source's default role
// (shown in the plan) and roles mapped from directory groups are applied only when the administrator confirms them in
// «اعمال» (or opted into automatic roles on the source). Scheduled runs act as the member who approved the source, with
// their access — never the system — and skip role grants unless automatic roles are on.
import { isIP } from "node:net";
import type { Ctx, ServerConfig } from "../../context";
import { uuidv7 } from "@shared/id";
import {
  attrMapOf, entryFromLdap, planDirectorySync, planStats, withoutRoleGrants, type CurrentMember, type DirEntry, type DirOptions, type DirPlan, type GroupMapping,
} from "@shared/integration/directory";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { createIn, emitEvent, removeIn, secretView, systemCtx, updateIn } from "../../engine";
import { tableDef } from "@shared/tables";
import { enqueue, registerJobHandler } from "../../jobs";
import { addGroupMembers, memberCtx, saveMemberAccess } from "../../access";
import { aiNet, internalAddress } from "../ai/net";
import { audit } from "../data/crud";
import { needFeature, needWithinLimit } from "../admin/common";
import { ensurePerson, setDirectoryName, setMemberActive, type MembershipRole } from "../admin/members";
import { LdapError } from "./ldap";
import { mappingFingerprint, openSourceConnection, nestedMemberships, rolesApproved } from "./directory-login";
import { revokeUserSessions } from "../../auth/session";
import { needRecentAuth } from "../../auth/policy";
import { securityEvent } from "../platform/security";
import { grantingGroups, intLog, liveRow, liveRows, needIntegrations, sysOf, type Row } from "./common";
import { lanAllowed, checkOutboundHost, OutboundBlockedError } from "../../net";
import { recordDirectoryTest } from "../platform/signin-health";

const HOUR = 3600_000;

export async function sourceRow(ctx: Ctx, id: string): Promise<Row> {
  const row = await liveRow(ctx.db, ctx, "directory_source", id);
  if (!row) throw notFound("منبع فهرست کاربران پیدا نشد");
  return row;
}

export function optionsOf(src: Row): DirOptions {
  return {
    default_role: typeof src.default_role === "string" && src.default_role.trim() ? src.default_role.trim() : null,
    deactivate_missing: src.deactivate_missing !== false,
    unit_from: src.unit_from === "department" ? "department" : "none",
    auto_roles: !!src.auto_roles,
  };
}

export function mappingsOf(src: Row): GroupMapping[] {
  return (Array.isArray(src.group_map) ? src.group_map : [])
    .filter((m: unknown) => m && typeof m === "object")
    .map((m: Record<string, unknown>) => ({
      source: String(m.source ?? "").trim(),
      group_id: typeof m.group_id === "string" && m.group_id ? m.group_id : null,
      role: typeof m.role === "string" && m.role ? m.role : null,
      unit_id: typeof m.unit_id === "string" && m.unit_id ? m.unit_id : null,
      workspace_id: typeof m.workspace_id === "string" && m.workspace_id ? m.workspace_id : null,
    }))
    .filter((m: GroupMapping) => m.source);
}

/**
 * Domain controllers on the installation's own network may be reached: the Windows app, the server edition (its LAN,
 * through the air-gap allowlist) and an on-premises installation that says so (cfg.auth.directoryLan, or
 * ITSM_DIRECTORY_LAN=1). The web version reaches public directories only.
 */
export const directoryLan = (cfg: Pick<ServerConfig, "mode" | "auth" | "network">): boolean => lanAllowed(cfg) || !!cfg.auth?.directoryLan || process.env.ITSM_DIRECTORY_LAN === "1";

/** The administrator's message when the air gap refuses a domain controller: the host and the two ways to allow it. */
export const dcBlockedMessage = (host: string): string =>
  `کنترل‌کنندهٔ دامنه «${host}» در فهرست میزبان‌های مجاز شبکهٔ بستهٔ سرور نیست و اتصال به آن برقرار نشد. مدیر سرور می‌تواند آن را با «karizctl allow add ${host}» روی سرور بیفزاید (فهرست کنونی و تلاش‌های ردشده در صفحهٔ «سلامت سرور» کنسول مدیر سامانه دیده می‌شود)؛ سامانه هیچ میزبانی را خودکار مجاز نمی‌کند`;

/**
 * Every domain-controller connection (sign-in, synchronisation, the connection test) passes here first.
 * - Where the installation has an outbound policy (the server edition), the host must pass it: air-gapped, only hosts
 *   on its allowlist (the socket guard refuses the rest again, below this check).
 * - On the office network (directoryLan) the source's own TLS setting governs (LDAPS or StartTLS; plaintext only as
 *   «فقط برای آزمایش»).
 * - On the web version an LDAP server must be a public host reached over TLS (ldaps://): the bind is a simple bind, and
 *   its DN and password must never cross the Internet in clear text.
 */
export async function guardHost(cfg: ServerConfig, url: string): Promise<void> {
  const lan = directoryLan(cfg);
  if (!lan && !/^ldaps:\/\//i.test(url)) throw bad("در نسخهٔ وب فقط ldaps:// (LDAP روی TLS) پذیرفته می‌شود تا گذرواژهٔ اتصال رمزنگاری‌نشده از اینترنت نگذرد");
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw bad("نشانی LDAP معتبر نیست");
  }
  if (cfg.network) {
    await checkOutboundHost(cfg.network, host, "سرور LDAP").catch((e) => {
      throw bad(e instanceof OutboundBlockedError ? dcBlockedMessage(host) : String((e as Error).message ?? e));
    });
  }
  if (lan) return;
  const addresses = isIP(host) ? [host] : await aiNet.lookup(host).catch(() => []);
  if (!addresses.length) throw bad(`نشانی سرور LDAP پیدا نشد (${host})`);
  if (addresses.some(internalAddress)) throw bad("سرور LDAP در نشانی داخلی است؛ در نسخهٔ وب فقط سرورهای عمومی (یا برنامهٔ ویندوز در شبکهٔ سازمان) پذیرفته می‌شوند");
}

/**
 * Read the people of an LDAP source: the domain controllers in order (failover), LDAPS / StartTLS with the source's
 * root CA, and — with nested groups on — the mapped groups' indirect members added to each person's groups.
 */
export async function readLdap(cfg: ServerConfig, sys: Ctx, src: Row): Promise<DirEntry[]> {
  if (!src.ldap_url || !src.base_dn) throw bad("نشانی LDAP و ریشهٔ جست‌وجو را تنظیم کنید");
  const map = attrMapOf(src.attr_map);
  const attrs = [...new Set([map.email, map.name, map.username, map.title, map.phone, map.department, map.manager, map.groups, map.disabled, "userPrincipalName", "cn"])].filter((a) => a.toLowerCase() !== "distinguishedname");
  const { client, conf } = await openSourceConnection(cfg, sys, src);
  try {
    const entries = await client.search(String(src.base_dn), String(src.user_filter || "(objectClass=person)"), attrs);
    const nested = await nestedMemberships(client, conf);
    return entries.map((e) => {
      const d = entryFromLdap(e.dn, e.attrs, map);
      const more = nested.get(e.dn.toLowerCase());
      return more ? { ...d, groups: [...new Set([...d.groups, ...more])] } : d;
    });
  } catch (e) {
    if (e instanceof LdapError) throw bad(e.message);
    throw e;
  } finally {
    client.close();
  }
}

/** The organisation's members as the planner sees them (roles, groups, profile). */
export async function currentMembers(ctx: Ctx): Promise<CurrentMember[]> {
  const rows = await ctx.db.query<{ user_id: string; email: string; name: string; active: boolean; role: string; roles: unknown; title: string | null; phone: string | null; unit_id: string | null; manager_id: string | null; groups: string[] | null }>(
    `select m.user_id, lower(u.email) as email, coalesce(nullif(p.name, ''), nullif(u.full_name, ''), u.email) as name, (m.is_active and m.deleted_at is null) as active, m.role,
            p.roles, p.title, p.phone, p.org_unit_id as unit_id, p.manager_id,
            (select array_agg(gm.group_id::text) from sm_group_members gm where gm.org_id = m.org_id and gm.user_id = m.user_id and gm.deleted_at is null) as groups
     from sm_org_members m join sm_users u on u.id = m.user_id
     left join sm_member_profiles p on p.org_id = m.org_id and p.user_id = m.user_id and p.deleted_at is null
     where m.org_id = $1 and m.deleted_at is null and lower(u.email) not like '%@service.invalid'`,
    [ctx.org.id],
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    email: r.email,
    name: r.name,
    active: !!r.active,
    role: r.role,
    roles: Array.isArray(r.roles) ? (r.roles as unknown[]).filter((x): x is string => typeof x === "string") : [],
    title: r.title,
    phone: r.phone,
    unit_id: r.unit_id,
    manager_id: r.manager_id,
    groups: r.groups ?? [],
  }));
}

export async function linksOf(ctx: Ctx, sourceId: string, kind: "user" | "group" = "user"): Promise<Record<string, string>> {
  const rows = await ctx.db.query<{ external_id: string; local_id: string }>(`select external_id, local_id from sm_directory_links where org_id = $1 and source_id = $2 and kind = $3 and active`, [ctx.org.id, sourceId, kind]);
  return Object.fromEntries(rows.map((r) => [r.external_id, r.local_id]));
}

export async function planFor(ctx: Ctx, src: Row, entries: DirEntry[]): Promise<DirPlan> {
  const units = await liveRows(ctx.db, sysOf(ctx), "org_unit", null);
  return planDirectorySync({
    entries,
    members: await currentMembers(ctx),
    links: await linksOf(ctx, String(src.id)),
    mappings: mappingsOf(src),
    units: units.map((u) => ({ id: String(u.id), name: String(u.name) })),
    options: optionsOf(src),
    // platform administrators' addresses: their accounts are the platform's, never a directory's to make or change
    reserved: ctx.cfg.platformAdmins ?? [],
  });
}

async function storeRun(ctx: Ctx, sourceId: string, kind: "preview" | "apply", plan: DirPlan | null, status: "done" | "failed", error?: string | null): Promise<string> {
  const id = uuidv7();
  await ctx.db.query(
    `insert into sm_directory_runs (id, org_id, source_id, kind, status, started_by, finished_at, stats, plan, error) values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9)`,
    [id, ctx.org.id, sourceId, kind, status, ctx.actor === "system" ? null : ctx.user.id, plan ? planStats(plan) : {}, plan, error ?? null],
  );
  return id;
}

async function markSource(ctx: Ctx, src: Row, patch: Record<string, unknown>, failed?: string): Promise<void> {
  const sys = sysOf(ctx);
  await sys.write(async (tx) => {
    await updateIn(tx, sys, "directory_source", String(src.id), patch, { trusted: true, keepVersion: true });
    if (failed) await emitEvent(tx, sys, { kind: "record.directory_failed", table: "directory_source", id: String(src.id), data: { users: [src.created_by, src.approved_by].filter(Boolean), message: failed } });
  });
}

/** «پیش‌نمایش»: read the directory and store the plan (nothing else changes). */
export async function previewDirectory(ctx: Ctx, sourceId: string): Promise<{ run_id: string; plan: DirPlan; stats: Record<string, number> }> {
  needIntegrations(ctx, "full");
  await needFeature(ctx, "directory_sync");
  const src = await sourceRow(ctx, sourceId);
  if (src.kind !== "ldap") throw bad("پیش‌نمایش برای منبع LDAP است؛ SCIM تغییرها را خودش می‌فرستد");
  const started = Date.now();
  try {
    const entries = await readLdap(ctx.cfg, sysOf(ctx), src);
    const plan = await planFor(ctx, src, entries);
    const runId = await storeRun(ctx, sourceId, "preview", plan, "done");
    await intLog(ctx.db, { org_id: ctx.org.id, kind: "directory", ref_id: sourceId, actor: ctx.user.id, ok: true, latency_ms: Date.now() - started, summary: `پیش‌نمایش: ${entries.length} نفر در فهرست` });
    return { run_id: runId, plan, stats: planStats(plan) };
  } catch (e) {
    const message = String((e as Error).message ?? e);
    await storeRun(ctx, sourceId, "preview", null, "failed", message);
    await intLog(ctx.db, { org_id: ctx.org.id, kind: "directory", ref_id: sourceId, actor: ctx.user.id, ok: false, latency_ms: Date.now() - started, summary: "پیش‌نمایش ناموفق", error: message });
    await markSource(ctx, src, { health: "failing", last_summary: message.slice(0, 2000) }, message);
    throw bad(message);
  }
}

export interface ApplyResult {
  created: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  group_adds: number;
  group_removes: number;
  roles_granted: number;
  roles_pending: number;
  units: number;
  problems: string[];
}

/** Apply a plan with `ctx`'s access (role grants only when `roles` is true). */
export async function applyPlan(ctx: Ctx, src: Row, plan: DirPlan, roles: boolean): Promise<ApplyResult> {
  const out: ApplyResult = { created: 0, updated: 0, deactivated: 0, reactivated: 0, group_adds: 0, group_removes: 0, roles_granted: 0, roles_pending: roles ? 0 : plan.role_grants.length, units: 0, problems: [] };
  if (plan.create.length) await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "members", plan.create.length);
  const membership: MembershipRole = src.membership_role === "member" ? "member" : "viewer";
  const ids = new Map<string, string>();
  const unitIds = new Map((await liveRows(ctx.db, sysOf(ctx), "org_unit", null)).map((u) => [String(u.name).toLowerCase(), String(u.id)]));
  const members = await currentMembers(ctx);
  for (const m of members) ids.set(m.email, m.user_id);
  const deactivated: string[] = [];
  await ctx.write(async (tx) => {
    for (const name of plan.units) {
      if (unitIds.has(name.toLowerCase())) continue;
      const u = await createIn(tx, ctx, "org_unit", { name: name.slice(0, 150), kind: "department" });
      unitIds.set(name.toLowerCase(), String(u.id));
      out.units++;
    }
    for (const c of plan.create) {
      const r = await ensurePerson(tx, ctx, { email: c.email, name: c.name, title: c.title }, membership);
      ids.set(c.email, r.user_id);
      out.created++;
    }
    // the global account's name only when the account is this organisation's own; else the member profile's
    for (const u of plan.update) if (u.changes.name) await setDirectoryName(tx, ctx, u.user_id, String(u.changes.name.to));
    for (const d of plan.deactivate)
      if (await setMemberActive(tx, ctx, d.user_id, false)) {
        out.deactivated++;
        deactivated.push(d.user_id);
      }
    for (const d of plan.reactivate) if (await setMemberActive(tx, ctx, d.user_id, true)) out.reactivated++;
    for (const l of plan.links) {
      const local = ids.get(l.email);
      if (!local) continue;
      await tx.query(
        `insert into sm_directory_links (org_id, source_id, kind, external_id, local_id, external_name, active, updated_at) values ($1, $2, 'user', $3, $4, $5, true, now())
         on conflict (source_id, kind, external_id) do update set local_id = excluded.local_id, external_name = excluded.external_name, active = true, updated_at = now()`,
        [ctx.org.id, src.id, l.external_id, local, l.email],
      );
    }
    await audit(tx, ctx, "directory_apply", "directory_source", String(src.id), `همگام‌سازی «${src.name}»: ${out.created} تازه، ${plan.update.length} به‌روز، ${out.deactivated} غیرفعال`, planStats(plan));
  });
  // people the directory switched off lose their sessions here at once (all of them when this was their only organisation)
  for (const userId of deactivated) {
    const elsewhere = await ctx.db.one(`select 1 from sm_org_members where user_id = $1 and org_id <> $2 and deleted_at is null and is_active`, [userId, ctx.org.id]);
    const n = await revokeUserSessions(ctx.db, userId, { reason: "directory", orgId: elsewhere ? ctx.org.id : null });
    if (n) await securityEvent(ctx.db, { kind: "sessions_revoked", user_id: userId, org_id: ctx.org.id, data: { by: "directory", source: src.id, sessions: n } });
  }
  // profiles through the access service (roles only as planned: the default role of new members, mapped roles when confirmed)
  const grants = new Map<string, string[]>();
  for (const g of roles ? plan.role_grants : []) grants.set(g.email, [...(grants.get(g.email) ?? []), g.role]);
  const current = new Map(members.map((m) => [m.email, m]));
  const profile = async (email: string, data: Record<string, unknown>) => {
    const userId = ids.get(email);
    if (!userId || !Object.keys(data).length) return;
    try {
      await saveMemberAccess(ctx, userId, data);
    } catch (e) {
      out.problems.push(`${email}: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  };
  for (const c of plan.create) {
    const data: Record<string, unknown> = {};
    const roleList = [...c.roles, ...(grants.get(c.email) ?? [])];
    if (roleList.length) {
      data.roles = [...new Set(roleList)];
      data.persona = roleList.every((r) => r === "requester") ? "requester" : "agent";
      out.roles_granted += grants.get(c.email)?.length ?? 0;
    }
    if (c.title) data.title = c.title.slice(0, 120);
    if (c.phone) data.phone = c.phone.slice(0, 40);
    if (c.unit && unitIds.has(c.unit.toLowerCase())) data.org_unit_id = unitIds.get(c.unit.toLowerCase());
    if (c.manager && ids.get(c.manager)) data.manager_id = ids.get(c.manager);
    await profile(c.email, data);
    grants.delete(c.email);
  }
  for (const u of plan.update) {
    const data: Record<string, unknown> = {};
    if (u.changes.title) data.title = String(u.changes.title.to).slice(0, 120);
    if (u.changes.phone) data.phone = String(u.changes.phone.to).slice(0, 40);
    if (u.changes.unit) data.org_unit_id = unitIds.get(String(u.changes.unit.to).toLowerCase()) ?? null;
    if (u.changes.manager && ids.get(String(u.changes.manager.to))) data.manager_id = ids.get(String(u.changes.manager.to));
    await profile(u.email, data);
    out.updated++;
  }
  for (const [email, extra] of grants) {
    const cur = current.get(email);
    await profile(email, { roles: [...new Set([...(cur?.roles ?? []), ...extra])] });
    out.roles_granted += extra.length;
  }
  // group memberships of mapped groups
  const adds = new Map<string, string[]>();
  for (const g of plan.group_adds) {
    const userId = ids.get(g.email) ?? (g.user.includes("@") ? undefined : g.user);
    if (userId) adds.set(g.group_id, [...(adds.get(g.group_id) ?? []), userId]);
  }
  // membership of a group that grants roles or a (secure) workspace is a role grant: only when confirmed
  const granting = await grantingGroups(ctx.db, ctx.org.id, [...adds.keys()]);
  for (const [group, users] of adds) {
    if (granting.has(group) && !roles) {
      out.roles_pending += users.length;
      continue;
    }
    try {
      const r = await addGroupMembers(ctx, group, users);
      out.group_adds += r.added;
    } catch (e) {
      out.problems.push(`گروه ${group}: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  }
  if (plan.group_removes.length) {
    await ctx.write(async (tx) => {
      for (const g of plan.group_removes) {
        const [row] = await liveRows(tx, sysOf(ctx), "group_member", { and: [{ f: "group_id", op: "eq", v: g.group_id }, { f: "user_id", op: "eq", v: g.user }] }, { limit: 1 });
        if (row) {
          await removeIn(tx, ctx, "group_member", String(row.id));
          out.group_removes++;
        }
      }
    });
  }
  return out;
}

/** «اعمال»: apply the stored plan of a preview exactly as it was shown. */
export async function applyDirectory(ctx: Ctx, sourceId: string, runId: string, opts: { roles: boolean }): Promise<ApplyResult> {
  needIntegrations(ctx, "full");
  ctx.need("users", "edit");
  await needFeature(ctx, "directory_sync");
  if (ctx.actor === "support") throw forbidden("همگام‌سازی فهرست کاربران را مدیر خود سازمان اعمال می‌کند");
  // granting the mapped roles is sensitive administration
  if (opts.roles) needRecentAuth(ctx);
  const src = await sourceRow(ctx, sourceId);
  if (src.mode !== "apply") throw conflict("این منبع در حالت «فقط پیش‌نمایش» است؛ برای اعمال، حالت آن را «اعمال» کنید");
  const run = await ctx.db.one<{ plan: DirPlan | null; started_at: string | Date; kind: string; status: string }>(`select plan, started_at, kind, status from sm_directory_runs where id = $1 and org_id = $2 and source_id = $3`, [runId, ctx.org.id, sourceId]);
  if (!run || run.kind !== "preview" || run.status !== "done" || !run.plan) throw notFound("پیش‌نمایشی با این شناسه نیست");
  if (Date.now() - new Date(run.started_at).getTime() > 24 * HOUR) throw conflict("این پیش‌نمایش کهنه است؛ دوباره پیش‌نمایش بگیرید");
  const roles = opts.roles || !!src.auto_roles;
  const result = await applyPlan(ctx, src, run.plan, roles);
  await storeRun(ctx, sourceId, "apply", roles ? run.plan : withoutRoleGrants(run.plan), "done");
  const next = Number(src.schedule_hours ?? 0) > 0 ? new Date(Date.now() + Number(src.schedule_hours) * HOUR).toISOString() : null;
  await markSource(ctx, src, { health: "ok", last_run_at: new Date().toISOString(), next_run_at: next, approved_by: ctx.user.id, last_summary: summary(result) });
  if (next) await ctx.write((tx) => enqueue(tx, { kind: "integration.directory.sync", orgId: ctx.org.id, payload: { id: sourceId }, runAt: next, dedupeKey: `directory:${sourceId}`, maxAttempts: 2 }));
  return result;
}

export const summary = (r: ApplyResult) =>
  `${r.created} عضو تازه، ${r.updated} به‌روز، ${r.deactivated} غیرفعال، ${r.group_adds} عضویت گروه، ${r.roles_granted} نقش${r.roles_pending ? `، ${r.roles_pending} نقش در انتظار تأیید` : ""}${r.problems.length ? `، ${r.problems.length} مشکل` : ""}`;

/** Test the connection: bind and read up to five people. */
export async function testDirectory(ctx: Ctx, sourceId: string): Promise<{ ok: boolean; count: number; sample: { name: string; email: string | null }[]; message: string }> {
  needIntegrations(ctx, "edit");
  const src = await sourceRow(ctx, sourceId);
  if (src.kind !== "ldap") throw bad("آزمایش اتصال برای منبع LDAP است");
  // the result also reaches the platform owner's «سلامت سرور» (the latest test per source: names and the message only)
  const record = (ok: boolean, message: string) => recordDirectoryTest(ctx.db, { org_id: ctx.org.id, user_id: ctx.user.id, source_id: sourceId, ok, message }).catch(() => undefined);
  try {
    const entries = await readLdap(ctx.cfg, sysOf(ctx), src);
    const message = `اتصال برقرار است؛ ${entries.length.toLocaleString("fa-IR")} نفر خوانده شد`;
    await record(true, message);
    return { ok: true, count: entries.length, sample: entries.slice(0, 5).map((e) => ({ name: e.name, email: e.email })), message };
  } catch (e) {
    const message = String((e as Error).message ?? e);
    await record(false, message);
    return { ok: false, count: 0, sample: [], message };
  }
}

export async function directoryRuns(ctx: Ctx, sourceId: string) {
  needIntegrations(ctx, "view");
  return ctx.db.query(`select id, kind, status, started_by, started_at, finished_at, stats, error from sm_directory_runs where org_id = $1 and source_id = $2 order by started_at desc limit 50`, [ctx.org.id, sourceId]);
}

export async function directoryRun(ctx: Ctx, runId: string) {
  needIntegrations(ctx, "view");
  const r = await ctx.db.one(`select id, source_id, kind, status, started_by, started_at, finished_at, stats, plan, error from sm_directory_runs where id = $1 and org_id = $2`, [runId, ctx.org.id]);
  if (!r) throw notFound("اجرا پیدا نشد");
  return r;
}

let installed = false;
export function installDirectoryJobs(): void {
  if (installed) return;
  installed = true;
  // a scheduled synchronisation: as the member who approved the source (their access), roles only when automatic
  registerJobHandler("integration.directory.sync", async (job, jctx) => {
    if (!job.org_id) return;
    const cfg = jctx.cfg as ServerConfig;
    const sys = await systemCtx(cfg, job.org_id);
    const src = await liveRow(cfg.db, sys, "directory_source", job.payload.id);
    if (!src || src.active === false || src.kind !== "ldap" || src.mode !== "apply" || Number(src.schedule_hours ?? 0) <= 0) return;
    const fail = async (message: string) => {
      await storeRun(sys, String(src.id), "apply", null, "failed", message);
      await markSource(sys, src, { health: "failing", last_run_at: new Date().toISOString(), last_summary: message.slice(0, 2000) }, message);
    };
    const ctx = await approverCtx(cfg, job.org_id, src);
    if (!ctx) return void (await fail("تأییدکنندهٔ این منبع دیگر عضو فعال نیست یا اختیارش را ندارد؛ یک مدیر باید همگام‌سازی را دوباره تأیید و اعمال کند"));
    try {
      const entries = await readLdap(cfg, sys, src);
      const plan = await planFor(ctx, src, entries);
      // automatic roles only for the mappings the approver approved (as at sign-in): changed mappings wait for a new approval
      const result = await applyPlan(ctx, src, plan, rolesApproved(src));
      await storeRun(ctx, String(src.id), "apply", plan, "done");
      await markSource(sys, src, { health: "ok", last_run_at: new Date().toISOString(), next_run_at: new Date(Date.now() + Number(src.schedule_hours) * HOUR).toISOString(), last_summary: summary(result) });
      await intLog(cfg.db, { org_id: job.org_id, kind: "directory", ref_id: String(src.id), actor: ctx.user.id, ok: true, summary: summary(result) });
    } catch (e) {
      await fail(String((e as Error).message ?? e));
    }
    return { again: Number(src.schedule_hours) * HOUR };
  });
}

/**
 * The member a source's synchronisation acts as: its approver, while they are an active member who still holds
 * integrations (full) and users (edit). When they no longer do, the approval is withdrawn (the source falls back to
 * preview) and null is returned: a source never acts with rights its approver lost.
 */
export async function approverCtx(cfg: ServerConfig, orgId: string, src: Row): Promise<Ctx | null> {
  if (!src.approved_by) return null;
  const ctx = await memberCtx(cfg, orgId, String(src.approved_by)).catch(() => null);
  if (ctx && ctx.actor === "user" && ctx.can("integrations", "full") && ctx.can("users", "edit")) return ctx;
  const sys = await systemCtx(cfg, orgId);
  await markSource(sys, src, { approved_by: null, mode: "preview", health: "failing" }, "تأییدکنندهٔ این منبع دیگر عضو فعال نیست یا اختیار مدیریت اعضا و یکپارچه‌سازی را ندارد؛ یک مدیر باید آن را دوباره تأیید کند");
  return null;
}

/**
 * «تأیید منبع»: the administrator who approves a source lends it their access — scheduled LDAP runs and SCIM requests
 * act as them (and stop when they leave or lose their rights). Needs integrations (full) and users (edit).
 */
export async function approveSource(ctx: Ctx, sourceId: string): Promise<Row> {
  needIntegrations(ctx, "full");
  ctx.need("users", "edit");
  if (ctx.actor === "support") throw forbidden("منبع فهرست کاربران را مدیر خود سازمان تأیید می‌کند");
  needRecentAuth(ctx);
  const src = await sourceRow(ctx, sourceId);
  await needFeature(ctx, src.kind === "scim" ? "scim" : "directory_sync");
  // the approval covers these very mappings: a directory sign-in grants mapped roles only while they are unchanged
  const fingerprint = mappingFingerprint(src);
  await markSource(ctx, src, { approved_by: ctx.user.id, approved_map_hash: fingerprint });
  await audit(ctx.db, ctx, "directory_approve", "directory_source", sourceId, `تأیید منبع «${src.name}» و نگاشت‌های آن با دسترسی ${ctx.user.full_name || ctx.user.email}`, { mappings: mappingsOf(src).length, auto_roles: !!src.auto_roles });
  // the row as callers see it: secrets only as «set» (never their sealed value or its last characters)
  const row = await sourceRow(ctx, sourceId);
  for (const f of tableDef("directory_source")!.fields) if (f.type === "secret" && f.name in row) row[f.name] = secretView(row[f.name], { hint: f.hint });
  return row;
}
