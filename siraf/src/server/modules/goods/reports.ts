// Inventory and commerce reports: stock balance (item × warehouse, low stock), kardex (moves of
// an item with running quantity and value), sales and purchase analysis (by item, party,
// category or month, with cost and gross profit) and the dashboard summary.
import type { Ctx } from "../../context";
import { likeContains, pgArray } from "../../db";
import { bad } from "../../http/errors";
import { D, normalizeDigits } from "@shared/money";
import { isUuid } from "@shared/id";
import { JALALI_MONTHS, jalaliMonthRange, toJalali, todayISO } from "@shared/jalali";
import { INVOICE_LABEL, MOVE_ORDER, STOCK_DOC_LABEL, moneyDp, orgTimezone, type InvoiceKind, type StockDocKind } from "./common";

type Dec = ReturnType<typeof D>;

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------------------------------------------------------------- stock balance

export interface StockRow {
  key: string;
  item_id: string;
  code: string;
  name: string;
  barcode: string | null;
  category_id: string | null;
  category_name: string | null;
  unit_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  qty: string;
  value: string;
  avg_cost: string | null;
  min_stock: string | null;
  reorder_point: string | null;
  max_stock: string | null;
  sale_price: string | null;
  low: boolean;
  is_active: boolean;
}

export async function stockReport(ctx: Ctx, q: Record<string, string | undefined>) {
  ctx.need("inventory", "view");
  const dp = moneyDp(ctx);
  const asOf = isDate(q.date) ? q.date : "9999-12-31";
  const params: unknown[] = [ctx.org.id, asOf];
  let whCond = "";
  if (q.warehouse_id && isUuid(q.warehouse_id)) {
    params.push(q.warehouse_id);
    whCond = `and warehouse_id = $${params.length}`;
  }
  const cond = ["i.org_id = $1", "i.deleted_at is null", "i.kind = 'goods'"];
  if (q.category_id && isUuid(q.category_id)) {
    params.push(q.category_id);
    cond.push(`i.category_id = $${params.length}`);
  }
  if (q.item_id && isUuid(q.item_id)) {
    params.push(q.item_id);
    cond.push(`i.id = $${params.length}`);
  }
  if (q.q?.trim()) {
    params.push(likeContains(normalizeDigits(q.q.trim())));
    cond.push(`(i.name ilike $${params.length} or i.code ilike $${params.length} or i.barcode ilike $${params.length})`);
  }
  // inactive items still count while they hold stock (rows without stock are hidden below)
  const rows = await ctx.db.query<Record<string, any>>(
    `with mv as (
       select item_id, warehouse_id, sum(qty) as qty, sum(value) as value
       from tz_stock_moves where org_id = $1 and date <= $2 ${whCond}
       group by item_id, warehouse_id
     )
     select i.id as item_id, i.code, i.name, i.barcode, i.category_id, c.name as category_name, u.name as unit_name,
            i.min_stock, i.reorder_point, i.max_stock, i.sale_price, i.is_active,
            mv.warehouse_id, w.name as warehouse_name, w.code as warehouse_code, coalesce(mv.qty, 0) as qty, coalesce(mv.value, 0) as value
     from tz_items i
     left join mv on mv.item_id = i.id
     left join tz_warehouses w on w.id = mv.warehouse_id
     left join tz_item_categories c on c.id = i.category_id
     left join tz_units u on u.id = i.unit_id
     where ${cond.join(" and ")}
     order by length(i.code), i.code, length(w.code), w.code`,
    params,
  );
  const byWarehouse = q.by === "warehouse";
  const map = new Map<string, StockRow>();
  for (const r of rows) {
    const key = byWarehouse ? `${r.item_id}|${r.warehouse_id ?? ""}` : r.item_id;
    const cur = map.get(key);
    if (cur) {
      cur.qty = D(cur.qty).plus(D(r.qty)).toString();
      cur.value = D(cur.value).plus(D(r.value)).toString();
      continue;
    }
    map.set(key, {
      key,
      item_id: r.item_id,
      code: r.code,
      name: r.name,
      barcode: r.barcode,
      category_id: r.category_id,
      category_name: r.category_name,
      unit_name: r.unit_name,
      warehouse_id: byWarehouse ? r.warehouse_id : null,
      warehouse_name: byWarehouse ? r.warehouse_name : null,
      qty: D(r.qty).toString(),
      value: D(r.value).toString(),
      avg_cost: null,
      min_stock: r.min_stock,
      reorder_point: r.reorder_point,
      max_stock: r.max_stock,
      sale_price: r.sale_price,
      low: false,
      is_active: r.is_active,
    });
  }
  const lowOnly = q.low === "1";
  const showZero = q.zero === "1" || lowOnly;
  const out: StockRow[] = [];
  let value = D(0);
  let lowCount = 0;
  for (const r of map.values()) {
    const qty = D(r.qty);
    r.avg_cost = qty.gt(0) ? D(r.value).div(qty).toDecimalPlaces(dp).toString() : null;
    const threshold = r.reorder_point ?? r.min_stock;
    r.low = r.is_active && threshold !== null && qty.lte(D(threshold));
    if (r.low && (!byWarehouse || r.warehouse_id)) lowCount++;
    if (byWarehouse && !r.warehouse_id) continue; // items without moves have no warehouse row
    if (lowOnly && !r.low) continue;
    if (!showZero && qty.isZero() && D(r.value).isZero()) continue;
    value = value.plus(D(r.value));
    out.push(r);
  }
  return { rows: out, totals: { value: value.toString(), items: out.length, low: lowCount }, as_of: isDate(q.date) ? q.date : null };
}

