// Exchange reports: currency positions with realized/unrealized profit, the daily cash report
// per cash box and currency, deals and profit by period and currency, correspondent balances,
// and the figures of the dashboard widget.
import type { Ctx } from "../../context";
import { D } from "@shared/money";
import { isUuid } from "@shared/id";
import { jalaliMonthRange, toJalali, todayISO } from "@shared/jalali";
import { currencyBook, latestRates, LIVE, orgTz, POSITION_KEYS, rateMid, roundTo, type Currency } from "./common";

type Dec = ReturnType<typeof D>;
const s = (d: Dec) => d.toFixed();

async function fiscalRange(ctx: Ctx, date: string) {
  const fy = await ctx.db.one<{ start_date: string; end_date: string }>(
    `select start_date, end_date from tz_fiscal_years where org_id = $1 and deleted_at is null and start_date <= $2 and end_date >= $2`,
    [ctx.org.id, date],
  );
  return { from: fy?.start_date ?? `${date.slice(0, 4)}-01-01`, to: fy?.end_date ?? date };
}

// ---------------------------------------------------------------- positions

export async function positions(ctx: Ctx, p: { date?: string | null; from?: string | null; to?: string | null }) {
  ctx.need("fx", "view");
  ctx.need("reports", "view");
  const tz = orgTz(ctx.org);
  const date = p.date || todayISO(tz);
  const dp = ctx.org.money_decimals ?? 0;
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const rates = await latestRates(ctx.db, ctx.org.id, { date, tz });
  const keys = [...POSITION_KEYS, "fx_parties", "correspondents", "remittances_payable"];
  const rows = await ctx.db.query<{ currency_id: string; system_key: string; detail_id: string | null; detail_name: string | null; fx: string; base: string }>(
    `select l.currency_id, a.system_key, l.detail_id, d.name as detail_name,
            sum(l.fx_debit - l.fx_credit) as fx, sum(l.debit - l.credit) as base
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     left join tz_details d on d.id = l.detail_id
     where l.org_id = $1 and ${LIVE} and v.date <= $2 and a.system_key = any($3::text[]) and l.currency_id is not null
     group by l.currency_id, a.system_key, l.detail_id, d.name`,
    [ctx.org.id, date, `{${keys.join(",")}}`],
  );
  const out = cur.list
    .filter((c) => !c.is_base)
    .map((c) => {
      const mine = rows.filter((r) => r.currency_id === c.id);
      const pos = mine.filter((r) => POSITION_KEYS.includes(r.system_key));
      const holdings = pos.reduce((a, r) => a.plus(D(r.fx)), D(0));
      const book = pos.reduce((a, r) => a.plus(D(r.base)), D(0));
      const market = rateMid(rates.get(c.id));
      const marketValue = market ? D(roundTo(holdings.times(D(market)), dp)) : null;
      const sumFx = (key: string, sign = 1) => mine.filter((r) => r.system_key === key).reduce((a, r) => a.plus(D(r.fx).times(sign)), D(0));
      const customersNet = sumFx("fx_parties");
      const corrNet = sumFx("correspondents").plus(sumFx("remittances_payable"));
      return {
        currency_id: c.id,
        code: c.code,
        name: c.name,
        kind: c.kind,
        decimals: c.decimals,
        holdings: s(holdings),
        book_value: s(book),
        avg_cost: holdings.gt(0) && book.gt(0) ? s(book.div(holdings).toDecimalPlaces(8)) : null,
        market_rate: market,
        rate_at: rates.get(c.id)?.at ?? null,
        market_value: marketValue ? s(marketValue) : null,
        unrealized: marketValue ? s(marketValue.minus(book)) : null,
        customers_net: s(customersNet),
        correspondents_net: s(corrNet),
        exposure: s(holdings.plus(customersNet).plus(corrNet)),
        legs: pos
          .filter((r) => !D(r.fx).isZero() || !D(r.base).isZero())
          .map((r) => ({ key: r.system_key, detail_id: r.detail_id, name: r.detail_name, fx: r.fx, base: r.base }))
          .sort((a, b) => D(b.fx).cmp(D(a.fx))),
      };
    })
    .filter((r) => !D(r.holdings).isZero() || !D(r.book_value).isZero() || !D(r.customers_net).isZero() || !D(r.correspondents_net).isZero());

  const range = p.from || p.to ? { from: p.from || "0001-01-01", to: p.to || date } : await fiscalRange(ctx, date);
  const realized = await ctx.db.one<{ n: number; profit: string; fees: string; volume: string }>(
    `select count(*)::int as n, coalesce(sum(profit), 0) as profit, coalesce(sum(fee_base), 0) as fees, coalesce(sum(base_value), 0) as volume
     from tz_fx_deals where org_id = $1 and deleted_at is null and status = 'posted' and date between $2 and $3`,
    [ctx.org.id, range.from, range.to],
  );
  const reval = await ctx.db.one<{ amount: string }>(
    `select coalesce(sum(l.credit - l.debit), 0) as amount
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${LIVE} and a.system_key = 'fx_revaluation' and v.date between $2 and $3`,
    [ctx.org.id, range.from, range.to],
  );
  const total = (k: "book_value" | "market_value" | "unrealized") => s(out.reduce((a, r) => a.plus(D(r[k] ?? 0)), D(0)));
  return {
    date,
    base: { id: cur.base.id, code: cur.base.code, decimals: cur.base.decimals },
    rows: out,
    totals: { book_value: total("book_value"), market_value: total("market_value"), unrealized: total("unrealized"), missing_rates: out.filter((r) => !r.market_rate && !D(r.holdings).isZero()).map((r) => r.code) },
    realized: { from: range.from, to: range.to, deals: realized?.n ?? 0, profit: realized?.profit ?? "0", fees: realized?.fees ?? "0", volume: realized?.volume ?? "0", revaluation: reval?.amount ?? "0" },
  };
}

