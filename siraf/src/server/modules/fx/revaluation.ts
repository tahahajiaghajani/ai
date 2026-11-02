// Revaluation (تسعیر ارز): bring the base-currency value of foreign balances to the market rate
// of a date. Every (account, detail, currency) balance on the position accounts — and, when
// asked, on customers' currency accounts and correspondents — is adjusted to amount × rate; the
// differences go to «سود (زیان) تسعیر ارز» in one automatic voucher (type `fx_revaluation`).
// Running it again for the same date replaces that date's voucher. After a revaluation the
// average cost of a currency is the revalued rate, so later profit is measured from there.
import type { Ctx, OrgRow } from "../../context";
import type { Queryable } from "../../db";
import { bad, conflict, notFound } from "../../http/errors";
import { D, isNumeric } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { formatJalali } from "@shared/jalali";
import { formatNumber } from "@shared/format";
import { accountByKey, postAuto, removeAuto, signed, type VoucherLineInput } from "../accounting/vouchers";
import { audit } from "../data/crud";
import { currencyBook, latestRates, LIVE, orgTz, POSITION_KEYS, rateMid, roundTo } from "./common";

export interface RevaluationInput {
  date: string;
  include_parties?: boolean;
  /** rate overrides per currency id (base per unit) */
  rates?: Record<string, string | number | null>;
}

