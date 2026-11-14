// ITAM feeds of a connector (design A §11; package DA7).
//
//   «ساخت دارایی برای دستگاه‌های تازه» (`make_assets`, §11.1)
//     · who: an asset manager switches it (the connector guard, guard.ts), and only once ITAM has confirmed its own
//       discovered-hardware step (`itam_config.auto_assets_confirmed_at`, stamped when an asset manager makes the first
//       batch from «داشبورد دارایی‌ها»): until then people are refused with what to do, and the feed makes nothing;
//     · what: ITAM's `assetsForDiscovered` for the connector's linked hardware CIs (ITAM's HW_CLASSES) that have no
//       asset — never for an ATM, CRS or kiosk (an item of kind `atm`, or a CI whose model is one of the bank fleet's);
//     · how fast: the job `discovery.itam` (after every completed pass while the feed is on, and daily) works in the
//       pull's slices (≤ 5 s; an asset starts only while the slice covers 1.5 × its measured time), one short
//       transaction per asset, at most `make_assets_daily` (5 000) a day — a UTC day; the job then waits for the next.
//     New assets are «تأییدنشده». Their holder and place come only from what people set on the CI: connectors never
//     write `used_by` or `location_id` (§6.3). Each feed pass is a `discovery_run` of lane `itam`: `created` counts the
//     day's assets, `failed` the devices ITAM refused (tried again the next day), and its cursor keeps the measured
//     time per asset.
//   «بی‌دارایی» (§8.4): the devices still waiting, with the tool's reported holder and place, and a roll-up per
//     connector — a tab of the reconciliation queue (service.ts).
//   Software staging and the SAM feed (§11.2) come with release 1.2 (the owner's decision of 14 November).
import type { Cond } from "@shared/model/conditions";
import { uuidv7 } from "@shared/id";
import { FLEET_CATEGORIES } from "@shared/tables/itam";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { isSystemCtx, list } from "../../engine";
import { registerHooks, type WriteArgs } from "../../engine/hooks";
import { AppError, bad } from "../../http/errors";
import type { JobContext, JobResult } from "../../jobs";
import { assetsForDiscovered, HW_CLASSES } from "../itam/assets";
import { liveRows } from "../itam/common";
import { assertWritable } from "../platform/org-admin";
import { mayForce, observe, predictMs, sliceEnd, START_FACTOR, type Ewma } from "./budget";
import { loadConnector } from "./runner";

type Row = Record<string, any>;

/** The lane of a feed pass in `discovery_run`. */
export const FEED_LANE = "itam";
export const MAKE_ASSETS_DAILY = 5000;
export const DAY_MS = 86_400_000;
/** Devices read per query (each still gets its own transaction). */
const BATCH = 25;
/** Devices ITAM refused that a day's pass remembers; more and the pass waits for the next day. */
export const SKIP_KEPT = 200;
const LEASE_MINUTES = 5;
const BUSY_AGAIN_MS = 30_000;
const WRITABLE_AGAIN_MS = 15 * 60_000;
const MAX_WARNINGS = 20;

export const NOT_CONFIRMED_MESSAGE =
  "ساخت دارایی برای دستگاه‌های تازه پس از تأیید مدیریت دارایی روشن می‌شود: نخست در «داشبورد دارایی‌ها» دکمهٔ «دارایی برای سخت‌افزار کشف‌شده» را بزنید";
const faNum = (n: number) => n.toLocaleString("fa-IR");
export const capWarning = (cap: number) => `سقف روزانهٔ ساخت دارایی (${faNum(cap)}) پر شد؛ دستگاه‌های دیگر روز بعد دارایی می‌گیرند`;
export const SKIP_WARNING = "دارایی بسیاری از دستگاه‌ها ساخته نشد؛ بقیه روز بعد دوباره آزموده می‌شوند";

// ---------------------------------------------------------------------------------------------------------------
// Which devices wait for an asset

const literals = (xs: readonly string[]) =>
  xs
    .map((x) => {
      if (!/^[a-z_]+$/.test(x)) throw new Error(`unexpected class key ${x}`);
      return `'${x}'`;
    })
    .join(", ");

