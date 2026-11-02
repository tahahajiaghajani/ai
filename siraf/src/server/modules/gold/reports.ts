// Reports of the gold module: stock (pieces by category, weighed gold and coins from the ledger,
// valuation at today's price), weight balances of parties and workshops, consignment by
// supplier, sales by day / month / document / category / customer and the dashboard summary.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { D } from "@shared/money";
import { JALALI_MONTHS, jalaliMonthRange, todayISO, toJalali } from "@shared/jalali";
import { DOC_KINDS } from "./pricing";
import { latestRate, latestWithChange } from "./rates";
import { listCoins } from "./items";

const POSTED = "v.deleted_at is null and v.status in ('posted','final') and v.kind not in ('closing','temp_closing')";

function today(ctx: Ctx) {
  return todayISO((ctx.org.settings?.timezone as string) || "Asia/Tehran");
}

/** Fiscal year that contains `date` (else the latest one). Balances are read within it. */
async function fiscalYearOf(q: Queryable, orgId: string, date: string) {
  return (
    (await q.one<{ id: string; start_date: string }>(
      `select id, start_date from tz_fiscal_years where org_id = $1 and deleted_at is null and start_date <= $2 and end_date >= $2 order by start_date desc limit 1`,
      [orgId, date],
    )) ??
    (await q.one<{ id: string; start_date: string }>(`select id, start_date from tz_fiscal_years where org_id = $1 and deleted_at is null order by start_date desc limit 1`, [orgId]))
  );
}

export interface LedgerBalance {
  rial: string;
  w: string;
  qty: string;
}

/** Ledger balances (rial, 750-weight, coin count) of accounts by system key up to a date. */
export async function ledgerByKey(q: Queryable, orgId: string, keys: string[], to: string): Promise<Record<string, LedgerBalance>> {
  const fy = await fiscalYearOf(q, orgId, to);
  const out: Record<string, LedgerBalance> = Object.fromEntries(keys.map((k) => [k, { rial: "0", w: "0", qty: "0" }]));
  if (!fy) return out;
  const rows = await q.query<{ system_key: string; rial: string; w: string; qty: string }>(
    `select a.system_key, coalesce(sum(l.debit - l.credit), 0) as rial, coalesce(sum(l.w_debit - l.w_credit), 0) as w,
            coalesce(sum(case when l.credit > 0 then -coalesce(l.qty, 0) else coalesce(l.qty, 0) end), 0) as qty
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${POSTED} and v.fiscal_year_id = $2 and v.date <= $3 and a.system_key = any($4::text[])
     group by a.system_key`,
    [orgId, fy.id, to, `{${keys.join(",")}}`],
  );
  for (const r of rows) out[r.system_key] = { rial: D(r.rial).toString(), w: D(r.w).toString(), qty: D(r.qty).toString() };
  return out;
}

// ---------------------------------------------------------------- stock

