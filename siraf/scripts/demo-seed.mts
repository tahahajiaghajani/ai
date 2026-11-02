// Fills an organisation of a running server with realistic Persian demo data through the public
// HTTP API, so that screens look like a real business (for screenshots and visual QA):
//   npx tsx scripts/demo-seed.mts --base http://127.0.0.1:3939 [--org <id>] [--email … --password …]
//                                 [--ids-out ids.json] [--force] [--quiet]
// Signs up the first user when the server has none (otherwise signs in), creates the organisation
// «بازرگانی نیک‌آوران» with all modules unless --org is given, then adds parties, treasury, goods,
// invoices, cheques, vouchers, gold and exchange data spread over the last three months. A second
// run against the same organisation does nothing (unless --force). Uses only fetch.

interface Opts {
  base: string;
  org: string | null;
  email: string;
  password: string;
  fullName: string;
  orgName: string;
  idsOut: string | null;
  force: boolean;
  quiet: boolean;
}

export interface SeedResult {
  org_id: string;
  email: string;
  password: string;
  skipped: boolean;
  seconds: number;
  requests: number;
  ids: Record<string, string>;
  counts: Record<string, number>;
}

export const DEMO = {
  email: "demo@example.com",
  password: "Demo-pass-1405",
  fullName: "سارا محمدی",
  orgName: "بازرگانی نیک‌آوران",
};

// ---------------------------------------------------------------- tiny API client

