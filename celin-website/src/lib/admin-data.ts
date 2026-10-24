import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { adminSetup, assertAdmin } from "@/lib/admin-auth";
import { adminPhones } from "@/lib/admin-phones";
import { USERS } from "@/lib/auth";
import { db, isMissingTable, missingDbVars } from "@/lib/db";
import { emailConfig } from "@/lib/email";
import { env } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { ORDER_COLUMNS, withPreview, type OrderSummary } from "@/lib/orders";
import { getSettingsFresh } from "@/lib/settings";
import { isOrderStatus, type Order, type OrderStatus } from "@/lib/order-meta";

export interface AdminCounts {
  orders: Partial<Record<OrderStatus, number>>;
  requests_pending: number;
  users: number;
  pro_active: number;
  products: Partial<Record<"draft" | "published" | "archived", number>>;
  low_stock: number;
  sales_total: number;
  sales_month: number;
}

const EMPTY: AdminCounts = { orders: {}, requests_pending: 0, users: 0, pro_active: 0, products: {}, low_stock: 0, sales_total: 0, sales_month: 0 };

/** Dashboard numbers and menu badges in one round trip; zeros when the database is not ready. */
export async function adminCounts(): Promise<AdminCounts> {
  await assertAdmin();
  const c = db();
  if (!c) return EMPTY;
  const { data, error } = await c.rpc("celin_admin_counts");
  if (error) {
    if (!isMissingTable(error) && error.code !== "PGRST202") console.error("[admin] counts", error.message);
    return EMPTY;
  }
  const d = (data ?? {}) as AdminCounts;
  return { ...EMPTY, ...d, sales_total: Number(d.sales_total ?? 0), sales_month: Number(d.sales_month ?? 0) };
}

