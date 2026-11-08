// Ordered list of schema migrations. Never edit a migration that has shipped: add a new file and register it
// here. `npm run schema` writes them to supabase/schema.sql and supabase/migrations/*.sql.
import core from "./0001_core";
import platform from "./0002_platform";
import integrations from "./0003_integrations";
import ai from "./0004_ai";
import engine from "./0005_engine";
import access from "./0007_access";
import notify from "./0010_notify";
import flows from "./0011_flows";
import aiRag from "./0020_ai_rag";
import knowledge from "./0045_knowledge";
import { ddlForAll } from "../../engine/ddl";

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
  { id: "0005_engine", title: "موتور رکوردها: صف کارها، تاریخچه، یادداشت‌ها، پیوست‌ها، پیوندها و شماره‌ها", sql: engine },
  {
    id: "0006_engine_tables",
    title: "جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)",
    // generated from the table registry when read (src/server/engine/ddl.ts); reconcileSchema re-applies it on
    // every database whose copy is older, so this migration never needs editing by hand
    get sql() {
      return ddlForAll();
    },
  },
  { id: "0007_access", title: "دسترسی: نسخهٔ پیکربندی دسترسی و شمارندهٔ دامنهٔ دید اعضا", sql: access },
  { id: "0010_notify", title: "اعلان‌ها: گزارش ارسال، ایمیل‌های ارسالی و دریافتی و وضعیت صندوق‌ها", sql: notify },
  { id: "0011_flows", title: "گردش‌کارها: اجراها، گزارش گام‌ها، انتظارها و زمان‌بندی", sql: flows },
  { id: "0020_ai_rag", title: "هوش مصنوعی: نمایه و بازیابی (قطعه‌ها، بردارها، متن اسناد هوشمند)", sql: aiRag },
  { id: "0045_knowledge", title: "مدیریت دانش: جریان رویدادهای دانش (جست‌وجو، بازدید، رأی، پیوند، حل بدون درخواست)", sql: knowledge },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;
