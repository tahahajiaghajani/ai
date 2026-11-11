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
import type { Queryable } from "../db";
import { pgArray } from "../db";

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

/**
 * Bump every organisation's sync epoch (a whole database was restored or went back in transaction ids). Plain SQL, so
 * that a restore tool can run it on a database it just restored (an older backup may predate the epoch column).
 */
export const BUMP_ALL_EPOCHS_SQL = `
alter table sm_org_sync add column if not exists epoch bigint not null default 0;
alter table sm_org_sync add column if not exists purged bigint not null default 0;
insert into sm_org_sync (org_id, rev, epoch) select id, 0, (extract(epoch from clock_timestamp()) * 1000)::bigint from sm_orgs
on conflict (org_id) do update set epoch = ${NEXT_EPOCH};`;

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

const MARK = "sync.xid_high";
const MARK_EVERY_MS = 60_000;
let markedAt = 0;

/**
 * Transaction ids only grow in a database — unless it was restored into another cluster (pg_dump/pg_restore, a
 * point-in-time recovery, a copied data folder that restarted lower): stored revisions may then exceed the ids new
 * writes get, and a Windows app's cursor would take those writes for seen. The database keeps a high-water mark of
 * the ids it handed out (sm_meta `sync.xid_high`, raised at most once a minute per process); when the next id is below
 * it, every organisation's sync epoch is bumped (one full re-read for every Windows app) and the mark starts again.
 * Returns whether a regression was found. `force` skips the once-a-minute pacing (startup, restores).
 */
export async function checkXidRegression(q: Queryable, opts: { force?: boolean; log?: (msg: string) => void } = {}): Promise<boolean> {
  const now = Date.now();
  if (!opts.force && now - markedAt < MARK_EVERY_MS) return false;
  markedAt = now;
  // the snapshot and the mark in ONE statement (one snapshot): a mark this statement sees was written by a transaction
  // that committed before it, whose own snapshot's xmax is below this one's — two statements would let another
  // process raise the mark in between, and an older xmax read first would look like a regression (every Windows app of
  // every organisation reading everything again for nothing)
  const both = await q.one<{ s: string; mark: unknown }>(`select pg_current_snapshot()::text as s, (select value from sm_meta where key = $1) as mark`, [MARK]).catch(() => null);
  const cur = parseSnap(both?.s) ?? (await currentSnap(q));
  const mark = Number(both?.mark ?? 0);
  if (Number.isFinite(mark) && mark > cur.xmax) {
    const n = await bumpAllSyncEpochs(q);
    await q.query(`insert into sm_meta (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [MARK, String(cur.xmax)]);
    opts.log?.(`transaction ids went back (next ${cur.xmax}, seen ${mark}): sync epochs of ${n} organisations bumped`);
    return true;
  }
  if (Number.isFinite(mark) && mark >= cur.xmax) return false;
  await q.query(
    `insert into sm_meta (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
     where coalesce(nullif(sm_meta.value, ''), '0')::numeric < excluded.value::numeric`,
    [MARK, String(cur.xmax)],
  );
  return false;
}
