// Remittances (حواله) through correspondents (همکار/کارگزار), with a small status machine and a
// history entry for every change.
//
// Outgoing (direction `out`): the customer pays here and the correspondent pays abroad.
//   registered:  Dr pay-leg (what the customer paid) / Cr «حواله‌های پرداختنی» [correspondent]
//                (remittance amount) + Cr «درآمد کارمزد» (customer fee).
//   paid:        Dr «حواله‌های پرداختنی» / Cr «حساب همکاران» [correspondent] (we now owe them),
//                plus their fee: Dr «کارمزد همکاران» / Cr «حساب همکاران».
// Incoming (direction `in`): a correspondent asks us to pay a beneficiary here.
//   paid:        Dr «حساب همکاران» [correspondent] (amount + our commission) / Cr pay-leg
//                + Cr «درآمد کارمزد»; foreign cash paid out leaves at its average cost.
// Cancelling or returning removes the vouchers; undoing «paid» removes the payout voucher.
// Fees: outgoing — paid by the customer in the pay currency; incoming — our commission charged
// to the correspondent in the remittance currency. Correspondent fee (outgoing) is in the
// remittance currency.
import type { Ctx, OrgRow } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, normalizeDigits } from "@shared/money";
import { uuidv7, isUuid } from "@shared/id";
import { formatNumber } from "@shared/format";
import { todayISO, toJalali } from "@shared/jalali";
import { isNationalId, normalizeMobile } from "@shared/validate";
import { accountByKey, cr, deleteVoucher, dr, saveVoucher, removeAuto, signed, type VoucherLineInput } from "../accounting/vouchers";
import { fiscalYearFor } from "../accounting/fiscal";
import { audit } from "../data/crud";
import { averageCost, cleanPerson, currencyBook, fxSettings, latestRates, legBalance, orgTz, rateMid, resolveLeg, roundTo, type Currency, type Method } from "./common";

export type RemStatus = "pending" | "sent" | "paid" | "cancelled" | "returned";
export type Direction = "out" | "in";

export const REM_STATUS_FA: Record<RemStatus, string> = { pending: "در انتظار", sent: "ارسال‌شده", paid: "پرداخت‌شده", cancelled: "لغوشده", returned: "برگشتی" };

/** Allowed status changes (undo steps included: paid → sent/pending, sent → pending). */
export const TRANSITIONS: Record<Direction, Record<RemStatus, RemStatus[]>> = {
  out: { pending: ["sent", "paid", "cancelled"], sent: ["paid", "returned", "cancelled", "pending"], paid: ["sent"], cancelled: [], returned: [] },
  in: { pending: ["paid", "cancelled", "returned"], sent: ["paid", "cancelled", "returned", "pending"], paid: ["pending"], cancelled: [], returned: [] },
};

export interface RemittanceInput {
  date: string;
  direction: Direction;
  party_id?: string | null;
  sender?: Record<string, unknown> | null;
  beneficiary?: Record<string, unknown> | null;
  correspondent_id: string;
  currency_id: string;
  amount: string;
  rate?: string | null;
  fee?: string | null;
  correspondent_fee?: string | null;
  pay_method: Method;
  pay_ref_id?: string | null;
  pay_currency_id?: string | null;
  tracking_code?: string | null;
  description?: string | null;
}

const PERSON_FIELDS = ["name", "national_id", "passport_no", "mobile", "nationality", "address", "country", "city", "bank", "account", "iban", "relation"];

type Row = Record<string, any>;

// ---------------------------------------------------------------- helpers

