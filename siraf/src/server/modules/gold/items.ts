// Tagged pieces (اتیکت‌ها): filtered lists with weight sums, lookup by scanned tag, tag
// numbering, bulk tag creation for existing stock, coin items with their stock and cost.
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { insertMany, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, isNumeric, normalizeDigits, type Num } from "@shared/money";
import { weight750 } from "@shared/gold";
import { uuidv7, isUuid } from "@shared/id";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { audit } from "../data/crud";
import { latestRate } from "./rates";
import { coinKey, pieceDefaults, priceLine } from "./pricing";
import { priceEnv } from "./settings";

export const ITEM_STATUS_TITLES: Record<string, string> = {
  in_stock: "موجود", reserved: "رزرو", sold: "فروخته‌شده", returned: "برگشت‌شده به همکار", melted: "ذوب‌شده", consigned_out: "امانی نزد دیگران",
};

export interface GoldItemRow {
  id: string;
  tag_no: string;
  category_id: string | null;
  title: string | null;
  fineness: string;
  gross_weight: string;
  stone_weight: string;
  net_weight: string;
  wage_type: string;
  wage_value: string;
  profit_pct: string | null;
  stone_desc: string | null;
  stone_price: string;
  supplier_id: string | null;
  ownership: "own" | "consignment";
  status: string;
  warehouse_id: string | null;
  cost: string | null;
  in_doc_id: string | null;
  out_doc_id: string | null;
  notes: string | null;
  deleted_at?: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  default_fineness: string;
  wage_type: string;
  wage_value: string;
  profit_pct: string | null;
}

/** Next free numeric tag (counting soft-deleted tags too, so a tag is never reused). */
export async function nextTagNo(q: Queryable, orgId: string): Promise<number> {
  const r = await q.one<{ n: string | null }>(
    `select max(tag_no::numeric) as n from tz_gold_items where org_id = $1 and tag_no ~ '^[0-9]{1,15}$'`,
    [orgId],
  );
  return Math.max(r?.n ? Number(r.n) + 1 : 100001, 100001);
}

export async function tagTaken(q: Queryable, orgId: string, tag: string, exceptId?: string | null): Promise<boolean> {
  const r = await q.one(
    `select 1 from tz_gold_items where org_id = $1 and tag_no = $2 and deleted_at is null ${exceptId ? "and id <> $3" : ""} limit 1`,
    exceptId ? [orgId, tag, exceptId] : [orgId, tag],
  );
  return !!r;
}

export function normalizeTag(tag: string): string {
  return normalizeDigits(String(tag ?? "")).trim().replace(/\s+/g, "");
}

export interface ItemListParams {
  q?: string;
  status?: string;
  category_id?: string;
  ownership?: string;
  supplier_id?: string;
  in_doc_id?: string;
  min_weight?: string;
  max_weight?: string;
  ids?: string;
  page?: number;
  size?: number;
  sort?: string;
  dir?: string;
}

const SORTS: Record<string, (dir: string) => string> = {
  tag_no: (d) => `length(i.tag_no) ${d}, i.tag_no ${d}`,
  net_weight: (d) => `i.net_weight ${d}`,
  gross_weight: (d) => `i.gross_weight ${d}`,
  title: (d) => `i.title ${d}`,
  created_at: (d) => `i.created_at ${d}`,
  fineness: (d) => `i.fineness ${d}`,
  wage_value: (d) => `i.wage_value ${d}`,
};

