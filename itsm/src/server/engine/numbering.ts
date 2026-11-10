// Record numbers: INC0001234 = the table's prefix + a counter per organisation and table, zero padded (the column
// `no` holds the counter, `number` is generated from it). The counter (sm_numbers) is advanced inside the write
// transaction, so numbers have no gaps and two concurrent creates never get the same one: the counter row is locked
// until commit, and a rolled-back create gives its number back. The counter never falls behind the table: rows that
// arrived by synchronisation with higher numbers are taken into account (`greatest`). Numbers of deleted records are
// never reused (the unique index (org_id, no) covers them).
//
// Offline (Windows app): numbers are allocated the same way from the local counter; when two runtimes created the
// same number, the cloud gives the pushed record the next free number and the desktop takes it over (sync/apply.ts,
// with `allocateNumber` as the aggregate's `nextNumber`).
import type { TableDef } from "@shared/model/types";
import type { Queryable } from "../db";

/** Allocate the next number of `def` for the organisation (call inside the write transaction). */
export async function allocateNumber(q: Queryable, def: TableDef, orgId: string): Promise<number> {
  if (!def.numbered) throw new Error(`table "${def.key}" is not numbered`);
  const r = await q.one<{ last: number }>(
    `insert into sm_numbers (org_id, table_key, last)
     values ($1, $2, (select coalesce(max(no), 0) + 1 from ${def.table} where org_id = $1))
     on conflict (org_id, table_key) do update
       set last = greatest(sm_numbers.last, (select coalesce(max(no), 0) from ${def.table} where org_id = $1)) + 1
     returning last`,
    [orgId, def.key],
  );
  return Number(r!.last);
}

/** The display form of a counter: prefix + zero padded (the same expression as the generated `number` column). */
export function formatNumber(def: TableDef, no: number | null | undefined): string | null {
  if (!def.numbered || no === null || no === undefined) return null;
  const s = String(no);
  return def.numbered.prefix + (s.length >= def.numbered.pad ? s : s.padStart(def.numbered.pad, "0"));
}
