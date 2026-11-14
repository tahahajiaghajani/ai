// Status (design A §9): item status → discovery_state per CI or asset, the status pass of a connector, the board and
// the side panel, and the event sink that turns pushed alerts into status.
//
//   · Where status lives (§9.1): per source in discovery_item (status, since, message; `listed_at` is when the tool
//     last reported it) and per target in discovery_state — never on ci or asset, so a flap is one non-synced row
//     update, no `rev` bump, no `record.updated`. Written with set-based SQL outside the organisation's lock, only when a
//     value changes.
//   · Aggregation (§9.3, @shared/discovery/status): the target's fresh sources — its items of active connectors, the
//     status a push sent for a target without an item (signal `c:<connector>`), the signals of pushed alerts (keyed by
//     event source) — and maintenance from an event-management window or a change being implemented on the CI.
//   · The job `discovery.status` (one per connector): a kind with a status or problems call reads them when due (its
//     run in lane `status`, resumable from its cursor); then the upkeep — ATMs matched to assets (device.ts), the
//     connector's targets aggregated (and targets elsewhere whose sources aged), ATM values through the hysteresis, the
//     problems sent to event management (problems.ts). The runner queues it after every inventory pass; push queues it
//     after a batch.
//   · The event sink (§9.7): an alert bound to a CI sets its event source's signal — down for availability alerts
//     (@shared/discovery/availability), warning for any other firing alert but `info`, maintenance while event
//     management holds the alert in maintenance; a clear removes it. Installations that only push alerts get live
//     status without a connector.
//   · Readers (§9.1, §14.5): the board and the panel go through the engine's read rules of the CI and the asset; tool
//     names, messages and links only for CMDB readers; requesters and the Windows app get nothing.
// A demo target's row is written only inside its demo scope, a real one's only outside it (§14.4).
import { alertSignal, recordState, VIRTUALISATION_KINDS } from "@shared/discovery/availability";
import { aggregateStatus, freshForMs, stateRank, type SourceStatus } from "@shared/discovery/status";
import { STATUS_WORDS, type DiscoveredProblem, type StatusItem, type StatusState } from "@shared/discovery/types";
import { occurrences, type WindowLike } from "@shared/change/logic";
import { grantIn, scopeRank } from "@shared/access";
import { ALERT_OPEN_STATES } from "@shared/tables/event";
import { FLEET_CATEGORIES } from "@shared/tables/itam";
import { tableDef } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../../context";
import { pgArray, type Queryable, type Tx } from "../../db";
import { demoScopeOrg, inDemoScope, isDemoRow } from "../../db/scope";
import { subjectOf } from "../../access";
import { condEnv, get, isSystemCtx, orgTz, readable, systemCtx } from "../../engine";
import { AppError, forbidden } from "../../http/errors";
import { registerJobHandler, type Job, type JobContext, type JobResult } from "../../jobs";
import { assertWritable } from "../platform/org-admin";
import { registerEventSink } from "../event/pipeline";
import { idList, isUuid, liveRows } from "../event/common";
import { busyAgainMs, MAX_DISCOVERY_JOBS, sliceEnd } from "./budget";
import { applyDevice, DEVICE_JOB, itemDeviceReports, matchAtms, observeDevices } from "./device";
import { rightsOf } from "./guard";
import { busyDiscoveryJobs, ensureDiscoverySweep, inConnectorScope } from "./jobs";
import { ConnectorError, CONNECTOR_MESSAGES } from "./kind";
import { editionOf } from "./net";
import { clearVanished, recordProblems, sendProblems } from "./problems";
import { serverKind } from "./registry";
import { connCtx, kindOptions, loadConnector, maskSecrets } from "./runner";

type Row = Record<string, any>;

export interface Target {
  table: "ci" | "asset";
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : new Date(v as string).toISOString());
export const STATUS_READ_MESSAGE = "وضعیت پایش را خوانندگان پایگاه پیکربندی و مسئولان دارایی‌ها می‌بینند";

// ---------------------------------------------------------------------------------------------------------------
// Item status (status passes, pushes)

/**
 * Statuses a tool reported for the connector's items (by its own id): the kind's verdict (§9.2) with its time, its
 * message and its record (`data.status`, where an ATM's device value is read), stamped as reported now. Items a status
 * names that the connector does not have are not created (status alone never creates). Set-based, lock-free.
 */
