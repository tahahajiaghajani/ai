// The coin and bar catalogue (tz_items with kind 'coin' / 'bar', a board key in rate_key and the
// metadata in gold_meta): seeding the standard catalogue, the «سکه‌ها» / «شمش‌ها» lists with stock,
// gold content, today's buy and sell price and bubble, the kardex of a coin and the editing of a
// product. Stock of coins is counted in tz_stock_moves (moving average cost); bars are counted
// one by one in tz_gold_bars.
import { z } from "zod";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { insertRow, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, isNumeric } from "@shared/money";
import { coinContent } from "@shared/gold";
import { STANDARD_CATALOGUE, legacyCoinKey, coinMeta, type GoldMeta, type ProductKind } from "@shared/gold-catalogue";
import { parseGoldMeta, normalizeRateKey } from "@shared/gold-meta";
import { productBubble, productQuote, type Product } from "@shared/gold-quote";
import { audit } from "../data/crud";
import { latestRate, type RateRow } from "./rates";
import { quoteEnv } from "./settings";

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  kind: ProductKind;
  rate_key: string | null;
  gold_weight: string | null;
  fineness: string | null;
  barcode: string | null;
  sku: string | null;
  is_active: boolean;
  gold_meta: GoldMeta;
  /** coins: average cost of one coin in stock now (margin VAT of quotes) */
  avg_cost?: string | null;
}

const COLS = "id, code, name, kind, rate_key, gold_weight, fineness, barcode, sku, is_active, gold_meta";

/** Catalogue products of a business (coins and/or bar models). */
export async function products(q: Queryable, orgId: string, kinds: ProductKind[] = ["coin", "bar"], ids?: string[]): Promise<ProductRow[]> {
  const params: unknown[] = [orgId, `{${kinds.join(",")}}`];
  let extra = "";
  if (ids) {
    params.push(`{${ids.join(",") || "00000000-0000-0000-0000-000000000000"}}`);
    extra = "and id = any($3::uuid[])";
  }
  const rows = await q.query<ProductRow>(
    `select ${COLS},
            case when kind = 'coin' then (select case when sum(m.qty) > 0 then round(sum(m.value) / sum(m.qty)) end from tz_stock_moves m
                                          where m.org_id = tz_items.org_id and m.item_id = tz_items.id) end as avg_cost
     from tz_items where org_id = $1 and kind = any($2::text[]) and deleted_at is null ${extra} order by kind desc, length(code), code`,
    params,
  );
  return rows.map((r) => ({
    ...r, rate_key: r.rate_key ?? (r.kind === "coin" ? legacyCoinKey(r) : null), gold_meta: coinMeta(r.kind, r.gold_meta), avg_cost: r.avg_cost === null || r.avg_cost === undefined ? null : D(r.avg_cost).toString(),
  }));
}

// ---------------------------------------------------------------- seeding

/**
 * Adds the standard catalogue to a gold business: coins made before it get their board key and
 * metadata, missing entries are added (ids derived from the business and the key, like the
 * migration, so two runtimes create the same rows). Safe to run again.
 */
