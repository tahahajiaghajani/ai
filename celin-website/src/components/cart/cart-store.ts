"use client";

import { useSyncExternalStore } from "react";
import { basketPieces } from "@/lib/basket";
import { MAX_LINES, type CartLine } from "@/lib/order-meta";
import { cleanPack, packCap } from "@/lib/packs";

/**
 * The order basket of a member, kept in this browser (localStorage) and synced across tabs. It holds
 * only ids, quantities and packs; names and pictures come from the catalogue, prices from the members' price layer,
 * and the server reads every price again when the order is placed. A line is one product, option and pack (a
 * single and a 4-size pack of the same option are two lines); `qty` counts packs (src/lib/packs.ts). Lines saved
 * before round six have no pack and read as single, so the key stays.
 */

const KEY = "celin-cart-v1";
const EMPTY: CartLine[] = [];
let lines: CartLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function read(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return EMPTY;
    // one line per product, option and pack (a hand-edited or older entry merges into its twin)
    const out = new Map<string, CartLine>();
    for (const l of raw.filter((l): l is CartLine => Boolean(l) && typeof l.productId === "string" && (l.variantId === null || typeof l.variantId === "string") && Number.isFinite(l.qty))) {
      const pack = cleanPack(l.pack ?? 1);
      const k = `${l.productId}:${l.variantId ?? ""}:${pack}`;
      const qty = Math.max(1, Math.min(packCap(pack), Math.floor(l.qty) + (out.get(k)?.qty ?? 0)));
      out.set(k, { productId: l.productId, variantId: l.variantId, qty, pack });
    }
    return [...out.values()].slice(0, MAX_LINES);
  } catch {
    return EMPTY;
  }
}

function ensure() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  lines = read();
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    lines = read();
    listeners.forEach((l) => l());
  });
}

function write(next: CartLine[]) {
  lines = next.slice(0, MAX_LINES);
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // private mode / storage full: the basket still works for this page view
  }
  listeners.forEach((l) => l());
}

const same = (a: CartLine, productId: string, variantId: string | null, pack: number) => a.productId === productId && a.variantId === variantId && a.pack === cleanPack(pack);

const OWNER = "celin-cart-owner";

export const cart = {
  /**
   * Ties the basket to the signed-in account (an opaque key from /api/me): another account signing in on
   * this browser starts with an empty basket instead of the previous member's selection.
   */
  bindOwner(key: string) {
    ensure();
    try {
      const prev = localStorage.getItem(OWNER);
      if (prev === key) return;
      localStorage.setItem(OWNER, key);
      if (prev && lines.length) write([]);
    } catch {
      // storage blocked: nothing is kept between page views anyway
    }
  },
  /** `qty` packs of `pack` pieces (1 = single) */
  add(productId: string, variantId: string | null, qty = 1, pack = 1) {
    ensure();
    const p = cleanPack(pack);
    const cur = lines.find((l) => same(l, productId, variantId, p));
    write(cur ? lines.map((l) => (l === cur ? { ...l, qty: Math.min(packCap(p), l.qty + qty) } : l)) : [...lines, { productId, variantId, qty: Math.min(packCap(p), Math.max(1, qty)), pack: p }]);
  },
  setQty(productId: string, variantId: string | null, qty: number, pack = 1) {
    ensure();
    if (qty < 1) return cart.remove(productId, variantId, pack);
    write(lines.map((l) => (same(l, productId, variantId, pack) ? { ...l, qty: Math.min(packCap(l.pack), Math.floor(qty)) } : l)));
  },
  remove(productId: string, variantId: string | null, pack = 1) {
    ensure();
    write(lines.filter((l) => !same(l, productId, variantId, pack)));
  },
  clear() {
    ensure();
    write([]);
  },
};

function subscribe(cb: () => void) {
  ensure();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The basket lines (empty during server render and before hydration). */
export function useCart(): CartLine[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      ensure();
      return lines;
    },
    () => EMPTY,
  );
}

/** Every piece in the basket (src/lib/basket.ts; a pack counts its pieces): what the quantity step counts. */
export function useCartCount(): number {
  return basketPieces(useCart());
}
