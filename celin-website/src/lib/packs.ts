import { commonCopy } from "@/content/copy/common";
import { num, type Lang } from "@/lib/format";
import { MAX_QTY } from "@/lib/order-meta";

/**
 * How a piece is sold (client-safe; celin_products.packs, round six). 1 = single («تک»); 2–5 = a pack of that many
 * pieces of the model (and of the chosen option) in as many different sizes, one of each, at that many times the
 * price of one piece. The admin picks any non-empty set per product (default: single only). These are public terms,
 * not prices or stock, so they may sit in the public catalogue and static HTML.
 *
 * Counting: a basket line holds `qty` packs of `pack` pieces; everything that counts — the quantity steps, stock,
 * the invoice and celin_place_order's p_items — counts pieces (packs × pack, src/lib/basket.ts linePieces). Order
 * lines keep pieces in `qty` and the pack in `pack` (packs = qty / pack).
 */

export const PACKS = [1, 2, 3, 4, 5] as const;
export const MAX_PACK = 5;

/** A pack the database accepts (1–5), else 1 (lines from before round six have none: single). */
export function cleanPack(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PACK ? n : 1;
}

/** The packs of a list as the admin may store them: unique whole numbers 1–5, ascending (possibly empty). */
export function cleanPacks(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const x of v) {
    const n = Number(x);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_PACK) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** How a product is sold, never empty: what it stored, or single only (before round six, or nothing valid). */
export function packsOf(v: unknown): number[] {
  const p = cleanPacks(v);
  return p.length ? p : [1];
}

/** Sold only one piece at a time — the way every product was sold before round six (nothing to choose or show). */
export const singleOnly = (packs: readonly number[] | undefined): boolean => !packs || !packs.length || (packs.length === 1 && packs[0] === 1);

/** The most packs one basket line may hold: a line stays at MAX_QTY pieces or fewer (19 five-size packs). */
export const packCap = (pack: number): number => Math.max(1, Math.floor(MAX_QTY / cleanPack(pack)));

/** How many packs of `pack` pieces fit into `pieces` (stock or room left), within one line's cap; 0 when not one. */
export function maxPacks(pack: number, pieces: number): number {
  const n = cleanPack(pack);
  return Math.max(0, Math.floor(Math.min(MAX_QTY, Math.max(0, pieces)) / n));
}

/** How a product is sold, in a few words: «فقط بسته‌ی ۴ سایزی», «تک یا بسته‌ی ۳ سایزی» / "4-size pack only", "Single or 3-size pack". */
export function packTerms(packs: readonly number[], lang: Lang): string {
  const c = commonCopy(lang).pack;
  const list = packsOf(packs);
  const name = (n: number) => (n === 1 ? c.single : c.name(num(n, lang)));
  const out = list.length === 1 ? c.only(name(list[0])) : c.list(list.slice(0, -1).map(name).join(lang === "fa" ? "، " : ", "), name(list[list.length - 1]));
  return out.charAt(0).toLocaleUpperCase(lang) + out.slice(1);
}