export async function applyItemStatuses(q: Queryable, orgId: string, connectorId: string, items: StatusItem[], at: Date): Promise<string[]> {
  const rows = items
    .filter((x) => x && typeof x.external_id === "string" && x.external_id && x.status)
    .map((x) => {
      const state = recordState(x.status) ?? "unknown";
      const since = x.status.since && Number.isFinite(Date.parse(x.status.since)) && Date.parse(x.status.since) <= at.getTime() ? new Date(x.status.since).toISOString() : null;
      return {
        external_id: x.external_id.slice(0, 200), state, since, message: x.status.message ? String(x.status.message).slice(0, 500) : null,
        status: { ...x.status, state }, last_contact_at: x.last_contact_at && Number.isFinite(Date.parse(x.last_contact_at)) ? new Date(x.last_contact_at).toISOString() : null,
      };
    });
  if (!rows.length) return [];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await q.query<{ id: string }>(
      `with x as (select * from jsonb_to_recordset($3::jsonb) as x(external_id text, state text, since timestamptz, message text, status jsonb, last_contact_at timestamptz))
       update sm_discovery_items t set
         status = x.state,
         status_since = case when t.status is distinct from x.state then coalesce(x.since, $4) else coalesce(t.status_since, x.since, $4) end,
         status_message = x.message,
         data = jsonb_set(coalesce(t.data, '{}'::jsonb), '{status}', x.status),
         listed_at = $4,
         last_contact_at = case when x.last_contact_at is not null and x.last_contact_at <= $4 and (t.last_contact_at is null or x.last_contact_at > t.last_contact_at) then x.last_contact_at else t.last_contact_at end,
         updated_at = now()
       from x where t.org_id = $1 and t.connector_id = $2 and t.deleted_at is null and t.external_id = x.external_id
       returning t.id`,
      [orgId, connectorId, JSON.stringify(rows.slice(i, i + 1000)), at.toISOString()],
    );
    out.push(...r.map((x) => x.id));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Aggregation onto targets (§9.3)

/** The targets a connector's items report: their CI, else their asset (an ATM without a CI). */
export async function connectorTargets(q: Queryable, orgId: string, connectorId: string): Promise<Target[]> {
  const rows = await q.query<{ t: string; id: string }>(
    `select distinct 'ci' as t, ci_id::text as id from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and ci_id is not null
     union
     select distinct 'asset', asset_id::text from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and ci_id is null and asset_id is not null`,
    [orgId, connectorId],
  );
  return rows.map((r) => ({ table: r.t as Target["table"], id: r.id }));
}

/** The CIs among `ciIds` inside maintenance now: an active maintenance window over them, or a change being implemented on them. */
export async function maintenanceOf(q: Queryable, sys: Ctx, ciIds: string[], now: number): Promise<Map<string, { label: string; since: string | null }>> {
  const out = new Map<string, { label: string; since: string | null }>();
  const want = new Set(ciIds);
  if (!want.size) return out;
  if (tableDef("change_window")) {
    const windows = await liveRows(q, sys, "change_window", { and: [{ f: "kind", op: "eq", v: "maintenance" }, { f: "active", op: "eq", v: true }] } as never, { limit: 300 }).catch(() => [] as Row[]);
    const tz = orgTz(sys);
    for (const w of windows) {
      const cis = idList(w.cis).filter((x) => want.has(x));
      if (!cis.length) continue;
      const occ = occurrences(w as unknown as WindowLike, now, now + 1, tz, 1);
      if (!occ.length) continue;
      for (const c of cis) if (!out.has(c)) out.set(c, { label: `پنجرهٔ نگهداری «${w.name}»`, since: new Date(occ[0].start).toISOString() });
    }
  }
  if (!tableDef("change_request")) return out;
  const list = [...want];
  const changes = await liveRows(q, sys, "change_request", {
    and: [
      { f: "state", op: "eq", v: "implement" },
      { or: [{ f: "planned_end", op: "empty" }, { f: "planned_end", op: "gte", v: new Date(now).toISOString() }] },
      { or: [{ f: "ci_id", op: "in", v: list }, { f: "affected_cis", op: "in", v: list }] },
    ],
  } as never, { order: "t.planned_start desc", limit: 500 }).catch(() => [] as Row[]);
  for (const c of changes) {
    for (const id of [...(isUuid(c.ci_id) ? [String(c.ci_id)] : []), ...idList(c.affected_cis)]) {
      if (want.has(id) && !out.has(id)) out.set(id, { label: `تغییر در حال اجرای ${c.number ?? ""}`.trim(), since: iso(c.actual_start ?? c.planned_start) });
    }
  }
  return out;
}

/** Sources of a target (and their freshness) from its row's items and signals. */
function sourcesOf(row: Row, connectors: Map<string, Row>): SourceStatus[] {
  const out: SourceStatus[] = [];
  for (const i of Array.isArray(row.items) ? row.items : []) {
    if (!i?.state) continue;
    out.push({
      state: i.state as StatusState, since: iso(i.since), message: i.message ?? null, observed_at: iso(i.at),
      fresh_ms: freshForMs({ status_every_minutes: i.status_every, every_minutes: i.every }), virtualisation: VIRTUALISATION_KINDS.has(String(i.kind)),
    });
  }
  const signals = row.signals && typeof row.signals === "object" ? (row.signals as Record<string, Row>) : {};
  for (const [key, s] of Object.entries(signals)) {
    if (!s?.state) continue;
    if (key.startsWith("c:")) {
      // a push's status for a target without an item: as fresh as its connector's interval, while it is active
      const k = connectors.get(key.slice(2));
      if (!k) continue;
      out.push({ state: s.state, since: iso(s.since), message: s.message ?? null, observed_at: iso(s.at), fresh_ms: freshForMs(k), virtualisation: VIRTUALISATION_KINDS.has(String(k.kind)) });
    } else out.push({ state: s.state, since: iso(s.since), message: s.message ?? null, fresh_ms: null });
  }
  return out;
}

/**
 * Re-key the rows of assets that gained a CI (§5.3): the row moves to the CI, or — when the CI already has one — hands
 * it its ATM columns and goes.
 */
export async function rekeyAssetRows(q: Queryable, orgId: string): Promise<void> {
  await q.query(
    `update sm_discovery_states s set target_table = 'ci', target_id = a.ci_id::text, ci_id = a.ci_id, updated_at = now()
     from sm_assets a
     where s.org_id = $1 and s.deleted_at is null and s.target_table = 'asset' and a.org_id = s.org_id and a.id = s.asset_id and a.deleted_at is null and a.ci_id is not null
       and exists (select 1 from sm_cis c where c.org_id = a.org_id and c.id = a.ci_id and c.deleted_at is null)
       and not exists (select 1 from sm_discovery_states c where c.org_id = s.org_id and c.deleted_at is null and c.target_table = 'ci' and c.target_id = a.ci_id::text)`,
    [orgId],
  );
  await q.query(
    `with moved as (
       select s.id, c.id as into_id, s.asset_id, s.device_reported, s.device_reported_since, s.device_pending, s.device_pending_since, s.device_pending_polls,
              s.device_applied, s.device_applied_at
       from sm_discovery_states s join sm_assets a on a.org_id = s.org_id and a.id = s.asset_id and a.deleted_at is null and a.ci_id is not null
       join sm_discovery_states c on c.org_id = s.org_id and c.deleted_at is null and c.target_table = 'ci' and c.target_id = a.ci_id::text
       where s.org_id = $1 and s.deleted_at is null and s.target_table = 'asset'
     ),
     merged as (
       update sm_discovery_states c set asset_id = coalesce(c.asset_id, m.asset_id),
         device_reported = coalesce(c.device_reported, m.device_reported), device_reported_since = coalesce(c.device_reported_since, m.device_reported_since),
         device_pending = coalesce(c.device_pending, m.device_pending), device_pending_since = coalesce(c.device_pending_since, m.device_pending_since),
         device_pending_polls = coalesce(c.device_pending_polls, m.device_pending_polls), device_applied = coalesce(c.device_applied, m.device_applied),
         device_applied_at = coalesce(c.device_applied_at, m.device_applied_at), updated_at = now()
       from moved m where c.id = m.into_id returning c.id
     )
     update sm_discovery_states s set deleted_at = now(), updated_at = now() from moved m where s.id = m.id`,
    [orgId],
  );
}

const AGG_CHUNK = 500;

/**
 * Recompute the status of targets from their sources and write the rows whose value changed (one set-based upsert per
 * chunk; a target nothing reports gets no row). Rows on the other side of the demo boundary are left alone. Stops at
 * `deadline` (after at least one chunk) and says how many targets it did.
 */
export async function aggregateTargets(q: Queryable, sys: Ctx, targets: Target[], opts: { now?: number; deadline?: number } = {}): Promise<{ written: number; done: number }> {
  const org = sys.org.id;
  const demo = demoScopeOrg() === org;
  const seen = new Set<string>();
  const list = targets.filter((t) => {
    const k = `${t.table}:${t.id}`;
    if ((t.table !== "ci" && t.table !== "asset") || !UUID.test(t.id) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  let written = 0;
  let done = 0;
  for (let i = 0; i < list.length; i += AGG_CHUNK) {
    if (opts.deadline && i > 0 && Date.now() >= opts.deadline) break;
    const chunk = list.slice(i, i + AGG_CHUNK);
    const now = opts.now ?? Date.now();
    const rows = await q.query<Row>(
      `with t as (select distinct * from jsonb_to_recordset($2::jsonb) as t(target_table text, target_id uuid))
       select t.target_table, t.target_id::text as target_id, s.monitor_status, s.monitor_since, s.monitor_message, s.sources, s.signals, (s.id is not null) as stored,
              exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = t.target_id) as demo,
              case when t.target_table = 'ci' then (select a.id from sm_assets a where a.org_id = $1 and a.ci_id = t.target_id and a.deleted_at is null order by a.created_at limit 1)
                   else t.target_id end as asset_id,
              case when t.target_table = 'ci' then exists (select 1 from sm_cis c where c.org_id = $1 and c.id = t.target_id and c.deleted_at is null)
                   else exists (select 1 from sm_assets a where a.org_id = $1 and a.id = t.target_id and a.deleted_at is null) end as live,
              coalesce((select jsonb_agg(jsonb_build_object('state', i.status, 'since', i.status_since, 'message', i.status_message, 'at', i.listed_at,
                                 'every', k.every_minutes, 'status_every', k.status_every_minutes, 'kind', k.kind))
                 from sm_discovery_items i join sm_discovery_connectors k on k.org_id = i.org_id and k.id = i.connector_id and k.deleted_at is null and k.active
                where i.org_id = $1 and i.deleted_at is null and i.status is not null and (i.state is null or i.state not in ('gone', 'ignored'))
                  and ((t.target_table = 'ci' and i.ci_id = t.target_id) or (t.target_table = 'asset' and i.ci_id is null and i.asset_id = t.target_id))), '[]'::jsonb) as items
       from t left join sm_discovery_states s on s.org_id = $1 and s.deleted_at is null and s.target_table = t.target_table and s.target_id = t.target_id::text`,
      [org, JSON.stringify(chunk.map((t) => ({ target_table: t.table, target_id: t.id })))],
    );
    const pushers = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.signals ?? {})) if (k.startsWith("c:") && UUID.test(k.slice(2))) pushers.add(k.slice(2));
    const connectors = new Map<string, Row>();
    if (pushers.size) {
      const ks = await q.query<Row>(`select id, kind, every_minutes, status_every_minutes from sm_discovery_connectors where org_id = $1 and deleted_at is null and active and id = any($2::uuid[])`, [org, pgArray([...pushers])]);
      for (const k of ks) connectors.set(String(k.id), k);
    }
    const maint = await maintenanceOf(q, sys, rows.filter((r) => r.target_table === "ci" && r.live).map((r) => String(r.target_id)), now);
    const writes: Row[] = [];
    for (const r of rows) {
      if (!r.live || !!r.demo !== demo) continue;
      const agg = aggregateStatus(sourcesOf(r, connectors), { now, maintenance: r.target_table === "ci" ? maint.get(String(r.target_id)) ?? null : null });
      if (!r.stored && agg.state === "unknown" && !agg.sources) continue;
      const same = r.monitor_status === agg.state;
      const next = {
        target_table: r.target_table, target_id: String(r.target_id), ci_id: r.target_table === "ci" ? String(r.target_id) : null, asset_id: r.asset_id ?? null,
        monitor_status: agg.state, monitor_since: same && r.monitor_since ? iso(r.monitor_since) : agg.since ?? new Date(now).toISOString(),
        monitor_message: agg.message ? String(agg.message).slice(0, 500) : null, sources: agg.sources,
      };
      if (r.stored && same && iso(r.monitor_since) === next.monitor_since && (r.monitor_message ?? null) === next.monitor_message && Number(r.sources ?? 0) === next.sources) continue;
      writes.push({ id: uuidv7(), ...next });
    }
    if (writes.length) {
      const res = await q.query(
        `insert into sm_discovery_states as s (id, org_id, target_table, target_id, ci_id, asset_id, monitor_status, monitor_since, monitor_message, sources, signals, origin)
         select x.id, $1, x.target_table, x.target_id, x.ci_id, x.asset_id, x.monitor_status, x.monitor_since, x.monitor_message, x.sources, '{}'::jsonb, $3
         from jsonb_to_recordset($2::jsonb) as x(id uuid, target_table text, target_id text, ci_id uuid, asset_id uuid, monitor_status text, monitor_since timestamptz,
           monitor_message text, sources int)
         on conflict (org_id, target_table, target_id) where deleted_at is null do update set
           monitor_status = excluded.monitor_status, monitor_since = excluded.monitor_since, monitor_message = excluded.monitor_message, sources = excluded.sources,
           ci_id = coalesce(excluded.ci_id, s.ci_id), asset_id = coalesce(excluded.asset_id, s.asset_id), updated_at = now()
         where s.monitor_status is distinct from excluded.monitor_status or s.monitor_since is distinct from excluded.monitor_since
            or s.monitor_message is distinct from excluded.monitor_message or s.sources is distinct from excluded.sources
         returning s.id`,
        [org, JSON.stringify(writes), sys.cfg.origin ?? "cloud"],
      );
      written += res.length;
    }
    done += chunk.length;
  }
  return { written, done };
}

/** Rows whose value may have aged (a source that stopped reporting): looked at again at most every half hour per organisation. */
const agedAt = new Map<string, number>();
/** A slice of a connector's aggregation left off after this many targets (big connectors take several slices). */
const aggAfter = new Map<string, number>();
export const resetStatusThrottles = () => {
  agedAt.clear();
  aggAfter.clear();
};

async function agedTargets(q: Queryable, orgId: string): Promise<Target[]> {
  if (Date.now() - (agedAt.get(orgId) ?? 0) < 30 * 60_000) return [];
  agedAt.set(orgId, Date.now());
  const rows = await q.query<{ target_table: string; target_id: string }>(
    `select target_table, target_id from sm_discovery_states where org_id = $1 and deleted_at is null and monitor_status is not null and monitor_status <> 'unknown'
       and updated_at < now() - interval '1 hour' order by updated_at limit 2000`,
    [orgId],
  );
  return rows.map((r) => ({ table: r.target_table as Target["table"], id: r.target_id }));
}

// ---------------------------------------------------------------------------------------------------------------
// The status job

interface StatusCursor {
  phase: "status" | "problems";
  kind_cursor: unknown;
  page: number;
  attempts: number;
  /** the pass's start: problems not seen since are cleared once the open set was read completely */
  started: string;
  complete: boolean;
}

const STATUS_ATTEMPTS = 4;

/** Is the connector's status call due: a pass running, its interval passed, or (status with inventory) a newer inventory pass? */
async function statusDue(q: Queryable, orgId: string, conn: Row): Promise<Row | "due" | null> {
  const running = await q.one<Row>(`select * from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'status' and state = 'running' and deleted_at is null`, [orgId, conn.id]);
  if (running) return running;
  const last = await q.one<{ status: string | null; inventory: string | null }>(
    `select max(started_at) filter (where lane = 'status') as status, max(finished_at) filter (where lane = 'inventory' and state = 'completed') as inventory
     from sm_discovery_runs where org_id = $1 and connector_id = $2 and deleted_at is null`,
    [orgId, conn.id],
  );
  const every = Number(conn.status_every_minutes ?? 0);
  const lastStatus = last?.status ? Date.parse(String(last.status)) : NaN;
  if (!Number.isFinite(lastStatus)) return "due";
  if (every > 0) return Date.now() - lastStatus >= every * 60_000 * 0.9 ? "due" : null;
  return last?.inventory && Date.parse(String(last.inventory)) > lastStatus ? "due" : null;
}

/** One slice of the tool's status and problems (kinds with those calls). "slice": come back; otherwise go on to the upkeep. */
async function pullStatus(sys: Ctx, conn: Row, end: number): Promise<"slice" | "done"> {
  const db = sys.db;
  const org = sys.org.id;
  const kind = serverKind(conn.kind);
  const collect: string[] = Array.isArray(conn.collect) && conn.collect.length ? conn.collect : (kind?.collects ?? []);
  const wantStatus = !!kind?.status && collect.includes("status");
  const wantProblems = !!kind?.problems && collect.includes("problems");
  if (!kind?.ready || !conn.active || (!wantStatus && !wantProblems)) return "done";
  const due = await statusDue(db, org, conn);
  if (!due) return "done";
  let run: Row;
  if (due === "due") {
    const cursor: StatusCursor = { phase: wantStatus ? "status" : "problems", kind_cursor: null, page: 0, attempts: 0, started: new Date().toISOString(), complete: true };
    try {
      run = (await db.one<Row>(
        `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, cursor, pages, fetched, staged, skipped_unchanged, refreshed, retried,
           created, updated, unmatched, duplicates, failed, stale_marked, problems_opened, problems_cleared, complete, warnings, origin)
         values ($1, $2, $3, 'status', 'schedule', 'running', now(), $4::jsonb, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, '[]'::jsonb, $5) returning *`,
        [uuidv7(), org, conn.id, JSON.stringify(cursor), sys.cfg.origin ?? "cloud"],
      ))!;
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") return "slice";
      throw e;
    }
  } else run = due;
  const worker = uuidv7();
  const claimed = await db.one(
    `update sm_discovery_runs set lease_by = $3, lease_until = now() + interval '5 minutes', updated_at = now()
     where org_id = $1 and id = $2 and state = 'running' and (lease_until is null or lease_until < now()) returning id`,
    [org, run.id, worker],
  );
  if (!claimed) return "slice";
  let cursor = run.cursor as StatusCursor;
  const save = (extra: Partial<Record<"pages" | "fetched" | "problems_opened" | "problems_cleared", number>> = {}) =>
    db.query(
      `update sm_discovery_runs set cursor = $3::jsonb, pages = pages + $4, fetched = fetched + $5, problems_opened = problems_opened + $6,
         problems_cleared = problems_cleared + $7, updated_at = now(), lease_until = now() + interval '5 minutes' where org_id = $1 and id = $2`,
      [org, run.id, JSON.stringify(cursor), extra.pages ?? 0, extra.fetched ?? 0, extra.problems_opened ?? 0, extra.problems_cleared ?? 0],
    );
  const finish = (state: "completed" | "failed", error?: string) =>
    db.query(
      `update sm_discovery_runs set state = $3, finished_at = now(), duration_ms = least(2147483647, (extract(epoch from (now() - started_at)) * 1000)::bigint)::int,
         complete = $4, error = $5, cursor = $6::jsonb, lease_by = null, lease_until = null, updated_at = now() where org_id = $1 and id = $2 and state = 'running'`,
      [org, run.id, state, state === "completed" && cursor.complete, error ?? null, JSON.stringify(cursor)],
    );
  let secrets: (string | null)[] = [];
  try {
    const parsed = kindOptions(kind, conn.options);
    if ("error" in parsed) {
      await finish("failed", parsed.error);
      return "done";
    }
    let cctx;
    try {
      cctx = await connCtx(sys, conn, kind, parsed.options, end);
    } catch (e) {
      if (!(e instanceof ConnectorError)) throw e;
      await finish("failed", e.message);
      return "done";
    }
    secrets = [cctx.secret, cctx.secret2];
    for (;;) {
      if (Date.now() >= end - 1000) {
        await save();
        return "slice";
      }
      let page: { items?: StatusItem[]; problems?: DiscoveredProblem[]; next: unknown; complete?: boolean };
      try {
        page = cursor.phase === "status" ? await kind.status!(cctx, cursor.kind_cursor as never) : await kind.problems!(cctx, cursor.kind_cursor as never);
      } catch (e) {
        if (e instanceof ConnectorError && e.retryable && cursor.attempts + 1 < STATUS_ATTEMPTS) {
          cursor = { ...cursor, attempts: cursor.attempts + 1 };
          await save();
          return "slice";
        }
        await finish("failed", maskSecrets(e instanceof ConnectorError ? e.message : CONNECTOR_MESSAGES.noAnswer(String(conn.name)), secrets));
        return "done";
      }
      if (cursor.phase === "status") {
        const items = maskSecrets(page.items ?? [], secrets);
        await applyItemStatuses(db, org, conn.id, items, new Date());
        cursor = { ...cursor, kind_cursor: page.next ?? null, page: cursor.page + 1, attempts: 0 };
        const last = page.next === null || page.next === undefined;
        if (last) cursor = { ...cursor, phase: "problems", kind_cursor: null, page: 0 };
        await save({ pages: 1, fetched: items.length });
        if (last && !wantProblems) break;
      } else {
        const problems = maskSecrets(page.problems ?? [], secrets);
        const r = await recordProblems(db, org, conn.id, problems, new Date(cursor.started), sys.cfg.origin ?? "cloud");
        cursor = { ...cursor, kind_cursor: page.next ?? null, page: cursor.page + 1, attempts: 0, complete: cursor.complete && page.complete !== false };
        const last = page.next === null || page.next === undefined;
        const cleared = last && cursor.complete ? await clearVanished(db, org, conn.id, new Date(cursor.started)) : 0;
        await save({ pages: 1, fetched: problems.length, problems_opened: r.opened, problems_cleared: cleared });
        if (last) break;
      }
    }
    await finish("completed");
    return "done";
  } finally {
    await db.query(`update sm_discovery_runs set lease_until = null where org_id = $1 and id = $2 and lease_by = $3`, [org, run.id, worker]).catch(() => undefined);
  }
}

/**
 * The upkeep after a status pass, an inventory pass or a push: ATMs matched to assets, the connector's targets (and
 * aged ones) aggregated, ATM values through the hysteresis, problems sent. Returns when to come back.
 */
export async function statusUpkeep(sys: Ctx, conn: Row, end: number): Promise<JobResult> {
  const db = sys.db;
  const org = sys.org.id;
  const demo = demoScopeOrg() === org;
  await matchAtms(db, org, conn.id, demo);
  await rekeyAssetRows(db, org);
  const targets = await connectorTargets(db, org, conn.id);
  targets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const from = Math.min(aggAfter.get(conn.id) ?? 0, targets.length);
  const agg = await aggregateTargets(db, sys, targets.slice(from), { deadline: end });
  if (from + agg.done < targets.length) {
    aggAfter.set(conn.id, from + agg.done);
    return { again: 0 };
  }
  aggAfter.delete(conn.id);
  const aged = await agedTargets(db, org);
  if (aged.length) await aggregateTargets(db, sys, aged, { deadline: end + 2000 });
  await observeDevices(db, sys, conn, await itemDeviceReports(db, org, conn.id), { demo });
  const sent = await sendProblems(sys, conn, { deadline: end });
  return sent.again ? { again: sent.again } : undefined;
}

/** The job `discovery.status` of a connector (jobs.ts): its status and problems when due, then the upkeep. */
export async function statusPass(sys: Ctx, connectorId: string, jctx: Pick<JobContext, "deadline">): Promise<JobResult> {
  if (editionOf(sys.cfg) === "desktop") return;
  const org = sys.org.id;
  const conn = await loadConnector(sys.db, org, connectorId);
  if (!conn) return;
  try {
    await assertWritable(sys.db, org);
  } catch {
    return { again: 15 * 60_000 };
  }
  const end = sliceEnd(Date.now(), jctx.deadline);
  if ((await pullStatus(sys, conn, end)) === "slice") return { again: 0 };
  return statusUpkeep(sys, conn, end);
}

// ---------------------------------------------------------------------------------------------------------------
// The event sink (§9.7)

/** Every processed event: an alert bound to a CI sets, changes or removes its event source's signal on the CI. */
export async function statusSink(tx: Tx, sys: Ctx, event: Row, alert: Row | null): Promise<void> {
  if (editionOf(sys.cfg) === "desktop") return;
  const ciId = isUuid(event.ci_id) ? String(event.ci_id) : isUuid(alert?.ci_id) ? String(alert!.ci_id) : null;
  const sourceId = isUuid(event.source_id) ? String(event.source_id) : null;
  if (!ciId || !sourceId) return;
  const resolved = String(event.status ?? "") === "resolved";
  // an event the rules dropped or suppressed raised no alert and says nothing about status
  if (!alert && !resolved) return;
  const org = sys.org.id;
  // a demo CI's row only inside the demo scope, a real one's only outside it
  if ((await isDemoRow(tx, org, ciId)) !== (demoScopeOrg() === org)) return;
  const conn = await tx.one<{ options: Row | null }>(`select options from sm_discovery_connectors where org_id = $1 and event_source_id = $2 and deleted_at is null limit 1`, [org, sourceId]);
  const match = typeof conn?.options?.availability_match === "string" ? String(conn.options.availability_match) : null;
  const open = alert ? ALERT_OPEN_STATES.includes(String(alert.state)) : false;
  const signal = !open || resolved ? null : alert?.state === "maintenance" ? "maintenance"
    : alertSignal({ status: event.status, severity: alert?.severity ?? event.severity, metric: event.metric, resource: event.resource, tags: event.tags, message: event.message }, match);
  const row = await tx.one<{ signals: Row | null }>(`select signals from sm_discovery_states where org_id = $1 and deleted_at is null and target_table = 'ci' and target_id = $2 for update`, [org, ciId]);
  const signals: Row = { ...(row?.signals && typeof row.signals === "object" ? row.signals : {}) };
  const prev = signals[sourceId] ?? null;
  if (signal) {
    const since = prev?.state === signal ? prev.since : iso(event.occurred_at && Date.parse(String(event.occurred_at)) <= Date.now() ? event.occurred_at : null) ?? new Date().toISOString();
    signals[sourceId] = { state: signal, since, alert_id: alert?.id ?? null };
  } else delete signals[sourceId];
  if (JSON.stringify(signals[sourceId] ?? null) === JSON.stringify(prev)) return;
  if (!row && !signal) return;
  await tx.query(
    `insert into sm_discovery_states as s (id, org_id, target_table, target_id, ci_id, asset_id, signals, origin)
     values ($1, $2, 'ci', $3, $3::uuid, (select a.id from sm_assets a where a.org_id = $2 and a.ci_id = $3::uuid and a.deleted_at is null order by a.created_at limit 1), $4::jsonb, $5)
     on conflict (org_id, target_table, target_id) where deleted_at is null do update set signals = excluded.signals, updated_at = now()`,
    [uuidv7(), org, ciId, JSON.stringify(signals), sys.cfg.origin ?? "cloud"],
  );
  await aggregateTargets(tx, sys, [{ table: "ci", id: ciId }]);
}

// ---------------------------------------------------------------------------------------------------------------
// Jobs and the sink (installed once per process from installDiscoveryModule)

/** The guard of the module's own jobs (as jobs.ts's): an organisation, a server that runs connectors, room among the jobs. */
export async function admittedJob(job: Job, jctx: JobContext): Promise<{ orgId: string; connector: string } | JobResult | null> {
  if (!job.org_id || editionOf({ mode: jctx.cfg.mode ?? "cloud", server: jctx.cfg.server }) === "desktop") return null;
  const connector = String(job.payload?.connector ?? "");
  if (!UUID.test(connector)) return null;
  const orgId = job.org_id;
  await inDemoScope(null, () => ensureDiscoverySweep(jctx.db, orgId));
  if ((await busyDiscoveryJobs(jctx.db, orgId, job.id)) >= MAX_DISCOVERY_JOBS) return { again: busyAgainMs() };
  return { orgId, connector };
}

let installed = false;

/** The event sink and the ATM job (push.ts installs its own). */
export function installDiscoveryStatus(): void {
  if (installed) return;
  installed = true;
  registerEventSink(statusSink);
  registerJobHandler(DEVICE_JOB, async (job, jctx) => {
    const a = await admittedJob(job, jctx);
    if (!a || !("orgId" in a)) return a ?? undefined;
    const asset = String(job.payload?.asset ?? "");
    if (!UUID.test(asset)) return;
    return inConnectorScope(jctx.db, a.orgId, a.connector, async () => applyDevice(await systemCtx(jctx.cfg, a.orgId), asset, a.connector));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Readers: the board «وضعیت پایش» and the side panel «منبع‌ها و وضعیت پایش» (§15)

interface StatusReader {
  /** reads the CMDB: CI rows, tool names, messages and links */
  cmdb: boolean;
  /** reads assets beyond their own (a branch officer: own-branch assets) */
  assets: boolean;
}

/** Who sees status: CMDB readers, and asset readers beyond their own assets (requesters see nothing, §14.5). */
async function readerOf(ctx: Ctx): Promise<StatusReader> {
  if (editionOf(ctx.cfg) === "desktop") throw new AppError(403, "desktop", CONNECTOR_MESSAGES.desktop);
  if (isSystemCtx(ctx)) return { cmdb: true, assets: true };
  const r = await rightsOf(ctx);
  let assets = false;
  try {
    assets = scopeRank(grantIn(subjectOf(ctx).eff, "asset").read) >= scopeRank("group");
  } catch {
    assets = ctx.can("asset" as never, "view");
  }
  if (!r.cmdbRead && !assets) throw forbidden(STATUS_READ_MESSAGE);
  return { cmdb: r.cmdbRead, assets };
}

export const BOARD_CHIPS = ["down", "unreachable", "warning", "maintenance", "off", "silent", "atm"] as const;
export type BoardChip = (typeof BOARD_CHIPS)[number];
const SILENT_DAYS = 14;

export interface BoardQuery {
  chip?: BoardChip;
  q?: string;
  page?: number;
  size?: number;
}

const wordOf = (s: string | null | undefined) => STATUS_WORDS.find((w) => w.value === s);

function chipSql(chip: BoardChip | undefined, params: unknown[]): string {
  if (!chip) return "true";
  if (chip === "silent") return `s.last_contact_at < now() - interval '${SILENT_DAYS} days'`;
  if (chip === "atm") {
    params.push(pgArray(FLEET_CATEGORIES));
    return `a.category = any($${params.length}::text[])`;
  }
  params.push(chip);
  return `s.monitor_status = $${params.length}`;
}

/** The board: the status rows of the CIs and assets the caller reads, worst first, with counts per chip. */
export async function statusBoard(ctx: Ctx, query: BoardQuery = {}): Promise<{ rows: Row[]; total: number; counts: Record<string, number>; page: number; size: number }> {
  const who = await readerOf(ctx);
  const env = await condEnv(ctx);
  const size = Math.min(200, Math.max(1, query.size ?? 50));
  const page = Math.min(1000, Math.max(1, query.page ?? 1));
  const counts: Record<string, number> = Object.fromEntries(BOARD_CHIPS.map((c) => [c, 0]));
  let total = 0;
  const fleet = pgArray(FLEET_CATEGORIES).replace(/'/g, "''");
  const countsSql = `count(*) filter (where s.monitor_status = 'down')::int as down, count(*) filter (where s.monitor_status = 'unreachable')::int as unreachable,
    count(*) filter (where s.monitor_status = 'warning')::int as warning, count(*) filter (where s.monitor_status = 'maintenance')::int as maintenance,
    count(*) filter (where s.monitor_status = 'off')::int as off, count(*) filter (where s.last_contact_at < now() - interval '${SILENT_DAYS} days')::int as silent,
    count(*) filter (where a.category = any('${fleet}'::text[]))::int as atm`;
  const build = (table: "ci" | "asset") => {
    const def = tableDef(table)!;
    const params: unknown[] = [ctx.org.id];
    const where = readable(ctx, def, "t", params, env);
    const filters = [`s.org_id = $1`, `s.deleted_at is null`, where];
    if (table === "ci") filters.push(`s.target_table = 'ci'`);
    else if (who.cmdb) filters.push(`s.target_table = 'asset'`);
    if (query.q?.trim()) {
      params.push(`%${query.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const p = `$${params.length}`;
      filters.push(table === "asset" ? `(t.name ilike ${p} or t.asset_tag ilike ${p} or t.terminal_id ilike ${p})` : `(t.name ilike ${p} or t.hostname ilike ${p})`);
    }
    const join = table === "ci"
      ? `join sm_cis t on t.org_id = s.org_id and t.id = s.ci_id and t.deleted_at is null left join sm_assets a on a.org_id = s.org_id and a.id = s.asset_id and a.deleted_at is null`
      : `join sm_assets t on t.org_id = s.org_id and t.id = s.asset_id and t.deleted_at is null left join sm_assets a on a.id = t.id`;
    return { params, from: `from sm_discovery_states s ${join} where ${filters.join(" and ")}`, table };
  };
  const sides = [...(who.cmdb ? [build("ci")] : []), build("asset")];
  const rows: Row[] = [];
  for (const side of sides) {
    const c = await ctx.db.one<Row>(`select ${countsSql} ${side.from}`, side.params);
    for (const k of BOARD_CHIPS) counts[k] += Number(c?.[k] ?? 0);
    const params = [...side.params];
    const chip = chipSql(query.chip, params);
    const n = await ctx.db.one<{ n: number }>(`select count(*)::int as n ${side.from} and ${chip}`, params);
    total += Number(n?.n ?? 0);
    params.push(page * size);
    const got = await ctx.db.query<Row>(
      `select s.target_table, s.target_id, s.ci_id, s.asset_id, s.monitor_status, s.monitor_since, s.monitor_message, s.sources, s.last_contact_at, s.stale_since,
              t.name, ${side.table === "ci" ? "t.class as class, t.location_id, null::text as category" : "null::text as class, t.location_id, t.category"},
              a.branch_id, a.category as asset_category, a.device_status
       ${side.from} and ${chip}
       order by case s.monitor_status when 'down' then 6 when 'unreachable' then 5 when 'warning' then 4 when 'maintenance' then 3 when 'off' then 2 when 'up' then 1 else 0 end desc,
                s.monitor_since desc nulls last, s.id limit $${params.length}`,
      params,
    );
    rows.push(...got);
  }
  const order = (s: string | null | undefined) => (s === "maintenance" ? 3.5 : stateRank(s));
  rows.sort((x, y) => order(y.monitor_status) - order(x.monitor_status) || String(iso(y.monitor_since) ?? "").localeCompare(String(iso(x.monitor_since) ?? "")));
  const slice = rows.slice((page - 1) * size, page * size).map((r) => ({
    target_table: r.target_table, target_id: r.target_id, ci_id: r.ci_id ?? null, asset_id: r.asset_id ?? null, name: r.name ?? null,
    class: r.class ?? null, category: r.category ?? r.asset_category ?? null, branch_id: r.branch_id ?? null, location_id: r.location_id ?? null,
    status: r.monitor_status ?? "unknown", status_label: wordOf(r.monitor_status)?.label ?? "نامعلوم", status_color: wordOf(r.monitor_status)?.color ?? "gray",
    since: iso(r.monitor_since), last_contact_at: iso(r.last_contact_at), sources: Number(r.sources ?? 0), device_status: r.device_status ?? null,
    // what a tool said, in its words: CMDB readers only (branch officers see the word, the dot and the times)
    ...(who.cmdb ? { message: r.monitor_message ?? null } : {}),
  }));
  return { rows: slice, total, counts, page, size };
}

/** The side panel of a CI or an asset: its status and last contact, and — for CMDB readers — one row per source. */
export async function statusPanel(ctx: Ctx, table: "ci" | "asset", id: string): Promise<Row> {
  const who = await readerOf(ctx);
  if (table === "ci" && !who.cmdb) throw forbidden(STATUS_READ_MESSAGE);
  const { row: record } = await get(ctx, table, id);
  const org = ctx.org.id;
  const ciId = table === "ci" ? id : isUuid(record.ci_id) ? String(record.ci_id) : null;
  const assetId = table === "asset" ? id : null;
  const state = await ctx.db.one<Row>(
    `select * from sm_discovery_states where org_id = $1 and deleted_at is null
       and ((target_table = 'ci' and target_id = $2) or (target_table = 'asset' and target_id = $3) or ($3::text is not null and asset_id = $3::uuid))
     order by (target_table = 'ci') desc limit 1`,
    [org, ciId ?? "", assetId],
  );
  const status = state
    ? {
        state: state.monitor_status ?? "unknown", label: wordOf(state.monitor_status)?.label ?? "نامعلوم", color: wordOf(state.monitor_status)?.color ?? "gray",
        since: iso(state.monitor_since), sources: Number(state.sources ?? 0), last_contact_at: iso(state.last_contact_at), stale_since: iso(state.stale_since),
        ...(who.cmdb ? { message: state.monitor_message ?? null } : {}),
      }
    : null;
  if (!who.cmdb) return { empty: !status, status, sources: [], signals: [] };
  const itemDef = tableDef("discovery_item")!;
  const env = await condEnv(ctx);
  const params: unknown[] = [org, ciId, assetId];
  const where = readable(ctx, itemDef, "i", params, env);
  const sources = await ctx.db.query<Row>(
    `select i.id as item_id, i.connector_id, k.name as connector_name, k.kind, i.state, i.status, i.status_since, i.status_message, i.last_contact_at, i.listed_at, i.link_url
     from sm_discovery_items i join sm_discovery_connectors k on k.org_id = i.org_id and k.id = i.connector_id and k.deleted_at is null
     where i.org_id = $1 and i.deleted_at is null and (i.state is null or i.state not in ('gone', 'ignored'))
       and (($2::uuid is not null and i.ci_id = $2::uuid) or ($3::uuid is not null and i.asset_id = $3::uuid)) and ${where}
     order by i.last_contact_at desc nulls last, k.name limit 50`,
    params,
  );
  const signalKeys = Object.entries(state?.signals && typeof state.signals === "object" ? (state.signals as Row) : {});
  const sourceIds = signalKeys.filter(([k]) => UUID.test(k)).map(([k]) => k);
  const pushIds = signalKeys.filter(([k]) => k.startsWith("c:") && UUID.test(k.slice(2))).map(([k]) => k.slice(2));
  const names = new Map<string, string>();
  if (sourceIds.length) for (const r of await ctx.db.query<Row>(`select id, name from sm_event_sources where org_id = $1 and id = any($2::uuid[])`, [org, pgArray(sourceIds)])) names.set(String(r.id), String(r.name));
  if (pushIds.length) for (const r of await ctx.db.query<Row>(`select id, name from sm_discovery_connectors where org_id = $1 and id = any($2::uuid[])`, [org, pgArray(pushIds)])) names.set(`c:${r.id}`, String(r.name));
  return {
    empty: !status && !sources.length,
    status,
    sources: sources.map((s) => ({
      connector_id: s.connector_id, name: s.connector_name, kind: s.kind, state: s.state ?? null, status: s.status ?? null, status_label: wordOf(s.status)?.label ?? null,
      status_since: iso(s.status_since), message: s.status_message ?? null, last_contact_at: iso(s.last_contact_at), reported_at: iso(s.listed_at), link_url: s.link_url ?? null,
    })),
    signals: signalKeys.map(([k, v]) => ({ key: k, name: names.get(k) ?? null, state: v?.state ?? null, since: iso(v?.since), alert_id: v?.alert_id ?? null })),
  };
}
