// The pull runner (design A §7.3–§7.5): one inventory pass of a connector, worked in slices of at most five seconds and
// resumed from the cursor kept on its discovery_run.
//
//   start ─► fetch page ─► stage (internal, set-based) ─► reconcile new/changed (IRE calls within the budget)
//         ─► next page … ─► parents ─► refresh ─► retry ─► (reapply) ─► finalise ─► stale ─► done
//
// · One running pass per connector and lane (the unique partial index), and one worker on it at a time (the run's
//   lease, renewed with every cursor write): two ticks of one connector never work one pass at once.
// · Staging and its cursor commit together; every IRE call's item results, counters and cursor commit in the IRE's
//   own transaction (the system context's write is wrapped) — a killed worker resumes exactly where it was, and an
//   item waits for the engine while its `reconciled_at` is null (stage.ts).
// · What reaches the engine (§7.4): new and changed items at once; linked unchanged items by the rolling refresh
//   (older than `refresh_days`, the source still in contact, at most 1/`refresh_days` of the linked items a day);
//   unmatched, duplicate and error items every `retry_hours`; every item on «اعمال دوباره روی همه». Linked items pass
//   their CI as the identity hint; `create_policy` other than «ساخت و به‌روزرسانی» (and every ATM) asks for no creation.
// · Errors (§7.5): a network or 5xx failure is retried three times (Retry-After honoured — the job comes back, it never
//   sleeps), then the pass fails «… پاسخ نداد»; 401/403 fail at once «نام کاربری یا کلید پذیرفته نشد»; one bad record
//   is one item in error and the pass goes on.
// · Finalise: a complete pass marks the unlisted items «gone» unless the mass-drop guard trips (§10.4: the owner is told
//   and the ladder waits), and writes a cmdb_import_run only when the pass changed something — all in one transaction
//   with the run's completion. The owner is also told when a third pass in a row fails (§7.5).
// · After every engine call the items' differences with the asset register become mismatches (mismatch.ts, §8.3).
import type { IreAction, IreItem, IreRelation, IreResult } from "@shared/cmdb/api";
import { applyRenames, checkMapping, ciValues } from "@shared/discovery/mapping";
import { normaliseRecord } from "@shared/discovery/normalise";
import { MASS_DROP_WARNING, massDrop } from "@shared/discovery/stale";
import type { Cursor, DiscoveredRecord, RunTrigger } from "@shared/discovery/types";
import { redact, scrubSecrets } from "@shared/event/logic";
import { tableDef } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../../context";
import { isTransientDbError, pgArray, type Queryable, type Tx } from "../../db";
import { isDemoRow } from "../../db/scope";
import { createIn, readSecret, savepoint, transitionIn } from "../../engine";
import { enqueue, type JobContext, type JobResult } from "../../jobs";
import { assertWritable } from "../platform/org-admin";
import { createOrUpdate } from "../cmdb/ire";
import { MIN_CALL, mayForce, observe, planCall, sliceEnd, type CallMode, type Ewma } from "./budget";
import { ConnectorError, CONNECTOR_MESSAGES, type ConnCtx, type ConnectorKind, type ConnectorView } from "./kind";
import { ireItem, mayCreate, PARENT_REL, recordClass } from "./mapping";
import { recordMismatches } from "./mismatch";
import { FAILURES_NOTICE, noticeFailures, noticeMassDrop } from "./notices";
import { connectorFetcher, editionOf } from "./net";
import { serverKind } from "./registry";
import { pendingCount, stagePage } from "./stage";

export const LEASE_MINUTES = 5;
/** Attempts of one page before the pass fails: the first and three retries (§7.5). */
export const PAGE_ATTEMPTS = 4;
/** Warnings and import rows a run keeps. */
const MAX_WARNINGS = 50;
const MAX_IMPORT_ROWS = 200;
/** A pass that lists more pages than this stops (a tool whose cursor never ends). */
const MAX_PAGES = 20_000;
/** Less than this left in the slice: no page fetch starts. */
const FETCH_MIN_MS = 1000;
const WRITABLE_AGAIN_MS = 15 * 60_000;

export type Phase = "fetch" | "parents" | "refresh" | "retry" | "reapply" | "finalise";
type Why = "new" | "parents" | "refresh" | "retry" | "reapply";

export interface RunWarning {
  code?: string;
  external_id?: string;
  message: string;
  accepted?: boolean;
}

/** Where a pass stands (the run's `cursor`, written with every staged page and every IRE call). */
export interface RunCursor {
  phase: Phase;
  /** the kind's own position in its listing */
  kind_cursor: Cursor;
  page: number;
  generation: number;
  /** failed attempts of the current page */
  attempts: number;
  ewma: Ewma;
  /** every page so far answered and said the listing is whole */
  complete: boolean;
  /** a pass of retries only (a connector run by hand only, with retries due) */
  retry_only?: boolean;
  /** «اعمال دوباره روی همه»: one full reconcile of every item at the end of the pass */
  reapply?: boolean;
  /** keyset of the parents and reapply phases */
  after?: string | null;
  /** today's refresh allowance left (set when the refresh phase starts) */
  refresh_left?: number | null;
  /** created + updated + duplicates + failed of listed, retried and reapplied items (refreshes never count) */
  changed: number;
  /** row results for the import run */
  rows: { external_id: string; action: string; ci_id: string | null; number: string | null; message?: string | null }[];
}

type Counters = Partial<Record<"pages" | "fetched" | "staged" | "skipped_unchanged" | "refreshed" | "retried" | "created" | "updated" | "unmatched" | "duplicates" | "failed", number>>;
const COUNTERS = ["pages", "fetched", "staged", "skipped_unchanged", "refreshed", "retried", "created", "updated", "unmatched", "duplicates", "failed"] as const;

type Row = Record<string, any>;

/**
 * Test seam (tests/discovery-runner.test.ts): a simulated crash at a named point of a pass — inside the transaction of
 * that step, so nothing of the step is kept, like a worker that died there. Armed for one hit; null in production.
 */
export const runnerFaults: { at: string | null } = { at: null };
function crashPoint(name: string): void {
  if (runnerFaults.at !== name) return;
  runnerFaults.at = null;
  throw Object.assign(new Error(`simulated crash at ${name}`), { code: "40001" });
}

