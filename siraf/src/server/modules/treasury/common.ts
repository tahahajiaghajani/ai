// Treasury module — shared types, Persian labels and lookups of the master rows a treasury
// document or a cheque operation posts against (cash boxes, bank accounts, POS terminals,
// parties, cheque books, accounts). Every lookup checks the row belongs to the organisation,
// is not deleted, is active and owns its detail account (تفصیلی).
import type { Queryable } from "../../db";
import { bad } from "../../http/errors";
import { faDigits } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";

export type DocKind = "receipt" | "payment" | "transfer";
export type Method = "cash" | "bank" | "pos" | "card" | "cheque" | "other";
export type ChequeDirection = "received" | "issued";

export const DOC_KINDS: DocKind[] = ["receipt", "payment", "transfer"];
export const METHODS: Method[] = ["cash", "bank", "pos", "card", "cheque", "other"];

export const KIND_TITLE: Record<DocKind, string> = { receipt: "دریافت", payment: "پرداخت", transfer: "انتقال وجه" };
export const METHOD_TITLE: Record<Method, string> = {
  cash: "نقد",
  bank: "بانکی",
  pos: "کارتخوان",
  card: "کارت‌به‌کارت",
  cheque: "چک",
  other: "سایر حساب‌ها",
};

/** Payment instruments allowed per document kind. */
export const KIND_METHODS: Record<DocKind, Method[]> = {
  receipt: ["cash", "bank", "pos", "card", "cheque", "other"],
  payment: ["cash", "bank", "card", "cheque", "other"],
  transfer: ["cash", "bank", "card"],
};

/** Status a cheque is registered in by its treasury document. */
export const INITIAL_STATUS: Record<ChequeDirection, string> = { received: "in_hand", issued: "issued" };
/** Statuses of cheques that still wait for their due date (used by due reports and summaries). */
export const OPEN_STATUSES: Record<ChequeDirection, string[]> = { received: ["in_hand", "deposited"], issued: ["issued"] };

export const CHEQUE_STATUS_TITLE: Record<string, string> = {
  in_hand: "نزد صندوق",
  deposited: "در جریان وصول",
  cleared: "وصول‌شده",
  bounced: "برگشتی",
  endorsed: "خرج‌شده",
  returned: "عودت‌شده",
  issued: "صادرشده",
  cancelled: "باطل‌شده",
};

export function chequeStatusTitle(direction: string, status: string): string {
  if (direction === "issued" && status === "cleared") return "پاس‌شده";
  return CHEQUE_STATUS_TITLE[status] ?? status;
}

/** «۱۲۳۴۵۶ بانک ملت» — how a cheque is named in messages and voucher lines. */
export function chequeLabel(c: { serial_no?: string | null; sayad_no?: string | null; bank_name?: string | null }): string {
  const no = c.serial_no || c.sayad_no || "";
  return `چک ${faDigits(no)}${c.bank_name ? ` ${c.bank_name}` : ""}`.trim();
}

export function fa(n: string | number | null | undefined): string {
  return faDigits(n ?? "");
}

export function jdate(iso: string | null | undefined): string {
  return formatJalali(iso ?? null);
}

