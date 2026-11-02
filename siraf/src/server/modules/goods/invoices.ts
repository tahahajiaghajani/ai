// Commercial documents: sales and purchase invoices, their returns, quotes and orders.
//
// Saving computes every amount on the server (calc.ts), snapshots the buyer, and — for posted
// invoices — writes the stock moves, runs the costing pipeline and posts the automatic voucher,
// all in one transaction. Quotes and orders never post; they are converted into invoices.
// Returns reference their original invoice and default to its prices; a sale return takes the
// original cost of the goods back into stock.
import { z } from "zod";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains, pgArray } from "../../db";
import { insertMany, insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { fiscalYearFor } from "../accounting/fiscal";
import { removeAuto } from "../accounting/vouchers";
import { audit } from "../data/crud";
import { D, isNumeric, normalizeDigits } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { faDigits, formatMoney, formatQty } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { calcInvoice, landedCosts } from "./calc";
import {
  ALLOCATED_SQL, INVOICE_KINDS, INVOICE_LABEL, POSTABLE_KINDS, RETURN_OF, SEQ, allocatedFor, buyerSnapshot, checkWarehouses,
  defaultVatPct, defaultWarehouse, kindArea, loadItems, loadParty, moneyDp, newCreatedAt, orgTimezone, stockDirection,
  unitFactor, walkinParty, type InvoiceKind, type ItemRow,
} from "./common";
import { lookupPrices } from "./prices";
import { afterStockChange, replaceMoves, type MoveInput } from "./stock";
import { postInvoiceVoucher } from "./posting";

type Dec = ReturnType<typeof D>;

// ---------------------------------------------------------------- input

const amount = z.union([z.string().max(40), z.number()]).nullish();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");

export const invoiceLineSchema = z.object({
  id: uuid.nullish(),
  item_id: z.string().uuid("کالا یا خدمت ردیف را انتخاب کنید"),
  description: z.string().max(500).nullish(),
  qty: z.union([z.string().max(40), z.number()]),
  unit_id: uuid.nullish(),
  /** empty → the price of the party's price list / the item's price / the original invoice */
  unit_price: amount,
  discount_pct: amount,
  discount: amount,
  /** empty → the item's rate, else the business default */
  vat_pct: amount,
  warehouse_id: uuid.nullish(),
  batch_no: z.string().max(60).nullish(),
  serial_no: z.string().max(60).nullish(),
});

export const invoiceSchema = z.object({
  kind: z.enum(INVOICE_KINDS),
  status: z.enum(["draft", "posted"]).optional(),
  no: z.number().int().positive().max(999_999_999).optional(),
  date: isoDate,
  due_date: isoDate.nullish(),
  party_id: uuid.nullish(),
  warehouse_id: uuid.nullish(),
  price_list_id: uuid.nullish(),
  salesperson_id: uuid.nullish(),
  ref_no: z.string().max(60).nullish(),
  ref_invoice_id: uuid.nullish(),
  discount: amount,
  discount_pct: amount,
  additions: amount,
  deductions: amount,
  settlement: z.enum(["cash", "credit", "mixed"]).nullish(),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(4000).nullish(),
  buyer: z.record(z.string(), z.union([z.string().max(400), z.null()])).nullish(),
  lines: z.array(invoiceLineSchema).min(1, "فاکتور ردیف ندارد").max(1000, "حداکثر ۱۰۰۰ ردیف"),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;

export interface InvoiceRow {
  id: string;
  org_id: string;
  fiscal_year_id: string;
  kind: InvoiceKind;
  no: number;
  ref_no: string | null;
  date: string;
  due_date: string | null;
  party_id: string | null;
  warehouse_id: string | null;
  price_list_id: string | null;
  salesperson_id: string | null;
  status: "draft" | "posted" | "cancelled";
  subtotal: string;
  line_discount: string;
  discount: string;
  additions: string;
  deductions: string;
  tax: string;
  total: string;
  settlement: string | null;
  notes: string | null;
  terms: string | null;
  ref_invoice_id: string | null;
  voucher_id: string | null;
  buyer: Record<string, string | null>;
  moadian: Record<string, unknown>;
  extra: Record<string, any>;
  created_at: string;
  deleted_at: string | null;
}

export interface SavedInvoice {
  id: string;
  kind: InvoiceKind;
  no: number;
  status: string;
  total: string;
  voucher_id: string | null;
}

function dec(v: unknown, label: string): Dec | null {
  if (v === null || v === undefined || v === "") return null;
  if (!isNumeric(v)) throw bad(`${label} باید عدد باشد`);
  return D(v as string);
}

function decimalsOf(d: Dec): number {
  return d.decimalPlaces();
}

const BUYER_KEYS = ["name", "kind", "national_id", "economic_code", "registration_no", "postal_code", "address", "city", "province", "phone"];

function cleanBuyer(b: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of BUYER_KEYS) {
    const v = b[k];
    if (v === null || v === undefined) continue;
    let s = String(v).trim();
    if (["national_id", "economic_code", "registration_no", "postal_code", "phone"].includes(k)) s = normalizeDigits(s).replace(/[\s-]/g, "");
    if (s) out[k] = s.slice(0, 400);
  }
  return out;
}

async function loadRow(q: Queryable, orgId: string, id: string): Promise<InvoiceRow> {
  const inv = await q.one<InvoiceRow>(`select * from tz_invoices where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!inv) throw notFound("فاکتور پیدا نشد");
  return inv;
}

/** Base quantity per item of the posted returns of an invoice (optionally without one return). */
async function returnedQty(q: Queryable, orgId: string, invoiceId: string, exceptId?: string | null): Promise<Map<string, Dec>> {
  const rows = await q.query<{ item_id: string; q: string }>(
    `select l.item_id, sum(l.qty * l.unit_factor) as q from tz_invoice_lines l join tz_invoices r on r.id = l.invoice_id
     where r.org_id = $1 and r.ref_invoice_id = $2 and r.deleted_at is null and r.status = 'posted' and r.id <> $3
     group by l.item_id`,
    [orgId, invoiceId, exceptId ?? "00000000-0000-0000-0000-000000000000"],
  );
  return new Map(rows.map((r) => [r.item_id, D(r.q)]));
}

interface ResolvedLine {
  id: string;
  item: ItemRow;
  qty: Dec;
  unitId: string | null;
  factor: string;
  base: Dec;
  unit_price: Dec;
  discount_pct: Dec;
  discount: Dec;
  vat_pct: Dec;
  warehouse_id: string | null;
  description: string | null;
  batch_no: string | null;
  serial_no: string | null;
}

// ---------------------------------------------------------------- save

export async function saveInvoiceTx(
  tx: Tx,
  ctx: Ctx,
  input: InvoiceInput,
  id: string | null,
  opts: { extra?: Record<string, unknown> } = {},
): Promise<SavedInvoice> {
  const kind = input.kind;
  ctx.need(kindArea(kind), "edit");
  const orgId = ctx.org.id;
  const dp = moneyDp(ctx);
  const existing = id ? await loadRow(tx, orgId, id) : null;
  if (existing) {
    if (existing.kind !== kind) throw bad("نوع سند قابل تغییر نیست");
    if (existing.status === "cancelled") throw conflict("سند ابطال‌شده قابل ویرایش نیست");
    if (existing.status === "posted") await fiscalYearFor(tx, orgId, existing.date);
  }
  const postable = POSTABLE_KINDS.has(kind);
  const status = input.status ?? (existing ? existing.status : postable ? "posted" : "draft");
  if (status === "posted" && !postable) throw bad("پیش‌فاکتور و سفارش ثبت قطعی ندارند؛ آن را به فاکتور تبدیل کنید");
  const fy = await fiscalYearFor(tx, orgId, input.date);
  if (input.due_date && input.due_date < input.date) throw bad(kind === "quote" ? "تاریخ اعتبار نمی‌تواند قبل از تاریخ سند باشد" : "سررسید نمی‌تواند قبل از تاریخ فاکتور باشد");

  // the original invoice of a return
  const refKind = RETURN_OF[kind];
  let ref: InvoiceRow | null = null;
  if (refKind && input.ref_invoice_id) {
    ref = await tx.one<InvoiceRow>(`select * from tz_invoices where id = $1 and org_id = $2 and deleted_at is null`, [input.ref_invoice_id, orgId]);
    if (!ref) throw notFound("فاکتور اصلی پیدا نشد");
    if (ref.kind !== refKind) throw bad(`سند مرجع باید ${INVOICE_LABEL[refKind]} باشد`);
    if (ref.status !== "posted") throw bad("فاکتور اصلی ثبت قطعی نشده است");
    if (input.date < ref.date) throw bad("تاریخ برگشت نمی‌تواند قبل از تاریخ فاکتور اصلی باشد");
  }

  // party (walk-in customer when empty)
  const partyId = input.party_id ?? ref?.party_id ?? null;
  if (ref && partyId !== ref.party_id) throw bad("طرف حساب برگشت باید همان طرف حساب فاکتور اصلی باشد");
  const party = partyId ? await loadParty(tx, orgId, partyId) : await walkinParty(tx, orgId);
  if (input.salesperson_id) await loadParty(tx, orgId, input.salesperson_id);
  if (input.price_list_id) {
    const pl = await tx.one(`select 1 from tz_price_lists where id = $1 and org_id = $2 and deleted_at is null`, [input.price_list_id, orgId]);
    if (!pl) throw bad("فهرست قیمت پیدا نشد");
  }

  // lines: items, units, default prices and VAT
  const items = await loadItems(tx, orgId, input.lines.map((l) => l.item_id));
  const oldLineIds = existing
    ? new Set((await tx.query<{ id: string }>(`select id from tz_invoice_lines where invoice_id = $1`, [existing.id])).map((r) => r.id))
    : new Set<string>();
  const refLines = ref
    ? await tx.query<{ item_id: string; unit_price: string; unit_factor: string; vat_pct: string }>(
        `select item_id, unit_price, unit_factor, vat_pct from tz_invoice_lines where invoice_id = $1 order by line_no`,
        [ref.id],
      )
    : [];
  const refByItem = new Map<string, { unit_price: string; unit_factor: string; vat_pct: string }>();
  for (const r of refLines) if (!refByItem.has(r.item_id)) refByItem.set(r.item_id, r);
  const needPrice = input.lines.filter((l) => l.unit_price === null || l.unit_price === undefined || l.unit_price === "");
  const looked = needPrice.length && !ref
    ? await lookupPrices(tx, ctx, { kind, partyId: party.id, priceListId: input.price_list_id, date: input.date, items: needPrice.map((l) => ({ item_id: l.item_id, qty: String(l.qty) })) })
    : new Map();
  const vatDefault = defaultVatPct(ctx);
  const usedIds = new Set<string>();
  const resolved: ResolvedLine[] = input.lines.map((l, i) => {
    const row = `ردیف ${faDigits(i + 1)}`;
    const it = items.get(l.item_id);
    if (!it) throw bad(`${row}: کالا یا خدمت پیدا نشد`);
    if (it.kind === "coin") throw bad(`${row}: «${it.name}» سکه است؛ خرید و فروش سکه از بخش طلا و جواهر انجام می‌شود`);
    if (it.kind === "bar") throw bad(`${row}: «${it.name}» مدل شمش است؛ خرید و فروش شمش از بخش طلا و جواهر انجام می‌شود`);
    const refLine = refByItem.get(it.id);
    if (ref && !refLine) throw bad(`${row}: «${it.name}» در فاکتور اصلی نیست`);
    const u = unitFactor(it, l.unit_id);
    const qty = dec(l.qty, `${row}: مقدار`) ?? D(0);
    if (qty.lte(0)) throw bad(`${row}: مقدار «${it.name}» باید بیشتر از صفر باشد`);
    if (u.decimals !== null && decimalsOf(qty) > u.decimals) {
      throw bad(u.decimals === 0 ? `${row}: مقدار «${it.name}» باید عدد صحیح باشد` : `${row}: مقدار «${it.name}» حداکثر ${faDigits(u.decimals)} رقم اعشار دارد`);
    }
    let price = dec(l.unit_price, `${row}: قیمت`);
    if (price === null) {
      if (refLine) price = D(refLine.unit_price).div(D(refLine.unit_factor)).times(D(u.factor));
      else {
        const p = looked.get(it.id)?.price;
        price = p !== null && p !== undefined ? D(p).times(D(u.factor)) : D(0);
      }
      price = price.toDecimalPlaces(dp);
    }
    if (price.isNeg()) throw bad(`${row}: قیمت نمی‌تواند منفی باشد`);
    const pct = dec(l.discount_pct, `${row}: درصد تخفیف`) ?? D(0);
    if (pct.isNeg() || pct.gt(100)) throw bad(`${row}: درصد تخفیف باید بین ۰ تا ۱۰۰ باشد`);
    const disc = pct.gt(0) ? D(0) : dec(l.discount, `${row}: تخفیف`) ?? D(0);
    if (disc.isNeg()) throw bad(`${row}: تخفیف نمی‌تواند منفی باشد`);
    const vat = dec(l.vat_pct, `${row}: نرخ مالیات`) ?? D(refLine?.vat_pct ?? it.vat_pct ?? vatDefault);
    if (vat.isNeg() || vat.gt(100)) throw bad(`${row}: نرخ مالیات بر ارزش افزوده معتبر نیست`);
    const lineId = l.id && oldLineIds.has(l.id) && !usedIds.has(l.id) ? l.id : uuidv7();
    usedIds.add(lineId);
    return {
      id: lineId,
      item: it,
      qty,
      unitId: u.unitId,
      factor: u.factor,
      base: qty.times(D(u.factor)),
      unit_price: price,
      discount_pct: pct,
      discount: disc,
      vat_pct: vat,
      warehouse_id: l.warehouse_id ?? null,
      description: l.description?.trim() || null,
      batch_no: l.batch_no?.trim() || null,
      serial_no: l.serial_no?.trim() || null,
    };
  });

  // header amounts
  const hpct = dec(input.discount_pct, "درصد تخفیف فاکتور") ?? D(0);
  if (hpct.isNeg() || hpct.gt(100)) throw bad("درصد تخفیف فاکتور باید بین ۰ تا ۱۰۰ باشد");
  for (const [v, label] of [[input.discount, "تخفیف فاکتور"], [input.additions, "اضافات"], [input.deductions, "کسورات"]] as const) {
    const d = dec(v, label);
    if (d && d.isNeg()) throw bad(`${label} نمی‌تواند منفی باشد`);
  }
  const calc = calcInvoice({
    lines: resolved.map((r) => ({ qty: r.qty, unit_price: r.unit_price, discount_pct: r.discount_pct, discount: r.discount, vat_pct: r.vat_pct })),
    discount: hpct.gt(0) ? 0 : input.discount,
    discount_pct: hpct,
    additions: input.additions,
    deductions: input.deductions,
    dp,
  });
  calc.lines.forEach((c, i) => {
    if (D(c.line_discount).gt(D(c.gross))) throw bad(`ردیف ${faDigits(i + 1)}: تخفیف از مبلغ ردیف بیشتر است`);
  });
  if (calc.lines.some((c) => D(c.net).isNeg())) throw bad("تخفیف فاکتور از جمع ردیف‌ها بیشتر است");
  if (D(calc.total).isNeg()) throw bad("مبلغ نهایی فاکتور منفی می‌شود؛ کسورات را بررسی کنید");

  // lowest allowed sale price (per main unit, after the line discount)
  if (kind === "sale" || kind === "quote" || kind === "sale_order") {
    resolved.forEach((r, i) => {
      if (!r.item.min_sale_price) return;
      const unitNet = D(calc.lines[i].gross).minus(D(calc.lines[i].line_discount)).div(r.base);
      if (unitNet.lt(D(r.item.min_sale_price))) {
        throw bad(`ردیف ${faDigits(i + 1)}: قیمت فروش «${r.item.name}» (${formatMoney(unitNet, dp)}) از کمترین قیمت مجاز (${formatMoney(r.item.min_sale_price, dp)}) کمتر است`);
      }
    });
  }

  // purchases: inventory cost of each line (additions/deductions spread over goods)
  const landed = kind === "purchase" || kind === "purchase_return"
    ? landedCosts(calc.lines.map((c) => c.net), resolved.map((r) => r.item.kind === "goods"), calc.additions, calc.deductions, dp)
    : null;
  if (landed?.some((x) => D(x).isNeg())) throw bad("کسورات فاکتور از مبلغ ردیف‌ها بیشتر است");

  // returns: never more than what is left of the original
  if (ref && status === "posted") {
    const orig = new Map<string, Dec>();
    for (const r of await tx.query<{ item_id: string; q: string }>(`select item_id, sum(qty * unit_factor) as q from tz_invoice_lines where invoice_id = $1 group by item_id`, [ref.id])) orig.set(r.item_id, D(r.q));
    const done = await returnedQty(tx, orgId, ref.id, existing?.id);
    const mine = new Map<string, Dec>();
    for (const r of resolved) mine.set(r.item.id, (mine.get(r.item.id) ?? D(0)).plus(r.base));
    for (const [itemId, q] of mine) {
      const left = (orig.get(itemId) ?? D(0)).minus(done.get(itemId) ?? D(0));
      if (q.gt(left)) throw bad(`مقدار برگشتی «${items.get(itemId)?.name}» (${formatQty(q)}) بیشتر از باقی‌مانده‌ی فاکتور اصلی (${formatQty(left)}) است`);
    }
  }

  // an original with posted returns must still cover them
  if (existing && (kind === "sale" || kind === "purchase")) {
    const rets = await tx.query<{ id: string; date: string }>(
      `select id, date from tz_invoices where org_id = $1 and ref_invoice_id = $2 and deleted_at is null and status = 'posted' order by date`,
      [orgId, existing.id],
    );
    if (rets.length) {
      if (status !== "posted") throw conflict("این فاکتور برگشتی ثبت‌شده دارد؛ ابتدا برگشتی‌ها را حذف کنید");
      if (input.date > rets[0].date) throw bad("تاریخ فاکتور نمی‌تواند بعد از تاریخ برگشتی‌های آن باشد");
      const done = await returnedQty(tx, orgId, existing.id);
      const mine = new Map<string, Dec>();
      for (const r of resolved) mine.set(r.item.id, (mine.get(r.item.id) ?? D(0)).plus(r.base));
      for (const [itemId, q] of done) {
        if (q.gt(mine.get(itemId) ?? D(0))) throw bad(`از «${items.get(itemId)?.name ?? "یکی از کالاها"}» ${formatQty(q)} برگشت خورده است؛ مقدار فاکتور نمی‌تواند کمتر شود`);
      }
    }
  }

  // receipts/payments already settled against it
  if (existing) {
    const alloc = D(await allocatedFor(tx, orgId, existing.id));
    if (alloc.gt(0)) {
      if (postable && status !== "posted") throw conflict("برای این فاکتور دریافت/پرداخت ثبت شده است؛ ابتدا آن را حذف کنید");
      if (alloc.gt(D(calc.total))) throw bad(`مبلغ فاکتور از دریافت/پرداخت‌های ثبت‌شده (${formatMoney(alloc, dp)}) کمتر می‌شود`);
    }
  }

  // warehouses
  const hasGoods = resolved.some((r) => r.item.kind === "goods");
  const headerWh = input.warehouse_id ?? ref?.warehouse_id ?? existing?.warehouse_id ?? (hasGoods ? await defaultWarehouse(tx, orgId) : null);
  await checkWarehouses(tx, orgId, [headerWh, ...resolved.map((r) => r.warehouse_id)]);

  // number, buyer, extras
  const no = existing && existing.fiscal_year_id === fy.id ? input.no ?? existing.no : input.no ?? (await nextNo(tx, "tz_invoices", orgId, fy.id, kind));
  const snap = buyerSnapshot(party);
  const buyer = input.buyer
    ? { ...snap, ...cleanBuyer(input.buyer) }
    : existing && existing.party_id === party.id && existing.buyer && Object.keys(existing.buyer).length
      ? existing.buyer
      : snap;
  const extra: Record<string, unknown> = { ...(existing?.extra ?? {}), ...(opts.extra ?? {}) };
  if (hpct.gt(0)) extra.discount_pct = hpct.toString();
  else delete extra.discount_pct;

  const root = {
    fiscal_year_id: fy.id,
    kind,
    no,
    ref_no: input.ref_no?.trim() || null,
    date: input.date,
    due_date: input.due_date ?? null,
    party_id: party.id,
    warehouse_id: headerWh,
    price_list_id: input.price_list_id ?? null,
    salesperson_id: input.salesperson_id ?? null,
    status,
    subtotal: calc.subtotal,
    line_discount: calc.line_discount,
    discount: calc.discount,
    additions: calc.additions,
    deductions: calc.deductions,
    tax: calc.tax,
    total: calc.total,
    settlement: input.settlement ?? null,
    notes: input.notes?.trim() || null,
    terms: input.terms?.trim() || null,
    ref_invoice_id: ref?.id ?? null,
    buyer,
    extra,
    origin: ctx.cfg.origin,
  };
  let invId: string;
  let createdAt: string;
  if (existing) {
    await updateRow(tx, "tz_invoices", { id: existing.id, org_id: orgId }, root, "id");
    invId = existing.id;
    createdAt = existing.created_at;
  } else {
    invId = uuidv7();
    createdAt = newCreatedAt();
    await insertRow(tx, "tz_invoices", { id: invId, org_id: orgId, created_by: ctx.user.id, created_at: createdAt, ...root }, "id");
  }
  await tx.query(`delete from tz_invoice_lines where invoice_id = $1`, [invId]);
  await insertMany(
    tx,
    "tz_invoice_lines",
    resolved.map((r, i) => ({
      id: r.id,
      invoice_id: invId,
      org_id: orgId,
      line_no: i + 1,
      item_id: r.item.id,
      description: r.description,
      qty: r.qty.toString(),
      unit_id: r.unitId,
      unit_factor: r.factor,
      unit_price: r.unit_price.toString(),
      discount_pct: r.discount_pct.toString(),
      discount: calc.lines[i].line_discount,
      vat_pct: r.vat_pct.toString(),
      vat: calc.lines[i].vat,
      total: calc.lines[i].total,
      warehouse_id: r.warehouse_id,
      batch_no: r.batch_no,
      serial_no: r.serial_no,
      // purchases: landed inventory cost of the line (sales: cost of goods sold comes from the moves)
      cost: landed ? landed[i] : null,
    })),
  );

  // stock moves → costing pipeline → voucher
  const dir = stockDirection(kind);
  const moves: MoveInput[] = [];
  if (status === "posted" && dir !== 0) {
    resolved.forEach((r, i) => {
      if (r.item.kind !== "goods") return;
      const base = r.base;
      const common = { item_id: r.item.id, warehouse_id: r.warehouse_id ?? headerWh!, date: input.date, source_line_id: r.id, batch_no: r.batch_no, serial_no: r.serial_no, created_at: createdAt };
      if (landed) {
        const cost = D(landed[i]);
        moves.push({
          ...common,
          seq: dir > 0 ? SEQ.in : SEQ.out,
          qty: (dir > 0 ? base : base.neg()).toString(),
          unit_cost: cost.div(base).toDecimalPlaces(6).toString(),
          value: (dir > 0 ? cost : cost.neg()).toString(),
          fixed_cost: true,
        });
      } else {
        // valued by the costing run: sales at the moving average, sale returns at the original cost
        moves.push({
          ...common,
          seq: kind === "sale" || ref ? SEQ.out : SEQ.in,
          qty: (dir > 0 ? base : base.neg()).toString(),
          unit_cost: "0",
          value: "0",
          fixed_cost: false,
        });
      }
    });
  }
  const touches = await replaceMoves(tx, orgId, "invoice", invId, moves);
  await afterStockChange(tx, ctx, touches, { type: "invoice", id: invId });
  const voucherId = await postInvoiceVoucher(tx, ctx, invId);
  await tx.query(`update tz_invoices set voucher_id = $2 where id = $1`, [invId, voucherId]);
  await audit(tx, ctx, existing ? "update" : "create", "invoice", invId, `${INVOICE_LABEL[kind]} ${no}`, { status, total: calc.total });
  return { id: invId, kind, no, status, total: calc.total, voucher_id: voucherId };
}

export const createInvoice = (ctx: Ctx, input: InvoiceInput) => ctx.write((tx) => saveInvoiceTx(tx, ctx, input, null));
export const updateInvoice = (ctx: Ctx, id: string, input: InvoiceInput) => ctx.write((tx) => saveInvoiceTx(tx, ctx, input, id));

/** The stored document as save input (used to re-post and to convert). */
async function storedInput(tx: Tx, inv: InvoiceRow): Promise<InvoiceInput> {
  const lines = await tx.query<Record<string, any>>(`select * from tz_invoice_lines where invoice_id = $1 order by line_no`, [inv.id]);
  const hpct = inv.extra?.discount_pct ? String(inv.extra.discount_pct) : null;
  return {
    kind: inv.kind,
    status: inv.status === "posted" ? "posted" : "draft",
    no: inv.no,
    date: inv.date,
    due_date: inv.due_date,
    party_id: inv.party_id,
    warehouse_id: inv.warehouse_id,
    price_list_id: inv.price_list_id,
    salesperson_id: inv.salesperson_id,
    ref_no: inv.ref_no,
    ref_invoice_id: inv.ref_invoice_id,
    discount: hpct ? null : inv.discount,
    discount_pct: hpct,
    additions: inv.additions,
    deductions: inv.deductions,
    settlement: (inv.settlement as "cash" | "credit" | "mixed" | null) ?? null,
    notes: inv.notes,
    terms: inv.terms,
    buyer: inv.buyer,
    lines: lines.map((l) => ({
      id: l.id,
      item_id: l.item_id,
      description: l.description,
      qty: l.qty,
      unit_id: l.unit_id,
      unit_price: l.unit_price,
      discount_pct: D(l.discount_pct).gt(0) ? l.discount_pct : null,
      discount: D(l.discount_pct).gt(0) ? null : l.discount,
      vat_pct: l.vat_pct,
      warehouse_id: l.warehouse_id,
      batch_no: l.batch_no,
      serial_no: l.serial_no,
    })),
  };
}

// ---------------------------------------------------------------- status, delete, convert

async function assertUnsettled(tx: Tx, ctx: Ctx, inv: InvoiceRow) {
  if (D(await allocatedFor(tx, ctx.org.id, inv.id)).gt(0)) throw conflict("برای این فاکتور دریافت/پرداخت ثبت شده است؛ ابتدا آن را حذف کنید");
  const ret = await tx.one(`select no from tz_invoices where org_id = $1 and ref_invoice_id = $2 and deleted_at is null and status <> 'cancelled' limit 1`, [ctx.org.id, inv.id]);
  if (ret) throw conflict("این فاکتور برگشتی دارد؛ ابتدا برگشتی‌ها را حذف کنید");
}

/** posted ← → draft, or cancelled (ابطال). */
export async function setInvoiceStatus(ctx: Ctx, id: string, target: "posted" | "draft" | "cancelled"): Promise<SavedInvoice> {
  return ctx.write(async (tx) => {
    const inv = await loadRow(tx, ctx.org.id, id);
    ctx.need(kindArea(inv.kind), target === "cancelled" ? "full" : "edit");
    const summary = (status: string): SavedInvoice => ({ id: inv.id, kind: inv.kind, no: inv.no, status, total: inv.total, voucher_id: status === "posted" ? inv.voucher_id : null });
    if (inv.status === target) return summary(target);
    if (target === "posted") {
      if (!POSTABLE_KINDS.has(inv.kind)) throw bad("پیش‌فاکتور و سفارش ثبت قطعی ندارند؛ آن را به فاکتور تبدیل کنید");
      if (inv.status === "cancelled") throw conflict("سند ابطال‌شده قابل ثبت نیست؛ ابتدا آن را به پیش‌نویس برگردانید");
      const input = await storedInput(tx, inv);
      return saveInvoiceTx(tx, ctx, { ...input, status: "posted" }, inv.id);
    }
    if (inv.status === "posted") {
      await fiscalYearFor(tx, ctx.org.id, inv.date);
      await assertUnsettled(tx, ctx, inv);
    }
    const touches = await replaceMoves(tx, ctx.org.id, "invoice", inv.id, []);
    await tx.query(`update tz_invoices set status = $2, voucher_id = null, origin = $3 where id = $1`, [inv.id, target, ctx.cfg.origin]);
    await afterStockChange(tx, ctx, touches, { type: "invoice", id: inv.id });
    await removeAuto(tx, ctx.org.id, "invoice", inv.id);
    await audit(tx, ctx, target === "cancelled" ? "cancel" : "unpost", "invoice", inv.id, `${INVOICE_LABEL[inv.kind]} ${inv.no}`);
    return summary(target);
  });
}

export async function deleteInvoice(ctx: Ctx, id: string) {
  return ctx.write(async (tx) => {
    const inv = await loadRow(tx, ctx.org.id, id);
    ctx.need(kindArea(inv.kind), "full");
    if (inv.status === "posted") await fiscalYearFor(tx, ctx.org.id, inv.date);
    await assertUnsettled(tx, ctx, inv);
    const touches = await replaceMoves(tx, ctx.org.id, "invoice", inv.id, []);
    await removeAuto(tx, ctx.org.id, "invoice", inv.id);
    await tx.query(`update tz_invoices set deleted_at = now(), voucher_id = null, origin = $2 where id = $1`, [inv.id, ctx.cfg.origin]);
    await afterStockChange(tx, ctx, touches, { type: "invoice", id: inv.id });
    // the quote/order it came from becomes open again
    if (inv.extra?.from_id && isUuid(inv.extra.from_id)) {
      await tx.query(
        `update tz_invoices set extra = extra - 'converted_to' - 'converted_kind' - 'converted_no', origin = $3
         where id = $1 and org_id = $2 and extra->>'converted_to' = $4`,
        [inv.extra.from_id, ctx.org.id, ctx.cfg.origin, inv.id],
      );
    }
    await audit(tx, ctx, "delete", "invoice", inv.id, `${INVOICE_LABEL[inv.kind]} ${inv.no}`);
    return { ok: true };
  });
}

const CONVERSIONS: Record<string, InvoiceKind[]> = {
  quote: ["sale", "sale_order"],
  sale_order: ["sale"],
  purchase_order: ["purchase"],
};

/** Turn a quote or order into an invoice (or a quote into a sales order). */
export async function convertInvoice(ctx: Ctx, id: string, body: { kind?: InvoiceKind; date?: string | null; status?: "draft" | "posted" }) {
  return ctx.write(async (tx) => {
    const src = await loadRow(tx, ctx.org.id, id);
    ctx.need(kindArea(src.kind), "view");
    const allowed = CONVERSIONS[src.kind];
    if (!allowed) throw bad("فقط پیش‌فاکتور و سفارش قابل تبدیل است");
    if (src.status === "cancelled") throw conflict("سند ابطال‌شده قابل تبدیل نیست");
    if (src.extra?.converted_to) {
      const done = await tx.one<{ no: number; kind: InvoiceKind }>(`select no, kind from tz_invoices where id = $1 and deleted_at is null`, [src.extra.converted_to]);
      if (done) throw conflict(`این سند قبلاً به ${INVOICE_LABEL[done.kind]} شماره‌ی ${faDigits(done.no)} تبدیل شده است`);
    }
    const target = body.kind ?? allowed[0];
    if (!allowed.includes(target)) throw bad(`${INVOICE_LABEL[src.kind]} به ${INVOICE_LABEL[target]} تبدیل نمی‌شود`);
    const input = await storedInput(tx, src);
    const saved = await saveInvoiceTx(
      tx,
      ctx,
      {
        ...input,
        kind: target,
        no: undefined,
        status: body.status ?? "draft",
        date: body.date ?? todayISO(orgTimezone(ctx)),
        due_date: null,
        lines: input.lines.map((l) => ({ ...l, id: null })),
      },
      null,
      { extra: { from_id: src.id, from_kind: src.kind, from_no: src.no } },
    );
    await tx.query(
      `update tz_invoices set extra = extra || $2::jsonb, origin = $3 where id = $1`,
      [src.id, { converted_to: saved.id, converted_kind: saved.kind, converted_no: saved.no }, ctx.cfg.origin],
    );
    return saved;
  });
}

// ---------------------------------------------------------------- read

const LIST_SORT: Record<string, string> = { no: "i.no", date: "i.date", total: "i.total", party_name: "p.name", due_date: "i.due_date" };

export async function listInvoices(ctx: Ctx, q: Record<string, string | undefined>) {
  const kinds = (q.kind ?? "sale").split(",").filter((k): k is InvoiceKind => (INVOICE_KINDS as readonly string[]).includes(k));
  if (!kinds.length) throw bad("نوع سند معتبر نیست");
  for (const area of new Set(kinds.map(kindArea))) ctx.need(area, "view");
  const params: unknown[] = [ctx.org.id, pgArray(kinds)];
  const cond = ["i.org_id = $1", "i.deleted_at is null", "i.kind = any($2::text[])"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (q.fiscal_year_id && isUuid(q.fiscal_year_id)) add("i.fiscal_year_id = ?", q.fiscal_year_id);
  if (q.from) add("i.date >= ?", q.from);
  if (q.to) add("i.date <= ?", q.to);
  if (q.status) add("i.status = ?", q.status);
  if (q.party_id && isUuid(q.party_id)) add("i.party_id = ?", q.party_id);
  if (q.warehouse_id && isUuid(q.warehouse_id)) add("i.warehouse_id = ?", q.warehouse_id);
  if (q.q?.trim()) {
    const s = normalizeDigits(q.q.trim());
    if (/^\d{1,9}$/.test(s)) {
      params.push(Number(s));
      const n = params.length;
      params.push(likeContains(s));
      cond.push(`(i.no = $${n} or i.ref_no ilike $${params.length} or p.mobile ilike $${params.length})`);
    } else {
      params.push(likeContains(s));
      cond.push(`(p.name ilike $${params.length} or i.ref_no ilike $${params.length} or i.notes ilike $${params.length} or i.buyer->>'name' ilike $${params.length})`);
    }
  }
  if (q.open === "1") cond.push(`i.status = 'posted' and i.total > ${ALLOCATED_SQL}`);
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const size = Math.min(500, Math.max(1, Number(q.size ?? 50) || 50));
  const sort = LIST_SORT[q.sort ?? ""] ?? "i.date";
  const dir = q.dir === "asc" ? "asc" : "desc";
  const where = cond.join(" and ");
  const agg = await ctx.db.one<{ n: number; total: string }>(
    `select count(*)::int as n, coalesce(sum(i.total), 0) as total from tz_invoices i left join tz_parties p on p.id = i.party_id where ${where}`,
    params,
  );
  const rows = await ctx.db.query<Record<string, any>>(
    `select i.id, i.kind, i.no, i.date, i.due_date, i.status, i.party_id, p.code as party_code, p.name as party_name, i.buyer->>'name' as buyer_name,
            i.subtotal, i.tax, i.total, i.ref_no, i.voucher_id, i.ref_invoice_id, i.extra, i.created_at,
            (select count(*)::int from tz_invoice_lines l where l.invoice_id = i.id) as line_count,
            ${ALLOCATED_SQL} as allocated
     from tz_invoices i left join tz_parties p on p.id = i.party_id
     where ${where}
     order by ${sort} ${dir} nulls last, i.no ${dir}, i.created_at ${dir}
     limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      remaining: POSTABLE_KINDS.has(r.kind) && r.status === "posted" ? D(r.total).minus(D(r.allocated)).toString() : null,
    })),
    total: agg?.n ?? 0,
    sum_total: D(agg?.total ?? 0).toString(),
    page,
    size,
  };
}

