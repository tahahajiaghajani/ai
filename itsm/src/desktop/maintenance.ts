// The Windows app's database kept compact (docs/PERFORMANCE_FA.md, the Windows app's database maintenance).
//
// PGlite runs PostgreSQL as one standalone backend: autovacuum is "on" but there is no launcher to run it, and the app
// never ran VACUUM. So the dead row versions of every update and delete stayed on disk for good. 1.1.0-beta's endless CMDB
// health loop (fixed in 1.1.1) rewrote a CI and queued two jobs per pass for hours: an owner's db folder reached 3.38 GB
// for an organisation that needs a few hundred MB — 2.7 KB per job, almost all of it in sm_jobs —, and from then on the
// job runner's hourly cleanup held the local server's thread for seconds per statement while it deleted those jobs.
//
// Two parts take care of it: this phase of the start (before the site, the bridge and the listener exist, so no request
// can wait for it), and the idle upkeep (./upkeep.ts: plain VACUUM and ANALYZE while nobody uses the app).
//
//   1. A gate of one query and two file checks (≈ 1–3 ms): dead space can only come from writes, and the log written
//      since the last look bounds it, so nothing is measured unless `gateBytes` of log were written since then (or a month
//      went by with some writes, a compaction was asked for in Settings, an earlier one was cut short or left tables for
//      later, or the template databases grow old). PGlite's statistics cannot tell bloat: its counters are zero after
//      every open (it never writes pg_stat/pgstat.stat), and a 1.1.x folder never had relpages or reltuples.
//   2. The look (`measureTables`): the public tables' files on disk (one directory listing), and for each large one a
//      seeded sample of about `samplePages` pages that tells how much its live rows take (old finished jobs the queue's
//      retention deletes count as dead); a table whose dead share and reclaimable bytes are large is a candidate.
//   3. The compaction, table by table, largest gain first: sm_jobs' old finished jobs deleted in heap ranges (a TID Range
//      Scan per 32 MB: sequential, a bounded statement), every range read again at once (the new hint bits cost no second
//      full-page image), a checkpoint after every 32 MB of log; for another table on a tight disk the same reading pass
//      first; then VACUUM FULL (the table rewritten compactly, its indexes rebuilt), VACUUM (ANALYZE), a checkpoint. A
//      table that does not fit the disk now waits for a later start (state.pending). The splash says what is going on.
//
// Safe to cut short at any point: each range's statement commits or not; VACUUM FULL swaps the table's files atomically,
// and the new files of one cut short — which PostgreSQL never removes — are found by the marker `maintenance.running` and
// removed at the next start (`cleanupInterrupted`); the checkpoints bound what a recovery replays; the next start's gate
// sees the marker or state.pending and goes on. Nothing is lost.
//
// Only the Windows app's data folders run this (src/desktop is never imported by src/server or src/server-edition): the
// web version and the server edition keep PostgreSQL's own autovacuum (src/server-edition/pgtune.ts).
import { existsSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { createPgliteDb, type PgliteDb } from "@server/db/pglite";
import { walSinceCheckpoint, walStartParams } from "@server/db/wal";
import { pgArray, type Db } from "@server/db";
import type { Logger } from "@server/context";
import { parseLsn } from "./backup-stream";

const MB = 1024 * 1024;
const PAGE = 8192;

/** setImmediate as it was when this module loaded (a test's fake timers never hold the start up) */
const setImmediateAtLoad: (fn: () => void) => void = (globalThis.setImmediate ?? ((fn: () => void) => setTimeout(fn, 0))).bind(globalThis);
const nextTurn = (): Promise<void> => new Promise((r) => setImmediateAtLoad(() => r()));

export const MAINT_DEFAULTS = {
  /** log written since the last look that opens the gate */
  gateBytes: 512 * MB,
  /** ... or this many days since the last look, with at least `lookMinBytes` written */
  lookEveryDays: 30,
  lookMinBytes: 64 * MB,
  /** tables whose heap and TOAST take this much get a sample */
  bigTableBytes: 16 * MB,
  /** pages a sample reads */
  samplePages: 2000,
  /** a table is compacted when this much would come free and this share of it is dead */
  candidateBytes: 32 * MB,
  candidateDead: 0.5,
  /** the phase runs when the candidates free this much together (or tables wait from an earlier start) */
  phaseBytes: 128 * MB,
  /** asked for in Settings (compact.pending): lower thresholds, the phase runs for any candidate */
  requested: { bigTableBytes: 8 * MB, candidateBytes: 8 * MB, candidateDead: 0.2, phaseBytes: 0 },
  /** heap pages per statement of the ranges' passes (32 MB) */
  rangePages: 4096,
  /** a checkpoint after this much log in the ranges' passes */
  checkpointBytes: 32 * MB,
  /** free disk kept after any step */
  diskMargin: 256 * MB,
  /** pg_wal's peak in the reading pass (its ranges and their checkpoints) */
  hintWalBytes: 64 * MB,
  /** above this (heap + TOAST), a table is read first even with disk to spare: VACUUM FULL's log then stays near the new size */
  directMaxBytes: 256 * MB,
  /** the template databases are frozen once their age reaches this (PostgreSQL stops writes about 2.1 billion) */
  templateFreezeAge: 5e8,
  /** the splash is told when the work is estimated to take longer than this */
  notifyAfterMs: 2000,
  /** a progress line every this many ranges, or this often */
  progressRanges: 4,
  progressMs: 2000,
  /** this computer's throughput until it is measured (MB/s) */
  startMbPerS: 8,
};

export type MaintOptions = Omit<typeof MAINT_DEFAULTS, "requested"> & { requested: typeof MAINT_DEFAULTS.requested };

/** The job queue's own retention (src/server/jobs/index.ts cleanup(): done 3 days, failed 30 days; a test checks the text). */
export const RETENTION = { doneDays: 3, failedDays: 30 } as const;
/** Rows of sm_jobs the retention deletes. */
export const RETENTION_SQL = `((status = 'done' and done_at < now() - interval '${RETENTION.doneDays} days') or (status = 'failed' and done_at < now() - interval '${RETENTION.failedDays} days'))`;

/** The marker of a compaction step under way (cut short: its new files are removed at the next start). */
export const RUNNING_FILE = "maintenance.running";
/** Written by Settings («فشرده‌سازی پایگاه داده»): the next start looks with lower thresholds. */
export const REQUEST_FILE = "compact.pending";
/** Support's switch: the phase and the idle upkeep do nothing while it exists. */
export const OFF_FILE = "maintenance.off";

// ------------------------------------------------------------------------------------------------ state

/** What the maintenance remembers between starts (sm_kv 'maint.state'). */
export interface MaintState {
  v: 1;
  /** the log's insert position at the last look (absent: never looked at, only the idle upkeep wrote) */
  lsn?: string;
  /** when the last look was (ISO) */
  looked_at?: string;
  /** the app database's files at the last look */
  db_bytes?: number;
  /** what the last look found reclaimable */
  reclaim_bytes?: number;
  /** when tables were last compacted */
  compacted_at?: string | null;
  /** tables to compact at a later start (the disk was short) */
  pending?: string[];
  /** tables ("schema.name") the idle upkeep could not vacuum within its budget: the next start's phase does */
  deferred?: string[];
  /** this computer's VACUUM throughput (MB/s, a moving average) */
  mb_per_s?: number;
  /** the idle upkeep's daily sweep: the oid it reached, when it last went through every table */
  sweep?: { cursor: number | null; done_at: string | null };
  /** the idle upkeep's last pass that ran a statement */
  upkeep_at?: string;
}

const STATE_KEY = "maint.state";

export async function readMaintState(db: Pick<Db, "one">): Promise<MaintState | null> {
  const r = await db.one<{ value: unknown }>(`select value from sm_kv where key = $1`, [STATE_KEY]);
  return asState(r?.value);
}

function asState(v: unknown): MaintState | null {
  if (!v || typeof v !== "object") return null;
  const s = { ...(v as MaintState) };
  if (s.v !== 1) return null;
  if (s.lsn !== undefined) {
    try {
      parseLsn(String(s.lsn));
    } catch {
      delete s.lsn;
    }
  }
  return s;
}

/** Merges `patch` into the state (its top-level keys replace the stored ones). */
export async function writeMaintState(db: Pick<Db, "query">, patch: Partial<MaintState>): Promise<void> {
  await db.query(`insert into sm_kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = coalesce(sm_kv.value, '{}'::jsonb) || excluded.value, updated_at = now()`, [
    STATE_KEY,
    JSON.stringify({ v: 1, ...patch }),
  ]);
}

/** A moving average of this computer's throughput (MB/s), from `bytes` done in `ms`. */
export function nextMbPerS(prev: number | undefined, bytes: number, ms: number, start = MAINT_DEFAULTS.startMbPerS): number {
  const old = prev && Number.isFinite(prev) && prev > 0 ? prev : start;
  if (bytes < MB || ms <= 0) return old;
  const now = bytes / MB / (ms / 1000);
  return +Math.min(5000, Math.max(0.5, old * 0.7 + now * 0.3)).toFixed(2);
}

// ------------------------------------------------------------------------------------------------ helpers

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** "schema.name" as SQL ("public" tables by their name alone) */
const qualified = (q: string) => {
  const at = q.indexOf(".");
  return at > 0 ? `${ident(q.slice(0, at))}.${ident(q.slice(at + 1))}` : ident(q);
};
const shortName = (q: string) => q.replace(/^public\./, "");
export function fmtBytes(b: number): string {
  if (b >= 10 * 1024 * MB) return `${(b / (1024 * MB)).toFixed(1)} GB`;
  if (b >= 1024 * MB) return `${(b / (1024 * MB)).toFixed(2)} GB`;
  if (b >= 10 * MB) return `${Math.round(b / MB)} MB`;
  return `${(b / MB).toFixed(1)} MB`;
}
const secs = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);