/**
 * An item `i` linked to a live hardware CI `c` (ITAM's classes) without an asset — never an ATM, CRS or kiosk (an item
 * of kind `atm` names the CI, or the model ITAM would give it is one of the bank fleet's: `assetsForDiscovered` finds
 * the model by the CI's model name, else «<class> نامشخص»). Shared by the feed and «بی‌دارایی».
 */
export const WAITING_SQL = `i.deleted_at is null and i.state = 'linked' and coalesce(i.kind, '') <> 'atm'
  and c.deleted_at is null and c.merged_into is null and c.class in (${literals(HW_CLASSES)}) and coalesce(c.state, '') not in ('retired', 'disposed', 'canceled')
  and not exists (select 1 from sm_assets a where a.org_id = c.org_id and a.ci_id = c.id and a.deleted_at is null)
  and not exists (select 1 from sm_discovery_items x where x.org_id = c.org_id and x.ci_id = c.id and x.kind = 'atm' and x.deleted_at is null)
  and not exists (select 1 from sm_asset_models m where m.org_id = c.org_id and m.deleted_at is null and m.category in (${literals(FLEET_CATEGORIES)})
                    and m.name = left(coalesce(nullif(c.model_name, ''), c.class || ' نامشخص'), 200))`;
const FROM_SQL = `from sm_discovery_items i join sm_cis c on c.org_id = i.org_id and c.id = i.ci_id`;

/** Has ITAM confirmed its discovered-hardware step (an asset manager made the first batch)? */
export async function itamConfirmed(q: Queryable, orgId: string): Promise<boolean> {
  const r = await q.one<{ at: string | null }>(`select auto_assets_confirmed_at as at from sm_itam_configs where org_id = $1 and deleted_at is null order by created_at limit 1`, [orgId]);
  return !!r?.at;
}

/** The connector's next devices waiting for an asset, oldest CI first (a demo connector's only demo CIs, a real one's only real ones). */
async function nextDevices(q: Queryable, orgId: string, connectorId: string, demo: boolean, skip: string[], n: number): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `select distinct c.id, c.created_at ${FROM_SQL}
     where i.org_id = $1 and i.connector_id = $2 and ${WAITING_SQL} and not (c.id = any($3::uuid[]))
       and exists (select 1 from sm_demo_rows d where d.org_id = c.org_id and d.row_id = c.id) = $4::boolean
     order by c.created_at, c.id limit $5`,
    [orgId, connectorId, pgArray(skip), demo, n],
  );
  return rows.map((r) => String(r.id));
}

// ---------------------------------------------------------------------------------------------------------------
// The feed pass (raw SQL bookkeeping of a non-synced table, lock-free)

interface FeedCursor {
  ewma: Ewma;
  /** the longest asset transaction of the pass (ms) */
  max_ms: number;
  /** devices ITAM refused today */
  skip: string[];
}

interface Warning {
  code: string;
  message: string;
}

/** The start of the current UTC day: the daily cap counts the feed passes started since. */
export const dayStart = (now = Date.now()) => new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString();
/** Until the next UTC day, plus up to five minutes so the organisations' feeds do not all start at once. */
export const untilTomorrow = (now = Date.now()) => DAY_MS - (now % DAY_MS) + Math.round(Math.random() * 300_000);

async function runningFeed(q: Queryable, orgId: string, connectorId: string): Promise<Row | null> {
  return q.one<Row>(`select * from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = '${FEED_LANE}' and state = 'running' and deleted_at is null`, [orgId, connectorId]);
}

/** Assets the connector's feed made today (UTC), the running pass's included. */
export async function madeToday(q: Queryable, orgId: string, connectorId: string): Promise<number> {
  const r = await q.one<{ n: number }>(
    `select coalesce(sum(created), 0)::int as n from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = '${FEED_LANE}' and started_at >= $3::timestamptz and deleted_at is null`,
    [orgId, connectorId, dayStart()],
  );
  return Number(r?.n ?? 0);
}