export async function stockReport(ctx: Ctx, p: { to?: string | null }) {
  ctx.need("gold", "view");
  const to = p.to || today(ctx);
  const [cats, ledger, coins, rate] = await Promise.all([
    ctx.db.query<{ category_id: string | null; category_name: string | null; ownership: string; count: number; gross: string; net: string; stone: string; w750: string; cost: string; with_cost: number; reserved: number }>(
      `select i.category_id, c.name as category_name, i.ownership, count(*)::int as count,
              coalesce(sum(i.gross_weight), 0) as gross, coalesce(sum(i.net_weight), 0) as net, coalesce(sum(i.stone_weight), 0) as stone,
              coalesce(sum(round(i.net_weight * i.fineness / 750, 3)), 0) as w750, coalesce(sum(i.cost), 0) as cost,
              count(i.cost)::int as with_cost, count(*) filter (where i.status = 'reserved')::int as reserved
       from tz_gold_items i left join tz_gold_categories c on c.id = i.category_id
       where i.org_id = $1 and i.deleted_at is null and i.status in ('in_stock', 'reserved')
       group by i.category_id, c.name, i.ownership
       order by c.name nulls last, i.ownership`,
      [ctx.org.id],
    ),
    ledgerByKey(ctx.db, ctx.org.id, ["gold_inventory", "gold_old", "gold_bullion", "coin_inventory", "stone_inventory", "gold_at_workshop", "gold_parties", "gold_consign_memo"], to),
    listCoins(ctx.db, ctx.org.id, to),
    latestRate(ctx.db, ctx.org.id),
  ]);
  const g18 = D(rate?.gram18 ?? 0);
  const value = (w: string) => D(w).times(g18).toDecimalPlaces(ctx.org.money_decimals).toString();
  const categories = cats.map((c) => ({ ...c, value: value(c.w750) }));
  const sum = (own: string | null, f: (c: (typeof cats)[number]) => string | number) =>
    cats.filter((c) => !own || c.ownership === own).reduce((a, c) => a.plus(D(f(c))), D(0)).toString();
  const totals = {
    count: Number(sum(null, (c) => c.count)),
    gross: sum(null, (c) => c.gross),
    net: sum(null, (c) => c.net),
    stone: sum(null, (c) => c.stone),
    w750: sum(null, (c) => c.w750),
    own_count: Number(sum("own", (c) => c.count)),
    own_w750: sum("own", (c) => c.w750),
    consigned_count: Number(sum("consignment", (c) => c.count)),
    consigned_w750: sum("consignment", (c) => c.w750),
  };
  const coinRows = coins.map((c) => ({ ...c, market_value: c.price ? D(c.qty).times(D(c.price)).toString() : null }));
  const bulk = (["gold_inventory", "gold_old", "gold_bullion", "gold_at_workshop"] as const).map((k) => ({ key: k, ...ledger[k], value: value(ledger[k].w) }));
  const ownGoldW = D(ledger.gold_inventory.w).plus(D(ledger.gold_old.w)).plus(D(ledger.gold_bullion.w)).plus(D(ledger.gold_at_workshop.w));
  return {
    as_of: to,
    rate: rate ? { gram18: rate.gram18, mazaneh: rate.mazaneh, at: rate.at } : null,
    categories,
    totals: { ...totals, value: value(totals.own_w750) },
    ledger,
    bulk,
    coins: coinRows,
    valuation: {
      gold_w750: ownGoldW.toString(),
      gold_value: value(ownGoldW.toString()),
      gold_book: D(ledger.gold_inventory.rial).plus(D(ledger.gold_old.rial)).plus(D(ledger.gold_bullion.rial)).plus(D(ledger.gold_at_workshop.rial)).toString(),
      coins_value: coinRows.reduce((a, c) => a.plus(D(c.market_value ?? 0)), D(0)).toString(),
      coins_book: ledger.coin_inventory.rial,
      parties_w: ledger.gold_parties.w,
      consign_w: ledger.gold_consign_memo.w,
    },
    // pieces in the showcase against the weight of «موجودی مصنوعات» in the ledger
    check: {
      ledger_w: ledger.gold_inventory.w,
      pieces_w: totals.own_w750,
      diff: D(ledger.gold_inventory.w).minus(D(totals.own_w750)).toString(),
    },
  };
}

// ---------------------------------------------------------------- parties