// ---------------------------------------------------------------- daily cash report

export async function cashReport(ctx: Ctx, p: { date?: string | null; cash_box_id?: string | null }) {
  ctx.need("fx", "view");
  const tz = orgTz(ctx.org);
  const date = p.date || todayISO(tz);
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const boxes = await ctx.db.query<{ id: string; code: string; name: string; detail_id: string | null; currency_id: string | null; is_active: boolean }>(
    `select id, code, name, detail_id, currency_id, is_active from tz_cash_boxes where org_id = $1 and deleted_at is null order by length(code), code`,
    [ctx.org.id],
  );
  const box = p.cash_box_id && isUuid(p.cash_box_id) ? boxes.find((b) => b.id === p.cash_box_id) : null;
  const params: unknown[] = [ctx.org.id, date, cur.base.id];
  let boxCond = "";
  if (box?.detail_id) {
    params.push(box.detail_id);
    boxCond = `and l.detail_id = $4`;
  }
  const rows = await ctx.db.query<{ detail_id: string; system_key: string; currency_id: string; opening: string; inflow: string; outflow: string; book_value: string; moves: number }>(
    `select l.detail_id, a.system_key, coalesce(l.currency_id, $3::uuid) as currency_id,
            coalesce(sum(case when v.date < $2 then (case when a.system_key = 'cash' then l.debit - l.credit else l.fx_debit - l.fx_credit end) end), 0) as opening,
            coalesce(sum(case when v.date = $2 then (case when a.system_key = 'cash' then l.debit else l.fx_debit end) end), 0) as inflow,
            coalesce(sum(case when v.date = $2 then (case when a.system_key = 'cash' then l.credit else l.fx_credit end) end), 0) as outflow,
            coalesce(sum(l.debit - l.credit), 0) as book_value,
            count(distinct case when v.date = $2 then v.id end)::int as moves
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${LIVE} and v.date <= $2 and a.system_key in ('cash', 'fx_cash') and l.detail_id is not null ${boxCond}
     group by 1, 2, 3`,
    params,
  );
  const byDetail = new Map(boxes.filter((b) => b.detail_id).map((b) => [b.detail_id!, b]));
  const lines = rows
    .map((r) => {
      const c = cur.byId.get(r.currency_id) ?? cur.base;
      const b = byDetail.get(r.detail_id);
      const closing = D(r.opening).plus(D(r.inflow)).minus(D(r.outflow));
      return {
        cash_box_id: b?.id ?? null,
        cash_box: b?.name ?? "—",
        currency_id: c.id,
        code: c.code,
        name: c.name,
        decimals: c.decimals,
        is_base: c.is_base,
        opening: r.opening,
        inflow: r.inflow,
        outflow: r.outflow,
        closing: s(closing),
        book_value: r.book_value,
        moves: Number(r.moves) || 0,
      };
    })
    .filter((r) => !(D(r.opening).isZero() && D(r.inflow).isZero() && D(r.outflow).isZero()))
    .sort((a, b) => (a.cash_box === b.cash_box ? (a.is_base ? -1 : b.is_base ? 1 : a.code.localeCompare(b.code)) : a.cash_box.localeCompare(b.cash_box, "fa")));

  // totals per currency over the boxes shown
  const totals = new Map<string, { currency_id: string; code: string; decimals: number; opening: Dec; inflow: Dec; outflow: Dec; closing: Dec; book_value: Dec }>();
  for (const l of lines) {
    const t = totals.get(l.currency_id) ?? { currency_id: l.currency_id, code: l.code, decimals: l.decimals, opening: D(0), inflow: D(0), outflow: D(0), closing: D(0), book_value: D(0) };
    t.opening = t.opening.plus(D(l.opening));
    t.inflow = t.inflow.plus(D(l.inflow));
    t.outflow = t.outflow.plus(D(l.outflow));
    t.closing = t.closing.plus(D(l.closing));
    t.book_value = t.book_value.plus(D(l.book_value));
    totals.set(l.currency_id, t);
  }

  // movements of the day for one box (for counting the till)
  let moves: unknown[] = [];
  if (box?.detail_id) {
    moves = await ctx.db.query(
      `select v.id as voucher_id, v.no, v.source_type, v.source_id, coalesce(l.description, v.description) as description,
              coalesce(l.currency_id, $3::uuid) as currency_id, c.code,
              case when a.system_key = 'cash' then l.debit else l.fx_debit end as inflow,
              case when a.system_key = 'cash' then l.credit else l.fx_credit end as outflow
       from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
       left join tz_currencies c on c.id = coalesce(l.currency_id, $3::uuid)
       where l.org_id = $1 and ${LIVE} and v.date = $2 and a.system_key in ('cash', 'fx_cash') and l.detail_id = $4
       order by v.no, l.line_no limit 2000`,
      [ctx.org.id, date, cur.base.id, box.detail_id],
    );
  }
  const deals = await ctx.db.query<{ kind: string; n: number; volume: string; profit: string; fees: string }>(
    `select kind, count(*)::int as n, coalesce(sum(base_value), 0) as volume, coalesce(sum(profit), 0) as profit, coalesce(sum(fee_base), 0) as fees
     from tz_fx_deals where org_id = $1 and deleted_at is null and status = 'posted' and date = $2 ${box ? "and (in_method = 'cash' and in_ref_id = $3 or out_method = 'cash' and out_ref_id = $3)" : ""}
     group by kind`,
    box ? [ctx.org.id, date, box.id] : [ctx.org.id, date],
  );
  return {
    date,
    cash_box: box ? { id: box.id, name: box.name } : null,
    boxes: boxes.map((b) => ({ id: b.id, name: b.name, is_active: b.is_active })),
    rows: lines,
    totals: [...totals.values()].map((t) => ({ currency_id: t.currency_id, code: t.code, decimals: t.decimals, opening: s(t.opening), inflow: s(t.inflow), outflow: s(t.outflow), closing: s(t.closing), book_value: s(t.book_value) })),
    moves,
    deals: deals.map((d) => ({ ...d, n: Number(d.n) })),
    value_total: s([...totals.values()].reduce((a, t) => a.plus(t.book_value), D(0))),
  };
}

