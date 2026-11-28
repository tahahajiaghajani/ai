import Link from "next/link";
import { notFound } from "next/navigation";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import { getCatalog } from "@/lib/catalog";
import { formatDate, formatPct, formatPhone, formatPrice, num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { requireMember, storeContact } from "@/lib/member";
import { orderDiscounts, type CartLine } from "@/lib/order-meta";
import { packsOf } from "@/lib/packs";
import { getOrder } from "@/lib/orders";
import { Picture } from "@/components/ui/picture";
import { StoreContact } from "@/components/account/contact";
import { CopyButton, OrderActions } from "@/components/account/order-actions";
import { itemMedia } from "@/components/account/order-row";
import { OrderStepper } from "@/components/account/order-stepper";
import { AccountHeader, SectionTitle, StatusChip } from "@/components/account/ui";

type SP = Record<string, string | string[] | undefined>;

/** The order code from the URL (CL-123456), tolerant of case and stray encoding. */
export function orderCodeParam(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    // keep it as it came
  }
  return s.trim().toUpperCase().slice(0, 20);
}

/** /account/orders/[code]: status, lines, totals, delivery details and what the member can do next. */
export async function OrderPage({ lang, params, searchParams }: { lang: Lang; params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code: raw }, sp] = await Promise.all([params, searchParams]);
  const code = orderCodeParam(raw);
  const me = await requireMember(lang, /^CL-\d{6}$/.test(code) ? `/account/orders/${code}` : "/account/orders");
  const order = await getOrder(code, me.id);
  if (!order) notFound();
  const c = accountCopy(lang).order;
  const [catalog, contact] = await Promise.all([getCatalog(), storeContact()]);

  // «سفارش مجدد»: only lines whose piece (and option) still exist and are still sold that way (single or that pack)
  const products = new Map(catalog.products.map((p) => [p.id, p]));
  const again: CartLine[] = order.items.flatMap((i) => {
    const p = i.product_id ? products.get(i.product_id) : undefined;
    if (!p) return [];
    if (i.variant_id ? !p.variants.some((v) => v.id === i.variant_id) : p.variants.length > 0) return [];
    if (!packsOf(p.packs).includes(i.pack)) return [];
    return [{ productId: p.id, variantId: i.variant_id, qty: Math.max(1, Math.floor(i.qty / i.pack)), pack: i.pack }];
  });
  const placed = sp.placed === "1";
  // what the order was placed with (its own stored rules, never today's settings)
  const d = orderDiscounts(order);
  const discounted = d.step > 0 || d.sale !== null;
  const cu = order.customer;
  // carrier and tracking code: inside the last step on phones, a row under the stepper on wider screens
  const shipping = (cls: string) =>
    order.status === "shipped" && (order.carrier || order.tracking_code) ? (
      <div className={`flex-wrap items-center gap-x-6 gap-y-1 text-xs text-ink-2 ${cls}`}>
        {order.carrier && (
          <p>
            {c.carrier}: <span className="text-ink">{order.carrier}</span>
          </p>
        )}
        {order.tracking_code && (
          <p className="flex flex-wrap items-center gap-x-2">
            {c.tracking}: <span className="font-label text-sm tracking-[0.04em] break-all text-ink ltr">{order.tracking_code}</span>
            <CopyButton text={order.tracking_code} lang={lang} />
          </p>
        )}
      </div>
    ) : null;

  return (
    <>
      <AccountHeader
        lang={lang}
        back="/account/orders"
        backLabel={c.back}
        backAlways
        title={
          <>
            {lang === "fa" ? "سفارش " : "Order "}
            <span className="ltr">{order.code}</span>
          </>
        }
      >
        <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            {c.placedOn} {formatDate(order.created_at, lang)}
          </span>
          <StatusChip status={order.status} lang={lang} />
        </p>
      </AccountHeader>

      {placed && order.status === "pending" && (
        <div role="status" className="mb-10 border border-gold/40 bg-gold-mist px-5 py-4 text-sm leading-7 text-ink">
          <p className="text-gold-text">{c.placedTitle}</p>
          <p className="text-ink-2">{c.placed}</p>
        </div>
      )}

      <div className="space-y-14">
        <section aria-labelledby="order-status">
          <h2 id="order-status" className="sr-only">
            {c.status}
          </h2>
          {order.status === "cancelled" ? (
            <div className="border border-line bg-bone px-5 py-5 sm:px-6">
              <p className="text-md text-ink">{c.cancelledTitle}</p>
              {order.cancel_reason && (
                <p className="mt-2 text-sm leading-7 text-ink-2">
                  {c.cancelledReason}: {order.cancel_reason}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">{formatDate(order.status_changed_at, lang, true)}</p>
            </div>
          ) : (
            <div className="border-y border-line py-8 md:py-10">
              <OrderStepper order={order} lang={lang} extra={{ shipped: shipping("mt-2 flex md:hidden") }} />
              {shipping("mt-8 hidden border-t border-line pt-5 md:flex")}
            </div>
          )}
        </section>

        <section aria-labelledby="order-items">
          <SectionTitle id="order-items">{c.items}</SectionTitle>
          <table className="w-full text-sm">
            <thead className="hidden border-b border-line text-xs text-muted sm:table-header-group">
              <tr>
                <th scope="col" className="py-3 text-start font-normal">
                  {c.product}
                </th>
                <th scope="col" className="w-40 py-3 text-start font-normal">
                  {c.unit}
                </th>
                <th scope="col" className="w-16 py-3 text-center font-normal">
                  {c.qty}
                </th>
                <th scope="col" className="w-40 py-3 text-end font-normal">
                  {c.lineTotal}
                </th>
              </tr>
            </thead>
            <tbody className="border-t border-line sm:border-t-0">
              {order.items.map((i) => {
                const name = t(i, "name", lang);
                const option = t(i, "variant", lang);
                // a line of packs: «۳ بسته‌ی ۴ سایزی · ۱۲ عدد» (the quantity column counts pieces)
                const packText = i.pack > 1 ? commonCopy(lang).pack.line(num(i.qty / i.pack, lang), num(i.pack, lang), num(i.qty, lang)) : "";
                // the original price (struck through) over what each piece was charged at the order's quantity step
                const list = i.list_price ?? i.unit_price;
                const stepped = list > i.unit_price;
                const p = commonCopy(lang).price;
                const was = (v: number) =>
                  stepped && (
                    <span className="block text-faint line-through decoration-gold/70">
                      <span className="sr-only">{p.was} </span>
                      {formatPrice(v, lang)}
                    </span>
                  );
                return (
                  <tr key={i.id} className="grid grid-cols-[4rem_minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-line py-5 sm:table-row sm:py-0">
                    <td className="row-span-2 sm:py-5">
                      <div className="flex items-start gap-4">
                        <Picture media={itemMedia(i.image)} lang={lang} ratio="4/5" sizes="80px" alt={name} className="w-16 shrink-0 sm:w-20" />
                        <div className="hidden min-w-0 sm:block">
                          <ItemText name={name} option={option} packs={packText} sku={i.sku} slug={i.slug} lang={lang} />
                        </div>
                      </div>
                    </td>
                    <td className="col-span-2 sm:hidden">
                      <ItemText name={name} option={option} packs={packText} sku={i.sku} slug={i.slug} lang={lang} />
                    </td>
                    <td className="self-end text-xs text-muted tabular-nums sm:table-cell sm:py-5 sm:align-top sm:text-sm sm:text-ink-2">
                      <span className="sm:hidden">
                        {num(i.qty, lang)} × {stepped && <span className="text-faint line-through decoration-gold/70">{formatPrice(list, lang)}</span>} {formatPrice(i.unit_price, lang)}
                      </span>
                      <span className="hidden sm:inline">
                        {was(list)}
                        {formatPrice(i.unit_price, lang)}
                      </span>
                    </td>
                    <td className="hidden py-5 text-center align-top tabular-nums sm:table-cell">{num(i.qty, lang)}</td>
                    <td className="self-end text-end text-ink tabular-nums sm:table-cell sm:py-5 sm:align-top">
                      {was(list * i.qty)}
                      {formatPrice(i.line_total, lang)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <dl className="ms-auto mt-6 max-w-sm space-y-2.5 text-sm">
            {/* list → «تخفیف تعداد» (every piece of the order together) → the special-day discount → after discounts */}
            {discounted && <Row label={c.subtotal} value={formatPrice(d.list, lang)} />}
            {d.step > 0 && <Row label={c.stepDiscount(num(d.pieces, lang), d.stepOff ? formatPct(d.stepOff, lang) : "")} value={`− ${formatPrice(d.step, lang)}`} tone="success" />}
            {d.sale && <Row label={c.saleDiscount((lang === "en" ? d.sale.en || d.sale.fa : d.sale.fa).trim(), formatPct(d.sale.pct, lang))} value={`− ${formatPrice(d.sale.amount, lang)}`} tone="success" />}
            <Row label={!discounted ? c.subtotal : d.sale ? c.afterDiscounts : c.afterStep} value={formatPrice(order.subtotal, lang)} />
            <Row label={c.shipping} value={order.shipping_fee > 0 ? formatPrice(order.shipping_fee, lang) : c.shippingNone} />
            {order.discount > 0 && <Row label={c.discount} value={`− ${formatPrice(order.discount, lang)}`} />}
            <div className="flex items-baseline justify-between gap-6 border-t border-line pt-3.5">
              <dt className="text-ink">{c.total}</dt>
              <dd className="text-md text-ink tabular-nums">{formatPrice(order.total, lang)}</dd>
            </div>
          </dl>
        </section>

        <div className="grid gap-12 border-t border-line pt-10 md:grid-cols-2">
          <section aria-labelledby="order-delivery">
            <h2 id="order-delivery" className="label mb-4">
              {c.delivery}
            </h2>
            <address className="space-y-1 text-sm leading-7 not-italic text-ink-2">
              <p className="text-ink">{cu.name}</p>
              {cu.phone && (
                <p>
                  <span className="ltr tabular-nums">{formatPhone(cu.phone, lang)}</span>
                </p>
              )}
              {cu.business && <p>{cu.business}</p>}
              <p>{[cu.city, cu.address].filter(Boolean).join("، ")}</p>
              {cu.postal_code && (
                <p>
                  {accountCopy(lang).fields.postal}: <span className="tabular-nums">{num(cu.postal_code, lang)}</span>
                </p>
              )}
            </address>
            {order.note && (
              <>
                <h3 className="label mt-8 mb-3">{c.yourNote}</h3>
                <p className="whitespace-pre-line text-sm leading-7 text-ink-2">{order.note}</p>
              </>
            )}
          </section>
          <section aria-labelledby="order-help" className="space-y-8">
            <div>
              <h2 id="order-help" className="label mb-3">
                {accountCopy(lang).contact.question}
              </h2>
              <p className="text-sm leading-7 text-ink-2">{accountCopy(lang).contact.reach}</p>
              <StoreContact contact={contact} lang={lang} className="mt-2" />
            </div>
            <OrderActions lang={lang} code={order.code} cancellable={order.status === "pending"} lines={again} />
          </section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className={tone === "success" ? "text-success" : "text-muted"}>{label}</dt>
      <dd className={`shrink-0 tabular-nums ${tone === "success" ? "text-success" : "text-ink-2"}`}>{value}</dd>
    </div>
  );
}

function ItemText({ name, option, packs, sku, slug, lang }: { name: string; option: string; packs: string; sku: string; slug: string; lang: Lang }) {
  return (
    <>
      {slug ? (
        <Link href={href(lang, `/product/${slug}`)} className="relative text-sm leading-6 text-ink after:absolute after:inset-x-0 after:-inset-y-3.5 hover:text-gold-text">
          {name}
        </Link>
      ) : (
        <p className="text-sm leading-6 text-ink">{name}</p>
      )}
      {option && <p className="text-xs leading-5 text-ink-2">{option}</p>}
      {packs && <p className="text-xs leading-5 text-ink-2 tabular-nums">{packs}</p>}
      {sku && (
        <p className="mt-0.5 font-label text-[11px] tracking-[0.06em] text-muted">
          <span className="ltr">{sku}</span>
        </p>
      )}
    </>
  );
}