// ---------------------------------------------------------------------------------------------------------------
// The run row (raw SQL: bookkeeping of a non-synced table, lock-free)

export async function loadConnector(q: Queryable, orgId: string, id: string): Promise<Row | null> {
  return q.one<Row>(`select * from sm_discovery_connectors where org_id = $1 and id = $2::uuid and deleted_at is null`, [orgId, id]);
}

export async function runningRun(q: Queryable, orgId: string, connectorId: string, lane = "inventory"): Promise<Row | null> {
  return q.one<Row>(`select * from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = $3 and state = 'running' and deleted_at is null`, [orgId, connectorId, lane]);
}

const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";

/** The running pass of a connector, or a new one (one per connector and lane: a concurrent creator finds the other's). */
async function ensureRun(q: Queryable, orgId: string, connectorId: string, origin: string, opts: { trigger: RunTrigger; reapply?: boolean; retryOnly?: boolean }): Promise<Row> {
  const found = await runningRun(q, orgId, connectorId);
  if (found) return found;
  const gen = await q.one<{ g: number }>(`select coalesce(max(generation), 0) + 1 as g from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'inventory'`, [orgId, connectorId]);
  const cursor: RunCursor = {
    phase: opts.retryOnly ? "retry" : "fetch", kind_cursor: null, page: 0, generation: Number(gen?.g ?? 1), attempts: 0, ewma: {},
    complete: !opts.retryOnly, retry_only: !!opts.retryOnly, reapply: !!opts.reapply, after: null, refresh_left: null, changed: 0, rows: [],
  };
  try {
    const row = await q.one<Row>(
      `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, cursor, generation, pages, fetched, staged,
         skipped_unchanged, refreshed, retried, created, updated, unmatched, duplicates, failed, stale_marked, problems_opened, problems_cleared,
         complete, warnings, origin)
       values ($1, $2, $3, 'inventory', $4, 'running', now(), $5::jsonb, $6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, '[]'::jsonb, $7)
       returning *`,
      [uuidv7(), orgId, connectorId, opts.trigger, JSON.stringify(cursor), cursor.generation, origin],
    );
    return row!;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const other = await runningRun(q, orgId, connectorId);
    if (!other) throw e;
    return other;
  }
}

/** Take (or keep) the pass for this job: false when another worker holds it. */
async function claim(q: Queryable, orgId: string, runId: string, worker: string): Promise<boolean> {
  return !!(await q.one(
    `update sm_discovery_runs set lease_by = $3, lease_until = now() + interval '${LEASE_MINUTES} minutes', updated_at = now()
     where org_id = $1 and id = $2 and state = 'running' and (lease_until is null or lease_until < now() or lease_by = $3) returning id`,
    [orgId, runId, worker],
  ));
}

async function release(q: Queryable, orgId: string, runId: string, worker: string): Promise<void> {
  await q.query(`update sm_discovery_runs set lease_until = null, updated_at = now() where org_id = $1 and id = $2 and lease_by = $3`, [orgId, runId, worker]);
}

/** Write the cursor, add to the counters and warnings, renew the lease. */
async function saveRun(q: Queryable, orgId: string, runId: string, cursor: RunCursor, delta: Counters = {}, warnings: RunWarning[] = []): Promise<void> {
  const params: unknown[] = [orgId, runId, JSON.stringify(cursor)];
  const sets = COUNTERS.map((c) => {
    params.push(Math.trunc(delta[c] ?? 0));
    return `${c} = ${c} + $${params.length}`;
  });
  params.push(warnings.length ? JSON.stringify(warnings) : null);
  const w = `$${params.length}::jsonb`;
  await q.query(
    `update sm_discovery_runs set cursor = $3::jsonb, ${sets.join(", ")},
       warnings = case when ${w} is null then warnings else (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(coalesce(warnings, '[]'::jsonb) || ${w}) e limit ${MAX_WARNINGS}) s) end,
       lease_until = now() + interval '${LEASE_MINUTES} minutes', updated_at = now()
     where org_id = $1 and id = $2`,
    params,
  );
}

async function finishRunSql(q: Queryable, orgId: string, runId: string, state: "completed" | "failed" | "canceled", x: { cursor?: RunCursor; complete?: boolean; itemsTotal?: number | null; error?: string | null; importRunId?: string | null; warnings?: RunWarning[] } = {}): Promise<void> {
  await q.query(
    `update sm_discovery_runs set state = $3, finished_at = now(), duration_ms = least(2147483647, (extract(epoch from (now() - started_at)) * 1000)::bigint)::int,
       complete = coalesce($4, complete), items_total = coalesce($5, items_total), error = $6, import_run_id = coalesce($7::uuid, import_run_id),
       cursor = coalesce($8::jsonb, cursor),
       warnings = case when $9::jsonb is null then warnings else (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(coalesce(warnings, '[]'::jsonb) || $9::jsonb) e limit ${MAX_WARNINGS}) s) end,
       lease_by = null, lease_until = null, updated_at = now()
     where org_id = $1 and id = $2 and state = 'running'`,
    [orgId, runId, state, x.complete ?? null, x.itemsTotal ?? null, x.error ? scrubSecrets(x.error).slice(0, 2000) : null, x.importRunId ?? null, x.cursor ? JSON.stringify(x.cursor) : null, x.warnings?.length ? JSON.stringify(x.warnings) : null],
  );
}

/** Stop a running pass (a person's «لغو»): its worker stops at its next step. */
export async function cancelRun(q: Queryable, orgId: string, runId: string): Promise<boolean> {
  const r = await q.query(`update sm_discovery_runs set state = 'canceled', finished_at = now(), lease_by = null, lease_until = null, updated_at = now() where org_id = $1 and id = $2 and state = 'running' returning id`, [orgId, runId]);
  return r.length > 0;
}