async function openFeed(q: Queryable, orgId: string, connectorId: string, origin: string): Promise<Row> {
  try {
    const row = await q.one<Row>(
      `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, cursor, generation, pages, fetched, staged,
         skipped_unchanged, refreshed, retried, created, updated, unmatched, duplicates, failed, stale_marked, problems_opened, problems_cleared,
         complete, warnings, origin)
       values ($1, $2, $3, '${FEED_LANE}', 'schedule', 'running', now(), '{}'::jsonb, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, '[]'::jsonb, $4)
       returning *`,
      [uuidv7(), orgId, connectorId, origin],
    );
    return row!;
  } catch (e) {
    // one running pass per connector and lane: a concurrent opener finds the other's
    if ((e as { code?: string })?.code !== "23505") throw e;
    const other = await runningFeed(q, orgId, connectorId);
    if (!other) throw e;
    return other;
  }
}

/** Take (or keep) the pass for this job: false while another worker holds it. */
async function claimFeed(q: Queryable, orgId: string, runId: string, worker: string): Promise<boolean> {
  return !!(await q.one(
    `update sm_discovery_runs set lease_by = $3, lease_until = now() + interval '${LEASE_MINUTES} minutes', updated_at = now()
     where org_id = $1 and id = $2 and state = 'running' and (lease_until is null or lease_until < now() or lease_by = $3) returning id`,
    [orgId, runId, worker],
  ));
}

const appendWarnings = (param: string) =>
  `case when ${param}::jsonb is null then warnings else (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(coalesce(warnings, '[]'::jsonb) || ${param}::jsonb) e limit ${MAX_WARNINGS}) s) end`;

/** Write the cursor, add to the counters, renew the lease. */
async function saveFeed(q: Queryable, orgId: string, runId: string, cursor: FeedCursor, created: number, failed: number, warning?: Warning): Promise<void> {
  await q.query(
    `update sm_discovery_runs set cursor = $3::jsonb, created = created + $4, failed = failed + $5, warnings = ${appendWarnings("$6")},
       lease_until = now() + interval '${LEASE_MINUTES} minutes', updated_at = now()
     where org_id = $1 and id = $2`,
    [orgId, runId, JSON.stringify(cursor), created, failed, warning ? JSON.stringify([warning]) : null],
  );
}

async function finishFeed(q: Queryable, orgId: string, runId: string, warning?: Warning): Promise<void> {
  await q.query(
    `update sm_discovery_runs set state = 'completed', finished_at = now(), duration_ms = least(2147483647, (extract(epoch from (now() - started_at)) * 1000)::bigint)::int,
       complete = true, warnings = ${appendWarnings("$3")}, lease_by = null, lease_until = null, updated_at = now()
     where org_id = $1 and id = $2 and state = 'running'`,
    [orgId, runId, warning ? JSON.stringify([warning]) : null],
  );
}

export interface FeedOptions {
  /** the job working the pass (its lease) */
  worker: string;
  /** the connector is a demo row (the caller is inside the demo scope, §14.4) */
  demo?: boolean;
}

/**
 * One slice of a connector's asset feed (the job `discovery.itam`, §11.1): assets for its waiting devices, one
 * transaction each, until the slice ends (again at once), the day's cap is reached (again the next day) or no device
 * waits (done). A feed switched off, a paused or deleted connector, or ITAM not yet confirmed: nothing (done).
 */