export async function listItems(ctx: Ctx, p: ItemListParams) {
  ctx.need("gold", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["i.org_id = $1", "i.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (p.q?.trim()) {
    params.push(likeContains(normalizeDigits(p.q.trim())));
    const n = params.length;
    cond.push(`(i.tag_no ilike $${n} or coalesce(i.title, '') ilike $${n} or coalesce(i.stone_desc, '') ilike $${n})`);
  }
  if (p.status) {
    const list = p.status.split(",").filter((x) => /^[a-z_]+$/.test(x));
    if (list.length) add("i.status = any(?::text[])", `{${list.join(",")}}`);
  }
  if (p.category_id && isUuid(p.category_id)) add("i.category_id = ?", p.category_id);
  if (p.ownership === "own" || p.ownership === "consignment") add("i.ownership = ?", p.ownership);
  if (p.supplier_id && isUuid(p.supplier_id)) add("i.supplier_id = ?", p.supplier_id);
  if (p.in_doc_id && isUuid(p.in_doc_id)) add("i.in_doc_id = ?", p.in_doc_id);
  if (p.min_weight && isNumeric(p.min_weight)) add("i.net_weight >= ?", D(p.min_weight).toString());
  if (p.max_weight && isNumeric(p.max_weight)) add("i.net_weight <= ?", D(p.max_weight).toString());
  if (p.ids) {
    const ids = p.ids.split(",").filter(isUuid);
    add("i.id = any(?::uuid[])", `{${ids.join(",") || "00000000-0000-0000-0000-000000000000"}}`);
  }
  const where = cond.join(" and ");
  const size = Math.min(Math.max(p.size ?? 50, 1), 1000);
  const page = Math.max(p.page ?? 1, 1);
  const sort = SORTS[p.sort ?? ""];
  const order = sort ? sort(p.dir === "desc" ? "desc" : "asc") : SORTS.tag_no("desc");
  const sums = await ctx.db.one<{ n: number; gross: string; net: string; w750: string; stone: string }>(
    `select count(*)::int as n, coalesce(sum(i.gross_weight),0) as gross, coalesce(sum(i.net_weight),0) as net,
            coalesce(sum(round(i.net_weight * i.fineness / 750, 3)),0) as w750, coalesce(sum(i.stone_weight),0) as stone
     from tz_gold_items i where ${where}`,
    params,
  );
  const rows = await ctx.db.query(
    `select i.*, round(i.net_weight * i.fineness / 750, 3) as weight750, c.name as category_name, p.name as supplier_name
     from tz_gold_items i
     left join tz_gold_categories c on c.id = i.category_id
     left join tz_parties p on p.id = i.supplier_id
     where ${where} order by ${order}, i.id limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { rows, total: sums?.n ?? 0, page, size, sums };
}

/** A scanned tag: the piece, its category and its sale price at the given (or latest) rate. */
export async function itemByTag(ctx: Ctx, rawTag: string, gram18?: string | null) {
  ctx.need("gold", "view");
  const tag = normalizeTag(rawTag);
  if (!tag) throw bad("شماره‌ی اتیکت را وارد کنید");
  let item = await ctx.db.one<GoldItemRow>(`select * from tz_gold_items where org_id = $1 and tag_no = $2 and deleted_at is null`, [ctx.org.id, tag]);
  if (!item && /^\d+$/.test(tag)) {
    // scanners sometimes add or drop leading zeros
    item = await ctx.db.one<GoldItemRow>(
      `select * from tz_gold_items where org_id = $1 and deleted_at is null and tag_no ~ '^[0-9]{1,15}$' and tag_no::numeric = $2::numeric limit 1`,
      [ctx.org.id, tag],
    );
  }
  if (!item) throw notFound(`اتیکت «${tag}» پیدا نشد`);
  const cat = item.category_id
    ? await ctx.db.one<CategoryRow>(`select id, name, default_fineness, wage_type, wage_value, profit_pct from tz_gold_categories where id = $1`, [item.category_id])
    : null;
  const supplier = item.supplier_id ? await ctx.db.one<{ name: string }>(`select name from tz_parties where id = $1`, [item.supplier_id]) : null;
  const rate = await latestRate(ctx.db, ctx.org.id);
  const g18 = gram18 && isNumeric(gram18) && D(gram18).gt(0) ? D(gram18).toString() : rate?.gram18 ?? "0";
  const defaults = pieceDefaults(item, cat);
  const line = {
    kind: "piece" as const,
    direction: "out" as const,
    gold_item_id: item.id,
    tag_no: item.tag_no,
    title: item.title || cat?.name || "جنس طلا",
    category_id: item.category_id,
    category_name: cat?.name ?? null,
    ownership: item.ownership,
    ...defaults,
  };
  const price = D(g18).gt(0) ? priceLine("sale", line, priceEnv(ctx.org, { gram18: g18 })) : null;
  return {
    item: { ...item, weight750: weight750(item.net_weight, item.fineness), category_name: cat?.name ?? null, supplier_name: supplier?.name ?? null },
    available: item.status === "in_stock",
    status_title: ITEM_STATUS_TITLES[item.status] ?? item.status,
    line,
    price,
    gram18: g18,
  };
}

export interface BulkItemInput {
  tag_no?: string | null;
  category_id?: string | null;
  title?: string | null;
  fineness?: Num;
  gross_weight: Num;
  stone_weight?: Num;
  wage_type?: string | null;
  wage_value?: Num;
  profit_pct?: Num;
  stone_desc?: string | null;
  stone_price?: Num;
  supplier_id?: string | null;
  ownership?: "own" | "consignment" | null;
  cost?: Num;
  notes?: string | null;
}

/**
 * Create many tags at once (labelling stock that is already in the shop). No accounting is
 * written — opening stock is posted with a «موجودی اول دوره» document.
 */
export async function bulkCreateItems(ctx: Ctx, input: { defaults?: Partial<BulkItemInput>; items: BulkItemInput[] }) {
  ctx.need("gold", "edit");
  if (!input.items.length) throw bad("هیچ جنسی وارد نشده است");
  if (input.items.length > 500) throw bad("در هر بار حداکثر ۵۰۰ اتیکت ساخته می‌شود");
  return ctx.write(async (tx) => {
    const cats = new Map(
      (await tx.query<CategoryRow>(`select id, name, default_fineness, wage_type, wage_value, profit_pct from tz_gold_categories where org_id = $1 and deleted_at is null`, [ctx.org.id])).map((c) => [c.id, c]),
    );
    const wh = await defaultWarehouse(tx, ctx.org.id);
    // suppliers must be parties of this organisation
    const supplierIds = [...new Set(input.items.map((r) => r.supplier_id ?? input.defaults?.supplier_id).filter((v): v is string => !!v && isUuid(v)))];
    const suppliers = new Set(
      supplierIds.length
        ? (await tx.query<{ id: string }>(`select id from tz_parties where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [ctx.org.id, `{${supplierIds.join(",")}}`])).map((r) => r.id)
        : [],
    );
    let next = await nextTagNo(tx, ctx.org.id);
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const [i, raw] of input.items.entries()) {
      const it = { ...(input.defaults ?? {}), ...raw };
      const n = i + 1;
      const catId = it.category_id && isUuid(it.category_id) ? it.category_id : null;
      const supplierId = it.supplier_id && isUuid(it.supplier_id) ? it.supplier_id : null;
      if (supplierId && !suppliers.has(supplierId)) throw bad(`ردیف ${n}: تأمین‌کننده پیدا نشد`);
      if (catId && !cats.has(catId)) throw bad(`ردیف ${n}: دسته پیدا نشد`);
      const cat = catId ? cats.get(catId)! : null;
      const gross = D(it.gross_weight ?? 0);
      const stone = D(it.stone_weight ?? 0);
      if (gross.lte(0)) throw bad(`ردیف ${n}: وزن کل را وارد کنید`);
      if (stone.lt(0) || stone.gt(gross)) throw bad(`ردیف ${n}: وزن سنگ معتبر نیست`);
      const fin = D(it.fineness ?? cat?.default_fineness ?? 750);
      if (fin.lte(0) || fin.gt(1000)) throw bad(`ردیف ${n}: عیار باید بین ۱ تا ۱۰۰۰ باشد`);
      let tag = it.tag_no ? normalizeTag(it.tag_no) : "";
      if (tag) {
        if (seen.has(tag) || (await tagTaken(tx, ctx.org.id, tag))) throw conflict(`ردیف ${n}: اتیکت «${tag}» قبلاً ثبت شده است`);
      } else {
        while (seen.has(String(next)) || (await tagTaken(tx, ctx.org.id, String(next)))) next++;
        tag = String(next++);
      }
      seen.add(tag);
      rows.push({
        id: uuidv7(),
        org_id: ctx.org.id,
        tag_no: tag,
        category_id: catId,
        title: it.title?.trim() || null,
        fineness: fin.toString(),
        gross_weight: gross.toDecimalPlaces(3).toString(),
        stone_weight: stone.toDecimalPlaces(3).toString(),
        net_weight: gross.minus(stone).toDecimalPlaces(3).toString(),
        wage_type: it.wage_type || cat?.wage_type || "percent",
        wage_value: D(it.wage_value ?? (it.wage_type ? 0 : cat?.wage_value ?? 0)).toString(),
        profit_pct: it.profit_pct !== undefined && it.profit_pct !== null && it.profit_pct !== "" ? D(it.profit_pct).toString() : null,
        stone_desc: it.stone_desc?.trim() || null,
        stone_price: D(it.stone_price ?? 0).toString(),
        supplier_id: supplierId,
        ownership: it.ownership === "consignment" ? "consignment" : "own",
        status: "in_stock",
        warehouse_id: wh,
        cost: it.cost !== undefined && it.cost !== null && it.cost !== "" ? D(it.cost).toString() : null,
        notes: it.notes?.trim() || null,
        origin: ctx.cfg.origin,
      });
    }
    await insertMany(tx, "tz_gold_items", rows);
    await audit(tx, ctx, "create", "gold_item", null, `ساخت ${rows.length} اتیکت`);
    const ids = rows.map((r) => r.id as string);
    const items = await tx.query(
      `select i.*, round(i.net_weight * i.fineness / 750, 3) as weight750, c.name as category_name
       from tz_gold_items i left join tz_gold_categories c on c.id = i.category_id
       where i.id = any($1::uuid[]) order by length(i.tag_no), i.tag_no`,
      [`{${ids.join(",")}}`],
    );
    return { count: rows.length, ids, tags: rows.map((r) => r.tag_no as string), items };
  });
}

