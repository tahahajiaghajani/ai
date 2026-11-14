"use client";

import { useEffect, useRef, useState } from "react";
import { commonCopy } from "@/content/copy/common";
import { fromPrice, stockOf, type ProPrice } from "@/lib/catalog-types";
import { formatPrice, num, type Lang } from "@/lib/format";
import { atPct, listPrice, pctFor } from "@/lib/pricing";
import { usePriceBook, type PriceBook } from "@/components/pro/session";
import { useCartCount } from "@/components/cart/cart-store";

/**
 * The price slot of a product. Everyone sees words in the price's own style («قیمت برای اعضا»); members see the
 * price of one piece at their level (src/lib/pricing.ts); Pro accounts also a stock band (members see no stock). A member whose order would reach a
 * quantity step — the pieces already in the basket plus `qty` (the pieces being chosen on the product page; one
 * on a card) — sees the original price (twice the admin's) struck through and the price at that quantity under
 * it; a Pro account always sees the admin's price alone. The box keeps its height while loading (no layout
 * shift), and the loading state is a still bone bar — never the locked words, so members don't see them flash.
 */

export function stockBand(p: { stock: number }, book: Pick<PriceBook, "stockDisplay" | "lowStock">, lang: Lang): { text: string; tone: "in" | "low" | "out" } {
  const c = commonCopy(lang).stock;
  if (p.stock <= 0) return { text: c.out, tone: "out" };
  if (book.stockDisplay === "exact") return { text: c.count(num(p.stock, lang)), tone: p.stock <= book.lowStock ? "low" : "in" };
  if (p.stock <= book.lowStock) return { text: c.low(num(p.stock, lang)), tone: "low" };
  return { text: c.in, tone: "in" };
}

const DOT = { in: "bg-success", low: "bg-warning", out: "bg-faint" };

export function useProPrice(productId: string): { book: PriceBook | null | undefined; price: ProPrice | undefined } {
  const book = usePriceBook();
  return { book, price: book?.prices[productId] };
}

export function PriceSlot({
  productId,
  variantId,
  lang,
  size = "card",
  showStock = true,
  qty = 1,
  className = "",
}: {
  productId: string;
  variantId?: string | null;
  lang: Lang;
  size?: "card" | "pdp";
  showStock?: boolean;
  /** pieces about to be added (the product page's quantity); the basket's pieces count too */
  qty?: number;
  className?: string;
}) {
  const { book, price } = useProPrice(productId);
  const inBasket = useCartCount();
  const c = commonCopy(lang);
  const [hint, setHint] = useState<boolean | null>(null);
  const wasLoading = useRef(true);
  useEffect(() => setHint(document.cookie.split("; ").includes("celin_pro_ui=1")), []);

  const box = size === "pdp" ? "min-h-8 text-lg" : "min-h-5 text-sm";
  // loading: before hydration, or while a member's prices are on their way
  if (hint === null || (book === undefined && hint)) {
    // without the app (no JS, or the boot failsafe) nothing ever loads: the locked words instead of an endless bar
    return (
      <div className={`${box} ${className}`}>
        <span aria-hidden className="inline-block h-[0.9em] w-3/5 max-w-40 translate-y-[0.2em] bg-bone [html:not(.js)_&]:hidden" />
        <span className="text-muted [html.js_&]:hidden">{c.price.locked}</span>
      </div>
    );
  }
  if (!book || !price) {
    return <div className={`${box} text-muted ${className}`}>{c.price.locked}</div>;
  }
  const v = variantId ? price.variants[variantId] : undefined;
  const base = v ? v.price ?? price.price : Object.keys(price.variants).length ? fromPrice(price) : price.price;
  const value = base === null ? null : listPrice(base, book.pricing);
  // the quantity step the order would reach with these pieces (members only; Pro has no steps)
  const pieces = inBasket + Math.max(1, Math.floor(qty) || 1);
  const stepped = base === null ? null : atPct(base, pctFor(pieces, book.pricing));
  const discounted = value !== null && stepped !== null && stepped < value;
  const varies = !v && Object.keys(price.variants).length > 0 && new Set(Object.values(price.variants).map((x) => x.price ?? price.price)).size > 1;
  const stock = v ? v.stock : stockOf(price);
  const band = stockBand({ stock }, book, lang);
  const fade = wasLoading.current;
  wasLoading.current = false;
  return (
    <div className={`${box} ${fade ? "animate-fade-in" : ""} ${className}`}>
      {discounted && (
        <span className="block text-[0.82em] leading-snug text-muted line-through decoration-gold/70 tabular-nums">
          <span className="sr-only">{c.price.was} </span>
          {`${varies ? `${c.price.from} ` : ""}${formatPrice(value, lang)}`}
        </span>
      )}
      <span className="text-ink tabular-nums">
        {discounted && <span className="sr-only">{c.price.now} </span>}
        {value === null ? c.price.onRequest : `${varies ? `${c.price.from} ` : ""}${formatPrice(discounted ? stepped : value, lang)}`}
      </span>
      {showStock && book.showStock && (
        <span className={`ms-3 inline-flex items-center gap-1.5 align-middle ${size === "pdp" ? "text-sm" : "text-xs"} text-muted`}>
          <span className={`size-1.5 rounded-full ${DOT[band.tone]}`} aria-hidden />
          {band.text}
        </span>
      )}
      {discounted && size === "pdp" && <span className="mt-1 block font-ui text-xs leading-5 text-muted">{c.price.atPieces(num(pieces, lang))}</span>}
    </div>
  );
}
