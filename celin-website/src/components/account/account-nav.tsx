"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/actions/account";
import { accountCopy } from "@/content/copy/account";
import { num, type Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { Icon, type IconName } from "@/components/ui/icons";
import { sessionChanged, useMe } from "@/components/pro/session";
import { useCartCount } from "@/components/cart/cart-store";
import { ProChip } from "@/components/account/ui";

export interface NavInitial {
  name: string;
  pro: boolean;
  unread: number;
}

type Key = "dashboard" | "cart" | "orders" | "pro" | "messages" | "wishlist" | "profile";
const ITEMS: { key: Key; path: string; icon: IconName }[] = [
  { key: "dashboard", path: "/account", icon: "dashboard" },
  { key: "cart", path: "/account/cart", icon: "bag" },
  { key: "orders", path: "/account/orders", icon: "box" },
  { key: "pro", path: "/account/pro", icon: "diamond" },
  { key: "messages", path: "/account/messages", icon: "mail" },
  { key: "wishlist", path: "/account/wishlist", icon: "heart" },
  { key: "profile", path: "/account/profile", icon: "user" },
];

function useNav(lang: Lang, initial: NavInitial) {
  const me = useMe();
  const cart = useCartCount();
  const path = usePathname();
  const name = me?.name ?? initial.name;
  const pro = me ? me.pro.active : initial.pro;
  const unread = me ? me.unread : initial.unread;
  const counts: Partial<Record<Key, { n: number; label: string }>> = {
    ...(cart > 0 ? { cart: { n: cart, label: accountCopy(lang).nav.inCart(num(cart, lang)) } } : {}),
    ...(unread > 0 ? { messages: { n: unread, label: accountCopy(lang).nav.unread(num(unread, lang)) } } : {}),
  };
  const isActive = (p: string) => {
    const full = href(lang, p);
    return path === full || (p !== "/account" && path.startsWith(`${full}/`));
  };
  return { name, pro, counts, isActive };
}

function Count({ n, label, lang }: { n: number; label: string; lang: Lang }) {
  return (
    <>
      <span aria-hidden className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1.5 text-[11px] leading-none text-bone tabular-nums">
        {num(n > 99 ? 99 : n, lang)}
      </span>
      <span className="sr-only">({label})</span>
    </>
  );
}

function SignOutButton({ lang, className, children }: { lang: Lang; className: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await signOut();
        } finally {
          await sessionChanged();
          router.replace(href(lang, "/"));
          router.refresh();
        }
      }}
      className={`${className} disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

/** Desktop sidebar: the member, a Pro chip when active, the sections with counts, «خروج». */
export function AccountSidebar({ lang, initial }: { lang: Lang; initial: NavInitial }) {
  const c = accountCopy(lang).nav;
  const { name, pro, counts, isActive } = useNav(lang, initial);
  return (
    <div>
      <p className="display text-2xl leading-snug break-words">{name}</p>
      {pro && <ProChip lang={lang} className="mt-3" />}
      <nav aria-label={c.label} className="mt-8 border-t border-line">
        <ul>
          {ITEMS.map((it) => {
            const on = isActive(it.path);
            const count = counts[it.key];
            return (
              <li key={it.key}>
                <Link
                  href={href(lang, it.path)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex h-12 items-center gap-3 border-b border-line ps-4 pe-1 text-sm transition-colors ${on ? "text-ink before:absolute before:inset-y-3 before:start-0 before:w-px before:bg-gold" : "text-ink-2 hover:text-ink"}`}
                >
                  <Icon name={it.icon} className={`size-[18px] shrink-0 ${on ? "text-gold" : "text-muted"}`} />
                  {c[it.key]}
                  {count && <Count n={count.n} label={count.label} lang={lang} />}
                </Link>
              </li>
            );
          })}
        </ul>
        <SignOutButton lang={lang} className="flex h-12 w-full items-center gap-3 ps-4 text-sm text-muted hover:text-ink">
          <Icon name="logout" className="size-[18px] shrink-0 rtl:-scale-x-100" />
          {c.signOut}
        </SignOutButton>
      </nav>
    </div>
  );
}

/** Phones: the account home is this list (56px rows with chevrons). */
export function AccountMenuList({ lang, initial }: { lang: Lang; initial: NavInitial }) {
  const c = accountCopy(lang).nav;
  const { counts } = useNav(lang, initial);
  return (
    <nav aria-label={c.label}>
      <ul className="divide-y divide-line border-y border-line">
        {ITEMS.filter((it) => it.key !== "dashboard").map((it) => {
          const count = counts[it.key];
          return (
            <li key={it.key}>
              <Link href={href(lang, it.path)} className="flex h-14 items-center gap-3.5 text-md text-ink">
                <Icon name={it.icon} className="size-5 shrink-0 text-muted" />
                {c[it.key]}
                {count ? <Count n={count.n} label={count.label} lang={lang} /> : <span className="ms-auto" />}
                <Icon name="chevron" className="size-4 shrink-0 text-faint rtl:-scale-x-100" />
              </Link>
            </li>
          );
        })}
        <li>
          <SignOutButton lang={lang} className="flex h-14 w-full items-center gap-3.5 text-md text-muted">
            <Icon name="logout" className="size-5 shrink-0 rtl:-scale-x-100" />
            {c.signOut}
          </SignOutButton>
        </li>
      </ul>
    </nav>
  );
}
