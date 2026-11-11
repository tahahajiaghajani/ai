// /api/auth — sign up, sign in (e-mail and password, a domain account, Windows single sign-on), sign out (here or
// everywhere), current user, re-authentication, password change and recovery (docs/AD_FA.md for the directory parts).
import { DEMO_SIGNIN_OFF, demoOrgOf, demoSignInAllowed } from "../modules/demo/signin";
import { z } from "zod";
import type { Context } from "hono";
import { router, body, requireUser, limitByIp, rateLimit } from "../http/hono";
import { bad, forbidden, tooMany, unauthorized } from "../http/errors";
import { hashPassword, verifyPassword, passwordProblem, readableCode, sha256 } from "../auth/password";
import { issueSession, setSessionCookie, clearSessionCookie, revokeSession, revokeUserSessions, resolveToken, tokenFromRequest, clientIp, peerAddress, isTrustedProxy, proxiesListed } from "../auth/session";
import type { ServerConfig } from "../context";
import { localLoginAllowed, userSessionPolicy } from "../auth/policy";
import { directoryReauth, directorySignIn, principalSignIn, ssoRefused } from "../auth/directory";
import { isNtlmToken, negotiateToken, negotiateValidator, PROXY_SECRET_HEADER, proxyPeerAllowed, proxySecretMatches } from "../auth/sso";
import { recordFailure, clearFailures } from "../auth/throttle";
import { loadLoginSource, loginSources, LoginFailure, sourceConfig } from "../modules/integration/directory-login";
import { liveRow } from "../modules/integration/common";
import { systemCtx } from "../engine";
import { loginMessage, parseLogin } from "@shared/auth/login";
import { APP_NAME } from "@shared/constants";
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
  const { token, maxAge } = await issueSession(cfg.db, user!.id, "web", { ip: clientIp(c), userAgent: c.req.header("user-agent"), method: "signup" });
  setSessionCookie(c, token, maxAge);
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
  // the demo pack's people sign in only while their organisation's administrators allow it (docs/DEMO_FA.md)
  const demoOrg = await demoOrgOf(cfg.db, user.id);
  if (demoOrg && !(await demoSignInAllowed(cfg.db, demoOrg))) {
    await securityEvent(cfg.db, { kind: "sign_in", ok: false, user_id: user.id, email: input.email, ...requestMeta(c), data: { reason: "demo_signin_off" } });
    throw forbidden(DEMO_SIGNIN_OFF);
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
  // an organisation that signs in with its directory may close local passwords to all but its break-glass accounts
  // (told only now that the password was right: it says nothing about whether the account exists)
  const full = await cfg.db.one<{ id: string; is_platform_admin: boolean }>(`select id, is_platform_admin from sm_users where id = $1`, [user.id]);
  if (full && cfg.mode !== "desktop" && !(await localLoginAllowed(cfg.db, full))) {
    await securityEvent(cfg.db, { kind: "sign_in", ok: false, user_id: user.id, email: input.email, ...requestMeta(c), data: { method: "password", reason: "local_disabled" } });
    throw forbidden(loginMessage("local_disabled", APP_NAME));
  }
  const kind = input.device ? "device" : "web";
  const policy = kind === "web" ? await userSessionPolicy(cfg.db, user.id) : null;
  const { token, session, maxAge } = await issueSession(cfg.db, user.id, kind, { deviceName: input.device?.name, ip: clientIp(c), userAgent: c.req.header("user-agent"), method: kind === "device" ? "device" : "password", policy });
  if (kind === "web") setSessionCookie(c, token, maxAge);
  await securityEvent(cfg.db, { kind: "sign_in", user_id: user.id, email: input.email, ...requestMeta(c), data: { method: kind === "device" ? "device" : "password", session: kind, ...(input.device ? { device: input.device.name.slice(0, 120) } : {}) } });
  return c.json({ ok: true, token: kind === "device" ? token : undefined, session_id: session.id, user_id: user.id });
});

authRoutes.post("/logout", requireUser, async (c) => {
  await revokeSession(c.get("cfg").db, c.get("session").id, "sign_out");
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const user = c.get("user");
  const session = c.get("session");
  const all = await accessibleOrgs(cfg.db, user);
  // a directory sign-in reaches only its organisation
  const orgs = session.org_id ? all.filter((o) => o.id === session.org_id) : all;
  return c.json({ user, orgs, session: { kind: session.kind, method: session.auth_method ?? "password", org_id: session.org_id ?? null, reauth_at: session.reauth_at ?? null } });
});

