import type { Project } from "@/content/types";

export const tejaratNewEpm: Project = {
  slug: "tejarat-new-epm",
  tier: "flagship",
  featured: true,
  title: { fa: "سامانه‌ی جدید EPM بانک تجارت", en: "Bank Tejarat's new EPM system" },
  kicker: { fa: "سامانه‌ی سازمانی · SharePoint و Project Server روی SQL Server · شبکه‌ی بی‌اینترنت", en: "Enterprise system · SharePoint & Project Server on SQL Server · no-internet network" },
  oneLiner: {
    fa: "جایگزین PWA قدیمی: یک سامانه‌ی فارسی و تک‌صفحه‌ای که درون یک وب‌پارت SharePoint بالا می‌آید و روی همان Project Server و لیست‌های موجود بانک، بی پایگاه‌داده‌ی جدا و بی اینترنت، مرکزهای پروژه، حسابرسی داخلی، مصوبات کمیته‌ها، قراردادها و کارتابل‌ها را یکجا می‌گرداند؛ حدود ۹۰ درصد ساخته شده و در حال بهره‌برداری است.",
    en: "The successor to the old PWA: a Persian single-page system that starts inside one SharePoint web part and, on the bank's existing Project Server and lists — no separate database, no internet — runs project centres, internal audit, committee resolutions, contracts and inboxes in one place. About 90% built, and in use.",
  },
  year: "2026",
  period: { fa: "در جریان · بیلد ۷۶", en: "Ongoing · build 76" },
  role: {
    fa: "مدیر پروژه: نیازها، قاعده‌ها و تصمیم‌ها، اجرای کاوشگرها و نصب روی سرور؛ معماری و کد با Claude طراحی و نوشته شد",
    en: "Project lead: needs, rules and decisions, server probes and installs; architecture and code designed and written with Claude",
  },
  context: { fa: "بانک تجارت · از طرف شرکت مدیریت پروژه پارس", en: "Bank Tejarat · on behalf of Pars Project Management" },
  status: { fa: "حدود ۹۰٪ ساخته شده و در حال بهره‌برداری؛ بیلد ۷۶ تحویل شده و آزمون کنسولی‌اش روی سرور در راه است", en: "About 90% built and in use; build 76 delivered, its on-server self-test pending" },
  disciplines: ["fullstack", "data", "design"],
  stack: [
    "SharePoint Server · web part · REST",
    "Project Server · REST · CSOM",
    "Project Server reporting OData",
    "SQL Server · BCS external lists · SSRS",
    "JavaScript, zero libraries",
    "Hand-written SVG (charts, Gantt)",
    "Node.js + Playwright (simulated farm)",
    "Python (build & packaging)",
  ],
  cover: { kind: "art", art: "graph", alt: { fa: "گرافی از گزارش، سرفصل یافته و مصداق", en: "A graph of reports, findings and cases" } },
  challenge: {
    fa: "بانک کارش را در Project Web App روی Project Server پیش می‌برد؛ ابزاری که جهانش «پروژه» است. روشن‌ترین نمونه حسابرسی داخلی بود: در PWA هر «مصداق» خودش یک پروژه بود و پایین‌ترین سطح ریشه شده بود، پس نمی‌شد به گزارشی که ثبت شده بود سرفصل یافته‌ی تازه افزود، یا به یک سرفصل مصداق تازه. حال آن‌که جدول خود کارفرما می‌گفت هر گزارش چند سرفصل یافته دارد، هر سرفصل چند مصداق و هر مصداق چند توصیه و اقدام.\n\nبقیه هم کم نبود. کد سفارشی کارتابل‌ها دوازده اشکال مستند داشت: دکمه‌هایی که پس از مرتب‌سازی به ردیف دیگری می‌رفتند، لیست‌هایی که فقط صد سطر اولشان خوانده می‌شد، و درصدهایی که رشته‌ای مقایسه می‌شدند تا «۹» از «۱۰۰» بزرگ‌تر دربیاید. تأیید درصد پیشرفت در Project Server هیچ API ندارد، و فرم قراردادها به نام «حساب سیستم» می‌نوشت، نه به نام خود کاربر.\n\nو قیدها سخت بودند: همه‌چیز روی سرورهای ایزوله‌ی بانک، بی اینترنت و بی CDN؛ روی سامانه‌ای زنده که داده‌ی واقعی دارد و «جای آزمون و خطا نیست»؛ و برای سروری که نویسنده‌ی کد هرگز آن را نمی‌دید.",
    en: "The bank ran its work on Project Web App over Project Server — a tool whose whole world is the «project». The clearest case was internal audit: in PWA every «case» was its own project and the lowest level had become the root, so you could not add a new finding to a report already registered, or a new case to a finding. Yet the client's own sheet said one report has several findings, each finding several cases, and each case several recommendations and actions.\n\nThe rest was no lighter. The custom inbox code had twelve documented bugs: row buttons that pointed at another row after sorting, lists of which only the first hundred rows were ever read, and percentages compared as strings so that «9» beat «100». Approving a progress percentage has no API in Project Server at all, and the contracts form wrote as a «system account», not as the person using it.\n\nAnd the constraints were hard: everything on the bank's isolated servers, with no internet and no CDN; on a live system holding real data, «not a place for trial and error»; and for a server that whoever wrote the code would never see.",
  },
  approach: {
    fa: "ایده‌ی اصلی یک لایه‌ی رابط کاربری نازک است، فقط در مرورگر و روی همان سکویی که هست: نه پایگاه‌داده‌ی تازه، نه سرور تازه، نه انتقال داده. کل سامانه با **یک وب‌پارت** روی یک صفحه‌ی SharePoint بالا می‌آید و سی فایل ایستا را از کتابخانه‌ی سند همان سایت بار می‌کند؛ به‌روزرسانی یعنی فقط جایگزینی فایل‌ها. هرچه نوشته می‌شود همان‌جایی می‌نشیند که PWA هم می‌نوشت، پس سامانه‌ی قدیم و جدید و Microsoft Project روی یک داده کنار هم کار می‌کنند.\n\n**SharePoint پل است.** بیشتر خواندن‌ها از لایه‌ی گزارش‌گیری Project Server (OData) است، نوشتن پروژه و فعالیت با REST روی پیش‌نویس پروژه، و دسترسی‌ها، سوابق پیشرفت و دفتر رویداد در لیست‌های SharePoint. سامانه هرگز مستقیم به SQL Server وصل نمی‌شود: «فقط در Project Server بنویس، بگذار خودش در SQL بنشیند.»\n\n**اول ایمنی.** همه‌ی رفت‌وآمد شبکه از یک «سپر ایمنی» می‌گذرد. نوشتن فقط با فهرست سفیدی از عملیات نام‌دار مجاز است و فقط درون یک «جلسه‌ی نوشتن» که به یک پروژه بسته شده؛ شعاع انفجار هر خطا همان یک پروژه است. موتور نوشتن پیش از هر تغییر از پروژه عکس می‌گیرد، check-out و publish می‌کند، check-in را «همیشه، در finally» می‌زند و پس از نوشتن مقدارها را دوباره می‌خواند تا هر فیلدی که روی سرور ننشسته، قرمز گزارش شود.\n\n**شاهد به‌جای حدس.** نماها و فرم‌های «مثل PWA» از روی خروجی کاوشگرهای فقط‌خواندنی همان سرور ساخته شدند: همان ستون‌ها، همان گروه‌بندی و همان برچسب‌ها، تا کاربر PWA غریبه نماند. چرخه‌ی کار ثابت بود: کاوشگر روی سرور واقعی، ساخت، آزمون خودکار روی یک فارم شبیه‌سازی‌شده، بسته‌ی zip با assert، نصب، و آزمون کنسولی روی سرور.\n\n**مرکز حسابرسی** مدل را درست کرد. گزارش و سرفصل یافته پروژه نیستند؛ فیلدهای خود پروژه‌ی مصداق‌اند و مرکز از روی آن‌ها درخت «گزارش ← سرفصل ← مصداق ← اقدام ← جزء کاری» را می‌سازد. «+ سرفصل یافته» و «+ مصداق» همان فرم را با بخش‌های بالادستی پر و قفل باز می‌کنند تا چیزی دوباره تایپ نشود، و گزارشی که پیش از نخستین مصداقش ثبت شود فقط یک رکورد نگه‌دارنده می‌سازد که با ثبت مصداق واقعی بازیافت می‌شود.\n\n**نقش‌ها.** طاها نیازها و قاعده‌ها را تعریف کرد و تصمیم‌های اصلی را گرفت: قاعده‌ی دید، تعریف «منشور»، «استفاده از PWA قدیمی ممنوع» و «هیچ فیلدی از فرم حسابرسی حذف نشود». کاوشگرها و آزمون کنسولی را روی سرور واقعی اجرا کرد، بسته‌ها را نصب کرد، و دو خطای طراحی را خودش گرفت. Claude در چارچوب قیدهای طاها معماری و تصمیم‌های طراحی را پیشنهاد داد، کد سامانه، سپر، موتور نوشتن، کاوشگرها و آزمون‌ها را نوشت و خروجی‌هایی را که طاها فرستاد برای یافتن علت ریشه‌ای تحلیل کرد. Claude هیچ دسترسی‌ای به سرور بانک نداشت؛ هرچه درباره‌ی سرور دانسته شد از خروجی کاوشگرها و آزمون‌هایی آمد که طاها اجرا کرد و فرستاد.",
    en: "The core idea is a thin user-interface layer that runs only in the browser, on the platform that is already there: no new database, no new server, no data migration. The whole system starts from **one web part** on a SharePoint page and loads thirty static files from a document library on the same site; an update is just a file replacement. Whatever is written lands exactly where PWA would write it, so the old system, the new one and Microsoft Project all work on the same data side by side.\n\n**SharePoint is the bridge.** Most reads come from Project Server's reporting layer (OData), project and task writes go over REST to the project draft, and access rights, progress history and the event log live in SharePoint lists. The system never connects to SQL Server directly: «write only to Project Server and let it land in SQL by itself.»\n\n**Safety first.** All network traffic goes through one «safety guard». Writes are allowed only from a whitelist of named operations, and only inside a «write session» bound to one project — the blast radius of any mistake is that one project. The write engine snapshots the project before every change, checks it out and publishes, checks it in «always, in finally», and reads the values back so any field that did not land on the server is reported in red.\n\n**Evidence over guessing.** The «like PWA» views and forms were rebuilt from the output of read-only probes run on the server itself — same columns, same grouping, same labels — so PWA users feel at home. The loop never changed: probe on the real server, build, automated tests on a simulated farm, a zip package with asserts, install, and a console self-test on the server.\n\n**The audit centre** fixed the model. Report and finding are not projects; they are fields on the case project itself, and the centre builds the «report → finding → case → action → work item» tree from them. «+ finding» and «+ case» open the same form with the upper sections filled and locked, so nothing is retyped, and a report saved before its first case creates exactly one placeholder record that is recycled when the real case is saved.\n\n**Who did what.** Taha defined the needs and rules and made the calls: the visibility rule, what a «charter» is, «the old PWA is forbidden for real work» and «no audit form field may be removed». He ran the probes and the console self-test on the real server, installed the packages, and caught two design errors himself. Claude proposed the architecture and design decisions within Taha's constraints, wrote the system, the guard, the write engine, the probes and the tests, and analysed the outputs Taha sent back to find root causes. It had no access to the bank's server; everything known about the server came from the output of the probes and tests Taha ran and sent back.",
  },
  architecture: {
    cols: 5,
    rows: 3,
    nodes: [
      { id: "users", col: 0, row: 1, kind: "human", label: { fa: "کارکنان بانک", en: "Bank staff" }, sub: { fa: "مرورگر · بی اینترنت", en: "browser · no internet" } },
      { id: "app", col: 1, row: 1, kind: "process", label: { fa: "سامانه‌ی جدید", en: "The new system" }, sub: { fa: "یک وب‌پارت · ۳۰ فایل", en: "one web part · 30 files" } },
      { id: "guard", col: 2, row: 1, kind: "agent", label: { fa: "سپر ایمنی", en: "Safety guard" }, sub: { fa: "فهرست سفید · یک پروژه", en: "whitelist · one project" } },
      { id: "sp", col: 3, row: 0, kind: "process", label: { fa: "SharePoint", en: "SharePoint" }, sub: { fa: "لیست‌ها · گروه‌ها", en: "lists · groups" } },
      { id: "ps", col: 3, row: 1, kind: "process", label: { fa: "Project Server", en: "Project Server" }, sub: { fa: "REST · CSOM · فرم تأیید", en: "REST · CSOM · approvals" } },
      { id: "odata", col: 3, row: 2, kind: "source", label: { fa: "OData گزارش‌گیری", en: "Reporting OData" }, sub: { fa: "بیشتر خواندن‌ها", en: "most reads" } },
      { id: "sql", col: 4, row: 1, kind: "store", label: { fa: "SQL Server", en: "SQL Server" }, sub: { fa: "انبار گزارش · SSRS", en: "reporting store · SSRS" } },
      { id: "pwa", col: 4, row: 2, kind: "source", label: { fa: "PWA قدیمی", en: "Old PWA" }, sub: { fa: "روی همان داده", en: "on the same data" } },
    ],
    edges: [
      { from: "users", to: "app" },
      { from: "app", to: "guard" },
      { from: "guard", to: "sp", label: { fa: "REST", en: "REST" } },
      { from: "guard", to: "ps", label: { fa: "نوشتن", en: "write" } },
      { from: "guard", to: "odata", label: { fa: "خواندن", en: "read" } },
      { from: "ps", to: "sql", label: { fa: "publish", en: "publish" } },
      { from: "sql", to: "sp", dashed: true, label: { fa: "لیست خارجی", en: "BCS" } },
      { from: "pwa", to: "ps", dashed: true },
    ],
    caption: { fa: "همه‌چیز روی شبکه‌ی بی‌اینترنت بانک می‌ماند؛ نمودار الگوی معماری است، نه نام‌ها و نشانی‌های واقعی", en: "Everything stays on the bank's no-internet network; the diagram shows the pattern, not the real names or addresses" },
  },
  interactive: "audit-centre",
  features: {
    fa: [
      "یک وب‌پارت و سی فایل ایستا روی همان SharePoint: بی پایگاه‌داده، سرور یا انتقال داده‌ی تازه، و هم‌زیستی کامل با PWA و Microsoft Project روی همان داده",
      "سپر ایمنی: مسیر واحد برای همه‌ی درخواست‌ها، قفل fetch و XHR در زمان اجرا، مهار بار (۱۰ خواندن و ۴ نوشتن هم‌زمان، ۱۸۰ درخواست در دقیقه، کلید حرارتی)، و سه حالت فقط‌خواندنی، شبیه‌سازی و نوشتن",
      "موتور نوشتن امن: عکس پیش از تغییر، check-out، نوشتن در پیش‌نویس، publish و سرانجام check-in در finally، حذف نرم، و بازخوانی پس از نوشتن با هشدار قرمز «روی سرور ننشست»",
      "مرکز حسابرسی: درخت گزارش ← سرفصل ← مصداق ← اقدام ← جزء کاری، پیشرفت تجمیعی از پایین به بالا، و فرم‌های «+ سرفصل یافته» و «+ مصداق» با بخش‌های بالادستی پر و قفل",
      "کارتابل وظایف و تأییدات از نو: درصد، سند، شرح وضعیت و دلیل تأخیر در یک بسته؛ تأیید تکی و گروهی، زنجیره‌ی چندمرحله‌ای و رد فقط با دلیل؛ و تأییدی که API ندارد، از همان فرم PWA در پس‌زمینه",
      "پانزده ماژول در شش گروه (هیئت‌مدیره و عامل، حسابرسی داخلی، فناوری اطلاعات، مصوبات کمیته‌ها، قراردادها، کارتابل‌ها) با گانت شمسی دست‌ساز، منشور هر پروژه و میز کار شخصی",
      "دسترسی پیش‌فرض «هیچ»، ماتریس کاربر × ماژول، دید داده بر پایه‌ی پنج نقش و زیردستان در RBS، و «نمای کاربر» فقط‌خواندنی؛ با این مرز صادقانه که این دیوار امنیتی نیست و دیوار واقعی مجوزهای خود سرور است",
      "بی هیچ کتابخانه‌ی بیرونی: قلم جاسازی‌شده، نمودار و گانت SVG، تقویم شمسی، و سازنده‌های zip و اکسل فارسی راست‌چین، همه درون خود سامانه",
    ],
    en: [
      "One web part and thirty static files on the existing SharePoint: no new database, server or data migration, and full coexistence with PWA and Microsoft Project on the same data",
      "A safety guard: one path for every request, a runtime lock on fetch and XHR, load control (10 reads and 4 writes at once, 180 requests a minute, a circuit breaker), and three modes — read-only, simulate and write",
      "A safe write engine: snapshot before the change, check-out → draft → publish → check-in in finally, soft deletes, and a read-back that flags in red any field that «did not land on the server»",
      "The audit centre: a report → finding → case → action → work item tree, progress rolled up from the bottom, and «+ finding» / «+ case» forms with the upper sections filled and locked",
      "Task and approval inboxes rebuilt: percentage, documents, status note and delay reason in one bundle; single and bulk approval, multi-stage chains, rejection only with a reason; and approval, which has no API, through PWA's own form in the background",
      "Fifteen modules in six groups — Board & CEO, internal audit, IT, committee resolutions, contracts, inboxes — with a hand-made Jalali Gantt, a charter for every project and a personal workspace",
      "Default access «none», a user × module matrix, data visibility from five roles plus subordinates in the RBS, and a read-only «view as user» — with the honest boundary that this is not a security wall; the real wall is the server's own permissions",
      "Zero external libraries: an embedded font, SVG charts and Gantt, a Jalali calendar, and zip and right-to-left Persian Excel writers, all inside the system",
    ],
  },
  outcomes: [
    { value: { fa: "۹۰٪", en: "90%" }, label: { fa: "ساخته شده به برآورد طاها، و در حال بهره‌برداری", en: "built, by Taha's estimate — and in use" } },
    { value: { fa: "۱۵", en: "15" }, label: { fa: "ماژول با دسترسی جدا، در ۶ گروه و ۵۲ مسیر صفحه", en: "access-controlled modules in 6 groups and 52 routes" } },
    { value: { fa: "۵۲٬۲۰۰", en: "52,200" }, label: { fa: "خط کد بی هیچ کتابخانه‌ی بیرونی: حدود ۴۱ هزار JavaScript و ۱۱ هزار CSS", en: "lines of code with zero external libraries: about 41k JavaScript and 11k CSS" } },
    { value: { fa: "۲٬۳۴۴", en: "2,344" }, label: { fa: "سنجه‌ی خودکار شمرده‌شده در ۳۸ از ۴۲ مجموعه‌ی آزمون، به‌علاوه‌ی ۱۸ صفحه‌ی شبیه‌ساز فارم", en: "counted automated checks in 38 of 42 test suites, plus 18 farm-simulator pages" } },
    { value: { fa: "۲۳", en: "23" }, label: { fa: "بیلد در حدود یک ماه، از نسخه‌ی ۵۴ تا ۷۶، تحویل‌شده به شکل بسته‌ی zip با راهنمای نصب", en: "builds in about a month, v54 to v76, delivered as zip packages with install guides" } },
    { value: { fa: "۳۲ms", en: "32 ms" }, label: { fa: "برای هر ضربه‌ی کلید با «حالت سبک» روی رایانه‌های بدون کارت گرافیک؛ پیش از آن ۶۰۰ تا ۹۰۰ میلی‌ثانیه (اندازه‌گیری آزمایشگاهی)", en: "per keystroke in «lite mode» on machines without a GPU, down from 600–900 ms (lab measurement)" } },
    { value: { fa: "۰", en: "0" }, label: { fa: "پروژه‌ی ساختگی ماندگار برای گزارش یا سرفصل؛ نگه‌دارنده‌ها بازیافت می‌شوند", en: "permanent dummy projects for a report or finding — placeholders are recycled" } },
    { value: { fa: "۰", en: "0" }, label: { fa: "درخواست به بیرون از شبکه‌ی بانک", en: "requests leaving the bank's network" } },
  ],
  gallery: [
    {
      kind: "image",
      src: "/media/work/tejarat-new-epm/audit-centre-pwa-view.webp",
      w: 1920,
      h: 1069,
      frame: "browser",
      tone: "color",
      alt: { fa: "مرکز حسابرسی در نمای «مثل PWA»: درخت گزارش، سرفصل، مصداق، اقدام و جزء کاری با دکمه‌های «+ سرفصل یافته»، «+ مصداق»، «+ اقدام» و «+ جزء کاری»", en: "The audit centre in its «like PWA» view: a report, finding, case, action and work-item tree with «+ finding», «+ case», «+ action» and «+ work item» buttons" },
      caption: { fa: "مرکز حسابرسی · نمای «مثل PWA»: همان ستون‌ها و قاعده‌ی ردیف گروه، با دکمه‌ی افزودن روی ردیف گزارش، سرفصل، مصداق و اقدام", en: "Audit centre · the «like PWA» view: same columns and group-row rule, with an add button on the report, finding, case and action rows" },
    },
    {
      kind: "image",
      src: "/media/work/tejarat-new-epm/audit-new-case-form.webp",
      w: 1920,
      h: 933,
      tone: "color",
      span: 6,
      alt: { fa: "فرم «مصداق تازه زیر همین سرفصل» با بخش‌های گزارش و سرفصل که از سطح بالاتر پر شده‌اند", en: "The «new case under this finding» form with the report and finding sections filled from the level above" },
      caption: { fa: "«+ مصداق»: گزارش و سرفصل از سطح بالاتر پر شده‌اند و دوباره تایپ نمی‌شوند", en: "«+ case»: report and finding come filled from the level above and are never retyped" },
    },
    {
      kind: "image",
      src: "/media/work/tejarat-new-epm/audit-report.webp",
      w: 1920,
      h: 1069,
      tone: "color",
      span: 6,
      alt: { fa: "گزارش حسابرسی داخلی با فیلترها، شاخص‌ها و نمودارهای دونات", en: "The internal audit report with filters, indicators and donut charts" },
      caption: { fa: "گزارش حسابرسی داخلی · پیشرفت تجمیعی و نمودارهای SVG دست‌ساز", en: "Internal audit report · rolled-up progress and hand-written SVG charts" },
    },
    {
      kind: "image",
      src: "/media/work/tejarat-new-epm/audit-centre-follow-up.webp",
      w: 1920,
      h: 1069,
      tone: "color",
      span: 6,
      alt: { fa: "نمای «پیگیری یافته‌ها» با ستون‌های اهمیت، نوع ریسک، وضعیت، مهلت، مسئول و پیشرفت", en: "The «finding follow-up» view with importance, risk type, status, deadline, responsible-person and progress columns" },
      caption: { fa: "نمای خود سامانه: پیگیری یافته‌ها", en: "The system's own view: finding follow-up" },
    },
    {
      kind: "image",
      src: "/media/work/tejarat-new-epm/case-schedule-gantt.webp",
      w: 1920,
      h: 560,
      tone: "color",
      span: 6,
      alt: { fa: "زمان‌بندی یک مصداق: جدول WBS و گانت با محور شمسی", en: "A case's schedule: the WBS table and a Gantt chart on a Jalali timeline" },
      caption: { fa: "زمان‌بندی: WBS و گانت دست‌ساز با تقویم شمسی", en: "Schedule: WBS and a hand-made Gantt on the Jalali calendar" },
    },
  ],
  code: [
    {
      title: {
        fa: "سقف ۲۰۴۸ نویسه‌ای IIS و نام ستون‌های فارسی: پرسمان بلند تکه‌تکه می‌شود، تکه‌ها موازی می‌روند و سطرها با کلید دوباره دوخته می‌شوند؛ سطر ناقص گزارش می‌شود، پنهان نمی‌شود",
        en: "IIS's 2048-character cap meets Persian column names: a long query is chunked, chunks run in parallel, rows are stitched back by key — and a partial row is reported, never hidden",
      },
      lang: "js",
      file: "app/app.js",
      code: `// IIS accepts a query string of at most 2048 chars; a Persian letter becomes ~6 once URL-encoded.
// A long $select is cut into chunks that all repeat the key and filter columns (MUST).
function splitCols(cols, max, withF) {
  if (!KEY || qsOf(cols, withF).length <= max) return [cols];
  var rest = cols.filter(function (c) { return MUST.indexOf(c) < 0; });
  var parts = [], cur = MUST.slice();
  rest.forEach(function (c) {
    if (cur.length > MUST.length && qsOf(cur.concat([c]), withF).length > max) {
      parts.push(cur); cur = MUST.slice();
    }
    cur.push(c);
  });
  if (cur.length > MUST.length || !parts.length) parts.push(cur);
  return parts;
}
function mergeParts(list) {                     // chunks run in parallel; rows are re-joined by key
  var byId = Object.create(null), out = [];
  list.forEach(function (rows) {
    rows.forEach(function (row) {
      var id = String(row[KEY] == null ? '' : row[KEY]).replace(/[{}]/g, '').toLowerCase();
      var t = byId[id];
      if (!t) { t = byId[id] = { row: {}, n: 0 }; out.push(t); }
      Object.keys(row).forEach(function (c) { if (t.row[c] === undefined) t.row[c] = row[c]; });
      t.n++;
    });
  });
  var partial = out.filter(function (t) { return t.n < list.length; }).length;  // reported, never hidden
  return { rows: out.map(function (t) { return t.row; }), partial: partial };
}`,
    },
    {
      title: {
        fa: "داور سپر ایمنی: نوشتن به‌طور پیش‌فرض «نه» است؛ باید با یک عملیات نام‌دار در فهرست سفید جور شود که پروژه‌اش همان پروژه‌ی جلسه‌ی نوشتن باز است",
        en: "The safety guard's judge: a write is «no» by default — it must match a named whitelist entry whose project is the project of the one open write session",
      },
      lang: "js",
      file: "app/guard.js",
      code: `// Every request the app itself starts goes through judge(). A write is "no" by default: it must match
// a named whitelist entry whose URL pattern has {P} = the project of the ONE open write session.
function judge(u, verb, fromApp, body) {
  if (!fromApp) {                                 // SharePoint's own traffic: counted, never blocked
    if (isWrite(verb)) state.foreignWrites++;
    return null;
  }
  var f = hitsForbidden(u, verb);                 // always-closed paths, in every mode
  if (f) return 'always-closed path ' + f;
  if (!isOurServer(u)) return 'destination outside the organization server';
  if (!prefixAllowed(u)) return 'path outside the app scope';
  if (!isWrite(verb)) {                           // reads: only a volume cap
    var top = /[?&]\\$top=(\\d+)/i.exec(u);
    return (top && +top[1] > POLICY.maxTopRows) ? '$top above the cap' : null;
  }
  if (isCsom(u)) {                                // CSOM has one URL for everything,
    if (POLICY.mode === 'readonly') return 'CSOM in read-only mode';
    if (!state.session) return 'CSOM without an open write session';
    if (!csomTargetsSession(body)) return 'CSOM body points to another project';
    return null;                                  // ...so its BODY must name the session project
  }
  if (POLICY.mode === 'readonly') return 'write verb in read-only mode';
  if (POLICY.mode !== 'write' && POLICY.mode !== 'simulate') return 'unknown mode, treated as read-only';
  var op = matchWriteOp(u, verb, body);
  if (!op) return 'write not on the whitelist';
  if (!op.noProject && !state.session) return 'write outside a write session';
  return null;                                    // allowed
}`,
    },
    {
      title: {
        fa: "گزارش و سرفصل پروژه نیستند: به‌جای ساختن پروژه‌ی دوم، رکورد نگه‌دارنده تکمیل می‌شود و نامش تغییر می‌کند، و ردی از آن نمی‌ماند",
        en: "Report and finding are not projects: no second project is created — the placeholder record is completed and renamed, and no trace of it remains",
      },
      lang: "js",
      file: "app/audit.js",
      code: `// "Report" and "finding" are not projects: they are fields on the CASE project. A report/finding
// saved before its first case becomes ONE placeholder project; when the real case is saved, that
// placeholder is completed and renamed — no second project, no leftover. (condensed from save())
var hasCase = !!String(cse.title || '').trim();
var hasFinding = !!(String(fnd.code || '').trim() || String(fnd.title || '').trim());
data.case.recState = hasCase ? STATE.complete : (hasFinding ? STATE.noCase : STATE.noFinding);

var projectId = ctx._ids && ctx._ids.projectId;   // 1) an existing record → edit it
var reuse = null;
if (!projectId && (hasCase || hasFinding) && ctx._chain) {
  var ch = ctx._chain;
  if (hasCase && ch.finding)                      // 2) a "no case" placeholder under this finding
    reuse = (ch.finding.cases || []).filter(isPlaceholder)[0] || null;
  if (!reuse && ch.report) {                      //    or the report's "no finding" placeholder
    var pool = [];
    (ch.report.findings || []).forEach(function (fg) {
      (fg.cases || []).forEach(function (c) { pool.push(c); });
    });
    reuse = pool.filter(isNoFinding)[0] || null;
  }
  if (reuse) projectId = reuse.projectId;
}
var name = String(cse.title || '').trim() || placeholderName(rep, fnd);  // unique, self-describing
if (!hasCase) data.case.title = name;
if (!projectId) projectId = await WRITE.createProject(eptId, name, vals, schema, log);  // 3) new`,
    },
    {
      title: {
        fa: "رنگ‌های نمودار قدیمی روی پوسته‌ی تیره: فقط روشنایی OKLCH جابه‌جا می‌شود تا هر وضعیت رنگ آشنای خودش را نگه دارد",
        en: "Legacy chart colours on the dark skin: only the OKLCH lightness moves, so every status keeps its familiar colour",
      },
      lang: "js",
      file: "app/legacy.js",
      code: `// Legacy chart colors were picked for a white page. On the dark theme only the OKLCH lightness is
// moved into a readable band; hue and chroma stay, so each status keeps its familiar color.
// If the result falls outside sRGB, chroma is lowered step by step until it fits.
function toneDark(c) {
  var mm = /^#([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!mm || !Math.cbrt) return c;                // named colors and rgba(...) stay as they are
  var n = parseInt(mm[1], 16), lab = okLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
  var L = lab[0], ch = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), h = Math.atan2(lab[2], lab[1]);
  var L2 = Math.min(0.665, Math.max(0.55, L));
  if (Math.abs(L2 - L) < 0.004) return c;
  for (var k = 1; k >= 0; k -= 0.02) {
    var rgb = okRgb(L2, ch * k * Math.cos(h), ch * k * Math.sin(h));
    if (rgb.every(function (v) { return v >= -0.0005 && v <= 1.0005; })) return rgbHex(rgb);
  }
  return c;
}`,
    },
  ],
  orgs: ["tejarat", "pars"],
  note: {
    fa: "این سامانه را شرکت مدیریت پروژه پارس برای بانک تجارت می‌سازد. نام‌ها، نشانی‌ها و داده‌های واقعی سامانه محرمانه است: تصویرها از همان کد روی فارم شبیه‌سازی‌شده و داده‌ی آزمون گرفته شده‌اند، با نام‌های ساختگی و بی سربرگ؛ تکه‌کدها پاک‌سازی شده‌اند (توضیح‌ها انگلیسی و نام‌ها عمومی)؛ و بخش تعاملی مرکز حسابرسی رفتار کد را روی داده‌ی ساختگی نشان می‌دهد. عددها از کد و بسته‌ها شمرده یا در همان فایل‌ها اندازه‌گیری و ثبت شده‌اند (۳۲ میلی‌ثانیه اندازه‌گیری آزمایشگاهی است) و ۹۰٪ برآورد طاهاست. کار روی هشدارها، داشبورد و سرعت صفحه‌های EPM بانک در پرونده‌ی بعدی آمده است.",
    en: "Pars Project Management is building this system for Bank Tejarat. The system's real names, addresses and data are confidential: the screenshots come from the same code running on the simulated farm with test data, with made-up names and the header removed; the code excerpts are sanitized (comments in English, names made generic); and the audit-centre piece shows the code's behaviour on made-up data. The numbers are counted from the code and the packages, or measured and recorded there (the 32 ms is a lab measurement); the 90% is Taha's estimate. Work on the bank's EPM alerts, dashboards and page speed is in the next case study.",
  },
};
