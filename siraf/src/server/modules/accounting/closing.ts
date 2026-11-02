// Year-end closing (بستن حساب‌ها): close income/expense into «خلاصه سود و زیان», move the
// result to retained earnings, close permanent accounts against «تراز اختتامیه» and open them
// in the next fiscal year against «تراز افتتاحیه». Balances are carried per account, detail
// account and currency, including foreign-currency amounts and gold weights.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { D } from "@shared/money";
import { bad, conflict } from "../../http/errors";
import { accountByKey, saveVoucher, type VoucherLineInput } from "./vouchers";
import { addDays, toJalali, jalaliYearRange, toFa } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { insertRow } from "../../db/sql";

interface Bal {
  account_id: string;
  kind: string;
  detail_id: string | null;
  currency_id: string | null;
  bal: string;
  fx: string;
  w: string;
}

async function balances(tx: Tx, orgId: string, fyId: string, kinds: string[]): Promise<Bal[]> {
  return tx.query<Bal>(
    `select l.account_id, a.kind, l.detail_id, l.currency_id,
            sum(l.debit - l.credit) as bal, sum(l.fx_debit - l.fx_credit) as fx, sum(l.w_debit - l.w_credit) as w
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and v.fiscal_year_id = $2 and v.deleted_at is null and v.status in ('posted','final')
       and a.kind = any($3::text[])
     group by l.account_id, a.kind, l.detail_id, l.currency_id`,
    [orgId, fyId, `{${kinds.join(",")}}`],
  );
}

function closeLine(b: Bal, reverse: boolean, description: string): VoucherLineInput {
  // the closing line takes the balance off the account; the opening line puts it back
  const bal = D(b.bal);
  const fx = D(b.fx);
  const w = D(b.w);
  const sign = reverse ? 1 : -1; // closing: opposite side of the balance
  const amt = bal.times(sign);
  const fxa = fx.times(sign);
  const wa = w.times(sign);
  return {
    account_id: b.account_id,
    detail_id: b.detail_id,
    currency_id: b.currency_id,
    description,
    debit: amt.gt(0) ? amt.toString() : "0",
    credit: amt.lt(0) ? amt.abs().toString() : "0",
    fx_debit: fxa.gt(0) ? fxa.toString() : "0",
    fx_credit: fxa.lt(0) ? fxa.abs().toString() : "0",
    w_debit: wa.gt(0) ? wa.toString() : "0",
    w_credit: wa.lt(0) ? wa.abs().toString() : "0",
  };
}

const nonZero = (b: Bal) => !(D(b.bal).isZero() && D(b.fx).isZero() && D(b.w).isZero());

