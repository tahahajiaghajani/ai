// Sync revisions are transaction ids (docs/spec/ENGINE.md §13): the sync trigger stamps every synced row with the id of
// the transaction that wrote it (`pg_current_xact_id()`, 64-bit, never wraps), with no lock and in any commit order.
// A pull's cursor is a snapshot (`pg_current_snapshot()`: xmin:xmax:xip) — what was committed when the pull looked.
// The rows a cursor has not seen yet are exactly those whose writer is visible in the newer snapshot and was not in the
// older one: nothing is missed (a transaction still open at the older look is in its xip list and comes later) and
// nothing comes twice (a row comes again only when it was written again).
//
// Visibility of a row's revision in a snapshot is plain arithmetic: every row a query sees was written by a committed
// transaction (or is older than all of them), so "visible in S" is `rev < S.xmin or (rev < S.xmax and rev not in
// S.xip)`. The predicates below are comparisons on the `rev` column, so the `(org_id, rev)` indexes answer them.
import type { Db, Queryable } from "../db";
import { pgArray, retryTransient } from "../db";
import { ident } from "../db/sql";

export interface Snap {
  xmin: number;
  xmax: number;
  /** transactions in progress at the look (xmin <= x < xmax) */
  xip: number[];
}

const SNAP = /^(\d{1,18}):(\d{1,18}):((?:\d{1,18})(?:,\d{1,18})*)?$/;
/** At most this many in-progress ids in a cursor (a client never gets more: a snapshot has at most max_connections). */
const MAX_XIP = 10_000;

/** Parse a snapshot cursor (`xmin:xmax:xip,…`, PostgreSQL's text form); null when empty or malformed. */
export function parseSnap(text: unknown): Snap | null {
  if (typeof text !== "string" || !text) return null;
  const m = SNAP.exec(text.trim());
  if (!m) return null;
  const xmin = Number(m[1]);
  const xmax = Number(m[2]);
  const xip = m[3] ? m[3].split(",").map(Number) : [];
  if (!Number.isSafeInteger(xmin) || !Number.isSafeInteger(xmax) || xmin > xmax || xip.length > MAX_XIP) return null;
  if (xip.some((x) => !Number.isSafeInteger(x) || x < xmin || x >= xmax)) return null;
  return { xmin, xmax, xip: [...new Set(xip)].sort((a, b) => a - b) };
}

/** The text form of a snapshot (the cursor handed to clients). */
export function snapText(s: Snap): string {
  return `${s.xmin}:${s.xmax}:${s.xip.join(",")}`;
}

/** The current snapshot: the transaction's in a repeatable-read transaction, the statement's otherwise. */
export async function currentSnap(q: Queryable): Promise<Snap> {
  const r = await q.one<{ s: string }>(`select pg_current_snapshot()::text as s`);
  const s = parseSnap(r?.s);
  if (!s) throw new Error(`unexpected snapshot ${r?.s}`);
  return s;
}

/** Is a revision visible in a snapshot (the transaction that wrote it had committed when the snapshot was taken)? */
export function visibleIn(rev: number, s: Snap): boolean {
  return rev < s.xmin || (rev < s.xmax && !s.xip.includes(rev));
}

/** Does `later` see everything `earlier` saw (a database whose transaction ids only grow)? */
export function covers(later: Snap, earlier: Snap): boolean {
  if (later.xmax < earlier.xmax || later.xmin < earlier.xmin) return false;
  // a transaction finished at the earlier look cannot be in progress at the later one
  return later.xip.every((x) => x >= earlier.xmax || earlier.xip.includes(x));
}

/**
 * SQL: the rows of alias `a` written after `since` (null: from the beginning) and visible in `upto` — the delta
 * between two looks. Parameters are appended to `params`.
 */
