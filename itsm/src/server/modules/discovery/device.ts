// ATMs and the bank's device_status (design A §9.5).
//
//   · Matching: `atm` items match ASSETS — by terminal id, then by serial within the fleet categories — never across
//     the demo boundary (a real connector never reaches a demo asset, the demo connector never a real one). The asset's
//     CI, when it has one, is the item's target; an ATM never creates an asset and an unmatched one stays in the queue.
//   · Strong identifiers only: a device value counts from an ATM item identified by terminal id or serial (a
//     hostname or an address identifies monitor status only — branch networks reuse addresses).
//   · Hysteresis (`deviceStep`, @shared/discovery/status): a value that differs from the asset's waits out
//     `device_hold_minutes` from the tool's own time and, for pulled sources, a second pass; it is applied by the job
//     `discovery.device_apply` through `updateIn(asset)` with `setStatusInfo(… { reason, at })`, so the bank's periods
//     start at the tool's time. A connector never sets nor overwrites «در نگهداری»; a person's change is detected
//     through `device_applied` and respected.
// The ATM columns live in discovery_state (lock-free bookkeeping); only an applied value writes the asset.
import { appliedColumns, deviceStep, mapDeviceStatus, type DeviceColumns, type DeviceRules } from "@shared/discovery/status";
import { FLEET_CATEGORIES } from "@shared/tables/itam";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { updateIn } from "../../engine";
import { enqueue, type JobResult } from "../../jobs";
import { setStatusInfo } from "../itam/bank";
import { loadConnector } from "./runner";

type Row = Record<string, any>;

export const DEVICE_JOB = "discovery.device_apply";
/** The warning of a device value sent with a weak identifier (§12.2). */
export const STRONG_ONLY_MESSAGE = "وضعیت خودپرداز فقط با شناسهٔ پایانه یا سریال پذیرفته می‌شود";

const DEVICE_COLS = ["device_reported", "device_reported_since", "device_pending", "device_pending_since", "device_pending_polls", "device_applied", "device_applied_at"] as const;

/** The SQL test that a row (alias `a`) is, or is not, a demo row: `$demo` is the boolean parameter's placeholder. */
const demoSide = (a: string, demo: string) => `(exists (select 1 from sm_demo_rows d where d.org_id = ${a}.org_id and d.row_id = ${a}.id)) = ${demo}`;

/**
 * Link a connector's reconciled ATM items to their assets (terminal id, then serial in the fleet categories), on the
 * connector's side of the demo boundary. Returns how many items changed.
 */
export async function matchAtms(q: Queryable, orgId: string, connectorId: string, demo: boolean): Promise<number> {
  const rows = await q.query(
    `with cand as (
       select i.id, nullif(i.data->>'terminal_id', '') as terminal, nullif(i.data->>'serial_number', '') as serial
       from sm_discovery_items i
       where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.kind = 'atm' and i.reconciled_at is not null
         and (i.state is null or i.state not in ('ignored', 'gone')) and (i.data ? 'terminal_id' or i.data ? 'serial_number')
     ),
     m as (
       select c.id as item_id, x.id as asset_id, x.matched_by,
              (select ci.id from sm_cis ci where ci.org_id = $1 and ci.id = x.ci_id and ci.deleted_at is null) as ci_id
       from cand c
       join lateral (
         select y.id, y.ci_id, y.matched_by from (
           select a.id, a.ci_id, 'terminal_id' as matched_by, 0 as pref from sm_assets a
            where a.org_id = $1 and a.deleted_at is null and c.terminal is not null and a.terminal_id = c.terminal and ${demoSide("a", "$3")}
           union all
           select a.id, a.ci_id, 'serial_number', 1 from sm_assets a
            where a.org_id = $1 and a.deleted_at is null and c.serial is not null and a.serial_number = c.serial and a.category = any($4::text[]) and ${demoSide("a", "$3")}
         ) y order by y.pref limit 1
       ) x on true
     )
     update sm_discovery_items t set asset_id = m.asset_id, ci_id = m.ci_id, state = 'linked', matched_by = m.matched_by, retry_at = null,
       message = null, dedup_task_id = null, updated_at = now()
     from m
     where t.org_id = $1 and t.id = m.item_id
       and (t.asset_id is distinct from m.asset_id or t.ci_id is distinct from m.ci_id or t.state is distinct from 'linked' or t.matched_by is distinct from m.matched_by)
     returning t.id`,
    [orgId, connectorId, demo, pgArray(FLEET_CATEGORIES)],
  );
  return rows.length;
}

