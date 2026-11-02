// /api/auth — sign up, sign in, sign out, current user, password change and recovery.
import { z } from "zod";
import { router, body, requireUser, limitByIp, rateLimit } from "../http/hono";
import { bad, forbidden, unauthorized } from "../http/errors";
import { hashPassword, verifyPassword, passwordProblem, readableCode, sha256 } from "../auth/password";
import { issueSession, setSessionCookie, clearSessionCookie, revokeSession, clientIp } from "../auth/session";
import { listMyOrgs } from "../modules/orgs/service";
import { uuidv7 } from "@shared/id";
import { isEmail } from "@shared/validate";

const email = z.string().trim().toLowerCase().refine(isEmail, "ایمیل معتبر نیست");

export const authRoutes = router();

authRoutes.post("/signup", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "signup", 10, 3600000);
  const input = await body(c, z.object({ email, password: z.string(), full_name: z.string().trim().min(2, "نام را کامل وارد کنید").max(120), mobile: z.string().trim().max(20).optional() }));
  const count = await cfg.db.one<{ n: number }>(`select count(*)::int as n from tz_users`);
  const first = (count?.n ?? 0) === 0;
  if (!first && !cfg.allowSignup && !cfg.platformAdmins.includes(input.email)) throw forbidden(cfg.mode === "desktop" ? "کاربر جدید را مدیر از «تنظیمات ← کاربران» اضافه می‌کند" : "ثبت‌نام در این سامانه بسته است");
  const problem = passwordProblem(input.password);
  if (problem) throw bad(problem);
  const exists = await cfg.db.one(`select 1 from tz_users where lower(email) = $1`, [input.email]);
  if (exists) throw bad("با این ایمیل قبلاً حساب ساخته شده است؛ وارد شوید");
  const recovery = readableCode(4, 4);
  // the first account administers the platform only while no owner email is configured;
  // otherwise whoever reached a fresh deployment first would see every business
  const isAdmin = cfg.platformAdmins.includes(input.email) || (first && !cfg.platformAdmins.length);
  const user = await cfg.db.one<{ id: string }>(
    `insert into tz_users (id, email, full_name, mobile, password_hash, recovery_hash, is_platform_admin)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [uuidv7(), input.email, input.full_name, input.mobile || null, await hashPassword(input.password), sha256(recovery.replace(/-/g, "")), isAdmin],
  );
  const { token } = await issueSession(cfg.db, user!.id, "web", { ip: clientIp(c), userAgent: c.req.header("user-agent") });
  setSessionCookie(c, token);
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
  rateLimit(`login-email:${input.email}`, 8, 900000);
  let user = await cfg.db.one<{ id: string; password_hash: string | null; disabled: boolean }>(
    `select id, password_hash, disabled from tz_users where lower(email) = $1`,
    [input.email],
  );
  let ok = user ? await verifyPassword(input.password, user.password_hash) : false;
  // desktop linked to the cloud: accept the cloud password (new members, changed passwords,
  // accounts whose password is not kept here) — for the very account the cloud vouched for, never
  // for a local-only account that merely has the same e-mail
  let unreachable = false;
  if (!ok && cfg.desktop?.cloudLogin) {
    const r = await cfg.desktop.cloudLogin(input.email, input.password).catch(() => ({ ok: false, unreachable: true, user_id: undefined }));
    unreachable = !!r.unreachable;
    if (r.ok && r.user_id) {
      user = await cfg.db.one(`select id, password_hash, disabled from tz_users where id = $1 and lower(email) = $2`, [r.user_id, input.email]);
      ok = !!user;
    }
  }
  if (!user || !ok) {
    throw unauthorized(unreachable
      ? "ایمیل یا رمز عبور درست نیست؛ اگر نخستین بار است که با این حساب روی این رایانه وارد می‌شوید، به اینترنت وصل شوید و دوباره امتحان کنید"
      : "ایمیل یا رمز عبور درست نیست");
  }
  if (user.disabled) throw forbidden("حساب شما غیرفعال شده است؛ با مدیر تماس بگیرید");
  if (cfg.platformAdmins.includes(input.email)) await cfg.db.query(`update tz_users set is_platform_admin = true where id = $1 and not is_platform_admin`, [user.id]);
  const kind = input.device ? "device" : "web";
  const { token, session } = await issueSession(cfg.db, user.id, kind, { deviceName: input.device?.name, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  if (kind === "web") setSessionCookie(c, token);
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
  const orgs = await listMyOrgs(cfg.db, user.id, user.is_platform_admin);
  return c.json({ user, orgs, session: { kind: c.get("session").kind } });
});

authRoutes.patch("/me", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ full_name: z.string().trim().min(2).max(120).optional(), mobile: z.string().trim().max(20).nullable().optional(), prefs: z.record(z.string(), z.unknown()).optional() }));
  const u = c.get("user");
  await cfg.db.query(
    `update tz_users set full_name = coalesce($2, full_name), mobile = case when $3::boolean then $4 else mobile end,
       prefs = case when $5::jsonb is null then prefs else prefs || $5::jsonb end where id = $1`,
    [u.id, input.full_name ?? null, input.mobile !== undefined, input.mobile ?? null, input.prefs ? JSON.stringify(input.prefs) : null],
  );
  return c.json({ ok: true });
});

authRoutes.post("/password", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ current: z.string(), next: z.string() }));
  const u = await cfg.db.one<{ password_hash: string }>(`select password_hash from tz_users where id = $1`, [c.get("user").id]);
  if (!(await verifyPassword(input.current, u?.password_hash))) throw bad("رمز فعلی درست نیست");
  const problem = passwordProblem(input.next);
  if (problem) throw bad(problem);
  await cfg.db.query(`update tz_users set password_hash = $2 where id = $1`, [c.get("user").id, await hashPassword(input.next)]);
  // sign out other sessions
  await cfg.db.query(`update tz_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null and kind = 'web'`, [c.get("user").id, c.get("session").id]);
  return c.json({ ok: true });
});

authRoutes.post("/recover", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "recover", 10, 3600000);
  const input = await body(c, z.object({ email, code: z.string().trim().min(8), next: z.string() }));
  const u = await cfg.db.one<{ id: string; recovery_hash: string | null }>(`select id, recovery_hash from tz_users where lower(email) = $1`, [input.email]);
  const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!u || !u.recovery_hash || u.recovery_hash !== sha256(code)) throw bad("ایمیل یا کد بازیابی درست نیست");
  const problem = passwordProblem(input.next);
  if (problem) throw bad(problem);
  const recovery = readableCode(4, 4);
  await cfg.db.query(`update tz_users set password_hash = $2, recovery_hash = $3 where id = $1`, [u.id, await hashPassword(input.next), sha256(recovery.replace(/-/g, ""))]);
  await cfg.db.query(`update tz_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [u.id]);
  return c.json({ ok: true, recovery_code: recovery });
});

authRoutes.get("/sessions", requireUser, async (c) => {
  const rows = await c.get("cfg").db.query(
    `select id, kind, device_name, ip, user_agent, created_at, last_seen_at from tz_sessions
     where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
    [c.get("user").id],
  );
  return c.json({ sessions: rows, current: c.get("session").id });
});

authRoutes.delete("/sessions/:id", requireUser, async (c) => {
  await c.get("cfg").db.query(`update tz_sessions set revoked_at = now() where id = $1 and user_id = $2`, [c.req.param("id"), c.get("user").id]);
  return c.json({ ok: true });
});
