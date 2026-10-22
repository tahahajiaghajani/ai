"use client";

import { useEffect, useState } from "react";

export type Me = { name: string; email: string; role: "user" | "admin"; phone: string; organization: string };

let pending: Promise<Me | null> | null = null;

/** Asks the server only when the readable hint cookie says someone signed in here (visitors cost nothing). */
function load(): Promise<Me | null> {
  if (!document.cookie.split("; ").includes("pars_user_ui=1")) return Promise.resolve(null);
  pending ??= fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((j: { user: Me | null }) => j.user ?? null)
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

const CHANGED = "pars-account-changed";

/** Call after the account's name or details change: every useAccount() on the page asks again. */
export function accountChanged() {
  pending = null;
  window.dispatchEvent(new Event(CHANGED));
}

/** The signed-in account; `undefined` while it is being checked. */
export function useAccount(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const get = () => void load().then((m) => live && setMe(m));
    get();
    window.addEventListener(CHANGED, get);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, get);
    };
  }, []);
  return me;
}
