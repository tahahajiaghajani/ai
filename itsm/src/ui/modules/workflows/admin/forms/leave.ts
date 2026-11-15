// Leaving a page that holds unsaved changes (design F §8.2; the form designers' drafts and the choice lists' edits):
// while it holds them the page registers how it asks (`holdLeave`), and every way out asks first — links and the
// header's «بازگشت» through `useLeaveGuard` (parts.tsx), the shell's own menus and the command palette through
// `confirmLeave` before they navigate, and the browser's Back and Forward through `holdBrowserHistory`, which takes
// the move back before the router sees it and makes it again only when the person agrees.
// No React and no kit here: the shell imports `confirmLeave` without the designers' code, and main.tsx imports this
// module before the router starts, so the history listener below is the window's first (tests drive `historyGuard`
// with a stand-in window: tests/workflows-admin-forms-ui.test.ts).

/** How a page asks whether to leave it (true: leave, its changes lost). */
export type AskLeave = () => Promise<boolean>;

const holders: AskLeave[] = [];

/** While a page holds unsaved changes: how it asks. Returns the release. */
export function holdLeave(ask: AskLeave): () => void {
  holders.push(ask);
  return () => {
    const at = holders.lastIndexOf(ask);
    if (at >= 0) holders.splice(at, 1);
  };
}

/** May the person leave the page? The page that holds unsaved changes asks; with none, yes at once. */
export function confirmLeave(): Promise<boolean> {
  const ask = holders[holders.length - 1];
  return ask ? ask() : Promise.resolve(true);
}

/** What the history guard uses of the window. */
export interface HistoryHost {
  history: { readonly state: unknown; go(delta: number): void };
  addEventListener(type: "popstate", listener: (e: Event) => void): void;
}

/** The router's position of a history entry (React Router keeps it as `idx` in the entry's state). */
const positionOf = (state: unknown): number | null => {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};

interface Hold {
  ask: AskLeave;
  /** the page's entry */
  here: number | null;
  asking: boolean;
}

/**
 * The browser's Back and Forward, held while a page has unsaved changes. Its listener must be the window's first —
 * listeners of one event on the window run in the order they were added, so the router, which listens from the
 * moment it starts, must come after — and it stops a move from reaching the router: the browser is sent back to the
 * page's entry and the page asks. «Stay»: nothing else happens. «Leave»: the hold ends and the same move is made
 * again, this time for the router. A move the router could not place (an entry without its position) is let through.
 */
export function historyGuard(host: HistoryHost) {
  const holds: Hold[] = [];
  /** the way back to the page's entry is under way: its arrival is nobody else's business */
  let returning = false;
  /** «leave» came before the way back arrived: the move to make once it has */
  let pending: { hold: Hold; delta: number } | null = null;

  const release = (h: Hold) => {
    const at = holds.indexOf(h);
    if (at >= 0) holds.splice(at, 1);
  };
  const leave = (h: Hold, delta: number) => {
    release(h);
    host.history.go(delta);
  };
  host.addEventListener("popstate", (e) => {
    if (returning) {
      returning = false;
      e.stopImmediatePropagation();
      const p = pending;
      pending = null;
      if (p && holds.includes(p.hold)) leave(p.hold, p.delta);
      return;
    }
    const h = holds[holds.length - 1];
    const to = positionOf(host.history.state);
    if (!h || h.here === null || to === null || to === h.here) return;
    e.stopImmediatePropagation();
    const delta = to - h.here;
    returning = true;
    host.history.go(-delta);
    if (h.asking) return;
    h.asking = true;
    void h.ask().then((ok) => {
      h.asking = false;
      if (!ok || !holds.includes(h)) return;
      if (returning) pending = { hold: h, delta };
      else leave(h, delta);
    });
  });
  return {
    /** While a page holds unsaved changes (its entry: the current one). Returns the release. */
    hold(ask: AskLeave): () => void {
      const h: Hold = { ask, here: positionOf(host.history.state), asking: false };
      holds.push(h);
      return () => release(h);
    },
  };
}

/** The guard of this window's history: installed when the app loads, before the router listens. */
const browser = typeof window === "undefined" ? null : historyGuard(window);

/** Holds the browser's Back and Forward while a page has unsaved changes (`historyGuard`). Returns the release. */
export const holdBrowserHistory = (ask: AskLeave): (() => void) => browser?.hold(ask) ?? (() => {});
