import Link from "next/link";
import { accountCopy } from "@/content/copy/account";
import { getCatalog } from "@/lib/catalog";
import { formatDate, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { requireMember } from "@/lib/member";
import { listMessages, unreadCount } from "@/lib/messages";
import { isOpen } from "@/lib/order-meta";
import { listOrders } from "@/lib/orders";
import { latestRequest, proStatus } from "@/lib/pro";
import { AccountMenuList } from "@/components/account/account-nav";
import { Membership, type MembershipSnapshot } from "@/components/account/membership";
import { OrderRow } from "@/components/account/order-row";
import { AccountHeader, SectionTitle, btn } from "@/components/account/ui";
import { WishlistPeek } from "@/components/account/wishlist-view";

/** /account «پیشخوان»: greeting, Pro state, orders in progress, latest messages, a few saved pieces. */
export async function DashboardPage({ lang }: { lang: Lang }) {
  const me = await requireMember(lang, "/account");
  const c = accountCopy(lang).dashboard;
  const [pro, request, orders, messages, unread, catalog] = await Promise.all([proStatus(me.id), latestRequest(me.id), listOrders(me.id), listMessages(me.id, 3), unreadCount(me.id), getCatalog()]);
  const open = orders.filter((o) => isOpen(o.status));
  const snapshot: MembershipSnapshot = {
    active: pro.active,
    issued: pro.issued,
    expiresAt: pro.expiresAt,
    since: pro.since,
    request: request?.status ?? "none",
    reply: request?.status === "rejected" ? request.reply : "",
    requestedAt: request?.created_at ?? null,
  };
  const name = me.name.trim();
  const peek = catalog.products.map((p) => ({ slug: p.slug, name_fa: p.name_fa, name_en: p.name_en, image: p.images[0] ?? null }));
  const more = (to: string, label: string) => (
    <Link href={href(lang, to)} className={btn.text}>
      {label}
    </Link>
  );

  return (
    <>
      <AccountHeader lang={lang} title={name ? c.hello(name) : c.helloPlain} back={null} />
      <div className="mb-14 lg:hidden">
        <AccountMenuList lang={lang} initial={{ name: me.name, pro: pro.active, unread }} />
      </div>

      <div className="space-y-14">
        <section aria-labelledby="dash-pro">
          <SectionTitle id="dash-pro">{c.proTitle}</SectionTitle>
          <Membership lang={lang} variant="compact" initial={snapshot} />
        </section>

        <section aria-labelledby="dash-orders">
          <SectionTitle id="dash-orders" action={orders.length > 0 && more("/account/orders", c.allOrders)}>{c.openOrders}</SectionTitle>
          {open.length ? (
            <ul className="border-t border-line">
              {open.slice(0, 4).map((o) => (
                <OrderRow key={o.id} order={o} lang={lang} />
              ))}
            </ul>
          ) : (
            <p className="border-y border-line py-6 text-sm text-muted">{c.noOpenOrders}</p>
          )}
        </section>

        <div className="grid gap-14 xl:grid-cols-2 xl:gap-12">
          <section aria-labelledby="dash-messages">
            <SectionTitle id="dash-messages" action={messages.length > 0 && more("/account/messages", c.allMessages)}>{c.lastMessages}</SectionTitle>
            {messages.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {messages.map((m) => (
                  <li key={m.id}>
                    <Link href={href(lang, "/account/messages")} className="flex items-start gap-3 py-4 hover:bg-bone/40">
                      <span className={`mt-2.5 size-1.5 shrink-0 rounded-full ${m.read_at ? "bg-transparent" : "bg-gold"}`} aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{t(m, "title", lang)}</span>
                        <span className="mt-0.5 block text-xs text-muted">{formatDate(m.created_at, lang)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-y border-line py-6 text-sm text-muted">{c.noMessages}</p>
            )}
          </section>

          <section aria-labelledby="dash-wish">
            <SectionTitle id="dash-wish" action={more("/account/wishlist", c.allWishlist)}>{c.wishlist}</SectionTitle>
            <WishlistPeek lang={lang} products={peek} />
          </section>
        </div>
      </div>
    </>
  );
}
