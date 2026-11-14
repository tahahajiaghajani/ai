// ITAM feeds of a connector (design A §11; package DA7).
//
//   «ساخت دارایی برای دستگاه‌های تازه» (`make_assets`, §11.1)
//     · who: an asset manager switches it (the connector guard, guard.ts), and only once ITAM has confirmed its own
//       discovered-hardware step (`itam_config.auto_assets_confirmed_at`, stamped when an asset manager makes the first
//       batch from «داشبورد دارایی‌ها»): until then people are refused with what to do, and the feed makes nothing;
//     · what: ITAM's `assetsForDiscovered` for the connector's linked hardware CIs (ITAM's HW_CLASSES) that have no
//       asset — never for an ATM, CRS or kiosk: an item of kind `atm`, a CI with a terminal id, or a CI whose model is
//       one of the bank fleet's by its name, its Latin model or its model number, as tools report them (ciWaits);
//     · how fast: the job `discovery.itam` (after every completed pass while the feed is on, and daily) walks the
//       connector's linked items in its tool's id order, in the pull's slices (≤ 5 s; an asset starts only while the
//       slice covers 1.5 × its measured time), one short transaction per asset, at most `make_assets_daily` (5 000)
//       tries a day — a UTC day, an asset made or a device ITAM refused; the job then waits for the next. A device
//       ITAM refuses is passed over by the day's later walks and tried again the next day.
//     New assets are «تأییدنشده». Their holder and place come only from what people set on the CI: connectors never
//     write `used_by` or `location_id` (§6.3). A walk that makes assets is a `discovery_run` of lane `itam`: `created`
//     counts its assets, `failed` the devices ITAM refused, and its cursor keeps the walk's place, the measured time per
//     asset and the CIs refused today (each walk of the day starts from the day's latest).
//   «بی‌دارایی» (§8.4): the devices still waiting, with the tool's reported holder and place, and a roll-up per
//     connector — a tab of the reconciliation queue (service.ts).
//   Software staging and the SAM feed (§11.2) come with release 1.2 (the owner's decision of 14 November).
import type { Cond } from "@shared/model/conditions";
import { uuidv7 } from "@shared/id";
import { FLEET_CATEGORIES } from "@shared/tables/itam";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { demoScopeOrg, isDemoRow } from "../../db/scope";
import { get, isSystemCtx, list, updateIn } from "../../engine";
import { registerHooks, type WriteArgs } from "../../engine/hooks";
import { AppError, bad, forbidden } from "../../http/errors";
import type { JobContext, JobResult } from "../../jobs";
import { assetsForDiscovered, HW_CLASSES } from "../itam/assets";
import { liveRows } from "../itam/common";
import { sysOf } from "../incident/common";
import { assertWritable } from "../platform/org-admin";
import { mayForce, observe, predictMs, sliceEnd, START_FACTOR, type Ewma } from "./budget";
import { ASSET_ONLY_MESSAGE, DEMO_PEOPLE_MESSAGE, rightsOf } from "./guard";
import { CONNECTOR_MESSAGES } from "./kind";
import { editionOf } from "./net";
import { loadConnector } from "./runner";

type Row = Record<string, any>;

/** The lane of a feed pass in `discovery_run`. */
export const FEED_LANE = "itam";
export const MAKE_ASSETS_DAILY = 5000;
export const DAY_MS = 86_400_000;
/** Items the walk reads per step (each device still gets its own transaction). */
const WALK_STEP = 200;
const LEASE_MINUTES = 5;
const BUSY_AGAIN_MS = 30_000;
const WRITABLE_AGAIN_MS = 15 * 60_000;
const MAX_WARNINGS = 20;
/** CIs refused today that the day's walks remember (beyond them, a refused device is tried again on the next walk). */
export const MAX_REFUSED = 500;

export const NOT_CONFIRMED_MESSAGE =
  "ساخت دارایی برای دستگاه‌های تازه پس از تأیید مدیریت دارایی روشن می‌شود: نخست در «داشبورد دارایی‌ها» دکمهٔ «دارایی برای سخت‌افزار کشف‌شده» را بزنید";
