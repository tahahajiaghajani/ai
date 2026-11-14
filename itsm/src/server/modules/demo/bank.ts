// The demo bank (docs/DEMO_FA.md): «بانک نمونهٔ آفتاب», a clearly fictional Iranian bank — never a real bank's name,
// brand or people. Its vocabulary (provinces and cities, departments, Persian names, the texts of incidents, changes,
// problems, requests and articles) and a deterministic generator: the same size gives the same bank.

export type DemoSize = "small" | "medium" | "large";

export const DEMO_SIZES: Record<DemoSize, { label: string; branches: number; employees: number; agents: number; incidents: number; problems: number; changes: number; requests: number; articles: number; cis: number; assets: number; security: number; hr: number; cases: number; visits: number }> = {
  small: { label: "کوچک", branches: 60, employees: 90, agents: 36, incidents: 160, problems: 12, changes: 30, requests: 50, articles: 16, cis: 60, assets: 120, security: 10, hr: 10, cases: 12, visits: 16 },
  medium: { label: "متوسط", branches: 300, employees: 600, agents: 140, incidents: 2400, problems: 90, changes: 360, requests: 900, articles: 60, cis: 500, assets: 1800, security: 60, hr: 80, cases: 120, visits: 240 },
  large: { label: "بزرگ", branches: 2000, employees: 2500, agents: 500, incidents: 12000, problems: 300, changes: 1500, requests: 4500, articles: 150, cis: 2500, assets: 9000, security: 200, hr: 300, cases: 600, visits: 1200 },
};

export const BANK_NAME = "بانک نمونهٔ آفتاب";
/** The reserved `.example` domain: the pack's accounts can never be anybody's real address. */
export const BANK_DOMAIN = "aftab-bank.example";

/** Deterministic randomness (mulberry32): the same seed gives the same bank. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
  /** pick with weights */
  weighted<T>(a: readonly (readonly [T, number])[]): T {
    const total = a.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of a) if ((r -= w) <= 0) return v;
    return a[a.length - 1][0];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Where the sequence stands: a load step resumed by another job invocation continues from it (load.ts). */
  get state(): number {
    return this.s;
  }
  set state(s: number) {
    this.s = s | 0;
  }
}

export const FIRST_NAMES = "علی محمد حسین رضا مهدی امیر حمید سعید مجید مسعود جواد حسن احمد مرتضی مصطفی بهرام فرهاد کامران داریوش سیاوش پویا آرش بابک کیوان نیما مریم زهرا فاطمه سارا نرگس لیلا مینا شیرین پریسا الهام نازنین سمیرا مهسا فرشته آزاده نسرین رویا ژیلا هدیه یاسمن ترانه مهتاب".split(" ");
export const LAST_NAMES = "محمدی حسینی احمدی رضایی موسوی کریمی جعفری صادقی رحیمی کاظمی قاسمی مرادی ابراهیمی نوری عباسی سلیمانی یزدانی شریفی اکبری باقری حیدری رستمی طاهری فرجی زمانی نجفی امیری حسن‌زاده تهرانی اصفهانی شیرازی تبریزی کرمانی رشتی همدانی قزوینی یزدی سمنانی بابایی خسروی".split(" ");

