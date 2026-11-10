// Members from a spreadsheet, a directory or an identity provider (catalogue ADM-003, INT-013, ACC-077): the one place
// that creates accounts and memberships in bulk, used by «ورود گروهی اعضا», the LDAP/AD synchronisation and SCIM.
// Rules: a new account gets no password (the person sets one with «فراموشی رمز» or the administrator's «رمز تازه»);
// service addresses (.invalid) and the platform's administrators' addresses are refused; nobody gets a role silently —
// a role is given only when the administrator named it for this import (or the directory source's default role), and
// through the access service, which refuses grants above the administrator's own; the plan's ceiling of members holds.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { insertRow } from "../../db/sql";
import { uuidv7 } from "@shared/id";
import { isEmail, isReservedEmail } from "@shared/validate";
import { bad, forbidden } from "../../http/errors";
import { audit } from "../data/crud";
import { securityEvent } from "../platform/security";
import { addGroupMembers, saveMemberAccess } from "../../access";
import { createIn, updateIn } from "../../engine";
import { RESETTABLE_SQL } from "../platform/members";
import { liveRows, needWithinLimit, sysOf } from "./common";

export type MembershipRole = "member" | "viewer";

export interface PersonInput {
  email: string;
  name: string;
  title?: string | null;
  phone?: string | null;
  /** a unit's name (matched case-insensitively; created when `createUnits`) */
  unit?: string | null;
  /** the manager's e-mail */
  manager?: string | null;
  /** group names or ids */
  groups?: string[];
}

export interface ImportOptions {
  dryRun: boolean;
  membershipRole: MembershipRole;
  /** the ITSM role every imported member gets (named by the administrator), or none */
  role: string | null;
  createUnits?: boolean;
}

export interface ImportRowResult {
  row: number;
  email: string;
  action: "create" | "update" | "skip";
  message?: string;
}

export interface MemberImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  units: string[];
  rows: ImportRowResult[];
}

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();

interface Existing {
  user_id: string;
  email: string;
  member: boolean;
  active: boolean;
}

async function existingPeople(q: Tx | Ctx["db"], orgId: string, emails: string[]): Promise<Map<string, Existing>> {
  if (!emails.length) return new Map();
  const rows = await q.query<{ user_id: string; email: string; member: boolean; active: boolean | null }>(
    `select u.id as user_id, lower(u.email) as email, (m.id is not null and m.deleted_at is null) as member, m.is_active as active
     from sm_users u left join sm_org_members m on m.user_id = u.id and m.org_id = $1
     where lower(u.email) = any($2::text[])`,
    [orgId, `{${emails.map((e) => `"${e.replace(/"/g, "")}"`).join(",")}}`],
  );
  return new Map(rows.map((r) => [r.email, { user_id: r.user_id, email: r.email, member: r.member, active: !!r.active }]));
}

/** Create the account and membership of a person (or bring a removed membership back). */
export async function ensurePerson(tx: Tx, ctx: Ctx, p: { email: string; name: string; title?: string | null }, membershipRole: MembershipRole): Promise<{ user_id: string; created: boolean; joined: boolean }> {
  const email = lower(p.email);
  let user = await tx.one<{ id: string }>(`select id from sm_users where lower(email) = $1`, [email]);
  const created = !user;
  if (!user) user = await insertRow<{ id: string }>(tx, "sm_users", { id: uuidv7(), email, full_name: p.name.slice(0, 120), password_hash: null }, "id");
  const m = await tx.one<{ id: string; deleted_at: string | null; is_active: boolean }>(`select id, deleted_at, is_active from sm_org_members where org_id = $1 and user_id = $2`, [ctx.org.id, user.id]);
  let joined = false;
  if (!m) {
    await insertRow(tx, "sm_org_members", { id: uuidv7(), org_id: ctx.org.id, user_id: user.id, role: membershipRole, title: p.title ?? null, origin: ctx.cfg.origin }, "id");
    joined = true;
  } else if (m.deleted_at) {
    await tx.query(`update sm_org_members set deleted_at = null, is_active = true, role = $2, overrides = '{}'::jsonb, title = coalesce($3, title) where id = $1`, [m.id, membershipRole, p.title ?? null]);
    joined = true;
  }
  // new_account marks an account this organisation made (createdHere: only such an account's own data is the
  // organisation's to change — its password, its name from a directory)
  if (joined) await audit(tx, ctx, "member_add", "member", user.id, `${email} (از فهرست کاربران)`, { new_account: created });
  return { user_id: user.id, created, joined };
}

