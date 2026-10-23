import type { SeedKey } from "@/content/seed-media";

/**
 * Every design picture of the site is a "slot": a place with a fixed shape, a built-in default picture and
 * the short texts that travel with it. Admin → «تصاویر سایت» shows these grouped by page; changing one
 * stores a row in celin_slots and refreshes the public pages. Category and collection pictures are edited
 * with the category / collection itself (Admin → «دسته‌ها و مجموعه‌ها»).
 */

export interface SlotText {
  key: string;
  /** label in the admin form */
  label: string;
  multiline?: boolean;
  fa: string;
  en: string;
}

export interface SlotDef {
  key: string;
  /** page group in the admin (fa) */
  page: string;
  /** section name in the admin (fa) */
  section: string;
  /** shape the picture is shown in on desktop, e.g. "3:4" */
  ratio: string;
  /** shape on phones when it differs */
  mobileRatio?: string;
  /** a separate phone picture may be set */
  mobile?: boolean;
  /** a looping background video may be set (the picture stays its poster and fallback) */
  video?: boolean;
  /** what kind of photo works best (fa) */
  hint: string;
  image: SeedKey;
  texts: SlotText[];
}

const cta = (fa: string, en: string, href: string): SlotText[] => [
  { key: "cta", label: "متن دکمه", fa, en },
  { key: "href", label: "پیوند دکمه (مثلاً /collections/nour)", fa: href, en: href },
];

