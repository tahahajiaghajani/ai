import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { getOrder } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { formatDate, formatNumber, formatPhone, formatPrice, num } from "@/lib/format";
import { ORDER_STEPS, STATUS_LABEL, type OrderDetail, type OrderEvent } from "@/lib/order-meta";
import { Card, LinkButton, PageHeader } from "@/components/admin/ui";
import { OrderEditCard, OrderStatusActions, PrintButton } from "@/components/admin/orders-detail";
import { ACTOR_LABEL, Row, StatusBadge, STATUS_TONE, whatsappUrl } from "@/components/admin/sales-ui";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

const PRINT_CSS = `@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background: white !important; }
  aside, [aria-live] { display: none !important; }
  main { padding: 0 !important; }
}`;

const DOT: Record<string, string> = { warning: "bg-warning", gold: "bg-gold", ink: "bg-ink", success: "bg-success", danger: "bg-danger" };

function lastEvent(events: OrderEvent[], status: string): OrderEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].status === status) return events[i];
  return undefined;
}

/**
 * What happened to the stock when this order was cancelled (celin_set_order_status): the pieces go back only
 * when it was cancelled before shipping, and a line whose option or product was deleted since has nowhere to go.
 */
function restockNote(o: OrderDetail): string {
  const i = o.events.map((e) => e.status).lastIndexOf("cancelled");
  const before = i > 0 ? o.events[i - 1].status : lastEvent(o.events, "shipped") ? "shipped" : "pending";
  if (before === "shipped") return "این سفارش پس از ارسال لغو شد؛ موجودی به انبار برنگشت (اگر کالا به فروشگاه برگشته، موجودی را در صفحه‌ی محصول اصلاح کنید).";
  const lost = o.items.filter((it) => !it.variant_id && (!it.product_id || it.variant_fa));
  if (lost.length === o.items.length) return "کالاها یا گزینه‌های این سفارش از فهرست محصولات حذف شده‌اند؛ موجودی آن‌ها به انبار برنگشت.";
  if (lost.length) return `موجودی کالاهای این سفارش به انبار برگشت، جز ${num(lost.length, "fa")} ردیف که کالا یا گزینه‌ی آن حذف شده است.`;
  return "موجودی کالاهای این سفارش به انبار برگشت.";
}

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  await requireAdminPage();
  const { code: raw } = await params;
  const order = await getOrder(decodeURIComponent(raw).toUpperCase());
  if (!order) notFound();
  const settings = await getSettings();
  const o = order;
  const cancelled = o.status === "cancelled";
  const idx = cancelled ? -1 : ORDER_STEPS.indexOf(o.status as (typeof ORDER_STEPS)[number]);
  const cancelEvent = cancelled ? lastEvent(o.events, "cancelled") : undefined;
  const phone = o.customer.phone;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="print:hidden">
        <PageHeader title={`سفارش ${o.code}`} back={{ href: "/admin/orders", label: "سفارش‌ها" }} sub={<>ثبت {formatDate(o.created_at, "fa", true)}</>} actions={<PrintButton />} />

        {/* status */}
        <section className="mb-6 border border-line bg-white p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={o.status} big />
            <span className="text-xs text-muted">آخرین تغییر: {formatDate(o.status_changed_at, "fa", true)}</span>
          </div>
          <ol className="mb-5 grid gap-0 sm:grid-cols-4 sm:gap-3">
            {ORDER_STEPS.map((s, i) => {
              const ev = lastEvent(o.events, s);
              const done = cancelled ? Boolean(ev) : i <= idx;
              const current = s === o.status;
              return (
                <li
                  key={s}
                  className={`flex gap-3 border-s-2 py-2 ps-3 sm:block sm:border-s-0 sm:border-t-2 sm:ps-0 sm:pt-3 ${done ? (cancelled ? "border-line-strong" : "border-ink") : "border-line"}`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] sm:mb-2 ${done ? (cancelled ? "bg-bone text-muted" : "bg-ink text-bone") : "border border-line-strong text-muted"}`}
                  >
                    {done && (!current || s === "shipped") ? <Icon name="check" className="size-3.5" strokeWidth={2} /> : num(i + 1, "fa")}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm leading-6 ${current ? "font-medium text-ink" : done ? "text-ink-2" : "text-muted"}`}>{STATUS_LABEL[s].fa}</span>
                    <span className="block text-[11px] text-muted">{done && ev ? formatDate(ev.created_at, "fa", true) : "—"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {cancelled && (
            <div className="mb-5 border border-danger/30 bg-danger-soft px-4 py-3 text-sm leading-7 text-danger">
              <div className="font-medium">
                این سفارش لغو شد{cancelEvent ? ` — ${formatDate(cancelEvent.created_at, "fa", true)}` : ""}
                {cancelEvent ? ` (${ACTOR_LABEL[cancelEvent.actor] ?? "سیستم"})` : ""}
              </div>
              {o.cancel_reason && <div>دلیل: {o.cancel_reason}</div>}
              <div className="text-xs">{restockNote(o)}</div>
            </div>
          )}
          <OrderStatusActions code={o.code} status={o.status} carrier={o.carrier} tracking={o.tracking_code} />
        </section>

        {/* phone: customer, items, costs, history; desktop: two columns */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="contents min-w-0 lg:block lg:space-y-6">
            <div className="order-2 lg:order-none">
              <Items order={o} />
            </div>
            <div className="order-3 lg:order-none">
              <OrderEditCard
                key={`${o.shipping_fee}|${o.discount}|${o.carrier}|${o.tracking_code}|${o.admin_note}`}
                code={o.code}
                subtotal={o.subtotal}
                shippingFee={o.shipping_fee}
                discount={o.discount}
                carrier={o.carrier}
                tracking={o.tracking_code}
                adminNote={o.admin_note ?? ""}
                cancelled={o.status === "cancelled"}
              />
            </div>
          </div>
          <div className="contents min-w-0 lg:block lg:space-y-6">
            <div className="order-1 lg:order-none">
              <Card
                title="مشتری"
                actions={
                  o.user_id ? (
                    <LinkButton href={`/admin/users/${o.user_id}`} size="sm" variant="ghost" icon="user">
                      حساب
                    </LinkButton>
                  ) : undefined
                }
              >
                <div className="text-base font-medium">{o.customer.name || "—"}</div>
                {phone && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a href={`tel:${phone}`} className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-3 text-sm hover:border-ink">
                      <Icon name="phone" className="size-4" />
                      <span className="ltr">{formatPhone(phone, "fa")}</span>
                    </a>
                    <a href={whatsappUrl(phone)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-3 text-sm hover:border-ink">
                      <Icon name="whatsapp" className="size-4" />
                      واتس‌اپ
                    </a>
                  </div>
                )}
                <div className="mt-3 divide-y divide-line border-t border-line">
                  {o.customer.business && <Row label="کسب‌وکار">{o.customer.business}</Row>}
                  {o.customer.city && <Row label="شهر">{o.customer.city}</Row>}
                  {o.customer.address && <Row label="نشانی">{o.customer.address}</Row>}
                  {o.customer.postal_code && (
                    <Row label="کد پستی">
                      <span className="ltr">{num(o.customer.postal_code, "fa")}</span>
                    </Row>
                  )}
                  {(o.carrier || o.tracking_code) && (
                    <Row label="ارسال">
                      {o.carrier}
                      {o.tracking_code && (
                        <>
                          {o.carrier ? " · " : ""}
                          <span className="ltr font-mono text-xs">{o.tracking_code}</span>
                        </>
                      )}
                    </Row>
                  )}
                </div>
                {o.note && (
                  <div className="mt-3 border-s-2 border-gold/60 bg-gold-mist/50 px-3 py-2 text-sm leading-7">
                    <div className="text-[11px] text-gold-text">یادداشت مشتری</div>
                    {o.note}
                  </div>
                )}
              </Card>
            </div>

            <div className="order-4 lg:order-none">
              <Card title="تاریخچه">
                <ol className="space-y-4">
                  {[...o.events].reverse().map((e, i) => (
                    <li key={i} className="flex gap-3">
                      <span className={`mt-2 size-2 shrink-0 rounded-full ${DOT[STATUS_TONE[e.status]]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{STATUS_LABEL[e.status].fa}</div>
                        <div className="text-[11px] text-muted">
                          {ACTOR_LABEL[e.actor] ?? "سیستم"} · {formatDate(e.created_at, "fa", true)}
                        </div>
                        {e.note && <p className="mt-1 text-xs leading-6 text-ink-2">{e.note}</p>}
                      </div>
                    </li>
                  ))}
                  {!o.events.length && <li className="text-sm text-muted">رویدادی ثبت نشده است.</li>}
                </ol>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Invoice order={o} phone={settings.contact.phone} address={settings.contact.address_fa} />
    </>
  );
}

function Totals({ order: o }: { order: OrderDetail }) {
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted">جمع کالاها</dt>
        <dd>{formatPrice(o.subtotal, "fa")}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted">هزینه‌ی ارسال</dt>
        <dd>{o.shipping_fee ? formatPrice(o.shipping_fee, "fa") : "—"}</dd>
      </div>
      {o.discount > 0 && (
        <div className="flex justify-between gap-4">
          <dt className="text-muted">تخفیف</dt>
          <dd className="text-success">− {formatPrice(o.discount, "fa")}</dd>
        </div>
      )}
      <div className="flex justify-between gap-4 border-t border-line pt-2 text-base font-medium">
        <dt>مبلغ نهایی</dt>
        <dd>{formatPrice(o.total, "fa")}</dd>
      </div>
    </dl>
  );
}

function Items({ order: o }: { order: OrderDetail }) {
  const cols = "sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,0.9fr)_56px_minmax(0,0.9fr)]";
  return (
    <Card title="اقلام سفارش" sub={`${num(o.items.length, "fa")} ردیف · ${num(o.items_count, "fa")} قطعه`} padded={false}>
      <div className={`hidden gap-4 border-b border-line bg-bone/60 px-5 py-2 text-xs text-muted sm:grid ${cols}`}>
        <span />
        <span>کالا</span>
        <span>فی</span>
        <span>تعداد</span>
        <span className="text-end">مبلغ</span>
      </div>
      <ul className="divide-y divide-line">
        {o.items.map((it) => (
          <li key={it.id} className={`grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 gap-y-1 px-5 py-3.5 sm:items-center ${cols}`}>
            <div className="row-span-2 sm:row-span-1">{it.image ? <Picture media={it.image} alt="" ratio="1/1" sizes="56px" className="w-14" /> : <div className="aspect-square w-14 bg-tile" />}</div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{it.name_fa}</div>
              {it.variant_fa && <div className="text-xs text-ink-2">{it.variant_fa}</div>}
              {it.sku && (
                <div className="mt-0.5 text-[11px] text-muted">
                  <span className="ltr font-mono">{it.sku}</span>
                </div>
              )}
            </div>
            {/* phone: one line under the name */}
            <div className="flex items-center justify-between gap-3 text-xs text-ink-2 sm:hidden">
              <span>
                {num(it.qty, "fa")} × {formatPrice(it.unit_price, "fa")}
              </span>
              <span className="text-sm font-medium text-ink">{formatPrice(it.line_total, "fa")}</span>
            </div>
            <span className="hidden text-sm text-ink-2 sm:block">{formatPrice(it.unit_price, "fa")}</span>
            <span className="hidden text-sm sm:block">{num(it.qty, "fa")}</span>
            <span className="hidden text-end text-sm font-medium sm:block">{formatPrice(it.line_total, "fa")}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-5 py-4 sm:ps-[calc(56px+2.5rem)]">
        <Totals order={o} />
      </div>
    </Card>
  );
}

/** Print-only pro-forma invoice (window.print()). */
function Invoice({ order: o, phone, address }: { order: OrderDetail; phone: string; address: string }) {
  const c = o.customer;
  const cancelled = o.status === "cancelled";
  return (
    <div className="hidden text-ink print:block">
      <header className="flex items-start justify-between border-b border-ink pb-4">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/celin-wordmark.svg" alt="CELIN" className="h-10 w-auto" />
          <div className="mt-2 text-xs text-muted">
            سلین — گالری اعتماد
            {phone && (
              <>
                {" · "}
                <span className="ltr">{num(phone, "fa")}</span>
              </>
            )}
          </div>
          {address && <div className="text-xs text-muted">{address}</div>}
        </div>
        <div className="text-end">
          <div className="text-lg font-medium">پیش‌فاکتور</div>
          {cancelled && <div className="mt-1 inline-block border-2 border-danger px-2 py-0.5 text-sm font-medium text-danger">لغو شده — فاقد اعتبار</div>}
          <div className="text-sm">
            <span className="ltr font-mono">{o.code}</span>
          </div>
          <div className="text-xs text-muted">{formatDate(o.created_at, "fa")}</div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-1 border-b border-line py-4 text-sm">
        <div>
          <span className="text-muted">خریدار: </span>
          {c.name}
          {c.business ? ` — ${c.business}` : ""}
        </div>
        <div>
          <span className="text-muted">تلفن: </span>
          <span className="ltr">{formatPhone(c.phone, "fa")}</span>
        </div>
        <div className="col-span-2">
          <span className="text-muted">نشانی: </span>
          {[c.city, c.address].filter(Boolean).join("، ")}
          {c.postal_code && (
            <>
              {" — کد پستی "}
              <span className="ltr">{num(c.postal_code, "fa")}</span>
            </>
          )}
        </div>
      </section>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink text-xs">
            <th className="py-2 text-start font-medium">ردیف</th>
            <th className="py-2 text-start font-medium">کالا</th>
            <th className="py-2 text-start font-medium">کد کالا</th>
            <th className="py-2 text-start font-medium">فی (تومان)</th>
            <th className="py-2 text-start font-medium">تعداد</th>
            <th className="py-2 text-end font-medium">مبلغ (تومان)</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((it, i) => (
            <tr key={it.id} className="border-b border-line align-top">
              <td className="py-2">{num(i + 1, "fa")}</td>
              <td className="py-2">
                {it.name_fa}
                {it.variant_fa && <span className="text-muted"> — {it.variant_fa}</span>}
              </td>
              <td className="py-2">
                <span className="ltr font-mono text-xs">{it.sku}</span>
              </td>
              <td className="py-2">{formatNumber(it.unit_price, "fa")}</td>
              <td className="py-2">{num(it.qty, "fa")}</td>
              <td className="py-2 text-end">{formatNumber(it.line_total, "fa")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* same face as the table above (tables use the dense numeric font) */}
      <div className="mt-4 ms-auto w-72 font-dense">
        <Totals order={o} />
      </div>

      {o.note && (
        <p className="mt-6 text-sm leading-7">
          <span className="text-muted">یادداشت خریدار: </span>
          {o.note}
        </p>
      )}
      <p className="mt-10 border-t border-line pt-3 text-center text-[11px] text-muted">
        {cancelled ? "این سفارش لغو شده است و این پیش‌فاکتور اعتبار ندارد." : "این پیش‌فاکتور پس از تأیید موجودی توسط فروشگاه معتبر است."}
      </p>
    </div>
  );
}