/** Provinces with a few of their cities (the first is the capital) and their weight in the branch network. */
export const PROVINCES: readonly (readonly [string, readonly string[], number])[] = [
  ["تهران", ["تهران", "شهریار", "اسلامشهر", "ورامین", "دماوند"], 30],
  ["اصفهان", ["اصفهان", "کاشان", "نجف‌آباد", "خمینی‌شهر"], 9],
  ["خراسان رضوی", ["مشهد", "نیشابور", "سبزوار", "تربت حیدریه"], 9],
  ["فارس", ["شیراز", "مرودشت", "کازرون", "جهرم"], 7],
  ["آذربایجان شرقی", ["تبریز", "مراغه", "مرند"], 6],
  ["خوزستان", ["اهواز", "دزفول", "آبادان", "بندر ماهشهر"], 6],
  ["البرز", ["کرج", "فردیس", "نظرآباد"], 5],
  ["مازندران", ["ساری", "بابل", "آمل", "قائم‌شهر"], 5],
  ["گیلان", ["رشت", "لاهیجان", "بندر انزلی"], 4],
  ["کرمان", ["کرمان", "رفسنجان", "سیرجان"], 4],
  ["قم", ["قم"], 3],
  ["کرمانشاه", ["کرمانشاه", "اسلام‌آباد غرب"], 3],
  ["آذربایجان غربی", ["ارومیه", "خوی", "مهاباد"], 3],
  ["یزد", ["یزد", "میبد", "اردکان"], 3],
  ["هرمزگان", ["بندرعباس", "قشم", "کیش"], 3],
  ["همدان", ["همدان", "ملایر"], 2],
  ["مرکزی", ["اراک", "ساوه"], 2],
  ["قزوین", ["قزوین", "تاکستان"], 2],
  ["زنجان", ["زنجان", "ابهر"], 2],
  ["گلستان", ["گرگان", "گنبد کاووس"], 2],
  ["سیستان و بلوچستان", ["زاهدان", "زابل", "چابهار"], 2],
  ["اردبیل", ["اردبیل", "مشگین‌شهر"], 2],
  ["لرستان", ["خرم‌آباد", "بروجرد"], 2],
  ["کردستان", ["سنندج", "سقز"], 2],
  ["بوشهر", ["بوشهر", "بندر گناوه"], 2],
  ["سمنان", ["سمنان", "شاهرود"], 1],
];

/** Headquarters departments (کد، نام). */
export const HQ_DEPARTMENTS: readonly (readonly [string, string])[] = [
  ["IT", "فناوری اطلاعات"],
  ["CARD", "کارت و پرداخت"],
  ["EBNK", "بانکداری الکترونیک"],
  ["OPS", "عملیات"],
  ["SEC", "امنیت اطلاعات"],
  ["HR", "منابع انسانی"],
  ["LEGAL", "حقوقی"],
  ["AUDIT", "حسابرسی"],
  ["FIN", "امور مالی"],
  ["CRED", "اعتبارات"],
  ["CX", "خدمات مشتریان"],
  ["LOG", "پشتیبانی و تدارکات"],
];

/** The bank's support groups: key, name, roles of its members, the area of its work. */
export const GROUPS: readonly { key: string; name: string; roles: string[]; types: string[] }[] = [
  { key: "desk", name: "میز خدمت بانک", roles: ["agent"], types: ["assignment"] },
  { key: "network", name: "شبکه و ارتباطات بانک", roles: ["agent"], types: ["assignment", "oncall"] },
  { key: "core", name: "سامانهٔ کربنکینگ", roles: ["agent"], types: ["assignment", "oncall"] },
  { key: "card", name: "کارت و خودپرداز", roles: ["agent"], types: ["assignment", "oncall"] },
  { key: "soc", name: "عملیات امنیت بانک (SOC)", roles: ["security_analyst"], types: ["assignment", "oncall"] },
  { key: "dc", name: "مرکز دادهٔ بانک", roles: ["agent"], types: ["assignment", "oncall"] },
  { key: "apps", name: "نرم‌افزارهای کاربردی بانک", roles: ["agent"], types: ["assignment"] },
  { key: "ebank", name: "بانکداری اینترنتی و همراه", roles: ["agent"], types: ["assignment", "oncall"] },
  { key: "hr", name: "منابع انسانی بانک", roles: ["hr_agent"], types: ["assignment"] },
  { key: "legal", name: "امور حقوقی بانک", roles: ["agent"], types: ["assignment"] },
  { key: "assets", name: "مدیریت دارایی بانک", roles: ["agent", "asset_manager"], types: ["assignment", "approval"] },
  { key: "cab", name: "کمیتهٔ تغییرات بانک", roles: ["cab_member"], types: ["cab", "approval"] },
  { key: "csm", name: "خدمات پذیرندگان و مشتریان حقوقی", roles: ["csm_agent"], types: ["assignment"] },
];

