// Cheque register (دفتر چک) and the cheque lifecycle.
//
// Cheques are only born inside treasury documents (a receipt registers received cheques, a payment
// issues cheques from a cheque book) so the books always stay right. After that every change of
// status is an operation with its own automatic voucher (source type `cheque_op`, a fresh id per
// operation) and an entry in the cheque's `history`; `undo` takes back the last operation.
//
// The value of a cheque always sits on exactly one account ("holding"):
//   received: in_hand → cheques_receivable[drawer], deposited → cheques_in_collection[bank],
//             bounced → cheques_bounced[drawer] (or ar[drawer] when bounced to the receivable)
//   issued:   issued → cheques_payable[payee]
// An operation moves it to the next holding: Dr new / Cr old (received), Dr old / Cr new (issued).
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { likeContains } from "../../db";
import { updateRow } from "../../db/sql";
import { bad, notFound } from "../../http/errors";
import { accountByKey, cr, dr, postAuto, removeAuto } from "../accounting/vouchers";
import { fiscalYearFor } from "../accounting/fiscal";
import { audit } from "../data/crud";
import { D, normalizeDigits } from "@shared/money";
import { uuidv7 } from "@shared/id";
import { diffDays } from "@shared/jalali";
import { Lookups, OPEN_STATUSES, chequeLabel, chequeStatusTitle, jdate, orgToday, type ChequeDirection } from "./common";
import type { ChequeRow } from "./docs";
import type { ChequeAction, ChequeActionInput } from "./schema";

interface Rule {
  from: string[];
  to: string;
  title: string;
}

/** Allowed operations per direction: from which statuses, to which status. */
export const RULES: Record<ChequeDirection, Partial<Record<ChequeAction, Rule>>> = {
  received: {
    deposit: { from: ["in_hand", "bounced"], to: "deposited", title: "واگذاری به بانک" },
    clear: { from: ["deposited"], to: "cleared", title: "وصول" },
    cash: { from: ["in_hand", "bounced"], to: "cleared", title: "وصول نقدی" },
    bounce: { from: ["in_hand", "deposited"], to: "bounced", title: "برگشت" },
    endorse: { from: ["in_hand"], to: "endorsed", title: "خرج چک" },
    return: { from: ["in_hand", "bounced"], to: "returned", title: "عودت به صاحب چک" },
  },
  issued: {
    clear: { from: ["issued"], to: "cleared", title: "پاس شدن" },
    bounce: { from: ["issued"], to: "bounced", title: "برگشت" },
    cancel: { from: ["issued"], to: "cancelled", title: "ابطال" },
  },
};

export interface ChequeOp {
  id: string;
  date: string;
  action: ChequeAction;
  from: string;
  to: string;
  voucher_id: string | null;
  note: string | null;
  by: string;
  by_name: string;
  at: string;
  amount: string;
  bank_account_id?: string | null;
  cash_box_id?: string | null;
  party_id?: string | null;
  to_account?: "ar" | "bounced" | null;
  prev_bank_account_id: string | null;
  prev_holder_party_id: string | null;
}

const opsOf = (c: { history: unknown }): ChequeOp[] => (Array.isArray(c.history) ? (c.history as ChequeOp[]) : []);

/** Operations offered for a cheque in its current status (plus undo when it has any). */
export function allowedActions(c: { direction: string; status: string; history?: unknown; ops?: number | null }): ChequeAction[] {
  const rules = RULES[c.direction as ChequeDirection] ?? {};
  const out = (Object.keys(rules) as ChequeAction[]).filter((a) => rules[a]!.from.includes(c.status));
  const n = c.ops ?? opsOf(c as { history: unknown }).length;
  if (n > 0) out.push("undo");
  return out;
}

interface Posting {
  accountId: string;
  detailId: string | null;
}