export async function closeFiscalYear(ctx: Ctx, fyId: string) {
  ctx.need("accounting", "full");
  return ctx.write(async (tx) => {
    const fy = await tx.one<{ id: string; title: string; start_date: string; end_date: string; status: string }>(
      `select id, title, start_date, end_date, status from tz_fiscal_years where id = $1 and org_id = $2 and deleted_at is null`,
      [fyId, ctx.org.id],
    );
    if (!fy) throw bad("سال مالی پیدا نشد");
    if (fy.status === "closed") throw conflict("این سال مالی قبلاً بسته شده است");
    const drafts = await tx.one<{ n: number }>(`select count(*)::int as n from tz_vouchers where org_id = $1 and fiscal_year_id = $2 and status = 'draft' and deleted_at is null`, [ctx.org.id, fyId]);
    if ((drafts?.n ?? 0) > 0) throw bad(`${toFa(drafts!.n)} سند پیش‌نویس در این سال هست؛ ابتدا آن‌ها را ثبت یا حذف کنید`);
    await tx.query(`update tz_fiscal_years set status = 'closing' where id = $1`, [fyId]);
    const org = { id: ctx.org.id, money_decimals: ctx.org.money_decimals };
    const opts = { userId: ctx.user.id, origin: ctx.cfg.origin, allowAuto: true, allowClosedYear: true };

    // 1) temporary accounts → P&L summary
    const temp = (await balances(tx, ctx.org.id, fyId, ["income", "expense"])).filter(nonZero);
    const pl = await accountByKey(tx, ctx.org.id, "pl_summary");
    let result = D(0);
    if (temp.length) {
      const lines = temp.map((b) => closeLine({ ...b, fx: "0", w: "0" }, false, "بستن حساب موقت"));
      const total = temp.reduce((a, b) => a.plus(D(b.bal)), D(0)); // debit-positive
      result = total.neg(); // income − expense
      lines.push({ account_id: pl, description: "خلاصه سود و زیان", debit: total.gt(0) ? total.toString() : "0", credit: total.lt(0) ? total.abs().toString() : "0" });
      await saveVoucher(tx, org, { date: fy.end_date, kind: "temp_closing", description: `بستن حساب‌های موقت ${fy.title}`, lines, source_type: "closing", source_id: fyId }, opts);
    }
    // 2) P&L summary → retained earnings
    if (!result.isZero()) {
      const re = await accountByKey(tx, ctx.org.id, "retained_earnings");
      const lines: VoucherLineInput[] = result.gt(0)
        ? [{ account_id: pl, debit: result.toString() }, { account_id: re, credit: result.toString(), description: "انتقال سود سال" }]
        : [{ account_id: re, debit: result.abs().toString(), description: "انتقال زیان سال" }, { account_id: pl, credit: result.abs().toString() }];
      await saveVoucher(tx, org, { date: fy.end_date, kind: "temp_closing", description: `انتقال نتیجه‌ی ${fy.title} به سود و زیان انباشته`, lines, source_type: "closing", source_id: fyId }, opts);
    }
    // 3) permanent accounts → closing balance
    const perm = (await balances(tx, ctx.org.id, fyId, ["asset", "liability", "equity", "memo"])).filter(nonZero);
    const closingAcc = await accountByKey(tx, ctx.org.id, "closing_balance");
    const openingAcc = await accountByKey(tx, ctx.org.id, "opening_balance");
    const permTotal = perm.reduce((a, b) => a.plus(D(b.bal)), D(0));
    if (perm.length) {
      const lines = perm.map((b) => closeLine(b, false, "سند اختتامیه"));
      if (!permTotal.isZero()) lines.push({ account_id: closingAcc, debit: permTotal.gt(0) ? permTotal.toString() : "0", credit: permTotal.lt(0) ? permTotal.abs().toString() : "0" });
      await saveVoucher(tx, org, { date: fy.end_date, kind: "closing", description: `سند اختتامیه ${fy.title}`, lines: dropEmpty(lines), source_type: "closing", source_id: fyId }, opts);
    }
    // 4) next fiscal year + opening voucher
    const nextStart = addDays(fy.end_date, 1);
    let next = await tx.one<{ id: string; title: string }>(
      `select id, title from tz_fiscal_years where org_id = $1 and deleted_at is null and start_date <= $2 and end_date >= $2`,
      [ctx.org.id, nextStart],
    );
    if (!next) {
      const jy = toJalali(nextStart).jy;
      const r = jalaliYearRange(jy);
      next = await insertRow(tx, "tz_fiscal_years", { id: uuidv7(), org_id: ctx.org.id, title: `سال مالی ${toFa(jy)}`, start_date: r.start, end_date: r.end, status: "open", origin: ctx.cfg.origin }, "id, title");
    }
    if (perm.length) {
      const lines = perm.map((b) => closeLine(b, true, "سند افتتاحیه"));
      if (!permTotal.isZero()) lines.push({ account_id: openingAcc, debit: permTotal.lt(0) ? permTotal.abs().toString() : "0", credit: permTotal.gt(0) ? permTotal.toString() : "0" });
      await saveVoucher(tx, org, { date: nextStart, kind: "opening", description: `سند افتتاحیه ${next!.title}`, lines: dropEmpty(lines), source_type: "opening", source_id: fyId }, opts);
    }
    await tx.query(`update tz_fiscal_years set status = 'closed', closed_at = now(), closed_by = $2 where id = $1`, [fyId, ctx.user.id]);
    return { ok: true, result: result.toString(), next_fiscal_year_id: next!.id };
  });
}

function dropEmpty(lines: VoucherLineInput[]): VoucherLineInput[] {
  return lines.filter((l) => [l.debit, l.credit, l.fx_debit, l.fx_credit, l.w_debit, l.w_credit].some((x) => !D(x).isZero()));
}

/** Undo a closing: remove its vouchers and reopen the year. */
export async function reopenFiscalYear(ctx: Ctx, fyId: string) {
  ctx.need("accounting", "full");
  return ctx.write(async (tx) => {
    const ids = await tx.query<{ id: string }>(
      `select id from tz_vouchers where org_id = $1 and source_id = $2 and source_type in ('closing','opening') and deleted_at is null`,
      [ctx.org.id, fyId],
    );
    for (const { id } of ids) {
      await tx.query(`delete from tz_voucher_lines where voucher_id = $1`, [id]);
      await tx.query(`update tz_vouchers set deleted_at = now(), total_debit = 0, total_credit = 0 where id = $1`, [id]);
    }
    await tx.query(`update tz_fiscal_years set status = 'open', closed_at = null, closed_by = null where id = $1 and org_id = $2`, [fyId, ctx.org.id]);
    return { ok: true, removed: ids.length };
  });
}
