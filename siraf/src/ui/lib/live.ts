// «زنده»: open screens refresh what another device changed — a phone, another browser, a Windows
// app's upload, or (in the Windows app) a download from the web version. The shell polls a cheap
// token (GET /o/:org/pulse, src/server/live.ts) while the window is visible and refreshes the
// read-only views on screen when it changes. Editors and forms are left alone (never reset a
// document someone is typing into), and so are quotes that price a sale being made.
import { useEffect, useRef } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { api, orgApi } from "./api";

/** Query keys (their first part) of read-only views: lists, reports, balances, dashboards. */
const LIVE = new Set([
  "table", "org", "shell-counts", "dashboard", "dash-pl", "dash-cash-accounts", "dash-cash-ledger",
  "accounts", "audit", "tb", "bs", "income", "journal", "ledger", "detail-bal", "party-bal", "party-st",
  "treasury-summary", "treasury-balances", "treasury-book", "treasury-cheques", "treasury-due", "treasury-singles",
  "goods-summary", "goods-items", "goods-stock", "goods-kardex", "goods-analysis",
  "gold-summary", "gold-stock", "gold-coins", "gold-kardex", "gold-party-balances", "gold-position", "gold-sales", "gold-consignment", "gold-bubbles", "gold-rates", "gold-rates-spark",
  "fx-summary", "fx-wallets", "fx-positions", "fx-positions-dash", "fx-party-bal", "fx-cash-report", "fx-deals-report", "fx-revaluations",
]);

export const isLiveQuery = (q: Pick<Query, "queryKey">): boolean => LIVE.has(String(q.queryKey[0] ?? ""));

/** How long to wait before the next look: often while someone works, rarely in the background. */
export function pulseDelay(s: { desktop: boolean; focused: boolean; idleMs: number }): number {
  if (!s.focused) return 60_000;
  if (s.desktop) return 5_000;
  return s.idleMs > 120_000 ? 30_000 : 12_000;
}

export function useLivePulse(orgId: string | null, desktop: boolean): void {
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    last.current = null;
    const o = orgApi(orgId);
    let stopped = false;
    let timer: number | undefined;
    let lastInput = Date.now();
    let lastWakeSync = 0;
    const visible = () => document.visibilityState === "visible";
    const schedule = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, pulseDelay({ desktop, focused: document.hasFocus(), idleMs: Date.now() - lastInput }));
    };
    async function tick() {
      if (stopped) return;
      if (visible() && navigator.onLine !== false) {
        try {
          const { pulse } = await o.get<{ pulse: string }>("/pulse");
          if (last.current !== null && pulse !== last.current) void qc.invalidateQueries({ predicate: isLiveQuery, refetchType: "active" });
          last.current = pulse;
        } catch {
          // offline, signed out or the server is restarting: look again later
        }
      }
      schedule();
    }
    const wake = () => {
      if (!visible()) return;
      // the Windows app asks the web version for news as soon as someone comes back to it
      if (desktop && Date.now() - lastWakeSync > 15_000) {
        lastWakeSync = Date.now();
        void api.post("/local/sync").catch(() => undefined);
      }
      window.clearTimeout(timer);
      void tick();
    };
    const input = () => {
      lastInput = Date.now();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pointerdown", input, { passive: true });
    window.addEventListener("keydown", input);
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pointerdown", input);
      window.removeEventListener("keydown", input);
    };
  }, [orgId, desktop, qc]);
}