authRoutes.patch("/me", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ full_name: z.string().trim().min(2).max(120).optional(), mobile: z.string().trim().max(20).nullable().optional(), prefs: z.record(z.string(), z.unknown()).optional() }));
  const u = c.get("user");
  // the mark of a demo pack's person (docs/DEMO_FA.md) is the platform's, never the person's to change
  if (input.prefs) delete input.prefs.demo_org;
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
    `select s.id, s.kind, s.device_name, s.ip, s.user_agent, s.created_at, s.last_seen_at, s.expires_at, s.auth_method, s.org_id, o.name as org_name from sm_sessions s
     left join sm_orgs o on o.id = s.org_id
     where s.user_id = $1 and s.revoked_at is null and s.expires_at > now() order by s.last_seen_at desc`,
    [c.get("user").id],
  );
  return c.json({ sessions: rows, current: c.get("session").id });
});

/** «خروج از همهٔ دستگاه‌ها»: end the person's other sessions (and this one too when asked). */
authRoutes.post("/sessions/revoke-all", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ include_current: z.boolean().optional() }));
  const me = c.get("user");
  const n = await revokeUserSessions(cfg.db, me.id, { reason: "sign_out_everywhere", exceptId: input.include_current ? null : c.get("session").id });
  if (input.include_current) clearSessionCookie(c);
  await securityEvent(cfg.db, { kind: "sessions_revoked", user_id: me.id, email: me.email, ...requestMeta(c), data: { by: me.id, self: true, sessions: n } });
  return c.json({ ok: true, sessions: n });
});

authRoutes.delete("/sessions/:id", requireUser, async (c) => {
  await c.get("cfg").db.query(`update sm_sessions set revoked_at = now(), revoke_reason = coalesce(revoke_reason, 'sign_out') where id = $1 and user_id = $2 and revoked_at is null`, [c.req.param("id"), c.get("user").id]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- domain accounts and Windows single sign-on

/**
 * The ways in the sign-in page offers. Directory sources are listed when one organisation signs in through its
 * directory here (an on-premises installation), or when the page carries an organisation's own link (?dir=<source>) —
 * on a shared installation domains are never matched across organisations.
 */
authRoutes.get("/options", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "auth-options", 120, 60_000);
  const hint = /^[0-9a-f-]{36}$/i.test(c.req.query("dir") ?? "") ? c.req.query("dir")!.toLowerCase() : null;
  const all = await loginSources(cfg);
  const visible = hint ? all.filter((s) => s.id === hint) : new Set(all.map((s) => s.org_id)).size === 1 ? all : [];
  const sources: { id: string; name: string; domains: string[]; sso: string; auto: boolean }[] = [];
  for (const ref of visible.slice(0, 10)) {
    const sys = await systemCtx(cfg, ref.org_id);
    const row = await liveRow(cfg.db, sys, "directory_source", ref.id);
    if (!row || !row.approved_by) continue;
    const conf = sourceConfig(row);
    sources.push({ id: conf.id, name: conf.name, domains: conf.domains.slice(0, 10), sso: conf.ssoMode, auto: conf.ssoAuto });
  }
  // Kerberos needs this server's SSPI; the proxy mode is offered wherever a source uses it (the proxy fronts the page)
  const sso = sources.find((s) => s.sso === "proxy" || (s.sso === "negotiate" && cfg.mode !== "desktop" && !!negotiateValidator()));
  return c.json({
    local: true,
    directory: sources.length ? { sources: sources.map(({ id, name, domains }) => ({ id, name, domains })) } : null,
    sso: sso ? { source_id: sso.id, mode: sso.sso, auto: sso.auto } : null,
  });
});

/** «ورود با حساب سازمانی»: a domain login name (ali, CORP\ali, ali@corp.example) and its password. */
authRoutes.post("/directory", async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({ login: z.string().max(300), password: z.string().max(1024), source: z.string().max(40).nullish() }));
  const s = await directorySignIn(c, cfg, { login: input.login, password: input.password, source: input.source && /^[0-9a-f-]{36}$/i.test(input.source) ? input.source : null });
  return c.json({ ok: true, user_id: s.user_id, org_id: s.org_id, session_id: s.session.id });
});

/** Where to go after a single sign-on in a top-level navigation: a path of this site only. */
const safeNext = (v: string | undefined) => (v && /^\/(?!\/)[^\s\\]*$/.test(v) ? v : "/");
const connOf = (c: Context): object | null => ((c.env as { incoming?: { socket?: object } } | undefined)?.incoming?.socket ?? null);