// ---------------------------------------------------------------- deals and profit

interface DealRow {
  date: string;
  kind: string;
  in_currency_id: string;
  in_amount: string;
  out_currency_id: string;
  out_amount: string;
  base_value: string;
  cost_value: string;
  profit: string;
  fee_base: string | null;
}

export async function dealsReport(ctx: Ctx, p: { from?: string | null; to?: string | null; currency_id?: string | null }) {
  ctx.need("fx", "view");
  ctx.need("reports", "view");
  const tz = orgTz(ctx.org);
  const today = todayISO(tz);
  const range = p.from || p.to ? { from: p.from || "0001-01-01", to: p.to || today } : await fiscalRange(ctx, today);
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const params: unknown[] = [ctx.org.id, range.from, range.to];
  let cc = "";
  if (p.currency_id && isUuid(p.currency_id)) {
    params.push(p.currency_id);
    cc = "and (in_currency_id = $4 or out_currency_id = $4)";
  }
  const rows = await ctx.db.query<DealRow>(
    `select date, kind, in_currency_id, in_amount, out_currency_id, out_amount, base_value, cost_value, profit, fee_base
     from tz_fx_deals where org_id = $1 and deleted_at is null and status = 'posted' and date between $2 and $3 ${cc}
     order by date limit 100000`,
    params,
  );
  type Agg = { buy_count: number; bought: Dec; bought_base: Dec; sell_count: number; sold: Dec; sold_base: Dec; cost: Dec; profit: Dec; ex_in: Dec; ex_in_base: Dec; ex_out: Dec; ex_out_cost: Dec; fees: Dec };
  const zero = (): Agg => ({ buy_count: 0, bought: D(0), bought_base: D(0), sell_count: 0, sold: D(0), sold_base: D(0), cost: D(0), profit: D(0), ex_in: D(0), ex_in_base: D(0), ex_out: D(0), ex_out_cost: D(0), fees: D(0) });
  const byCur = new Map<string, Agg>();
  const at = (id: string) => {
    const a = byCur.get(id) ?? zero();
    byCur.set(id, a);
    return a;
  };
  const byDay = new Map<string, { date: string; count: number; volume: Dec; profit: Dec; fees: Dec }>();
  const byKind = new Map<string, { kind: string; count: number; volume: Dec; profit: Dec; fees: Dec }>();
  for (const r of rows) {
    const fee = D(r.fee_base ?? 0);
    if (r.kind === "buy") {
      const a = at(r.in_currency_id);
      a.buy_count += 1;
      a.bought = a.bought.plus(D(r.in_amount));
      a.bought_base = a.bought_base.plus(D(r.base_value));
      a.fees = a.fees.plus(fee);
    } else if (r.kind === "sell") {
      const a = at(r.out_currency_id);
      a.sell_count += 1;
      a.sold = a.sold.plus(D(r.out_amount));
      a.sold_base = a.sold_base.plus(D(r.base_value));
      a.cost = a.cost.plus(D(r.cost_value));
      a.profit = a.profit.plus(D(r.profit));
      a.fees = a.fees.plus(fee);
    } else {
      const ai = at(r.in_currency_id);
      ai.ex_in = ai.ex_in.plus(D(r.in_amount));
      ai.ex_in_base = ai.ex_in_base.plus(D(r.base_value));
      const ao = at(r.out_currency_id);
      ao.ex_out = ao.ex_out.plus(D(r.out_amount));
      ao.ex_out_cost = ao.ex_out_cost.plus(D(r.cost_value));
      ao.profit = ao.profit.plus(D(r.profit));
      ao.fees = ao.fees.plus(fee);
    }
    const d = byDay.get(r.date) ?? { date: r.date, count: 0, volume: D(0), profit: D(0), fees: D(0) };
    d.count += 1;
    d.volume = d.volume.plus(D(r.base_value));
    d.profit = d.profit.plus(D(r.profit));
    d.fees = d.fees.plus(fee);
    byDay.set(r.date, d);
    const k = byKind.get(r.kind) ?? { kind: r.kind, count: 0, volume: D(0), profit: D(0), fees: D(0) };
    k.count += 1;
    k.volume = k.volume.plus(D(r.base_value));
    k.profit = k.profit.plus(D(r.profit));
    k.fees = k.fees.plus(fee);
    byKind.set(r.kind, k);
  }
  const by_currency = [...byCur.entries()]
    .map(([id, a]) => {
      const c: Currency = cur.byId.get(id) ?? cur.base;
      return {
        currency_id: id,
        code: c.code,
        name: c.name,
        decimals: c.decimals,
        buy_count: a.buy_count,
        bought: s(a.bought),
        bought_base: s(a.bought_base),
        avg_buy: a.bought.gt(0) ? s(a.bought_base.div(a.bought).toDecimalPlaces(6)) : null,
        sell_count: a.sell_count,
        sold: s(a.sold),
        sold_base: s(a.sold_base),
        avg_sell: a.sold.gt(0) ? s(a.sold_base.div(a.sold).toDecimalPlaces(6)) : null,
        cost: s(a.cost),
        exchange_in: s(a.ex_in),
        exchange_out: s(a.ex_out),
        profit: s(a.profit),
        fees: s(a.fees),
      };
    })
    .sort((a, b) => D(b.bought_base).plus(D(b.sold_base)).cmp(D(a.bought_base).plus(D(a.sold_base))));
  const total = { count: rows.length, volume: D(0), profit: D(0), fees: D(0) };
  for (const d of byDay.values()) {
    total.volume = total.volume.plus(d.volume);
    total.profit = total.profit.plus(d.profit);
    total.fees = total.fees.plus(d.fees);
  }
  return {
    from: range.from,
    to: range.to,
    by_currency,
    by_day: [...byDay.values()].map((d) => ({ date: d.date, count: d.count, volume: s(d.volume), profit: s(d.profit), fees: s(d.fees) })),
    by_kind: [...byKind.values()].map((k) => ({ kind: k.kind, count: k.count, volume: s(k.volume), profit: s(k.profit), fees: s(k.fees) })),
    totals: { count: total.count, volume: s(total.volume), profit: s(total.profit), fees: s(total.fees), income: s(total.profit.plus(total.fees)) },
  };
}

