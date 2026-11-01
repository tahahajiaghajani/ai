// Treasury documents in the base currency: receipts (دریافت), payments (پرداخت) and transfers
// between cash boxes and bank accounts (انتقال وجه).
//
// A document owns
//  - its automatic voucher (source type `treasury_doc`), rewritten on every save;
//  - the cheques it registers: received cheques of a receipt (status in_hand) and cheques issued
//    from a cheque book in a payment (status issued). While a cheque is still in that initial
//    status the document may change or drop it; once it has been deposited, cleared, endorsed…
//    its amount, party and bank are locked and the document cannot be deleted;
//  - its allocations to invoices (rows of tz_treasury_allocs; invoices are only read).
//
// Postings (fees are bank charges: they reduce money received and add to money paid):
//   receipt:  Dr cash[box] / bank[bank] / cheques_receivable[drawer] / other …, Dr bank_fees[bank]
//             Cr ar[party] (or the header counter account)
//   payment:  Dr ap[party] (or the header counter account), Dr bank_fees[bank]
//             Cr cash[box] / bank[bank] / cheques_payable[payee] / other …
//   transfer: Dr destination, Dr bank_fees / Cr source
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { insertMany, insertRow, nextNo, updateRow } from "../../db/sql";
import { bad, conflict, notFound } from "../../http/errors";
import { accountByKey, cr, dr, postAuto, removeAuto, type VoucherLineInput } from "../accounting/vouchers";
import { fiscalYearFor } from "../accounting/fiscal";
import { audit } from "../data/crud";
import { D, isNumeric, normalizeDigits, round } from "@shared/money";
import { uuidv7 } from "@shared/id";
import { formatMoney } from "@shared/format";
import { checkFormat } from "@shared/validate";
import {
  INITIAL_STATUS, KIND_METHODS, KIND_TITLE, METHOD_TITLE, Lookups, chequeLabel, chequeStatusTitle, fa, jdate, takesPersonDetail,
  type ChequeDirection, type DocKind, type Method, type PartyRow,
} from "./common";
import type { DocInput, DocLineInput } from "./schema";

// ---------------------------------------------------------------- types

type Decimal = ReturnType<typeof D>;

export interface DocRow {
  id: string;
  org_id: string;
  fiscal_year_id: string;
  kind: DocKind;
  no: number;
  date: string;
  party_id: string | null;
  account_id: string | null;
  detail_id: string | null;
  description: string | null;
  total: string;
  status: string;
  voucher_id: string | null;
  source_type: string | null;
  source_id: string | null;
  deleted_at: string | null;
}

export interface ChequeRow {
  id: string;
  direction: ChequeDirection;
  sayad_no: string | null;
  serial_no: string | null;
  bank_name: string | null;
  branch_name: string | null;
  account_no: string | null;
  account_owner: string | null;
  party_id: string | null;
  amount: string;
  issue_date: string | null;
  due_date: string;
  status: string;
  bank_account_id: string | null;
  cheque_book_id: string | null;
  holder_party_id: string | null;
  description: string | null;
  source_type: string | null;
  source_id: string | null;
  history: unknown[];
}

/** A cheque the document registers, ready to be written. */
interface ChequeSpec {
  id: string;
  existing: ChequeRow | null;
  direction: ChequeDirection;
  party: PartyRow;
  amount: string;
  sayad_no: string | null;
  serial_no: string | null;
  bank_name: string | null;
  branch_name: string | null;
  account_no: string | null;
  account_owner: string | null;
  issue_date: string;
  due_date: string;
  bank_account_id: string | null;
  cheque_book_id: string | null;
  description: string | null;
}

interface Resolved {
  row: number;
  id: string;
  direction: "in" | "out";
  method: Method;
  amount: Decimal;
  fee: Decimal;
  cash_box_id: string | null;
  bank_account_id: string | null;
  pos_id: string | null;
  account_id: string | null;
  detail_id: string | null;
  ref_no: string | null;
  description: string | null;
  /** where the money lands (in) or leaves from (out) */
  post: { accountId: string; detailId: string | null; label: string };
  /** bank detail charged with this line's fee */
  feeDetail: string | null;
  cheque: ChequeSpec | null;
}

const at = (row: number) => `ردیف ${fa(row)}: `;
const clean = (s: string | null | undefined) => (s ?? "").trim() || null;
const digits = (s: string | null | undefined) => {
  const v = normalizeDigits(String(s ?? "")).replace(/[\s-]/g, "");
  return v || null;
};

/** A cheque has left its initial status (or has any recorded operation). */
export function chequeMoved(c: Pick<ChequeRow, "direction" | "status" | "history">): boolean {
  return c.status !== INITIAL_STATUS[c.direction] || (Array.isArray(c.history) && c.history.length > 0);
}