// ---------------------------------------------------------------- kardex

export async function kardex(ctx: Ctx, q: Record<string, string | undefined>) {
  ctx.need("inventory", "view");
  if (!q.item_id || !isUuid(q.item_id)) throw bad("کالا را انتخاب کنید");
  const dp = moneyDp(ctx);
  const item = await ctx.db.one<Record<string, any>>(
    `select i.id, i.code, i.name, i.kind, u.name as unit_name from tz_items i left join tz_units u on u.id = i.unit_id
     where i.id = $1 and i.org_id = $2 and i.deleted_at is null`,
    [q.item_id, ctx.org.id],
  );
  if (!item) throw bad("کالا پیدا نشد");
  const from = isDate(q.from) ? q.from : "0001-01-01";
  const to = isDate(q.to) ? q.to : "9999-12-31";
  const whId = q.warehouse_id && isUuid(q.warehouse_id) ? q.warehouse_id : null;
  const opening = await ctx.db.one<{ q: string; v: string }>(
    `select coalesce(sum(m.qty), 0) as q, coalesce(sum(m.value), 0) as v from tz_stock_moves m
     where m.org_id = $1 and m.item_id = $2 and m.date < $3 ${whId ? "and m.warehouse_id = $4" : ""}`,
    whId ? [ctx.org.id, item.id, from, whId] : [ctx.org.id, item.id, from],
  );
  const params: unknown[] = whId ? [ctx.org.id, item.id, from, to, whId] : [ctx.org.id, item.id, from, to];
  const wh = whId ? "and m.warehouse_id = $5" : "";
  const rows = await ctx.db.query<Record<string, any>>(
    `select m.id, m.date, m.qty, m.unit_cost, m.value, m.fixed_cost, m.warehouse_id, w.name as warehouse_name,
            m.source_type, m.source_id, m.batch_no, m.serial_no,
            i.kind as invoice_kind, i.no as invoice_no, d.kind as doc_kind, d.no as doc_no, d.description as doc_description,
            coalesce(p.name, dp.name) as party_name
     from tz_stock_moves m
     left join tz_invoices i on m.source_type = 'invoice' and i.id = m.source_id
     left join tz_stock_docs d on m.source_type = 'stock_doc' and d.id = m.source_id
     left join tz_parties p on p.id = i.party_id
     left join tz_parties dp on dp.id = d.party_id
     left join tz_warehouses w on w.id = m.warehouse_id
     where m.org_id = $1 and m.item_id = $2 and m.date >= $3 and m.date <= $4 ${wh}
     order by ${MOVE_ORDER}
     limit 20000`,
    params,
  );
  let qty = D(opening?.q ?? 0);
  let value = D(opening?.v ?? 0);
  let inQ = D(0);
  let outQ = D(0);
  let inV = D(0);
  let outV = D(0);
  const out = rows.map((r) => {
    const mq = D(r.qty);
    const mv = D(r.value);
    qty = qty.plus(mq);
    value = value.plus(mv);
    if (mq.gt(0)) {
      inQ = inQ.plus(mq);
      inV = inV.plus(mv);
    } else {
      outQ = outQ.plus(mq.abs());
      outV = outV.plus(mv.abs());
    }
    const doc = r.source_type === "invoice"
      ? { title: INVOICE_LABEL[r.invoice_kind as InvoiceKind] ?? "فاکتور", no: r.invoice_no }
      : r.source_type === "stock_doc"
        ? { title: STOCK_DOC_LABEL[r.doc_kind as StockDocKind] ?? "سند انبار", no: r.doc_no }
        : { title: r.source_type === "gold_doc" ? "سند طلا" : r.source_type, no: null };
    return {
      id: r.id,
      date: r.date,
      source_type: r.source_type,
      source_id: r.source_id,
      doc_kind: r.invoice_kind ?? r.doc_kind,
      doc_title: doc.title,
      doc_no: doc.no,
      party_name: r.party_name,
      description: r.doc_description,
      warehouse_name: r.warehouse_name,
      in_qty: mq.gt(0) ? mq.toString() : "0",
      out_qty: mq.lt(0) ? mq.abs().toString() : "0",
      unit_cost: r.unit_cost,
      in_value: mq.gt(0) ? mv.toString() : "0",
      out_value: mq.lt(0) ? mv.abs().toString() : "0",
      balance_qty: qty.toString(),
      balance_value: value.toString(),
      avg_cost: qty.gt(0) ? value.div(qty).toDecimalPlaces(dp).toString() : null,
      batch_no: r.batch_no,
      serial_no: r.serial_no,
    };
  });
  return {
    item,
    opening: { qty: D(opening?.q ?? 0).toString(), value: D(opening?.v ?? 0).toString() },
    rows: out,
    totals: { in_qty: inQ.toString(), out_qty: outQ.toString(), in_value: inV.toString(), out_value: outV.toString(), qty: qty.toString(), value: value.toString() },
  };
}

