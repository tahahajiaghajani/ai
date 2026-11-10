import type { Db } from "./index";
import { MIGRATIONS, SCHEMA_VERSION } from "./migrations";
import { reconcileSchema } from "../engine/ddl";

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  current: string;
  latest: string;
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

/**
 * Apply pending migrations, each in its own transaction. Safe to run concurrently from several
 * server instances: a transaction-level advisory lock serialises them and each one re-checks.
 */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  // under the lock too: concurrent `create table if not exists` on a fresh database fails with a
  // unique violation in the catalog (several server instances starting at once)
  await db.tx(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(724100)");
    await tx.exec(`create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now())`);
  });
  const done: string[] = [];
  for (const m of MIGRATIONS) {
    const ran = await db.tx(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(724100)");
      const exists = await tx.one("select 1 from sm_migrations where id = $1", [m.id]);
      if (exists) return false;
      await tx.exec(m.sql);
      await tx.query("insert into sm_migrations (id) values ($1) on conflict (id) do nothing", [m.id]);
      return true;
    });
    if (ran) {
      done.push(m.id);
      log(`migration ${m.id} applied`);
    }
  }
  // the record engine's tables follow the table registry (new tables and fields of this version)
  await reconcileSchema(db, log);
  return done;
}