async function loadDoc(q: Queryable, orgId: string, id: string): Promise<DocRow | null> {
  return q.one<DocRow>(`select * from tz_treasury_docs where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
}

async function docCheques(q: Queryable, orgId: string, docId: string): Promise<ChequeRow[]> {
  return q.query<ChequeRow>(
    `select * from tz_cheques where org_id = $1 and source_type = 'treasury_doc' and source_id = $2 and deleted_at is null order by created_at`,
    [orgId, docId],
  );
}

// ---------------------------------------------------------------- save

export interface SavedDoc {
  id: string;
  kind: DocKind;
  no: number;
  total: string;
  voucher_id: string | null;
}

/**
 * Create (no `id`) or replace (with `id`) a treasury document inside the caller's write
 * transaction. Other modules may call it too (e.g. settling an invoice), passing
 * `source_type`/`source_id` to mark where the document came from.
 */
export async function saveDoc(tx: Tx, ctx: Ctx, input: DocInput, id?: string): Promise<SavedDoc> {
  const org = ctx.org;
  const dp = org.money_decimals ?? 0;
  const L = new Lookups(tx, org.id);
  const kind = input.kind;

  const prev = id ? await loadDoc(tx, org.id, id) : null;
  if (id && !prev) throw notFound("سند خزانه پیدا نشد");
  if (prev && prev.kind !== kind) throw bad("نوع سند قابل تغییر نیست");
  if (prev) await fiscalYearFor(tx, org.id, prev.date); // documents of a closed year stay as they are
  const fy = await fiscalYearFor(tx, org.id, input.date);
  const docId = prev?.id ?? uuidv7();
  const prevCheques = prev ? await docCheques(tx, org.id, prev.id) : [];
  if (prev) {
    // boxes, banks, POS, accounts and cheque books the document already uses stay usable even if
    // they were deactivated since (editing an old receipt must not fail for that reason)
    const refs = await tx.query<Record<string, string | null>>(
      `select cash_box_id, bank_account_id, pos_id, account_id from tz_treasury_lines where doc_id = $1`,
      [prev.id],
    );
    for (const r of refs) for (const v of Object.values(r)) if (v) L.known.add(v);
    for (const c of prevCheques) for (const v of [c.cheque_book_id, c.bank_account_id, c.party_id]) if (v) L.known.add(v);
    for (const v of [prev.account_id, prev.party_id]) if (v) L.known.add(v);
  }

  // ----- header: who pays us / whom we pay
  let party: PartyRow | null = null;
  let counter: { accountId: string; detailId: string | null; label: string } | null = null;
  let headerAccountId: string | null = null;
  let headerDetailId: string | null = null;
  if (kind !== "transfer") {
    if (input.party_id) party = await L.party(input.party_id);
    if (input.account_id) {
      const acc = await L.account(input.account_id, "حساب طرف مقابل: ");
      if (acc.system_key === "cash" || acc.system_key === "bank") {
        throw bad("برای جابه‌جایی پول بین صندوق‌ها و بانک‌ها از «انتقال وجه» استفاده کنید");
      }
      let detailId = input.detail_id ?? null;
      if (acc.detail_mode === "none") detailId = null;
      else if (!detailId && party && takesPersonDetail(acc)) detailId = party.detail_id;
      if (acc.detail_mode === "required" && !detailId) {
        throw bad(`حساب «${acc.name}» تفصیلی لازم دارد؛ شخص یا حساب تفصیلی را انتخاب کنید`);
      }
      counter = { accountId: acc.id, detailId, label: party?.name ?? acc.name };
      headerAccountId = acc.id;
      headerDetailId = detailId;
    } else if (party) {
      counter = { accountId: await accountByKey(tx, org.id, kind === "receipt" ? "ar" : "ap"), detailId: party.detail_id, label: party.name };
    } else {
      throw bad(kind === "receipt" ? "دریافت از چه کسی؟ شخص یا حساب طرف مقابل را انتخاب کنید" : "پرداخت به چه کسی؟ شخص یا حساب طرف مقابل را انتخاب کنید");
    }
  }
  const counterName = counter?.label ?? "";
  // a document against an account (no party) reads «بابت اجاره» rather than «به اجاره»
  const byAccount = !party;

  // ----- lines
  if (kind === "transfer") {
    if (input.lines.length !== 2) throw bad("انتقال وجه یک مبدأ و یک مقصد دارد");
  }
  const resolved: Resolved[] = [];
  const prevById = new Map(prevCheques.map((c) => [c.id, c]));
  const usedCheques = new Set<string>();
  for (const [i, l] of input.lines.entries()) {
    resolved.push(await resolveLine(tx, ctx, L, { kind, docDate: input.date, party, counterName, dp, row: i + 1, line: l, index: i, prevById, usedCheques }));
  }
  if (kind === "transfer") {
    const out = resolved.filter((r) => r.direction === "out");
    const inn = resolved.filter((r) => r.direction === "in");
    if (out.length !== 1 || inn.length !== 1) throw bad("انتقال وجه یک مبدأ (برداشت) و یک مقصد (واریز) دارد");
    if (!out[0].amount.eq(inn[0].amount)) throw bad("مبلغ برداشت از مبدأ و واریز به مقصد باید برابر باشد");
    if (out[0].post.accountId === inn[0].post.accountId && out[0].post.detailId === inn[0].post.detailId) {
      throw bad("مبدأ و مقصد انتقال یکی است");
    }
  }

  const total = kind === "transfer" ? resolved.find((r) => r.direction === "in")!.amount : resolved.reduce((a, r) => a.plus(r.amount), D(0));

  // ----- cheques: locked ones keep their accounting facts, removed ones must be untouched
  const specs = resolved.map((r) => r.cheque).filter((c): c is ChequeSpec => !!c);
  for (const s of specs) {
    const e = s.existing;
    if (!e || !chequeMoved(e)) continue;
    // (a received cheque's bank is set by its operations — deposit/clearance — not by the document)
    const changed =
      !D(e.amount).eq(D(s.amount)) || e.party_id !== s.party.id || e.direction !== s.direction ||
      (s.direction === "issued" &&
        ((e.bank_account_id ?? null) !== (s.bank_account_id ?? null) || (e.cheque_book_id ?? null) !== (s.cheque_book_id ?? null)));
    if (changed) {
      throw conflict(`${chequeLabel(e)} «${chequeStatusTitle(e.direction, e.status)}» است؛ مبلغ، شخص و بانک آن قابل تغییر نیست (ابتدا عملیات چک را برگردانید)`);
    }
    const first = (e.history[0] as { date?: string } | undefined)?.date;
    if (first && input.date > first) throw bad(`تاریخ سند نمی‌تواند بعد از نخستین عملیات ${chequeLabel(e)} (${jdate(first)}) باشد`);
  }
  const removed = prevCheques.filter((c) => !usedCheques.has(c.id));
  for (const c of removed) {
    if (chequeMoved(c)) throw conflict(`${chequeLabel(c)} «${chequeStatusTitle(c.direction, c.status)}» است و نمی‌توان آن را از سند حذف کرد`);
  }
  await checkDuplicates(tx, org.id, specs);

  // ----- allocations to invoices
  const allocs = await resolveAllocs(tx, org.id, { kind, party, total, docId, dp, allocs: input.allocs ?? [] });

  // ----- number
  const no = prev && prev.fiscal_year_id === fy.id ? prev.no : await nextNo(tx, "tz_treasury_docs", org.id, fy.id, kind);

  // ----- voucher
  const vlines: VoucherLineInput[] = [];
  const needFees = resolved.some((r) => r.fee.gt(0));
  const feeAccount = needFees ? await accountByKey(tx, org.id, "bank_fees") : null;
  for (const r of resolved) {
    const net = r.direction === "in" ? r.amount.minus(r.fee) : r.amount.plus(r.fee);
    const extra: Omit<VoucherLineInput, "account_id" | "debit" | "credit"> = {
      detail_id: r.post.detailId,
      description: lineText(kind, r, counterName, byAccount),
      ...(r.cheque ? { ref_type: "cheque", ref_id: r.cheque.id, due_date: r.cheque.due_date } : {}),
    };
    vlines.push(r.direction === "in" ? dr(r.post.accountId, net.toString(), extra) : cr(r.post.accountId, net.toString(), extra));
    if (r.fee.gt(0)) {
      vlines.push(dr(feeAccount!, r.fee.toString(), { detail_id: r.feeDetail, description: `کارمزد بانکی — ${r.post.label}` }));
    }
  }
  const header = headerText(kind, no, counterName, byAccount, resolved, input.description);
  if (counter) {
    const extra = { detail_id: counter.detailId, description: header };
    vlines.push(kind === "receipt" ? cr(counter.accountId, total.toString(), extra) : dr(counter.accountId, total.toString(), extra));
  }
  const voucherId = await postAuto(
    tx,
    org,
    { type: "treasury_doc", id: docId, date: input.date, description: header, voucherId: prev?.voucher_id ?? null },
    vlines,
    { userId: ctx.user.id, origin: ctx.cfg.origin },
  );

  // ----- write the root, its children and the cheques
  const root = {
    fiscal_year_id: fy.id,
    kind,
    no,
    date: input.date,
    party_id: party?.id ?? null,
    account_id: headerAccountId,
    detail_id: headerDetailId,
    description: clean(input.description),
    total: total.toString(),
    status: "posted",
    voucher_id: voucherId,
    origin: ctx.cfg.origin,
  };
  if (prev) {
    await updateRow(tx, "tz_treasury_docs", { id: docId, org_id: org.id }, root);
  } else {
    await insertRow(tx, "tz_treasury_docs", {
      id: docId,
      org_id: org.id,
      ...root,
      source_type: input.source_type ?? null,
      source_id: input.source_id ?? null,
      created_by: ctx.user.id,
    }, "id");
  }

  for (const s of specs) {
    const row = {
      direction: s.direction,
      sayad_no: s.sayad_no,
      serial_no: s.serial_no,
      bank_name: s.bank_name,
      branch_name: s.branch_name,
      account_no: s.account_no,
      account_owner: s.account_owner,
      party_id: s.party.id,
      amount: s.amount,
      issue_date: s.issue_date,
      due_date: s.due_date,
      // operations own the bank of a received cheque once it exists
      ...(s.direction === "issued" || !s.existing ? { bank_account_id: s.bank_account_id } : {}),
      cheque_book_id: s.cheque_book_id,
      description: s.description,
      origin: ctx.cfg.origin,
    };
    if (s.existing) {
      await updateRow(tx, "tz_cheques", { id: s.id, org_id: org.id }, row);
    } else {
      await insertRow(tx, "tz_cheques", {
        id: s.id,
        org_id: org.id,
        ...row,
        status: INITIAL_STATUS[s.direction],
        source_type: "treasury_doc",
        source_id: docId,
        history: [],
      }, "id");
    }
  }
  if (removed.length) {
    await tx.query(`update tz_cheques set deleted_at = now(), origin = $3 where org_id = $1 and id = any($2::uuid[])`, [
      org.id,
      `{${removed.map((c) => c.id).join(",")}}`,
      ctx.cfg.origin,
    ]);
  }

  await tx.query(`delete from tz_treasury_lines where doc_id = $1`, [docId]);
  await insertMany(
    tx,
    "tz_treasury_lines",
    resolved.map((r, i) => ({
      id: r.id,
      doc_id: docId,
      org_id: org.id,
      line_no: i + 1,
      direction: r.direction,
      method: r.method,
      cash_box_id: r.cash_box_id,
      bank_account_id: r.bank_account_id,
      pos_id: r.pos_id,
      cheque_id: r.cheque?.id ?? null,
      account_id: r.account_id,
      detail_id: r.detail_id,
      amount: r.amount.toString(),
      fee: r.fee.toString(),
      ref_no: r.ref_no,
      description: r.description,
    })),
  );
  await tx.query(`delete from tz_treasury_allocs where doc_id = $1`, [docId]);
  await insertMany(
    tx,
    "tz_treasury_allocs",
    allocs.map((a) => ({ id: uuidv7(), doc_id: docId, org_id: org.id, invoice_id: a.invoice_id, amount: a.amount })),
  );

  await audit(tx, ctx, prev ? "update" : "create", "treasury_doc", docId, `${KIND_TITLE[kind]} ${fa(no)}${counterName ? ` — ${counterName}` : ""}`);
  return { id: docId, kind, no, total: total.toString(), voucher_id: voucherId };
}

interface ResolveCtx {
  kind: DocKind;
  docDate: string;
  party: PartyRow | null;
  counterName: string;
  dp: number;
  row: number;
  index: number;
  line: DocLineInput;
  prevById: Map<string, ChequeRow>;
  usedCheques: Set<string>;
}

/** Validate one line and find the account/detail it posts to. */
async function resolveLine(tx: Tx, ctx: Ctx, L: Lookups, rc: ResolveCtx): Promise<Resolved> {
  const { kind, line: l, row, dp } = rc;
  const w = at(row);
  const orgId = ctx.org.id;
  const direction: "in" | "out" = kind === "receipt" ? "in" : kind === "payment" ? "out" : (l.direction ?? (rc.index === 0 ? "out" : "in"));
  const method = l.method as Method;
  if (!KIND_METHODS[kind].includes(method)) throw bad(`${w}روش «${METHOD_TITLE[method]}» در ${KIND_TITLE[kind]} به کار نمی‌رود`);
  if (!isNumeric(l.amount)) throw bad(`${w}مبلغ معتبر نیست`);
  const amount = D(round(l.amount, dp));
  if (amount.lte(0)) throw bad(`${w}مبلغ را وارد کنید`);
  if (l.fee && !isNumeric(l.fee)) throw bad(`${w}کارمزد معتبر نیست`);
  const fee = l.fee ? D(round(l.fee, dp)) : D(0);
  if (fee.isNeg()) throw bad(`${w}کارمزد نمی‌تواند منفی باشد`);
  if (fee.gt(0) && !["bank", "card", "pos"].includes(method)) throw bad(`${w}کارمزد فقط برای بانک، کارت‌به‌کارت و کارتخوان ثبت می‌شود`);
  if (fee.gt(0) && direction === "in" && fee.gte(amount)) throw bad(`${w}کارمزد باید کمتر از مبلغ باشد`);

  const base = {
    row,
    id: l.id ?? uuidv7(),
    direction,
    method,
    amount,
    fee,
    cash_box_id: null as string | null,
    bank_account_id: null as string | null,
    pos_id: null as string | null,
    account_id: null as string | null,
    detail_id: null as string | null,
    ref_no: clean(l.ref_no ? normalizeDigits(l.ref_no) : null),
    description: clean(l.description),
    feeDetail: null as string | null,
    cheque: null as ChequeSpec | null,
  };

  switch (method) {
    case "cash": {
      if (!l.cash_box_id) throw bad(`${w}صندوق را انتخاب کنید`);
      const box = await L.box(l.cash_box_id, w);
      return { ...base, cash_box_id: box.id, post: { accountId: await accountByKey(tx, orgId, "cash"), detailId: box.detail_id, label: box.name } };
    }
    case "bank":
    case "card": {
      if (!l.bank_account_id) throw bad(`${w}حساب بانکی را انتخاب کنید`);
      const bank = await L.bank(l.bank_account_id, w);
      return {
        ...base,
        bank_account_id: bank.id,
        feeDetail: bank.detail_id,
        post: { accountId: await accountByKey(tx, orgId, "bank"), detailId: bank.detail_id, label: bank.name },
      };
    }
    case "pos": {
      if (!l.pos_id) throw bad(`${w}کارتخوان را انتخاب کنید`);
      const pos = await L.pos(l.pos_id, w);
      const bank = await L.bank(pos.bank_account_id!, `${w}کارتخوان «${pos.name}»: `);
      return {
        ...base,
        pos_id: pos.id,
        bank_account_id: bank.id,
        feeDetail: bank.detail_id,
        post: { accountId: await accountByKey(tx, orgId, "bank"), detailId: bank.detail_id, label: `کارتخوان ${pos.name}` },
      };
    }
    case "other": {
      if (!l.account_id) throw bad(`${w}حساب را انتخاب کنید`);
      const acc = await L.account(l.account_id, w);
      if (acc.system_key === "cash" || acc.system_key === "bank") throw bad(`${w}برای صندوق و بانک روش «نقد» یا «بانکی» را انتخاب کنید`);
      let detailId = l.detail_id ?? null;
      if (acc.detail_mode === "none") detailId = null;
      else if (!detailId && rc.party && takesPersonDetail(acc)) detailId = rc.party.detail_id;
      if (acc.detail_mode === "required" && !detailId) throw bad(`${w}حساب «${acc.name}» تفصیلی لازم دارد`);
      return { ...base, account_id: acc.id, detail_id: detailId, post: { accountId: acc.id, detailId, label: acc.name } };
    }
    case "cheque": {
      const c = l.cheque ?? {};
      const cdir: ChequeDirection = direction === "in" ? "received" : "issued";
      if (rc.party && c.party_id && c.party_id !== rc.party.id) throw bad(`${w}شخص چک با شخص سند یکی نیست`);
      const partyId = c.party_id || rc.party?.id || null;
      if (!partyId) throw bad(`${w}شخص ${cdir === "received" ? "صاحب چک (طرف حساب)" : "دریافت‌کننده‌ی چک"} را انتخاب کنید`);
      const cp = await L.party(partyId, w);
      if (!c.due_date) throw bad(`${w}تاریخ سررسید چک را وارد کنید`);
      const sayad = digits(c.sayad_no);
      if (sayad) {
        const problem = checkFormat("sayad", sayad);
        if (problem) throw bad(`${w}${problem}`);
      }
      const serial = digits(c.serial_no);
      if (!serial && !sayad) throw bad(`${w}شماره‌ی سریال یا شناسه‌ی صیادی چک را وارد کنید`);

      let existing: ChequeRow | null = null;
      if (l.cheque_id) {
        existing = rc.prevById.get(l.cheque_id) ?? null;
        if (!existing) throw bad(`${w}چک این ردیف به این سند تعلق ندارد`);
        if (rc.usedCheques.has(existing.id)) throw bad(`${w}یک چک در دو ردیف آمده است`);
        rc.usedCheques.add(existing.id);
      }

      let bankAccountId: string | null = null;
      let bookId: string | null = null;
      let bankName = clean(c.bank_name);
      let branchName = clean(c.branch_name);
      let accountNo = digits(c.account_no);
      let owner = clean(c.account_owner);
      let accountKey = "cheques_receivable";
      if (cdir === "issued") {
        accountKey = "cheques_payable";
        if (c.cheque_book_id) {
          const book = await L.book(c.cheque_book_id, w);
          bookId = book.id;
          bankAccountId = book.bank_account_id;
          if (c.bank_account_id && c.bank_account_id !== book.bank_account_id) throw bad(`${w}دسته‌چک «${book.title}» متعلق به حساب بانکی دیگری است`);
          if (serial) checkSerialRange(book, serial, w);
        } else {
          bankAccountId = c.bank_account_id ?? l.bank_account_id ?? null;
          if (!bankAccountId) throw bad(`${w}دسته‌چک یا حساب بانکی چک را انتخاب کنید`);
        }
        const bank = await L.bank(bankAccountId, w);
        bankName = bankName ?? bank.bank_name ?? bank.name;
        branchName = branchName ?? bank.branch_name;
        accountNo = accountNo ?? digits(bank.account_no);
        owner = owner ?? bank.owner_name ?? ctx.org.name;
      }
      const spec: ChequeSpec = {
        id: existing?.id ?? uuidv7(),
        existing,
        direction: cdir,
        party: cp,
        amount: amount.toString(),
        sayad_no: sayad,
        serial_no: serial,
        bank_name: bankName,
        branch_name: branchName,
        account_no: accountNo,
        account_owner: owner,
        issue_date: c.issue_date ?? rc.docDate,
        due_date: c.due_date,
        bank_account_id: bankAccountId,
        cheque_book_id: bookId,
        description: clean(c.description) ?? clean(l.description),
      };
      return {
        ...base,
        bank_account_id: cdir === "issued" ? bankAccountId : null,
        cheque: spec,
        post: { accountId: await accountByKey(tx, orgId, accountKey), detailId: cp.detail_id, label: chequeLabel(spec) },
      };
    }
  }
}

function checkSerialRange(book: { title: string; serial_from: string | null; serial_to: string | null }, serial: string, w: string) {
  const f = digits(book.serial_from);
  const t = digits(book.serial_to);
  if (!/^\d+$/.test(serial) || !f || !t || !/^\d+$/.test(f) || !/^\d+$/.test(t)) return;
  const n = BigInt(serial);
  if (n < BigInt(f) || n > BigInt(t)) throw bad(`${w}سریال ${fa(serial)} در محدوده‌ی دسته‌چک «${book.title}» (${fa(f)} تا ${fa(t)}) نیست`);
}

/** Sayad numbers are unique per direction; issued serials are unique per cheque book / bank account. */
async function checkDuplicates(tx: Tx, orgId: string, specs: ChequeSpec[]) {
  const own = `{${specs.map((s) => s.id).join(",")}}`;
  const seen = new Set<string>();
  for (const s of specs) {
    if (s.sayad_no) {
      const k = `s:${s.direction}:${s.sayad_no}`;
      if (seen.has(k)) throw bad(`شناسه‌ی صیادی ${fa(s.sayad_no)} دو بار در این سند آمده است`);
      seen.add(k);
      const dup = await tx.one<{ serial_no: string | null }>(
        `select serial_no from tz_cheques where org_id = $1 and direction = $2 and sayad_no = $3 and deleted_at is null and not (id = any($4::uuid[])) limit 1`,
        [orgId, s.direction, s.sayad_no, own],
      );
      if (dup) throw conflict(`چکی با شناسه‌ی صیادی ${fa(s.sayad_no)} قبلاً ثبت شده است`);
    }
    if (s.direction === "issued" && s.serial_no) {
      const k = `b:${s.cheque_book_id ?? s.bank_account_id}:${s.serial_no}`;
      if (seen.has(k)) throw bad(`سریال ${fa(s.serial_no)} دو بار در این سند آمده است`);
      seen.add(k);
      const dup = await tx.one(
        `select 1 from tz_cheques where org_id = $1 and direction = 'issued' and serial_no = $2 and deleted_at is null
           and not (id = any($3::uuid[])) and ${s.cheque_book_id ? "cheque_book_id = $4" : "bank_account_id = $4"} limit 1`,
        [orgId, s.serial_no, own, s.cheque_book_id ?? s.bank_account_id],
      );
      if (dup) throw conflict(`برگ چک با سریال ${fa(s.serial_no)} قبلاً صادر شده است`);
    }
  }
}

const RECEIPT_INVOICES = ["sale", "purchase_return"];
const PAYMENT_INVOICES = ["purchase", "sale_return"];
const INVOICE_TITLE: Record<string, string> = { sale: "فاکتور فروش", purchase: "فاکتور خرید", sale_return: "برگشت از فروش", purchase_return: "برگشت از خرید" };

/** Allocations of a receipt/payment to the party's invoices (read-only use of tz_invoices). */
async function resolveAllocs(
  tx: Tx,
  orgId: string,
  p: { kind: DocKind; party: PartyRow | null; total: Decimal; docId: string; dp: number; allocs: { invoice_id: string; amount: string }[] },
): Promise<{ invoice_id: string; amount: string }[]> {
  const merged = new Map<string, Decimal>();
  for (const a of p.allocs) {
    if (!isNumeric(a.amount)) throw bad("مبلغ تخصیص معتبر نیست");
    const amt = D(round(a.amount, p.dp));
    if (amt.isNeg()) throw bad("مبلغ تخصیص نمی‌تواند منفی باشد");
    if (amt.isZero()) continue;
    merged.set(a.invoice_id, (merged.get(a.invoice_id) ?? D(0)).plus(amt));
  }
  if (!merged.size) return [];
  if (p.kind === "transfer") throw bad("انتقال وجه به فاکتور تخصیص داده نمی‌شود");
  if (!p.party) throw bad("برای تخصیص به فاکتور، شخص سند را انتخاب کنید");
  const ids = `{${[...merged.keys()].join(",")}}`;
  const invoices = await tx.query<{ id: string; kind: string; no: number; party_id: string | null; total: string; status: string }>(
    `select id, kind, no, party_id, total, status from tz_invoices where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
    [orgId, ids],
  );
  const others = await tx.query<{ invoice_id: string; amount: string }>(
    `select a.invoice_id, sum(a.amount) as amount from tz_treasury_allocs a join tz_treasury_docs d on d.id = a.doc_id
     where a.org_id = $1 and a.invoice_id = any($2::uuid[]) and d.deleted_at is null and a.doc_id <> $3 group by a.invoice_id`,
    [orgId, ids, p.docId],
  );
  const allowed = p.kind === "receipt" ? RECEIPT_INVOICES : PAYMENT_INVOICES;
  let sum = D(0);
  const out: { invoice_id: string; amount: string }[] = [];
  for (const [invoiceId, amt] of merged) {
    const inv = invoices.find((x) => x.id === invoiceId);
    if (!inv) throw bad("فاکتور انتخاب‌شده برای تخصیص پیدا نشد");
    const title = `${INVOICE_TITLE[inv.kind] ?? "فاکتور"} شماره‌ی ${fa(inv.no)}`;
    if (!allowed.includes(inv.kind)) throw bad(`${title} با ${KIND_TITLE[p.kind]} تسویه نمی‌شود`);
    if (["draft", "void", "cancelled"].includes(inv.status)) throw bad(`${title} قطعی نشده یا باطل است`);
    if (inv.party_id && inv.party_id !== p.party.id) throw bad(`${title} متعلق به شخص دیگری است`);
    const already = D(others.find((x) => x.invoice_id === invoiceId)?.amount ?? 0);
    const left = D(inv.total).minus(already);
    if (amt.gt(left)) throw bad(`تخصیص به ${title} بیش از مانده‌ی آن است (مانده: ${formatMoney(left.isNeg() ? 0 : left, p.dp)})`);
    sum = sum.plus(amt);
    out.push({ invoice_id: invoiceId, amount: amt.toString() });
  }
  if (sum.gt(p.total)) throw bad(`جمع تخصیص‌ها (${formatMoney(sum, p.dp)}) از مبلغ سند (${formatMoney(p.total, p.dp)}) بیشتر است`);
  return out;
}

