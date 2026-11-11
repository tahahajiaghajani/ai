// SCIM 2.0 provisioning (catalogue INT-013, ACC-077) for Microsoft Entra ID and other identity providers, at
// /api/v1/scim/:source/… with the source's secret token. The identity provider creates, changes and switches off
// people; members are matched by e-mail and linked to the provider's ids (sm_directory_links). Nothing is ever deleted
// (a removed person is switched off). Groups are linked, never created as ITSM groups: membership changes reach only the
// ITSM groups an administrator mapped, and roles mapped to them are granted only with automatic roles on the source and
// an approval that covers the current mappings (rolesApproved: approved_map_hash; otherwise they wait for the
// administrator, like LDAP sync and directory sign-in). In «پیش‌نمایش» mode (a dry run) requests are answered and recorded in
// the source's run log, and nothing changes. Writes act as the member who approved the source — never the system.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Ctx, ServerConfig } from "../../context";
import { uuidv7 } from "@shared/id";
import { tableDef } from "@shared/tables";
import { isEmail, isReservedEmail } from "@shared/validate";
import { patchGroup, patchUser, SCIM_GROUP, SCIM_USER, scimList, userFromScim, parseScimFilter, type PatchOp, type ScimUserInput } from "@shared/integration/scim";
import { groupMatches } from "@shared/integration/directory";
import { readSecret, systemCtx } from "../../engine";
import { addGroupMembers, memberCtx, saveMemberAccess } from "../../access";
import { hasFeature, limitAtCommit, needWithinLimit } from "../admin/common";
import { ensurePerson, setDirectoryName, setMemberActive } from "../admin/members";
import { removeIn } from "../../engine";
import { grantingGroups, intLog, liveRow, liveRows, sysOf, isUuid, type Row } from "./common";
import { approverCtx, mappingsOf, optionsOf } from "./directory";
import { rolesApproved } from "./directory-login";

export class ScimError extends Error {
  constructor(public status: number, message: string, public scimType?: string) {
    super(message);
  }
}

export interface ScimSession {
  cfg: ServerConfig;
  orgId: string;
  source: Row;
  sys: Ctx;
  /** the approving member's context (apply mode) */
  ctx: Ctx | null;
  dryRun: boolean;
  base: string;
}

const safeEqual = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

/** Authenticate a SCIM request (the source's token) and open its session. */
export async function scimSession(cfg: ServerConfig, sourceId: string, authorization: string | undefined, base: string): Promise<ScimSession> {
  if (!isUuid(sourceId)) throw new ScimError(404, "منبع SCIM پیدا نشد");
  const r = await cfg.db.one<{ org_id: string }>(`select org_id from sm_directory_sources where id = $1 and deleted_at is null`, [sourceId]);
  if (!r) throw new ScimError(404, "منبع SCIM پیدا نشد");
  const sys = await systemCtx(cfg, r.org_id);
  const source = await liveRow(cfg.db, sys, "directory_source", sourceId);
  if (!source || source.kind !== "scim") throw new ScimError(404, "منبع SCIM پیدا نشد");
  const token = await readSecret(cfg.db, sys, tableDef("directory_source")!, sourceId, "scim_token");
  const given = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !given || !safeEqual(token, given)) {
    await intLog(cfg.db, { org_id: r.org_id, kind: "scim", ref_id: sourceId, status: 401, ok: false, summary: "توکن SCIM نادرست" });
    throw new ScimError(401, "توکن SCIM معتبر نیست");
  }
  if (source.active === false) throw new ScimError(403, "این منبع SCIM غیرفعال است");
  if (!(await hasFeature(cfg.db, r.org_id, "scim", cfg.mode))) throw new ScimError(403, "تأمین کاربر با SCIM برای این سازمان روشن نیست");
  const dryRun = source.mode !== "apply";
  let ctx: Ctx | null = null;
  if (!dryRun) {
    if (!source.approved_by) throw new ScimError(403, "این منبع SCIM هنوز از سوی مدیری تأیید نشده است");
    ctx = await approverCtx(cfg, r.org_id, source);
    if (!ctx) throw new ScimError(403, "تأییدکنندهٔ این منبع دیگر عضو فعال نیست یا اختیارش را ندارد");
  }
  return { cfg, orgId: r.org_id, source, sys, ctx, dryRun, base };
}