const faNum = (n: number) => n.toLocaleString("fa-IR");
export const capWarning = (cap: number) => `سقف روزانهٔ ساخت دارایی (${faNum(cap)}) پر شد؛ دستگاه‌های دیگر روز بعد دارایی می‌گیرند`;

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
 * A model as compared with the bank fleet's: lower case, Latin letters and digits only, Persian and Arabic digits as
 * Latin ones — «ان‌سی‌آر SelfServ 22e (خودپرداز)», "SelfServ 22e" and "SELFSERV-22E" give one key.
 */
const modelKey = (expr: string) => `regexp_replace(lower(translate(${expr}, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')), '[^a-z0-9]+', '', 'g')`;

/**
 * The CI `c` waits for an asset: live hardware (ITAM's classes) without one, never an ATM, CRS or kiosk. Monitoring
 * tools report those as plain devices (Zabbix and PRTG items are of kind `device`), so any of these names one:
 *   · an item of kind `atm` links it;
 *   · it has a terminal id (an ATM's or a POS terminal's id in the switch, a class attribute): a bank terminal;
 *   · its model is one of `fleet` (fleetKeys): the model ITAM would give it (`assetsForDiscovered` finds it by the CI's
 *     model name, else «<class> نامشخص») by name in any case, or the tool's model by its key (modelKey) — the fleet
 *     model's name, its name without the bracketed kind, or its model number.
 * Each check is an index probe or a test of the row; `offset 0` keeps the planner from flattening the probes into joins
 * it would size without statistics (PGlite, a fresh load).
 */
const ciWaits = (fleet: string) => `c.deleted_at is null and c.merged_into is null and c.class in (${literals(HW_CLASSES)})
  and coalesce(c.state, '') not in ('retired', 'disposed', 'canceled')
  and coalesce(c.attrs->>'terminal_id', '') = ''
  and lower(left(coalesce(nullif(c.model_name, ''), c.class || ' نامشخص'), 200)) <> all(${fleet}::text[])
  and ${modelKey("coalesce(c.model_name, '')")} <> all(${fleet}::text[])
  and not exists (select 1 from sm_assets a where a.org_id = c.org_id and a.ci_id = c.id and a.deleted_at is null offset 0)
  and not exists (select 1 from sm_discovery_items x where x.org_id = c.org_id and x.ci_id = c.id and x.kind = 'atm' and x.deleted_at is null offset 0)`;

/** A linked item `i` (never an ATM's) whose CI waits for an asset — shared by the feed and «بی‌دارایی». */
export const waitingSql = (fleet: string, more = "") => `i.deleted_at is null and i.state = 'linked' and i.ci_id is not null and coalesce(i.kind, '') <> 'atm'
  and exists (select 1 from sm_cis c where c.id = i.ci_id and c.org_id = i.org_id and ${ciWaits(fleet)}${more} offset 0)`;

/**
 * The bank fleet's models (ATM, CRS, kiosk) as ciWaits compares them: each name in lower case, and the keys (modelKey)
 * of its name, its name without the bracketed kind and its model number — keys of fewer than 3 characters say too
 * little (the «۲۱» of «کیوسک خدمات بانکی ۲۱ اینچ»). A CI whose model is one of them never gets an asset here.
 */
export async function fleetKeys(q: Queryable, orgId: string): Promise<string[]> {
  const rows = await q.query<{ k: string }>(
    `with m as (select name, model_number from sm_asset_models where org_id = $1 and deleted_at is null and category = any($2::text[]))
     select lower(name) as k from m where coalesce(name, '') <> ''
     union
     select k from (select ${modelKey("v")} as k from m, lateral (values (name), (regexp_replace(name, '\\([^)]*\\)', '', 'g')), (model_number)) x(v) where v is not null) s
     where length(k) >= 3`,
    [orgId, pgArray(FLEET_CATEGORIES)],
  );
  return rows.map((r) => r.k);
}