export async function seedGoldCatalogue(tx: Tx, orgId: string, origin: string): Promise<number> {
  const rows = await tx.query<{ id: string; code: string; name: string; sku: string | null; kind: string; rate_key: string | null; gold_weight: string | null }>(
    `select id, code, name, sku, kind, rate_key, gold_weight from tz_items where org_id = $1 and kind in ('coin', 'bar') and deleted_at is null order by length(code), code, id`,
    [orgId],
  );
  const taken = new Set(rows.filter((r) => r.rate_key).map((r) => r.rate_key!));
  const byKey = new Map(STANDARD_CATALOGUE.map((e) => [e.key, e]));
  for (const r of rows.filter((x) => x.kind === "coin" && !x.rate_key)) {
    const key = legacyCoinKey(r);
    if (!key || taken.has(key)) continue;
    const e = byKey.get(key);
    const legacyWeight = r.gold_weight && ["8.133", "4.066", "2.033"].includes(D(r.gold_weight).toString());
    await updateRow(tx, "tz_items", { id: r.id, org_id: orgId }, {
      rate_key: key, gold_meta: e?.meta ?? {}, ...(legacyWeight && e?.gold_weight ? { gold_weight: e.gold_weight } : {}), origin,
    });
    taken.add(key);
  }
  const unit = await tx.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد' and deleted_at is null order by created_at limit 1`, [orgId]);
  const codes = new Set((await tx.query<{ code: string }>(`select code from tz_items where org_id = $1 and deleted_at is null`, [orgId])).map((r) => r.code));
  let added = 0;
  for (const e of STANDARD_CATALOGUE) {
    if (taken.has(e.key)) continue;
    const id = (await tx.one<{ id: string }>(`select tz_seed_uuid($1) as id`, [`${orgId}:gold:${e.key}`]))!.id;
    if (await tx.one(`select 1 from tz_items where id = $1`, [id])) continue;
    const prefix = e.kind === "bar" ? "B" : "C";
    let n = 1;
    while (codes.has(`${prefix}${n}`)) n++;
    codes.add(`${prefix}${n}`);
    await insertRow(tx, "tz_items", {
      id, org_id: orgId, code: `${prefix}${n}`, name: e.name, kind: e.kind, unit_id: unit?.id ?? null, gold_weight: e.gold_weight, fineness: e.fineness,
      vat_pct: 0, is_active: e.active, rate_key: e.key, gold_meta: e.meta, origin,
    }, "id");
    taken.add(e.key);
    added++;
  }
  return added;
}

export async function seedCatalogueAction(ctx: Ctx) {
  ctx.need("gold", "full");
  return ctx.write(async (tx) => {
    const added = await seedGoldCatalogue(tx, ctx.org.id, ctx.cfg.origin);
    if (added) await audit(tx, ctx, "create", "item", null, `افزودن ${added} سکه و شمش استاندارد`);
    return { added };
  });
}

// ---------------------------------------------------------------- lists

export interface CatalogueRow extends ProductRow {
  /** coins: count on hand; bars: bars in stock of this model */
  qty: string;
  /** book value of the stock */
  value: string;
  avg_cost: string | null;
  /** gold content of the stock: grams, pure grams and 750-equivalent grams */
  weight: string;
  pure: string;
  weight750: string;
  sell: string | null;
  buy: string | null;
  sell_value: string | null;
  buy_value: string | null;
  bubble: { domestic: string | null; world: string | null; domestic_amount: string | null; world_amount: string | null } | null;
}

/** Coin stock (count and book value) per item up to a date. */
async function coinStocks(q: Queryable, orgId: string, asOf?: string | null) {
  const rows = await q.query<{ item_id: string; qty: string; value: string }>(
    `select item_id, coalesce(sum(qty), 0) as qty, coalesce(sum(value), 0) as value from tz_stock_moves
     where org_id = $1 and source_type = 'gold_doc' ${asOf ? "and date <= $2" : ""} group by item_id`,
    asOf ? [orgId, asOf] : [orgId],
  );
  return new Map(rows.map((r) => [r.item_id, r]));
}

/** Bars in stock (own) per model up to a date. */
async function barStocks(q: Queryable, orgId: string, asOf?: string | null) {
  const rows = await q.query<{ item_id: string | null; n: string; weight: string; pure: string; w750: string; cost: string }>(
    `select b.item_id, count(*) as n, coalesce(sum(b.weight), 0) as weight, coalesce(sum(b.fine_weight), 0) as pure,
            coalesce(sum(b.weight750), 0) as w750, coalesce(sum(b.cost), 0) as cost
     from tz_gold_bars b
     where b.org_id = $1 and b.deleted_at is null and b.ownership = 'own' and ${barInStockAt(asOf)}
     group by b.item_id`,
    asOf ? [orgId, asOf] : [orgId],
  );
  return new Map(rows.map((r) => [r.item_id ?? "", r]));
}

