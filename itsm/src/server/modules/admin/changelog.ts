// «تازه‌ها» of the platform (catalogue ADM-015): what each version brought, shown in the platform owner's «نسخه و ارتقا»
// and the tenant console's home. Kept in code with the release; newest first.
export interface ChangelogEntry {
  version: string;
  /** ISO date */
  date: string;
  items: string[];
}

export const ADMIN_CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "2026-11-09",
    items: [
      "کنسول مدیر سامانه: طرح‌ها و محدودیت‌ها، کلیدهای قابلیت، اطلاعیه به سازمان‌ها، پایش کارهای پس‌زمینه، پشتیبان‌گیری و نسخه",
      "کنسول مدیر سازمان: برند، ورود گروهی اعضا، ماتریس دسترسی با توضیح، استودیوی جدول‌ها و فیلدهای سفارشی، ورود و خروج داده، گزارش‌های سامانه، مجوزها",
      "مرکز اتصال‌ها: کاربران یکپارچه‌سازی و کلیدهای API با دامنه، سند OpenAPI، وب‌هوک‌ها، LDAP/AD، SCIM، Jira و GitHub، خروجی‌های زمان‌بندی‌شده",
    ],
  },
];
