// /api/orgs (list/create) and /api/o/:org (profile, settings, members, fiscal years).
import { z } from "zod";
import { router, body, requireUser, type C } from "../http/hono";
import { bad, conflict, forbidden, notFound } from "../http/errors";
import { createOrg, listMyOrgs, seedOrg, FIAT, CRYPTO } from "../modules/orgs/service";
import { listFiscalYears } from "../modules/accounting/fiscal";
import { closeFiscalYear, reopenFiscalYear } from "../modules/accounting/closing";
import { permissionMap, ROLES, type Role } from "@shared/permissions";
import { BUSINESS_KINDS, BASE_CURRENCIES, type ModuleKey } from "@shared/constants";
import { hashPassword, passwordProblem, readableCode } from "../auth/password";
import { uuidv7 } from "@shared/id";
import { insertMany, insertRow, updateRow } from "../db/sql";
import { coaFor, levelOfCode, parentCode } from "../modules/accounting/coa";
import { isEmail } from "@shared/validate";
import { audit } from "../modules/data/crud";
import { jalaliYearRange, toFa } from "@shared/jalali";

const modulesSchema = z.array(z.enum(["goods", "gold", "fx"]));

export const orgsRoutes = router();
orgsRoutes.use("*", requireUser);

orgsRoutes.get("/", async (c) => {
  const u = c.get("user");
  return c.json({ orgs: await listMyOrgs(c.get("cfg").db, u.id, u.is_platform_admin) });
});

orgsRoutes.post("/", async (c) => {
  const cfg = c.get("cfg");
  const input = await body(c, z.object({
    name: z.string().trim().min(2, "نام کسب‌وکار را وارد کنید").max(160),
    legal_name: z.string().trim().max(200).nullish(),
    business_kind: z.enum(BUSINESS_KINDS.map((b) => b.key) as [string, ...string[]]),
    modules: modulesSchema,
    base_currency: z.enum(BASE_CURRENCIES.map((b) => b.code) as [string, ...string[]]).default("IRR"),
    fiscal_year: z.number().int().min(1350).max(1500).optional(),
    economic_code: z.string().trim().max(20).nullish(),
    national_id: z.string().trim().max(20).nullish(),
    phone: z.string().trim().max(40).nullish(),
    city: z.string().trim().max(80).nullish(),
    address: z.string().trim().max(400).nullish(),
  }));
  const r = await createOrg(cfg.db, c.get("user").id, input as never, cfg.origin);
  return c.json({ id: r.id });
});

// ---------- organisation-scoped ----------
export const orgRoutes = router();

orgRoutes.get("/", async (c) => {
  const ctx = c.get("ctx");
  const [fiscalYears, base, counts] = await Promise.all([
    listFiscalYears(ctx.db, ctx.org.id),
    ctx.db.one(`select id, code, name, symbol, decimals from tz_currencies where org_id = $1 and is_base and deleted_at is null`, [ctx.org.id]),
    ctx.db.one(`select (select count(*)::int from tz_org_members where org_id = $1 and deleted_at is null and is_active) as members`, [ctx.org.id]),
  ]);
  return c.json({
    org: ctx.org,
    member: { role: ctx.member.role, title: ROLES[ctx.member.role]?.title, permissions: permissionMap(ctx.member.role, ctx.member.overrides) },
    fiscal_years: fiscalYears,
    base_currency: base,
    counts,
  });
});