/** A request recorded in the dry run's log (today's run of the source). */
async function record(s: ScimSession, item: Record<string, unknown>): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const run = await s.cfg.db.one<{ id: string; plan: { items?: unknown[] } | null }>(
    `select id, plan from sm_directory_runs where org_id = $1 and source_id = $2 and kind = 'scim' and started_at::date = $3::date order by started_at desc limit 1`,
    [s.orgId, s.source.id, today],
  );
  const entry = { at: new Date().toISOString(), dry_run: s.dryRun, ...item };
  if (run) {
    const items = [...((run.plan?.items as unknown[]) ?? []), entry].slice(-500);
    await s.cfg.db.query(`update sm_directory_runs set plan = $2, stats = jsonb_build_object('requests', $3::int), finished_at = now() where id = $1`, [run.id, { items }, items.length]);
  } else {
    await s.cfg.db.query(`insert into sm_directory_runs (id, org_id, source_id, kind, status, finished_at, stats, plan) values ($1, $2, $3, 'scim', 'done', now(), $4, $5)`, [uuidv7(), s.orgId, s.source.id, { requests: 1 }, { items: [entry] }]);
  }
}

// ---------------------------------------------------------------- users

interface MemberView {
  user_id: string;
  email: string;
  name: string;
  active: boolean;
  title: string | null;
  external: string | null;
}

async function memberById(s: ScimSession, userId: string): Promise<MemberView | null> {
  if (!isUuid(userId)) return null;
  return s.cfg.db.one<MemberView>(
    `select m.user_id, lower(u.email) as email, coalesce(nullif(p.name, ''), nullif(u.full_name, ''), u.email) as name, m.is_active as active, p.title,
            (select l.external_id from sm_directory_links l where l.source_id = $3 and l.kind = 'user' and l.local_id = m.user_id limit 1) as external
     from sm_org_members m join sm_users u on u.id = m.user_id left join sm_member_profiles p on p.org_id = m.org_id and p.user_id = m.user_id and p.deleted_at is null
     where m.org_id = $1 and m.user_id = $2 and m.deleted_at is null`,
    [s.orgId, userId, s.source.id],
  );
}

async function memberByEmail(s: ScimSession, email: string): Promise<MemberView | null> {
  const r = await s.cfg.db.one<{ user_id: string }>(`select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and lower(u.email) = $2 and m.deleted_at is null`, [s.orgId, email.toLowerCase()]);
  return r ? memberById(s, r.user_id) : null;
}

export function userResource(s: ScimSession, m: MemberView) {
  return {
    schemas: [SCIM_USER],
    id: m.user_id,
    externalId: m.external ?? undefined,
    userName: m.email,
    displayName: m.name,
    name: { formatted: m.name },
    title: m.title ?? undefined,
    emails: [{ value: m.email, type: "work", primary: true }],
    active: m.active,
    meta: { resourceType: "User", location: `${s.base}/Users/${m.user_id}` },
  };
}

async function link(s: ScimSession, kind: "user" | "group", external: string, local: string, name: string | null): Promise<void> {
  await s.cfg.db.query(
    `insert into sm_directory_links (org_id, source_id, kind, external_id, local_id, external_name, active, updated_at) values ($1, $2, $3, $4, $5, $6, true, now())
     on conflict (source_id, kind, external_id) do update set local_id = excluded.local_id, external_name = excluded.external_name, active = true, updated_at = now()`,
    [s.orgId, s.source.id, kind, external, local, name],
  );
}

