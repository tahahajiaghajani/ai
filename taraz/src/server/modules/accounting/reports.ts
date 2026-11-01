// Accounting reports straight from voucher lines: trial balance (2/4/6/8 columns), ledgers,
// journal, detail balances, party statement, income statement and balance sheet.
import type { Queryable } from "../../db";
import { D } from "@shared/money";

export interface ReportRange {
  from?: string | null;
  to?: string | null;
  fiscalYearId?: string | null;
  includeDrafts?: boolean;
}

function statusCond(includeDrafts?: boolean) {
  return includeDrafts ? "v.status <> 'void'" : "v.status in ('posted','final')";
}

interface AccountNode {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: number;
  kind: string;
  nature: string;
  is_postable: boolean;
  system_key: string | null;
  fx_mode: string;
  weight_mode: string;
}

export async function accountTree(q: Queryable, orgId: string): Promise<AccountNode[]> {
  return q.query<AccountNode>(
    `select id, parent_id, code, name, level, kind, nature, is_postable, system_key, fx_mode, weight_mode
     from tz_accounts where org_id = $1 and deleted_at is null order by code`,
    [orgId],
  );
}

interface Sums {
  op_dr: string;
  op_cr: string;
  dr: string;
  cr: string;
  w_op: string;
  w_dr: string;
  w_cr: string;
}

/** Sums per account: opening (before `from`, same fiscal year) and the period. */
async function sumsByAccount(q: Queryable, orgId: string, r: ReportRange, extra = "", extraParams: unknown[] = []) {
  const params: unknown[] = [orgId, r.from ?? "0001-01-01", r.to ?? "9999-12-31"];
  let fy = "";
  if (r.fiscalYearId) {
    params.push(r.fiscalYearId);
    fy = `and v.fiscal_year_id = $${params.length}`;
  }
  params.push(...extraParams);
  return q.query<Sums & { account_id: string }>(
    `select l.account_id,
            coalesce(sum(case when v.date < $2 then l.debit end), 0) as op_dr,
            coalesce(sum(case when v.date < $2 then l.credit end), 0) as op_cr,
            coalesce(sum(case when v.date >= $2 then l.debit end), 0) as dr,
            coalesce(sum(case when v.date >= $2 then l.credit end), 0) as cr,
            coalesce(sum(case when v.date < $2 then l.w_debit - l.w_credit end), 0) as w_op,
            coalesce(sum(case when v.date >= $2 then l.w_debit end), 0) as w_dr,
            coalesce(sum(case when v.date >= $2 then l.w_credit end), 0) as w_cr
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id
     where l.org_id = $1 and v.deleted_at is null and ${statusCond(r.includeDrafts)} and v.date <= $3 ${fy} ${extra}
     group by l.account_id`,
    params,
  );
}

export interface TrialRow {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: number;
  kind: string;
  opening: string; // signed (debit +)
  debit: string;
  credit: string;
  balance: string; // signed closing
  w_opening: string;
  w_debit: string;
  w_credit: string;
  w_balance: string;
  has_children: boolean;
}

