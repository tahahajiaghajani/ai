import Link from "next/link";
import { ViewTransition } from "react";
import { commonCopy } from "@/content/copy/common";
import type { Product } from "@/lib/catalog-types";
import { num, type Lang } from "@/lib/format";
import { href, t } from "@/lib/i18n";
import { Picture } from "@/components/ui/picture";
import { PriceSlot } from "@/components/pro/price-slot";
import { Swatch } from "@/components/shop/swatch";
import { WishButton } from "@/components/shop/wish-button";
import { pieceName } from "@/components/shop/piece-name";

/**
 * The product card: a tonal 4:5 tile (the on-model picture fades in on hover, desktop only), the collection
 * as a small label, the name, the price slot and the colour hint. Priced and locked cards share one anatomy.
 * The cover carries the view-transition name that morphs into the product page's hero.
 */
export function ProductCard({
  product: p,
  lang,
  collectionName,
  sizes = "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, 50vw",
  priority = false,
  variant = "tile",
  ground = true,
}: {
  product: Product;
  lang: Lang;
  collectionName?: string;
  sizes?: string;
  priority?: boolean;
  /** "arch": the picture in the brand's round arch (home and editorial rows) */
  variant?: "tile" | "arch";
  /** false: no card ground (the card sits on a band's own mesh ground) */
  ground?: boolean;
}) {
  const c = commonCopy(lang);
  const cover = p.images[0];
  const second = p.images[1];
  const swatches = [...new Set(p.variants.map((v) => v.swatch).filter(Boolean))];
  const name = t(p, "name", lang);
  const arch = variant === "arch";
  const ratio = arch ? "3/4" : "4/5";
  return (
    <article className={`group relative flex h-full flex-col ${arch || !ground ? "" : "bg-ground"}`}>
      <Link href={href(lang, `/product/${p.slug}`)} className="block outline-offset-[-2px]" data-cursor="view">
        <div className={`relative ${arch ? "p-2" : ""}`}>
          {arch && <span aria-hidden className="arch-ring opacity-0 transition-opacity duration-700 [--ring-gap:0px] group-hover:opacity-100" />}
          <div className={`fx-sheen relative overflow-hidden bg-tile ${arch ? "arch" : ""}`}>
            <ViewTransition name={`product-${p.id}`} share="morph" default="none">
              <Picture media={cover} lang={lang} ratio={ratio} sizes={sizes} priority={priority} alt={name} className={arch ? "arch" : ""} imgClassName="transition-transform duration-[1.2s] ease-[var(--ease-out-expo)] group-hover:scale-[1.04]" />
            </ViewTransition>
            {second && (
              <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700 ease-[var(--ease-lux)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100" aria-hidden>
                <Picture media={second} lang={lang} ratio={ratio} sizes={sizes} alt="" className="!absolute inset-0 h-full" />
              </div>
            )}
            {p.badge && (
              <span className={`absolute ${arch ? "bottom-3 left-1/2 -translate-x-1/2" : "top-3 start-3"} glass px-2.5 py-0.5 font-ui text-[11px] text-ink-2`}>{c.badges[p.badge]}</span>
            )}
          </div>
        </div>
      </Link>
      <WishButton slug={p.slug} lang={lang} className={arch ? "absolute top-[18%] end-0" : "absolute top-1 end-1"} />
      <Link href={href(lang, `/product/${p.slug}`)} className={`flex flex-1 flex-col pt-4 pb-5 ${arch ? "items-center px-1 text-center" : "px-3 sm:px-4"}`}>
        {collectionName && <span className="label text-gold-text!">{collectionName}</span>}
        <h3 className="mt-1 text-base leading-7 font-semibold text-ink">{pieceName(name, collectionName)}</h3>
        <PriceSlot productId={p.id} lang={lang} className="mt-1" />
        {swatches.length > 1 && (
          <span className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            {swatches.slice(0, 4).map((s) => (
              <Swatch key={s} swatch={s} />
            ))}
            <span className="ms-1 font-ui">
              {lang === "fa" ? `${num(p.variants.length, lang)} گزینه` : `${p.variants.length} options`}
            </span>
          </span>
        )}
      </Link>
    </article>
  );
}