orgRoutes.patch("/", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "edit");
  const input = await body(c, z.object({
    name: z.string().trim().min(2).max(160).optional(),
    legal_name: z.string().trim().max(200).nullish(),
    economic_code: z.string().trim().max(20).nullish(),
    national_id: z.string().trim().max(20).nullish(),
    registration_no: z.string().trim().max(40).nullish(),
    phone: z.string().trim().max(40).nullish(),
    mobile: z.string().trim().max(40).nullish(),
    email: z.string().trim().max(120).nullish(),
    website: z.string().trim().max(200).nullish(),
    province: z.string().trim().max(80).nullish(),
    city: z.string().trim().max(80).nullish(),
    address: z.string().trim().max(400).nullish(),
    postal_code: z.string().trim().max(20).nullish(),
    logo: z.string().max(400_000).nullish(),
    settings: z.record(z.string(), z.unknown()).optional(),
    modules: modulesSchema.optional(),
  }));
  const { settings, modules, ...profile } = input;
  const result = await ctx.write(async (tx) => {
    const patch: Record<string, unknown> = { ...profile, origin: ctx.cfg.origin };
    if (settings) {
      // one level deep: a form that saves part of settings.fx / settings.gold keeps the rest
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
      patch.modules = modules;
      await addModuleData(tx, ctx.org.id, ctx.org.modules, modules, ctx.cfg.origin);
    }
    return updateRow(tx, "tz_orgs", { id: ctx.org.id }, patch);
  });
  return c.json({ org: result });
});

/** When a module is switched on later: add its accounts, currencies and defaults. */
async function addModuleData(tx: import("../db").Tx, orgId: string, before: ModuleKey[], after: ModuleKey[], origin: string) {
  const added = after.filter((m) => !before.includes(m));
  if (!added.length) return;
  const existing = new Map((await tx.query<{ id: string; code: string }>(`select id, code from tz_accounts where org_id = $1 and deleted_at is null`, [orgId])).map((r) => [r.code, r.id]));
  const keys = new Set((await tx.query<{ system_key: string }>(`select system_key from tz_accounts where org_id = $1 and system_key is not null and deleted_at is null`, [orgId])).map((r) => r.system_key));
  const rows = coaFor(after).filter((e) => e.module && added.includes(e.module) && !existing.has(e.code) && !(e.key && keys.has(e.key)));
  for (const e of rows) existing.set(e.code, uuidv7());
  await insertMany(tx, "tz_accounts", rows.map((e) => ({
    id: existing.get(e.code), org_id: orgId, parent_id: parentCode(e.code) ? existing.get(parentCode(e.code)!) ?? null : null,
    code: e.code, name: e.name, level: levelOfCode(e.code), kind: e.kind, nature: e.nature, is_postable: levelOfCode(e.code) === 3,
    detail_mode: e.detail?.mode ?? "none", detail_kinds: e.detail?.kinds ?? [], fx_mode: e.fx ?? "none", weight_mode: e.weight ?? "none",
    system_key: e.key ?? null, sort: 500, origin,
  })));
  if (added.includes("fx")) {
    const have = new Set((await tx.query<{ code: string }>(`select code from tz_currencies where org_id = $1 and deleted_at is null`, [orgId])).map((r) => r.code));
    const cur: Record<string, unknown>[] = [];
    FIAT.forEach(([code, name, symbol, decimals], i) => { if (!have.has(code)) cur.push({ id: uuidv7(), org_id: orgId, code, name, symbol, kind: "fiat", decimals, sort: 10 + i, origin }); });
    CRYPTO.forEach(([code, name, symbol, decimals, cg, ku], i) => { if (!have.has(code)) cur.push({ id: uuidv7(), org_id: orgId, code, name, symbol, kind: "crypto", decimals, sort: 100 + i, price_ids: { coingecko: cg, kucoin: ku, okx: ku, nobitex: code.toLowerCase() }, origin }); });
    await insertMany(tx, "tz_currencies", cur);
  }
  if (added.includes("gold")) {
    const cats = await tx.one<{ n: number }>(`select count(*)::int as n from tz_gold_categories where org_id = $1`, [orgId]);
    if (!cats?.n) {
      const names = ["انگشتر", "گردنبند", "دستبند", "النگو", "گوشواره", "سرویس", "آویز", "زنجیر"];
      await insertMany(tx, "tz_gold_categories", names.map((name, i) => ({ id: uuidv7(), org_id: orgId, code: String(i + 1), name, wage_type: "percent", wage_value: "15", origin })));
    }
    const wh = await tx.one(`select 1 from tz_warehouses where org_id = $1 and deleted_at is null`, [orgId]);
    if (!wh) await insertRow(tx, "tz_warehouses", { id: uuidv7(), org_id: orgId, code: "1", name: "ویترین و گاوصندوق", origin }, "id");
  }
  if (added.includes("goods")) {
    const wh = await tx.one(`select 1 from tz_warehouses where org_id = $1 and deleted_at is null`, [orgId]);
    if (!wh) await insertRow(tx, "tz_warehouses", { id: uuidv7(), org_id: orgId, code: "1", name: "انبار مرکزی", origin }, "id");
  }
}

