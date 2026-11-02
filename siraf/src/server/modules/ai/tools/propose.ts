// Proposal tools: the assistant prepares a document, nothing is written. Each tool resolves what
// the model named (party, items, accounts, boxes…) exactly, validates with the module's own rules
// and calculators, and returns a Persian preview, the payload the executor in ./proposals.ts will
// run once a permitted person confirms, and a link to the same data in the normal form.
import { z } from "zod";
import type { Ctx } from "../../../context";
import { D, normalizeDigits } from "@shared/money";
import { isUuid } from "@shared/id";
import { isMobile, isNationalId, isLegalNationalId, normalizeMobile } from "@shared/validate";
import { formatMoney, formatNumber } from "@shared/format";
import { bad, forbidden } from "../../../http/errors";
import { calcInvoice } from "../../goods/calc";
import { kindArea } from "../../goods/common";
import { normalizeLines } from "../../accounting/vouchers";
import { docSchema as goldDocSchema, prepare as prepareGold } from "../../gold/docs";
import { KINDS as GOLD_KINDS } from "../../gold/pricing";
import { previewDeal, type DealInput } from "../../fx/deals";
import { defineTool, type AiProposalInput } from "./registry";
import {
  dec, faNorm, faSql, fmtMoney, jd, moneyInfo, moneyUnitInput, resolveAccount, resolveCurrency, resolveItem, resolveMoneyBox, resolveParty, toBase,
} from "./common";
import { parseDateInput } from "../analytics/period";

const dateArg = z.string().max(24).nullish().describe("Jalali «1405/08/11» or ISO; default today");

function dateOf(raw: string | null | undefined, today: string, label = "تاریخ"): string {
  if (!raw) return today;
  const d = parseDateInput(raw, today);
  if (!d) throw bad(`${label} «${raw}» معتبر نیست`);
  return d;
}

const DRAFT_NOTE = "پس از تأیید، به‌صورت پیش‌نویس ثبت می‌شود و تا وقتی آن را قطعی نکنید در حساب‌ها اثری ندارد.";

// ---------------------------------------------------------------- invoice

export const invoicePayload = z.object({
  kind: z.enum(["sale", "purchase", "quote"]),
  date: z.string(),
  due_date: z.string().nullish(),
  party_id: z.string().uuid(),
  discount: z.string().nullish(),
  notes: z.string().max(4000).nullish(),
  lines: z.array(z.object({ item_id: z.string().uuid(), qty: z.string(), unit_price: z.string().nullish(), discount: z.string().nullish(), vat_pct: z.string().nullish(), description: z.string().max(500).nullish() })).min(1).max(200),
});
export type InvoicePayload = z.infer<typeof invoicePayload>;