/** How many of a connector's latest inventory passes failed in a row (the owner is told after three, §7.5). */
export async function consecutiveFailures(q: Queryable, orgId: string, connectorId: string): Promise<number> {
  const rows = await q.query<{ state: string }>(`select state from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'inventory' and state in ('completed', 'failed') and deleted_at is null order by started_at desc limit 10`, [orgId, connectorId]);
  let n = 0;
  for (const r of rows) {
    if (r.state !== "failed") break;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// The connector as its kind sees it

const tags = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function connectorView(row: Row, options: Record<string, unknown>): ConnectorView {
  const mapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(row.mapping))) if (typeof v === "string") mapping[k] = v;
  return {
    id: row.id, name: String(row.name ?? ""), kind: String(row.kind ?? ""), base_url: row.base_url ?? null, hosts: tags(row.hosts), auth: row.auth ?? null,
    username: row.username ?? null, api_key_header: row.api_key_header ?? null, plain_http: !!row.plain_http, collect: tags(row.collect), options, mapping,
    default_class: row.default_class ?? null, rate_per_second: Number(row.rate_per_second ?? 5) || 5, ca_cert: row.ca_cert ?? null,
  };
}

/** The connector's options as its kind's schema reads them, or the Persian reason they do not parse. */
export function kindOptions(kind: ConnectorKind, raw: unknown): { options: Record<string, unknown> } | { error: string } {
  const r = kind.optionsSchema.safeParse(raw ?? {});
  if (r.success) return { options: r.data as Record<string, unknown> };
  const first = r.error.issues[0];
  return { error: `تنظیمات ابزار درست نیست: «${first?.path?.join(".") || "options"}» — ${first?.message ?? ""}`.trim() };
}

