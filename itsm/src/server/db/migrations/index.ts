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
import accessLocations from "./0050_access_locations";
import aiSkills from "./0052_ai_skills";
import grantEpochs from "./0053_grant_epochs";
import aiAgents from "./0058_ai_agents";
import aiMl from "./0064_ai_ml";
import portal from "./0067_portal";
import portalSurveys from "./0070_portal_surveys";
import adminIntegration from "./0080_admin_integration";
import authDirectory from "./0090_auth_directory";
import directoryIdentity from "./0091_directory_identity";
import scale from "./0095_scale";
import demo from "./0098_demo";
import demoTouch from "./0099_demo_touch";
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
  { id: "0050_access_locations", title: "دسترسی: مکان عضو در محیط شرط‌ها (مکان من)", sql: accessLocations },
  { id: "0052_ai_skills", title: "مهارت‌های هوش مصنوعی: پیشنهادهای وابسته به رکورد", sql: aiSkills },
  { id: "0053_grant_epochs", title: "دسترسی: بازخوانی برنامهٔ ویندوز وقتی دسترسی مالکان خدمت، تأییدکنندگان و جانشینان تغییر می‌کند", sql: grantEpochs },
  { id: "0058_ai_agents", title: "عامل‌های هوش مصنوعی: پیشنهادهای عامل‌ها، مسیر رسیدگی و نتیجهٔ هر ردیف", sql: aiAgents },
  { id: "0064_ai_ml", title: "هوش مصنوعی پیش‌بین: مدل‌ها، پیش‌بینی‌ها، خوشه‌ها، بینش‌ها و گزارش حاکمیت", sql: aiMl },
  { id: "0067_portal", title: "درگاه سلف‌سرویس: جریان رویدادهای درگاه و گزارش پیام‌های کانال‌های پیام‌رسان", sql: portal },
  { id: "0070_portal_surveys", title: "درگاه سلف‌سرویس: پاسخ‌های نظرسنجی بی‌نام در انتظار ثبت دسته‌ای", sql: portalSurveys },
  { id: "0080_admin_integration", title: "مدیریت و اتصال‌ها: طرح‌ها، کلیدهای قابلیت، اطلاعیه‌ها، پشتیبان‌ها، کلیدهای API کاربران یکپارچه‌سازی، گزارش اتصال‌ها و فهرست کاربران", sql: adminIntegration },
  { id: "0090_auth_directory", title: "ورود با حساب سازمانی و ورود خودکار ویندوز: روش و دامنهٔ نشست‌ها، سیاست نشست، شمارش ورودهای ناموفق و قفل محلی", sql: authDirectory },
  { id: "0091_directory_identity", title: "پیوند حساب‌ها با خود شیء فهرست کاربران (objectGUID)، نه فقط نام آن", sql: directoryIdentity },
  { id: "0095_scale", title: "مقیاس بانکی: جست‌وجوی سه‌حرفی (pg_trgm) و نمایه‌های BRIN جریان‌های افزایشی", sql: scale },
  { id: "0098_demo", title: "داده‌های نمایشی: بستهٔ نمایشی سازمان و فهرست همهٔ ردیف‌هایی که ساخته است (برای حذف بی‌ردپا)", sql: demo },
  { id: "0099_demo_touch", title: "داده‌های نمایشی: ثبت تغییرهای کار نمایشی در ردیف‌های واقعی (تا حذف فقط همان‌ها را برگرداند) و نفرستادن کار نمایشی از برنامهٔ ویندوز", sql: demoTouch },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;