/**
 * SQL condition: bar `b` was in the shop on a date — its last posted movement on or before that
 * date brought it in (documents keep the whole history, also of bars bought back and resold).
 */
export function barInStockAt(asOf?: string | null, p = "$2") {
  if (!asOf) return "b.status in ('in_stock', 'reserved')";
  return `exists (select 1 from (
      select distinct on (l.gold_bar_id) l.direction from tz_gold_lines l join tz_gold_docs d on d.id = l.doc_id
      where l.org_id = b.org_id and l.gold_bar_id = b.id and d.status = 'posted' and d.deleted_at is null and d.date <= ${p}
      order by l.gold_bar_id, d.date desc, d.created_at desc
    ) last where last.direction = 'in')`;
}

export async function catalogue(q: Queryable, ctx: Ctx, opts: { kind?: ProductKind | null; to?: string | null; active?: boolean | null } = {}): Promise<{ rows: CatalogueRow[]; rate: RateRow | null }> {
  const kinds: ProductKind[] = opts.kind ? [opts.kind] : ["coin", "bar"];
  const [list, stock, bars, rate] = await Promise.all([
    products(q, ctx.org.id, kinds),
    coinStocks(q, ctx.org.id, opts.to),
    kinds.includes("bar") ? barStocks(q, ctx.org.id, opts.to) : Promise.resolve(new Map()),
    latestRate(q, ctx.org.id),
  ]);
  const env = quoteEnv(ctx.org);
  const rows = list
    .filter((p) => opts.active === undefined || opts.active === null || p.is_active === opts.active)
    .map((p): CatalogueRow => {
      const prod: Product = p;
      if (p.kind === "bar") {
        const s = bars.get(p.id);
        const n = D(s?.n ?? 0);
        const avg = n.gt(0) ? D(s!.cost).div(n).toDecimalPlaces(0).toString() : null;
        const sell = productQuote(prod, rate, env, { side: "sell", unitCost: avg ?? 0 });
        const buy = productQuote(prod, rate, env, { side: "buy" });
        return {
          ...p, qty: n.toString(), value: D(s?.cost ?? 0).toString(), avg_cost: avg,
          weight: D(s?.weight ?? 0).toString(), pure: D(s?.pure ?? 0).toString(), weight750: D(s?.w750 ?? 0).toString(),
          sell: sell?.unit ?? null, buy: buy?.unit ?? null, sell_value: null, buy_value: null, bubble: null,
        };
      }
      const s = stock.get(p.id);
      const qty = D(s?.qty ?? 0);
      const avg = qty.gt(0) ? D(s!.value).div(qty).toDecimalPlaces(0).toString() : null;
      const content = coinContent(p.gold_weight ?? 0, p.fineness ?? 900, qty);
      // margin VAT of the sell price: over the average cost of the stock
      const sell = productQuote(prod, rate, env, { side: "sell", unitCost: avg ?? 0 });
      const buy = productQuote(prod, rate, env, { side: "buy" });
      const b = productBubble(prod, rate);
      return {
        ...p, qty: qty.toString(), value: D(s?.value ?? 0).toString(), avg_cost: avg,
        weight: content.weight, pure: content.pure, weight750: content.weight750, sell: sell?.unit ?? null, buy: buy?.unit ?? null,
        sell_value: sell?.unit ? qty.times(D(sell.unit)).toString() : null, buy_value: buy?.unit ? qty.times(D(buy.unit)).toString() : null,
        bubble: b ? { domestic: b.domestic?.pct ?? null, world: b.world?.pct ?? null, domestic_amount: b.domestic?.amount ?? null, world_amount: b.world?.amount ?? null } : null,
      };
    });
  return { rows, rate };
}

export async function catalogueAction(ctx: Ctx, opts: { kind?: string | null; to?: string | null; active?: string | null }) {
  ctx.need("gold", "view");
  const kind = opts.kind === "coin" || opts.kind === "bar" ? opts.kind : null;
  const to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : null;
  const { rows, rate } = await catalogue(ctx.db, ctx, { kind, to, active: opts.active === "1" ? true : opts.active === "0" ? false : null });
  return { rows, rate: rate ? { at: rate.at, gram18: rate.gram18, source: rate.source, meta: rate.meta } : null };
}

