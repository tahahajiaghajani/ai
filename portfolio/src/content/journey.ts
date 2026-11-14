import type { Role } from "@/content/types";

/**
 * Career and education: what is running now first, then the bank engagements, own products, research and study
 * (facts confirmed from Taha's own words, his thesis and his repositories). Engagements whose dates Taha has not
 * given carry their kind (advisory, on site, oversight) in place of a date.
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
    title: { fa: "سرپرست تیم توسعه و هوش مصنوعی و مدیر محصول", en: "Head of Development & AI, Product Manager" },
    period: { fa: "اکنون", en: "Now" },
    body: {
      fa: "پروژه‌ی ساخت سامانه‌ی مدیریت خدمات فناوری اطلاعات (ITSM) بانک صنعت و معدن: سرپرستی تیم توسعه و هوش مصنوعی و مدیریت محصول.",
      en: "Building the Bank of Industry and Mine's IT service management (ITSM) system: leading the development and AI team, and managing the product.",
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
    org: "mellat",
    title: { fa: "مهندس استقرار پیشرو (FDE)", en: "Forward Deployed Engineer" },
    period: { fa: "استقرار در محل", en: "On site" },
    body: {
      fa: "مدیریت و رفع مشکلات «سایمپ»، سامانه‌ی مدیریت پروژه‌ی بانک ملت.",
      en: "Managing and resolving the issues of Saymp (سایمپ), Bank Mellat's project-management system.",
    },
  },
  {
    org: "refah",
    title: { fa: "مشاور هوش مصنوعی", en: "AI Consultant" },
    period: { fa: "مشاوره", en: "Advisory" },
    body: {
      fa: "مشاوره‌ی هوش مصنوعی به بانک رفاه: مدیریت سخت‌افزارهای هوش مصنوعی، مدیریت درخواست‌ها و کاربران، و مدیریت و بهبود عملکرد مدل‌های محلی.",
      en: "AI advisory at Refah Bank: managing the AI hardware, handling requests and users, and running and improving the performance of local models.",
    },
  },
  {
    org: "postbank",
    title: { fa: "ناظر پروژه", en: "Project Supervisor" },
    period: { fa: "نظارت", en: "Oversight" },
    body: {
      fa: "یکی از ناظران پروژه‌ی ساخت نرم‌افزار مدیریت پروژه‌ی پست بانک ایران.",
      en: "One of the supervisors of the project building Post Bank of Iran's project-management software.",
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