/** Regions of the branch network: a field-support group each. */
export const REGIONS = ["تهران بزرگ", "شمال و شمال‌غرب", "شرق", "مرکز", "جنوب و جنوب‌غرب", "غرب"];
export const REGION_OF: Record<string, string> = {
  تهران: "تهران بزرگ",
  البرز: "تهران بزرگ",
  قم: "مرکز",
  اصفهان: "مرکز",
  یزد: "مرکز",
  مرکزی: "مرکز",
  سمنان: "مرکز",
  "خراسان رضوی": "شرق",
  کرمان: "شرق",
  "سیستان و بلوچستان": "شرق",
  فارس: "جنوب و جنوب‌غرب",
  خوزستان: "جنوب و جنوب‌غرب",
  هرمزگان: "جنوب و جنوب‌غرب",
  بوشهر: "جنوب و جنوب‌غرب",
  "آذربایجان شرقی": "شمال و شمال‌غرب",
  "آذربایجان غربی": "شمال و شمال‌غرب",
  مازندران: "شمال و شمال‌غرب",
  گیلان: "شمال و شمال‌غرب",
  گلستان: "شمال و شمال‌غرب",
  اردبیل: "شمال و شمال‌غرب",
  زنجان: "شمال و شمال‌غرب",
  قزوین: "شمال و شمال‌غرب",
  کرمانشاه: "غرب",
  همدان: "غرب",
  لرستان: "غرب",
  کردستان: "غرب",
};

export const BRANCH_STREETS = ["مرکزی", "آزادی", "انقلاب", "امام", "بهار", "فردوسی", "ولیعصر", "سعدی", "حافظ", "جمهوری", "بازار", "میدان شهدا", "پارک", "دانشگاه", "صنعتی", "فرودگاه", "بلوار ساحلی", "شهرک غرب", "نارمک", "تجریش"];

/** Business and technical services of the bank (generic interbank services, never a real network's brand). */
export const SERVICES: readonly { key: string; name: string; type: "business" | "technical"; group: string; critical: boolean; desc: string }[] = [
  { key: "core", name: "سامانهٔ کربنکینگ (متمرکز)", type: "technical", group: "core", critical: true, desc: "هستهٔ حساب‌ها، سپرده‌ها و تسهیلات همهٔ شعب؛ پایگاه دادهٔ متمرکز با رونوشت در سایت پشتیبان." },
  { key: "card", name: "مدیریت کارت", type: "technical", group: "card", critical: true, desc: "صدور، فعال‌سازی و مسدودسازی کارت‌های بانکی و کارت هدیه." },
  { key: "switch", name: "سوئیچ کارت", type: "technical", group: "card", critical: true, desc: "مسیریابی تراکنش‌های کارتی خودپردازها و پایانه‌های فروش به شبکهٔ بین‌بانکی کارت." },
  { key: "atm", name: "شبکهٔ خودپردازها", type: "business", group: "card", critical: true, desc: "خودپردازها و دستگاه‌های بازیافت پول شعب و باجه‌های مستقل." },
  { key: "hsm", name: "ماژول امنیت سخت‌افزاری (HSM)", type: "technical", group: "soc", critical: true, desc: "نگهداری کلیدهای رمز کارت و پین؛ دو دستگاه در مرکز داده و یکی در سایت پشتیبان." },
  { key: "swift", name: "پیام‌رسان بین‌المللی بانکی", type: "technical", group: "apps", critical: true, desc: "تبادل پیام‌های مالی بین‌المللی با بانک‌های کارگزار (خدمت عمومی پیام‌رسانی بین‌بانکی)." },
  { key: "rtgs", name: "تسویهٔ ناخالص آنی بین‌بانکی", type: "business", group: "apps", critical: true, desc: "انتقال وجه بزرگ و فوری بین بانک‌ها (خدمت عمومی تسویهٔ آنی بین‌بانکی)." },
  { key: "ach", name: "پایاپای الکترونیک بین‌بانکی", type: "business", group: "apps", critical: true, desc: "انتقال وجه گروهی در چرخه‌های روزانه (خدمت عمومی پایاپای بین‌بانکی)." },
  { key: "cheque", name: "تبادل تصویر چک", type: "business", group: "apps", critical: true, desc: "ثبت، تبادل و تسویهٔ چک‌ها با تصویر (خدمت عمومی تبادل چک)." },
  { key: "pos", name: "شبکهٔ پرداخت پایانه‌های فروش", type: "business", group: "card", critical: true, desc: "پذیرندگان و پایانه‌های فروش متصل به شبکهٔ عمومی پرداخت کارتی." },
  { key: "ibank", name: "بانکداری اینترنتی", type: "business", group: "ebank", critical: true, desc: "درگاه وب مشتریان حقیقی و حقوقی: مانده، انتقال وجه، صورت‌حساب." },
  { key: "mbank", name: "بانکداری همراه", type: "business", group: "ebank", critical: true, desc: "برنامهٔ تلفن همراه مشتریان با ورود دومرحله‌ای." },
  { key: "dc", name: "مرکز دادهٔ اصلی", type: "technical", group: "dc", critical: true, desc: "تالار سرور، برق اضطراری، سرمایش و رک‌های شبکهٔ مرکزی." },
  { key: "dr", name: "سایت پشتیبان (DR)", type: "technical", group: "dc", critical: true, desc: "سایت بازیابی از فاجعه با رونوشت هم‌زمان کربنکینگ." },
  { key: "wan", name: "شبکهٔ ارتباطی شعب", type: "technical", group: "network", critical: true, desc: "خطوط اختصاصی و پشتیبان شعب، مسیریاب‌ها و دیواره‌های آتش شعب." },
  { key: "mail", name: "ایمیل و همکاری سازمانی", type: "business", group: "apps", critical: false, desc: "پست الکترونیک، تقویم و پیام‌رسان داخلی کارکنان." },
  { key: "teller", name: "سامانهٔ باجه و صندوق", type: "business", group: "core", critical: true, desc: "نرم‌افزار باجه، چاپ دفترچه و رسید در شعب." },
];