export async function listUsers(s: ScimSession, filter: string | null, startIndex: number, count: number) {
  const f = parseScimFilter(filter);
  if (filter && !f) throw new ScimError(400, "این پالایه پشتیبانی نمی‌شود", "invalidFilter");
  if (s.dryRun) return scimList([], startIndex, 0);
  let found: MemberView[] = [];
  if (f && (f.attr === "username" || f.attr === "emails.value" || f.attr === "emails[type eq \"work\"].value")) {
    const m = await memberByEmail(s, f.value);
    found = m ? [m] : [];
  } else if (f && f.attr === "externalid") {
    const l = await s.cfg.db.one<{ local_id: string }>(`select local_id from sm_directory_links where source_id = $1 and kind = 'user' and external_id = $2`, [s.source.id, f.value]);
    const m = l ? await memberById(s, l.local_id) : null;
    found = m ? [m] : [];
  } else if (!f) {
    const rows = await s.cfg.db.query<{ local_id: string }>(`select local_id from sm_directory_links where source_id = $1 and kind = 'user' order by updated_at limit $2 offset $3`, [s.source.id, count, Math.max(0, startIndex - 1)]);
    for (const r of rows) {
      const m = await memberById(s, r.local_id);
      if (m) found.push(m);
    }
  } else throw new ScimError(400, "این پالایه پشتیبانی نمی‌شود", "invalidFilter");
  return scimList(found.map((m) => userResource(s, m)), startIndex, found.length);
}

export async function getUser(s: ScimSession, id: string) {
  const m = await memberById(s, id);
  if (!m) throw new ScimError(404, "کاربر پیدا نشد");
  return userResource(s, m);
}

async function applyProfile(s: ScimSession, userId: string, u: ScimUserInput, isNew: boolean): Promise<void> {
  const data: Record<string, unknown> = {};
  const opts = optionsOf(s.source);
  if (isNew && opts.default_role) {
    data.roles = [opts.default_role];
    data.persona = opts.default_role === "requester" ? "requester" : "agent";
  }
  if (u.title) data.title = u.title.slice(0, 120);
  if (u.phone) data.phone = u.phone.slice(0, 40);
  if (Object.keys(data).length) await saveMemberAccess(s.ctx!, userId, data);
}

export async function createUser(s: ScimSession, body: Record<string, unknown>) {
  const u = userFromScim(body);
  if (!u.email || !isEmail(u.email)) throw new ScimError(400, "ایمیل کاربر معتبر نیست", "invalidValue");
  if (isReservedEmail(u.email)) throw new ScimError(400, "این نشانی برای حساب‌های خدمت کنار گذاشته شده است", "invalidValue");
  if (s.cfg.platformAdmins?.includes(u.email.toLowerCase())) throw new ScimError(400, "این نشانی مدیر سامانه است و حساب آن را خودش می‌سازد", "invalidValue");
  await record(s, { op: "create_user", email: u.email, name: u.name, active: u.active, external: u.externalId ?? u.userName });
  if (s.dryRun) return { ...userResource(s, { user_id: uuidv7(), email: u.email, name: u.name ?? u.email, active: u.active, title: u.title, external: u.externalId }), meta: { resourceType: "User", note: "dry-run" } };
  const existing = await memberByEmail(s, u.email);
  if (existing && existing.external && existing.external !== (u.externalId ?? u.userName)) throw new ScimError(409, "کاربری با این ایمیل هست", "uniqueness");
  if (!existing) await needWithinLimit(s.cfg.db, s.cfg, s.orgId, "members", 1);
  const ctx = s.ctx!;
  const r = await ctx.write(async (tx) => {
    // the seat ceiling again at commit (members added since the count above)
    if (!existing) limitAtCommit(tx, s.cfg, s.orgId, "members");
    return ensurePerson(tx, ctx, { email: u.email!, name: u.name ?? u.email!, title: u.title }, s.source.membership_role === "member" ? "member" : "viewer");
  });
  await link(s, "user", u.externalId ?? u.userName ?? u.email, r.user_id, u.email);
  if (!u.active) await ctx.write((tx) => setMemberActive(tx, ctx, r.user_id, false));
  await applyProfile(s, r.user_id, u, r.joined && !existing);
  await intLog(s.cfg.db, { org_id: s.orgId, kind: "scim", ref_id: String(s.source.id), method: "POST", target: "/Users", status: 201, ok: true, summary: `ساخت ${u.email}` });
  return getUser(s, r.user_id);
}

