// Exchange deals (معامله‌ی ارز): buy, sell or exchange between any two currencies, each side
// settled through a leg (cash box, bank account, crypto wallet or the customer's account).
//
// Posting (one automatic voucher per deal, type `fx_deal`):
// - buy  (we receive foreign X): Dr in-leg (X amount, base = amount × rate) / Cr out-leg (base).
// - sell (we give foreign X):    Dr in-leg (base) / Cr out-leg (X amount at its average cost),
//                                 the difference is realized profit on «سود (زیان) معاملات ارز».
// - exchange (both foreign):     the out-leg leaves at its average cost, the in-leg comes in at
//                                 the board's mid rate (or at the out cost when it has none).
// - fee: paid by the customer → «درآمد کارمزد»; in the currency they give it goes through the
//   in-leg, in the currency they get it is taken off the out-leg, any other currency goes through
//   the in-leg's method in that currency.
// - network fee of a crypto withdrawal: «کارمزد شبکه» against the paying wallet.
// The average cost is taken when the deal is posted; posting a back-dated deal later does not
// re-value the deals that come after it.
import type { Ctx, OrgRow } from "../../context";
import type { Queryable } from "../../db";
import { likeContains } from "../../db";
import { insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, normalizeDigits } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { formatNumber } from "@shared/format";
import { CHAINS } from "@shared/entities";
import { isCryptoAddress, isMobile, isNationalId, normalizeMobile, type ChainId } from "@shared/validate";
import { accountByKey, cr, dr, postAuto, removeAuto, signed, type VoucherLineInput } from "../accounting/vouchers";
import { fiscalYearFor } from "../accounting/fiscal";
import { audit } from "../data/crud";
import {
  averageCost, cleanPerson, currencyBook, fxSettings, KIND_FA, latestRates, legBalance, METHOD_FA, orgTz, rateMid, resolveLeg, roundTo,
  type Currency, type Leg, type Method,
} from "./common";

export type DealKind = "buy" | "sell" | "exchange";

export interface DealInput {
  date: string;
  kind?: DealKind | null;
  party_id?: string | null;
  walkin?: Record<string, unknown> | null;
  in_currency_id: string;
  in_amount?: string | null;
  in_method: Method;
  in_ref_id?: string | null;
  out_currency_id: string;
  out_amount?: string | null;
  out_method: Method;
  out_ref_id?: string | null;
  rate?: string | null;
  fee?: string | null;
  fee_currency_id?: string | null;
  network_fee?: string | null;
  tx_hash?: string | null;
  network?: string | null;
  address?: string | null;
  description?: string | null;
  status?: "draft" | "posted";
}

export interface DealPlan {
  kind: DealKind;
  in_amount: string;
  out_amount: string;
  rate: string;
  base_value: string;
  cost_value: string;
  profit: string;
  avg_cost: string | null;
  market_rate: string | null;
  fee: string;
  fee_currency_id: string | null;
  fee_base: string;
  network_fee: string;
  walkin: Record<string, string>;
  party: { id: string; name: string } | null;
  legs: { in: Leg; out: Leg };
  lines: VoucherLineInput[];
  /** rules that stop posting (KYC, not enough in the till) */
  blocking: string[];
  warnings: string[];
  kyc_required: boolean;
  /** current position of the currency we give (for the counter screen) */
  position: { currency_id: string; fx: string; avg: string | null } | null;
  title: string;
}

const WALKIN_FIELDS = ["name", "national_id", "mobile", "passport_no", "nationality"];
const fmt = (v: string, dp: number) => formatNumber(v, { dp });

function positive(v: unknown, c: Currency, label: string): string {
  const d = D(v as string);
  if (d.isNeg()) throw bad(`${label} نمی‌تواند منفی باشد`);
  const r = roundTo(d, c.decimals);
  return r;
}

