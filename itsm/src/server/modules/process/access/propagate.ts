// Access settings of a process reach its cases (design F §3.5 «Publish», review #31, package F4b): who manages a
// process (named managers, manager groups) and whether its cases are confidential take effect on publish and reach
// EVERY case of the process, open or closed — one system update in the publish's transaction (F4c calls it). The
// rows change, so they re-sync: a new manager's Windows app pulls the cases, a removed one's receives tombstones, and
// a case made confidential leaves the area readers' apps the same way.
// A case's side rows (journal entries, attachments, links) travel only when they change, and a person who could not
// read them got tombstones for them. So whenever a case's readers widen — a participant, a manager or a manager group
// joins it, a round opens (a reader's new step shows more fields, hence more files), or it stops being confidential —
// its side rows take a new revision in the same transaction (`restampCaseSides`), and the next pull brings them.
import type { WriteArgs } from "../../../engine";
import type { Row } from "../../../engine/hooks";
import { pgArray, type Queryable } from "../../../db";

export interface AccessSettings {
  managers: readonly string[];
  manager_groups: readonly string[];
  confidential: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (v: readonly string[]) => [...new Set(v.filter((x) => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))].sort();

/**
 * Give a case's journal entries, attachments and links a new revision (inside the caller's transaction), keeping
 * their times: the next pull of each reader brings them. The sync trigger stamps the revision; `itsm.applying` keeps
 * `updated_at` and keeps the rows out of a Windows app's outbox.
 */
export async function restampCaseSides(q: Queryable, orgId: string, caseIds: readonly string[]): Promise<void> {
  const list = [...new Set(caseIds.filter((x) => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];
  if (!list.length) return;
  const was = await q.one<{ v: string | null }>(`select current_setting('itsm.applying', true) as v`);
  await q.query(`select set_config('itsm.applying', 'on', true)`);
  try {
    const arr = pgArray(list);
    for (const t of ["sm_journal", "sm_attachments"]) {
      await q.query(`update ${t} set rev = rev where org_id = $1 and table_key = 'process_case' and record_id = any($2::uuid[])`, [orgId, arr]);
    }
    await q.query(
      `update sm_links set rev = rev where org_id = $1
         and ((from_table = 'process_case' and from_id = any($2::uuid[])) or (to_table = 'process_case' and to_id = any($2::uuid[])))`,
      [orgId, arr],
    );
  } finally {
    await q.query(`select set_config('itsm.applying', $1, true)`, [was?.v ?? ""]);
  }
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);
const roundsOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Did a write let someone read the case who could not, or a reader see more of it (a round opened)? */
export function readersWidened(prev: Row, next: Row): boolean {
  const gained = (k: string) => {
    const before = new Set(listOf(prev[k]));
    return listOf(next[k]).some((x) => !before.has(x));
  };
  if (gained("participants") || gained("managers") || gained("manager_groups")) return true;
  if (prev.confidential === true && next.confidential !== true) return true;
  const a = roundsOf(prev.open_rounds);
  return Object.entries(roundsOf(next.open_rounds)).some(([k, v]) => Number(a[k]) !== Number(v));
}

/** `afterWrite` on `process_case`: the side rows follow a widening (see the header). */
export async function caseReadersHook(w: WriteArgs & { row: Row }): Promise<void> {
  if (!w.prev || (w.op !== "update" && w.op !== "transition") || !readersWidened(w.prev, w.row)) return;
  await restampCaseSides(w.tx, w.ctx.org.id, [String(w.row.id)]);
}

/** Give every case of `processId` these access settings (inside the caller's transaction). Returns how many changed. */
export async function propagateAccess(q: Queryable, orgId: string, processId: string, s: AccessSettings): Promise<number> {
  const managers = JSON.stringify(ids(s.managers));
  const groups = JSON.stringify(ids(s.manager_groups));
  const rows = await q.query<{ id: string; wider: boolean }>(
    `with prior as (
       select id, managers, manager_groups, confidential from sm_process_cases
       where org_id = $1 and process_id = $2
         and (managers is distinct from $3::jsonb or manager_groups is distinct from $4::jsonb or confidential is distinct from $5)
       for update
     )
     update sm_process_cases c set managers = $3::jsonb, manager_groups = $4::jsonb, confidential = $5, updated_at = now()
     from prior where c.id = prior.id
     returning c.id, (not coalesce($3::jsonb <@ prior.managers, false) or not coalesce($4::jsonb <@ prior.manager_groups, false)
       or (coalesce(prior.confidential, false) and not $5)) as wider`,
    [orgId, processId, managers, groups, !!s.confidential],
  );
  // a new manager (or a lifted confidentiality) reads these cases now: their side rows follow
  await restampCaseSides(q, orgId, rows.filter((r) => r.wider).map((r) => String(r.id)));
  return rows.length;
}
