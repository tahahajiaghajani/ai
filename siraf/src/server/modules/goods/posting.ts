// Automatic vouchers of invoices and stock documents, always rebuilt from what is stored (the
// document, its lines and its stock moves), so the costing run can refresh them after costs
// change. A voucher is only rewritten when its lines actually differ.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { bad } from "../../http/errors";
import { accountByKey, cr, dr, postAuto, removeAuto, type VoucherLineInput } from "../accounting/vouchers";
import { D, round } from "@shared/money";
import { faDigits } from "@shared/format";
import {
  INVOICE_LABEL, STOCK_DOC_LABEL, POSTABLE_KINDS, itemAccounts, loadItems, moneyDp, touchRoot,
  type InvoiceKind, type StockDocKind,
} from "./common";

type Dec = ReturnType<typeof D>;

/** Accumulates amounts per account (keeps first-seen order for stable vouchers). */
class Bucket {
  private m = new Map<string, Dec>();
  add(account: string, amount: Dec) {
    this.m.set(account, (this.m.get(account) ?? D(0)).plus(amount));
  }
  entries() {
    return Array.from(this.m.entries()).filter(([, v]) => !v.isZero());
  }
}

/** Replace the automatic voucher of a source document only when its content changed. */
export async function postIfChanged(
  tx: Tx,
  ctx: Ctx,
  src: { type: string; id: string; date: string; description: string; refNo?: string | null },
  lines: VoucherLineInput[],
): Promise<string | null> {
  const dp = moneyDp(ctx);
  const clean = lines.filter((l) => !D(round(l.debit ?? 0, dp)).isZero() || !D(round(l.credit ?? 0, dp)).isZero());
  const existing = await tx.one<{ id: string; date: string; description: string | null; ref_no: string | null }>(
    `select id, date, description, ref_no from tz_vouchers where org_id = $1 and source_type = $2 and source_id = $3 and deleted_at is null order by created_at limit 1`,
    [ctx.org.id, src.type, src.id],
  );
  if (existing && clean.length) {
    const old = await tx.query<{ account_id: string; detail_id: string | null; debit: string; credit: string; description: string | null }>(
      `select account_id, detail_id, debit, credit, description from tz_voucher_lines where voucher_id = $1 order by line_no`,
      [existing.id],
    );
    const sig = (a: string, d: string | null | undefined, x: unknown, y: unknown, s: string | null | undefined) =>
      `${a}|${d ?? ""}|${D(round(x as string, dp)).toFixed()}|${D(round(y as string, dp)).toFixed()}|${(s ?? "").trim()}`;
    const same =
      existing.date === src.date &&
      (existing.description ?? "") === src.description.trim() &&
      (existing.ref_no ?? "") === (src.refNo?.trim() ?? "") &&
      old.length === clean.length &&
      old.every((o, i) => sig(o.account_id, o.detail_id, o.debit, o.credit, o.description) === sig(clean[i].account_id, clean[i].detail_id, clean[i].debit, clean[i].credit, clean[i].description));
    if (same) return existing.id;
  }
  return postAuto(tx, ctx.org, src, clean, { userId: ctx.user.id, origin: ctx.cfg.origin });
}

// ---------------------------------------------------------------- invoices

interface InvoiceRoot {
  id: string;
  kind: InvoiceKind;
  no: number;
  date: string;
  status: string;
  party_id: string | null;
  ref_no: string | null;
  subtotal: string;
  line_discount: string;
  discount: string;
  additions: string;
  deductions: string;
  tax: string;
  total: string;
  deleted_at: string | null;
}

