// Account actions of «مدیریت سامانه»: disable/enable, sign out everywhere, a temporary password with
// a reason, and granting or revoking the platform admin role. Each one is written to the platform
// audit log (actor_kind 'platform') and as a security event. Guards: never on yourself, never the
// last active platform admin, never against an administrator whose address is listed in
// PLATFORM_ADMIN_EMAILS (the platform's owner: an admin he granted cannot lock him out or take his
// role — an account on a listed address that is not an administrator proves nothing and can be
// disabled), and never a temporary password for a platform admin, a listed address, or an account
// whose admin role was taken away in the last RECENT_ADMIN_DAYS days (it would let one admin sign
// in as another, directly or by first revoking the role; their password is changed by themselves
// or with their recovery code).
import type { AuthUser, ServerConfig } from "../../context";
import { bad, notFound } from "../../http/errors";
import { hashPassword, readableCode } from "../../auth/password";
import { platformAudit } from "./audit";
import { securityEvent } from "./security";

type Meta = { ip?: string | null; user_agent?: string | null };

interface Target {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  disabled: boolean;
}

async function target(cfg: ServerConfig, id: string): Promise<Target> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("کاربر پیدا نشد");
  const u = await cfg.db.one<Target>(`select id, email, full_name, is_platform_admin, disabled from tz_users where id = $1`, [id]);
  if (!u) throw notFound("کاربر پیدا نشد");
  return u;
}

const envAdmin = (cfg: ServerConfig, u: Target) => cfg.platformAdmins.includes(u.email.toLowerCase());
const ENV_ADMIN_MESSAGE = "این ایمیل در PLATFORM_ADMIN_EMAILS است (مالک سامانه)؛ نخست آن را از تنظیمات سرور بردارید";

const activeAdmins = async (cfg: ServerConfig) =>
  (await cfg.db.one<{ n: number }>(`select count(*)::int as n from tz_users where is_platform_admin and not disabled`))?.n ?? 0;

/** A former admin's account gets no temporary password for this long after the role was taken away. */
export const RECENT_ADMIN_DAYS = 7;

/** True when the account's platform admin role was revoked within RECENT_ADMIN_DAYS (platform audit log). */
export const recentlyAdmin = async (cfg: ServerConfig, id: string) =>
  !!(await cfg.db.one(
    `select 1 from tz_audit where action = 'admin_revoke' and actor_kind = 'platform' and entity = 'user' and entity_id = $1 and at > now() - make_interval(days => $2) limit 1`,
    [id, RECENT_ADMIN_DAYS],
  ));