// ---------------------------------------------------------------- descriptions

function lineText(kind: DocKind, r: Resolved, who: string, byAccount: boolean): string {
  const ref = r.ref_no ? ` (پیگیری ${fa(r.ref_no)})` : "";
  const note = r.description ? ` — ${r.description}` : "";
  const c = r.cheque;
  const from = byAccount ? `بابت ${who}` : `از ${who}`;
  const to = byAccount ? `بابت ${who}` : `به ${who}`;
  let s: string;
  if (kind === "transfer") {
    s = r.direction === "in" ? `واریز انتقال وجه به ${r.post.label}${ref}` : `برداشت انتقال وجه از ${r.post.label}${ref}`;
  } else if (r.direction === "in") {
    switch (r.method) {
      case "cash": s = `دریافت نقد ${from}`; break;
      case "bank": s = `واریز به ${r.post.label} ${from}${ref}`; break;
      case "card": s = `کارت‌به‌کارت به ${r.post.label} ${from}${ref}`; break;
      case "pos": s = `${r.post.label} — ${who}${ref}`; break;
      case "cheque": s = `${chequeLabel(c!)} سررسید ${jdate(c!.due_date)} — ${c!.party.name}`; break;
      default: s = `دریافت ${from}`;
    }
  } else {
    switch (r.method) {
      case "cash": s = `پرداخت نقد ${to}`; break;
      case "bank": s = `حواله از ${r.post.label} ${to}${ref}`; break;
      case "card": s = `کارت‌به‌کارت از ${r.post.label} ${to}${ref}`; break;
      case "cheque": s = `${chequeLabel(c!)} سررسید ${jdate(c!.due_date)} در وجه ${c!.party.name}`; break;
      default: s = `پرداخت ${to}`;
    }
  }
  return `${s}${note}`.slice(0, 500);
}

