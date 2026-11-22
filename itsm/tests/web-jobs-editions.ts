// The databases the job queue's suites run on (Kariz 1.1.5): PGlite, as the Windows app (and every other suite) runs
// it, and a real PostgreSQL — the web version's Supabase and the server edition's own — when ITSM_PG_URL or ITSM_PG_BIN
// names one (tests/pg-real.ts). `jobsDb` gives a migrated database of the edition; `close` drops it.
import { createPgliteDb } from "@server/db/pglite";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import type { Db } from "@server/db";
import { realPg, realPgAvailable, type RealPg } from "./pg-real";

export interface JobsEdition {
  name: string;
  /** a fresh migrated database */
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const pglite: JobsEdition = {
  name: "PGlite",
  async open() {
    const db = await createPgliteDb();
    await migrate(db);
    return { db, close: () => db.close().catch(() => undefined) };
  },
};

const postgres: JobsEdition = {
  name: "PostgreSQL",
  async open() {
    const pg: RealPg = await realPg("jobs");
    // a pool like the server edition's (several connections: a heartbeat and another process's tick run beside a job)
    const db = createPostgresDb({ url: pg.url, ssl: false, max: 6 });
    await migrate(db);
    return {
      db,
      async close() {
        await db.close().catch(() => undefined);
        await pg.stop();
      },
    };
  },
};

/** PGlite always; PostgreSQL too when one is configured. */
export const JOBS_EDITIONS: JobsEdition[] = realPgAvailable() ? [pglite, postgres] : [pglite];

/** Another process on the same database: its own Db object, so its own tick guard (the guard is per Db). */
export function otherProcess(db: Db): Db {
  return new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Db;
}
