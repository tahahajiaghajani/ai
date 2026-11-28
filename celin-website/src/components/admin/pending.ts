"use client";

import { useState } from "react";

/** A change the admin just made to one value: what it was set to, and the page's value it replaced. */
export interface Want<T> {
  to: T;
  from: T;
}

/** What a control shows: the admin's own change while the page's copy still holds the value it replaced. */
export function shownValue<T>(want: Want<T> | undefined, server: T): T {
  return want && Object.is(want.from, server) ? want.to : server;
}

/**
 * The changes that still speak for their rows: once the page's copy of a row moves (the refreshed page arrived, or
 * another save changed it) or the row is gone, the page leads again, so an old change never comes back later.
 */
export function prunePending<T>(wants: ReadonlyMap<string, Want<T>>, server: ReadonlyMap<string, T>): ReadonlyMap<string, Want<T>> {
  let next: Map<string, Want<T>> | null = null;
  for (const [id, w] of wants) {
    if (server.has(id) && Object.is(server.get(id), w.from)) continue;
    next ??= new Map(wants);
    next.delete(id);
  }
  return next ?? wants;
}

/**
 * Switches and buttons of an admin list (a row's «نمایش», a product's «انتشار») that show their new state the moment
 * they are pressed. A Server Action's toast comes back before the page it refreshes does; a control drawn only from
 * the page's data waits for that page — and keeps showing the old state under the «saved» toast while the refresh is
 * slow or lost. A change stands in for the page's value until that value moves (prunePending) or it is dropped
 * (the action failed: the control goes back).
 *
 * `rows` are the page's rows (`value` reads the field the controls change).
 */
export function usePending<R extends { id: string }, T>(rows: readonly R[], value: (row: R) => T) {
  const [wants, setWants] = useState<ReadonlyMap<string, Want<T>>>(() => new Map());
  const [seen, setSeen] = useState(rows);
  if (seen !== rows) {
    // a new copy of the page's rows: adjusted while rendering, so no frame shows an outdated change
    setSeen(rows);
    setWants((w) => prunePending(w, new Map(rows.map((r) => [r.id, value(r)]))));
  }
  const server = (id: string): T | undefined => {
    const row = rows.find((r) => r.id === id);
    return row ? value(row) : undefined;
  };
  return {
    /** the value to show for a row whose page value is `current` */
    get: (id: string, current: T): T => shownValue(wants.get(id), current),
    /** the admin set a row to `to`: shown at once */
    set: (id: string, to: T) =>
      setWants((w) => {
        const from = server(id);
        const next = new Map(w);
        if (from === undefined || Object.is(from, to)) next.delete(id);
        else next.set(id, { to, from });
        return next;
      }),
    /** the change did not go through: the row shows the page's value again */
    drop: (id: string) =>
      setWants((w) => {
        if (!w.has(id)) return w;
        const next = new Map(w);
        next.delete(id);
        return next;
      }),
  };
}
