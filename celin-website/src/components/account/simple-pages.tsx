import Link from "next/link";
import { accountCopy } from "@/content/copy/account";
import { hasPassword } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { formatDate, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { lightProduct, requireMember, storeContact } from "@/lib/member";
import { listMessages } from "@/lib/messages";
import { latestRequest, proStatus } from "@/lib/pro";
import { MarkMessagesRead } from "@/components/account/mark-read";
import { Membership, type MembershipSnapshot } from "@/components/account/membership";
import { ProCodeEntry } from "@/components/account/pro-code-entry";
import { ProfileForms } from "@/components/account/profile-forms";
import { AccountHeader, Empty, btn } from "@/components/account/ui";
import { WishlistGrid } from "@/components/account/wishlist-view";

/**
 * /account/pro: the membership state (the member's card, the steps of a request, or the code ceremony), and
 * «کد دارید؟» beside the request when no code has been issued yet.
 */
export async function AccountProPage({ lang }: { lang: Lang }) {
  const me = await requireMember(lang, "/account/pro");
  const c = accountCopy(lang);
  const [pro, request, contact] = await Promise.all([proStatus(me.id), latestRequest(me.id), storeContact()]);
  const snapshot: MembershipSnapshot = {
    active: pro.active,
    issued: pro.issued,
    expiresAt: pro.expiresAt,
    since: pro.since,
    request: request?.status ?? "none",
    reply: request?.status === "rejected" ? request.reply : "",
    requestedAt: request?.created_at ?? null,
  };
  const withCode = !pro.active && !pro.issued;
  return (
    <>
      <AccountHeader lang={lang} title={c.nav.pro} />
      <div className={withCode ? "grid items-start gap-14 xl:grid-cols-[minmax(0,1fr)_25rem] xl:gap-12" : "max-w-3xl"}>
        <Membership lang={lang} variant="account" initial={snapshot} contact={contact} />
        {withCode && <ProCodeEntry lang={lang} contact={contact} />}
      </div>
      <p className="mt-12">
        <Link href={href(lang, "/pro")} className={btn.text}>
          {c.proPage.benefitsTitle}
        </Link>
      </p>
    </>
  );
}

/** /account/messages: the store's notes; opening the page marks them read. */
export async function MessagesPage({ lang }: { lang: Lang }) {
  const me = await requireMember(lang, "/account/messages");
  const c = accountCopy(lang).messages;
  const messages = await listMessages(me.id);
  const unread = messages.some((m) => !m.read_at);
  return (
    <>
      <AccountHeader lang={lang} title={c.title} />
      {unread && <MarkMessagesRead />}
      {messages.length === 0 ? (
        <Empty>{c.empty}</Empty>
      ) : (
        <ul className="max-w-3xl border-t border-line">
          {messages.map((m) => {
            const link = typeof m.link === "string" && /^\/(?![/\\])/.test(m.link) ? m.link : "";
            return (
              <li key={m.id} className="border-b border-line py-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h2 className="flex items-center gap-2.5 text-md text-ink">
                    {!m.read_at && (
                      <>
                        <span className="size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
                        <span className="sr-only">{c.new}: </span>
                      </>
                    )}
                    {t(m, "title", lang)}
                  </h2>
                  <time dateTime={m.created_at} className="shrink-0 text-xs text-muted">
                    {formatDate(m.created_at, lang, true)}
                  </time>
                </div>
                {t(m, "body", lang) && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-7 text-ink-2">{t(m, "body", lang)}</p>}
                {link && (
                  <Link href={href(lang, link)} className="mt-4 inline-flex h-11 items-center justify-center border border-ink px-5 text-sm text-ink transition-colors hover:bg-ink hover:text-bone">
                    {c.open}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** /account/wishlist: the pieces saved in this browser. */
export async function WishlistPage({ lang }: { lang: Lang }) {
  await requireMember(lang, "/account/wishlist");
  const c = accountCopy(lang).wishlist;
  const catalog = await getCatalog();
  const collections = Object.fromEntries(catalog.collections.map((k) => [k.slug, t(k, "name", lang)]));
  return (
    <>
      <AccountHeader lang={lang} title={c.title} />
      <WishlistGrid lang={lang} products={catalog.products.map(lightProduct)} collections={collections} />
    </>
  );
}

/** /account/profile: details and address, the password, signing out. */
export async function ProfilePage({ lang }: { lang: Lang }) {
  const me = await requireMember(lang, "/account/profile");
  const c = accountCopy(lang).profile;
  const withPassword = await hasPassword(me.id);
  return (
    <>
      <AccountHeader lang={lang} title={c.title} />
      <ProfileForms
        lang={lang}
        hasPassword={withPassword}
        initial={{ name: me.name, phone: me.phone, email: me.email, business: me.business, city: me.city, address: me.address, postal_code: me.postal_code }}
      />
    </>
  );
}
