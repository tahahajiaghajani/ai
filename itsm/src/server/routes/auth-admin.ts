// /api/o/:org/auth — «امنیت ورود و نشست‌ها», the organisation's sign-in and session administration (docs/AD_FA.md):
//   · GET|PUT /policy        the session policy (idle timeout, absolute lifetime, one session per person,
//                            re-authentication, browser-only cookies), local sign-in for break-glass accounts only,
//                            and the local lockout; saving tightens the sessions already open and is audited
//   · GET /sessions          who is signed in (members' sessions: method, address, browser, since, last seen)
//   · DELETE /sessions/:id   end one; POST /sessions/revoke-all ends one member's, or everyone's but yours
//   · GET /signins           the sign-in audit (every attempt: method, source, address, result, reason)
//   · GET /locks, DELETE /locks/:key   login names and addresses held back after failures, and «رفع قفل»
// Changes need the settings area at full level, sessions the users area, and both a recent proof of identity.
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { bad, forbidden, notFound } from "../http/errors";
import { normalizePolicy, policyProblems, type AuthPolicy } from "@shared/auth/policy";
import { orgPolicy, needRecentAuthOf, tightenSessions } from "../auth/policy";
import { cookieSecure, isHttps, revokeSession, revokeUserSessions } from "../auth/session";
import { listLocks, unlock } from "../auth/throttle";
import { pushRules } from "./sync";
import { audit } from "../modules/data/crud";
import { requestMeta, securityEvent } from "../modules/platform/security";
import { likeContains, type Db } from "../db";

export const authAdminRoutes = router();

const isId = (s: string | undefined) => !!s && /^[0-9a-f-]{36}$/i.test(s);

authAdminRoutes.get("/policy", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "view");
  const policy = orgPolicy(ctx.org);
  const cookie = { secure: cookieSecure(c), https: isHttps(c), mode: ctx.cfg.auth?.cookieSecure ?? (process.env.ITSM_COOKIE_SECURE || "auto") };
  const session = { method: c.get("session").auth_method ?? "password", org_scoped: !!c.get("session").org_id };
  // who the break-glass accounts are and how many guesses the lockout allows are for those who administer them: any
  // other member (every directory member is a viewer at least) sees the session rules only
  if (!ctx.can("settings", "full") && !ctx.can("users", "full")) return c.json({ policy: { session: policy.session, local_login: policy.local_login }, sources: [], breakglass: [], cookie, session });
  const sources = await ctx.db.query<{ id: string; name: string; login_enabled: boolean; approved: boolean; sso_mode: string | null; active: boolean }>(
    `select id, name, login_enabled, approved_by is not null as approved, sso_mode, active from sm_directory_sources where org_id = $1 and deleted_at is null and kind = 'ldap' order by name`,
    [ctx.org.id],
  );
  const people = policy.breakglass.length
    ? await ctx.db.query<{ id: string; full_name: string; email: string }>(`select id, full_name, email from sm_users where id = any($1::uuid[])`, [`{${policy.breakglass.join(",")}}`])
    : [];
  return c.json({
    policy,
    sources,
    breakglass: people,
    cookie,
    session,
  });
});

const policyInput = z.object({
  session: z.object({ idle_minutes: z.number(), absolute_hours: z.number(), single_session: z.boolean(), reauth_minutes: z.number(), browser_session: z.boolean() }).partial().optional(),
  local_login: z.enum(["all", "breakglass"]).optional(),
  breakglass: z.array(z.string()).max(50).optional(),
  lockout: z.object({ threshold: z.number(), window_minutes: z.number(), lock_minutes: z.number(), ip_threshold: z.number() }).partial().optional(),
});

