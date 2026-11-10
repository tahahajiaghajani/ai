// Archival of old closed records (docs/PERFORMANCE_FA.md §۸): an organisation may move the closed records of its work
// tables that nobody touched for N years (setting `archive: { enabled, years }`) out of the hot tables into their
// archives (ddl.ts `archiveDdl`: same columns, fewer indexes, no sync trigger). They stay readable through the access
// provider — lists and aggregates with `archived`, the record, its journal and history read-only — and searchable
// (the stored search document moves with them).
//
// The job `engine.archive` (per organisation, nightly, small batches under the write lock) copies a batch into the
// archive and leaves a tombstone in the hot table (`deleted_at`, a new sync revision), so Windows apps drop their copies;
// tombstones of archived records are removed for good after 30 days. Display labels of archived records read
// « (بایگانی)». Journal, history, links and attachments stay where they are (keyed by the record id).
import type { TableDef } from "@shared/model/types";
import { physicalTables } from "@shared/tables";
import type { Ctx, OrgRow } from "../context";
import { pgArray, type Queryable } from "../db";
import { enqueue, registerJobHandler, type JobContext } from "../jobs";
import { archivable, archiveTableOf } from "./ddl";
import { systemCtx } from "./env";

export interface ArchiveSettings {
  enabled: boolean;
  /** records closed and untouched for this many years move (1–30) */
  years: number;
}

export const ARCHIVE_DEFAULT_YEARS = 3;
/** Records moved per transaction (each batch holds the organisation's write lock briefly). */
export const ARCHIVE_BATCH = 500;
/** Days a tombstone of an archived record stays in the hot table (Windows apps learn of it). */
export const ARCHIVE_TOMBSTONE_DAYS = 30;

export function archiveSettings(org: Pick<OrgRow, "settings">): ArchiveSettings {
  const a = (org.settings?.archive ?? {}) as Record<string, unknown>;
  const years = Number(a.years);
  return { enabled: a.enabled === true, years: Number.isInteger(years) && years >= 1 && years <= 30 ? years : ARCHIVE_DEFAULT_YEARS };
}

/** The archivable tables (numbered work records with an open/closed flag, not scoped by a parent). */
export function archivableTables(): TableDef[] {
  return physicalTables().filter(archivable);
}

const columnsCache = new Map<string, string[]>();

/** Columns the hot table and its archive both have (the archive keeps generated values as stored). */
async function sharedColumns(q: Queryable, def: TableDef): Promise<string[]> {
  const arc = archiveTableOf(def);
  const hit = columnsCache.get(arc);
  if (hit) return hit;
  const rows = await q.query<{ column_name: string }>(
    `select h.column_name from information_schema.columns h
     join information_schema.columns a on a.table_schema = h.table_schema and a.table_name = $2 and a.column_name = h.column_name
     where h.table_schema = current_schema() and h.table_name = $1 order by h.ordinal_position`,
    [def.table, arc],
  );
  const cols = rows.map((r) => r.column_name);
  if (cols.length) columnsCache.set(arc, cols);
  return cols;
}

/**
 * Move one batch of `def`'s records of the organisation closed (inactive) and untouched for `years` years into the
 * archive, oldest first, leaving tombstones. Returns how many moved.
 */
export async function archiveBatch(sys: Ctx, def: TableDef, years: number, limit = ARCHIVE_BATCH): Promise<number> {
  if (!archivable(def)) return 0;
  const cols = (await sharedColumns(sys.db, def)).map((c) => `"${c}"`).join(", ");
  if (!cols) return 0;
  return sys.write(async (tx) => {
    // the oldest untouched rows first (the hot table's updated_at index, read backwards)
    const ids = (
      await tx.query<{ id: string }>(
        `select id from ${def.table} where org_id = $1 and deleted_at is null and not active and updated_at < now() - make_interval(years => $2)
         order by updated_at, id limit ${Math.max(1, Math.trunc(limit))} for update skip locked`,
        [sys.org.id, years],
      )
    ).map((r) => r.id);
    if (!ids.length) return 0;
    const list = pgArray(ids);
    await tx.query(`insert into ${archiveTableOf(def)} (${cols}) select ${cols} from ${def.table} where id = any($1::uuid[]) on conflict (id) do nothing`, [list]);
    // a tombstone: Windows apps that hold the record delete their copy (the sync trigger gives it a new revision)
    await tx.query(`update ${def.table} set deleted_at = now() where id = any($1::uuid[]) and org_id = $2`, [list, sys.org.id]);
    return ids.length;
  });
}