export async function adminOrders(filter: { status?: string; q?: string; limit?: number } = {}): Promise<OrderSummary[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  let q = c.from("celin_orders").select(ORDER_COLUMNS).order("created_at", { ascending: false }).limit(filter.limit ?? 300);
  if (filter.status && isOrderStatus(filter.status)) q = q.eq("status", filter.status);
  const term = (filter.q ?? "").trim();
  if (term) {
    const safe = term.replace(/[%,()*\\]/g, " ").slice(0, 60);
    q = /^CL-?\d+$/i.test(safe) ? q.ilike("code", `%${safe.replace(/^cl-?/i, "")}%`) : q.or(`customer->>name.ilike.%${safe}%,customer->>phone.ilike.%${safe}%,customer->>business.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  return withPreview(((data ?? []) as Order[]).map((o) => ({ ...o, subtotal: Number(o.subtotal), total: Number(o.total), shipping_fee: Number(o.shipping_fee), discount: Number(o.discount) })));
}

// ---------------------------------------------------------------- connections & health

export type Health = "ok" | "warn" | "error";

export interface HealthItem {
  key: string;
  title: string;
  state: Health;
  detail: string;
}

const TABLES = [
  "celin_settings",
  "celin_media",
  "celin_slots",
  "celin_videos",
  "celin_categories",
  "celin_collections",
  "celin_products",
  "celin_variants",
  "celin_users",
  "celin_pro_requests",
  "celin_pro_codes",
  "celin_messages",
  "celin_orders",
  "celin_order_items",
  "celin_order_events",
  "celin_rate_limits",
];

/** The SQL files of the project, in order (Admin → Connections offers them for copy/paste). */
export function migrationFiles(): { name: string; sql: string }[] {
  try {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
  } catch {
    return [];
  }
}

export async function healthReport(): Promise<{ items: HealthItem[]; missingTables: string[]; supabaseProject: string }> {
  await assertAdmin();
  const items: HealthItem[] = [];
  const c = db();
  const missing: string[] = [];
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.supabaseUrl)?.[1] ?? "";
  if (!c) {
    const vars = missingDbVars();
    items.push({
      key: "db",
      title: "پایگاه داده (Supabase)",
      state: "error",
      detail: `${vars.join(" و ")} در Vercel تنظیم نشده است؛ تا آن زمان ثبت‌نام، ورود اعضا، اشتراک Pro و سفارش خاموش است (بازدیدکننده پیام «به‌زودی فعال می‌شود» می‌بیند). مقدارها را از Supabase ← Project Settings ← API Keys بردارید، در Vercel ← Settings ← Environment Variables بگذارید و دوباره Deploy کنید.`,
    });
  } else {
    const results = await Promise.all(TABLES.map(async (t) => ({ t, r: await c.from(t).select("*", { count: "exact", head: true }) })));
    for (const { t, r } of results) if (r.error && isMissingTable(r.error)) missing.push(t);
    const broken = results.find(({ r }) => r.error && !isMissingTable(r.error));
    const [{ error: fnError }, { error: versionError }] = await Promise.all([c.rpc("celin_admin_counts"), c.rpc("celin_schema_version")]);
    if (broken) items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "error", detail: `خطا در خواندن: ${broken.r.error!.message}` });
    else if (missing.length || fnError) items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "error", detail: missing.length ? `${missing.length} جدول ساخته نشده است؛ SQL را در Supabase اجرا کنید.` : "تابع‌های پایگاه داده ساخته نشده‌اند؛ SQL را دوباره اجرا کنید." })
    else if (versionError) items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "error", detail: "فایل تازه‌ی SQL (20261024090000_celin_hardening.sql: قواعد وضعیت سفارش و امنیت کدهای Pro) اجرا نشده است؛ SQL زیر را در Supabase اجرا کنید." });
    else items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "ok", detail: "همه‌ی جدول‌ها و تابع‌ها آماده‌اند." });

    const { data: buckets, error: be } = await c.storage.listBuckets();
    const bucket = (buckets ?? []).find((b) => b.id === env.bucket);
    items.push(
      be
        ? { key: "storage", title: "فضای تصاویر (Storage)", state: "error", detail: be.message }
        : !bucket
          ? { key: "storage", title: "فضای تصاویر (Storage)", state: "error", detail: `فضای «${env.bucket}» (bucket) ساخته نشده است؛ SQL را اجرا کنید.` }
          : !bucket.public
            ? { key: "storage", title: "فضای تصاویر (Storage)", state: "warn", detail: `فضای «${env.bucket}» (bucket) عمومی نیست؛ در Storage آن را Public کنید.` }
            : { key: "storage", title: "فضای تصاویر (Storage)", state: "ok", detail: `فضای «${env.bucket}» آماده‌ی بارگذاری است.` },
    );
  }

  const setup = adminSetup();
  const admins = c ? await c.from(USERS).select("name, phone, role").or(`role.eq.admin${adminPhones().length ? `,phone.in.(${adminPhones().join(",")})` : ""}`).limit(20) : null;
  const adminList = ((admins?.data ?? []) as { name: string; phone: string }[]).map((a) => `${a.name || "—"} (${a.phone})`).join("، ");
  const phonesNote = setup.phones ? `ADMIN_PHONES: ${adminPhones().join("، ")}` : "ADMIN_PHONES تنظیم نشده است (شماره‌ی موبایل خودتان را بگذارید تا حسابتان با ثبت‌نام یا ورود مدیر شود)";
  const secretNote = process.env.APP_SECRET ? "" : " APP_SECRET جداگانه تنظیم نشده (از کلید Supabase استفاده می‌شود)؛ بهتر است یک رشته‌ی تصادفی ۳۲ نویسه‌ای بگذارید.";
  items.push({
    key: "admin",
    title: "ورود مدیر",
    state: !setup.phones && !adminList ? "error" : process.env.APP_SECRET && setup.phones ? "ok" : "warn",
    detail: `${phonesNote}.${adminList ? ` حساب‌های مدیر: ${adminList}.` : ""}${setup.password ? " ADMIN_PASSWORD (ورود اضطراری) تنظیم شده است." : ""}${secretNote}`,
  });

  const s = c ? await getSettingsFresh().catch(() => null) : null;
  if (s) {
    items.push(
      s.catalog.initialized
        ? { key: "catalog", title: "کاتالوگ محصولات", state: "ok", detail: "محصولات از پایگاه داده خوانده می‌شوند." }
        : { key: "catalog", title: "کاتالوگ محصولات", state: "warn", detail: "هنوز محصولات نمونه نمایش داده می‌شوند؛ در «محصولات» آن‌ها را وارد کنید یا محصول تازه بسازید." },
    );
    const notifyOk = s.notify.channel !== "none" && s.notify.chatId && decrypt(s.notify.botTokenEnc);
    items.push({ key: "notify", title: "اعلان به مدیر (تلگرام/بله)", state: notifyOk ? "ok" : "warn", detail: notifyOk ? `از طریق ${s.notify.channel === "bale" ? "بله" : "تلگرام"}` : "تنظیم نشده (اختیاری): سفارش و درخواست تازه فقط در پنل دیده می‌شود." });
    const smsOk = s.sms.provider !== "none" && decrypt(s.sms.apiKeyEnc);
    items.push({ key: "sms", title: "پیامک به اعضا", state: smsOk ? "ok" : "warn", detail: smsOk ? (s.sms.provider === "kavenegar" ? "کاوه‌نگار" : "SMS.ir") : "تنظیم نشده (اختیاری): کد Pro در پیام‌های حساب کاربر و با دکمه‌های اشتراک‌گذاری به او می‌رسد." });
    const mail = await emailConfig();
    items.push({ key: "email", title: "ایمیل (Resend)", state: mail ? "ok" : "warn", detail: mail ? `فرستنده: ${mail.from}` : "تنظیم نشده (اختیاری)." });
  }
  const explicitUrl = Boolean(process.env.NEXT_PUBLIC_SITE_URL);
  items.push({ key: "url", title: "نشانی سایت", state: explicitUrl ? "ok" : "warn", detail: explicitUrl ? env.siteUrl : `${env.siteUrl} — بهتر است NEXT_PUBLIC_SITE_URL را روی دامنه‌ی اصلی بگذارید.` });
  return { items, missingTables: missing, supabaseProject: ref };
}
