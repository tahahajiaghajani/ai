// Core dashboard figures straight from the ledger: cash and bank, receivables and payables,
// income and expenses of this month and year, and a six-month trend.
import type { Ctx } from "../context";
import { D } from "@shared/money";
import { jalaliMonthRange, toJalali, todayISO, JALALI_MONTHS } from "@shared/jalali";

export async function dashboard(ctx: Ctx) {
  const tz = (ctx.org.settings?.timezone as string) || "Asia/Tehran";
  const today = todayISO(tz);
  const t = toJalali(today);
  const month = jalaliMonthRange(t.jy, t.jm);
  const fy = await ctx.db.one<{ id: string; start_date: string; end_date: string }>(
    `select id, start_date, end_date from tz_fiscal_years where org_id = $1 and deleted_at is null and start_date <= $2 and end_date >= $2`,
    [ctx.org.id, today],
  );
  const posted = "v.status in ('posted','final') and v.deleted_at is null";
  const byKey = await ctx.db.query<{ system_key: string; bal: string }>(
    `select a.system_key, coalesce(sum(l.debit - l.credit), 0) as bal
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${posted} and a.system_key = any($2::text[]) ${fy ? "and v.fiscal_year_id = $3" : ""}
     group by a.system_key`,
    fy ? [ctx.org.id, "{cash,bank,ar,ap,cheques_receivable,cheques_payable,fx_cash,crypto_wallets,petty_cash}", fy.id] : [ctx.org.id, "{cash,bank,ar,ap,cheques_receivable,cheques_payable,fx_cash,crypto_wallets,petty_cash}"],
  );
  const k = (key: string) => D(byKey.find((r) => r.system_key === key)?.bal ?? 0);
  const pl = await ctx.db.query<{ kind: string; m: string; y: string }>(
    `select a.kind,
            coalesce(sum(case when v.date between $2 and $3 then l.credit - l.debit end), 0) as m,
            coalesce(sum(l.credit - l.debit), 0) as y
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${posted} and a.kind in ('income','expense') and v.kind not in ('temp_closing','closing') ${fy ? "and v.fiscal_year_id = $4" : ""}
     group by a.kind`,
    fy ? [ctx.org.id, month.start, month.end, fy.id] : [ctx.org.id, month.start, month.end],
  );
  const inc = pl.find((r) => r.kind === "income");
  const exp = pl.find((r) => r.kind === "expense");

  // last six Jalali months
  const months: { label: string; start: string; end: string }[] = [];
  let jy = t.jy;
  let jm = t.jm;
  for (let i = 0; i < 6; i++) {
    const r = jalaliMonthRange(jy, jm);
    months.unshift({ label: JALALI_MONTHS[jm - 1], start: r.start, end: r.end });
    jm -= 1;
    if (jm < 1) {
      jm = 12;
      jy -= 1;
    }
  }
  const trendRows = await ctx.db.query<{ kind: string; d: string; amount: string }>(
    `select a.kind, v.date as d, sum(l.credit - l.debit) as amount
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${posted} and a.kind in ('income','expense') and v.kind not in ('temp_closing','closing') and v.date between $2 and $3
     group by a.kind, v.date`,
    [ctx.org.id, months[0].start, months[5].end],
  );
  const trend = months.map((m) => {
    const rows = trendRows.filter((r) => r.d >= m.start && r.d <= m.end);
    const income = rows.filter((r) => r.kind === "income").reduce((a, r) => a.plus(D(r.amount)), D(0));
    const expense = rows.filter((r) => r.kind === "expense").reduce((a, r) => a.minus(D(r.amount)), D(0));
    return { month: m.label, income: income.toString(), expense: expense.toString(), profit: income.minus(expense).toString() };
  });

  const boxes = await ctx.db.query<{ name: string; kind: string; bal: string }>(
    `select d.name, d.kind, sum(l.debit - l.credit) as bal
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id join tz_details d on d.id = l.detail_id
     where l.org_id = $1 and ${posted} and a.system_key in ('cash','bank') ${fy ? "and v.fiscal_year_id = $2" : ""}
     group by d.name, d.kind order by d.kind, d.name`,
    fy ? [ctx.org.id, fy.id] : [ctx.org.id],
  );
  const cheques = await ctx.db.query(
    `select id, direction, amount, due_date, status, serial_no, sayad_no, bank_name,
            (select name from tz_parties p where p.id = c.party_id) as party_name
     from tz_cheques c where org_id = $1 and deleted_at is null and status in ('in_hand','deposited','issued')
       and due_date <= ($2::date + 14) order by due_date limit 8`,
    [ctx.org.id, today],
  );
  const recent = await ctx.db.query(
    `select id, no, date, description, total_debit, kind, source_type from tz_vouchers where org_id = $1 and deleted_at is null order by created_at desc limit 6`,
    [ctx.org.id],
  );
  return {
    today,
    totals: {
      cash: k("cash").plus(k("petty_cash")).toString(),
      bank: k("bank").toString(),
      receivable: k("ar").toString(),
      payable: k("ap").neg().toString(),
      cheques_receivable: k("cheques_receivable").toString(),
      cheques_payable: k("cheques_payable").neg().toString(),
      income_month: D(inc?.m ?? 0).toString(),
      expense_month: D(exp?.m ?? 0).neg().toString(),
      income_year: D(inc?.y ?? 0).toString(),
      expense_year: D(exp?.y ?? 0).neg().toString(),
    },
    trend,
    boxes,
    cheques,
    recent,
  };
}