/** One reported device value of a target. */
export interface DeviceReport {
  target_table: "ci" | "asset";
  target_id: string;
  asset_id: string;
  /** the tool's raw value (mapped through the connector's device_status_map) */
  raw: string | null;
  since?: string | null;
  /** when Kariz received it (an item's listing time; the request's time) */
  at: string;
}

/** The connector's ATM items' device values (strongly identified, linked to a fleet asset) as of their last listing. */
export async function itemDeviceReports(q: Queryable, orgId: string, connectorId: string): Promise<DeviceReport[]> {
  const rows = await q.query<Row>(
    `select i.ci_id, i.asset_id, i.data->'status'->>'device_status' as raw, i.data->'status'->>'since' as since, i.listed_at as at
     from sm_discovery_items i join sm_assets a on a.org_id = i.org_id and a.id = i.asset_id and a.deleted_at is null and a.category = any($3::text[])
     where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.kind = 'atm' and i.state = 'linked'
       and (i.data ? 'terminal_id' or i.data ? 'serial_number') and nullif(i.data->'status'->>'device_status', '') is not null`,
    [orgId, connectorId, pgArray(FLEET_CATEGORIES)],
  );
  return rows.map((r) => ({
    target_table: r.ci_id ? "ci" : "asset", target_id: String(r.ci_id ?? r.asset_id), asset_id: String(r.asset_id), raw: r.raw ?? null, since: r.since ?? null,
    at: new Date(r.at ?? Date.now()).toISOString(),
  }));
}

const iso = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : new Date(v as string).toISOString());

function columnsOf(r: Row | undefined): DeviceColumns {
  return {
    device_reported: r?.device_reported ?? null, device_reported_since: iso(r?.device_reported_since), device_pending: r?.device_pending ?? null,
    device_pending_since: iso(r?.device_pending_since), device_pending_polls: r?.device_pending_polls ?? null, device_applied: r?.device_applied ?? null,
    device_applied_at: iso(r?.device_applied_at),
  };
}

const sameColumns = (a: DeviceColumns, b: DeviceColumns) => DEVICE_COLS.every((k) => (a[k] ?? null) === (b[k] ?? null));

export function deviceRules(conn: Row): DeviceRules {
  return {
    hold_minutes: Math.max(0, Number(conn.device_hold_minutes ?? 10)),
    manual_hold_hours: Math.max(0, Number(conn.manual_hold_hours ?? 24)),
    pulled: String(conn.kind ?? "") !== "push",
  };
}

/** Write a target's ATM columns (inserting its row when it has none yet: an ATM reported before any status). */
async function storeDevice(q: Queryable, orgId: string, origin: string, rows: { target_table: string; target_id: string; asset_id: string; cols: DeviceColumns }[]): Promise<void> {
  if (!rows.length) return;
  const data = rows.map((r) => ({ id: uuidv7(), target_table: r.target_table, target_id: r.target_id, ci_id: r.target_table === "ci" ? r.target_id : null, asset_id: r.asset_id, ...r.cols }));
  await q.query(
    `insert into sm_discovery_states as s (id, org_id, target_table, target_id, ci_id, asset_id, ${DEVICE_COLS.join(", ")}, origin)
     select x.id, $1, x.target_table, x.target_id, x.ci_id, x.asset_id, ${DEVICE_COLS.map((c) => `x.${c}`).join(", ")}, $3
     from jsonb_to_recordset($2::jsonb) as x(id uuid, target_table text, target_id text, ci_id uuid, asset_id uuid, device_reported text, device_reported_since timestamptz,
       device_pending text, device_pending_since timestamptz, device_pending_polls int, device_applied text, device_applied_at timestamptz)
     on conflict (org_id, target_table, target_id) where deleted_at is null do update set
       ${DEVICE_COLS.map((c) => `${c} = excluded.${c}`).join(", ")}, asset_id = coalesce(excluded.asset_id, s.asset_id), updated_at = now()`,
    [orgId, JSON.stringify(data), origin],
  );
}

/**
 * Feed reported device values through the hysteresis (`deviceStep`): pending values are kept on the target's row, and
 * a value that may be applied — now, or when its hold ends — gets its `discovery.device_apply` job. Values of assets
 * outside the fleet categories are ignored. Returns how many are pending and how many were queued to apply now.
 */