class Api {
  cookie = "";
  requests = 0;
  constructor(private base: string) {}
  async req<T = any>(method: string, path: string, body?: unknown, okStatus: number[] = [200]): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    this.requests++;
    const res = await fetch(`${this.base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!okStatus.includes(res.status)) {
      const msg = data?.error?.message ?? text.slice(0, 300);
      throw new Error(`${method} ${path} → ${res.status}: ${msg}\n  body: ${JSON.stringify(body)?.slice(0, 600)}`);
    }
    return data as T;
  }
  get = <T = any>(p: string) => this.req<T>("GET", p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>("POST", p, b);
  put = <T = any>(p: string, b: unknown = {}) => this.req<T>("PUT", p, b);
}

// ---------------------------------------------------------------- helpers

/** deterministic random numbers (mulberry32) so every run produces the same business */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

function tehranToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/** a valid Iranian national id from nine digits */
function nationalId(nine: string) {
  const d = nine.split("").map(Number);
  const r = d.reduce((a, x, i) => a + x * (10 - i), 0) % 11;
  return `${nine}${r < 2 ? r : 11 - r}`;
}
/** an IBAN «IR..» with valid check digits from the 22-digit BBAN */
function iban(bban: string) {
  const num = BigInt(`${bban}1827` + "00"); // I=18 R=27
  const check = 98n - (num % 97n);
  return `IR${String(check).padStart(2, "0")}${bban}`;
}
/** a card number with a valid Luhn digit from the first 15 digits */
function card(fifteen: string) {
  const ds = fifteen.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = ds[i];
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${fifteen}${(10 - (sum % 10)) % 10}`;
}
/** rounds rial amounts to a «nice» step */
const round = (v: number, step = 10000) => Math.max(step, Math.round(v / step) * step);
const s = (v: number) => String(Math.round(v));

// ---------------------------------------------------------------- data

type Role = "customer" | "supplier" | "employee" | "correspondent" | "wholesaler" | "workshop";
interface PartySpec {
  key: string;
  name: string;
  kind?: "person" | "company";
  roles: Role[];
  city: string;
  first?: string;
  last?: string;
  company?: string;
}

const PARTIES: PartySpec[] = [
  { key: "c1", name: "علی رضایی", first: "علی", last: "رضایی", roles: ["customer"], city: "تهران" },
  { key: "c2", name: "مریم احمدی", first: "مریم", last: "احمدی", roles: ["customer"], city: "تهران" },
  { key: "c3", name: "حسین کریمی", first: "حسین", last: "کریمی", roles: ["customer"], city: "کرج" },
  { key: "c4", name: "زهرا موسوی", first: "زهرا", last: "موسوی", roles: ["customer"], city: "اصفهان" },
  { key: "c5", name: "محمد حسینی", first: "محمد", last: "حسینی", roles: ["customer"], city: "تهران" },
  { key: "c6", name: "فاطمه جعفری", first: "فاطمه", last: "جعفری", roles: ["customer"], city: "شیراز" },
  { key: "c7", name: "رضا قاسمی", first: "رضا", last: "قاسمی", roles: ["customer"], city: "مشهد" },
  { key: "c8", name: "نرگس صادقی", first: "نرگس", last: "صادقی", roles: ["customer"], city: "تهران" },
  { key: "c9", name: "امیرحسین نوروزی", first: "امیرحسین", last: "نوروزی", roles: ["customer"], city: "تبریز" },
  { key: "c10", name: "سارا کاظمی", first: "سارا", last: "کاظمی", roles: ["customer"], city: "تهران" },
  { key: "c11", name: "مهدی رحیمی", first: "مهدی", last: "رحیمی", roles: ["customer"], city: "قم" },
  { key: "c12", name: "لیلا عباسی", first: "لیلا", last: "عباسی", roles: ["customer"], city: "رشت" },
  { key: "cc1", name: "فروشگاه زنجیره‌ای نیک‌پخش", kind: "company", company: "شرکت نیک‌پخش ایرانیان", roles: ["customer"], city: "تهران" },
  { key: "cc2", name: "شرکت آرین تجارت پارس", kind: "company", company: "آرین تجارت پارس (سهامی خاص)", roles: ["customer"], city: "اصفهان" },
  { key: "s1", name: "شرکت پخش البرز", kind: "company", company: "پخش البرز (سهامی خاص)", roles: ["supplier"], city: "تهران" },
  { key: "s2", name: "بازرگانی سپهر کالا", kind: "company", company: "سپهر کالای شرق", roles: ["supplier"], city: "مشهد" },
  { key: "s3", name: "واردات دیجیتال پارسیان", kind: "company", company: "پارسیان دیجیتال", roles: ["supplier"], city: "تهران" },
  { key: "s4", name: "صنایع غذایی گلستان", kind: "company", company: "گلستان (سهامی عام)", roles: ["supplier"], city: "گرگان" },
  { key: "s5", name: "پخش سراسری مهرگان", kind: "company", company: "مهرگان پخش", roles: ["supplier"], city: "تهران" },
  { key: "fx1", name: "صرافی همکار الماس دبی", kind: "company", company: "Almas Exchange LLC", roles: ["correspondent"], city: "دبی" },
  { key: "fx2", name: "صرافی همکار آناتولی استانبول", kind: "company", company: "Anadolu Döviz", roles: ["correspondent"], city: "استانبول" },
  { key: "g1", name: "بنکداری طلای زرین", kind: "company", company: "زرین گستر طلا", roles: ["wholesaler", "supplier"], city: "تهران" },
  { key: "g2", name: "گالری طلای آریا", kind: "company", company: "گالری آریا", roles: ["wholesaler"], city: "تهران" },
  { key: "g3", name: "کارگاه ساخت طلای رضوی", first: "جواد", last: "رضوی", roles: ["workshop"], city: "تهران" },
  { key: "e1", name: "کیوان مرادی", first: "کیوان", last: "مرادی", roles: ["employee"], city: "تهران" },
];

type Cat = "phone" | "acc" | "home" | "food";
interface ItemSpec {
  name: string;
  cat: Cat;
  unit: string;
  buy: number; // rial
  brand?: string;
}
const CATS: Record<Cat, { name: string; vat: string; supplier: string; restock: [number, number] }> = {
  phone: { name: "موبایل و تبلت", vat: "10", supplier: "s3", restock: [3, 7] },
  acc: { name: "لوازم جانبی دیجیتال", vat: "10", supplier: "s1", restock: [20, 50] },
  home: { name: "لوازم خانگی کوچک", vat: "10", supplier: "s5", restock: [3, 7] },
  food: { name: "مواد غذایی و نوشیدنی", vat: "0", supplier: "s4", restock: [30, 80] },
};
const ITEMS: ItemSpec[] = [
  { name: "گوشی سامسونگ Galaxy A55 ۲۵۶ گیگ", cat: "phone", unit: "دستگاه", buy: 268_000_000, brand: "Samsung" },
  { name: "گوشی سامسونگ Galaxy S24 ۲۵۶ گیگ", cat: "phone", unit: "دستگاه", buy: 590_000_000, brand: "Samsung" },
  { name: "گوشی شیائومی Redmi Note 13", cat: "phone", unit: "دستگاه", buy: 128_000_000, brand: "Xiaomi" },
  { name: "گوشی شیائومی Poco X6 Pro", cat: "phone", unit: "دستگاه", buy: 205_000_000, brand: "Xiaomi" },
  { name: "گوشی اپل iPhone 15 ۱۲۸ گیگ", cat: "phone", unit: "دستگاه", buy: 735_000_000, brand: "Apple" },
  { name: "گوشی آنر X8b", cat: "phone", unit: "دستگاه", buy: 112_000_000, brand: "Honor" },
  { name: "گوشی نوکیا 105", cat: "phone", unit: "دستگاه", buy: 11_500_000, brand: "Nokia" },
  { name: "تبلت سامسونگ Galaxy Tab A9", cat: "phone", unit: "دستگاه", buy: 142_000_000, brand: "Samsung" },
  { name: "تبلت لنوو Tab M10", cat: "phone", unit: "دستگاه", buy: 98_000_000, brand: "Lenovo" },
  { name: "ساعت هوشمند شیائومی Band 8", cat: "phone", unit: "عدد", buy: 21_000_000, brand: "Xiaomi" },
  { name: "هندزفری بلوتوثی انکر", cat: "acc", unit: "عدد", buy: 18_500_000, brand: "Anker" },
  { name: "شارژر دیواری ۲۰ وات", cat: "acc", unit: "عدد", buy: 4_200_000 },
  { name: "کابل USB-C یک‌متری", cat: "acc", unit: "عدد", buy: 1_150_000 },
  { name: "پاوربانک ۲۰۰۰۰ میلی‌آمپر", cat: "acc", unit: "عدد", buy: 13_800_000 },
  { name: "قاب محافظ سیلیکونی", cat: "acc", unit: "عدد", buy: 950_000 },
  { name: "گلس محافظ صفحه نمایش", cat: "acc", unit: "عدد", buy: 600_000 },
  { name: "کارت حافظه ۱۲۸ گیگ", cat: "acc", unit: "عدد", buy: 6_900_000 },
  { name: "فلش مموری ۶۴ گیگ", cat: "acc", unit: "عدد", buy: 3_400_000 },
  { name: "اسپیکر بلوتوثی قابل‌حمل", cat: "acc", unit: "عدد", buy: 16_200_000 },
  { name: "ماوس بی‌سیم لاجیتک", cat: "acc", unit: "عدد", buy: 7_600_000, brand: "Logitech" },
  { name: "چای‌ساز بوش", cat: "home", unit: "دستگاه", buy: 78_000_000, brand: "Bosch" },
  { name: "اتو بخار فیلیپس", cat: "home", unit: "دستگاه", buy: 46_000_000, brand: "Philips" },
  { name: "جاروبرقی پارس‌خزر ۲۰۰۰ وات", cat: "home", unit: "دستگاه", buy: 92_000_000 },
  { name: "سشوار حرفه‌ای", cat: "home", unit: "دستگاه", buy: 24_500_000 },
  { name: "مخلوط‌کن مولینکس", cat: "home", unit: "دستگاه", buy: 38_000_000, brand: "Moulinex" },
  { name: "توستر دو کاره", cat: "home", unit: "دستگاه", buy: 21_000_000 },
  { name: "کتری برقی استیل", cat: "home", unit: "دستگاه", buy: 14_500_000 },
  { name: "آبمیوه‌گیری چهارکاره", cat: "home", unit: "دستگاه", buy: 56_000_000 },
  { name: "سرخ‌کن بدون روغن ۵ لیتری", cat: "home", unit: "دستگاه", buy: 69_000_000 },
  { name: "پنکه رومیزی", cat: "home", unit: "دستگاه", buy: 17_800_000 },
  { name: "برنج هاشمی ممتاز ۱۰ کیلویی", cat: "food", unit: "بسته", buy: 9_800_000 },
  { name: "روغن آفتابگردان ۱٫۸ لیتری", cat: "food", unit: "عدد", buy: 1_450_000 },
  { name: "چای سیاه ممتاز ۵۰۰ گرمی", cat: "food", unit: "بسته", buy: 2_350_000 },
  { name: "قند حبه یک کیلویی", cat: "food", unit: "بسته", buy: 640_000 },
  { name: "زعفران سرگل نیم مثقال", cat: "food", unit: "عدد", buy: 3_900_000 },
  { name: "عسل طبیعی یک کیلویی", cat: "food", unit: "عدد", buy: 4_700_000 },
  { name: "رب گوجه‌فرنگی ۸۰۰ گرمی", cat: "food", unit: "عدد", buy: 820_000 },
  { name: "ماکارونی ۷۰۰ گرمی", cat: "food", unit: "بسته", buy: 410_000 },
  { name: "کنسرو تن ماهی", cat: "food", unit: "عدد", buy: 960_000 },
  { name: "خرما مضافتی", cat: "food", unit: "کیلوگرم", buy: 1_750_000 },
];

// ---------------------------------------------------------------- seeding

export async function seed(o: Opts): Promise<SeedResult> {
  const t0 = Date.now();
  const log = (...a: unknown[]) => {
    if (!o.quiet) console.log("[demo-seed]", ...a);
  };
  const api = new Api(o.base.replace(/\/$/, ""));
  const R = rng(1405);
  const ids: Record<string, string> = {};
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  // ---- user
  const meta = await api.get("/meta");
  if (meta.first_run) {
    log("first run: creating the owner", o.email);
    await api.post("/auth/signup", { email: o.email, password: o.password, full_name: o.fullName, mobile: "09121112233" });
  } else {
    await api.post("/auth/login", { email: o.email, password: o.password });
  }

  // ---- organisation
  let org = o.org;
  if (!org) {
    const { orgs } = await api.get<{ orgs: { id: string; name: string }[] }>("/orgs");
    org = orgs.find((x) => x.name === o.orgName)?.id ?? null;
    if (!org) {
      const r = await api.post<{ id: string }>("/orgs", {
        name: o.orgName, legal_name: "شرکت بازرگانی نیک‌آوران پارس (سهامی خاص)", business_kind: "mixed", modules: ["goods", "gold", "fx"],
        base_currency: "IRR", phone: "021-88776655", city: "تهران", address: "تهران، خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۲۴۸",
        economic_code: "411122233344", national_id: "10320456789",
      });
      org = r.id;
      log("created organisation", org);
    }
  }
  const O = (p: string) => `/o/${org}${p}`;
  const info = await api.get(O(""));
  const modules: string[] = info.org.modules ?? [];

  // ---- already seeded?
  const existing = await api.get(O(`/data/party?q=${encodeURIComponent(PARTIES[0].name)}`));
  if (existing.total > 0 && !o.force) {
    log("organisation already holds demo data — nothing to do (use --force to add again)");
    const result: SeedResult = { org_id: org, email: o.email, password: o.password, skipped: true, seconds: (Date.now() - t0) / 1000, requests: api.requests, ids: { org }, counts };
    await writeIds(o.idsOut, result);
    return result;
  }
  ids.org = org;

  // ---- dates: the last three months, inside the current fiscal year
  const today = tehranToday();
  const fy = (info.fiscal_years as { start_date: string; end_date: string; is_closed?: boolean }[]).find((f) => f.start_date <= today && f.end_date >= today) ?? info.fiscal_years[0];
  const first = maxDate(addDays(today, -92), fy.start_date);
  const span = Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 86400000));
  /** a date `n` days ago, never before the first day of the period nor after today */
  const ago = (n: number) => minDate(today, maxDate(first, addDays(today, -n)));
  /** a position 0…1 along the period → date */
  const at = (f: number) => ago(Math.round(span * (1 - f)));
  log(`period ${first} → ${today} (${span} days)`);

  // ---- settings
  await api.put(O("/gold/settings"), { profit_pct: "7", tax_pct: "10", round_step: "10000", old_deduction_pct: "1" }).catch(() => null);

  // ---- accounts
  const accounts = (await api.get(O("/accounting/accounts"))).accounts as { id: string; code: string; system_key: string | null }[];
  const acc = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    if (!a) throw new Error(`account ${code} not found`);
    return a.id;
  };

  // ---- parties
  const party: Record<string, { id: string; detail_id: string; name: string }> = {};
  const prefixes = ["0912", "0935", "0919", "0912", "0936", "0901", "0915", "0917", "0938", "0991"];
  let nine = 1;
  for (const p of PARTIES) {
    const mobile = `${R.pick(prefixes)}${String(R.int(1000000, 9999999))}`;
    const body: Record<string, unknown> = {
      name: p.name, kind: p.kind ?? "person", roles: p.roles, mobile, city: p.city, province: p.city === "دبی" || p.city === "استانبول" ? null : p.city,
    };
    if (p.kind === "company") {
      body.company_name = p.company;
      body.phone = `021-${R.int(22000000, 88999999)}`;
      if (!["fx1", "fx2"].includes(p.key)) body.economic_code = String(R.int(100000000000, 999999999999)).slice(0, 12);
    } else {
      body.first_name = p.first;
      body.last_name = p.last;
      body.national_id = nationalId(String(4400000 + nine * 7919).padStart(9, "0").slice(0, 9));
    }
    body.kyc_status = "verified";
    nine++;
    if (p.roles.includes("customer") && p.kind === "company") body.credit_limit = "5000000000";
    const r = (await api.post(O("/data/party"), body)).row;
    party[p.key] = { id: r.id, detail_id: r.detail_id, name: p.name };
    bump("parties");
  }
  ids.party_customer = party.c1.id;
  ids.party_company = party.cc1.id;
  ids.party_supplier = party.s1.id;

  // ---- treasury master data
  const box = (await api.get(O("/data/cash_box"))).rows[0] as { id: string; detail_id: string };
  await api.req("PATCH", O(`/data/cash_box/${box.id}`), { name: "صندوق اصلی فروشگاه" });
  const box2 = (await api.post(O("/data/cash_box"), { name: "صندوق ارزی باجه", keeper_id: party.e1.id })).row;
  const bank1 = (await api.post(O("/data/bank_account"), {
    name: "ملت جاری شعبه ونک", bank_name: "ملت", branch_name: "ونک", branch_code: "6512", account_no: "4581236790", account_type: "current",
    iban: iban("0120000000004581236790"), card_no: card("610433781234567"), owner_name: o.orgName,
  })).row;
  const bank2 = (await api.post(O("/data/bank_account"), {
    name: "پاسارگاد کوتاه‌مدت مرکزی", bank_name: "پاسارگاد", branch_name: "مرکزی", account_no: "2071098345671", account_type: "savings", owner_name: o.orgName,
  })).row;
  const pos = (await api.post(O("/data/pos_terminal"), { name: "کارتخوان ملت ویترین", terminal_no: "71825634", provider: "به‌پرداخت ملت", bank_account_id: bank1.id })).row;
  const book = (await api.post(O("/data/cheque_book"), { bank_account_id: bank1.id, title: "دسته‌چک ملت ۵۲", serial_from: "520001", serial_to: "520050", sheets: 50, received_at: ago(95) })).row;
  ids.bank = bank1.id;
  bump("bank_accounts", 2);
  bump("cash_boxes", 1);

  // opening capital
  const cap = await api.post(O("/accounting/vouchers"), {
    date: first, description: "آورده‌ی نقدی شرکا — افتتاح حساب‌ها",
    lines: [
      { account_id: acc("1101"), detail_id: box.detail_id, debit: "2000000000", description: "واریز به صندوق" },
      { account_id: acc("1101"), detail_id: box2.detail_id, debit: "6000000000", description: "واریز به صندوق باجه" },
      { account_id: acc("1102"), detail_id: bank1.detail_id, debit: "55000000000", description: "واریز به حساب ملت" },
      { account_id: acc("1102"), detail_id: bank2.detail_id, debit: "25000000000", description: "واریز به حساب پاسارگاد" },
      { account_id: acc("5101"), credit: "88000000000", description: "سرمایه‌ی پرداخت‌شده" },
    ],
  });
  ids.voucher = cap.voucher.id;
  bump("vouchers");

  // ---- goods
  const invoiceIds: Record<string, string[]> = { sale: [], purchase: [] };
  if (modules.includes("goods")) {
    const units = (await api.get(O("/data/unit?size=100"))).rows as { id: string; name: string }[];
    const unit = (n: string) => units.find((u) => u.name === n)?.id ?? units[0].id;
    const catIds: Record<string, string> = {};
    for (const [k, c] of Object.entries(CATS)) catIds[k] = (await api.post(O("/data/item_category"), { name: c.name, code: String(Object.keys(catIds).length + 1) })).row.id;
    bump("item_categories", 4);
    const wh2 = (await api.post(O("/data/warehouse"), { name: "انبار شعبه‌ی کرج", address: "کرج، بلوار جمهوری" })).row;
    void wh2;

    const items: { id: string; spec: ItemSpec; sale: number; stock: number }[] = [];
    let bc = 0;
    for (const sp of ITEMS) {
      const margin = sp.cat === "food" ? 1.22 : sp.cat === "phone" ? 1.16 : sp.cat === "acc" ? 1.45 : 1.32;
      const sale = round(sp.buy * margin, sp.buy > 50_000_000 ? 500_000 : 10_000);
      const r = (await api.post(O("/data/item"), {
        name: sp.name, kind: "goods", category_id: catIds[sp.cat], unit_id: unit(sp.unit), sale_price: s(sale), purchase_price: s(sp.buy),
        min_sale_price: s(round(sp.buy * 1.03, 10_000)), vat_pct: CATS[sp.cat].vat, barcode: `62${String(60012345000 + ++bc * 137).padStart(11, "0")}`,
        brand: sp.brand ?? null, min_stock: sp.cat === "phone" || sp.cat === "home" ? "3" : "20", reorder_point: sp.cat === "phone" || sp.cat === "home" ? "5" : "30",
      })).row;
      items.push({ id: r.id, spec: sp, sale, stock: 0 });
      bump("items");
    }
    ids.item = items[0].id;

    // a price list for the company customers
    const pl = (await api.post(O("/data/price_list"), { name: "قیمت عمده‌فروشی", valid_from: first })).row;
    await api.put(O(`/goods/price-lists/${pl.id}/items`), { items: items.slice(10, 20).map((i) => ({ item_id: i.id, price: s(round(i.sale * 0.94, 10_000)) })) }).catch(() => null);
    ids.price_list = pl.id;

    const purchase = async (date: string, sup: string, lines: { it: (typeof items)[number]; qty: number }[], extra: Record<string, unknown> = {}) => {
      const r = await api.post(O("/goods/invoices"), {
        kind: "purchase", date, party_id: party[sup].id, ref_no: `F-${R.int(1000, 9999)}`,
        lines: lines.map((l) => ({ item_id: l.it.id, qty: String(l.qty), unit_price: s(l.it.spec.buy * (0.97 + R.next() * 0.06)) })), ...extra,
      });
      for (const l of lines) l.it.stock += l.qty;
      invoiceIds.purchase.push(r.invoice.id);
      bump("purchase_invoices");
      return { id: r.invoice.id as string, total: String(r.invoice.total), date, sup };
    };

    // opening purchases: every category from its supplier
    const purchases: { id: string; total: string; date: string; sup: string }[] = [];
    for (const [k, c] of Object.entries(CATS) as [Cat, (typeof CATS)[Cat]][]) {
      const its = items.filter((i) => i.spec.cat === k);
      const inv = await purchase(ago(90 - Object.keys(CATS).indexOf(k)), c.supplier, its.map((it) => ({ it, qty: R.int(c.restock[0], c.restock[1]) + 2 })));
      purchases.push(inv);
    }

    // sales across the period — more of them as the business grows
    const customers = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "cc1", "cc2"];
    const sales: { id: string; total: string; date: string; party: string | null; lines: { item_id: string; qty: number }[] }[] = [];
    const SALES = 80;
    const restockAt = new Set([0.2, 0.35, 0.5, 0.65, 0.8, 0.9].map((f) => Math.round(f * SALES)));
    for (let n = 0; n < SALES; n++) {
      const f = Math.min(0.995, Math.pow((n + 0.5) / SALES, 0.8) * 0.96 + 0.03);
      const date = at(f);
      if (restockAt.has(n)) {
        // restock what runs low
        for (const [k, c] of Object.entries(CATS) as [Cat, (typeof CATS)[Cat]][]) {
          const low = items.filter((i) => i.spec.cat === k && i.stock < c.restock[0] * 1.5);
          if (low.length) {
            const inv = await purchase(date, k === "home" && R.chance(0.5) ? "s2" : c.supplier, low.map((it) => ({ it, qty: R.int(c.restock[0], c.restock[1]) })));
            purchases.push(inv);
          }
        }
      }
      const who = R.chance(0.15) ? null : R.pick(customers);
      const company = who === "cc1" || who === "cc2";
      const nLines = company ? R.int(3, 6) : R.int(1, 3);
      const chosen = new Map<string, { it: (typeof items)[number]; qty: number }>();
      for (let i = 0; i < nLines; i++) {
        const it = R.pick(items);
        const max = it.spec.cat === "phone" || it.spec.cat === "home" ? (company ? 3 : 1) : company ? 24 : 5;
        const qty = Math.min(R.int(1, max), it.stock - (chosen.get(it.id)?.qty ?? 0));
        if (qty <= 0) continue;
        chosen.set(it.id, { it, qty: (chosen.get(it.id)?.qty ?? 0) + qty });
      }
      if (!chosen.size) continue;
      const lines = [...chosen.values()];
      const r = await api.post(O("/goods/invoices"), {
        kind: "sale", date, party_id: who ? party[who].id : null, settlement: who ? (company ? "credit" : "mixed") : "cash",
        discount_pct: company ? "3" : null,
        lines: lines.map((l) => ({ item_id: l.it.id, qty: String(l.qty), unit_price: s(l.it.sale), discount_pct: !company && R.chance(0.2) ? "5" : null })),
        notes: company ? "تحویل درب انبار خریدار؛ تسویه طی ۳۰ روز" : null,
      });
      for (const l of lines) l.it.stock -= l.qty;
      sales.push({ id: r.invoice.id, total: r.invoice.total, date, party: who, lines: lines.map((l) => ({ item_id: l.it.id, qty: l.qty })) });
      invoiceIds.sale.push(r.invoice.id);
      bump("sale_invoices");
    }
    ids.sale_invoice = sales[sales.length - 1].id;
    ids.purchase_invoice = purchases[0].id;

    // returns
    const returnable = sales.filter((x) => x.party && x.date < ago(5)).slice(-12);
    for (const sl of [returnable[1], returnable[6]].filter(Boolean)) {
      const r = await api.post(O("/goods/invoices"), {
        kind: "sale_return", date: minDate(today, addDays(sl.date, 3)), party_id: party[sl.party!].id, ref_invoice_id: sl.id,
        lines: [{ item_id: sl.lines[0].item_id, qty: "1" }], notes: "مرجوعی به‌دلیل ایراد ظاهری",
      });
      ids.sale_return = r.invoice.id;
      bump("sale_returns");
    }
    {
      const p = purchases.find((x) => x.sup === "s1")!;
      const inv = (await api.get(O(`/goods/invoices/${p.id}`))).invoice;
      const r = await api.post(O("/goods/invoices"), {
        kind: "purchase_return", date: addDays(p.date, 6), party_id: party.s1.id, ref_invoice_id: p.id,
        lines: [{ item_id: inv.lines[2].item_id, qty: "5" }], notes: "برگشت کالای معیوب",
      });
      ids.purchase_return = r.invoice.id;
      bump("purchase_returns");
    }
    // a quote and a customer order still open
    const q = await api.post(O("/goods/invoices"), {
      kind: "quote", date: ago(2), party_id: party.cc2.id, due_date: addDays(today, 7),
      lines: items.filter((i) => i.spec.cat === "home").slice(0, 4).map((i) => ({ item_id: i.id, qty: "10", unit_price: s(round(i.sale * 0.95, 10_000)) })),
      terms: "اعتبار پیش‌فاکتور: ۷ روز", status: "draft",
    });
    ids.quote = q.invoice.id;
    const so = await api.post(O("/goods/invoices"), {
      kind: "sale_order", date: ago(1), party_id: party.cc1.id,
      lines: items.filter((i) => i.spec.cat === "acc").slice(0, 5).map((i) => ({ item_id: i.id, qty: "40" })), status: "draft",
    });
    ids.sale_order = so.invoice.id;
    bump("quotes_orders", 2);

    // a stock transfer to the branch warehouse
    const wh = (await api.get(O("/data/warehouse?size=10"))).rows.find((w: { id: string }) => w.id !== wh2.id);
    const tr = await api.post(O("/goods/stock-docs"), {
      kind: "transfer", date: ago(20), warehouse_id: wh.id, dest_warehouse_id: wh2.id, description: "ارسال به شعبه‌ی کرج",
      lines: items.filter((i) => i.spec.cat === "food" && i.stock > 20).slice(0, 4).map((i) => ({ item_id: i.id, qty: "10" })),
    });
    ids.stock_doc = tr.doc.id;
    bump("stock_docs");

    /** settles a receipt/payment against an invoice, never above what is still open on it */
    const alloc = async (invoiceId: string, amount: number) => {
      const inv = (await api.get(O(`/goods/invoices/${invoiceId}`))).invoice;
      const open = Math.min(amount, Number(inv.remaining ?? inv.total));
      return open > 0 ? [{ invoice_id: invoiceId, amount: s(open) }] : [];
    };
    // ---- treasury: receipts for most sales, payments to suppliers, cheques
    const paid = new Set<string>();
    let sayad = 1405_0811_0000_0000n;
    const nextSayad = () => String((sayad += 7_919n));
    const chequeBanks = ["ملی", "صادرات", "تجارت", "سپه", "پارسیان", "سامان", "رفاه", "مسکن"];
    for (const sl of sales) {
      if (!sl.party) continue;
      const company = sl.party === "cc1" || sl.party === "cc2";
      if (company) continue; // company customers pay by cheque below
      if (R.chance(0.25)) continue; // left on account
      const date = minDate(today, addDays(sl.date, R.int(0, 6)));
      const total = Number(sl.total);
      const part = R.chance(0.8) ? total : round(total * 0.6, 10_000);
      const lines = R.chance(0.5)
        ? [{ method: "pos", pos_id: pos.id, amount: s(part), ref_no: String(R.int(100000, 999999)) }]
        : R.chance(0.5)
          ? [{ method: "cash", cash_box_id: box.id, amount: s(part) }]
          : [{ method: "bank", bank_account_id: bank1.id, amount: s(part), ref_no: `PAYA-${R.int(10000, 99999)}` }];
      const r = await api.post(O("/treasury/docs"), {
        kind: "receipt", date, party_id: party[sl.party].id, description: "دریافت بابت فاکتور فروش", lines, allocs: await alloc(sl.id, part),
      });
      ids.receipt = r.doc.id;
      paid.add(sl.id);
      bump("receipts");
    }

    // cheques from the company customers, each in a different state
    const companySales = sales.filter((x) => x.party === "cc1" || x.party === "cc2");
    const chequeStates = ["cleared", "deposited", "in_hand", "in_hand", "bounced", "endorsed", "in_hand", "cleared"] as const;
    const cheques: { id: string; state: string; date: string; due: string }[] = [];
    for (let i = 0; i < Math.min(companySales.length, chequeStates.length); i++) {
      const sl = companySales[i];
      const state = chequeStates[i];
      const date = minDate(today, addDays(sl.date, 2));
      const due = state === "in_hand" ? addDays(today, R.int(8, 60)) : minDate(today, addDays(date, R.int(5, 20)));
      const amount = s(round(Number(sl.total) * (state === "in_hand" ? 0.5 : 1), 10_000));
      const r = await api.post(O("/treasury/docs"), {
        kind: "receipt", date, party_id: party[sl.party!].id, description: "دریافت چک بابت فاکتور",
        lines: [{
          method: "cheque", amount,
          cheque: { serial_no: String(R.int(100000, 999999)), sayad_no: nextSayad(), bank_name: R.pick(chequeBanks), branch_name: R.pick(["مرکزی", "ونک", "جردن", "انقلاب", "آزادی"]), due_date: due, account_owner: party[sl.party!].name },
        }],
        allocs: await alloc(sl.id, Number(amount)),
      });
      const doc = (await api.get(O(`/treasury/docs/${r.doc.id}`))).doc;
      const ch = doc.lines.find((l: { cheque?: unknown }) => l.cheque).cheque;
      cheques.push({ id: ch.id, state, date, due });
      bump("cheques_received");
    }
    for (const ch of cheques) {
      const d1 = maxDate(ch.date, minDate(today, ch.due));
      if (ch.state === "deposited" || ch.state === "cleared" || ch.state === "bounced") {
        await api.post(O(`/treasury/cheques/${ch.id}/action`), { action: "deposit", date: d1, bank_account_id: bank1.id, note: "واگذاری به بانک" });
      }
      if (ch.state === "cleared") await api.post(O(`/treasury/cheques/${ch.id}/action`), { action: "clear", date: minDate(today, addDays(d1, 2)) });
      if (ch.state === "bounced") await api.post(O(`/treasury/cheques/${ch.id}/action`), { action: "bounce", date: minDate(today, addDays(d1, 2)), note: "کسری موجودی" });
      if (ch.state === "endorsed") await api.post(O(`/treasury/cheques/${ch.id}/action`), { action: "endorse", date: d1, party_id: party.s5.id, note: "خرج چک بابت بدهی پخش مهرگان" });
    }
    ids.cheque = cheques[0]?.id ?? "";

    // payments to suppliers: bank transfers and cheques from our cheque book
    let serial = 520001;
    for (const [i, p] of purchases.entries()) {
      if (i % 3 === 2) continue; // some stay payable
      const total = Number(p.total);
      const date = minDate(today, addDays(p.date, R.int(1, 8)));
      const byCheque = i % 2 === 1;
      const due = byCheque ? (i % 4 === 1 ? addDays(today, R.int(10, 45)) : minDate(today, addDays(date, 10))) : null;
      const amount = s(round(total * 0.7, 10_000));
      const r = await api.post(O("/treasury/docs"), {
        kind: "payment", date, party_id: party[p.sup].id, description: "پرداخت بابت فاکتور خرید",
        lines: byCheque
          ? [{ method: "cheque", amount, cheque: { cheque_book_id: book.id, serial_no: String(serial++), sayad_no: nextSayad(), due_date: due } }]
          : [{ method: "bank", bank_account_id: R.chance(0.7) ? bank1.id : bank2.id, amount, fee: "50000", ref_no: `SATNA-${R.int(100000, 999999)}` }],
        allocs: await alloc(p.id, Number(amount)),
      });
      ids.payment = r.doc.id;
      bump("payments");
      if (byCheque && due && due <= today) {
        const doc = (await api.get(O(`/treasury/docs/${r.doc.id}`))).doc;
        const ch = doc.lines.find((l: { cheque?: unknown }) => l.cheque).cheque;
        await api.post(O(`/treasury/cheques/${ch.id}/action`), { action: "clear", date: due });
      }
      bump("cheques_issued", byCheque ? 1 : 0);
    }
  }

  // ---- monthly expenses: rent, utilities, salaries (accrual voucher + payment)
  for (let m = 0; m < 3; m++) {
    const date = ago(85 - m * 30);
    await api.post(O("/treasury/docs"), {
      kind: "payment", date, account_id: acc("7202"), description: "اجاره‌ی ماهانه‌ی مغازه و انبار",
      lines: [{ method: "bank", bank_account_id: bank1.id, amount: "380000000", ref_no: `RENT-${m + 1}` }],
    });
    await api.post(O("/treasury/docs"), {
      kind: "payment", date: ago(80 - m * 30), account_id: acc("7203"), description: "قبض برق، آب، گاز و اینترنت",
      lines: [{ method: "cash", cash_box_id: box.id, amount: s(R.int(14, 26) * 1_000_000) }],
    });
    const salDate = ago(62 - m * 30);
    const salary = 640_000_000 + m * 10_000_000;
    await api.post(O("/accounting/vouchers"), {
      date: salDate, description: "ثبت حقوق و دستمزد ماهانه‌ی کارکنان",
      lines: [
        { account_id: acc("7201"), debit: s(salary), description: "حقوق پایه و اضافه‌کار" },
        { account_id: acc("3204"), credit: s(salary * 0.07), description: "سهم بیمه‌ی کارکنان" },
        { account_id: acc("3205"), credit: s(salary * 0.03), description: "مالیات حقوق" },
        { account_id: acc("3203"), credit: s(salary * 0.9), description: "خالص پرداختنی" },
      ],
    });
    if (salDate < today) {
      await api.post(O("/treasury/docs"), {
        kind: "payment", date: minDate(today, addDays(salDate, 1)), account_id: acc("3203"), description: "پرداخت حقوق کارکنان",
        lines: [{ method: "bank", bank_account_id: bank1.id, amount: s(salary * 0.9), fee: "120000", ref_no: `PAYROLL-${m + 1}` }],
      });
    }
    bump("payments", 3);
    bump("vouchers");
  }
  // equipment purchase and depreciation
  await api.post(O("/accounting/vouchers"), {
    date: ago(70), description: "خرید ویترین، قفسه و صندوق فروشگاهی",
    lines: [
      { account_id: acc("2104"), debit: "4200000000", description: "ویترین شیشه‌ای و قفسه‌بندی" },
      { account_id: acc("1102"), detail_id: bank2.detail_id, credit: "4200000000" },
    ],
  });
  await api.post(O("/accounting/vouchers"), {
    date: ago(3), description: "استهلاک سه‌ماهه‌ی اثاثیه و منصوبات",
    lines: [
      { account_id: acc("7209"), debit: "210000000" },
      { account_id: acc("2203"), credit: "210000000" },
    ],
  });
  // cash from the bank to the till
  await api.post(O("/treasury/docs"), {
    kind: "transfer", date: ago(40), description: "برداشت از بانک برای صندوق",
    lines: [
      { direction: "out", method: "bank", bank_account_id: bank1.id, amount: "1500000000", ref_no: "W-1405" },
      { direction: "in", method: "cash", cash_box_id: box.id, amount: "1500000000" },
    ],
  });
  bump("vouchers", 2);
  bump("transfers");

  // ---- gold
  if (modules.includes("gold")) {
    // rate board over the period (mazaneh / gram18 and coins)
    let g18 = 71_400_000;
    for (let d = Math.min(span, 90); d >= 0; d -= 3) {
      g18 = Math.round((g18 * (1 + (R.next() - 0.42) * 0.012)) / 10000) * 10000;
      const coin = (k: number) => s(round(g18 * k, 100000));
      await api.post(O("/gold/rates"), {
        at: `${ago(d)}T07:${String(10 + (d % 40)).padStart(2, "0")}:00Z`, gram18: s(g18), ounce_usd: s(2650 + R.int(-40, 60)), usd: "1050000",
        coins: { emami: coin(12.1), bahar: coin(11.9), nim: coin(6.25), rob: coin(3.6), gerami: coin(1.62) }, note: d % 15 === 0 ? "مظنه‌ی بازار تهران" : null,
      });
      bump("gold_rates");
    }
    const g18Now = g18;
    const gram = (d: number) => s(round(g18Now * (1 - d * 0.0009), 10000));

    const cats = (await api.get(O("/data/gold_category?size=100"))).rows as { id: string; name: string }[];
    const cat = (n: string) => cats.find((x) => x.name === n)!.id;
    const italian = (await api.post(O("/data/gold_category"), { name: "زنجیر ایتالیایی", default_fineness: 750, wage_type: "percent", wage_value: 12 })).row.id;
    bump("gold_categories");

    // tagged pieces bought from the wholesaler in three batches
    const PIECES: [string, string, number, number][] = [
      ["انگشتر", "انگشتر رینگ ساده", 3.2, 4.1], ["انگشتر", "انگشتر نگین‌دار", 4.4, 5.8], ["انگشتر", "انگشتر مردانه", 6.1, 8.2],
      ["گردنبند", "گردنبند ونیزی", 6.5, 9.4], ["گردنبند", "گردنبند پلاک اسم", 3.1, 4.6], ["دستبند", "دستبند کارتیه", 7.2, 11.5],
      ["دستبند", "دستبند زنجیری", 4.6, 6.9], ["النگو", "النگو ساده", 9.8, 14.2], ["النگو", "النگو طرح‌دار", 11.1, 15.7],
      ["گوشواره", "گوشواره حلقه‌ای", 2.1, 3.4], ["گوشواره", "گوشواره آویز", 2.8, 4.2], ["سرویس", "نیم‌ست عروس", 18.5, 26.0],
      ["آویز", "آویز قلب", 1.4, 2.3], ["زنجیر", "زنجیر کارتیه", 5.2, 8.8], ["پابند", "پابند ظریف", 2.2, 3.1],
    ];
    const pieces: { id: string; tag: string; doc: string }[] = [];
    for (let b = 0; b < 3; b++) {
      const date = ago(84 - b * 28);
      const lines = PIECES.map(([c, title, lo, hi]) => ({
        kind: "piece", category_id: c === "زنجیر" && b === 2 ? italian : cat(c), title, weight: (lo + R.next() * (hi - lo)).toFixed(3), fineness: "750",
        stone_weight: title.includes("نگین") ? "0.250" : undefined, wage_type: "percent", wage_value: String(R.int(3, 6)),
      })).filter((_, i) => (i + b) % 3 !== 0 || b === 0);
      const r = (await api.post(O("/gold/docs"), {
        kind: "purchase", date, party_id: party.g1.id, gram18: gram(84 - b * 28), settle: { mode: "rial" }, lines,
        description: `خرید از بنکدار — بار ${["اول", "دوم", "سوم"][b]}`,
      })).doc;
      for (const l of r.lines) pieces.push({ id: l.gold_item_id, tag: l.tag_no, doc: r.id });
      // most of each batch is paid to the wholesaler a few days later
      await api.post(O("/treasury/docs"), {
        kind: "payment", date: minDate(today, addDays(date, 4)), party_id: party.g1.id, description: "تسویه‌ی بخشی از خرید طلا",
        lines: [{ method: "bank", bank_account_id: bank1.id, amount: s(round(Number(r.total) * 0.75, 1_000_000)), ref_no: `SATNA-${R.int(100000, 999999)}` }],
      });
      bump("payments");
      ids.gold_purchase = r.id;
      bump("gold_docs");
      bump("gold_pieces", r.lines.length);
    }
    // coins bought from the wholesaler
    const coins = (await api.get(O("/data/item?f.kind=coin&size=50"))).rows as { id: string; name: string }[];
    const rob = coins.find((x) => x.name === "ربع سکه");
    const nim = coins.find((x) => x.name === "نیم سکه");
    if (rob && nim) {
      await api.post(O("/gold/docs"), {
        kind: "purchase", date: ago(50), party_id: party.g1.id,
        settle: { mode: "rial", bank: { bank_account_id: bank1.id, amount: s(round(g18Now * 3.55, 100000) * 12 + round(g18Now * 6.2, 100000) * 6) } },
        lines: [
          { kind: "coin", item_id: rob.id, qty: "12", gram_price: s(round(g18Now * 3.55, 100000)) },
          { kind: "coin", item_id: nim.id, qty: "6", gram_price: s(round(g18Now * 6.2, 100000)) },
        ],
      });
      bump("gold_docs");
    }

    // counter sales (some with a trade-in of used gold), priced through /gold/calc first
    const sellable = [...pieces];
    const customers = ["c2", "c4", "c6", "c8", "c10", "c12", null, null, "c1", null];
    for (let i = 0; i < 10; i++) {
      const date = at(0.3 + i * 0.07);
      const pick = sellable.splice(R.int(0, sellable.length - 1), 1)[0];
      const second = i % 4 === 0 ? sellable.splice(R.int(0, sellable.length - 1), 1)[0] : null;
      const tradeIn = i % 3 === 0;
      const lines: Record<string, unknown>[] = [{ kind: "piece", gold_item_id: pick.id }];
      if (second) lines.push({ kind: "piece", gold_item_id: second.id });
      if (tradeIn) lines.push({ kind: "old", weight: (1.2 + R.next() * 1.8).toFixed(2), fineness: "740" });
      const g = gram(Math.round(span * (1 - (0.3 + i * 0.07))));
      const doc = { kind: "sale", date, gram18: g, party_id: customers[i] ? party[customers[i]!].id : null, lines };
      let priced = (await api.post(O("/gold/calc"), { type: "doc", doc })).result;
      if (Number(priced.totals.net ?? priced.totals.total) <= Number(priced.totals.total) * 0.25) {
        // the trade-in would cover (almost) all of it: sell without it
        doc.lines = lines.filter((l) => l.kind !== "old");
        priced = (await api.post(O("/gold/calc"), { type: "doc", doc })).result;
      }
      const net = Number(priced.totals.net ?? priced.totals.total);
      const walkIn = !customers[i];
      const cash = walkIn || R.chance(0.5) ? Math.max(0, round(net * 0.3, 10000)) : 0;
      const settle: Record<string, unknown> = {};
      if (walkIn) {
        settle.cash = { cash_box_id: box.id, amount: s(cash) };
        settle.pos = { pos_id: pos.id, amount: s(net - cash) };
      } else if (cash) {
        settle.pos = { pos_id: pos.id, amount: s(Math.min(net, round(net * 0.8, 10000))) };
      }
      const r = (await api.post(O("/gold/docs"), {
        ...doc, settle, buyer: walkIn ? { name: R.pick(["نسرین یوسفی", "مینا کرمانی", "بهاره شریفی"]), mobile: `0912${R.int(1000000, 9999999)}` } : null,
      })).doc;
      ids.gold_sale = r.id;
      bump("gold_sales");
    }

    // buying used gold from a customer, a consignment from the gallery and a workshop round
    await api.post(O("/gold/docs"), {
      kind: "buyback", date: ago(12), party_id: party.c5.id, gram18: gram(12), lines: [{ kind: "old", weight: "8.40", fineness: "740", deduction_pct: "1" }],
      settle: { cash: { cash_box_id: box.id, amount: "100000000" } },
    }).catch(() => null);
    const cin = (await api.post(O("/gold/docs"), {
      kind: "consign_in", date: ago(30), party_id: party.g2.id, settle: { mode: "weight" }, description: "امانی گالری آریا — سرویس‌های عروس",
      lines: [
        { kind: "piece", category_id: cat("سرویس"), title: "سرویس کامل جواهر", weight: "32.450", wage_type: "percent", wage_value: "6", extra: { sale_wage_type: "percent", sale_wage_value: "22" } },
        { kind: "piece", category_id: cat("گردنبند"), title: "گردنبند طرح مروارید", weight: "11.200", wage_type: "percent", wage_value: "5", extra: { sale_wage_type: "percent", sale_wage_value: "18" } },
        { kind: "piece", category_id: cat("دستبند"), title: "دستبند طرح لوکس", weight: "9.850", wage_type: "percent", wage_value: "5" },
      ],
    })).doc;
    ids.gold_consign = cin.id;
    bump("gold_pieces", cin.lines.length);
    {
      const doc = { kind: "sale", date: ago(9), gram18: gram(9), party_id: party.c10.id, lines: [{ kind: "piece", gold_item_id: cin.lines[1].gold_item_id }] };
      const priced = (await api.post(O("/gold/calc"), { type: "doc", doc })).result;
      await api.post(O("/gold/docs"), { ...doc, settle: { bank: { bank_account_id: bank1.id, amount: s(priced.totals.total) } } });
      bump("gold_sales");
    }
  }

  // ---- exchange
  if (modules.includes("fx")) {
    const board = await api.get(O("/fx/rates"));
    const cur: Record<string, string> = {};
    for (const x of board.currencies) cur[x.code] = x.id;
    const base: Record<string, [number, number]> = { USD: [1_046_000, 1_056_000], EUR: [1_214_000, 1_229_000], AED: [284_500, 287_800], USDT: [1_048_000, 1_058_000], BTC: [98_400_000_000, 99_600_000_000] };
    const drift: Record<string, number> = { USD: 1, EUR: 1, AED: 1, USDT: 1, BTC: 1 };
    const rateOn: Record<string, Record<string, [number, number]>> = {};
    for (let d = Math.min(span, 30); d >= 0; d -= 2) {
      const day = ago(d);
      const rates = Object.entries(base).map(([code, [b, sl]]) => {
        drift[code] *= 1 + (R.next() - 0.45) * (code === "BTC" ? 0.03 : 0.006);
        const step = code === "BTC" ? 1_000_000 : code === "AED" ? 100 : 1000;
        const buy = round(b * drift[code], step);
        const sell = round(sl * drift[code], step);
        (rateOn[day] ??= {})[code] = [buy, sell];
        return { currency_id: cur[code], buy: s(buy), sell: s(sell) };
      });
      await api.post(O("/fx/rates"), { at: `${day}T06:30:00Z`, rates });
      bump("fx_rate_sets");
    }
    const rate = (day: string, code: string): [number, number] => {
      const days = Object.keys(rateOn).filter((d) => d <= day).sort();
      return rateOn[days[days.length - 1] ?? Object.keys(rateOn).sort()[0]][code];
    };
    await api.put(O("/fx/settings"), { kyc_threshold: "3000000000" }).catch(() => null);

    const wallet = (await api.post(O("/data/wallet"), {
      name: "کیف‌پول تتر (ترون)", currency_id: cur.USDT, chain: "TRON", address: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G", kind: "hot", auto_check: false,
    })).row;
    const btcWallet = (await api.post(O("/data/wallet"), {
      name: "کیف‌پول بیت‌کوین", currency_id: cur.BTC, chain: "BTC", address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", kind: "cold", auto_check: false,
    })).row;
    ids.wallet = wallet.id;
    bump("wallets", 2);

    const walkins = [
      { name: "رضا محمدی", national_id: nationalId("001234567"), mobile: "09121234567" },
      { name: "پریسا نیک‌نام", national_id: nationalId("004567812"), mobile: "09351234567" },
      { name: "بابک افشار", national_id: nationalId("002345678"), mobile: "09191234567" },
    ];
    const fxParties = ["c1", "c3", "c5", "c7", "c9", "c11"];
    const deal = (b: Record<string, unknown>) => api.post(O("/fx/deals"), { in_method: "cash", out_method: "cash", in_ref_id: box2.id, out_ref_id: box2.id, ...b });
    const held: Record<string, number> = { USD: 0, EUR: 0, AED: 0, USDT: 0, BTC: 0 };
    // opening buys so the till holds foreign cash
    const d0 = ago(Math.min(span, 30));
    for (const [code, amt] of [["USD", 6000], ["EUR", 3000], ["AED", 20000]] as [string, number][]) {
      const r = await deal({ date: d0, party_id: party.fx1.id, in_currency_id: cur[code], in_amount: String(amt), out_currency_id: cur.IRR, out_method: "bank", out_ref_id: bank2.id, rate: s(rate(d0, code)[0]), description: "خرید عمده از همکار" });
      held[code] += amt;
      ids.fx_deal = r.deal.id;
      bump("fx_deals");
    }
    for (let d = Math.min(span, 28); d >= 0; d -= 1) {
      const day = ago(d);
      const n = R.int(1, 3);
      for (let k = 0; k < n; k++) {
        const code = R.pick(["USD", "USD", "EUR", "AED"]);
        const [buy, sell] = rate(day, code);
        const who = R.chance(0.5) ? { party_id: party[R.pick(fxParties)].id } : { walkin: R.pick(walkins) };
        if (R.chance(0.36) || held[code] < 600) {
          const amt = code === "AED" ? R.int(5, 40) * 100 : R.int(2, 25) * 100;
          const r = await deal({ date: day, ...who, in_currency_id: cur[code], in_amount: String(amt), out_currency_id: cur.IRR, rate: s(buy) });
          held[code] += amt;
          ids.fx_deal = r.deal.id;
        } else {
          const amt = Math.min(held[code] - 100, code === "AED" ? R.int(5, 30) * 100 : R.int(1, 15) * 100);
          if (amt <= 0) continue;
          const r = await deal({ date: day, ...who, in_currency_id: cur.IRR, out_currency_id: cur[code], out_amount: String(amt), rate: s(sell), fee: R.chance(0.3) ? "500000" : null });
          held[code] -= amt;
          ids.fx_deal = r.deal.id;
        }
        bump("fx_deals");
      }
    }
    // an exchange USD → AED
    {
      const day = ago(6);
      const r = await deal({ date: day, party_id: party.c3.id, in_currency_id: cur.USD, in_amount: "1000", out_currency_id: cur.AED, out_amount: "3640" });
      ids.fx_deal_exchange = r.deal.id;
      bump("fx_deals");
    }
    // crypto into the wallets
    for (const [day, amt] of [[ago(18), "2500"], [ago(9), "1200"], [ago(2), "800"]] as [string, string][]) {
      await deal({ date: day, party_id: party.c9.id, in_currency_id: cur.USDT, in_amount: amt, in_method: "wallet", in_ref_id: wallet.id, out_currency_id: cur.IRR, out_method: "bank", out_ref_id: bank1.id, rate: s(rate(day, "USDT")[0]), network: "TRON", tx_hash: `demo${day.replace(/-/g, "")}${amt}` });
      bump("fx_deals");
    }
    {
      const day = ago(15);
      await deal({ date: day, party_id: party.c7.id, in_currency_id: cur.BTC, in_amount: "0.035", in_method: "wallet", in_ref_id: btcWallet.id, out_currency_id: cur.IRR, out_method: "bank", out_ref_id: bank1.id, rate: s(rate(day, "BTC")[0]), network: "BTC" });
      bump("fx_deals");
    }
    // remittances: one out (paid), one in (waiting)
    const r1 = (await api.post(O("/fx/remittances"), {
      date: ago(10), direction: "out", correspondent_id: party.fx1.id, currency_id: cur.AED, amount: "25000", rate: s(rate(ago(10), "AED")[1]), fee: "15000000",
      correspondent_fee: "50", pay_method: "bank", pay_ref_id: bank1.id, party_id: party.c5.id,
      sender: { name: party.c5.name, mobile: "09121234567" }, beneficiary: { name: "Hamid Rahmani Trading LLC", country: "UAE", bank: "Emirates NBD", account: "AE070331234567890123456" },
      description: "حواله‌ی بابت واردات کالا",
    })).remittance;
    await api.post(O(`/fx/remittances/${r1.id}/status`), { status: "sent", note: "ارسال به همکار دبی" });
    await api.post(O(`/fx/remittances/${r1.id}/status`), { status: "paid", date: ago(8) });
    const r2 = (await api.post(O("/fx/remittances"), {
      date: ago(3), direction: "in", correspondent_id: party.fx2.id, currency_id: cur.EUR, amount: "4200", rate: s(rate(ago(3), "EUR")[0]), fee: "20",
      pay_method: "cash", pay_ref_id: box2.id, beneficiary: { name: party.c2.name, national_id: nationalId("001122334"), mobile: "09129876543" },
      sender: { name: "Mehmet Yılmaz", country: "Turkey" }, description: "حواله‌ی ورودی از استانبول",
    })).remittance;
    ids.remittance = r1.id;
    ids.remittance_in = r2.id;
    bump("remittances", 2);
  }

  const result: SeedResult = { org_id: org, email: o.email, password: o.password, skipped: false, seconds: (Date.now() - t0) / 1000, requests: api.requests, ids, counts };
  await writeIds(o.idsOut, result);
  log(`done in ${result.seconds.toFixed(1)}s with ${api.requests} requests`, JSON.stringify(counts));
  return result;
}

