"use client";

import { useSyncExternalStore } from "react";

/** «علاقه‌مندی‌ها», kept in this browser (no account needed). Holds product slugs. */
const KEY = "celin-wishlist-v1";
const EMPTY: string[] = [];
let items: string[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function ensure() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    items = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : EMPTY;
  } catch {
    items = EMPTY;
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    loaded = false;
    ensure();
    listeners.forEach((l) => l());
  });
}

export function toggleWish(slug: string) {
  ensure();
  items = items.includes(slug) ? items.filter((s) => s !== slug) : [slug, ...items];
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // private mode
  }
  listeners.forEach((l) => l());
}

export function useWishlist(): string[] {
  return useSyncExternalStore(
    (cb) => {
      ensure();
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      ensure();
      return items;
    },
    () => EMPTY,
  );
}