export async function partyBalances(ctx: Ctx, p: { to?: string | null; scope?: string | null }) {
  ctx.need("gold", "view");
  const to = p.to || today(ctx);
  const fy = await fiscalYearOf(ctx.db, ctx.org.id, to);
  if (!fy) return { as_of: to, rows: [], totals: {} };
  const rows = await ctx.db.query<{ detail_id: string; code: string; name: string; party_id: string | null; system_key: string; rial: string; w: string; last_date: string }>(
    `select d.id as detail_id, coalesce(p.code, d.code) as code, coalesce(p.name, d.name) as name, d.ref_id as party_id, a.system_key,
            coalesce(sum(l.debit - l.credit), 0) as rial, coalesce(sum(l.w_debit - l.w_credit), 0) as w, max(v.date) as last_date
     from tz_voucher_lines l
     join tz_vouchers v on v.id = l.voucher_id
     join tz_accounts a on a.id = l.account_id
     join tz_details d on d.id = l.detail_id
     left join tz_parties p on p.id = d.ref_id
     where l.org_id = $1 and ${POSTED} and v.fiscal_year_id = $2 and v.date <= $3
       and a.system_key = any('{gold_parties,gold_at_workshop,gold_consign_memo,ar,ap}'::text[])
     group by d.id, p.code, d.code, p.name, d.name, d.ref_id, a.system_key`,
    [ctx.org.id, fy.id, to],
  );
  const consigned = await ctx.db.query<{ supplier_id: string; n: number; w750: string }>(
    `select supplier_id, count(*)::int as n, coalesce(sum(round(net_weight * fineness / 750, 3)), 0) as w750 from tz_gold_items
     where org_id = $1 and deleted_at is null and ownership = 'consignment' and status in ('in_stock', 'reserved') and supplier_id is not null
     group by supplier_id`,
    [ctx.org.id],
  );
  const byParty = new Map<string, Record<string, any>>();
  for (const r of rows) {
    const k = r.detail_id;
    const e = byParty.get(k) ?? {
      detail_id: r.detail_id, party_id: r.party_id, code: r.code, name: r.name, gold_w: "0", gold_rial: "0", workshop_w: "0", workshop_rial: "0",
      consign_w: "0", ar: "0", ap: "0", last_date: r.last_date, consigned_pieces: 0, consigned_w750: "0",
    };
    const w = D(r.w).toString();
    const rial = D(r.rial).toString();
    if (r.system_key === "gold_parties") Object.assign(e, { gold_w: w, gold_rial: rial });
    if (r.system_key === "gold_at_workshop") Object.assign(e, { workshop_w: w, workshop_rial: rial });
    if (r.system_key === "gold_consign_memo") e.consign_w = w;
    if (r.system_key === "ar") e.ar = rial;
    if (r.system_key === "ap") e.ap = rial;
    if (r.last_date > e.last_date) e.last_date = r.last_date;
    byParty.set(k, e);
  }
  const details = await ctx.db.query<{ id: string; ref_id: string }>(`select id, ref_id from tz_details where org_id = $1 and kind = 'person'`, [ctx.org.id]);
  const detailOf = new Map(details.map((d) => [d.ref_id, d.id]));
  for (const c of consigned) {
    const e = byParty.get(detailOf.get(c.supplier_id) ?? "");
    if (e) Object.assign(e, { consigned_pieces: c.n, consigned_w750: c.w750 });
  }
  const goldish = (e: Record<string, any>) => !D(e.gold_w).isZero() || !D(e.gold_rial).isZero() || !D(e.workshop_w).isZero() || !D(e.consign_w).isZero();
  let list = [...byParty.values()].filter(goldish);
  if (p.scope === "workshop") list = list.filter((e) => !D(e.workshop_w).isZero() || !D(e.workshop_rial).isZero());
  if (p.scope === "consignment") list = list.filter((e) => !D(e.consign_w).isZero());
  if (p.scope === "parties") list = list.filter((e) => !D(e.gold_w).isZero() || !D(e.gold_rial).isZero());
  list = list
    .map((e): Record<string, any> => ({ ...e, rial: D(e.ar).plus(D(e.ap)).toString() }))
    .sort((a, b) => String(a.code).length - String(b.code).length || String(a.code).localeCompare(String(b.code)));
  const tot = (f: string) => list.reduce((a, e) => a.plus(D(e[f])), D(0)).toString();
  return {
    as_of: to,
    rows: list,
    totals: { gold_w: tot("gold_w"), gold_rial: tot("gold_rial"), workshop_w: tot("workshop_w"), workshop_rial: tot("workshop_rial"), consign_w: tot("consign_w"), rial: tot("rial") },
  };
}

// ---------------------------------------------------------------- sales

