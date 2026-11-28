// The purged-id ledger (docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته», migration 0105_demo_purge_sync): the ids of every row a
// demo purge removed or left as a content-free tombstone — content-free itself (ids and table names) and kept after
// the pack's own bookkeeping (sm_demo_rows) is gone:
//   · a Windows app that was away pushes what it holds: a row whose id is here is never brought back, and a row that
//     names one is not stored with a reference to nothing (./pushed.ts, POST /sync/push);
//   · a later purge (after a reload) recognises what an earlier one left behind: an id here counts as demo data
//     (purge.ts `isDemo`), and a row alive again under such an id joins the registry (`reclaimLeftovers`).
// Kept at least LEDGER_DAYS, and until every Windows app of the organisation has pulled since (an app that has not
// synced for LEDGER_DEVICE_DAYS no longer holds it back: it reads everything again anyway when it returns, the purge
// watermark sees to that) — the job `demo.ledger`, queued by the purge, a day at a time.
import { physicalTables } from "@shared/tables";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { ident } from "../../db/sql";
import { inDemoScope } from "../../db/scope";
import { archivable, archiveTableOf } from "../../engine/ddl";
import { hasColumn } from "./catalog";

/** Days a purged id is kept at least. */
export const LEDGER_DAYS = 30;
/** A Windows app silent for longer no longer holds the ledger back (its return reads everything again). */
export const LEDGER_DEVICE_DAYS = 365;
const DAY = 24 * 3600_000;
/** Rows one run of the cleanup deletes (short statements on the web version). */
const CLEAN_BATCH = 20_000;

export interface PurgedRow {
  row_id: string;
  /** the physical table (`sm_incidents`); an archive's rows are recorded under the hot table, like the registry */
  tbl: string;
}

/**
 * SQL: does the uuid expression `e` name a row an earlier purge of the organisation ($1) removed? An index probe. Its
 * alias is one no caller uses (`e` may name an outer `p` or `d`: the purge's queries alias positions and units `p`).
 */
export const isPurgedSql = (e: string): string => `exists (select 1 from sm_demo_purged purged_id where purged_id.org_id = $1 and purged_id.row_id = ${e})`;

/** The name a content-free account tombstone carries (shown wherever an old Windows app still lists its trail). */
export const PURGED_ACCOUNT_NAME = "حساب نمایشی حذف‌شده";

/** A table name the registry may hold (the capture trigger's tables are `sm_…`). */
const TABLE_NAME = /^sm_[a-z0-9_]+$/;

/**
 * Record what the purge removed (or left as a tombstone) in the ledger: `rows`, or — without them — the pack's registry
 * as it stands: every row that is gone or a tombstone now, but its jobs (a job never reaches a Windows app). A row
 * still alive is no purged data and stays out: one the remove phase could not remove (its savepoint failed; the
 * report counts it under `skipped`) — a push of it is judged as any row's, and a later purge does not take it for
 * demo data —, and an account that lives on (one kept for another organisation is no demo data any more). An archived
 * row is recorded under the hot table, like the registry, and is alive while its archive copy is there. Idempotent (the
 * first time a row was recorded stays). Called by the purge's remove and finish phases, inside their transaction; it
 * also makes sure the ledger's cleanup is queued.
 */
