// Access settings of a process reach its cases (design F §3.5 «Publish», review #31, package F4b): who manages a
// process (named managers, manager groups) and whether its cases are confidential take effect on publish and reach
// EVERY case of the process, open or closed — one system update in the publish's transaction (F4c calls it). The
// rows change, so they re-sync: a new manager's Windows app pulls the cases, a removed one's receives tombstones, and
// a case made confidential leaves the area readers' apps the same way.
import type { Queryable } from "../../../db";

export interface AccessSettings {
  managers: readonly string[];
  manager_groups: readonly string[];
  confidential: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (v: readonly string[]) => [...new Set(v.filter((x) => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))].sort();

/** Give every case of `processId` these access settings (inside the caller's transaction). Returns how many changed. */
export async function propagateAccess(q: Queryable, orgId: string, processId: string, s: AccessSettings): Promise<number> {
  const managers = JSON.stringify(ids(s.managers));
  const groups = JSON.stringify(ids(s.manager_groups));
  const rows = await q.query<{ id: string }>(
    `update sm_process_cases set managers = $3::jsonb, manager_groups = $4::jsonb, confidential = $5, updated_at = now()
     where org_id = $1 and process_id = $2
       and (managers is distinct from $3::jsonb or manager_groups is distinct from $4::jsonb or confidential is distinct from $5)
     returning id`,
    [orgId, processId, managers, groups, !!s.confidential],
  );
  return rows.length;
}