const SALE_COLS = `
  count(distinct d.id)::int as docs,
  count(*) filter (where l.kind = 'piece' and l.direction = 'out')::int as pieces,
  coalesce(sum(l.weight) filter (where l.direction = 'out' and l.kind in ('piece', 'bulk')), 0) as weight,
  coalesce(sum(l.weight750) filter (where l.direction = 'out' and l.kind in ('piece', 'bulk')), 0) as weight750,
  coalesce(sum(l.gold_value) filter (where l.direction = 'out' and l.kind in ('piece', 'bulk')), 0) as gold_value,
  coalesce(sum(l.wage) filter (where l.direction = 'out'), 0) as wage,
  coalesce(sum(l.profit) filter (where l.direction = 'out'), 0) as profit,
  coalesce(sum(l.discount) filter (where l.direction = 'out'), 0) as discount,
  coalesce(sum(l.tax) filter (where l.direction = 'out'), 0) as tax,
  coalesce(sum(l.stone) filter (where l.direction = 'out'), 0) as stone,
  coalesce(sum(l.qty) filter (where l.kind = 'coin' and l.direction = 'out'), 0) as coin_qty,
  coalesce(sum(l.total) filter (where l.kind = 'coin' and l.direction = 'out'), 0) as coins,
  coalesce(sum(l.total) filter (where l.direction = 'out'), 0) as total,
  coalesce(sum(l.weight750) filter (where l.kind = 'old'), 0) as old_weight750,
  coalesce(sum(l.total) filter (where l.kind = 'old'), 0) as old_value,
  coalesce(sum(l.cost) filter (where l.direction = 'out'), 0) as cost`;

const NUM_FIELDS = ["weight", "weight750", "gold_value", "wage", "profit", "discount", "tax", "stone", "coin_qty", "coins", "total", "old_weight750", "old_value", "cost"] as const;

export async function salesReport(ctx: Ctx, p: { from?: string | null; to?: string | null; group?: string | null; kinds?: string | null }) {
  ctx.need("gold", "view");
  const t = today(ctx);
  const to = p.to || t;
  const tj = toJalali(to);
  const from = p.from || jalaliMonthRange(tj.jy, tj.jm).start;
  const kinds = (p.kinds || "sale").split(",").filter((k) => (DOC_KINDS as readonly string[]).includes(k));
  const group = ["day", "month", "doc", "category", "party"].includes(p.group ?? "") ? p.group! : "day";
  const params = [ctx.org.id, `{${(kinds.length ? kinds : ["sale"]).join(",")}}`, from, to];
  const base = `from tz_gold_docs d join tz_gold_lines l on l.doc_id = d.id
     where d.org_id = $1 and d.deleted_at is null and d.status = 'posted' and d.kind = any($2::text[]) and d.date between $3 and $4`;
  let rows: Record<string, any>[];
  if (group === "doc") {
    rows = await ctx.db.query(
      `select d.id as key, d.no, d.date, d.kind, coalesce(pa.name, d.buyer->>'name') as label, ${SALE_COLS}
       ${base.replace("join tz_gold_lines l on l.doc_id = d.id", "join tz_gold_lines l on l.doc_id = d.id left join tz_parties pa on pa.id = d.party_id")}
       group by d.id, d.no, d.date, d.kind, pa.name order by d.date, d.no`,
      params,
    );
  } else if (group === "category") {
    rows = await ctx.db.query(
      `select coalesce(c.id::text, l.kind) as key, coalesce(c.name, case l.kind when 'coin' then 'سکه' when 'bulk' then 'طلای وزنی' when 'old' then 'طلای مستعمل' else 'بدون دسته' end) as label, ${SALE_COLS}
       ${base.replace("join tz_gold_lines l on l.doc_id = d.id", "join tz_gold_lines l on l.doc_id = d.id left join tz_gold_categories c on c.id = l.category_id")}
       group by 1, 2 order by 2`,
      params,
    );
  } else if (group === "party") {
    rows = await ctx.db.query(
      `select coalesce(d.party_id::text, 'walkin') as key, coalesce(pa.name, 'مشتری گذری') as label, ${SALE_COLS}
       ${base.replace("join tz_gold_lines l on l.doc_id = d.id", "join tz_gold_lines l on l.doc_id = d.id left join tz_parties pa on pa.id = d.party_id")}
       group by 1, 2 order by sum(l.total) filter (where l.direction = 'out') desc nulls last`,
      params,
    );
  } else {
    rows = await ctx.db.query(`select d.date as key, d.date, ${SALE_COLS} ${base} group by d.date order by d.date`, params);
    if (group === "month") {
      const m = new Map<string, Record<string, any>>();
      for (const r of rows) {
        const j = toJalali(r.date);
        const key = `${j.jy}-${String(j.jm).padStart(2, "0")}`;
        const e = m.get(key) ?? { key, label: `${JALALI_MONTHS[j.jm - 1]} ${j.jy}`, date: r.date, docs: 0, pieces: 0, ...Object.fromEntries(NUM_FIELDS.map((f) => [f, "0"])) };
        e.docs += r.docs;
        e.pieces += r.pieces;
        for (const f of NUM_FIELDS) e[f] = D(e[f]).plus(D(r[f])).toString();
        m.set(key, e);
      }
      rows = [...m.values()];
    }
  }
  const withMargin = rows.map((r): Record<string, any> => ({ ...r, margin: D(r.total).minus(D(r.tax)).minus(D(r.cost)).toString() }));
  const totals: Record<string, any> = { docs: 0, pieces: 0 };
  // documents may span several groups (categories): count them once
  const docCount = await ctx.db.one<{ n: number }>(`select count(*)::int as n from tz_gold_docs d where d.org_id = $1 and d.deleted_at is null and d.status = 'posted' and d.kind = any($2::text[]) and d.date between $3 and $4`, params);
  totals.docs = docCount?.n ?? 0;
  totals.pieces = withMargin.reduce((a, r) => a + Number(r.pieces), 0);
  for (const f of [...NUM_FIELDS, "margin"]) totals[f] = withMargin.reduce((a, r) => a.plus(D(r[f])), D(0)).toString();
  return { from, to, group, kinds, rows: withMargin, totals };
}