export async function getInvoice(ctx: Ctx, id: string): Promise<Record<string, any>> {
  const inv = await ctx.db.one<Record<string, any>>(
    `select i.*, p.code as party_code, p.name as party_name, p.mobile as party_mobile, p.detail_id as party_detail_id,
            v.no as voucher_no, w.name as warehouse_name, pl.name as price_list_name, sp.name as salesperson_name,
            u.full_name as created_by_name, ${ALLOCATED_SQL} as allocated
     from tz_invoices i
     left join tz_parties p on p.id = i.party_id
     left join tz_vouchers v on v.id = i.voucher_id and v.deleted_at is null
     left join tz_warehouses w on w.id = i.warehouse_id
     left join tz_price_lists pl on pl.id = i.price_list_id
     left join tz_parties sp on sp.id = i.salesperson_id
     left join tz_users u on u.id = i.created_by
     where i.id = $1 and i.org_id = $2 and i.deleted_at is null`,
    [id, ctx.org.id],
  );
  if (!inv) throw notFound("فاکتور پیدا نشد");
  ctx.need(kindArea(inv.kind), "view");
  const dp = moneyDp(ctx);
  const lines = await ctx.db.query<Record<string, any>>(
    `select l.*, it.code as item_code, it.name as item_name, it.kind as item_kind, it.barcode, it.tax_goods_id,
            it.unit_id as item_unit_id, it.unit2_id as item_unit2_id, it.unit2_factor as item_unit2_factor,
            u.name as unit_name, u1.name as main_unit_name, u1.decimals as main_unit_decimals, u2.name as unit2_name, u2.decimals as unit2_decimals,
            w.name as warehouse_name,
            (select coalesce(sum(m.value), 0) from tz_stock_moves m where m.source_id = l.invoice_id and m.source_line_id = l.id) as move_value
     from tz_invoice_lines l
     left join tz_items it on it.id = l.item_id
     left join tz_units u on u.id = l.unit_id
     left join tz_units u1 on u1.id = it.unit_id
     left join tz_units u2 on u2.id = it.unit2_id
     left join tz_warehouses w on w.id = l.warehouse_id
     where l.invoice_id = $1 order by l.line_no`,
    [id],
  );
  const purchaseSide = inv.kind === "purchase" || inv.kind === "purchase_return";
  let cost = D(0);
  const outLines = lines.map((l) => {
    const gross = D(l.qty).times(D(l.unit_price)).toDecimalPlaces(dp);
    const net = D(l.total).minus(D(l.vat));
    const mv = D(l.move_value);
    const lineCost = purchaseSide ? (l.cost !== null ? D(l.cost) : null) : l.item_kind === "goods" ? mv.abs() : null;
    if (lineCost && !purchaseSide) cost = cost.plus(lineCost);
    return {
      ...l,
      base_qty: D(l.qty).times(D(l.unit_factor)).toString(),
      gross: gross.toString(),
      net: net.toString(),
      cost: lineCost?.toString() ?? null,
    };
  });
  const link = async (invoiceId: unknown) =>
    invoiceId && isUuid(invoiceId)
      ? ctx.db.one(`select id, kind, no, date, status, total from tz_invoices where id = $1 and org_id = $2 and deleted_at is null`, [invoiceId, ctx.org.id])
      : null;
  const returns = inv.kind === "sale" || inv.kind === "purchase"
    ? await ctx.db.query(`select id, kind, no, date, status, total from tz_invoices where org_id = $1 and ref_invoice_id = $2 and deleted_at is null order by date, no`, [ctx.org.id, id])
    : [];
  const postable = POSTABLE_KINDS.has(inv.kind);
  const netSales = D(inv.subtotal).minus(D(inv.line_discount)).minus(D(inv.discount)).minus(D(inv.deductions));
  return {
    ...inv,
    lines: outLines,
    ref_invoice: await link(inv.ref_invoice_id),
    converted_to: await link(inv.extra?.converted_to),
    converted_from: await link(inv.extra?.from_id),
    returns,
    remaining: postable && inv.status === "posted" ? D(inv.total).minus(D(inv.allocated)).toString() : null,
    cost: inv.kind === "sale" || inv.kind === "sale_return" ? cost.toString() : null,
    gross_profit: inv.kind === "sale" && inv.status === "posted" ? netSales.minus(cost).toString() : null,
  };
}

