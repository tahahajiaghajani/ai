// /api/auth — sign up, sign in, sign out, current user, password change and recovery.
import { z } from "zod";
import { router, body, requireUser, limitByIp, rateLimit } from "../http/hono";
import { bad, forbidden, tooMany, unauthorized } from "../http/errors";
import { hashPassword, verifyPassword, passwordProblem, readableCode, sha256 } from "../auth/password";
import { issueSession, setSessionCookie, clearSessionCookie, revokeSession, clientIp } from "../auth/session";
import { accessibleOrgs } from "../modules/platform/support";
import { firstRateLimitHit, requestMeta, securityEvent } from "../modules/platform/security";
import { AppError } from "../http/errors";
import { uuidv7 } from "@shared/id";
import { isEmail, isReservedEmail } from "@shared/validate";

const email = z.string().trim().toLowerCase().refine(isEmail, "ایمیل معتبر نیست");
/** A new account's address: never one of the reserved service domain (`isReservedEmail`). */
const newEmail = email.refine((e) => !isReservedEmail(e), "این نشانی برای حساب‌های خدمت سامانه کنار گذاشته شده است");

export const authRoutes = router();

const hasActiveAdmin = async (db: import("../db").Db) =>
  !!(await db.one(`select 1 from sm_users where is_platform_admin and not disabled limit 1`));