/** Free bytes of the disk holding `dir` (Infinity when it cannot be told: never a skip for it). */
function diskFree(dir: string): number {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Infinity;
  }
}

/** The bytes of every file below `dir` (a walk with stat; files removed meanwhile count as nothing). */
export function folderBytes(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    let names: import("node:fs").Dirent[];
    try {
      names = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          n += statSync(p).size;
        } catch {
          /* gone */
        }
      }
    }
  };
  walk(dir);
  return n;
}

/** A data file's name: its filenode, and whether it is the main fork (or a 1 GB segment of it). */
const FILE = /^(\d+)(?:_(fsm|vm|init))?(?:\.\d+)?$/;

/**
 * Bytes on disk per filenode, from the names of a database folder's files: the main fork and its segments only
 * (`<node>`, `<node>.<n>`), of the filenodes in `wanted` (all when absent). `size` stats one file.
 */
export function fileSizes(names: readonly string[], size: (name: string) => number, wanted?: ReadonlySet<number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const name of names) {
    const m = FILE.exec(name);
    if (!m || m[2]) continue;
    const node = Number(m[1]);
    if (wanted && !wanted.has(node)) continue;
    out.set(node, (out.get(node) ?? 0) + size(name));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the gate

export interface Gate {
  look: boolean;
  /** why the look was opened (or why not) */
  why: string;
  state: MaintState | null;
  lsn: string;
  /** log written since the last look */
  sinceBytes: number;
  /** the oldest age of the other databases (template0, template1) */
  otherAge: number;
  requested: boolean;
  interrupted: boolean;
  /** sm_jobs was never analysed (reltuples −1: every 1.1.x folder): the job runner's cleanup plans blindly until it is */
  jobsUnanalysed: boolean;
  ms: number;
}

/**
 * Is there anything to look at? One query (the state, the log's position, the other databases' age) and two file checks.
 * A database that has no state yet and wrote less than the gate's log since initdb — a new installation, the build's
 * template, the smoke start — gets its state now and is not looked at.
 */
export async function lookNeeded(db: Pick<Db, "one" | "query">, o: { dataDir: string; options?: Partial<MaintOptions>; now?: number }): Promise<Gate> {
  const t0 = performance.now();
  const opt = { ...MAINT_DEFAULTS, ...o.options };
  const now = o.now ?? Date.now();
  const r = await db.one<{ state: unknown; lsn: string; other_age: number | string | null; jobs_tuples: number | null }>(
    `select (select value from sm_kv where key = '${STATE_KEY}') as state, pg_current_wal_insert_lsn()::text as lsn,
            (select max(greatest(age(datfrozenxid), mxid_age(datminmxid))) from pg_database where datname <> current_database()) as other_age,
            (select c.reltuples::float8 from pg_class c where c.oid = to_regclass('public.sm_jobs')) as jobs_tuples`,
  );
  const requested = existsSync(join(o.dataDir, REQUEST_FILE));
  const interrupted = existsSync(join(o.dataDir, RUNNING_FILE));
  const state = asState(r?.state);
  const lsn = r?.lsn ?? "0/0";
  const otherAge = Number(r?.other_age ?? 0);
  const at = parseLsn(lsn);
  const sinceBytes = state?.lsn ? Math.max(0, at - parseLsn(state.lsn)) : at;
  const jobsUnanalysed = r?.jobs_tuples !== null && r?.jobs_tuples !== undefined && Number(r.jobs_tuples) < 0;
  const gate = (look: boolean, why: string): Gate => ({ look, why, state, lsn, sinceBytes, otherAge, requested, interrupted, jobsUnanalysed, ms: Math.round((performance.now() - t0) * 10) / 10 });
  if (interrupted) return gate(true, "an earlier compaction was cut short");
  if (requested) return gate(true, "a compaction was asked for in Settings");
  if (otherAge >= opt.templateFreezeAge) return gate(true, "the template databases are old");
  if (!state?.lsn) {
    if (at >= opt.gateBytes) return gate(true, "never looked at");
    await writeMaintState(db, { lsn, looked_at: new Date(now).toISOString(), pending: [], deferred: state?.deferred ?? [] });
    if (!state?.deferred?.length) return gate(false, "a new database");
  }
  if (!state) return gate(false, "a new database");
  if (state.pending?.length) return gate(true, "tables wait from an earlier start");
  if (state.deferred?.length) return gate(true, "the idle upkeep left tables for this start");
  if (sinceBytes >= opt.gateBytes) return gate(true, "much was written since the last look");
  const lookedAt = Date.parse(state.looked_at ?? "");
  if ((!Number.isFinite(lookedAt) || now - lookedAt >= opt.lookEveryDays * 86_400_000) && sinceBytes >= opt.lookMinBytes) return gate(true, "a month since the last look");
  return gate(false, "nothing to do");
}

// ------------------------------------------------------------------------------------------------ the look

export interface TableMeasure {
  name: string;
  /** bytes on disk: the heap (main fork), its TOAST table, their indexes */
  heap: number;
  toast: number;
  index: number;
  /** whether a sample was taken (else the table is taken as all live) */
  sampled: boolean;
  /** what the live rows take in heap and TOAST, estimated */
  compact: number;
  /** the dead share of heap and TOAST, 0–1 */
  dead: number;
  /** what compacting the table would free */
  reclaim: number;
  /** live rows, estimated (sampled tables) */
  rows?: number;
  /** of which the job queue's retention deletes (sm_jobs) */
  gone?: number;
}

export interface Measured {
  tables: TableMeasure[];
  /** the app database's oid (its folder base/<oid>) */
  dboid: number;
  /** the app database's files (base/<oid>) */
  dbBytes: number;
  ms: { catalog: number; files: number; samples: number; total: number };
}

/** The estimate of a sample: what the live rows take (heap + TOAST), the dead share, what compacting frees. */
export function estimateTable(t: { heap: number; toast: number; index: number }, sample: { n: number; b: number; gone_n?: number; gone_b?: number } | null, pct: number): Pick<TableMeasure, "compact" | "dead" | "reclaim" | "rows" | "gone"> {
  const old = t.heap + t.toast;
  if (!sample || old <= 0) return { compact: old, dead: 0, reclaim: 0 };
  const scale = 100 / Math.max(0.0001, pct);
  const n = Math.max(0, sample.n - (sample.gone_n ?? 0));
  const b = Math.max(0, sample.b - (sample.gone_b ?? 0));
  // a row also takes its line pointer and alignment (≈ 8 bytes), a page its header and free space left by the fill (5 %)
  const compact = Math.min(old, (b + n * 8) * 1.05 * scale);
  const dead = Math.max(0, Math.min(1, 1 - compact / old));
  return { compact, dead, reclaim: Math.max(0, old - compact + t.index * dead), rows: Math.round(n * scale), gone: sample.gone_n ? Math.round(sample.gone_n * scale) : undefined };
}

/**
 * The public tables of the app's database on disk, and a seeded page sample of each large one (≈ 0.3 s on a Linux
 * development machine for an 885 MB folder; only when the gate opened).
 */
export async function measureTables(db: Pick<Db, "query" | "one">, dbDir: string, opt: Pick<MaintOptions, "bigTableBytes" | "samplePages">): Promise<Measured> {
  const t0 = performance.now();
  const dboid = (await db.one<{ oid: number }>(`select oid::int8 as oid from pg_database where datname = current_database()`))!.oid;
  const rels = await db.query<{ name: string; node: number; toast: number; idx: number[] }>(
    `select c.relname as name, pg_relation_filenode(c.oid)::int8 as node, coalesce(pg_relation_filenode(c.reltoastrelid), 0)::int8 as toast,
            coalesce((select json_agg(pg_relation_filenode(i.indexrelid)) from pg_index i where i.indrelid in (c.oid, c.reltoastrelid)), '[]'::json) as idx
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'm') and c.relpersistence = 'p'`,
  );
  const t1 = performance.now();
  const base = join(dbDir, "base", String(dboid));
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    /* no such folder: nothing to measure */
  }
  const sizeOf = (name: string) => {
    try {
      return statSync(join(base, name)).size;
    } catch {
      return 0;
    }
  };
  // every file of the database once (its size for Settings), the main forks per filenode
  const all = new Map<string, number>();
  for (const name of names) all.set(name, sizeOf(name));
  const sizes = fileSizes(names, (n) => all.get(n) ?? 0);
  const dbBytes = [...all.values()].reduce((a, b) => a + b, 0);
  const t2 = performance.now();
  const tables: TableMeasure[] = [];
  for (const r of rels) {
    const heap = sizes.get(Number(r.node)) ?? 0;
    const toast = r.toast ? (sizes.get(Number(r.toast)) ?? 0) : 0;
    const index = (Array.isArray(r.idx) ? r.idx : []).reduce((n, i) => n + (sizes.get(Number(i)) ?? 0), 0);
    const t = { name: r.name, heap, toast, index };
    if (heap + toast < opt.bigTableBytes || heap <= 0) {
      tables.push({ ...t, sampled: false, compact: heap + toast, dead: 0, reclaim: 0 });
      continue;
    }
    const pages = Math.max(1, heap / PAGE);
    const pct = Math.min(100, Math.max(0.01, (100 * opt.samplePages) / pages));
    const jobs = r.name === "sm_jobs";
    const s = await db.one<{ n: number; b: number; gone_n?: number; gone_b?: number }>(
      `select count(*)::float8 as n, coalesce(sum(pg_column_size(t.*)), 0)::float8 as b${jobs ? `, (count(*) filter (where ${RETENTION_SQL}))::float8 as gone_n, coalesce(sum(pg_column_size(t.*)) filter (where ${RETENTION_SQL}), 0)::float8 as gone_b` : ""}
         from ${ident(r.name)} t tablesample system (${pct.toFixed(4)}) repeatable (42)`,
    );
    tables.push({ ...t, sampled: true, ...estimateTable(t, s && { n: Number(s.n), b: Number(s.b), gone_n: Number(s.gone_n ?? 0), gone_b: Number(s.gone_b ?? 0) }, pct) });
  }
  const t3 = performance.now();
  const ms = (a: number, b: number) => Math.round(b - a);
  return { tables, dboid: Number(dboid), dbBytes, ms: { catalog: ms(t0, t1), files: ms(t1, t2), samples: ms(t2, t3), total: ms(t0, t3) } };
}

