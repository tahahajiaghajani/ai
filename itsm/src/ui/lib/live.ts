// «زنده»: open screens refresh what another device changed — a phone, another browser, a Windows
// app's upload, or (in the Windows app) a download from the web version. The shell polls a cheap
// token (GET /o/:org/pulse, src/server/live.ts) while the window is visible and refreshes the
// read-only views on screen when it changes. Editors and forms are left alone (never reset a
// record someone is typing into).
import { useEffect, useRef } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { api, orgApi } from "./api";

/**
 * Query keys (their first part) of read-only views: lists, the home page, the members and audit pages, integrations.
 * Modules add the keys of their own read-only views with `registerLiveQueries`.
 */
const LIVE = new Set(["table", "org", "shell-counts", "home", "members", "audit", "integrations", "integration-events", "api-keys"]);

/** Adds query keys (their first part) of a module's read-only views to the ones «زنده» refreshes. */
export function registerLiveQueries(...keys: string[]): void {
  for (const k of keys) LIVE.add(k);
}

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