export async function trialBalance(q: Queryable, orgId: string, r: ReportRange & { level?: number; nonZero?: boolean }) {
  const [tree, sums] = await Promise.all([accountTree(q, orgId), sumsByAccount(q, orgId, r)]);
  const byId = new Map(tree.map((a) => [a.id, a]));
  const agg = new Map<string, { op: ReturnType<typeof D>; dr: ReturnType<typeof D>; cr: ReturnType<typeof D>; wop: ReturnType<typeof D>; wdr: ReturnType<typeof D>; wcr: ReturnType<typeof D> }>();
  const zero = () => ({ op: D(0), dr: D(0), cr: D(0), wop: D(0), wdr: D(0), wcr: D(0) });
  for (const s of sums) {
    let node = byId.get(s.account_id);
    while (node) {
      const a = agg.get(node.id) ?? zero();
      a.op = a.op.plus(D(s.op_dr)).minus(D(s.op_cr));
      a.dr = a.dr.plus(D(s.dr));
      a.cr = a.cr.plus(D(s.cr));
      a.wop = a.wop.plus(D(s.w_op));
      a.wdr = a.wdr.plus(D(s.w_dr));
      a.wcr = a.wcr.plus(D(s.w_cr));
      agg.set(node.id, a);
      node = node.parent_id ? byId.get(node.parent_id) : undefined;
    }
  }
  const children = new Set(tree.map((a) => a.parent_id).filter(Boolean) as string[]);
  const level = r.level ?? 3;
  const rows: TrialRow[] = tree
    .filter((a) => a.level <= level)
    .map((a) => {
      const s = agg.get(a.id) ?? zero();
      const bal = s.op.plus(s.dr).minus(s.cr);
      return {
        id: a.id, parent_id: a.parent_id, code: a.code, name: a.name, level: a.level, kind: a.kind,
        opening: s.op.toString(), debit: s.dr.toString(), credit: s.cr.toString(), balance: bal.toString(),
        w_opening: s.wop.toString(), w_debit: s.wdr.toString(), w_credit: s.wcr.toString(), w_balance: s.wop.plus(s.wdr).minus(s.wcr).toString(),
        has_children: children.has(a.id),
      };
    })
    .filter((row) => !r.nonZero || !(D(row.opening).isZero() && D(row.debit).isZero() && D(row.credit).isZero() && D(row.w_balance).isZero()));
  const top = rows.filter((x) => x.level === 1);
  const totals = {
    opening_dr: top.reduce((a, x) => (D(x.opening).gt(0) ? a.plus(D(x.opening)) : a), D(0)).toString(),
    opening_cr: top.reduce((a, x) => (D(x.opening).lt(0) ? a.minus(D(x.opening)) : a), D(0)).toString(),
    debit: top.reduce((a, x) => a.plus(D(x.debit)), D(0)).toString(),
    credit: top.reduce((a, x) => a.plus(D(x.credit)), D(0)).toString(),
    balance_dr: top.reduce((a, x) => (D(x.balance).gt(0) ? a.plus(D(x.balance)) : a), D(0)).toString(),
    balance_cr: top.reduce((a, x) => (D(x.balance).lt(0) ? a.minus(D(x.balance)) : a), D(0)).toString(),
  };
  return { rows, totals };
}

/** Descendant ids of an account (including itself). */
async function subtree(q: Queryable, orgId: string, accountId: string): Promise<string[]> {
  const tree = await accountTree(q, orgId);
  const kids = new Map<string, string[]>();
  for (const a of tree) if (a.parent_id) kids.set(a.parent_id, [...(kids.get(a.parent_id) ?? []), a.id]);
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const k of kids.get(id) ?? []) walk(k);
  };
  walk(accountId);
  return out;
}

export interface LedgerParams extends ReportRange {
  accountId?: string | null;
  detailId?: string | null;
  currencyId?: string | null;
}