/** Reserve a piece for a customer (or release it). */
export async function setReserved(ctx: Ctx, id: string, reserved: boolean, note?: string | null) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const it = await tx.one<GoldItemRow>(`select * from tz_gold_items where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!it) throw notFound("جنس پیدا نشد");
    if (reserved && it.status !== "in_stock") throw conflict(`این جنس «${ITEM_STATUS_TITLES[it.status] ?? it.status}» است و رزرو نمی‌شود`);
    if (!reserved && it.status !== "reserved") throw conflict("این جنس رزرو نیست");
    return updateRow(tx, "tz_gold_items", { id, org_id: ctx.org.id }, {
      status: reserved ? "reserved" : "in_stock",
      notes: note !== undefined ? note?.trim() || it.notes : it.notes,
      origin: ctx.cfg.origin,
    });
  });
}

export async function defaultWarehouse(q: Queryable, orgId: string): Promise<string | null> {
  const r = await q.one<{ id: string }>(
    `select id from tz_warehouses where org_id = $1 and deleted_at is null and is_active order by length(code), code limit 1`,
    [orgId],
  );
  return r?.id ?? null;
}

// ---------------------------------------------------------------- coins

export interface CoinRow {
  id: string;
  code: string;
  name: string;
  gold_weight: string | null;
  fineness: string | null;
  sku: string | null;
  purchase_price: string | null;
  qty: string;
  value: string;
  avg_cost: string | null;
  key: string | null;
  price: string | null;
}

/** Coin items with stock on hand, average cost and today's price from the rate board. */
export async function listCoins(q: Queryable, orgId: string, asOf?: string | null): Promise<CoinRow[]> {
  const rows = await q.query<Omit<CoinRow, "key" | "price" | "avg_cost">>(
    `select i.id, i.code, i.name, i.gold_weight, i.fineness, i.sku, i.purchase_price,
            coalesce(sum(m.qty), 0) as qty, coalesce(sum(m.value), 0) as value
     from tz_items i
     left join tz_stock_moves m on m.item_id = i.id and m.org_id = i.org_id ${asOf ? "and m.date <= $2" : ""}
     where i.org_id = $1 and i.kind = 'coin' and i.deleted_at is null
     group by i.id order by i.code`,
    asOf ? [orgId, asOf] : [orgId],
  );
  const rate = await latestRate(q, orgId);
  return rows.map((r) => {
    const key = coinKey(r);
    const qty = D(r.qty);
    return {
      ...r,
      qty: qty.toString(),
      value: D(r.value).toString(),
      avg_cost: qty.gt(0) ? D(r.value).div(qty).toDecimalPlaces(0).toString() : null,
      key,
      price: key && rate?.coins?.[key] ? String(rate.coins[key]) : null,
    };
  });
}

/** Stock and average cost of one coin before a document (its own moves excluded). */
export async function coinStock(tx: Tx, orgId: string, itemId: string, date: string, excludeDocId: string) {
  const r = await tx.one<{ q: string; v: string }>(
    `select coalesce(sum(qty), 0) as q, coalesce(sum(value), 0) as v from tz_stock_moves
     where org_id = $1 and item_id = $2 and date <= $3 and source_id <> $4`,
    [orgId, itemId, date, excludeDocId],
  );
  const qty = D(r?.q ?? 0);
  const value = D(r?.v ?? 0);
  return { qty, value, avg: qty.gt(0) ? value.div(qty) : null };
}

/**
 * Refuses a change that leaves any of the coins with negative stock at the end of a day on or
 * after `fromDate` (a back-dated sale, or cancelling a purchase whose coins were sold later).
 */
export async function assertCoinStock(tx: Tx, orgId: string, itemIds: string[], fromDate: string) {
  for (const itemId of new Set(itemIds.filter(Boolean))) {
    const r = await tx.one<{ date: string; bal: string }>(
      `select date, bal from (
         select date, sum(q) over (order by date) as bal
         from (select date, sum(qty) as q from tz_stock_moves where org_id = $1 and item_id = $2 group by date) d
       ) b where date >= $3 and bal < 0 order by date limit 1`,
      [orgId, itemId, fromDate],
    );
    if (!r) continue;
    const name = (await tx.one<{ name: string }>(`select name from tz_items where id = $1 and org_id = $2`, [itemId, orgId]))?.name ?? "";
    throw bad(`موجودی «${name}» در تاریخ ${faDigits(formatJalali(String(r.date).slice(0, 10)))} کافی نیست (${faDigits(D(r.bal).toString())} عدد)؛ سندهای بعدی این سکه را بررسی کنید`);
  }
}
