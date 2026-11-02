// Gold documents (sale, purchase, buy-back, consignment, workshop, melt, bullion sale, opening
// stock): input validation and pricing on the server (client figures are never trusted),
// numbering per kind and fiscal year, and the lifecycle draft → posted → cancelled with the
// piece / coin / voucher bookkeeping of ./posting.
import { z } from "zod";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { insertMany, insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, isNumeric, normalizeDigits, type Num } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { faDigits, formatMoney } from "@shared/format";
import { isLegalNationalId, isNationalId } from "@shared/validate";
import { barLineDefaults, coinLineDefaults, premiumToWage } from "@shared/gold-quote";
import { fiscalYearFor } from "../accounting/fiscal";
import { audit } from "../data/crud";
import {
  KINDS, DOC_KINDS, LINE_KIND_TITLES, bothPrices, docTotals, lineSide, pieceDefaults, priceLine,
  type DocKind, type Direction, type LineIn, type LineKind, type DocTotals,
} from "./pricing";
import { goldSettings, priceEnv } from "./settings";
import { products, type ProductRow } from "./catalogue";
import { normalizeBarNo, normalizeBrand, normalizeSerial, type BarRow } from "./bars";
import { latestRate, type RateRow } from "./rates";
import { assertCoinStock, coinStock, normalizeTag, type CategoryRow, type GoldItemRow } from "./items";
import { applyDoc, settleDue, unapplyDoc, type DocRow, type LineRow, type Settle, type SettleMoney } from "./posting";

// ---------------------------------------------------------------- input

const num = z.union([z.string().max(40), z.number()]).nullish();
const uuid = z.string().uuid().nullish();

const barSchema = z
  .object({
    bar_no: z.string().max(40).nullish(),
    serial_no: z.string().max(80).nullish(),
    brand: z.string().max(80).nullish(),
    qr: z.string().max(500).nullish(),
    nominal_weight: num,
    certificate_no: z.string().max(80).nullish(),
    certificate_issuer: z.string().max(120).nullish(),
    assay_lab: z.string().max(120).nullish(),
    assay_no: z.string().max(60).nullish(),
    assay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    seal_status: z.enum(["sealed", "opened", "damaged", "no_card"]).nullish(),
  })
  .nullish();

export const lineSchema = z.object({
  kind: z.enum(["piece", "bulk", "old", "coin", "bar"]),
  direction: z.enum(["out", "in"]).nullish(),
  gold_item_id: uuid,
  gold_bar_id: uuid,
  bar: barSchema,
  /** bars: a fixed price of the bar instead of metal + premium */
  unit_price: num,
  /** bars bought back: fee percent and assay fee instead of the defaults */
  fee_pct: num,
  assay_fee: num,
  item_id: uuid,
  category_id: uuid,
  title: z.string().max(200).nullish(),
  form: z.enum(["bullion", "old", "scrap"]).nullish(),
  qty: num,
  fineness: num,
  weight: num,
  stone_weight: num,
  gram_price: num,
  wage_type: z.enum(["percent", "per_gram", "fixed"]).nullish(),
  wage_value: num,
  profit_pct: num,
  stone: num,
  discount: num,
  deduction_pct: num,
  cost: num,
  assay_no: z.string().max(60).nullish(),
  tag_no: z.string().max(40).nullish(),
  description: z.string().max(500).nullish(),
  extra: z
    .object({
      sale_wage_type: z.enum(["percent", "per_gram", "fixed"]).nullish(),
      sale_wage_value: num,
      sale_profit_pct: num,
      sale_stone_price: num,
      stone_desc: z.string().max(200).nullish(),
    })
    .nullish(),
});

const moneySchema = z
  .object({ cash_box_id: uuid, pos_id: uuid, bank_account_id: uuid, amount: num, ref_no: z.string().max(60).nullish() })
  .nullish();

