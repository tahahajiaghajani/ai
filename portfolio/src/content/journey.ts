import type { Role } from "@/content/types";

/**
 * Career and education: what is running now first, then the earlier bank engagements, own products, research and
 * study (facts confirmed from Taha's own words, his thesis and his repositories). Engagements whose dates Taha has
 * not given are marked «پیش‌تر» / Earlier in place of a date and told in the past tense; among themselves they
 * follow the reverse of his own telling. Never put a year on them until he gives one.
 */
export const JOURNEY: Role[] = [
  {
    org: "pars",
    current: true,
    title: { fa: "مدیر پروژه و سرپرست تیم هوش مصنوعی", en: "Project Manager & Head of AI" },
    period: { fa: "اکنون", en: "Now" },
    body: {
      fa: "سرپرستی تیم هوش مصنوعی شرکت مدیریت پروژه پارس؛ مدیریت سامانه‌های مدیریت پروژه‌ی بانک تجارت و مشاوره‌ی هوش مصنوعی به این بانک، از جمله طراحی، ساخت و هدایت سامانه‌ی جدید EPM بانک؛ ایجنت‌ها و دستیار هوشمند سامانه‌های پارس، و بازطراحی برند و وب‌سایت شرکت.",
      en: "Leading the AI team at Pars Project Management; managing Bank Tejarat's project-management systems and advising the bank on AI, including designing, building and leading the bank's new EPM system; building the agents and AI copilot of Pars's systems, and the company's new brand and website.",
    },
  },
  {
    org: "bim",
    current: true,
    title: { fa: "سرپرست تیم توسعه و هوش مصنوعی و مدیر محصول ITSM", en: "Head of the Development & AI Team, ITSM Product Manager" },
    period: { fa: "اکنون", en: "Now" },
    body: {
      fa: "در پروژه‌ی ساخت سامانه‌ی مدیریت خدمات فناوری اطلاعات (ITSM) بانک صنعت و معدن: سرپرستی تیم توسعه و هوش مصنوعی پروژه و مدیریت محصول.",
      en: "On the project building the Bank of Industry and Mine's IT service management (ITSM) system: leading the project's development and AI team, and managing the product.",
    },
  },
  {
    org: "msc",
    current: true,
    title: { fa: "کارشناسی ارشد مهندسی صنایع", en: "MSc Industrial Engineering" },
    period: { fa: "در حال تحصیل", en: "In progress" },
    body: { fa: "گرایش طراحی سیستم و تحلیل داده.", en: "System design & data analysis track." },
  },
  {
    org: "postbank",
    title: { fa: "ناظر پروژه", en: "Project Supervisor" },
    period: { fa: "پیش‌تر", en: "Earlier" },
    body: {
      fa: "حضور به‌عنوان یکی از ناظران در پروژه‌ی ساخت نرم‌افزار مدیریت پروژه‌ی پست بانک ایران.",
      en: "Served as one of the supervisors of the project building Post Bank of Iran's project-management software.",
    },
  },
  {
    org: "mellat",
    title: { fa: "مهندس استقرار پیشرو (FDE)", en: "Forward Deployed Engineer" },
    period: { fa: "پیش‌تر", en: "Earlier" },
    body: {
      fa: "مدتی به‌عنوان FDE در بانک ملت: مدیریت و رفع مشکلات «سایمپ»، سامانه‌ی مدیریت پروژه‌ی بانک.",
      en: "For a period, as a forward-deployed engineer at Bank Mellat, managed and resolved the issues of the bank's project-management system (known in Persian as «سایمپ»).",
    },
  },
  {
    org: "refah",
    title: { fa: "مشاور هوش مصنوعی", en: "AI Consultant" },
    period: { fa: "پیش‌تر", en: "Earlier" },
    body: {
      fa: "مدتی مشاور هوش مصنوعی بانک رفاه: مدیریت سخت‌افزارهای هوش مصنوعی، مدیریت درخواست‌ها و کاربران، و مدیریت و بهبود عملکرد مدل‌های محلی.",
      en: "For a period, AI consultant to Refah Bank: managed the AI hardware, handled requests and users, and ran and improved the performance of local models.",
    },
  },
  {
    org: "independent",
    title: { fa: "سازنده‌ی محصول و استودیوی شخصی", en: "Independent product builder" },
    period: { fa: "۱۴۰۵", en: "2026" },
    body: {
      fa: "محصولات سیراف (حسابداری و مدیریت کسب‌وکار برای کالا، طلا و ارز) و کاریز (مدیریت خدمات سازمان با هوش مصنوعی)، Task Flow (پلتفرم تسک‌دهی با ایجنت‌های هوش مصنوعی)، سندو (همراه چندعاملی با جهان سه‌بعدی)، وب‌سایت و سامانه‌ی فروش سلین و سامانه‌های سفارشی؛ از برند تا استقرار.",
      en: "The products Siraf (accounting and business management for goods, gold and currency) and Kariz (enterprise service management with AI), Task Flow (a task platform run by AI agents), Sendō (a multi-agent companion in a 3D world), the CELIN website and partner-sales platform, and custom systems — from brand to deployment.",
    },
  },
  {
    org: "sharif",
    title: { fa: "همکاری پژوهشی: پایش عمر ابزار فرز", en: "Research collaboration: milling tool-life monitoring" },
    period: { fa: "همکاری با دانشجویان شریف", en: "With Sharif students" },
    body: {
      fa: "طراحی مشترک سیستمی که ارتعاش دستگاه فرز را با مدل‌های سری زمانی پایش می‌کند، ناهنجاری‌ها را می‌یابد و عمر تیغه را زنده تخمین می‌زند.",
      en: "Co-designed a system that monitors a milling machine's vibration with time-series models, detects anomalies and estimates the cutter's remaining life live.",
    },
  },
  {
    org: "iust",
    title: { fa: "کارشناسی مهندسی مکانیک", en: "BSc Mechanical Engineering" },
    period: { fa: "تیر ۱۴۰۵", en: "2026" },
    body: {
      fa: "دانشگاه علم و صنعت ایران؛ پایان‌نامه: سامانه‌ی بینایی ماشین هیبرید (تبدیل هاف + SAM) برای پایش سوراخ‌های خنک‌کاری فین توربین.",
      en: "Iran University of Science and Technology; thesis: a hybrid machine-vision system (Hough transform + SAM) for monitoring turbine-fin cooling holes.",
    },
  },
];
