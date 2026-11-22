// Queueing the organisation's `process.reresolve` (release 1.1.5; the job itself is ./index.ts): a little after
// anything that may give a workflow step waiting with nobody its people, whichever path wrote it —
//   · the record engine: holders, positions, groups, group members, roles and members' profiles (the watch in
//     ./index.ts: the generic API, the holder import, an import set, a Windows app's pushed record, the directory's
//     holders, groups and profiles);
//   · a membership made active again or given another role, which no record event carries: the members page
//     (routes/org.ts), a Windows app's push of a membership (routes/sync.ts), and the one place that creates and switches
//     memberships in bulk (../../admin/members.ts: the members' import, LDAP/AD synchronisation, SCIM, a directory
//     sign-in).
// One queued job per organisation (its dedupe key), run a quiet half minute after the first change, and only while some
// case waits. Light on purpose: those paths import nothing else of the workflows.
import type { Queryable } from "../../../db";
import { enqueue } from "../../../jobs";

export const RERESOLVE_JOB = "process.reresolve";
/** Changes of a burst (an import of holders, a directory sync) are taken together: the job runs this long after the first. */
export const QUIET_MS = 30_000;

/**
 * Queue the organisation's re-resolution a little after people's places change — once (a later change while it waits
 * starts its pass from the beginning), and only while some case waits.
 */
export async function queueReresolve(q: Queryable, orgId: string): Promise<void> {
  if (!(await q.one(`select 1 as x from sm_process_cases where org_id = $1 and state = 'waiting' and deleted_at is null limit 1`, [orgId]))) return;
  await enqueue(q, { kind: RERESOLVE_JOB, orgId, delayMs: QUIET_MS, dedupeKey: RERESOLVE_JOB, maxAttempts: 5 });
  await q.query(`update sm_jobs set payload = '{}'::jsonb where org_id = $1 and dedupe_key = $2 and status = 'queued' and payload <> '{}'::jsonb`, [orgId, RERESOLVE_JOB]);
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