export async function revaluationPreview(q: Queryable, org: OrgRow, input: RevaluationInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw bad("تاریخ تسعیر معتبر نیست");
  const dp = org.money_decimals ?? 0;
  const cur = await currencyBook(q, org.id);
  const board = await latestRates(q, org.id, { date: input.date, tz: orgTz(org) });
  const keys = input.include_parties ? [...POSITION_KEYS, "fx_parties", "correspondents", "remittances_payable"] : POSITION_KEYS;
  const rows = await q.query<{ account_id: string; system_key: string; account_code: string; account_name: string; detail_id: string | null; detail_name: string | null; currency_id: string; fx: string; base: string }>(
    `select l.account_id, a.system_key, a.code as account_code, a.name as account_name, l.detail_id, d.name as detail_name, l.currency_id,
            sum(l.fx_debit - l.fx_credit) as fx, sum(l.debit - l.credit) as base
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     left join tz_details d on d.id = l.detail_id
     where l.org_id = $1 and ${LIVE} and v.date <= $2 and a.system_key = any($3::text[]) and l.currency_id is not null and l.currency_id <> $4
       and (v.source_type is distinct from 'fx_revaluation' or v.date <> $2)
     group by l.account_id, a.system_key, a.code, a.name, l.detail_id, d.name, l.currency_id
     order by a.code, d.name`,
    [org.id, input.date, `{${keys.join(",")}}`, cur.base.id],
  );
  const rateOf = new Map<string, string | null>();
  const sourceOf = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.currency_id))) {
    const o = input.rates?.[id];
    if (o !== undefined && o !== null && o !== "" && isNumeric(o) && D(o).gt(0)) {
      rateOf.set(id, D(o).toFixed());
      sourceOf.set(id, "manual");
    } else {
      rateOf.set(id, rateMid(board.get(id)));
      sourceOf.set(id, board.get(id)?.source ?? "");
    }
  }
  const missing = new Set<string>();
  const lines = rows
    .map((r) => {
      const c = cur.byId.get(r.currency_id);
      const rate = rateOf.get(r.currency_id) ?? null;
      if (!rate) {
        if (!D(r.fx).isZero()) missing.add(c?.code ?? "?");
        return null;
      }
      const target = roundTo(D(r.fx).times(D(rate)), dp);
      const diff = D(target).minus(D(r.base));
      return {
        account_id: r.account_id,
        account_key: r.system_key,
        account_code: r.account_code,
        account_name: r.account_name,
        detail_id: r.detail_id,
        detail_name: r.detail_name,
        currency_id: r.currency_id,
        code: c?.code ?? "",
        decimals: c?.decimals ?? 2,
        fx: r.fx,
        book: r.base,
        rate,
        target,
        diff: diff.toFixed(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && !D(x.diff).isZero());
  const currencies = [...rateOf.entries()].map(([id, rate]) => ({ currency_id: id, code: cur.byId.get(id)?.code ?? "", rate, source: sourceOf.get(id) ?? "" }));
  const existing = await q.one<{ id: string; no: number; source_id: string }>(
    `select id, no, source_id from tz_vouchers where org_id = $1 and source_type = 'fx_revaluation' and date = $2 and deleted_at is null order by created_at limit 1`,
    [org.id, input.date],
  );
  return {
    date: input.date,
    rows: lines,
    currencies,
    missing_rates: [...missing],
    total: lines.reduce((a, l) => a.plus(D(l.diff)), D(0)).toFixed(),
    existing: existing ? { voucher_id: existing.id, no: existing.no } : null,
  };
}

/**
 * A later run measured its differences against the books including this date's run, so
 * replacing or removing an earlier run would leave the later one wrong: go latest first.
 */
async function assertLatest(q: Queryable, orgId: string, date: string) {
  const later = await q.one<{ date: string }>(
    `select date from tz_vouchers where org_id = $1 and source_type = 'fx_revaluation' and deleted_at is null and date > $2 order by date desc limit 1`,
    [orgId, date],
  );
  if (later) throw conflict(`تسعیر ارز تاریخ ${formatJalali(later.date)} بعد از این تاریخ ثبت شده است؛ ابتدا آن را حذف کنید`);
}

export async function previewRevaluation(ctx: Ctx, input: RevaluationInput) {
  ctx.need("fx", "view");
  ctx.need("reports", "view");
  return revaluationPreview(ctx.db, ctx.org, input);
}

export async function postRevaluation(ctx: Ctx, input: RevaluationInput) {
  ctx.need("fx", "full");
  ctx.need("accounting", "edit");
  return ctx.write(async (tx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw bad("تاریخ تسعیر معتبر نیست");
    await assertLatest(tx, ctx.org.id, input.date);
    const p = await revaluationPreview(tx, ctx.org, input);
    if (p.missing_rates.length) throw bad(`نرخ این ارزها برای تسعیر معلوم نیست: ${p.missing_rates.join("، ")}`);
    const existing = await tx.one<{ source_id: string }>(
      `select source_id from tz_vouchers where org_id = $1 and source_type = 'fx_revaluation' and date = $2 and deleted_at is null order by created_at limit 1`,
      [ctx.org.id, input.date],
    );
    const sourceId = existing?.source_id ?? uuidv7();
    const lines: VoucherLineInput[] = p.rows.map((r) =>
      signed(r.account_id, r.diff, {
        detail_id: r.detail_id,
        currency_id: r.currency_id,
        fx_rate: r.rate,
        description: `تسعیر ${formatNumber(r.fx, { dp: r.decimals })} ${r.code} به نرخ ${formatNumber(r.rate, { dp: 6 })}`,
      }),
    );
    const total = D(p.total);
    if (!total.isZero()) lines.push(signed(await accountByKey(tx, ctx.org.id, "fx_revaluation"), total.neg().toFixed(), { description: total.gt(0) ? "سود تسعیر ارز" : "زیان تسعیر ارز" }));
    const voucherId = await postAuto(
      tx,
      ctx.org,
      { type: "fx_revaluation", id: sourceId, date: input.date, description: `تسعیر ارز — ${formatJalali(input.date)}${input.include_parties ? " (با حساب اشخاص و همکاران)" : ""}` },
      lines,
      { userId: ctx.user.id, origin: ctx.cfg.origin },
    );
    await audit(tx, ctx, "post", "fx_revaluation", sourceId, `تسعیر ارز ${input.date}: ${p.total}`);
    const v = voucherId ? await tx.one<{ no: number }>(`select no from tz_vouchers where id = $1`, [voucherId]) : null;
    return { voucher_id: voucherId, voucher_no: v?.no ?? null, total: p.total, rows: p.rows.length };
  });
}

export async function listRevaluations(ctx: Ctx) {
  ctx.need("fx", "view");
  const rows = await ctx.db.query(
    `select v.id, v.no, v.date, v.description, v.total_debit, v.source_id, v.created_at,
            coalesce((select sum(l.credit - l.debit) from tz_voucher_lines l join tz_accounts a on a.id = l.account_id
                      where l.voucher_id = v.id and a.system_key = 'fx_revaluation'), 0) as result
     from tz_vouchers v where v.org_id = $1 and v.source_type = 'fx_revaluation' and v.deleted_at is null
     order by v.date desc, v.no desc limit 200`,
    [ctx.org.id],
  );
  return { rows };
}

export async function removeRevaluation(ctx: Ctx, voucherId: string) {
  ctx.need("fx", "full");
  ctx.need("accounting", "edit");
  if (!isUuid(voucherId)) throw notFound("سند تسعیر پیدا نشد");
  return ctx.write(async (tx) => {
    const v = await tx.one<{ source_id: string; date: string }>(
      `select source_id, date from tz_vouchers where id = $1 and org_id = $2 and source_type = 'fx_revaluation' and deleted_at is null`,
      [voucherId, ctx.org.id],
    );
    if (!v) throw notFound("سند تسعیر پیدا نشد");
    await assertLatest(tx, ctx.org.id, v.date);
    await removeAuto(tx, ctx.org.id, "fx_revaluation", v.source_id);
    await audit(tx, ctx, "delete", "fx_revaluation", v.source_id, `حذف تسعیر ${v.date}`);
    return { ok: true };
  });
}