async function writeIds(path: string | null, r: SeedResult) {
  if (!path) return;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, JSON.stringify(r, null, 2));
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv: string[]): Opts {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = get("base") ?? argv.find((a) => /^https?:\/\//.test(a));
  if (!base) {
    console.error("usage: npx tsx scripts/demo-seed.mts --base http://127.0.0.1:3939 [--org <id>] [--email e --password p] [--ids-out file.json] [--force] [--quiet]");
    process.exit(2);
  }
  return {
    base,
    org: get("org") ?? null,
    email: get("email") ?? DEMO.email,
    password: get("password") ?? DEMO.password,
    fullName: get("name") ?? DEMO.fullName,
    orgName: get("org-name") ?? DEMO.orgName,
    idsOut: get("ids-out") ?? null,
    force: argv.includes("--force"),
    quiet: argv.includes("--quiet"),
  };
}

const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href || process.argv[1]?.endsWith("demo-seed.mts");
  } catch {
    return false;
  }
})();
if (isMain) {
  seed(parseArgs(process.argv.slice(2))).then(
    (r) => console.log(JSON.stringify({ org_id: r.org_id, skipped: r.skipped, seconds: r.seconds, requests: r.requests })),
    (e) => {
      console.error(e instanceof Error ? (e.message.includes(" → ") ? e.message : e.stack) : e);
      process.exit(1);
    },
  );
}
