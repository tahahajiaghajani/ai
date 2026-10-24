import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { adminSetup, assertAdmin } from "@/lib/admin-auth";
import { adminPhones } from "@/lib/admin-phones";
import { USERS } from "@/lib/auth";
import { allRows, db, isMissingTable, missingDbVars } from "@/lib/db";
import { ipSetup } from "@/lib/request";
import { emailConfig } from "@/lib/email";
import { env } from "@/lib/env";
import { decrypt } from "@/lib/crypto";
import { formatPhone, latinDigits, normalizePhone } from "@/lib/format";
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

/**
 * What an admin typed into the order search, normalised: Persian / Arabic digits become Latin (a phone keyboard
 * types ۰۹۱۲…), an order code «CL-۹۱۷۰۷۴» or «cl 917074» searches the code, and a phone number may be typed with
 * spaces or dashes («0912 345 6789») or as +98…. Characters that would break the filter are removed.
 */
export function orderSearch(raw: string): { code: string } | { text: string; phone: string; digits: string } | null {
  const term = latinDigits(String(raw ?? "")).replace(/[%,()*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!term) return null;
  const code = /^cl[\s-]*(\d+)$/i.exec(term);
  if (code) return { code: code[1] };
  const compact = term.replace(/[\s\-–]/g, "");
  const numeric = /^\+?\d+$/.test(compact);
  const phone = numeric ? normalizePhone(compact) || compact.replace(/^(\+|00)?98(?=9)/, "0") : term;
  // a bare number may also be (part of) an order code
  return { text: term, phone, digits: numeric ? compact.replace(/^\+/, "") : "" };
}

export async function adminOrders(filter: { status?: string; q?: string; limit?: number } = {}): Promise<OrderSummary[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  let q = c.from("celin_orders").select(ORDER_COLUMNS).order("created_at", { ascending: false }).limit(filter.limit ?? 300);
  if (filter.status && isOrderStatus(filter.status)) q = q.eq("status", filter.status);
  const where = orderSearch(filter.q ?? "");
  if (where && !("text" in where)) q = q.ilike("code", `%${where.code}%`);
  else if (where) q = q.or(`customer->>name.ilike.%${where.text}%,customer->>phone.ilike.%${where.phone}%,customer->>business.ilike.%${where.text}%${where.digits ? `,code.ilike.%${where.digits}%` : ""}`);
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

// ---------------------------------------------------------------- which SQL files have run

const INIT = "20261023100000_celin_init.sql";
const SLOT_VIDEO = "20261023180000_celin_slot_video.sql";
const HARDENING = "20261024090000_celin_hardening.sql";
/** From this file on, every SQL file records its own name in celin_migrations. */
const RECORDING_FROM = "20261024120000_celin_admin_fixes.sql";

/**
 * Files that only change stored content are recognised by what they change: while a product spec still holds
 * exactly what such a file rewrites, the file has not run (or ran before the content was imported) and
 * Connections asks for it. Each check matches only what its file changes, so running it always turns it green.
 */
type SpecText = { label_fa?: string; label_en?: string; value_fa?: string; value_en?: string };
const CONTENT_CHECKS: { prefix: string; what: string; spec: (s: SpecText) => boolean }[] = [
  {
    prefix: "20261024100000",
    what: "نام جنس نگین («زیرکونیا») هنوز در مشخصات محصولات هست",
    spec: (s) => /زیرکونیا/.test(s.value_fa ?? "") || /cubic zirconia/i.test(s.value_en ?? ""),
  },
  {
    prefix: "20261024110000",
    what: "جمله‌ی قدیمی «نشانده و پرداخت‌شده با دست» هنوز در مشخصات محصولات هست",
    spec: (s) => s.value_fa === "نشانده و پرداخت‌شده با دست" || s.value_en === "Hand-set and hand-finished",
  },
];

/**
 * The SQL files the database still needs, in order, each with what is missing — from their effects (tables,
 * functions, stored content) and, for newer files, the name they record in celin_migrations. Admin → Connections
 * shows them and copies exactly these files.
 */
export async function pendingMigrations(): Promise<{ file: string; why: string }[]> {
  await assertAdmin();
  const c = db();
  if (!c) return [];
  const files = migrationFiles().map((f) => f.name);
  const out: { file: string; why: string }[] = [];
  const add = (file: string | undefined, why: string) => {
    if (file && !out.some((o) => o.file === file)) out.push({ file, why });
  };
  const results = await Promise.all(TABLES.map(async (t) => ({ t, r: await c.from(t).select("*", { count: "exact", head: true }) })));
  const missing = results.filter(({ r }) => r.error && isMissingTable(r.error)).map(({ t }) => t);
  const [{ error: fnError }, { error: versionError }] = await Promise.all([c.rpc("celin_admin_counts"), c.rpc("celin_schema_version")]);
  if (missing.some((t) => t !== "celin_videos") || fnError) {
    // the first file has not run: everything, in order
    return files.map((file) => ({ file, why: file === INIT ? `${missing.length ? `${missing.length} جدول` : "تابع‌های پایگاه داده"} ساخته نشده است` : "پس از فایل اول" }));
  }
  if (missing.includes("celin_videos")) add(SLOT_VIDEO, "جدول ویدئوهای تصاویر سایت ساخته نشده است");
  if (versionError) add(HARDENING, "قواعد وضعیت سفارش و امنیت کدهای Pro");
  // content files: the product specs still say what they remove
  const checks = CONTENT_CHECKS.map((k) => ({ ...k, file: files.find((f) => f.startsWith(k.prefix)) })).filter((k) => k.file);
  if (checks.length) {
    try {
      const rows = await allRows<{ specs: unknown }>((a, b) => c.from("celin_products").select("specs").range(a, b));
      const specs = rows.flatMap((r) => (Array.isArray(r.specs) ? (r.specs as SpecText[]) : []));
      for (const k of checks) if (specs.some((sp) => sp && typeof sp === "object" && k.spec(sp))) add(k.file, k.what);
    } catch (e) {
      console.error("[admin] content check", e);
    }
  }
  // newer files record their name
  const { data, error } = await c.from("celin_migrations").select("name");
  const recorded = new Set(error ? [] : ((data ?? []) as { name: string }[]).map((r) => `${r.name}.sql`));
  for (const f of files) if (f >= RECORDING_FROM && !recorded.has(f)) add(f, f === RECORDING_FROM ? "پیام‌های کد Pro و تصاویر سفارش‌ها" : "فایل تازه");
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export async function healthReport(): Promise<{ items: HealthItem[]; missingTables: string[]; pending: { file: string; why: string }[]; supabaseProject: string }> {
  await assertAdmin();
  const items: HealthItem[] = [];
  const c = db();
  const missing: string[] = [];
  let pending: { file: string; why: string }[] = [];
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
    pending = broken ? [] : await pendingMigrations();
    if (broken) items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "error", detail: `خطا در خواندن: ${broken.r.error!.message}` });
    else if (missing.length && pending.some((p) => p.file === INIT)) items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "error", detail: `${missing.length} جدول ساخته نشده است؛ SQL را در Supabase اجرا کنید.` });
    else if (pending.length)
      items.push({
        key: "db",
        title: "پایگاه داده (Supabase)",
        state: "error",
        detail: `SQL تازه را اجرا کنید: ${pending.map((p) => `${p.file} (${p.why})`).join("، ")}.`,
      });
    else items.push({ key: "db", title: "پایگاه داده (Supabase)", state: "ok", detail: "همه‌ی جدول‌ها، تابع‌ها و فایل‌های SQL اجرا شده‌اند." });

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
  const admins = c ? await c.from(USERS).select("name, phone").eq("role", "admin").limit(20) : null;
  const adminList = ((admins?.data ?? []) as { name: string; phone: string }[]).map((a) => `${a.name || "—"} (\u200e${formatPhone(a.phone, "fa")}\u200e)`).join("، ");
  const passwordNote = setup.password
    ? "ADMIN_PASSWORD تنظیم شده است (فعال کردن پنل روی یک حساب، و ورود اضطراری)."
    : "ADMIN_PASSWORD تنظیم نشده است: هیچ حسابی را نمی‌توان با رمز مدیریت مدیر کرد.";
  const phonesNote = setup.phones ? ` فقط این شماره‌ها می‌توانند مدیر شوند (ADMIN_PHONES): ${adminPhones().map((p) => `\u200e${formatPhone(p, "fa")}\u200e`).join("، ")}.` : "";
  const secretNote = process.env.APP_SECRET ? "" : " APP_SECRET جداگانه تنظیم نشده (از کلید Supabase استفاده می‌شود)؛ بهتر است یک رشته‌ی تصادفی ۳۲ نویسه‌ای بگذارید.";
  items.push({
    key: "admin",
    title: "ورود مدیر",
    state: !setup.password && !adminList ? "error" : process.env.APP_SECRET && setup.password ? "ok" : "warn",
    detail: `${adminList ? `حساب‌های مدیر: ${adminList}. ` : ""}${passwordNote}${phonesNote}${secretNote}`,
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
  const ip = ipSetup();
  items.push(
    ip.mode === "header"
      ? { key: "ip", title: "IP بازدیدکننده (محدودیت تلاش‌ها)", state: "ok", detail: `از سرآیند «${ip.header}» خوانده می‌شود${ip.secret ? "، فقط برای درخواست‌هایی که رمز پراکسی (TRUSTED_PROXY_SECRET) را دارند" : "؛ سایت باید فقط از راه همان پراکسی در دسترس باشد (یا TRUSTED_PROXY_SECRET را هم بگذارید)"}.` }
      : ip.mode === "vercel"
        ? ip.ignored
          ? { key: "ip", title: "IP بازدیدکننده (محدودیت تلاش‌ها)", state: "warn", detail: `TRUSTED_IP_HEADER روی Vercel بدون TRUSTED_PROXY_SECRET نادیده گرفته می‌شود (هر کسی می‌تواند آن را مستقیم به نشانی ‎vercel.app بفرستد)؛ IP از سرآیند خود Vercel خوانده می‌شود. راهنما: docs/SETUP_FA.md بخش ۷.` }
          : { key: "ip", title: "IP بازدیدکننده (محدودیت تلاش‌ها)", state: "ok", detail: "از سرآیند خود Vercel خوانده می‌شود. اگر CDN داخلی (مثل ابرآروان) جلوی سایت گذاشته‌اید، TRUSTED_IP_HEADER و TRUSTED_PROXY_SECRET را هم بگذارید (راهنما بخش ۷)." }
        : { key: "ip", title: "IP بازدیدکننده (محدودیت تلاش‌ها)", state: "warn", detail: "TRUSTED_IP_HEADER تنظیم نشده است: روی سرور خودتان نمی‌توان به IP اعلام‌شده اعتماد کرد، پس محدودیت تلاش‌های ورود، ثبت‌نام و کد Pro میان همه‌ی بازدیدکننده‌ها مشترک است. نام سرآیندی را که پراکسی IP واقعی را در آن می‌گذارد تنظیم کنید (راهنما بخش ۷)." },
  );
  return { items, missingTables: missing, pending, supabaseProject: ref };
}
