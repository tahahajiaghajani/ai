// The double-entry engine. Every financial event ends up here as a voucher (سند):
// manual vouchers typed by the accountant, and automatic vouchers owned by a source document
// (invoice, receipt, cheque operation, gold or FX deal). A voucher balances in the base
// currency; foreign-currency amounts and gold weights ride along on the same lines.
import type { Queryable, Tx } from "../../db";
import { insertMany, insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { D, round, type Num } from "@shared/money";
import { uuidv7 } from "@shared/id";
import { formatMoney } from "@shared/format";
import { assertYearOpen, fiscalYearFor } from "./fiscal";

export type VoucherKind = "normal" | "opening" | "closing" | "temp_closing" | "auto";
export type VoucherStatus = "draft" | "posted" | "final" | "void";

export interface VoucherLineInput {
  account_id: string;
  detail_id?: string | null;
  detail2_id?: string | null;
  description?: string | null;
  debit?: Num;
  credit?: Num;
  currency_id?: string | null;
  fx_debit?: Num;
  fx_credit?: Num;
  fx_rate?: Num | null;
  w_debit?: Num;
  w_credit?: Num;
  fineness?: Num | null;
  raw_weight?: Num | null;
  qty?: Num | null;
  item_id?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  due_date?: string | null;
}

export interface VoucherInput {
  id?: string;
  date: string;
  description?: string | null;
  ref_no?: string | null;
  kind?: VoucherKind;
  status?: VoucherStatus;
  lines: VoucherLineInput[];
  source_type?: string | null;
  source_id?: string | null;
}

interface AccountInfo {
  id: string;
  code: string;
  name: string;
  is_postable: boolean;
  is_active: boolean;
  detail_mode: "none" | "optional" | "required";
  detail_kinds: string[];
  fx_mode: "none" | "optional" | "required";
  currency_id: string | null;
  weight_mode: "none" | "optional" | "required";
  system_key: string | null;
}

// ---------- account lookups (memoised per transaction) ----------
const keyCache = new WeakMap<object, Map<string, string>>();

export async function accountByKey(q: Queryable, orgId: string, key: string): Promise<string> {
  let m = keyCache.get(q);
  if (!m) {
    m = new Map();
    keyCache.set(q, m);
  }
  const k = `${orgId}:${key}`;
  const hit = m.get(k);
  if (hit) return hit;
  const row = await q.one<{ id: string }>(
    `select id from tz_accounts where org_id = $1 and system_key = $2 and deleted_at is null`,
    [orgId, key],
  );
  if (!row) throw bad(`حساب «${KEY_TITLES[key] ?? key}» در کدینگ حساب‌ها تعریف نشده است (حسابداری ← کدینگ حساب‌ها ← نقش حساب)`);
  m.set(k, row.id);
  return row.id;
}

export const KEY_TITLES: Record<string, string> = {
  cash: "صندوق", bank: "بانک‌ها", ar: "حساب‌های دریافتنی", ap: "حساب‌های پرداختنی", sales: "فروش کالا",
  service_income: "درآمد خدمات", sales_returns: "برگشت از فروش", sales_discounts: "تخفیفات فروش", cogs: "بهای تمام‌شده کالای فروش‌رفته",
  inventory: "موجودی کالا", vat_out: "مالیات بر ارزش افزوده فروش", vat_in: "مالیات بر ارزش افزوده خرید",
  cheques_receivable: "اسناد دریافتنی", cheques_in_collection: "اسناد در جریان وصول", cheques_bounced: "اسناد برگشتی",
  cheques_payable: "اسناد پرداختنی", opening_balance: "تراز افتتاحیه", closing_balance: "تراز اختتامیه",
  pl_summary: "خلاصه سود و زیان", retained_earnings: "سود و زیان انباشته", current_pl: "سود و زیان سال جاری",
  gold_inventory: "موجودی مصنوعات طلا", gold_old: "موجودی طلای مستعمل", gold_bullion: "موجودی طلای آبشده",
  gold_parties: "حساب وزنی اشخاص", gold_sales: "فروش طلا", gold_wage_income: "درآمد اجرت ساخت", gold_profit_income: "سود فروش طلا",
  gold_cogs: "بهای تمام‌شده طلای فروش‌رفته", fx_cash: "صندوق ارزی", fx_bank: "بانک‌های ارزی", crypto_wallets: "کیف‌پول‌های رمزارز",
  fx_parties: "حساب ارزی اشخاص", correspondents: "حساب همکاران", fx_trading_gain: "سود معاملات ارز", fx_commission: "درآمد کارمزد",
  remittances_payable: "حواله‌های پرداختنی", fx_revaluation: "سود و زیان تسعیر",
};

async function loadAccounts(q: Queryable, orgId: string, ids: string[]): Promise<Map<string, AccountInfo>> {
  const uniq = Array.from(new Set(ids));
  const rows = await q.query<AccountInfo>(
    `select id, code, name, is_postable, is_active, detail_mode, detail_kinds, fx_mode, currency_id, weight_mode, system_key
     from tz_accounts where org_id = $1 and deleted_at is null and id = any($2::uuid[])`,
    [orgId, `{${uniq.join(",")}}`],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------- validation ----------
export interface NormalizedLine extends Required<Omit<VoucherLineInput, "fx_rate" | "fineness" | "raw_weight" | "qty">> {
  fx_rate: string | null;
  fineness: string | null;
  raw_weight: string | null;
  qty: string | null;
}

export async function normalizeLines(q: Queryable, orgId: string, lines: VoucherLineInput[], moneyDp: number): Promise<{ lines: NormalizedLine[]; debit: string; credit: string }> {
  const real = lines.filter(
    (l) => l.account_id && [l.debit, l.credit, l.fx_debit, l.fx_credit, l.w_debit, l.w_credit].some((x) => !D(x).isZero()),
  );
  if (real.length < 1) throw bad("سند باید دست‌کم یک ردیف با مبلغ داشته باشد");
  const accounts = await loadAccounts(q, orgId, real.map((l) => l.account_id));
  const detailIds = Array.from(new Set(real.flatMap((l) => [l.detail_id, l.detail2_id]).filter(Boolean) as string[]));
  const details = detailIds.length
    ? new Map(
        (await q.query<{ id: string; kind: string; name: string; is_active: boolean }>(
          `select id, kind, name, is_active from tz_details where org_id = $1 and id = any($2::uuid[])`,
          [orgId, `{${detailIds.join(",")}}`],
        )).map((r) => [r.id, r]),
      )
    : new Map();

  let debit = D(0);
  let credit = D(0);
  const out: NormalizedLine[] = real.map((l, i) => {
    const row = i + 1;
    const acc = accounts.get(l.account_id);
    if (!acc) throw bad(`ردیف ${row}: حساب پیدا نشد`);
    if (!acc.is_postable) throw bad(`ردیف ${row}: حساب «${acc.code} ${acc.name}» حساب معین نیست و سند نمی‌پذیرد`);
    if (!acc.is_active) throw bad(`ردیف ${row}: حساب «${acc.name}» غیرفعال است`);
    const dr = D(round(l.debit ?? 0, moneyDp));
    const cr = D(round(l.credit ?? 0, moneyDp));
    if (dr.isNeg() || cr.isNeg()) throw bad(`ردیف ${row}: مبلغ منفی مجاز نیست`);
    if (!dr.isZero() && !cr.isZero()) throw bad(`ردیف ${row}: یک ردیف نمی‌تواند هم بدهکار و هم بستانکار باشد`);
    let detailId = l.detail_id || null;
    if (acc.detail_mode === "required" && !detailId) throw bad(`ردیف ${row}: حساب «${acc.name}» تفصیلی لازم دارد`);
    if (acc.detail_mode === "none") detailId = null;
    if (detailId) {
      const d = details.get(detailId);
      if (!d) throw bad(`ردیف ${row}: حساب تفصیلی پیدا نشد`);
      const kinds = Array.isArray(acc.detail_kinds) ? acc.detail_kinds : [];
      if (kinds.length && !kinds.includes(d.kind)) throw bad(`ردیف ${row}: تفصیلی «${d.name}» با حساب «${acc.name}» جور نیست`);
    }
    const fxd = D(l.fx_debit ?? 0);
    const fxc = D(l.fx_credit ?? 0);
    let currency = l.currency_id || null;
    if (acc.currency_id) currency = currency ?? acc.currency_id;
    if (acc.currency_id && currency !== acc.currency_id) throw bad(`ردیف ${row}: ارز ردیف با ارز حساب «${acc.name}» یکی نیست`);
    if ((!fxd.isZero() || !fxc.isZero()) && !currency) throw bad(`ردیف ${row}: برای مبلغ ارزی، ارز را انتخاب کنید`);
    if (acc.fx_mode === "required" && !currency) throw bad(`ردیف ${row}: حساب «${acc.name}» ارزی است؛ ارز و مبلغ ارزی را وارد کنید`);
    if (acc.fx_mode === "none" && (!fxd.isZero() || !fxc.isZero())) throw bad(`ردیف ${row}: حساب «${acc.name}» مبلغ ارزی نمی‌پذیرد`);
    const wd = D(l.w_debit ?? 0);
    const wc = D(l.w_credit ?? 0);
    if (acc.weight_mode === "none" && (!wd.isZero() || !wc.isZero())) throw bad(`ردیف ${row}: حساب «${acc.name}» وزن نمی‌پذیرد`);
    if (fxd.isNeg() || fxc.isNeg() || wd.isNeg() || wc.isNeg()) throw bad(`ردیف ${row}: مقدار منفی مجاز نیست`);
    debit = debit.plus(dr);
    credit = credit.plus(cr);
    return {
      account_id: acc.id,
      detail_id: detailId,
      detail2_id: l.detail2_id || null,
      description: l.description?.trim() || null,
      debit: dr.toString(),
      credit: cr.toString(),
      currency_id: currency,
      fx_debit: fxd.toString(),
      fx_credit: fxc.toString(),
      fx_rate: l.fx_rate === null || l.fx_rate === undefined || l.fx_rate === "" ? null : D(l.fx_rate).toString(),
      w_debit: wd.toDecimalPlaces(3).toString(),
      w_credit: wc.toDecimalPlaces(3).toString(),
      fineness: l.fineness === null || l.fineness === undefined || l.fineness === "" ? null : D(l.fineness).toString(),
      raw_weight: l.raw_weight === null || l.raw_weight === undefined || l.raw_weight === "" ? null : D(l.raw_weight).toString(),
      qty: l.qty === null || l.qty === undefined || l.qty === "" ? null : D(l.qty).toString(),
      item_id: l.item_id || null,
      ref_type: l.ref_type || null,
      ref_id: l.ref_id || null,
      due_date: l.due_date || null,
    };
  });
  if (!debit.eq(credit)) {
    throw bad(`سند تراز نیست: جمع بدهکار ${formatMoney(debit, moneyDp)} و جمع بستانکار ${formatMoney(credit, moneyDp)} (اختلاف ${formatMoney(debit.minus(credit).abs(), moneyDp)})`);
  }
  return { lines: out, debit: debit.toString(), credit: credit.toString() };
}

// ---------- save / delete ----------
export interface SavedVoucher {
  id: string;
  no: number;
  fiscal_year_id: string;
  status: VoucherStatus;
}

export async function saveVoucher(
  tx: Tx,
  org: { id: string; money_decimals: number },
  input: VoucherInput,
  opts: { userId?: string | null; origin?: string; allowAuto?: boolean; allowClosedYear?: boolean } = {},
): Promise<SavedVoucher> {
  const fy = await fiscalYearFor(tx, org.id, input.date, { allowClosed: opts.allowClosedYear });
  const { lines, debit, credit } = await normalizeLines(tx, org.id, input.lines, org.money_decimals);
  const kind: VoucherKind = input.kind ?? (input.source_type ? "auto" : "normal");
  const status: VoucherStatus = input.status ?? (kind === "auto" ? "posted" : "posted");
  let id = input.id;
  let no: number;
  const existing = id
    ? await tx.one<{ id: string; no: number; status: VoucherStatus; kind: VoucherKind; fiscal_year_id: string; deleted_at: string | null }>(
        `select id, no, status, kind, fiscal_year_id, deleted_at from tz_vouchers where id = $1 and org_id = $2`,
        [id, org.id],
      )
    : null;
  if (existing && !existing.deleted_at) {
    if (existing.status === "final") throw conflict("این سند قطعی شده و قابل ویرایش نیست");
    if (existing.kind === "auto" && !opts.allowAuto) throw conflict("این سند خودکار است؛ آن را از سند مبدأ (فاکتور، دریافت و …) ویرایش کنید");
    if (!opts.allowClosedYear) await assertYearOpen(tx, org.id, existing.fiscal_year_id);
    no = existing.fiscal_year_id === fy.id ? existing.no : await nextNo(tx, "tz_vouchers", org.id, fy.id);
    await updateRow(tx, "tz_vouchers", { id: existing.id, org_id: org.id }, {
      fiscal_year_id: fy.id,
      no,
      date: input.date,
      kind,
      status,
      description: input.description?.trim() || null,
      ref_no: input.ref_no?.trim() || null,
      source_type: input.source_type ?? null,
      source_id: input.source_id ?? null,
      total_debit: debit,
      total_credit: credit,
      origin: opts.origin,
    });
    await tx.query(`delete from tz_voucher_lines where voucher_id = $1`, [existing.id]);
    id = existing.id;
  } else {
    id = id ?? uuidv7();
    no = await nextNo(tx, "tz_vouchers", org.id, fy.id);
    if (existing && existing.deleted_at) {
      await tx.query(`delete from tz_voucher_lines where voucher_id = $1`, [id]);
      await tx.query(`delete from tz_vouchers where id = $1`, [id]);
    }
    await insertRow(tx, "tz_vouchers", {
      id,
      org_id: org.id,
      fiscal_year_id: fy.id,
      no,
      date: input.date,
      kind,
      status,
      description: input.description?.trim() || null,
      ref_no: input.ref_no?.trim() || null,
      source_type: input.source_type ?? null,
      source_id: input.source_id ?? null,
      total_debit: debit,
      total_credit: credit,
      created_by: opts.userId ?? null,
      origin: opts.origin,
    }, "id");
  }
  await insertMany(
    tx,
    "tz_voucher_lines",
    lines.map((l, i) => ({ id: uuidv7(), voucher_id: id, org_id: org.id, line_no: i + 1, ...l })),
  );
  return { id: id!, no, fiscal_year_id: fy.id, status };
}

/** Soft-delete a manual voucher. */
export async function deleteVoucher(tx: Tx, orgId: string, id: string, opts: { allowAuto?: boolean } = {}) {
  const v = await tx.one<{ status: VoucherStatus; kind: VoucherKind; fiscal_year_id: string }>(`select status, kind, fiscal_year_id from tz_vouchers where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!v) throw notFound("سند پیدا نشد");
  if (v.status === "final") throw conflict("سند قطعی قابل حذف نیست");
  if (v.kind === "auto" && !opts.allowAuto) throw conflict("سند خودکار را از سند مبدأ حذف کنید");
  await assertYearOpen(tx, orgId, v.fiscal_year_id);
  await tx.query(`delete from tz_voucher_lines where voucher_id = $1`, [id]);
  await tx.query(`update tz_vouchers set deleted_at = now(), total_debit = 0, total_credit = 0 where id = $1`, [id]);
}

/**
 * Write (or replace) the automatic voucher owned by a source document. An empty `lines` list
 * removes it. Returns the voucher id or null.
 */
export async function postAuto(
  tx: Tx,
  org: { id: string; money_decimals: number },
  src: { type: string; id: string; date: string; description: string; refNo?: string | null; voucherId?: string | null },
  lines: VoucherLineInput[],
  opts: { userId?: string | null; origin?: string } = {},
): Promise<string | null> {
  const existing = await tx.one<{ id: string }>(
    `select id from tz_vouchers where org_id = $1 and source_type = $2 and source_id = $3 and deleted_at is null order by created_at limit 1`,
    [org.id, src.type, src.id],
  );
  const clean = lines.filter((l) => [l.debit, l.credit, l.fx_debit, l.fx_credit, l.w_debit, l.w_credit].some((x) => !D(x).isZero()));
  if (!clean.length) {
    if (existing) await deleteVoucher(tx, org.id, existing.id, { allowAuto: true });
    return null;
  }
  const saved = await saveVoucher(
    tx,
    org,
    {
      id: existing?.id ?? src.voucherId ?? undefined,
      date: src.date,
      description: src.description,
      ref_no: src.refNo ?? null,
      kind: "auto",
      status: "posted",
      source_type: src.type,
      source_id: src.id,
      lines: clean,
    },
    { ...opts, allowAuto: true },
  );
  return saved.id;
}

export async function removeAuto(tx: Tx, orgId: string, sourceType: string, sourceId: string) {
  const rows = await tx.query<{ id: string }>(
    `select id from tz_vouchers where org_id = $1 and source_type = $2 and source_id = $3 and deleted_at is null`,
    [orgId, sourceType, sourceId],
  );
  for (const r of rows) await deleteVoucher(tx, orgId, r.id, { allowAuto: true });
}

// ---------- line helpers for automatic postings ----------
type Extra = Omit<VoucherLineInput, "account_id" | "debit" | "credit">;
export const dr = (account_id: string, amount: Num, extra: Extra = {}): VoucherLineInput => ({ account_id, debit: amount, credit: 0, ...extra });
export const cr = (account_id: string, amount: Num, extra: Extra = {}): VoucherLineInput => ({ account_id, debit: 0, credit: amount, ...extra });

/** A signed amount on one account: positive → debit, negative → credit. */
export const signed = (account_id: string, amount: Num, extra: Extra = {}): VoucherLineInput =>
  D(amount).isNeg() ? cr(account_id, D(amount).abs().toString(), extra) : dr(account_id, D(amount).toString(), extra);

export async function getVoucher(q: Queryable, orgId: string, id: string) {
  const v = await q.one(`select * from tz_vouchers where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!v) throw notFound("سند پیدا نشد");
  const lines = await q.query(
    `select l.*, a.code as account_code, a.name as account_name, d.code as detail_code, d.name as detail_name,
            c.code as currency_code
     from tz_voucher_lines l
     join tz_accounts a on a.id = l.account_id
     left join tz_details d on d.id = l.detail_id
     left join tz_currencies c on c.id = l.currency_id
     where l.voucher_id = $1 order by l.line_no`,
    [id],
  );
  return { ...v, lines };
}