// ---------------------------------------------------------------- correspondents

export async function correspondentBalances(ctx: Ctx, p: { date?: string | null }) {
  ctx.need("fx", "view");
  const date = p.date || todayISO(orgTz(ctx.org));
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const parties = await ctx.db.query<{ id: string; code: string; name: string; mobile: string | null; detail_id: string | null }>(
    `select id, code, name, mobile, detail_id from tz_parties where org_id = $1 and deleted_at is null and roles @> '["correspondent"]'::jsonb order by name`,
    [ctx.org.id],
  );
  const rows = await ctx.db.query<{ detail_id: string; system_key: string; currency_id: string | null; fx: string; base: string }>(
    `select l.detail_id, a.system_key, l.currency_id, sum(l.fx_debit - l.fx_credit) as fx, sum(l.debit - l.credit) as base
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${LIVE} and v.date <= $2 and a.system_key in ('correspondents', 'remittances_payable') and l.detail_id is not null
     group by l.detail_id, a.system_key, l.currency_id`,
    [ctx.org.id, date],
  );
  const open = await ctx.db.query<{ correspondent_id: string; direction: string; status: string; n: number }>(
    `select correspondent_id, direction, status, count(*)::int as n from tz_remittances
     where org_id = $1 and deleted_at is null and status in ('pending', 'sent') group by correspondent_id, direction, status`,
    [ctx.org.id],
  );
  const list = parties.map((pt) => {
    const mine = rows.filter((r) => r.detail_id === pt.detail_id);
    const per = new Map<string, { account: Dec; account_base: Dec; payable: Dec; payable_base: Dec }>();
    for (const r of mine) {
      const c = r.currency_id && cur.byId.has(r.currency_id) ? cur.byId.get(r.currency_id)! : cur.base;
      const fx = c.is_base ? D(r.base) : D(r.fx);
      const e = per.get(c.id) ?? { account: D(0), account_base: D(0), payable: D(0), payable_base: D(0) };
      if (r.system_key === "correspondents") {
        e.account = e.account.plus(fx);
        e.account_base = e.account_base.plus(D(r.base));
      } else {
        e.payable = e.payable.plus(fx.neg());
        e.payable_base = e.payable_base.plus(D(r.base).neg());
      }
      per.set(c.id, e);
    }
    const currencies = [...per.entries()]
      .map(([id, e]) => {
        const c = cur.byId.get(id)!;
        return {
          currency_id: id,
          code: c.code,
          decimals: c.decimals,
          // + they owe us, − we owe them
          balance: s(e.account),
          balance_base: s(e.account_base),
          // outgoing remittances registered but not yet paid through them
          in_transit: s(e.payable),
          in_transit_base: s(e.payable_base),
          net: s(e.account.minus(e.payable)),
        };
      })
      .filter((x) => !D(x.balance).isZero() || !D(x.in_transit).isZero());
    const count = (direction: string, status: string) => open.find((o) => o.correspondent_id === pt.id && o.direction === direction && o.status === status)?.n ?? 0;
    return {
      party_id: pt.id,
      code: pt.code,
      name: pt.name,
      mobile: pt.mobile,
      currencies,
      open: { out_pending: count("out", "pending"), out_sent: count("out", "sent"), in_pending: count("in", "pending") },
    };
  });
  return { date, rows: list };
}

