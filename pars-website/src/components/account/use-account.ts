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

/** The signed-in account; `undefined` while it is being checked. */
export function useAccount(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void load().then((m) => live && setMe(m));
    return () => {
      live = false;
    };
  }, []);
  return me;
}