/** Today in the organisation's time zone. */
export function orgToday(ctx: Ctx): string {
  return todayISO((ctx.org.settings?.timezone as string) || "Asia/Tehran");
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- lookups

export interface BoxRow { deleted_at?: string | null; id: string; code: string; name: string; detail_id: string | null; currency_id: string | null; is_active: boolean }
export interface BankRow {
  deleted_at?: string | null;
  id: string; code: string; name: string; bank_name: string | null; branch_name: string | null; account_no: string | null;
  owner_name: string | null; detail_id: string | null; currency_id: string | null; is_active: boolean;
}
export interface PosRow { deleted_at?: string | null; id: string; name: string; terminal_no: string | null; bank_account_id: string | null; is_active: boolean }
export interface PartyRow { deleted_at?: string | null; id: string; code: string; name: string; detail_id: string | null; is_active: boolean }
export interface BookRow { deleted_at?: string | null; id: string; title: string; bank_account_id: string; serial_from: string | null; serial_to: string | null; sheets: number | null; is_active: boolean }
export interface AccountRow {
  deleted_at?: string | null;
  id: string; code: string; name: string; is_postable: boolean; is_active: boolean;
  detail_mode: "none" | "optional" | "required"; detail_kinds: string[]; fx_mode: string; currency_id: string | null; system_key: string | null;
}

/**
 * Memoised master-data reads for one request. Errors are Persian and name the row (`what`
 * prefixes them, e.g. «ردیف ۲»).
 */
export class Lookups {
  private memo = new Map<string, Promise<unknown>>();
  private base: Promise<string | null> | null = null;
  /** rows an existing document already uses: they stay usable after being deactivated or removed */
  readonly known = new Set<string>();

  constructor(private q: Queryable, private orgId: string) {}

  private active(row: { id: string; is_active: boolean }): boolean {
    return row.is_active || this.known.has(row.id);
  }

  /** a removed row only counts when the document already used it */
  private found<T extends { id: string; deleted_at?: string | null }>(row: T | null): T | null {
    return row && (!row.deleted_at || this.known.has(row.id)) ? row : null;
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.memo.set(key, p);
    }
    return p;
  }

  baseCurrencyId(): Promise<string | null> {
    if (!this.base) {
      this.base = this.q
        .one<{ id: string }>(`select id from tz_currencies where org_id = $1 and is_base and deleted_at is null limit 1`, [this.orgId])
        .then((r) => r?.id ?? null);
    }
    return this.base;
  }

  /** Cash boxes and bank accounts in a foreign currency belong to the FX module. */
  private async baseOnly(row: { name: string; currency_id: string | null }, what: string) {
    if (!row.currency_id) return;
    const base = await this.baseCurrencyId();
    if (base && row.currency_id !== base) throw bad(`${what}«${row.name}» ارزی است؛ دریافت و پرداخت ارزی در بخش صرافی ثبت می‌شود`);
  }

  async box(id: string, what = ""): Promise<BoxRow> {
    const row = this.found(await this.once(`box:${id}`, () =>
      this.q.one<BoxRow>(
        `select id, code, name, detail_id, currency_id, is_active, deleted_at from tz_cash_boxes where id = $1 and org_id = $2`,
        [id, this.orgId],
      ),
    ));
    if (!row) throw bad(`${what}صندوق انتخاب‌شده پیدا نشد`);
    if (!this.active(row)) throw bad(`${what}صندوق «${row.name}» غیرفعال است`);
    if (!row.detail_id) throw bad(`${what}صندوق «${row.name}» حساب تفصیلی ندارد؛ یک بار آن را ویرایش و ذخیره کنید`);
    await this.baseOnly(row, what ? `${what}صندوق ` : "صندوق ");
    return row;
  }

  async bank(id: string, what = ""): Promise<BankRow> {
    const row = this.found(await this.once(`bank:${id}`, () =>
      this.q.one<BankRow>(
        `select id, code, name, bank_name, branch_name, account_no, owner_name, detail_id, currency_id, is_active, deleted_at
         from tz_bank_accounts where id = $1 and org_id = $2`,
        [id, this.orgId],
      ),
    ));
    if (!row) throw bad(`${what}حساب بانکی انتخاب‌شده پیدا نشد`);
    if (!this.active(row)) throw bad(`${what}حساب بانکی «${row.name}» غیرفعال است`);
    if (!row.detail_id) throw bad(`${what}حساب بانکی «${row.name}» حساب تفصیلی ندارد؛ یک بار آن را ویرایش و ذخیره کنید`);
    await this.baseOnly(row, what ? `${what}حساب بانکی ` : "حساب بانکی ");
    return row;
  }

  async pos(id: string, what = ""): Promise<PosRow> {
    const row = this.found(await this.once(`pos:${id}`, () =>
      this.q.one<PosRow>(
        `select id, name, terminal_no, bank_account_id, is_active, deleted_at from tz_pos_terminals where id = $1 and org_id = $2`,
        [id, this.orgId],
      ),
    ));
    if (!row) throw bad(`${what}کارتخوان انتخاب‌شده پیدا نشد`);
    if (!this.active(row)) throw bad(`${what}کارتخوان «${row.name}» غیرفعال است`);
    if (!row.bank_account_id) throw bad(`${what}برای کارتخوان «${row.name}» حساب بانکی تعیین نشده است`);
    return row;
  }

  async party(id: string, what = ""): Promise<PartyRow> {
    const row = this.found(await this.once(`party:${id}`, () =>
      this.q.one<PartyRow>(`select id, code, name, detail_id, is_active, deleted_at from tz_parties where id = $1 and org_id = $2`, [id, this.orgId]),
    ));
    if (!row) throw bad(`${what}شخص انتخاب‌شده پیدا نشد`);
    if (!row.detail_id) throw bad(`${what}«${row.name}» حساب تفصیلی ندارد؛ یک بار پرونده‌ی شخص را ویرایش و ذخیره کنید`);
    return row;
  }

  async book(id: string, what = ""): Promise<BookRow> {
    const row = this.found(await this.once(`book:${id}`, () =>
      this.q.one<BookRow>(
        `select id, title, bank_account_id, serial_from, serial_to, sheets, is_active, deleted_at from tz_cheque_books where id = $1 and org_id = $2`,
        [id, this.orgId],
      ),
    ));
    if (!row) throw bad(`${what}دسته‌چک انتخاب‌شده پیدا نشد`);
    if (!this.active(row)) throw bad(`${what}دسته‌چک «${row.title}» غیرفعال است`);
    return row;
  }

  async account(id: string, what = ""): Promise<AccountRow> {
    const row = this.found(await this.once(`acc:${id}`, () =>
      this.q.one<AccountRow>(
        `select id, code, name, is_postable, is_active, detail_mode, detail_kinds, fx_mode, currency_id, system_key, deleted_at
         from tz_accounts where id = $1 and org_id = $2`,
        [id, this.orgId],
      ),
    ));
    if (!row) throw bad(`${what}حساب انتخاب‌شده پیدا نشد`);
    if (!row.is_postable) throw bad(`${what}حساب «${row.code} ${row.name}» معین نیست؛ یک حساب معین انتخاب کنید`);
    if (!this.active(row)) throw bad(`${what}حساب «${row.name}» غیرفعال است`);
    if (row.fx_mode === "required") throw bad(`${what}حساب «${row.name}» ارزی است و در اسناد ریالی خزانه به کار نمی‌رود`);
    return row;
  }
}

/** Whether a person detail may sit on an account (detail allowed and of kind person). */
export function takesPersonDetail(acc: AccountRow): boolean {
  if (acc.detail_mode === "none") return false;
  const kinds = Array.isArray(acc.detail_kinds) ? acc.detail_kinds : [];
  return !kinds.length || kinds.includes("person");
}
