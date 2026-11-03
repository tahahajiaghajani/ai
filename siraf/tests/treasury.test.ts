import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, signupWithOrg, accountId } from "./helpers";
import type { Db } from "@server/db";
import { addDays, todayISO } from "@shared/jalali";
import { D } from "@shared/money";
import { uuidv7 } from "@shared/id";
import { lineFromDoc, linePayload } from "@ui/modules/treasury/editor";

interface VLine {
  account_id: string;
  detail_id: string | null;
  debit: string;
  credit: string;
}

describe("treasury: receipts, payments, transfers, cheques and reports", () => {
  let c: Client;
  let db: Db;
  let org: string;
  const o = (p: string) => `/o/${org}${p}`;
  const acc: Record<string, string> = {};
  let box: { id: string; detail_id: string };
  let bank: { id: string; detail_id: string };
  let bank2: { id: string; detail_id: string };
  let pos: { id: string };
  let book: { id: string };
  let customer: { id: string; detail_id: string };
  let customer2: { id: string; detail_id: string };
  let supplier: { id: string; detail_id: string };
  let receipt1: { id: string; voucher_id: string };
  let payment1: { id: string; voucher_id: string };

  const voucher = async (id: string) => (await c.get(o(`/accounting/vouchers/${id}`))).voucher as { total_debit: string; total_credit: string; lines: VLine[]; source_type: string };
  /** Signed sum (debit − credit) of a voucher's lines on an account (and detail). */
  const net = (lines: VLine[], account: string, detail?: string | null) =>
    lines
      .filter((l) => l.account_id === account && (detail === undefined || l.detail_id === detail))
      .reduce((a, l) => a.plus(D(l.debit)).minus(D(l.credit)), D(0))
      .toString();
  /** Ledger balance (debit − credit) of an account, optionally of one detail. */
  const balance = async (account: string, detail?: string) => {
    const r = await c.get(o(`/accounting/reports/ledger?account_id=${account}${detail ? `&detail_id=${detail}` : ""}`));
    return r.totals.balance as string;
  };
  const chequesOf = async (docId: string) => (await c.get(o(`/treasury/docs/${docId}`))).doc.lines.filter((l: any) => l.cheque).map((l: any) => l.cheque);

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    for (const k of ["cash", "bank", "ar", "ap", "cheques_receivable", "cheques_in_collection", "cheques_bounced", "cheques_payable", "bank_fees", "opening_balance"]) {
      acc[k] = await accountId(db, org, k);
    }
    const rent = await db.one<{ id: string }>(`select id from tz_accounts where org_id = $1 and code = '7202'`, [org]);
    acc.rent = rent!.id;
    box = (await db.one<{ id: string; detail_id: string }>(`select id, detail_id from tz_cash_boxes where org_id = $1`, [org]))!;
    bank = (await c.post(o("/data/bank_account"), { name: "ملت جاری مرکزی", bank_name: "ملت", account_no: "1234567" })).row;
    bank2 = (await c.post(o("/data/bank_account"), { name: "صادرات جاری", bank_name: "صادرات" })).row;
    pos = (await c.post(o("/data/pos_terminal"), { name: "کارتخوان سامان", bank_account_id: bank.id })).row;
    book = (await c.post(o("/data/cheque_book"), { bank_account_id: bank.id, title: "دسته‌چک ملت ۱", serial_from: "100001", serial_to: "100050", sheets: 50 })).row;
    customer = (await c.post(o("/data/party"), { name: "علی رضایی", roles: ["customer"] })).row;
    customer2 = (await c.post(o("/data/party"), { name: "مریم احمدی", roles: ["customer"] })).row;
    supplier = (await c.post(o("/data/party"), { name: "شرکت پخش البرز", roles: ["supplier"] })).row;
  });

  it("posts a receipt with cash, POS (with bank fee) and a received cheque", async () => {
    const r = await c.post(o("/treasury/docs"), {
      kind: "receipt",
      date: "2026-04-10",
      party_id: customer.id,
      description: "تسویه‌ی فاکتور",
      lines: [
        { method: "cash", cash_box_id: box.id, amount: "10000000" },
        { method: "pos", pos_id: pos.id, amount: "5000000", fee: "50000", ref_no: "778899" },
        {
          method: "cheque",
          amount: "20000000",
          cheque: { serial_no: "445566", sayad_no: "۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶", bank_name: "تجارت", branch_name: "مرکزی", due_date: "2026-05-15", account_owner: "علی رضایی" },
        },
      ],
    });
    expect(r.doc.no).toBe(1);
    expect(r.doc.total).toBe("35000000");
    receipt1 = r.doc;
    const v = await voucher(r.doc.voucher_id);
    expect(v.source_type).toBe("treasury_doc");
    expect(v.total_debit).toBe("35000000");
    expect(v.total_credit).toBe("35000000");
    expect(net(v.lines, acc.cash, box.detail_id)).toBe("10000000");
    expect(net(v.lines, acc.bank, bank.detail_id)).toBe("4950000");
    expect(net(v.lines, acc.bank_fees, bank.detail_id)).toBe("50000");
    expect(net(v.lines, acc.cheques_receivable, customer.detail_id)).toBe("20000000");
    expect(net(v.lines, acc.ar, customer.detail_id)).toBe("-35000000");

    const list = await c.get(o("/treasury/cheques?direction=received"));
    expect(list.total).toBe(1);
    const ch = list.rows[0];
    expect(ch.status).toBe("in_hand");
    expect(ch.amount).toBe("20000000");
    expect(ch.sayad_no).toBe("1234567890123456");
    expect(ch.party_id).toBe(customer.id);
    expect(ch.doc_no).toBe(1);
    expect(ch.actions).toEqual(expect.arrayContaining(["deposit", "cash", "endorse", "bounce", "return"]));

    const doc = (await c.get(o(`/treasury/docs/${r.doc.id}`))).doc;
    expect(doc.lines).toHaveLength(3);
    expect(doc.lines[1].bank_account_id).toBe(bank.id);
    expect(doc.lines[2].cheque.status).toBe("in_hand");
    expect(doc.lines[2].cheque.locked).toBe(false);
    expect(doc.voucher_no).toBeGreaterThan(0);

    // the same Sayad number cannot be registered twice
    const dup = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-04-11", party_id: customer2.id,
      lines: [{ method: "cheque", amount: "1000", cheque: { sayad_no: "1234567890123456", due_date: "2026-05-01" } }],
    }, 409);
    expect(dup.error.message).toContain("صیادی");
  });

  it("validates receipts: party or counter account, cheque fields, fees", async () => {
    const noParty = await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-04-10", lines: [{ method: "cash", cash_box_id: box.id, amount: "1000" }] }, 400);
    expect(noParty.error.message).toContain("شخص");
    const noDue = await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-04-10", party_id: customer.id, lines: [{ method: "cheque", amount: "1000", cheque: { serial_no: "1" } }] }, 400);
    expect(noDue.error.message).toContain("سررسید");
    const cashFee = await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-04-10", party_id: customer.id, lines: [{ method: "cash", cash_box_id: box.id, amount: "1000", fee: "10" }] }, 400);
    expect(cashFee.error.message).toContain("کارمزد");
    const posInPayment = await c.post(o("/treasury/docs"), { kind: "payment", date: "2026-04-10", party_id: supplier.id, lines: [{ method: "pos", pos_id: pos.id, amount: "1000" }] }, 400);
    expect(posInPayment.error.message).toContain("کارتخوان");
    const badSayad = await c.post(o("/treasury/docs"), { kind: "receipt", date: "2026-04-10", party_id: customer.id, lines: [{ method: "cheque", amount: "1000", cheque: { sayad_no: "123", due_date: "2026-05-01" } }] }, 400);
    expect(badSayad.error.message).toContain("۱۶");
  });

  it("posts a payment with a cheque issued from a cheque book and a bank transfer with fee", async () => {
    const next = await c.get(o(`/treasury/cheque-books/${book.id}/next-serial`));
    expect(next.serial).toBe("100001");
    const r = await c.post(o("/treasury/docs"), {
      kind: "payment",
      date: "2026-04-12",
      party_id: supplier.id,
      lines: [
        { method: "cheque", amount: "8000000", cheque: { cheque_book_id: book.id, serial_no: next.serial, sayad_no: "9876543210987654", due_date: "2026-06-01" } },
        { method: "bank", bank_account_id: bank.id, amount: "2000000", fee: "10000", ref_no: "TR-1" },
      ],
    });
    payment1 = r.doc;
    expect(r.doc.no).toBe(1);
    const v = await voucher(r.doc.voucher_id);
    expect(v.total_debit).toBe("10010000");
    expect(v.total_credit).toBe("10010000");
    expect(net(v.lines, acc.ap, supplier.detail_id)).toBe("10000000");
    expect(net(v.lines, acc.bank_fees, bank.detail_id)).toBe("10000");
    expect(net(v.lines, acc.cheques_payable, supplier.detail_id)).toBe("-8000000");
    expect(net(v.lines, acc.bank, bank.detail_id)).toBe("-2010000");

    const [ch] = await chequesOf(r.doc.id);
    expect(ch.direction).toBe("issued");
    expect(ch.status).toBe("issued");
    expect(ch.bank_account_id).toBe(bank.id);
    expect(ch.cheque_book_id).toBe(book.id);
    expect(ch.bank_name).toBe("ملت");
    expect((await c.get(o(`/treasury/cheque-books/${book.id}/next-serial`))).serial).toBe("100002");

    // a leaf of a cheque book is issued once, and must be in the book's range
    const dup = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-04-12", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "1000", cheque: { cheque_book_id: book.id, serial_no: "100001", due_date: "2026-06-01" } }],
    }, 409);
    expect(dup.error.message).toContain("سریال");
    const range = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-04-12", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "1000", cheque: { cheque_book_id: book.id, serial_no: "200000", due_date: "2026-06-01" } }],
    }, 400);
    expect(range.error.message).toContain("محدوده");
  });

  it("posts a payment to a counter account (rent expense) without a party", async () => {
    const r = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-04-14", account_id: acc.rent, description: "اجاره‌ی فروردین",
      lines: [{ method: "cash", cash_box_id: box.id, amount: "1500000" }],
    });
    const v = await voucher(r.doc.voucher_id);
    expect(net(v.lines, acc.rent)).toBe("1500000");
    expect(net(v.lines, acc.cash, box.detail_id)).toBe("-1500000");
    // cash/bank as the counter account is a transfer, not a payment
    await c.post(o("/treasury/docs"), { kind: "payment", date: "2026-04-14", account_id: acc.bank, lines: [{ method: "cash", cash_box_id: box.id, amount: "1" }] }, 400);
  });

  it("posts a transfer between a bank and a cash box with a bank fee", async () => {
    const r = await c.post(o("/treasury/docs"), {
      kind: "transfer",
      date: "2026-04-13",
      description: "برداشت برای صندوق",
      lines: [
        { direction: "out", method: "bank", bank_account_id: bank.id, amount: "3000000", fee: "5000", ref_no: "W-1" },
        { direction: "in", method: "cash", cash_box_id: box.id, amount: "3000000" },
      ],
    });
    expect(r.doc.no).toBe(1);
    expect(r.doc.total).toBe("3000000");
    const v = await voucher(r.doc.voucher_id);
    expect(v.total_debit).toBe("3005000");
    expect(net(v.lines, acc.cash, box.detail_id)).toBe("3000000");
    expect(net(v.lines, acc.bank_fees, bank.detail_id)).toBe("5000");
    expect(net(v.lines, acc.bank, bank.detail_id)).toBe("-3005000");

    const mismatch = await c.post(o("/treasury/docs"), {
      kind: "transfer", date: "2026-04-13",
      lines: [{ direction: "out", method: "bank", bank_account_id: bank.id, amount: "100" }, { direction: "in", method: "cash", cash_box_id: box.id, amount: "90" }],
    }, 400);
    expect(mismatch.error.message).toContain("برابر");
    const same = await c.post(o("/treasury/docs"), {
      kind: "transfer", date: "2026-04-13",
      lines: [{ direction: "out", method: "bank", bank_account_id: bank.id, amount: "100" }, { direction: "in", method: "bank", bank_account_id: bank.id, amount: "100" }],
    }, 400);
    expect(same.error.message).toContain("یکی");
  });

  it("runs a received cheque through deposit and clearance", async () => {
    const [ch] = await chequesOf(receipt1.id);
    const early = await c.post(o(`/treasury/cheques/${ch.id}/action`), { action: "deposit", date: "2026-04-01", bank_account_id: bank2.id }, 400);
    expect(early.error.message).toContain("پیش از");
    const dep = await c.post(o(`/treasury/cheques/${ch.id}/action`), { action: "deposit", date: "2026-05-16", bank_account_id: bank2.id, note: "واگذاری" });
    expect(dep.status).toBe("deposited");
    const v1 = await voucher(dep.op.voucher_id);
    expect(v1.source_type).toBe("cheque_op");
    expect(net(v1.lines, acc.cheques_in_collection, bank2.detail_id)).toBe("20000000");
    expect(net(v1.lines, acc.cheques_receivable, customer.detail_id)).toBe("-20000000");
    // the voucher screen finds the cheque from its operation
    expect((await c.get(o(`/treasury/cheques/by-op/${dep.op.id}`))).cheque.id).toBe(ch.id);

    await c.post(o(`/treasury/cheques/${ch.id}/action`), { action: "endorse", date: "2026-05-17", party_id: supplier.id }, 400);
    const clr = await c.post(o(`/treasury/cheques/${ch.id}/action`), { action: "clear", date: "2026-05-18" });
    expect(clr.status).toBe("cleared");
    const v2 = await voucher(clr.op.voucher_id);
    expect(net(v2.lines, acc.bank, bank2.detail_id)).toBe("20000000");
    expect(net(v2.lines, acc.cheques_in_collection, bank2.detail_id)).toBe("-20000000");

    expect(await balance(acc.cheques_receivable, customer.detail_id)).toBe("0");
    expect(await balance(acc.cheques_in_collection)).toBe("0");
    expect(await balance(acc.bank, bank2.detail_id)).toBe("20000000");

    const full = (await c.get(o(`/treasury/cheques/${ch.id}`))).cheque;
    expect(full.history).toHaveLength(2);
    expect(full.history[0].action).toBe("deposit");
    expect(full.history[0].bank_account_name).toBe("صادرات جاری");
    expect(full.history[1].voucher_no).toBeGreaterThan(0);
    expect(full.actions).toEqual(["undo"]);
  });

  it("bounces, returns, endorses and undoes received cheques", async () => {
    const r = await c.post(o("/treasury/docs"), {
      kind: "receipt",
      date: "2026-04-20",
      party_id: customer2.id,
      lines: [
        { method: "cheque", amount: "4000000", cheque: { serial_no: "700001", bank_name: "ملی", due_date: "2026-05-20" } },
        { method: "cheque", amount: "6000000", cheque: { serial_no: "700002", bank_name: "ملی", due_date: "2026-06-20" } },
        { method: "cheque", amount: "1000000", cheque: { serial_no: "700003", bank_name: "ملی", due_date: "2026-07-20" } },
      ],
    });
    const [a, b, d] = await chequesOf(r.doc.id);

    // A: bounces in hand, then goes back to its drawer
    const bounce = await c.post(o(`/treasury/cheques/${a.id}/action`), { action: "bounce", date: "2026-05-21" });
    const vb = await voucher(bounce.op.voucher_id);
    expect(net(vb.lines, acc.cheques_bounced, customer2.detail_id)).toBe("4000000");
    expect(net(vb.lines, acc.cheques_receivable, customer2.detail_id)).toBe("-4000000");
    const ret = await c.post(o(`/treasury/cheques/${a.id}/action`), { action: "return", date: "2026-05-22" });
    expect(ret.status).toBe("returned");
    const vr = await voucher(ret.op.voucher_id);
    expect(net(vr.lines, acc.ar, customer2.detail_id)).toBe("4000000");
    expect(net(vr.lines, acc.cheques_bounced, customer2.detail_id)).toBe("-4000000");

    // B: spent on a supplier (خرج چک), then the endorsement is undone
    const end = await c.post(o(`/treasury/cheques/${b.id}/action`), { action: "endorse", date: "2026-05-01", party_id: supplier.id });
    expect(end.status).toBe("endorsed");
    const ve = await voucher(end.op.voucher_id);
    expect(net(ve.lines, acc.ap, supplier.detail_id)).toBe("6000000");
    expect(net(ve.lines, acc.cheques_receivable, customer2.detail_id)).toBe("-6000000");
    expect((await c.get(o(`/treasury/cheques/${b.id}`))).cheque.holder_party_id).toBe(supplier.id);
    const undo = await c.post(o(`/treasury/cheques/${b.id}/action`), { action: "undo" });
    expect(undo.status).toBe("in_hand");
    await c.get(o(`/accounting/vouchers/${end.op.voucher_id}`), 404);
    const back = (await c.get(o(`/treasury/cheques/${b.id}`))).cheque;
    expect(back.status).toBe("in_hand");
    expect(back.holder_party_id).toBeNull();
    expect(back.history).toHaveLength(0);
    await c.post(o(`/treasury/cheques/${b.id}/action`), { action: "undo" }, 400);

    // D: deposited, bounced to the customer's receivable, deposited again and cleared
    await c.post(o(`/treasury/cheques/${d.id}/action`), { action: "deposit", date: "2026-07-20", bank_account_id: bank.id });
    const b2 = await c.post(o(`/treasury/cheques/${d.id}/action`), { action: "bounce", date: "2026-07-22", to_account: "ar" });
    const vb2 = await voucher(b2.op.voucher_id);
    expect(net(vb2.lines, acc.ar, customer2.detail_id)).toBe("1000000");
    expect(net(vb2.lines, acc.cheques_in_collection, bank.detail_id)).toBe("-1000000");
    const again = await c.post(o(`/treasury/cheques/${d.id}/action`), { action: "deposit", date: "2026-07-25", bank_account_id: bank.id });
    const va = await voucher(again.op.voucher_id);
    expect(net(va.lines, acc.cheques_in_collection, bank.detail_id)).toBe("1000000");
    expect(net(va.lines, acc.ar, customer2.detail_id)).toBe("-1000000");
    await c.post(o(`/treasury/cheques/${d.id}/action`), { action: "clear", date: "2026-07-27" });

    // customer2 paid 11M in cheques: A came back (4M owed again), B is still in hand, D cleared
    expect(await balance(acc.ar, customer2.detail_id)).toBe("-7000000");
    expect(await balance(acc.cheques_receivable, customer2.detail_id)).toBe("6000000");
    expect(await balance(acc.cheques_bounced, customer2.detail_id)).toBe("0");
    const rows = (await c.get(o(`/accounting/reports/detail-balances?account_id=${acc.ar}`))).rows as { detail_id: string; balance: string }[];
    expect(rows.find((x) => x.detail_id === customer2.detail_id)?.balance).toBe("-7000000");
  });

  it("clears and bounces issued cheques", async () => {
    const [ch] = await chequesOf(payment1.id);
    const clr = await c.post(o(`/treasury/cheques/${ch.id}/action`), { action: "clear", date: "2026-06-01" });
    expect(clr.status).toBe("cleared");
    const v = await voucher(clr.op.voucher_id);
    expect(net(v.lines, acc.cheques_payable, supplier.detail_id)).toBe("8000000");
    expect(net(v.lines, acc.bank, bank.detail_id)).toBe("-8000000");
    await c.post(o(`/treasury/cheques/${ch.id}/action`), { action: "deposit", date: "2026-06-02", bank_account_id: bank.id }, 400);

    const p = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-04-15", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "3000000", cheque: { cheque_book_id: book.id, serial_no: "100002", due_date: "2026-08-01" } }],
    });
    const [ch2] = await chequesOf(p.doc.id);
    const bn = await c.post(o(`/treasury/cheques/${ch2.id}/action`), { action: "bounce", date: "2026-08-02" });
    expect(bn.status).toBe("bounced");
    const vb = await voucher(bn.op.voucher_id);
    expect(net(vb.lines, acc.cheques_payable, supplier.detail_id)).toBe("3000000");
    expect(net(vb.lines, acc.ap, supplier.detail_id)).toBe("-3000000");
    expect(await balance(acc.cheques_payable, supplier.detail_id)).toBe("0");
  });

  it("edits documents while their cheques are untouched and protects cheques that moved on", async () => {
    // receipt1's cheque is cleared: other lines may change, the cheque's amount may not
    const doc = (await c.get(o(`/treasury/docs/${receipt1.id}`))).doc;
    const lines = doc.lines.map((l: any) => ({
      id: l.id, method: l.method, cash_box_id: l.cash_box_id, pos_id: l.pos_id, bank_account_id: l.bank_account_id,
      amount: l.amount, fee: l.fee, ref_no: l.ref_no, cheque_id: l.cheque_id, cheque: l.cheque,
    }));
    lines[0].amount = "12000000";
    const ok = await c.put(o(`/treasury/docs/${receipt1.id}`), { kind: "receipt", date: doc.date, party_id: customer.id, lines });
    expect(ok.doc.total).toBe("37000000");
    expect(ok.doc.no).toBe(1);
    const v = await voucher(ok.doc.voucher_id);
    expect(v.total_debit).toBe("37000000");
    expect(net(v.lines, acc.ar, customer.detail_id)).toBe("-37000000");
    const changed = structuredClone(lines);
    changed[2].amount = "21000000";
    const refused = await c.put(o(`/treasury/docs/${receipt1.id}`), { kind: "receipt", date: doc.date, party_id: customer.id, lines: changed }, 409);
    expect(refused.error.message).toContain("وصول‌شده");
    await c.put(o(`/treasury/docs/${receipt1.id}`), { kind: "receipt", date: doc.date, party_id: customer.id, lines: lines.slice(0, 2) }, 409);
    // its deposit is dated 2026-05-16: the receipt cannot move after that
    const late = await c.put(o(`/treasury/docs/${receipt1.id}`), { kind: "receipt", date: "2026-05-20", party_id: customer.id, lines }, 400);
    expect(late.error.message).toContain("نخستین عملیات");
    await c.del(o(`/treasury/docs/${receipt1.id}`), 409);

    // an untouched cheque is replaced in place and goes away with its document
    const r = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-04-25", party_id: customer.id,
      lines: [{ method: "cheque", amount: "500000", cheque: { serial_no: "880001", due_date: "2026-09-01" } }],
    });
    const [ch] = await chequesOf(r.doc.id);
    const upd = await c.put(o(`/treasury/docs/${r.doc.id}`), {
      kind: "receipt", date: "2026-04-25", party_id: customer.id,
      lines: [{ method: "cheque", amount: "700000", cheque_id: ch.id, cheque: { serial_no: "880001", due_date: "2026-09-05" } }],
    });
    expect(upd.doc.voucher_id).toBe(r.doc.voucher_id);
    const [ch2] = await chequesOf(r.doc.id);
    expect(ch2.id).toBe(ch.id);
    expect(ch2.amount).toBe("700000");
    expect(ch2.due_date).toBe("2026-09-05");
    expect(net((await voucher(upd.doc.voucher_id)).lines, acc.cheques_receivable, customer.detail_id)).toBe("700000");
    await c.del(o(`/treasury/docs/${r.doc.id}`));
    await c.get(o(`/treasury/docs/${r.doc.id}`), 404);
    await c.get(o(`/treasury/cheques/${ch.id}`), 404);
    await c.get(o(`/accounting/vouchers/${r.doc.voucher_id}`), 404);
    await c.put(o(`/treasury/docs/${r.doc.id}`), { kind: "receipt", date: "2026-04-25", party_id: customer.id, lines: [{ method: "cash", cash_box_id: box.id, amount: "1" }] }, 404);
  });

  it("registers opening cheques through a receipt from the opening balance account", async () => {
    const missing = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-03-21", account_id: acc.opening_balance,
      lines: [{ method: "cheque", amount: "1000", cheque: { serial_no: "1", due_date: "2026-04-01" } }],
    }, 400);
    expect(missing.error.message).toContain("صاحب چک");
    const r = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-03-21", account_id: acc.opening_balance, description: "چک‌های افتتاحیه",
      lines: [
        { method: "cheque", amount: "2500000", cheque: { serial_no: "900001", due_date: "2026-04-30", party_id: customer.id } },
        { method: "cheque", amount: "1500000", cheque: { serial_no: "900002", due_date: "2026-05-30", party_id: customer2.id } },
      ],
    });
    const v = await voucher(r.doc.voucher_id);
    expect(net(v.lines, acc.cheques_receivable, customer.detail_id)).toBe("2500000");
    expect(net(v.lines, acc.cheques_receivable, customer2.detail_id)).toBe("1500000");
    expect(net(v.lines, acc.opening_balance)).toBe("-4000000");
    const cheques = await chequesOf(r.doc.id);
    expect(cheques.map((x: any) => x.party_id)).toEqual([customer.id, customer2.id]);
  });

  it("allocates a receipt to invoices and exposes the allocations", async () => {
    const fy = await db.one<{ id: string }>(`select id from tz_fiscal_years where org_id = $1`, [org]);
    const inv = uuidv7();
    await db.query(
      `insert into tz_invoices (id, org_id, fiscal_year_id, kind, no, date, party_id, status, total) values ($1, $2, $3, 'sale', 501, '2026-04-01', $4, 'posted', 3000000)`,
      [inv, org, fy!.id, customer.id],
    );
    const open = await c.get(o(`/treasury/invoices?party_id=${customer.id}&kind=receipt`));
    expect(open.rows.map((x: any) => x.id)).toContain(inv);
    const r = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-04-26", party_id: customer.id,
      lines: [{ method: "cash", cash_box_id: box.id, amount: "2000000" }],
      allocs: [{ invoice_id: inv, amount: "2000000" }],
    });
    const al = await c.get(o(`/treasury/allocations?invoice_id=${inv}`));
    expect(al.rows).toHaveLength(1);
    expect(al.totals[inv]).toBe("2000000");
    expect(al.rows[0].doc_id).toBe(r.doc.id);
    // more than what is left of the invoice is refused
    const over = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-04-26", party_id: customer.id,
      lines: [{ method: "cash", cash_box_id: box.id, amount: "2000000" }],
      allocs: [{ invoice_id: inv, amount: "1500000" }],
    }, 400);
    expect(over.error.message).toContain("مانده");
    await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-04-26", party_id: customer.id,
      lines: [{ method: "cash", cash_box_id: box.id, amount: "100" }],
      allocs: [{ invoice_id: inv, amount: "100" }],
    }, 400);
    const rest = (await c.get(o(`/treasury/invoices?party_id=${customer.id}&kind=receipt`))).rows.find((x: any) => x.id === inv);
    expect(rest.remaining).toBe("1000000");
  });

  it("reports the cash book, the bank book, balances, cheques due and the summary", async () => {
    const book = await c.get(o(`/treasury/book?cash_box_id=${box.id}&from=2026-04-01&to=2026-12-31`));
    expect(book.opening).toBe("0");
    // receipt 12M (edited) − rent 1.5M + transfer 3M + receipt with allocation 2M
    expect(book.totals.balance).toBe("15500000");
    const last = book.rows[book.rows.length - 1];
    expect(last.balance).toBe(book.totals.balance);
    expect(book.rows[0].doc.kind).toBe("receipt");
    // before the 14th: receipt 12M and the transfer 3M
    const later = await c.get(o(`/treasury/book?cash_box_id=${box.id}&from=2026-04-14`));
    expect(later.opening).toBe("15000000");
    expect(later.rows[0].balance).toBe("13500000");

    const bankBook = await c.get(o(`/treasury/book?bank_account_id=${bank.id}`));
    // POS 4.95M − transfer out 2.01M − withdrawal 3.005M − issued cheque 8M + cheque D 1M
    expect(bankBook.totals.balance).toBe("-7065000");
    expect(bankBook.rows.some((x: any) => x.cheque?.action === "clear")).toBe(true);

    const bal = await c.get(o("/treasury/balances"));
    expect(bal.boxes.find((x: any) => x.id === box.id).balance).toBe("15500000");
    expect(bal.banks.find((x: any) => x.id === bank2.id).balance).toBe("20000000");
    expect(bal.cash_total).toBe("15500000");
    expect(bal.bank_total).toBe("12935000");

    // a cheque due in a few days shows up in the dashboard summary and the due report
    const today = todayISO();
    await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-04-27", party_id: customer.id,
      lines: [{ method: "cheque", amount: "900000", cheque: { serial_no: "990001", due_date: addDays(today, 3) } }],
    });
    const s = await c.get(o("/treasury/summary"));
    expect(s.cash_total).toBe("15500000");
    expect(s.cheques.received_week.count).toBeGreaterThanOrEqual(1);
    expect(D(s.cheques.received_week.sum).gte(900000)).toBe(true);
    expect(s.upcoming.some((x: any) => x.serial_no === "990001")).toBe(true);
    const due = await c.get(o("/treasury/reports/cheques-due?direction=received"));
    expect(due.buckets.find((x: any) => x.key === "week").received.count).toBeGreaterThanOrEqual(1);
    expect(due.rows.every((x: any) => ["in_hand", "deposited"].includes(x.status))).toBe(true);

    const filtered = await c.get(o(`/treasury/cheques?direction=received&status=in_hand&party_id=${customer2.id}`));
    // B (still in hand) and the opening cheque, by due date
    expect(filtered.rows.map((x: any) => x.serial_no)).toEqual(["900002", "700002"]);
    expect(filtered.by_status.find((x: any) => x.status === "cleared").count).toBe(1);

    const pb = await c.get(o(`/treasury/party-balance/${customer2.id}`));
    expect(pb.balance).toBe("-7000000");
    expect(pb.cheques.received_open.sum).toBe("7500000");

    const docs = await c.get(o("/treasury/docs?kind=receipt&q=445566"));
    expect(docs.rows.map((x: any) => x.id)).toEqual([receipt1.id]);
    const tb = await c.get(o("/accounting/reports/trial-balance?level=1"));
    expect(tb.totals.debit).toBe(tb.totals.credit);
  });
});