/** Remove for good the tombstones of records archived more than ARCHIVE_TOMBSTONE_DAYS ago. Returns how many. */
export async function purgeArchived(sys: Ctx, def: TableDef, limit = 2000): Promise<number> {
  if (!archivable(def)) return 0;
  const rows = await sys.db.query<{ id: string }>(
    `delete from ${def.table} t where t.id in (
       select a.id from ${archiveTableOf(def)} a join ${def.table} h on h.id = a.id
       where a.org_id = $1 and a.archived_at < now() - make_interval(days => ${ARCHIVE_TOMBSTONE_DAYS}) and h.deleted_at is not null
       limit ${Math.max(1, Math.trunc(limit))})
     returning t.id`,
    [sys.org.id],
  );
  return rows.length;
}

/** Milliseconds until the next 02:00 in the organisation's time zone (the nightly run). */
function untilNight(tz: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const minutes = ((26 - h) % 24) * 60 - m;
  return Math.max(60_000, (minutes <= 0 ? minutes + 1440 : minutes) * 60_000);
}

/** Queue the organisation's archival run (now, or at its next night) unless one is queued. */
export async function scheduleArchive(q: Queryable, orgId: string, opts: { now?: boolean; tz?: string } = {}): Promise<void> {
  await enqueue(q, { kind: "engine.archive", orgId, dedupeKey: "engine.archive", delayMs: opts.now ? 0 : untilNight(opts.tz ?? "Asia/Tehran"), maxAttempts: 5 });
  // «اجرا اکنون» brings a run already queued for the night forward
  if (opts.now) await q.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'engine.archive' and status = 'queued' and run_at > now()`, [orgId]);
}

registerJobHandler("engine.archive", async (job, jctx: JobContext) => {
  if (!job.org_id) return;
  const sys = await systemCtx(jctx.cfg, job.org_id).catch(() => null);
  if (!sys) return;
  const settings = archiveSettings(sys.org);
  // switched off: nothing runs (switching it on queues the next run)
  if (!settings.enabled) return;
  const tz = (sys.org.settings?.timezone as string | undefined) || "Asia/Tehran";
  const progress = { ...(job.payload ?? {}) } as Record<string, number>;
  for (const def of archivableTables()) {
    for (;;) {
      if (Date.now() > jctx.deadline - 1500) {
        await jctx.save(progress);
        return { again: 0 };
      }
      const moved = await archiveBatch(sys, def, settings.years);
      if (moved) progress[def.key] = (progress[def.key] ?? 0) + moved;
      if (moved < ARCHIVE_BATCH) break;
    }
    await purgeArchived(sys, def);
  }
  jctx.log.info?.("archive run finished", { org: job.org_id, moved: progress });
  await jctx.save({});
  return { again: untilNight(tz) };
});

/** What an organisation's archive holds, per table (counted up to 100 000) — the settings page. */
export async function archiveSummary(ctx: Ctx): Promise<{ settings: ArchiveSettings; tables: { key: string; label: string; archived: number; capped: boolean }[] }> {
  const tables: { key: string; label: string; archived: number; capped: boolean }[] = [];
  for (const def of archivableTables()) {
    const r = await ctx.db.one<{ n: number }>(`select count(*)::int as n from (select 1 from ${archiveTableOf(def)} where org_id = $1 limit 100001) x`, [ctx.org.id]).catch(() => null);
    const n = Number(r?.n ?? 0);
    tables.push({ key: def.key, label: def.plural, archived: Math.min(n, 100_000), capped: n > 100_000 });
  }
  return { settings: archiveSettings(ctx.org), tables };
}
