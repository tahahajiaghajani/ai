// Background work of the discovery module (design A §7.2). Handlers run outside any transaction and open their own;
// the Windows app runs none of it (§14.7).
//
//   discovery.sweep        per organisation, every 5 minutes on the server edition and 15 on the web version, while it
//                          has an active connector: queues due pulls and status passes (a demo connector's inside the
//                          demo scope, §14.4), resumes a pass whose worker vanished, and once a day queues retries of
//                          connectors run by hand and every active connector's contact ladder, tells the asset managers
//                          of new mismatches, and keeps runs 90 days (the last 20 per lane and the last complete inventory
//                          pass always) and batches 30 days
//   discovery.pull         one slice of a connector's inventory pass (runner.ts)
//   discovery.status       a status pass (DA2's status.ts)
//   discovery.stale        the contact ladder (stale.ts): after a complete pass, after «پذیرش اندازهٔ تازه», and daily
// DA2 adds discovery.push_batch and discovery.device_apply, DA7 discovery.itam. At most two discovery jobs of an
// organisation work at once (§7.1): the others come back in 30 seconds.
import type { RunTrigger } from "@shared/discovery/types";
import type { ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { demoScopeOrg, inDemoScope, isDemoRow } from "../../db/scope";
import { systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type Job, type JobContext, type JobResult } from "../../jobs";
import { isUuid } from "../incident/common";
import { BUSY_AGAIN_MS, MAX_DISCOVERY_JOBS } from "./budget";
import { editionOf } from "./net";
import { serverKind } from "./registry";
import { mismatchDigest } from "./mismatch";
import { runPull } from "./runner";
import { staleJob } from "./stale";
import { statusPass } from "./status";

export const JOB_KINDS = {
  sweep: "discovery.sweep",
  pull: "discovery.pull",
  status: "discovery.status",
  pushBatch: "discovery.push_batch",
  deviceApply: "discovery.device_apply",
  stale: "discovery.stale",
  itam: "discovery.itam",
} as const;

/** Minimum intervals in minutes (§3): inventory 15 on the web version and 5 on the server; status 15 and 1. */
export const MIN_EVERY_MINUTES = { cloud: 15, server: 5 } as const;
export const MIN_STATUS_EVERY_MINUTES = { cloud: 15, server: 1 } as const;
export const RUN_KEEP_DAYS = 90;
export const RUN_KEEP_LAST = 20;
export const BATCH_KEEP_DAYS = 30;
/** A running pass untouched this long whose worker is gone is abandoned. */
const ABANDON_HOURS = 24;
/** A running pass untouched this long gets its job queued again (its worker died). */
const RESUME_AFTER_MS = 10 * 60_000;
const DAILY_MS = 20 * 3600_000;

type Cfg = Pick<ServerConfig, "db"> & Partial<ServerConfig>;

/** How often an organisation's sweep runs (§3, §7.2). */
export function sweepEveryMs(cfg: Partial<Pick<ServerConfig, "mode" | "server">>): number {
  return editionOf({ mode: cfg.mode ?? "cloud", server: cfg.server }) === "server" ? 5 * 60_000 : 15 * 60_000;
}

const lastEnsure = new Map<string, number>();
const lastDaily = new Map<string, number>();
export const resetDiscoveryThrottles = () => {
  lastEnsure.clear();
  lastDaily.clear();
};

/** Queue the organisation's sweep (one queued per organisation), from a write's transaction (the outbox). */
export async function ensureSweepIn(q: Queryable, orgId: string, delayMs = 30_000): Promise<void> {
  await enqueue(q, { kind: JOB_KINDS.sweep, orgId, delayMs, dedupeKey: JOB_KINDS.sweep, maxAttempts: 5 });
}

/** The same at most once per ten minutes per process (callers outside a write). */
export async function ensureDiscoverySweep(q: Queryable, orgId: string, delayMs = 60_000): Promise<void> {
  if (Date.now() - (lastEnsure.get(orgId) ?? 0) < 10 * 60_000) return;
  lastEnsure.set(orgId, Date.now());
  await ensureSweepIn(q, orgId, delayMs);
}

export interface QueuePullOptions {
  trigger?: RunTrigger;
  /** «اعمال دوباره روی همه» */
  reapply?: boolean;
  /** retries only, no listing */
  retryOnly?: boolean;
  /** the connector is a demo row (the caller is inside the demo scope) */
  demo?: boolean;
  delayMs?: number;
}

/**
 * Queue a slice of a connector's pass (one queued per connector). A reapply asked while a pull waits in the queue is
 * added to that pull; a pass already running takes it on at its next slice.
 */
export async function queuePull(q: Queryable, orgId: string, connectorId: string, opts: QueuePullOptions = {}): Promise<string> {
  const id = await enqueue(q, {
    kind: JOB_KINDS.pull,
    orgId,
    payload: { connector: connectorId, trigger: opts.trigger ?? "schedule", ...(opts.reapply ? { reapply: true } : {}), ...(opts.retryOnly ? { retry_only: true } : {}), ...(opts.demo ? { __demo: true } : {}) },
    delayMs: opts.delayMs,
    dedupeKey: `${JOB_KINDS.pull}:${connectorId}`,
    maxAttempts: 8,
  });
  // the queued twin: a reapply joins it, and a pull with listing outranks a retry-only one
  if (opts.reapply || !opts.retryOnly) {
    await q.query(
      `update sm_jobs set payload = (payload - 'retry_only') || $3::jsonb, updated_at = now()
       where id = $1 and org_id = $2 and status = 'queued'`,
      [id, orgId, JSON.stringify(opts.reapply ? { reapply: true } : {})],
    );
  }
  return id;
}

/** Discovery jobs of an organisation working now, other than `jobId` (the sweep never counts). */
export async function busyDiscoveryJobs(q: Queryable, orgId: string, jobId: string): Promise<number> {
  const r = await q.one<{ n: number }>(
    `select count(*)::int as n from sm_jobs where org_id = $1 and status = 'running' and id <> $2 and kind like 'discovery.%' and kind <> $3 and locked_until > now()`,
    [orgId, jobId, JOB_KINDS.sweep],
  );
  return r?.n ?? 0;
}

/**
 * Run a connector's work in the right scope (§14.4): a demo connector's always inside its organisation's demo scope
 * (its writes are demo rows), a real one's never — whatever scope the job came with.
 */
export async function inConnectorScope<T>(q: Queryable, orgId: string, connectorId: string, fn: (demo: boolean) => Promise<T>): Promise<T> {
  const demo = await isDemoRow(q, orgId, connectorId);
  if (demo) return demoScopeOrg() === orgId ? fn(true) : inDemoScope(orgId, () => fn(true));
  return demoScopeOrg() ? inDemoScope(null, () => fn(false)) : fn(false);
}

/** The guard every connector job starts with: an organisation, a server that runs connectors, room among the jobs. */
async function admitted(job: Job, jctx: JobContext): Promise<{ orgId: string; connector: string } | JobResult | null> {
  if (!job.org_id || editionOf({ mode: jctx.cfg.mode ?? "cloud", server: jctx.cfg.server }) === "desktop") return null;
  const connector = String(job.payload?.connector ?? "");
  if (!isUuid(connector)) return null;
  if ((await busyDiscoveryJobs(jctx.db, job.org_id, job.id)) >= MAX_DISCOVERY_JOBS) return { again: BUSY_AGAIN_MS };
  return { orgId: job.org_id, connector };
}

interface SweepRow {
  id: string;
  kind: string;
  active: boolean;
  every_minutes: number | null;
  status_every_minutes: number | null;
  collect: string[] | null;
  last_inventory: string | null;
  last_status: string | null;
  running_updated: string | null;
  retries_due: boolean;
  demo: boolean;
}

/** One sweep of an organisation: what it queued, and when it should run again (null: no active connector left). */
export async function discoverySweep(cfg: Cfg, orgId: string): Promise<{ queued: number; again: number | null }> {
  const db = cfg.db;
  const rows = await db.query<SweepRow>(
    `select c.id, c.kind, c.active, c.every_minutes, c.status_every_minutes, c.collect,
       (select max(r.started_at) from sm_discovery_runs r where r.org_id = c.org_id and r.connector_id = c.id and r.lane = 'inventory' and r.deleted_at is null) as last_inventory,
       (select max(r.started_at) from sm_discovery_runs r where r.org_id = c.org_id and r.connector_id = c.id and r.lane = 'status' and r.deleted_at is null) as last_status,
       (select max(r.updated_at) from sm_discovery_runs r where r.org_id = c.org_id and r.connector_id = c.id and r.lane = 'inventory' and r.state = 'running') as running_updated,
       exists (select 1 from sm_discovery_items i where i.org_id = c.org_id and i.connector_id = c.id and i.deleted_at is null
                 and i.state in ('unmatched', 'duplicate', 'error') and i.retry_at <= now()) as retries_due,
       exists (select 1 from sm_demo_rows d where d.org_id = c.org_id and d.row_id = c.id) as demo
     from sm_discovery_connectors c where c.org_id = $1 and c.deleted_at is null`,
    [orgId],
  );
  const now = Date.now();
  const daily = now - (lastDaily.get(orgId) ?? 0) >= DAILY_MS;
  let queued = 0;
  let active = 0;
  for (const c of rows) {
    if (!c.active) continue;
    active++;
    // a demo connector's jobs are queued inside the demo scope with `__demo` (§14.4), a real one's outside it
    const scoped = <T,>(fn: () => Promise<T>) => (c.demo ? inDemoScope(orgId, fn) : inDemoScope(null, fn));
    const every = Number(c.every_minutes ?? 0);
    if (c.running_updated) {
      // a pass is running: queue its job again only when its worker went quiet
      if (now - Date.parse(c.running_updated) >= RESUME_AFTER_MS) {
        await scoped(() => queuePull(db, orgId, c.id, { trigger: "schedule", demo: c.demo }));
        queued++;
      }
    } else if (every > 0 && (!c.last_inventory || now - Date.parse(c.last_inventory) >= every * 60_000)) {
      await scoped(() => queuePull(db, orgId, c.id, { trigger: "schedule", demo: c.demo }));
      queued++;
    } else if (daily && c.retries_due) {
      // unmatched, duplicate and error items are retried every retry_hours even when the tool is not listed (§7.4)
      await scoped(() => queuePull(db, orgId, c.id, { trigger: "schedule", retryOnly: true, demo: c.demo }));
      queued++;
    }
    const statusEvery = Number(c.status_every_minutes ?? 0);
    const kind = serverKind(c.kind);
    if (kind?.status && (c.collect ?? []).includes("status") && statusEvery > 0 && (!c.last_status || now - Date.parse(c.last_status) >= statusEvery * 60_000)) {
      await scoped(() =>
        enqueue(db, { kind: JOB_KINDS.status, orgId, payload: { connector: c.id, ...(c.demo ? { __demo: true } : {}) }, dedupeKey: `${JOB_KINDS.status}:${c.id}`, maxAttempts: 5 }),
      );
      queued++;
    }
    if (daily) {
      // the contact ladder ages on the calendar, not only on passes (§10): a silent machine goes stale and missing even
      // when nothing is listed any more
      await scoped(() => enqueue(db, { kind: JOB_KINDS.stale, orgId, payload: { connector: c.id, ...(c.demo ? { __demo: true } : {}) }, dedupeKey: `${JOB_KINDS.stale}:${c.id}`, maxAttempts: 5 }));
      queued++;
    }
  }
  if (daily) {
    lastDaily.set(orgId, now);
    await dailyUpkeep(db, orgId);
    // «… ناهمخوانی تازه میان ابزارها و دفتر اموال» once a day (each difference told once, §8.3)
    await mismatchDigest(db, orgId).catch((e) => cfg.log?.warn?.("discovery mismatch digest failed", String((e as Error)?.message ?? e)));
  }
  return { queued, again: active ? sweepEveryMs(cfg) : null };
}

/** Runs kept 90 days (always the last 20 of each lane and the last complete inventory pass), batches 30, and passes whose worker is long gone abandoned. */
export async function dailyUpkeep(q: Queryable, orgId: string): Promise<{ runs: number; batches: number; abandoned: number }> {
  const abandoned = await q.query(
    `update sm_discovery_runs set state = 'abandoned', finished_at = now(), lease_by = null, lease_until = null, updated_at = now()
     where org_id = $1 and state = 'running' and updated_at < now() - interval '${ABANDON_HOURS} hours' and (lease_until is null or lease_until < now()) returning id`,
    [orgId],
  );
  const runs = await q.query(
    `delete from sm_discovery_runs r where r.org_id = $1 and r.state <> 'running' and r.started_at < now() - interval '${RUN_KEEP_DAYS} days'
       and r.id not in (select id from (select id, row_number() over (partition by connector_id, lane order by started_at desc) as n from sm_discovery_runs where org_id = $1) k where k.n <= ${RUN_KEEP_LAST})
       and r.id not in (select distinct on (connector_id) id from sm_discovery_runs where org_id = $1 and lane = 'inventory' and state = 'completed' and complete order by connector_id, started_at desc)
     returning r.id`,
    [orgId],
  );
  const batches = await q.query(`delete from sm_discovery_batches where org_id = $1 and received_at < now() - interval '${BATCH_KEEP_DAYS} days' returning id`, [orgId]);
  return { runs: runs.length, batches: batches.length, abandoned: abandoned.length };
}

let installed = false;

/** The module's job handlers (once per process, from installDiscoveryModule). */
export function installDiscoveryJobs(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(JOB_KINDS.sweep, async (job, jctx) => {
    if (!job.org_id || editionOf({ mode: jctx.cfg.mode ?? "cloud", server: jctx.cfg.server }) === "desktop") return;
    try {
      const r = await discoverySweep(jctx.cfg, job.org_id);
      return r.again ? { again: r.again } : undefined;
    } catch (e) {
      // the sweep is the connectors' only clock: an error never ends it (the next round tries again)
      jctx.log.warn("discovery sweep failed", String((e as Error)?.message ?? e));
      return { again: sweepEveryMs(jctx.cfg) };
    }
  });
  registerJobHandler(JOB_KINDS.pull, async (job, jctx) => {
    const a = await admitted(job, jctx);
    if (!a || !("orgId" in a)) return a ?? undefined;
    return inConnectorScope(jctx.db, a.orgId, a.connector, async (demo) => {
      const sys = await systemCtx(jctx.cfg, a.orgId);
      const p = job.payload ?? {};
      // a preview is never a pass (runner.ts previewConnector)
      const trigger: RunTrigger = p.trigger === "manual" || p.trigger === "push" ? p.trigger : "schedule";
      return runPull(sys, a.connector, jctx, { worker: job.id, trigger, reapply: p.reapply === true, retryOnly: p.retry_only === true, demo });
    });
  });
  registerJobHandler(JOB_KINDS.status, async (job, jctx) => {
    const a = await admitted(job, jctx);
    if (!a || !("orgId" in a)) return a ?? undefined;
    return inConnectorScope(jctx.db, a.orgId, a.connector, async () => statusPass(await systemCtx(jctx.cfg, a.orgId), a.connector, jctx));
  });
  registerJobHandler(JOB_KINDS.stale, async (job, jctx) => {
    const a = await admitted(job, jctx);
    if (!a || !("orgId" in a)) return a ?? undefined;
    return inConnectorScope(jctx.db, a.orgId, a.connector, async () => staleJob(await systemCtx(jctx.cfg, a.orgId), a.connector, job, jctx));
  });
}
