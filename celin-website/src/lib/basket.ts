import type { ProPrices } from "@/lib/catalog-types";
import type { CartLine } from "@/lib/order-meta";
import type { InvoiceLine } from "@/lib/pricing";

/**
 * Basket lines → what the invoice counts (client-safe). One place turns the browser's lines into pieces and
 * per-piece prices, and the product page's price (PriceSlot), the basket (cart-view.tsx) and the order action
 * (src/app/actions/orders.ts) all use it — so the quantity step, the totals the member sees and the total the
 * server checks are always computed alike. A line that counts more than one piece per unit (a pack of sizes)
 * only has to change `linePieces`.
 */

/** The pieces of one basket line: what the quantity steps, stock and celin_place_order count. */
export function linePieces(l: Pick<CartLine, "qty">): number {
  return l.qty;
}

/** Every piece in the basket, whichever design or option. */
export function basketPieces(lines: readonly Pick<CartLine, "qty">[]): number {
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

/** The lines of the invoice (src/lib/pricing.ts invoice): pieces at the admin's price of one piece; lines that are gone are left out. */
export function invoiceLines(lines: readonly CartLine[], prices: ProPrices): InvoiceLine[] {
  return lines.flatMap((l) => {
    const price = piecePrice(prices, l);
    return price === undefined ? [] : [{ price, qty: linePieces(l) }];
  });
}
