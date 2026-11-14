import type { Org } from "@/content/types";

/**
 * Organisations Taha works or worked with, in the order the home page shows them; logos are single-colour (shown
 * white on black, black when inverted). The banks are marked, so the home page can count them; `current` marks
 * work that is running now, so the assistant never presents an earlier engagement as ongoing.
 */
export const ORGS: Org[] = [
  { key: "pars", current: true, name: { fa: "مدیریت پروژه پارس", en: "Pars Project Management" }, logo: "/brand/orgs/pars.svg", relation: { fa: "مدیر پروژه و سرپرست تیم هوش مصنوعی", en: "Project manager & head of AI" } },
  { key: "tejarat", bank: true, current: true, name: { fa: "بانک تجارت", en: "Bank Tejarat" }, logo: "/brand/orgs/tejarat.svg", relation: { fa: "مدیریت سامانه‌های مدیریت پروژه و مشاوره‌ی هوش مصنوعی", en: "Project-management systems & AI advisory" } },
  { key: "bim", bank: true, current: true, name: { fa: "بانک صنعت و معدن", en: "Bank of Industry and Mine" }, logo: "/brand/orgs/bim.png", relation: { fa: "سرپرست تیم توسعه و هوش مصنوعی و مدیر محصول در پروژه‌ی ITSM", en: "Development & AI team lead and product manager on the ITSM project" } },
  { key: "mellat", bank: true, name: { fa: "بانک ملت", en: "Bank Mellat" }, logo: "/brand/orgs/mellat.svg", relation: { fa: "مهندس استقرار پیشرو (FDE) روی سامانه‌ی مدیریت پروژه", en: "Forward-deployed engineer on the project-management system" } },
  { key: "refah", bank: true, name: { fa: "بانک رفاه", en: "Refah Bank" }, logo: "/brand/orgs/refah.svg", relation: { fa: "مشاور هوش مصنوعی: سخت‌افزار، کاربران و مدل‌های محلی", en: "AI consultant: hardware, users and local models" } },
  { key: "postbank", bank: true, name: { fa: "پست بانک ایران", en: "Post Bank of Iran" }, logo: "/brand/orgs/postbank.svg", relation: { fa: "ناظر پروژه‌ی ساخت نرم‌افزار مدیریت پروژه", en: "Supervisor on the project-management software build" } },
  { key: "celin", name: { fa: "سلین · گالری اعتماد", en: "CELIN · Etemad Gallery" }, logo: "/brand/orgs/celin.svg", relation: { fa: "وب‌سایت و سامانه‌ی فروش همکاران", en: "Website and partner-sales platform" } },
  { key: "iust", name: { fa: "دانشگاه علم و صنعت ایران", en: "Iran University of Science and Technology" }, logo: "/brand/orgs/iust.png", relation: { fa: "کارشناسی مهندسی مکانیک", en: "BSc Mechanical Engineering" } },
  { key: "sharif", name: { fa: "دانشگاه صنعتی شریف", en: "Sharif University of Technology" }, relation: { fa: "همکاری پژوهشی با دانشجویان", en: "Research collaboration with students" } },
];