/** Movements of one coin (buy, sell, trade-in, melt…) with the running count and value. */
export async function coinKardex(ctx: Ctx, itemId: string, p: { from?: string | null; to?: string | null }) {
  ctx.need("gold", "view");
  const item = (await products(ctx.db, ctx.org.id, ["coin"], [itemId]))[0];
  if (!item) throw notFound("سکه پیدا نشد");
  const params: unknown[] = [ctx.org.id, itemId];
  let cond = "";
  if (p.to && /^\d{4}-\d{2}-\d{2}$/.test(p.to)) {
    params.push(p.to);
    cond = `and m.date <= $${params.length}`;
  }
  const rows = await ctx.db.query<{ date: string; qty: string; value: string; unit_cost: string; doc_id: string; kind: string; no: number; party_name: string | null; total: string | null }>(
    `select m.date, m.qty, m.value, m.unit_cost, d.id as doc_id, d.kind, d.no, coalesce(pa.name, d.buyer->>'name') as party_name, l.total
     from tz_stock_moves m
     join tz_gold_docs d on d.id = m.source_id
     left join tz_gold_lines l on l.id = m.source_line_id
     left join tz_parties pa on pa.id = d.party_id
     where m.org_id = $1 and m.item_id = $2 ${cond}
     order by m.date, d.created_at, m.seq`,
    params,
  );
  let qty = D(0);
  let value = D(0);
  const from = p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from) ? p.from : null;
  const opening = { qty: "0", value: "0" };
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    qty = qty.plus(D(r.qty));
    value = value.plus(D(r.value));
    const date = String(r.date).slice(0, 10);
    if (from && date < from) {
      opening.qty = qty.toString();
      opening.value = value.toString();
      continue;
    }
    out.push({ ...r, date, balance_qty: qty.toString(), balance_value: value.toString() });
  }
  return { item, opening, rows: out, balance: { qty: qty.toString(), value: value.toString() } };
}

// ---------------------------------------------------------------- editing

const num = z.union([z.string().max(40), z.number()]).nullish();
export const productSchema = z.object({
  kind: z.enum(["coin", "bar"]),
  name: z.string().trim().min(1, "نام را وارد کنید").max(200),
  code: z.string().trim().max(40).nullish(),
  rate_key: z.string().max(40).nullish(),
  gold_weight: num,
  fineness: num,
  barcode: z.string().max(60).nullish(),
  is_active: z.boolean().nullish(),
  gold_meta: z.record(z.string(), z.unknown()).nullish(),
});
export type ProductInput = z.infer<typeof productSchema>;

