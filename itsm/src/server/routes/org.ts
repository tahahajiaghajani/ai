// /api/orgs (list/create) and /api/o/:org (profile, settings, members, audit log, support sessions). Every
// /o/:org route passes `orgAccess` first: the platform admin's support session and the organisation's
// platform status (read-only, suspended).
import { z } from "zod";
import { router, body, requireUser, type C } from "../http/hono";
import { bad, conflict, forbidden, notFound } from "../http/errors";
import { createOrg, knownModules, seedOrg } from "../modules/orgs/service";
import { AREAS, permissionMap, ROLES, type Area, type Level, type Role } from "@shared/permissions";
import { APP_NAME, isTimeZone } from "@shared/constants";
import { supportPermissions } from "../context";
import { orgAccess } from "../modules/platform/access";
import { accessibleOrgs, endSupport, listSupportSessions, SUPPORT_LEVEL_TITLE } from "../modules/platform/support";
import { requestMeta, securityEvent } from "../modules/platform/security";
import { createdHere, memberChangeProblem, RESETTABLE_SQL } from "../modules/platform/members";
import { hashPassword, passwordProblem, readableCode } from "../auth/password";
import { uuidv7 } from "@shared/id";
import { insertRow, updateRow } from "../db/sql";
import { isEmail } from "@shared/validate";
import { audit } from "../modules/data/crud";
import { pulse } from "../live";
import { shellAccess } from "../access/service";

const timezoneSchema = z.string().trim().max(64).refine(isTimeZone, "منطقهٔ زمانی معتبر نیست");
const modulesSchema = z.array(z.string().max(40)).max(50);

export const orgsRoutes = router();
orgsRoutes.use("*", requireUser);

orgsRoutes.get("/", async (c) => c.json({ orgs: await accessibleOrgs(c.get("cfg").db, c.get("user")) }));

orgsRoutes.post("/", async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({
    name: z.string().trim().min(2, "نام سازمان را وارد کنید").max(160),
    legal_name: z.string().trim().max(200).nullish(),
    timezone: timezoneSchema.nullish(),
    modules: modulesSchema.optional(),
    phone: z.string().trim().max(40).nullish(),
    email: z.string().trim().max(120).nullish(),
    city: z.string().trim().max(80).nullish(),
    address: z.string().trim().max(400).nullish(),
  }));
  // On the Windows app, owning any organisation makes one an administrator of the installation
  // (backups, restore, LAN, cloud link — see routes/local.ts); only existing administrators add
  // organisations there, otherwise any member could promote themselves.
  if (cfg.mode === "desktop" && !c.get("user").is_platform_admin) {
    const admin = await cfg.db.one(
      `select 1 from sm_org_members where user_id = $1 and role in ('owner','admin') and is_active and deleted_at is null limit 1`,
      [c.get("user").id],
    );
    if (!admin) throw forbidden("سازمان جدید را مدیر این رایانه اضافه می‌کند");
  }
  const r = await createOrg(cfg.db, c.get("user").id, input, cfg.origin);
  return c.json({ id: r.id });
});

// ---------- organisation-scoped ----------
export const orgRoutes = router();
// first for every /o/:org route: app.ts mounts orgRoutes right after loadOrg
orgRoutes.use("*", orgAccess);

// «زنده»: a token that changes whenever this organisation's data changes (src/server/live.ts)
orgRoutes.get("/pulse", async (c) => c.json({ pulse: await pulse(c.get("ctx")) }));

orgRoutes.get("/", async (c) => {
  const ctx = c.get("ctx");
  const counts = await ctx.db.one(`select (select count(*)::int from sm_org_members where org_id = $1 and deleted_at is null and is_active) as members`, [ctx.org.id]);
  const s = ctx.support ?? null;
  return c.json({
    org: ctx.org,
    member: s
      ? { role: ctx.member.role, title: `پشتیبانی ${APP_NAME}`, permissions: supportPermissions(s.level) }
      : { role: ctx.member.role, title: ROLES[ctx.member.role]?.title, permissions: permissionMap(ctx.member.role, ctx.member.overrides) },
    counts,
    // the platform admin working here in «حالت پشتیبانی» (null for members)
    support: s ? { active: true, id: s.id, level: s.level, level_title: SUPPORT_LEVEL_TITLE[s.level], reason: s.reason, started_at: s.started_at, expires_at: s.expires_at } : null,
    // the organisation's platform status: read_only refuses changes (members still see everything)
    status: { status: ctx.status?.status ?? "active", reason: ctx.status?.reason ?? null },
    // the member's effective ITSM access: nav items and spaces name an area and a level (the server checks again)
    access: await shellAccess(ctx),
  });
});