export async function observeDevices(q: Queryable, sys: Ctx, conn: Row, reports: DeviceReport[], opts: { now?: number; demo?: boolean } = {}): Promise<{ pending: number; ready: number }> {
  if (!reports.length) return { pending: 0, ready: 0 };
  const org = sys.org.id;
  const now = opts.now ?? Date.now();
  const assets = await q.query<Row>(
    `select id, device_status, device_status_at, category from sm_assets where org_id = $1 and deleted_at is null and id = any($2::uuid[]) and category = any($3::text[])`,
    [org, pgArray([...new Set(reports.map((r) => r.asset_id))]), pgArray(FLEET_CATEGORIES)],
  );
  const assetOf = new Map(assets.map((a) => [String(a.id), a]));
  const states = await q.query<Row>(
    `select target_table, target_id, ${DEVICE_COLS.join(", ")} from sm_discovery_states where org_id = $1 and deleted_at is null and asset_id = any($2::uuid[])`,
    [org, pgArray([...assetOf.keys()])],
  );
  const stateOf = new Map(states.map((s) => [`${s.target_table}:${s.target_id}`, s]));
  const rules = deviceRules(conn);
  const map = conn.device_status_map && typeof conn.device_status_map === "object" ? (conn.device_status_map as Record<string, unknown>) : {};
  const writes: { target_table: string; target_id: string; asset_id: string; cols: DeviceColumns }[] = [];
  let pending = 0;
  let ready = 0;
  const seen = new Set<string>();
  for (const r of reports) {
    const asset = assetOf.get(r.asset_id);
    const key = `${r.target_table}:${r.target_id}`;
    if (!asset || seen.has(key)) continue;
    seen.add(key);
    const cur = columnsOf(stateOf.get(key));
    const step = deviceStep(cur, { device_status: asset.device_status ?? null, device_status_at: iso(asset.device_status_at) }, { value: mapDeviceStatus(r.raw, map), since: r.since ?? null, at: r.at }, rules, now);
    if (!sameColumns(cur, step.next)) writes.push({ target_table: r.target_table, target_id: r.target_id, asset_id: r.asset_id, cols: step.next });
    if (step.next.device_pending) pending++;
    if (step.apply || step.wake_at) {
      if (step.apply) ready++;
      await enqueue(q, {
        kind: DEVICE_JOB, orgId: org, payload: { asset: r.asset_id, connector: conn.id, ...(opts.demo ? { __demo: true } : {}) },
        dedupeKey: `discovery.device:${r.asset_id}`, runAt: step.apply ? undefined : step.wake_at ?? undefined, maxAttempts: 5,
      });
    }
  }
  await storeDevice(q, org, sys.cfg.origin ?? "cloud", writes);
  return { pending, ready };
}

/**
 * The job `discovery.device_apply` (one per asset): the value pending on the asset's row is applied once it held —
 * through the asset's own write, at the tool's time, «از منبع داده «…»» — or the job comes back when the hold ends.
 */
export async function applyDevice(sys: Ctx, assetId: string, connectorId: string, opts: { now?: number } = {}): Promise<JobResult> {
  const org = sys.org.id;
  const conn = await loadConnector(sys.db, org, connectorId);
  if (!conn) return;
  const outcome = await sys.write(async (tx) => {
    const st = await tx.one<Row>(
      `select target_table, target_id, ${DEVICE_COLS.join(", ")} from sm_discovery_states where org_id = $1 and deleted_at is null and asset_id = $2 and device_pending is not null
       order by (target_table = 'ci') desc limit 1 for update`,
      [org, assetId],
    );
    if (!st) return null;
    const asset = await tx.one<Row>(`select id, device_status, device_status_at, category from sm_assets where org_id = $1 and id = $2 and deleted_at is null for update`, [org, assetId]);
    const cur = columnsOf(st);
    const now = opts.now ?? Date.now();
    const step = asset && (FLEET_CATEGORIES as string[]).includes(String(asset.category))
      ? deviceStep(cur, { device_status: asset.device_status ?? null, device_status_at: iso(asset.device_status_at) }, null, deviceRules(conn), now)
      : { next: { ...cur, device_pending: null, device_pending_since: null, device_pending_polls: null }, apply: null, wake_at: null };
    let cols = step.next;
    if (step.apply) {
      setStatusInfo(tx, assetId, { reason: `از منبع داده «${String(conn.name ?? "").slice(0, 120)}»`, at: step.apply.at });
      await updateIn(tx, sys, "asset", assetId, { device_status: step.apply.value }, { trusted: true });
      cols = appliedColumns(step.next, step.apply.value, new Date(now).toISOString());
    }
    if (!sameColumns(cur, cols)) {
      await tx.query(
        `update sm_discovery_states set ${DEVICE_COLS.map((c, i) => `${c} = $${i + 4}`).join(", ")}, updated_at = now()
         where org_id = $1 and target_table = $2 and target_id = $3 and deleted_at is null`,
        [org, st.target_table, st.target_id, ...DEVICE_COLS.map((c) => cols[c])],
      );
    }
    return step.wake_at;
  });
  if (outcome) return { again: Math.max(1000, Date.parse(outcome) - Date.now()) };
}