export const docSchema = z.object({
  kind: z.enum(DOC_KINDS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست"),
  party_id: uuid,
  gram18: num,
  mazaneh: num,
  status: z.enum(["draft", "posted"]).optional(),
  description: z.string().max(1000).nullish(),
  /** purchase source (wholesaler, ICE auction, the public) and its reference */
  extra: z
    .object({
      source: z.enum(["wholesaler", "ice", "public"]).nullish(),
      auction_ref: z.string().max(80).nullish(),
    })
    .nullish(),
  buyer: z
    .object({
      name: z.string().max(160).nullish(),
      national_id: z.string().max(20).nullish(),
      economic_code: z.string().max(20).nullish(),
      mobile: z.string().max(20).nullish(),
      postal_code: z.string().max(20).nullish(),
      address: z.string().max(400).nullish(),
    })
    .nullish(),
  settle: z
    .object({
      mode: z.enum(["rial", "weight"]).nullish(),
      cash: moneySchema,
      pos: moneySchema,
      bank: moneySchema,
      consumed_weight750: num,
      close_workshop: z.boolean().nullish(),
    })
    .nullish(),
  lines: z.array(lineSchema).min(1, "سند ردیفی ندارد").max(500, "حداکثر ۵۰۰ ردیف"),
});

export type DocInput = z.infer<typeof docSchema>;
type LineInput = z.infer<typeof lineSchema>;

const has = (v: Num) => v !== null && v !== undefined && v !== "";

function decimal(v: Num, label: string, n: number, opts: { min?: Num; max?: Num; positive?: boolean } = {}): string | null {
  if (!has(v)) return null;
  if (!isNumeric(v)) throw bad(`ردیف ${faDigits(n)}: «${label}» باید عدد باشد`);
  const d = D(v);
  if (d.isNeg()) throw bad(`ردیف ${faDigits(n)}: «${label}» نمی‌تواند منفی باشد`);
  if (opts.positive && d.isZero()) throw bad(`ردیف ${faDigits(n)}: «${label}» را وارد کنید`);
  if (opts.max !== undefined && d.gt(D(opts.max))) throw bad(`ردیف ${faDigits(n)}: «${label}» معتبر نیست`);
  return d.toString();
}

function defaultDirection(kind: DocKind, lineKind: LineKind): Direction {
  const r = KINDS[kind].lines;
  if (r.in.includes(lineKind) && !r.out.includes(lineKind)) return "in";
  return "out";
}

function defaultForm(kind: DocKind, direction: Direction): "bullion" | "old" {
  if (kind === "melt") return direction === "in" ? "bullion" : "old";
  if (kind === "workshop_out" || kind === "workshop_in") return "old";
  return "bullion";
}

type LineDraft = Omit<LineRow, "id" | "doc_id" | "org_id">;

export interface Prepared {
  header: {
    kind: DocKind;
    fiscal_year_id: string;
    date: string;
    party_id: string | null;
    gram18: string | null;
    mazaneh: string | null;
    gold_value: string;
    wage: string;
    profit: string;
    tax: string;
    stone: string;
    discount: string;
    old_value: string;
    total: string;
    weight_out: string;
    weight_in: string;
    settle: Settle;
    buyer: Record<string, string>;
    description: string | null;
    extra: Record<string, string>;
  };
  lines: LineDraft[];
  totals: DocTotals;
}

/** Validate, complete (from tags, categories, coins and the rate board) and price a document. */
export async function prepare(q: Queryable, ctx: Ctx, input: DocInput, docId: string | null, opts: { preview?: boolean } = {}): Promise<Prepared> {
  const kind = input.kind;
  const rule = KINDS[kind];
  const orgId = ctx.org.id;
  const fy = await fiscalYearFor(q, orgId, input.date);

  let party: { id: string; name: string } | null = null;
  if (rule.party !== "none" && input.party_id) {
    party = await q.one(`select id, name from tz_parties where id = $1 and org_id = $2 and deleted_at is null`, [input.party_id, orgId]);
    if (!party) throw bad(`${rule.partyLabel || "طرف حساب"} پیدا نشد`);
  }
  if (rule.party === "required" && !party) throw bad(`${rule.partyLabel} را انتخاب کنید`);

  const raw = input.lines;
  const pieceIds = raw.filter((l) => l.kind === "piece" && l.gold_item_id).map((l) => l.gold_item_id!);
  const items = new Map(
    pieceIds.length
      ? (await q.query<GoldItemRow>(`select * from tz_gold_items where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [orgId, `{${pieceIds.join(",")}}`])).map((r) => [r.id, r])
      : [],
  );
  // tags this document created earlier (an edited purchase keeps its tags)
  const own = new Set(
    docId && pieceIds.length
      ? (await q.query<{ id: string }>(`select id from tz_gold_items where org_id = $1 and in_doc_id = $2 and id = any($3::uuid[])`, [orgId, docId, `{${pieceIds.join(",")}}`])).map((r) => r.id)
      : [],
  );
  const cats = new Map(
    (await q.query<CategoryRow>(`select id, name, default_fineness, wage_type, wage_value, profit_pct from tz_gold_categories where org_id = $1 and deleted_at is null`, [orgId])).map((c) => [c.id, c]),
  );
  const barIds = raw.filter((l) => l.kind === "bar" && l.gold_bar_id).map((l) => l.gold_bar_id!);
  const bars = new Map(
    barIds.length
      ? (await q.query<BarRow>(`select * from tz_gold_bars where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [orgId, `{${barIds.join(",")}}`])).map((r) => [r.id, r])
      : [],
  );
  const productIds = [...new Set([...raw.filter((l) => (l.kind === "coin" || l.kind === "bar") && l.item_id).map((l) => l.item_id!), ...[...bars.values()].map((b) => b.item_id).filter((x): x is string => !!x)])];
  const prods = new Map<string, ProductRow>(productIds.length ? (await products(q, orgId, ["coin", "bar"], productIds)).map((r) => [r.id, r]) : []);
  const gs = goldSettings(ctx.org);

  // market price: the document's, else the latest rate when a line needs it
  let { gram18, mazaneh } = bothPrices(input.gram18, input.mazaneh);
  let rate: RateRow | null | undefined;
  const getRate = async () => (rate === undefined ? (rate = await latestRate(q, orgId)) : rate);
  const needsG18 = raw.some((l) => {
    if (has(l.gram_price) && D(l.gram_price).gt(0) && l.kind !== "coin") return false;
    if (l.kind === "coin") return (kind === "sale" || kind === "buyback" || kind === "purchase") && prods.get(l.item_id ?? "")?.gold_meta.pricing_mode === "weight";
    if (l.kind === "bar" && kind === "bullion_sale") return !mazaneh;
    if (l.kind === "bar") return (kind === "sale" || kind === "buyback" || kind === "purchase" || (kind === "opening" && !has(l.cost))) && !(has(l.unit_price) && D(l.unit_price).gt(0));
    switch (kind) {
      case "sale":
      case "purchase":
      case "buyback":
        return true;
      case "opening":
        return !has(l.cost);
      case "workshop_in":
        return l.kind === "piece" && (l.wage_type ?? "percent") === "percent" && D(l.wage_value ?? 0).gt(0);
      case "bullion_sale":
        return !mazaneh;
      default:
        return false;
    }
  });
  if (needsG18 && !gram18 && !(kind === "bullion_sale" && mazaneh)) {
    const r = await getRate();
    if (r?.gram18) ({ gram18, mazaneh } = bothPrices(r.gram18, r.mazaneh));
    if (!gram18) throw bad(kind === "bullion_sale" ? "مظنه را وارد کنید" : "قیمت گرم ۱۸ عیار را وارد کنید");
  }
  const env = priceEnv(ctx.org, { gram18: gram18 ?? 0, mazaneh }, { date: input.date });
  const seenBars = new Set<string>();
  const seenSerials = new Set<string>();
  const reason = (l: LineInput, n: number) => {
    if (!l.description?.trim()) throw bad(`ردیف ${faDigits(n)}: دلیل کسر بابت وضعیت را در شرح ردیف بنویسید`);
  };

  const lines: LineDraft[] = [];
  const seenItems = new Set<string>();
  const seenTags = new Set<string>();
  for (const [i, l] of raw.entries()) {
    const n = i + 1;
    const direction = l.direction ?? defaultDirection(kind, l.kind);
    if (!rule.lines[direction].includes(l.kind)) {
      throw bad(`ردیف ${faDigits(n)}: «${LINE_KIND_TITLES[l.kind]}» ${direction === "out" ? "خروجی" : "ورودی"} در «${rule.title}» مجاز نیست`);
    }
    const draft: LineDraft = {
      line_no: n, kind: l.kind, direction, gold_item_id: null, gold_bar_id: null, item_id: null, category_id: null, title: l.title?.trim() || null, form: null,
      qty: "1", fineness: null, weight: "0", weight750: "0", stone_weight: null, gram_price: null, gold_value: "0", wage_type: null, wage_value: null,
      wage: "0", profit_pct: null, profit: "0", tax: "0", stone: "0", deduction_pct: null, discount: "0", total: "0", assay_no: l.assay_no?.trim() || null,
      description: l.description?.trim() || null, cost: null, tag_no: null, extra: {},
    };
    let pin: LineIn;
    const gramPrice = decimal(l.gram_price, l.kind === "coin" ? "قیمت واحد" : "قیمت گرم", n);

    if (l.kind === "piece" && direction === "out") {
      if (!l.gold_item_id) throw bad(`ردیف ${faDigits(n)}: اتیکت جنس را اسکن یا انتخاب کنید`);
      const it = items.get(l.gold_item_id);
      if (!it) throw bad(`ردیف ${faDigits(n)}: جنس پیدا نشد`);
      if (seenItems.has(it.id)) throw bad(`اتیکت ${faDigits(it.tag_no)} دو بار در سند آمده است`);
      seenItems.add(it.id);
      const cat = it.category_id ? cats.get(it.category_id) ?? null : null;
      const d = pieceDefaults(it, cat);
      Object.assign(draft, {
        gold_item_id: it.id, tag_no: it.tag_no, category_id: it.category_id, title: draft.title ?? (it.title || cat?.name || "جنس طلا"),
        stone_weight: d.stone_weight, wage_type: l.wage_type ?? d.wage_type, wage_value: decimal(l.wage_value, "اجرت", n) ?? d.wage_value,
      });
      pin = {
        kind: "piece", direction, weight: d.weight, fineness: d.fineness, gram_price: gramPrice, wage_type: draft.wage_type, wage_value: draft.wage_value,
        profit_pct: decimal(l.profit_pct, "سود", n, { max: 100 }) ?? d.profit_pct, stone: decimal(l.stone, "ارزش سنگ", n) ?? d.stone,
        discount: decimal(l.discount, "تخفیف", n),
      };
    } else if (l.kind === "piece") {
      const cat = l.category_id ? cats.get(l.category_id) ?? null : null;
      if (l.category_id && !cat) throw bad(`ردیف ${faDigits(n)}: دسته پیدا نشد`);
      const weight = decimal(l.weight, "وزن خالص", n, { positive: true })!;
      const fineness = decimal(l.fineness, "عیار", n, { max: 1000 }) ?? D(cat?.default_fineness ?? 750).toString();
      if (D(fineness).isZero()) throw bad(`ردیف ${faDigits(n)}: عیار را وارد کنید`);
      const tag = l.tag_no ? normalizeTag(l.tag_no) : "";
      if (tag) {
        if (seenTags.has(tag)) throw bad(`اتیکت ${faDigits(tag)} دو بار در سند آمده است`);
        seenTags.add(tag);
      }
      const x = l.extra ?? {};
      const extra: Record<string, string> = {};
      if (x.sale_wage_type) extra.sale_wage_type = x.sale_wage_type;
      for (const k of ["sale_wage_value", "sale_profit_pct", "sale_stone_price"] as const) {
        const v = decimal(x[k], k === "sale_wage_value" ? "اجرت فروش" : k === "sale_profit_pct" ? "سود فروش" : "ارزش سنگ", n);
        if (v !== null) extra[k] = v;
      }
      if (x.stone_desc?.trim()) extra.stone_desc = x.stone_desc.trim();
      Object.assign(draft, {
        gold_item_id: l.gold_item_id && own.has(l.gold_item_id) ? l.gold_item_id : null,
        tag_no: tag || null, category_id: cat?.id ?? null, title: draft.title ?? cat?.name ?? "جنس طلا",
        stone_weight: decimal(l.stone_weight, "وزن سنگ", n) ?? "0", wage_type: l.wage_type ?? "percent", wage_value: decimal(l.wage_value, "اجرت", n) ?? "0", extra,
      });
      pin = {
        kind: "piece", direction, weight, fineness, gram_price: gramPrice, wage_type: draft.wage_type, wage_value: draft.wage_value,
        stone: decimal(l.stone, "ارزش سنگ", n), cost: decimal(l.cost, "بهای تمام‌شده", n),
      };
    } else if (l.kind === "bulk") {
      const weight = decimal(l.weight, "وزن", n, { positive: true })!;
      const fineness = decimal(l.fineness, "عیار", n, { max: 1000 }) ?? "750";
      if (D(fineness).isZero()) throw bad(`ردیف ${faDigits(n)}: عیار را وارد کنید`);
      const form = l.form ?? defaultForm(kind, direction);
      Object.assign(draft, {
        form, title: draft.title ?? (form === "bullion" ? "آبشده" : form === "scrap" ? "طلای شکسته" : "طلای مستعمل"),
        wage_type: kind === "sale" || kind === "purchase" || kind === "opening" ? l.wage_type ?? "fixed" : null,
        wage_value: kind === "sale" || kind === "purchase" || kind === "opening" ? decimal(l.wage_value, "اجرت", n) ?? "0" : null,
      });
      pin = {
        kind: "bulk", direction, form, weight, fineness, gram_price: gramPrice, wage_type: draft.wage_type, wage_value: draft.wage_value,
        profit_pct: decimal(l.profit_pct, "سود", n, { max: 100 }), stone: decimal(l.stone, "ارزش سنگ", n),
        discount: decimal(l.discount, "تخفیف", n), cost: decimal(l.cost, "بهای تمام‌شده", n),
      };
    } else if (l.kind === "old") {
      const weight = decimal(l.weight, "وزن", n, { positive: true })!;
      const fineness = decimal(l.fineness, "عیار", n, { max: 1000 }) ?? "750";
      if (D(fineness).isZero()) throw bad(`ردیف ${faDigits(n)}: عیار را وارد کنید`);
      Object.assign(draft, { form: "old", title: draft.title ?? "طلای مستعمل" });
      pin = { kind: "old", direction: "in", weight, fineness, gram_price: gramPrice, deduction_pct: decimal(l.deduction_pct, "درصد کسر", n, { max: 100 }) };
    } else if (l.kind === "coin") {
      if (!l.item_id) throw bad(`ردیف ${faDigits(n)}: نوع سکه را انتخاب کنید`);
      const c = prods.get(l.item_id);
      if (!c || c.kind !== "coin") throw bad(`ردیف ${faDigits(n)}: سکه پیدا نشد`);
      const qty = decimal(l.qty, "تعداد", n, { positive: true })!;
      if (!D(qty).isInteger()) throw bad(`ردیف ${faDigits(n)}: تعداد سکه باید عدد صحیح باشد`);
      const side = lineSide(direction);
      const priced = kind === "sale" || kind === "buyback" || kind === "purchase" || (kind === "opening" && !has(l.cost));
      const d = coinLineDefaults(c, priced ? await getRate() : null, side, { wholesale: kind === "purchase" });
      // weight-priced coins follow the document's gram price (the buy price of the board when we buy)
      let price = gramPrice;
      if (!price && priced) {
        if (d.pricing_mode === "weight") price = side === "sell" ? gram18 : d.gram_price ?? gram18;
        else price = d.gram_price;
      }
      if (!price && priced) throw bad(`ردیف ${faDigits(n)}: قیمت ${side === "buy" ? "خرید " : ""}«${c.name}» را وارد کنید`);
      const discount = decimal(l.discount, side === "buy" ? "کسر بابت وضعیت" : "تخفیف", n);
      if (side === "buy" && discount && D(discount).gt(0)) reason(l, n);
      let unitCost: string | null = null;
      if (d.vat_mode === "margin" && side === "sell" && kind === "sale") {
        const st = docId ? await coinStock(q as Tx, orgId, c.id, input.date, docId) : await coinStock(q as Tx, orgId, c.id, input.date, "00000000-0000-0000-0000-000000000000");
        unitCost = st.avg ? st.avg.toDecimalPlaces(0).toString() : "0";
      }
      const wageType = d.pricing_mode === "weight" ? l.wage_type ?? d.wage_type : null;
      const wageValue = d.pricing_mode === "weight" ? decimal(l.wage_value, "اجرت", n) ?? d.wage_value : null;
      Object.assign(draft, {
        item_id: c.id, title: draft.title ?? c.name, wage_type: wageType, wage_value: wageValue,
        extra: { pricing_mode: d.pricing_mode, vat_mode: d.vat_mode, ...(unitCost ? { unit_cost: unitCost } : {}) },
      });
      pin = {
        kind: "coin", direction, qty, fineness: c.fineness ?? "900", weight: D(qty).times(D(c.gold_weight ?? 0)).toString(), gram_price: price,
        pricing_mode: d.pricing_mode, vat_mode: d.vat_mode, wage_type: wageType, wage_value: wageValue,
        profit_pct: d.pricing_mode === "weight" && side === "sell" ? decimal(l.profit_pct, "سود", n, { max: 100 }) ?? d.profit_pct : null,
        unit_cost: unitCost, discount, cost: decimal(l.cost, "بهای تمام‌شده", n),
      };
    } else {
      // bars: out lines are bars of the register; in lines describe the bar that comes in
      const x = l.bar ?? {};
      let bar: BarRow | null = null;
      if (l.gold_bar_id) {
        bar = bars.get(l.gold_bar_id) ?? null;
        if (!bar) throw bad(`ردیف ${faDigits(n)}: شمش پیدا نشد`);
        if (seenBars.has(bar.id)) throw bad(`شمش ${faDigits(bar.bar_no)} دو بار در سند آمده است`);
        seenBars.add(bar.id);
      } else if (direction === "out") throw bad(`ردیف ${faDigits(n)}: شمش را اسکن یا انتخاب کنید`);
      const model = prods.get(l.item_id ?? bar?.item_id ?? "") ?? null;
      if (l.item_id && (!model || model.kind !== "bar")) throw bad(`ردیف ${faDigits(n)}: مدل شمش پیدا نشد`);
      const side = lineSide(direction);
      const weight = direction === "out" ? D(bar!.weight).toString() : decimal(l.weight, "وزن شمش", n, { positive: true }) ?? (bar ? D(bar.weight).toString() : null);
      if (!weight) throw bad(`ردیف ${faDigits(n)}: وزن شمش را وارد کنید`);
      const fineness = direction === "out" ? D(bar!.fineness).toString() : decimal(l.fineness, "عیار", n, { max: 1000 }) ?? (bar ? D(bar.fineness).toString() : model?.fineness ? D(model.fineness).toString() : "995");
      if (D(fineness).isZero()) throw bad(`ردیف ${faDigits(n)}: عیار را وارد کنید`);
      const seal = x.seal_status ?? bar?.seal_status ?? "sealed";
      const serial = (x.serial_no ?? bar?.serial_no ?? "").trim();
      const brand = normalizeBrand(x.brand ?? bar?.brand ?? model?.gold_meta.brand ?? "");
      if (direction === "in" && serial) {
        const k = `${brand}|${normalizeSerial(serial)}`;
        if (seenSerials.has(k)) throw bad(`سریال «${serial}» دو بار در سند آمده است`);
        seenSerials.add(k);
      }
      const d = barLineDefaults(model, { weight, seal_status: seal }, side === "buy" || kind === "sale" || kind === "purchase" ? await getRate() : null, gs.bars, side);
      const unit = decimal(l.unit_price, "قیمت شمش", n) ?? (kind === "sale" || ((kind === "buyback") && side === "buy") ? d.unit_price : null);
      const discount = decimal(l.discount, side === "buy" ? "کسر بابت وضعیت" : "تخفیف", n);
      if (side === "buy" && discount && D(discount).gt(0)) reason(l, n);
      const sellSide = kind === "sale" && direction === "out";
      const wageType = sellSide ? l.wage_type ?? premiumToWage(d.premium_type) : kind === "purchase" || kind === "opening" ? l.wage_type ?? "percent" : null;
      const wageValue = sellSide ? decimal(l.wage_value, "حق ضرب", n) ?? d.premium_value : kind === "purchase" || kind === "opening" ? decimal(l.wage_value, "حق ضرب", n) ?? "0" : null;
      const attrs: Record<string, string> = {};
      if (direction === "in") {
        const barNo = x.bar_no ? normalizeBarNo(x.bar_no) : "";
        if (barNo) attrs.bar_no = barNo;
        if (serial) attrs.serial_no = serial;
        if (brand) attrs.brand = brand;
        for (const k of ["qr", "certificate_no", "certificate_issuer", "assay_lab", "assay_no", "assay_date"] as const) {
          const v = x[k] ?? (bar ? (bar[k] as string | null) : null);
          if (v && String(v).trim()) attrs[k] = String(v).trim();
        }
        const nominal = decimal(x.nominal_weight, "وزن اسمی", n) ?? (bar?.nominal_weight ? D(bar.nominal_weight).toString() : model?.gold_weight ? D(model.gold_weight).toString() : null);
        if (nominal) attrs.nominal_weight = nominal;
        attrs.seal_status = seal;
      }
      const sealed = seal === "sealed";
      const feePct = side === "buy" ? decimal(l.fee_pct, "کارمزد خرید", n, { max: 100 }) ?? d.fee_pct : null;
      const assayFee = side === "buy" ? decimal(l.assay_fee, "هزینه‌ی ری‌گیری", n) ?? d.assay_fee : null;
      Object.assign(draft, {
        gold_bar_id: bar?.id ?? null, item_id: model?.id ?? null, tag_no: bar?.bar_no ?? attrs.bar_no ?? null,
        title: draft.title ?? model?.name ?? "شمش", wage_type: wageType, wage_value: wageValue,
        extra: {
          ...(direction === "in" ? { bar: attrs } : {}), ...(unit ? { unit_price: unit } : {}), basis: d.basis, vat_mode: d.vat_mode,
          ...(feePct !== null ? { fee_pct: feePct, assay_fee: assayFee, sealed: sealed ? "1" : "0" } : {}),
        },
      });
      pin = {
        kind: "bar", direction, weight, fineness, gram_price: gramPrice, unit_price: unit, basis: d.basis, wage_type: wageType, wage_value: wageValue,
        profit_pct: sellSide ? decimal(l.profit_pct, "سود", n, { max: 100 }) : null, vat_mode: d.vat_mode, discount, cost: decimal(l.cost, "بهای تمام‌شده", n),
        sealed, fee_pct: feePct, assay_fee: assayFee, opened_fineness: d.opened_fineness,
      };
    }

    if (kind === "workshop_in" && l.kind === "piece" && (draft.wage_type ?? "percent") === "percent" && D(draft.wage_value ?? 0).gt(0) && !gram18 && !gramPrice) {
      throw bad("برای اجرت درصدی، قیمت گرم ۱۸ عیار را وارد کنید");
    }
    const p = priceLine(kind, pin, env);
    Object.assign(draft, {
      qty: p.qty, fineness: p.fineness, weight: p.weight, weight750: p.weight750, gram_price: p.gram_price, gold_value: p.gold_value,
      wage: p.wage, profit_pct: p.profit_pct, profit: p.profit, tax: p.tax, stone: p.stone, discount: p.discount,
      deduction_pct: p.deduction_pct, total: p.total,
    });
    lines.push(draft);
  }
  if (kind === "melt" && (!lines.some((l) => l.direction === "out") || !lines.some((l) => l.direction === "in"))) {
    throw bad("ذوب باید هم طلای ورودی (مستعمل، جنس، سکه یا شمش) و هم آب‌شده‌ی حاصل را داشته باشد");
  }

  const totals = docTotals(kind, lines);
  const settle = normalizeSettle(kind, input.settle, lines, !!party, ctx.org.money_decimals, !!opts.preview);
  const buyer: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.buyer ?? {})) if (typeof v === "string" && v.trim()) buyer[k] = normalizeDigits(v.trim());
  return {
    header: {
      kind, fiscal_year_id: fy.id, date: input.date, party_id: party?.id ?? null, gram18, mazaneh,
      gold_value: totals.gold_value, wage: totals.wage, profit: totals.profit, tax: totals.tax, stone: totals.stone, discount: totals.discount,
      old_value: totals.old_value, total: totals.total, weight_out: totals.weight_out, weight_in: totals.weight_in,
      settle, buyer, description: input.description?.trim() || null, extra: docExtra(kind, input.extra),
    },
    lines,
    totals,
  };
}