orgRoutes.patch("/", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "edit");
  const input = await body(c, z.object({
    name: z.string().trim().min(2).max(160).optional(),
    legal_name: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(40).nullish(),
    email: z.string().trim().max(120).nullish(),
    website: z.string().trim().max(200).nullish(),
    city: z.string().trim().max(80).nullish(),
    address: z.string().trim().max(400).nullish(),
    logo: z.string().max(400_000).nullish(),
    settings: z.record(z.string(), z.unknown()).optional(),
    modules: modulesSchema.optional(),
  }));
  const { settings, modules, ...profile } = input;
  if (settings && "timezone" in settings && (typeof settings.timezone !== "string" || !isTimeZone(settings.timezone))) throw bad("منطقهٔ زمانی معتبر نیست");
  const result = await ctx.write(async (tx) => {
    const patch: Record<string, unknown> = { ...profile, origin: ctx.cfg.origin };
    if (settings) {
      // one level deep: a form that saves part of a settings group keeps the rest of it
      const prev = (ctx.org.settings ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...prev };
      for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
        const old = prev[k];
        const plain = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
        merged[k] = plain(v) && plain(old) ? { ...(old as object), ...(v as object) } : v;
      }
      patch.settings = merged;
    }
    if (modules) {
      ctx.need("settings", "full");
      const next = knownModules(modules);
      const added = next.filter((m) => !(ctx.org.modules ?? []).includes(m));
      patch.modules = next;
      if (added.length) await seedOrg(tx, ctx.org.id, added, ctx.cfg.origin);
    }
    return updateRow(tx, "sm_orgs", { id: ctx.org.id }, patch);
  });
  return c.json({ org: result });
});

// ----- members -----
const LEVELS = ["none", "view", "edit", "full"] as const;
const roleSchema = z.enum(Object.keys(ROLES) as [Role, ...Role[]]);
// per-area overrides: only known areas («هوش مصنوعی» included)
const overridesSchema = z
  .record(z.string(), z.enum(LEVELS))
  .refine((o) => Object.keys(o).every((k) => k in AREAS), "بخش ناشناخته در دسترسی‌ها");

orgRoutes.get("/members", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "view");
  // password_reset: whether «رمز تازه» can work for this member (POST /members/:id/password), told
  // only to those who may reset (it also says whether the person works for another organisation)
  const rows = await ctx.db.query(
    `select m.id, m.user_id, m.role, m.overrides, m.title, m.is_active, m.created_at, u.email, u.full_name, u.mobile, u.last_login_at, u.disabled,
       ($2::boolean and ${RESETTABLE_SQL("$1", "u")}) as password_reset
     from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.deleted_at is null order by m.created_at`,
    [ctx.org.id, ctx.can("users", "full") && !ctx.support],
  );
  return c.json({
    members: rows,
    roles: Object.entries(ROLES).map(([key, r]) => ({ key, title: r.title, kind: r.kind, about: r.about })),
  });
});