export const INCIDENTS: readonly { text: string; detail: string; service: string; group: string; weight: number; impact: [string, string] }[] = [
  { text: "گیر کردن اسکناس در خودپرداز شعبه", detail: "دستگاه پس از شمارش اسکناس پیام خطای مخزن داد و از سرویس خارج شد؛ مشتریان در صف هستند.", service: "atm", group: "card", weight: 14, impact: ["2", "2"] },
  { text: "خرابی کارت‌خوان خودپرداز", detail: "کارت‌خوان کارت را نمی‌خواند و بعد از دو تلاش کارت را پس می‌دهد.", service: "atm", group: "card", weight: 9, impact: ["2", "2"] },
  { text: "کندی سامانهٔ کربنکینگ در ساعات اوج", detail: "ثبت تراکنش در باجه بیش از سی ثانیه طول می‌کشد؛ چند شعبه همزمان گزارش داده‌اند.", service: "core", group: "core", weight: 6, impact: ["1", "2"] },
  { text: "خطای ورود به بانکداری اینترنتی", detail: "مشتریان پس از وارد کردن رمز یکبار مصرف پیام «نشست نامعتبر» می‌گیرند.", service: "ibank", group: "ebank", weight: 5, impact: ["2", "1"] },
  { text: "عدم ورود به بانکداری همراه", detail: "پس از به‌روزرسانی برنامه، ورود با اثر انگشت برای برخی مشتریان کار نمی‌کند.", service: "mbank", group: "ebank", weight: 5, impact: ["2", "2"] },
  { text: "قطعی شبکهٔ شعبه", detail: "خط اصلی شعبه قطع است و خط پشتیبان فعال نشده؛ باجه‌ها آفلاین هستند.", service: "wan", group: "network", weight: 8, impact: ["2", "1"] },
  { text: "خرابی چاپگر دفترچه", detail: "چاپگر دفترچهٔ باجهٔ دو کاغذ را جمع می‌کند و چاپ نیمه‌کاره می‌ماند.", service: "teller", group: "desk", weight: 10, impact: ["3", "3"] },
  { text: "بازنشانی گذرواژهٔ کاربر", detail: "کاربر پس از سه بار ورود نادرست قفل شده و درخواست بازنشانی دارد.", service: "mail", group: "desk", weight: 14, impact: ["3", "3"] },
  { text: "گزارش ایمیل مشکوک (فیشینگ)", detail: "ایمیلی با عنوان «به‌روزرسانی فوری حساب» و پیوند ناشناس به چند کارمند رسیده است.", service: "mail", group: "soc", weight: 6, impact: ["2", "2"] },
  { text: "خطای انتقال وجه پایاپای", detail: "دستورهای چرخهٔ دوم پایاپای با خطای قالب فایل برگشت خورده است.", service: "ach", group: "apps", weight: 4, impact: ["1", "2"] },
  { text: "تأخیر در تسویهٔ آنی بین‌بانکی", detail: "پیام‌های تسویهٔ آنی بیش از ده دقیقه در صف خروجی مانده‌اند.", service: "rtgs", group: "apps", weight: 3, impact: ["1", "1"] },
  { text: "خطای ثبت چک در تبادل تصویر چک", detail: "تصویر چک‌های اسکن‌شده در شعبه رد می‌شود (کیفیت تصویر نامعتبر).", service: "cheque", group: "apps", weight: 4, impact: ["2", "2"] },
  { text: "قطعی پایانه‌های فروش یک پذیرنده", detail: "پایانه‌های فروشگاه زنجیره‌ای پاسخ «صادرکننده در دسترس نیست» می‌دهند.", service: "pos", group: "card", weight: 5, impact: ["2", "2"] },
  { text: "کندی باز شدن صندوق پست الکترونیک", detail: "صندوق‌های پست کارکنان ستاد با تأخیر باز می‌شوند.", service: "mail", group: "apps", weight: 3, impact: ["3", "3"] },
  { text: "هشدار دمای تالار سرور", detail: "حسگر ردیف C دمای ۳۱ درجه گزارش داده است.", service: "dc", group: "dc", weight: 2, impact: ["1", "2"] },
];