describe("treasury: editing cheques of a document, reports past their row limits", () => {
  let c: Client;
  let db: Db;
  let org: string;
  const o = (p: string) => `/o/${org}${p}`;
  let customer: { id: string; detail_id: string };
  let supplier: { id: string; detail_id: string };
  let mellat: { id: string; detail_id: string };
  let saderat: { id: string; detail_id: string };
  let bookM: { id: string };
  let bookS: { id: string };
  const chequesOf = async (docId: string) => (await c.get(o(`/treasury/docs/${docId}`))).doc.lines.filter((l: any) => l.cheque).map((l: any) => l.cheque);

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    c = new Client(s.app);
    org = await signupWithOrg(c);
    customer = (await c.post(o("/data/party"), { name: "علی رضایی", roles: ["customer"] })).row;
    supplier = (await c.post(o("/data/party"), { name: "شرکت پخش البرز", roles: ["supplier"] })).row;
    mellat = (await c.post(o("/data/bank_account"), { name: "ملت جاری", bank_name: "ملت", branch_name: "مرکزی", account_no: "1111111", owner_name: "شرکت آزمایشی" })).row;
    saderat = (await c.post(o("/data/bank_account"), { name: "صادرات جاری", bank_name: "صادرات", account_no: "2222222" })).row;
    bookM = (await c.post(o("/data/cheque_book"), { bank_account_id: mellat.id, title: "دسته‌چک ملت", serial_from: "300001", serial_to: "300025" })).row;
    bookS = (await c.post(o("/data/cheque_book"), { bank_account_id: saderat.id, title: "دسته‌چک صادرات", serial_from: "400001", serial_to: "400025" })).row;
  });

  it("takes an issued cheque's bank, branch, account number and owner from its cheque book's account", async () => {
    const p = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-05-01", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "5000000", cheque: { cheque_book_id: bookM.id, serial_no: "300001", due_date: "2026-07-01" } }],
    });
    const [before] = await chequesOf(p.doc.id);
    expect(before).toMatchObject({ bank_account_id: mellat.id, bank_name: "ملت", branch_name: "مرکزی", account_no: "1111111", account_owner: "شرکت آزمایشی" });

    // the editor loads the cheque with Mellat's details, then the other bank's cheque book is picked
    const doc = (await c.get(o(`/treasury/docs/${p.doc.id}`))).doc;
    const line = lineFromDoc(doc.lines[0]);
    line.cheque = { ...line.cheque, cheque_book_id: bookS.id, bank_account_id: saderat.id, serial_no: "400001" };
    const payload = linePayload(line);
    expect(payload.cheque).toMatchObject({ bank_name: null, branch_name: null, account_no: null, account_owner: null });
    await c.put(o(`/treasury/docs/${p.doc.id}`), { kind: "payment", date: "2026-05-01", party_id: supplier.id, lines: [payload] });
    const [after] = await chequesOf(p.doc.id);
    expect(after.id).toBe(before.id);
    const fromSaderat = { cheque_book_id: bookS.id, bank_account_id: saderat.id, bank_name: "صادرات", branch_name: null, account_no: "2222222", account_owner: "فروشگاه آزمایشی" };
    expect(after).toMatchObject(fromSaderat);

    // whatever a client sends, the details of an issued cheque are those of the account it is drawn on
    const stale = { ...payload, cheque: { ...payload.cheque, bank_name: "ملت", branch_name: "مرکزی", account_no: "1111111", account_owner: "شرکت آزمایشی" } };
    await c.put(o(`/treasury/docs/${p.doc.id}`), { kind: "payment", date: "2026-05-01", party_id: supplier.id, lines: [stale] });
    expect((await chequesOf(p.doc.id))[0]).toMatchObject(fromSaderat);
    const fresh = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-05-01", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "1000000", cheque: { cheque_book_id: bookS.id, serial_no: "400002", due_date: "2026-07-01", bank_name: "ملت", account_no: "1111111" } }],
    });
    expect((await chequesOf(fresh.doc.id))[0]).toMatchObject({ ...fromSaderat, serial_no: "400002" });
  });

  it("lets one edit drop a cheque and enter it again with the same Sayad number or serial", async () => {
    // received: the cheque's line is deleted and typed again (a new line, without the cheque's id)
    const sayad = "1111222233334444";
    const r = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-05-02", party_id: customer.id,
      lines: [{ method: "cheque", amount: "3000000", cheque: { serial_no: "550001", sayad_no: sayad, bank_name: "ملی", due_date: "2026-08-01" } }],
    });
    const [oldIn] = await chequesOf(r.doc.id);
    await c.put(o(`/treasury/docs/${r.doc.id}`), {
      kind: "receipt", date: "2026-05-02", party_id: customer.id,
      lines: [{ method: "cheque", amount: "3500000", cheque: { serial_no: "550001", sayad_no: sayad, bank_name: "ملی", due_date: "2026-08-05" } }],
    });
    const [newIn] = await chequesOf(r.doc.id);
    expect(newIn.id).not.toBe(oldIn.id);
    expect(newIn).toMatchObject({ sayad_no: sayad, amount: "3500000", due_date: "2026-08-05", status: "in_hand" });
    await c.get(o(`/treasury/cheques/${oldIn.id}`), 404);
    expect((await c.get(o(`/treasury/cheques?q=${sayad}`))).total).toBe(1);
    // another document still cannot register it
    const dupIn = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-05-03", party_id: customer.id,
      lines: [{ method: "cheque", amount: "1000", cheque: { sayad_no: sayad, due_date: "2026-08-01" } }],
    }, 409);
    expect(dupIn.error.message).toContain("صیادی");

    // issued: the same leaf of the same cheque book is entered again on a new line
    const p = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-05-02", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "2000000", cheque: { cheque_book_id: bookM.id, serial_no: "300010", due_date: "2026-08-01" } }],
    });
    const [oldOut] = await chequesOf(p.doc.id);
    await c.put(o(`/treasury/docs/${p.doc.id}`), {
      kind: "payment", date: "2026-05-02", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "2500000", cheque: { cheque_book_id: bookM.id, serial_no: "300010", due_date: "2026-08-10" } }],
    });
    const [newOut] = await chequesOf(p.doc.id);
    expect(newOut.id).not.toBe(oldOut.id);
    expect(newOut).toMatchObject({ serial_no: "300010", cheque_book_id: bookM.id, amount: "2500000", status: "issued" });
    await c.get(o(`/treasury/cheques/${oldOut.id}`), 404);
    const dupOut = await c.post(o("/treasury/docs"), {
      kind: "payment", date: "2026-05-03", party_id: supplier.id,
      lines: [{ method: "cheque", amount: "1000", cheque: { cheque_book_id: bookM.id, serial_no: "300010", due_date: "2026-08-01" } }],
    }, 409);
    expect(dupOut.error.message).toContain("سریال");

    // a cheque that has had an operation is still neither dropped nor entered a second time
    const m = await c.post(o("/treasury/docs"), {
      kind: "receipt", date: "2026-05-04", party_id: customer.id,
      lines: [{ method: "cheque", amount: "1000000", cheque: { serial_no: "660001", sayad_no: "5555666677778888", due_date: "2026-09-01" } }],
    });
    const [moved] = await chequesOf(m.doc.id);
    await c.post(o(`/treasury/cheques/${moved.id}/action`), { action: "deposit", date: "2026-09-02", bank_account_id: mellat.id });
    const refused = await c.put(o(`/treasury/docs/${m.doc.id}`), {
      kind: "receipt", date: "2026-05-04", party_id: customer.id,
      lines: [{ method: "cheque", amount: "1000000", cheque: { serial_no: "660001", sayad_no: "5555666677778888", due_date: "2026-09-01" } }],
    }, 409);
    expect(refused.error.message).toContain("در جریان وصول");
    expect((await chequesOf(m.doc.id))[0].id).toBe(moved.id);
  });

  it("totals the cash book over the whole period when its rows stop at the row limit", async () => {
    const box = (await c.post(o("/data/cash_box"), { name: "صندوق شعبه" })).row as { id: string; detail_id: string };
    const cash = await accountId(db, org, "cash");
    const counter = await accountId(db, org, "opening_balance");
    const fy = (await db.one<{ id: string }>(`select id from tz_fiscal_years where org_id = $1`, [org]))!;
    /** a posted voucher with `count` equal lines on the box and one counter line */
    const bulk = async (no: number, date: string, count: number, debit: string, credit: string) => {
      const id = uuidv7();
      const total = D(debit).plus(D(credit)).times(count).toString();
      await db.query(
        `insert into tz_vouchers (id, org_id, fiscal_year_id, no, date, status, description, total_debit, total_credit)
         values ($1, $2, $3, $4, $5, 'posted', 'سند انبوه آزمایشی', $6, $6)`,
        [id, org, fy.id, no, date, total],
      );
      await db.query(
        `insert into tz_voucher_lines (voucher_id, org_id, line_no, account_id, detail_id, debit, credit)
         select $1::uuid, $2::uuid, g, $3::uuid, $4::uuid, $5::numeric, $6::numeric from generate_series(1, $7::int) g
         union all
         select $1::uuid, $2::uuid, $7::int + 1, $8::uuid, null, $6::numeric * $7::int, $5::numeric * $7::int`,
        [id, org, cash, box.detail_id, debit, credit, count, counter],
      );
    };
    await bulk(900001, "2026-04-15", 1, "50000000", "0"); // before the period: the opening balance
    await bulk(900002, "2026-06-01", 20000, "1000", "0"); // as many lines as the book lists
    await bulk(900003, "2026-06-02", 1, "0", "7000000"); // one more, past the limit

    const book = await c.get(o(`/treasury/book?cash_box_id=${box.id}&from=2026-05-01&to=2026-12-31`));
    expect(book.opening).toBe("50000000");
    expect(book.totals).toMatchObject({ debit: "20000000", credit: "7000000", balance: "63000000" });
    expect(book.truncated).toBe(true);
    expect(book.rows).toHaveLength(20000);
    expect(book.rows[book.rows.length - 1].balance).toBe("70000000");
    // the accounting ledger of the same account and detail agrees
    const led = await c.get(o(`/accounting/reports/ledger?account_id=${cash}&detail_id=${box.detail_id}&from=2026-05-01&to=2026-12-31`));
    expect(led.totals).toMatchObject({ debit: "20000000", credit: "7000000", balance: "63000000" });
    expect(led.truncated).toBe(true);
    // a range within the limit is complete
    const tail = await c.get(o(`/treasury/book?cash_box_id=${box.id}&from=2026-06-02`));
    expect(tail.opening).toBe("70000000");
    expect(tail.totals).toMatchObject({ debit: "0", credit: "7000000", balance: "63000000" });
    expect(tail.truncated).toBe(false);
    expect(tail.rows).toHaveLength(1);
  });

  it("sums the cheques due over every open cheque when the list stops at the row limit", async () => {
    const today = todayISO();
    const d40 = addDays(today, 40);
    const d50 = addDays(today, 50);
    const many = (direction: string, status: string, party: string, prefix: string, count: number, amount: string, due: string) =>
      db.query(
        `insert into tz_cheques (org_id, direction, serial_no, party_id, amount, issue_date, due_date, status)
         select $1::uuid, $2::text, $3::text || g::text, $4::uuid, $5::numeric, $6::date, $7::date, $8::text from generate_series(1, $9::int) g`,
        [org, direction, prefix, party, amount, today, due, status, count],
      );
    await many("received", "in_hand", customer.id, "R", 5000, "1000", d40); // as many as the report lists
    await many("received", "in_hand", customer.id, "S", 3, "2000", d50);
    await many("issued", "issued", supplier.id, "I", 2, "1500", d50);

    const due = await c.get(o(`/treasury/reports/cheques-due?from=${d40}&to=${d50}`));
    const later = due.buckets.find((b: any) => b.key === "later");
    expect(later.received).toEqual({ count: 5003, sum: "5006000" });
    expect(later.issued).toEqual({ count: 2, sum: "3000" });
    expect(later.net).toBe("5003000");
    expect(due.by_date).toEqual([
      { due_date: d40, received: { count: 5000, sum: "5000000" }, issued: { count: 0, sum: "0" }, net: "5000000", cumulative: "5000000" },
      { due_date: d50, received: { count: 3, sum: "6000" }, issued: { count: 2, sum: "3000" }, net: "3000", cumulative: "5003000" },
    ]);
    expect(due.truncated).toBe(true);
    expect(due.rows).toHaveLength(5000);
    const issued = await c.get(o(`/treasury/reports/cheques-due?direction=issued&from=${d40}&to=${d50}`));
    expect(issued.truncated).toBe(false);
    expect(issued.rows.map((x: any) => x.serial_no).sort()).toEqual(["I1", "I2"]);
  });
});
