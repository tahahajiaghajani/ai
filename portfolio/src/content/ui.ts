import type { Lang } from "@/lib/i18n";

/** Interface strings, both languages side by side so they never drift. */
const UI = {
  nav: {
    work: { fa: "کارها", en: "Work" },
    expertise: { fa: "تخصص", en: "Expertise" },
    journey: { fa: "مسیر", en: "Journey" },
    ask: { fa: "از دستیار بپرس", en: "Ask my AI" },
    contact: { fa: "تماس", en: "Contact" },
    start: { fa: "شروع همکاری", en: "Start a project" },
    menu: { fa: "منو", en: "Menu" },
    close: { fa: "بستن", en: "Close" },
    home: { fa: "خانه", en: "Home" },
    skip: { fa: "رفتن به محتوا", en: "Skip to content" },
    lang: { fa: "English", en: "فارسی" },
    langShort: { fa: "EN", en: "فا" },
    theme: { fa: "تغییر روشنایی", en: "Invert colours" },
  },
  hero: {
    scroll: { fa: "اسکرول", en: "Scroll" },
    available: { fa: "پذیرای پروژه‌های سازمانی هوش مصنوعی", en: "Taking on enterprise AI engagements" },
  },
  sections: {
    manifesto: { fa: "بیانیه", en: "Manifesto" },
    expertise: { fa: "تخصص‌ها", en: "Expertise" },
    work: { fa: "کارهای منتخب", en: "Selected work" },
    method: { fa: "روش کار", en: "How I work" },
    journey: { fa: "مسیر حرفه‌ای", en: "Journey" },
    trust: { fa: "همکاران و نهادها", en: "Worked with" },
    toolbox: { fa: "جعبه‌ابزار", en: "Toolbox" },
    ask: { fa: "دستیار هوشمند", en: "AI assistant" },
    contact: { fa: "شروع همکاری", en: "Start a project" },
  },
  work: {
    view: { fa: "مشاهده", en: "View" },
    all: { fa: "همه‌ی کارها", en: "All work" },
    role: { fa: "نقش", en: "Role" },
    period: { fa: "زمان", en: "Period" },
    context: { fa: "برای", en: "For" },
    status: { fa: "وضعیت", en: "Status" },
    stack: { fa: "فناوری‌ها", en: "Stack" },
    challenge: { fa: "مسئله", en: "The challenge" },
    approach: { fa: "راه‌حل", en: "The approach" },
    architecture: { fa: "معماری سامانه", en: "System architecture" },
    features: { fa: "قابلیت‌ها", en: "What it does" },
    outcomes: { fa: "نتیجه", en: "Outcome" },
    gallery: { fa: "تصاویر", en: "Gallery" },
    code: { fa: "از دل کد", en: "From the code" },
    next: { fa: "پروژه‌ی بعدی", en: "Next project" },
    back: { fa: "بازگشت به کارها", en: "Back to work" },
    links: { fa: "پیوندها", en: "Links" },
  },
  chat: {
    title: { fa: "دستیار هوشمند طاها", en: "Taha's AI" },
    subtitle: { fa: "آموزش‌دیده با کارها و دانش من · Gemini", en: "Grounded in my work and knowledge · Gemini" },
    placeholder: { fa: "سؤالتان را بنویسید…", en: "Ask anything about my work…" },
    send: { fa: "ارسال", en: "Send" },
    open: { fa: "گفت‌وگو با دستیار", en: "Chat with my AI" },
    reset: { fa: "گفت‌وگوی تازه", en: "New chat" },
    thinking: { fa: "در حال فکر کردن", en: "Thinking" },
    busy: { fa: "دستیار الان سرش شلوغ است؛ چند لحظه بعد دوباره بپرسید.", en: "The assistant is busy right now — please try again in a moment." },
    rate: { fa: "تعداد پرسش‌ها زیاد شد؛ کمی بعد دوباره امتحان کنید.", en: "Too many questions for now — please try again a little later." },
    error: { fa: "ارتباط برقرار نشد. دوباره امتحان کنید.", en: "Couldn't connect. Please try again." },
    disclaimer: { fa: "پاسخ‌ها با هوش مصنوعی ساخته می‌شوند و ممکن است خطا داشته باشند.", en: "Answers are AI-generated and may contain mistakes." },
    actionTicket: { fa: "ثبت درخواست همکاری", en: "Send a request" },
    actionContact: { fa: "راه‌های تماس", en: "Contact details" },
    actionWork: { fa: "دیدن کارها", en: "See the work" },
    suggestions: {
      fa: ["چه سیستم‌های سازمانی هوش مصنوعی ساخته‌ای؟", "پروژه‌ی بینایی ماشین توربین چطور کار می‌کند؟", "Task Flow چیست؟", "برای سازمان ما چه کاری می‌توانی بکنی؟"],
      en: ["What enterprise AI systems have you built?", "How does the turbine vision system work?", "What is Task Flow?", "What could you build for my company?"],
    },
  },
  request: {
    title: { fa: "یک پروژه را با هم شروع کنیم", en: "Let's build something serious" },
    lead: {
      fa: "درخواست همکاری، دمو یا مشاوره را ثبت کنید. هوش مصنوعی آن را دسته‌بندی و خلاصه می‌کند، به من خبر می‌دهد و یک کد پیگیری به شما می‌دهد.",
      en: "Send a collaboration, demo or consulting request. AI triages and summarises it, notifies me, and gives you a tracking code.",
    },
    kind: { fa: "نوع درخواست", en: "Request type" },
    kinds: {
      project: { fa: "ساخت سیستم / پروژه", en: "Build a system" },
      consulting: { fa: "مشاوره‌ی هوش مصنوعی", en: "AI consulting" },
      demo: { fa: "درخواست دمو", en: "Request a demo" },
      collaboration: { fa: "همکاری / استخدام", en: "Collaboration / hiring" },
      design: { fa: "برند و طراحی", en: "Brand & design" },
      other: { fa: "سایر", en: "Something else" },
    },
    name: { fa: "نام شما", en: "Your name" },
    organization: { fa: "سازمان / شرکت", en: "Company" },
    email: { fa: "ایمیل", en: "Email" },
    phone: { fa: "تلفن یا تلگرام", en: "Phone or Telegram" },
    subject: { fa: "موضوع", en: "Subject" },
    body: { fa: "شرح نیاز", en: "What do you need?" },
    bodyHint: { fa: "مسئله، داده‌ها و سیستم‌های فعلی، و نتیجه‌ای که می‌خواهید.", en: "The problem, your current data and systems, and the outcome you want." },
    budget: { fa: "بودجه (اختیاری)", en: "Budget (optional)" },
    timeline: { fa: "زمان‌بندی (اختیاری)", en: "Timeline (optional)" },
    submit: { fa: "ارسال درخواست", en: "Send request" },
    sending: { fa: "در حال ارسال و تحلیل…", en: "Sending and analysing…" },
    contactNeeded: { fa: "یک راه تماس (ایمیل یا تلفن/تلگرام) لازم است.", en: "Please leave an email or a phone / Telegram." },
    done: { fa: "درخواست شما ثبت شد", en: "Your request is in" },
    code: { fa: "کد پیگیری", en: "Tracking code" },
    track: { fa: "پیگیری درخواست", en: "Track your request" },
    keep: { fa: "این پیوند را نگه دارید؛ پاسخ من همان‌جا نمایش داده می‌شود.", en: "Keep this link — my reply will appear there." },
    aiRead: { fa: "برداشت هوش مصنوعی از درخواست شما", en: "How the AI read your request" },
    failed: { fa: "ثبت درخواست ممکن نشد. لطفاً از ایمیل یا تلگرام استفاده کنید.", en: "The request couldn't be saved. Please use email or Telegram instead." },
    offline: { fa: "سامانه‌ی درخواست هنوز به پایگاه داده وصل نشده؛ لطفاً مستقیم پیام بدهید.", en: "The request desk isn't connected yet — please message me directly." },
    rate: { fa: "درخواست‌های زیادی ثبت شد؛ کمی بعد دوباره امتحان کنید.", en: "Too many requests — please try again later." },
    or: { fa: "یا مستقیم", en: "or directly" },
  },
  track: {
    title: { fa: "پیگیری درخواست", en: "Request status" },
    status: {
      new: { fa: "دریافت شد", en: "Received" },
      reviewing: { fa: "در حال بررسی", en: "Reviewing" },
      answered: { fa: "پاسخ داده شد", en: "Answered" },
      scheduled: { fa: "جلسه هماهنگ شد", en: "Meeting scheduled" },
      closed: { fa: "بسته شد", en: "Closed" },
    },
    you: { fa: "شما", en: "You" },
    taha: { fa: "طاها", en: "Taha" },
    system: { fa: "سامانه", en: "System" },
    reply: { fa: "افزودن پیام", en: "Add a message" },
    replySend: { fa: "ارسال پیام", en: "Send message" },
    denied: { fa: "این پیوند معتبر نیست.", en: "This link isn't valid." },
  },
  footer: {
    rights: { fa: "طراحی و مهندسی: طاها آقاجانی", en: "Designed & engineered by Taha Aghajani" },
    built: { fa: "ساخته‌شده با Next.js، Supabase و Gemini", en: "Built with Next.js, Supabase and Gemini" },
    top: { fa: "بازگشت به بالا", en: "Back to top" },
    say: { fa: "سلام کنید", en: "Say hello" },
  },
} as const;

type Leaf = { fa: string; en: string };
type Tree = { [k: string]: Leaf | Tree | { fa: readonly string[]; en: readonly string[] } };

export const ui = UI;

export function u(leaf: Leaf, lang: Lang): string {
  return leaf[lang];
}

export type { Tree };