authAdminRoutes.put("/policy", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  if (ctx.actor === "support") throw forbidden("سیاست ورود را مدیر خود سازمان تعیین می‌کند");
  needRecentAuthOf(c, ctx);
  const input = await body(c, policyInput);
  const before = orgPolicy(ctx.org);
  const next: AuthPolicy = normalizePolicy({
    ...before,
    ...input,
    session: { ...before.session, ...(input.session ?? {}) },
    lockout: { ...before.lockout, ...(input.lockout ?? {}) },
  });
  // break-glass accounts are active members of this organisation
  if (next.breakglass.length) {
    const rows = await ctx.db.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active and user_id = any($2::uuid[])`, [ctx.org.id, `{${next.breakglass.join(",")}}`]);
    const ok = new Set(rows.map((r) => r.user_id));
    if (next.breakglass.some((u) => !ok.has(u))) throw bad("حساب‌های اضطراری باید از اعضای فعال همین سازمان باشند");
  }
  const directory = await ctx.db.one(
    `select 1 from sm_directory_sources where org_id = $1 and deleted_at is null and kind = 'ldap' and active and login_enabled and approved_by is not null limit 1`,
    [ctx.org.id],
  );
  const problems = policyProblems(next, { directoryLogin: !!directory });
  if (problems.length) throw bad(problems[0], { problems });
  // never lock yourself out: a local session closing local sign-in must keep its own account among the break-glass ones
  const session = c.get("session");
  const local = !session.org_id && ["password", "signup", "recover"].includes(session.auth_method ?? "password");
  if (next.local_login === "breakglass" && local && !next.breakglass.includes(ctx.user.id)) throw bad("شما با رمز محلی وارد شده‌اید؛ حساب خودتان را هم به فهرست حساب‌های اضطراری بیفزایید یا با حساب سازمانی وارد شوید");
  await ctx.write(async (tx) => {
    await tx.query(`update sm_orgs set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('auth', $2::jsonb), origin = $3 where id = $1`, [ctx.org.id, JSON.stringify(next), ctx.cfg.origin]);
    await audit(tx, ctx, "auth_policy", "org", ctx.org.id, "تغییر سیاست ورود و نشست‌ها", { before, after: next });
  });
  const tightened = await tightenSessions(ctx.db, ctx.org.id, next.session);
  await securityEvent(ctx.db, { kind: "auth_policy", user_id: ctx.user.id, email: ctx.user.email, org_id: ctx.org.id, ...requestMeta(c), data: { session: next.session, local_login: next.local_login, breakglass: next.breakglass.length, lockout: next.lockout, tightened } });
  return c.json({ policy: next, tightened });
});

// ---------------------------------------------------------------- sessions

authAdminRoutes.get("/sessions", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  const q = query(c, z.object({ q: z.string().max(100).optional(), method: z.string().max(20).optional() }));
  const params: unknown[] = [ctx.org.id];
  const where = [
    "s.revoked_at is null",
    "s.expires_at > now()",
    "(s.org_id = $1 or (s.org_id is null and s.user_id in (select user_id from sm_org_members where org_id = $1 and deleted_at is null)))",
  ];
  if (q.method) where.push(`coalesce(s.auth_method, 'password') = $${params.push(q.method)}`);
  if (q.q?.trim()) where.push(`(u.full_name ilike $${params.push(likeContains(q.q.trim()))} or u.email ilike $${params.length} or s.ip ilike $${params.length})`);
  const rows = await ctx.db.query(
    `select s.id, s.user_id, u.full_name, u.email, u.is_platform_admin, s.kind, coalesce(s.auth_method, 'password') as auth_method, s.org_id, s.ip, s.user_agent, s.device_name,
            s.created_at, s.last_seen_at, s.expires_at, s.idle_minutes, s.reauth_at
     from sm_sessions s join sm_users u on u.id = s.user_id
     where ${where.join(" and ")} order by s.last_seen_at desc limit 500`,
    params,
  );
  return c.json({ sessions: rows, current: c.get("session").id });
});

/** May this organisation's administrator end the session? Its own directory sessions, and members' local ones (never a platform administrator's). */
async function revocable(db: Db, orgId: string, id: string) {
  return db.one<{ id: string; user_id: string; email: string }>(
    `select s.id, s.user_id, u.email from sm_sessions s join sm_users u on u.id = s.user_id
     where s.id = $1 and s.revoked_at is null
       and (s.org_id = $2 or (s.org_id is null and not u.is_platform_admin and s.user_id in (select user_id from sm_org_members where org_id = $2 and deleted_at is null)))`,
    [id, orgId],
  );
}

authAdminRoutes.delete("/sessions/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  if (ctx.actor === "support") throw forbidden("نشست‌های اعضا را مدیر خود سازمان می‌بندد");
  needRecentAuthOf(c, ctx);
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("نشست پیدا نشد");
  const s = await revocable(ctx.db, ctx.org.id, id);
  if (!s) throw notFound("نشست پیدا نشد");
  await revokeSession(ctx.db, s.id, "admin");
  await audit(ctx.db, ctx, "session_revoke", "user", s.user_id, `پایان نشست ${s.email}`);
  await securityEvent(ctx.db, { kind: "sessions_revoked", user_id: s.user_id, email: s.email, org_id: ctx.org.id, ...requestMeta(c), data: { by: ctx.user.id, by_name: ctx.user.full_name, sessions: 1 } });
  return c.json({ ok: true });
});

/** «خروج همه»: one member's sessions, or every member's (but the administrator's own current one). */
authAdminRoutes.post("/sessions/revoke-all", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  if (ctx.actor === "support") throw forbidden("نشست‌های اعضا را مدیر خود سازمان می‌بندد");
  needRecentAuthOf(c, ctx);
  const input = await body(c, z.object({ user_id: z.string().optional() }));
  const current = c.get("session").id;
  let n = 0;
  if (input.user_id) {
    if (!isId(input.user_id)) throw notFound("عضو پیدا نشد");
    const m = await ctx.db.one<{ email: string; is_platform_admin: boolean }>(
      `select u.email, u.is_platform_admin from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2 and m.deleted_at is null`,
      [ctx.org.id, input.user_id],
    );
    if (!m) throw notFound("عضو پیدا نشد");
    n += await revokeUserSessions(ctx.db, input.user_id, { reason: "admin", orgId: ctx.org.id, exceptId: current });
    if (!m.is_platform_admin) {
      const rows = await ctx.db.query(`update sm_sessions set revoked_at = now(), revoke_reason = 'admin' where user_id = $1 and org_id is null and revoked_at is null and id <> $2 returning id`, [input.user_id, current]);
      n += rows.length;
    }
    await securityEvent(ctx.db, { kind: "sessions_revoked", user_id: input.user_id, email: m.email, org_id: ctx.org.id, ...requestMeta(c), data: { by: ctx.user.id, by_name: ctx.user.full_name, sessions: n } });
  } else {
    const rows = await ctx.db.query(
      `update sm_sessions s set revoked_at = now(), revoke_reason = 'admin_all'
       where s.revoked_at is null and s.id <> $2
         and (s.org_id = $1 or (s.org_id is null and s.user_id in (select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.deleted_at is null and not u.is_platform_admin)))
       returning s.id`,
      [ctx.org.id, current],
    );
    n = rows.length;
    await securityEvent(ctx.db, { kind: "sessions_revoked", user_id: ctx.user.id, email: ctx.user.email, org_id: ctx.org.id, ...requestMeta(c), data: { by: ctx.user.id, everyone: true, sessions: n } });
  }
  await audit(ctx.db, ctx, "session_revoke_all", "org", ctx.org.id, `پایان ${n} نشست`, { user_id: input.user_id ?? null });
  return c.json({ ok: true, sessions: n });
});

// ---------------------------------------------------------------- the sign-in audit and lockouts

authAdminRoutes.get("/signins", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  const q = query(c, z.object({
    ok: z.enum(["true", "false"]).optional(),
    method: z.string().max(20).optional(),
    source: z.string().max(40).optional(),
    q: z.string().max(100).optional(),
    before: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }));
  const params: unknown[] = [ctx.org.id];
  const where = ["e.org_id = $1", "e.kind in ('sign_in', 'reauth', 'sessions_revoked', 'auth_policy')"];
  if (q.ok) where.push(`e.ok = $${params.push(q.ok === "true")}`);
  if (q.method) where.push(`coalesce(e.data->>'method', 'password') = $${params.push(q.method)}`);
  if (q.source && isId(q.source)) where.push(`e.data->>'source' = $${params.push(q.source.toLowerCase())}`);
  if (q.before && !Number.isNaN(Date.parse(q.before))) where.push(`e.at < $${params.push(q.before)}::timestamptz`);
  if (q.q?.trim()) where.push(`(e.email ilike $${params.push(likeContains(q.q.trim()))} or e.ip ilike $${params.length} or u.full_name ilike $${params.length})`);
  const rows = await ctx.db.query(
    `select e.id, e.at, e.kind, e.ok, e.user_id, e.email, e.ip, e.user_agent, e.data, u.full_name as user_name
     from sm_security_events e left join sm_users u on u.id = e.user_id
     where ${where.join(" and ")} order by e.at desc, e.id desc limit ${q.limit ?? 100}`,
    params,
  );
  return c.json({ events: rows });
});

authAdminRoutes.get("/locks", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  return c.json({ locks: await listLocks(ctx.db, ctx.org.id) });
});

authAdminRoutes.delete("/locks/:key", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  const key = c.req.param("key");
  if (!/^(login|ip):[0-9a-f]{40}$/.test(key)) throw notFound("قفل پیدا نشد");
  if (!(await unlock(ctx.db, ctx.org.id, key))) throw notFound("قفل پیدا نشد");
  await audit(ctx.db, ctx, "signin_unlock", "org", ctx.org.id, "رفع قفل ورود");
  return c.json({ ok: true });
});

// a Windows app never changes the sign-in policy: a pushed organisation keeps the web version's (additive rule)
const previousOrgRule = pushRules.get("org");
pushRules.set("org", async (tx, ctx, agg, existing) => {
  const row = agg.row as Record<string, unknown>;
  if (row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)) {
    const current = (ctx.org.settings as Record<string, unknown> | undefined)?.auth;
    const pushed = { ...(row.settings as Record<string, unknown>) };
    if (current === undefined) delete pushed.auth;
    else pushed.auth = current;
    row.settings = pushed;
  }
  return previousOrgRule ? previousOrgRule(tx, ctx, agg, existing) : null;
});