/** Build and post (or remove) the voucher of an invoice; returns the voucher id. */
export async function postInvoiceVoucher(tx: Tx, ctx: Ctx, invoiceId: string): Promise<string | null> {
  const inv = await tx.one<InvoiceRoot>(
    `select id, kind, no, date, status, party_id, ref_no, subtotal, line_discount, discount, additions, deductions, tax, total, deleted_at
     from tz_invoices where id = $1 and org_id = $2`,
    [invoiceId, ctx.org.id],
  );
  if (!inv || inv.deleted_at || inv.status !== "posted" || !POSTABLE_KINDS.has(inv.kind)) {
    await removeAuto(tx, ctx.org.id, "invoice", invoiceId);
    return null;
  }
  const lines = await tx.query<{ id: string; item_id: string; qty: string; unit_price: string; cost: string | null }>(
    `select id, item_id, qty, unit_price, cost from tz_invoice_lines where invoice_id = $1 order by line_no`,
    [invoiceId],
  );
  const moves = await tx.query<{ source_line_id: string; value: string }>(
    `select source_line_id, coalesce(sum(value), 0) as value from tz_stock_moves where org_id = $1 and source_id = $2 group by source_line_id`,
    [ctx.org.id, invoiceId],
  );
  const moveValue = new Map(moves.map((m) => [m.source_line_id, D(m.value)]));
  const party = inv.party_id
    ? await tx.one<{ name: string; detail_id: string | null }>(`select name, detail_id from tz_parties where id = $1 and org_id = $2`, [inv.party_id, ctx.org.id])
    : null;
  if (!party?.detail_id) throw bad("طرف حساب فاکتور حساب تفصیلی ندارد");
  const items = await loadItems(tx, ctx.org.id, lines.map((l) => l.item_id));
  const accounts = await itemAccounts(tx, ctx.org.id, Array.from(items.values()));
  const dp = moneyDp(ctx);
  const label = `${INVOICE_LABEL[inv.kind]} ${faDigits(inv.no)}`;
  const k = (key: string) => accountByKey(tx, ctx.org.id, key);
  const out: VoucherLineInput[] = [];
  const total = D(inv.total);
  const deductions = D(inv.deductions);
  const additions = D(inv.additions);
  const tax = D(inv.tax);
  const person = { detail_id: party.detail_id };

  if (inv.kind === "sale" || inv.kind === "sale_return") {
    const sale = inv.kind === "sale";
    const revenue = new Bucket();
    const cogs = new Bucket();
    const stock = new Bucket();
    for (const l of lines) {
      const it = items.get(l.item_id);
      const acc = accounts.get(l.item_id);
      if (!it || !acc) continue;
      revenue.add(sale ? acc.revenue : await k("sales_returns"), D(round(D(l.qty).times(D(l.unit_price)), dp)));
      const mv = moveValue.get(l.id);
      if (it.kind === "goods" && mv && !mv.isZero()) {
        cogs.add(acc.cogs, mv.abs());
        stock.add(acc.inventory, mv.abs());
      }
    }
    const side = sale ? dr : cr; // receivable, discounts
    const other = sale ? cr : dr; // revenue, VAT, additions
    out.push(side(await k("ar"), total.toString(), { ...person, description: label }));
    if (!D(inv.line_discount).isZero()) out.push(side(await k("sales_discounts"), inv.line_discount, { description: "تخفیف ردیف‌ها" }));
    if (!D(inv.discount).isZero()) out.push(side(await k("sales_discounts"), inv.discount, { description: "تخفیف فاکتور" }));
    if (!deductions.isZero()) out.push(side(await k("sales_discounts"), deductions.toString(), { description: "کسورات فاکتور" }));
    for (const [acc, v] of revenue.entries()) out.push(other(acc, v.toString(), { description: sale ? "فروش" : "برگشت از فروش" }));
    if (!tax.isZero()) out.push(other(await k("vat_out"), tax.toString(), { description: "مالیات و عوارض ارزش افزوده" }));
    if (!additions.isZero()) out.push(other(await k("invoice_additions"), additions.toString(), { description: "اضافات فاکتور" }));
    // cost of goods sold (sale) or its reversal (return)
    for (const [acc, v] of cogs.entries()) out.push((sale ? dr : cr)(acc, v.toString(), { description: "بهای تمام‌شده‌ی کالای فروش‌رفته" }));
    for (const [acc, v] of stock.entries()) out.push((sale ? cr : dr)(acc, v.toString(), { description: sale ? "خروج کالا از انبار" : "ورود کالای برگشتی به انبار" }));
  } else {
    // purchase / purchase return: inventory (goods) or expense (services) at landed cost
    const purchase = inv.kind === "purchase";
    const stock = new Bucket();
    const expense = new Bucket();
    for (const l of lines) {
      const it = items.get(l.item_id);
      const acc = accounts.get(l.item_id);
      if (!it || !acc) continue;
      const cost = D(l.cost ?? 0);
      if (it.kind === "goods") stock.add(acc.inventory, cost);
      else expense.add(acc.expense, cost);
    }
    const side = purchase ? dr : cr;
    for (const [acc, v] of stock.entries()) out.push(side(acc, v.toString(), { description: purchase ? "خرید کالا" : "برگشت کالا به فروشنده" }));
    for (const [acc, v] of expense.entries()) out.push(side(acc, v.toString(), { description: purchase ? "خرید خدمات" : "برگشت خدمات" }));
    if (!tax.isZero()) out.push(side(await k("vat_in"), tax.toString(), { description: "مالیات و عوارض ارزش افزوده‌ی خرید" }));
    out.push((purchase ? cr : dr)(await k("ap"), total.toString(), { ...person, description: label }));
  }

  return postIfChanged(tx, ctx, {
    type: "invoice",
    id: inv.id,
    date: inv.date,
    description: `${label} — ${party.name}`,
    refNo: inv.ref_no,
  }, out);
}

// ---------------------------------------------------------------- stock documents

interface StockDocRoot {
  id: string;
  kind: StockDocKind;
  no: number;
  date: string;
  status: string;
  party_id: string | null;
  account_id: string | null;
  detail_id: string | null;
  description: string | null;
  deleted_at: string | null;
}

/**
 * Detail of a stock document's counter account: the one chosen on the document (validated by the
 * voucher engine), else the party's — but only when the account takes a detail of that kind.
 */