export const proposeInvoice = defineTool({
  name: "propose_invoice",
  title_fa: "پیش‌نویس فاکتور",
  description:
    "Prepares a goods sales invoice, purchase invoice or quote as a DRAFT for the person to confirm (nothing is saved until they confirm; the confirmed draft does not affect the books until it is posted in the app). party: id, exact name, code, national id or mobile. Each line: item (id, exact code/barcode or exact name), qty, optional unit_price (default: the item's sale/purchase price), discount amount, vat_pct (default: the item's or the business's). Amounts in money_unit (default the base currency). Ambiguous names return candidates — ask the person which one, do not guess.",
  input: z.object({
    kind: z.enum(["sale", "purchase", "quote"]),
    party: z.string().min(1).max(120),
    date: dateArg,
    due_date: dateArg,
    lines: z.array(z.object({
      item: z.string().min(1).max(120),
      qty: z.union([z.string(), z.number()]),
      unit_price: z.union([z.string(), z.number()]).nullish(),
      discount: z.union([z.string(), z.number()]).nullish(),
      vat_pct: z.union([z.string(), z.number()]).nullish(),
      description: z.string().max(300).nullish(),
    })).min(1).max(50),
    discount: z.union([z.string(), z.number()]).nullish().describe("invoice-level discount amount"),
    money_unit: moneyUnitInput,
    notes: z.string().max(1000).nullish(),
  }),
  kind: "propose",
  area: "sales",
  level: "edit",
  modules: ["goods"],
  async run(ctx, input, rt) {
    const area = kindArea(input.kind);
    ctx.need(area, "edit");
    const m = await moneyInfo(ctx);
    const party = await resolveParty(ctx.db, ctx, input.party);
    const date = dateOf(input.date, rt.today);
    const due = input.due_date ? dateOf(input.due_date, rt.today, "سررسید") : null;
    const vatDefault = String(ctx.org.settings?.vat_pct ?? "10");
    const warnings: string[] = [];
    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const item = await resolveItem(ctx.db, ctx, l.item, ["goods", "service"]);
      if (!item.is_active) warnings.push(`«${item.name}» غیرفعال است`);
      const qty = dec(l.qty, `تعداد ردیف ${i + 1}`, { positive: true });
      const listPrice = input.kind === "purchase" ? item.purchase_price : item.sale_price;
      const price = l.unit_price !== null && l.unit_price !== undefined && l.unit_price !== "" ? toBase(l.unit_price, input.money_unit, m, `قیمت ردیف ${i + 1}`) : listPrice ? D(listPrice).toString() : null;
      if (price === null) throw bad(`قیمت «${item.name}» تعریف نشده است؛ قیمت را بدهید`);
      if (D(price).lt(0)) throw bad(`قیمت ردیف ${i + 1} منفی است`);
      lines.push({
        item, qty, unit_price: price,
        discount: l.discount ? toBase(l.discount, input.money_unit, m, `تخفیف ردیف ${i + 1}`) : "0",
        vat_pct: l.vat_pct !== null && l.vat_pct !== undefined && l.vat_pct !== "" ? dec(l.vat_pct, `مالیات ردیف ${i + 1}`, { min0: true }) : item.vat_pct ?? vatDefault,
        description: l.description ?? null,
      });
    }
    if (input.kind === "sale") {
      const stock = await ctx.db.query<{ item_id: string; q: string }>(
        `select item_id, coalesce(sum(qty), 0) as q from tz_stock_moves where org_id = $1 and item_id = any($2::uuid[]) group by item_id`,
        [ctx.org.id, `{${lines.map((l) => l.item.id).join(",")}}`],
      );
      for (const l of lines) {
        if (l.item.kind !== "goods") continue;
        const have = D(stock.find((s) => s.item_id === l.item.id)?.q ?? 0);
        if (have.lt(D(l.qty))) warnings.push(`موجودی «${l.item.name}» ${formatNumber(have, { dp: 3 })} است و کمتر از تعداد فاکتور`);
      }
    }
    const discount = input.discount ? toBase(input.discount, input.money_unit, m, "تخفیف فاکتور") : "0";
    const calc = calcInvoice({ dp: m.dp, lines: lines.map((l) => ({ qty: l.qty, unit_price: l.unit_price, discount_pct: "0", discount: l.discount, vat_pct: l.vat_pct })), discount, discount_pct: "0", additions: "0", deductions: "0" });
    const payload: InvoicePayload = {
      kind: input.kind, date, due_date: due, party_id: party.id, discount, notes: input.notes ?? null,
      lines: lines.map((l) => ({ item_id: l.item.id, qty: l.qty, unit_price: l.unit_price, discount: l.discount, vat_pct: l.vat_pct, description: l.description })),
    };
    const title = input.kind === "sale" ? "فاکتور فروش" : input.kind === "purchase" ? "فاکتور خرید" : "پیش‌فاکتور";
    const proposal: AiProposalInput = {
      kind: input.kind === "sale" ? "sales_invoice" : input.kind === "purchase" ? "purchase_invoice" : "quote",
      title_fa: `پیش‌نویس ${title}`,
      summary_fa: `${title} برای «${party.name}» به مبلغ ${fmtMoney(calc.total, m)}`,
      payload,
      preview: [
        { label: "شخص", value: party.name },
        { label: "تاریخ", value: jd(date)! },
        ...(due ? [{ label: "سررسید", value: jd(due)! }] : []),
        { label: "جمع ردیف‌ها", value: fmtMoney(calc.subtotal, m) },
        ...(D(calc.line_discount).plus(D(calc.discount)).gt(0) ? [{ label: "تخفیف", value: fmtMoney(D(calc.line_discount).plus(D(calc.discount)), m) }] : []),
        { label: "مالیات بر ارزش افزوده", value: fmtMoney(calc.tax, m) },
        { label: "مبلغ کل", value: fmtMoney(calc.total, m) },
      ],
      // amounts without the unit in every cell: the unit is in the headers
      line_headers: ["کالا", "تعداد", `فی (${m.unit})`, `مالیات (${m.unit})`, `جمع (${m.unit})`],
      lines: lines.map((l, i) => ({ cells: [l.item.name, formatNumber(l.qty, { dp: 3 }), formatMoney(l.unit_price, m.dp), formatMoney(calc.lines[i].vat, m.dp), formatMoney(calc.lines[i].total, m.dp)] })),
      warnings: [...warnings, input.kind === "quote" ? "پیش‌فاکتور در حساب‌ها اثری ندارد." : DRAFT_NOTE],
      edit_path: `${input.kind === "purchase" ? "purchases/invoices" : input.kind === "quote" ? "sales/quotes" : "sales/invoices"}/new?party=${party.id}`,
      area,
      level: "edit",
    };
    return { data: { proposal: "prepared", awaiting_confirmation: true, total: calc.total, unit: m.unit, warnings }, proposal, summary_fa: proposal.summary_fa };
  },
});

// ---------------------------------------------------------------- voucher

