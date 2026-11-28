import type { ProPrices } from "@/lib/catalog-types";
import type { CartLine } from "@/lib/order-meta";
import { cleanPack } from "@/lib/packs";
import type { InvoiceLine } from "@/lib/pricing";

/**
 * Basket lines → what the invoice counts (client-safe). One place turns the browser's lines into pieces and
 * per-piece prices, and the product page's price (PriceSlot), the basket (cart-view.tsx) and the order action
 * (src/app/actions/orders.ts) all use it — so the quantity step, the totals the member sees and the total the
 * server checks are always computed alike. A line of packs (src/lib/packs.ts) holds `qty` packs of `pack` pieces:
 * everything here counts its pieces.
 */

type Counted = Pick<CartLine, "qty"> & { pack?: number };

/** The pieces of one basket line (packs × pieces per pack): what the quantity steps, stock and celin_place_order count. */
export function linePieces(l: Counted): number {
  return l.qty * cleanPack(l.pack ?? 1);
}

/** Every piece in the basket, whichever design, option or pack. */
export function basketPieces(lines: readonly Counted[]): number {
  return lines.reduce((n, l) => n + linePieces(l), 0);
}

/**
 * The admin's price of one piece of a line (an option's own price, else the product's): null = on request;
 * undefined = the piece or its option is no longer in the price book (the line is gone).
 */
export function piecePrice(prices: ProPrices, l: Pick<CartLine, "productId" | "variantId">): number | null | undefined {
  const p = prices[l.productId];
  if (!p) return undefined;
  if (!l.variantId) return p.price;
  const v = p.variants[l.variantId];
  return v ? (v.price ?? p.price) : undefined;
}

/**
 * The lines of the invoice (src/lib/pricing.ts invoice): pieces at the admin's price of one piece — a pack costs its
 * pieces, rounded per piece like every other line; lines that are gone are left out.
 */
export function invoiceLines(lines: readonly (Counted & Pick<CartLine, "productId" | "variantId">)[], prices: ProPrices): InvoiceLine[] {
  return lines.flatMap((l) => {
    const price = piecePrice(prices, l);
    return price === undefined ? [] : [{ price, qty: linePieces(l) }];
  });
}
