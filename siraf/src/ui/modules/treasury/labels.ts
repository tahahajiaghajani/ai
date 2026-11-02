// Persian labels and small helpers shared by the treasury screens.

export type DocKind = "receipt" | "payment" | "transfer";
export type Method = "cash" | "bank" | "pos" | "card" | "cheque" | "other";
export type Direction = "received" | "issued";
export type ChequeAction = "deposit" | "clear" | "cash" | "bounce" | "endorse" | "return" | "cancel" | "undo";

export const KIND_TITLE: Record<DocKind, string> = { receipt: "دریافت", payment: "پرداخت", transfer: "انتقال وجه" };
export const KIND_PLURAL: Record<DocKind, string> = { receipt: "دریافت‌ها", payment: "پرداخت‌ها", transfer: "انتقال وجه" };
export const KIND_PATH: Record<DocKind, string> = { receipt: "treasury/receipts", payment: "treasury/payments", transfer: "treasury/transfers" };
export const KIND_SLIP: Record<DocKind, string> = { receipt: "رسید دریافت وجه", payment: "رسید پرداخت وجه", transfer: "سند انتقال وجه" };

export const METHOD_LABEL: Record<Method, string> = {
  cash: "نقد",
  bank: "واریز / حواله بانکی",
  pos: "کارتخوان",
  card: "کارت‌به‌کارت",
  cheque: "چک",
  other: "سایر حساب‌ها",
};
export const METHOD_SHORT: Record<Method, string> = { cash: "نقد", bank: "بانکی", pos: "کارتخوان", card: "کارت", cheque: "چک", other: "سایر" };
export const METHOD_COLOR: Record<Method, string> = { cash: "green", bank: "blue", pos: "cyan", card: "geekblue", cheque: "gold", other: "default" };

export const KIND_METHODS: Record<DocKind, Method[]> = {
  receipt: ["cash", "bank", "pos", "card", "cheque", "other"],
  payment: ["cash", "bank", "card", "cheque", "other"],
  transfer: ["cash", "bank", "card"],
};

/** Status tags of cheques (label, antd color), by direction. */
export function chequeStatusMap(direction: Direction | string): Record<string, [string, string]> {
  return {
    in_hand: ["نزد صندوق", "processing"],
    deposited: ["در جریان وصول", "warning"],
    cleared: [direction === "issued" ? "پاس‌شده" : "وصول‌شده", "success"],
    bounced: ["برگشتی", "error"],
    endorsed: ["خرج‌شده", "purple"],
    returned: ["عودت‌شده", "default"],
    issued: ["صادرشده", "processing"],
    cancelled: ["باطل‌شده", "default"],
  };
}

export const STATUSES: Record<Direction, string[]> = {
  received: ["in_hand", "deposited", "cleared", "bounced", "endorsed", "returned"],
  issued: ["issued", "cleared", "bounced", "cancelled"],
};

export const ACTION_LABEL: Record<Direction, Partial<Record<ChequeAction, string>>> = {
  received: {
    deposit: "واگذاری به بانک",
    clear: "وصول شد",
    cash: "وصول نقدی",
    bounce: "برگشت خورد",
    endorse: "خرج چک (واگذاری به شخص)",
    return: "عودت به صاحب چک",
    undo: "برگشت آخرین عملیات",
  },
  issued: {
    clear: "پاس شد",
    bounce: "برگشت خورد",
    cancel: "ابطال (عودت به ما)",
    undo: "برگشت آخرین عملیات",
  },
};

/** Short title of a recorded operation in the history. */
export const OP_TITLE: Record<Direction, Partial<Record<ChequeAction, string>>> = {
  received: { deposit: "واگذاری به بانک", clear: "وصول", cash: "وصول نقدی", bounce: "برگشت", endorse: "خرج چک", return: "عودت به صاحب چک" },
  issued: { clear: "پاس شدن", bounce: "برگشت", cancel: "ابطال" },
};

/** Common Iranian banks, offered while typing a cheque's bank. */
export const BANKS = [
  "ملی", "ملت", "صادرات", "تجارت", "سپه", "کشاورزی", "مسکن", "رفاه کارگران", "پارسیان", "پاسارگاد", "سامان", "اقتصاد نوین",
  "شهر", "دی", "سینا", "کارآفرین", "خاورمیانه", "سرمایه", "ایران زمین", "گردشگری", "آینده", "توسعه صادرات", "توسعه تعاون",
  "صنعت و معدن", "پست بانک", "قرض‌الحسنه مهر ایران", "قرض‌الحسنه رسالت", "مؤسسه ملل", "نور",
].map((b) => ({ value: b }));

export const isSayad = (s: string | null | undefined) => /^\d{16}$/.test(String(s ?? ""));