export async function patchUserById(s: ScimSession, id: string, ops: PatchOp[], replace?: Record<string, unknown>) {
  const m = await memberById(s, id);
  await record(s, { op: replace ? "replace_user" : "patch_user", id, ops: replace ? undefined : ops.map((o) => ({ op: o.op, path: o.path })) });
  if (s.dryRun) {
    if (!m) throw new ScimError(404, "کاربر پیدا نشد");
    return userResource(s, m);
  }
  if (!m) throw new ScimError(404, "کاربر پیدا نشد");
  const cur: ScimUserInput = { userName: m.email, externalId: m.external, email: m.email, name: m.name, title: m.title, phone: null, department: null, active: m.active };
  const next = replace ? userFromScim(replace) : patchUser(cur, ops);
  const ctx = s.ctx!;
  await ctx.write(async (tx) => {
    // the global account's name only when the account is this organisation's own; else the member profile's
    if (next.name && next.name !== m.name) await setDirectoryName(tx, ctx, id, next.name);
    if (next.active !== m.active) await setMemberActive(tx, ctx, id, next.active);
  });
  if (next.title !== cur.title || next.phone) await applyProfile(s, id, { ...next, title: next.title !== cur.title ? next.title : null }, false);
  await intLog(s.cfg.db, { org_id: s.orgId, kind: "scim", ref_id: String(s.source.id), method: "PATCH", target: "/Users", status: 200, ok: true, summary: `${m.email}${next.active !== m.active ? (next.active ? " فعال شد" : " غیرفعال شد") : ""}` });
  return getUser(s, id);
}

/** DELETE: the person is switched off (never deleted). */
export async function deleteUser(s: ScimSession, id: string): Promise<void> {
  const m = await memberById(s, id);
  await record(s, { op: "delete_user", id });
  if (!m) throw new ScimError(404, "کاربر پیدا نشد");
  if (s.dryRun) return;
  const ctx = s.ctx!;
  await ctx.write((tx) => setMemberActive(tx, ctx, id, false));
  await intLog(s.cfg.db, { org_id: s.orgId, kind: "scim", ref_id: String(s.source.id), method: "DELETE", target: "/Users", status: 204, ok: true, summary: `غیرفعال کردن ${m.email}` });
}

// ---------------------------------------------------------------- groups (linked, never created)

interface GroupLink {
  id: string;
  name: string;
  /** the mapped ITSM group (null: observed only) */
  group_id: string | null;
  role: string | null;
}

async function groupLinks(s: ScimSession): Promise<GroupLink[]> {
  const rows = await s.cfg.db.query<{ external_id: string; local_id: string; external_name: string | null }>(`select external_id, local_id, external_name from sm_directory_links where source_id = $1 and kind = 'group' and active`, [s.source.id]);
  const maps = mappingsOf(s.source);
  return rows.map((r) => {
    const name = r.external_name ?? r.external_id;
    const m = maps.find((x) => groupMatches(name, x.source));
    return { id: r.local_id, name, group_id: m?.group_id ?? null, role: m?.role ?? null };
  });
}

const groupResource = (s: ScimSession, g: GroupLink) => ({ schemas: [SCIM_GROUP], id: g.id, displayName: g.name, meta: { resourceType: "Group", location: `${s.base}/Groups/${g.id}` } });

export async function listGroups(s: ScimSession, filter: string | null, startIndex: number) {
  const f = parseScimFilter(filter);
  if (filter && (!f || f.attr !== "displayname")) throw new ScimError(400, "این پالایه پشتیبانی نمی‌شود", "invalidFilter");
  if (s.dryRun) return scimList([], startIndex, 0);
  const links = await groupLinks(s);
  const found = f ? links.filter((g) => g.name.toLowerCase() === f.value.toLowerCase()) : links;
  return scimList(found.map((g) => groupResource(s, g)), startIndex, found.length);
}

export async function createGroup(s: ScimSession, body: Record<string, unknown>) {
  const name = String(body.displayName ?? "").trim();
  if (!name) throw new ScimError(400, "نام گروه خالی است", "invalidValue");
  await record(s, { op: "create_group", name });
  const id = uuidv7();
  if (!s.dryRun) {
    const existing = (await groupLinks(s)).find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (existing) throw new ScimError(409, "گروهی با این نام هست", "uniqueness");
    await link(s, "group", name, id, name);
    const members = Array.isArray(body.members) ? (body.members as { value?: string }[]).map((x) => String(x?.value ?? "")).filter(Boolean) : [];
    if (members.length) await changeMembers(s, id, members, []);
  }
  return groupResource(s, { id, name, group_id: null, role: null });
}

