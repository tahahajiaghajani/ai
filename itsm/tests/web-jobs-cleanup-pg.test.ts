// The plans of the job cleanup on a real PostgreSQL (Kariz 1.1.4). The old statement — `delete … where id in (select id
// … limit 5000)` — was planned as a hash semi join over a sequential scan of the whole sm_jobs once per batch when most
// rows qualify (measured); the new ones read the finished jobs through their partial index (sm_jobs_finished_idx, or
// sm_jobs_failed_idx for the failed ones), lock the rows they found and delete them by address (a TID scan), so a
// batch costs the same however long the table is, and a cleanup with nothing to delete is one index probe each.
// Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/web-jobs-cleanup-pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import type { Db } from "@server/db";
import { CLEANUP_BATCH, CLEANUP_DONE_SQL, CLEANUP_FAILED_SQL } from "@server/jobs";
import { realPg, realPgAvailable, type RealPg } from "./pg-real";

const INDEX_SCAN = /Index Scan (?:Backward )?using sm_jobs_(?:finished|failed)_idx|Bitmap Index Scan on sm_jobs_(?:finished|failed)_idx/;
const SEQ_SCAN = /Seq Scan on sm_jobs\b/;

describe.skipIf(!realPgAvailable())("job cleanup on a real PostgreSQL", () => {
  let pg: RealPg | null = null;
  let db: Db;

  beforeAll(async () => {
    pg = await realPg("webjobs");
    db = createPostgresDb({ url: pg.url, ssl: false, max: 2 });
    await migrate(db);
    // 30,000 finished jobs as a busy queue leaves them — finished in the order they ran, nearly all past their
    // retention (the case where the old statement scanned the whole table) — and the queue's live part beside them
    await db.exec(`
      insert into sm_jobs (id, kind, status, attempts, payload, run_at, done_at, created_at, updated_at)
      select gen_random_uuid(), 'record.created', 'done', 1, jsonb_build_object('table', 'incident', 'id', gen_random_uuid()),
             t, t + interval '2 seconds', t, t + interval '2 seconds'
      from (select now() - interval '12 days' + (g * interval '20 seconds') as t from generate_series(1, 27000) g) x;
      insert into sm_jobs (id, kind, status, attempts, last_error, run_at, done_at, created_at, updated_at)
      select gen_random_uuid(), 'notify.deliver', 'failed', 8, 'نشانی گیرنده پذیرفته نشد', t, t + interval '1 minute', t, t + interval '1 minute'
      from (select now() - interval '45 days' + (g * interval '6 minutes') as t from generate_series(1, 3000) g) x;
      insert into sm_jobs (id, kind, status, run_at)
      select gen_random_uuid(), 'record.updated', 'queued', now() + (g * interval '1 second') from generate_series(1, 500) g;
      analyze sm_jobs;
    `);
  }, 300_000);

  afterAll(async () => {
    await db?.close().catch(() => undefined);
    await pg?.stop();
  }, 120_000);

  const plan = async (sql: string) => (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).map((r) => r["QUERY PLAN"]).join("\n");

  it("plans each cleanup statement as an index scan of the finished jobs and a TID scan, never a scan of the whole table", async () => {
    const finished = await db.one<{ done: number; failed: number }>(
      `select count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'failed')::int as failed from sm_jobs`,
    );
    expect(finished).toEqual({ done: 27_000, failed: 3000 });
    for (const sql of [CLEANUP_DONE_SQL, CLEANUP_FAILED_SQL]) {
      const p = await plan(sql);
      console.log(`[cleanup plan]\n${p}`);
      expect(p).toMatch(INDEX_SCAN);
      expect(p).toMatch(/Tid Scan on sm_jobs/);
      expect(p).not.toMatch(SEQ_SCAN);
      expect(sql).toContain(`limit ${CLEANUP_BATCH}`);
    }
  });

  it("deletes a batch of 2,000 in milliseconds, oldest first", async () => {
    for (const [sql, status] of [
      [CLEANUP_DONE_SQL, "done"],
      [CLEANUP_FAILED_SQL, "failed"],
    ] as const) {
      const r = await db
        .tx(async (tx) => {
          const before = await tx.one<{ oldest: string }>(`select min(done_at) as oldest from sm_jobs where status = $1`, [status]);
          const t0 = performance.now();
          const gone = await tx.one<{ n: number }>(`with gone as (${sql} returning 1) select count(*)::int as n from gone`);
          const ms = performance.now() - t0;
          const after = await tx.one<{ oldest: string }>(`select min(done_at) as oldest from sm_jobs where status = $1`, [status]);
          throw Object.assign(new Error("roll back"), { result: { n: gone!.n, ms, before: before!.oldest, after: after!.oldest } });
        })
        .catch((e: { result?: { n: number; ms: number; before: string; after: string } }) => {
          if (!e.result) throw e;
          return e.result;
        });
      console.log(`[cleanup ${status}] ${r.n} rows in ${r.ms.toFixed(1)} ms`);
      expect(r.n).toBe(CLEANUP_BATCH);
      expect(r.after > r.before).toBe(true);
      expect(r.ms).toBeLessThan(2000);
    }
  });
});
