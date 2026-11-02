// Labels, paths and permissions of the goods module's documents (shared by its screens).
import type { Area } from "@shared/permissions";

export type InvoiceKind = "sale" | "purchase" | "sale_return" | "purchase_return" | "quote" | "sale_order" | "purchase_order";
export type StockDocKind = "receipt" | "issue" | "transfer" | "adjust" | "count";

export interface InvoiceMeta {
  title: string;
  plural: string;
  /** list route (relative to /:org/) — the editor is `${path}/new` and `${path}/:id` */
  path: string;
  area: Area;
  party: string;
  role: "customer" | "supplier";
  sale: boolean;
  postable: boolean;
  /** treasury document that settles it (receipt from a customer, payment to a supplier) */
  settle?: "receipt" | "payment";
  color: string;
}

export const INVOICE_META: Record<InvoiceKind, InvoiceMeta> = {
  sale: { title: "فاکتور فروش", plural: "فاکتورهای فروش", path: "sales/invoices", area: "sales", party: "خریدار", role: "customer", sale: true, postable: true, settle: "receipt", color: "cyan" },
  sale_return: { title: "برگشت از فروش", plural: "برگشت از فروش", path: "sales/returns", area: "sales", party: "مشتری", role: "customer", sale: true, postable: true, settle: "payment", color: "orange" },
  quote: { title: "پیش‌فاکتور", plural: "پیش‌فاکتورها", path: "sales/quotes", area: "sales", party: "خریدار", role: "customer", sale: true, postable: false, color: "purple" },
  sale_order: { title: "سفارش فروش", plural: "سفارش‌های فروش", path: "sales/orders", area: "sales", party: "خریدار", role: "customer", sale: true, postable: false, color: "geekblue" },
  purchase: { title: "فاکتور خرید", plural: "فاکتورهای خرید", path: "purchases/invoices", area: "purchases", party: "فروشنده", role: "supplier", sale: false, postable: true, settle: "payment", color: "gold" },
  purchase_return: { title: "برگشت از خرید", plural: "برگشت از خرید", path: "purchases/returns", area: "purchases", party: "فروشنده", role: "supplier", sale: false, postable: true, settle: "receipt", color: "volcano" },
  purchase_order: { title: "سفارش خرید", plural: "سفارش‌های خرید", path: "purchases/orders", area: "purchases", party: "فروشنده", role: "supplier", sale: false, postable: false, color: "lime" },
};

export const INVOICE_KINDS = Object.keys(INVOICE_META) as InvoiceKind[];

export function kindFromPath(pathname: string): InvoiceKind | null {
  for (const k of INVOICE_KINDS) if (pathname.includes(`/${INVOICE_META[k].path}/`) || pathname.endsWith(`/${INVOICE_META[k].path}`)) return k;
  return null;
}

export const RETURN_KIND: Partial<Record<InvoiceKind, InvoiceKind>> = { sale: "sale_return", purchase: "purchase_return" };

export const STOCK_DOC_META: Record<StockDocKind, { title: string; short: string; color: string; hint: string }> = {
  receipt: { title: "رسید انبار", short: "رسید", color: "green", hint: "موجودی اول دوره یا ورود کالا بدون فاکتور" },
  issue: { title: "حواله انبار", short: "حواله", color: "orange", hint: "خروج کالا برای مصرف، نمونه یا ضایعات" },
  transfer: { title: "انتقال بین انبارها", short: "انتقال", color: "blue", hint: "جابه‌جایی کالا از انباری به انبار دیگر" },
  adjust: { title: "تعدیل موجودی", short: "تعدیل", color: "purple", hint: "اصلاح موجودی: مقدار مثبت اضافی و منفی کسری است" },
  count: { title: "انبارگردانی", short: "انبارگردانی", color: "magenta", hint: "شمارش موجودی و ثبت خودکار اختلاف‌ها" },
};

export const STOCK_DOC_KINDS = Object.keys(STOCK_DOC_META) as StockDocKind[];

export const INVOICE_STATUS: Record<string, [string, string]> = {
  draft: ["پیش‌نویس", "default"],
  posted: ["ثبت‌شده", "processing"],
  cancelled: ["ابطال‌شده", "error"],
};

export const SETTLEMENT = [
  { value: "cash", label: "نقدی" },
  { value: "credit", label: "نسیه" },
  { value: "mixed", label: "نقد و نسیه" },
];

export const SOURCE_PATH: Record<string, (kind?: string | null) => string> = {
  invoice: (kind) => INVOICE_META[(kind as InvoiceKind) ?? "sale"]?.path ?? "sales/invoices",
  stock_doc: (kind) => (kind === "count" ? "inventory/count" : "inventory/docs"),
};