/**
 * A directory's (LDAP, SCIM) name for a member. The account is global — the same person in other organisations — so
 * its name changes only when this organisation made it for someone who works for no other organisation and is no
 * platform admin (the rule of password resets); otherwise only this organisation's member profile shows the
 * directory's name.
 */
export async function setDirectoryName(tx: Tx, ctx: Ctx, userId: string, name: string): Promise<"account" | "profile" | "none"> {
  const clean = String(name ?? "").trim().slice(0, 120);
  if (!clean) return "none";
  const own = await tx.one(`select 1 from sm_users u where u.id = $2::uuid and ${RESETTABLE_SQL("$1", "u")}`, [ctx.org.id, userId]);
  if (own) {
    await tx.query(`update sm_users set full_name = $2 where id = $1`, [userId, clean]);
    return "account";
  }
  const sys = sysOf(ctx);
  const [profile] = await liveRows(tx, sys, "member_profile", { f: "user_id", op: "eq", v: userId }, { limit: 1 });
  if (!profile) return "none";
  if (profile.name !== clean) await updateIn(tx, sys, "member_profile", String(profile.id), { name: clean }, { trusted: true });
  return "profile";
}

/** Switch a membership off or on (never an owner or a «مدیر», never the acting administrator). */
export async function setMemberActive(tx: Tx, ctx: Ctx, userId: string, active: boolean): Promise<boolean> {
  if (userId === ctx.user.id) return false;
  const r = await tx.one<{ id: string }>(
    `update sm_org_members set is_active = $3 where org_id = $1 and user_id = $2 and deleted_at is null and role not in ('owner', 'admin') and is_active <> $3 returning id`,
    [ctx.org.id, userId, active],
  );
  return !!r;
}