export async function recordPurged(tx: Queryable, orgId: string, rows?: PurgedRow[]): Promise<number> {
  let n = 0;
  if (rows) {
    if (rows.length) {
      const r = await tx.one<{ n: number }>(
        `with i as (insert into sm_demo_purged (org_id, row_id, tbl)
           select $1, x.row_id, x.tbl from jsonb_to_recordset($2::jsonb) as x(row_id uuid, tbl text)
           on conflict (org_id, row_id) do nothing returning 1) select count(*)::int as n from i`,
        [orgId, JSON.stringify(rows)],
      );
      n = r?.n ?? 0;
    }
  } else {
    const archives = new Map(physicalTables().filter(archivable).map((d) => [d.table, archiveTableOf(d)]));
    const tables = await tx.query<{ tbl: string; here: boolean; soft: boolean }>(
      `select t.tbl, to_regclass(t.tbl) is not null as here,
              ${hasColumn("t.tbl", "deleted_at")} as soft
         from (select distinct d.tbl from sm_demo_rows d where d.org_id = $1 and d.tbl <> 'sm_jobs') t`,
      [orgId],
    );
    for (const { tbl, here, soft } of tables) {
      // what keeps a row out of the ledger: it is alive (not a tombstone), or an account that lives on
      let alive = "false";
      if (tbl === "sm_users") alive = `exists (select 1 from sm_users u where u.id = d.row_id and coalesce(u.prefs ->> 'demo_purged', '') = '')`;
      else if (here && TABLE_NAME.test(tbl)) {
        alive = `exists (select 1 from ${ident(tbl)} x where x.id = d.row_id${soft ? " and x.deleted_at is null" : ""})`;
        const copy = archives.get(tbl);
        if (copy && TABLE_NAME.test(copy) && (await tx.one<{ x: boolean }>(`select to_regclass($1) is not null as x`, [copy]))?.x) {
          alive += ` or exists (select 1 from ${ident(copy)} a where a.id = d.row_id)`;
        }
      }
      const r = await tx.one<{ n: number }>(
        `with i as (insert into sm_demo_purged (org_id, row_id, tbl)
           select d.org_id, d.row_id, d.tbl from sm_demo_rows d
            where d.org_id = $1 and d.tbl = $2 and not (${alive})
           on conflict (org_id, row_id) do nothing returning 1) select count(*)::int as n from i`,
        [orgId, tbl],
      );
      n += r?.n ?? 0;
    }
  }
  // the cleanup's first run: when the shortest stay is over (a queued one is kept: it runs no later)
  await enqueue(tx, { kind: "demo.ledger", orgId, payload: {}, dedupeKey: "demo.ledger", delayMs: LEDGER_DAYS * DAY, maxAttempts: 100 });
  return n;
}

/** The ids among `ids` an earlier purge of the organisation removed (lower case). */
export async function purgedAmong(q: Queryable, orgId: string, ids: Iterable<string>): Promise<Set<string>> {
  const list = [...new Set([...ids].map((i) => i.toLowerCase()))];
  if (!list.length) return new Set();
  const rows = await q.query<{ id: string }>(`select row_id::text as id from sm_demo_purged where org_id = $1 and row_id = any($2::uuid[])`, [orgId, pgArray(list)]);
  return new Set(rows.map((r) => r.id.toLowerCase()));
}

/** Does the organisation have a ledger at all? (One index probe; most never purged a pack.) */
export async function hasLedger(q: Queryable, orgId: string): Promise<boolean> {
  return !!(await q.one(`select 1 from sm_demo_purged where org_id = $1 limit 1`, [orgId]));
}

/** Ids that are demo data again (an account the loader marked anew): they leave the ledger. */
export async function forgetPurged(q: Queryable, orgId: string, ids: string[]): Promise<void> {
  if (ids.length) await q.query(`delete from sm_demo_purged where org_id = $1 and row_id = any($2::uuid[])`, [orgId, pgArray(ids)]);
}

/**
 * Rows alive again under an id an earlier purge removed (brought back before the ledger existed, or by a restore) are
 * what that purge left behind: they join the registry and go with the pack. Accounts aside (the loader re-marks a
 * kept account and takes it out of the ledger). Called by the purge's expand phase; returns how many joined.
 */
export async function reclaimLeftovers(tx: Queryable, orgId: string): Promise<number> {
  const tables = await tx.query<{ tbl: string }>(
    `select distinct p.tbl from sm_demo_purged p
      where p.org_id = $1 and p.tbl <> 'sm_users' and to_regclass(p.tbl) is not null
        and ${hasColumn("p.tbl", "org_id")}`,
    [orgId],
  );
  let n = 0;
  for (const { tbl } of tables) {
    if (!/^sm_[a-z0-9_]+$/.test(tbl)) continue;
    const r = await tx.one<{ n: number }>(
      `with i as (insert into sm_demo_rows (org_id, row_id, tbl)
         select $1, x.id, p.tbl from ${ident(tbl)} x join sm_demo_purged p on p.org_id = $1 and p.row_id = x.id
          where x.org_id = $1
         on conflict do nothing returning 1) select count(*)::int as n from i`,
      [orgId],
    );
    n += r?.n ?? 0;
  }
  return n;
}

