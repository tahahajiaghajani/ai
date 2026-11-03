// Prices and look-ups for the document editors: price lists (read/replace their items), the
// price of items for a party (price list of the party, its group or the default list, else the
// item's own price), item search with stock and price, and a party's commercial summary.
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains, pgArray } from "../../db";
import { insertMany } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { D, normalizeDigits } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { buyerSnapshot, defaultVatPct, isSaleSide, loadParty, moneyDp, type PartyRow } from "./common";

export interface PriceInfo {
  /** price of one main unit */
  price: string | null;
  source: "list" | "item" | "last" | "none";
  price_list_id: string | null;
  /** default line discount of the party (sales) */
  discount_pct: string | null;
}

interface ListRow {
  id: string;
  is_default: boolean;
  valid_from: string | null;
  valid_to: string | null;
}

async function validList(q: Queryable, orgId: string, id: string | null | undefined, date: string): Promise<string | null> {
  if (!id) return null;
  const l = await q.one<ListRow>(`select id, is_default, valid_from, valid_to from tz_price_lists where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!l) return null;
  if (l.valid_from && date < l.valid_from) return null;
  if (l.valid_to && date > l.valid_to) return null;
  return l.id;
}

/** The price list that applies: chosen on the document → the party's → its group's → default. */
export async function resolvePriceList(
  q: Queryable,
  orgId: string,
  p: { party?: PartyRow | null; priceListId?: string | null; date: string; groupListId?: string | null },
): Promise<string | null> {
  for (const id of [p.priceListId, p.party?.price_list_id, p.groupListId]) {
    const ok = await validList(q, orgId, id, p.date);
    if (ok) return ok;
  }
  const defaults = await q.query<ListRow>(
    `select id, is_default, valid_from, valid_to from tz_price_lists where org_id = $1 and deleted_at is null and is_default order by created_at`,
    [orgId],
  );
  for (const l of defaults) {
    if (l.valid_from && p.date < l.valid_from) continue;
    if (l.valid_to && p.date > l.valid_to) continue;
    return l.id;
  }
  return null;
}

/** Price of each item in a list for a quantity (the row with the largest min_qty ≤ qty). */
export async function listPrices(q: Queryable, listId: string, itemIds: string[], qtyOf: (itemId: string) => string = () => "1"): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!itemIds.length) return out;
  const rows = await q.query<{ item_id: string; price: string; min_qty: string | null }>(
    `select item_id, price, min_qty from tz_price_list_items where price_list_id = $1 and item_id = any($2::uuid[])`,
    [listId, pgArray(Array.from(new Set(itemIds)))],
  );
  const best = new Map<string, { min: ReturnType<typeof D>; price: string }>();
  for (const r of rows) {
    const min = D(r.min_qty ?? 0);
    if (min.gt(D(qtyOf(r.item_id)))) continue;
    const cur = best.get(r.item_id);
    if (!cur || min.gt(cur.min)) best.set(r.item_id, { min, price: r.price });
  }
  for (const [id, b] of best) out.set(id, D(b.price).toString());
  return out;
}

/** Default unit prices (per main unit) for a document kind and party. */
export async function lookupPrices(
  q: Queryable,
  ctx: Ctx,
  p: { kind: string; partyId?: string | null; priceListId?: string | null; date: string; items: { item_id: string; qty?: string | null }[] },
): Promise<Map<string, PriceInfo>> {
  const out = new Map<string, PriceInfo>();
  const ids = Array.from(new Set(p.items.map((i) => i.item_id).filter(isUuid)));
  if (!ids.length) return out;
  const items = await q.query<{ id: string; sale_price: string | null; purchase_price: string | null }>(
    `select id, sale_price, purchase_price from tz_items where org_id = $1 and id = any($2::uuid[])`,
    [ctx.org.id, pgArray(ids)],
  );
  const qty = new Map(p.items.map((i) => [i.item_id, D(i.qty ?? 1).toString()]));
  if (isSaleSide(p.kind)) {
    let party: PartyRow | null = null;
    let group: { price_list_id: string | null; discount_pct: string | null } | null = null;
    if (p.partyId && isUuid(p.partyId)) {
      party = await loadParty(q, ctx.org.id, p.partyId).catch(() => null);
      if (party?.group_id) group = await q.one(`select price_list_id, discount_pct from tz_party_groups where id = $1 and org_id = $2 and deleted_at is null`, [party.group_id, ctx.org.id]);
    }
    const listId = await resolvePriceList(q, ctx.org.id, { party, priceListId: p.priceListId, date: p.date, groupListId: group?.price_list_id });
    const fromList = listId ? await listPrices(q, listId, ids, (id) => qty.get(id) ?? "1") : new Map<string, string>();
    const discount = party?.discount_pct ?? group?.discount_pct ?? null;
    for (const it of items) {
      const lp = fromList.get(it.id);
      out.set(it.id, {
        price: lp ?? (it.sale_price !== null ? D(it.sale_price).toString() : null),
        source: lp ? "list" : it.sale_price !== null ? "item" : "none",
        price_list_id: lp ? listId : null,
        discount_pct: discount !== null && D(discount).gt(0) ? D(discount).toString() : null,
      });
    }
  } else {
    const last = await q.query<{ item_id: string; price: string }>(
      `select distinct on (l.item_id) l.item_id, l.unit_price / nullif(l.unit_factor, 0) as price
       from tz_invoice_lines l join tz_invoices i on i.id = l.invoice_id
       where i.org_id = $1 and i.kind = 'purchase' and i.status = 'posted' and i.deleted_at is null and l.item_id = any($2::uuid[])
       order by l.item_id, i.date desc, i.created_at desc`,
      [ctx.org.id, pgArray(ids)],
    );
    const lastOf = new Map(last.map((r) => [r.item_id, D(r.price).toDecimalPlaces(moneyDp(ctx)).toString()]));
    for (const it of items) {
      const lp = lastOf.get(it.id);
      out.set(it.id, {
        price: it.purchase_price !== null ? D(it.purchase_price).toString() : lp ?? null,
        source: it.purchase_price !== null ? "item" : lp ? "last" : "none",
        price_list_id: null,
        discount_pct: null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- price list items

export async function getPriceListItems(ctx: Ctx, listId: string) {
  ctx.need("sales", "view");
  const list = await ctx.db.one(`select * from tz_price_lists where id = $1 and org_id = $2 and deleted_at is null`, [listId, ctx.org.id]);
  if (!list) throw notFound("فهرست قیمت پیدا نشد");
  const rows = await ctx.db.query(
    `select pi.id, pi.item_id, pi.price, pi.min_qty, i.code, i.name, i.kind, i.sale_price, i.purchase_price, u.name as unit_name
     from tz_price_list_items pi join tz_items i on i.id = pi.item_id left join tz_units u on u.id = i.unit_id
     where pi.price_list_id = $1 order by length(i.code), i.code, pi.min_qty nulls first`,
    [listId],
  );
  return { price_list: list, rows };
}

/**
 * Every active good and service with its sale price, for «افزودن همه‌ی کالاها» of the editor
 * (which adds the ones it does not list yet, then saves with replacePriceListItems). Checked
 * against sales like the rest of the editor: members who set prices need not see the inventory.
 */
export async function priceListAllItems(ctx: Ctx, listId: string) {
  ctx.need("sales", "edit");
  const list = isUuid(listId)
    ? await ctx.db.one(`select id from tz_price_lists where id = $1 and org_id = $2 and deleted_at is null`, [listId, ctx.org.id])
    : null;
  if (!list) throw notFound("فهرست قیمت پیدا نشد");
  const rows = await ctx.db.query(
    `select i.id as item_id, i.code, i.name, i.kind, i.sale_price, u.name as unit_name
     from tz_items i left join tz_units u on u.id = i.unit_id
     where i.org_id = $1 and i.deleted_at is null and i.is_active and i.kind in ('goods', 'service')
     order by length(i.code), i.code`,
    [ctx.org.id],
  );
  return { rows };
}

export async function replacePriceListItems(ctx: Ctx, listId: string, items: { item_id: string; price: string | number; min_qty?: string | number | null }[]) {
  ctx.need("sales", "edit");
  return ctx.write(async (tx: Tx) => {
    const list = await tx.one(`select id from tz_price_lists where id = $1 and org_id = $2 and deleted_at is null`, [listId, ctx.org.id]);
    if (!list) throw notFound("فهرست قیمت پیدا نشد");
    const ids = Array.from(new Set(items.map((i) => i.item_id)));
    const known = ids.length
      ? new Set((await tx.query<{ id: string }>(`select id from tz_items where org_id = $1 and deleted_at is null and id = any($2::uuid[])`, [ctx.org.id, pgArray(ids)])).map((r) => r.id))
      : new Set<string>();
    const seen = new Set<string>();
    const rows = items.map((i, n) => {
      if (!known.has(i.item_id)) throw bad(`ردیف ${n + 1}: کالا پیدا نشد`);
      const price = D(i.price);
      if (price.isNeg()) throw bad(`ردیف ${n + 1}: قیمت نمی‌تواند منفی باشد`);
      const minQty = i.min_qty === null || i.min_qty === undefined || i.min_qty === "" ? null : D(i.min_qty).toString();
      const key = `${i.item_id}|${minQty ?? ""}`;
      if (seen.has(key)) throw bad(`ردیف ${n + 1}: قیمت این کالا (با همین حداقل مقدار) تکراری است`);
      seen.add(key);
      return { id: uuidv7(), price_list_id: listId, org_id: ctx.org.id, item_id: i.item_id, price: price.toString(), min_qty: minQty };
    });
    await tx.query(`delete from tz_price_list_items where price_list_id = $1`, [listId]);
    await insertMany(tx, "tz_price_list_items", rows);
    // children changed → touch the aggregate root for sync
    await tx.query(`update tz_price_lists set origin = $2 where id = $1`, [listId, ctx.cfg.origin]);
    return { ok: true, count: rows.length };
  });
}

// ---------------------------------------------------------------- item search

export interface LookupParams {
  q?: string;
  code?: string;
  ids?: string[];
  kinds?: string[];
  warehouseId?: string | null;
  invoiceKind?: string | null;
  partyId?: string | null;
  priceListId?: string | null;
  date: string;
  limit?: number;
  includeInactive?: boolean;
}

/** Items for the document editors with stock (total and in a warehouse) and resolved prices. */
export async function itemLookup(ctx: Ctx, p: LookupParams) {
  const params: unknown[] = [ctx.org.id];
  const cond = ["i.org_id = $1", "i.deleted_at is null"];
  if (!p.includeInactive && !p.ids?.length) cond.push("i.is_active");
  const kinds = (p.kinds?.length ? p.kinds : ["goods", "service"]).filter((k) => ["goods", "service", "coin"].includes(k));
  params.push(pgArray(kinds));
  cond.push(`i.kind = any($${params.length}::text[])`);
  let rank = "";
  if (p.ids?.length) {
    params.push(pgArray(p.ids.filter(isUuid)));
    cond.push(`i.id = any($${params.length}::uuid[])`);
  } else if (p.code !== undefined) {
    const code = normalizeDigits(p.code.trim());
    if (!code) return [];
    params.push(code);
    cond.push(`(i.barcode = $${params.length} or i.code = $${params.length} or i.sku = $${params.length})`);
    rank = `case when i.barcode = $${params.length} then 0 when i.code = $${params.length} then 1 else 2 end`;
  } else if (p.q && p.q.trim()) {
    const s = normalizeDigits(p.q.trim());
    params.push(likeContains(s));
    const like = params.length;
    params.push(s);
    const exact = params.length;
    cond.push(`(i.name ilike $${like} or i.code ilike $${like} or i.barcode ilike $${like} or i.sku ilike $${like})`);
    rank = `case when i.barcode = $${exact} or i.code = $${exact} then 0 when i.name ilike ($${exact} || '%') then 1 else 2 end`;
  }
  let wh = "null::numeric";
  if (p.warehouseId && isUuid(p.warehouseId)) {
    params.push(p.warehouseId);
    wh = `(select coalesce(sum(m.qty), 0) from tz_stock_moves m where m.org_id = i.org_id and m.item_id = i.id and m.warehouse_id = $${params.length})`;
  }
  const limit = Math.min(Math.max(p.limit ?? 20, 1), 100);
  const rows = await ctx.db.query<Record<string, any>>(
    `select i.id, i.code, i.name, i.kind, i.barcode, i.sku, i.category_id, i.unit_id, u.name as unit_name, u.decimals as unit_decimals,
            i.unit2_id, u2.name as unit2_name, u2.decimals as unit2_decimals, i.unit2_factor, i.sale_price, i.purchase_price,
            i.min_sale_price, i.vat_pct as item_vat_pct, i.tax_goods_id, i.is_active, i.allow_negative, i.reorder_point, i.min_stock,
            coalesce(s.qty, 0) as stock, coalesce(s.value, 0) as stock_value, ${wh} as wh_stock
     from tz_items i
     left join tz_units u on u.id = i.unit_id
     left join tz_units u2 on u2.id = i.unit2_id
     left join lateral (select sum(m.qty) as qty, sum(m.value) as value from tz_stock_moves m where m.org_id = i.org_id and m.item_id = i.id) s on true
     where ${cond.join(" and ")}
     order by ${rank ? `${rank}, ` : ""}length(i.code), i.code
     limit ${limit}`,
    params,
  );
  const prices = p.invoiceKind
    ? await lookupPrices(ctx.db, ctx, { kind: p.invoiceKind, partyId: p.partyId, priceListId: p.priceListId, date: p.date, items: rows.map((r) => ({ item_id: r.id })) })
    : new Map<string, PriceInfo>();
  const vat = defaultVatPct(ctx);
  const showCost = ctx.can("inventory", "view") || ctx.can("purchases", "view");
  return rows.map((r) => {
    const stock = D(r.stock);
    const pr = prices.get(r.id);
    return {
      ...r,
      vat_pct: r.item_vat_pct ?? vat,
      avg_cost: showCost && stock.gt(0) ? D(r.stock_value).div(stock).toDecimalPlaces(moneyDp(ctx)).toString() : null,
      stock_value: showCost ? r.stock_value : null,
      price: pr?.price ?? null,
      price_source: pr?.source ?? null,
      price_list_id: pr?.price_list_id ?? null,
      discount_pct: pr?.discount_pct ?? null,
    };
  });
}

// ---------------------------------------------------------------- party summary

export async function partyInfo(ctx: Ctx, id: string) {
  const party = await loadParty(ctx.db, ctx.org.id, id);
  const group = party.group_id
    ? await ctx.db.one<{ name: string; price_list_id: string | null; discount_pct: string | null }>(
        `select name, price_list_id, discount_pct from tz_party_groups where id = $1 and org_id = $2 and deleted_at is null`,
        [party.group_id, ctx.org.id],
      )
    : null;
  const bal = party.detail_id
    ? await ctx.db.one<{ b: string }>(
        `select coalesce(sum(l.debit - l.credit), 0) as b from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id
         where l.org_id = $1 and l.detail_id = $2 and l.currency_id is null and v.deleted_at is null and v.status in ('posted', 'final')`,
        [ctx.org.id, party.detail_id],
      )
    : null;
  const flags = await ctx.db.one<{ is_blacklisted: boolean; is_active: boolean; roles: string[] }>(`select is_blacklisted, is_active, roles from tz_parties where id = $1`, [id]);
  return {
    party: { ...party, ...flags },
    buyer: buyerSnapshot(party),
    group,
    balance: D(bal?.b ?? 0).toString(),
    credit_limit: party.credit_limit,
    price_list_id: party.price_list_id ?? group?.price_list_id ?? null,
    discount_pct: party.discount_pct ?? group?.discount_pct ?? null,
  };
}
