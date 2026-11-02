// /api/o/:org/accounting — chart of accounts, vouchers, reports.
import { z } from "zod";
import { router, body } from "../http/hono";
import { notFound, bad } from "../http/errors";
import { createAccount, deleteAccount, updateAccount } from "../modules/accounting/accounts";
import { deleteVoucher, getVoucher, saveVoucher } from "../modules/accounting/vouchers";
import * as reports from "../modules/accounting/reports";
import { likeContains } from "../db";
import { normalizeDigits } from "@shared/money";

export const accountingRoutes = router();

const lineSchema = z.object({
  account_id: z.string().uuid("حساب را انتخاب کنید"),
  detail_id: z.string().uuid().nullish(),
  detail2_id: z.string().uuid().nullish(),
  description: z.string().max(500).nullish(),
  debit: z.union([z.string(), z.number()]).nullish(),
  credit: z.union([z.string(), z.number()]).nullish(),
  currency_id: z.string().uuid().nullish(),
  fx_debit: z.union([z.string(), z.number()]).nullish(),
  fx_credit: z.union([z.string(), z.number()]).nullish(),
  fx_rate: z.union([z.string(), z.number()]).nullish(),
  w_debit: z.union([z.string(), z.number()]).nullish(),
  w_credit: z.union([z.string(), z.number()]).nullish(),
  fineness: z.union([z.string(), z.number()]).nullish(),
  qty: z.union([z.string(), z.number()]).nullish(),
  due_date: z.string().nullish(),
});
const voucherSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست"),
  description: z.string().max(1000).nullish(),
  ref_no: z.string().max(60).nullish(),
  kind: z.enum(["normal", "opening"]).optional(),
  status: z.enum(["draft", "posted"]).optional(),
  lines: z.array(lineSchema).min(1, "سند ردیف ندارد").max(2000),
});

// ----- accounts -----
accountingRoutes.get("/accounts", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "view");
  const rows = await ctx.db.query(
    `select a.*, (select count(*)::int from tz_voucher_lines l where l.account_id = a.id) as line_count
     from tz_accounts a where a.org_id = $1 and a.deleted_at is null order by a.code`,
    [ctx.org.id],
  );
  return c.json({ accounts: rows });
});
const accountSchema = z.object({
  parent_id: z.string().uuid().nullish(),
  code: z.string().max(12).optional(),
  name: z.string().max(200).optional(),
  kind: z.string().optional(),
  nature: z.enum(["debit", "credit", "both"]).optional(),
  detail_mode: z.enum(["none", "optional", "required"]).optional(),
  detail_kinds: z.array(z.string()).optional(),
  fx_mode: z.enum(["none", "optional", "required"]).optional(),
  currency_id: z.string().uuid().nullish(),
  weight_mode: z.enum(["none", "optional", "required"]).optional(),
  system_key: z.string().max(60).nullish(),
  is_active: z.boolean().optional(),
  description: z.string().max(1000).nullish(),
});
accountingRoutes.post("/accounts", async (c) => c.json({ account: await createAccount(c.get("ctx"), await body(c, accountSchema)) }));
accountingRoutes.patch("/accounts/:id", async (c) => c.json({ account: await updateAccount(c.get("ctx"), c.req.param("id"), await body(c, accountSchema)) }));
accountingRoutes.delete("/accounts/:id", async (c) => c.json(await deleteAccount(c.get("ctx"), c.req.param("id"))));

