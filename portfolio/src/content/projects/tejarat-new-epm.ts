import type { Project } from "@/content/types";

export const tejaratNewEpm: Project = {
  slug: "tejarat-new-epm",
  tier: "flagship",
  featured: true,
  title: { fa: "سامانه‌ی جدید EPM بانک تجارت", en: "Bank Tejarat's new EPM system" },
  kicker: { fa: "مهاجرت سازمانی · Project Server، SharePoint و SQL Server · شبکه‌ی ایزوله", en: "Enterprise migration · Project Server, SharePoint & SQL Server · isolated network" },
  oneLiner: {
    fa: "سامانه‌ی مدیریت پروژه‌ی یکی از بزرگ‌ترین بانک‌های کشور، از PWA قدیمی به یک سامانه‌ی سفارشی کوچ می‌کند: وب‌اپی روی سرورهای ایزوله‌ی خود بانک که از راه SharePoint با Project Server و SQL Server حرف می‌زند و طوری طراحی شده که حتی برای حسابرسی داخلی جامع باشد؛ حدود ۹۰ درصد ساخته شده و هر روز استفاده می‌شود.",
    en: "The project-management platform of one of Iran's largest banks, moving from the old PWA to a custom system: a web application on the bank's own isolated servers that talks to Project Server and SQL Server through SharePoint, designed to be complete even for internal audit — about 90% built and in daily use.",
  },
  year: "2026",
  period: { fa: "در جریان", en: "Ongoing" },
  role: {
    fa: "مدیر پروژه و طراح سامانه: تحلیل، معماری و هدایت ساخت",
    en: "Project manager & system designer: analysis, architecture and delivery",
  },
  context: { fa: "بانک تجارت · از طرف شرکت مدیریت پروژه پارس", en: "Bank Tejarat · on behalf of Pars Project Management" },
  status: { fa: "حدود ۹۰٪ ساخته شده؛ در استفاده‌ی روزانه", en: "About 90% built; in daily use" },
  disciplines: ["fullstack", "data", "design"],
  stack: ["Microsoft Project Server", "SharePoint (REST · lists · external lists)", "SQL Server · T-SQL", "Project Server reporting OData", "React (no build step)", "JavaScript", "SSRS (legacy)"],
  cover: { kind: "art", art: "graph", alt: { fa: "گرافی از سطح‌های سازمان", en: "A graph of organisational levels" } },
  challenge: {
    fa: "سامانه‌ی قبلی بانک، Project Web App روی Project Server بود؛ ابزاری که جهانش «پروژه» است. هرچه پروژه نبود هم ناچار پروژه می‌شد: پرونده‌های حسابرسی داخلی با فیلدهای یافته، توصیه، اقدام اصلاحی و نوع ریسک، مصوبات هیئت‌مدیره، ابلاغیه‌ها و نامه‌ها همه به شکل پروژه ثبت می‌شدند. سطح‌های بالاتر از پروژه، یعنی طرح، اداره، مدیریت و معاونت، فقط به شکل پرچم، نوع پروژه یا یک مسیر متنی وجود داشتند. گاهی هم یک نیاز برای هر اداره جدا ثبت می‌شد.\n\nنتیجه را همه حس می‌کردند: گزارش‌ها بالاتر از اداره را نمی‌فهمیدند، برای کار در سطح‌های بالا پروژه‌ی ساختگی لازم بود و حسابرسی در قالبی کار می‌کرد که برایش ساخته نشده بود. و همه‌ی این‌ها باید روی شبکه‌ی ایزوله‌ی بانک حل می‌شد: بدون اینترنت، بدون CDN و بدون اینکه داده‌ای از بانک بیرون برود.",
    en: "The bank's previous platform was Project Web App on Project Server — a tool whose whole world is the «project». Anything that wasn't a project had to become one: internal-audit cases with finding, recommendation, corrective-action and risk-type fields, board resolutions, directives and letters were all registered as projects. Levels above the project — programme, office, directorate, deputy — existed only as flags, project types or a free-text path, and one requirement was sometimes registered once per office.\n\nEveryone felt the result: reports didn't understand anything above the office, work at higher levels needed placeholder projects, and audit worked inside a shape that wasn't made for it. And all of it had to be solved on the bank's isolated network — no internet, no CDN, and no data leaving the bank.",
  },
  approach: {
    fa: "به‌جای جایگزین کردن پلتفرمی که داده‌ی سال‌ها پروژه‌ی بانک را نگه می‌دارد، سامانه‌ی جدید **روی همان پایه** ساخته شد. SQL Server و Project Server سر جایشان ماندند و **SharePoint پل** شد: نماهای گزارش‌گیری Project Server به نماهای SQL سفارشی می‌رسند و این نماها به شکل لیست‌های خارجی وارد SharePoint می‌شوند. داده‌هایی که کاربران ثبت می‌کنند در لیست‌های بومی می‌مانند، و صفحه‌های سفارشی همه را با REST می‌خوانند.\n\nصفحه‌ها خودبسنده‌اند و هیچ درخواستی به بیرون از بانک نمی‌فرستند؛ بدون CDN و بدون وابستگی به اینترنت. داده همان داده‌ی Project Server است، پس سامانه‌ی جدید کنار PWA قدیمی و روی همان اطلاعات رشد می‌کند.\n\nو برای ادارات غیرپروژه‌ای، به‌ویژه حسابرسی، ایده‌ی **مرکز حسابرسی**: پرونده روی خود سطح سازمانی بالاتر از پروژه ساخته می‌شود، نه روی یک پروژه‌ی ساختگی برای هر سطح.",
    en: "Rather than replace the platform that holds years of the bank's project data, the new system is built **on the same foundation**. SQL Server and Project Server stay where they are, and **SharePoint becomes the bridge**: Project Server's reporting views feed custom SQL views, which enter SharePoint as external lists. Records users enter live in native lists, and the custom pages read everything over REST.\n\nThe pages are self-contained and send no request outside the bank — no CDN, no internet dependency. The data is Project Server's own, so the new system grows beside the old PWA on the same information.\n\nAnd for the non-project departments, internal audit above all, the **audit centre** idea: a file is built on the organisational level above the project itself, not on a placeholder project for each level.",
  },
  architecture: {
    cols: 4,
    rows: 3,
    nodes: [
      { id: "users", col: 0, row: 1, kind: "human", label: { fa: "کارکنان بانک", en: "Bank staff" }, sub: { fa: "ادارات · مدیران · حسابرسی", en: "offices · managers · audit" } },
      { id: "legacy", col: 0, row: 2, kind: "source", label: { fa: "PWA و SSRS قدیمی", en: "Old PWA & SSRS" }, sub: { fa: "در دسترس تا پایان مهاجرت", en: "kept until the move is done" } },
      { id: "app", col: 1, row: 1, kind: "process", label: { fa: "وب‌اپ جدید EPM", en: "New EPM web app" }, sub: { fa: "صفحه‌های سفارشی · بدون CDN", en: "custom pages · no CDN" } },
      { id: "sp", col: 2, row: 1, kind: "process", label: { fa: "SharePoint", en: "SharePoint" }, sub: { fa: "پل · REST · لیست‌ها", en: "the bridge · REST · lists" } },
      { id: "ps", col: 3, row: 0, kind: "process", label: { fa: "Project Server", en: "Project Server" }, sub: { fa: "زمان‌بندی · نوع پروژه", en: "schedules · project types" } },
      { id: "sql", col: 3, row: 2, kind: "store", label: { fa: "SQL Server", en: "SQL Server" }, sub: { fa: "نماهای گزارش‌گیری", en: "reporting views" } },
    ],
    edges: [
      { from: "users", to: "app" },
      { from: "legacy", to: "app", dashed: true, label: { fa: "مهاجرت", en: "migration" } },
      { from: "app", to: "sp", label: { fa: "REST", en: "REST" } },
      { from: "sp", to: "ps" },
      { from: "sp", to: "sql", label: { fa: "لیست خارجی", en: "external lists" } },
    ],
    caption: { fa: "همه‌چیز روی شبکه‌ی ایزوله‌ی بانک می‌ماند؛ نمودار الگوی معماری است، نه نام‌ها و نشانی‌های واقعی", en: "Everything stays on the bank's isolated network; the diagram shows the pattern, not the real names or addresses" },
  },
  interactive: "audit-centre",
  features: {
    fa: [
      "وب‌اپ سفارشی روی سرورهای خود بانک؛ بدون اینترنت، بدون CDN و بدون هیچ درخواستی به بیرون",
      "SharePoint به‌عنوان تنها پل: نماهای Project Server از راه SQL به لیست‌ها می‌رسند و داده‌ی کاربران در لیست‌های بومی می‌ماند",
      "مرکز حسابرسی: پرونده روی سطح‌های بالاتر از پروژه، بی‌نیاز از پروژه‌ی ساختگی برای هر سطح",
      "جامع برای ادارات غیرپروژه‌ای: حسابرسی داخلی، پیشنهادهای هیئت‌مدیره و ابلاغیه‌ها که در سامانه‌ی قبلی ناچار پروژه ثبت می‌شدند",
    ],
    en: [
      "A custom web app on the bank's own servers: no internet, no CDN, no request leaving the bank",
      "SharePoint as the single bridge: Project Server's views reach lists through SQL, and user records live in native lists",
      "The audit centre: files on levels above the project, with no placeholder project for each level",
      "Complete for non-project departments — internal audit, board proposals and directives, which the old system forced into projects",
    ],
  },
  outcomes: [
    { value: { fa: "۹۰٪", en: "90%" }, label: { fa: "ساخته شده، و همین حالا در استفاده‌ی روزانه", en: "built — and already in daily use" } },
    { value: { fa: "۰", en: "0" }, label: { fa: "پروژه‌ی ساختگی برای پرونده‌ای بالاتر از سطح پروژه", en: "placeholder projects for a file above project level" } },
    { value: { fa: "۱", en: "1" }, label: { fa: "پل برای همه‌چیز: SharePoint میان صفحه‌ها و Project Server و SQL Server", en: "bridge for everything: SharePoint between the pages and Project Server and SQL Server" } },
    { value: { fa: "۰", en: "0" }, label: { fa: "وابستگی به اینترنت؛ همه‌چیز روی سرورهای بانک", en: "internet dependencies — everything on the bank's servers" } },
  ],
  gallery: [],
  orgs: ["tejarat", "pars"],
  note: {
    fa: "این سامانه را شرکت مدیریت پروژه پارس برای بانک تجارت می‌سازد. نام‌ها، نشانی‌ها، داده‌ها و تصاویر سامانه‌ی بانک محرمانه است؛ نمودار و بخش تعاملی مرکز حسابرسی، ایده را با یک سازمان نمادین نشان می‌دهند. کار روی هشدارها، داشبورد و سرعت صفحه‌های EPM بانک در پرونده‌ی بعدی آمده است.",
    en: "Pars Project Management builds this system for Bank Tejarat. The bank's names, addresses, data and screens are confidential; the diagram and the audit-centre piece show the idea with an illustrative organisation. Work on the bank's EPM alerts, dashboards and page speed is in the next case study.",
  },
};