/** Ledger (دفتر حساب) of an account subtree and/or a detail account with running balances. */
export async function ledger(q: Queryable, orgId: string, p: LedgerParams) {
  const params: unknown[] = [orgId];
  const cond: string[] = ["l.org_id = $1", "v.deleted_at is null", statusCond(p.includeDrafts)];
  if (p.accountId) {
    const ids = await subtree(q, orgId, p.accountId);
    params.push(`{${ids.join(",")}}`);
    cond.push(`l.account_id = any($${params.length}::uuid[])`);
  }
  if (p.detailId) {
    params.push(p.detailId);
    cond.push(`(l.detail_id = $${params.length} or l.detail2_id = $${params.length})`);
  }
  if (p.currencyId) {
    params.push(p.currencyId);
    cond.push(`l.currency_id = $${params.length}`);
  }
  if (p.fiscalYearId) {
    params.push(p.fiscalYearId);
    cond.push(`v.fiscal_year_id = $${params.length}`);
  }
  const from = p.from ?? "0001-01-01";
  const to = p.to ?? "9999-12-31";
  params.push(from);
  const fromIdx = params.length;
  params.push(to);
  const toIdx = params.length;
  const opening = await q.one<{ dr: string; cr: string; fx: string; w: string }>(
    `select coalesce(sum(l.debit),0) as dr, coalesce(sum(l.credit),0) as cr, coalesce(sum(l.fx_debit - l.fx_credit),0) as fx, coalesce(sum(l.w_debit - l.w_credit),0) as w
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id
     where ${cond.join(" and ")} and v.date < $${fromIdx}`,
    params.slice(0, toIdx - 1),
  );
  const rows = await q.query(
    `select v.id as voucher_id, v.no, v.date, v.kind, v.source_type, v.source_id, coalesce(l.description, v.description) as description,
            l.debit, l.credit, l.fx_debit, l.fx_credit, l.fx_rate, l.w_debit, l.w_credit, l.line_no,
            a.code as account_code, a.name as account_name, d.code as detail_code, d.name as detail_name, c.code as currency_code
     from tz_voucher_lines l
     join tz_vouchers v on v.id = l.voucher_id
     join tz_accounts a on a.id = l.account_id
     left join tz_details d on d.id = l.detail_id
     left join tz_currencies c on c.id = l.currency_id
     where ${cond.join(" and ")} and v.date >= $${fromIdx} and v.date <= $${toIdx}
     order by v.date, v.no, l.line_no
     limit 20000`,
    params,
  );
  let bal = D(opening?.dr ?? 0).minus(D(opening?.cr ?? 0));
  let fx = D(opening?.fx ?? 0);
  let w = D(opening?.w ?? 0);
  let tdr = D(0);
  let tcr = D(0);
  const out = rows.map((r) => {
    bal = bal.plus(D(r.debit)).minus(D(r.credit));
    fx = fx.plus(D(r.fx_debit)).minus(D(r.fx_credit));
    w = w.plus(D(r.w_debit)).minus(D(r.w_credit));
    tdr = tdr.plus(D(r.debit));
    tcr = tcr.plus(D(r.credit));
    return { ...r, balance: bal.toString(), fx_balance: fx.toString(), w_balance: w.toString() };
  });
  return {
    opening: D(opening?.dr ?? 0).minus(D(opening?.cr ?? 0)).toString(),
    opening_fx: opening?.fx ?? "0",
    opening_w: opening?.w ?? "0",
    rows: out,
    totals: { debit: tdr.toString(), credit: tcr.toString(), balance: bal.toString(), fx_balance: fx.toString(), w_balance: w.toString() },
  };
}

/** Balances per detail account (e.g. every customer under «حساب‌های دریافتنی»). */
export async function detailBalances(q: Queryable, orgId: string, p: ReportRange & { accountId?: string | null; kind?: string | null; currencyId?: string | null }) {
  const params: unknown[] = [orgId, p.to ?? "9999-12-31"];
  const cond = ["l.org_id = $1", "v.deleted_at is null", statusCond(p.includeDrafts), "v.date <= $2", "l.detail_id is not null"];
  if (p.accountId) {
    const ids = await subtree(q, orgId, p.accountId);
    params.push(`{${ids.join(",")}}`);
    cond.push(`l.account_id = any($${params.length}::uuid[])`);
  }
  if (p.kind) {
    params.push(p.kind);
    cond.push(`d.kind = $${params.length}`);
  }
  if (p.currencyId) {
    params.push(p.currencyId);
    cond.push(`l.currency_id = $${params.length}`);
  }
  if (p.fiscalYearId) {
    params.push(p.fiscalYearId);
    cond.push(`v.fiscal_year_id = $${params.length}`);
  }
  return q.query(
    `select d.id as detail_id, d.code, d.name, d.kind, d.ref_id, l.currency_id, c.code as currency_code,
            sum(l.debit) as debit, sum(l.credit) as credit, sum(l.debit - l.credit) as balance,
            sum(l.fx_debit - l.fx_credit) as fx_balance, sum(l.w_debit - l.w_credit) as w_balance,
            max(v.date) as last_date
     from tz_voucher_lines l
     join tz_vouchers v on v.id = l.voucher_id
     join tz_details d on d.id = l.detail_id
     left join tz_currencies c on c.id = l.currency_id
     where ${cond.join(" and ")}
     group by d.id, d.code, d.name, d.kind, d.ref_id, l.currency_id, c.code
     order by d.code`,
    params,
  );
}