/** Lines of an invoice with what can still be returned (for the return editor). */
export async function returnableLines(ctx: Ctx, id: string) {
  const inv = await ctx.db.one<Record<string, any>>(
    `select i.id, i.kind, i.no, i.date, i.status, i.party_id, i.warehouse_id, i.price_list_id, p.name as party_name
     from tz_invoices i left join tz_parties p on p.id = i.party_id where i.id = $1 and i.org_id = $2 and i.deleted_at is null`,
    [id, ctx.org.id],
  );
  if (!inv) throw notFound("فاکتور پیدا نشد");
  if (inv.kind !== "sale" && inv.kind !== "purchase") throw bad("برگشت فقط برای فاکتور فروش یا خرید ثبت می‌شود");
  ctx.need(kindArea(inv.kind), "view");
  if (inv.status !== "posted") throw bad("فاکتور اصلی ثبت قطعی نشده است");
  const dp = moneyDp(ctx);
  const lines = await ctx.db.query<Record<string, any>>(
    `select l.id, l.item_id, l.qty, l.unit_id, l.unit_factor, l.unit_price, l.discount, l.vat_pct, l.vat, l.total, l.warehouse_id,
            it.code as item_code, it.name as item_name, it.kind as item_kind, u.name as unit_name
     from tz_invoice_lines l left join tz_items it on it.id = l.item_id left join tz_units u on u.id = l.unit_id
     where l.invoice_id = $1 order by l.line_no`,
    [id],
  );
  const left = await returnedQty(ctx.db, ctx.org.id, id);
  return {
    invoice: inv,
    lines: lines.map((l) => {
      const base = D(l.qty).times(D(l.unit_factor));
      const used = minDec(left.get(l.item_id) ?? D(0), base);
      left.set(l.item_id, (left.get(l.item_id) ?? D(0)).minus(used));
      const gross = D(l.qty).times(D(l.unit_price)).toDecimalPlaces(dp);
      const net = D(l.total).minus(D(l.vat));
      // every discount of the original (line and invoice) as one percentage, so the return refunds the same net price
      // (12 decimals: a full return reproduces the original net to the rial)
      const pct = gross.gt(0) ? gross.minus(net).div(gross).times(100).toDecimalPlaces(12) : D(0);
      return {
        line_id: l.id,
        item_id: l.item_id,
        item_code: l.item_code,
        item_name: l.item_name,
        item_kind: l.item_kind,
        unit_id: l.unit_id,
        unit_name: l.unit_name,
        unit_factor: l.unit_factor,
        qty: l.qty,
        returned: used.div(D(l.unit_factor)).toString(),
        remaining: base.minus(used).div(D(l.unit_factor)).toString(),
        unit_price: l.unit_price,
        discount_pct: pct.toString(),
        vat_pct: l.vat_pct,
        warehouse_id: l.warehouse_id,
      };
    }),
  };
}

function minDec(a: Dec, b: Dec): Dec {
  return a.lt(b) ? a : b;
}