function headerText(kind: DocKind, no: number, who: string, byAccount: boolean, lines: Resolved[], description: string | null | undefined): string {
  let s = `${KIND_TITLE[kind]} شماره‌ی ${fa(no)}`;
  if (kind === "transfer") {
    const out = lines.find((l) => l.direction === "out");
    const inn = lines.find((l) => l.direction === "in");
    if (out && inn) s += ` از ${out.post.label} به ${inn.post.label}`;
  } else if (who) {
    s += byAccount ? ` بابت ${who}` : kind === "receipt" ? ` از ${who}` : ` به ${who}`;
  }
  const d = clean(description);
  return `${s}${d ? ` — ${d}` : ""}`.slice(0, 1000);
}

// ---------------------------------------------------------------- delete

export async function deleteDoc(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  const org = ctx.org;
  const prev = await loadDoc(tx, org.id, id);
  if (!prev) throw notFound("سند خزانه پیدا نشد");
  await fiscalYearFor(tx, org.id, prev.date);
  const cheques = await docCheques(tx, org.id, id);
  for (const c of cheques) {
    if (chequeMoved(c)) throw conflict(`${chequeLabel(c)} «${chequeStatusTitle(c.direction, c.status)}» است؛ ابتدا عملیات چک را برگردانید`);
  }
  await removeAuto(tx, org.id, "treasury_doc", id);
  if (cheques.length) {
    await tx.query(`update tz_cheques set deleted_at = now(), origin = $3 where org_id = $1 and id = any($2::uuid[])`, [
      org.id,
      `{${cheques.map((c) => c.id).join(",")}}`,
      ctx.cfg.origin,
    ]);
  }
  await tx.query(`delete from tz_treasury_allocs where doc_id = $1`, [id]);
  await tx.query(`update tz_treasury_docs set deleted_at = now(), voucher_id = null, origin = $3 where id = $1 and org_id = $2`, [id, org.id, ctx.cfg.origin]);
  await audit(tx, ctx, "delete", "treasury_doc", id, `${KIND_TITLE[prev.kind]} ${fa(prev.no)}`);
}