/** Journal (دفتر روزنامه): vouchers with their lines in date order. */
export async function journal(q: Queryable, orgId: string, p: ReportRange) {
  const params: unknown[] = [orgId, p.from ?? "0001-01-01", p.to ?? "9999-12-31"];
  let fy = "";
  if (p.fiscalYearId) {
    params.push(p.fiscalYearId);
    fy = `and v.fiscal_year_id = $${params.length}`;
  }
  return q.query(
    `select v.id as voucher_id, v.no, v.date, v.description as voucher_description, l.line_no,
            a.code as account_code, a.name as account_name, d.name as detail_name, l.description, l.debit, l.credit
     from tz_vouchers v join tz_voucher_lines l on l.voucher_id = v.id
     join tz_accounts a on a.id = l.account_id left join tz_details d on d.id = l.detail_id
     where v.org_id = $1 and v.deleted_at is null and ${statusCond(p.includeDrafts)} and v.date between $2 and $3 ${fy}
     order by v.date, v.no, l.line_no limit 50000`,
    params,
  );
}

/** Income statement (صورت سود و زیان) for a period. */
export async function incomeStatement(q: Queryable, orgId: string, p: ReportRange) {
  const { rows } = await trialBalance(q, orgId, { ...p, level: 3 });
  const pick = (kind: string) =>
    rows.filter((r) => r.kind === kind && r.level === 3 && !(D(r.debit).isZero() && D(r.credit).isZero()))
      .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: (kind === "income" ? D(r.credit).minus(D(r.debit)) : D(r.debit).minus(D(r.credit))).toString() }));
  const income = pick("income");
  const expense = pick("expense");
  const ti = income.reduce((a, x) => a.plus(D(x.amount)), D(0));
  const te = expense.reduce((a, x) => a.plus(D(x.amount)), D(0));
  return { income, expense, total_income: ti.toString(), total_expense: te.toString(), net: ti.minus(te).toString() };
}

/** Balance sheet (ترازنامه) at a date: assets = liabilities + equity (+ current result). */
export async function balanceSheet(q: Queryable, orgId: string, p: ReportRange) {
  const { rows } = await trialBalance(q, orgId, { ...p, from: null, level: 3 });
  const side = (kind: string, sign: 1 | -1) =>
    rows.filter((r) => r.kind === kind && r.level === 3 && !D(r.balance).isZero())
      .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: D(r.balance).times(sign).toString() }));
  const assets = side("asset", 1);
  const liabilities = side("liability", -1);
  const equity = side("equity", -1);
  const result = rows.filter((r) => (r.kind === "income" || r.kind === "expense") && r.level === 3).reduce((a, r) => a.minus(D(r.balance)), D(0));
  const ta = assets.reduce((a, x) => a.plus(D(x.amount)), D(0));
  const tl = liabilities.reduce((a, x) => a.plus(D(x.amount)), D(0));
  const tq = equity.reduce((a, x) => a.plus(D(x.amount)), D(0)).plus(result);
  return {
    assets, liabilities, equity, current_result: result.toString(),
    total_assets: ta.toString(), total_liabilities: tl.toString(), total_equity: tq.toString(),
    balanced: ta.eq(tl.plus(tq)),
  };
}

/** Statement of a party across all accounts (rial, currencies and gold weight). */
export async function partyStatement(q: Queryable, orgId: string, detailId: string, p: ReportRange) {
  return ledger(q, orgId, { ...p, detailId });
}