/**
 * A content-free account tombstone (a pack account removed while Windows apps are linked): no name, address, password
 * or mark of the pack — `prefs.demo_purged` names the organisation, so a linked app deletes the account with its
 * sessions and what names it (src/desktop/sync-client.ts) — and its own unique address, so the persona's address is free
 * for a reload. Disabled: nobody signs in with it. `finalizeDemo` removes it for good with the memberships' tombstones.
 * Idempotent (a tombstone is not written again).
 */
export async function tombstoneAccount(q: Queryable, orgId: string, userId: string): Promise<void> {
  await tombstoneAccounts(q, orgId, [userId]);
}

/** `tombstoneAccount` for many accounts in one statement (the purge's accounts go a chunk at a time). */
export async function tombstoneAccounts(q: Queryable, orgId: string, userIds: readonly string[]): Promise<void> {
  if (!userIds.length) return;
  await q.query(
    `update sm_users set email = 'purged.' || lower(id::text) || '@demo.invalid', full_name = $3, mobile = null, password_hash = null, recovery_hash = null, disabled = true,
            prefs = jsonb_build_object('demo_purged', $2::text)
      where id = any($1::uuid[]) and coalesce(prefs ->> 'demo_purged', '') = ''`,
    [pgArray([...userIds]), orgId, PURGED_ACCOUNT_NAME],
  );
}

/**
 * The ledger's cleanup for one organisation: rows older than LEDGER_DAYS that every Windows app of the organisation
 * (not revoked, synced within LEDGER_DEVICE_DAYS) has pulled since — an app's last pull, or its registration when it
 * never pulled, is after the purge recorded them. A batch at a time. Returns whether rows are left.
 */
export async function cleanLedger(q: Queryable, orgId: string): Promise<{ removed: number; left: boolean }> {
  const r = await q.one<{ n: number }>(
    `with floor as (
       select least(now() - make_interval(days => ${LEDGER_DAYS}),
                    coalesce((select min(coalesce(d.last_pull_at, d.created_at)) from sm_devices d
                               where d.org_id = $1 and d.revoked_at is null
                                 and greatest(d.last_pull_at, d.last_push_at, d.created_at) > now() - make_interval(days => ${LEDGER_DEVICE_DAYS})),
                             'infinity'::timestamptz)) as t),
     gone as (
       delete from sm_demo_purged p where p.org_id = $1 and p.ctid = any(array(
         select x.ctid from sm_demo_purged x, floor where x.org_id = $1 and x.purged_at < floor.t limit ${CLEAN_BATCH}))
       returning 1)
     select count(*)::int as n from gone`,
    [orgId],
  );
  const left = !!(await q.one(`select 1 from sm_demo_purged where org_id = $1 limit 1`, [orgId]));
  return { removed: r?.n ?? 0, left };
}

let installed = false;

/** The ledger's job (installed with the demo module). */
export function installDemoLedger(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(
    "demo.ledger",
    async (job, jctx) => {
      if (!job.org_id) return;
      const r = await cleanLedger((jctx.cfg as JobConfig).db, job.org_id);
      // a full batch: the next one soon; rows still held back by an app (or younger than the shortest stay): a day later
      if (r.removed >= CLEAN_BATCH) return { again: 60_000 };
      if (r.left) return { again: DAY };
    },
    {
      // its worker stopped (or it failed) at every attempt in a row: the cleanup looks again a day later while ids are
      // left — otherwise only the organisation's next purge would queue it, and the ledger would outstay its days
      onExhausted: async (job, ectx) => {
        const orgId = job.org_id;
        if (!orgId) return;
        await inDemoScope(null, async () => {
          if (await hasLedger(ectx.db, orgId)) await enqueue(ectx.db, { kind: "demo.ledger", orgId, payload: {}, dedupeKey: "demo.ledger", delayMs: DAY, maxAttempts: 100 });
        });
      },
    },
  );
}