// ------------------------------------------------------------------------------------------------ the plan

export interface Plan {
  /** tables to compact, the largest gain first */
  compact: TableMeasure[];
  /** tables ("schema.name") to VACUUM (ANALYZE) in the phase: those the idle upkeep could not do within its budget */
  vacuum: string[];
  /** what the compaction frees, estimated */
  reclaim: number;
  /** whether the phase runs */
  run: boolean;
  /** the phase's work, estimated (ms at `mbPerS`) */
  estimateMs: number;
  /** whether the splash is told */
  notify: boolean;
}

/** Which tables to compact and vacuum (pure). */
export function planCompaction(tables: readonly TableMeasure[], state: Pick<MaintState, "pending" | "deferred" | "mb_per_s"> | null, opt: MaintOptions, requested = false): Plan {
  const th = requested ? { ...opt, ...opt.requested } : opt;
  const pending = new Set(state?.pending ?? []);
  const qualifies = (t: TableMeasure) => t.reclaim >= th.candidateBytes && t.dead >= th.candidateDead;
  const compact = tables.filter(qualifies).sort((a, b) => b.reclaim - a.reclaim || a.name.localeCompare(b.name));
  const reclaim = compact.reduce((n, t) => n + t.reclaim, 0);
  const waiting = compact.some((t) => pending.has(t.name));
  const run = compact.length > 0 && (reclaim >= th.phaseBytes || waiting || requested);
  const chosen = run ? compact : [];
  const names = new Set(chosen.map((t) => t.name));
  // (not the large tables a sample finds sparse: what a plain VACUUM gives back is reused space, not a smaller file, so the
  // same tables would be vacuumed at every look for nothing; the idle upkeep's daily sweep vacuums them, or defers them here)
  const vacuum = [...new Set(state?.deferred ?? [])].filter((q) => !names.has(q.replace(/^public\./, "")));
  const rate = (state?.mb_per_s && state.mb_per_s > 0 ? state.mb_per_s : opt.startMbPerS) * MB;
  const byName = new Map(tables.map((t) => [`public.${t.name}`, t]));
  const work = chosen.reduce((n, t) => n + t.heap + t.toast + t.index, 0) + vacuum.reduce((n, q) => n + (byName.get(q) ? byName.get(q)!.heap + byName.get(q)!.index : 16 * MB), 0);
  const estimateMs = Math.round((work / rate) * 1000);
  return { compact: chosen, vacuum, reclaim: chosen.reduce((n, t) => n + t.reclaim, 0), run: run || vacuum.length > 0, estimateMs, notify: chosen.length > 0 || estimateMs > opt.notifyAfterMs };
}

