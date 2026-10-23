import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { adminCounts, adminOrders, healthReport, type HealthItem } from "@/lib/admin-data";
import { listRequests } from "@/lib/members";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, formatNumber, formatPhone, num } from "@/lib/format";
import { Card, DbMissing, LinkButton, PageHeader, Stat } from "@/components/admin/ui";
import { OrdersList } from "@/components/admin/orders-list";
import { ProCodeProvider } from "@/components/admin/pro-code-dialog";
import { ApproveRequestButton } from "@/components/admin/pro-actions";
import { Icon } from "@/components/ui/icons";

interface Step {
  key: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  state: "warn" | "error";
}

/** The setup steps still open (shown on the dashboard until everything is in place). */
function setupSteps(items: HealthItem[], contactEmpty: boolean): Step[] {
  const out: Step[] = [];
  const find = (k: string) => items.find((i) => i.key === k && i.state !== "ok");
  const db = find("db");
  if (db) out.push({ key: "db", title: "اتصال پایگاه داده", detail: db.detail, href: "/admin/connections", action: "اتصالات", state: "error" });
  const storage = find("storage");
  if (storage) out.push({ key: "storage", title: "فضای تصاویر", detail: storage.detail, href: "/admin/connections", action: "اتصالات", state: storage.state === "error" ? "error" : "warn" });
  const admin = find("admin");
  if (admin) out.push({ key: "admin", title: "کلید امنیتی", detail: admin.detail, href: "/admin/connections", action: "اتصالات", state: admin.state === "error" ? "error" : "warn" });
  const catalog = find("catalog");
  if (catalog) out.push({ key: "catalog", title: "کاتالوگ محصولات", detail: "محصولات نمونه را وارد کنید یا اولین محصول را بسازید.", href: "/admin/products", action: "محصولات", state: "warn" });
  if (contactEmpty) out.push({ key: "contact", title: "اطلاعات تماس", detail: "تلفن، واتس‌اپ و نشانی فروشگاه هنوز وارد نشده است.", href: "/admin/settings#contact", action: "تنظیمات", state: "warn" });
  const notify = find("notify");
  if (notify)
    out.push({
      key: "notify",
      title: "اعلان سفارش به تلگرام یا بله",
      detail: "تا سفارش و درخواست تازه را فوراً روی گوشی ببینید (اختیاری).",
      href: "/admin/settings#notify",
      action: "تنظیمات",
      state: "warn",
    });
  return out;
}

function Toman({ n }: { n: number }) {
  return (
    <>
      {formatNumber(n, "fa")} <span className="text-sm font-normal text-muted">تومان</span>
    </>
  );
}

export default async function AdminHome() {
  await requireAdminPage();
  const ready = Boolean(db());
  const [counts, orders, requests, health, settings] = await Promise.all([
    adminCounts(),
    ready ? adminOrders({ limit: 6 }) : Promise.resolve(null),
    ready ? listRequests() : Promise.resolve(null),
    healthReport(),
    getSettings(),
  ]);
  const c = settings.contact;
  const steps = setupSteps(health.items, !c.phone && !c.whatsapp && !c.address_fa);
  const pending = (requests ?? []).filter((r) => r.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const preparing = (counts.orders.packing ?? 0) + (counts.orders.ready ?? 0);

  return (
    <ProCodeProvider siteUrl={env.siteUrl}>
      <PageHeader title="پیشخوان" sub={formatDate(new Date().toISOString(), "fa")} />

      {steps.length > 0 && (
        <section className="mb-6 border border-gold/40 bg-white">
          <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <Icon name="sparkle" className="size-4 text-gold" />
            <h2 className="text-sm font-medium">راه‌اندازی</h2>
            <span className="text-xs text-muted">{num(steps.length, "fa")} کار مانده</span>
          </header>
          <ul className="divide-y divide-line">
            {steps.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className="flex min-h-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-ground">
                  <span className={`size-2 shrink-0 rounded-full ${s.state === "error" ? "bg-danger" : "bg-warning"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="block text-xs leading-6 text-muted">{s.detail}</span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-ink-2 sm:inline">{s.action}</span>
                  <Icon name="chevron" className="size-4 shrink-0 rotate-180 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!ready ? (
        <DbMissing />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="فروش ۳۰ روز اخیر" value={<Toman n={counts.sales_month} />} hint="بدون سفارش‌های لغوشده" href="/admin/orders" />
            <Stat label="فروش کل" value={<Toman n={counts.sales_total} />} hint="بدون سفارش‌های لغوشده" href="/admin/orders" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
            <Stat label="در انتظار تأیید" value={num(counts.orders.pending ?? 0, "fa")} hint="سفارش" tone={counts.orders.pending ? "gold" : "neutral"} href="/admin/orders?status=pending" />
            <Stat
              label="در حال آماده‌سازی"
              value={num(preparing, "fa")}
              hint="بسته‌بندی و آماده‌ی ارسال"
              href={counts.orders.packing || !counts.orders.ready ? "/admin/orders?status=packing" : "/admin/orders?status=ready"}
            />
            <Stat label="درخواست‌های Pro" value={num(counts.requests_pending, "fa")} hint="در انتظار بررسی" tone={counts.requests_pending ? "gold" : "neutral"} href="/admin/pro" />
            <Stat label="اعضای فعال Pro" value={num(counts.pro_active, "fa")} hint={`از ${num(counts.users, "fa")} حساب`} href="/admin/users?f=pro" />
            <Stat label="محصولات رو به اتمام" value={num(counts.low_stock, "fa")} hint="موجودی ۲ یا کمتر" tone={counts.low_stock ? "danger" : "neutral"} href="/admin/products" />
          </div>

          <div className="space-y-6">
            <Card
              title="آخرین سفارش‌ها"
              actions={
                <LinkButton href="/admin/orders" size="sm" variant="ghost">
                  همه‌ی سفارش‌ها
                </LinkButton>
              }
              padded={!orders?.length}
            >
              {orders?.length ? <OrdersList orders={orders} variant="compact" bare /> : <p className="text-sm text-muted">هنوز سفارشی ثبت نشده است.</p>}
            </Card>

            <Card
              title="درخواست‌های Pro"
              actions={
                pending.length ? (
                  <LinkButton href="/admin/pro" size="sm" variant="ghost">
                    همه
                  </LinkButton>
                ) : undefined
              }
              padded={!pending.length}
            >
              {pending.length ? (
                <ul className="divide-y divide-line">
                  {pending.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <Link href={`/admin/users/${r.user_id}`} className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.user?.name || "—"}</span>
                        <span className="block truncate text-xs text-muted">
                          {r.business || r.user?.business || <span className="ltr">{formatPhone(r.user?.phone ?? "", "fa")}</span>}
                          {(r.city || r.user?.city) && ` · ${r.city || r.user?.city}`}
                        </span>
                        <span className="block text-[11px] text-faint">{formatDate(r.created_at, "fa", true)}</span>
                      </Link>
                      <ApproveRequestButton id={r.id} userId={r.user_id} name={r.user?.name ?? ""} phone={r.user?.phone ?? ""} defaultDays={settings.pro.defaultDays} label="تأیید" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">درخواست تازه‌ای نیست.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </ProCodeProvider>
  );
}
