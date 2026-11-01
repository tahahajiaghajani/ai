// Treasury reports straight from the ledger: the cash & bank book (دفتر صندوق و بانک) of one box or
// bank account with running balance, balances of every box and bank, cheques by due date
// (سررسید چک‌ها), a party's current balance for the cashier and the dashboard summary.
// Balances are cumulative (all fiscal years): opening vouchers of a new year and closing
// vouchers of the old one cancel out, so this is right whether or not a year has been closed.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { notFound } from "../../http/errors";
import { ledger } from "../accounting/reports";
import { D } from "@shared/money";
import { addDays } from "@shared/jalali";
import { OPEN_STATUSES, orgToday } from "./common";

const POSTED = "v.deleted_at is null and v.status in ('posted','final')";

async function keyId(q: Queryable, orgId: string, key: string): Promise<string | null> {
  const r = await q.one<{ id: string }>(`select id from tz_accounts where org_id = $1 and system_key = $2 and deleted_at is null`, [orgId, key]);
  return r?.id ?? null;
}

// ---------------------------------------------------------------- cash & bank book

export async function cashBankBook(q: Queryable, ctx: Ctx, p: { kind: "cash" | "bank"; id: string; from?: string | null; to?: string | null; drafts?: boolean }) {
  const orgId = ctx.org.id;
  const row = p.kind === "cash"
    ? await q.one<Record<string, any>>(`select id, code, name, detail_id, is_active from tz_cash_boxes where id = $1 and org_id = $2 and deleted_at is null`, [p.id, orgId])
    : await q.one<Record<string, any>>(
        `select id, code, name, bank_name, account_no, detail_id, is_active from tz_bank_accounts where id = $1 and org_id = $2 and deleted_at is null`,
        [p.id, orgId],
      );
  if (!row) throw notFound(p.kind === "cash" ? "صندوق پیدا نشد" : "حساب بانکی پیدا نشد");
  const accountId = await keyId(q, orgId, p.kind);
  const empty = { opening: "0", opening_fx: "0", opening_w: "0", rows: [] as Record<string, any>[], totals: { debit: "0", credit: "0", balance: "0" } };
  const led = accountId && row.detail_id
    ? await ledger(q, orgId, { accountId, detailId: row.detail_id, from: p.from ?? null, to: p.to ?? null, includeDrafts: p.drafts })
    : empty;
  const rows = led.rows as Record<string, any>[];

  // link each row to the treasury document or cheque operation that produced it
  const docIds = Array.from(new Set(rows.filter((r) => r.source_type === "treasury_doc").map((r) => r.source_id as string)));
  const opIds = Array.from(new Set(rows.filter((r) => r.source_type === "cheque_op").map((r) => r.source_id as string)));
  const docs = docIds.length
    ? await q.query<{ id: string; kind: string; no: number; party_name: string | null }>(
        `select d.id, d.kind, d.no, p.name as party_name from tz_treasury_docs d left join tz_parties p on p.id = d.party_id
         where d.org_id = $1 and d.id = any($2::uuid[])`,
        [orgId, `{${docIds.join(",")}}`],
      )
    : [];
  const ops = opIds.length
    ? await q.query<{ op_id: string; cheque_id: string; direction: string; action: string; serial_no: string | null }>(
        `select e ->> 'id' as op_id, c.id as cheque_id, c.direction, e ->> 'action' as action, c.serial_no
         from tz_cheques c cross join lateral jsonb_array_elements(c.history) e
         where c.org_id = $1 and e ->> 'id' = any($2::text[])`,
        [orgId, `{${opIds.join(",")}}`],
      )
    : [];
  const out = rows.map((r) => {
    const doc = r.source_type === "treasury_doc" ? docs.find((d) => d.id === r.source_id) : undefined;
    const op = r.source_type === "cheque_op" ? ops.find((o) => o.op_id === r.source_id) : undefined;
    return {
      ...r,
      doc: doc ? { id: doc.id, kind: doc.kind, no: doc.no, party_name: doc.party_name } : null,
      cheque: op ? { id: op.cheque_id, direction: op.direction, action: op.action, serial_no: op.serial_no } : null,
    };
  });
  let inCollection: { count: number; sum: string } | null = null;
  if (p.kind === "bank") {
    const r = await q.one<{ n: number; sum: string }>(
      `select count(*)::int as n, coalesce(sum(amount), 0) as sum from tz_cheques
       where org_id = $1 and deleted_at is null and direction = 'received' and status = 'deposited' and bank_account_id = $2`,
      [orgId, row.id],
    );
    const issued = await q.one<{ n: number; sum: string }>(
      `select count(*)::int as n, coalesce(sum(amount), 0) as sum from tz_cheques
       where org_id = $1 and deleted_at is null and direction = 'issued' and status = 'issued' and bank_account_id = $2`,
      [orgId, row.id],
    );
    inCollection = { count: r?.n ?? 0, sum: r?.sum ?? "0" };
    return { kind: p.kind, account: row, opening: led.opening, rows: out, totals: led.totals, in_collection: inCollection, issued_open: { count: issued?.n ?? 0, sum: issued?.sum ?? "0" } };
  }
  return { kind: p.kind, account: row, opening: led.opening, rows: out, totals: led.totals };
}