/**
 * What compacting `t` needs on the disk, and how: "direct" (VACUUM FULL at once: its log may reach the old heap's size),
 * "hint" (the table read first in ranges with checkpoints, so VACUUM FULL's log stays near the new size), or "skip" (it
 * does not fit now). Pure.
 */
export function requiredBytes(t: TableMeasure, free: number, opt: Pick<MaintOptions, "diskMargin" | "hintWalBytes" | "directMaxBytes">, read = false): { mode: "direct" | "hint" | "skip"; need: number } {
  const old = t.heap + t.toast;
  const fresh = t.compact + t.index * (1 - t.dead);
  const direct = old + 2 * fresh + opt.diskMargin;
  const hint = 2 * fresh + opt.hintWalBytes + opt.diskMargin;
  // a table whose pages this phase just read (sm_jobs' delete pass, its log checkpointed): VACUUM FULL writes about the
  // new size of log, and of its TOAST table at most the old one (it fetches the live values through the TOAST index) —
  // not the reading pass's log again (with it, a table the pass had read did not fit a disk its unread copy fitted)
  if (read) {
    const need = 2 * fresh + t.toast + opt.diskMargin;
    return free >= need ? { mode: "direct", need } : { mode: "skip", need };
  }
  if (free >= direct && old <= opt.directMaxBytes) return { mode: "direct", need: direct };
  if (free >= hint) return { mode: "hint", need: hint };
  return { mode: "skip", need: hint };
}