function docExtra(kind: DocKind, raw: DocInput["extra"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (kind === "purchase" && raw?.source) out.source = raw.source;
  if (kind === "purchase" && raw?.auction_ref?.trim()) out.auction_ref = normalizeDigits(raw.auction_ref.trim());
  return out;
}

/**
 * Identification (KYC): selling or buying coins, bars or آب‌شده needs a party with a valid national
 * id (or the walk-in buyer's) when the setting is on and the document reaches the threshold.
 */
export async function assertKyc(q: Queryable, ctx: Ctx, doc: { kind: DocKind; party_id: string | null; total: Num; old_value: Num; buyer?: Record<string, unknown> | null }, lines: { kind: string; form: string | null }[]) {
  const k = goldSettings(ctx.org).kyc;
  if (!k.enabled || !["sale", "buyback", "bullion_sale"].includes(doc.kind)) return;
  if (!lines.some((l) => l.kind === "coin" || l.kind === "bar" || (l.kind === "bulk" && l.form === "bullion"))) return;
  const amount = D(doc.total ?? 0).abs().gt(D(doc.old_value ?? 0).abs()) ? D(doc.total ?? 0).abs() : D(doc.old_value ?? 0).abs();
  if (k.threshold && amount.lt(D(k.threshold))) return;
  const valid = (v: unknown) => typeof v === "string" && (isNationalId(v) || isLegalNationalId(v));
  if (valid(doc.buyer?.national_id)) return;
  if (doc.party_id) {
    const p = await q.one<{ national_id: string | null }>(`select national_id from tz_parties where id = $1 and org_id = $2`, [doc.party_id, ctx.org.id]);
    if (valid(p?.national_id)) return;
  }
  const who = doc.kind === "buyback" ? "فروشنده" : "خریدار";
  const above = k.threshold ? ` از ${formatMoney(k.threshold, ctx.org.money_decimals)} به بالا` : "";
  throw bad(`برای ${doc.kind === "buyback" ? "خرید" : "فروش"} سکه، شمش یا آب‌شده${above} شناسایی ${who} لازم است؛ ${who} با کد ملی معتبر را انتخاب کنید یا کد ملی را در مشخصات ${who} وارد کنید`);
}

function normalizeSettle(kind: DocKind, raw: DocInput["settle"], lines: LineDraft[], hasParty: boolean, dp: number, preview = false): Settle {
  const rule = KINDS[kind];
  const s: Settle = {};
  if (rule.modes) s.mode = raw?.mode === "weight" ? "weight" : "rial";
  if (s.mode === "weight" && !hasParty) throw bad(`برای تسویه‌ی وزنی، ${rule.partyLabel} را انتخاب کنید`);
  const due = settleDue(kind, s.mode, lines);
  const allowCash = rule.cash !== "none" && !(kind === "bullion_sale" && s.mode === "weight");
  const money = (m: NonNullable<DocInput["settle"]>["cash"], field: "cash_box_id" | "pos_id" | "bank_account_id", label: string): SettleMoney | null => {
    if (!m || !allowCash) return null;
    if (has(m.amount) && !isNumeric(m.amount)) throw bad(`مبلغ ${label} معتبر نیست`);
    const amount = D(m.amount ?? 0).toDecimalPlaces(dp);
    if (amount.isNeg()) throw bad(`مبلغ ${label} نمی‌تواند منفی باشد`);
    if (amount.isZero()) return null;
    const id = m[field];
    if (!id || !isUuid(id)) throw bad(`${label} را انتخاب کنید`);
    return { [field]: id, amount: amount.toString(), ...(m.ref_no?.trim() ? { ref_no: m.ref_no.trim() } : {}) } as SettleMoney;
  };
  s.cash = money(raw?.cash, "cash_box_id", "صندوق");
  s.pos = money(raw?.pos, "pos_id", "کارتخوان");
  s.bank = money(raw?.bank, "bank_account_id", "حساب بانکی");
  if (s.pos && (rule.cash !== "receive" || due.isNeg())) throw bad("پرداخت به طرف حساب با کارتخوان ممکن نیست؛ نقد یا واریز بانکی را انتخاب کنید");
  const paid = D(s.cash?.amount ?? 0).plus(D(s.pos?.amount ?? 0)).plus(D(s.bank?.amount ?? 0));
  const remaining = due.abs().minus(paid);
  if (remaining.isNeg() && !preview) throw bad(`مبلغ پرداختی (${faDigits(paid.toString())}) از مبلغ قابل تسویه (${faDigits(due.abs().toString())}) بیشتر است`);
  if (!remaining.isZero() && !hasParty && !preview) {
    throw bad(`${faDigits(remaining.toString())} از مبلغ سند تسویه نشده است؛ برای نسیه ${rule.partyLabel || "طرف حساب"} را انتخاب کنید یا کل مبلغ را دریافت/پرداخت کنید`);
  }
  s.due = due.toString();
  s.paid = paid.toString();
  s.remaining = remaining.toString();
  if (kind === "workshop_in") {
    s.consumed_weight750 = has(raw?.consumed_weight750) && isNumeric(raw!.consumed_weight750) && D(raw!.consumed_weight750).gt(0) ? D(raw!.consumed_weight750).toDecimalPlaces(3).toString() : null;
    s.close_workshop = !!raw?.close_workshop;
  }
  return s;
}

// ---------------------------------------------------------------- persistence

async function writeLines(tx: Tx, ctx: Ctx, docId: string, drafts: LineDraft[]): Promise<LineRow[]> {
  const rows: LineRow[] = drafts.map((l) => ({ ...l, id: uuidv7(), doc_id: docId, org_id: ctx.org.id }));
  await insertMany(tx, "tz_gold_lines", rows as unknown as Record<string, unknown>[]);
  return rows;
}

export async function loadDocRow(q: Queryable, orgId: string, id: string): Promise<DocRow> {
  const d = await q.one<DocRow>(`select * from tz_gold_docs where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!d) throw notFound("سند طلا پیدا نشد");
  return d;
}

async function loadLines(q: Queryable, docId: string): Promise<LineRow[]> {
  return q.query<LineRow>(`select * from tz_gold_lines where doc_id = $1 order by line_no`, [docId]);
}

const summary = (kind: DocKind, no: number) => `${KINDS[kind].title} ش ${faDigits(no)}`;

export async function createDoc(ctx: Ctx, input: DocInput) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const p = await prepare(tx, ctx, input, null);
    const id = uuidv7();
    const no = await nextNo(tx, "tz_gold_docs", ctx.org.id, p.header.fiscal_year_id, input.kind);
    const status = input.status ?? "posted";
    if (status === "posted") await assertKyc(tx, ctx, p.header, p.lines);
    await insertRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id, no, status, ...p.header, created_by: ctx.user.id, origin: ctx.cfg.origin }, "id");
    const lines = await writeLines(tx, ctx, id, p.lines);
    if (status === "posted") {
      const voucherId = await applyDoc(tx, ctx, await loadDocRow(tx, ctx.org.id, id), lines);
      await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { voucher_id: voucherId, origin: ctx.cfg.origin });
    }
    await audit(tx, ctx, "create", "gold_doc", id, summary(input.kind, no));
    return readDoc(tx, ctx.org.id, id);
  });
}

export async function updateDoc(ctx: Ctx, id: string, input: DocInput) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const prev = await loadDocRow(tx, ctx.org.id, id);
    if (prev.kind !== input.kind) throw bad("نوع سند قابل تغییر نیست");
    // documents of a closed fiscal year stay as they are
    if (prev.status === "posted") await fiscalYearFor(tx, ctx.org.id, prev.date);
    const status = input.status ?? prev.status;
    if (status === "cancelled") throw conflict("سند باطل‌شده قابل ویرایش نیست؛ ابتدا آن را دوباره ثبت یا پیش‌نویس کنید");
    // undo the old posting first so its pieces are free again (its voucher is replaced in place)
    const undone = prev.status === "posted" ? await unapplyDoc(tx, ctx, prev, { keepVoucher: status === "posted" }) : null;
    const p = await prepare(tx, ctx, input, id);
    if (status === "posted") await assertKyc(tx, ctx, p.header, p.lines);
    const no = prev.fiscal_year_id === p.header.fiscal_year_id ? prev.no : await nextNo(tx, "tz_gold_docs", ctx.org.id, p.header.fiscal_year_id, input.kind);
    await tx.query(`delete from tz_gold_lines where doc_id = $1`, [id]);
    const lines = await writeLines(tx, ctx, id, p.lines);
    await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { ...p.header, no, status, origin: ctx.cfg.origin });
    let voucherId: string | null = null;
    if (status === "posted") voucherId = await applyDoc(tx, ctx, await loadDocRow(tx, ctx.org.id, id), lines);
    // the old posting's coins (perhaps on an earlier date) must still cover the later sales
    if (undone && status === "posted") await assertCoinStock(tx, ctx.org.id, undone.coinItems, prev.date < input.date ? prev.date : input.date);
    await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { voucher_id: voucherId, origin: ctx.cfg.origin });
    await audit(tx, ctx, "update", "gold_doc", id, summary(input.kind, no));
    return readDoc(tx, ctx.org.id, id);
  });
}

/** Post a draft (or re-post a cancelled document) with the figures it was saved with. */
export async function postDoc(ctx: Ctx, id: string) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const doc = await loadDocRow(tx, ctx.org.id, id);
    if (doc.status === "posted") throw conflict("این سند قبلاً ثبت شده است");
    const lines = await loadLines(tx, id);
    await assertKyc(tx, ctx, doc, lines);
    const fy = await fiscalYearFor(tx, ctx.org.id, doc.date);
    const no = fy.id === doc.fiscal_year_id ? doc.no : await nextNo(tx, "tz_gold_docs", ctx.org.id, fy.id, doc.kind);
    await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { fiscal_year_id: fy.id, no, status: "posted", origin: ctx.cfg.origin });
    const voucherId = await applyDoc(tx, ctx, await loadDocRow(tx, ctx.org.id, id), lines);
    await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { voucher_id: voucherId, origin: ctx.cfg.origin });
    await audit(tx, ctx, "post", "gold_doc", id, summary(doc.kind, no));
    return readDoc(tx, ctx.org.id, id);
  });
}

/** Cancel (باطل) a posted document: its pieces return, its tags and voucher go. */
export async function cancelDoc(ctx: Ctx, id: string) {
  ctx.need("gold", "edit");
  return ctx.write(async (tx) => {
    const doc = await loadDocRow(tx, ctx.org.id, id);
    if (doc.status !== "posted") throw conflict("فقط سند ثبت‌شده باطل می‌شود");
    await fiscalYearFor(tx, ctx.org.id, doc.date); // documents of a closed year stay as they are
    await unapplyDoc(tx, ctx, doc);
    await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { status: "cancelled", voucher_id: null, origin: ctx.cfg.origin });
    await audit(tx, ctx, "cancel", "gold_doc", id, summary(doc.kind, doc.no));
    return readDoc(tx, ctx.org.id, id);
  });
}

export async function deleteDoc(ctx: Ctx, id: string) {
  ctx.need("gold", "full");
  return ctx.write(async (tx) => {
    const doc = await loadDocRow(tx, ctx.org.id, id);
    if (doc.status === "posted") {
      await fiscalYearFor(tx, ctx.org.id, doc.date); // documents of a closed year stay as they are
      await unapplyDoc(tx, ctx, doc);
    }
    await updateRow(tx, "tz_gold_docs", { id, org_id: ctx.org.id }, { deleted_at: new Date().toISOString(), voucher_id: null, origin: ctx.cfg.origin });
    await audit(tx, ctx, "delete", "gold_doc", id, summary(doc.kind, doc.no));
    return { ok: true };
  });
}

// ---------------------------------------------------------------- reading

/** A document with its party, lines (tags, categories, coins), voucher and settlement names. */
export async function readDoc(q: Queryable, orgId: string, id: string) {
  const doc = await loadDocRow(q, orgId, id);
  const [party, lines, voucher] = await Promise.all([
    doc.party_id
      ? q.one(`select id, code, name, mobile, phone, national_id, economic_code, postal_code, address, city, detail_id from tz_parties where id = $1`, [doc.party_id])
      : Promise.resolve(null),
    q.query(
      `select l.*, c.name as category_name, coalesce(i.status, b.status) as item_status, coalesce(i.ownership, b.ownership) as ownership, i.supplier_id,
              ci.name as coin_name, ci.code as coin_code, ci.rate_key, b.bar_no, b.serial_no, b.brand, b.seal_status, b.certificate_no, b.fine_weight
       from tz_gold_lines l
       left join tz_gold_categories c on c.id = l.category_id
       left join tz_gold_items i on i.id = l.gold_item_id
       left join tz_gold_bars b on b.id = l.gold_bar_id
       left join tz_items ci on ci.id = l.item_id
       where l.doc_id = $1 order by l.line_no`,
      [id],
    ),
    q.one(`select id, no, date, status from tz_vouchers where org_id = $1 and source_type = 'gold_doc' and source_id = $2 and deleted_at is null limit 1`, [orgId, id]),
  ]);
  const s = doc.settle ?? {};
  const names = {
    cash: s.cash?.cash_box_id ? (await q.one<{ name: string }>(`select name from tz_cash_boxes where id = $1`, [s.cash.cash_box_id]))?.name ?? null : null,
    pos: s.pos?.pos_id ? (await q.one<{ name: string }>(`select name from tz_pos_terminals where id = $1`, [s.pos.pos_id]))?.name ?? null : null,
    bank: s.bank?.bank_account_id ? (await q.one<{ name: string }>(`select name from tz_bank_accounts where id = $1`, [s.bank.bank_account_id]))?.name ?? null : null,
  };
  const creator = doc.created_by ? await q.one<{ full_name: string }>(`select full_name from tz_users where id = $1`, [doc.created_by]) : null;
  return { ...doc, kind_title: KINDS[doc.kind].title, party, lines, voucher, settle_names: names, created_by_name: creator?.full_name ?? null };
}

export interface DocListParams {
  kind?: string;
  status?: string;
  from?: string;
  to?: string;
  party_id?: string;
  q?: string;
  fiscal_year_id?: string;
  page?: number;
  size?: number;
}

export async function listDocs(ctx: Ctx, p: DocListParams) {
  ctx.need("gold", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["d.org_id = $1", "d.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (p.kind) {
    const kinds = p.kind.split(",").filter((k) => (DOC_KINDS as readonly string[]).includes(k));
    if (kinds.length) add("d.kind = any(?::text[])", `{${kinds.join(",")}}`);
  }
  if (p.status && ["draft", "posted", "cancelled"].includes(p.status)) add("d.status = ?", p.status);
  if (p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from)) add("d.date >= ?", p.from);
  if (p.to && /^\d{4}-\d{2}-\d{2}$/.test(p.to)) add("d.date <= ?", p.to);
  if (p.party_id && isUuid(p.party_id)) add("d.party_id = ?", p.party_id);
  if (p.fiscal_year_id && isUuid(p.fiscal_year_id)) add("d.fiscal_year_id = ?", p.fiscal_year_id);
  if (p.q?.trim()) {
    const s = normalizeDigits(p.q.trim());
    if (/^\d+$/.test(s)) {
      params.push(Number(s));
      const a = params.length;
      params.push(s);
      cond.push(`(d.no = $${a} or exists (select 1 from tz_gold_lines gl where gl.doc_id = d.id and gl.tag_no = $${params.length}))`);
    } else {
      params.push(likeContains(s));
      const n = params.length;
      cond.push(
        `(pa.name ilike $${n} or coalesce(d.description, '') ilike $${n} or coalesce(d.buyer->>'name', '') ilike $${n}
          or exists (select 1 from tz_gold_lines gl left join tz_gold_bars gb on gb.id = gl.gold_bar_id
                     where gl.doc_id = d.id and (gb.serial_no ilike $${n} or gl.extra->'bar'->>'serial_no' ilike $${n})))`,
      );
    }
  }
  const where = cond.join(" and ");
  const size = Math.min(Math.max(p.size ?? 50, 1), 500);
  const page = Math.max(p.page ?? 1, 1);
  const sums = await ctx.db.one<{ n: number; total: string; weight_out: string; weight_in: string }>(
    `select count(*)::int as n, coalesce(sum(case when d.status = 'posted' then d.total end), 0) as total,
            coalesce(sum(case when d.status = 'posted' then d.weight_out end), 0) as weight_out,
            coalesce(sum(case when d.status = 'posted' then d.weight_in end), 0) as weight_in
     from tz_gold_docs d left join tz_parties pa on pa.id = d.party_id where ${where}`,
    params,
  );
  const rows = await ctx.db.query(
    `select d.id, d.kind, d.no, d.date, d.status, d.party_id, pa.name as party_name, d.buyer->>'name' as buyer_name, d.gram18, d.mazaneh,
            d.gold_value, d.wage, d.profit, d.tax, d.discount, d.old_value, d.total, d.weight_out, d.weight_in, d.settle->>'remaining' as remaining,
            d.settle->>'mode' as mode, d.description, d.voucher_id, d.created_at,
            (select count(*)::int from tz_gold_lines gl where gl.doc_id = d.id) as line_count,
            (select v.no from tz_vouchers v where v.id = d.voucher_id) as voucher_no
     from tz_gold_docs d left join tz_parties pa on pa.id = d.party_id
     where ${where} order by d.date desc, d.created_at desc limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { rows: rows.map((r) => ({ ...r, kind_title: KINDS[r.kind as DocKind]?.title ?? r.kind })), total: sums?.n ?? 0, page, size, sums };
}
