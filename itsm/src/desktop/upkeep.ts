// The Windows app's database vacuumed while nobody uses the app (docs/PERFORMANCE_FA.md, the Windows app's database
// maintenance). PGlite runs PostgreSQL in single-user mode, where autovacuum never runs: dead row versions were never
// reclaimed, statistics never refreshed, transaction ids never frozen (./maintenance.ts compacts what that left at the
// next start). This does what autovacuum would, in small steps at idle moments:
//   - a pass every `everyMs` once no person's request has been in flight for `idleMs` (the window's, or a signed-in
//     browser's of the office network — never the screens' polling, a sync or a token client: src/desktop/server.ts),
//     and only while no backup holds the heavy lock (./heavy.ts);
//   - its plan from one query of the catalogue and this session's statistics (`upkeepPlan`), by priority: tables whose
//     transaction ids grow old (FREEZE), with many dead rows, with many rows inserted since a vacuum, with many changes
//     since an analyze, and once a day every table (PGlite's counters start from zero at every open, so a table changed
//     before this start shows nothing: the daily sweep reaches it — a clean table costs well under a millisecond);
//   - one statement per step, the database's own queue between them (job ticks and the sync interleave), a short pause
//     and a look whether a person came back (the pass stops then) and whether a backup waits;
//   - a statement whose estimated cost exceeds the budget (≈ 1 s of this computer's measured throughput at idle, ≈ 4 s
//     after half an hour) is not run: the table is left for the next start's phase (state.deferred), where no person waits.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { inDemoScope } from "@server/db/scope";
import type { Db } from "@server/db";
import type { Logger } from "@server/context";
import type { PgliteDb } from "@server/db/pglite";
import type { HeavyLock } from "./heavy";
import { MAINT_DEFAULTS, OFF_FILE, analyzeBytes, nextMbPerS, readMaintState, writeMaintState, type MaintState } from "./maintenance";

const MB = 1024 * 1024;
const PAGE = 8192;

export const UPKEEP_DEFAULTS = {
  /** how often a pass may start */
  everyMs: 60_000,
  /** no person's request for this long: the app is idle */
  idleMs: 5 * 60_000,
  /** ... for this long: idle enough for longer statements */
  deepIdleMs: 30 * 60_000,
  /** the longest a statement may take at idle, and after `deepIdleMs` (in this computer's measured throughput) */
  budgetMs: 1000,
  deepBudgetMs: 4000,
  /** the throughput assumed until one is measured (MB/s) */
  startMbPerS: MAINT_DEFAULTS.startMbPerS,
  /** the pause between two statements */
  yieldMs: 100,
  /** how often every table is vacuumed */
  sweepEveryMs: 24 * 3_600_000,
  /** tables older than this (transaction ids) are frozen; PostgreSQL turns VACUUM aggressive at 150 million */
  freezeAge: 1e8,
  /** a database this old is warned about in app.log (PostgreSQL stops writes about 2.1 billion) */
  warnAge: 1e9,
  /** statements this long get a line of their own */
  slowMs: 500,
};
export type UpkeepOptions = typeof UPKEEP_DEFAULTS;

/** One table as the plan's query sees it (pg_class with this session's pg_stat_all_tables). */
export interface UpkeepRow {
  oid: number;
  schema: string;
  name: string;
  relpages: number;
  /** −1: never analysed */
  reltuples: number;
  relallvisible: number;
  xid_age: number;
  mxid_age: number;
  n_dead_tup: number;
  n_ins_since_vacuum: number;
  n_mod_since_analyze: number;
}

export type UpkeepKind = "freeze" | "vacuum" | "analyze" | "sweep";

