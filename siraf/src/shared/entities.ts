// Master-data entities described once and used everywhere: the server validates and stores
// them through one generic CRUD, the UI builds list pages and forms from the same fields.
import type { Area } from "./permissions";
import type { ModuleKey } from "./constants";

export type FieldType =
  | "text" | "textarea" | "int" | "decimal" | "money" | "pct" | "weight" | "bool" | "date"
  | "select" | "multiselect" | "ref" | "json" | "image" | "code";

export interface Option {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Option[];
  ref?: string; // entity key for "ref"
  refFilter?: Record<string, string>;
  default?: unknown;
  list?: boolean; // column in the list table
  search?: boolean; // matched by the search box
  filter?: boolean; // offered as a list filter
  format?: "nationalId" | "iban" | "card" | "mobile" | "email" | "postal" | "economic" | "sayad" | "taxGoodsId";
  maxLength?: number;
  span?: 6 | 8 | 12 | 16 | 18 | 24; // form grid span (of 24)
  section?: string;
  help?: string;
  ltr?: boolean;
  hidden?: boolean; // stored but not shown in forms
  readonly?: boolean;
  modules?: ModuleKey[];
}

export interface EntityDef {
  key: string;
  table: string;
  title: string;
  plural: string;
  area: Area;
  modules?: ModuleKey[];
  fields: FieldDef[];
  display: string;
  sub?: string;
  code?: { field: string; start: number };
  order: string;
  icon?: string;
  /** detail account (تفصیلی) kind created for every row */
  detail?: "person" | "cash" | "bank" | "wallet" | "cost_center" | "project" | "other";
}

export const PARTY_ROLES: Option[] = [
  { value: "customer", label: "مشتری" },
  { value: "supplier", label: "تأمین‌کننده" },
  { value: "employee", label: "کارمند" },
  { value: "partner", label: "شریک" },
  { value: "broker", label: "بازاریاب / واسطه" },
  { value: "correspondent", label: "همکار صرافی / کارگزار" },
  { value: "workshop", label: "کارگاه / سازنده طلا" },
  { value: "wholesaler", label: "بنکدار / همکار طلا" },
];

export const CHAINS: Option[] = [
  { value: "TRON", label: "TRON (TRC20)" },
  { value: "ETH", label: "Ethereum (ERC20)" },
  { value: "BSC", label: "BNB Smart Chain (BEP20)" },
  { value: "BTC", label: "Bitcoin" },
  { value: "SOL", label: "Solana" },
  { value: "TON", label: "TON" },
  { value: "POLYGON", label: "Polygon" },
  { value: "ARBITRUM", label: "Arbitrum One" },
  { value: "BASE", label: "Base" },
  { value: "LTC", label: "Litecoin" },
  { value: "DOGE", label: "Dogecoin" },
];

export const WAGE_TYPES: Option[] = [
  { value: "percent", label: "درصد از ارزش طلا" },
  { value: "per_gram", label: "مبلغ به ازای هر گرم" },
  { value: "fixed", label: "مبلغ ثابت" },
];

