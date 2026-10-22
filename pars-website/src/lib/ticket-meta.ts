/** Ticket vocabulary (client-safe). */
export const STATUSES = ["new", "in_progress", "answered", "resolved", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const CATEGORIES = ["support", "bug", "sales", "demo", "training", "consulting", "feature", "other"] as const;
export const PRODUCTS = ["epm", "migration", "ai", "custom", "training", "other"] as const;

export type TicketStatus = (typeof STATUSES)[number];
export type TicketPriority = (typeof PRIORITIES)[number];
export type TicketCategory = (typeof CATEGORIES)[number];
export type TicketProduct = (typeof PRODUCTS)[number];

type L = { fa: string; en: string };

export const STATUS_LABEL: Record<TicketStatus, L> = {
  new: { fa: "ثبت شد", en: "Received" },
  in_progress: { fa: "در حال بررسی", en: "In progress" },
  answered: { fa: "پاسخ داده شد", en: "Answered" },
  resolved: { fa: "حل شد", en: "Resolved" },
  closed: { fa: "بسته شد", en: "Closed" },
};

export const PRIORITY_LABEL: Record<TicketPriority, L> = {
  low: { fa: "کم", en: "Low" },
  normal: { fa: "معمولی", en: "Normal" },
  high: { fa: "بالا", en: "High" },
  urgent: { fa: "فوری", en: "Urgent" },
};

export const CATEGORY_LABEL: Record<TicketCategory, L> = {
  support: { fa: "پشتیبانی فنی", en: "Technical support" },
  bug: { fa: "گزارش خطا", en: "Bug report" },
  sales: { fa: "فروش و پیش‌فاکتور", en: "Sales & quote" },
  demo: { fa: "درخواست دمو یا جلسه", en: "Demo or meeting" },
  training: { fa: "آموزش و دوره‌ها", en: "Training" },
  consulting: { fa: "مشاوره", en: "Consulting" },
  feature: { fa: "درخواست قابلیت", en: "Feature request" },
  other: { fa: "سایر", en: "Other" },
};

export const PRODUCT_LABEL: Record<TicketProduct, L> = {
  epm: { fa: "سامانه‌های EPM / EPPM", en: "EPM / EPPM systems" },
  migration: { fa: "نوسازی و مهاجرت EPM", en: "EPM renewal & migration" },
  ai: { fa: "ایجنت‌ها و هوش مصنوعی", en: "AI agents & assistants" },
  custom: { fa: "نرم‌افزار سازمانی سفارشی", en: "Custom enterprise software" },
  training: { fa: "آموزش", en: "Training" },
  other: { fa: "سایر / نمی‌دانم", en: "Other / not sure" },
};

/** first-response targets in hours */
export const SLA_HOURS: Record<TicketPriority, number> = { urgent: 2, high: 8, normal: 24, low: 72 };

export const OPEN_STATUSES: TicketStatus[] = ["new", "in_progress", "answered"];

export function isStatus(v: unknown): v is TicketStatus {
  return STATUSES.includes(v as TicketStatus);
}
export function isPriority(v: unknown): v is TicketPriority {
  return PRIORITIES.includes(v as TicketPriority);
}
export function isCategory(v: unknown): v is TicketCategory {
  return CATEGORIES.includes(v as TicketCategory);
}
export function isProduct(v: unknown): v is TicketProduct {
  return PRODUCTS.includes(v as TicketProduct);
}

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Human-friendly tracking code, e.g. PP-7K3QX9 (no 0/O/1/I). */
export function ticketCode(random: (n: number) => Uint8Array): string {
  const bytes = random(6);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `PP-${s}`;
}

export function normalizeCode(input: string): string {
  const s = input
    .trim()
    .toUpperCase()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[^A-Z0-9]/g, "");
  const core = s.startsWith("PP") ? s.slice(2) : s;
  return `PP-${core}`;
}