async function loadCheque(q: Queryable, orgId: string, id: string): Promise<ChequeRow | null> {
  return q.one<ChequeRow>(`select * from tz_cheques where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
}

// ---------------------------------------------------------------- operations

export async function chequeAction(tx: Tx, ctx: Ctx, id: string, input: ChequeActionInput) {
  const org = ctx.org;
  const c = await loadCheque(tx, org.id, id);
  if (!c) throw notFound("چک پیدا نشد");
  if (input.action === "undo") return undoLast(tx, ctx, c);

  const rule = RULES[c.direction]?.[input.action];
  const label = chequeLabel(c);
  if (!rule) throw bad(`این عملیات برای چک ${c.direction === "received" ? "دریافتی" : "پرداختی"} تعریف نشده است`);
  if (!rule.from.includes(c.status)) throw bad(`${label} «${chequeStatusTitle(c.direction, c.status)}» است و «${rule.title}» برای آن ممکن نیست`);
  const history = opsOf(c);
  const date = input.date ?? orgToday(ctx);
  const lastDate = history.length ? history[history.length - 1].date : c.issue_date;
  if (lastDate && date < lastDate) throw bad(`تاریخ عملیات نمی‌تواند پیش از ${jdate(lastDate)} (آخرین رویداد چک) باشد`);
  if (!c.party_id) throw bad(`شخص ${label} مشخص نیست`);

  const L = new Lookups(tx, org.id);
  // the cheque's own bank stays usable for its operations even if the account was deactivated since
  if (c.bank_account_id) L.known.add(c.bank_account_id);
  const party = await L.party(c.party_id);
  const key = (k: string) => accountByKey(tx, org.id, k);
  const note = input.note?.trim() || null;
  const who = party.name;
  const patch: Record<string, unknown> = { status: rule.to, origin: ctx.cfg.origin };
  const extra: Partial<ChequeOp> = {};
  let holding: Posting;
  let target: Posting;
  let text: string;

  if (c.direction === "received") {
    holding = await receivedHolding(tx, L, org.id, c, history, party.detail_id);
    switch (input.action) {
      case "deposit": {
        if (!input.bank_account_id) throw bad("حساب بانکی را که چک به آن واگذار می‌شود انتخاب کنید");
        const bank = await L.bank(input.bank_account_id);
        target = { accountId: await key("cheques_in_collection"), detailId: bank.detail_id };
        patch.bank_account_id = bank.id;
        extra.bank_account_id = bank.id;
        text = `واگذاری ${label} (${who}) به ${bank.name} برای وصول`;
        break;
      }
      case "clear": {
        const bankId = input.bank_account_id ?? c.bank_account_id;
        if (!bankId) throw bad("حساب بانکی وصول‌کننده را انتخاب کنید");
        const bank = await L.bank(bankId);
        target = { accountId: await key("bank"), detailId: bank.detail_id };
        patch.bank_account_id = bank.id;
        extra.bank_account_id = bank.id;
        text = `وصول ${label} (${who}) — ${bank.name}`;
        break;
      }
      case "cash": {
        if (!input.cash_box_id) throw bad("صندوق را انتخاب کنید");
        const box = await L.box(input.cash_box_id);
        target = { accountId: await key("cash"), detailId: box.detail_id };
        extra.cash_box_id = box.id;
        text = `وصول نقدی ${label} (${who}) — ${box.name}`;
        break;
      }
      case "bounce": {
        const toAccount = input.to_account ?? "bounced";
        target = { accountId: await key(toAccount === "ar" ? "ar" : "cheques_bounced"), detailId: party.detail_id };
        extra.to_account = toAccount;
        text = `برگشت ${label} (${who})${toAccount === "ar" ? " — انتقال به حساب دریافتنی" : ""}`;
        break;
      }
      case "endorse": {
        if (!input.party_id) throw bad("شخصی را که چک به او واگذار (خرج) می‌شود انتخاب کنید");
        if (input.party_id === party.id) throw bad("برای پس دادن چک به صاحبش «عودت» را انتخاب کنید");
        const to = await L.party(input.party_id);
        target = { accountId: await key("ap"), detailId: to.detail_id };
        patch.holder_party_id = to.id;
        extra.party_id = to.id;
        text = `خرج ${label} (${who}) در وجه ${to.name}`;
        break;
      }
      case "return": {
        target = { accountId: await key("ar"), detailId: party.detail_id };
        text = `عودت ${label} به ${who}`;
        break;
      }
      default:
        throw bad("عملیات چک معتبر نیست");
    }
  } else {
    holding = { accountId: await key("cheques_payable"), detailId: party.detail_id };
    switch (input.action) {
      case "clear": {
        const bankId = c.bank_account_id ?? input.bank_account_id;
        if (!bankId) throw bad("حساب بانکی چک را انتخاب کنید");
        const bank = await L.bank(bankId);
        target = { accountId: await key("bank"), detailId: bank.detail_id };
        patch.bank_account_id = bank.id;
        extra.bank_account_id = bank.id;
        text = `پاس شدن ${label} در وجه ${who} — ${bank.name}`;
        break;
      }
      case "bounce":
      case "cancel": {
        target = { accountId: await key("ap"), detailId: party.detail_id };
        text = `${input.action === "bounce" ? "برگشت" : "ابطال"} ${label} در وجه ${who}`;
        break;
      }
      default:
        throw bad("عملیات چک معتبر نیست");
    }
  }

  const opId = uuidv7();
  const amount = D(c.amount).toString();
  const desc = `${text}${note ? ` — ${note}` : ""}`.slice(0, 500);
  const ref = { ref_type: "cheque", ref_id: c.id, due_date: c.due_date };
  const same = holding.accountId === target.accountId && (holding.detailId ?? null) === (target.detailId ?? null);
  const lines = same
    ? []
    : c.direction === "received"
      ? [dr(target.accountId, amount, { detail_id: target.detailId, description: desc, ...ref }), cr(holding.accountId, amount, { detail_id: holding.detailId, description: desc, ...ref })]
      : [dr(holding.accountId, amount, { detail_id: holding.detailId, description: desc, ...ref }), cr(target.accountId, amount, { detail_id: target.detailId, description: desc, ...ref })];
  const voucherId = lines.length
    ? await postAuto(tx, org, { type: "cheque_op", id: opId, date, description: desc, refNo: (c.sayad_no ?? c.serial_no)?.slice(0, 60) ?? null }, lines, {
        userId: ctx.user.id,
        origin: ctx.cfg.origin,
      })
    : null;

  const op: ChequeOp = {
    id: opId,
    date,
    action: input.action,
    from: c.status,
    to: rule.to,
    voucher_id: voucherId,
    note,
    by: ctx.user.id,
    by_name: ctx.user.full_name,
    at: new Date().toISOString(),
    amount,
    ...extra,
    prev_bank_account_id: c.bank_account_id ?? null,
    prev_holder_party_id: c.holder_party_id ?? null,
  };
  patch.history = [...history, op];
  await updateRow(tx, "tz_cheques", { id: c.id, org_id: org.id }, patch, "id");
  await audit(tx, ctx, `cheque_${input.action}`, "cheque", c.id, `${rule.title} ${label}`.slice(0, 300), { op: opId, voucher_id: voucherId });
  return { op, status: rule.to };
}

async function receivedHolding(tx: Tx, L: Lookups, orgId: string, c: ChequeRow, history: ChequeOp[], partyDetail: string | null): Promise<Posting> {
  switch (c.status) {
    case "in_hand":
      return { accountId: await accountByKey(tx, orgId, "cheques_receivable"), detailId: partyDetail };
    case "deposited": {
      const bank = c.bank_account_id ? await L.bank(c.bank_account_id) : null;
      return { accountId: await accountByKey(tx, orgId, "cheques_in_collection"), detailId: bank?.detail_id ?? null };
    }
    case "bounced": {
      const bounce = [...history].reverse().find((h) => h.action === "bounce");
      return { accountId: await accountByKey(tx, orgId, bounce?.to_account === "ar" ? "ar" : "cheques_bounced"), detailId: partyDetail };
    }
    default:
      throw bad(`${chequeLabel(c)} «${chequeStatusTitle(c.direction, c.status)}» است`);
  }
}

/** Take back the last operation: its voucher goes, the status and bank/holder are restored. */
async function undoLast(tx: Tx, ctx: Ctx, c: ChequeRow) {
  const org = ctx.org;
  const history = opsOf(c);
  const last = history[history.length - 1];
  if (!last) throw bad("این چک عملیاتی ندارد که برگردانده شود");
  await fiscalYearFor(tx, org.id, last.date); // operations of a closed year stay
  await removeAuto(tx, org.id, "cheque_op", last.id);
  await updateRow(tx, "tz_cheques", { id: c.id, org_id: org.id }, {
    status: last.from,
    history: history.slice(0, -1),
    bank_account_id: last.prev_bank_account_id ?? null,
    holder_party_id: last.prev_holder_party_id ?? null,
    origin: ctx.cfg.origin,
  }, "id");
  const title = RULES[c.direction]?.[last.action]?.title ?? last.action;
  await audit(tx, ctx, "cheque_undo", "cheque", c.id, `برگشت «${title}» ${chequeLabel(c)}`.slice(0, 300), { op: last.id });
  return { op: last, status: last.from, undone: true };
}

// ---------------------------------------------------------------- read

export interface ListChequesParams {
  direction?: string;
  status?: string;
  from?: string;
  to?: string;
  party_id?: string;
  bank_account_id?: string;
  q?: string;
  overdue?: string;
  open?: string;
  page?: number;
  size?: number;
  sort?: string;
  dir?: string;
}

const SORTS: Record<string, string> = {
  due_date: "c.due_date",
  amount: "c.amount",
  serial_no: "c.serial_no",
  party_name: "p.name",
  status: "c.status",
  issue_date: "c.issue_date",
};

const OPEN_SQL = `((c.direction = 'received' and c.status = any('{${OPEN_STATUSES.received.join(",")}}'::text[])) or (c.direction = 'issued' and c.status = any('{${OPEN_STATUSES.issued.join(",")}}'::text[])))`;

export async function listCheques(q: Queryable, ctx: Ctx, p: ListChequesParams) {
  const today = orgToday(ctx);
  const params: unknown[] = [ctx.org.id];
  const cond = ["c.org_id = $1", "c.deleted_at is null"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (p.direction) add("c.direction = ?", p.direction);
  if (p.from) add("c.due_date >= ?", p.from);
  if (p.to) add("c.due_date <= ?", p.to);
  if (p.party_id) add("(c.party_id = ? or c.holder_party_id = ?)", p.party_id);
  if (p.bank_account_id) add("c.bank_account_id = ?", p.bank_account_id);
  if (p.open === "1") cond.push(OPEN_SQL);
  if (p.overdue === "1") add(`${OPEN_SQL} and c.due_date < ?`, today);
  const s = normalizeDigits((p.q ?? "").trim());
  if (s) {
    add(
      `(c.serial_no ilike ? or c.sayad_no ilike ? or c.bank_name ilike ? or c.account_owner ilike ? or c.description ilike ? or p.name ilike ?)`,
      likeContains(s),
    );
  }
  // totals per status ignore the status filter, so the summary chips can switch between statuses
  const baseWhere = cond.join(" and ");
  const totals = await q.query<{ status: string; n: number; sum: string }>(
    `select c.status, count(*)::int as n, coalesce(sum(c.amount), 0) as sum
     from tz_cheques c left join tz_parties p on p.id = c.party_id where ${baseWhere} group by c.status`,
    params,
  );
  const statuses = (p.status ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (statuses.length) add("c.status = any(?::text[])", `{${statuses.join(",")}}`);
  const where = cond.join(" and ");
  const size = Math.min(500, Math.max(1, Number(p.size) || 50));
  const page = Math.max(1, Number(p.page) || 1);
  const sort = SORTS[p.sort ?? ""];
  const order = sort ? `${sort} ${p.dir === "desc" ? "desc" : "asc"} nulls last, c.created_at` : "c.due_date, c.created_at";
  const head = await q.one<{ n: number; sum: string }>(
    `select count(*)::int as n, coalesce(sum(c.amount), 0) as sum from tz_cheques c left join tz_parties p on p.id = c.party_id where ${where}`,
    params,
  );
  const rows = await q.query<{ direction: string; status: string; due_date: string; ops: number } & Record<string, any>>(
    `select c.id, c.direction, c.sayad_no, c.serial_no, c.bank_name, c.branch_name, c.account_no, c.account_owner, c.party_id,
            c.amount, c.issue_date, c.due_date, c.status, c.bank_account_id, c.cheque_book_id, c.holder_party_id, c.description,
            c.source_type, c.source_id, jsonb_array_length(c.history) as ops,
            (c.history -> (jsonb_array_length(c.history) - 1)) ->> 'date' as last_op_date,
            (c.history -> (jsonb_array_length(c.history) - 1)) ->> 'action' as last_op_action,
            p.name as party_name, p.code as party_code, h.name as holder_name, ba.name as bank_account_name, cb.title as cheque_book_title,
            d.kind as doc_kind, d.no as doc_no, d.date as doc_date
     from tz_cheques c
     left join tz_parties p on p.id = c.party_id
     left join tz_parties h on h.id = c.holder_party_id
     left join tz_bank_accounts ba on ba.id = c.bank_account_id
     left join tz_cheque_books cb on cb.id = c.cheque_book_id
     left join tz_treasury_docs d on d.id = c.source_id and c.source_type = 'treasury_doc'
     where ${where}
     order by ${order}
     limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return {
    today,
    rows: rows.map((r) => decorate(r, today)),
    total: head?.n ?? 0,
    sum: head?.sum ?? "0",
    page,
    size,
    by_status: totals.map((t) => ({ status: t.status, count: t.n, sum: t.sum })),
  };
}

/** Adds overdue flag, days to due date and the operations offered. */
function decorate<T extends { direction: string; status: string; due_date: string; ops?: number | null }>(r: T, today: string) {
  const open = OPEN_STATUSES[r.direction as ChequeDirection]?.includes(r.status) ?? false;
  return {
    ...r,
    open,
    overdue: open && r.due_date < today,
    days: diffDays(r.due_date, today),
    actions: allowedActions({ direction: r.direction, status: r.status, ops: Number(r.ops ?? 0) }),
  };
}

export async function getCheque(q: Queryable, ctx: Ctx, id: string) {
  const today = orgToday(ctx);
  const c = await q.one<Record<string, any>>(
    `select c.*, jsonb_array_length(c.history) as ops, p.name as party_name, p.code as party_code, p.mobile as party_mobile,
            h.name as holder_name, ba.name as bank_account_name, cb.title as cheque_book_title,
            d.kind as doc_kind, d.no as doc_no, d.date as doc_date
     from tz_cheques c
     left join tz_parties p on p.id = c.party_id
     left join tz_parties h on h.id = c.holder_party_id
     left join tz_bank_accounts ba on ba.id = c.bank_account_id
     left join tz_cheque_books cb on cb.id = c.cheque_book_id
     left join tz_treasury_docs d on d.id = c.source_id and c.source_type = 'treasury_doc' and d.deleted_at is null
     where c.id = $1 and c.org_id = $2 and c.deleted_at is null`,
    [id, ctx.org.id],
  );
  if (!c) throw notFound("چک پیدا نشد");
  const ops = opsOf(c as { history: unknown });
  const ids = (k: keyof ChequeOp) => Array.from(new Set(ops.map((o) => o[k]).filter(Boolean) as string[]));
  const arr = (xs: string[]) => `{${xs.join(",")}}`;
  const [vouchers, banks, boxes, parties] = await Promise.all([
    ids("voucher_id").length ? q.query<{ id: string; no: number }>(`select id, no from tz_vouchers where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [ctx.org.id, arr(ids("voucher_id"))]) : [],
    ids("bank_account_id").length ? q.query<{ id: string; name: string }>(`select id, name from tz_bank_accounts where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, arr(ids("bank_account_id"))]) : [],
    ids("cash_box_id").length ? q.query<{ id: string; name: string }>(`select id, name from tz_cash_boxes where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, arr(ids("cash_box_id"))]) : [],
    ids("party_id").length ? q.query<{ id: string; name: string }>(`select id, name from tz_parties where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, arr(ids("party_id"))]) : [],
  ]);
  const name = (rows: { id: string; name?: string; no?: number }[], id?: string | null) => (id ? rows.find((r) => r.id === id) : undefined);
  const history = ops.map((o) => ({
    ...o,
    title: RULES[c.direction as ChequeDirection]?.[o.action]?.title ?? o.action,
    voucher_no: name(vouchers, o.voucher_id)?.no ?? null,
    bank_account_name: name(banks, o.bank_account_id)?.name ?? null,
    cash_box_name: name(boxes, o.cash_box_id)?.name ?? null,
    party_name: name(parties, o.party_id)?.name ?? null,
  }));
  return { ...decorate(c as { direction: string; status: string; due_date: string; ops: number }, today), history };
}