// ------------------------------------------------------------------------------------------------ a step cut short

interface RunningMarker {
  step: string;
  table: string;
  node_before?: number | null;
  started_at: number;
}

export interface Interrupted {
  table: string;
  started_at: number;
  removed: number;
  removed_bytes: number;
  /** other files no relation names (older than the step): reported, kept */
  kept: number;
  kept_bytes: number;
}

/**
 * An earlier compaction cut short (`maintenance.running`): its VACUUM FULL's new files stay on disk, unreferenced, for
 * good. The files of every filenode written since the step began that no relation names are removed (main fork,
 * segments, free space and visibility maps); older unreferenced files are only reported. Then the marker goes.
 */
export async function cleanupInterrupted(db: Pick<Db, "query" | "one">, dataDir: string, dbDir: string, log: Pick<Logger, "info" | "warn">): Promise<Interrupted | null> {
  const file = join(dataDir, RUNNING_FILE);
  if (!existsSync(file)) return null;
  let marker: RunningMarker | null = null;
  try {
    marker = JSON.parse(readFileSync(file, "utf8")) as RunningMarker;
  } catch {
    marker = null;
  }
  const startedAt = Number(marker?.started_at);
  const out: Interrupted = { table: String(marker?.table ?? "?"), started_at: Number.isFinite(startedAt) ? startedAt : 0, removed: 0, removed_bytes: 0, kept: 0, kept_bytes: 0 };
  try {
    const dboid = (await db.one<{ oid: number }>(`select oid::int8 as oid from pg_database where datname = current_database()`))!.oid;
    const base = join(dbDir, "base", String(dboid));
    const byNode = new Map<number, { name: string; size: number; mtime: number }[]>();
    for (const name of readdirSync(base)) {
      const m = FILE.exec(name);
      if (!m) continue;
      try {
        const st = statSync(join(base, name));
        const list = byNode.get(Number(m[1])) ?? [];
        list.push({ name, size: st.size, mtime: st.mtimeMs });
        byNode.set(Number(m[1]), list);
      } catch {
        /* gone */
      }
    }
    const nodes = [...byNode.keys()];
    const unref = nodes.length ? (await db.query<{ n: number }>(`select n::int8 as n from unnest($1::oid[]) as n where pg_filenode_relation(0, n) is null`, [pgArray(nodes)])).map((r) => Number(r.n)) : [];
    for (const node of unref) {
      const files = byNode.get(node) ?? [];
      const bytes = files.reduce((n, f) => n + f.size, 0);
      const recent = Number.isFinite(startedAt) && files.some((f) => f.mtime >= startedAt - 2000);
      if (!recent) {
        out.kept++;
        out.kept_bytes += bytes;
        continue;
      }
      for (const f of files) unlinkSync(join(base, f.name));
      out.removed += files.length;
      out.removed_bytes += bytes;
    }
    const when = out.started_at ? new Date(out.started_at).toISOString().replace(/\.\d{3}Z$/, "Z") : "an unknown time";
    log.info(`database maintenance: an earlier compaction of ${out.table} was cut short (${when}); ${out.removed} of its files removed (${fmtBytes(out.removed_bytes)})`);
    if (out.kept) log.warn(`database maintenance: ${out.kept} other files no table names (${fmtBytes(out.kept_bytes)}), older than that step: kept`);
  } finally {
    rmSync(file, { force: true });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the template databases

/**
 * template1 and template0 grow old with every transaction of the cluster (nothing vacuums them: single-user mode has no
 * autovacuum); PostgreSQL stops taking writes when any database nears 2^31. PGlite opens them (single-user mode ignores
 * datallowconn): the app's database is closed, each template opened and frozen, and the app's database opened again —
 * the returned one is the instance to use from now on.
 */
export async function freezeOtherDatabases(db: PgliteDb, dbDir: string, log: Pick<Logger, "info" | "warn">, reopen: () => Promise<PgliteDb>): Promise<PgliteDb> {
  const others = await db.query<{ datname: string; age: number }>(
    `select datname, greatest(age(datfrozenxid), mxid_age(datminmxid))::int8 as age from pg_database where datname <> current_database() order by datname`,
  );
  await db.close();
  for (const o of others) {
    const t = performance.now();
    const options: PGliteOptions = { database: o.datname, startParams: walStartParams(PGlite.defaultStartParams) };
    const pg = new PGlite(dbDir, options);
    try {
      await pg.waitReady;
      await pg.exec(`vacuum (freeze)`);
      const after = (await pg.query<{ age: number }>(`select greatest(age(datfrozenxid), mxid_age(datminmxid))::int8 as age from pg_database where datname = current_database()`)).rows[0]?.age ?? 0;
      log.info(`maintenance step freeze:${o.datname} applied (age ${Number(o.age)} → ${Number(after)}, ${Math.round(performance.now() - t)} ms)`);
    } catch (e) {
      log.warn(`database maintenance: ${o.datname} was not frozen`, String((e as Error)?.message ?? e));
    } finally {
      await pg.close().catch(() => {});
    }
  }
  return reopen();
}

// ------------------------------------------------------------------------------------------------ the phase

export interface MaintReport {
  /** why nothing was done (a memory database, switched off, the gate) */
  skipped?: string;
  gate?: Gate;
  looked?: number;
  compacted: string[];
  pending: string[];
  vacuumed: string[];
  froze: boolean;
  /** sm_jobs analysed for the first time */
  analyzed?: boolean;
  /** old finished jobs deleted */
  jobs_deleted?: number;
  interrupted?: Interrupted | null;
  folder_before?: number;
  folder_after?: number;
  ms: number;
  error?: string;
}

export interface StartupOptions {
  dataDir: string;
  dbDir: string;
  log: Pick<Logger, "info" | "warn">;
  memory?: boolean;
  /** told before the phase does work that takes a while (the splash's note, src/desktop/server.ts) */
  notify?: () => void;
  /** free bytes of the database's disk (tests) */
  freeBytes?: () => number;
  options?: Partial<MaintOptions>;
  /** opens the data folder again after the template databases were frozen (default: as the local server opens it) */
  reopen?: () => Promise<PgliteDb>;
}

type MaintDb = Db & Partial<Pick<PgliteDb, "pg" | "wal" | "checkpoint">>;

/**
 * The phase at every start of the Windows app, after the migrations and before anything can send a request: in about a
 * millisecond nothing (the gate), otherwise a look and, when it finds much dead space, the compaction. Returns the
 * database to go on with (another instance only after the template databases were frozen). Never fails the start: what
 * goes wrong is logged and left for the next start.
 */
export async function startupMaintenance<D extends MaintDb>(db: D, o: StartupOptions): Promise<{ db: D; report: MaintReport }> {
  const t0 = performance.now();
  const report: MaintReport = { compacted: [], pending: [], vacuumed: [], froze: false, ms: 0 };
  const done = (skipped?: string) => ({ db, report: { ...report, ...(skipped ? { skipped } : {}), ms: Math.round(performance.now() - t0) } });
  if (o.memory || db.kind !== "pglite" || !db.wal || !db.pg || !db.checkpoint) return done("not a data folder");
  if (existsSync(join(o.dataDir, OFF_FILE))) {
    o.log.info(`database maintenance: switched off (${OFF_FILE} in the data folder)`);
    return done("switched off");
  }
  const opt: MaintOptions = { ...MAINT_DEFAULTS, ...o.options, requested: { ...MAINT_DEFAULTS.requested, ...o.options?.requested } };
  const log = o.log;
  let gate: Gate;
  try {
    gate = await lookNeeded(db, { dataDir: o.dataDir, options: opt });
  } catch (e) {
    log.warn("database maintenance: the gate failed", String((e as Error)?.message ?? e));
    return done("the gate failed");
  }
  report.gate = gate;
  const pgdb = db as PgliteDb;
  /**
   * sm_jobs never analysed (every 1.1.x folder: nothing ran ANALYZE): the job runner's cleanup statement is planned
   * without statistics and reads every old job per statement. Analysed once here (ANALYZE reads at most 30 000 pages).
   */
  const analyzeJobs = async () => {
    const pages = Number((await db.one<{ b: number }>(`select pg_relation_size('sm_jobs')::float8 as b`))?.b ?? 0) / PAGE;
    const estimate = (Math.min(pages, 30_000) * PAGE) / ((report.gate?.state?.mb_per_s || opt.startMbPerS) * MB);
    if (estimate * 1000 > opt.notifyAfterMs && !notified) {
      o.notify?.();
      notified = true;
      await nextTurn();
    }
    const ta = performance.now();
    await db.exec(`analyze sm_jobs`);
    report.analyzed = true;
    log.info(`maintenance step analyze:sm_jobs applied (${Math.round(performance.now() - ta)} ms; never analysed before)`);
  };
  let notified = false;
  if (!gate.look) {
    log.info(`database maintenance: nothing to do (${Math.max(1, Math.round(gate.ms))} ms; ${Math.round(gate.sinceBytes / MB)} MB of log since the last look)`);
    if (gate.jobsUnanalysed) await analyzeJobs().catch((e) => log.warn("database maintenance: sm_jobs was not analysed", String((e as Error)?.message ?? e)));
    return done(gate.why);
  }
  try {
    report.interrupted = await cleanupInterrupted(db, o.dataDir, o.dbDir, log);
    const state = await readMaintState(db);
    const tm = performance.now();
    const m = await measureTables(db, o.dbDir, gate.requested ? { ...opt, ...opt.requested } : opt);
    report.looked = m.tables.length;
    const plan = planCompaction(m.tables, state, opt, gate.requested);
    const found = m.tables.filter((t) => t.reclaim >= opt.requested.candidateBytes).sort((a, b) => b.reclaim - a.reclaim);
    const listed = found.slice(0, 4).map((t) => `${t.name} ${fmtBytes(t.reclaim)}`).join(", ") + (found.length > 4 ? ", …" : "");
    log.info(`database maintenance: looked at ${m.tables.length} tables in ${Math.round(performance.now() - tm)} ms: ${fmtBytes(found.reduce((n, t) => n + t.reclaim, 0))} reclaimable in ${found.length}${found.length ? ` (${listed})` : ""}`);
    const freeze = gate.otherAge >= opt.templateFreezeAge;
    const looked: Partial<MaintState> = { lsn: gate.lsn, looked_at: new Date().toISOString(), db_bytes: m.dbBytes, reclaim_bytes: Math.round(plan.reclaim) };
    if (!plan.run && !freeze) {
      if (gate.jobsUnanalysed) await analyzeJobs();
      await writeMaintState(db, { ...looked, pending: [], deferred: [] });
      return done("nothing to compact");
    }
    const free = () => (o.freeBytes ?? (() => diskFree(o.dbDir)))();
    const free0 = free();
    /**
     * sm_jobs' old finished jobs are deleted before it is compacted — when the look found some (after a pass that deleted
     * them all, a start that again finds no room for VACUUM FULL must not read the whole table twice for nothing), and
     * when the disk takes the pass's log (a checkpoint after every `checkpointBytes`) and the margin.
     */
    const jobsPass = (t: TableMeasure, f: number) => t.name === "sm_jobs" && (t.gone ?? 0) > 0 && f >= opt.hintWalBytes + opt.diskMargin;
    // what fits the disk now: a table that fits nowhere yet waits for a later start without the splash's note
    const doable = plan.compact.filter((t) => jobsPass(t, free0) || requiredBytes(t, free0, opt).mode !== "skip");
    if (doable.length) log.info(`database maintenance: compacting ${doable.length} table${doable.length === 1 ? "" : "s"} (${fmtBytes(doable.reduce((n, t) => n + t.reclaim, 0))} to free; ${Number.isFinite(free0) ? fmtBytes(free0) : "unknown"} free on the disk)`);
    if ((plan.notify && (doable.length > 0 || plan.vacuum.length > 0)) || freeze) {
      o.notify?.();
      notified = true;
      // the splash's note and the line above leave before the first statement holds the thread
      await nextTurn();
    }
    report.folder_before = folderBytes(o.dbDir);
    // the tables still to do are remembered first: a start cut short goes on at the next one
    await writeMaintState(db, { pending: plan.compact.map((t) => t.name) });
    let mbPerS = state?.mb_per_s;
    const pending = new Set(plan.compact.map((t) => t.name));
    await pgdb.checkpoint("maintenance");
    /**
     * A pass over the table's heap in ranges: sm_jobs' old finished jobs deleted, or the pages only read — which sets
     * their hint bits, so VACUUM FULL then writes about the new size of log (with data checksums every page's first hint
     * after a checkpoint is a full-page image). In the hint mode its TOAST table is read too: VACUUM FULL copies that.
     */
    const range = async (t: TableMeasure, kind: "jobs" | "hint") => {
      const toast = kind === "hint" && t.toast > 0 ? ((await db.one<{ q: string | null }>(`select c.reltoastrelid::regclass::text as q from pg_class c where c.oid = ${quoteLit(t.name)}::regclass and c.reltoastrelid <> 0`))?.q ?? null) : null;
      const passes: { rel: string; pages: number }[] = [{ rel: ident(t.name), pages: Math.ceil(t.heap / PAGE) }, ...(toast ? [{ rel: toast, pages: Math.ceil(t.toast / PAGE) }] : [])];
      const total = passes.reduce((n, x) => n + Math.ceil(x.pages / opt.rangePages), 0);
      /**
       * One range's old jobs, through a TID range scan whatever the planner would rather do: on a table nobody analysed
       * (every 1.1.x folder) it reads every old job through the partial indexes for each range, so the first statement
       * sets the hint bits of the whole table — a full-page image of every page, the log of the whole table before the
       * next checkpoint can be taken — and every range reads the whole table again.
       */
      const deleteRange = (where: string) =>
        db.tx(async (tx) => {
          await tx.exec(`set local enable_seqscan = off; set local enable_indexscan = off; set local enable_bitmapscan = off`);
          return (await tx.one<{ n: number }>(`with gone as (delete from sm_jobs where ${where} and ${RETENTION_SQL} returning 1) select count(*)::int as n from gone`))?.n ?? 0;
        });
      let deleted = 0;
      let i = 0;
      let line = performance.now();
      for (const pass of passes) {
        for (let p = 0; p < pass.pages; p += opt.rangePages) {
          i++;
          const ts = performance.now();
          const where = `ctid >= '(${p},0)'::tid and ctid < '(${p + opt.rangePages},0)'::tid`;
          if (kind === "jobs") deleted += await deleteRange(where);
          // read again at once: the new hint bits are set now, while each page's image of this checkpoint is in the log
          await db.query(`select count(*) from ${pass.rel} where ${where}`);
          if ((await walSinceCheckpoint(pgdb.pg)) >= opt.checkpointBytes) await pgdb.checkpoint("maintenance");
          if (i % opt.progressRanges === 0 || performance.now() - line >= opt.progressMs || i === total) {
            line = performance.now();
            const what = kind === "jobs" ? `, ${deleted} finished jobs deleted so far` : "";
            log.info(`maintenance step ${kind}:${t.name}:${i} applied (${fmtBytes(Math.min(opt.rangePages, pass.pages - p) * PAGE)}${what}, ${Math.round(performance.now() - ts)} ms)`);
          }
        }
      }
      report.jobs_deleted = (report.jobs_deleted ?? 0) + deleted;
    };
    const compactOne = async (t: TableMeasure, mode: "direct" | "hint", read: boolean) => {
      if (mode === "hint" && !read) await range(t, "hint");
      const node = (await db.one<{ n: number }>(`select pg_relation_filenode(${quoteLit(t.name)}::regclass)::int8 as n`))?.n ?? null;
      const marker = join(o.dataDir, RUNNING_FILE);
      writeFileSync(marker, JSON.stringify({ step: "compact", table: t.name, node_before: node, started_at: Date.now() } satisfies RunningMarker));
      const tv = performance.now();
      await db.exec(`vacuum (full) ${ident(t.name)}`);
      const fullMs = performance.now() - tv;
      rmSync(marker, { force: true });
      await pgdb.checkpoint("maintenance");
      const after = Number((await db.one<{ b: number }>(`select pg_total_relation_size(${quoteLit(t.name)}::regclass)::float8 as b`))?.b ?? 0);
      log.info(`maintenance step compact:${t.name} applied (${fmtBytes(t.heap + t.toast + t.index)} → ${fmtBytes(after)} in ${Math.round(fullMs)} ms)`);
      mbPerS = nextMbPerS(mbPerS, t.heap + t.toast, fullMs, opt.startMbPerS);
      const ta = performance.now();
      await db.exec(`vacuum (analyze) ${ident(t.name)}`);
      await pgdb.checkpoint("maintenance");
      log.info(`maintenance step analyze:${t.name} applied (${Math.round(performance.now() - ta)} ms)`);
      pending.delete(t.name);
      report.compacted.push(t.name);
      await writeMaintState(db, { pending: [...pending], mb_per_s: mbPerS });
    };
    const later: TableMeasure[] = [];
    /** tables whose every page this phase has read (sm_jobs' delete pass): VACUUM FULL writes about their new size of log */
    const read = new Set<string>();
    for (const t of plan.compact) {
      if (jobsPass(t, free())) {
        await range(t, "jobs");
        read.add(t.name);
      }
      const need = requiredBytes(t, free(), opt, read.has(t.name));
      if (need.mode === "skip") {
        later.push(t);
        continue;
      }
      await compactOne(t, need.mode, read.has(t.name));
    }
    // the others freed space: one more try for what did not fit, then it waits for a later start
    for (const t of later) {
      const f = free();
      const need = requiredBytes(t, f, opt, read.has(t.name));
      if (need.mode === "skip") {
        log.info(`database maintenance: ${t.name} left for a later start: needs ${fmtBytes(need.need)} free on the disk, ${fmtBytes(f)} free`);
        continue;
      }
      await compactOne(t, need.mode, read.has(t.name));
    }
    report.pending = [...pending];
    if (gate.jobsUnanalysed && !report.compacted.includes("sm_jobs")) await analyzeJobs();
    // what the idle upkeep could not do within its budget (./upkeep.ts)
    const sizes = new Map(m.tables.map((t) => [`public.${t.name}`, t.heap + t.toast]));
    for (const q of plan.vacuum) {
      const tv = performance.now();
      try {
        await db.exec(`vacuum (analyze, skip_database_stats) ${qualified(q)}`);
      } catch (e) {
        log.warn(`database maintenance: vacuum of ${shortName(q)} failed`, String((e as Error)?.message ?? e));
        continue;
      }
      const ms = performance.now() - tv;
      const bytes = sizes.get(q) ?? 0;
      mbPerS = nextMbPerS(mbPerS, bytes, ms, opt.startMbPerS);
      report.vacuumed.push(q);
      log.info(`maintenance step vacuum:${shortName(q)} applied (deferred, ${fmtBytes(bytes)} scanned, ${secs(ms)})`);
    }
    if (report.vacuumed.length) await db.exec(`vacuum (only_database_stats)`);
    if (freeze) {
      db = (await freezeOtherDatabases(pgdb, o.dbDir, log, o.reopen ?? (() => createPgliteDb({ dataDir: o.dbDir, desktop: true, log: o.log })))) as unknown as D;
      report.froze = true;
    }
    await (db as PgliteDb).checkpoint("maintenance");
    const lsn = (await db.one<{ lsn: string }>(`select pg_current_wal_insert_lsn()::text as lsn`))!.lsn;
    await writeMaintState(db, {
      ...looked,
      lsn,
      looked_at: new Date().toISOString(),
      db_bytes: folderBytes(join(o.dbDir, "base", String(m.dboid))),
      ...(report.compacted.length ? { compacted_at: new Date().toISOString() } : {}),
      pending: report.pending,
      deferred: [],
      ...(mbPerS ? { mb_per_s: mbPerS } : {}),
    });
    report.folder_after = folderBytes(o.dbDir);
    const left = report.pending.length ? `, ${report.pending.length} left for later` : "";
    log.info(`database maintenance: done in ${secs(performance.now() - t0)}: folder ${fmtBytes(report.folder_before)} → ${fmtBytes(report.folder_after)} (${report.compacted.length} compacted${left})`);
    return done();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    report.error = msg;
    log.warn(`database maintenance failed; the app starts as usual and the next start goes on: ${msg}`);
    // PostgreSQL removed the files of a statement that failed (only a step cut short by the process's end leaves any)
    rmSync(join(o.dataDir, RUNNING_FILE), { force: true });
    if ((db as PgliteDb).pg?.closed) throw e;
    return done();
  } finally {
    rmSync(join(o.dataDir, REQUEST_FILE), { force: true });
  }
}

const quoteLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ------------------------------------------------------------------------------------------------ Settings

/** What Settings shows of the database's upkeep (bridge.ts info().database). */
export async function maintSummary(db: Pick<Db, "one">, dataDir: string): Promise<Record<string, unknown>> {
  const state = await readMaintState(db).catch(() => null);
  return {
    db_bytes: state?.db_bytes ?? null,
    looked_at: state?.looked_at ?? null,
    compacted_at: state?.compacted_at ?? null,
    reclaim_bytes: state?.reclaim_bytes ?? null,
    pending: state?.pending ?? [],
    deferred: state?.deferred?.length ?? 0,
    upkeep_at: state?.upkeep_at ?? null,
    requested: existsSync(join(dataDir, REQUEST_FILE)),
    off: existsSync(join(dataDir, OFF_FILE)),
  };
}

/** Settings asked for a compaction: the next start looks with lower thresholds (and compacts what it finds). */
export function scheduleCompaction(dataDir: string): void {
  writeFileSync(join(dataDir, REQUEST_FILE), new Date().toISOString(), "utf8");
}
