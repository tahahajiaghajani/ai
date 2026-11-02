// Request schemas of the treasury module (zod). Amounts travel as strings (or numbers, which are
// turned into strings) and are parsed with decimal.js by the services — never as floats.
import { z } from "zod";

const blankToNull = (v: unknown) => (v === "" ? null : v);

export const optUuid = z.preprocess(blankToNull, z.string().uuid("شناسه‌ی انتخاب‌شده معتبر نیست").nullish());
export const reqUuid = (message: string) => z.string({ error: message }).uuid(message);
export const isoDate = z.string({ error: "تاریخ را وارد کنید" }).regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");
export const optDate = z.preprocess(blankToNull, isoDate.nullish());
const optText = (max: number) => z.preprocess(blankToNull, z.string().max(max, `حداکثر ${max} نویسه`).nullish());
const amount = z.union([z.string(), z.number()], { error: "مبلغ را وارد کنید" }).transform((v) => String(v));
const optAmount = z.preprocess(blankToNull, z.union([z.string(), z.number()]).transform((v) => String(v)).nullish());

/** Inline cheque of a receipt (received cheque) or a payment (cheque issued from a cheque book). */
export const chequeSchema = z.object({
  sayad_no: optText(30),
  serial_no: optText(30),
  bank_name: optText(100),
  branch_name: optText(100),
  account_no: optText(40),
  account_owner: optText(150),
  issue_date: optDate,
  due_date: optDate,
  cheque_book_id: optUuid,
  bank_account_id: optUuid,
  /** drawer (received) or payee (issued); defaults to the document's party */
  party_id: optUuid,
  description: optText(500),
});

export const lineSchema = z.object({
  id: optUuid,
  direction: z.enum(["in", "out"]).nullish(),
  method: z.enum(["cash", "bank", "pos", "card", "cheque", "other"], { error: "روش دریافت یا پرداخت را انتخاب کنید" }),
  cash_box_id: optUuid,
  bank_account_id: optUuid,
  pos_id: optUuid,
  account_id: optUuid,
  detail_id: optUuid,
  amount,
  fee: optAmount,
  ref_no: optText(60),
  description: optText(500),
  /** the cheque this line registered before (editing a saved document) */
  cheque_id: optUuid,
  cheque: chequeSchema.nullish(),
});

export const allocSchema = z.object({
  invoice_id: reqUuid("فاکتور را انتخاب کنید"),
  amount,
});

export const docSchema = z.object({
  kind: z.enum(["receipt", "payment", "transfer"], { error: "نوع سند معتبر نیست" }),
  date: isoDate,
  party_id: optUuid,
  /** counter account instead of the party's receivable/payable (e.g. other income, rent expense) */
  account_id: optUuid,
  detail_id: optUuid,
  description: optText(1000),
  lines: z.array(lineSchema).min(1, "سند ردیف ندارد").max(200, "حداکثر ۲۰۰ ردیف"),
  allocs: z.array(allocSchema).max(200).nullish(),
});

export type DocInput = z.infer<typeof docSchema> & { source_type?: string | null; source_id?: string | null };
export type DocLineInput = z.infer<typeof lineSchema>;
export type ChequeInput = z.infer<typeof chequeSchema>;

export const CHEQUE_ACTIONS = ["deposit", "clear", "cash", "bounce", "endorse", "return", "cancel", "undo"] as const;
export type ChequeAction = (typeof CHEQUE_ACTIONS)[number];

export const chequeActionSchema = z.object({
  action: z.enum(CHEQUE_ACTIONS, { error: "عملیات چک معتبر نیست" }),
  date: optDate,
  bank_account_id: optUuid,
  cash_box_id: optUuid,
  party_id: optUuid,
  to_account: z.enum(["ar", "bounced"]).nullish(),
  note: optText(500),
});
export type ChequeActionInput = z.infer<typeof chequeActionSchema>;