/** The cheque an operation (voucher source `cheque_op`) belongs to. */
export async function chequeByOp(q: Queryable, orgId: string, opId: string) {
  const r = await q.one<{ id: string; direction: string }>(
    `select id, direction from tz_cheques where org_id = $1 and history @> $2::jsonb limit 1`,
    [orgId, JSON.stringify([{ id: opId }])],
  );
  if (!r) throw notFound("عملیات چک پیدا نشد");
  return r;
}

/** First unused serial of a cheque book (when its serials are numeric). */
export async function nextSerial(q: Queryable, orgId: string, bookId: string) {
  const book = await q.one<{ id: string; title: string; serial_from: string | null; serial_to: string | null; sheets: number | null; bank_account_id: string }>(
    `select id, title, serial_from, serial_to, sheets, bank_account_id from tz_cheque_books where id = $1 and org_id = $2 and deleted_at is null`,
    [bookId, orgId],
  );
  if (!book) throw notFound("دسته‌چک پیدا نشد");
  const used = await q.query<{ serial_no: string | null }>(
    `select serial_no from tz_cheques where org_id = $1 and cheque_book_id = $2 and deleted_at is null`,
    [orgId, bookId],
  );
  const set = new Set(used.map((u) => normalizeDigits(u.serial_no ?? "")));
  const from = normalizeDigits(book.serial_from ?? "").trim();
  const to = normalizeDigits(book.serial_to ?? "").trim();
  let serial: string | null = null;
  let sheets: number | null = book.sheets ?? null;
  if (/^\d+$/.test(from)) {
    const start = BigInt(from);
    const end = /^\d+$/.test(to) ? BigInt(to) : start + BigInt(Math.max((book.sheets ?? 0) - 1, 0));
    if (end >= start) sheets = Number(end - start + 1n);
    for (let n = start, i = 0; n <= end && i < 10000; n += 1n, i++) {
      const s = n.toString().padStart(from.length, "0");
      if (!set.has(s)) {
        serial = s;
        break;
      }
    }
  }
  return {
    book_id: book.id,
    bank_account_id: book.bank_account_id,
    serial,
    used: used.length,
    sheets,
    remaining: sheets !== null ? Math.max(sheets - used.length, 0) : null,
  };
}

