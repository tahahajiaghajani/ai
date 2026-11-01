// Editor state of a treasury document: lines as the grid holds them, and their conversion from
// the API's document and back to the save payload. Last used boxes/banks are remembered per
// browser so a cashier's usual box is preselected.
import { uuidv7 } from "@shared/id";
import { D } from "@shared/money";
import type { Opt } from "../../components/inputs";
import type { DocKind, Method } from "./labels";

export interface ChequeFields {
  serial_no: string;
  sayad_no: string;
  bank_name: string;
  branch_name: string;
  account_no: string;
  account_owner: string;
  due_date: string | null;
  cheque_book_id: string | null;
  bank_account_id: string | null;
  party_id: string | null;
}

export interface Line {
  key: string;
  id: string | null;
  direction: "in" | "out";
  method: Method;
  cash_box_id: string | null;
  bank_account_id: string | null;
  pos_id: string | null;
  account_id: string | null;
  account: Opt | null;
  detail_id: string | null;
  amount: string | null;
  fee: string | null;
  ref_no: string;
  description: string;
  cheque_id: string | null;
  cheque: ChequeFields;
  /** status of a saved cheque; locked once it has moved on (deposited, cleared …) */
  status: string | null;
  locked: boolean;
  /** names for the printed slip */
  names: { src?: string; detail?: string; party?: string; book?: string; bank?: string };
}

export const blankCheque = (): ChequeFields => ({
  serial_no: "",
  sayad_no: "",
  bank_name: "",
  branch_name: "",
  account_no: "",
  account_owner: "",
  due_date: null,
  cheque_book_id: null,
  bank_account_id: null,
  party_id: null,
});

// ---------------------------------------------------------------- remembered choices

const MEMO = "taraz.treasury.last";

export function recall(key: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(MEMO) ?? "{}");
    return typeof all[key] === "string" ? all[key] : null;
  } catch {
    return null;
  }
}

export function remember(key: string, value: string | null | undefined) {
  if (!value) return;
  try {
    const all = JSON.parse(localStorage.getItem(MEMO) ?? "{}");
    all[key] = value;
    localStorage.setItem(MEMO, JSON.stringify(all));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

// ---------------------------------------------------------------- lines

export function blankLine(kind: DocKind, method: Method, direction?: "in" | "out"): Line {
  const dir = direction ?? (kind === "payment" ? "out" : "in");
  return {
    key: uuidv7(),
    id: null,
    direction: dir,
    method,
    cash_box_id: method === "cash" ? recall("cash_box") : null,
    bank_account_id: method === "bank" || method === "card" ? recall("bank_account") : null,
    pos_id: method === "pos" ? recall("pos") : null,
    account_id: null,
    account: null,
    detail_id: null,
    amount: null,
    fee: null,
    ref_no: "",
    description: "",
    cheque_id: null,
    cheque: { ...blankCheque(), cheque_book_id: method === "cheque" && dir === "out" ? recall("cheque_book") : null },
    status: null,
    locked: false,
    names: {},
  };
}

/** Switch a line to another method, keeping what still applies. */
export function withMethod(l: Line, method: Method): Line {
  const fresh = blankLine("receipt", method, l.direction);
  return { ...fresh, key: l.key, id: l.id, amount: l.amount, description: l.description, cheque_id: method === "cheque" ? l.cheque_id : null };
}

export function lineFromDoc(l: any): Line {
  const c = l.cheque;
  return {
    key: l.id ?? uuidv7(),
    id: l.id ?? null,
    direction: l.direction,
    method: l.method,
    cash_box_id: l.cash_box_id,
    bank_account_id: l.method === "pos" ? null : l.bank_account_id,
    pos_id: l.pos_id,
    account_id: l.account_id,
    account: l.account_id
      ? { id: l.account_id, label: l.account_name, sub: l.account_code, detail_mode: l.account_detail_mode, detail_kinds: l.account_detail_kinds }
      : null,
    detail_id: l.detail_id,
    amount: l.amount,
    fee: D(l.fee).isZero() ? null : l.fee,
    ref_no: l.ref_no ?? "",
    description: l.description ?? "",
    cheque_id: l.cheque_id,
    cheque: c
      ? {
          serial_no: c.serial_no ?? "",
          sayad_no: c.sayad_no ?? "",
          bank_name: c.bank_name ?? "",
          branch_name: c.branch_name ?? "",
          account_no: c.account_no ?? "",
          account_owner: c.account_owner ?? "",
          due_date: c.due_date,
          cheque_book_id: c.cheque_book_id,
          bank_account_id: c.direction === "issued" ? c.bank_account_id : null,
          party_id: c.party_id,
        }
      : blankCheque(),
    status: c?.status ?? null,
    locked: !!c?.locked,
    names: {
      src: l.cash_box_name ?? l.pos_name ?? l.bank_account_name ?? (l.account_name ? `${l.account_name}` : undefined) ?? c?.cheque_book_title,
      detail: l.detail_name ?? undefined,
      party: c?.party_name ?? undefined,
      book: c?.cheque_book_title ?? undefined,
      bank: c?.bank_account_name ?? undefined,
    },
  };
}

/** A line nobody typed into (the trailing empty row of the grid). */
export function isEmptyLine(l: Line): boolean {
  return !l.amount && !l.ref_no && !l.description && !l.cheque.serial_no && !l.cheque.sayad_no && !l.account_id;
}

export function linePayload(l: Line) {
  const text = (s: string) => s.trim() || null;
  return {
    id: l.id,
    direction: l.direction,
    method: l.method,
    cash_box_id: l.method === "cash" ? l.cash_box_id : null,
    bank_account_id: l.method === "bank" || l.method === "card" ? l.bank_account_id : null,
    pos_id: l.method === "pos" ? l.pos_id : null,
    account_id: l.method === "other" ? l.account_id : null,
    detail_id: l.method === "other" ? l.detail_id : null,
    amount: l.amount ?? "0",
    fee: l.fee,
    ref_no: l.method === "cheque" ? null : text(l.ref_no),
    description: text(l.description),
    cheque_id: l.method === "cheque" ? l.cheque_id : null,
    cheque:
      l.method === "cheque"
        ? {
            serial_no: text(l.cheque.serial_no),
            sayad_no: text(l.cheque.sayad_no),
            bank_name: text(l.cheque.bank_name),
            branch_name: text(l.cheque.branch_name),
            account_no: text(l.cheque.account_no),
            account_owner: text(l.cheque.account_owner),
            due_date: l.cheque.due_date,
            cheque_book_id: l.direction === "out" ? l.cheque.cheque_book_id : null,
            bank_account_id: l.direction === "out" && !l.cheque.cheque_book_id ? l.cheque.bank_account_id : null,
            party_id: l.cheque.party_id,
          }
        : null,
  };
}

export function lineTotals(lines: Line[]) {
  const amount = lines.reduce((a, l) => a.plus(D(l.amount)), D(0));
  const fee = lines.reduce((a, l) => a.plus(D(l.fee)), D(0));
  return { amount, fee };
}