// ----- vouchers -----
accountingRoutes.get("/vouchers", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "view");
  const q = c.req.query();
  const params: unknown[] = [ctx.org.id];
  const cond = ["v.org_id = $1", "v.deleted_at is null"];
  if (q.fiscal_year_id) { params.push(q.fiscal_year_id); cond.push(`v.fiscal_year_id = $${params.length}`); }
  if (q.from) { params.push(q.from); cond.push(`v.date >= $${params.length}`); }
  if (q.to) { params.push(q.to); cond.push(`v.date <= $${params.length}`); }
  if (q.status) { params.push(q.status); cond.push(`v.status = $${params.length}`); }
  if (q.kind) { params.push(q.kind); cond.push(`v.kind = $${params.length}`); }
  if (q.q) {
    const s = normalizeDigits(q.q.trim());
    if (/^\d+$/.test(s)) { params.push(Number(s)); cond.push(`v.no = $${params.length}`); }
    else { params.push(likeContains(s)); cond.push(`v.description ilike $${params.length}`); }
  }
  const page = Math.max(1, Number(q.page ?? 1));
  const size = Math.min(500, Math.max(1, Number(q.size ?? 50)));
  const total = await ctx.db.one<{ n: number }>(`select count(*)::int as n from tz_vouchers v where ${cond.join(" and ")}`, params);
  const rows = await ctx.db.query(
    `select v.id, v.no, v.date, v.kind, v.status, v.description, v.total_debit, v.total_credit, v.source_type, v.source_id, v.ref_no, v.created_at,
            u.full_name as created_by_name
     from tz_vouchers v left join tz_users u on u.id = v.created_by
     where ${cond.join(" and ")} order by v.date desc, v.no desc limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return c.json({ rows, total: total?.n ?? 0, page, size });
});

accountingRoutes.get("/vouchers/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "view");
  return c.json({ voucher: await getVoucher(ctx.db, ctx.org.id, c.req.param("id")) });
});

accountingRoutes.post("/vouchers", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "edit");
  const input = await body(c, voucherSchema);
  const saved = await ctx.write((tx) => saveVoucher(tx, ctx.org, { ...input, lines: input.lines as never }, { userId: ctx.user.id, origin: ctx.cfg.origin }));
  return c.json({ voucher: saved });
});

accountingRoutes.put("/vouchers/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "edit");
  const input = await body(c, voucherSchema);
  const saved = await ctx.write(async (tx) => {
    const v = await tx.one(`select id from tz_vouchers where id = $1 and org_id = $2 and deleted_at is null`, [c.req.param("id"), ctx.org.id]);
    if (!v) throw notFound("سند پیدا نشد");
    return saveVoucher(tx, ctx.org, { ...input, id: c.req.param("id"), lines: input.lines as never }, { userId: ctx.user.id, origin: ctx.cfg.origin });
  });
  return c.json({ voucher: saved });
});

accountingRoutes.post("/vouchers/:id/status", async (c) => {
  const ctx = c.get("ctx");
  const { status } = await body(c, z.object({ status: z.enum(["draft", "posted", "final"]) }));
  ctx.need("accounting", status === "final" ? "full" : "edit");
  await ctx.write(async (tx) => {
    const v = await tx.one<{ status: string }>(`select status from tz_vouchers where id = $1 and org_id = $2 and deleted_at is null`, [c.req.param("id"), ctx.org.id]);
    if (!v) throw notFound("سند پیدا نشد");
    if (v.status === "final") throw bad("سند قطعی قابل تغییر وضعیت نیست");
    await tx.query(
      `update tz_vouchers set status = $3, approved_by = case when $3 = 'final' then $4::uuid else approved_by end,
         approved_at = case when $3 = 'final' then now() else approved_at end, origin = $5 where id = $1 and org_id = $2`,
      [c.req.param("id"), ctx.org.id, status, ctx.user.id, ctx.cfg.origin],
    );
  });
  return c.json({ ok: true });
});

accountingRoutes.delete("/vouchers/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "full");
  await ctx.write((tx) => deleteVoucher(tx, ctx.org.id, c.req.param("id")));
  return c.json({ ok: true });
});

/** Renumber a fiscal year's vouchers by date (مرتب‌سازی شماره‌ی اسناد). */
accountingRoutes.post("/vouchers/renumber", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("accounting", "full");
  const { fiscal_year_id } = await body(c, z.object({ fiscal_year_id: z.string().uuid() }));
  const n = await ctx.write(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `select id from tz_vouchers where org_id = $1 and fiscal_year_id = $2 and deleted_at is null
       order by case kind when 'opening' then 0 when 'temp_closing' then 2 when 'closing' then 3 else 1 end, date, no, created_at`,
      [ctx.org.id, fiscal_year_id],
    );
    await tx.query(`update tz_vouchers set no = -no where org_id = $1 and fiscal_year_id = $2 and deleted_at is null`, [ctx.org.id, fiscal_year_id]);
    let i = 0;
    for (const r of rows) await tx.query(`update tz_vouchers set no = $2 where id = $1`, [r.id, ++i]);
    return i;
  });
  return c.json({ ok: true, count: n });
});

// ----- reports -----
const range = (q: Record<string, string>) => ({
  from: q.from || null,
  to: q.to || null,
  fiscalYearId: q.fiscal_year_id || null,
  includeDrafts: q.drafts === "1",
});

accountingRoutes.get("/reports/trial-balance", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  const q = c.req.query();
  return c.json(await reports.trialBalance(ctx.db, ctx.org.id, { ...range(q), level: q.level ? Number(q.level) : 3, nonZero: q.nonzero !== "0" }));
});
accountingRoutes.get("/reports/ledger", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  const q = c.req.query();
  if (!q.account_id && !q.detail_id) throw bad("حساب یا تفصیلی را انتخاب کنید");
  return c.json(await reports.ledger(ctx.db, ctx.org.id, { ...range(q), accountId: q.account_id || null, detailId: q.detail_id || null, currencyId: q.currency_id || null }));
});
accountingRoutes.get("/reports/detail-balances", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  const q = c.req.query();
  return c.json({ rows: await reports.detailBalances(ctx.db, ctx.org.id, { ...range(q), accountId: q.account_id || null, kind: q.kind || null, currencyId: q.currency_id || null }) });
});
accountingRoutes.get("/reports/journal", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  return c.json({ rows: await reports.journal(ctx.db, ctx.org.id, range(c.req.query())) });
});
accountingRoutes.get("/reports/income-statement", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  return c.json(await reports.incomeStatement(ctx.db, ctx.org.id, range(c.req.query())));
});
accountingRoutes.get("/reports/balance-sheet", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("reports", "view");
  return c.json(await reports.balanceSheet(ctx.db, ctx.org.id, range(c.req.query())));
});