/** Ten digits: Jalali year (2) + 7 random + a Luhn check digit (catches typing mistakes). */
export function makeTrackingCode(date: string): string {
  const yy = String(toJalali(date).jy % 100).padStart(2, "0");
  const rnd = new Uint32Array(1);
  globalThis.crypto.getRandomValues(rnd);
  const body = `${yy}${String(rnd[0] % 10_000_000).padStart(7, "0")}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

async function uniqueTracking(q: Queryable, orgId: string, date: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = makeTrackingCode(date);
    const used = await q.one(`select 1 from tz_remittances where org_id = $1 and tracking_code = $2 and deleted_at is null`, [orgId, code]);
    if (!used) return code;
  }
  return `${makeTrackingCode(date)}${Date.now() % 10}`;
}

/** Write (or replace) one of the remittance's own vouchers by id; empty lines remove it. */
async function postEvent(
  tx: Tx,
  org: { id: string; money_decimals: number },
  src: { voucherId: string | null; id: string; date: string; description: string; refNo: string },
  lines: VoucherLineInput[],
  opts: { userId: string; origin: string },
): Promise<string | null> {
  const clean = lines.filter((l) => [l.debit, l.credit, l.fx_debit, l.fx_credit].some((x) => !D(x).isZero()));
  if (src.voucherId && clean.length) {
    // A remittance issued before its fiscal year was closed can still move on (sent, paid in the
    // open year); its voucher in the closed year stays as it is.
    const cur = await tx.one<{ date: string; year_status: string }>(
      `select v.date, f.status as year_status from tz_vouchers v join tz_fiscal_years f on f.id = v.fiscal_year_id
       where v.id = $1 and v.org_id = $2 and v.deleted_at is null`,
      [src.voucherId, org.id],
    );
    if (cur?.year_status === "closed" && String(cur.date).slice(0, 10) === String(src.date).slice(0, 10)) return src.voucherId;
  }
  if (!clean.length) {
    if (src.voucherId) {
      const live = await tx.one(`select 1 from tz_vouchers where id = $1 and org_id = $2 and deleted_at is null`, [src.voucherId, org.id]);
      if (live) await deleteVoucher(tx, org.id, src.voucherId, { allowAuto: true });
    }
    return null;
  }
  const saved = await saveVoucher(
    tx,
    org,
    { id: src.voucherId ?? undefined, date: src.date, description: src.description, ref_no: src.refNo, kind: "auto", status: "posted", source_type: "remittance", source_id: src.id, lines: clean },
    { ...opts, allowAuto: true },
  );
  return saved.id;
}

async function loadCorrespondent(q: Queryable, orgId: string, id: string) {
  const c = await q.one<{ id: string; name: string; detail_id: string | null; roles: string[] }>(
    `select id, name, detail_id, roles from tz_parties where id = $1 and org_id = $2 and deleted_at is null`,
    [id, orgId],
  );
  if (!c) throw bad("همکار پیدا نشد");
  if (!Array.isArray(c.roles) || !c.roles.includes("correspondent")) throw bad(`«${c.name}» نقش «همکار صرافی / کارگزار» ندارد؛ در پرونده‌ی شخص این نقش را اضافه کنید`);
  if (!c.detail_id) throw bad(`«${c.name}» حساب تفصیلی ندارد`);
  return c;
}

interface Prepared {
  values: Row;
  X: Currency;
  P: Currency;
  correspondent: { id: string; name: string; detail_id: string };
}

/** Validate an input and compute the stored figures (amounts in base, fees, pay amount). */
async function prepare(q: Queryable, org: OrgRow, input: RemittanceInput): Promise<Prepared> {
  const cur = await currencyBook(q, org.id);
  const s = fxSettings(org);
  const dp = org.money_decimals ?? 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw bad("تاریخ حواله معتبر نیست");
  if (input.direction !== "out" && input.direction !== "in") throw bad("نوع حواله را انتخاب کنید");
  const X = cur.get(input.currency_id, "ارز حواله");
  const P = input.pay_currency_id ? cur.get(input.pay_currency_id, "ارز پرداخت") : cur.base;
  if (P.id !== X.id && !P.is_base) throw bad("ارز پرداخت باید ارز پایه یا همان ارز حواله باشد");
  const amount = roundTo(input.amount, X.decimals);
  if (D(amount).lte(0)) throw bad("مبلغ حواله را وارد کنید");
  let rate = "1";
  if (!X.is_base) {
    const board = (await latestRates(q, org.id, { date: input.date, tz: orgTz(org) })).get(X.id);
    const r = input.rate && D(input.rate).gt(0) ? D(input.rate) : D((input.direction === "out" ? board?.sell : board?.buy) ?? rateMid(board));
    if (r.lte(0)) throw bad(`نرخ ${X.code} را وارد کنید (در تابلوی نرخ هم ثبت نشده است)`);
    rate = r.toFixed();
  }
  const baseAmount = roundTo(D(amount).times(D(rate)), dp);
  const feeCur = input.direction === "out" ? P : X;
  const fee = roundTo(D(input.fee).isNeg() ? 0 : input.fee ?? 0, feeCur.decimals);
  const feeBase = feeCur.is_base ? roundTo(fee, dp) : roundTo(D(fee).times(D(rate)), dp);
  const corrFee = input.direction === "out" ? roundTo(D(input.correspondent_fee).isNeg() ? 0 : input.correspondent_fee ?? 0, X.decimals) : "0";
  const payAmount = input.direction === "out" ? D(P.is_base ? baseAmount : amount).plus(D(fee)).toFixed() : P.is_base ? baseAmount : amount;

  const correspondent = await loadCorrespondent(q, org.id, input.correspondent_id);
  let party: { id: string; name: string; national_id: string | null; passport_no: string | null; id_doc_no: string | null; mobile: string | null; is_blacklisted: boolean } | null = null;
  if (input.party_id) {
    party = await q.one(`select id, name, national_id, passport_no, id_doc_no, mobile, is_blacklisted from tz_parties where id = $1 and org_id = $2 and deleted_at is null`, [input.party_id, org.id]);
    if (!party) throw bad("مشتری پیدا نشد");
    if (party.is_blacklisted) throw bad(`«${party.name}» در فهرست سیاه است`);
  }
  const sender = cleanPerson(input.sender, PERSON_FIELDS);
  const beneficiary = cleanPerson(input.beneficiary, PERSON_FIELDS);
  for (const p of [sender, beneficiary]) {
    if (p.national_id) p.national_id = normalizeDigits(p.national_id).replace(/[\s-]/g, "");
    if (p.mobile) p.mobile = normalizeMobile(p.mobile);
  }
  if (input.direction === "out") {
    if (party && !sender.name) sender.name = party.name;
    if (!sender.name) throw bad("نام فرستنده را وارد کنید");
    if (sender.national_id && (!sender.nationality || /ایران|iran/i.test(sender.nationality)) && !isNationalId(sender.national_id)) throw bad("کد ملی فرستنده معتبر نیست");
    const kyc = s.kyc_threshold && D(baseAmount).gte(D(s.kyc_threshold));
    if (kyc && !(sender.national_id || sender.passport_no || party?.national_id || party?.passport_no || party?.id_doc_no)) {
      throw bad(`برای حواله‌ی بالای ${formatNumber(s.kyc_threshold!, { dp })} کد ملی یا گذرنامه‌ی فرستنده لازم است`);
    }
  } else if (party && !beneficiary.name) beneficiary.name = party.name;
  if (!beneficiary.name) throw bad("نام ذی‌نفع (گیرنده) را وارد کنید");

  // validates the leg now; it is resolved again when vouchers are written
  const leg = await resolveLeg(q, org.id, cur.base, input.pay_method, input.pay_ref_id, P, party?.id);
  return {
    X,
    P,
    correspondent: { id: correspondent.id, name: correspondent.name, detail_id: correspondent.detail_id! },
    values: {
      date: input.date,
      direction: input.direction,
      party_id: party?.id ?? null,
      sender,
      beneficiary,
      correspondent_id: correspondent.id,
      currency_id: X.id,
      amount,
      rate,
      base_amount: baseAmount,
      fee,
      fee_base: feeBase,
      correspondent_fee: corrFee,
      pay_method: leg.method,
      pay_ref_id: leg.ref_id,
      pay_currency_id: P.id,
      pay_amount: payAmount,
      description: input.description?.trim().slice(0, 1000) || null,
    },
  };
}

/** Lines of the outgoing remittance's first voucher (the customer's payment). */
async function registerLines(q: Queryable, org: OrgRow, r: Row): Promise<VoucherLineInput[]> {
  if (r.direction !== "out") return [];
  const cur = await currencyBook(q, org.id);
  const X = cur.get(r.currency_id);
  const P = cur.get(r.pay_currency_id);
  const corr = await loadCorrespondent(q, org.id, r.correspondent_id);
  const leg = await resolveLeg(q, org.id, cur.base, r.pay_method, r.pay_ref_id, P, r.party_id);
  const base = D(r.base_amount);
  const feeBase = D(r.fee_base ?? 0);
  const fxPaid = D(r.amount).plus(D(r.fee));
  const who = r.sender?.name ?? "";
  const lines: VoucherLineInput[] = [
    dr(leg.account_id, base.plus(feeBase).toFixed(), {
      detail_id: leg.detail_id,
      ...(P.is_base ? {} : { currency_id: P.id, fx_debit: fxPaid.toFixed(), fx_rate: r.rate }),
      description: `دریافت وجه حواله‌ی ش ${formatNumber(r.no)}${who ? ` از ${who}` : ""}`,
    }),
    cr(await accountByKey(q, org.id, "remittances_payable"), base.toFixed(), {
      detail_id: corr.detail_id,
      currency_id: X.id,
      fx_credit: r.amount,
      fx_rate: r.rate,
      description: `حواله‌ی ${formatNumber(r.amount, { dp: X.decimals })} ${X.code} به ${r.beneficiary?.name ?? ""} — ${corr.name}`,
    }),
  ];
  if (feeBase.gt(0)) lines.push(cr(await accountByKey(q, org.id, "fx_commission"), feeBase.toFixed(), { description: `کارمزد حواله‌ی ش ${formatNumber(r.no)}` }));
  return lines;
}

/** Lines of the payout voucher (status «paid»). */
async function paidLines(q: Queryable, org: OrgRow, r: Row, date: string, opts: { check: boolean }): Promise<VoucherLineInput[]> {
  const cur = await currencyBook(q, org.id);
  const dp = org.money_decimals ?? 0;
  const X = cur.get(r.currency_id);
  const corr = await loadCorrespondent(q, org.id, r.correspondent_id);
  const corrAcc = await accountByKey(q, org.id, "correspondents");
  const base = D(r.base_amount);
  /** a line on the correspondent's accounts, in the remittance currency when it is foreign */
  const xLine = (side: "dr" | "cr", account: string, value: string, amount: string, description: string) => {
    const extra: Omit<VoucherLineInput, "account_id" | "debit" | "credit"> = { detail_id: corr.detail_id, description };
    if (!X.is_base) {
      extra.currency_id = X.id;
      extra.fx_rate = r.rate;
      if (side === "dr") extra.fx_debit = amount;
      else extra.fx_credit = amount;
    }
    return side === "dr" ? dr(account, value, extra) : cr(account, value, extra);
  };
  if (r.direction === "out") {
    const lines: VoucherLineInput[] = [
      dr(await accountByKey(q, org.id, "remittances_payable"), base.toFixed(), { detail_id: corr.detail_id, currency_id: X.id, fx_debit: r.amount, fx_rate: r.rate, description: `پرداخت حواله‌ی ش ${formatNumber(r.no)} توسط ${corr.name}` }),
      xLine("cr", corrAcc, base.toFixed(), r.amount, `حواله‌ی ش ${formatNumber(r.no)} — ${r.beneficiary?.name ?? ""}`),
    ];
    const cf = D(r.correspondent_fee ?? 0);
    if (cf.gt(0)) {
      const cfBase = roundTo(cf.times(D(r.rate)), dp);
      lines.push(dr(await accountByKey(q, org.id, "correspondent_fees"), cfBase, { description: `کارمزد ${corr.name} برای حواله‌ی ش ${formatNumber(r.no)}` }));
      lines.push(xLine("cr", corrAcc, cfBase, cf.toFixed(), `کارمزد حواله‌ی ش ${formatNumber(r.no)}`));
    }
    return lines;
  }
  // incoming: we pay the beneficiary, the correspondent owes us amount + our commission
  const P = cur.get(r.pay_currency_id);
  const leg = await resolveLeg(q, org.id, cur.base, r.pay_method, r.pay_ref_id, P, r.party_id);
  const feeBase = D(r.fee_base ?? 0);
  let payCost = base;
  if (!P.is_base && leg.position) {
    const avg = await averageCost(q, org.id, P.id, date, { type: "remittance", id: r.id });
    if (avg.avg) payCost = D(roundTo(D(r.amount).times(D(avg.avg)), dp));
    if (opts.check) {
      const bal = await legBalance(q, org.id, leg, date, { type: "remittance", id: r.id });
      if (D(bal.fx).lt(D(r.amount)) && !fxSettings(org).allow_negative && leg.method !== "bank") {
        throw bad(`موجودی ${P.code} در «${leg.ref_name}» ${formatNumber(bal.fx, { dp: P.decimals })} است و برای پرداخت حواله کافی نیست`);
      }
    }
  }
  const lines: VoucherLineInput[] = [
    xLine("dr", corrAcc, base.plus(feeBase).toFixed(), D(r.amount).plus(D(r.fee)).toFixed(), `حواله‌ی وارده‌ی ش ${formatNumber(r.no)} از ${corr.name}`),
    cr(leg.account_id, payCost.toFixed(), {
      detail_id: leg.detail_id,
      ...(P.is_base ? {} : { currency_id: P.id, fx_credit: r.amount, fx_rate: payCost.div(D(r.amount)).toDecimalPlaces(12).toFixed() }),
      description: `پرداخت حواله به ${r.beneficiary?.name ?? ""}`,
    }),
  ];
  if (feeBase.gt(0)) lines.push(cr(await accountByKey(q, org.id, "fx_commission"), feeBase.toFixed(), { description: `کارمزد حواله‌ی وارده‌ی ش ${formatNumber(r.no)}` }));
  const gain = base.minus(payCost);
  if (!gain.isZero()) lines.push(signed(await accountByKey(q, org.id, "fx_trading_gain"), gain.neg().toFixed(), { description: "سود/زیان ارزی پرداخت حواله" }));
  return lines;
}

/** Bring the vouchers in line with the remittance's status. */
async function syncVouchers(tx: Tx, ctx: Ctx, r: Row): Promise<{ voucher_id: string | null; paid_voucher_id: string | null }> {
  const opts = { userId: ctx.user.id, origin: ctx.cfg.origin };
  const live = r.status !== "cancelled" && r.status !== "returned";
  const corr = await tx.one<{ name: string }>(`select name from tz_parties where id = $1`, [r.correspondent_id]);
  const ref = String(r.no);
  const voucherId = await postEvent(
    tx,
    ctx.org,
    { voucherId: r.voucher_id ?? null, id: r.id, date: r.date, description: `حواله‌ی صادره‌ی ش ${formatNumber(r.no)} — ${r.beneficiary?.name ?? ""} (${corr?.name ?? ""})`, refNo: ref },
    live ? await registerLines(tx, ctx.org, r) : [],
    opts,
  );
  const paidDate = r.paid_date ?? r.date;
  const paidVoucherId = await postEvent(
    tx,
    ctx.org,
    { voucherId: r.paid_voucher_id ?? null, id: r.id, date: paidDate, description: `${r.direction === "out" ? "پرداخت حواله‌ی صادره" : "پرداخت حواله‌ی وارده"} ش ${formatNumber(r.no)} — ${r.beneficiary?.name ?? ""} (${corr?.name ?? ""})`, refNo: ref },
    r.status === "paid" ? await paidLines(tx, ctx.org, r, paidDate, { check: true }) : [],
    opts,
  );
  return { voucher_id: voucherId, paid_voucher_id: paidVoucherId };
}

// ---------------------------------------------------------------- queries

const SELECT = `
  select r.*, c.code as currency_code, c.decimals as currency_decimals, c.name as currency_name,
         pc.code as pay_currency_code, pc.decimals as pay_currency_decimals,
         cp.name as correspondent_name, cp.code as correspondent_code, p.name as party_name,
         v.no as voucher_no, pv.no as paid_voucher_no
  from tz_remittances r
  join tz_currencies c on c.id = r.currency_id
  left join tz_currencies pc on pc.id = r.pay_currency_id
  left join tz_parties cp on cp.id = r.correspondent_id
  left join tz_parties p on p.id = r.party_id
  left join tz_vouchers v on v.id = r.voucher_id and v.deleted_at is null
  left join tz_vouchers pv on pv.id = r.paid_voucher_id and pv.deleted_at is null`;

export async function getRemittance(ctx: Ctx, id: string) {
  ctx.need("fx", "view");
  if (!isUuid(id)) throw notFound("حواله پیدا نشد");
  const r = await ctx.db.one(`${SELECT} where r.id = $1 and r.org_id = $2 and r.deleted_at is null`, [id, ctx.org.id]);
  if (!r) throw notFound("حواله پیدا نشد");
  const table = r.pay_method === "cash" ? "tz_cash_boxes" : r.pay_method === "bank" ? "tz_bank_accounts" : r.pay_method === "wallet" ? "tz_wallets" : "tz_parties";
  const ref = r.pay_ref_id ? await ctx.db.one<{ name: string }>(`select name from ${table} where id = $1`, [r.pay_ref_id]) : null;
  return { ...r, pay_ref_name: ref?.name ?? null, next_statuses: TRANSITIONS[r.direction as Direction]?.[r.status as RemStatus] ?? [] };
}

export interface RemListParams {
  status?: string;
  direction?: string;
  correspondent_id?: string;
  party_id?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  size?: number;
}

export async function listRemittances(ctx: Ctx, p: RemListParams) {
  ctx.need("fx", "view");
  const params: unknown[] = [ctx.org.id];
  const cond = ["r.org_id = $1", "r.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace(/\?/g, `$${params.length}`));
  };
  if (p.status) {
    const list = p.status.split(",").filter((x) => x in REM_STATUS_FA);
    if (list.length) add("r.status = any(?::text[])", `{${list.join(",")}}`);
  }
  if (p.direction === "out" || p.direction === "in") add("r.direction = ?", p.direction);
  if (p.correspondent_id && isUuid(p.correspondent_id)) add("r.correspondent_id = ?", p.correspondent_id);
  if (p.party_id && isUuid(p.party_id)) add("r.party_id = ?", p.party_id);
  if (p.from) add("r.date >= ?", p.from);
  if (p.to) add("r.date <= ?", p.to);
  if (p.q?.trim()) {
    const s = normalizeDigits(p.q.trim());
    if (/^\d{1,6}$/.test(s)) add("(r.no = ?::int or r.tracking_code like ?::text || '%')", s);
    else add("(r.tracking_code ilike ? or r.beneficiary->>'name' ilike ? or r.sender->>'name' ilike ? or cp.name ilike ? or r.description ilike ?)", likeContains(s));
  }
  const page = Math.max(1, Number(p.page) || 1);
  const size = Math.min(500, Math.max(1, Number(p.size) || 50));
  const where = cond.join(" and ");
  const total = await ctx.db.one<{ n: number }>(`select count(*)::int as n from tz_remittances r left join tz_parties cp on cp.id = r.correspondent_id where ${where}`, params);
  const rows = await ctx.db.query(`${SELECT} where ${where} order by r.date desc, r.no desc limit ${size} offset ${(page - 1) * size}`, params);
  return { rows, total: total?.n ?? 0, page, size };
}

// ---------------------------------------------------------------- writes

export async function saveRemittance(ctx: Ctx, input: RemittanceInput, id?: string) {
  ctx.need("fx", "edit");
  const savedId = await ctx.write(async (tx) => {
    let prev: Row | null = null;
    if (id) {
      prev = await tx.one(`select * from tz_remittances where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
      if (!prev) throw notFound("حواله پیدا نشد");
      if (prev.status === "cancelled" || prev.status === "returned") throw conflict("حواله‌ی لغوشده یا برگشتی قابل ویرایش نیست");
    }
    const remId = id ?? uuidv7();
    let values: Row;
    if (prev && prev.status !== "pending") {
      // after sending only the people's details and the notes may change
      values = {
        sender: cleanPerson(input.sender ?? prev.sender, PERSON_FIELDS),
        beneficiary: cleanPerson(input.beneficiary ?? prev.beneficiary, PERSON_FIELDS),
        description: input.description?.trim().slice(0, 1000) || null,
      };
      if (!values.beneficiary.name) throw bad("نام ذی‌نفع (گیرنده) را وارد کنید");
    } else {
      values = (await prepare(tx, ctx.org, input)).values;
    }
    const fy = await fiscalYearFor(tx, ctx.org.id, values.date ?? prev!.date);
    const no = prev && prev.fiscal_year_id === fy.id ? Number(prev.no) : await nextNo(tx, "tz_remittances", ctx.org.id, fy.id);
    const tracking = input.tracking_code?.trim() ? normalizeDigits(input.tracking_code.trim()).slice(0, 60) : prev?.tracking_code ?? (await uniqueTracking(tx, ctx.org.id, values.date ?? prev?.date));
    const now = new Date().toISOString();
    const history = prev ? prev.history ?? [] : [{ at: now, status: "pending", from: null, date: values.date, note: "ثبت حواله", user: ctx.user.full_name }];
    const row: Row = { ...(prev ?? {}), ...values, id: remId, fiscal_year_id: fy.id, no, tracking_code: tracking, history, status: prev?.status ?? "pending" };
    const vouchers = await syncVouchers(tx, ctx, row);
    const patch: Row = { ...values, fiscal_year_id: fy.id, no, tracking_code: tracking, history, ...vouchers, origin: ctx.cfg.origin };
    if (prev) await updateRow(tx, "tz_remittances", { id: remId, org_id: ctx.org.id }, patch);
    else await insertRow(tx, "tz_remittances", { id: remId, org_id: ctx.org.id, status: "pending", created_by: ctx.user.id, ...patch }, "id");
    await audit(tx, ctx, prev ? "update" : "create", "remittance", remId, `حواله‌ی ${row.direction === "out" ? "صادره" : "وارده"} ${no}`);
    return remId;
  });
  return getRemittance(ctx, savedId);
}

