import type { Role } from "@/content/types";

/** Career and education, newest first (facts confirmed from Taha's own words, his thesis and his repositories). */
export const JOURNEY: Role[] = [
  {
    org: "pars",
    current: true,
    title: { fa: "مدیر پروژه و سرپرست تیم هوش مصنوعی", en: "Project Manager & Head of AI" },
    period: { fa: "اکنون", en: "Now" },
    body: {
      fa: "سرپرستی تیم هوش مصنوعی شرکت مدیریت پروژه پارس؛ مدیریت سامانه‌های مدیریت پروژه‌ی بانک تجارت و مشاوره‌ی هوش مصنوعی به این بانک؛ ایجنت‌ها و دستیار هوشمند سامانه‌های پارس، و بازطراحی برند و وب‌سایت شرکت.",
      en: "Leading the AI team at Pars Project Management; managing Bank Tejarat's project-management systems and advising the bank on AI; building the agents and AI copilot of Pars's systems, and the company's new brand and website.",
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
    org: "independent",
    title: { fa: "سازنده‌ی محصول و استودیوی شخصی", en: "Independent product builder" },
    period: { fa: "۱۴۰۵", en: "2026" },
    body: {
      fa: "Task Flow (پلتفرم تسک‌دهی با ایجنت‌های هوش مصنوعی)، سندو (همراه چندعاملی با جهان سه‌بعدی)، وب‌سایت و سامانه‌ی فروش سلین و سامانه‌های سفارشی؛ از برند تا استقرار.",
      en: "Task Flow (a task platform run by AI agents), Sendō (a multi-agent companion in a 3D world), the CELIN website and partner-sales platform, and custom systems — from brand to deployment.",
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
