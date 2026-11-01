// Stock documents (اسناد انبار): receipts (opening stock or goods received without an invoice),
// issues (consumption), transfers between warehouses, adjustments and stock counts
// (انبارگردانی). Posting writes their stock moves, runs the costing pipeline and posts the
// automatic voucher (type "stock_doc"; transfers have none).
import { z } from "zod";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains, pgArray } from "../../db";
import { insertMany, insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { fiscalYearFor } from "../accounting/fiscal";
import { removeAuto } from "../accounting/vouchers";
import { audit } from "../data/crud";
import { D, Decimal, isNumeric, normalizeDigits } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { faDigits } from "@shared/format";
import { todayISO } from "@shared/jalali";
import {
  SEQ, STOCK_DOC_KINDS, STOCK_DOC_LABEL, checkWarehouses, loadItems, loadParty, moneyDp, newCreatedAt, orgTimezone, unitFactor,
  type StockDocKind,
} from "./common";
import { afterStockChange, deriveCount, replaceMoves, type MoveInput } from "./stock";
import { postStockDocVoucher } from "./posting";

type Dec = ReturnType<typeof D>;

const amount = z.union([z.string().max(40), z.number()]).nullish();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");

export const stockLineSchema = z.object({
  id: uuid.nullish(),
  item_id: z.string().uuid("کالای ردیف را انتخاب کنید"),
  /** receipt/issue/transfer: > 0; adjustment: + surplus, − shortage; count: not used */
  qty: amount,
  unit_id: uuid.nullish(),
  /** receipt / surplus: cost of one unit (empty surplus → the running average) */
  unit_cost: amount,
  /** count: the quantity found */
  counted_qty: amount,
  batch_no: z.string().max(60).nullish(),
  serial_no: z.string().max(60).nullish(),
  expiry_date: isoDate.nullish(),
  description: z.string().max(500).nullish(),
});

export const stockDocSchema = z.object({
  kind: z.enum(STOCK_DOC_KINDS),
  status: z.enum(["draft", "posted"]).optional(),
  no: z.number().int().positive().max(999_999_999).optional(),
  date: isoDate,
  warehouse_id: z.string().uuid("انبار را انتخاب کنید"),
  dest_warehouse_id: uuid.nullish(),
  party_id: uuid.nullish(),
  /** counter account (receipt: default opening balance / payables; issue: misc. expenses; adjustment: gain/loss) */
  account_id: uuid.nullish(),
  detail_id: uuid.nullish(),
  reason: z.string().max(200).nullish(),
  description: z.string().max(2000).nullish(),
  lines: z.array(stockLineSchema).min(1, "سند ردیف ندارد").max(5000, "حداکثر ۵۰۰۰ ردیف"),
});

export type StockDocInput = z.infer<typeof stockDocSchema>;

interface StockDocRow {
  id: string;
  kind: StockDocKind;
  no: number;
  fiscal_year_id: string;
  date: string;
  status: "draft" | "posted";
  warehouse_id: string | null;
  dest_warehouse_id: string | null;
  party_id: string | null;
  account_id: string | null;
  detail_id: string | null;
  reason: string | null;
  description: string | null;
  voucher_id: string | null;
  created_at: string;
}

export interface SavedStockDoc {
  id: string;
  kind: StockDocKind;
  no: number;
  status: string;
  voucher_id: string | null;
}

function dec(v: unknown, label: string): Dec | null {
  if (v === null || v === undefined || v === "") return null;
  if (!isNumeric(v)) throw bad(`${label} باید عدد باشد`);
  return D(v as string);
}

async function loadRow(q: Queryable, orgId: string, id: string): Promise<StockDocRow> {
  const d = await q.one<StockDocRow>(`select * from tz_stock_docs where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!d) throw notFound("سند انبار پیدا نشد");
  return d;
}

export async function saveStockDocTx(tx: Tx, ctx: Ctx, input: StockDocInput, id: string | null): Promise<SavedStockDoc> {
  ctx.need("inventory", "edit");
  const orgId = ctx.org.id;
  const dp = moneyDp(ctx);
  const kind = input.kind;
  const existing = id ? await loadRow(tx, orgId, id) : null;
  if (existing) {
    if (existing.kind !== kind) throw bad("نوع سند قابل تغییر نیست");
    if (existing.status === "posted") await fiscalYearFor(tx, orgId, existing.date);
  }
  const status = input.status ?? existing?.status ?? "posted";
  const fy = await fiscalYearFor(tx, orgId, input.date);
  if (kind === "transfer") {
    if (!input.dest_warehouse_id) throw bad("انبار مقصد را انتخاب کنید");
    if (input.dest_warehouse_id === input.warehouse_id) throw bad("انبار مبدأ و مقصد یکی است");
  }
  await checkWarehouses(tx, orgId, [input.warehouse_id, kind === "transfer" ? input.dest_warehouse_id : null]);
  const party = input.party_id ? await loadParty(tx, orgId, input.party_id) : null;
  if (input.account_id) {
    const acc = await tx.one<{ is_postable: boolean }>(`select is_postable from tz_accounts where id = $1 and org_id = $2 and deleted_at is null`, [input.account_id, orgId]);
    if (!acc) throw bad("حساب طرف سند پیدا نشد");
    if (!acc.is_postable) throw bad("حساب طرف سند باید حساب معین باشد");
  }
  if (input.detail_id) {
    const d = await tx.one(`select 1 from tz_details where id = $1 and org_id = $2 and deleted_at is null`, [input.detail_id, orgId]);
    if (!d) throw bad("حساب تفصیلی پیدا نشد");
  }

  const items = await loadItems(tx, orgId, input.lines.map((l) => l.item_id));
  const oldLineIds = existing
    ? new Set((await tx.query<{ id: string }>(`select id from tz_stock_lines where doc_id = $1`, [existing.id])).map((r) => r.id))
    : new Set<string>();
  const seenItems = new Set<string>();
  const usedIds = new Set<string>();
  const lines = input.lines.map((l, i) => {
    const row = `ردیف ${faDigits(i + 1)}`;
    const it = items.get(l.item_id);
    if (!it) throw bad(`${row}: کالا پیدا نشد`);
    if (it.kind !== "goods") throw bad(`${row}: «${it.name}» کالای انبارداری نیست${it.kind === "coin" ? " (سکه در بخش طلا ثبت می‌شود)" : " (خدمت موجودی ندارد)"}`);
    const lineId = l.id && oldLineIds.has(l.id) && !usedIds.has(l.id) ? l.id : uuidv7();
    usedIds.add(lineId);
    const base = {
      id: lineId,
      item: it,
      batch_no: l.batch_no?.trim() || null,
      serial_no: l.serial_no?.trim() || null,
      expiry_date: l.expiry_date ?? null,
      description: l.description?.trim() || null,
    };
    if (kind === "count") {
      if (seenItems.has(it.id)) throw bad(`${row}: «${it.name}» دو بار در برگه‌ی شمارش آمده است`);
      seenItems.add(it.id);
      const counted = dec(l.counted_qty, `${row}: مقدار شمارش‌شده`);
      if (counted === null) throw bad(`${row}: مقدار شمارش‌شده‌ی «${it.name}» را وارد کنید`);
      if (counted.isNeg()) throw bad(`${row}: مقدار شمارش‌شده نمی‌تواند منفی باشد`);
      if (it.unit_decimals === 0 && counted.decimalPlaces() > 0) throw bad(`${row}: مقدار «${it.name}» باید عدد صحیح باشد`);
      return { ...base, qty: D(0), unitId: it.unit_id, factor: "1", baseQty: D(0), unitCost: null as Dec | null, totalCost: null as Dec | null, counted };
    }
    const u = unitFactor(it, l.unit_id);
    const qty = dec(l.qty, `${row}: مقدار`) ?? D(0);
    if (kind === "adjust" ? qty.isZero() : qty.lte(0)) throw bad(`${row}: مقدار «${it.name}» ${kind === "adjust" ? "نمی‌تواند صفر باشد" : "باید بیشتر از صفر باشد"}`);
    if (u.decimals !== null && qty.decimalPlaces() > u.decimals) {
      throw bad(u.decimals === 0 ? `${row}: مقدار «${it.name}» باید عدد صحیح باشد` : `${row}: مقدار «${it.name}» حداکثر ${faDigits(u.decimals)} رقم اعشار دارد`);
    }
    let unitCost: Dec | null = null;
    if (kind === "receipt" || (kind === "adjust" && qty.gt(0))) {
      unitCost = dec(l.unit_cost, `${row}: بهای واحد`);
      if (unitCost === null && kind === "receipt") unitCost = D(it.purchase_price ?? 0).times(D(u.factor));
      if (unitCost && unitCost.isNeg()) throw bad(`${row}: بها نمی‌تواند منفی باشد`);
    }
    const totalCost = unitCost ? qty.abs().times(unitCost).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP) : null;
    return { ...base, qty, unitId: u.unitId, factor: u.factor, baseQty: qty.times(D(u.factor)), unitCost, totalCost, counted: null as Dec | null };
  });

  const no = existing && existing.fiscal_year_id === fy.id ? input.no ?? existing.no : input.no ?? (await nextNo(tx, "tz_stock_docs", orgId, fy.id, kind));
  const root = {
    fiscal_year_id: fy.id,
    kind,
    no,
    date: input.date,
    warehouse_id: input.warehouse_id,
    dest_warehouse_id: kind === "transfer" ? input.dest_warehouse_id ?? null : null,
    party_id: party?.id ?? null,
    account_id: kind === "transfer" ? null : input.account_id ?? null,
    detail_id: kind === "transfer" ? null : input.detail_id ?? null,
    reason: input.reason?.trim() || null,
    description: input.description?.trim() || null,
    status,
    origin: ctx.cfg.origin,
  };
  let docId: string;
  let createdAt: string;
  if (existing) {
    await updateRow(tx, "tz_stock_docs", { id: existing.id, org_id: orgId }, root, "id");
    docId = existing.id;
    createdAt = existing.created_at;
  } else {
    docId = uuidv7();
    createdAt = newCreatedAt();
    await insertRow(tx, "tz_stock_docs", { id: docId, org_id: orgId, created_by: ctx.user.id, created_at: createdAt, ...root }, "id");
  }
  await tx.query(`delete from tz_stock_lines where doc_id = $1`, [docId]);
  await insertMany(
    tx,
    "tz_stock_lines",
    lines.map((l, i) => ({
      id: l.id,
      doc_id: docId,
      org_id: orgId,
      line_no: i + 1,
      item_id: l.item.id,
      qty: l.qty.toString(),
      unit_id: l.unitId,
      unit_factor: l.factor,
      base_qty: l.baseQty.toString(),
      unit_cost: l.unitCost?.toString() ?? null,
      total_cost: l.totalCost?.toString() ?? null,
      counted_qty: l.counted?.toString() ?? null,
      system_qty: null,
      batch_no: l.batch_no,
      serial_no: l.serial_no,
      expiry_date: l.expiry_date,
      description: l.description,
    })),
  );

  const moves: MoveInput[] = [];
  if (status === "posted" && kind !== "count") {
    for (const l of lines) {
      const common = { item_id: l.item.id, warehouse_id: input.warehouse_id, date: input.date, source_line_id: l.id, batch_no: l.batch_no, serial_no: l.serial_no, created_at: createdAt };
      const base = l.baseQty;
      if (kind === "receipt" || (kind === "adjust" && base.gt(0) && l.totalCost)) {
        moves.push({ ...common, seq: SEQ.in, qty: base.toString(), unit_cost: l.totalCost!.div(base).toDecimalPlaces(6).toString(), value: l.totalCost!.toString(), fixed_cost: true });
      } else if (kind === "adjust" && base.gt(0)) {
        moves.push({ ...common, seq: SEQ.in, qty: base.toString(), unit_cost: "0", value: "0", fixed_cost: false });
      } else if (kind === "transfer") {
        moves.push({ ...common, seq: SEQ.transfer, qty: base.neg().toString(), unit_cost: "0", value: "0", fixed_cost: false });
        moves.push({ ...common, warehouse_id: input.dest_warehouse_id!, seq: SEQ.transfer, qty: base.toString(), unit_cost: "0", value: "0", fixed_cost: false });
      } else {
        // issue, or a shortage in an adjustment: at the running average
        moves.push({ ...common, seq: SEQ.out, qty: (base.gt(0) ? base.neg() : base).toString(), unit_cost: "0", value: "0", fixed_cost: false });
      }
    }
  }
  const touches = await replaceMoves(tx, orgId, "stock_doc", docId, moves);
  if (kind === "count") {
    const r = await deriveCount(tx, ctx, { id: docId, date: input.date, created_at: createdAt, warehouse_id: input.warehouse_id }, undefined, { writeMoves: status === "posted" });
    touches.push(...r.touches);
  }
  await afterStockChange(tx, ctx, touches, { type: "stock_doc", id: docId });
  const voucherId = await postStockDocVoucher(tx, ctx, docId);
  await tx.query(`update tz_stock_docs set voucher_id = $2 where id = $1`, [docId, voucherId]);
  await audit(tx, ctx, existing ? "update" : "create", "stock_doc", docId, `${STOCK_DOC_LABEL[kind]} ${no}`, { status });
  return { id: docId, kind, no, status, voucher_id: voucherId };
}

export const createStockDoc = (ctx: Ctx, input: StockDocInput) => ctx.write((tx) => saveStockDocTx(tx, ctx, input, null));
export const updateStockDoc = (ctx: Ctx, id: string, input: StockDocInput) => ctx.write((tx) => saveStockDocTx(tx, ctx, input, id));

async function storedInput(tx: Tx, d: StockDocRow): Promise<StockDocInput> {
  const lines = await tx.query<Record<string, any>>(`select * from tz_stock_lines where doc_id = $1 order by line_no`, [d.id]);
  return {
    kind: d.kind,
    status: d.status,
    no: d.no,
    date: d.date,
    warehouse_id: d.warehouse_id!,
    dest_warehouse_id: d.dest_warehouse_id,
    party_id: d.party_id,
    account_id: d.account_id,
    detail_id: d.detail_id,
    reason: d.reason,
    description: d.description,
    lines: lines.map((l) => ({
      id: l.id,
      item_id: l.item_id,
      qty: l.qty,
      unit_id: l.unit_id,
      unit_cost: l.unit_cost,
      counted_qty: l.counted_qty,
      batch_no: l.batch_no,
      serial_no: l.serial_no,
      expiry_date: l.expiry_date,
      description: l.description,
    })),
  };
}

export async function setStockDocStatus(ctx: Ctx, id: string, target: "posted" | "draft"): Promise<SavedStockDoc> {
  return ctx.write(async (tx) => {
    const d = await loadRow(tx, ctx.org.id, id);
    ctx.need("inventory", "edit");
    if (d.status === target) return { id: d.id, kind: d.kind, no: d.no, status: d.status, voucher_id: d.voucher_id };
    if (target === "posted") return saveStockDocTx(tx, ctx, { ...(await storedInput(tx, d)), status: "posted" }, d.id);
    await fiscalYearFor(tx, ctx.org.id, d.date);
    const touches = await replaceMoves(tx, ctx.org.id, "stock_doc", d.id, []);
    await tx.query(`update tz_stock_docs set status = 'draft', voucher_id = null, origin = $2 where id = $1`, [d.id, ctx.cfg.origin]);
    await afterStockChange(tx, ctx, touches, { type: "stock_doc", id: d.id });
    await removeAuto(tx, ctx.org.id, "stock_doc", d.id);
    await audit(tx, ctx, "unpost", "stock_doc", d.id, `${STOCK_DOC_LABEL[d.kind]} ${d.no}`);
    return { id: d.id, kind: d.kind, no: d.no, status: "draft", voucher_id: null };
  });
}

export async function deleteStockDoc(ctx: Ctx, id: string) {
  return ctx.write(async (tx) => {
    const d = await loadRow(tx, ctx.org.id, id);
    ctx.need("inventory", "full");
    if (d.status === "posted") await fiscalYearFor(tx, ctx.org.id, d.date);
    const touches = await replaceMoves(tx, ctx.org.id, "stock_doc", d.id, []);
    await removeAuto(tx, ctx.org.id, "stock_doc", d.id);
    await tx.query(`update tz_stock_docs set deleted_at = now(), voucher_id = null, origin = $2 where id = $1`, [d.id, ctx.cfg.origin]);
    await afterStockChange(tx, ctx, touches, { type: "stock_doc", id: d.id });
    await audit(tx, ctx, "delete", "stock_doc", d.id, `${STOCK_DOC_LABEL[d.kind]} ${d.no}`);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- read

const VALUE_SQL = `(select coalesce(sum(case when m.qty > 0 then m.value else 0 end), 0) from tz_stock_moves m where m.source_id = d.id) as value_in,
  (select coalesce(sum(case when m.qty < 0 then -m.value else 0 end), 0) from tz_stock_moves m where m.source_id = d.id) as value_out`;

export async function listStockDocs(ctx: Ctx, q: Record<string, string | undefined>) {
  ctx.need("inventory", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["d.org_id = $1", "d.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replaceAll("?", `$${params.length}`));
  };
  const kinds = (q.kind ?? "").split(",").filter((k) => (STOCK_DOC_KINDS as readonly string[]).includes(k));
  if (kinds.length) add("d.kind = any(?::text[])", pgArray(kinds));
  if (q.fiscal_year_id && isUuid(q.fiscal_year_id)) add("d.fiscal_year_id = ?", q.fiscal_year_id);
  if (q.status) add("d.status = ?", q.status);
  if (q.from) add("d.date >= ?", q.from);
  if (q.to) add("d.date <= ?", q.to);
  if (q.warehouse_id && isUuid(q.warehouse_id)) add("(d.warehouse_id = ? or d.dest_warehouse_id = ?)", q.warehouse_id);
  if (q.item_id && isUuid(q.item_id)) add("exists (select 1 from tz_stock_lines l where l.doc_id = d.id and l.item_id = ?)", q.item_id);
  if (q.q?.trim()) {
    const s = normalizeDigits(q.q.trim());
    if (/^\d{1,9}$/.test(s)) add("d.no = ?", Number(s));
    else add("(d.description ilike ? or d.reason ilike ? or p.name ilike ?)", likeContains(s));
  }
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const size = Math.min(500, Math.max(1, Number(q.size ?? 50) || 50));
  const sort = q.sort === "no" ? "d.no" : "d.date";
  const dir = q.dir === "asc" ? "asc" : "desc";
  const where = cond.join(" and ");
  const total = await ctx.db.one<{ n: number }>(`select count(*)::int as n from tz_stock_docs d left join tz_parties p on p.id = d.party_id where ${where}`, params);
  const rows = await ctx.db.query(
    `select d.id, d.kind, d.no, d.date, d.status, d.warehouse_id, w.name as warehouse_name, d.dest_warehouse_id, w2.name as dest_warehouse_name,
            d.party_id, p.name as party_name, d.description, d.reason, d.voucher_id, d.created_at,
            (select count(*)::int from tz_stock_lines l where l.doc_id = d.id) as line_count, ${VALUE_SQL}
     from tz_stock_docs d
     left join tz_warehouses w on w.id = d.warehouse_id
     left join tz_warehouses w2 on w2.id = d.dest_warehouse_id
     left join tz_parties p on p.id = d.party_id
     where ${where}
     order by ${sort} ${dir}, d.no ${dir}, d.created_at ${dir}
     limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { rows, total: total?.n ?? 0, page, size };
}

export async function getStockDoc(ctx: Ctx, id: string) {
  ctx.need("inventory", "view");
  const d = await ctx.db.one<Record<string, any>>(
    `select d.*, w.name as warehouse_name, w2.name as dest_warehouse_name, p.name as party_name, a.code as account_code, a.name as account_name,
            dt.name as detail_name, v.no as voucher_no, u.full_name as created_by_name, ${VALUE_SQL}
     from tz_stock_docs d
     left join tz_warehouses w on w.id = d.warehouse_id
     left join tz_warehouses w2 on w2.id = d.dest_warehouse_id
     left join tz_parties p on p.id = d.party_id
     left join tz_accounts a on a.id = d.account_id
     left join tz_details dt on dt.id = d.detail_id
     left join tz_vouchers v on v.id = d.voucher_id and v.deleted_at is null
     left join tz_users u on u.id = d.created_by
     where d.id = $1 and d.org_id = $2 and d.deleted_at is null`,
    [id, ctx.org.id],
  );
  if (!d) throw notFound("سند انبار پیدا نشد");
  const lines = await ctx.db.query<Record<string, any>>(
    `select l.*, it.code as item_code, it.name as item_name, it.unit_id as item_unit_id, it.unit2_id as item_unit2_id, it.unit2_factor as item_unit2_factor,
            u.name as unit_name, u1.name as main_unit_name, u1.decimals as main_unit_decimals, u2.name as unit2_name, u2.decimals as unit2_decimals,
            (select coalesce(sum(case when m.qty < 0 then -m.value else m.value end), 0) from tz_stock_moves m
              where m.source_id = l.doc_id and m.source_line_id = l.id and (m.qty < 0 or d.kind <> 'transfer')) as cost
     from tz_stock_lines l
     join tz_stock_docs d on d.id = l.doc_id
     left join tz_items it on it.id = l.item_id
     left join tz_units u on u.id = l.unit_id
     left join tz_units u1 on u1.id = it.unit_id
     left join tz_units u2 on u2.id = it.unit2_id
     where l.doc_id = $1 order by l.line_no`,
    [id],
  );
  return { ...d, lines };
}

/** Items of a warehouse with their system quantity, to start a stock count. */
export async function countSheet(ctx: Ctx, q: Record<string, string | undefined>) {
  ctx.need("inventory", "view");
  if (!q.warehouse_id || !isUuid(q.warehouse_id)) throw bad("انبار را انتخاب کنید");
  const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayISO(orgTimezone(ctx));
  const params: unknown[] = [ctx.org.id, q.warehouse_id, date];
  const cond = ["i.org_id = $1", "i.deleted_at is null", "i.is_active", "i.kind = 'goods'"];
  if (q.category_id && isUuid(q.category_id)) {
    params.push(q.category_id);
    cond.push(`i.category_id = $${params.length}`);
  }
  if (q.all !== "1") cond.push("coalesce(s.q, 0) <> 0");
  const rows = await ctx.db.query(
    `select i.id as item_id, i.code, i.name, i.barcode, u.name as unit_name, u.decimals as unit_decimals, coalesce(s.q, 0) as system_qty
     from tz_items i
     left join tz_units u on u.id = i.unit_id
     left join (select item_id, sum(qty) as q from tz_stock_moves where org_id = $1 and warehouse_id = $2 and date <= $3 group by item_id) s on s.item_id = i.id
     where ${cond.join(" and ")}
     order by length(i.code), i.code
     limit 5000`,
    params,
  );
  return { date, rows };
}
