// Schema migrations, applied in steps that each fit a serverless request and resume where they stopped.
//
// The plan: create sm_migrations, then every migration of ./migrations in order — the record engine's generated DDL
// (0006_engine_tables, ≈ 2.5 MB) split into chunks of about 25 tables (engine/ddl.ts `engineChunks`) — then the
// engine's reconcile when its DDL changed since this database last had it (the same chunks). Every step is idempotent,
// runs in its own transaction under one advisory lock and records itself in that transaction (sm_migrations, or sm_meta
// for engine chunks), so a step cut short (a function killed at its time limit, a dropped connection) is rolled back and
// simply runs again: nothing is ever half-applied, and nothing done is done twice.
//
// - `migrate(db)` runs the whole plan (the Windows app, the server edition, tests, scripts/migrate-db.mts, the build).
// - `migrateSteps(db, { budgetMs, wait: false })` runs steps until the budget is spent and never queues behind another
//   instance's step (the web version, inside requests while the schema is incomplete: src/server/cloud.ts).
import type { Db, Queryable } from "./index";
import { MIGRATIONS, SCHEMA_VERSION } from "./migrations";
import { engineChunks, engineProgress, readEngineProgress, type EngineChunk } from "../engine/ddl";
import { checkXidRegression } from "../sync/snapshot";

export const MIGRATION_LOCK = 724100;
const ENGINE_MIGRATION = "0006_engine_tables";
const INIT_SQL = `create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now())`;

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  current: string;
  latest: string;
}

/** What a database has: applied migrations, the stored engine DDL version and the engine chunks applied since. */
interface DbState {
  hasMigrations: boolean;
  applied: Set<string>;
  hasMeta: boolean;
  stored: string | null;
  parts: string[];
}

const EMPTY: DbState = { hasMigrations: false, applied: new Set(), hasMeta: false, stored: null, parts: [] };

async function readState(q: Queryable, inTx: boolean): Promise<DbState> {
  if (inTx) {
    // inside a transaction a failing statement would abort it: ask the catalogue first
    const t = await q.one<{ m: boolean; meta: boolean }>(`select to_regclass('sm_migrations') is not null as m, to_regclass('sm_meta') is not null as meta`);
    if (!t?.m) return EMPTY;
    const applied = new Set((await q.query<{ id: string }>(`select id from sm_migrations`)).map((r) => r.id));
    if (!t.meta) return { ...EMPTY, hasMigrations: true, applied };
    return { hasMigrations: true, applied, hasMeta: true, ...(await readEngineProgress(q)) };
  }
  // one round trip on a database that has everything (every cold start of the web version)
  try {
    const r = await q.one<{ applied: string[] | null; stored: string | null; parts: string[] | null }>(
      `select (select array_agg(id) from sm_migrations) as applied,
              (select value from sm_meta where key = 'engine.ddl') as stored,
              (select array_agg(key) from sm_meta where key like 'engine.ddl.part:%' or key like 'engine.ddl.seen:%') as parts`,
    );
    return { hasMigrations: true, applied: new Set(r?.applied ?? []), hasMeta: true, stored: r?.stored ?? null, parts: r?.parts ?? [] };
  } catch {
    try {
      return await readState(q, true);
    } catch {
      return EMPTY;
    }
  }
}

interface Step {
  /** stable id: `init`, a migration id, `engine:<i>` (the chunks of 0006) or `reconcile:<i>` */
  id: string;
  /** Persian label for progress screens */
  label: string;
  done(s: DbState): boolean;
  run(tx: Queryable): Promise<void>;
}

function engineStep(kind: "engine" | "reconcile", c: EngineChunk): Step {
  return {
    id: `${kind}:${c.index}`,
    label: `جدول‌های رکوردها (بخش ${c.index + 1} از ${c.total})`,
    done: (s) => {
      if (!s.hasMeta) return false;
      // inside 0006: done once 0006 is recorded (an older database brings its tables up to date in the reconcile)
      if (kind === "engine" && s.applied.has(ENGINE_MIGRATION)) return true;
      const p = engineProgress(s.stored, s.parts, c.hash);
      return p.complete || p.done.has(c.index);
    },
    run: (tx) => tx.exec(c.sql),
  };
}

/** Every step, in order (the engine chunks follow the table registry, so the plan is computed when asked). */
function plan(): Step[] {
  const { chunks } = engineChunks();
  const steps: Step[] = [{ id: "init", label: "فهرست مرحله‌های پایگاه داده", done: (s) => s.hasMigrations, run: (tx) => tx.exec(INIT_SQL) }];
  for (const m of MIGRATIONS) {
    if (m.id === ENGINE_MIGRATION) {
      for (const c of chunks) steps.push(engineStep("engine", c));
      continue;
    }
    steps.push({
      id: m.id,
      label: m.title,
      done: (s) => s.applied.has(m.id),
      run: async (tx) => {
        await tx.exec(m.sql);
        await tx.query("insert into sm_migrations (id) values ($1) on conflict (id) do nothing", [m.id]);
      },
    });
  }
  for (const c of chunks) steps.push(engineStep("reconcile", c));
  return steps;
}