authRoutes.post("/signup", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "signup", 10, 3600000);
  const input = await body(c, z.object({ email: newEmail, password: z.string(), full_name: z.string().trim().min(2, "نام را کامل وارد کنید").max(120), mobile: z.string().trim().max(20).optional() }));
  const count = await cfg.db.one<{ n: number }>(`select count(*)::int as n from sm_users`);
  const first = (count?.n ?? 0) === 0;
  // An address in PLATFORM_ADMIN_EMAILS is no proof of owning it (nothing is e-mailed): it opens a
  // closed sign-up and becomes administrator only while the platform has no active administrator
  // (the owner's first account). Later addresses are granted from «مدیریت سامانه».
  const bootstrap = cfg.platformAdmins.includes(input.email) && !(await hasActiveAdmin(cfg.db));
  if (!first && !cfg.allowSignup && !bootstrap) throw forbidden(cfg.mode === "desktop" ? "کاربر جدید را مدیر از «تنظیمات ← کاربران» اضافه می‌کند" : "ثبت‌نام در این سامانه بسته است");
  const problem = passwordProblem(input.password);
  if (problem) throw bad(problem);
  const exists = await cfg.db.one(`select 1 from sm_users where lower(email) = $1`, [input.email]);
  if (exists) throw bad("با این ایمیل قبلاً حساب ساخته شده است؛ وارد شوید");
  const recovery = readableCode(4, 4);
  // the first account administers the platform only while no owner email is configured;
  // otherwise whoever reached a fresh deployment first would see every organisation
  const isAdmin = bootstrap || (first && !cfg.platformAdmins.length);
  const user = await cfg.db.one<{ id: string }>(
    `insert into sm_users (id, email, full_name, mobile, password_hash, recovery_hash, is_platform_admin)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [uuidv7(), input.email, input.full_name, input.mobile || null, await hashPassword(input.password), sha256(recovery.replace(/-/g, "")), isAdmin],
  );
  const { token } = await issueSession(cfg.db, user!.id, "web", { ip: clientIp(c), userAgent: c.req.header("user-agent") });
  setSessionCookie(c, token);
  await securityEvent(cfg.db, { kind: "sign_up", user_id: user!.id, email: input.email, ...requestMeta(c), data: isAdmin ? { platform_admin: true } : null });
  return c.json({ ok: true, recovery_code: recovery });
});

authRoutes.post("/login", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "login", 20, 60000);
  const input = await body(c, z.object({
    email,
    password: z.string().min(1, "رمز عبور را وارد کنید"),
    device: z.object({ name: z.string().max(120), platform: z.string().max(40).optional() }).optional(),
  }));
  try {
    rateLimit(`login-email:${input.email}`, 8, 900000);
  } catch (e) {
    // a burst of guesses is one event per address and account, not one per guess
    if (e instanceof AppError && firstRateLimitHit(`${clientIp(c)}|${input.email}`))
      await securityEvent(cfg.db, { kind: "sign_in", ok: false, email: input.email, ...requestMeta(c), data: { reason: "rate_limited" } });
    throw e;
  }
  let user = await cfg.db.one<{ id: string; password_hash: string | null; disabled: boolean }>(
    `select id, password_hash, disabled from sm_users where lower(email) = $1`,
    [input.email],
  );
  let ok = user ? await verifyPassword(input.password, user.password_hash) : false;
  // desktop linked to the cloud: accept the cloud password (new members, changed passwords,
  // accounts whose password is not kept here) — for the very account the cloud vouched for, never
  // for a local-only account that merely has the same e-mail
  let unreachable = false;
  if (!ok && cfg.desktop?.cloudLogin) {
    const r: { ok: boolean; user_id?: string; unreachable?: boolean; limited?: boolean } =
      await cfg.desktop.cloudLogin(input.email, input.password).catch(() => ({ ok: false, unreachable: true }));
    if (r.limited) throw tooMany("نسخهٔ وب تلاش‌های زیاد این حساب را موقتاً نمی‌پذیرد؛ چند دقیقه بعد دوباره امتحان کنید");
    unreachable = !!r.unreachable;
    if (r.ok && r.user_id) {
      user = await cfg.db.one(`select id, password_hash, disabled from sm_users where id = $1 and lower(email) = $2`, [r.user_id, input.email]);
      ok = !!user;
    }
  }
  if (!user || !ok) {
    await securityEvent(cfg.db, { kind: "sign_in", ok: false, user_id: user?.id ?? null, email: input.email, ...requestMeta(c), data: { reason: user ? "wrong_password" : "unknown_account" } });
    throw unauthorized(unreachable
      ? "ایمیل یا رمز عبور درست نیست؛ اگر نخستین بار است که با این حساب روی این رایانه وارد می‌شوید، به اینترنت وصل شوید و دوباره امتحان کنید"
      : "ایمیل یا رمز عبور درست نیست");
  }
  if (user.disabled) {
    await securityEvent(cfg.db, { kind: "sign_in", ok: false, user_id: user.id, email: input.email, ...requestMeta(c), data: { reason: "disabled" } });
    throw forbidden("حساب شما غیرفعال شده است؛ با مدیر تماس بگیرید");
  }
  if (cfg.platformAdmins.includes(input.email)) {
    // only while the platform has no active administrator (see sign-up): otherwise whoever made an
    // account with a listed address first — by sign-up or as an organisation's new member — would get it
    const promoted = await cfg.db.one(
      `update sm_users set is_platform_admin = true where id = $1 and not is_platform_admin
         and not exists (select 1 from sm_users a where a.is_platform_admin and not a.disabled) returning id`,
      [user.id],
    );
    if (promoted) await securityEvent(cfg.db, { kind: "platform_admin", user_id: user.id, email: input.email, ...requestMeta(c), data: { granted: true, by: "env" } });
  }
  const kind = input.device ? "device" : "web";
  const { token, session } = await issueSession(cfg.db, user.id, kind, { deviceName: input.device?.name, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  if (kind === "web") setSessionCookie(c, token);
  await securityEvent(cfg.db, { kind: "sign_in", user_id: user.id, email: input.email, ...requestMeta(c), data: { session: kind, ...(input.device ? { device: input.device.name.slice(0, 120) } : {}) } });
  return c.json({ ok: true, token: kind === "device" ? token : undefined, session_id: session.id, user_id: user.id });
});

authRoutes.post("/logout", requireUser, async (c) => {
  await revokeSession(c.get("cfg").db, c.get("session").id);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const user = c.get("user");
  const orgs = await accessibleOrgs(cfg.db, user);
  return c.json({ user, orgs, session: { kind: c.get("session").kind } });
});

authRoutes.patch("/me", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ full_name: z.string().trim().min(2).max(120).optional(), mobile: z.string().trim().max(20).nullable().optional(), prefs: z.record(z.string(), z.unknown()).optional() }));
  const u = c.get("user");
  await cfg.db.query(
    `update sm_users set full_name = coalesce($2, full_name), mobile = case when $3::boolean then $4 else mobile end,
       prefs = case when $5::jsonb is null then prefs else prefs || $5::jsonb end where id = $1`,
    [u.id, input.full_name ?? null, input.mobile !== undefined, input.mobile ?? null, input.prefs ? JSON.stringify(input.prefs) : null],
  );
  return c.json({ ok: true });
});

authRoutes.post("/password", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ current: z.string(), next: z.string() }));
  const u = await cfg.db.one<{ password_hash: string }>(`select password_hash from sm_users where id = $1`, [c.get("user").id]);
  const me = c.get("user");
  if (!(await verifyPassword(input.current, u?.password_hash))) {
    await securityEvent(cfg.db, { kind: "password_change", ok: false, user_id: me.id, email: me.email, ...requestMeta(c), data: { reason: "wrong_password" } });
    throw bad("رمز فعلی درست نیست");
  }
  const problem = passwordProblem(input.next);
  if (problem) throw bad(problem);
  await cfg.db.query(`update sm_users set password_hash = $2 where id = $1`, [me.id, await hashPassword(input.next)]);
  // sign out other sessions
  await cfg.db.query(`update sm_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null and kind = 'web'`, [me.id, c.get("session").id]);
  await securityEvent(cfg.db, { kind: "password_change", user_id: me.id, email: me.email, ...requestMeta(c) });
  return c.json({ ok: true });
});

authRoutes.post("/recover", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "recover", 10, 3600000);
  const input = await body(c, z.object({ email, code: z.string().trim().min(8), next: z.string() }));
  const u = await cfg.db.one<{ id: string; recovery_hash: string | null }>(`select id, recovery_hash from sm_users where lower(email) = $1`, [input.email]);
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!u || !u.recovery_hash || u.recovery_hash !== sha256(code)) {
    await securityEvent(cfg.db, { kind: "password_recover", ok: false, user_id: u?.id ?? null, email: input.email, ...requestMeta(c), data: { reason: u ? "wrong_code" : "unknown_account" } });
    throw bad("ایمیل یا کد بازیابی درست نیست");
  }
  const problem = passwordProblem(input.next);
  if (problem) throw bad(problem);
  const recovery = readableCode(4, 4);
  await cfg.db.query(`update sm_users set password_hash = $2, recovery_hash = $3 where id = $1`, [u.id, await hashPassword(input.next), sha256(recovery.replace(/-/g, ""))]);
  await cfg.db.query(`update sm_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [u.id]);
  await securityEvent(cfg.db, { kind: "password_recover", user_id: u.id, email: input.email, ...requestMeta(c) });
  return c.json({ ok: true, recovery_code: recovery });
});

authRoutes.get("/sessions", requireUser, async (c) => {
  const rows = await c.get("cfg").db.query(
    `select id, kind, device_name, ip, user_agent, created_at, last_seen_at from sm_sessions
     where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
    [c.get("user").id],
  );
  return c.json({ sessions: rows, current: c.get("session").id });
});

authRoutes.delete("/sessions/:id", requireUser, async (c) => {
  await c.get("cfg").db.query(`update sm_sessions set revoked_at = now() where id = $1 and user_id = $2`, [c.req.param("id"), c.get("user").id]);
  return c.json({ ok: true });
});
