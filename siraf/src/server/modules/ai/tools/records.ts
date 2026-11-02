// Finding and reading records: parties, items, accounts, invoices, vouchers, treasury documents,
// cheques, gold documents, gold pieces and bars, currency deals and remittances. Each type checks
// the permission (and module) of the page that lists it; personal identifiers are masked by the
// data policy; free text typed by users (notes, descriptions) is returned as data.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { Area, Level } from "@shared/permissions";
import type { AiRef } from "@shared/ai/types";
import { D, normalizeDigits } from "@shared/money";
import { isUuid } from "@shared/id";
import { bad, forbidden, notFound } from "../../../http/errors";
import { CHEQUE_STATUS_TITLE } from "../../treasury/common";
import { KINDS as GOLD_KINDS } from "../../gold/pricing";
import { getVoucher } from "../../accounting/vouchers";
import { getDoc as getTreasuryDoc } from "../../treasury/docs";
import { getCheque } from "../../treasury/cheques";
import { partyBalance } from "../../treasury/reports";
import { getInvoice } from "../../goods/invoices";
import { readDoc as readGoldDoc } from "../../gold/docs";
import { getDeal } from "../../fx/deals";
import { getRemittance } from "../../fx/remittances";
import { defineTool, type ToolRuntime } from "./registry";
import { INVOICE_TITLE, bounded, faSql, fmtMoney, jd, likePattern, maskId, moneyInfo, partyName, period, periodInput, ref, type MoneyInfo } from "./common";