// ---------------------------------------------------------------- balances of boxes and banks

export async function balances(q: Queryable, ctx: Ctx) {
  const orgId = ctx.org.id;
  const sums = await q.query<{ system_key: string; detail_id: string; balance: string; last_date: string | null }>(
    `select a.system_key, l.detail_id, sum(l.debit - l.credit) as balance, max(v.date) as last_date
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and ${POSTED} and a.system_key in ('cash','bank') and l.detail_id is not null
     group by a.system_key, l.detail_id`,
    [orgId],
  );
  const bal = (key: string, detailId: string | null) => sums.find((s) => s.system_key === key && s.detail_id === detailId);
  interface Box { id: string; code: string; name: string; detail_id: string | null; currency_id: string | null; is_active: boolean }
  interface Bank extends Box { bank_name: string | null; account_no: string | null }
  const boxes = await q.query<Box>(
    `select id, code, name, detail_id, currency_id, is_active from tz_cash_boxes where org_id = $1 and deleted_at is null order by length(code), code`,
    [orgId],
  );
  const banks = await q.query<Bank>(
    `select id, code, name, bank_name, account_no, detail_id, currency_id, is_active from tz_bank_accounts where org_id = $1 and deleted_at is null order by length(code), code`,
    [orgId],
  );
  const cheq = await q.query<{ bank_account_id: string; direction: string; n: number; sum: string }>(
    `select bank_account_id, direction, count(*)::int as n, coalesce(sum(amount), 0) as sum from tz_cheques
     where org_id = $1 and deleted_at is null and bank_account_id is not null
       and ((direction = 'received' and status = 'deposited') or (direction = 'issued' and status = 'issued'))
     group by bank_account_id, direction`,
    [orgId],
  );
  const base = await q.one<{ id: string }>(`select id from tz_currencies where org_id = $1 and is_base and deleted_at is null limit 1`, [orgId]);
  const rial = (r: { currency_id: string | null }) => !r.currency_id || r.currency_id === base?.id;
  const boxRows = boxes.filter(rial).map((b) => ({ ...b, balance: bal("cash", b.detail_id)?.balance ?? "0", last_date: bal("cash", b.detail_id)?.last_date ?? null }));
  const bankRows = banks.filter(rial).map((b) => {
    const inc = cheq.find((c) => c.bank_account_id === b.id && c.direction === "received");
    const iss = cheq.find((c) => c.bank_account_id === b.id && c.direction === "issued");
    return {
      ...b,
      balance: bal("bank", b.detail_id)?.balance ?? "0",
      last_date: bal("bank", b.detail_id)?.last_date ?? null,
      in_collection: inc?.sum ?? "0",
      in_collection_count: inc?.n ?? 0,
      issued_open: iss?.sum ?? "0",
      issued_open_count: iss?.n ?? 0,
    };
  });
  // totals come from the ledger (every detail of the accounts), not only the listed rows
  const total = (key: string) => sums.filter((s) => s.system_key === key).reduce((a, s) => a.plus(D(s.balance)), D(0)).toString();
  return { boxes: boxRows, banks: bankRows, cash_total: total("cash"), bank_total: total("bank") };
}

// ---------------------------------------------------------------- cheques by due date

