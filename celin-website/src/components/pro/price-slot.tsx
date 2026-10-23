"use client";

import { useEffect, useRef, useState } from "react";
import { commonCopy } from "@/content/copy/common";
import { fromPrice, stockOf, type ProPrice } from "@/lib/catalog-types";
import { formatPrice, num, type Lang } from "@/lib/format";
import { usePriceBook, type PriceBook } from "@/components/pro/session";

/**
 * The price slot of a product. Everyone sees words in the price's own style («قیمت ویژه‌ی اعضای Pro»);
 * Pro members see the price and a stock band. The box keeps its height in every state (no layout shift),
 * and the loading state is a still bone bar — never the locked words, so members don't see them flash.
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
  className = "",
}: {
  productId: string;
  variantId?: string | null;
  lang: Lang;
  size?: "card" | "pdp";
  showStock?: boolean;
  className?: string;
}) {
  const { book, price } = useProPrice(productId);
  const c = commonCopy(lang);
  const [hint, setHint] = useState<boolean | null>(null);
  const wasLoading = useRef(true);
  useEffect(() => setHint(document.cookie.split("; ").includes("celin_pro_ui=1")), []);

  const box = size === "pdp" ? "min-h-8 text-lg" : "min-h-5 text-sm";
  // loading: before hydration, or while a Pro member's prices are on their way
  if (hint === null || (book === undefined && hint)) {
    return (
      <div className={`${box} ${className}`} aria-hidden>
        <span className={`inline-block h-[0.9em] w-3/5 max-w-40 translate-y-[0.2em] bg-bone`} />
      </div>
    );
  }
  if (!book || !price) {
    return <div className={`${box} text-muted ${className}`}>{c.price.locked}</div>;
  }
  const v = variantId ? price.variants[variantId] : undefined;
  const value = v ? v.price ?? price.price : Object.keys(price.variants).length ? fromPrice(price) : price.price;
  const varies = !v && Object.keys(price.variants).length > 0 && new Set(Object.values(price.variants).map((x) => x.price ?? price.price)).size > 1;
  const stock = v ? v.stock : stockOf(price);
  const band = stockBand({ stock }, book, lang);
  const fade = wasLoading.current;
  wasLoading.current = false;
  return (
    <div className={`${box} ${fade ? "animate-fade-in" : ""} ${className}`}>
      <span className="text-ink tabular-nums">{value === null ? c.price.onRequest : `${varies ? `${c.price.from} ` : ""}${formatPrice(value, lang)}`}</span>
      {showStock && (
        <span className={`ms-3 inline-flex items-center gap-1.5 align-middle ${size === "pdp" ? "text-sm" : "text-xs"} text-muted`}>
          <span className={`size-1.5 rounded-full ${DOT[band.tone]}`} aria-hidden />
          {band.text}
        </span>
      )}
    </div>
  );
}