/** The ConnCtx of one job slice: options, secrets read once, the pinned fetch. */
async function connCtx(sys: Ctx, row: Row, kind: ConnectorKind, options: Record<string, unknown>, deadline: number): Promise<ConnCtx> {
  const def = tableDef("discovery_connector")!;
  const view = connectorView(row, options);
  const [secret, secret2] = await Promise.all([readSecret(sys.db, sys, def, row.id, "secret"), readSecret(sys.db, sys, def, row.id, "secret2")]);
  const fetcher = connectorFetcher(sys.cfg, view, kind.headers);
  const edition = editionOf(sys.cfg);
  return {
    connector: view, options, secret, secret2, edition, deadline, now: () => new Date(),
    fetchJson: fetcher.fetchJson, fetchText: fetcher.fetchText,
    log: (message, data) => sys.cfg.log?.info?.(`discovery «${view.name}»: ${message}`, data),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One reconciliation call, atomic with its bookkeeping

interface Candidate {
  id: string;
  external_id: string;
  data: DiscoveredRecord;
  ci_id: string | null;
}

/** A system context whose write runs `after` in the same transaction as the engine's writes (one per slice). */
function ireCtx(sys: Ctx) {
  let after: ((tx: Tx, out: IreResult) => Promise<void>) | null = null;
  const ctx: Ctx = {
    ...sys,
    write: <T,>(fn: (tx: Tx) => Promise<T>, opts?: Parameters<Ctx["write"]>[1]) =>
      sys.write<T>(async (tx) => {
        const out = await fn(tx);
        if (after) await after(tx, out as unknown as IreResult);
        return out;
      }, opts),
  };
  return { ctx, set: (fn: typeof after) => void (after = fn) };
}

const asRecord = (v: unknown): DiscoveredRecord => (v && typeof v === "object" ? (v as DiscoveredRecord) : ({ external_id: "", kind: "other", name: "" } as DiscoveredRecord));

// ---------------------------------------------------------------------------------------------------------------
// The pass

export interface PullOptions {
  /** the job (it holds the pass's lease) */
  worker: string;
  trigger?: RunTrigger;
  reapply?: boolean;
  retryOnly?: boolean;
  /** the job runs demo work (its connector is a demo row): what it queues is demo work too */
  demo?: boolean;
}

/** One slice of a connector's inventory pass. Returns when the slice is spent ({again: 0}) or the pass ended. */
export async function runPull(sys: Ctx, connectorId: string, jctx: Pick<JobContext, "deadline">, opts: PullOptions): Promise<JobResult> {
  const db = sys.db;
  const org = sys.org.id;
  const started = Date.now();
  const end = sliceEnd(started, jctx.deadline);
  if (editionOf(sys.cfg) === "desktop") return;
  const conn = await loadConnector(db, org, connectorId);
  if (!conn) {
    await db.query(`update sm_discovery_runs set state = 'canceled', finished_at = now(), lease_by = null, lease_until = null where org_id = $1 and connector_id = $2 and state = 'running'`, [org, connectorId]);
    return;
  }
  // `internal` bookkeeping skips the organisation's platform status: one check per slice (§7.1)
  try {
    await assertWritable(db, org);
  } catch {
    return { again: WRITABLE_AGAIN_MS };
  }
  let run = await ensureRun(db, org, connectorId, sys.cfg.origin ?? "cloud", { trigger: opts.trigger ?? "schedule", reapply: opts.reapply, retryOnly: opts.retryOnly });
  if (!(await claim(db, org, run.id, opts.worker))) return { again: 15_000 };
  let cursor = run.cursor as RunCursor;
  if (opts.reapply && !cursor.reapply) cursor = { ...cursor, reapply: true };

  const fail = async (message: string) => {
    await finishRunSql(db, org, run.id, "failed", { cursor, error: message, complete: false });
    // the owner hears of a tool that keeps failing, once, when the third pass in a row fails (§7.5)
    if ((await consecutiveFailures(db, org, connectorId)) === FAILURES_NOTICE) await noticeFailures(db, org, connectorId, message).catch(() => false);
  };
  const kind = serverKind(conn.kind);
  if (!kind) {
    await fail("نوع این منبع در این نسخهٔ کاریز شناخته نیست");
    return;
  }
  if (!kind.ready) {
    await fail(CONNECTOR_MESSAGES.notBuilt(kind.label));
    return;
  }
  const edition = editionOf(sys.cfg);
  if (!kind.editions.includes(edition as "cloud" | "server")) {
    await fail(`منبع «${kind.label}» در این نسخهٔ کاریز اجرا نمی‌شود`);
    return;
  }
  if (!conn.source_id) {
    await fail("منبع دادهٔ پیکربندیِ این منبع پیدا نشد");
    return;
  }
  const parsed = kindOptions(kind, conn.options);
  if ("error" in parsed) {
    await fail(parsed.error);
    return;
  }
  const options = parsed.options;
  const cctx = await connCtx(sys, conn, kind, options, end);
  const wrapped = ireCtx(sys);
  const retryHours = Math.max(1, Number(conn.retry_hours ?? 24));
  const listingIsContact = options.listing_is_contact === true;
  /** Did this slice fetch a page or make an engine call yet (the progress guarantee, budget.ts mayForce)? */
  let worked = false;
  const force = () => mayForce(worked, Date.now(), jctx.deadline);

  /** Reconcile these items: one engine call per create policy among them (an ATM never creates). */
  const reconcile = async (items: Candidate[], why: Why, mode: CallMode): Promise<void> => {
    const byCreate = new Map<boolean, Candidate[]>();
    for (const c of items) {
      const create = why !== "parents" && mayCreate(c.data, conn.create_policy);
      byCreate.set(create, [...(byCreate.get(create) ?? []), c]);
    }
    for (const [create, group] of byCreate) {
      const parentIds = [...new Set(group.map((c) => c.data.parent_external_id).filter((x): x is string => !!x))];
      const parents = parentIds.length
        ? await db.query<{ external_id: string; ci_id: string }>(`select external_id, ci_id from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and ci_id is not null and external_id = any($3::text[])`, [org, connectorId, pgArray(parentIds)])
        : [];
      const parentCi = new Map(parents.map((p) => [p.external_id, p.ci_id]));
      const indexOf = new Map(group.map((c, i) => [c.external_id, i]));
      const ireItems: IreItem[] = group.map((c, i) => {
        const relations: IreRelation[] = [];
        const pid = c.data.parent_external_id;
        if (pid) {
          const j = indexOf.get(pid);
          if (j !== undefined && j !== i) relations.push({ type: PARENT_REL, direction: "out", item: j });
          else if (parentCi.get(pid)) relations.push({ type: PARENT_REL, direction: "out", ci_id: parentCi.get(pid) });
        }
        return ireItem({ record: c.data, defaultClass: conn.default_class ?? null, hint: c.ci_id, relations });
      });
      const done: { next: RunCursor | null } = { next: null };
      wrapped.set(async (tx, out) => {
        const retryAt = new Date(Date.now() + retryHours * 3600_000).toISOString();
        const delta: Counters = {};
        const add = (k: keyof Counters, n = 1) => (delta[k] = (delta[k] ?? 0) + n);
        const rows: RunCursor["rows"] = [];
        const updates = out.results.map((r) => {
          const c = group[r.index];
          const message = r.message ? scrubSecrets(String(r.message)).slice(0, 500) : null;
          if (why === "new" || why === "retry" || why === "reapply") {
            if (r.action === "created") add("created");
            else if (r.action === "updated") add("updated");
            else if (r.action === "unmatched") add("unmatched");
            else if (r.action === "duplicate") add("duplicates");
            else if (r.action !== "unchanged") add("failed");
            if (r.action !== "unchanged") rows.push({ external_id: c.external_id, action: r.action, ci_id: r.ci_id ?? null, number: r.number ?? null, message });
          } else if (r.action === "error" || r.action === "skipped") add("failed");
          const base = { id: c.id, matched_by: r.matched_by ?? null, message };
          if (r.action === "created" || r.action === "updated" || r.action === "unchanged") return { ...base, state: "linked", ci_id: r.ci_id, keep_ci: false, dedup_task_id: null, retry_at: null };
          if (r.action === "duplicate") return { ...base, state: "duplicate", ci_id: null, keep_ci: false, dedup_task_id: r.dedup_task_id ?? null, retry_at: retryAt };
          if (r.action === "unmatched") return { ...base, state: "unmatched", ci_id: null, keep_ci: false, dedup_task_id: null, retry_at: retryAt };
          return { ...base, state: "error", ci_id: null, keep_ci: true, dedup_task_id: null, retry_at: retryAt };
        });
        if (why === "refresh") add("refreshed", group.length);
        if (why === "retry") add("retried", group.length);
        await tx.query(
          `update sm_discovery_items t set
             state = x.state,
             ci_id = case when x.keep_ci then t.ci_id else x.ci_id end,
             asset_id = case when x.state = 'linked' then (select a.id from sm_assets a where a.org_id = t.org_id and a.ci_id = x.ci_id and a.deleted_at is null limit 1) else t.asset_id end,
             matched_by = x.matched_by, message = x.message, dedup_task_id = x.dedup_task_id,
             reconciled_at = now(), retry_at = x.retry_at, updated_at = now()
           from jsonb_to_recordset($3::jsonb) as x(id uuid, state text, ci_id uuid, keep_ci boolean, matched_by text, message text, dedup_task_id uuid, retry_at timestamptz)
           where t.org_id = $1 and t.connector_id = $2 and t.id = x.id`,
          [org, connectorId, JSON.stringify(updates)],
        );
        // what the tool says and the asset register holds differently (§8.3): the queue's «ناهمخوانی», with the CI — in
        // its own savepoint: a failure here is logged and never fails the reconciliation
        await savepoint(tx, () =>
          recordMismatches(tx, org, out.results.map((r) => {
            const linked = r.action === "created" || r.action === "updated" || r.action === "unchanged";
            return { itemId: group[r.index].id, ciId: linked ? r.ci_id : null, record: group[r.index].data, skipped: r.skipped, sent: ireItems[r.index] };
          })),
        ).catch((e) => {
          if (isTransientDbError(e)) throw e;
          sys.cfg.log?.warn?.("discovery mismatches not recorded", { connector: connectorId, error: scrubSecrets(String((e as Error)?.message ?? e)) });
        });
        crashPoint(`ire:${why}`);
        const changed = (delta.created ?? 0) + (delta.updated ?? 0) + (delta.duplicates ?? 0) + (why === "refresh" || why === "parents" ? 0 : (delta.failed ?? 0));
        done.next = { ...cursor, changed: cursor.changed + changed, rows: [...cursor.rows, ...rows].slice(0, MAX_IMPORT_ROWS) };
        await saveRun(tx, org, run.id, done.next, delta);
      });
      const t0 = performance.now();
      try {
        await createOrUpdate(wrapped.ctx, { source_id: conn.source_id, items: ireItems, create });
        if (done.next) cursor = done.next;
      } catch (e) {
        if (isTransientDbError(e)) throw e;
        // the whole call failed (not one item): its items are in error and the pass goes on
        const message = scrubSecrets(String((e as Error)?.message ?? e)).slice(0, 500);
        await sys.write(async (tx) => {
          await tx.query(
            `update sm_discovery_items set state = 'error', message = $3, reconciled_at = now(), retry_at = now() + make_interval(hours => $4), updated_at = now()
             where org_id = $1 and id = any($2::uuid[])`,
            [org, pgArray(group.map((c) => c.id)), message, retryHours],
          );
          await saveRun(tx, org, run.id, cursor, { failed: group.length }, [{ code: "ire", message }]);
        }, { internal: true });
      } finally {
        wrapped.set(null);
      }
      worked = true;
      cursor = { ...cursor, ewma: observe(cursor.ewma, mode, group.length, performance.now() - t0) };
    }
  };

  /** Items of a connector by one of the phases' rules (the first `n`). */
  const candidates = async (why: Why, n: number): Promise<Candidate[]> => {
    const params: unknown[] = [org, connectorId, n];
    let where: string;
    let order = "t.id";
    if (why === "new") where = `t.reconciled_at is null and (t.state is null or t.state <> 'ignored')`;
    else if (why === "retry") {
      where = `t.state in ('unmatched', 'duplicate', 'error') and t.retry_at <= now()`;
      order = "t.retry_at, t.id";
    } else if (why === "refresh") {
      params.push(Math.max(1, Number(conn.refresh_days ?? 7)), kind.contact === null, Math.max(1, Number(conn.stale_days ?? 14)) + (kind.contact?.lag_days ?? 0));
      where = `t.state = 'linked' and t.ci_id is not null and t.reconciled_at < now() - make_interval(days => $4)
               and ($5::boolean or (t.last_contact_at is not null and t.last_contact_at >= now() - make_interval(days => $6)))`;
      order = "t.reconciled_at, t.id";
    } else if (why === "reapply") {
      params.push(cursor.after ?? "00000000-0000-0000-0000-000000000000");
      where = `(t.state is null or t.state not in ('ignored', 'gone')) and t.id > $4::uuid`;
    } else {
      params.push(cursor.after ?? "00000000-0000-0000-0000-000000000000");
      where = `t.state = 'linked' and t.ci_id is not null and t.data->>'parent_external_id' is not null and t.id > $4::uuid
               and exists (select 1 from sm_discovery_items p where p.org_id = t.org_id and p.connector_id = t.connector_id and p.deleted_at is null
                             and p.external_id = t.data->>'parent_external_id' and p.ci_id is not null
                             and not exists (select 1 from sm_ci_rels r where r.org_id = t.org_id and r.deleted_at is null and r.parent_id = t.ci_id
                                               and r.child_id = p.ci_id and r.type = '${PARENT_REL}' and (r.valid_to is null or r.valid_to > now())))`;
    }
    const rows = await db.query<Row>(
      `select t.id, t.external_id, t.data, t.ci_id from sm_discovery_items t where t.org_id = $1 and t.connector_id = $2 and t.deleted_at is null and ${where} order by ${order} limit $3`,
      params,
    );
    return rows.map((r) => ({ id: r.id, external_id: r.external_id, data: asRecord(r.data), ci_id: r.ci_id ?? null }));
  };

  /** One call of a phase's items, sized to the budget and the slice: "slice" when none fits, "empty" when none is due. */
  const step = async (why: Why, mode: CallMode, cap?: number): Promise<"did" | "slice" | "empty"> => {
    let n = Math.min(planCall(cursor.ewma, mode, Date.now(), end), cap ?? Infinity);
    if (n <= 0) {
      // the slice's first call starts at the smallest size even when the estimate says it will not fit
      if (!force()) return "slice";
      n = Math.min(MIN_CALL, cap ?? MIN_CALL);
    }
    const items = await candidates(why, n);
    if (!items.length) return "empty";
    await reconcile(items, why, mode);
    if (why === "parents" || why === "reapply") {
      cursor = { ...cursor, after: items[items.length - 1].id };
      await saveRun(db, org, run.id, cursor);
    }
    if (why === "refresh") {
      cursor = { ...cursor, refresh_left: Math.max(0, (cursor.refresh_left ?? 0) - items.length) };
      await saveRun(db, org, run.id, cursor);
    }
    return "did";
  };

  const goTo = async (phase: Phase) => {
    cursor = { ...cursor, phase, after: null, refresh_left: phase === "refresh" ? null : cursor.refresh_left };
    await saveRun(db, org, run.id, cursor);
  };

  /** Fetch and stage one page; returns a job result when the pass ended or must come back later. */
  const fetchStep = async (): Promise<JobResult | "next"> => {
    let page;
    try {
      page = await kind.pages(cctx, cursor.kind_cursor);
    } catch (e) {
      if (e instanceof ConnectorError && e.retryable) {
        const attempts = cursor.attempts + 1;
        if (attempts < PAGE_ATTEMPTS) {
          cursor = { ...cursor, attempts };
          await saveRun(db, org, run.id, cursor, {}, [{ code: "retry", message: e.message }]);
          return { again: e.retryAfterMs ?? 15_000 * 4 ** (attempts - 1) };
        }
        await fail(e.message);
        return;
      }
      await fail(e instanceof ConnectorError ? e.message : CONNECTOR_MESSAGES.noAnswer(String(conn.name)));
      if (!(e instanceof ConnectorError)) sys.cfg.log?.warn?.("discovery pull failed", { connector: connectorId, error: scrubSecrets(String((e as Error)?.message ?? e)) });
      return;
    }
    crashPoint("fetch");
    const now = new Date();
    const warnings: RunWarning[] = [];
    const byId = new Map<string, DiscoveredRecord>();
    let rejected = 0;
    for (const raw of page.records ?? []) {
      let n = normaliseRecord(raw, { now });
      if (n.record && kind.kind !== "rest" && Object.keys(cctx.connector.mapping).length) n = normaliseRecord(applyRenames(n.record, cctx.connector.mapping), { now });
      if (!n.record) {
        rejected++;
        if (warnings.length < 20) warnings.push({ code: "record", message: n.error ?? "رکورد پذیرفته نشد" });
        continue;
      }
      for (const w of n.warnings.slice(0, 2)) if (warnings.length < 20) warnings.push({ code: "field", external_id: n.record.external_id, message: w });
      if (listingIsContact && !n.record.last_contact_at) n.record.last_contact_at = now.toISOString();
      if (byId.has(n.record.external_id) && warnings.length < 20) warnings.push({ code: "repeat", external_id: n.record.external_id, message: "ابزار یک شناسه را دو بار در یک صفحه فرستاد؛ آخری نگه داشته شد" });
      byId.set(n.record.external_id, n.record);
    }
    for (const x of page.rejected ?? []) {
      rejected++;
      if (warnings.length < 20) warnings.push({ code: "record", external_id: x.external_id, message: x.message });
    }
    const same = JSON.stringify(page.next ?? null) === JSON.stringify(cursor.kind_cursor ?? null) && page.next !== null;
    const overflow = cursor.page + 1 >= MAX_PAGES;
    if (same) warnings.push({ code: "cursor", message: "ابزار همان صفحه را دوباره فرستاد؛ فهرست ناتمام ماند" });
    if (overflow) warnings.push({ code: "pages", message: `فهرست بیش از ${MAX_PAGES} صفحه شد و ناتمام ماند` });
    const ended = page.next === null || same || overflow;
    const next: RunCursor = {
      ...cursor,
      phase: ended ? "parents" : "fetch",
      kind_cursor: ended ? null : page.next,
      page: cursor.page + 1,
      attempts: 0,
      complete: cursor.complete && page.complete !== false && !same && !overflow,
    };
    await sys.write(async (tx) => {
      const r = await stagePage(tx, {
        orgId: org, connectorId, generation: cursor.generation, configVersion: Number(conn.config_version ?? 1), kindVersion: kind.version,
        records: [...byId.values()], link: kind.link ? (rec) => kind.link!(rec, cctx) : undefined, origin: sys.cfg.origin ?? "cloud",
      });
      crashPoint("stage");
      await saveRun(tx, org, run.id, next, { pages: 1, fetched: (page.records?.length ?? 0) + (page.rejected?.length ?? 0), staged: r.staged, skipped_unchanged: r.unchanged, failed: rejected }, warnings);
    }, { internal: true });
    cursor = next;
    worked = true;
    return "next";
  };

  /** Finalise (§7.3): gone, the mass-drop guard, the import run, the run's completion — one transaction. */
  const finalise = async (): Promise<void> => {
    const complete = cursor.complete && !cursor.retry_only;
    const warnings: RunWarning[] = [];
    await sys.write(async (tx) => {
      const listed = Number((await tx.one<{ n: number }>(`select count(*)::int as n from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and seen_generation = $3`, [org, connectorId, cursor.generation]))?.n ?? 0);
      let gone = 0;
      let stale = false;
      if (complete) {
        const last = await tx.one<{ n: number }>(
          `select items_total as n from sm_discovery_runs r where r.org_id = $1 and r.connector_id = $2 and r.lane = 'inventory' and r.state = 'completed' and r.complete
             and r.id <> $3 and r.deleted_at is null
             and not exists (select 1 from jsonb_array_elements(coalesce(r.warnings, '[]'::jsonb)) w where w->>'code' = 'mass_drop' and coalesce((w->>'accepted')::boolean, false) = false)
           order by r.started_at desc limit 1`,
          [org, connectorId, run.id],
        );
        if (massDrop(listed, last?.n ?? null)) {
          warnings.push({ code: "mass_drop", message: `${MASS_DROP_WARNING}: ${listed} مورد در برابر ${last?.n} مورد گذر کامل پیشین` });
          // nothing is set aside and the ladder waits: the owner decides whether the new size is right (§10.4)
          await noticeMassDrop(tx, org, connectorId, listed, Number(last?.n ?? 0));
        } else {
          gone = (await tx.query(
            `update sm_discovery_items set state = 'gone', updated_at = now()
             where org_id = $1 and connector_id = $2 and deleted_at is null and seen_generation < $3 and (state is null or state not in ('gone', 'ignored')) returning id`,
            [org, connectorId, cursor.generation],
          )).length;
          stale = true;
        }
      }
      let importRunId: string | null = null;
      if (cursor.changed > 0) {
        const counts = await tx.one<Row>(`select staged, retried, created, updated, skipped_unchanged, duplicates, failed, started_at from sm_discovery_runs where org_id = $1 and id = $2`, [org, run.id]);
        const made = await createIn(tx, sys, "cmdb_import_run", {
          name: `منبع داده «${String(conn.name).slice(0, 120)}»`, source_id: conn.source_id, dry_run: false, started_at: counts?.started_at ?? new Date().toISOString(),
          finished_at: new Date().toISOString(), total: Number(counts?.staged ?? 0) + Number(counts?.retried ?? 0), created: Number(counts?.created ?? 0), updated: Number(counts?.updated ?? 0),
          unchanged: Number(counts?.skipped_unchanged ?? 0), duplicates: Number(counts?.duplicates ?? 0), failed: Number(counts?.failed ?? 0),
          results: cursor.rows.map((r, i) => ({ index: i, action: r.action, ci_id: r.ci_id, number: r.number, name: r.external_id, message: r.message ?? null })),
        }, { trusted: true });
        await transitionIn(tx, sys, "cmdb_import_run", made.id, "completed", {}, { trusted: true });
        importRunId = made.id;
      }
      if (gone) warnings.push({ code: "gone", message: `${gone} مورد دیگر گزارش نمی‌شود` });
      crashPoint("finalise");
      await finishRunSql(tx, org, run.id, "completed", { cursor: { ...cursor, phase: "finalise" }, complete, itemsTotal: listed, importRunId, warnings });
      // the contact ladder judges the connector's targets after a complete pass the guard let through (§10)
      if (stale) await enqueue(tx, { kind: "discovery.stale", orgId: org, payload: { connector: connectorId, run: run.id, ...(opts.demo ? { __demo: true } : {}) }, dedupeKey: `discovery.stale:${connectorId}`, maxAttempts: 5 });
    });
  };

  try {
    for (;;) {
      // a person canceled the pass: stop at once
      const live = await db.one<{ state: string }>(`select state from sm_discovery_runs where org_id = $1 and id = $2`, [org, run.id]);
      if (live?.state !== "running") return;
      if (Date.now() >= end && !force()) {
        await saveRun(db, org, run.id, cursor);
        return { again: 0 };
      }
      // new and changed items first, in every phase
      if (await pendingCount(db, org, connectorId, 0)) {
        const r = await step("new", "new");
        if (r === "slice") {
          await saveRun(db, org, run.id, cursor);
          return { again: 0 };
        }
        if (r === "did") continue;
      }
      switch (cursor.phase) {
        case "fetch": {
          if (end - Date.now() < FETCH_MIN_MS && !force()) {
            await saveRun(db, org, run.id, cursor);
            return { again: 0 };
          }
          const r = await fetchStep();
          if (r !== "next") return r;
          continue;
        }
        case "parents": {
          const r = await step("parents", "refresh");
          if (r === "slice") {
            await saveRun(db, org, run.id, cursor);
            return { again: 0 };
          }
          if (r === "empty") await goTo("refresh");
          continue;
        }
        case "refresh": {
          if (cursor.refresh_left === null || cursor.refresh_left === undefined) {
            const linked = Number((await db.one<{ n: number }>(`select count(*)::int as n from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and state = 'linked'`, [org, connectorId]))?.n ?? 0);
            const today = Number((await db.one<{ n: number }>(`select coalesce(sum(refreshed), 0)::int as n from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'inventory' and started_at >= date_trunc('day', now()) and deleted_at is null`, [org, connectorId]))?.n ?? 0);
            cursor = { ...cursor, refresh_left: Math.max(0, Math.ceil(linked / Math.max(1, Number(conn.refresh_days ?? 7))) - today) };
            await saveRun(db, org, run.id, cursor);
          }
          const r = (cursor.refresh_left ?? 0) > 0 ? await step("refresh", "refresh", cursor.refresh_left ?? 0) : "empty";
          if (r === "slice") {
            await saveRun(db, org, run.id, cursor);
            return { again: 0 };
          }
          if (r === "empty" || (cursor.refresh_left ?? 0) <= 0) await goTo("retry");
          continue;
        }
        case "retry": {
          const r = await step("retry", "new");
          if (r === "slice") {
            await saveRun(db, org, run.id, cursor);
            return { again: 0 };
          }
          if (r === "empty") await goTo(cursor.reapply ? "reapply" : "finalise");
          continue;
        }
        case "reapply": {
          const r = await step("reapply", "new");
          if (r === "slice") {
            await saveRun(db, org, run.id, cursor);
            return { again: 0 };
          }
          if (r === "empty") await goTo("finalise");
          continue;
        }
        case "finalise":
          await finalise();
          return;
      }
    }
  } finally {
    await release(db, org, run.id, opts.worker).catch(() => undefined);
  }
}

/** «پذیرش اندازهٔ تازه» (§10.4): a pass the mass-drop guard held is accepted — its unlisted items are marked gone now. */
export async function acceptNewSize(sys: Ctx, runId: string): Promise<{ gone: number } | null> {
  return sys.write(async (tx) => {
    const run = await tx.one<Row>(`select * from sm_discovery_runs where org_id = $1 and id = $2 and state = 'completed' and complete for update`, [sys.org.id, runId]);
    const held = Array.isArray(run?.warnings) && (run!.warnings as RunWarning[]).some((w) => w.code === "mass_drop" && !w.accepted);
    if (!run || !held) return null;
    const gone = (await tx.query(
      `update sm_discovery_items set state = 'gone', updated_at = now()
       where org_id = $1 and connector_id = $2 and deleted_at is null and seen_generation < $3 and (state is null or state not in ('gone', 'ignored')) returning id`,
      [sys.org.id, run.connector_id, run.generation],
    )).length;
    const warnings = (run.warnings as RunWarning[]).map((w) => (w.code === "mass_drop" ? { ...w, accepted: true } : w));
    await tx.query(`update sm_discovery_runs set warnings = $3::jsonb, updated_at = now() where org_id = $1 and id = $2`, [sys.org.id, runId, JSON.stringify(warnings)]);
    // a demo connector's ladder is demo work (§14.4; the caller runs this inside the connector's scope)
    const demo = await isDemoRow(tx, sys.org.id, String(run.connector_id));
    await enqueue(tx, { kind: "discovery.stale", orgId: sys.org.id, payload: { connector: run.connector_id, run: run.id, ...(demo ? { __demo: true } : {}) }, dedupeKey: `discovery.stale:${run.connector_id}`, maxAttempts: 5 });
    return { gone };
  }, { internal: true });
}


// ---------------------------------------------------------------------------------------------------------------
// Preview (§7.5)

export interface PreviewRow {
  external_id: string;
  name: string;
  class: string;
  /** the mapped CI fields and class attributes (what the engine would be sent) */
  values: Record<string, unknown>;
  attrs: Record<string, unknown>;
  /** what the engine would do: «ساخته می‌شود / به‌روز می‌شود / تکراری / بی‌همتا» */
  action: IreAction | "rejected";
  matched_by?: string | null;
  message?: string | null;
  warnings: string[];
  /** the tool's own element, secrets masked — for tenant administrators only (the route strips it for others) */
  raw?: unknown;
}

export interface PreviewDraft {
  mapping?: Record<string, string>;
  options?: Record<string, unknown>;
  default_class?: string | null;
  create_policy?: string | null;
}

/** A preview older than this is a dead one (a preview's own calls end within 30 s). */
const PREVIEW_STUCK_MINUTES = 2;
/** Rows a preview shows at most. */
export const MAX_PREVIEW_ROWS = 100;
export const PREVIEW_BUSY = "پیش‌نمایش دیگری از این منبع در جریان است؛ چند ثانیهٔ دیگر دوباره بزنید";

/**
 * «پیش‌نمایش» (§7.5): the first page only, mapped with the connector's settings or a draft of them (the mapping editor's
 * live preview), run through the engine as a dry run — which rolls everything back — and nothing staged. The pass is
 * recorded as a run of lane `preview`. The caller has checked the person's rights before (a preview sends the stored
 * credentials, §14.5).
 */
export async function previewConnector(sys: Ctx, connectorId: string, draft: PreviewDraft = {}, limit = 20): Promise<{ run_id: string; rows: PreviewRow[]; total?: number; complete?: boolean }> {
  const db = sys.db;
  const org = sys.org.id;
  const conn = await loadConnector(db, org, connectorId);
  if (!conn) throw new ConnectorError("config", "منبع داده پیدا نشد");
  const kind = serverKind(conn.kind);
  if (!kind?.ready) throw new ConnectorError("not_built", CONNECTOR_MESSAGES.notBuilt(kind?.label ?? String(conn.kind)));
  if (!kind.editions.includes(editionOf(sys.cfg) as "cloud" | "server")) throw new ConnectorError("config", `منبع «${kind.label}» در این نسخهٔ کاریز اجرا نمی‌شود`);
  if (draft.mapping) {
    // a draft is held to the connector's own rules (the allow-list, §6.3) before it is tried
    const problems = checkMapping(draft.mapping, { rest: kind.kind === "rest" });
    if (problems.length) throw new ConnectorError("config", problems[0].key ? `نگاشت «${problems[0].key}»: ${problems[0].message}` : problems[0].message);
  }
  const row = { ...conn, ...(draft.mapping ? { mapping: draft.mapping } : {}), ...(draft.default_class !== undefined ? { default_class: draft.default_class } : {}), ...(draft.create_policy ? { create_policy: draft.create_policy } : {}) };
  const parsed = kindOptions(kind, draft.options ?? conn.options);
  if ("error" in parsed) throw new ConnectorError("config", parsed.error);
  const runId = uuidv7();
  // a preview whose process stopped leaves its row running: it is let go once it is older than any preview can be
  await db.query(
    `update sm_discovery_runs set state = 'abandoned', finished_at = now(), updated_at = now()
     where org_id = $1 and connector_id = $2 and lane = 'preview' and state = 'running' and started_at < now() - interval '${PREVIEW_STUCK_MINUTES} minutes'`,
    [org, connectorId],
  );
  try {
    await db.query(
      `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, cursor, generation, pages, fetched, staged, skipped_unchanged, refreshed,
         retried, created, updated, unmatched, duplicates, failed, stale_marked, problems_opened, problems_cleared, complete, warnings, origin)
       values ($1, $2, $3, 'preview', 'preview', 'running', now(), '{}'::jsonb, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, '[]'::jsonb, $4)`,
      [runId, org, connectorId, sys.cfg.origin ?? "cloud"],
    );
  } catch (e) {
    // one preview of a connector at a time (the running-run index)
    if (isUniqueViolation(e)) throw new ConnectorError("config", PREVIEW_BUSY);
    throw e;
  }
  try {
    const cctx = await connCtx(sys, row, kind, parsed.options, Date.now() + 30_000);
    const page = await kind.pages(cctx, null);
    const now = new Date();
    const rows: PreviewRow[] = [];
    const ready: { at: number; record: DiscoveredRecord }[] = [];
    const shown = Math.max(1, Math.min(MAX_PREVIEW_ROWS, Math.floor(limit) || 20));
    (page.records ?? []).slice(0, shown).forEach((raw, i) => {
      let n = normaliseRecord(raw, { now });
      if (n.record && kind.kind !== "rest" && Object.keys(cctx.connector.mapping).length) n = normaliseRecord(applyRenames(n.record, cctx.connector.mapping), { now });
      const element = page.raw?.[i] !== undefined ? redact(page.raw[i]) : undefined;
      if (!n.record) {
        rows.push({ external_id: "", name: "", class: "", values: {}, attrs: {}, action: "rejected", message: n.error ?? null, warnings: n.warnings, raw: element });
        return;
      }
      const { values, attrs } = ciValues(n.record);
      rows.push({ external_id: n.record.external_id, name: n.record.name, class: recordClass(n.record, row.default_class ?? null), values, attrs, action: "unchanged", warnings: n.warnings, raw: element });
      ready.push({ at: rows.length - 1, record: n.record });
    });
    // what the engine would do (linked items through their CI, as a pass would send them)
    const linked = ready.length
      ? await db.query<{ external_id: string; ci_id: string }>(`select external_id, ci_id from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and ci_id is not null and external_id = any($3::text[])`, [org, connectorId, pgArray(ready.map((x) => x.record.external_id))])
      : [];
    const hint = new Map(linked.map((x) => [x.external_id, x.ci_id]));
    for (const create of [true, false]) {
      const group = ready.filter((x) => mayCreate(x.record, row.create_policy) === create);
      if (!group.length) continue;
      const out = await createOrUpdate(sys, {
        source_id: conn.source_id, dry_run: true, create,
        items: group.map((x) => ireItem({ record: x.record, defaultClass: row.default_class ?? null, hint: hint.get(x.record.external_id) ?? null })),
      });
      for (const r of out.results) Object.assign(rows[group[r.index].at], { action: r.action, matched_by: r.matched_by ?? null, message: r.message ? scrubSecrets(String(r.message)) : null });
    }
    await db.query(`update sm_discovery_runs set state = 'completed', finished_at = now(), pages = 1, fetched = $3, complete = $4, items_total = $5, updated_at = now() where org_id = $1 and id = $2`, [org, runId, (page.records ?? []).length, page.next === null && page.complete !== false, page.total ?? null]);
    return { run_id: runId, rows, ...(page.total !== undefined ? { total: page.total } : {}), complete: page.next === null && page.complete !== false };
  } catch (e) {
    const message = e instanceof ConnectorError ? e.message : scrubSecrets(String((e as Error)?.message ?? e)).slice(0, 2000);
    await finishRunSql(db, org, runId, "failed", { error: message, complete: false });
    throw e;
  }
}