// ---------------------------------------------------------------- sales / purchase analysis

export type AnalysisGroup = "item" | "party" | "category" | "month" | "day";

interface AnalysisRow {
  key: string;
  label: string;
  code: string | null;
  qty: Dec;
  amount: Dec;
  tax: Dec;
  cost: Dec;
  invoices: Set<string>;
}

/**
 * Sales: net sales (after every discount and the invoice deductions, without VAT), cost of goods
 * sold from the stock moves and gross profit; returns count negative.
 * Purchases: landed cost of the lines (with additions/deductions) and VAT.
 */
export async function analysis(ctx: Ctx, side: "sales" | "purchases", q: Record<string, string | undefined>) {
  ctx.need("reports", "view");
  const dp = moneyDp(ctx);
  const group = (["item", "party", "category", "month", "day"].includes(q.group ?? "") ? q.group : "item") as AnalysisGroup;
  const kinds = side === "sales" ? ["sale", "sale_return"] : ["purchase", "purchase_return"];
  const from = isDate(q.from) ? q.from : "0001-01-01";
  const to = isDate(q.to) ? q.to : "9999-12-31";
  const params: unknown[] = [ctx.org.id, pgArray(kinds), from, to];
  const cond = ["inv.org_id = $1", "inv.deleted_at is null", "inv.status = 'posted'", "inv.kind = any($2::text[])", "inv.date >= $3", "inv.date <= $4"];
  if (q.party_id && isUuid(q.party_id)) {
    params.push(q.party_id);
    cond.push(`inv.party_id = $${params.length}`);
  }
  if (q.item_id && isUuid(q.item_id)) {
    params.push(q.item_id);
    cond.push(`l.item_id = $${params.length}`);
  }
  if (q.category_id && isUuid(q.category_id)) {
    params.push(q.category_id);
    cond.push(`it.category_id = $${params.length}`);
  }
  if (q.warehouse_id && isUuid(q.warehouse_id)) {
    params.push(q.warehouse_id);
    cond.push(`coalesce(l.warehouse_id, inv.warehouse_id) = $${params.length}`);
  }
  const rows = await ctx.db.query<Record<string, any>>(
    `select l.id, inv.id as invoice_id, inv.kind, inv.date, inv.party_id, p.code as party_code, p.name as party_name,
            l.item_id, it.code as item_code, it.name as item_name, it.kind as item_kind, it.category_id, c.name as category_name,
            l.qty * l.unit_factor as base_qty, l.total - l.vat as net, l.vat, l.cost,
            inv.deductions, inv.subtotal - inv.line_discount - inv.discount as inv_net,
            coalesce(mv.v, 0) as move_value
     from tz_invoice_lines l
     join tz_invoices inv on inv.id = l.invoice_id
     left join tz_items it on it.id = l.item_id
     left join tz_item_categories c on c.id = it.category_id
     left join tz_parties p on p.id = inv.party_id
     left join (select source_line_id, sum(value) as v from tz_stock_moves
                where org_id = $1 and source_type = 'invoice' and date >= $3 and date <= $4 group by source_line_id) mv on mv.source_line_id = l.id
     where ${cond.join(" and ")}
     limit 200000`,
    params,
  );
  const groups = new Map<string, AnalysisRow>();
  const total = { qty: D(0), amount: D(0), tax: D(0), cost: D(0), invoices: new Set<string>() };
  for (const r of rows) {
    const sign = r.kind === "sale_return" || r.kind === "purchase_return" ? -1 : 1;
    let amount: Dec;
    let cost: Dec;
    if (side === "sales") {
      const net = D(r.net);
      const share = D(r.inv_net).isZero() ? D(0) : D(r.deductions).times(net).div(D(r.inv_net));
      amount = net.minus(share).times(sign);
      cost = D(r.move_value).neg(); // sale moves are negative (cost +), return moves positive (cost −)
    } else {
      amount = D(r.cost ?? r.net).times(sign);
      cost = D(0);
    }
    const qty = D(r.base_qty).times(sign);
    const tax = D(r.vat).times(sign);
    let key: string;
    let label: string;
    let code: string | null = null;
    switch (group) {
      case "party":
        key = r.party_id ?? "-";
        label = r.party_name ?? "—";
        code = r.party_code;
        break;
      case "category":
        key = r.category_id ?? "-";
        label = r.category_name ?? "بدون گروه";
        break;
      case "month": {
        const j = toJalali(r.date);
        key = `${j.jy}-${String(j.jm).padStart(2, "0")}`;
        label = `${JALALI_MONTHS[j.jm - 1]} ${j.jy}`;
        break;
      }
      case "day":
        key = r.date;
        label = r.date;
        break;
      default:
        key = r.item_id ?? "-";
        label = r.item_name ?? "—";
        code = r.item_code;
    }
    const g = groups.get(key) ?? { key, label, code, qty: D(0), amount: D(0), tax: D(0), cost: D(0), invoices: new Set<string>() };
    g.qty = g.qty.plus(qty);
    g.amount = g.amount.plus(amount);
    g.tax = g.tax.plus(tax);
    g.cost = g.cost.plus(cost);
    g.invoices.add(r.invoice_id);
    groups.set(key, g);
    total.qty = total.qty.plus(qty);
    total.amount = total.amount.plus(amount);
    total.tax = total.tax.plus(tax);
    total.cost = total.cost.plus(cost);
    total.invoices.add(r.invoice_id);
  }
  const fmt = (g: { qty: Dec; amount: Dec; tax: Dec; cost: Dec; invoices: Set<string> }) => {
    const amount = g.amount.toDecimalPlaces(dp);
    const profit = amount.minus(g.cost);
    return {
      qty: g.qty.toString(),
      amount: amount.toString(),
      tax: g.tax.toString(),
      cost: g.cost.toString(),
      profit: side === "sales" ? profit.toString() : null,
      margin_pct: side === "sales" && !amount.isZero() ? profit.div(amount).times(100).toDecimalPlaces(2).toString() : null,
      invoices: g.invoices.size,
    };
  };
  const list = Array.from(groups.values()).map((g) => ({ key: g.key, label: g.label, code: g.code, ...fmt(g) }));
  if (group === "month" || group === "day") list.sort((a, b) => a.key.localeCompare(b.key));
  else list.sort((a, b) => D(b.amount).cmp(D(a.amount)));
  return { group, rows: list, totals: fmt(total) };
}

