export const KIND_LABEL: Record<string, string> = {
  asset: "دارایی", liability: "بدهی", equity: "حقوق مالکانه", income: "درآمد", expense: "هزینه", memo: "انتظامی", closing: "افتتاحیه/اختتامیه",
};
export const NATURE_LABEL: Record<string, string> = { debit: "بدهکار", credit: "بستانکار", both: "هر دو" };
export const DETAIL_KINDS = [
  { value: "person", label: "اشخاص" }, { value: "cash", label: "صندوق" }, { value: "bank", label: "بانک" }, { value: "wallet", label: "کیف‌پول" },
  { value: "cost_center", label: "مرکز هزینه" }, { value: "project", label: "پروژه" }, { value: "other", label: "سایر" },
];
