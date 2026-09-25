"use client";
import * as React from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Row = Record<string, unknown>;

/**
 * Keeps a list of rows in sync with a Postgres table through Supabase Realtime (RLS applies).
 * `filter` uses the Realtime syntax, e.g. "task_id=eq.<uuid>".
 */
export function useRealtimeRows<T extends Row>(
  table: string,
  initial: T[],
  opts: { filter?: string; insertOnly?: boolean; sort?: (a: T, b: T) => number; limit?: number; accept?: (row: T) => boolean; enabled?: boolean; idKey?: string } = {},
): [T[], React.Dispatch<React.SetStateAction<T[]>>] {
  const idKey = opts.idKey ?? "id";
  const [rows, setRows] = React.useState<T[]>(initial);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  // A new `initial` array arrives whenever the server component re-renders (e.g. router.refresh()).
  React.useEffect(() => {
    setRows(initial);
  }, [initial]);

  React.useEffect(() => {
    if (opts.enabled === false) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`rt:${table}:${opts.filter ?? "all"}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: opts.insertOnly ? "INSERT" : "*", schema: "public", table, ...(opts.filter ? { filter: opts.filter } : {}) },
        (payload: RealtimePostgresChangesPayload<T>) => {
          const o = optsRef.current;
          setRows((prev) => {
            let next = prev;
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as Record<string, unknown>)[idKey];
              next = prev.filter((r) => r[idKey] !== oldId);
            } else {
              const row = payload.new as T;
              if (o.accept && !o.accept(row)) {
                next = prev.filter((r) => r[idKey] !== row[idKey]);
              } else {
                const idx = prev.findIndex((r) => r[idKey] === row[idKey]);
                next = idx >= 0 ? prev.map((r, i) => (i === idx ? { ...r, ...row } : r)) : [...prev, row];
              }
            }
            if (o.sort) next = [...next].sort(o.sort);
            if (o.limit && next.length > o.limit) next = next.slice(-o.limit);
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, opts.filter, opts.insertOnly, opts.enabled]);

  return [rows, setRows];
}

/** Re-render every `ms` so relative times ("۲ دقیقه پیش") stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