// ---------------------------------------------------------------- dashboard

export async function goodsSummary(ctx: Ctx) {
  ctx.need("sales", "view");
  const today = todayISO(orgTimezone(ctx));
  const j = toJalali(today);
  const month = jalaliMonthRange(j.jy, j.jm);
  const sums = await ctx.db.one<Record<string, string | number>>(
    `select
       coalesce(sum(case when kind = 'sale' and date = $2 then total when kind = 'sale_return' and date = $2 then -total end), 0) as today_sales,
       count(*) filter (where kind = 'sale' and date = $2)::int as today_count,
       coalesce(sum(case when kind = 'sale' and date >= $3 then total when kind = 'sale_return' and date >= $3 then -total end), 0) as month_sales,
       count(*) filter (where kind = 'sale' and date >= $3)::int as month_count,
       coalesce(sum(case when kind = 'purchase' and date >= $3 then total when kind = 'purchase_return' and date >= $3 then -total end), 0) as month_purchases
     from tz_invoices
     where org_id = $1 and deleted_at is null and status = 'posted' and date >= $3 and date <= $4`,
    [ctx.org.id, today, month.start, month.end],
  );
  const canReports = ctx.can("reports", "view");
  const sales = canReports ? await analysis(ctx, "sales", { group: "item", from: month.start, to: month.end }) : null;
  const low = ctx.can("inventory", "view") ? (await stockReport(ctx, { low: "1" })).totals.low : null;
  const openQuotes = await ctx.db.one<{ n: number }>(
    `select count(*)::int as n from tz_invoices where org_id = $1 and deleted_at is null and kind in ('quote', 'sale_order') and status = 'draft' and not (extra ? 'converted_to')`,
    [ctx.org.id],
  );
  return {
    today,
    month: { start: month.start, end: month.end, title: `${JALALI_MONTHS[j.jm - 1]} ${j.jy}` },
    today_sales: D(sums?.today_sales ?? 0).toString(),
    today_count: Number(sums?.today_count ?? 0),
    month_sales: D(sums?.month_sales ?? 0).toString(),
    month_count: Number(sums?.month_count ?? 0),
    month_purchases: D(sums?.month_purchases ?? 0).toString(),
    month_net_sales: sales?.totals.amount ?? null,
    month_profit: sales?.totals.profit ?? null,
    top_items: sales ? sales.rows.slice(0, 5).map((r) => ({ item_id: r.key, code: r.code, name: r.label, qty: r.qty, amount: r.amount, profit: r.profit })) : [],
    low_stock: low,
    open_quotes: openQuotes?.n ?? 0,
  };
}