orgRoutes.post("/members", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "edit");
  const input = await body(c, z.object({
    email: z.string().trim().toLowerCase().refine(isEmail, "ایمیل معتبر نیست"),
    full_name: z.string().trim().min(2, "نام را وارد کنید").max(120),
    role: roleSchema,
    title: z.string().trim().max(80).nullish(),
    password: z.string().optional(),
  }));
  if (input.role === "owner" && ctx.member.role !== "owner") throw forbidden("فقط مالک می‌تواند مالک دیگری اضافه کند");
  const refusal = memberChangeProblem(ctx, null, { user_id: "", role: input.role, overrides: {} });
  if (refusal) throw forbidden(refusal);
  let temp: string | null = null;
  const result = await ctx.write(async (tx) => {
    let user = await tx.one<{ id: string }>(`select id from sm_users where lower(email) = $1`, [input.email]);
    const created = !user;
    if (!user) {
      // the platform's administrators (PLATFORM_ADMIN_EMAILS) make their own accounts: one made
      // here with a password the organisation chose must never sign in as one
      if (ctx.cfg.platformAdmins.includes(input.email)) throw bad("این نشانی برای مدیر سامانه کنار گذاشته شده است؛ حساب آن را خودش می‌سازد");
      const pw = input.password || (temp = readableCode(3, 4));
      const problem = passwordProblem(pw);
      if (problem) throw bad(problem);
      user = await insertRow(tx, "sm_users", { id: uuidv7(), email: input.email, full_name: input.full_name, password_hash: await hashPassword(pw) }, "id");
    }
    const exists = await tx.one<{ id: string; deleted_at: string | null }>(`select id, deleted_at from sm_org_members where org_id = $1 and user_id = $2`, [ctx.org.id, user!.id]);
    if (exists && !exists.deleted_at) throw conflict("این کاربر قبلاً عضو است");
    if (exists) {
      // a member who comes back starts from the role: per-area access of the old membership is dropped
      await tx.query(`update sm_org_members set deleted_at = null, is_active = true, role = $2, title = $3, overrides = '{}'::jsonb where id = $1`, [exists.id, input.role, input.title ?? null]);
    } else {
      await insertRow(tx, "sm_org_members", { id: uuidv7(), org_id: ctx.org.id, user_id: user!.id, role: input.role, title: input.title ?? null, origin: ctx.cfg.origin }, "id");
    }
    // new_account marks an account this organisation made (see createdHere: password resets)
    await audit(tx, ctx, "member_add", "member", user!.id, `${input.email} (${ROLES[input.role].title})`, { new_account: created });
    return { user_id: user!.id, created };
  });
  await securityEvent(ctx.db, {
    kind: "member_added",
    user_id: result.user_id,
    email: input.email,
    org_id: ctx.org.id,
    ...requestMeta(c),
    data: { role: input.role, new_account: result.created, by: ctx.user.id, by_name: ctx.user.full_name },
  });
  return c.json({ user_id: result.user_id, temp_password: temp });
});

type MemberState = { id: string; role: Role; user_id: string; is_active: boolean; overrides: Partial<Record<Area, Level>> | null; title: string | null; email: string };

orgRoutes.patch("/members/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "edit");
  const input = await body(c, z.object({
    role: roleSchema.optional(),
    overrides: overridesSchema.optional(),
    title: z.string().trim().max(80).nullish(),
    is_active: z.boolean().optional(),
  }));
  const m = await ctx.db.one<MemberState>(
    `select m.id, m.role, m.user_id, m.is_active, m.overrides, m.title, u.email from sm_org_members m join sm_users u on u.id = m.user_id
     where m.id = $1 and m.org_id = $2 and m.deleted_at is null`,
    [c.req.param("id"), ctx.org.id],
  );
  if (!m) throw notFound("عضو پیدا نشد");
  // owners are changed only by owners (a manager «مدیر» is the owner's deputy, not above them);
  // below the owner nobody changes themselves, a member with more access, or grants above their own
  const refusal = memberChangeProblem(
    ctx,
    { user_id: m.user_id, role: m.role, overrides: m.overrides },
    { user_id: m.user_id, role: input.role ?? m.role, overrides: input.overrides ?? m.overrides },
  );
  if (refusal) throw forbidden(refusal);
  if (m.user_id === ctx.user.id && input.is_active === false) throw bad("نمی‌توانید حساب خودتان را غیرفعال کنید");
  const losesOwner = m.role === "owner" && m.is_active && ((input.role && input.role !== "owner") || input.is_active === false);
  await ctx.write(async (tx) => {
    if (losesOwner) {
      const owners = await tx.one<{ n: number }>(`select count(*)::int as n from sm_org_members where org_id = $1 and role = 'owner' and deleted_at is null and is_active`, [ctx.org.id]);
      if ((owners?.n ?? 0) <= 1) throw bad("سازمان باید دست‌کم یک مالک فعال داشته باشد");
    }
    await updateRow(tx, "sm_org_members", { id: m.id, org_id: ctx.org.id }, { ...input, origin: ctx.cfg.origin });
  });
  // role, per-area overrides and activation are privilege changes: logged as security events
  const changes: Record<string, unknown> = {};
  if (input.role && input.role !== m.role) changes.role = [m.role, input.role];
  if (input.overrides && JSON.stringify(input.overrides) !== JSON.stringify(m.overrides ?? {})) changes.overrides = [m.overrides ?? {}, input.overrides];
  if (input.is_active !== undefined && input.is_active !== m.is_active) changes.is_active = [m.is_active, input.is_active];
  if (Object.keys(changes).length)
    await securityEvent(ctx.db, {
      kind: "member_changed",
      user_id: m.user_id,
      email: m.email,
      org_id: ctx.org.id,
      ...requestMeta(c),
      data: { changes, by: ctx.user.id, by_name: ctx.user.full_name },
    });
  return c.json({ ok: true });
});