export interface SchemaProgress {
  /** every step is done: the schema is current */
  complete: boolean;
  done: number;
  total: number;
  /** the label of the next step (null when complete) */
  next: string | null;
}

export interface StepsResult extends SchemaProgress {
  /** another instance held the migration lock (only with `wait: false`): try again shortly */
  busy: boolean;
  /** ids of the steps this call ran */
  ran: string[];
  /** migrations this call completed, in order */
  migrations: string[];
}

function summary(steps: Step[], s: DbState): SchemaProgress {
  const pending = steps.filter((x) => !x.done(s));
  return { complete: pending.length === 0, done: steps.length - pending.length, total: steps.length, next: pending[0]?.label ?? null };
}

/** How far this database is (one round trip; nothing is changed). */
export async function schemaProgress(db: Queryable): Promise<SchemaProgress> {
  return summary(plan(), await readState(db, false));
}

/**
 * Run pending steps until none is left or `budgetMs` is spent (a step starts only while budget remains; one step is a
 * few seconds at most). `wait: false` gives up at once when another instance holds the lock (`busy`) instead of
 * queueing behind it.
 */
export async function migrateSteps(db: Db, opts: { budgetMs?: number; wait?: boolean; log?: (msg: string) => void } = {}): Promise<StepsResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? Infinity;
  const wait = opts.wait ?? true;
  const log = opts.log ?? (() => {});
  const steps = plan();
  const ran: string[] = [];
  /** migrations recorded by this call's own steps (not by another instance's meanwhile) */
  const recorded = new Set<string>();
  const before = await readState(db, false);
  let state = before;
  let busy = false;
  let tried = 0;
  for (const step of steps) {
    if (step.done(state)) continue;
    // a step starts only while budget remains — but every call does at least one (a tiny budget still makes progress)
    if (tried++ > 0 && Date.now() - started >= budget) break;
    const t0 = Date.now();
    const r = await db.tx(async (tx): Promise<"busy" | "ran" | "skipped"> => {
      if (wait) await tx.query(`select pg_advisory_xact_lock(${MIGRATION_LOCK})`);
      else if (!(await tx.one<{ ok: boolean }>(`select pg_try_advisory_xact_lock(${MIGRATION_LOCK}) as ok`))?.ok) return "busy";
      // under the lock: a step another instance finished meanwhile is not run again
      const locked = await readState(tx, true);
      if (step.done(locked)) return "skipped";
      await step.run(tx);
      // what this step recorded (steps take turns on the lock, so nobody else records anything in between): a migration
      // step its own id, the engine chunk that completes the set 0006 with it
      if (!step.id.includes(":") && step.id !== "init") recorded.add(step.id);
      else if (step.id.startsWith("engine:") && !locked.applied.has(ENGINE_MIGRATION) && (await tx.one(`select 1 as x from sm_migrations where id = $1`, [ENGINE_MIGRATION]))) recorded.add(ENGINE_MIGRATION);
      return "ran";
    });
    if (r === "busy") {
      busy = true;
      break;
    }
    if (r === "ran") {
      ran.push(step.id);
      log(step.id.includes(":") || step.id === "init" ? `schema step ${step.id} applied (${Date.now() - t0} ms)` : `migration ${step.id} applied (${Date.now() - t0} ms)`);
    }
    state = await readState(db, false);
  }
  // only what this call recorded: instances starting together each report their own share, never another's
  const migrations = MIGRATIONS.map((m) => m.id).filter((id) => recorded.has(id));
  return { ...summary(steps, state), busy, ran, migrations };
}

/**
 * Apply every pending step, waiting for the lock (safe to run concurrently from several server instances). Returns the
 * migrations this call recorded.
 */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  const r = await migrateSteps(db, { log });
  if (r.ran.some((id) => id.startsWith("reconcile:"))) log("engine schema reconciled");
  // a database restored into another cluster may hand out transaction ids below its stored revisions: rows, cursors and
  // purge watermarks ahead of them start again and every Windows app reads everything once (src/server/sync/snapshot.ts;
  // the web version runs the same check when an instance builds its app: src/server/cloud.ts)
  await checkXidRegression(db, { force: true, restamp: true, log }).catch((e) => log(`xid check skipped: ${String((e as Error)?.message ?? e)}`));
  return r.migrations;
}

export async function migrationStatus(db: Db): Promise<MigrationStatus> {
  let applied: string[] = [];
  try {
    applied = (await db.query<{ id: string }>("select id from sm_migrations order by id")).map((r) => r.id);
  } catch {
    applied = [];
  }
  const set = new Set(applied);
  const pending = MIGRATIONS.filter((m) => !set.has(m.id)).map((m) => m.id);
  return { applied, pending, current: applied[applied.length - 1] ?? "", latest: SCHEMA_VERSION };
}