async function counterDetail(tx: Tx, orgId: string, accountId: string, chosen: string | null, partyDetail: string | null): Promise<string | null> {
  if (chosen) return chosen;
  if (!partyDetail) return null;
  const a = await tx.one<{ detail_mode: string; detail_kinds: string[] }>(`select detail_mode, detail_kinds from tz_accounts where id = $1 and org_id = $2`, [accountId, orgId]);
  if (!a || a.detail_mode === "none") return null;
  const kinds = Array.isArray(a.detail_kinds) ? a.detail_kinds : [];
  return !kinds.length || kinds.includes("person") ? partyDetail : null;
}

/** Build and post (or remove) the voucher of a stock document; returns the voucher id. */
export async function postStockDocVoucher(tx: Tx, ctx: Ctx, docId: string): Promise<string | null> {
  const doc = await tx.one<StockDocRoot>(
    `select id, kind, no, date, status, party_id, account_id, detail_id, description, deleted_at from tz_stock_docs where id = $1 and org_id = $2`,
    [docId, ctx.org.id],
  );
  if (!doc || doc.deleted_at || doc.status !== "posted" || doc.kind === "transfer") {
    await removeAuto(tx, ctx.org.id, "stock_doc", docId);
    return null;
  }
  const moves = await tx.query<{ item_id: string; value: string }>(
    `select item_id, value from tz_stock_moves where org_id = $1 and source_id = $2 order by seq, id`,
    [ctx.org.id, docId],
  );
  const items = await loadItems(tx, ctx.org.id, moves.map((m) => m.item_id));
  const accounts = await itemAccounts(tx, ctx.org.id, Array.from(items.values()));
  const k = (key: string) => accountByKey(tx, ctx.org.id, key);
  const party = doc.party_id
    ? await tx.one<{ name: string; detail_id: string | null }>(`select name, detail_id from tz_parties where id = $1 and org_id = $2`, [doc.party_id, ctx.org.id])
    : null;
  const label = `${STOCK_DOC_LABEL[doc.kind]} ${faDigits(doc.no)}`;
  const out: VoucherLineInput[] = [];
  const stockIn = new Bucket();
  const stockOut = new Bucket();
  let inTotal = D(0);
  let outTotal = D(0);
  for (const m of moves) {
    const acc = accounts.get(m.item_id);
    if (!acc) continue;
    const v = D(m.value);
    if (v.gt(0)) {
      stockIn.add(acc.inventory, v);
      inTotal = inTotal.plus(v);
    } else if (v.lt(0)) {
      stockOut.add(acc.inventory, v.abs());
      outTotal = outTotal.plus(v.abs());
    }
  }
  const detailFor = (account: string) => counterDetail(tx, ctx.org.id, account, doc.detail_id, party?.detail_id ?? null);
  if (doc.kind === "receipt") {
    const counter = doc.account_id ?? (party ? await k("ap") : await k("opening_balance"));
    for (const [acc, v] of stockIn.entries()) out.push(dr(acc, v.toString(), { description: "ورود کالا به انبار" }));
    if (!inTotal.isZero()) out.push(cr(counter, inTotal.toString(), { detail_id: await detailFor(counter), description: label }));
  } else if (doc.kind === "issue") {
    const counter = doc.account_id ?? (await k("misc_expense"));
    if (!outTotal.isZero()) out.push(dr(counter, outTotal.toString(), { detail_id: await detailFor(counter), description: label }));
    for (const [acc, v] of stockOut.entries()) out.push(cr(acc, v.toString(), { description: "خروج کالا از انبار" }));
  } else {
    // adjust / count: surplus → inventory gain, shortage → inventory loss (or the chosen account)
    const gain = doc.account_id ?? (await k("inventory_gain"));
    const loss = doc.account_id ?? (await k("inventory_loss"));
    for (const [acc, v] of stockIn.entries()) out.push(dr(acc, v.toString(), { description: "اضافی انبار" }));
    if (!inTotal.isZero()) out.push(cr(gain, inTotal.toString(), { detail_id: await detailFor(gain), description: label }));
    if (!outTotal.isZero()) out.push(dr(loss, outTotal.toString(), { detail_id: await detailFor(loss), description: label }));
    for (const [acc, v] of stockOut.entries()) out.push(cr(acc, v.toString(), { description: "کسری انبار" }));
  }
  return postIfChanged(tx, ctx, {
    type: "stock_doc",
    id: doc.id,
    date: doc.date,
    description: `${label}${doc.description ? ` — ${doc.description}` : party ? ` — ${party.name}` : ""}`,
  }, out);
}

/** Re-post a document whose stock values changed in a costing run and touch its root. */
export async function refreshSource(tx: Tx, ctx: Ctx, type: string, id: string) {
  if (type === "invoice") {
    const voucherId = await postInvoiceVoucher(tx, ctx, id);
    await touchRoot(tx, "tz_invoices", id, ctx.cfg.origin, { voucher_id: voucherId });
  } else if (type === "stock_doc") {
    const voucherId = await postStockDocVoucher(tx, ctx, id);
    await touchRoot(tx, "tz_stock_docs", id, ctx.cfg.origin, { voucher_id: voucherId });
  }
}