orgRoutes.post("/members/:id/password", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  const input = await body(c, z.object({ password: z.string().optional() }));
  const m = await ctx.db.one<{ user_id: string; role: Role; overrides: Partial<Record<Area, Level>> | null; email: string }>(
    `select m.user_id, m.role, m.overrides, u.email from sm_org_members m join sm_users u on u.id = m.user_id where m.id = $1 and m.org_id = $2 and m.deleted_at is null`,
    [c.req.param("id"), ctx.org.id],
  );
  if (!m) throw notFound("عضو پیدا نشد");
  if (m.role === "owner" && ctx.member.role !== "owner") throw forbidden();
  const grant = { user_id: m.user_id, role: m.role, overrides: m.overrides };
  const refusal = memberChangeProblem(ctx, grant, grant);
  if (refusal) throw forbidden(refusal);
  // the account is global: anyone can add an existing account to their own organisation by its e-mail.
  // An organisation resets only an account it made itself, for someone who works for no other organisation,
  // and never a platform admin's (that one is reset from «مدیریت سامانه»)
  if (!(await createdHere(ctx.db, ctx.org.id, m.user_id)))
    throw forbidden("این حساب پیش از عضویت در این سازمان ساخته شده بود؛ رمز آن را صاحب حساب خودش از «حساب من» عوض می‌کند (یا با کمک مدیر سامانه)");
  const elsewhere = await ctx.db.one(
    `select 1 from sm_users u where u.id = $1 and (u.is_platform_admin or exists (
       select 1 from sm_org_members o where o.user_id = u.id and o.org_id <> $2 and o.deleted_at is null))`,
    [m.user_id, ctx.org.id],
  );
  if (elsewhere) throw forbidden("این کاربر در سازمان دیگری هم عضو است؛ رمز را خودش از «حساب من» عوض می‌کند (یا با کمک مدیر سامانه)");
  const pw = input.password || readableCode(3, 4);
  const problem = passwordProblem(pw);
  if (problem) throw bad(problem);
  await ctx.db.query(`update sm_users set password_hash = $2 where id = $1`, [m.user_id, await hashPassword(pw)]);
  await ctx.db.query(`update sm_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [m.user_id]);
  await securityEvent(ctx.db, {
    kind: "password_reset",
    user_id: m.user_id,
    email: m.email,
    org_id: ctx.org.id,
    ...requestMeta(c),
    data: { scope: "org", by: ctx.user.id, by_name: ctx.user.full_name },
  });
  return c.json({ ok: true, temp_password: input.password ? null : pw });
});

// ----- audit log and support sessions -----
// actor_kind: 'user' (a member), 'support' (the platform admin in a support session) or 'platform'
// (a change the platform admin made from «مدیریت سامانه», e.g. the organisation's status)
orgRoutes.get("/audit", async (c: C) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "view");
  const before = c.req.query("before");
  const params: unknown[] = [ctx.org.id];
  if (before) params.push(before);
  const rows = await ctx.db.query(
    `select a.*, u.full_name, u.email from sm_audit a left join sm_users u on u.id = a.user_id
     where a.org_id = $1 ${before ? "and a.at < $2" : ""} order by a.at desc limit 300`,
    params,
  );
  return c.json({ rows });
});

orgRoutes.get("/support-sessions", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "view");
  const sessions = await listSupportSessions(ctx.db, { org_id: ctx.org.id, limit: 100 });
  return c.json({ sessions, can_end: !ctx.support && (ctx.member.role === "owner" || ctx.member.role === "admin") });
});

/** An owner or manager closes the door on a live support session at any time. */
orgRoutes.post("/support-sessions/:id/end", async (c) => {
  const ctx = c.get("ctx");
  if (ctx.support || (ctx.member.role !== "owner" && ctx.member.role !== "admin")) throw forbidden("پایان حالت پشتیبانی با مالک یا مدیر سازمان است");
  const session = await endSupport(ctx.cfg, ctx.user, c.req.param("id"), { member: { org_id: ctx.org.id } }, requestMeta(c));
  return c.json({ session });
});