export const PROBLEMS: readonly { text: string; cause: string; workaround: string; service: string; group: string }[] = [
  { text: "گیر کردن مکرر اسکناس در خودپردازهای یک مدل", cause: "فرسودگی تسمه‌های مخزن و نسخهٔ قدیمی نرم‌افزار کنترل‌کنندهٔ دستگاه.", workaround: "تمیزکاری مخزن و کاهش ظرفیت هر کاست به ۸۰ درصد.", service: "atm", group: "card" },
  { text: "کندی دوره‌ای کربنکینگ در پایان ماه", cause: "اجرای گزارش‌های سنگین پایان ماه روی پایگاه دادهٔ عملیاتی.", workaround: "انتقال گزارش‌ها به رونوشت فقط‌خواندنی پس از ساعت ۱۶.", service: "core", group: "core" },
  { text: "قطعی‌های پراکندهٔ خط پشتیبان شعب استان", cause: "پیکربندی نادرست مسیریابی پویا در مسیریاب‌های یک سری خرید.", workaround: "فعال‌سازی دستی خط پشتیبان از مرکز عملیات شبکه.", service: "wan", group: "network" },
  { text: "خطای نشست در بانکداری اینترنتی پس از به‌روزرسانی", cause: "ناسازگاری زمان انقضای توکن بین درگاه و سرویس احراز هویت.", workaround: "پاک کردن کوکی مرورگر و ورود دوباره.", service: "ibank", group: "ebank" },
  { text: "رد شدن تصاویر چک از شعب با اسکنر قدیمی", cause: "وضوح تصویر کمتر از حد استاندارد تبادل چک.", workaround: "اسکن دوباره با تنظیم ۳۰۰ نقطه در اینچ.", service: "cheque", group: "apps" },
];