// ---------------------------------------------------------------- dashboard

export async function summary(ctx: Ctx) {
  ctx.need("fx", "view");
  const tz = orgTz(ctx.org);
  const today = todayISO(tz);
  const t = toJalali(today);
  const month = jalaliMonthRange(t.jy, t.jm);
  const cur = await currencyBook(ctx.db, ctx.org.id);
  const showProfit = ctx.can("reports", "view");
  const agg = async (from: string, to: string) => {
    const r = await ctx.db.one<{ n: number; volume: string; profit: string; fees: string }>(
      `select count(*)::int as n, coalesce(sum(base_value), 0) as volume, coalesce(sum(profit), 0) as profit, coalesce(sum(fee_base), 0) as fees
       from tz_fx_deals where org_id = $1 and deleted_at is null and status = 'posted' and date between $2 and $3`,
      [ctx.org.id, from, to],
    );
    return { count: r?.n ?? 0, volume: r?.volume ?? "0", profit: showProfit ? r?.profit ?? "0" : null, fees: showProfit ? r?.fees ?? "0" : null };
  };
  const rem = await ctx.db.one<{ out_open: number; in_open: number }>(
    `select count(*) filter (where direction = 'out' and status in ('pending','sent'))::int as out_open,
            count(*) filter (where direction = 'in' and status = 'pending')::int as in_open
     from tz_remittances where org_id = $1 and deleted_at is null`,
    [ctx.org.id],
  );
  const rates = await latestRates(ctx.db, ctx.org.id);
  const codes = ["USD", "EUR", "AED", "USDT", "BTC", "ETH"];
  const board = codes
    .map((code) => cur.byCode.get(code))
    .filter((c): c is Currency => !!c && !c.is_base)
    .map((c) => {
      const r = rates.get(c.id);
      return { currency_id: c.id, code: c.code, name: c.name, kind: c.kind, buy: r?.buy ?? null, sell: r?.sell ?? null, mid: rateMid(r), at: r?.at ?? null };
    });
  const wallets = await ctx.db.one<{ n: number; errors: number; last: string | null }>(
    `select count(*)::int as n, count(*) filter (where last_error is not null)::int as errors, max(last_checked_at) as last
     from tz_wallets where org_id = $1 and deleted_at is null`,
    [ctx.org.id],
  );
  return {
    today,
    base: { code: cur.base.code, decimals: cur.base.decimals },
    day: await agg(today, today),
    month: await agg(month.start, month.end),
    remittances: { out_open: rem?.out_open ?? 0, in_open: rem?.in_open ?? 0 },
    board,
    wallets: { count: wallets?.n ?? 0, errors: wallets?.errors ?? 0, last_checked_at: wallets?.last ?? null },
  };
}