/** Work out amounts, values and voucher lines of a deal without writing anything. */
export async function planDeal(q: Queryable, org: OrgRow, input: DealInput, opts: { dealId?: string | null } = {}): Promise<DealPlan> {
  const cur = await currencyBook(q, org.id);
  const s = fxSettings(org);
  const dp = org.money_decimals ?? 0;
  const inC = cur.get(input.in_currency_id, "ارزی که مشتری می‌دهد");
  const outC = cur.get(input.out_currency_id, "ارزی که مشتری می‌گیرد");
  if (inC.id === outC.id) throw bad("ارز دریافتی و پرداختی نمی‌توانند یکی باشند");
  if (inC.is_base && outC.is_base) throw bad("یک طرف معامله باید ارز خارجی یا رمزارز باشد");
  const kind: DealKind = inC.is_base ? "sell" : outC.is_base ? "buy" : "exchange";
  if (input.kind && input.kind !== kind) throw bad(`با این دو ارز نوع معامله «${KIND_FA[kind]}» است`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw bad("تاریخ معامله معتبر نیست");

  // the board as of the deal's date; a currency with no rate by then falls back to its latest one
  const rates = await latestRates(q, org.id, { date: input.date, tz: orgTz(org) });
  for (const [id, r] of await latestRates(q, org.id)) if (!rates.has(id)) rates.set(id, r);
  const warnings: string[] = [];
  const blocking: string[] = [];

  // ---- amounts and rate
  let inAmt: string;
  let outAmt: string;
  let rate: string;
  if (kind === "buy" || kind === "sell") {
    const fc = kind === "buy" ? inC : outC;
    const board = rates.get(fc.id);
    const r = input.rate && D(input.rate).gt(0) ? D(input.rate) : D(kind === "buy" ? board?.buy ?? rateMid(board) : board?.sell ?? rateMid(board));
    if (r.lte(0)) throw bad(`نرخ ${fc.code} را وارد کنید (در تابلوی نرخ هم ثبت نشده است)`);
    rate = r.toFixed();
    const typedForeign = kind === "buy" ? input.in_amount : input.out_amount;
    const typedBase = kind === "buy" ? input.out_amount : input.in_amount;
    let foreign = D(typedForeign);
    if (foreign.isZero() && D(typedBase).gt(0)) foreign = D(typedBase).div(r); // amount typed in base
    const fa = positive(foreign, fc, `مبلغ ${fc.code}`);
    if (D(fa).lte(0)) throw bad(`مبلغ ${fc.code} را وارد کنید`);
    const ba = roundTo(D(fa).times(r), dp);
    inAmt = kind === "buy" ? fa : ba;
    outAmt = kind === "buy" ? ba : fa;
  } else {
    inAmt = positive(input.in_amount, inC, `مبلغ ${inC.code}`);
    const r = D(input.rate);
    outAmt = D(input.out_amount).gt(0) ? positive(input.out_amount, outC, `مبلغ ${outC.code}`) : r.gt(0) ? roundTo(D(inAmt).times(r), outC.decimals) : "0";
    if (D(inAmt).lte(0)) throw bad(`مبلغ ${inC.code} را وارد کنید`);
    if (D(outAmt).lte(0)) throw bad(`مبلغ ${outC.code} یا نرخ تبدیل را وارد کنید`);
    rate = D(outAmt).div(D(inAmt)).toDecimalPlaces(18).toFixed(); // units of out per one unit of in
  }

  // ---- customer
  let party: { id: string; name: string; national_id: string | null; passport_no: string | null; id_doc_no: string | null; is_blacklisted: boolean; kyc_status: string } | null = null;
  if (input.party_id) {
    party = await q.one(`select id, name, national_id, passport_no, id_doc_no, is_blacklisted, kyc_status from tz_parties where id = $1 and org_id = $2 and deleted_at is null`, [input.party_id, org.id]);
    if (!party) throw bad("مشتری پیدا نشد");
    if (party.is_blacklisted) throw bad(`«${party.name}» در فهرست سیاه است و معامله با او مجاز نیست`);
  }
  const walkin = party ? {} : cleanPerson(input.walkin, WALKIN_FIELDS);
  if (walkin.national_id) {
    walkin.national_id = normalizeDigits(walkin.national_id).replace(/[\s-]/g, "");
    const iranian = !walkin.nationality || /ایران|iran/i.test(walkin.nationality);
    if (iranian && !isNationalId(walkin.national_id)) throw bad("کد ملی مشتری معتبر نیست");
  }
  if (walkin.mobile) {
    walkin.mobile = normalizeMobile(walkin.mobile);
    if (!isMobile(walkin.mobile) && !/^\+?\d{8,15}$/.test(walkin.mobile)) throw bad("شماره‌ی موبایل مشتری معتبر نیست");
  }

  // ---- legs
  const inLeg = await resolveLeg(q, org.id, cur.base, input.in_method, input.in_ref_id, inC, party?.id);
  const outLeg = await resolveLeg(q, org.id, cur.base, input.out_method, input.out_ref_id, outC, party?.id);

  // ---- valuation
  const exclude = opts.dealId ? { type: "fx_deal", id: opts.dealId } : null;
  const lines: VoucherLineInput[] = [];
  const gainAcc = await accountByKey(q, org.id, "fx_trading_gain");
  let baseValue: string;
  let costValue: string;
  let avgCost: string | null = null;
  let marketRate: string | null = null;
  let position: DealPlan["position"] = null;
  const who = party?.name ?? walkin.name ?? "";
  const inText = `دریافت ${fmt(inAmt, inC.decimals)} ${inC.code}${who ? ` از ${who}` : ""}`;
  const outText = `پرداخت ${fmt(outAmt, outC.decimals)} ${outC.code}${who ? ` به ${who}` : ""}`;

  if (kind === "buy") {
    baseValue = outAmt;
    costValue = outAmt;
    lines.push(dr(inLeg.account_id, baseValue, { detail_id: inLeg.detail_id, currency_id: inC.id, fx_debit: inAmt, fx_rate: rate, description: inText }));
    lines.push(cr(outLeg.account_id, outAmt, { detail_id: outLeg.detail_id, description: outText }));
    const pos = await averageCost(q, org.id, inC.id, input.date, exclude);
    position = { currency_id: inC.id, fx: pos.fx, avg: pos.avg };
  } else {
    const pos = await averageCost(q, org.id, outC.id, input.date, exclude);
    position = { currency_id: outC.id, fx: pos.fx, avg: pos.avg };
    const outMid = rateMid(rates.get(outC.id));
    if (kind === "sell") {
      avgCost = pos.avg ?? outMid ?? rate;
      if (!pos.avg) warnings.push(`موجودی ${outC.code} برای محاسبه‌ی میانگین بها نیست؛ بهای تمام‌شده با ${outMid ? "نرخ تابلو" : "نرخ همین معامله"} حساب شد`);
      costValue = roundTo(D(outAmt).times(D(avgCost)), dp);
      baseValue = inAmt;
      lines.push(dr(inLeg.account_id, inAmt, { detail_id: inLeg.detail_id, description: inText }));
      lines.push(cr(outLeg.account_id, costValue, { detail_id: outLeg.detail_id, currency_id: outC.id, fx_credit: outAmt, fx_rate: avgCost, description: outText }));
    } else {
      const inMid = rateMid(rates.get(inC.id));
      marketRate = inMid;
      const outRate = pos.avg ?? outMid;
      if (!outRate && !inMid) throw bad(`برای تبدیل، نرخ ${inC.code} یا ${outC.code} را در تابلوی نرخ ثبت کنید`);
      if (!pos.avg) warnings.push(`موجودی ${outC.code} برای محاسبه‌ی میانگین بها نیست؛ ${outMid ? "نرخ تابلو" : "ارزش دریافتی"} مبنا شد`);
      costValue = outRate ? roundTo(D(outAmt).times(D(outRate)), dp) : roundTo(D(inAmt).times(D(inMid!)), dp);
      baseValue = inMid ? roundTo(D(inAmt).times(D(inMid)), dp) : costValue;
      if (!inMid) warnings.push(`نرخ ${inC.code} در تابلو نیست؛ ارز دریافتی به بهای ارز پرداختی ثبت شد`);
      avgCost = D(costValue).div(D(outAmt)).toDecimalPlaces(12).toFixed();
      lines.push(dr(inLeg.account_id, baseValue, { detail_id: inLeg.detail_id, currency_id: inC.id, fx_debit: inAmt, fx_rate: D(baseValue).div(D(inAmt)).toDecimalPlaces(12).toFixed(), description: inText }));
      lines.push(cr(outLeg.account_id, costValue, { detail_id: outLeg.detail_id, currency_id: outC.id, fx_credit: outAmt, fx_rate: avgCost, description: outText }));
    }
  }
  const profit = D(baseValue).minus(D(costValue));
  if (!profit.isZero()) lines.push(signed(gainAcc, profit.neg().toFixed(), { description: profit.gt(0) ? "سود معامله‌ی ارز" : "زیان معامله‌ی ارز" }));

  // ---- fee paid by the customer through the in-leg
  const feeC = input.fee_currency_id ? cur.get(input.fee_currency_id, "ارز کارمزد") : cur.base;
  const fee = positive(input.fee ?? 0, feeC, "کارمزد");
  let feeBase = "0";
  if (D(fee).gt(0)) {
    let feeRate: string | null;
    if (feeC.is_base) feeRate = "1";
    else if (kind !== "exchange" && (feeC.id === inC.id || feeC.id === outC.id)) feeRate = rate;
    else if (kind === "exchange" && feeC.id === inC.id) feeRate = D(baseValue).div(D(inAmt)).toFixed();
    else if (kind === "exchange" && feeC.id === outC.id) feeRate = avgCost;
    else feeRate = rateMid(rates.get(feeC.id));
    if (!feeRate) throw bad(`نرخ ${feeC.code} برای تبدیل کارمزد در تابلو نیست`);
    feeBase = roundTo(D(fee).times(D(feeRate)), dp);
    // in the currency the customer gives: on top of it; in the currency they get: taken off it
    // (a rial fee on buying crypto into a wallet cannot go through the wallet)
    const feeLeg = feeC.id === inC.id ? inLeg : feeC.id === outC.id ? outLeg : await resolveLeg(q, org.id, cur.base, input.in_method, input.in_ref_id, feeC, party?.id);
    lines.push(dr(feeLeg.account_id, feeBase, { detail_id: feeLeg.detail_id, ...(feeC.is_base ? {} : { currency_id: feeC.id, fx_debit: fee, fx_rate: feeRate }), description: `کارمزد ${fmt(fee, feeC.decimals)} ${feeC.code}` }));
    lines.push(cr(await accountByKey(q, org.id, "fx_commission"), feeBase, { description: "کارمزد معامله‌ی ارز" }));
  }

  // ---- network fee of a crypto withdrawal (paid by us from the wallet)
  const networkFee = positive(input.network_fee ?? 0, outC, "کارمزد شبکه");
  if (D(networkFee).gt(0)) {
    if (outLeg.method !== "wallet") throw bad("کارمزد شبکه فقط برای برداشت از کیف‌پول است");
    const nfRate = avgCost ?? rate;
    const nfBase = roundTo(D(networkFee).times(D(nfRate)), dp);
    lines.push(dr(await accountByKey(q, org.id, "network_fees"), nfBase, { description: `کارمزد شبکه ${fmt(networkFee, outC.decimals)} ${outC.code}` }));
    lines.push(cr(outLeg.account_id, nfBase, { detail_id: outLeg.detail_id, currency_id: outC.id, fx_credit: networkFee, fx_rate: nfRate, description: "کارمزد شبکه" }));
  }

  // ---- crypto details
  if (input.network && !CHAINS.some((c) => c.value === input.network)) throw bad("شبکه‌ی انتقال معتبر نیست");
  if (input.address && input.network && !isCryptoAddress(input.network as ChainId, input.address.trim())) throw bad("نشانی کیف‌پول با شبکه‌ی انتخاب‌شده جور نیست");

  // ---- the till cannot give what it does not hold
  if (outLeg.position && (outLeg.method === "cash" || outLeg.method === "wallet" || outLeg.method === "bank")) {
    const bal = await legBalance(q, org.id, outLeg, input.date, exclude);
    const need = D(outAmt).plus(D(networkFee));
    if (D(bal.fx).lt(need)) {
      const msg = `موجودی ${outC.code} در «${outLeg.ref_name}» ${fmt(bal.fx, outC.decimals)} است و برای پرداخت ${fmt(need.toFixed(), outC.decimals)} کافی نیست`;
      if (!s.allow_negative && outLeg.method !== "bank") blocking.push(msg);
      else warnings.push(msg);
    }
  }

  // ---- KYC: identity is required above the threshold
  const kycRequired = !!s.kyc_threshold && D(baseValue).gte(D(s.kyc_threshold));
  if (kycRequired) {
    if (!party && (!walkin.name || !(walkin.national_id || walkin.passport_no))) {
      blocking.push(`برای معامله‌ی بالای ${fmt(s.kyc_threshold!, dp)} نام و کد ملی (یا شماره‌ی گذرنامه) مشتری لازم است`);
    }
    if (party && !(party.national_id || party.passport_no || party.id_doc_no) && party.kyc_status !== "verified") {
      blocking.push(`برای معامله‌ی بالای ${fmt(s.kyc_threshold!, dp)} کد ملی یا گذرنامه‌ی «${party.name}» را در پرونده‌اش ثبت کنید`);
    }
  }

  const foreign = kind === "buy" ? inC : outC;
  const title =
    kind === "exchange"
      ? `تبدیل ${fmt(inAmt, inC.decimals)} ${inC.code} به ${fmt(outAmt, outC.decimals)} ${outC.code}`
      : `${KIND_FA[kind]} ${fmt(kind === "buy" ? inAmt : outAmt, foreign.decimals)} ${foreign.code} به نرخ ${fmt(rate, 8)}`;

  return {
    kind,
    in_amount: inAmt,
    out_amount: outAmt,
    rate,
    base_value: baseValue,
    cost_value: costValue,
    profit: profit.toFixed(),
    avg_cost: avgCost,
    market_rate: marketRate,
    fee,
    fee_currency_id: D(fee).gt(0) ? feeC.id : null,
    fee_base: feeBase,
    network_fee: networkFee,
    walkin,
    party: party ? { id: party.id, name: party.name } : null,
    legs: { in: inLeg, out: outLeg },
    lines,
    blocking,
    warnings,
    kyc_required: kycRequired,
    position,
    title: `${title}${who ? ` — ${who}` : ""}`,
  };
}

// ---------------------------------------------------------------- queries

const SELECT = `
  select d.*, ic.code as in_code, ic.decimals as in_decimals, ic.kind as in_kind, ic.name as in_name,
         oc.code as out_code, oc.decimals as out_decimals, oc.kind as out_kind, oc.name as out_name,
         fc.code as fee_code, fc.decimals as fee_decimals,
         p.name as party_name, p.code as party_code, p.mobile as party_mobile, p.national_id as party_national_id,
         coalesce(p.name, d.walkin->>'name') as customer_name,
         v.no as voucher_no, u.full_name as created_by_name
  from tz_fx_deals d
  join tz_currencies ic on ic.id = d.in_currency_id
  join tz_currencies oc on oc.id = d.out_currency_id
  left join tz_currencies fc on fc.id = d.fee_currency_id
  left join tz_parties p on p.id = d.party_id
  left join tz_vouchers v on v.id = d.voucher_id and v.deleted_at is null
  left join tz_users u on u.id = d.created_by`;

async function refName(q: Queryable, method: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const table = method === "cash" ? "tz_cash_boxes" : method === "bank" ? "tz_bank_accounts" : method === "wallet" ? "tz_wallets" : method === "party" ? "tz_parties" : null;
  if (!table) return null;
  const r = await q.one<{ name: string }>(`select name from ${table} where id = $1`, [id]);
  return r?.name ?? null;
}

export async function getDeal(ctx: Ctx, id: string) {
  ctx.need("fx", "view");
  if (!isUuid(id)) throw notFound("معامله پیدا نشد");
  const d = await ctx.db.one(`${SELECT} where d.id = $1 and d.org_id = $2 and d.deleted_at is null`, [id, ctx.org.id]);
  if (!d) throw notFound("معامله پیدا نشد");
  const [inRef, outRef] = await Promise.all([refName(ctx.db, d.in_method, d.in_ref_id), refName(ctx.db, d.out_method, d.out_ref_id)]);
  return { ...d, in_ref_name: inRef, out_ref_name: outRef, in_method_fa: METHOD_FA[d.in_method as Method], out_method_fa: METHOD_FA[d.out_method as Method] };
}

export interface DealListParams {
  from?: string;
  to?: string;
  kind?: string;
  status?: string;
  currency_id?: string;
  party_id?: string;
  q?: string;
  page?: number;
  size?: number;
}

export async function listDeals(ctx: Ctx, p: DealListParams) {
  ctx.need("fx", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["d.org_id = $1", "d.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace(/\?/g, `$${params.length}`));
  };
  if (p.from) add("d.date >= ?", p.from);
  if (p.to) add("d.date <= ?", p.to);
  if (p.kind) add("d.kind = ?", p.kind);
  if (p.status) add("d.status = ?", p.status);
  if (p.currency_id && isUuid(p.currency_id)) add("(d.in_currency_id = ? or d.out_currency_id = ?)", p.currency_id);
  if (p.party_id && isUuid(p.party_id)) add("d.party_id = ?", p.party_id);
  if (p.q?.trim()) {
    const s = normalizeDigits(p.q.trim());
    if (/^\d+$/.test(s)) add("(d.no = ?::int or d.tx_hash ilike '%' || ?::text || '%')", s);
    else add("(p.name ilike ? or d.walkin->>'name' ilike ? or d.description ilike ? or d.tx_hash ilike ?)", likeContains(s));
  }
  const page = Math.max(1, Number(p.page) || 1);
  const size = Math.min(500, Math.max(1, Number(p.size) || 50));
  const where = cond.join(" and ");
  const total = await ctx.db.one<{ n: number; profit: string; fees: string; volume: string }>(
    `select count(*)::int as n, coalesce(sum(case when d.status = 'posted' then d.profit end), 0) as profit,
            coalesce(sum(case when d.status = 'posted' then d.fee_base end), 0) as fees,
            coalesce(sum(case when d.status = 'posted' then d.base_value end), 0) as volume
     from tz_fx_deals d left join tz_parties p on p.id = d.party_id where ${where}`,
    params,
  );
  const rows = await ctx.db.query(`${SELECT} where ${where} order by d.date desc, d.no desc limit ${size} offset ${(page - 1) * size}`, params);
  return { rows, total: total?.n ?? 0, page, size, sums: { profit: total?.profit ?? "0", fees: total?.fees ?? "0", volume: total?.volume ?? "0" } };
}

// ---------------------------------------------------------------- writes

function inputFromRow(r: Record<string, any>): DealInput {
  return {
    date: r.date, kind: r.kind, party_id: r.party_id, walkin: r.walkin,
    in_currency_id: r.in_currency_id, in_amount: r.in_amount, in_method: r.in_method, in_ref_id: r.in_ref_id,
    out_currency_id: r.out_currency_id, out_amount: r.out_amount, out_method: r.out_method, out_ref_id: r.out_ref_id,
    rate: r.kind === "exchange" ? null : r.rate, fee: r.fee, fee_currency_id: r.fee_currency_id, network_fee: r.network_fee,
    tx_hash: r.tx_hash, network: r.network, address: r.address, description: r.description,
  };
}

/** Create (no id) or replace a deal; posted deals get their voucher written in the same transaction. */
export async function saveDeal(ctx: Ctx, input: DealInput, id?: string, opts: { reopen?: boolean } = {}) {
  ctx.need("fx", "edit");
  const saved = await ctx.write(async (tx) => {
    let prev: Record<string, any> | null = null;
    if (id) {
      prev = await tx.one(`select * from tz_fx_deals where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
      if (!prev) throw notFound("معامله پیدا نشد");
      if (prev.status === "cancelled" && !opts.reopen) throw conflict("معامله‌ی باطل‌شده قابل ویرایش نیست؛ ابتدا آن را دوباره ثبت کنید");
    }
    const dealId = id ?? uuidv7();
    const plan = await planDeal(tx, ctx.org, input, { dealId });
    const status = input.status ?? (prev?.status as "draft" | "posted" | undefined) ?? "posted";
    if (status === "posted" && plan.blocking.length) throw bad(plan.blocking[0]);
    const fy = await fiscalYearFor(tx, ctx.org.id, input.date);
    const no = prev && prev.fiscal_year_id === fy.id ? Number(prev.no) : await nextNo(tx, "tz_fx_deals", ctx.org.id, fy.id);
    const description = input.description?.trim() || null;
    let voucherId: string | null = null;
    if (status === "posted") {
      voucherId = await postAuto(
        tx,
        ctx.org,
        { type: "fx_deal", id: dealId, date: input.date, description: `معامله‌ی ارز ش ${formatNumber(no)}: ${plan.title}${description ? ` (${description})` : ""}`, refNo: String(no) },
        plan.lines,
        { userId: ctx.user.id, origin: ctx.cfg.origin },
      );
    } else {
      await removeAuto(tx, ctx.org.id, "fx_deal", dealId);
    }
    const row: Record<string, unknown> = {
      fiscal_year_id: fy.id,
      no,
      date: input.date,
      kind: plan.kind,
      party_id: plan.party?.id ?? null,
      walkin: plan.walkin,
      in_currency_id: plan.legs.in.currency.id,
      in_amount: plan.in_amount,
      in_method: plan.legs.in.method,
      in_ref_id: plan.legs.in.ref_id,
      out_currency_id: plan.legs.out.currency.id,
      out_amount: plan.out_amount,
      out_method: plan.legs.out.method,
      out_ref_id: plan.legs.out.ref_id,
      rate: plan.rate,
      fee: plan.fee,
      fee_currency_id: plan.fee_currency_id,
      fee_base: plan.fee_base,
      network_fee: plan.network_fee,
      base_value: plan.base_value,
      cost_value: plan.cost_value,
      profit: plan.profit,
      avg_cost: plan.avg_cost,
      market_rate: plan.market_rate,
      tx_hash: input.tx_hash?.trim().slice(0, 200) || null,
      network: input.network || null,
      address: input.address?.trim().slice(0, 200) || null,
      status,
      description,
      voucher_id: voucherId,
      cancelled_at: null,
      cancel_reason: null,
      origin: ctx.cfg.origin,
    };
    if (prev) await updateRow(tx, "tz_fx_deals", { id: dealId, org_id: ctx.org.id }, row);
    else await insertRow(tx, "tz_fx_deals", { id: dealId, org_id: ctx.org.id, created_by: ctx.user.id, ...row }, "id");
    await audit(tx, ctx, prev ? "update" : "create", "fx_deal", dealId, `معامله‌ی ارز ${no}: ${plan.title}`);
    return { id: dealId, warnings: plan.warnings };
  });
  return { deal: await getDeal(ctx, saved.id), warnings: saved.warnings };
}

/** Post a draft or a cancelled deal again (re-valued at today's average cost). */
export async function postDeal(ctx: Ctx, id: string) {
  ctx.need("fx", "edit");
  const row = await ctx.db.one(`select * from tz_fx_deals where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
  if (!row) throw notFound("معامله پیدا نشد");
  if (row.status === "posted") throw conflict("این معامله قبلاً ثبت شده است");
  return saveDeal(ctx, { ...inputFromRow(row), status: "posted" }, id, { reopen: true });
}

export async function cancelDeal(ctx: Ctx, id: string, reason?: string | null) {
  ctx.need("fx", "edit");
  await ctx.write(async (tx) => {
    const row = await tx.one(`select id, no, status from tz_fx_deals where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!row) throw notFound("معامله پیدا نشد");
    if (row.status === "cancelled") throw conflict("این معامله قبلاً باطل شده است");
    await removeAuto(tx, ctx.org.id, "fx_deal", id);
    await updateRow(tx, "tz_fx_deals", { id, org_id: ctx.org.id }, { status: "cancelled", voucher_id: null, cancelled_at: new Date().toISOString(), cancel_reason: reason?.trim().slice(0, 500) || null, origin: ctx.cfg.origin });
    await audit(tx, ctx, "cancel", "fx_deal", id, `ابطال معامله‌ی ارز ${row.no}`);
  });
  return getDeal(ctx, id);
}

export async function deleteDeal(ctx: Ctx, id: string) {
  ctx.need("fx", "full");
  return ctx.write(async (tx) => {
    const row = await tx.one(`select id, no from tz_fx_deals where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!row) throw notFound("معامله پیدا نشد");
    await removeAuto(tx, ctx.org.id, "fx_deal", id);
    await tx.query(`update tz_fx_deals set deleted_at = now(), voucher_id = null, origin = $3 where id = $1 and org_id = $2`, [id, ctx.org.id, ctx.cfg.origin]);
    await audit(tx, ctx, "delete", "fx_deal", id, `حذف معامله‌ی ارز ${row.no}`);
    return { ok: true };
  });
}

/** What the counter screen shows before saving: values, profit, lines and any blocking rule. */
export async function previewDeal(ctx: Ctx, input: DealInput, id?: string | null) {
  ctx.need("fx", "view");
  const plan = await planDeal(ctx.db, ctx.org, input, { dealId: id ?? null });
  const accIds = Array.from(new Set(plan.lines.map((l) => l.account_id)));
  const accounts = new Map(
    (await ctx.db.query<{ id: string; code: string; name: string }>(`select id, code, name from tz_accounts where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, `{${accIds.join(",")}}`])).map((a) => [a.id, a]),
  );
  const detailIds = Array.from(new Set(plan.lines.map((l) => l.detail_id).filter(Boolean) as string[]));
  const details = detailIds.length
    ? new Map((await ctx.db.query<{ id: string; name: string }>(`select id, name from tz_details where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, `{${detailIds.join(",")}}`])).map((d) => [d.id, d.name]))
    : new Map<string, string>();
  const { lines, legs, ...rest } = plan;
  return {
    ...rest,
    legs: { in: { method: legs.in.method, ref_id: legs.in.ref_id, ref_name: legs.in.ref_name }, out: { method: legs.out.method, ref_id: legs.out.ref_id, ref_name: legs.out.ref_name } },
    lines: lines.map((l) => ({
      account_code: accounts.get(l.account_id)?.code ?? "",
      account_name: accounts.get(l.account_id)?.name ?? "",
      detail_name: l.detail_id ? details.get(l.detail_id) ?? null : null,
      currency_id: l.currency_id ?? null,
      description: l.description ?? null,
      debit: D(l.debit).toFixed(),
      credit: D(l.credit).toFixed(),
      fx_debit: D(l.fx_debit).toFixed(),
      fx_credit: D(l.fx_credit).toFixed(),
    })),
  };
}

/** Balances of a customer in every currency (rial receivable and currency accounts). */
export async function partyBalances(ctx: Ctx, partyId: string) {
  ctx.need("fx", "view");
  const p = await ctx.db.one<{ id: string; name: string; detail_id: string | null; national_id: string | null; passport_no: string | null; mobile: string | null; kyc_status: string; is_blacklisted: boolean; roles: string[] }>(
    `select id, name, detail_id, national_id, passport_no, mobile, kyc_status, is_blacklisted, roles from tz_parties where id = $1 and org_id = $2 and deleted_at is null`,
    [partyId, ctx.org.id],
  );
  if (!p) throw notFound("شخص پیدا نشد");
  const rows = p.detail_id
    ? await ctx.db.query(
        `select l.currency_id, c.code, c.decimals, a.system_key,
                sum(l.debit - l.credit) as base, sum(l.fx_debit - l.fx_credit) as fx
         from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
         left join tz_currencies c on c.id = l.currency_id
         where l.org_id = $1 and l.detail_id = $2 and v.deleted_at is null and v.status in ('posted','final') and v.kind <> 'closing' and v.source_type is distinct from 'opening'
           and a.system_key = any('{ar,ap,fx_parties,correspondents,remittances_payable,customer_advances}'::text[])
         group by l.currency_id, c.code, c.decimals, a.system_key order by c.code nulls first`,
        [ctx.org.id, p.detail_id],
      )
    : [];
  return { party: p, balances: rows };
}