export const RECORD_TYPES = [
  "party", "item", "account", "invoice", "voucher", "treasury_doc", "cheque", "gold_doc", "gold_item", "gold_bar", "fx_deal", "remittance",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

const SALE_KINDS = ["sale", "sale_return", "quote", "sale_order"];
const PURCHASE_KINDS = ["purchase", "purchase_return", "purchase_order"];

const STATUS_FA: Record<string, string> = {
  draft: "پیش‌نویس",
  posted: "ثبت‌شده",
  final: "قطعی",
  void: "باطل",
  cancelled: "باطل‌شده",
  pending: "در انتظار",
  sent: "ارسال‌شده",
  paid: "پرداخت‌شده",
  in_stock: "موجود",
  sold: "فروخته‌شده",
  reserved: "رزرو",
};

const TREASURY_KIND_FA: Record<string, string> = { receipt: "دریافت", payment: "پرداخت", transfer: "انتقال" };
const FX_KIND_FA: Record<string, string> = { buy: "خرید ارز", sell: "فروش ارز", exchange: "تبدیل ارز" };

interface TypeRule {
  title_fa: string;
  /** any one of these is enough */
  any: [Area, Level][];
  module?: "goods" | "gold" | "fx";
}

const RULES: Record<RecordType, TypeRule> = {
  party: { title_fa: "شخص", any: [["parties", "view"], ["sales", "view"], ["purchases", "view"], ["treasury", "view"]] },
  item: { title_fa: "کالا", any: [["inventory", "view"], ["sales", "view"], ["purchases", "view"]] },
  account: { title_fa: "حساب", any: [["accounting", "view"], ["reports", "view"]] },
  invoice: { title_fa: "فاکتور", any: [["sales", "view"], ["purchases", "view"]], module: "goods" },
  voucher: { title_fa: "سند حسابداری", any: [["accounting", "view"]] },
  treasury_doc: { title_fa: "سند خزانه", any: [["treasury", "view"]] },
  cheque: { title_fa: "چک", any: [["treasury", "view"]] },
  gold_doc: { title_fa: "سند طلا", any: [["gold", "view"]], module: "gold" },
  gold_item: { title_fa: "جنس طلا", any: [["gold", "view"]], module: "gold" },
  gold_bar: { title_fa: "شمش", any: [["gold", "view"]], module: "gold" },
  fx_deal: { title_fa: "معاملهٔ ارز", any: [["fx", "view"]], module: "fx" },
  remittance: { title_fa: "حواله", any: [["fx", "view"]], module: "fx" },
};

/** Record types this member may look up in this business. */
export function allowedTypes(ctx: Ctx): RecordType[] {
  return RECORD_TYPES.filter((t) => typeAllowed(ctx, t));
}

function typeAllowed(ctx: Ctx, t: RecordType): boolean {
  const r = RULES[t];
  if (r.module && !ctx.hasModule(r.module)) return false;
  return r.any.some(([a, l]) => ctx.can(a, l));
}

function needType(ctx: Ctx, t: RecordType) {
  const r = RULES[t];
  if (r.module && !ctx.hasModule(r.module)) throw forbidden(`«${r.title_fa}» در بخش‌های فعال این کسب‌وکار نیست`);
  if (!r.any.some(([a, l]) => ctx.can(a, l))) throw forbidden(`دسترسی دیدن «${r.title_fa}» را ندارید`);
}

function invoiceKindsAllowed(ctx: Ctx): string[] {
  return [...(ctx.can("sales", "view") ? SALE_KINDS : []), ...(ctx.can("purchases", "view") ? PURCHASE_KINDS : [])];
}

// ---------------------------------------------------------------- find

interface Found {
  row: Record<string, unknown>;
  ref: AiRef;
}

interface FindArgs {
  q: string;
  like: string;
  digits: string | null;
  from: string | null;
  to: string | null;
  party_id: string | null;
  status: string | null;
  limit: number;
}

async function findRows(ctx: Ctx, type: RecordType, a: FindArgs, m: MoneyInfo, rt: ToolRuntime): Promise<Found[]> {
  const db = ctx.db;
  const org = ctx.org.id;
  const params: unknown[] = [org];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const cond: string[] = [];
  const range = (col: string) => {
    if (a.from) cond.push(`${col} >= ${p(a.from)}`);
    if (a.to) cond.push(`${col} <= ${p(a.to)}`);
  };
  const party = (col: string) => {
    if (a.party_id) cond.push(`${col} = ${p(a.party_id)}`);
  };
  const status = (col: string) => {
    if (a.status) cond.push(`${col} = ${p(a.status)}`);
  };
  const where = () => (cond.length ? ` and ${cond.join(" and ")}` : "");
  const lim = Math.min(Math.max(a.limit, 1), 50) + 1;

  switch (type) {
    case "party": {
      if (a.q) {
        const like = p(a.like);
        const exact = a.digits ? ` or national_id = ${p(a.digits)} or mobile = ${p(a.digits)} or code = ${p(a.digits)}` : "";
        cond.push(`(${faSql("name")} like ${like} or ${faSql("company_name")} like ${like}${exact})`);
      }
      const rows = await db.query<Record<string, any>>(
        `select id, code, kind, name, roles, mobile, national_id, kyc_status, credit_limit, is_active, is_blacklisted
         from tz_parties where org_id = $1 and deleted_at is null${where()} order by is_active desc, length(name), code limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: {
          id: r.id, code: r.code, name: partyName(r.name, r.code, rt), kind: r.kind, roles: r.roles,
          mobile: maskId(r.mobile, rt), national_id: maskId(r.national_id, rt), kyc_status: r.kyc_status,
          credit_limit: r.credit_limit ? fmtMoney(r.credit_limit, m) : null, active: r.is_active, blacklisted: r.is_blacklisted,
        },
        ref: ref("party", r.id, partyName(r.name, r.code, rt)),
      }));
    }
    case "item": {
      const kinds = ctx.hasModule("goods") ? ["goods", "service", "coin"] : ["coin"];
      cond.push(`i.kind = any(${p(`{${kinds.join(",")}}`)}::text[])`);
      if (a.q) cond.push(`(${faSql("i.name")} like ${p(a.like)} or i.code = ${p(normalizeDigits(a.q))} or i.barcode = ${p(normalizeDigits(a.q))} or i.sku = ${p(a.q)})`);
      const rows = await db.query<Record<string, any>>(
        `select i.id, i.code, i.name, i.kind, i.sale_price, i.purchase_price, i.min_stock, i.reorder_point, i.is_active, c.name as category,
                (select coalesce(sum(m.qty), 0) from tz_stock_moves m where m.item_id = i.id and m.org_id = i.org_id) as stock
         from tz_items i left join tz_item_categories c on c.id = i.category_id
         where i.org_id = $1 and i.deleted_at is null${where()} order by i.is_active desc, length(i.name), i.code limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: {
          id: r.id, code: r.code, name: r.name, kind: r.kind, category: r.category, stock_qty: D(r.stock).toString(),
          sale_price: r.sale_price ? fmtMoney(r.sale_price, m) : null, purchase_price: r.purchase_price ? fmtMoney(r.purchase_price, m) : null,
          reorder_point: r.reorder_point, active: r.is_active,
        },
        ref: ref("item", r.id, r.name),
      }));
    }
    case "account": {
      if (a.q) cond.push(`(${faSql("name")} like ${p(a.like)} or code like ${p(`${normalizeDigits(a.q)}%`)})`);
      const rows = await db.query<Record<string, any>>(
        `select id, code, name, level, kind, is_postable, system_key from tz_accounts where org_id = $1 and deleted_at is null and is_active${where()}
         order by code limit ${lim}`,
        params,
      );
      return rows.map((r) => ({ row: { id: r.id, code: r.code, name: r.name, level: r.level, kind: r.kind, postable: r.is_postable, role: r.system_key }, ref: ref("account", r.id, `${r.code} ${r.name}`) }));
    }
    case "invoice": {
      const kinds = invoiceKindsAllowed(ctx);
      cond.push(`inv.kind = any(${p(`{${kinds.join(",")}}`)}::text[])`);
      range("inv.date");
      party("inv.party_id");
      status("inv.status");
      if (a.q) cond.push(a.digits ? `(inv.no::text = ${p(a.digits)} or inv.ref_no = ${p(a.q)})` : `${faSql("pa.name")} like ${p(a.like)}`);
      const rows = await db.query<Record<string, any>>(
        `select inv.id, inv.kind, inv.no, inv.date, inv.due_date, inv.status, inv.total, inv.paid, pa.name as party, pa.code as party_code
         from tz_invoices inv left join tz_parties pa on pa.id = inv.party_id
         where inv.org_id = $1 and inv.deleted_at is null${where()} order by inv.date desc, inv.no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => {
        const label = `${INVOICE_TITLE[r.kind] ?? "فاکتور"} ${r.no}`;
        return {
          row: {
            id: r.id, kind: r.kind, kind_fa: INVOICE_TITLE[r.kind], no: r.no, date_fa: jd(r.date), due_date_fa: jd(r.due_date),
            party: r.party ? partyName(r.party, r.party_code, rt) : null, status: STATUS_FA[r.status] ?? r.status,
            total: fmtMoney(r.total, m), remaining: fmtMoney(D(r.total).minus(D(r.paid ?? 0)), m),
          },
          ref: ref("invoice", r.id, label, { kind: r.kind }),
        };
      });
    }
    case "voucher": {
      range("v.date");
      status("v.status");
      if (a.q) cond.push(a.digits ? `v.no::text = ${p(a.digits)}` : `${faSql("v.description")} like ${p(a.like)}`);
      const rows = await db.query<Record<string, any>>(
        `select v.id, v.no, v.date, v.kind, v.status, v.description, v.total_debit, v.source_type
         from tz_vouchers v where v.org_id = $1 and v.deleted_at is null${where()} order by v.date desc, v.no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: { id: r.id, no: r.no, date_fa: jd(r.date), kind: r.kind, status: STATUS_FA[r.status] ?? r.status, description: r.description, amount: fmtMoney(r.total_debit, m), source: r.source_type },
        ref: ref("voucher", r.id, `سند ${r.no}`),
      }));
    }
    case "treasury_doc": {
      range("d.date");
      party("d.party_id");
      if (a.q) cond.push(a.digits ? `d.no::text = ${p(a.digits)}` : `(${faSql("pa.name")} like ${p(a.like)} or ${faSql("d.description")} like ${p(a.like)})`);
      const rows = await db.query<Record<string, any>>(
        `select d.id, d.kind, d.no, d.date, d.total, d.description, pa.name as party, pa.code as party_code
         from tz_treasury_docs d left join tz_parties pa on pa.id = d.party_id
         where d.org_id = $1 and d.deleted_at is null${where()} order by d.date desc, d.no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: { id: r.id, kind_fa: TREASURY_KIND_FA[r.kind] ?? r.kind, no: r.no, date_fa: jd(r.date), party: r.party ? partyName(r.party, r.party_code, rt) : null, total: fmtMoney(r.total, m), description: r.description },
        ref: ref("treasury_doc", r.id, `${TREASURY_KIND_FA[r.kind] ?? "سند"} ${r.no}`),
      }));
    }
    case "cheque": {
      range("c.due_date");
      party("c.party_id");
      status("c.status");
      if (a.q) cond.push(a.digits ? `(c.serial_no = ${p(a.digits)} or c.sayad_no = ${p(a.digits)})` : `(${faSql("pa.name")} like ${p(a.like)} or ${faSql("c.bank_name")} like ${p(a.like)})`);
      const rows = await db.query<Record<string, any>>(
        `select c.id, c.direction, c.serial_no, c.sayad_no, c.bank_name, c.amount, c.due_date, c.status, pa.name as party, pa.code as party_code
         from tz_cheques c left join tz_parties pa on pa.id = c.party_id
         where c.org_id = $1 and c.deleted_at is null${where()} order by c.due_date desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: {
          id: r.id, direction: r.direction === "received" ? "دریافتی" : "پرداختی", serial_no: r.serial_no, sayad_no: maskId(r.sayad_no, rt), bank: r.bank_name,
          party: r.party ? partyName(r.party, r.party_code, rt) : null, amount: fmtMoney(r.amount, m), due_date_fa: jd(r.due_date), status: CHEQUE_STATUS_TITLE[r.status] ?? r.status,
        },
        ref: ref("cheque", r.id, `چک ${r.serial_no ?? ""}`.trim(), { direction: r.direction }),
      }));
    }
    case "gold_doc": {
      range("d.date");
      party("d.party_id");
      status("d.status");
      if (a.q) cond.push(a.digits ? `d.no::text = ${p(a.digits)}` : `${faSql("pa.name")} like ${p(a.like)}`);
      const rows = await db.query<Record<string, any>>(
        `select d.id, d.kind, d.no, d.date, d.status, d.total, d.weight_out, d.weight_in, pa.name as party, pa.code as party_code
         from tz_gold_docs d left join tz_parties pa on pa.id = d.party_id
         where d.org_id = $1 and d.deleted_at is null${where()} order by d.date desc, d.no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => {
        const title = (GOLD_KINDS as Record<string, { title: string }>)[r.kind]?.title ?? "سند طلا";
        return {
          row: {
            id: r.id, kind_fa: title, no: r.no, date_fa: jd(r.date), status: STATUS_FA[r.status] ?? r.status, party: r.party ? partyName(r.party, r.party_code, rt) : null,
            total: fmtMoney(r.total, m), weight_out_g: D(r.weight_out ?? 0).toString(), weight_in_g: D(r.weight_in ?? 0).toString(),
          },
          ref: ref("gold_doc", r.id, `${title} ${r.no}`),
        };
      });
    }
    case "gold_item": {
      status("g.status");
      if (a.q) cond.push(a.digits ? `g.tag_no = ${p(a.digits)}` : `(${faSql("g.title")} like ${p(a.like)} or ${faSql("gc.name")} like ${p(a.like)})`);
      const rows = await db.query<Record<string, any>>(
        `select g.id, g.tag_no, g.title, g.net_weight, g.fineness, g.status, g.ownership, gc.name as category
         from tz_gold_items g left join tz_gold_categories gc on gc.id = g.category_id
         where g.org_id = $1 and g.deleted_at is null${where()} order by g.tag_no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: { id: r.id, tag_no: r.tag_no, title: r.title, category: r.category, net_weight_g: D(r.net_weight ?? 0).toString(), fineness: r.fineness, status: STATUS_FA[r.status] ?? r.status, ownership: r.ownership },
        ref: ref("gold_item", r.id, `اتیکت ${r.tag_no}`, { tag: r.tag_no }),
      }));
    }
    case "gold_bar": {
      status("b.status");
      if (a.q) cond.push(`(b.bar_no = ${p(normalizeDigits(a.q))} or b.serial_no = ${p(a.q)} or ${faSql("b.brand")} like ${p(a.like)})`);
      const rows = await db.query<Record<string, any>>(
        `select b.id, b.bar_no, b.brand, b.serial_no, b.weight, b.fineness, b.weight750, b.seal_status, b.status, b.ownership
         from tz_gold_bars b where b.org_id = $1 and b.deleted_at is null${where()} order by b.bar_no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: {
          id: r.id, bar_no: r.bar_no, brand: r.brand, serial_no: r.serial_no, weight_g: D(r.weight).toString(), fineness: D(r.fineness).toString(),
          weight750_g: D(r.weight750).toString(), seal: r.seal_status, status: STATUS_FA[r.status] ?? r.status, ownership: r.ownership,
        },
        ref: ref("gold_bar", r.id, `شمش ${r.bar_no}`, { tag: r.bar_no }),
      }));
    }
    case "fx_deal": {
      range("f.date");
      party("f.party_id");
      status("f.status");
      if (a.q) cond.push(a.digits ? `f.no::text = ${p(a.digits)}` : `(${faSql("pa.name")} like ${p(a.like)} or upper(ci.code) = upper(${p(a.q)}) or upper(co.code) = upper(${p(a.q)}))`);
      const rows = await db.query<Record<string, any>>(
        `select f.id, f.no, f.date, f.kind, f.status, f.in_amount, f.out_amount, f.rate, f.base_value, ci.code as in_code, co.code as out_code, pa.name as party, pa.code as party_code
         from tz_fx_deals f left join tz_parties pa on pa.id = f.party_id
         left join tz_currencies ci on ci.id = f.in_currency_id left join tz_currencies co on co.id = f.out_currency_id
         where f.org_id = $1 and f.deleted_at is null${where()} order by f.date desc, f.no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: {
          id: r.id, no: r.no, date_fa: jd(r.date), kind_fa: FX_KIND_FA[r.kind] ?? r.kind, status: STATUS_FA[r.status] ?? r.status,
          party: r.party ? partyName(r.party, r.party_code, rt) : "مشتری گذری", customer_gives: `${D(r.in_amount).toString()} ${r.in_code}`,
          customer_gets: `${D(r.out_amount).toString()} ${r.out_code}`, rate: D(r.rate).toString(), base_value: fmtMoney(r.base_value, m),
        },
        ref: ref("fx_deal", r.id, `${FX_KIND_FA[r.kind] ?? "معامله"} ${r.no}`),
      }));
    }
    case "remittance": {
      range("r.date");
      party("r.party_id");
      status("r.status");
      if (a.q) cond.push(a.digits ? `(r.no::text = ${p(a.digits)} or r.tracking_code = ${p(a.q)})` : `(${faSql("pa.name")} like ${p(a.like)} or r.tracking_code = ${p(a.q)})`);
      const rows = await db.query<Record<string, any>>(
        `select r.id, r.no, r.date, r.direction, r.status, r.amount, r.base_amount, r.tracking_code, c.code as currency, pa.name as party, pa.code as party_code
         from tz_remittances r left join tz_parties pa on pa.id = r.party_id left join tz_currencies c on c.id = r.currency_id
         where r.org_id = $1 and r.deleted_at is null${where()} order by r.date desc, r.no desc limit ${lim}`,
        params,
      );
      return rows.map((r) => ({
        row: {
          id: r.id, no: r.no, date_fa: jd(r.date), direction: r.direction === "out" ? "ارسالی" : "دریافتی", status: STATUS_FA[r.status] ?? r.status,
          party: r.party ? partyName(r.party, r.party_code, rt) : null, amount: `${D(r.amount).toString()} ${r.currency}`, base_amount: fmtMoney(r.base_amount ?? 0, m), tracking_code: r.tracking_code,
        },
        ref: ref("remittance", r.id, `حواله ${r.no}`),
      }));
    }
    default:
      throw bad("نوع رکورد پشتیبانی نمی‌شود");
  }
}