const OPEN_COND = `((c.direction = 'received' and c.status = any('{${OPEN_STATUSES.received.join(",")}}'::text[])) or (c.direction = 'issued' and c.status = any('{${OPEN_STATUSES.issued.join(",")}}'::text[])))`;

interface Agg {
  count: number;
  sum: string;
}
const zero = (): Agg => ({ count: 0, sum: "0" });
const plus = (a: Agg, amount: string): Agg => ({ count: a.count + 1, sum: D(a.sum).plus(D(amount)).toString() });

export async function chequesDue(q: Queryable, ctx: Ctx, p: { direction?: string | null; from?: string | null; to?: string | null }) {
  const today = orgToday(ctx);
  const params: unknown[] = [ctx.org.id];
  const cond = ["c.org_id = $1", "c.deleted_at is null", OPEN_COND];
  if (p.direction) {
    params.push(p.direction);
    cond.push(`c.direction = $${params.length}`);
  }
  if (p.from) {
    params.push(p.from);
    cond.push(`c.due_date >= $${params.length}`);
  }
  if (p.to) {
    params.push(p.to);
    cond.push(`c.due_date <= $${params.length}`);
  }
  const rows = await q.query<Record<string, any>>(
    `select c.id, c.direction, c.status, c.amount, c.due_date, c.serial_no, c.sayad_no, c.bank_name, c.party_id,
            p.name as party_name, ba.name as bank_account_name
     from tz_cheques c left join tz_parties p on p.id = c.party_id left join tz_bank_accounts ba on ba.id = c.bank_account_id
     where ${cond.join(" and ")}
     order by c.due_date, c.amount desc
     limit 5000`,
    params,
  );
  const week = addDays(today, 7);
  const month = addDays(today, 30);
  const buckets = [
    { key: "overdue", label: "سررسید گذشته", test: (d: string) => d < today },
    { key: "week", label: "تا ۷ روز آینده", test: (d: string) => d >= today && d <= week },
    { key: "month", label: "۸ تا ۳۰ روز آینده", test: (d: string) => d > week && d <= month },
    { key: "later", label: "بعد از ۳۰ روز", test: (d: string) => d > month },
  ].map((b) => {
    let received = zero();
    let issued = zero();
    for (const r of rows) {
      if (!b.test(r.due_date)) continue;
      if (r.direction === "received") received = plus(received, r.amount);
      else issued = plus(issued, r.amount);
    }
    return { key: b.key, label: b.label, received, issued, net: D(received.sum).minus(D(issued.sum)).toString() };
  });
  const byDate = new Map<string, { due_date: string; received: Agg; issued: Agg }>();
  for (const r of rows) {
    const e = byDate.get(r.due_date) ?? { due_date: r.due_date, received: zero(), issued: zero() };
    if (r.direction === "received") e.received = plus(e.received, r.amount);
    else e.issued = plus(e.issued, r.amount);
    byDate.set(r.due_date, e);
  }
  let running = D(0);
  const by_date = [...byDate.values()].map((e) => {
    const net = D(e.received.sum).minus(D(e.issued.sum));
    running = running.plus(net);
    return { ...e, net: net.toString(), cumulative: running.toString() };
  });
  return { today, buckets, by_date, rows: rows.map((r) => ({ ...r, overdue: r.due_date < today })) };
}

// ---------------------------------------------------------------- party balance