// ---------------------------------------------------------------- read

export async function getDoc(q: Queryable, orgId: string, id: string) {
  const doc = await q.one(
    `select d.*, p.name as party_name, p.code as party_code, a.code as account_code, a.name as account_name,
            a.detail_mode as account_detail_mode, a.detail_kinds as account_detail_kinds,
            dt.name as detail_name, v.no as voucher_no, u.full_name as created_by_name, fy.title as fiscal_year_title, fy.status as fiscal_year_status
     from tz_treasury_docs d
     left join tz_parties p on p.id = d.party_id
     left join tz_accounts a on a.id = d.account_id
     left join tz_details dt on dt.id = d.detail_id
     left join tz_vouchers v on v.id = d.voucher_id and v.deleted_at is null
     left join tz_users u on u.id = d.created_by
     left join tz_fiscal_years fy on fy.id = d.fiscal_year_id
     where d.id = $1 and d.org_id = $2 and d.deleted_at is null`,
    [id, orgId],
  );
  if (!doc) throw notFound("سند خزانه پیدا نشد");
  const lines = await q.query(
    `select l.*, cb.name as cash_box_name, ba.name as bank_account_name, pt.name as pos_name,
            a.code as account_code, a.name as account_name, a.detail_mode as account_detail_mode, a.detail_kinds as account_detail_kinds,
            dt.name as detail_name
     from tz_treasury_lines l
     left join tz_cash_boxes cb on cb.id = l.cash_box_id
     left join tz_bank_accounts ba on ba.id = l.bank_account_id
     left join tz_pos_terminals pt on pt.id = l.pos_id
     left join tz_accounts a on a.id = l.account_id
     left join tz_details dt on dt.id = l.detail_id
     where l.doc_id = $1 order by l.line_no`,
    [id],
  );
  const chequeIds = lines.map((l) => l.cheque_id).filter(Boolean) as string[];
  const cheques = chequeIds.length
    ? await q.query(
        `select c.id, c.direction, c.sayad_no, c.serial_no, c.bank_name, c.branch_name, c.account_no, c.account_owner, c.party_id,
                c.amount, c.issue_date, c.due_date, c.status, c.bank_account_id, c.cheque_book_id, c.holder_party_id, c.description,
                jsonb_array_length(c.history) as ops, p.name as party_name, cb.title as cheque_book_title, ba.name as bank_account_name
         from tz_cheques c
         left join tz_parties p on p.id = c.party_id
         left join tz_cheque_books cb on cb.id = c.cheque_book_id
         left join tz_bank_accounts ba on ba.id = c.bank_account_id
         where c.org_id = $1 and c.id = any($2::uuid[])`,
        [orgId, `{${chequeIds.join(",")}}`],
      )
    : [];
  const byId = new Map(cheques.map((c) => [c.id, { ...c, locked: c.status !== INITIAL_STATUS[c.direction as ChequeDirection] || Number(c.ops ?? 0) > 0 }]));
  const allocs = await q.query(
    `select a.id, a.invoice_id, a.amount, i.kind as invoice_kind, i.no as invoice_no, i.date as invoice_date, i.total as invoice_total
     from tz_treasury_allocs a left join tz_invoices i on i.id = a.invoice_id where a.doc_id = $1 order by i.date, i.no`,
    [id],
  );
  return { ...doc, lines: lines.map((l) => ({ ...l, cheque: l.cheque_id ? byId.get(l.cheque_id) ?? null : null })), allocs };
}