export const findRecords = defineTool({
  name: "find_records",
  title_fa: "جست‌وجوی رکوردها",
  description:
    "Searches one record type of this business and returns up to `limit` matches (newest first for documents) with ids and links. Types: party, item, account, invoice (goods sales/purchase invoices, returns, quotes, orders), voucher, treasury_doc (receipts/payments/transfers), cheque, gold_doc, gold_item (jewellery piece by tag), gold_bar, fx_deal, remittance. `query` matches names (Persian, partial) or, when it is a number, a document number / code / tag / serial / national id / mobile. Amounts are formatted with the business's currency unit. Use get_record for the full record with its lines. Only types the person may see are allowed.",
  input: z.object({
    type: z.enum(RECORD_TYPES),
    query: z.string().max(120).nullish().describe("Name part, number, code, tag, serial; empty lists the latest"),
    period: periodInput.nullish().describe("Documents only: date range (cheques: due date)"),
    party: z.string().max(120).nullish().describe("Documents only: party id (uuid) to filter by; resolve names with find_records type=party first"),
    status: z.string().max(30).nullish().describe("Optional raw status, e.g. draft, posted, in_hand, issued, bounced, in_stock"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input, rt) {
    needType(ctx, input.type);
    const m = await moneyInfo(ctx);
    const q = (input.query ?? "").trim();
    const digits = /^[\d۰-۹٠-٩\s-]+$/.test(q) ? normalizeDigits(q).replace(/[\s-]/g, "") : null;
    const per = input.period ? await period(ctx, input.period, rt.today, "this_month") : null;
    if (input.party && !isUuid(input.party)) throw bad("شناسهٔ شخص را بدهید (با find_records نوع party پیدا کنید)");
    const found = await findRows(ctx, input.type, {
      q, like: likePattern(q), digits, from: per?.from ?? null, to: per?.to ?? null, party_id: input.party ?? null, status: input.status ?? null, limit: input.limit,
    }, m, rt);
    const b = bounded(found, input.limit);
    return {
      data: {
        type: input.type,
        period: per ? { from_fa: per.from_fa, to_fa: per.to_fa, label_fa: per.label_fa } : null,
        currency_unit: m.unit,
        rows: b.rows.map((f) => f.row),
        more: b.truncated,
      },
      refs: b.rows.slice(0, 12).map((f) => f.ref),
      summary_fa: b.rows.length ? `${b.rows.length}${b.truncated ? "+" : ""} ${RULES[input.type].title_fa} پیدا شد` : `${RULES[input.type].title_fa}ی پیدا نشد`,
    };
  },
});

// ---------------------------------------------------------------- get

const LINE_LIMIT = 60;

function pick(o: Record<string, any> | null | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!o) return out;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") out[k] = o[k];
  return out;
}

function lines(rows: unknown, keys: string[]) {
  const arr = Array.isArray(rows) ? (rows as Record<string, any>[]) : [];
  return { lines: arr.slice(0, LINE_LIMIT).map((l) => pick(l, keys)), line_count: arr.length, lines_truncated: arr.length > LINE_LIMIT };
}

/** Dates in a picked object get a Jalali twin («date» → «date_fa»). */
function withJalali(o: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(o)) if (/(^|_)date$|_at$/.test(k) && typeof o[k] === "string") o[`${k}_fa`] = jd(o[k] as string);
  return o;
}