async function changeMembers(s: ScimSession, groupId: string, add: string[], remove: string[]): Promise<{ added: number; removed: number; pending_roles: number }> {
  const g = (await groupLinks(s)).find((x) => x.id === groupId);
  if (!g) throw new ScimError(404, "گروه پیدا نشد");
  const out = { added: 0, removed: 0, pending_roles: 0 };
  const ctx = s.ctx!;
  const users = add.filter(isUuid);
  // a group whose membership grants roles or a (secure) workspace is a role grant: only with automatic roles on
  const grants = g.group_id ? (await grantingGroups(s.cfg.db, s.orgId, [g.group_id])).has(g.group_id) : false;
  // (and only while the approval covers the current mappings — the same rule as LDAP sync and directory sign-in)
  const approved = rolesApproved(s.source);
  if (g.group_id && users.length && grants && !approved) out.pending_roles += users.length;
  else if (g.group_id && users.length) out.added = (await addGroupMembers(ctx, g.group_id, users)).added;
  if (g.group_id && remove.length) {
    await ctx.write(async (tx) => {
      for (const u of remove.filter(isUuid)) {
        const [row] = await liveRows(tx, sysOf(ctx), "group_member", { and: [{ f: "group_id", op: "eq", v: g.group_id }, { f: "user_id", op: "eq", v: u }] }, { limit: 1 });
        if (row) {
          await removeIn(tx, ctx, "group_member", String(row.id));
          out.removed++;
        }
      }
    });
  }
  if (g.role && users.length) {
    if (approved) {
      for (const u of users) {
        const p = await s.cfg.db.one<{ roles: unknown }>(`select roles from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [s.orgId, u]);
        const roles = Array.isArray(p?.roles) ? (p!.roles as string[]) : [];
        if (!roles.includes(g.role)) await saveMemberAccess(ctx, u, { roles: [...roles, g.role] });
      }
    } else out.pending_roles += users.length;
  }
  return out;
}

export async function getGroup(s: ScimSession, id: string) {
  const g = (await groupLinks(s)).find((x) => x.id === id);
  if (!g) throw new ScimError(404, "گروه پیدا نشد");
  return groupResource(s, g);
}

export async function patchGroupById(s: ScimSession, id: string, ops: PatchOp[]) {
  const p = patchGroup(ops);
  await record(s, { op: "patch_group", id, add: p.add.length, remove: p.remove.length, rename: p.displayName });
  if (s.dryRun) return null;
  const g = (await groupLinks(s)).find((x) => x.id === id);
  if (!g) throw new ScimError(404, "گروه پیدا نشد");
  if (p.displayName && p.displayName !== g.name) await s.cfg.db.query(`update sm_directory_links set external_name = $3, updated_at = now() where source_id = $1 and kind = 'group' and local_id = $2`, [s.source.id, id, p.displayName]);
  const r = await changeMembers(s, id, p.add, p.remove);
  await intLog(s.cfg.db, { org_id: s.orgId, kind: "scim", ref_id: String(s.source.id), method: "PATCH", target: "/Groups", status: 204, ok: true, summary: `${g.name}: +${r.added} −${r.removed}${r.pending_roles ? `، ${r.pending_roles} نقش در انتظار تأیید` : ""}` });
  return null;
}

export async function deleteGroup(s: ScimSession, id: string): Promise<void> {
  await record(s, { op: "delete_group", id });
  if (s.dryRun) return;
  await s.cfg.db.query(`update sm_directory_links set active = false, updated_at = now() where source_id = $1 and kind = 'group' and local_id = $2`, [s.source.id, id]);
}

export function serviceProviderConfig(base: string) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: `${base}`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "توکن SCIM منبع فهرست کاربران", primary: true }],
  };
}

export { sysOf };