/** Import people (a spreadsheet's rows): a plan (dry run) or the import itself. */
export async function importMembers(ctx: Ctx, input: PersonInput[], opts: ImportOptions): Promise<MemberImportResult> {
  ctx.need("users", "edit");
  if (ctx.actor === "support") throw forbidden("ورود گروهی اعضا را مدیر خود سازمان انجام می‌دهد");
  if (input.length > 2000) throw bad("در هر بار حداکثر ۲۰۰۰ نفر");
  const result: MemberImportResult = { dryRun: opts.dryRun, created: 0, updated: 0, skipped: 0, units: [], rows: [] };
  const sys = sysOf(ctx);
  const units = await liveRows(ctx.db, sys, "org_unit", null);
  const groups = await liveRows(ctx.db, sys, "group", null);
  const unitByName = new Map(units.map((u) => [lower(u.name), String(u.id)]));
  const groupOf = (g: string) => groups.find((x) => String(x.id) === g || lower(x.name) === lower(g));
  const emails = [...new Set(input.map((r) => lower(r.email)).filter(Boolean))];
  const known = await existingPeople(ctx.db, ctx.org.id, emails);
  const seen = new Set<string>();
  const accepted: (PersonInput & { row: number; email: string; existing: Existing | undefined })[] = [];
  for (const [i, r] of input.entries()) {
    const row = i + 1;
    const email = lower(r.email);
    const skip = (message: string) => {
      result.skipped++;
      result.rows.push({ row, email, action: "skip", message });
    };
    if (!email || !isEmail(email)) {
      skip("ایمیل معتبر نیست");
      continue;
    }
    if (isReservedEmail(email)) {
      skip("این نشانی برای حساب‌های خدمت سامانه کنار گذاشته شده است");
      continue;
    }
    if (ctx.cfg.platformAdmins?.includes(email)) {
      skip("این نشانی مدیر سامانه است و حساب آن را خودش می‌سازد");
      continue;
    }
    if (seen.has(email)) {
      skip("ایمیل تکراری در فایل");
      continue;
    }
    seen.add(email);
    if (!String(r.name ?? "").trim() || String(r.name).trim().length < 2) {
      skip("نام وارد نشده است");
      continue;
    }
    const missing = (r.groups ?? []).filter((g) => g.trim() && !groupOf(g.trim()));
    if (missing.length) {
      skip(`گروه «${missing[0]}» پیدا نشد`);
      continue;
    }
    const unit = r.unit?.trim();
    if (unit && !unitByName.has(lower(unit))) {
      if (!opts.createUnits) {
        skip(`واحد «${unit}» پیدا نشد`);
        continue;
      }
      if (!result.units.includes(unit)) result.units.push(unit);
    }
    const existing = known.get(email);
    const action = existing?.member ? "update" : "create";
    if (action === "create") result.created++;
    else result.updated++;
    result.rows.push({ row, email, action });
    accepted.push({ ...r, row, email, existing });
  }
  if (opts.dryRun) return result;
  if (result.created) await needWithinLimit(ctx.db, ctx.cfg, ctx.org.id, "members", result.created);

  // accounts, memberships and new units in one transaction
  const ids = new Map<string, string>();
  const joinedNow: string[] = [];
  await ctx.write(async (tx) => {
    for (const name of result.units) {
      const u = await createIn(tx, ctx, "org_unit", { name: name.slice(0, 120), kind: "department" });
      unitByName.set(lower(name), String(u.id));
    }
    for (const p of accepted) {
      const r = await ensurePerson(tx, ctx, { email: p.email, name: p.name.trim(), title: p.title ?? null }, opts.membershipRole);
      ids.set(p.email, r.user_id);
      if (r.joined) joinedNow.push(p.email);
    }
    await audit(tx, ctx, "member_import", "member", null, `ورود گروهی اعضا: ${result.created} تازه، ${result.updated} به‌روز`, { created: result.created, updated: result.updated, role: opts.role, membership: opts.membershipRole });
  });
  for (const email of joinedNow) {
    await securityEvent(ctx.db, { kind: "member_added", user_id: ids.get(email)!, email, org_id: ctx.org.id, data: { role: opts.membershipRole, by: ctx.user.id, by_name: ctx.user.full_name, via: "import", itsm_role: opts.role } });
  }
  // profiles (roles only when named, through the access service: no grant above the administrator's own)
  for (const p of accepted) {
    const userId = ids.get(p.email)!;
    const profile: Record<string, unknown> = {};
    if (opts.role && p.existing?.member !== true) {
      profile.roles = [opts.role];
      profile.persona = opts.role === "requester" ? "requester" : "agent";
    }
    if (p.title?.trim()) profile.title = p.title.trim().slice(0, 120);
    if (p.phone?.trim()) profile.phone = p.phone.trim().slice(0, 40);
    const unit = p.unit?.trim() ? unitByName.get(lower(p.unit)) : undefined;
    if (unit) profile.org_unit_id = unit;
    const manager = p.manager ? ids.get(lower(p.manager)) ?? known.get(lower(p.manager))?.user_id : undefined;
    if (manager && manager !== userId) profile.manager_id = manager;
    if (!Object.keys(profile).length) continue;
    try {
      await saveMemberAccess(ctx, userId, profile);
    } catch (e) {
      const at = result.rows.find((x) => x.email === p.email);
      if (at) at.message = `عضو ثبت شد؛ نمایه: ${String((e as Error).message ?? e).slice(0, 200)}`;
    }
  }
  // group memberships
  const byGroup = new Map<string, string[]>();
  for (const p of accepted) for (const g of p.groups ?? []) {
    const grp = groupOf(g.trim());
    if (!grp) continue;
    byGroup.set(String(grp.id), [...(byGroup.get(String(grp.id)) ?? []), ids.get(p.email)!]);
  }
  for (const [groupId, users] of byGroup) await addGroupMembers(ctx, groupId, users);
  return result;
}
