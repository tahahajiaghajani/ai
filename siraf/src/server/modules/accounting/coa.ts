// Standard Iranian chart of accounts (کدینگ استاندارد): گروه (1 digit) → کل (2) → معین (4).
// Detail accounts (تفصیلی شناور) hang under معین accounts that allow them. `key` marks the
// accounts the automatic postings use; module-specific accounts are only created when the
// module is on.
import type { ModuleKey } from "@shared/constants";

export type AccountKind = "asset" | "liability" | "equity" | "income" | "expense" | "memo" | "closing";
export type Nature = "debit" | "credit" | "both";
export type DetailKind = "person" | "cash" | "bank" | "wallet" | "cost_center" | "project" | "other";

export interface CoaEntry {
  code: string;
  name: string;
  kind: AccountKind;
  nature: Nature;
  key?: string;
  detail?: { mode: "optional" | "required"; kinds: DetailKind[] };
  fx?: "optional" | "required";
  weight?: "optional" | "required";
  module?: ModuleKey;
}

const P = (mode: "optional" | "required" = "required"): CoaEntry["detail"] => ({ mode, kinds: ["person"] });

export const COA: CoaEntry[] = [
  // 1 — current assets
  { code: "1", name: "دارایی‌های جاری", kind: "asset", nature: "debit" },
  { code: "11", name: "موجودی نقد و بانک", kind: "asset", nature: "debit" },
  { code: "1101", name: "صندوق", kind: "asset", nature: "debit", key: "cash", detail: { mode: "required", kinds: ["cash"] } },
  { code: "1102", name: "بانک‌ها", kind: "asset", nature: "debit", key: "bank", detail: { mode: "required", kinds: ["bank"] } },
  { code: "1103", name: "تنخواه‌گردان", kind: "asset", nature: "debit", key: "petty_cash", detail: P("optional") },
  { code: "1104", name: "وجوه در راه", kind: "asset", nature: "debit", key: "cash_in_transit" },
  { code: "1110", name: "صندوق ارزی", kind: "asset", nature: "debit", key: "fx_cash", detail: { mode: "required", kinds: ["cash"] }, fx: "required", module: "fx" },
  { code: "1111", name: "حساب‌های بانکی ارزی", kind: "asset", nature: "debit", key: "fx_bank", detail: { mode: "required", kinds: ["bank"] }, fx: "required", module: "fx" },
  { code: "1112", name: "کیف‌پول‌های رمزارز", kind: "asset", nature: "debit", key: "crypto_wallets", detail: { mode: "required", kinds: ["wallet"] }, fx: "required", module: "fx" },
  { code: "12", name: "سرمایه‌گذاری‌های کوتاه‌مدت", kind: "asset", nature: "debit" },
  { code: "1201", name: "سپرده‌های کوتاه‌مدت بانکی", kind: "asset", nature: "debit", detail: { mode: "optional", kinds: ["bank"] } },
  { code: "13", name: "حساب‌ها و اسناد دریافتنی تجاری", kind: "asset", nature: "debit" },
  { code: "1301", name: "حساب‌های دریافتنی تجاری", kind: "asset", nature: "both", key: "ar", detail: P() },
  { code: "1302", name: "اسناد دریافتنی (چک‌های دریافتی)", kind: "asset", nature: "debit", key: "cheques_receivable", detail: P() },
  { code: "1303", name: "اسناد در جریان وصول", kind: "asset", nature: "debit", key: "cheques_in_collection", detail: { mode: "optional", kinds: ["bank"] } },
  { code: "1304", name: "اسناد برگشتی", kind: "asset", nature: "debit", key: "cheques_bounced", detail: P() },
  { code: "14", name: "سایر حساب‌ها و اسناد دریافتنی", kind: "asset", nature: "debit" },
  { code: "1401", name: "سایر حساب‌های دریافتنی", kind: "asset", nature: "both", key: "other_receivables", detail: P("optional") },
  { code: "1402", name: "مالیات بر ارزش افزوده خرید", kind: "asset", nature: "debit", key: "vat_in" },
  { code: "1403", name: "مساعده و علی‌الحساب کارکنان", kind: "asset", nature: "debit", detail: P() },
  { code: "1410", name: "حساب وزنی (طلایی) اشخاص", kind: "asset", nature: "both", key: "gold_parties", detail: P(), weight: "required", module: "gold" },
  { code: "1411", name: "طلای ما نزد کارگاه‌ها", kind: "asset", nature: "debit", key: "gold_at_workshop", detail: P(), weight: "required", module: "gold" },
  { code: "1420", name: "حساب ارزی اشخاص", kind: "asset", nature: "both", key: "fx_parties", detail: P(), fx: "required", module: "fx" },
  { code: "1421", name: "حساب همکاران و کارگزاران", kind: "asset", nature: "both", key: "correspondents", detail: P(), fx: "optional", module: "fx" },
  { code: "15", name: "موجودی مواد و کالا", kind: "asset", nature: "debit" },
  { code: "1501", name: "موجودی کالا", kind: "asset", nature: "debit", key: "inventory" },
  { code: "1502", name: "کالای در راه", kind: "asset", nature: "debit", key: "goods_in_transit" },
  { code: "1510", name: "موجودی مصنوعات طلا", kind: "asset", nature: "debit", key: "gold_inventory", weight: "required", module: "gold" },
  { code: "1511", name: "موجودی طلای آبشده", kind: "asset", nature: "debit", key: "gold_bullion", weight: "required", module: "gold" },
  { code: "1512", name: "موجودی طلای مستعمل و شکسته", kind: "asset", nature: "debit", key: "gold_old", weight: "required", module: "gold" },
  { code: "1513", name: "موجودی سکه", kind: "asset", nature: "debit", key: "coin_inventory", module: "gold" },
  { code: "1514", name: "موجودی سنگ و جواهر", kind: "asset", nature: "debit", key: "stone_inventory", module: "gold" },
  { code: "16", name: "سفارش‌ها و پیش‌پرداخت‌ها", kind: "asset", nature: "debit" },
  { code: "1601", name: "پیش‌پرداخت خرید", kind: "asset", nature: "debit", key: "supplier_advances", detail: P() },
  { code: "1602", name: "پیش‌پرداخت هزینه‌ها", kind: "asset", nature: "debit" },

  // 2 — non-current assets
  { code: "2", name: "دارایی‌های غیرجاری", kind: "asset", nature: "debit" },
  { code: "21", name: "دارایی‌های ثابت مشهود", kind: "asset", nature: "debit" },
  { code: "2101", name: "زمین", kind: "asset", nature: "debit" },
  { code: "2102", name: "ساختمان", kind: "asset", nature: "debit" },
  { code: "2103", name: "وسایط نقلیه", kind: "asset", nature: "debit" },
  { code: "2104", name: "اثاثیه و منصوبات", kind: "asset", nature: "debit" },
  { code: "2105", name: "ماشین‌آلات و تجهیزات", kind: "asset", nature: "debit" },
  { code: "2106", name: "رایانه و تجهیزات اداری", kind: "asset", nature: "debit" },
  { code: "22", name: "استهلاک انباشته", kind: "asset", nature: "credit" },
  { code: "2201", name: "استهلاک انباشته ساختمان", kind: "asset", nature: "credit" },
  { code: "2202", name: "استهلاک انباشته وسایط نقلیه", kind: "asset", nature: "credit" },
  { code: "2203", name: "استهلاک انباشته اثاثیه و منصوبات", kind: "asset", nature: "credit" },
  { code: "2204", name: "استهلاک انباشته ماشین‌آلات و تجهیزات", kind: "asset", nature: "credit" },
  { code: "23", name: "دارایی‌های نامشهود", kind: "asset", nature: "debit" },
  { code: "2301", name: "سرقفلی", kind: "asset", nature: "debit" },
  { code: "2302", name: "نرم‌افزار و حق امتیاز", kind: "asset", nature: "debit" },
  { code: "24", name: "سرمایه‌گذاری‌ها و سپرده‌های بلندمدت", kind: "asset", nature: "debit" },
  { code: "2401", name: "سپرده‌های بلندمدت", kind: "asset", nature: "debit" },
  { code: "2402", name: "ودیعه‌ها", kind: "asset", nature: "debit", detail: P("optional") },

  // 3 — current liabilities
  { code: "3", name: "بدهی‌های جاری", kind: "liability", nature: "credit" },
  { code: "31", name: "حساب‌ها و اسناد پرداختنی تجاری", kind: "liability", nature: "credit" },
  { code: "3101", name: "حساب‌های پرداختنی تجاری", kind: "liability", nature: "both", key: "ap", detail: P() },
  { code: "3102", name: "اسناد پرداختنی (چک‌های پرداختی)", kind: "liability", nature: "credit", key: "cheques_payable", detail: P() },
  { code: "32", name: "سایر حساب‌ها و اسناد پرداختنی", kind: "liability", nature: "credit" },
  { code: "3201", name: "سایر حساب‌های پرداختنی", kind: "liability", nature: "both", key: "other_payables", detail: P("optional") },
  { code: "3202", name: "مالیات بر ارزش افزوده فروش", kind: "liability", nature: "credit", key: "vat_out" },
  { code: "3203", name: "حقوق و دستمزد پرداختنی", kind: "liability", nature: "credit", detail: P("optional") },
  { code: "3204", name: "حق بیمه پرداختنی", kind: "liability", nature: "credit" },
  { code: "3205", name: "مالیات حقوق پرداختنی", kind: "liability", nature: "credit" },
  { code: "3206", name: "ذخیره مالیات بر درآمد", kind: "liability", nature: "credit", key: "income_tax" },
  { code: "3210", name: "حواله‌های ارزی پرداختنی", kind: "liability", nature: "credit", key: "remittances_payable", detail: P("optional"), fx: "required", module: "fx" },
  { code: "33", name: "پیش‌دریافت‌ها", kind: "liability", nature: "credit" },
  { code: "3301", name: "پیش‌دریافت از مشتریان", kind: "liability", nature: "credit", key: "customer_advances", detail: P() },
  { code: "34", name: "تسهیلات مالی کوتاه‌مدت", kind: "liability", nature: "credit" },
  { code: "3401", name: "وام‌ها و تسهیلات کوتاه‌مدت", kind: "liability", nature: "credit", detail: { mode: "optional", kinds: ["bank"] } },

  // 4 — non-current liabilities
  { code: "4", name: "بدهی‌های غیرجاری", kind: "liability", nature: "credit" },
  { code: "41", name: "تسهیلات مالی بلندمدت", kind: "liability", nature: "credit" },
  { code: "4101", name: "وام‌ها و تسهیلات بلندمدت", kind: "liability", nature: "credit", detail: { mode: "optional", kinds: ["bank"] } },
  { code: "42", name: "ذخایر", kind: "liability", nature: "credit" },
  { code: "4201", name: "ذخیره مزایای پایان خدمت کارکنان", kind: "liability", nature: "credit" },

  // 5 — equity
  { code: "5", name: "حقوق مالکانه", kind: "equity", nature: "credit" },
  { code: "51", name: "سرمایه", kind: "equity", nature: "credit" },
  { code: "5101", name: "سرمایه", kind: "equity", nature: "credit", key: "capital", detail: P("optional") },
  { code: "52", name: "اندوخته‌ها", kind: "equity", nature: "credit" },
  { code: "5201", name: "اندوخته قانونی", kind: "equity", nature: "credit" },
  { code: "53", name: "سود (زیان) انباشته", kind: "equity", nature: "credit" },
  { code: "5301", name: "سود (زیان) انباشته", kind: "equity", nature: "both", key: "retained_earnings" },
  { code: "5302", name: "سود (زیان) سال جاری", kind: "equity", nature: "both", key: "current_pl" },
  { code: "54", name: "حساب جاری شرکا", kind: "equity", nature: "both" },
  { code: "5401", name: "حساب جاری شرکا", kind: "equity", nature: "both", key: "partners_current", detail: P() },
  { code: "5402", name: "برداشت", kind: "equity", nature: "debit", key: "drawings", detail: P("optional") },

  // 6 — income
  { code: "6", name: "درآمدها", kind: "income", nature: "credit" },
  { code: "61", name: "فروش و درآمدهای عملیاتی", kind: "income", nature: "credit" },
  { code: "6101", name: "فروش کالا", kind: "income", nature: "credit", key: "sales" },
  { code: "6102", name: "درآمد ارائه‌ی خدمات", kind: "income", nature: "credit", key: "service_income" },
  { code: "6103", name: "اضافات فاکتور (حمل، بسته‌بندی و …)", kind: "income", nature: "credit", key: "invoice_additions" },
  { code: "6110", name: "فروش طلا (ارزش طلا)", kind: "income", nature: "credit", key: "gold_sales", module: "gold" },
  { code: "6111", name: "درآمد اجرت ساخت", kind: "income", nature: "credit", key: "gold_wage_income", module: "gold" },
  { code: "6112", name: "سود فروش طلا", kind: "income", nature: "credit", key: "gold_profit_income", module: "gold" },
  { code: "6113", name: "فروش سنگ و جواهر", kind: "income", nature: "credit", key: "stone_sales", module: "gold" },
  { code: "6114", name: "فروش سکه", kind: "income", nature: "credit", key: "coin_sales", module: "gold" },
  { code: "6120", name: "سود (زیان) معاملات ارز", kind: "income", nature: "both", key: "fx_trading_gain", module: "fx" },
  { code: "6121", name: "درآمد کارمزد", kind: "income", nature: "credit", key: "fx_commission", module: "fx" },
  { code: "6122", name: "سود (زیان) تسعیر ارز", kind: "income", nature: "both", key: "fx_revaluation", module: "fx" },
  { code: "62", name: "برگشت از فروش و تخفیفات", kind: "income", nature: "debit" },
  { code: "6201", name: "برگشت از فروش", kind: "income", nature: "debit", key: "sales_returns" },
  { code: "6202", name: "تخفیفات فروش", kind: "income", nature: "debit", key: "sales_discounts" },
  { code: "63", name: "سایر درآمدها", kind: "income", nature: "credit" },
  { code: "6301", name: "درآمدهای متفرقه", kind: "income", nature: "credit", key: "other_income" },
  { code: "6302", name: "سود سپرده‌های بانکی", kind: "income", nature: "credit" },
  { code: "6303", name: "سود فروش دارایی ثابت", kind: "income", nature: "credit" },
  { code: "6304", name: "اضافی انبار", kind: "income", nature: "credit", key: "inventory_gain" },
  { code: "6305", name: "تخفیفات خرید", kind: "income", nature: "credit", key: "purchase_discounts" },
  { code: "6306", name: "سود (زیان) گرد کردن مبالغ", kind: "income", nature: "both", key: "rounding" },
  { code: "6307", name: "اضافه وزن طلا", kind: "income", nature: "credit", key: "gold_gain", weight: "optional", module: "gold" },

  // 7 — cost of sales and expenses
  { code: "7", name: "بهای تمام‌شده و هزینه‌ها", kind: "expense", nature: "debit" },
  { code: "71", name: "بهای تمام‌شده", kind: "expense", nature: "debit" },
  { code: "7101", name: "بهای تمام‌شده کالای فروش‌رفته", kind: "expense", nature: "debit", key: "cogs" },
  { code: "7110", name: "بهای تمام‌شده طلای فروش‌رفته", kind: "expense", nature: "debit", key: "gold_cogs", module: "gold" },
  { code: "7111", name: "اجرت ساخت پرداختی", kind: "expense", nature: "debit", key: "gold_wage_expense", module: "gold" },
  { code: "7112", name: "افت و کسری طلا", kind: "expense", nature: "debit", key: "gold_loss", weight: "optional", module: "gold" },
  { code: "7113", name: "بهای تمام‌شده سکه‌ی فروش‌رفته", kind: "expense", nature: "debit", key: "coin_cogs", module: "gold" },
  { code: "72", name: "هزینه‌های عمومی، اداری و فروش", kind: "expense", nature: "debit" },
  { code: "7201", name: "حقوق و دستمزد", kind: "expense", nature: "debit", key: "salary_expense", detail: { mode: "optional", kinds: ["cost_center", "person"] } },
  { code: "7202", name: "اجاره", kind: "expense", nature: "debit", detail: { mode: "optional", kinds: ["cost_center"] } },
  { code: "7203", name: "آب، برق، گاز و تلفن", kind: "expense", nature: "debit", detail: { mode: "optional", kinds: ["cost_center"] } },
  { code: "7204", name: "ملزومات و لوازم مصرفی", kind: "expense", nature: "debit", detail: { mode: "optional", kinds: ["cost_center"] } },
  { code: "7205", name: "تعمیر و نگهداری", kind: "expense", nature: "debit", detail: { mode: "optional", kinds: ["cost_center"] } },
  { code: "7206", name: "حمل و نقل", kind: "expense", nature: "debit", key: "freight_expense", detail: { mode: "optional", kinds: ["cost_center"] } },
  { code: "7207", name: "تبلیغات و بازاریابی", kind: "expense", nature: "debit", detail: { mode: "optional", kinds: ["cost_center", "project"] } },
  { code: "7208", name: "پذیرایی و آبدارخانه", kind: "expense", nature: "debit" },
  { code: "7209", name: "هزینه‌ی استهلاک", kind: "expense", nature: "debit" },
  { code: "7210", name: "بیمه‌ی دارایی‌ها", kind: "expense", nature: "debit" },
  { code: "7211", name: "هزینه‌های متفرقه", kind: "expense", nature: "debit", key: "misc_expense", detail: { mode: "optional", kinds: ["cost_center", "project"] } },
  { code: "7220", name: "کارمزد شبکه و انتقال رمزارز", kind: "expense", nature: "debit", key: "network_fees", module: "fx" },
  { code: "7221", name: "کارمزد همکاران و کارگزاران", kind: "expense", nature: "debit", key: "correspondent_fees", module: "fx" },
  { code: "73", name: "هزینه‌های مالی", kind: "expense", nature: "debit" },
  { code: "7301", name: "کارمزد و هزینه‌های بانکی", kind: "expense", nature: "debit", key: "bank_fees", detail: { mode: "optional", kinds: ["bank"] } },
  { code: "7302", name: "سود و کارمزد تسهیلات", kind: "expense", nature: "debit" },
  { code: "74", name: "سایر هزینه‌ها", kind: "expense", nature: "debit" },
  { code: "7401", name: "کسری انبار", kind: "expense", nature: "debit", key: "inventory_loss" },
  { code: "7402", name: "مطالبات سوخت‌شده", kind: "expense", nature: "debit", detail: P("optional") },

  // 8 — memorandum accounts
  { code: "8", name: "حساب‌های انتظامی", kind: "memo", nature: "debit" },
  { code: "81", name: "حساب‌های انتظامی", kind: "memo", nature: "debit" },
  { code: "8101", name: "اسناد تضمینی ما نزد دیگران", kind: "memo", nature: "debit", detail: P("optional") },
  { code: "8102", name: "کالای امانی نزد ما", kind: "memo", nature: "debit", key: "consign_in_memo", detail: P("optional") },
  { code: "8103", name: "طلای امانی نزد ما", kind: "memo", nature: "debit", key: "gold_consign_memo", detail: P("optional"), weight: "required", module: "gold" },
  { code: "82", name: "طرف حساب‌های انتظامی", kind: "memo", nature: "credit" },
  { code: "8201", name: "طرف اسناد تضمینی", kind: "memo", nature: "credit", detail: P("optional") },
  { code: "8202", name: "طرف کالای امانی", kind: "memo", nature: "credit", key: "consign_in_contra", detail: P("optional") },
  { code: "8203", name: "طرف طلای امانی", kind: "memo", nature: "credit", key: "gold_consign_contra", detail: P("optional"), weight: "required", module: "gold" },

  // 9 — opening / closing
  { code: "9", name: "حساب‌های افتتاحیه و اختتامیه", kind: "closing", nature: "both" },
  { code: "91", name: "ترازها", kind: "closing", nature: "both" },
  { code: "9101", name: "تراز افتتاحیه", kind: "closing", nature: "both", key: "opening_balance" },
  { code: "9102", name: "تراز اختتامیه", kind: "closing", nature: "both", key: "closing_balance" },
  { code: "9103", name: "خلاصه سود و زیان", kind: "closing", nature: "both", key: "pl_summary" },
];

export function coaFor(modules: ModuleKey[]): CoaEntry[] {
  return COA.filter((a) => !a.module || modules.includes(a.module));
}

export function levelOfCode(code: string): 1 | 2 | 3 {
  return code.length === 1 ? 1 : code.length === 2 ? 2 : 3;
}

export function parentCode(code: string): string | null {
  if (code.length === 1) return null;
  if (code.length === 2) return code.slice(0, 1);
  return code.slice(0, 2);
}
