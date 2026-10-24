"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ProPrices } from "@/lib/catalog-types";
import type { ProEnded } from "@/lib/pro-copy";
import { cart } from "@/components/cart/cart-store";

/**
 * The visitor's account and (for Pro members) prices, loaded once per page view from /api/me and
 * /api/pro/prices. Visitors cost nothing: both are asked only when the readable hint cookies say someone is
 * signed in here (celin_ui) / has Pro (celin_pro_ui). Public pages stay static and identical for everyone.
 */

export interface Me {
  name: string;
  phone: string;
  email: string;
  role: "user" | "admin";
  business: string;
  city: string;
  address: string;
  postal_code: string;
  pro: { active: boolean; issued: boolean; expiresAt: string | null; ended?: ProEnded; request: "none" | "pending" | "approved" | "rejected"; reply: string };
  unread: number;
  /** opaque per-account key: the basket in this browser belongs to one account */
  key?: string;
}

export interface PriceBook {
  prices: ProPrices;
  stockDisplay: "exact" | "level";
  lowStock: number;
  minOrder: number;
}

type State = { me: Me | null | undefined; book: PriceBook | null | undefined };

let state: State = { me: undefined, book: undefined };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const hasCookie = (name: string) => typeof document !== "undefined" && document.cookie.split("; ").includes(`${name}=1`);

async function loadPrices(): Promise<PriceBook | null> {
  try {
    const r = await fetch("/api/pro/prices", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return null;
    return (await r.json()) as PriceBook;
  } catch {
    return null;
  }
}

function load(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    if (!hasCookie("celin_ui")) {
      emit({ me: null, book: null });
      return;
    }
    // prices load in parallel with the account when the Pro hint is there (no extra round trip)
    const pricesP = hasCookie("celin_pro_ui") ? loadPrices() : Promise.resolve(null);
    let me: Me | null = null;
    try {
      const r = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
      me = r.ok ? (((await r.json()) as { user: Me | null }).user ?? null) : null;
    } catch {
      me = null;
    }
    if (me?.key) cart.bindOwner(me.key);
    let book = await pricesP;
    if (me?.pro.active && !book) book = await loadPrices();
    emit({ me, book: me?.pro.active ? book : null });
  })();
  return loading;
}

/** Call after signing in/out, entering a code or ordering: every hook on the page loads again. */
export function sessionChanged(): Promise<void> {
  loading = null;
  emit({ me: undefined, book: undefined });
  return load(true);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const SERVER: State = { me: undefined, book: undefined };

function useSession(): State {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  useEffect(() => {
    void load();
  }, []);
  return s;
}

/** The signed-in account; `undefined` while it is being checked, `null` for visitors. */
export function useMe(): Me | null | undefined {
  return useSession().me;
}

/** Prices for Pro members; `undefined` while loading, `null` when this visitor has no Pro. */
export function usePriceBook(): PriceBook | null | undefined {
  return useSession().book;
}

/** True after hydration (avoids flashing the wrong state from the static HTML). */
export function useHydrated(): boolean {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}