export interface ListDocsParams {
  kind?: string;
  from?: string;
  to?: string;
  party_id?: string;
  fiscal_year_id?: string;
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
  dir?: string;
}

const SORTS: Record<string, string> = { no: "d.no", date: "d.date", total: "d.total", party_name: "p.name" };

export async function listDocs(q: Queryable, orgId: string, p: ListDocsParams) {
  const params: unknown[] = [orgId];
  const cond = ["d.org_id = $1", "d.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (p.kind) add("d.kind = ?", p.kind);
  if (p.from) add("d.date >= ?", p.from);
  if (p.to) add("d.date <= ?", p.to);
  if (p.party_id) add("d.party_id = ?", p.party_id);
  if (p.fiscal_year_id) add("d.fiscal_year_id = ?", p.fiscal_year_id);
  const s = normalizeDigits((p.q ?? "").trim());
  if (s) {
    params.push(likeContains(s));
    const like = `$${params.length}`;
    const parts = [
      `d.description ilike ${like}`,
      `p.name ilike ${like}`,
      `exists (select 1 from tz_treasury_lines l where l.doc_id = d.id and (l.ref_no ilike ${like} or l.description ilike ${like}))`,
      `exists (select 1 from tz_cheques c where c.source_type = 'treasury_doc' and c.source_id = d.id and (c.serial_no ilike ${like} or c.sayad_no ilike ${like}))`,
    ];
    if (/^\d{1,9}$/.test(s)) {
      params.push(Number(s));
      parts.push(`d.no = $${params.length}`);
    }
    cond.push(`(${parts.join(" or ")})`);
  }
  const where = cond.join(" and ");
  const size = Math.min(500, Math.max(1, Number(p.size) || 50));
  const page = Math.max(1, Number(p.page) || 1);
  const sort = SORTS[p.sort ?? ""] ?? null;
  const order = sort ? `${sort} ${p.dir === "asc" ? "asc" : "desc"}, d.no desc` : "d.date desc, d.no desc";
  const head = await q.one<{ n: number; sum: string }>(
    `select count(*)::int as n, coalesce(sum(d.total), 0) as sum from tz_treasury_docs d left join tz_parties p on p.id = d.party_id where ${where}`,
    params,
  );
  const rows = await q.query(
    `select d.id, d.kind, d.no, d.date, d.party_id, d.account_id, d.description, d.total, d.voucher_id, d.created_at,
            p.name as party_name, a.name as account_name, v.no as voucher_no, u.full_name as created_by_name,
            (select coalesce(jsonb_agg(distinct l.method), '[]'::jsonb) from tz_treasury_lines l where l.doc_id = d.id) as methods,
            (select coalesce(sum(l.fee), 0) from tz_treasury_lines l where l.doc_id = d.id) as fees,
            (select count(*)::int from tz_treasury_lines l where l.doc_id = d.id and l.cheque_id is not null) as cheque_count,
            (select coalesce(cb.name, ba.name) from tz_treasury_lines l left join tz_cash_boxes cb on cb.id = l.cash_box_id
               left join tz_bank_accounts ba on ba.id = l.bank_account_id where l.doc_id = d.id and l.direction = 'out' order by l.line_no limit 1) as from_name,
            (select coalesce(cb.name, ba.name) from tz_treasury_lines l left join tz_cash_boxes cb on cb.id = l.cash_box_id
               left join tz_bank_accounts ba on ba.id = l.bank_account_id where l.doc_id = d.id and l.direction = 'in' order by l.line_no limit 1) as to_name
     from tz_treasury_docs d
     left join tz_parties p on p.id = d.party_id
     left join tz_accounts a on a.id = d.account_id
     left join tz_vouchers v on v.id = d.voucher_id and v.deleted_at is null
     left join tz_users u on u.id = d.created_by
     where ${where}
     order by ${order}
     limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { rows, total: head?.n ?? 0, sum: head?.sum ?? "0", page, size };
}

// ---------------------------------------------------------------- allocations (read side)

/** Allocations of non-deleted treasury documents to the given invoices. */
export async function allocations(q: Queryable, orgId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return { rows: [], totals: {} as Record<string, string> };
  const rows = await q.query<{ invoice_id: string; amount: string } & Record<string, unknown>>(
    `select a.id, a.invoice_id, a.amount, a.doc_id, d.kind, d.no, d.date, d.party_id, p.name as party_name
     from tz_treasury_allocs a
     join tz_treasury_docs d on d.id = a.doc_id and d.deleted_at is null
     left join tz_parties p on p.id = d.party_id
     where a.org_id = $1 and a.invoice_id = any($2::uuid[])
     order by d.date, d.no`,
    [orgId, `{${invoiceIds.join(",")}}`],
  );
  const totals: Record<string, string> = {};
  for (const r of rows) totals[r.invoice_id] = D(totals[r.invoice_id] ?? 0).plus(D(r.amount)).toString();
  return { rows, totals };
}

/** The party's invoices a receipt/payment can be allocated to, with what is left of each. */
export async function openInvoices(q: Queryable, orgId: string, p: { partyId: string; kind: DocKind; docId?: string | null }) {
  const kinds = p.kind === "receipt" ? RECEIPT_INVOICES : p.kind === "payment" ? PAYMENT_INVOICES : [];
  if (!kinds.length) return [];
  const rows = await q.query<{ id: string; total: string; allocated: string; this_doc: string }>(
    `select i.id, i.kind, i.no, i.date, i.due_date, i.total, i.status,
            coalesce((select sum(a.amount) from tz_treasury_allocs a join tz_treasury_docs d on d.id = a.doc_id
                      where a.invoice_id = i.id and d.deleted_at is null and a.doc_id is distinct from $4::uuid), 0) as allocated,
            coalesce((select sum(a.amount) from tz_treasury_allocs a where a.invoice_id = i.id and a.doc_id = $4::uuid), 0) as this_doc
     from tz_invoices i
     where i.org_id = $1 and i.party_id = $2 and i.kind = any($3::text[]) and i.deleted_at is null and i.status not in ('draft','void','cancelled')
     order by i.date, i.no
     limit 300`,
    [orgId, p.partyId, `{${kinds.join(",")}}`, p.docId ?? null],
  );
  return rows
    .map((r) => ({ ...r, remaining: D(r.total).minus(D(r.allocated)).toString() }))
    .filter((r) => D(r.remaining).gt(0) || D(r.this_doc).gt(0));
}
