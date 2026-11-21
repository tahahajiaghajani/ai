// Helpers of the Windows app's database maintenance tests (tests/desktop-maint-*.test.ts): PGlite data folders in the
// system's temporary folder with the two tables the maintenance needs (sm_kv, sm_jobs as migration 0005 makes them),
// bloat made by inserts and deletes, a logger that keeps its lines.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgliteDb, type PgliteDb } from "@server/db/pglite";
import type { Logger } from "@server/context";

export const MB = 1024 * 1024;

const made: string[] = [];
/** A new temporary folder (removed by `cleanFolders`). */
export function tempFolder(prefix = "kariz-maint-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}
export function cleanFolders(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function capture(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const put = (m: string, d?: unknown) => lines.push(`${m}${d === undefined ? "" : ` ${typeof d === "string" ? d : JSON.stringify(d)}`}`);
  return { lines, info: put, warn: put, error: put };
}

/** sm_kv and sm_jobs as the migrations make them (0001_core, 0005_engine, 0103_jobs_failed_idx). */
export const MINIMAL_SCHEMA = `
create table if not exists sm_kv (key text primary key, value jsonb, updated_at timestamptz not null default now());
create table if not exists sm_jobs (
  id uuid primary key, org_id uuid, kind text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'queued',
  run_at timestamptz not null default now(), attempts integer not null default 0, max_attempts integer not null default 8,
  locked_until timestamptz, locked_by text, dedupe_key text, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), done_at timestamptz);
create index if not exists sm_jobs_due_idx on sm_jobs (run_at) where status = 'queued';
create index if not exists sm_jobs_running_idx on sm_jobs (locked_until) where status = 'running';
create index if not exists sm_jobs_finished_idx on sm_jobs (done_at) where status in ('done', 'failed');
create index if not exists sm_jobs_org_idx on sm_jobs (org_id, created_at desc);
create index if not exists sm_jobs_failed_idx on sm_jobs (org_id, done_at) where status = 'failed';
`;

export interface Folder {
  root: string;
  dataDir: string;
  dbDir: string;
}

/** A data folder (root = the app's data folder, db inside it). */
export function folder(): Folder {
  const root = tempFolder();
  return { root, dataDir: root, dbDir: join(root, "db") };
}

/** Opens the folder's database as the app does (the WAL guard on; its scheduler out of the tests' way). */
export async function openDb(f: Folder, log?: Logger): Promise<PgliteDb> {
  const db = await createPgliteDb({ dataDir: f.dbDir, vector: false, log, wal: { pollMs: 3_600_000 } });
  await db.exec(MINIMAL_SCHEMA);
  return db;
}

/** A table of `rows` rows of about `pad` bytes, then all but every `keep`-th row deleted (dead, hint bits not set). */
export async function bloat(db: PgliteDb, table: string, rows: number, pad = 200, keep = 10): Promise<void> {
  await db.exec(`create table if not exists ${table} (id int primary key, pad text)`);
  await db.exec(`insert into ${table} select g, repeat('b', ${pad}) from generate_series(1, ${rows}) g`);
  if (keep > 1) await db.exec(`delete from ${table} where id % ${keep} <> 0`);
}

export async function size(db: PgliteDb, table: string): Promise<number> {
  return Number((await db.one<{ b: number }>(`select pg_total_relation_size($1::regclass)::float8 as b`, [table]))!.b);
}

/** The table's rows as a fingerprint: count, sum and a hash of the ids and their values. */
export async function fingerprint(db: PgliteDb, table: string): Promise<{ n: number; sum: number; md5: string }> {
  const r = await db.one<{ n: number; sum: number; md5: string }>(`select count(*)::int as n, coalesce(sum(id), 0)::float8 as sum, md5(coalesce(string_agg(id::text || ':' || md5(pad), ',' order by id), '')) as md5 from ${table}`);
  return { n: Number(r!.n), sum: Number(r!.sum), md5: r!.md5 };
}

/** Old finished jobs (and the ones the retention keeps) in sm_jobs. */
export async function jobs(db: PgliteDb, n: { oldDone?: number; newDone?: number; oldFailed?: number; newFailed?: number; queued?: number; running?: number; pad?: number }): Promise<void> {
  const pad = n.pad ?? 300;
  const put = async (count: number | undefined, kind: string, status: string, doneAt: string | null) => {
    if (!count) return;
    await db.exec(
      `insert into sm_jobs (id, kind, payload, status, done_at, locked_until) select gen_random_uuid(), '${kind}', jsonb_build_object('p', repeat('j', ${pad})), '${status}', ${doneAt ?? "null"}, ${status === "running" ? "now() + interval '5 minutes'" : "null"} from generate_series(1, ${count})`,
    );
  };
  await put(n.oldDone, "old.done", "done", "now() - interval '5 days'");
  await put(n.newDone, "new.done", "done", "now() - interval '1 day'");
  await put(n.oldFailed, "old.failed", "failed", "now() - interval '40 days'");
  await put(n.newFailed, "new.failed", "failed", "now() - interval '10 days'");
  await put(n.queued, "queued", "queued", null);
  await put(n.running, "running", "running", null);
}

/** WAL insert position in bytes. */
export async function walAt(db: PgliteDb): Promise<number> {
  return Number((await db.one<{ b: number }>(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), '0/0')::float8 as b`))!.b);
}

/** Options that let a small test database through the gate and the thresholds. */
export const SMALL = { gateBytes: 1, phaseBytes: 1, candidateBytes: 1 * MB, bigTableBytes: 1 * MB } as const;
