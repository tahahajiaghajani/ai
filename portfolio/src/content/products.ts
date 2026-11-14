import type { Product } from "@/content/types";

/**
 * Taha's own products, each with a section of its own on the home page (its slug is the section id). The web version
 * is open to everyone; the Windows and server editions are locked here on purpose: visitors contact Taha to use them,
 * so never link their installers.
 */
export const PRODUCTS: Product[] = [
  {
    slug: "siraf",
    name: { fa: "سیراف", en: "Siraf" },
    category: { fa: "محصول · حسابداری و مدیریت کسب‌وکار", en: "Product · Accounting & business management" },
    tagline: { fa: "هر داد و ستد، به حساب می‌نشیند.", en: "Where trade settles." },
    summary: {
      fa: "سیراف یک دفتر کل است برای کسب‌وکارهایی که کالا، طلا و ارز را با هم داد و ستد می‌کنند: هر ردیف سند، مبلغ ریالی، مبلغ ارزی با نرخش و وزن طلا را با هم نگه می‌دارد. حسابداری ایرانی از پایه، با کنترل‌هایی هم‌سطح سامانه‌های سازمانی: چند کسب‌وکار زیر یک حساب، نقش‌ها و دسترسی بخش‌به‌بخش، گزارش ممیزی و سال مالیِ بسته‌ای که دیگر تغییر نمی‌کند. نامش از بندر سیراف می‌آید؛ بندری در خلیج فارس که روزگاری ابریشم، مروارید، طلا و سکه‌ی سرزمین‌های دور در آن دست‌به‌دست می‌شد.",
      en: "Siraf is one general ledger for businesses that trade goods, gold and currency together: every voucher line carries a rial amount, a currency amount with its rate, and a gold weight. Iranian accounting from the ground up, with enterprise-grade controls: several businesses under one account, roles with per-area access, an audit log, and closed fiscal years that can no longer change. It is named after Siraf, the Persian Gulf port where silk, pearls, gold and coin from distant lands once changed hands.",
    },
    features: {
      fa: [
        "یک دفتر کل برای کالا، طلا و ارز: هر ردیف سند مبلغ ریالی، مبلغ ارزی با نرخ و وزن طلا دارد، و تراز و دفاتر هر سه را نشان می‌دهند.",
        "برای حسابداری ایرانی: کدینگ گروه، کل، معین و تفصیلی، تقویم شمسی، چک صیادی، ارزش افزوده و خروجی صورتحساب در قالب سامانه‌ی مؤدیان.",
        "طلا با اتیکت بارکددار، فرمول قانونی فروش و حساب وزنی اشخاص؛ صرافی با نرخ زنده، حواله و کیف‌پول رمزارز.",
        "روی وب و ویندوز: نسخه‌ی ویندوز بی‌اینترنت کار می‌کند، در شبکه‌ی فروشگاه به رایانه‌ها و گوشی‌های دیگر سرویس می‌دهد و خودکار با نسخه‌ی وب هم‌گام می‌شود.",
        "نقش‌ها و دسترسی بخش‌به‌بخش، گزارش رویدادها، پشتیبانی که فقط با جلسه‌ی ثبت‌شده و محدود وارد می‌شود، و سال مالی بسته‌ای که تغییر نمی‌کند.",
        "دستیار هوش مصنوعی با کلید خود کسب‌وکار: عددها از دفاتر می‌آیند و هر سندی که پیشنهاد می‌دهد تا تأیید یک شخص مجاز پیش‌نویس می‌ماند.",
      ],
      en: [
        "One general ledger for goods, gold and currency: every voucher line carries a rial amount, a currency amount with its rate and a gold weight, and the trial balance and ledgers show all three.",
        "Made for Iranian accounting: the four-level chart of accounts, the Jalali calendar, Sayad cheques, VAT and e-invoice export in the tax system's format.",
        "Gold with barcoded tags, the legal sale formula and weight accounts; currency exchange with live rates, remittances and crypto wallets.",
        "On the web and on Windows: the Windows app works fully offline, serves the shop's other PCs and phones over the LAN, and syncs with the web version on its own.",
        "Roles with per-area access, an audit log, support that gets in only through a recorded, time-limited session, and closed fiscal years that cannot change.",
        "An AI assistant on the business's own key: the numbers come from the books, and every entry it suggests stays a draft until a permitted person confirms it.",
      ],
    },
    editions: [
      { kind: "web", href: "https://siraf.vercel.app", note: { fa: "در مرورگر و روی گوشی؛ روی Vercel و Supabase.", en: "In the browser and on phones; on Vercel and Supabase." } },
      { kind: "windows", note: { fa: "یک فایل نصب با پایگاه داده‌ی درون‌برنامه؛ بی‌اینترنت کار می‌کند و با نسخه‌ی وب هم‌گام می‌شود.", en: "One installer with its own embedded database; works offline and syncs with the web version." } },
    ],
    shots: [
      {
        kind: "image",
        src: "/media/products/siraf/dashboard-light.webp",
        w: 1440,
        h: 900,
        frame: "browser",
        tone: "mono",
        blur: "data:image/webp;base64,UklGRjIAAABXRUJQVlA4ICYAAABwAQCdASoQAAoAA4BaJaV9qAGIAAD+9Ae0u1ZdOKXKhkHJ1DgAAA==",
        alt: { fa: "پیشخوان سیراف با داده‌ی نمایشی یک بازرگانی ساختگی: موجودی نقد و بانک، درآمد و سود، طلب از اشخاص، چک‌های پیش رو و آخرین اسناد", en: "The Siraf dashboard with a fictional trading business's demo data: cash and bank, income and profit, receivables, upcoming cheques and the latest documents" },
        caption: { fa: "پیشخوان، با داده‌ی نمایشی", en: "The dashboard, with demo data" },
      },
      {
        kind: "image",
        src: "/media/products/siraf/ledger-gold-light.webp",
        w: 1440,
        h: 900,
        frame: "browser",
        tone: "mono",
        blur: "data:image/webp;base64,UklGRigAAABXRUJQVlA4IBwAAAAwAQCdASoQAAoAA4BaJaQAA3AA/vQOVe4AnsIA",
        alt: { fa: "دفتر حساب موجودی مصنوعات طلا در سیراف: هر ردیف وزن به گرم، بدهکار و بستانکار به ریال و مانده دارد", en: "The gold-stock ledger in Siraf: every row carries a weight in grams, debit and credit in rials, and a running balance" },
        caption: { fa: "دفتر حساب طلا: وزن و ریال در یک ردیف", en: "The gold ledger: weight and rials on one line" },
      },
    ],
    stack: ["React 19", "Ant Design 6", "Tailwind 4", "Vite", "Hono", "Next.js 16", "PostgreSQL · Supabase", "PGlite (WASM)", "Electron", "decimal.js", "Vitest", "GitHub Actions"],
    status: { fa: "نسخه‌ی ۱٫۰؛ نسخه‌ی وب زنده است و نسخه‌ی ویندوز منتشر شده", en: "v1.0; the web version is live and the Windows app is released" },
    period: { fa: "۱۰ تا ۱۹ آبان ۱۴۰۵", en: "Nov 1 – 10, 2026" },
    role: { fa: "مفهوم محصول، پژوهش بازار، برند، مشخصات، معماری و پیاده‌سازی", en: "Product concept, market research, brand, specification, architecture and implementation" },
    tags: ["سیراف", "Siraf", "حسابداری", "accounting", "دفتر کل", "ledger", "طلا", "gold", "طلافروشی", "ارز", "currency", "صرافی", "exchange", "کالا", "انبار", "inventory", "مؤدیان", "e-invoice", "ارزش افزوده", "VAT", "چک", "ERP", "ویندوز", "Windows", "آفلاین", "offline"],
  },
  {
    slug: "kariz",
    name: { fa: "کاریز", en: "Kariz" },
    category: { fa: "محصول · مدیریت خدمات سازمان (ITSM و ESM)", en: "Product · Enterprise service management (ITSM & ESM)" },
    tagline: { fa: "مدیریت هوشمند خدمات سازمان", en: "Intelligent service management" },
    summary: {
      fa: "کاریز همه‌ی کار میز خدمت و فناوری اطلاعات سازمان را، از رخداد و مشکل و تغییر تا درخواست، دانش، پیکربندی و دارایی، روی یک سکوی فارسی و راست‌چین می‌آورد که بر پایه‌ی شیوه‌های ITIL 4 طراحی شده است؛ روی وب، روی ویندوزِ بی‌اینترنت، یا روی سرورِ شبکه‌ی بسته‌ی سازمان. نامش همان کاریز است، قنات: زیرساختی پنهان که آب را آرام، پیوسته و به اندازه به شهر می‌رساند.",
      en: "Kariz brings an organisation's whole service desk onto one Persian, right-to-left platform built around ITIL 4 practices: incidents, problems, changes, requests, knowledge, configuration and assets. It runs on the web, on Windows without internet, or on a server inside a closed intranet. Its name is the Persian word for a qanat: hidden infrastructure that carries water to the town quietly, steadily and by measure.",
    },
    features: {
      fa: [
        "فرایندهای اصلی مدیریت خدمات روی یک سکو: رخداد و رخداد عمده، مشکل، تغییر، درخواست و کاتالوگ، دانش، CMDB، دارایی‌ها و سطح خدمت.",
        "سه نسخه با یک کد: وب، برنامه‌ی ویندوز که بی‌اینترنت کار می‌کند و با وب هم‌گام می‌شود، و نسخه‌ی سرور برای شبکه‌ی بسته‌ی سازمان.",
        "دستیار هوش مصنوعی در همه‌ی صفحه‌ها که فقط آنچه کاربر اجازه‌ی دیدنش را دارد می‌بیند؛ هر تغییری که پیشنهاد می‌دهد پیش‌نویسی است که شخص مجاز تأییدش می‌کند. با کلید خود سازمان یا مدل محلی.",
        "ورود با Active Directory و ورود خودکار ویندوز، نقش‌ها و فضاهای کاری امن، گزارش ممیزی و پشتیبان‌گیری خودکار.",
        "فراتر از فناوری اطلاعات: خدمات منابع انسانی، امور اداری، مالی و حقوقی در فضاهای امن خودشان؛ و رویدادها و کشیک، تداوم کسب‌وکار و گزارش‌ها.",
        "فارسی و راست‌چین از پایه: تقویم شمسی، تعطیلات رسمی و هفته‌ی کاری ایران، و جست‌وجوی فارسی‌آگاه.",
      ],
      en: [
        "Every core service-management practice on one platform: incidents and major incidents, problems, changes, requests and catalogue, knowledge, CMDB, assets and service levels.",
        "Three editions, one codebase: web, a Windows app that works offline and syncs with the web, and a server edition for closed intranets.",
        "An AI assistant on every page that sees only what the user may see; every change it suggests is a draft a permitted person confirms. On the organisation's own key or a local model.",
        "Active Directory sign-in and Windows single sign-on, role-based secure workspaces, audit logs and automatic backups.",
        "Beyond IT: HR, facilities, finance and legal services in secure workspaces of their own, plus events and on-call, business continuity and reporting.",
        "Persian and right-to-left from the ground up: the Jalali calendar, Iranian holidays and working week, and Persian-aware search.",
      ],
    },
    editions: [
      { kind: "web", href: "https://kariz-itsm.vercel.app", note: { fa: "در مرورگر؛ روی Vercel و Supabase.", en: "In the browser; on Vercel and Supabase." } },
      { kind: "windows", note: { fa: "با پایگاه داده‌ی درون‌برنامه؛ بی‌اینترنت کار می‌کند، یا به وب یا سرور سازمان وصل می‌شود.", en: "With its own embedded database; works offline, or links to the web or the organisation's server." } },
      { kind: "server", note: { fa: "یک فایل نصب برای ویندوز سرور در شبکه‌ی بسته: PostgreSQL، HTTPS، پشتیبان‌گیری و ورود با Active Directory.", en: "One installer for Windows Server on a closed network: PostgreSQL, HTTPS, backups and Active Directory sign-in." } },
    ],
    shots: [
      {
        kind: "image",
        src: "/media/products/kariz/agent-home-dark.webp",
        w: 1440,
        h: 900,
        frame: "browser",
        tone: "mono",
        blur: "data:image/webp;base64,UklGRiwAAABXRUJQVlA4ICAAAABwAQCdASoQAAoAA4BaJaWVuAGIAAD+8ifqMCqbneQAAA==",
        alt: { fa: "خانه‌ی کارشناس در کاریز با داده‌ی نمونه: کار بعدی پیشنهادی، کارهای من، شیفت امروز و زمان‌سنج‌های در خطر", en: "The agent home in Kariz with sample data: the suggested next task, my work, today's shift and timers at risk" },
        caption: { fa: "خانه‌ی کارشناس، با داده‌ی نمونه", en: "The agent home, with sample data" },
      },
      {
        kind: "image",
        src: "/media/products/kariz/incident-record-dark.webp",
        w: 1440,
        h: 900,
        frame: "browser",
        tone: "mono",
        blur: "data:image/webp;base64,UklGRiYAAABXRUJQVlA4IBoAAAAwAQCdASoQAAoAA4BaJaQAA3AA/vIquy+AAA==",
        alt: { fa: "یک رخداد نمونه در کاریز: اولویت از ماتریس اثر و فوریت، اقدام‌ها، و پنل‌های خطای شناخته‌شده، پیش‌بینی و هوش مصنوعی", en: "A sample incident in Kariz: priority from the impact and urgency matrix, actions, and the known-error, prediction and AI panels" },
        caption: { fa: "یک رخداد، با داده‌ی نمونه", en: "An incident, with sample data" },
      },
    ],
    stack: ["React 19", "Ant Design 6", "Tailwind 4", "Vite", "Hono", "Next.js 16", "PostgreSQL 17 · pgvector", "Supabase", "PGlite (WASM)", "Electron", "WiX MSI", "Node cluster", "Vitest"],
    status: { fa: "نسخه‌ی ۱٫۱ بتا (۱۹ آبان ۱۴۰۵)؛ نسخه‌ی پایدار ۱٫۰", en: "1.1 beta (Nov 10, 2026); 1.0 stable" },
    period: { fa: "۱۶ تا ۲۰ آبان ۱۴۰۵", en: "Nov 7 – 11, 2026" },
    role: { fa: "مالک محصول و معمار؛ طراحی و پیاده‌سازی", en: "Product owner & architect; design and implementation" },
    note: {
      fa: "هسته‌ی سکو (وب و هم‌گام‌سازی ویندوز، ورود، سازمان‌ها و موتور هوش مصنوعی) از سیراف آمده است. طراحی‌شده بر پایه‌ی ITIL 4؛ گواهی‌شده نیست.",
      en: "Its platform core (web and Windows sync, sign-in, organisations and the AI engine) comes from Siraf. Built around ITIL 4; not certified.",
    },
    tags: ["کاریز", "Kariz", "ITSM", "ITIL", "میز خدمت", "service desk", "رخداد", "incident", "تغییر", "change", "مشکل", "problem", "CMDB", "دارایی", "ITAM", "ESM", "خدمات سازمانی", "Active Directory", "سرور", "server", "on-premise", "ویندوز", "Windows", "بانک", "bank"],
  },
];

export function getProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}