export async function saveProduct(ctx: Ctx, id: string | null, input: ProductInput) {
  ctx.need("gold", "full");
  const meta = parseGoldMeta(input.kind, input.gold_meta ?? {});
  if ("error" in meta) throw bad(meta.error);
  let key: string | null;
  try {
    key = normalizeRateKey(input.rate_key);
  } catch (e) {
    throw bad((e as Error).message);
  }
  const dec = (v: unknown, label: string, max?: number) => {
    if (v === null || v === undefined || v === "") return null;
    if (!isNumeric(v) || D(v as string).lte(0) || (max !== undefined && D(v as string).gt(max))) throw bad(`«${label}» معتبر نیست`);
    return D(v as string).toString();
  };
  const weight = dec(input.gold_weight, input.kind === "bar" ? "وزن اسمی" : "وزن هر سکه");
  const fineness = dec(input.fineness, "عیار", 1000) ?? (input.kind === "bar" ? "995" : "900");
  if (input.kind === "coin" && !weight) throw bad("وزن هر سکه را وارد کنید");
  if (meta.meta.pricing_mode === "board" && !key) throw bad("برای قیمت‌گذاری با تابلو، کلید تابلو لازم است");
  return ctx.write(async (tx) => {
    if (key) {
      const dup = await tx.one<{ name: string }>(
        `select name from tz_items where org_id = $1 and rate_key = $2 and kind in ('coin', 'bar') and deleted_at is null ${id ? "and id <> $3" : ""} limit 1`,
        id ? [ctx.org.id, key, id] : [ctx.org.id, key],
      );
      if (dup) throw conflict(`کلید تابلوی «${key}» برای «${dup.name}» ثبت شده است`);
    }
    const fields = {
      name: input.name, kind: input.kind, rate_key: key, gold_weight: weight, fineness, barcode: input.barcode?.trim() || null,
      is_active: input.is_active ?? true, gold_meta: meta.meta, origin: ctx.cfg.origin,
    };
    if (id) {
      const prev = await tx.one<{ kind: string }>(`select kind from tz_items where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
      if (!prev) throw notFound("سکه یا شمش پیدا نشد");
      if (prev.kind !== input.kind) throw bad("نوع قابل تغییر نیست");
      const code = input.code?.trim();
      if (code) {
        const used = await tx.one(`select 1 from tz_items where org_id = $1 and code = $2 and id <> $3 and deleted_at is null`, [ctx.org.id, code, id]);
        if (used) throw conflict("این کد قبلاً استفاده شده است");
      }
      await updateRow(tx, "tz_items", { id, org_id: ctx.org.id }, { ...fields, ...(code ? { code } : {}) });
      await audit(tx, ctx, "update", "item", id, input.name);
      return (await products(tx, ctx.org.id, [input.kind], [id]))[0];
    }
    const prefix = input.kind === "bar" ? "B" : "C";
    let code = input.code?.trim() || "";
    if (code) {
      if (await tx.one(`select 1 from tz_items where org_id = $1 and code = $2 and deleted_at is null`, [ctx.org.id, code])) throw conflict("این کد قبلاً استفاده شده است");
    } else {
      const codes = new Set((await tx.query<{ code: string }>(`select code from tz_items where org_id = $1 and code like $2`, [ctx.org.id, `${prefix}%`])).map((r) => r.code));
      let n = 1;
      while (codes.has(`${prefix}${n}`)) n++;
      code = `${prefix}${n}`;
    }
    const unit = await tx.one<{ id: string }>(`select id from tz_units where org_id = $1 and name = 'عدد' and deleted_at is null order by created_at limit 1`, [ctx.org.id]);
    const { uuidv7 } = await import("@shared/id");
    const newId = uuidv7();
    await insertRow(tx, "tz_items", { id: newId, org_id: ctx.org.id, code, unit_id: unit?.id ?? null, vat_pct: 0, ...fields }, "id");
    await audit(tx, ctx, "create", "item", newId, input.name);
    return (await products(tx, ctx.org.id, [input.kind], [newId]))[0];
  });
}

/** Removes a product nobody used yet; a used one can only be switched off. */
export async function deleteProduct(ctx: Ctx, id: string) {
  ctx.need("gold", "full");
  return ctx.write(async (tx) => {
    const p = await tx.one<{ name: string; kind: string }>(`select name, kind from tz_items where id = $1 and org_id = $2 and kind in ('coin', 'bar') and deleted_at is null`, [id, ctx.org.id]);
    if (!p) throw notFound("سکه یا شمش پیدا نشد");
    const used = await tx.one(
      `select 1 where exists (select 1 from tz_gold_lines where org_id = $1 and item_id = $2) or exists (select 1 from tz_gold_bars where org_id = $1 and item_id = $2 and deleted_at is null)`,
      [ctx.org.id, id],
    );
    if (used) throw conflict(`«${p.name}» در اسناد به کار رفته است؛ به جای حذف، آن را غیرفعال کنید`);
    await updateRow(tx, "tz_items", { id, org_id: ctx.org.id }, { deleted_at: new Date().toISOString(), origin: ctx.cfg.origin });
    await audit(tx, ctx, "delete", "item", id, p.name);
    return { ok: true };
  });
}
