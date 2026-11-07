// Ordered list of schema migrations. Never edit a migration that has shipped: add a new file and register it
// here. `npm run schema` writes them to supabase/schema.sql and supabase/migrations/*.sql.
import core from "./0001_core";
import platform from "./0002_platform";
import integrations from "./0003_integrations";
import ai from "./0004_ai";

export interface Migration {
  id: string;
  title: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { id: "0001_core", title: "هسته: کاربران، سازمان‌ها، اعضا، همگام‌سازی و گزارش رویدادها", sql: core },
  { id: "0002_platform", title: "مدیریت سامانه: حالت پشتیبانی، رویدادهای امنیتی و وضعیت سازمان‌ها", sql: platform },
  { id: "0003_integrations", title: "اتصال‌ها: کلیدهای API و وب‌هوک‌ها", sql: integrations },
  { id: "0004_ai", title: "هوش مصنوعی: اتصال‌ها، مصرف، گفتگوها و پیشنهادها", sql: ai },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;
