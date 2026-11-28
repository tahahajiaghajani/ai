// The Windows app as it runs on a computer: its database a PGlite data folder, opened as the app opens it
// (src/desktop/server.ts: `createPgliteDb({ dataDir, desktop: true, log })`) — the write-ahead log's limits and its
// checkpoint scheduler (src/server/db/wal.ts), the event loop's turns between statements and inside long transactions
// (src/server/db/pglite.ts) — where the other Windows standalone files keep PGlite in memory (./harness.ts
// folderEdition). W1, the owner's case, and W5, the deadlines (reminders, escalations, «پایان مهلت», an automatic
// decision); then each folder closed as the app quits and opened again as its next start opens it: the scheduler
// checkpointed while the workflows ran, the log stayed within its bounds, the close was clean, and every case, step
// and journal line the workflows wrote is there as it was.
// The scheduler's thresholds are scaled to a test run: the app checkpoints after 32 MB of log (or 5 minutes) once the
// database has been idle for a second, at once past 64 MB — a run of these scenarios writes less than that, and never
// rests a second. Here after 2 MB with 50 ms of rest, at once past 8 MB: its checkpoints fall between the workflows'
// own transactions, as the app's do between its job ticks and requests.
import { describe, it, expect, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { walSegments, WAL_LIMITS_MB, WAL_SEGMENT_BYTES } from "@server/db/wal";
import { readControl } from "@local/db-open";
import { editionRef, folderEdition } from "./harness";
import { w01 } from "./w01-project";
import { w05 } from "./w05-security-report";

const MB = 1024 * 1024;
const ref = editionRef(() => folderEdition({ wal: { volumeBytes: 2 * MB, hardBytes: 8 * MB, idleMs: 50, pollMs: 200, busyPollMs: 50, idleCheckMs: 25 } }));

describe("Windows app on its data folder (PGlite)", () => {
  afterAll(() => ref.close(), 120_000);
  w01(ref);
  w05(ref);

  describe("the folders afterwards", () => {
    it("checkpointed while the workflows ran and kept the log within its bounds; closed as the app quits and opened again, every case, step and journal line is there as it was", async () => {
      const folders = (await ref.get()).folders!();
      // one world per workflow
      expect(folders).toHaveLength(2);
      const quiet = { info() {}, warn() {} };
      for (const f of folders) {
        // the scheduler checkpointed on this folder while the workflows ran (after their first case began)
        expect(f.db.wal).not.toBeNull();
        const first = Date.parse(String((await f.db.one<{ t: string }>(`select min(created_at) as t from sm_process_cases`))!.t));
        expect(f.checkpoints.filter((c) => c.at > first).length).toBeGreaterThan(0);
        // a checkpoint keeps max_wal_size for reuse, plus what was written since (tests/pglite-wal.test.ts's bound)
        expect(walSegments(join(f.dbDir, "pg_wal"), (p) => readdirSync(p)).length).toBeLessThanOrEqual((WAL_LIMITS_MB.max_wal_size * MB) / WAL_SEGMENT_BYTES + 4);
        const snapshot = async () => ({
          cases: await f.db.query(`select id, state, outcome, data, open_rounds, paused_at from sm_process_cases order by id`),
          tasks: await f.db.query(`select id, case_id, step_key, round, assigned_to, status, outcome, due_at, reminded_at, escalated_at from sm_process_tasks order by id`),
          journal: await f.db.query(`select id, body from sm_journal where table_key = 'process_case' order by id`),
        });
        const before = await snapshot();
        expect(before.cases.length).toBeGreaterThan(0);
        // the app quits: a checkpoint, then a clean shutdown (pg_control says so, the next start replays nothing)
        await f.db.close();
        expect(readControl(f.dbDir)).toMatchObject({ recovery: false, unknown: null });
        // its next start: the folder opened again and migrated (nothing left to apply)
        f.db = await createPgliteDb({ dataDir: f.dbDir, desktop: true, log: quiet });
        expect(await migrate(f.db)).toEqual([]);
        expect(await snapshot()).toEqual(before);
      }
    }, 300_000);
  });
});