export async function setRemittanceStatus(ctx: Ctx, id: string, input: { status: RemStatus; date?: string | null; note?: string | null }) {
  ctx.need("fx", "edit");
  await ctx.write(async (tx) => {
    const prev = await tx.one<Row>(`select * from tz_remittances where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!prev) throw notFound("حواله پیدا نشد");
    const from = prev.status as RemStatus;
    const to = input.status;
    if (!(TRANSITIONS[prev.direction as Direction]?.[from] ?? []).includes(to)) {
      throw bad(`تغییر وضعیت از «${REM_STATUS_FA[from] ?? from}» به «${REM_STATUS_FA[to] ?? to}» مجاز نیست`);
    }
    const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayISO(orgTz(ctx.org));
    if (to === "paid" && date < prev.date) throw bad("تاریخ پرداخت نمی‌تواند پیش از تاریخ حواله باشد");
    const history = [...(Array.isArray(prev.history) ? prev.history : []), { at: new Date().toISOString(), status: to, from, date, note: input.note?.trim().slice(0, 500) || null, user: ctx.user.full_name }];
    const row: Row = { ...prev, status: to, paid_date: to === "paid" ? date : null };
    const vouchers = await syncVouchers(tx, ctx, row);
    await updateRow(tx, "tz_remittances", { id, org_id: ctx.org.id }, {
      status: to,
      paid_date: row.paid_date,
      paid_at: to === "paid" ? new Date().toISOString() : null,
      history,
      ...vouchers,
      origin: ctx.cfg.origin,
    });
    await audit(tx, ctx, "status", "remittance", id, `حواله‌ی ${prev.no}: ${REM_STATUS_FA[from]} ← ${REM_STATUS_FA[to]}`);
  });
  return getRemittance(ctx, id);
}

export async function deleteRemittance(ctx: Ctx, id: string) {
  ctx.need("fx", "full");
  return ctx.write(async (tx) => {
    const r = await tx.one<Row>(`select id, no, status from tz_remittances where id = $1 and org_id = $2 and deleted_at is null`, [id, ctx.org.id]);
    if (!r) throw notFound("حواله پیدا نشد");
    if (r.status === "paid") throw conflict("حواله‌ی پرداخت‌شده قابل حذف نیست؛ ابتدا وضعیت آن را برگردانید");
    await removeAuto(tx, ctx.org.id, "remittance", id);
    await tx.query(`update tz_remittances set deleted_at = now(), voucher_id = null, paid_voucher_id = null, origin = $3 where id = $1 and org_id = $2`, [id, ctx.org.id, ctx.cfg.origin]);
    await audit(tx, ctx, "delete", "remittance", id, `حذف حواله‌ی ${r.no}`);
    return { ok: true };
  });
}