/** Disables or enables an account; disabling also ends all of its sessions. */
export async function setUserDisabled(cfg: ServerConfig, admin: AuthUser, id: string, disabled: boolean, reason: string | null, meta: Meta = {}) {
  const u = await target(cfg, id);
  if (u.id === admin.id) throw bad("حساب خودتان را نمی‌توانید غیرفعال کنید");
  if (u.disabled === disabled) return { ok: true };
  if (disabled && u.is_platform_admin && envAdmin(cfg, u)) throw bad(ENV_ADMIN_MESSAGE);
  if (disabled && u.is_platform_admin && (await activeAdmins(cfg)) <= 1) throw bad("سامانه باید دست‌کم یک مدیر فعال داشته باشد");
  await cfg.db.tx(async (tx) => {
    // tz_user_touch gives the row a new revision so linked Windows apps receive the change
    await tx.query(`update tz_users set disabled = $2 where id = $1`, [id, disabled]);
    if (disabled) await tx.query(`update tz_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [id]);
    await platformAudit(tx, cfg, admin, {
      action: disabled ? "user_disable" : "user_enable",
      entity: "user",
      entity_id: id,
      summary: `${disabled ? "غیرفعال کردن" : "فعال کردن"} حساب ${u.email}${reason ? `؛ دلیل: ${reason}` : ""}`,
      data: reason ? { reason } : null,
    });
  });
  await securityEvent(cfg.db, { kind: disabled ? "user_disabled" : "user_enabled", user_id: id, email: u.email, ...meta, data: { by: admin.id, by_name: admin.full_name, reason } });
  return { ok: true };
}

/** «خروج از همهٔ دستگاه‌ها»: ends every web and Windows-app session of the account. */
export async function signOutEverywhere(cfg: ServerConfig, admin: AuthUser, id: string, meta: Meta = {}) {
  const u = await target(cfg, id);
  const n = await cfg.db.tx(async (tx) => {
    const rows = await tx.query(`update tz_sessions set revoked_at = now() where user_id = $1 and revoked_at is null returning id`, [id]);
    await platformAudit(tx, cfg, admin, { action: "user_sign_out", entity: "user", entity_id: id, summary: `خروج ${u.email} از همهٔ دستگاه‌ها (${rows.length} نشست)` });
    return rows.length;
  });
  await securityEvent(cfg.db, { kind: "sessions_revoked", user_id: id, email: u.email, ...meta, data: { by: admin.id, by_name: admin.full_name, sessions: n } });
  return { ok: true, sessions: n };
}

/** Sets a one-off password (shown once to the admin) and ends the account's sessions. */
export async function temporaryPassword(cfg: ServerConfig, admin: AuthUser, id: string, reason: string, meta: Meta = {}) {
  const u = await target(cfg, id);
  if (u.id === admin.id) throw bad("رمز خودتان را از «حساب من» عوض کنید");
  if (u.is_platform_admin || envAdmin(cfg, u)) throw bad("رمز مدیر سامانه را فقط خودش از «حساب من» یا با کد بازیابی عوض می‌کند");
  if (await recentlyAdmin(cfg, u.id))
    throw bad(`این حساب تا ${RECENT_ADMIN_DAYS} روز پیش مدیر سامانه بوده است؛ رمزش را خودش از «حساب من» یا با کد بازیابی عوض می‌کند`);
  const why = reason.trim();
  if (why.length < 5) throw bad("دلیل را بنویسید (دست‌کم ۵ نویسه)");
  const pw = readableCode(3, 4);
  const hash = await hashPassword(pw);
  await cfg.db.tx(async (tx) => {
    await tx.query(`update tz_users set password_hash = $2 where id = $1`, [id, hash]);
    await tx.query(`update tz_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [id]);
    await platformAudit(tx, cfg, admin, { action: "user_password", entity: "user", entity_id: id, summary: `رمز موقت برای ${u.email}؛ دلیل: ${why}`, data: { reason: why } });
  });
  await securityEvent(cfg.db, { kind: "password_reset", user_id: id, email: u.email, ...meta, data: { scope: "platform", reason: why.slice(0, 200), by: admin.id, by_name: admin.full_name } });
  return { ok: true, temp_password: pw };
}

/** Grants or revokes «مدیر کل سامانه». */
export async function setPlatformAdmin(cfg: ServerConfig, admin: AuthUser, id: string, granted: boolean, meta: Meta = {}) {
  const u = await target(cfg, id);
  if (u.id === admin.id) throw bad("دسترسی مدیر سامانهٔ خودتان را نمی‌توانید تغییر دهید");
  if (u.is_platform_admin === granted) return { ok: true };
  if (granted && u.disabled) throw bad("نخست حساب را فعال کنید");
  if (!granted) {
    if (envAdmin(cfg, u)) throw bad(ENV_ADMIN_MESSAGE);
    if (!u.disabled && (await activeAdmins(cfg)) <= 1) throw bad("سامانه باید دست‌کم یک مدیر فعال داشته باشد");
  }
  await cfg.db.tx(async (tx) => {
    await tx.query(`update tz_users set is_platform_admin = $2 where id = $1`, [id, granted]);
    // a revoked admin's live support sessions end with the role
    if (!granted) await tx.query(`update tz_support_sessions set ended_at = now(), ended_by = $2 where admin_user_id = $1 and ended_at is null and expires_at > now()`, [id, admin.id]);
    await platformAudit(tx, cfg, admin, {
      action: granted ? "admin_grant" : "admin_revoke",
      entity: "user",
      entity_id: id,
      summary: granted ? `دسترسی مدیر سامانه به ${u.email} داده شد` : `دسترسی مدیر سامانه از ${u.email} گرفته شد`,
    });
  });
  await securityEvent(cfg.db, { kind: "platform_admin", user_id: id, email: u.email, ...meta, data: { granted, by: admin.id, by_name: admin.full_name } });
  return { ok: true };
}
