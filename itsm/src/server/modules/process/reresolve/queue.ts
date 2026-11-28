// Queueing the organisation's `process.reresolve` (release 1.1.5; the job itself is ./index.ts): a little after
// anything that may give a workflow step waiting with nobody its people, whichever path wrote it —
//   · the record engine: holders, positions, groups, group members, roles, members' profiles and units — their heads,
//     whether they are active, their kinds and places in the tree (the watch in ./index.ts: the generic API, the
//     holder import, an import set, a Windows app's pushed record, the directory's holders, groups and profiles);
//   · a membership made active again or given another role, which no record event carries: the members page
//     (routes/org.ts), a Windows app's push of a membership (routes/sync.ts), and the one place that creates and switches
//     memberships in bulk (../../admin/members.ts: the members' import, LDAP/AD synchronisation, SCIM, a directory
//     sign-in).
// One queued job per organisation (its dedupe key), run a quiet half minute after the first change, and only while some
// case waits. A holding or a group membership whose period starts later also queues a pass for when it starts
// (`queueReresolveAt`, engine-access-4): the quiet half minute's finds nobody yet. Light on purpose: those paths import
// nothing else of the workflows.
import type { Queryable } from "../../../db";
import { enqueue } from "../../../jobs";

export const RERESOLVE_JOB = "process.reresolve";
/** Changes of a burst (an import of holders, a directory sync) are taken together: the job runs this long after the first. */
export const QUIET_MS = 30_000;
/**
 * A pass for a period that starts later runs this long after its start: the clock that queues and claims the job (the
 * database's) and the one the rules read the day by (the server's, a web function's) may differ a little.
 */
export const STARTS_MARGIN_MS = 60_000;

/**
 * Queue the organisation's re-resolution a little after people's places change — once (a later change while it waits
 * starts its pass from the beginning), and only while some case waits.
 */
export async function queueReresolve(q: Queryable, orgId: string): Promise<void> {
  if (!(await q.one(`select 1 as x from sm_process_cases where org_id = $1 and state = 'waiting' and deleted_at is null limit 1`, [orgId]))) return;
  await enqueue(q, { kind: RERESOLVE_JOB, orgId, delayMs: QUIET_MS, dedupeKey: RERESOLVE_JOB, maxAttempts: 5 });
  await q.query(`update sm_jobs set payload = '{}'::jsonb where org_id = $1 and dedupe_key = $2 and status = 'queued' and payload <> '{}'::jsonb`, [orgId, RERESOLVE_JOB]);
}

/**
 * Queue a pass of the organisation's re-resolution for when a holding or a group membership written now starts (`at`: a
 * later day's start in the organisation's time zone, a member's later moment), `STARTS_MARGIN_MS` after it — so a step
 * that waits with nobody reaches the person that day, not only when something else changes. A job of its own per
 * moment (its dedupe key names it: a change now never merges into it, nor it into the quiet half minute's), queued
 * whether or not a case waits now: one may wait by then.
 */
export async function queueReresolveAt(q: Queryable, orgId: string, at: number): Promise<void> {
  const when = new Date(at + STARTS_MARGIN_MS).toISOString();
  await enqueue(q, { kind: RERESOLVE_JOB, orgId, runAt: when, dedupeKey: `${RERESOLVE_JOB}:${when}`, maxAttempts: 5 });
}

const queuedIn = new WeakMap<object, Set<string>>();

/**
 * `queueReresolve` once per transaction and organisation: a bulk write (an import of 2 000 members, a directory sync)
 * that switches many memberships on queues one job, not one check per person. `tx` is the caller's transaction (the job
 * goes or stays with it).
 */
export async function queueReresolveIn(tx: Queryable, orgId: string): Promise<void> {
  let orgs = queuedIn.get(tx);
  if (!orgs) queuedIn.set(tx, (orgs = new Set()));
  if (orgs.has(orgId)) return;
  orgs.add(orgId);
  await queueReresolve(tx, orgId);
}