export interface UpkeepItem {
  oid: number;
  /** "schema.name" */
  table: string;
  kind: UpkeepKind;
  /** the statement */
  sql: string;
  /** whether it analyses too */
  analyze: boolean;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** The pass's statements, in priority order: freeze, dead rows, inserted rows, analyze, the daily sweep (pure). */
export function upkeepPlan(rows: readonly UpkeepRow[], sweep: { due: boolean; cursor: number | null }, o: Pick<UpkeepOptions, "freezeAge">): UpkeepItem[] {
  const out: UpkeepItem[] = [];
  const seen = new Set<number>();
  const q = (r: UpkeepRow) => `${ident(r.schema)}.${ident(r.name)}`;
  const tuples = (r: UpkeepRow) => Math.max(0, r.reltuples);
  const analyzeDue = (r: UpkeepRow) => r.reltuples < 0 || r.n_mod_since_analyze > 50 + 0.1 * tuples(r);
  const push = (r: UpkeepRow, kind: UpkeepKind, sql: string, analyze: boolean) => {
    if (seen.has(r.oid)) return;
    seen.add(r.oid);
    out.push({ oid: r.oid, table: `${r.schema}.${r.name}`, kind, sql, analyze });
  };
  const sorted = [...rows].sort((a, b) => a.oid - b.oid);
  // 1. transaction ids growing old: an aggressive VACUUM that freezes
  for (const r of [...sorted].sort((a, b) => Math.max(b.xid_age, b.mxid_age) - Math.max(a.xid_age, a.mxid_age))) {
    if (Math.max(r.xid_age, r.mxid_age) > o.freezeAge) push(r, "freeze", `vacuum (freeze, skip_database_stats) ${q(r)}`, false);
  }
  // 2. many dead rows (autovacuum's rule: 50 + 10 % of the table), 3. many rows inserted since the last vacuum
  for (const r of [...sorted].sort((a, b) => b.n_dead_tup - a.n_dead_tup)) {
    if (r.n_dead_tup > 50 + 0.1 * tuples(r)) push(r, "vacuum", `vacuum (${analyzeDue(r) ? "analyze, " : ""}skip_database_stats) ${q(r)}`, analyzeDue(r));
  }
  for (const r of sorted) {
    if (r.n_ins_since_vacuum > 1000 + 0.2 * tuples(r)) push(r, "vacuum", `vacuum (${analyzeDue(r) ? "analyze, " : ""}skip_database_stats) ${q(r)}`, analyzeDue(r));
  }
  // 4. many changes since the last analyze: the planner's statistics
  for (const r of sorted) {
    if (r.reltuples >= 0 && r.n_mod_since_analyze > 50 + 0.1 * tuples(r)) push(r, "analyze", `analyze ${q(r)}`, true);
  }
  // 5. once a day every table, from where the last pass stopped (never-analysed ones are analysed too)
  if (sweep.due) {
    for (const r of sorted) {
      if (sweep.cursor !== null && r.oid <= sweep.cursor) continue;
      push(r, "sweep", `vacuum (${r.reltuples < 0 ? "analyze, " : ""}skip_database_stats) ${q(r)}`, r.reltuples < 0);
    }
  }
  return out;
}

/**
 * What one statement costs, estimated in the bytes of a VACUUM's throughput: pages not all-visible, the table's growth
 * since its last vacuum, its indexes when it has dead rows — and the ANALYZE it runs (an analyze item, or a vacuum that
 * analyses too: every never-analysed table of a 1.1.x folder in the first sweep), which costs several times a VACUUM's
 * time per byte (./maintenance.ts ANALYZE_FACTOR). Pure.
 */
export function estimateBytes(r: Pick<UpkeepRow, "relpages" | "relallvisible" | "n_dead_tup">, kind: UpkeepKind, size: { heap: number; index: number }, analyze = kind === "analyze"): number {
  const pages = Math.max(r.relpages, Math.ceil(size.heap / PAGE));
  const sampled = analyze ? analyzeBytes(pages * PAGE) : 0;
  if (kind === "analyze") return sampled;
  if (kind === "freeze") return size.heap + (r.n_dead_tup > 0 ? size.index : 0) + sampled;
  const notVisible = Math.max(0, r.relpages - r.relallvisible) * PAGE;
  const growth = Math.max(0, size.heap - r.relpages * PAGE);
  return notVisible + growth + (r.n_dead_tup > 0 ? size.index : 0) + sampled;
}

const PLAN_SQL = `select c.oid::int8 as oid, n.nspname as schema, c.relname as name, c.relpages::int8 as relpages, c.reltuples::float8 as reltuples,
         c.relallvisible::int8 as relallvisible,
         greatest(age(c.relfrozenxid), coalesce(age(t.relfrozenxid), 0))::int8 as xid_age,
         greatest(mxid_age(c.relminmxid), coalesce(mxid_age(t.relminmxid), 0))::int8 as mxid_age,
         coalesce(s.n_dead_tup, 0)::int8 as n_dead_tup, coalesce(s.n_ins_since_vacuum, 0)::int8 as n_ins_since_vacuum,
         coalesce(s.n_mod_since_analyze, 0)::int8 as n_mod_since_analyze
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    left join pg_class t on t.oid = c.reltoastrelid
    left join pg_stat_all_tables s on s.relid = c.oid
   where c.relkind in ('r', 'm') and c.relpersistence = 'p'`;

export interface UpkeepClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: UpkeepClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface UpkeepPassReport {
  /** why nothing ran */
  skipped?: string;
  vacuumed: number;
  analyzed: number;
  frozen: number;
  /** tables left for the next start's phase */
  deferred: string[];
  /** a person came back, a backup waited, the upkeep was stopped */
  stopped?: string;
  longest: { table: string; ms: number } | null;
  ms: number;
}

export interface Upkeep {
  start(): void;
  /** stops the timer and waits for the statement under way (at most its budget) */
  stop(): Promise<void>;
  /** one pass now (the timer calls it; tests call it) */
  pass(): Promise<UpkeepPassReport>;
}

export interface UpkeepConfig {
  db: Db & Partial<Pick<PgliteDb, "wal" | "pg">>;
  log: Pick<Logger, "info" | "warn">;
  /** ms since a person's request was last in flight (0 while one is) */
  quietMs: () => number;
  lock: HeavyLock;
  /** the data folder (its maintenance.off switches the upkeep off) */
  dataDir?: string;
  memory?: boolean;
  clock?: UpkeepClock;
  /** the pause between statements (tests: none) */
  sleep?: (ms: number) => Promise<void>;
  options?: Partial<UpkeepOptions>;
}

const NONE: Upkeep = { start() {}, async stop() {}, pass: async () => ({ skipped: "not a data folder", vacuumed: 0, analyzed: 0, frozen: 0, deferred: [], longest: null, ms: 0 }) };

/** The idle upkeep of a data folder's database (nothing for a memory database or anything but PGlite). */
export function createUpkeep(c: UpkeepConfig): Upkeep {
  if (c.memory || c.db.kind !== "pglite" || !c.db.wal) return NONE;
  const o: UpkeepOptions = { ...UPKEEP_DEFAULTS, ...c.options };
  const clock = c.clock ?? systemClock;
  const sleep = c.sleep ?? ((ms: number) => new Promise<void>((r) => clock.setTimeout(r, ms)));
  const db = c.db;
  let timer: unknown = null;
  /** the timer is off (before start, after stop) */
  let stopped = true;
  /** stop() was called: a pass under way ends after its statement */
  let closing = false;
  let running: Promise<UpkeepPassReport> | null = null;
  let offLogged = false;
  let warned = false;

  async function run(): Promise<UpkeepPassReport> {
    const t0 = clock.now();
    const report: UpkeepPassReport = { vacuumed: 0, analyzed: 0, frozen: 0, deferred: [], longest: null, ms: 0 };
    const end = (patch: Partial<UpkeepPassReport>) => ({ ...report, ...patch, ms: Math.round(clock.now() - t0) });
    if (c.dataDir && existsSync(join(c.dataDir, OFF_FILE))) {
      if (!offLogged) c.log.info(`database upkeep: switched off (${OFF_FILE} in the data folder)`);
      offLogged = true;
      return end({ skipped: "switched off" });
    }
    if (c.quietMs() < o.idleMs) return end({ skipped: "a person is using the app" });
    if (c.lock.busy()) return end({ skipped: "a backup holds the database" });
    // one statement on the database's queue, outside any demo scope, while nobody holds the heavy lock
    const step = async <T>(fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> => c.lock.tryRun("upkeep", () => inDemoScope(null, fn));
    // this session's counters reach the statistics' shared memory at the next flush
    const flushed = await step(() => db.query(`select pg_stat_force_next_flush()`));
    if (!flushed.ran) return end({ skipped: "a backup holds the database" });
    const planned = await step(async () => ({
      rows: await db.query<UpkeepRow>(PLAN_SQL),
      ages: await db.query<{ datname: string; age: number }>(`select datname, greatest(age(datfrozenxid), mxid_age(datminmxid))::int8 as age from pg_database`),
    }));
    if (!planned.ran) return end({ skipped: "a backup holds the database" });
    const old = planned.value.ages.filter((a) => Number(a.age) >= o.warnAge);
    if (old.length && !warned) {
      warned = true;
      c.log.warn(`database upkeep: ${old.map((a) => `${a.datname} is ${Number(a.age)} transactions old`).join(", ")}; PostgreSQL stops taking writes near 2.1 billion (the next start freezes the template databases)`);
    }
    const state = (await readMaintState(db).catch(() => null)) as MaintState | null;
    const sweepDone = state?.sweep?.done_at ? Date.parse(state.sweep.done_at) : NaN;
    const sweep = { cursor: state?.sweep?.cursor ?? null, due: !Number.isFinite(sweepDone) || Date.now() - sweepDone >= o.sweepEveryMs || state?.sweep?.cursor != null };
    const items = upkeepPlan(planned.value.rows.map(numbers), sweep, o);
    if (!items.length) return end({ skipped: "nothing to do" });
    const byOid = new Map(planned.value.rows.map((r) => [Number(r.oid), numbers(r)]));
    let mbPerS = state?.mb_per_s;
    /** left for the next start's phase already: a table over the budget is planned again at every pass until then */
    const deferredBefore = new Set(state?.deferred ?? []);
    const deferred = new Set(deferredBefore);
    let cursor = sweep.cursor;
    let sweptAll = sweep.due;
    let ran = 0;
    for (const item of items) {
      if (closing) {
        report.stopped = "the app is closing";
        sweptAll = false;
        break;
      }
      const quiet = c.quietMs();
      if (quiet < o.idleMs) {
        report.stopped = "a person is using the app";
        sweptAll = false;
        break;
      }
      const budgetMs = quiet >= o.deepIdleMs ? o.deepBudgetMs : o.budgetMs;
      const row = byOid.get(item.oid)!;
      const size = await step(() =>
        db.one<{ heap: number; index: number }>(
          `select pg_relation_size($1::oid)::float8 + coalesce((select pg_relation_size(reltoastrelid) from pg_class where oid = $1::oid and reltoastrelid <> 0), 0)::float8 as heap,
                  coalesce((select sum(pg_relation_size(indexrelid)) from pg_index where indrelid = $1::oid), 0)::float8 as index`,
          [item.oid],
        ),
      );
      if (!size.ran) {
        report.stopped = "a backup waits";
        sweptAll = false;
        break;
      }
      if (!size.value) continue; // dropped meanwhile
      const bytes = estimateBytes(row, item.kind, { heap: Number(size.value.heap), index: Number(size.value.index) }, item.analyze);
      const budget = (budgetMs / 1000) * (mbPerS && mbPerS > 0 ? mbPerS : o.startMbPerS) * MB;
      if (bytes > budget) {
        deferred.add(item.table);
        report.deferred.push(item.table);
        if (item.kind === "sweep") cursor = item.oid;
        continue;
      }
      const ts = clock.now();
      const done = await step(() => db.exec(item.sql));
      if (!done.ran) {
        report.stopped = "a backup waits";
        sweptAll = false;
        break;
      }
      const ms = clock.now() - ts;
      ran++;
      deferred.delete(item.table);
      if (item.kind === "sweep") cursor = item.oid;
      if (item.kind === "freeze") report.frozen++;
      if (item.kind === "analyze") report.analyzed++;
      else report.vacuumed++;
      if (item.analyze && item.kind !== "analyze") report.analyzed++;
      mbPerS = nextMbPerS(mbPerS, bytes, ms, o.startMbPerS);
      if (!report.longest || ms > report.longest.ms) report.longest = { table: item.table.replace(/^public\./, ""), ms: Math.round(ms) };
      if (ms >= o.slowMs) c.log.info(`database upkeep: ${item.kind === "analyze" ? "analyze" : "vacuum"} ${item.table.replace(/^public\./, "")} took ${Math.round(ms)} ms (${Math.round(bytes / MB)} MB scanned)`);
      await sleep(o.yieldMs);
    }
    // the database's oldest transaction id moves on with the tables' (a millisecond)
    if (report.vacuumed) await step(() => db.exec(`vacuum (only_database_stats)`)).catch(() => {});
    const swept = sweep.due && sweptAll;
    // A pass that changed nothing writes nothing and says nothing: the counters of this session keep a table over the
    // budget in the plan of every pass until the next start's phase vacuums it — otherwise a write and a line in app.log
    // every minute for as long as nobody uses the app.
    const newlyDeferred = report.deferred.filter((t) => !deferredBefore.has(t));
    const changed = ran > 0 || newlyDeferred.length > 0 || deferred.size !== deferredBefore.size || swept || cursor !== (state?.sweep?.cursor ?? null) || (mbPerS ?? null) !== (state?.mb_per_s ?? null);
    if (changed) {
      await step(() =>
        writeMaintState(db, {
          deferred: [...deferred],
          sweep: swept ? { cursor: null, done_at: new Date().toISOString() } : { cursor, done_at: state?.sweep?.done_at ?? null },
          ...(mbPerS ? { mb_per_s: mbPerS } : {}),
          ...(ran ? { upkeep_at: new Date().toISOString() } : {}),
        }),
      ).catch((e) => c.log.warn("database upkeep: its state was not saved", String((e as Error)?.message ?? e)));
    }
    const out = end({});
    if (ran || newlyDeferred.length) {
      const longest = out.longest ? ` (longest ${out.longest.table} ${out.longest.ms} ms)` : "";
      const left = report.deferred.length ? `; ${report.deferred.length} left for the next start` : "";
      c.log.info(`database upkeep: ${report.vacuumed} tables vacuumed, ${report.analyzed} analyzed, ${report.frozen} frozen in ${(out.ms / 1000).toFixed(1)} s${longest}${left}`);
    }
    return out;
  }

  const upkeep: Upkeep = {
    start() {
      if (!stopped) return;
      stopped = false;
      closing = false;
      const schedule = () => {
        if (stopped) return;
        timer = clock.setTimeout(() => {
          timer = null;
          void upkeep.pass().finally(schedule);
        }, o.everyMs);
      };
      schedule();
    },
    async stop() {
      stopped = true;
      closing = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      await running?.catch(() => {});
    },
    pass() {
      running ??= run()
        .catch((e) => {
          c.log.warn("database upkeep failed", String((e as Error)?.message ?? e));
          return { skipped: "failed", vacuumed: 0, analyzed: 0, frozen: 0, deferred: [], longest: null, ms: 0 } as UpkeepPassReport;
        })
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
  return upkeep;
}

/** The plan's row with its numbers as numbers (int8 and float8 come back as numbers already; nulls as 0). */
function numbers(r: UpkeepRow): UpkeepRow {
  return {
    oid: Number(r.oid),
    schema: r.schema,
    name: r.name,
    relpages: Number(r.relpages ?? 0),
    reltuples: Number(r.reltuples ?? -1),
    relallvisible: Number(r.relallvisible ?? 0),
    xid_age: Number(r.xid_age ?? 0),
    mxid_age: Number(r.mxid_age ?? 0),
    n_dead_tup: Number(r.n_dead_tup ?? 0),
    n_ins_since_vacuum: Number(r.n_ins_since_vacuum ?? 0),
    n_mod_since_analyze: Number(r.n_mod_since_analyze ?? 0),
  };
}