/** A party's balances by account (for the cashier while typing a receipt or payment). */
export async function partyBalance(q: Queryable, ctx: Ctx, partyId: string) {
  const party = await q.one<{ id: string; name: string; detail_id: string | null; credit_limit: string | null }>(
    `select id, name, detail_id, credit_limit from tz_parties where id = $1 and org_id = $2 and deleted_at is null`,
    [partyId, ctx.org.id],
  );
  if (!party) throw notFound("شخص پیدا نشد");
  const rows = party.detail_id
    ? await q.query<{ account_id: string; code: string; name: string; system_key: string | null; balance: string }>(
        `select a.id as account_id, a.code, a.name, a.system_key, sum(l.debit - l.credit) as balance
         from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
         where l.org_id = $1 and ${POSTED} and (l.detail_id = $2 or l.detail2_id = $2)
         group by a.id, a.code, a.name, a.system_key having sum(l.debit - l.credit) <> 0 order by a.code`,
        [ctx.org.id, party.detail_id],
      )
    : [];
  const by = (keys: string[]) => rows.filter((r) => r.system_key && keys.includes(r.system_key)).reduce((a, r) => a.plus(D(r.balance)), D(0)).toString();
  const cheques = await q.query<{ direction: string; status: string; n: number; sum: string }>(
    `select direction, status, count(*)::int as n, coalesce(sum(amount), 0) as sum from tz_cheques
     where org_id = $1 and party_id = $2 and deleted_at is null group by direction, status`,
    [ctx.org.id, partyId],
  );
  const pick = (dir: string, statuses: string[]) => {
    const xs = cheques.filter((c) => c.direction === dir && statuses.includes(c.status));
    return { count: xs.reduce((a, c) => a + c.n, 0), sum: xs.reduce((a, c) => a.plus(D(c.sum)), D(0)).toString() };
  };
  return {
    party: { id: party.id, name: party.name, credit_limit: party.credit_limit },
    /** receivable/payable current account: + they owe us, − we owe them */
    balance: by(["ar", "ap", "customer_advances", "supplier_advances"]),
    total: rows.reduce((a, r) => a.plus(D(r.balance)), D(0)).toString(),
    accounts: rows,
    cheques: {
      received_open: pick("received", OPEN_STATUSES.received),
      bounced: pick("received", ["bounced"]),
      issued_open: pick("issued", OPEN_STATUSES.issued),
    },
  };
}

// ---------------------------------------------------------------- dashboard summary

export async function summary(q: Queryable, ctx: Ctx) {
  const orgId = ctx.org.id;
  const today = orgToday(ctx);
  const week = addDays(today, 7);
  const b = await balances(q, ctx);
  const due = await q.query<{ direction: string; overdue: boolean; n: number; sum: string }>(
    `select c.direction, c.due_date < $2 as overdue, count(*)::int as n, coalesce(sum(c.amount), 0) as sum
     from tz_cheques c where c.org_id = $1 and c.deleted_at is null and ${OPEN_COND} and c.due_date <= $3
     group by c.direction, c.due_date < $2`,
    [orgId, today, week],
  );
  const agg = (direction: string, overdue: boolean): Agg => {
    const r = due.find((x) => x.direction === direction && x.overdue === overdue);
    return { count: r?.n ?? 0, sum: r?.sum ?? "0" };
  };
  const upcoming = await q.query(
    `select c.id, c.direction, c.status, c.amount, c.due_date, c.serial_no, c.sayad_no, c.bank_name, p.name as party_name
     from tz_cheques c left join tz_parties p on p.id = c.party_id
     where c.org_id = $1 and c.deleted_at is null and ${OPEN_COND} and c.due_date <= $2
     order by c.due_date, c.amount desc limit 8`,
    [orgId, week],
  );
  const docs = await q.query<{ kind: string; n: number; sum: string }>(
    `select kind, count(*)::int as n, coalesce(sum(total), 0) as sum from tz_treasury_docs
     where org_id = $1 and deleted_at is null and date = $2 group by kind`,
    [orgId, today],
  );
  const doc = (kind: string): Agg => {
    const r = docs.find((d) => d.kind === kind);
    return { count: r?.n ?? 0, sum: r?.sum ?? "0" };
  };
  const collection = b.banks.reduce((a, x) => ({ count: a.count + Number(x.in_collection_count ?? 0), sum: D(a.sum).plus(D(x.in_collection)).toString() }), zero());
  return {
    today,
    cash_total: b.cash_total,
    bank_total: b.bank_total,
    boxes: b.boxes.map((x) => ({ id: x.id, name: x.name, balance: x.balance })),
    banks: b.banks.map((x) => ({ id: x.id, name: x.name, balance: x.balance, in_collection: x.in_collection })),
    in_collection: collection,
    cheques: {
      received_week: agg("received", false),
      issued_week: agg("issued", false),
      received_overdue: agg("received", true),
      issued_overdue: agg("issued", true),
    },
    upcoming: upcoming.map((r) => ({ ...r, overdue: r.due_date < today })),
    today_receipts: doc("receipt"),
    today_payments: doc("payment"),
    today_transfers: doc("transfer"),
  };
}