// ----- members -----
orgRoutes.get("/members", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "view");
  const rows = await ctx.db.query(
    `select m.id, m.user_id, m.role, m.overrides, m.title, m.is_active, m.created_at, u.email, u.full_name, u.mobile, u.last_login_at, u.disabled
     from tz_org_members m join tz_users u on u.id = m.user_id
     where m.org_id = $1 and m.deleted_at is null order by m.created_at`,
    [ctx.org.id],
  );
  return c.json({ members: rows, roles: Object.entries(ROLES).map(([key, r]) => ({ key, title: r.title })) });
});

orgRoutes.post("/members", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "edit");
  const input = await body(c, z.object({
    email: z.string().trim().toLowerCase().refine(isEmail, "ایمیل معتبر نیست"),
    full_name: z.string().trim().min(2, "نام را وارد کنید").max(120),
    role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]),
    title: z.string().trim().max(80).nullish(),
    password: z.string().optional(),
  }));
  if (input.role === "owner" && ctx.member.role !== "owner" && !ctx.user.is_platform_admin) throw forbidden("فقط مالک می‌تواند مالک دیگری اضافه کند");
  let temp: string | null = null;
  const result = await ctx.write(async (tx) => {
    let user = await tx.one<{ id: string }>(`select id from tz_users where lower(email) = $1`, [input.email]);
    if (!user) {
      const pw = input.password || (temp = readableCode(3, 4));
      const problem = passwordProblem(pw);
      if (problem) throw bad(problem);
      user = await insertRow(tx, "tz_users", { id: uuidv7(), email: input.email, full_name: input.full_name, password_hash: await hashPassword(pw) }, "id");
    }
    const exists = await tx.one<{ id: string; deleted_at: string | null }>(`select id, deleted_at from tz_org_members where org_id = $1 and user_id = $2`, [ctx.org.id, user!.id]);
    if (exists && !exists.deleted_at) throw conflict("این کاربر قبلاً عضو است");
    if (exists) {
      await tx.query(`update tz_org_members set deleted_at = null, is_active = true, role = $2, title = $3 where id = $1`, [exists.id, input.role, input.title ?? null]);
    } else {
      await insertRow(tx, "tz_org_members", { id: uuidv7(), org_id: ctx.org.id, user_id: user!.id, role: input.role, title: input.title ?? null, origin: ctx.cfg.origin }, "id");
    }
    await audit(tx, ctx, "member_add", "member", user!.id, input.email);
    return { user_id: user!.id };
  });
  return c.json({ ...result, temp_password: temp });
});