export function deltaSql(a: string, since: Snap | null, upto: Snap, params: unknown[]): string {
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const parts: string[] = [`${a}.rev < ${p(upto.xmax)}`];
  if (upto.xip.length) parts.push(`not (${a}.rev = any(${p(pgArray(upto.xip))}::bigint[]))`);
  if (since) {
    parts.push(`${a}.rev >= ${p(since.xmin)}`);
    parts.push(since.xip.length ? `(${a}.rev >= ${p(since.xmax)} or ${a}.rev = any(${p(pgArray(since.xip))}::bigint[]))` : `${a}.rev >= ${p(since.xmax)}`);
  }
  return parts.join(" and ");
}

/** Keyset position within a delta: rows after (rev, id) in (rev, id) order. */
export interface After {
  rev: number;
  id: string;
}

const AFTER = /^(\d{1,18}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export function parseAfter(text: unknown): After | null {
  if (typeof text !== "string" || !text) return null;
  const m = AFTER.exec(text.trim().toLowerCase());
  return m && Number.isSafeInteger(Number(m[1])) ? { rev: Number(m[1]), id: m[2] } : null;
}
export const afterText = (a: After): string => `${a.rev}:${a.id}`;

/**
 * SQL: rows of alias `a` after the keyset position (none: all). The plain lower bound on `rev` lets the `(org_id, rev)`
 * index start at the position (a page never rescans the pages before it).
 */
export function afterSql(a: string, after: After | null, params: unknown[]): string {
  if (!after) return "true";
  params.push(after.rev, after.id);
  const r = `$${params.length - 1}`;
  const i = `$${params.length}`;
  return `${a}.rev >= ${r} and (${a}.rev > ${r} or ${a}.id > ${i}::uuid)`;
}

/** (rev, id) order as PostgreSQL sorts it (uuids compare as their lower-case text). */
export function compareKey(a: After, b: After): number {
  return a.rev !== b.rev ? (a.rev < b.rev ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ----- epochs ---------------------------------------------------------------------------------------------------

/**
 * The next epoch: the clock in milliseconds, or one more than the last when the clock is behind. A database restored
 * from an older backup carries an older epoch; bumped after the restore it still moves past every epoch handed out
 * before it (a counter could land on a value a Windows app already holds).
 */
const NEXT_EPOCH = `greatest(sm_org_sync.epoch + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint)`;

/**
 * Bump an organisation's sync epoch: every Windows app linked to it reads everything again (and drops what the server
 * no longer has). Restores, imports and a detected transaction-id regression call it. A short row lock on the
 * organisation's sm_org_sync row — ordinary writes never touch that row.
 */
export async function bumpSyncEpoch(q: Queryable, orgId: string): Promise<void> {
  await q.query(
    `insert into sm_org_sync (org_id, rev, epoch) values ($1, 0, (extract(epoch from clock_timestamp()) * 1000)::bigint)
     on conflict (org_id) do update set epoch = ${NEXT_EPOCH}`,
    [orgId],
  );
}

/** sm_meta key of the high-water mark of the transaction ids the database handed out (xidRegressionWaiting). */
export const XID_MARK_KEY = "sync.xid_high";
/** sm_meta key of a restamp under way (restampSteps): the synced table it is in (JSON). */
export const RESTAMP_KEY = "sync.restamp";
const MARK = XID_MARK_KEY;
const RESTAMP = RESTAMP_KEY;

/**
 * PL/pgSQL statements, inside a block that declared `v_xid bigint` (the writing transaction's id) and `t record`, with
 * `itsm.applying` on (timestamps stay): every synced row — the tables of the sync trigger functions — whose revision is
 * at or above `v_xid` takes `v_xid`. Such a row would look written by a transaction that has not happened yet: a pull's
 * window (`rev < snap.xmax`) leaves it out — a full read misses it and the Windows app drops its copy (sweepUnseen) —
 * until the database's transaction ids pass it. Migration 0100 (counter revisions that ran ahead of the ids) and
 * RESTAMP_SQL (a database restored into another cluster) share it; a running database does the same in steps
 * (restampSteps).
 */
export const RESTAMP_ROWS = `  for t in
    select distinct c.relname as tbl
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = g.tgfoid
    where n.nspname = current_schema() and p.proname in ('sm_sync_touch', 'sm_user_touch') and not g.tgisinternal
  loop
    execute format('update %I set rev = %s where rev >= %s', t.tbl, v_xid, v_xid);
  end loop;`;

/**
 * A database restored into another cluster starts again from this transaction. pg_dump/pg_restore loads the data before
 * its triggers exist, so every row keeps the revision the old cluster gave it, while the new cluster hands out
 * transaction ids that may be far below — and so do the other values that hold the old cluster's ids:
 * · synced rows at or above this transaction's id take it (RESTAMP_ROWS): the Windows apps' full read after the epoch
 *   bump brings them, instead of leaving them out and dropping each app's copies at its end;
 * · the Windows apps' cursors (`sm_devices.cursor`) go back to 0 — each app reads everything again and its cursor
 *   follows — and a demo pack whose tombstones wait for the apps (`purge_mark`) waits for that read;
 * · the purge watermark of an organisation that has one becomes this transaction's id (notePurgedHere): an old
 *   cluster's value would never be visible in a snapshot taken here, so every pull with a cursor would read everything
 *   again; this one is visible to the apps' first full read;
 * · the high-water mark of transaction ids starts here, and a restamp the backup caught under way is over (the
 *   startup's check finds nothing more to do).
 * A database restored into its own cluster has no row at or above this id: only the cursors, the demo pack's mark and
 * the watermarks start again (harmless: every app reads everything again after a restore anyway). Not on a Windows
 * app's database (its revisions are the server's, opaque to it) nor on a database from before transaction-id revisions
 * (migration 0100 does this when it runs). Plain SQL in one transaction: `karizctl restore` runs it on the restored
 * database (BUMP_ALL_EPOCHS_SQL) before any server opens it; a database found to have gone back while servers use it
 * does the same in short steps (restampSteps).
 */
export const RESTAMP_SQL = `
do $restamp$
declare
  v_xid bigint;
  t record;
begin
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' or to_regclass('sm_migrations') is null then
    return;
  end if;
  if not exists (select 1 from sm_migrations where id = '0100_xid_revisions') then
    return;
  end if;
  v_xid := pg_current_xact_id()::text::bigint;
  perform set_config('itsm.applying', 'on', true);
${RESTAMP_ROWS}
  update sm_devices set cursor = 0 where cursor <> 0;
  update sm_demo_packs set purge_mark = v_xid + 1 where state = 'tombstoned';
  update sm_org_sync set purged = v_xid where purged <> 0;
  update sm_meta set value = v_xid::text, updated_at = now() where key = '${MARK}';
  delete from sm_meta where key = '${RESTAMP}';
  perform set_config('itsm.applying', '', true);
end
$restamp$;`;

/**
 * Bump every organisation's sync epoch (a whole database was restored or went back in transaction ids) and start again
 * what holds another cluster's transaction ids (RESTAMP_SQL). Plain SQL, so that a restore tool can run it on a database
 * it just restored (an older backup may predate the epoch column), in one transaction.
 */
export const BUMP_ALL_EPOCHS_SQL = `
alter table sm_org_sync add column if not exists epoch bigint not null default 0;
alter table sm_org_sync add column if not exists purged bigint not null default 0;
insert into sm_org_sync (org_id, rev, epoch) select id, 0, (extract(epoch from clock_timestamp()) * 1000)::bigint from sm_orgs
on conflict (org_id) do update set epoch = ${NEXT_EPOCH};
${RESTAMP_SQL}`;

export async function bumpAllSyncEpochs(q: Queryable): Promise<number> {
  const rows = await q.query<{ org_id: string }>(
    `insert into sm_org_sync (org_id, rev, epoch) select id, 0, (extract(epoch from clock_timestamp()) * 1000)::bigint from sm_orgs
     on conflict (org_id) do update set epoch = ${NEXT_EPOCH}
     returning org_id`,
  );
  return rows.length;
}

/** The organisation's sync epoch and purge watermark. */
export async function orgSyncState(q: Queryable, orgId: string): Promise<{ epoch: number; purged: number }> {
  const r = await q.one<{ epoch: number; purged: number }>(`select epoch, purged from sm_org_sync where org_id = $1`, [orgId]);
  return { epoch: Number(r?.epoch ?? 0), purged: Number(r?.purged ?? 0) };
}

/**
 * Raise the organisation's purge watermark: tombstones up to this revision were removed for good, so a Windows app
 * whose cursor is older than it reads everything again (and drops what it still holds of them).
 */
export async function notePurged(q: Queryable, orgId: string, rev: number): Promise<void> {
  if (!(rev > 0)) return;
  // (a watermark this transaction set to its own id stays: it already covers every committed revision — notePurgedHere)
  await q.query(
    `insert into sm_org_sync (org_id, rev, purged) values ($1, 0, $2)
     on conflict (org_id) do update set purged = case when sm_org_sync.purged = pg_current_xact_id()::text::bigint
       then sm_org_sync.purged else greatest(sm_org_sync.purged, excluded.purged) end`,
    [orgId, rev],
  );
}

/**
 * Rows a Windows app may hold were deleted for good in this transaction, and no tombstone told the apps (the demo
 * pack's purge: what the platform computed during the demo, a pack removed while no app was active, memberships): the
 * watermark becomes this transaction's own id, so every app whose cursor does not see this transaction reads everything
 * again (and drops what the server no longer has). It replaces the previous watermark rather than taking the greater
 * one: a cursor that sees this transaction sees every transaction that committed before it — the one that set the
 * previous watermark included (it committed before this one could update the row), even when that one's id is higher.
 */
export async function notePurgedHere(q: Queryable, orgId: string): Promise<void> {
  await q.query(
    `insert into sm_org_sync (org_id, rev, purged) values ($1, 0, pg_current_xact_id()::text::bigint)
     on conflict (org_id) do update set purged = excluded.purged`,
    [orgId],
  );
}

// ----- transaction-id regression -------------------------------------------------------------------------------

const MARK_EVERY_MS = 60_000;
let markedAt = 0;
/** This process saw a regression waiting: every check reads the database again (no pacing) until it is handled. */
let seenWaiting = false;

/** The lock of the migrations and the engine's DDL (db/migrate.ts MIGRATION_LOCK): restamp steps take turns with them. */
const XID_LOCK = 724100;
/** Rows of one synced table restamped by one step (one short transaction). */
export const RESTAMP_BATCH = 2000;

/**
 * The snapshot, the mark and a restamp under way in ONE statement (one snapshot): a mark this statement sees was
 * written by a transaction that committed before it, whose own snapshot's xmax is below this one's — two statements
 * would let another process raise the mark in between, and an older xmax read first would look like a regression
 * (every Windows app of every organisation reading everything again for nothing).
 */
const SNAP_AND_MARK = `select pg_current_snapshot()::text as s, (select value from sm_meta where key = $1) as mark, (select value from sm_meta where key = $2) as restamp`;

interface MarkRead {
  s: string;
  mark: unknown;
  restamp: unknown;
}

/**
 * Does a transaction-id regression wait: a restamp under way (`sync.restamp`), or the high-water mark (`sync.xid_high`)
 * ahead of the next id? Read in one statement with the snapshot (SNAP_AND_MARK; the web version's cold start:
 * db/schema-check.ts coldStart).
 */
export function regressionWaiting(xmax: number, mark: unknown, restamp: unknown): boolean {
  if (restamp != null && restamp !== false) return true;
  const m = Number(mark ?? 0);
  return Number.isFinite(m) && m > xmax;
}

function waiting(r: MarkRead | null, cur: Snap): boolean {
  return regressionWaiting(cur.xmax, r?.mark, r?.restamp);
}

/** `fn` in one transaction: a new one on a database, the caller's own on a transaction (or a bare connection). */
function inOneTx<T>(q: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const d = q as Partial<Db> & { inTx?: boolean };
  return !d.inTx && typeof d.tx === "function" ? d.tx(fn) : fn(q);
}

/**
 * Transaction ids only grow in a database — unless it was restored into another cluster (pg_dump/pg_restore, a
 * point-in-time recovery, a copied data folder that restarted lower): stored revisions may then exceed the ids new
 * writes get. A pull's window (`rev < snap.xmax`) leaves such rows out — a Windows app's full read misses them and the
 * app drops its copies (sweepUnseen) — and a cursor would take later writes for seen. The database keeps a high-water
 * mark of the ids it handed out (sm_meta `sync.xid_high`, raised here at most once a minute per process); a next id
 * below it, or a restamp under way, is a regression waiting: this answers true and leaves it to restampSteps, the only
 * place that lowers the mark — in the step that finishes the restamp of every row ahead of the ids. `force` skips the
 * pacing; once this process saw a regression waiting, every call reads the database again until it is handled.
 */
export async function xidRegressionWaiting(q: Queryable, opts: { force?: boolean; log?: (msg: string) => void } = {}): Promise<boolean> {
  const now = Date.now();
  if (!opts.force && !seenWaiting && now - markedAt < MARK_EVERY_MS) return false;
  markedAt = now;
  const both = await q.one<MarkRead>(SNAP_AND_MARK, [MARK, RESTAMP]).catch(() => null);
  const cur = parseSnap(both?.s) ?? (await currentSnap(q));
  if (waiting(both, cur)) {
    if (!seenWaiting) opts.log?.(`transaction ids went back (next ${cur.xmax}, seen ${String(both?.mark ?? "")}): the synced rows ahead of them are restamped before any pull is answered`);
    seenWaiting = true;
    return true;
  }
  seenWaiting = false;
  const mark = Number(both?.mark ?? 0);
  if (Number.isFinite(mark) && mark >= cur.xmax) return false;
  await q.query(
    `insert into sm_meta (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
     where coalesce(nullif(sm_meta.value, ''), '0')::numeric < excluded.value::numeric`,
    [MARK, String(cur.xmax)],
  );
  return false;
}

/** The synced tables (those of the sync trigger functions, as RESTAMP_ROWS walks them) and whether each has org_id. */
const SYNCED_TABLES = `select distinct c.relname::text as tbl,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped) as by_org
  from pg_trigger g
  join pg_class c on c.oid = g.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = g.tgfoid
  where n.nspname = current_schema() and p.proname in ('sm_sync_touch', 'sm_user_touch') and not g.tgisinternal`;

/** What a restamp under way keeps between its steps (sm_meta `sync.restamp`). */
interface RestampState {
  /** the synced table it is in (null: none yet); the tables before it, in name order, are done */
  table: string | null;
  /** the regression as it was found: the next id and the mark */
  next: number;
  seen: number;
}

function parseState(v: unknown): RestampState | null {
  if (v == null) return null;
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      o = null;
    }
  }
  // an unreadable state starts again from the first table (a step only restamps rows still ahead of its own id)
  const r = (o && typeof o === "object" ? o : {}) as Partial<RestampState>;
  return { table: typeof r.table === "string" ? r.table : null, next: Number(r.next) || 0, seen: Number(r.seen) || 0 };
}

export interface RestampResult {
  /** a regression still waits: more steps are needed, or another process holds the lock */
  waiting: boolean;
  /** this call ran the step that finished it: every organisation's epoch moved and the mark started again */
  finished: boolean;
  /** another process held the lock (`wait: false` only) */
  busy: boolean;
  /** steps this call ran */
  steps: number;
  /** progress: the synced tables done, of all, and the one under way */
  done: number;
  total: number;
  table: string | null;
}

type StepOutcome = { kind: "busy" | "none" | "ran" | "finished"; done: number; total: number; table: string | null };

/**
 * One step of a restamp, in the caller's transaction, under the migrations' lock: the rows of one synced table above
 * this transaction's id — found through its `(org_id, rev)` index, at most RESTAMP_BATCH — take this id (the trigger
 * stamps it; `itsm.applying` keeps their timestamps); a table with none left hands over to the next one. The
 * step that finds no table left finishes: the Windows apps' cursors go back to 0, a tombstoned demo pack's `purge_mark`
 * becomes this id + 1 and a non-zero purge watermark this id (notePurgedHere: visible to the apps' first full read),
 * every organisation's epoch moves (every app reads everything again — and finds every row) and the mark starts again.
 * Not on a Windows app's database nor before 0100 (revisions there are not this database's ids): only the epochs and
 * the mark.
 */
async function restampStep(tx: Queryable, wait: boolean, log?: (msg: string) => void): Promise<StepOutcome> {
  const idle = { done: 0, total: 0, table: null };
  if (wait) await tx.query(`select pg_advisory_xact_lock(${XID_LOCK})`);
  else if (!(await tx.one<{ ok: boolean }>(`select pg_try_advisory_xact_lock(${XID_LOCK}) as ok`))?.ok) return { kind: "busy", ...idle };
  // under the lock: what another process did meanwhile is seen (instances starting together take turns)
  const read = await tx.one<MarkRead>(SNAP_AND_MARK, [MARK, RESTAMP]);
  const at = parseSnap(read?.s);
  if (!at) throw new Error(`unexpected snapshot ${read?.s}`);
  let state = parseState(read?.restamp);
  if (!state) {
    if (!waiting(read, at)) return { kind: "none", ...idle };
    state = { table: null, next: at.xmax, seen: Number(read?.mark ?? 0) };
    log?.(`transaction ids went back (next ${state.next}, seen ${state.seen}): restamping the synced rows ahead of them`);
  }
  const xid = Number((await tx.one<{ x: string }>(`select pg_current_xact_id()::text as x`))!.x);
  const env = await tx.one<{ desktop: boolean; xids: boolean }>(
    `select coalesce(current_setting('itsm.mode', true), '') = 'desktop' as desktop,
            exists (select 1 from sm_migrations where id = '0100_xid_revisions') as xids`,
  );
  const rows = !!env?.xids && !env.desktop;
  const tables = rows ? (await tx.query<{ tbl: string; by_org: boolean }>(SYNCED_TABLES)).sort((a, b) => (a.tbl < b.tbl ? -1 : a.tbl > b.tbl ? 1 : 0)) : [];
  // the table under way, or the first one after it (a table dropped meanwhile)
  let i = state.table === null ? 0 : tables.findIndex((t) => t.tbl >= state!.table!);
  if (i < 0) i = tables.length;
  await tx.query(`select set_config('itsm.applying', 'on', true)`);
  for (; i < tables.length; i++) {
    const t = ident(tables[i].tbl);
    // the rows still ahead of this step's id: an earlier step's rows carry a lower id, and this step's own (one
    // transaction for every step: a caller's) carry this one — a row at exactly this id reads as written by this step
    const ahead = tables[i].by_org
      ? await tx.query<{ id: string }>(
        `select x.id::text as id from sm_orgs o cross join lateral (select t.id from ${t} t where t.org_id = o.id and t.rev > $1 limit ${RESTAMP_BATCH}) x limit ${RESTAMP_BATCH}`,
        [xid],
      )
      : await tx.query<{ id: string }>(`select id::text as id from ${t} where rev > $1 limit ${RESTAMP_BATCH}`, [xid]);
    if (!ahead.length) continue;
    await tx.query(`update ${t} set rev = $1 where id = any($2::uuid[]) and rev > $1`, [xid, pgArray(ahead.map((r) => r.id))]);
    await tx.query(
      `insert into sm_meta (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [RESTAMP, JSON.stringify({ ...state, table: tables[i].tbl })],
    );
    await tx.query(`select set_config('itsm.applying', '', true)`);
    return { kind: "ran", done: i, total: tables.length, table: tables[i].tbl };
  }
  if (rows) {
    await tx.query(`update sm_devices set cursor = 0 where cursor <> 0`);
    await tx.query(`update sm_demo_packs set purge_mark = $1::bigint + 1 where state = 'tombstoned'`, [xid]);
    await tx.query(`update sm_org_sync set purged = $1 where purged <> 0`, [xid]);
  }
  const n = await bumpAllSyncEpochs(tx);
  await tx.query(`insert into sm_meta (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [MARK, String(at.xmax)]);
  await tx.query(`delete from sm_meta where key = $1`, [RESTAMP]);
  await tx.query(`select set_config('itsm.applying', '', true)`);
  log?.(`transaction ids went back (next ${state.next}, seen ${state.seen}): ${rows ? "synced rows, cursors and purge watermarks ahead of the ids started again; " : ""}sync epochs of ${n} organisations bumped`);
  return { kind: "finished", done: tables.length, total: tables.length, table: null };
}

/**
 * Handle a transaction-id regression (xidRegressionWaiting) in steps, each its own short transaction (restampStep),
 * until it is finished or `budgetMs` is spent (a step starts only while budget remains; every call runs at least one).
 * Resumable: a step cut short is rolled back, the next one finds the rows still ahead of its id. The epochs move and
 * the mark is lowered only by the step that finishes, so a regression stays seen (and no pull is answered, routes/sync.ts)
 * until every row is back below the ids. `wait: false` gives up at once while another process holds the lock (the web
 * version's requests: src/server/cloud.ts). Nothing waiting: one cheap step that finds nothing.
 */
export async function restampSteps(q: Queryable, opts: { budgetMs?: number; wait?: boolean; log?: (msg: string) => void } = {}): Promise<RestampResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? Infinity;
  const wait = opts.wait ?? true;
  let steps = 0;
  let last: StepOutcome = { kind: "none", done: 0, total: 0, table: null };
  for (;;) {
    if (steps > 0 && Date.now() - started >= budget) return { waiting: true, finished: false, busy: false, steps, done: last.done, total: last.total, table: last.table };
    // a deadlock with a write on the same rows (a server whose database moved under it) aborts only that step: again
    const r = await retryTransient(() => inOneTx(q, (tx) => restampStep(tx, wait, opts.log)), 5);
    if (r.kind === "busy") return { waiting: true, finished: false, busy: true, steps, done: last.done, total: last.total, table: last.table };
    if (r.kind === "none") return { waiting: false, finished: false, busy: false, steps, done: r.done, total: r.total, table: null };
    steps++;
    if (r.kind === "ran" && r.table !== last.table) opts.log?.(`restamping ${r.table} (table ${r.done + 1} of ${r.total})`);
    last = r;
    if (r.kind === "finished") {
      seenWaiting = false;
      return { waiting: false, finished: true, busy: false, steps, done: r.done, total: r.total, table: null };
    }
  }
}

/**
 * The start-up's check (`migrate()`, scripts/migrate-db.mts; tests): a regression waiting is handled whole, in steps.
 * Returns whether this call finished one (instances starting together: exactly one does).
 */
export async function checkXidRegression(q: Queryable, opts: { force?: boolean; log?: (msg: string) => void } = {}): Promise<boolean> {
  if (!(await xidRegressionWaiting(q, opts))) return false;
  return (await restampSteps(q, { log: opts.log })).finished;
}

const restamping = new WeakMap<object, Promise<void>>();
let restampFailedAt = 0;

/**
 * A request found a regression waiting (routes/sync.ts) in a process that runs its own background work (the server
 * edition, tests): its steps run here, outside the request, one run per database at a time — a run that failed is not
 * tried again for 10 seconds. The web version hands it to its 503 «migrating» answers instead (ServerConfig.xidRegression).
 */
export function restampInBackground(db: Db, log?: (msg: string) => void): void {
  if (restamping.has(db) || Date.now() - restampFailedAt < 10_000) return;
  const run = restampSteps(db, { log })
    .then(
      () => undefined,
      (e) => {
        restampFailedAt = Date.now();
        log?.(`restamp after a transaction-id regression failed: ${String((e as Error)?.message ?? e)}`);
      },
    )
    .finally(() => restamping.delete(db));
  restamping.set(db, run);
}
