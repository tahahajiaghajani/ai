import type { Org } from "@/content/types";

/** Organisations Taha works or worked with; logos are single-colour (shown white on black, black when inverted). */
export const ORGS: Org[] = [
  { key: "pars", name: { fa: "مدیریت پروژه پارس", en: "Pars Project Management" }, logo: "/brand/orgs/pars.svg", relation: { fa: "مدیر پروژه و سرپرست تیم هوش مصنوعی", en: "Project manager & head of AI" } },
  { key: "tejarat", name: { fa: "بانک تجارت", en: "Bank Tejarat" }, logo: "/brand/orgs/tejarat.svg", relation: { fa: "مدیریت سامانه‌های مدیریت پروژه و مشاوره‌ی هوش مصنوعی", en: "Project-management systems & AI advisory" } },
  { key: "celin", name: { fa: "سلین · گالری اعتماد", en: "CELIN · Etemad Gallery" }, logo: "/brand/orgs/celin.svg", relation: { fa: "وب‌سایت و سامانه‌ی فروش همکاران", en: "Website and partner-sales platform" } },
  { key: "iust", name: { fa: "دانشگاه علم و صنعت ایران", en: "Iran University of Science and Technology" }, logo: "/brand/orgs/iust.png", relation: { fa: "کارشناسی مهندسی مکانیک", en: "BSc Mechanical Engineering" } },
  { key: "sharif", name: { fa: "دانشگاه صنعتی شریف", en: "Sharif University of Technology" }, relation: { fa: "همکاری پژوهشی با دانشجویان", en: "Research collaboration with students" } },
];