async function resolveDetail(ctx: Ctx, q: string): Promise<{ id: string; name: string }> {
  const s = q.trim();
  const rows = isUuid(s)
    ? await ctx.db.query<{ id: string; name: string }>(`select id, name from tz_details where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id])
    : await ctx.db.query<{ id: string; name: string }>(
        `select id, name from tz_details where org_id = $1 and deleted_at is null and (code = $2 or ${faSql("name")} = $3) limit 3`,
        [ctx.org.id, normalizeDigits(s), faNorm(s)],
      );
  if (rows.length === 1) return rows[0];
  throw bad(rows.length ? `چند حساب تفصیلی با «${s}» هست؛ شناسه را بدهید` : `حساب تفصیلی «${s}» پیدا نشد`, rows.length ? { candidates: rows.map((r) => ({ id: r.id, label: r.name })) } : undefined);
}

export const voucherPayload = z.object({
  date: z.string(),
  description: z.string().max(1000).nullish(),
  lines: z.array(z.object({ account_id: z.string().uuid(), detail_id: z.string().uuid().nullish(), description: z.string().max(500).nullish(), debit: z.string(), credit: z.string() })).min(2).max(100),
});
export type VoucherPayload = z.infer<typeof voucherPayload>;

export const proposeVoucher = defineTool({
  name: "propose_voucher",
  title_fa: "پیش‌نویس سند حسابداری",
  description:
    "Prepares a manual accounting voucher as a DRAFT for the person to confirm. Lines: account (id, code or exact name of a postable account), optional party (its detail account is used) or detail id, debit or credit (one of them, > 0), description. Debits must equal credits. Amounts in money_unit (default the base currency). Use only when no operational document (invoice, receipt, payment) fits.",
  input: z.object({
    date: dateArg,
    description: z.string().max(500).nullish(),
    lines: z.array(z.object({
      account: z.string().min(1).max(120),
      party: z.string().max(120).nullish().describe("a party: its detail account is used"),
      detail: z.string().max(120).nullish().describe("other detail account (cash box, bank account, cost center…): id, code or exact name"),
      debit: z.union([z.string(), z.number()]).nullish(),
      credit: z.union([z.string(), z.number()]).nullish(),
      description: z.string().max(300).nullish(),
    })).min(2).max(40),
    money_unit: moneyUnitInput,
  }),
  kind: "propose",
  area: "accounting",
  level: "edit",
  async run(ctx, input, rt) {
    ctx.need("accounting", "edit");
    const m = await moneyInfo(ctx);
    const date = dateOf(input.date, rt.today);
    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const acc = await resolveAccount(ctx.db, ctx, l.account, { postable: true });
      const party = l.party ? await resolveParty(ctx.db, ctx, l.party) : null;
      if (party && !party.detail_id) throw bad(`«${party.name}» حساب تفصیلی ندارد`);
      const detail = !party && l.detail ? await resolveDetail(ctx, l.detail) : null;
      const debit = l.debit ? toBase(l.debit, input.money_unit, m, `بدهکار ردیف ${i + 1}`) : "0";
      const credit = l.credit ? toBase(l.credit, input.money_unit, m, `بستانکار ردیف ${i + 1}`) : "0";
      if (D(debit).lt(0) || D(credit).lt(0)) throw bad(`ردیف ${i + 1}: مبلغ منفی مجاز نیست`);
      if (D(debit).isZero() === D(credit).isZero()) throw bad(`ردیف ${i + 1}: فقط یکی از بدهکار یا بستانکار را بدهید`);
      lines.push({ acc, party, detail, debit, credit, description: l.description ?? null });
    }
    const td = lines.reduce((a, l) => a.plus(D(l.debit)), D(0));
    const tc = lines.reduce((a, l) => a.plus(D(l.credit)), D(0));
    if (!td.eq(tc)) throw bad(`سند تراز نیست: جمع بدهکار ${fmtMoney(td, m)} و جمع بستانکار ${fmtMoney(tc, m)}`);
    const payload: VoucherPayload = {
      date, description: input.description ?? null,
      lines: lines.map((l) => ({ account_id: l.acc.id, detail_id: l.party?.detail_id ?? l.detail?.id ?? null, description: l.description, debit: l.debit, credit: l.credit })),
    };
    // the accounting engine's own checks (detail requirements, currencies) before anything is shown
    await normalizeLines(ctx.db, ctx.org.id, payload.lines.map((l, i) => ({ ...l, line_no: i + 1 })) as never, m.dp);
    const proposal: AiProposalInput = {
      kind: "voucher",
      title_fa: "پیش‌نویس سند حسابداری",
      summary_fa: `سند ${input.description ? `«${input.description}» ` : ""}به مبلغ ${fmtMoney(td, m)}`,
      payload,
      preview: [{ label: "تاریخ", value: jd(date)! }, { label: "شرح", value: input.description ?? "—" }, { label: "جمع بدهکار و بستانکار", value: fmtMoney(td, m) }],
      line_headers: ["حساب", "تفصیلی", `بدهکار (${m.unit})`, `بستانکار (${m.unit})`],
      lines: lines.map((l) => ({ cells: [`${l.acc.code} ${l.acc.name}`, l.party?.name ?? l.detail?.name ?? "—", D(l.debit).isZero() ? "—" : formatMoney(l.debit, m.dp), D(l.credit).isZero() ? "—" : formatMoney(l.credit, m.dp)] })),
      warnings: [DRAFT_NOTE],
      edit_path: "accounting/vouchers/new",
      area: "accounting",
      level: "edit",
    };
    return { data: { proposal: "prepared", awaiting_confirmation: true, total: td.toString(), unit: m.unit }, proposal, summary_fa: proposal.summary_fa };
  },
});

// ---------------------------------------------------------------- treasury

export const treasuryPayload = z.object({
  kind: z.enum(["receipt", "payment", "transfer"]),
  date: z.string(),
  party_id: z.string().uuid().nullish(),
  description: z.string().max(1000).nullish(),
  lines: z.array(z.object({
    direction: z.enum(["in", "out"]).nullish(),
    method: z.enum(["cash", "bank"]),
    cash_box_id: z.string().uuid().nullish(),
    bank_account_id: z.string().uuid().nullish(),
    amount: z.string(),
    ref_no: z.string().max(60).nullish(),
    description: z.string().max(500).nullish(),
  })).min(1).max(4),
});
export type TreasuryPayload = z.infer<typeof treasuryPayload>;

const boxArg = z.object({ method: z.enum(["cash", "bank"]), box: z.string().max(120).nullish().describe("cash box or bank account id/code/exact name; empty = the only one") });

export const proposeTreasuryDoc = defineTool({
  name: "propose_treasury_doc",
  title_fa: "پیش‌نویس دریافت و پرداخت",
  description:
    "Prepares a receipt (money received from a party), payment (money paid to a party) or transfer (between the business's own cash boxes and bank accounts) for the person to confirm. Cash and bank transfers only (cheques are entered in the app). party: id or exact name/code/national id/mobile (receipt/payment). Amount in money_unit (default the base currency). NOTE: receipts and payments have no draft state in this app — once the person confirms, the document is recorded (it can still be edited or deleted).",
  input: z.object({
    kind: z.enum(["receipt", "payment", "transfer"]),
    party: z.string().max(120).nullish(),
    date: dateArg,
    amount: z.union([z.string(), z.number()]),
    money_unit: moneyUnitInput,
    via: boxArg.describe("receipt: where the money lands; payment: where it is paid from; transfer: from"),
    to: boxArg.nullish().describe("transfer only: destination"),
    ref_no: z.string().max(60).nullish(),
    description: z.string().max(500).nullish(),
  }),
  kind: "propose",
  area: "treasury",
  level: "edit",
  async run(ctx, input, rt) {
    ctx.need("treasury", "edit");
    const m = await moneyInfo(ctx);
    const date = dateOf(input.date, rt.today);
    const amount = toBase(input.amount, input.money_unit, m, "مبلغ");
    if (!D(amount).gt(0)) throw bad("مبلغ باید بیشتر از صفر باشد");
    const party = input.kind !== "transfer" ? (input.party ? await resolveParty(ctx.db, ctx, input.party) : null) : null;
    if (input.kind !== "transfer" && !party) throw bad("شخص را بدهید");
    const via = await resolveMoneyBox(ctx.db, ctx, input.via.method, input.via.box);
    const line = (dir: "in" | "out" | null, b: { method: "cash" | "bank" }, id: string) => ({
      direction: dir, method: b.method, cash_box_id: b.method === "cash" ? id : null, bank_account_id: b.method === "bank" ? id : null, amount, ref_no: input.ref_no ?? null, description: null,
    });
    const lines = [];
    let toName: string | null = null;
    if (input.kind === "transfer") {
      if (!input.to) throw bad("مقصد انتقال را بدهید");
      const to = await resolveMoneyBox(ctx.db, ctx, input.to.method, input.to.box);
      if (to.id === via.id) throw bad("مبدأ و مقصد انتقال یکی است");
      toName = to.name;
      lines.push(line("out", input.via, via.id), line("in", input.to, to.id));
    } else lines.push(line(null, input.via, via.id));
    const payload: TreasuryPayload = { kind: input.kind, date, party_id: party?.id ?? null, description: input.description ?? null, lines };
    const title = input.kind === "receipt" ? "دریافت" : input.kind === "payment" ? "پرداخت" : "انتقال";
    const viaLabel = `${input.via.method === "cash" ? "صندوق" : "بانک"} «${via.name}»`;
    const proposal: AiProposalInput = {
      kind: input.kind,
      title_fa: `سند ${title}`,
      summary_fa: input.kind === "transfer" ? `انتقال ${fmtMoney(amount, m)} از ${viaLabel} به «${toName}»` : `${title} ${fmtMoney(amount, m)} ${input.kind === "receipt" ? "از" : "به"} «${party!.name}»`,
      payload,
      preview: [
        ...(party ? [{ label: "شخص", value: party.name }] : []),
        { label: "تاریخ", value: jd(date)! },
        { label: input.kind === "receipt" ? "واریز به" : "از", value: viaLabel },
        ...(toName ? [{ label: "به", value: toName }] : []),
        { label: "مبلغ", value: fmtMoney(amount, m) },
        ...(input.description ? [{ label: "شرح", value: input.description }] : []),
      ],
      warnings: ["سند دریافت و پرداخت پیش‌نویس ندارد؛ با تأیید شما ثبت می‌شود و بعداً هم قابل ویرایش یا حذف است."],
      edit_path: `treasury/docs/new?kind=${input.kind}${party ? `&party=${party.id}` : ""}`,
      area: "treasury",
      level: "edit",
    };
    return { data: { proposal: "prepared", awaiting_confirmation: true, amount, unit: m.unit }, proposal, summary_fa: proposal.summary_fa };
  },
});

// ---------------------------------------------------------------- gold

const GOLD_PROPOSE_KINDS = ["sale", "purchase", "buyback"] as const;

export const proposeGoldDoc = defineTool({
  name: "propose_gold_doc",
  title_fa: "پیش‌نویس سند طلا",
  description:
    "Prepares a gold sale, purchase (from a wholesaler) or buy-back (used gold from a customer) as a DRAFT priced by the gold module itself (today's recorded 18k gram unless gram18 is given). Lines: piece (jewellery by tag number), coin (coin name or board key, qty), bar (bar number), bulk (melted/weighed gold: weight g, fineness ‰), old (used gold taken in: weight, fineness). In a sale, old lines are the customer's trade-in. Returns the module's own totals. Amounts in the base currency.",
  input: z.object({
    kind: z.enum(GOLD_PROPOSE_KINDS),
    party: z.string().max(120).nullish().describe("required for purchase; optional for sale and buy-back"),
    date: dateArg,
    gram18: z.union([z.string(), z.number()]).nullish(),
    lines: z.array(z.object({
      kind: z.enum(["piece", "coin", "bar", "bulk", "old"]),
      tag: z.string().max(40).nullish().describe("piece: tag number"),
      coin: z.string().max(120).nullish().describe("coin: name or board key"),
      bar_no: z.string().max(40).nullish(),
      qty: z.union([z.string(), z.number()]).nullish(),
      weight: z.union([z.string(), z.number()]).nullish(),
      fineness: z.union([z.string(), z.number()]).nullish(),
      wage_type: z.enum(["percent", "per_gram", "fixed"]).nullish(),
      wage_value: z.union([z.string(), z.number()]).nullish(),
      discount: z.union([z.string(), z.number()]).nullish(),
    })).min(1).max(30),
    settle: z.enum(["account", "cash", "bank"]).nullish().describe("how it is settled: on the party's account (default with a party), cash (default without one) or bank"),
    box: z.string().max(120).nullish().describe("cash box or bank account for settle=cash/bank; empty = the only one"),
    description: z.string().max(500).nullish(),
  }),
  kind: "propose",
  area: "gold",
  level: "edit",
  modules: ["gold"],
  async run(ctx, input, rt) {
    ctx.need("gold", "edit");
    const m = await moneyInfo(ctx);
    const date = dateOf(input.date, rt.today);
    const party = input.party ? await resolveParty(ctx.db, ctx, input.party) : null;
    const lines: Record<string, unknown>[] = [];
    for (const [i, l] of input.lines.entries()) {
      const n = i + 1;
      const base = { kind: l.kind, wage_type: l.wage_type ?? null, wage_value: l.wage_value ?? null, discount: l.discount ?? null };
      if (l.kind === "piece") {
        if (!l.tag) throw bad(`ردیف ${n}: شمارهٔ اتیکت را بدهید`);
        const g = await ctx.db.one<{ id: string }>(`select id from tz_gold_items where org_id = $1 and tag_no = $2 and deleted_at is null`, [ctx.org.id, l.tag.trim()]);
        if (!g) throw bad(`ردیف ${n}: اتیکت «${l.tag}» پیدا نشد`);
        lines.push({ ...base, gold_item_id: g.id });
      } else if (l.kind === "coin") {
        if (!l.coin) throw bad(`ردیف ${n}: سکه را نام ببرید`);
        const s = l.coin.trim();
        const c = await ctx.db.query<{ id: string }>(
          `select id from tz_items where org_id = $1 and kind = 'coin' and deleted_at is null and (rate_key = $2 or code = $2 or ${faSql("name")} = $3) limit 2`,
          [ctx.org.id, s, faNorm(s)],
        );
        const item = c.length === 1 ? c[0] : await resolveItem(ctx.db, ctx, s, ["coin"]);
        lines.push({ ...base, item_id: item.id, qty: dec(l.qty ?? 1, `تعداد ردیف ${n}`, { positive: true }) });
      } else if (l.kind === "bar") {
        if (!l.bar_no) throw bad(`ردیف ${n}: شمارهٔ شمش را بدهید`);
        const b = await ctx.db.one<{ id: string }>(`select id from tz_gold_bars where org_id = $1 and (bar_no = $2 or serial_no = $2) and deleted_at is null limit 1`, [ctx.org.id, l.bar_no.trim()]);
        if (!b) throw bad(`ردیف ${n}: شمش «${l.bar_no}» پیدا نشد`);
        lines.push({ ...base, gold_bar_id: b.id });
      } else {
        lines.push({ ...base, weight: dec(l.weight, `وزن ردیف ${n}`, { positive: true }), fineness: dec(l.fineness ?? 750, `عیار ردیف ${n}`, { positive: true }) });
      }
    }
    const doc = { kind: input.kind, date, party_id: party?.id ?? null, gram18: input.gram18 ?? null, status: "draft", description: input.description ?? null, lines } as Record<string, unknown>;
    let parsed = goldDocSchema.safeParse(doc);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? "سند طلا معتبر نیست");
    let prep = await prepareGold(ctx.db, ctx, parsed.data, null, { preview: true });
    const settle = input.settle ?? (party ? "account" : "cash");
    if (settle === "account" && !party) throw bad("برای تسویه به حساب شخص، شخص را بدهید");
    let settleLabel = "به حساب شخص";
    if (settle !== "account" && !D(prep.header.total).isZero()) {
      const box = await resolveMoneyBox(ctx.db, ctx, settle, input.box);
      const amount = D(prep.header.total).abs().toString();
      doc.settle = { mode: "rial", [settle]: { [settle === "cash" ? "cash_box_id" : "bank_account_id"]: box.id, amount } };
      settleLabel = `${settle === "cash" ? "نقد از صندوق" : "بانک"} «${box.name}»`;
      parsed = goldDocSchema.safeParse(doc);
      if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? "سند طلا معتبر نیست");
      prep = await prepareGold(ctx.db, ctx, parsed.data, null, { preview: true });
    }
    const h = prep.header;
    const title = (GOLD_KINDS as Record<string, { title: string }>)[input.kind]?.title ?? "سند طلا";
    const proposal: AiProposalInput = {
      kind: "gold_doc",
      title_fa: `پیش‌نویس ${title}`,
      summary_fa: `${title}${party ? ` با «${party.name}»` : ""} به مبلغ ${fmtMoney(h.total, m)}`,
      payload: parsed.data,
      preview: [
        ...(party ? [{ label: "طرف حساب", value: party.name }] : []),
        { label: "تاریخ", value: jd(date)! },
        ...(h.gram18 ? [{ label: "نرخ گرم ۱۸", value: fmtMoney(h.gram18, m) }] : []),
        { label: "ارزش طلا", value: fmtMoney(h.gold_value, m) },
        ...(D(h.wage).gt(0) ? [{ label: "اجرت", value: fmtMoney(h.wage, m) }] : []),
        ...(D(h.profit).gt(0) ? [{ label: "سود", value: fmtMoney(h.profit, m) }] : []),
        ...(D(h.tax).gt(0) ? [{ label: "مالیات", value: fmtMoney(h.tax, m) }] : []),
        ...(D(h.old_value).gt(0) ? [{ label: "طلای دریافتی (کسر)", value: fmtMoney(h.old_value, m) }] : []),
        { label: "مبلغ کل", value: fmtMoney(h.total, m) },
        { label: "تسویه", value: settleLabel },
        { label: "وزن خروجی / ورودی", value: `${formatNumber(h.weight_out, { dp: 3 })} / ${formatNumber(h.weight_in, { dp: 3 })} گرم` },
      ],
      line_headers: ["ردیف", "شرح", "وزن (گرم)", "عیار", `مبلغ (${m.unit})`],
      lines: prep.lines.map((l, i) => {
        const r = l as unknown as Record<string, string | null>;
        return { cells: [String(i + 1), r.title ?? r.kind ?? "—", r.weight ? formatNumber(r.weight, { dp: 3 }) : "—", r.fineness ?? "—", formatMoney(r.total ?? 0, m.dp)] };
      }),
      warnings: [DRAFT_NOTE],
      edit_path: `${{ sale: "gold/sale", purchase: "gold/purchase", buyback: "gold/buyback" }[input.kind]}/new${party ? `?party=${party.id}` : ""}`,
      area: "gold",
      level: "edit",
    };
    return { data: { proposal: "prepared", awaiting_confirmation: true, total: h.total, unit: m.unit }, proposal, summary_fa: proposal.summary_fa };
  },
});

// ---------------------------------------------------------------- fx

export const fxPayload = z.object({
  date: z.string(),
  party_id: z.string().uuid().nullish(),
  in_currency_id: z.string().uuid(),
  in_amount: z.string().nullish(),
  in_method: z.enum(["cash", "bank", "wallet", "party"]),
  out_currency_id: z.string().uuid(),
  out_amount: z.string().nullish(),
  out_method: z.enum(["cash", "bank", "wallet", "party"]),
  rate: z.string().nullish(),
  description: z.string().max(1000).nullish(),
});
export type FxPayload = z.infer<typeof fxPayload>;

export const proposeFxDeal = defineTool({
  name: "propose_fx_deal",
  title_fa: "پیش‌نویس معاملهٔ ارز",
  description:
    "Prepares a currency deal as a DRAFT, calculated by the exchange module itself. side=buy: the business buys `currency` from the customer and pays base currency; side=sell: the business sells `currency`; side=exchange: customer gives `currency` and gets `to_currency`. amount is in `currency`. rate (base per unit) defaults to today's recorded buy/sell rate. Methods: cash, bank, wallet, party (on the customer's account). party optional (walk-in customer).",
  input: z.object({
    side: z.enum(["buy", "sell", "exchange"]),
    currency: z.string().min(2).max(20).describe("currency code, e.g. USD, EUR, AED, USDT"),
    to_currency: z.string().max(20).nullish().describe("exchange only"),
    amount: z.union([z.string(), z.number()]),
    rate: z.union([z.string(), z.number()]).nullish(),
    party: z.string().max(120).nullish(),
    in_method: z.enum(["cash", "bank", "wallet", "party"]).default("cash").describe("how the customer pays the business"),
    out_method: z.enum(["cash", "bank", "wallet", "party"]).default("cash").describe("how the business pays the customer"),
    date: dateArg,
    description: z.string().max(500).nullish(),
  }),
  kind: "propose",
  area: "fx",
  level: "edit",
  modules: ["fx"],
  async run(ctx, input, rt) {
    ctx.need("fx", "edit");
    const m = await moneyInfo(ctx);
    const date = dateOf(input.date, rt.today);
    const cur = await resolveCurrency(ctx.db, ctx, input.currency);
    if (cur.is_base) throw bad("ارز معامله نباید ارز پایه باشد");
    const base = await ctx.db.one<{ id: string }>(`select id from tz_currencies where org_id = $1 and is_base and deleted_at is null limit 1`, [ctx.org.id]);
    if (!base) throw bad("ارز پایهٔ کسب‌وکار تعریف نشده است");
    const other = input.side === "exchange" ? await resolveCurrency(ctx.db, ctx, input.to_currency ?? "") : null;
    const party = input.party ? await resolveParty(ctx.db, ctx, input.party) : null;
    const amount = dec(input.amount, "مبلغ", { positive: true });
    const rate = input.rate !== null && input.rate !== undefined && input.rate !== "" ? dec(input.rate, "نرخ", { positive: true }) : null;
    const inCur = input.side === "sell" ? base.id : cur.id;
    const outCur = input.side === "buy" ? base.id : input.side === "sell" ? cur.id : other!.id;
    const payload: FxPayload = {
      date, party_id: party?.id ?? null, in_currency_id: inCur, out_currency_id: outCur,
      in_amount: input.side === "sell" ? null : amount, out_amount: input.side === "sell" ? amount : null,
      in_method: input.in_method, out_method: input.out_method, rate, description: input.description ?? null,
    };
    const plan = (await previewDeal(ctx, { ...payload, kind: input.side, status: "draft" } as DealInput)) as Record<string, any>;
    const outCode = input.side === "buy" ? m.code : input.side === "sell" ? cur.code : other!.code;
    const inCode = input.side === "sell" ? m.code : cur.code;
    const proposal: AiProposalInput = {
      kind: "fx_deal",
      title_fa: `پیش‌نویس ${input.side === "buy" ? "خرید" : input.side === "sell" ? "فروش" : "تبدیل"} ارز`,
      summary_fa: `${input.side === "buy" ? "خرید" : input.side === "sell" ? "فروش" : "تبدیل"} ${formatNumber(amount, { dp: cur.decimals })} ${cur.code} به نرخ ${formatNumber(plan.rate, { dp: 4 })}`,
      payload,
      preview: [
        { label: "مشتری", value: party?.name ?? "مشتری گذری" },
        { label: "تاریخ", value: jd(date)! },
        { label: "مشتری می‌دهد", value: `${formatNumber(plan.in_amount, { dp: 8 })} ${inCode}` },
        { label: "مشتری می‌گیرد", value: `${formatNumber(plan.out_amount, { dp: 8 })} ${outCode}` },
        { label: "نرخ", value: formatNumber(plan.rate, { dp: 4 }) },
        { label: "ارزش پایه", value: fmtMoney(plan.base_value, m) },
        ...(plan.profit && !D(plan.profit).isZero() ? [{ label: "سود برآوردی", value: fmtMoney(plan.profit, m) }] : []),
      ],
      warnings: [...((plan.warnings as string[]) ?? []), ...((plan.blocking as string[]) ?? []).map((b) => `پیش از ثبت قطعی: ${b}`), DRAFT_NOTE],
      edit_path: "fx/deals/new",
      area: "fx",
      level: "edit",
    };
    return { data: { proposal: "prepared", awaiting_confirmation: true, base_value: plan.base_value, rate: plan.rate, unit: m.unit }, proposal, summary_fa: proposal.summary_fa };
  },
});

// ---------------------------------------------------------------- party

export const partyPayload = z.object({
  kind: z.enum(["person", "company"]),
  name: z.string().min(2).max(200),
  first_name: z.string().max(100).nullish(),
  last_name: z.string().max(100).nullish(),
  company_name: z.string().max(200).nullish(),
  roles: z.array(z.enum(["customer", "supplier", "employee", "partner", "other"])).min(1),
  mobile: z.string().max(20).nullish(),
  national_id: z.string().max(20).nullish(),
  economic_code: z.string().max(20).nullish(),
  city: z.string().max(100).nullish(),
  address: z.string().max(400).nullish(),
  notes: z.string().max(1000).nullish(),
});
export type PartyPayload = z.infer<typeof partyPayload>;

export const proposeParty = defineTool({
  name: "propose_party",
  title_fa: "تعریف شخص",
  description:
    "Prepares a new party (customer, supplier…) for the person to confirm. Checks the national id / company id checksum and the mobile format, and refuses when a party with the same national id or mobile exists (returns it instead). kind person|company.",
  input: partyPayload.extend({ roles: partyPayload.shape.roles.default(["customer"]) }),
  kind: "propose",
  area: "parties",
  level: "edit",
  async run(ctx, input) {
    ctx.need("parties", "edit");
    const warnings: string[] = [];
    const nid = input.national_id ? input.national_id.replace(/\D/g, "") : null;
    if (nid && !(input.kind === "company" ? isLegalNationalId(nid) : isNationalId(nid))) throw bad(input.kind === "company" ? "شناسهٔ ملی شرکت معتبر نیست" : "کد ملی معتبر نیست");
    const mobile = input.mobile ? normalizeMobile(input.mobile) : null;
    if (mobile && !isMobile(mobile)) throw bad("شمارهٔ موبایل معتبر نیست");
    const dup = nid || mobile
      ? await ctx.db.one<{ id: string; name: string; code: string }>(
          `select id, name, code from tz_parties where org_id = $1 and deleted_at is null and ((national_id = $2 and $2 is not null) or (mobile = $3 and $3 is not null)) limit 1`,
          [ctx.org.id, nid, mobile],
        )
      : null;
    if (dup) throw forbidden(`این شخص با نام «${dup.name}» (کد ${dup.code}) پیش‌تر تعریف شده است`);
    const same = await ctx.db.one<{ id: string }>(`select id from tz_parties where org_id = $1 and deleted_at is null and ${faSql("name")} = $2 limit 1`, [ctx.org.id, faNorm(input.name)]);
    if (same) warnings.push("شخص دیگری با همین نام وجود دارد");
    const payload: PartyPayload = { ...input, national_id: nid, mobile };
    const ROLE_FA: Record<string, string> = { customer: "مشتری", supplier: "تأمین‌کننده", employee: "کارمند", partner: "شریک", other: "سایر" };
    const proposal: AiProposalInput = {
      kind: "party",
      title_fa: "تعریف شخص",
      summary_fa: `تعریف «${input.name}» به‌عنوان ${input.roles.map((r) => ROLE_FA[r]).join("، ")}`,
      payload,
      preview: [
        { label: "نام", value: input.name },
        { label: "نوع", value: input.kind === "company" ? "حقوقی" : "حقیقی" },
        { label: "نقش", value: input.roles.map((r) => ROLE_FA[r]).join("، ") },
        ...(mobile ? [{ label: "موبایل", value: mobile }] : []),
        ...(nid ? [{ label: input.kind === "company" ? "شناسهٔ ملی" : "کد ملی", value: nid }] : []),
        ...(input.economic_code ? [{ label: "کد اقتصادی", value: input.economic_code }] : []),
      ],
      warnings,
      // the parties page opens its «new person» form prefilled from these (there is no parties/new route)
      edit_path: `parties?${Object.entries({ new: "1", name: input.name, kind: input.kind, mobile, national_id: nid, economic_code: input.economic_code ?? null })
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${encodeURIComponent(v!).replace(/[!'()*~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`)
        .join("&")}`,
      area: "parties",
      level: "edit",
    };
    return { data: { proposal: "prepared", awaiting_confirmation: true, warnings }, proposal, summary_fa: proposal.summary_fa };
  },
});