export const SLOTS: SlotDef[] = [
  // ------------------------------------------------------------ home
  {
    key: "home.hero.a",
    page: "صفحه‌ی اصلی",
    section: "سرآغاز — تصویر اول",
    ratio: "3:4",
    mobileRatio: "4:5",
    mobile: true,
    video: true,
    hint: "عکس روی مدل (گردن یا دست)، روشن، با جواهر در مرکز",
    image: "choker-rose",
    texts: [
      { key: "eyebrow", label: "برچسب کوچک بالای عنوان", fa: "۲۰ سال درخشش · از ۱۳۸۵", en: "Twenty years of brilliance · since 2006" },
      { key: "title", label: "عنوان", fa: "فراتر از یک زیور", en: "More than an ornament" },
      { key: "subtitle", label: "یک جمله", multiline: true, fa: "امضایی از ظرافت، کیفیت و اصالت.", en: "A signature of finesse, quality and authenticity." },
      ...cta("مشاهده‌ی مجموعه‌ها", "Discover the collections", "/collections"),
    ],
  },
  {
    key: "home.hero.b",
    page: "صفحه‌ی اصلی",
    section: "سرآغاز — تصویر دوم (فقط دسکتاپ)",
    ratio: "3:4",
    hint: "عکس روی مدل هم‌خانواده با تصویر اول",
    image: "set-cascade",
    texts: [],
  },
  {
    key: "home.hero.c",
    page: "صفحه‌ی اصلی",
    section: "سرآغاز — تصویر سوم (فقط دسکتاپ)",
    ratio: "3:4",
    hint: "عکس روی مدل یا جزئیات، هم‌خانواده با تصویر اول",
    image: "earrings-sunburst",
    texts: [],
  },
  {
    key: "home.statement",
    page: "صفحه‌ی اصلی",
    section: "جمله‌ی بزرگ با دو تصویر کوچک",
    ratio: "3:4",
    hint: "عکس روی دست؛ در قاب طاقیِ کوچک میان کلمات نمایش داده می‌شود",
    image: "ring-paraiba-wrap-hand",
    texts: [
      { key: "line1", label: "سطر اول", fa: "برای کسانی که زیبایی را", en: "For those who see beauty" },
      { key: "line2", label: "سطر دوم (رنگ مسی)", fa: "در جزئیات می‌بینند", en: "in the details" },
      { key: "line3", label: "سطر سوم", fa: "و تفاوت را در کیفیت احساس می‌کنند", en: "and feel the difference in quality" },
    ],
  },
  {
    key: "home.statement.b",
    page: "صفحه‌ی اصلی",
    section: "جمله‌ی بزرگ — تصویر کوچک دوم",
    ratio: "3:4",
    hint: "عکس جزئیات روی مدل",
    image: "earrings-bow-pearl",
    texts: [],
  },
  {
    key: "home.interlude",
    page: "صفحه‌ی اصلی",
    section: "بخش تیره — هنر تراش اتمی",
    ratio: "3:4",
    mobileRatio: "4:5",
    video: true,
    hint: "عکس استودیویی نگین روی زمینه‌ی تیره",
    image: "ring-paraiba-oval",
    texts: [
      { key: "eyebrow", label: "برچسب", fa: "تراش اتمی", en: "Atomic cut" },
      { key: "title", label: "عنوان", fa: "نور، با تراشی دقیق", en: "Light, precisely cut" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "در سلین، هر قطعه با الهام از ساختار و ظرافت طلا و جواهر طراحی و ساخته می‌شود؛ با نگین‌های درخشان کیوبیک زیرکونیا، مخراج‌کاری دقیق و آبکاری‌های باکیفیت رودیوم و طلا.", en: "At CELIN, every piece is designed and made after the structure and finesse of fine jewelry — with brilliant cubic zirconia, precise stone setting and quality rhodium and gold plating." },
      ...cta("هنر ساخت", "The craft", "/craft"),
    ],
  },
  {
    key: "home.craft.1",
    page: "صفحه‌ی اصلی",
    section: "مراحل ساخت — ۱. طراحی",
    ratio: "3:4",
    hint: "عکس روی مدل از یک طرح شاخص",
    image: "necklace-gold-square",
    texts: [
      { key: "title", label: "عنوان", fa: "طراحی اختصاصی", en: "Exclusive design" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "به‌روزترین طرح‌های روز دنیا و مدل‌های اختصاصی، با همراهی دیزاینرهای بین‌المللی و با الهام از ساختار طلا و جواهر.", en: "The latest designs of the world and exclusive models, created with international designers after the structure of fine jewelry." },
    ],
  },
  {
    key: "home.craft.2",
    page: "صفحه‌ی اصلی",
    section: "مراحل ساخت — ۲. نگین",
    ratio: "3:4",
    hint: "عکس استودیویی نگین",
    image: "ring-paraiba-cushion",
    texts: [
      { key: "title", label: "عنوان", fa: "نگین کیوبیک زیرکونیا", en: "Cubic zirconia" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "نگین‌های درخشان کیوبیک زیرکونیا با تراش اتمی؛ وجه‌هایی متقارن که نور را مثل جواهر برمی‌گردانند.", en: "Brilliant cubic zirconia with an atomic cut: symmetrical facets that return light like a fine jewel." },
    ],
  },
  {
    key: "home.craft.3",
    page: "صفحه‌ی اصلی",
    section: "مراحل ساخت — ۳. مخراج‌کاری",
    ratio: "3:4",
    hint: "عکس جزئیات نگین‌کاری",
    image: "ring-gold-pave-rows",
    texts: [
      { key: "title", label: "عنوان", fa: "مخراج‌کاری دقیق", en: "Precise setting" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "از انتخاب نگین تا ظرافت نشاندن هر سنگ؛ توجه به جزئیات، بخشی جدایی‌ناپذیر از هویت ماست.", en: "From choosing each stone to the finesse of setting it — attention to detail is part of who we are." },
    ],
  },
  {
    key: "home.craft.4",
    page: "صفحه‌ی اصلی",
    section: "مراحل ساخت — ۴. آبکاری",
    ratio: "3:4",
    hint: "عکسی که رنگ طلایی و نقره‌ای را کنار هم نشان دهد",
    image: "bangles-sapphire",
    texts: [
      { key: "title", label: "عنوان", fa: "آبکاری رودیوم و طلا", en: "Rhodium & gold plating" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "آبکاری‌های باکیفیت رودیوم و طلا، برای درخششی ماندگار در رنگ‌های نقره‌ای و طلایی.", en: "Quality rhodium and gold plating, for a lasting shine in silver and gold tones." },
    ],
  },
  {
    key: "home.anniversary",
    page: "صفحه‌ی اصلی",
    section: "۲۰ سال درخشش",
    ratio: "3:4",
    hint: "عکس روی مدل؛ درون عدد «۲۰» هم دیده می‌شود",
    image: "set-bow-sapphire",
    texts: [
      { key: "eyebrow", label: "برچسب", fa: "۱۳۸۵ — ۱۴۰۵", en: "2006 — 2026" },
      { key: "number", label: "عدد بزرگ", fa: "۲۰", en: "20" },
      { key: "title", label: "عنوان", fa: "سلین، ۲۰ سال درخشش", en: "CELIN, twenty years of brilliance" },
      { key: "subtitle", label: "زیرعنوان", fa: "آغاز فصلی تازه در دنیای زیبایی", en: "A new chapter in the world of beauty" },
      { key: "body", label: "متن", multiline: true, fa: "امروز، در بیستمین سال تولد سلین، با افتخار فصلی تازه از مسیر خود را در کنار شما آغاز می‌کنیم؛ افتتاح وب‌سایت رسمی سلین، برای تجربه‌ای متفاوت از خریدی آسان، امن و لذت‌بخش.", en: "Today, in CELIN's twentieth year, we proudly begin a new chapter with you: the opening of CELIN's official website, for an easy, safe and delightful way to shop." },
      { key: "body2", label: "متن دوم", multiline: true, fa: "این آغاز تازه، هدیه‌ای است به همراهی و اعتماد شما؛ همراهانی که در تمام این سال‌ها، بخشی جدایی‌ناپذیر از داستان درخشش سلین بوده‌اید.", en: "This new beginning is a gift to your companionship and trust — you who have been an inseparable part of CELIN's story of brilliance all these years." },
      { key: "closing", label: "جمله‌ی پایانی", multiline: true, fa: "۲۰ سال همراهی، هزاران جلوه از زیبایی و شروعی تازه برای درخششی بی‌پایان.", en: "Twenty years together, thousands of moments of beauty, and a new beginning for endless brilliance." },
      ...cta("داستان سلین", "The CELIN story", "/maison"),
    ],
  },
  {
    key: "home.house",
    page: "صفحه‌ی اصلی",
    section: "گالری اعتماد",
    ratio: "3:4",
    mobileRatio: "4:5",
    hint: "عکس روی دست با پس‌زمینه‌ی روشن",
    image: "ring-paraiba-wrap",
    texts: [
      { key: "eyebrow", label: "برچسب", fa: "داستان سلین", en: "The CELIN story" },
      { key: "title", label: "عنوان", fa: "زیبایی، ظرافت و کیفیت، در کنار یکدیگر", en: "Beauty, finesse and quality, together" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "سلین در سال ۱۳۸۵ متولد شد؛ با نگاهی متفاوت به دنیای زیورآلات و رؤیای خلق آثاری که زیبایی، ظرافت و کیفیت را در کنار یکدیگر معنا کنند.", en: "CELIN was born in 2006, with a different eye on the world of jewelry and a dream of creating pieces in which beauty, finesse and quality find their meaning together." },
      ...cta("داستان ما", "Our story", "/maison"),
    ],
  },
  {
    key: "home.pro",
    page: "صفحه‌ی اصلی",
    section: "اشتراک Pro",
    ratio: "4:5",
    hint: "عکس روی دست یا جزئیات محصول",
    image: "rings-heart-signet",
    texts: [
      { key: "eyebrow", label: "برچسب", fa: "اعضای Pro", en: "Pro members" },
      { key: "title", label: "عنوان", fa: "قیمت، موجودی و سفارش برای همکاران", en: "Prices, stock and ordering for partners" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "با اشتراک Pro، قیمت و موجودی همه‌ی آثار را می‌بینید و سفارش خود را مستقیم ثبت می‌کنید.", en: "With Pro membership you see the price and stock of every piece and place your orders directly." },
      ...cta("درخواست اشتراک Pro", "Request Pro membership", "/pro"),
    ],
  },
  // ------------------------------------------------------------ menu & listings
  {
    key: "menu.promo",
    page: "منو و فهرست محصولات",
    section: "تصویر منوی جواهرات",
    ratio: "3:4",
    hint: "عکس روی مدل",
    image: "bangles-ruby",
    texts: [
      { key: "title", label: "عنوان", fa: "نگار · النگو", en: "The Negar bangle" },
      ...cta("مشاهده", "Discover", "/product/negar-bangle"),
    ],
  },
  {
    key: "shop.editorial",
    page: "منو و فهرست محصولات",
    section: "تصویر میان فهرست محصولات",
    ratio: "8:5",
    mobileRatio: "4:5",
    mobile: true,
    hint: "عکس روی مدل؛ در دو ستون فهرست نمایش داده می‌شود",
    image: "ring-emerald-fan",
    texts: [
      { key: "title", label: "عنوان", fa: "گلبرگ، روی دست", en: "Golbarg, worn" },
      ...cta("مشاهده‌ی مجموعه", "Discover the collection", "/collections/golbarg"),
    ],
  },
  // ------------------------------------------------------------ house pages
  {
    key: "maison.hero",
    page: "گالری اعتماد (درباره‌ی ما)",
    section: "تصویر سرآغاز",
    ratio: "3:4",
    mobileRatio: "4:5",
    video: true,
    hint: "عکس روی مدل",
    image: "set-tennis-lace",
    texts: [
      { key: "eyebrow", label: "برچسب کوچک بالای عنوان", fa: "گالری اعتماد · از ۱۳۸۵", en: "Etemad Gallery · since 2006" },
      { key: "title", label: "عنوان", fa: "فراتر از یک زیور", en: "More than an ornament" },
      { key: "subtitle", label: "یک جمله", multiline: true, fa: "امضایی از ظرافت، کیفیت و اصالت", en: "A signature of finesse, quality and authenticity" },
    ],
  },
  {
    key: "maison.chapter.1",
    page: "گالری اعتماد (درباره‌ی ما)",
    section: "فصل ۱ — با الهام از طلا و جواهر",
    ratio: "3:4",
    hint: "عکس روی مدل از قطعه‌ای با ساختار جواهری",
    image: "necklace-triple-tennis",
    texts: [],
  },
  {
    key: "maison.chapter.2",
    page: "گالری اعتماد (درباره‌ی ما)",
    section: "فصل ۲ — طرح‌هایی متمایز",
    ratio: "3:4",
    hint: "عکس روی مدل از یک طرح شاخص",
    image: "set-bow-ruby",
    texts: [],
  },
  {
    key: "maison.chapter.3",
    page: "گالری اعتماد (درباره‌ی ما)",
    section: "فصل ۳ — اعتماد، مسیر ما را ساخت",
    ratio: "3:4",
    hint: "عکس گرم روی دست",
    image: "rings-heart-signet",
    texts: [],
  },
  {
    key: "maison.chapter.4",
    page: "گالری اعتماد (درباره‌ی ما)",
    section: "فصل ۴ — فراتر از تعریف متداول",
    ratio: "3:4",
    hint: "عکس استودیویی یک نگین درخشان",
    image: "ring-paraiba-oval-side",
    texts: [],
  },
  {
    key: "maison.story",
    page: "گالری اعتماد (درباره‌ی ما)",
    section: "تصویر کنار جمله‌ی «سلین؛ برای کسانی که…»",
    ratio: "3:4",
    hint: "عکس جزئیات روی دست",
    image: "rings-heart-leaf",
    texts: [],
  },
  {
    key: "craft.hero",
    page: "هنر تراش",
    section: "تصویر سرآغاز",
    ratio: "3:4",
    mobileRatio: "4:5",
    video: true,
    hint: "عکس استودیویی نگین روی زمینه‌ی تیره",
    image: "ring-paraiba-oval",
    texts: [
      { key: "eyebrow", label: "برچسب کوچک بالای عنوان", fa: "هنر ساخت", en: "The craft" },
      { key: "title", label: "عنوان", fa: "از طرح تا درخشش", en: "From design to brilliance" },
      { key: "subtitle", label: "یک جمله", multiline: true, fa: "در سلین، هر قطعه با الهام از ساختار و ظرافت طلا و جواهر طراحی و ساخته می‌شود.", en: "At CELIN, every piece is designed and made after the structure and finesse of gold and fine jewelry." },
    ],
  },
  {
    key: "craft.plating",
    page: "هنر تراش",
    section: "تصویر آبکاری (رودیوم و طلا)",
    ratio: "3:4",
    hint: "عکسی که دو رنگ طلایی و نقره‌ای را کنار هم نشان دهد",
    image: "bangles-emerald",
    texts: [
      { key: "title", label: "عنوان", fa: "آبکاری رودیوم و طلا", en: "Rhodium & gold plating" },
      { key: "body", label: "متن کوتاه", multiline: true, fa: "آبکاری‌های باکیفیت رودیوم و طلا، برای درخششی ماندگار در رنگ‌های نقره‌ای و طلایی.", en: "Quality rhodium and gold plating, for a lasting shine in silver and gold tones." },
    ],
  },
  {
    key: "care.hero",
    page: "نگهداری و ضمانت",
    section: "تصویر سرآغاز",
    ratio: "3:4",
    hint: "عکس روی دست با پس‌زمینه‌ی روشن",
    image: "ring-gold-pave-rows",
    texts: [
      { key: "eyebrow", label: "برچسب کوچک بالای عنوان", fa: "نگهداری و ضمانت", en: "Care & warranty" },
      { key: "title", label: "عنوان", fa: "برای درخششی ماندگار", en: "For a lasting shine" },
      { key: "subtitle", label: "یک جمله", multiline: true, fa: "نگهداری، بسته‌بندی و ارسال، و پشتیبانی آثار سلین.", en: "Caring for your CELIN pieces, packaging and delivery, and our support." },
    ],
  },
  {
    key: "care.packaging",
    page: "نگهداری و ضمانت",
    section: "تصویر بسته‌بندی و ارسال",
    ratio: "3:4",
    hint: "عکس جعبه و بسته‌بندی سلین، یا یک قطعه کنار جعبه",
    image: "set-baguette-drops",
    texts: [],
  },
  // ------------------------------------------------------------ account & Pro
  {
    key: "pro.hero",
    page: "اشتراک Pro و ورود",
    section: "تصویر صفحه‌ی اشتراک Pro",
    ratio: "3:4",
    hint: "عکس روی مدل",
    image: "set-bow-sapphire",
    texts: [
      { key: "title", label: "عنوان", fa: "اشتراک Pro سلین", en: "CELIN Pro membership" },
      { key: "subtitle", label: "یک جمله", multiline: true, fa: "برای فروشگاه‌ها و همکارانی که سلین را به مشتریان خود می‌رسانند.", en: "For shops and partners who bring CELIN to their clients." },
    ],
  },
  {
    key: "auth.side",
    page: "اشتراک Pro و ورود",
    section: "تصویر کنار فرم ورود و ثبت‌نام",
    ratio: "3:4",
    hint: "عکس روی مدل؛ روی موبایل نمایش داده نمی‌شود",
    image: "earrings-bow-pearl",
    texts: [],
  },
  {
    key: "contact.hero",
    page: "تماس",
    section: "تصویر صفحه‌ی تماس",
    ratio: "3:4",
    hint: "عکس روی مدل",
    image: "earrings-sunburst",
    texts: [
      { key: "eyebrow", label: "برچسب کوچک بالای عنوان", fa: "تماس با سلین", en: "Contact CELIN" },
      { key: "title", label: "عنوان", fa: "با ما در تماس باشید", en: "Get in touch" },
      { key: "subtitle", label: "یک جمله", multiline: true, fa: "برای پرسش درباره‌ی آثار، سفارش‌ها و اشتراک Pro، از هر راهی که برایتان آسان‌تر است با ما گفتگو کنید.", en: "For questions about a piece, an order or Pro membership, reach us whichever way suits you best." },
    ],
  },
];

export const SLOT_KEYS = SLOTS.map((s) => s.key);
export type SlotKey = (typeof SLOTS)[number]["key"];
export const slotDef = (key: string) => SLOTS.find((s) => s.key === key);