export async function itamFeed(sys: Ctx, connectorId: string, jctx: Pick<JobContext, "deadline">, opts: FeedOptions): Promise<JobResult> {
  const start = Date.now();
  const db = sys.db;
  const org = sys.org.id;
  const conn = await loadConnector(db, org, connectorId);
  let run = await runningFeed(db, org, connectorId);
  if (!conn || conn.active === false || conn.make_assets !== true || !(await itamConfirmed(db, org))) {
    if (run) await finishFeed(db, org, run.id);
    return;
  }
  // the assets are engine writes, refused while the organisation is not writable: wait (§7.1)
  try {
    await assertWritable(db, org);
  } catch {
    return { again: WRITABLE_AGAIN_MS };
  }
  // a pass belongs to one day: yesterday's ends before today's begins
  if (run && new Date(run.started_at).getTime() < Date.parse(dayStart())) {
    await finishFeed(db, org, run.id);
    run = null;
  }
  const cap = Math.max(0, Math.trunc(Number(conn.make_assets_daily ?? MAKE_ASSETS_DAILY)));
  let made = await madeToday(db, org, connectorId);
  if (made >= cap) {
    if (run) await finishFeed(db, org, run.id, { code: "cap", message: capWarning(cap) });
    return { again: untilTomorrow() };
  }
  const cursor: FeedCursor = { ewma: {}, max_ms: 0, skip: [], ...((run?.cursor as Partial<FeedCursor> | null) ?? {}) };
  let ids = await nextDevices(db, org, connectorId, !!opts.demo, cursor.skip, Math.min(BATCH, cap - made));
  if (!ids.length) {
    if (run) await finishFeed(db, org, run.id);
    return;
  }
  run ??= await openFeed(db, org, connectorId, sys.cfg.origin ?? "cloud");
  if (!(await claimFeed(db, org, run.id, opts.worker))) return { again: BUSY_AGAIN_MS };
  const runId = String(run.id);
  const end = sliceEnd(start, jctx.deadline);
  let worked = false;
  for (;;) {
    const cis = new Map((await liveRows(db, sys, "ci", { f: "id", op: "in", v: ids } as Cond, { limit: ids.length })).map((r) => [String(r.id), r]));
    for (const id of ids) {
      const now = Date.now();
      // an asset starts only while the slice covers 1.5 × its measured time (the slice's first one always)
      if (!mayForce(worked, now, jctx.deadline) && (now >= end || START_FACTOR * predictMs(cursor.ewma, "new", 1) > end - now)) {
        await saveFeed(db, org, runId, cursor, 0, 0);
        return { again: 0 };
      }
      const ci = cis.get(id);
      worked = true;
      let created = 0;
      let failed = 0;
      let warning: Warning | undefined;
      const t0 = Date.now();
      try {
        // a CI gone since it was listed is passed over for the day
        if (ci) created = (await assetsForDiscovered(sys, 1, [ci])).created;
        else cursor.skip = [...cursor.skip, id];
      } catch (e) {
        // ITAM refused this device (its rules, a bad value): the others go on; it is tried again the next day
        if (!(e instanceof AppError)) throw e;
        failed = 1;
        cursor.skip = [...cursor.skip, id];
        warning = { code: "refused", message: `${String(ci?.name ?? ci?.number ?? id).slice(0, 120)}: ${e.message}`.slice(0, 300) };
      }
      if (ci) {
        const ms = Date.now() - t0;
        cursor.ewma = observe(cursor.ewma, "new", 1, ms);
        cursor.max_ms = Math.max(cursor.max_ms, ms);
      }
      made += created;
      await saveFeed(db, org, runId, cursor, created, failed, warning);
      if (made >= cap) {
        await finishFeed(db, org, runId, { code: "cap", message: capWarning(cap) });
        return { again: untilTomorrow() };
      }
      if (cursor.skip.length >= SKIP_KEPT) {
        await finishFeed(db, org, runId, { code: "refused_many", message: SKIP_WARNING });
        return { again: untilTomorrow() };
      }
    }
    ids = await nextDevices(db, org, connectorId, !!opts.demo, cursor.skip, Math.min(BATCH, cap - made));
    if (!ids.length) {
      await saveFeed(db, org, runId, cursor, 0, 0);
      await finishFeed(db, org, runId);
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// «بی‌دارایی»: the devices still waiting, and the roll-up per connector (§8.4)

export interface WaitingRollup {
  connector_id: string;
  name: string;
  /** devices of this connector waiting for an asset */
  waiting: number;
  make_assets: boolean;
  make_assets_daily: number;
  /** assets the feed made today (UTC) */
  made_today: number;
}

/** Devices waiting for an asset among the given connectors. */
export async function waitingCount(q: Queryable, orgId: string, connectorIds: string[]): Promise<number> {
  if (!connectorIds.length) return 0;
  const r = await q.one<{ n: number }>(`select count(*)::int as n ${FROM_SQL} where i.org_id = $1 and i.connector_id = any($2::uuid[]) and ${WAITING_SQL}`, [orgId, pgArray(connectorIds)]);
  return Number(r?.n ?? 0);
}

const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const textOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * The «بی‌دارایی» tab over connectors the caller reads (`connectorIds`), oldest device first — the feed's order. Rows
 * come through the engine's read rules (an item through its connector; the reported record only for callers of field
 * group internal), each with the tool's reported holder and place to help the asset manager; with a roll-up per
 * connector: devices waiting, the feed's switch and cap, and what it made today.
 */
export async function waitingPage(ctx: Ctx, connectorIds: string[], p: { q?: string; page?: number; size?: number }) {
  const size = Math.min(Math.max(Math.trunc(p.size ?? 50) || 50, 1), 500);
  const page = Math.max(Math.trunc(p.page ?? 1) || 1, 1);
  if (!connectorIds.length) return { rows: [] as Row[], total: 0, page, size, display: {} as Record<string, string>, rollup: [] as WaitingRollup[] };
  const org = ctx.org.id;
  const params: unknown[] = [org, pgArray(connectorIds)];
  let search = "";
  if (p.q?.trim()) {
    params.push(likeOf(p.q.trim()));
    search = ` and (i.name ilike $3 or c.name ilike $3 or i.external_id ilike $3)`;
  }
  const where = `where i.org_id = $1 and i.connector_id = any($2::uuid[]) and ${WAITING_SQL}${search}`;
  const total = Number((await ctx.db.one<{ n: number }>(`select count(*)::int as n ${FROM_SQL} ${where}`, params))?.n ?? 0);
  const ids = (await ctx.db.query<{ id: string }>(`select i.id ${FROM_SQL} ${where} order by c.created_at, c.id, i.id limit ${size} offset ${(page - 1) * size}`, params)).map((r) => String(r.id));
  const res = ids.length ? await list(ctx, "discovery_item", { filter: { f: "id", op: "in", v: ids } as never, size: ids.length, total: false }) : { rows: [] as Row[], display: {} as Record<string, string> };
  const byId = new Map(res.rows.map((r) => [String(r.id), r]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((r): r is Row => !!r)
    .map((r) => {
      const reported = (r.data && typeof r.data === "object" ? (r.data as Row).reported : null) as Row | null;
      return { ...r, reported: reported ? { user: textOf(reported.user), site: textOf(reported.site), location: textOf(reported.location) } : null };
    });
  // the roll-up per connector the caller reads
  const per = await ctx.db.query<{ connector_id: string; n: number }>(
    `select i.connector_id, count(*)::int as n ${FROM_SQL} where i.org_id = $1 and i.connector_id = any($2::uuid[]) and ${WAITING_SQL} group by i.connector_id`,
    [org, pgArray(connectorIds)],
  );
  const conns = await ctx.db.query<Row>(
    `select c.id, c.name, c.make_assets, c.make_assets_daily,
       (select coalesce(sum(r.created), 0)::int from sm_discovery_runs r where r.org_id = c.org_id and r.connector_id = c.id and r.lane = '${FEED_LANE}' and r.started_at >= $3::timestamptz and r.deleted_at is null) as made_today
     from sm_discovery_connectors c where c.org_id = $1 and c.id = any($2::uuid[]) and c.deleted_at is null`,
    [org, pgArray(connectorIds), dayStart()],
  );
  const rollup: WaitingRollup[] = conns
    .map((c) => ({
      connector_id: String(c.id), name: String(c.name ?? ""), waiting: per.find((x) => x.connector_id === c.id)?.n ?? 0, make_assets: c.make_assets === true,
      make_assets_daily: Number(c.make_assets_daily ?? MAKE_ASSETS_DAILY), made_today: Number(c.made_today ?? 0),
    }))
    .filter((r) => r.waiting > 0 || r.make_assets)
    .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, "fa"));
  return { rows, total, page, size, display: res.display, rollup };
}

// ---------------------------------------------------------------------------------------------------------------
// The switch (§11.1): only once ITAM has confirmed its discovered-hardware step

async function beforeWrite(w: WriteArgs): Promise<void> {
  if (w.op !== "create" && w.op !== "update") return;
  const turnsOn = w.next.make_assets === true && (w.op === "create" || (w.changed.has("make_assets") && w.prev?.make_assets !== true));
  // the module's own trusted writes pass: the feed itself still makes nothing until ITAM has confirmed
  if (!turnsOn || isSystemCtx(w.ctx) || w.trusted) return;
  if (!(await itamConfirmed(w.tx, w.ctx.org.id))) throw bad(NOT_CONFIRMED_MESSAGE, { field: "make_assets" });
}

let installed = false;

/** The switch's precondition (once per process, from installDiscoveryModule; after the connector guard). */
export function installItamFeed(): void {
  if (installed) return;
  installed = true;
  registerHooks("discovery_connector", { beforeWrite });
}
