import Link from "next/link";
import { accountCopy } from "@/content/copy/account";
import { formatPrice, num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { requireMember } from "@/lib/member";
import { isOpen } from "@/lib/order-meta";
import { listOrders } from "@/lib/orders";
import { OrderRow } from "@/components/account/order-row";
import { AccountHeader, Empty, SectionTitle, btn } from "@/components/account/ui";

/** /account/orders: orders in progress first, then the previous ones, with the total of all purchases. */
export async function OrdersPage({ lang }: { lang: Lang }) {
  const me = await requireMember(lang, "/account/orders");
  const c = accountCopy(lang).orders;
  const orders = await listOrders(me.id);
  const open = orders.filter((o) => isOpen(o.status));
  const past = orders.filter((o) => !isOpen(o.status));
  const spent = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);

  return (
    <>
      <AccountHeader lang={lang} title={c.title} />
      {orders.length === 0 ? (
        <Empty
          action={
            <Link href={href(lang, "/shop")} className={btn.outline}>
              {c.emptyCta}
            </Link>
          }
        >
          {c.empty}
        </Empty>
      ) : (
        <>
          <dl className="mb-12 grid grid-cols-2 gap-px border border-line bg-line sm:max-w-lg">
            <div className="bg-ground px-4 py-4 sm:px-5">
              <dt className="text-xs text-muted">{c.countLabel}</dt>
              <dd className="mt-1 text-md text-ink tabular-nums">{c.count(num(orders.length, lang))}</dd>
            </div>
            <div className="bg-ground px-4 py-4 sm:px-5">
              <dt className="text-xs text-muted">{c.spent}</dt>
              <dd className="mt-1 text-md text-ink tabular-nums">{formatPrice(spent, lang)}</dd>
            </div>
          </dl>
          <div className="space-y-14">
            {open.length > 0 && (
              <section aria-labelledby="orders-open">
                <SectionTitle id="orders-open">{c.open}</SectionTitle>
                <ul className="border-t border-line">
                  {open.map((o) => (
                    <OrderRow key={o.id} order={o} lang={lang} />
                  ))}
                </ul>
              </section>
            )}
            {past.length > 0 && (
              <section aria-labelledby="orders-past">
                <SectionTitle id="orders-past">{c.past}</SectionTitle>
                <ul className="border-t border-line">
                  {past.map((o) => (
                    <OrderRow key={o.id} order={o} lang={lang} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