export const CHANGES: readonly { text: string; plan: string; service: string; group: string; risk: "low" | "moderate" | "high" }[] = [
  { text: "ارتقای نسخهٔ نرم‌افزار خودپردازها", plan: "ارتقای مرحله‌ای ۲۰ دستگاه در هر شب، با بازگشت به نسخهٔ قبل در صورت خطا.", service: "atm", group: "card", risk: "moderate" },
  { text: "نصب وصله‌های امنیتی سرورهای کربنکینگ", plan: "نصب در پنجرهٔ نگهداری جمعه ۰۲:۰۰ تا ۰۶:۰۰ با جابه‌جایی به گره دوم خوشه.", service: "core", group: "core", risk: "high" },
  { text: "تعویض گواهی‌های امنیتی بانکداری اینترنتی", plan: "جایگزینی گواهی پیش از انقضا روی متعادل‌کنندهٔ بار و آزمون ورود.", service: "ibank", group: "ebank", risk: "moderate" },
  { text: "افزایش پهنای باند شعب استان", plan: "ارتقای خطوط اختصاصی ۴۰ شعبه با هماهنگی مخابرات.", service: "wan", group: "network", risk: "low" },
  { text: "تغییر کلیدهای HSM", plan: "تولید کلید جدید با حضور دو امین کلید و بارگذاری در هر سه دستگاه.", service: "hsm", group: "soc", risk: "high" },
  { text: "استقرار نسخهٔ جدید بانکداری همراه", plan: "انتشار تدریجی ۱۰ درصدی و پایش خطاهای ورود.", service: "mbank", group: "ebank", risk: "moderate" },
  { text: "آزمون جابه‌جایی به سایت پشتیبان", plan: "جابه‌جایی کربنکینگ به سایت DR در پنجرهٔ آخر هفته و بازگشت.", service: "dr", group: "dc", risk: "high" },
  { text: "به‌روزرسانی قالب فایل پایاپای", plan: "اعمال قالب جدید ابلاغی و آزمون با محیط آزمایشی بین‌بانکی.", service: "ach", group: "apps", risk: "moderate" },
];

export const REQUESTS: readonly { item: string; text: string; detail: string }[] = [
  { item: "لپ‌تاپ جدید", text: "لپ‌تاپ برای کارشناس اعتبارات", detail: "برای بازدید از طرح‌های مشتریان، لپ‌تاپ با رمزگذاری دیسک لازم است." },
  { item: "درخواست دسترسی", text: "دسترسی به سامانهٔ کربنکینگ", detail: "دسترسی نقش «متصدی باجه» برای همکار تازه منتقل‌شده به شعبه." },
  { item: "دسترسی VPN", text: "دسترسی VPN برای دورکاری", detail: "دسترسی دورکاری با توکن سخت‌افزاری برای کارشناس امنیت." },
  { item: "ورود کارمند جدید", text: "ورود کارمند جدید شعبه", detail: "حساب کاربری، ایمیل، رایانه و دسترسی باجه برای کارمند جدید." },
  { item: "نصب نرم‌افزار", text: "نصب نرم‌افزار تحلیل آماری", detail: "نصب نسخهٔ دارای مجوز برای واحد حسابرسی." },
  { item: "صندوق پست الکترونیک", text: "افزایش ظرفیت صندوق پست", detail: "صندوق پست واحد حقوقی پر شده است." },
];

export const ARTICLES: readonly { title: string; body: string }[] = [
  { title: "رفع گیر کردن اسکناس در خودپرداز", body: "۱. دستگاه را از سرویس خارج کنید.\n۲. کاست را طبق دستورالعمل ایمنی بیرون بیاورید و اسکناس‌های گیرکرده را ثبت کنید.\n۳. مسیر عبور اسکناس را تمیز کنید و دستگاه را آزمایش کنید.\n۴. در صورت تکرار، به گروه کارت و خودپرداز ارجاع دهید." },
  { title: "بازنشانی گذرواژهٔ کاربران شعبه", body: "هویت کاربر را با شمارهٔ پرسنلی و تماس با رئیس شعبه تأیید کنید، سپس گذرواژهٔ موقت بسازید و تغییر آن در ورود بعدی را الزامی کنید." },
  { title: "اتصال به VPN سازمانی", body: "برنامهٔ اتصال را از درگاه نرم‌افزار نصب کنید، توکن سخت‌افزاری را وصل کنید و با نام کاربری سازمانی وارد شوید." },
  { title: "رفع کندی سامانهٔ کربنکینگ در شعبه", body: "اتصال شبکهٔ شعبه را با آزمون تأخیر بررسی کنید؛ اگر تأخیر طبیعی است، شمارهٔ رخداد کلی را از میز خدمت بپرسید." },
  { title: "شناسایی ایمیل فیشینگ", body: "نشانی فرستنده، پیوندها و پیوست‌ها را بررسی کنید؛ هرگز روی پیوند کلیک نکنید و ایمیل را با دکمهٔ «گزارش فیشینگ» برای مرکز عملیات امنیت بفرستید." },
  { title: "راه‌اندازی دوبارهٔ خط پشتیبان شعبه", body: "در صورت قطعی خط اصلی، چراغ مودم پشتیبان را بررسی کنید و با مرکز عملیات شبکه برای فعال‌سازی دستی تماس بگیرید." },
  { title: "رفع خطای چاپگر دفترچه", body: "کاغذ را خارج کنید، هد چاپ را تمیز کنید و تنظیم ضخامت دفترچه را روی «دفترچهٔ بانکی» بگذارید." },
  { title: "راهنمای ثبت چک در سامانهٔ تبادل تصویر", body: "چک را با وضوح ۳۰۰ نقطه در اینچ اسکن کنید، اطلاعات خوانده‌شده را تطبیق دهید و پیش از ارسال، تصویر پشت و روی چک را بررسی کنید." },
];