/** Has ITAM confirmed its discovered-hardware step (an asset manager made the first batch)? */
export async function itamConfirmed(q: Queryable, orgId: string): Promise<boolean> {
  const r = await q.one<{ at: string | null }>(`select auto_assets_confirmed_at as at from sm_itam_configs where org_id = $1 and deleted_at is null order by created_at limit 1`, [orgId]);
  return !!r?.at;
}

interface Step {
  external_id: string;
  ci_id: string;
  waits: boolean;
}

/**
 * The walk's next linked items of a connector after `after`, in its tool's id order (the connector's unique index),
 * each with whether its CI waits — a demo connector's only on demo CIs, a real one's only on real ones (§14.4).
 */
async function walkStep(q: Queryable, orgId: string, connectorId: string, demo: boolean, fleet: string[], after: string | null): Promise<Step[]> {
  return q.query<Step>(
    `select i.external_id, i.ci_id,
       exists (select 1 from sm_cis c where c.id = i.ci_id and c.org_id = i.org_id and ${ciWaits("$5")}
                 and exists (select 1 from sm_demo_rows d where d.org_id = c.org_id and d.row_id = c.id) = $4::boolean offset 0) as waits
     from sm_discovery_items i
     where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.state = 'linked' and i.ci_id is not null and coalesce(i.kind, '') <> 'atm'
       and ($3::text is null or i.external_id > $3::text)
     order by i.external_id limit ${WALK_STEP}`,
    [orgId, connectorId, after, demo, pgArray(fleet)],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The feed pass (raw SQL bookkeeping of a non-synced table, lock-free)

interface FeedCursor {
  ewma: Ewma;
  /** the longest asset transaction of the pass (ms) */
  max_ms: number;
  /** the walk's place: the last item passed (its tool's id) */
  after: string | null;
  /** CIs ITAM refused today (≤ MAX_REFUSED): the day's later walks pass them over, the next day tries them again */
  refused: string[];
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

/**
 * Devices the connector's feed tried today (UTC), the running pass's included: the assets it made and the devices ITAM
 * refused — the daily cap counts both, so refusals never cost more than the cap's transactions a day.
 */
export async function triedToday(q: Queryable, orgId: string, connectorId: string): Promise<number> {
  const r = await q.one<{ n: number }>(
    `select coalesce(sum(created + failed), 0)::int as n from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = '${FEED_LANE}' and started_at >= $3::timestamptz and deleted_at is null`,
    [orgId, connectorId, dayStart()],
  );
  return Number(r?.n ?? 0);
}

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_REFUSED) : []);

/** The CIs ITAM refused today (UTC), kept by the day's latest walk: a new walk of the day starts from them. */
async function refusedToday(q: Queryable, orgId: string, connectorId: string): Promise<string[]> {
  const r = await q.one<{ refused: unknown }>(
    `select cursor->'refused' as refused from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = '${FEED_LANE}' and started_at >= $3::timestamptz and deleted_at is null
     order by started_at desc limit 1`,
    [orgId, connectorId, dayStart()],
  );
  return idsOf(r?.refused);
}

async function openFeed(q: Queryable, orgId: string, connectorId: string, origin: string, cursor: FeedCursor): Promise<Row> {
  try {
    const row = await q.one<Row>(
      `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, cursor, generation, pages, fetched, staged,
         skipped_unchanged, refreshed, retried, created, updated, unmatched, duplicates, failed, stale_marked, problems_opened, problems_cleared,
         complete, warnings, origin)
       values ($1, $2, $3, '${FEED_LANE}', 'schedule', 'running', now(), $5::jsonb, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, '[]'::jsonb, $4)
       returning *`,
      [uuidv7(), orgId, connectorId, origin, JSON.stringify(cursor)],
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
 * One slice of a connector's asset feed (the job `discovery.itam`, §11.1): the walk over its linked items goes on, and
 * every waiting device gets its asset in its own transaction — until the slice ends (again at once), the day's cap is
 * reached (again the next day) or the walk ends (done). A feed switched off, a paused or deleted connector, or ITAM not
 * yet confirmed: nothing (done). A walk that finds nothing to make leaves no run behind.
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
  // a walk belongs to one day: yesterday's ends before today's begins
  if (run && new Date(run.started_at).getTime() < Date.parse(dayStart())) {
    await finishFeed(db, org, run.id);
    run = null;
  }
  const cap = Math.max(0, Math.trunc(Number(conn.make_assets_daily ?? MAKE_ASSETS_DAILY)));
  // the cap counts tries: assets made and devices ITAM refused
  let tried = await triedToday(db, org, connectorId);
  if (tried >= cap) {
    if (run) await finishFeed(db, org, run.id, { code: "cap", message: capWarning(cap) });
    return { again: untilTomorrow() };
  }
  if (run && !(await claimFeed(db, org, run.id, opts.worker))) return { again: BUSY_AGAIN_MS };
  const cursor: FeedCursor = { ewma: {}, max_ms: 0, after: null, ...((run?.cursor as Partial<FeedCursor> | null) ?? {}), refused: [] };
  // devices ITAM refused today wait for the next day: a new walk starts from what the day's latest one kept
  cursor.refused = run ? idsOf((run.cursor as Row | null)?.refused) : await refusedToday(db, org, connectorId);
  const refused = new Set(cursor.refused);
  const fleet = await fleetKeys(db, org);
  const end = sliceEnd(start, jctx.deadline);
  // the slice's first item always moves the walk on (the progress guarantee, budget.ts mayForce)
  let moved = false;
  /** the walk's run, opened when it first has something to keep (an asset, or its place at a slice's end) */
  const runOf = async (): Promise<string | null> => {
    if (!run) {
      run = await openFeed(db, org, connectorId, sys.cfg.origin ?? "cloud", cursor);
      if (!(await claimFeed(db, org, run.id, opts.worker))) return null;
    }
    return String(run.id);
  };
  for (;;) {
    const steps = await walkStep(db, org, connectorId, !!opts.demo, fleet, cursor.after);
    if (!steps.length) {
      // the walk is over: today's devices have their assets, or ITAM refused them (the next day tries again)
      if (run) {
        await saveFeed(db, org, String(run.id), cursor, 0, 0);
        await finishFeed(db, org, String(run.id));
      }
      return;
    }
    const waiting = steps.filter((x) => x.waits && !refused.has(String(x.ci_id)));
    const cis = waiting.length ? new Map((await liveRows(db, sys, "ci", { f: "id", op: "in", v: [...new Set(waiting.map((x) => x.ci_id))] } as Cond, { limit: waiting.length })).map((r) => [String(r.id), r])) : new Map<string, Row>();
    for (const step of steps) {
      const now = Date.now();
      const ci = step.waits && !refused.has(String(step.ci_id)) ? cis.get(String(step.ci_id)) : undefined;
      // the slice ends on time; an asset starts only while the slice covers 1.5 × its measured time
      if (!mayForce(moved, now, jctx.deadline) && (now >= end || (ci && START_FACTOR * predictMs(cursor.ewma, "new", 1) > end - now))) {
        const id = await runOf();
        if (!id) return { again: BUSY_AGAIN_MS };
        await saveFeed(db, org, id, cursor, 0, 0);
        return { again: 0 };
      }
      moved = true;
      if (!ci) {
        cursor.after = step.external_id;
        continue;
      }
      const id = await runOf();
      if (!id) return { again: BUSY_AGAIN_MS };
      let created = 0;
      let failed = 0;
      let warning: Warning | undefined;
      const t0 = Date.now();
      try {
        created = (await assetsForDiscovered(sys, 1, [ci])).created;
      } catch (e) {
        // ITAM refused this device (its rules, a bad value): the walk goes on; the day's later walks pass it over
        if (!(e instanceof AppError)) throw e;
        failed = 1;
        warning = { code: "refused", message: `${String(ci.name ?? ci.number ?? step.external_id).slice(0, 120)}: ${e.message}`.slice(0, 300) };
        refused.add(String(step.ci_id));
        if (cursor.refused.length < MAX_REFUSED) cursor.refused.push(String(step.ci_id));
      }
      const ms = Date.now() - t0;
      cursor.ewma = observe(cursor.ewma, "new", 1, ms);
      cursor.max_ms = Math.max(cursor.max_ms, ms);
      cursor.after = step.external_id;
      tried += created + failed;
      await saveFeed(db, org, id, cursor, created, failed, warning);
      if (tried >= cap) {
        await finishFeed(db, org, id, { code: "cap", message: capWarning(cap) });
        return { again: untilTomorrow() };
      }
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
  /** devices ITAM refused today (UTC): they count against the cap with the assets, and wait for the next day */
  refused_today: number;
}

/** Devices waiting for an asset among the given connectors (items: a device two connectors report counts twice). */
export async function waitingCount(q: Queryable, orgId: string, connectorIds: string[]): Promise<number> {
  if (!connectorIds.length) return 0;
  const r = await q.one<{ n: number }>(`select count(*)::int as n from sm_discovery_items i where i.org_id = $1 and i.connector_id = any($2::uuid[]) and ${waitingSql("$3")}`, [
    orgId,
    pgArray(connectorIds),
    pgArray(await fleetKeys(q, orgId)),
  ]);
  return Number(r?.n ?? 0);
}

/** The tab's columns; the reported record (`data`, field group internal) only for those who may read it. */
const ITEM_FIELDS = ["connector_id", "external_id", "kind", "name", "ci_id", "asset_id", "state", "matched_by", "first_seen_at", "listed_at", "last_contact_at", "status", "link_url", "data"];
const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const textOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * The «بی‌دارایی» tab over connectors the caller reads (`connectorIds`), per connector in its tool's id order — the
 * feed's order. Rows come through the engine's read rules (an item through its connector; the reported record only for
 * callers of field group internal), each with the tool's reported holder and place to help the asset manager; with a
 * roll-up per connector: devices waiting, the feed's switch and cap, and what it made and ITAM refused today.
 */
export async function waitingPage(ctx: Ctx, connectorIds: string[], p: { q?: string; page?: number; size?: number }) {
  const size = Math.min(Math.max(Math.trunc(p.size ?? 50) || 50, 1), 500);
  const page = Math.max(Math.trunc(p.page ?? 1) || 1, 1);
  if (!connectorIds.length) return { rows: [] as Row[], total: 0, page, size, display: {} as Record<string, string>, rollup: [] as WaitingRollup[] };
  const org = ctx.org.id;
  const fleet = pgArray(await fleetKeys(ctx.db, org));
  // the roll-up per connector the caller reads
  const per = await ctx.db.query<{ connector_id: string; n: number }>(
    `select i.connector_id, count(*)::int as n from sm_discovery_items i where i.org_id = $1 and i.connector_id = any($2::uuid[]) and ${waitingSql("$3")} group by i.connector_id`,
    [org, pgArray(connectorIds), fleet],
  );
  const params: unknown[] = [org, pgArray(connectorIds), fleet];
  let search = "";
  if (p.q?.trim()) {
    params.push(likeOf(p.q.trim()));
    search = ` and (i.name ilike $4 or i.external_id ilike $4)`;
  }
  const where = `where i.org_id = $1 and i.connector_id = any($2::uuid[]) and ${waitingSql("$3")}${search}`;
  const total = search ? Number((await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_discovery_items i ${where}`, params))?.n ?? 0) : per.reduce((t, x) => t + x.n, 0);
  const ids = (await ctx.db.query<{ id: string }>(`select i.id from sm_discovery_items i ${where} order by i.connector_id, i.external_id limit ${size} offset ${(page - 1) * size}`, params)).map((r) => String(r.id));
  const res = ids.length ? await list(ctx, "discovery_item", { filter: { f: "id", op: "in", v: ids } as never, fields: ITEM_FIELDS, size: ids.length, total: false }) : { rows: [] as Row[], display: {} as Record<string, string> };
  const byId = new Map(res.rows.map((r) => [String(r.id), r]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((r): r is Row => !!r)
    .map((r) => {
      const reported = (r.data && typeof r.data === "object" ? (r.data as Row).reported : null) as Row | null;
      return { ...r, reported: reported ? { user: textOf(reported.user), site: textOf(reported.site), location: textOf(reported.location) } : null };
    });
  const conns = await ctx.db.query<Row>(
    `select c.id, c.name, c.make_assets, c.make_assets_daily, t.made_today, t.refused_today
     from sm_discovery_connectors c,
       lateral (select coalesce(sum(r.created), 0)::int as made_today, coalesce(sum(r.failed), 0)::int as refused_today from sm_discovery_runs r
                where r.org_id = c.org_id and r.connector_id = c.id and r.lane = '${FEED_LANE}' and r.started_at >= $3::timestamptz and r.deleted_at is null) t
     where c.org_id = $1 and c.id = any($2::uuid[]) and c.deleted_at is null`,
    [org, pgArray(connectorIds), dayStart()],
  );
  const rollup: WaitingRollup[] = conns
    .map((c) => ({
      connector_id: String(c.id), name: String(c.name ?? ""), waiting: per.find((x) => x.connector_id === c.id)?.n ?? 0, make_assets: c.make_assets === true,
      make_assets_daily: Number(c.make_assets_daily ?? MAKE_ASSETS_DAILY), made_today: Number(c.made_today ?? 0), refused_today: Number(c.refused_today ?? 0),
    }))
    .filter((r) => r.waiting > 0 || r.make_assets)
    .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, "fa"));
  return { rows, total, page, size, display: res.display, rollup };
}

// ---------------------------------------------------------------------------------------------------------------
// The switch (§11.1): asset managers, only once ITAM has confirmed its discovered-hardware step

/**
 * «ساخت دارایی برای دستگاه‌های تازه» and its daily cap, switched by an asset manager on a connector they read (§14.5).
 * The connector's record is the CMDB's to write (its owner or a CMDB administrator), so this switch has its own route;
 * it changes nothing else, and the connector's history shows the person.
 */
export async function switchAssetFeed(ctx: Ctx, id: string, input: { make_assets?: boolean; make_assets_daily?: number }): Promise<{ id: string; make_assets: boolean; make_assets_daily: number }> {
  if (editionOf(ctx.cfg) === "desktop") throw new AppError(403, "desktop", CONNECTOR_MESSAGES.desktop);
  const rights = await rightsOf(ctx);
  await get(ctx, "discovery_connector", id);
  if (!rights.assetManager) throw forbidden(ASSET_ONLY_MESSAGE);
  // the demo pack's people act only on the pack's connectors
  if (demoScopeOrg() === ctx.org.id && !(await isDemoRow(ctx.db, ctx.org.id, id))) throw forbidden(DEMO_PEOPLE_MESSAGE);
  const patch: Row = {};
  if (typeof input.make_assets === "boolean") patch.make_assets = input.make_assets;
  if (input.make_assets_daily !== undefined) patch.make_assets_daily = input.make_assets_daily;
  if (!Object.keys(patch).length) throw bad("چیزی برای تغییر فرستاده نشد");
  const row = await loadConnector(ctx.db, ctx.org.id, id);
  if (patch.make_assets === true && row?.make_assets !== true && !(await itamConfirmed(ctx.db, ctx.org.id))) throw bad(NOT_CONFIRMED_MESSAGE, { field: "make_assets" });
  const by = sysOf(ctx, ctx.user.id);
  await by.write((tx) => updateIn(tx, by, "discovery_connector", id, patch, { trusted: true }));
  const now = await loadConnector(ctx.db, ctx.org.id, id);
  return { id, make_assets: now?.make_assets === true, make_assets_daily: Number(now?.make_assets_daily ?? MAKE_ASSETS_DAILY) };
}

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