// ---------------------------------------------------------------- consignment

export async function consignmentReport(ctx: Ctx) {
  ctx.need("gold", "view");
  const suppliers = await ctx.db.query(
    `select i.supplier_id, p.name as supplier_name, p.code as supplier_code, count(*)::int as pieces,
            coalesce(sum(i.net_weight), 0) as net, coalesce(sum(round(i.net_weight * i.fineness / 750, 3)), 0) as w750
     from tz_gold_items i left join tz_parties p on p.id = i.supplier_id
     where i.org_id = $1 and i.deleted_at is null and i.ownership = 'consignment' and i.status in ('in_stock', 'reserved')
     group by i.supplier_id, p.name, p.code order by p.name nulls last`,
    [ctx.org.id],
  );
  const sold = await ctx.db.query(
    `select i.supplier_id, count(*)::int as pieces, coalesce(sum(round(i.net_weight * i.fineness / 750, 3)), 0) as w750
     from tz_gold_items i where i.org_id = $1 and i.deleted_at is null and i.ownership = 'consignment' and i.status = 'sold'
     group by i.supplier_id`,
    [ctx.org.id],
  );
  return { suppliers, sold };
}

// ---------------------------------------------------------------- dashboard

export async function summary(ctx: Ctx) {
  ctx.need("gold", "view");
  const t = today(ctx);
  const j = toJalali(t);
  const monthStart = jalaliMonthRange(j.jy, j.jm).start;
  const [rate, stock, ledger, day, month] = await Promise.all([
    latestWithChange(ctx.db, ctx.org.id),
    ctx.db.one<{ pieces: number; net: string; w750: string; consigned: number }>(
      `select count(*)::int as pieces, coalesce(sum(net_weight), 0) as net, coalesce(sum(round(net_weight * fineness / 750, 3)), 0) as w750,
              count(*) filter (where ownership = 'consignment')::int as consigned
       from tz_gold_items where org_id = $1 and deleted_at is null and status in ('in_stock', 'reserved')`,
      [ctx.org.id],
    ),
    ledgerByKey(ctx.db, ctx.org.id, ["gold_old", "gold_bullion", "gold_at_workshop", "gold_parties"], t),
    salesTotals(ctx.db, ctx.org.id, t, t),
    salesTotals(ctx.db, ctx.org.id, monthStart, t),
  ]);
  return { today: t, rate, stock, ledger, sales_today: day, sales_month: month };
}

async function salesTotals(q: Queryable, orgId: string, from: string, to: string) {
  return q.one<{ count: number; weight750: string; total: string; old_weight750: string; old_value: string }>(
    `select count(*)::int as count, coalesce(sum(weight_out), 0) as weight750, coalesce(sum(total), 0) as total,
            coalesce(sum(weight_in), 0) as old_weight750, coalesce(sum(old_value), 0) as old_value
     from tz_gold_docs where org_id = $1 and deleted_at is null and status = 'posted' and kind = 'sale' and date between $2 and $3`,
    [orgId, from, to],
  );
}