export const KNOWN_NAMES = {
  agent: { email: `agent@${BANK_DOMAIN}`, name: "نگار کارشناس‌پور", title: "کارشناس میز خدمت", roles: ["agent"] },
  manager: { email: `manager@${BANK_DOMAIN}`, name: "بهروز مدیرنیا", title: "مدیر میز خدمت و رخدادهای عمده", roles: ["service_desk_manager", "incident_manager", "problem_manager"] },
  requester: { email: `requester@${BANK_DOMAIN}`, name: "سمیه شعبه‌دار", title: "رئیس شعبهٔ میدان آزادی", roles: ["requester"] },
  change: { email: `change@${BANK_DOMAIN}`, name: "کاوه تغییری", title: "مدیر تغییرات", roles: ["change_manager", "cab_member"] },
  assets: { email: `assets@${BANK_DOMAIN}`, name: "رامین دارایی", title: "مدیر دارایی و ناوگان خودپرداز", roles: ["asset_manager", "configuration_manager"] },
  soc: { email: `soc@${BANK_DOMAIN}`, name: "لادن امن‌زاده", title: "تحلیل‌گر مرکز عملیات امنیت", roles: ["security_analyst"] },
  hr: { email: `hr@${BANK_DOMAIN}`, name: "پروانه منابعی", title: "کارشناس منابع انسانی", roles: ["hr_agent"] },
  branch: { email: `branch@${BANK_DOMAIN}`, name: "یاسر اموالی", title: "مسئول اموال شعبهٔ میدان آزادی", roles: ["branch_asset_officer"] },
  // the rest of the bank: finance, customer service, field service, operations, release and projects, risk, workforce
  // (roles the modules seed; none is an administrator's)
  finance: { email: `finance@${BANK_DOMAIN}`, name: "مهرداد بودجه‌نژاد", title: "مدیر مالی فناوری اطلاعات", roles: ["it_finance"] },
  csm: { email: `csm@${BANK_DOMAIN}`, name: "شبنم مشتری‌مدار", title: "کارشناس خدمات پذیرندگان و مشتریان حقوقی", roles: ["csm_agent"] },
  field: { email: `field@${BANK_DOMAIN}`, name: "حمید میدانی", title: "توزیع‌کنندهٔ خدمات میدانی خودپردازها", roles: ["dispatcher"] },
  ops: { email: `ops@${BANK_DOMAIN}`, name: "آرمان پایش‌گر", title: "مهندس پایش و کشیک کارت و خودپرداز", roles: ["ops_engineer"] },
  release: { email: `release@${BANK_DOMAIN}`, name: "سپیده انتشاری", title: "مدیر انتشار و دواپس", roles: ["release_manager"] },
  pm: { email: `pm@${BANK_DOMAIN}`, name: "کامبیز پروژه‌پور", title: "مدیر پروژه‌های فناوری", roles: ["project_manager"] },
  grc: { email: `grc@${BANK_DOMAIN}`, name: "ژاله ریسک‌شناس", title: "مدیر ریسک، انطباق و تداوم کسب‌وکار", roles: ["grc_manager", "continuity_manager"] },
  wfm: { email: `wfm@${BANK_DOMAIN}`, name: "مینو نوبت‌نگار", title: "مدیر نیروی کار و نوبت‌کاری", roles: ["workforce_manager"] },
} as const;

export type Persona = keyof typeof KNOWN_NAMES;
