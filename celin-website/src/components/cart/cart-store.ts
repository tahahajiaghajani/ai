"use client";

import { useSyncExternalStore } from "react";
import { MAX_LINES, MAX_QTY, type CartLine } from "@/lib/order-meta";

/**
 * The order basket of a Pro member, kept in this browser (localStorage) and synced across tabs. It holds
 * only ids and quantities; names and pictures come from the catalogue, prices from the Pro price layer,
 * and the server reads every price again when the order is placed.
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
    return raw
      .filter((l): l is CartLine => Boolean(l) && typeof l.productId === "string" && (l.variantId === null || typeof l.variantId === "string") && Number.isFinite(l.qty))
      .map((l) => ({ productId: l.productId, variantId: l.variantId, qty: Math.max(1, Math.min(MAX_QTY, Math.floor(l.qty))) }))
      .slice(0, MAX_LINES);
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

const same = (a: CartLine, productId: string, variantId: string | null) => a.productId === productId && a.variantId === variantId;

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
  add(productId: string, variantId: string | null, qty = 1) {
    ensure();
    const cur = lines.find((l) => same(l, productId, variantId));
    write(cur ? lines.map((l) => (l === cur ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l)) : [...lines, { productId, variantId, qty: Math.min(MAX_QTY, Math.max(1, qty)) }]);
  },
  setQty(productId: string, variantId: string | null, qty: number) {
    ensure();
    if (qty < 1) return cart.remove(productId, variantId);
    write(lines.map((l) => (same(l, productId, variantId) ? { ...l, qty: Math.min(MAX_QTY, Math.floor(qty)) } : l)));
  },
  remove(productId: string, variantId: string | null) {
    ensure();
    write(lines.filter((l) => !same(l, productId, variantId)));
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

export function useCartCount(): number {
  return useCart().reduce((n, l) => n + l.qty, 0);
}
