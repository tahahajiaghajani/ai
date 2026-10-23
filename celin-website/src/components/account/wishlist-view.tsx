"use client";

import Link from "next/link";
import { accountCopy } from "@/content/copy/account";
import type { Product } from "@/lib/catalog-types";
import type { Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import type { Media } from "@/lib/media";
import { Picture } from "@/components/ui/picture";
import { useHydrated } from "@/components/pro/session";
import { ProductCard } from "@/components/shop/product-card";
import { useWishlist } from "@/components/shop/wishlist";
import { Empty, btn } from "@/components/account/ui";

export interface PeekProduct {
  slug: string;
  name_fa: string;
  name_en: string;
  image: Media | null;
}

function pick<T extends { slug: string }>(slugs: string[], products: T[]): T[] {
  const by = new Map(products.map((p) => [p.slug, p]));
  return slugs.map((s) => by.get(s)).filter((p): p is T => Boolean(p));
}

/** «علاقه‌مندی‌ها»: the pieces saved in this browser, as product cards. */
export function WishlistGrid({ lang, products, collections }: { lang: Lang; products: Product[]; collections: Record<string, string> }) {
  const c = accountCopy(lang).wishlist;
  const hydrated = useHydrated();
  const items = pick(useWishlist(), products);
  if (!hydrated) return <div className="min-h-64" aria-busy />;
  if (!items.length) {
    return (
      <Empty
        action={
          <Link href={href(lang, "/shop")} className={btn.outline}>
            {c.emptyCta}
          </Link>
        }
      >
        {c.empty}
      </Empty>
    );
  }
  return (
    <>
      <ul className="grid grid-cols-2 gap-px border-y border-line bg-line xl:grid-cols-3">
        {items.map((p) => (
          <li key={p.id}>
            <ProductCard product={p} lang={lang} collectionName={p.collection ? collections[p.collection] : undefined} sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, 50vw" />
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs text-muted">{c.note}</p>
    </>
  );
}

/** A few saved pieces on the account home. */
export function WishlistPeek({ lang, products }: { lang: Lang; products: PeekProduct[] }) {
  const c = accountCopy(lang).dashboard;
  const hydrated = useHydrated();
  const items = pick(useWishlist(), products).slice(0, 4);
  if (!hydrated) return <div className="min-h-24" aria-busy />;
  if (!items.length) return <p className="text-sm leading-7 text-muted">{c.noWishlist}</p>;
  return (
    <ul className="grid grid-cols-4 gap-2 sm:gap-3">
      {items.map((p) => (
        <li key={p.slug}>
          <Link href={href(lang, `/product/${p.slug}`)} className="group block">
            <Picture media={p.image} lang={lang} ratio="4/5" sizes="(min-width: 1024px) 160px, 25vw" alt={t(p, "name", lang)} imgClassName="transition-transform duration-700 ease-[var(--ease-lux)] group-hover:scale-[1.02]" />
            <span className="mt-2 line-clamp-2 block text-xs leading-5 text-ink-2">{t(p, "name", lang)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