async function getOne(ctx: Ctx, type: RecordType, id: string, m: MoneyInfo, rt: ToolRuntime): Promise<{ data: Record<string, unknown>; ref: AiRef }> {
  const org = ctx.org.id;
  switch (type) {
    case "party": {
      const r = await ctx.db.one<Record<string, any>>(`select * from tz_parties where id = $1 and org_id = $2 and deleted_at is null`, [id, org]);
      if (!r) throw notFound("شخص پیدا نشد");
      const data = pick(r, ["id", "code", "kind", "roles", "first_name", "last_name", "company_name", "kyc_status", "credit_limit", "discount_pct", "city", "is_active", "is_blacklisted", "tags", "notes"]);
      data.name = partyName(r.name, r.code, rt);
      for (const k of ["national_id", "mobile", "phone", "economic_code", "passport_no", "iban", "card_no"]) if (r[k]) data[k] = maskId(r[k], rt);
      if (rt.dataPolicy === "aggregates") for (const k of ["first_name", "last_name", "company_name", "notes"]) delete data[k];
      if (ctx.can("treasury", "view")) {
        const b = await partyBalance(ctx.db, ctx, id);
        data.balance = {
          current_account: fmtMoney(b.balance, m),
          all_accounts: fmtMoney(b.total, m),
          note: "positive = the party owes the business, negative = the business owes the party",
          cheques_received_open: { count: b.cheques.received_open.count, sum: fmtMoney(b.cheques.received_open.sum, m) },
          cheques_bounced: { count: b.cheques.bounced.count, sum: fmtMoney(b.cheques.bounced.sum, m) },
          cheques_issued_open: { count: b.cheques.issued_open.count, sum: fmtMoney(b.cheques.issued_open.sum, m) },
        };
      }
      return { data, ref: ref("party", id, String(data.name)) };
    }
    case "item": {
      const r = await ctx.db.one<Record<string, any>>(
        `select i.*, c.name as category, u.name as unit,
                (select coalesce(sum(qty), 0) from tz_stock_moves where item_id = i.id and org_id = i.org_id) as stock_qty,
                (select coalesce(sum(value), 0) from tz_stock_moves where item_id = i.id and org_id = i.org_id) as stock_value
         from tz_items i left join tz_item_categories c on c.id = i.category_id left join tz_units u on u.id = i.unit_id
         where i.id = $1 and i.org_id = $2 and i.deleted_at is null`,
        [id, org],
      );
      if (!r) throw notFound("کالا پیدا نشد");
      const data = pick(r, ["id", "code", "name", "kind", "category", "unit", "barcode", "sale_price", "purchase_price", "min_sale_price", "vat_pct", "min_stock", "reorder_point", "max_stock", "gold_weight", "fineness", "is_active", "description"]);
      data.stock_qty = D(r.stock_qty).toString();
      if (ctx.can("inventory", "view")) data.stock_value = fmtMoney(D(r.stock_value), m);
      data.currency_unit = m.unit;
      return { data, ref: ref("item", id, r.name) };
    }
    case "account": {
      const r = await ctx.db.one<Record<string, any>>(`select id, code, name, level, kind, nature, is_postable, system_key, detail_mode, description from tz_accounts where id = $1 and org_id = $2 and deleted_at is null`, [id, org]);
      if (!r) throw notFound("حساب پیدا نشد");
      return { data: pick(r, Object.keys(r)), ref: ref("account", id, `${r.code} ${r.name}`) };
    }
    case "invoice": {
      const r = await getInvoice(ctx, id);
      if (!invoiceKindsAllowed(ctx).includes(r.kind)) throw forbidden();
      const data = withJalali(pick(r, ["id", "kind", "no", "ref_no", "date", "due_date", "status", "party_name", "warehouse_name", "subtotal", "line_discount", "discount", "additions", "deductions", "tax", "total", "paid", "remaining", "settlement", "notes"]));
      Object.assign(data, lines(r.lines, ["line_no", "item_code", "item_name", "description", "qty", "unit_name", "unit_price", "discount", "vat", "total", "cost"]));
      data.currency_unit = m.unit;
      return { data, ref: ref("invoice", id, `${INVOICE_TITLE[r.kind] ?? "فاکتور"} ${r.no}`, { kind: r.kind }) };
    }
    case "voucher": {
      const v = (await getVoucher(ctx.db, org, id)) as Record<string, any> | null;
      if (!v) throw notFound("سند پیدا نشد");
      const data = withJalali(pick(v, ["id", "no", "daily_no", "date", "kind", "status", "description", "ref_no", "total_debit", "total_credit", "source_type"]));
      Object.assign(data, lines(v.lines, ["line_no", "account_code", "account_name", "detail_name", "description", "debit", "credit", "fx_debit", "fx_credit", "currency_code", "w_debit", "w_credit"]));
      data.currency_unit = m.unit;
      return { data, ref: ref("voucher", id, `سند ${v.no}`) };
    }
    case "treasury_doc": {
      const d = (await getTreasuryDoc(ctx.db, org, id)) as Record<string, any>;
      const data = withJalali(pick(d, ["id", "kind", "no", "date", "party_name", "account_name", "detail_name", "description", "total", "voucher_no"]));
      Object.assign(data, lines(d.lines, ["line_no", "direction", "method", "cash_box_name", "bank_account_name", "amount", "fee", "ref_no", "description"]));
      data.allocations = Array.isArray(d.allocs) ? d.allocs.slice(0, 30).map((x: Record<string, any>) => pick(x, ["invoice_no", "invoice_kind", "amount"])) : [];
      data.currency_unit = m.unit;
      return { data, ref: ref("treasury_doc", id, `${TREASURY_KIND_FA[d.kind] ?? "سند"} ${d.no}`) };
    }
    case "cheque": {
      const c = (await getCheque(ctx.db, ctx, id)) as Record<string, any>;
      const data = withJalali(pick(c, ["id", "direction", "serial_no", "bank_name", "branch_name", "amount", "issue_date", "due_date", "status", "party_name", "holder_name", "description"]));
      if (c.sayad_no) data.sayad_no = maskId(c.sayad_no, rt);
      if (c.account_no) data.account_no = maskId(c.account_no, rt);
      data.status_fa = CHEQUE_STATUS_TITLE[c.status] ?? c.status;
      data.history = Array.isArray(c.history) ? c.history.slice(-12).map((h: Record<string, any>) => withJalali(pick(h, ["action", "date", "status", "note"]))) : [];
      data.currency_unit = m.unit;
      return { data, ref: ref("cheque", id, `چک ${c.serial_no ?? ""}`.trim(), { direction: c.direction }) };
    }
    case "gold_doc": {
      const d = (await readGoldDoc(ctx.db, org, id)) as Record<string, any>;
      const data = withJalali(pick(d, ["id", "kind", "no", "date", "status", "party_name", "gram18", "mazaneh", "gold_value", "wage", "profit", "tax", "stone", "discount", "old_value", "total", "weight_out", "weight_in", "description"]));
      data.kind_fa = d.kind_title ?? (GOLD_KINDS as Record<string, { title: string }>)[d.kind]?.title;
      if (d.party?.name) data.party_name = d.party.name;
      Object.assign(data, lines(d.lines, ["line_no", "kind", "direction", "title", "coin_name", "category_name", "tag_no", "qty", "weight", "fineness", "weight750", "gram_price", "gold_value", "wage", "profit", "tax", "discount", "total", "cost"]));
      data.currency_unit = m.unit;
      data.weight_unit = "گرم";
      return { data, ref: ref("gold_doc", id, `${data.kind_fa ?? "سند طلا"} ${d.no}`) };
    }
    case "gold_item": {
      const r = await ctx.db.one<Record<string, any>>(
        `select g.*, gc.name as category from tz_gold_items g left join tz_gold_categories gc on gc.id = g.category_id where g.id = $1 and g.org_id = $2 and g.deleted_at is null`,
        [id, org],
      );
      if (!r) throw notFound("جنس پیدا نشد");
      return { data: pick(r, ["id", "tag_no", "title", "category", "fineness", "gross_weight", "stone_weight", "net_weight", "wage_type", "wage_value", "profit_pct", "stone_desc", "stone_price", "ownership", "status", "cost", "notes"]), ref: ref("gold_item", id, `اتیکت ${r.tag_no}`, { tag: r.tag_no }) };
    }
    case "gold_bar": {
      const r = await ctx.db.one<Record<string, any>>(`select * from tz_gold_bars where id = $1 and org_id = $2 and deleted_at is null`, [id, org]);
      if (!r) throw notFound("شمش پیدا نشد");
      return {
        data: withJalali(pick(r, ["id", "bar_no", "brand", "serial_no", "nominal_weight", "weight", "fineness", "fine_weight", "weight750", "certificate_no", "certificate_issuer", "assay_lab", "assay_no", "assay_date", "seal_status", "source", "ownership", "status", "cost", "notes"])),
        ref: ref("gold_bar", id, `شمش ${r.bar_no}`, { tag: r.bar_no }),
      };
    }
    case "fx_deal": {
      const d = (await getDeal(ctx, id)) as Record<string, any>;
      const deal = (d.deal ?? d) as Record<string, any>;
      const data = withJalali(pick(deal, ["id", "no", "date", "kind", "status", "party_name", "in_currency_code", "in_amount", "in_method", "out_currency_code", "out_amount", "out_method", "rate", "fee", "base_value", "cost_value", "profit", "market_rate", "description"]));
      data.currency_unit = m.unit;
      return { data, ref: ref("fx_deal", id, `${FX_KIND_FA[deal.kind] ?? "معامله"} ${deal.no}`) };
    }
    case "remittance": {
      const r = (await getRemittance(ctx, id)) as Record<string, any>;
      const rem = (r.remittance ?? r) as Record<string, any>;
      const data = withJalali(pick(rem, ["id", "no", "date", "direction", "status", "party_name", "correspondent_name", "currency_code", "amount", "rate", "base_amount", "fee", "correspondent_fee", "pay_method", "tracking_code", "paid_date", "description"]));
      data.currency_unit = m.unit;
      return { data, ref: ref("remittance", id, `حواله ${rem.no}`) };
    }
    default:
      throw bad("نوع رکورد پشتیبانی نمی‌شود");
  }
}

export const getRecord = defineTool({
  name: "get_record",
  title_fa: "خواندن رکورد",
  description:
    "Reads one record by type and id (from find_records or a link the person is looking at): header fields, up to 60 lines, totals, status, Jalali dates (fields ending in _fa). Parties include their receivable/payable balance when the person may see treasury (positive = the party owes the business). Amounts are in the business's base currency unless a currency code is given; weights are grams.",
  input: z.object({ type: z.enum(RECORD_TYPES), id: z.string().uuid() }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input, rt) {
    needType(ctx, input.type);
    const m = await moneyInfo(ctx);
    const r = await getOne(ctx, input.type, input.id, m, rt);
    if (rt.dataPolicy === "aggregates") for (const k of ["party_name", "holder_name", "correspondent_name", "party_mobile"]) delete r.data[k];
    return { data: { type: input.type, ...r.data }, refs: [r.ref], summary_fa: r.ref.label };
  },
});