orgRoutes.patch("/members/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "edit");
  const input = await body(c, z.object({
    role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]).optional(),
    overrides: z.record(z.string(), z.enum(["none", "view", "edit", "full"])).optional(),
    title: z.string().trim().max(80).nullish(),
    is_active: z.boolean().optional(),
  }));
  const m = await ctx.db.one<{ id: string; role: Role; user_id: string }>(`select id, role, user_id from tz_org_members where id = $1 and org_id = $2 and deleted_at is null`, [c.req.param("id"), ctx.org.id]);
  if (!m) throw notFound("عضو پیدا نشد");
  if ((m.role === "owner" || input.role === "owner") && ctx.member.role !== "owner" && !ctx.user.is_platform_admin) throw forbidden("فقط مالک می‌تواند نقش مالک را تغییر دهد");
  if (m.user_id === ctx.user.id && input.is_active === false) throw bad("نمی‌توانید حساب خودتان را غیرفعال کنید");
  await ctx.write(async (tx) => {
    if (m.role === "owner" && input.role && input.role !== "owner") {
      const owners = await tx.one<{ n: number }>(`select count(*)::int as n from tz_org_members where org_id = $1 and role = 'owner' and deleted_at is null and is_active`, [ctx.org.id]);
      if ((owners?.n ?? 0) <= 1) throw bad("کسب‌وکار باید دست‌کم یک مالک داشته باشد");
    }
    await updateRow(tx, "tz_org_members", { id: m.id, org_id: ctx.org.id }, { ...input, origin: ctx.cfg.origin });
  });
  return c.json({ ok: true });
});

orgRoutes.post("/members/:id/password", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("users", "full");
  const input = await body(c, z.object({ password: z.string().optional() }));
  const m = await ctx.db.one<{ user_id: string; role: Role }>(`select user_id, role from tz_org_members where id = $1 and org_id = $2 and deleted_at is null`, [c.req.param("id"), ctx.org.id]);
  if (!m) throw notFound("عضو پیدا نشد");
  if (m.role === "owner" && ctx.member.role !== "owner" && !ctx.user.is_platform_admin) throw forbidden();
  const pw = input.password || readableCode(3, 4);
  const problem = passwordProblem(pw);
  if (problem) throw bad(problem);
  await ctx.db.query(`update tz_users set password_hash = $2 where id = $1`, [m.user_id, await hashPassword(pw)]);
  await ctx.db.query(`update tz_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [m.user_id]);
  return c.json({ ok: true, temp_password: input.password ? null : pw });
});

// ----- fiscal years -----
orgRoutes.get("/fiscal-years", async (c) => c.json({ fiscal_years: await listFiscalYears(c.get("ctx").db, c.get("ctx").org.id) }));

orgRoutes.post("/fiscal-years", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "full");
  const input = await body(c, z.object({ jalali_year: z.number().int().min(1350).max(1500).optional(), title: z.string().trim().max(80).optional(), start_date: z.string().optional(), end_date: z.string().optional() }));
  let start = input.start_date;
  let end = input.end_date;
  if (input.jalali_year) {
    const r = jalaliYearRange(input.jalali_year);
    start = r.start;
    end = r.end;
  }
  if (!start || !end || start > end) throw bad("بازه‌ی سال مالی معتبر نیست");
  const overlap = await ctx.db.one(`select 1 from tz_fiscal_years where org_id = $1 and deleted_at is null and start_date <= $3 and end_date >= $2`, [ctx.org.id, start, end]);
  if (overlap) throw conflict("این بازه با سال مالی دیگری هم‌پوشانی دارد");
  const row = await ctx.write((tx) => insertRow(tx, "tz_fiscal_years", { id: uuidv7(), org_id: ctx.org.id, title: input.title || `سال مالی ${toFa(input.jalali_year ?? start!.slice(0, 4))}`, start_date: start, end_date: end, status: "open", origin: ctx.cfg.origin }));
  return c.json({ fiscal_year: row });
});

orgRoutes.post("/fiscal-years/:id/close", async (c) => c.json(await closeFiscalYear(c.get("ctx"), c.req.param("id"))));
orgRoutes.post("/fiscal-years/:id/reopen", async (c) => c.json(await reopenFiscalYear(c.get("ctx"), c.req.param("id"))));

orgRoutes.get("/audit", async (c: C) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "view");
  const rows = await ctx.db.query(
    `select a.*, u.full_name, u.email from tz_audit a left join tz_users u on u.id = a.user_id where a.org_id = $1 order by a.at desc limit 300`,
    [ctx.org.id],
  );
  return c.json({ rows });
});

export { seedOrg };