const active: FieldDef = { name: "is_active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 };
const code = (start = 1): FieldDef => ({ name: "code", label: "کد", type: "code", list: true, search: true, span: 6, ltr: true, help: `خالی بگذارید تا خودکار پر شود (از ${start})` });

export const ENTITIES: Record<string, EntityDef> = {
  party_group: {
    key: "party_group", table: "tz_party_groups", title: "گروه اشخاص", plural: "گروه‌های اشخاص", area: "parties",
    display: "name", order: "name",
    fields: [
      { name: "name", label: "نام گروه", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "discount_pct", label: "تخفیف پیش‌فرض", type: "pct", list: true, span: 6 },
      { name: "price_list_id", label: "فهرست قیمت", type: "ref", ref: "price_list", span: 6, modules: ["goods"] },
      { name: "description", label: "توضیحات", type: "textarea", span: 24 },
    ],
  },
  party: {
    key: "party", table: "tz_parties", title: "شخص", plural: "اشخاص", area: "parties", icon: "team",
    display: "name", sub: "code", code: { field: "code", start: 1001 }, order: "code", detail: "person",
    fields: [
      code(1001),
      { name: "kind", label: "نوع", type: "select", required: true, default: "person", span: 6, list: true, filter: true, options: [{ value: "person", label: "حقیقی" }, { value: "company", label: "حقوقی" }] },
      { name: "name", label: "نام نمایشی", type: "text", required: true, list: true, search: true, span: 12, help: "نام کامل شخص یا شرکت" },
      { name: "roles", label: "نقش‌ها", type: "multiselect", options: PARTY_ROLES, default: ["customer"], list: true, filter: true, span: 12 },
      { name: "group_id", label: "گروه", type: "ref", ref: "party_group", span: 6, filter: true },
      { name: "mobile", label: "موبایل", type: "text", format: "mobile", list: true, search: true, span: 6, ltr: true },
      { name: "first_name", label: "نام", type: "text", span: 6, section: "هویت" },
      { name: "last_name", label: "نام خانوادگی", type: "text", span: 6, section: "هویت" },
      { name: "father_name", label: "نام پدر", type: "text", span: 6, section: "هویت" },
      { name: "company_name", label: "نام شرکت", type: "text", span: 6, section: "هویت" },
      { name: "national_id", label: "کد ملی / شناسه ملی", type: "text", format: "nationalId", search: true, span: 6, ltr: true, section: "هویت" },
      { name: "economic_code", label: "کد اقتصادی", type: "text", format: "economic", span: 6, ltr: true, section: "هویت" },
      { name: "registration_no", label: "شماره ثبت", type: "text", span: 6, ltr: true, section: "هویت" },
      { name: "birth_date", label: "تاریخ تولد", type: "date", span: 6, section: "هویت" },
      { name: "nationality", label: "ملیت", type: "text", span: 6, section: "احراز هویت (KYC)", default: "ایران" },
      { name: "passport_no", label: "شماره گذرنامه", type: "text", span: 6, ltr: true, section: "احراز هویت (KYC)" },
      { name: "id_doc_type", label: "نوع مدرک", type: "select", span: 6, section: "احراز هویت (KYC)", options: [
        { value: "national_card", label: "کارت ملی" }, { value: "passport", label: "گذرنامه" }, { value: "residence", label: "کارت اقامت" }, { value: "license", label: "گواهینامه" }, { value: "other", label: "سایر" },
      ] },
      { name: "id_doc_no", label: "شماره مدرک", type: "text", span: 6, ltr: true, section: "احراز هویت (KYC)" },
      { name: "id_doc_expiry", label: "انقضای مدرک", type: "date", span: 6, section: "احراز هویت (KYC)" },
      { name: "kyc_status", label: "وضعیت احراز", type: "select", default: "none", span: 6, section: "احراز هویت (KYC)", filter: true, options: [
        { value: "none", label: "ثبت نشده" }, { value: "pending", label: "در انتظار بررسی" }, { value: "verified", label: "تأیید شده" }, { value: "rejected", label: "رد شده" },
      ] },
      { name: "phone", label: "تلفن", type: "text", span: 6, ltr: true, section: "تماس" },
      { name: "email", label: "ایمیل", type: "text", format: "email", span: 6, ltr: true, section: "تماس" },
      { name: "province", label: "استان", type: "text", span: 6, section: "تماس" },
      { name: "city", label: "شهر", type: "text", span: 6, section: "تماس" },
      { name: "postal_code", label: "کد پستی", type: "text", format: "postal", span: 6, ltr: true, section: "تماس" },
      { name: "address", label: "نشانی", type: "textarea", span: 18, section: "تماس" },
      { name: "credit_limit", label: "سقف اعتبار", type: "money", span: 6, section: "مالی" },
      { name: "discount_pct", label: "تخفیف ویژه", type: "pct", span: 6, section: "مالی" },
      { name: "price_list_id", label: "فهرست قیمت", type: "ref", ref: "price_list", span: 6, section: "مالی", modules: ["goods"] },
      { name: "bank_name", label: "بانک", type: "text", span: 6, section: "مالی" },
      { name: "iban", label: "شماره شبا", type: "text", format: "iban", span: 12, ltr: true, section: "مالی" },
      { name: "card_no", label: "شماره کارت", type: "text", format: "card", span: 12, ltr: true, section: "مالی" },
      { name: "tags", label: "برچسب‌ها", type: "multiselect", options: [], span: 12, section: "سایر" },
      { name: "is_blacklisted", label: "فهرست سیاه", type: "bool", span: 6, section: "سایر", filter: true },
      { ...active, section: "سایر" },
      { name: "notes", label: "یادداشت", type: "textarea", span: 24, section: "سایر" },
    ],
  },
  cash_box: {
    key: "cash_box", table: "tz_cash_boxes", title: "صندوق", plural: "صندوق‌ها", area: "treasury", icon: "wallet",
    display: "name", sub: "code", code: { field: "code", start: 1 }, order: "code", detail: "cash",
    fields: [
      code(1),
      { name: "name", label: "نام صندوق", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "currency_id", label: "ارز (خالی = چندارزی)", type: "ref", ref: "currency", span: 6, list: true },
      { name: "keeper_id", label: "صندوقدار", type: "ref", ref: "party", refFilter: { role: "employee" }, span: 12 },
      active,
      { name: "description", label: "توضیحات", type: "textarea", span: 24 },
    ],
  },
  bank_account: {
    key: "bank_account", table: "tz_bank_accounts", title: "حساب بانکی", plural: "حساب‌های بانکی", area: "treasury", icon: "bank",
    display: "name", sub: "account_no", code: { field: "code", start: 1 }, order: "code", detail: "bank",
    fields: [
      code(1),
      { name: "name", label: "عنوان حساب", type: "text", required: true, list: true, search: true, span: 12, help: "مثلاً «ملت جاری شعبه مرکزی»" },
      { name: "bank_name", label: "بانک", type: "text", list: true, span: 6 },
      { name: "branch_name", label: "شعبه", type: "text", span: 6 },
      { name: "branch_code", label: "کد شعبه", type: "text", span: 6, ltr: true },
      { name: "account_no", label: "شماره حساب", type: "text", list: true, search: true, span: 6, ltr: true },
      { name: "account_type", label: "نوع حساب", type: "select", default: "current", span: 6, options: [
        { value: "current", label: "جاری" }, { value: "savings", label: "پس‌انداز / کوتاه‌مدت" }, { value: "long", label: "سپرده بلندمدت" }, { value: "loan", label: "تسهیلات" },
      ] },
      { name: "iban", label: "شماره شبا", type: "text", format: "iban", span: 12, ltr: true },
      { name: "card_no", label: "شماره کارت", type: "text", format: "card", span: 12, ltr: true },
      { name: "owner_name", label: "صاحب حساب", type: "text", span: 12 },
      { name: "currency_id", label: "ارز (خالی = ارز پایه)", type: "ref", ref: "currency", span: 6 },
      active,
      { name: "description", label: "توضیحات", type: "textarea", span: 24 },
    ],
  },
  pos_terminal: {
    key: "pos_terminal", table: "tz_pos_terminals", title: "کارتخوان", plural: "کارتخوان‌ها", area: "treasury",
    display: "name", sub: "terminal_no", order: "name",
    fields: [
      { name: "name", label: "نام", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "terminal_no", label: "شماره پایانه", type: "text", list: true, span: 6, ltr: true },
      { name: "provider", label: "شرکت PSP", type: "text", span: 6 },
      { name: "bank_account_id", label: "حساب بانکی متصل", type: "ref", ref: "bank_account", required: true, list: true, span: 12 },
      active,
    ],
  },
  cheque_book: {
    key: "cheque_book", table: "tz_cheque_books", title: "دسته‌چک", plural: "دسته‌چک‌ها", area: "treasury",
    display: "title", order: "title",
    fields: [
      { name: "bank_account_id", label: "حساب بانکی", type: "ref", ref: "bank_account", required: true, list: true, span: 12 },
      { name: "title", label: "عنوان", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "serial_from", label: "از سریال", type: "text", span: 6, ltr: true, list: true },
      { name: "serial_to", label: "تا سریال", type: "text", span: 6, ltr: true, list: true },
      { name: "sheets", label: "تعداد برگ", type: "int", span: 6 },
      { name: "received_at", label: "تاریخ دریافت", type: "date", span: 6 },
      active,
    ],
  },
  unit: {
    key: "unit", table: "tz_units", title: "واحد", plural: "واحدهای اندازه‌گیری", area: "inventory",
    display: "name", order: "name",
    fields: [
      { name: "name", label: "نام واحد", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "decimals", label: "تعداد اعشار مقدار", type: "int", default: 0, list: true, span: 6 },
    ],
  },
  item_category: {
    key: "item_category", table: "tz_item_categories", title: "گروه کالا", plural: "گروه‌های کالا", area: "inventory", modules: ["goods"],
    display: "name", order: "name",
    fields: [
      { name: "name", label: "نام گروه", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "code", label: "کد", type: "text", span: 6, list: true, ltr: true },
      { name: "parent_id", label: "گروه بالاتر", type: "ref", ref: "item_category", span: 6, list: true },
      { name: "inventory_account_id", label: "حساب موجودی (اختیاری)", type: "ref", ref: "account", span: 8, section: "حساب‌ها" },
      { name: "sales_account_id", label: "حساب فروش (اختیاری)", type: "ref", ref: "account", span: 8, section: "حساب‌ها" },
      { name: "cogs_account_id", label: "حساب بهای تمام‌شده (اختیاری)", type: "ref", ref: "account", span: 8, section: "حساب‌ها" },
    ],
  },
  item: {
    key: "item", table: "tz_items", title: "کالا / خدمت", plural: "کالاها و خدمات", area: "inventory", icon: "shopping",
    display: "name", sub: "code", code: { field: "code", start: 10001 }, order: "code",
    fields: [
      code(10001),
      { name: "kind", label: "نوع", type: "select", required: true, default: "goods", span: 6, list: true, filter: true, options: [
        { value: "goods", label: "کالا" }, { value: "service", label: "خدمت" }, { value: "coin", label: "سکه" }, { value: "bar", label: "مدل شمش" },
      ] },
      { name: "name", label: "نام", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "category_id", label: "گروه", type: "ref", ref: "item_category", span: 6, list: true, filter: true },
      { name: "unit_id", label: "واحد اصلی", type: "ref", ref: "unit", span: 6, list: true },
      { name: "barcode", label: "بارکد", type: "text", span: 6, ltr: true, search: true },
      { name: "sku", label: "کد کالا نزد تأمین‌کننده / SKU", type: "text", span: 6, ltr: true, search: true },
      { name: "sale_price", label: "قیمت فروش", type: "money", span: 6, list: true, section: "قیمت و مالیات" },
      { name: "purchase_price", label: "قیمت خرید", type: "money", span: 6, section: "قیمت و مالیات" },
      { name: "min_sale_price", label: "کمترین قیمت مجاز فروش", type: "money", span: 6, section: "قیمت و مالیات" },
      { name: "vat_pct", label: "مالیات بر ارزش افزوده (٪)", type: "pct", span: 6, section: "قیمت و مالیات", help: "خالی = نرخ پیش‌فرض کسب‌وکار" },
      { name: "tax_goods_id", label: "شناسه کالا/خدمت (سامانه مؤدیان)", type: "text", format: "taxGoodsId", span: 12, ltr: true, section: "قیمت و مالیات" },
      { name: "unit2_id", label: "واحد فرعی", type: "ref", ref: "unit", span: 6, section: "انبار" },
      { name: "unit2_factor", label: "هر واحد فرعی چند واحد اصلی", type: "decimal", span: 6, section: "انبار" },
      { name: "track_mode", label: "ردیابی", type: "select", default: "none", span: 6, section: "انبار", options: [
        { value: "none", label: "ندارد" }, { value: "batch", label: "سری ساخت / انقضا" }, { value: "serial", label: "شماره سریال" },
      ] },
      { name: "allow_negative", label: "فروش بیش از موجودی مجاز", type: "bool", span: 6, section: "انبار" },
      { name: "min_stock", label: "حداقل موجودی", type: "decimal", span: 6, section: "انبار" },
      { name: "reorder_point", label: "نقطه‌ی سفارش", type: "decimal", span: 6, section: "انبار" },
      { name: "max_stock", label: "حداکثر موجودی", type: "decimal", span: 6, section: "انبار" },
      { name: "gold_weight", label: "وزن طلا (گرم)", type: "weight", span: 6, section: "سکه و طلا", modules: ["gold"] },
      { name: "fineness", label: "عیار (در هزار)", type: "decimal", span: 6, section: "سکه و طلا", modules: ["gold"] },
      { name: "brand", label: "برند", type: "text", span: 6, section: "سایر" },
      { name: "model", label: "مدل", type: "text", span: 6, section: "سایر" },
      { name: "weight", label: "وزن کالا (کیلوگرم)", type: "decimal", span: 6, section: "سایر" },
      { ...active, section: "سایر" },
      { name: "image", label: "تصویر", type: "image", span: 24, section: "سایر" },
      { name: "description", label: "توضیحات", type: "textarea", span: 24, section: "سایر" },
      { name: "inventory_account_id", label: "حساب موجودی", type: "ref", ref: "account", span: 8, section: "حساب‌ها (اختیاری)" },
      { name: "sales_account_id", label: "حساب فروش", type: "ref", ref: "account", span: 8, section: "حساب‌ها (اختیاری)" },
      { name: "cogs_account_id", label: "حساب بهای تمام‌شده", type: "ref", ref: "account", span: 8, section: "حساب‌ها (اختیاری)" },
    ],
  },
  warehouse: {
    key: "warehouse", table: "tz_warehouses", title: "انبار", plural: "انبارها", area: "inventory",
    display: "name", sub: "code", code: { field: "code", start: 1 }, order: "code",
    fields: [
      code(1),
      { name: "name", label: "نام انبار", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "keeper_id", label: "انباردار", type: "ref", ref: "party", span: 6 },
      { name: "address", label: "نشانی", type: "textarea", span: 24 },
      active,
    ],
  },
  price_list: {
    key: "price_list", table: "tz_price_lists", title: "فهرست قیمت", plural: "فهرست‌های قیمت", area: "sales", modules: ["goods"],
    display: "name", order: "name",
    fields: [
      { name: "name", label: "نام فهرست", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "is_default", label: "پیش‌فرض", type: "bool", list: true, span: 6 },
      { name: "valid_from", label: "معتبر از", type: "date", span: 6, list: true },
      { name: "valid_to", label: "معتبر تا", type: "date", span: 6, list: true },
    ],
  },
  currency: {
    key: "currency", table: "tz_currencies", title: "ارز", plural: "ارزها و رمزارزها", area: "fx",
    display: "name", sub: "code", order: "sort",
    fields: [
      { name: "code", label: "نماد", type: "text", required: true, list: true, search: true, span: 6, ltr: true, help: "مثلاً USD یا BTC" },
      { name: "name", label: "نام", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "symbol", label: "علامت", type: "text", span: 6 },
      { name: "kind", label: "نوع", type: "select", default: "fiat", list: true, filter: true, span: 6, options: [
        { value: "fiat", label: "ارز" }, { value: "crypto", label: "رمزارز" }, { value: "metal", label: "فلز گران‌بها" },
      ] },
      { name: "decimals", label: "تعداد اعشار", type: "int", default: 2, span: 6, list: true },
      { name: "sort", label: "ترتیب نمایش", type: "int", default: 50, span: 6 },
      { name: "price_ids", label: "شناسه در منابع قیمت", type: "json", span: 24, help: '{"coingecko":"bitcoin","kucoin":"BTC","nobitex":"btc"}' },
      active,
    ],
  },
  wallet: {
    key: "wallet", table: "tz_wallets", title: "کیف‌پول", plural: "کیف‌پول‌های رمزارز", area: "fx", modules: ["fx"],
    display: "name", sub: "address", code: { field: "code", start: 1 }, order: "name", detail: "wallet",
    fields: [
      { name: "name", label: "نام کیف‌پول", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "currency_id", label: "دارایی", type: "ref", ref: "currency", refFilter: { kind: "crypto" }, required: true, list: true, span: 6 },
      { name: "chain", label: "شبکه", type: "select", options: CHAINS, required: true, list: true, filter: true, span: 6 },
      { name: "address", label: "نشانی کیف‌پول", type: "text", required: true, search: true, span: 24, ltr: true },
      { name: "token_contract", label: "قرارداد توکن (برای توکن‌ها، اختیاری)", type: "text", span: 24, ltr: true, help: "برای USDT روی TRON/اتریوم/BSC خودکار پر می‌شود" },
      { name: "kind", label: "نوع", type: "select", default: "hot", list: true, span: 6, options: [
        { value: "hot", label: "داغ (عملیاتی)" }, { value: "cold", label: "سرد" }, { value: "exchange", label: "حساب صرافی/اکسچنج" }, { value: "customer", label: "کیف‌پول مشتری" },
      ] },
      { name: "owner_party_id", label: "صاحب (کیف‌پول مشتری)", type: "ref", ref: "party", span: 12 },
      { name: "auto_check", label: "بررسی خودکار موجودی", type: "bool", default: true, span: 6 },
      { name: "notes", label: "یادداشت", type: "textarea", span: 24 },
    ],
  },
  gold_category: {
    key: "gold_category", table: "tz_gold_categories", title: "دسته‌ی طلا", plural: "دسته‌های طلا", area: "gold", modules: ["gold"],
    display: "name", order: "code",
    fields: [
      { name: "code", label: "کد", type: "text", span: 6, list: true, ltr: true },
      { name: "name", label: "نام دسته", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "default_fineness", label: "عیار پیش‌فرض", type: "decimal", default: 750, list: true, span: 6 },
      { name: "wage_type", label: "نوع اجرت", type: "select", options: WAGE_TYPES, default: "percent", list: true, span: 8 },
      { name: "wage_value", label: "مقدار اجرت", type: "decimal", default: 0, list: true, span: 8 },
      { name: "profit_pct", label: "سود فروشنده (٪) — خالی = پیش‌فرض", type: "pct", span: 8 },
    ],
  },
  gold_item: {
    key: "gold_item", table: "tz_gold_items", title: "جنس طلا (اتیکت)", plural: "اجناس طلا", area: "gold", modules: ["gold"],
    display: "title", sub: "tag_no", code: { field: "tag_no", start: 100001 }, order: "tag_no",
    fields: [
      { name: "tag_no", label: "شماره اتیکت / بارکد", type: "code", list: true, search: true, span: 6, ltr: true, help: "خالی بگذارید تا خودکار پر شود" },
      { name: "category_id", label: "دسته", type: "ref", ref: "gold_category", required: true, list: true, filter: true, span: 6 },
      { name: "title", label: "شرح", type: "text", list: true, search: true, span: 12 },
      { name: "fineness", label: "عیار (در هزار)", type: "decimal", default: 750, list: true, span: 6 },
      { name: "gross_weight", label: "وزن کل (گرم)", type: "weight", required: true, list: true, span: 6 },
      { name: "stone_weight", label: "وزن نگین/سنگ (گرم)", type: "weight", default: 0, span: 6 },
      { name: "net_weight", label: "وزن خالص طلا", type: "weight", readonly: true, list: true, span: 6, help: "= وزن کل − وزن سنگ" },
      { name: "wage_type", label: "نوع اجرت", type: "select", options: WAGE_TYPES, default: "percent", span: 8, section: "اجرت و سود" },
      { name: "wage_value", label: "مقدار اجرت", type: "decimal", default: 0, list: true, span: 8, section: "اجرت و سود" },
      { name: "profit_pct", label: "سود فروشنده (٪) — خالی = پیش‌فرض", type: "pct", span: 8, section: "اجرت و سود" },
      { name: "stone_desc", label: "مشخصات سنگ", type: "text", span: 12, section: "سنگ و جواهر" },
      { name: "stone_price", label: "ارزش سنگ", type: "money", default: 0, span: 12, section: "سنگ و جواهر" },
      { name: "supplier_id", label: "تأمین‌کننده / بنکدار", type: "ref", ref: "party", span: 8, section: "منشأ", filter: true },
      { name: "ownership", label: "مالکیت", type: "select", default: "own", span: 8, section: "منشأ", filter: true, list: true, options: [
        { value: "own", label: "متعلق به ما" }, { value: "consignment", label: "امانی (متعلق به همکار)" },
      ] },
      { name: "warehouse_id", label: "محل نگهداری", type: "ref", ref: "warehouse", span: 8, section: "منشأ" },
      { name: "cost", label: "بهای خرید (اختیاری)", type: "money", span: 8, section: "منشأ" },
      { name: "status", label: "وضعیت", type: "select", default: "in_stock", list: true, filter: true, readonly: true, span: 8, section: "منشأ", options: [
        { value: "in_stock", label: "موجود" }, { value: "reserved", label: "رزرو" }, { value: "sold", label: "فروخته‌شده" }, { value: "returned", label: "برگشت به همکار" }, { value: "melted", label: "ذوب‌شده" }, { value: "consigned_out", label: "امانی نزد دیگران" },
      ] },
      { name: "image", label: "تصویر", type: "image", span: 24, section: "سایر" },
      { name: "notes", label: "یادداشت", type: "textarea", span: 24, section: "سایر" },
    ],
  },
  detail: {
    key: "detail", table: "tz_details", title: "حساب تفصیلی", plural: "حساب‌های تفصیلی", area: "accounting",
    display: "name", sub: "code", order: "code",
    fields: [
      { name: "code", label: "کد", type: "code", list: true, search: true, span: 6, ltr: true },
      { name: "name", label: "نام", type: "text", required: true, list: true, search: true, span: 12 },
      { name: "kind", label: "نوع", type: "select", required: true, default: "cost_center", list: true, filter: true, span: 6, options: [
        { value: "cost_center", label: "مرکز هزینه" }, { value: "project", label: "پروژه" }, { value: "other", label: "سایر" },
        { value: "person", label: "شخص" }, { value: "cash", label: "صندوق" }, { value: "bank", label: "بانک" }, { value: "wallet", label: "کیف‌پول" },
      ] },
      active,
      { name: "description", label: "توضیحات", type: "textarea", span: 24 },
    ],
  },
};

export function entity(key: string): EntityDef | undefined {
  return ENTITIES[key];
}

/** Fields available for an organisation's enabled modules. */
export function fieldsFor(def: EntityDef, modules: ModuleKey[]): FieldDef[] {
  return def.fields.filter((f) => !f.modules || f.modules.some((m) => modules.includes(m)));
}

/** Fields a spreadsheet import can fill (images and raw JSON are left to the form). */
export function importFields(def: EntityDef, modules: ModuleKey[]): FieldDef[] {
  return fieldsFor(def, modules).filter((f) => !f.readonly && !f.hidden && f.type !== "image" && f.type !== "json");
}
