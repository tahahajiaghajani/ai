// «زنده»: open screens refresh what another device changed — a phone, another browser, a Windows
// app's upload, or (in the Windows app) a download from the web version. The shell polls a cheap
// token (GET /o/:org/pulse, src/server/live.ts) while the window is visible, naming what the screen
// shows: the tables of its lists, counts and aggregates and the records it has open (`table:id`).
// The answer says which of those changed (src/server/live-scope.ts: only rows the person may read),
// and only the read-only views that show them are refreshed — a write elsewhere in the organisation
// refetches nothing here. Editors and forms are left alone (never reset a record someone is typing into).
import { useEffect, useRef } from "react";
import { useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
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

// ---------------------------------------------------------------- what a screen shows

/** The tables (and records, `table:id`) a live view shows: what it asks the pulse about. */
export interface LiveScope {
  tables: string[];
  records: string[];
}

/** The engine's list keys (`[key, org, table, …]`) and record keys (`[key, org, table, id]`). */
const LIST_KEYS = new Set(["records", "records-agg", "records-views"]);
const RECORD_KEYS = new Set(["record", "record-activity", "record-links", "record-attachments"]);
/** Tables of module keys (first part of a query key): declared by the module, or `module:<key>` for its own tables. */
const KEY_TABLES = new Map<string, string[]>();
/** At most this many records are asked about by id; more fall back to their tables. */
export const MAX_RECORDS = 30;

/**
 * Declare the tables a module's live key shows (`registerLiveTables("notify-count", ["notification"])`). An entry
 * `module:<name>` stands for every table of that module. A live key nobody declares stands for its module's tables
 * when a module of that name exists; otherwise «زنده» leaves it to its own refresh interval.
 */
export function registerLiveTables(key: string, tables: string[]): void {
  KEY_TABLES.set(key, [...new Set(tables)]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What one live query shows (null: nothing «زنده» can ask about — it keeps its own interval). `moduleTables` lists a
 * module's tables (from the schema the app loaded).
 */
export function scopeOf(key: readonly unknown[], moduleTables: (module: string) => string[] = () => []): LiveScope | null {
  const head = String(key[0] ?? "");
  if (LIST_KEYS.has(head) && typeof key[2] === "string" && key[2]) return { tables: [key[2]], records: [] };
  if (RECORD_KEYS.has(head) && typeof key[2] === "string" && typeof key[3] === "string" && UUID.test(key[3])) return { tables: [], records: [`${key[2]}:${key[3].toLowerCase()}`] };
  const declared = KEY_TABLES.get(head) ?? [`module:${head}`];
  const tables = [...new Set(declared.flatMap((t) => (t.startsWith("module:") ? moduleTables(t.slice(7)) : [t])))];
  return tables.length ? { tables, records: [] } : null;
}

/** The union of what the screen's live queries show; records beyond `MAX_RECORDS` are asked about by table. */
export function screenScope(scopes: (LiveScope | null)[]): LiveScope {
  const tables = new Set<string>();
  const records = new Set<string>();
  for (const s of scopes) {
    if (!s) continue;
    for (const t of s.tables) tables.add(t);
    for (const r of s.records) records.add(r);
  }
  const ids = [...records];
  for (const r of ids.slice(MAX_RECORDS)) tables.add(r.split(":")[0]);
  return { tables: [...tables].sort(), records: ids.slice(0, MAX_RECORDS) };
}

/** Does a view showing `scope` need a refresh when the pulse reports `changed`? */
export function touched(scope: LiveScope | null, changed: ReadonlySet<string>): boolean {
  if (!scope) return false;
  if (scope.tables.some((t) => changed.has(t))) return true;
  // a record asked about by its table (beyond the cap) is refreshed when its table changed
  return scope.records.some((r) => changed.has(r) || changed.has(r.split(":")[0]));
}

/** The tables of each module, from the schema the app loaded (`["records-meta", org]`). */
function moduleTablesOf(qc: QueryClient, orgId: string): (module: string) => string[] {
  const schema = qc.getQueryData<{ tables?: Map<string, { key: string; module?: string }> }>(["records-meta", orgId]);
  const byModule = new Map<string, string[]>();
  for (const d of schema?.tables?.values?.() ?? []) if (d.module) byModule.set(d.module, [...(byModule.get(d.module) ?? []), d.key]);
  return (m) => byModule.get(m) ?? [];
}

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
          const tables = moduleTablesOf(qc, orgId!);
          const live = qc.getQueryCache().findAll({ predicate: (q) => isLiveQuery(q) && q.getObserversCount() > 0 });
          const scope = screenScope(live.map((q) => scopeOf(q.queryKey, tables)));
          const asked = scope.tables.length + scope.records.length > 0;
          const query: Record<string, string> = {};
          if (asked) {
            if (last.current) query.since = last.current;
            query.t = scope.tables.join(",");
            if (scope.records.length) query.r = scope.records.join(",");
          }
          const { pulse, changed } = await o.get<{ pulse: string; changed?: string[] }>("/pulse", query);
          if (last.current !== null && asked) {
            if (Array.isArray(changed)) {
              const set = new Set(changed);
              if (set.size) void qc.invalidateQueries({ predicate: (q) => isLiveQuery(q) && touched(scopeOf(q.queryKey, tables), set), refetchType: "active" });
            } else if (pulse !== last.current) {
              // a server without scoped answers: every live view
              void qc.invalidateQueries({ predicate: isLiveQuery, refetchType: "active" });
            }
          }
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