/**
 * «ورود خودکار با حساب ویندوز». A trusted proxy (IIS with Windows Authentication) passes the person's name in the
 * source's header — believed only from the source's proxy addresses and with its shared secret; otherwise this server
 * speaks Negotiate itself (Kerberos; NTLM only when the source allows it). The session is the normal one.
 * `?redirect=1&next=/path` answers a top-level navigation with a redirect; `?reauth=1` re-authenticates the session.
 */
authRoutes.get("/sso", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "auth-sso", 60, 60_000);
  const hint = /^[0-9a-f-]{36}$/i.test(c.req.query("source") ?? "") ? c.req.query("source")!.toLowerCase() : null;
  const sources = (await loginSources(cfg)).filter((s) => (s.sso_mode === "negotiate" || s.sso_mode === "proxy") && (!hint || s.id === hint));
  if (!sources.length || cfg.mode === "desktop") throw await ssoRefused(c, cfg, "sso_unavailable", "sso");
  const reauth = c.req.query("reauth") === "1";
  // the re-authentication comes from the app itself (a header a cross-site navigation cannot add)
  if (reauth && c.req.header("x-itsm-reauth") !== "1") throw bad("درخواست تأیید دوباره معتبر نیست");
  const done = async (principal: string, method: "sso" | "proxy", fixed?: { sourceId: string; orgId: string }, ntlm = false) => {
    if (reauth) return reauthWithWindows(c, principal);
    const s = await principalSignIn(c, cfg, principal, method, hint, fixed, ntlm);
    if (c.req.query("redirect") === "1") return c.redirect(safeNext(c.req.query("next")), 302);
    return c.json({ ok: true, user_id: s.user_id, org_id: s.org_id });
  };

  // a trusted proxy: the name in a header, from a listed address, with the shared secret
  const proxies = sources.filter((s) => s.sso_mode === "proxy");
  for (const ref of proxies) {
    let conf;
    try {
      conf = (await loadLoginSource(cfg, ref)).conf;
    } catch (e) {
      if (e instanceof LoginFailure) continue;
      throw e;
    }
    const name = c.req.header(conf.proxyHeader);
    const secret = c.req.header(PROXY_SECRET_HEADER);
    if (!name && !secret) continue;
    const peer = peerAddress(c);
    // an installation that lists its reverse proxies (the server edition: kariz.json trusted_proxies) believes a proxy
    // header only from them as well — one list for the HTTP front, the client address and SSO
    const installationTrusts = !proxiesListed(cfg) || isTrustedProxy(cfg, peer);
    if (!proxyPeerAllowed(conf.proxyIps, peer) || !installationTrusts) throw await ssoRefused(c, cfg, "proxy_untrusted", "proxy", { orgId: ref.org_id, sourceId: ref.id, principal: name ?? null, detail: `نشانی ${peer ?? "نامعلوم"} در فهرست پراکسی‌های معتمد نیست` });
    const sys = await systemCtx(cfg, ref.org_id);
    if (!(await proxySecretMatches(cfg, sys, ref.id, secret))) throw await ssoRefused(c, cfg, "proxy_secret", "proxy", { orgId: ref.org_id, sourceId: ref.id, principal: name ?? null });
    if (!name?.trim()) throw await ssoRefused(c, cfg, "sso_failed", "proxy", { orgId: ref.org_id, sourceId: ref.id, detail: "پراکسی نام کاربر را نفرستاد" });
    return done(name.trim(), "proxy", { sourceId: ref.id, orgId: ref.org_id });
  }

  // Negotiate on this server
  const negs = sources.filter((s) => s.sso_mode === "negotiate");
  if (!negs.length) throw await ssoRefused(c, cfg, "sso_failed", "proxy", { detail: "درخواست از راه پراکسی ورود ویندوز نیامد" });
  const validator = negotiateValidator();
  if (!validator) throw await ssoRefused(c, cfg, "sso_unavailable", "sso");
  const token = negotiateToken(c.req.header("authorization"));
  if (!token) {
    c.header("WWW-Authenticate", "Negotiate");
    return c.json({ error: { code: "negotiate", message: loginMessage("sso_failed", APP_NAME), details: null } }, 401);
  }
  if (isNtlmToken(token)) {
    const allowNtlm = [];
    for (const ref of negs) {
      const sys = await systemCtx(cfg, ref.org_id);
      const row = await liveRow(cfg.db, sys, "directory_source", ref.id);
      if (row?.ntlm) allowNtlm.push(ref.id);
    }
    if (!allowNtlm.length) throw await ssoRefused(c, cfg, "ntlm_refused", "sso", { orgId: negs[0].org_id, sourceId: negs[0].id, detail: "مرورگر به‌جای Kerberos با NTLM آمد (نام SPN یا تنظیم Intranet مرورگر را بررسی کنید)" });
  }
  let r;
  try {
    r = await validator.accept(token, connOf(c));
  } catch (e) {
    throw await ssoRefused(c, cfg, "sso_failed", "sso", { orgId: negs[0].org_id, sourceId: negs[0].id, detail: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  if (r.response) c.header("WWW-Authenticate", `Negotiate ${r.response.toString("base64")}`);
  if (!r.done) return c.json({ error: { code: "negotiate", message: "ورود خودکار ادامه دارد", details: null } }, 401);
  if (!r.principal) throw await ssoRefused(c, cfg, "sso_failed", "sso", { orgId: negs[0].org_id, sourceId: negs[0].id, detail: "نام کاربر از ویندوز نرسید" });
  // an NTLM handshake (every leg carries NTLMSSP) is judged again by the source the person is routed to: one source
  // that allows NTLM never opens the others to it
  return done(r.principal, "sso", undefined, isNtlmToken(token));
});

/** Re-authentication through Windows: the same person as the session's own sign-in. */
async function reauthWithWindows(c: Context, principal: string) {
  const cfg = (c as unknown as { get(k: "cfg"): ServerConfig }).get("cfg");
  const resolved = await resolveToken(cfg.db, tokenFromRequest(c));
  if (!resolved) throw unauthorized();
  const row = await cfg.db.one<{ login: string | null }>(`select login from sm_sessions where id = $1`, [resolved.session.id]);
  const a = parseLogin(principal)?.key;
  const b = parseLogin(row?.login ?? "")?.key;
  const ok = !!a && !!b && a === b;
  await securityEvent(cfg.db, { kind: "reauth", ok, user_id: resolved.user.id, email: resolved.user.email, org_id: resolved.session.org_id ?? null, ...requestMeta(c), data: { method: "sso" } });
  if (!ok) throw unauthorized("حساب ویندوز این رایانه با حساب این نشست یکی نیست؛ با گذرواژه تأیید کنید");
  await cfg.db.query(`update sm_sessions set reauth_at = now() where id = $1`, [resolved.session.id]);
  return c.json({ ok: true });
}

/**
 * Re-authentication before sensitive administration: the session's own way in — the local password, or the domain
 * password for a session opened with a domain account (or Windows). Five failures end the session.
 */
authRoutes.post("/reauth", requireUser, async (c) => {
  const cfg = c.get("cfg");
  const session = c.get("session");
  const me = c.get("user");
  const input = await body(c, z.object({ password: z.string().max(1024) }));
  rateLimit(`reauth:${session.id}`, 10, 15 * 60_000);
  if (!input.password) throw bad("گذرواژه را وارد کنید");
  const method = session.auth_method ?? "password";
  let ok = false;
  if (method === "ldap" || method === "sso" || method === "proxy") {
    const row = await cfg.db.one<{ login: string | null }>(`select login from sm_sessions where id = $1`, [session.id]);
    ok = await directoryReauth(cfg, session, row?.login ?? "", input.password);
  } else {
    const u = await cfg.db.one<{ password_hash: string | null }>(`select password_hash from sm_users where id = $1`, [me.id]);
    ok = await verifyPassword(input.password, u?.password_hash);
  }
  const key = { kind: "login" as const, org_id: session.org_id ?? null, subject: me.email, scope: `reauth|${session.id}` };
  if (!ok) {
    const r = await recordFailure(cfg.db, key, 5, 15, 15);
    await securityEvent(cfg.db, { kind: "reauth", ok: false, user_id: me.id, email: me.email, org_id: session.org_id ?? null, ...requestMeta(c), data: { method, failures: r.failures } });
    if (r.locked) {
      await revokeSession(cfg.db, session.id, "reauth_failed");
      clearSessionCookie(c);
      throw unauthorized("چند بار پیاپی گذرواژه درست نبود؛ برای امنیت از حساب خارج شدید");
    }
    throw new AppError(401, "reauth_failed", "گذرواژه درست نیست");
  }
  await clearFailures(cfg.db, key);
  await cfg.db.query(`update sm_sessions set reauth_at = now() where id = $1`, [session.id]);
  await securityEvent(cfg.db, { kind: "reauth", user_id: me.id, email: me.email, org_id: session.org_id ?? null, ...requestMeta(c), data: { method } });
  return c.json({ ok: true });
});
