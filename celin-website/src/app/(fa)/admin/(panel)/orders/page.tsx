import { requireAdminPage } from "@/lib/admin-auth";
import { adminCounts, adminOrders } from "@/lib/admin-data";
import { isOrderStatus, ORDER_STATUSES } from "@/lib/order-meta";
import { num } from "@/lib/format";
import { DbMissing, Empty, LinkButton, PageHeader, Tabs } from "@/components/admin/ui";
import { OrdersList } from "@/components/admin/orders-list";
import { SearchBox, STATUS_SHORT } from "@/components/admin/sales-ui";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && isOrderStatus(sp.status) ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const [orders, counts] = await Promise.all([adminOrders({ status: status || undefined, q }), adminCounts()]);

  const href = (s: string) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (q) p.set("q", q);
    const qs = p.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  };
  const total = Object.values(counts.orders).reduce((a, b) => a + (b ?? 0), 0);
  const tabs = [{ key: "", label: "همه", href: href(""), count: total }, ...ORDER_STATUSES.map((s) => ({ key: s, label: STATUS_SHORT[s], href: href(s), count: counts.orders[s] ?? 0 }))];

  return (
    <>
      <PageHeader title="سفارش‌ها" sub={orders ? `${num(total, "fa")} سفارش` : undefined} />
      {orders === null ? (
        <DbMissing />
      ) : (
        <>
          <Tabs items={tabs} active={status} />
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <SearchBox action="/admin/orders" q={q} placeholder="کد سفارش، نام، موبایل یا کسب‌وکار" keep={{ status }} />
            {q && (
              <p className="text-xs text-muted">
                {num(orders.length, "fa")} نتیجه برای «<span className="ltr">{q}</span>»
              </p>
            )}
          </div>
          {orders.length ? (
            <OrdersList orders={orders} />
          ) : q ? (
            <Empty title="سفارشی پیدا نشد" action={<LinkButton href={status ? `/admin/orders?status=${status}` : "/admin/orders"}>پاک کردن جستجو</LinkButton>}>
              کد سفارش را کامل بنویسید (مثلاً <span className="ltr font-mono text-xs">CL-123456</span>) یا بخشی از نام، شماره‌ی موبایل یا نام کسب‌وکار را.
            </Empty>
          ) : (
            <Empty title={status ? `سفارشی در «${STATUS_SHORT[status]}» نیست` : "هنوز سفارشی ثبت نشده است"}>
              {status ? "سفارش‌های این مرحله این‌جا نمایش داده می‌شوند." : "سفارش‌های اعضای Pro پس از ثبت، این‌جا نمایش داده می‌شوند."}
            </Empty>
          )}
        </>
      )}
    </>
  );
}
