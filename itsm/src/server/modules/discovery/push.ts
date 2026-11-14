// The push API's services (design A §12): tools that send their own records, statuses and open problems to
// /api/v1/discovery/<connector>/… (routes/discovery-api.ts) with an integration user's key.
//
//   · Auth: the key resolves through `apiAuth` (per-key rate limit, the integration user's IP allow-list, sm_int_log);
//     its user must be the connector's `push_user_id`; it must hold the scope «ثبت «موارد منبع داده»» ({ table:
//     "discovery_item", ops: ["create"] }); the connector must be active and of kind push or rest.
//   · Batches (§12.1) are always asynchronous: the batch row is written, its valid records staged (set-based,
//     lock-free) and `discovery.push_batch` queued in one transaction — the outbox — and the answer is 202 with a status
//     URL. The same batch id again answers the stored outcome (200, `duplicate`), nothing reprocessed. Records are
//     checked one by one (a bad one is reported by its index, fields outside the allow-list dropped with a warning);
//     a record older than what the item already holds (its last contact) is ignored. Reconciliation is the pull path's
//     (a retries-only pass under the lock budget); the job writes the outcome when the batch's items are reconciled.
//   · Snapshots: when every part 1..parts of a snapshot id has arrived (any order, within 24 h) it is finalised as a
//     complete pass — unlisted items «gone» unless the mass-drop guard holds it — and parts missing after 24 h abandon
//     it with a warning. Its parts share one listing generation.
//   · Problem sets: a `complete` set is diffed like pulled problems (§9.6).
//   · Status only (§12.2): up to 200 items are answered at once (the writes touch only items and states, ATM values go
//     to the hysteresis), larger requests are queued. A device value needs a strong identifier — the external id of a
//     linked item, a terminal id or a serial — never a hostname or an address; status alone never creates anything.
import { z } from "zod";
import { MASS_DROP_WARNING, massDrop } from "@shared/discovery/stale";
import { normaliseRecord } from "@shared/discovery/normalise";
import { recordState } from "@shared/discovery/availability";
import { RECORD_SCHEMA, STATUS_VALUES, type DiscoveredRecord, type StatusItem } from "@shared/discovery/types";
import { scopeAllows } from "@shared/integration/scopes";
import { FLEET_CATEGORIES } from "@shared/tables/itam";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { inDemoScope } from "../../db/scope";
import { systemCtx } from "../../engine";
import { AppError, bad, forbidden, notFound, zodToAppError } from "../../http/errors";
import { enqueue, registerJobHandler, type JobResult } from "../../jobs";
import type { ApiCaller } from "../integration/api";
import { assertWritable } from "../platform/org-admin";
import { observeDevices, STRONG_ONLY_MESSAGE, type DeviceReport } from "./device";
import { inConnectorScope, JOB_KINDS, queuePull } from "./jobs";
import { CONNECTOR_MESSAGES } from "./kind";
import { noticeMassDrop } from "./notices";
import { editionOf } from "./net";
import { clearVanished, recordProblems } from "./problems";
import { serverKind } from "./registry";
import { loadConnector, NOT_HELD_SQL } from "./runner";
import { itemHash, stagePage } from "./stage";
import { admittedJob, aggregateTargets, applyItemStatuses, type Target } from "./status";

type Row = Record<string, any>;

export const PUSH_LIMITS = { bytes: 1024 * 1024, records: 500, problems: 5000, statusItems: 1000, syncStatus: 200 } as const;
/** A snapshot whose parts are still missing after this long is abandoned. */
export const SNAPSHOT_HOURS = 24;
export const PUSH_STATUS_JOB = "discovery.push_status";

export const PUSH_MESSAGES = {
  notFound: "منبع داده پیدا نشد",
  kind: "این منبع داده ارسال نمی‌پذیرد؛ فقط منبع «ارسال از ابزار (API)» یا REST/JSON عمومی",
  user: "این کلید برای ارسال به این منبع داده نیست؛ ارسال فقط با کلید «کاربر یکپارچه‌سازیِ ارسال‌کننده» همین منبع پذیرفته است",
  scope: "این کلید اجازهٔ ثبت «موارد منبع داده» را ندارد",
  inactive: "این منبع خاموش است",
  batchId: "شناسهٔ دسته لازم است: سرآیند Idempotency-Key یا batch_id در بدنه",
  batchIdMismatch: "شناسهٔ دسته در سرآیند Idempotency-Key و در بدنه یکی نیست",
  tooLarge: "حجم دسته بیش از ۱ مگابایت است؛ آن را در چند دسته بفرستید",
  json: "بدنهٔ درخواست JSON معتبر نیست",
  older: "داده‌ای تازه‌تر از این رکورد پیش‌تر رسیده است؛ این رکورد کنار گذاشته شد",
  unmatched: "با هیچ مورد، پیکربندی یا دارایی‌ای یکی نشد",
  snapshotParts: "شمارهٔ بخش نباید از شمار بخش‌ها بیشتر باشد",
  snapshotAbandoned: "بخش‌هایی از این تصویر کامل تا ۲۴ ساعت نرسید و تصویر رها شد؛ چیزی «دیگر گزارش نمی‌شود» نشد",
  noStatus: "وضعیت دسته پیدا نشد",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// The caller and the connector

/** The connector a key pushes to: refused unless the key's user is its push user, with the scope, and it is active. */
export async function pushConnector(caller: ApiCaller, connectorId: string): Promise<Row> {
  if (editionOf(caller.ctx.cfg) === "desktop") throw new AppError(403, "desktop", CONNECTOR_MESSAGES.desktop);
  const conn = await loadConnector(caller.ctx.db, caller.key.org_id, connectorId);
  if (!conn) throw notFound(PUSH_MESSAGES.notFound);
  if (conn.kind !== "push" && conn.kind !== "rest") throw new AppError(409, "not_push", PUSH_MESSAGES.kind);
  if (!conn.push_user_id || String(conn.push_user_id) !== String(caller.ctx.user.id)) throw forbidden(PUSH_MESSAGES.user);
  if (!scopeAllows(caller.key.table_scopes ?? [], "discovery_item", "create")) throw forbidden(PUSH_MESSAGES.scope);
  if (!conn.active) throw new AppError(409, "inactive", PUSH_MESSAGES.inactive);
  return conn;
}

// ---------------------------------------------------------------------------------------------------------------
// Batches (§12.1)

const problemItem = z.object({
  key: z.string().trim().min(1).max(200),
  external_id: z.string().trim().max(200).optional(),
  severity: z.union([z.string().max(40), z.number()]).optional(),
  availability: z.boolean().optional(),
  message: z.string().max(2000).optional(),
  since: z.string().max(60).optional(),
});

export const batchBody = z.object({
  schema: z.literal(RECORD_SCHEMA).optional(),
  batch_id: z.string().trim().min(1).max(200).optional(),
  snapshot: z
    .object({ id: z.string().trim().min(1).max(200), part: z.number().int().min(1).max(10_000), parts: z.number().int().min(1).max(10_000) })
    .refine((s) => s.part <= s.parts, { message: PUSH_MESSAGES.snapshotParts })
    .optional(),
  records: z.array(z.unknown()).max(PUSH_LIMITS.records).default([]),
  problems: z.object({ complete: z.boolean().default(false), items: z.array(problemItem).max(PUSH_LIMITS.problems) }).optional(),
});
export type BatchBody = z.infer<typeof batchBody>;

interface RowMessage {
  index: number;
  external_id?: string | null;
  message: string;
}

/** What a batch reports, as stored and as answered. */
export function batchView(b: Row): Row {
  const r: Row = b.result && typeof b.result === "object" ? b.result : {};
  return {
    batch_id: b.batch_id, state: b.state, received_at: b.received_at ? new Date(b.received_at).toISOString() : null, records: Number(b.records ?? 0),
    created: Number(r.created ?? 0), updated: Number(r.updated ?? 0), unchanged: Number(r.unchanged ?? 0), unmatched: Number(r.unmatched ?? 0),
    duplicates: Number(r.duplicates ?? 0), failed: Number(r.failed ?? 0), rejected: Number(r.rejected ?? 0),
    errors: Array.isArray(r.errors) ? r.errors : [], warnings: Array.isArray(r.warnings) ? r.warnings : [],
    ...(b.snapshot_id ? { snapshot: { id: b.snapshot_id, part: b.part, parts: b.parts, state: r.snapshot_state ?? "waiting" } } : {}),
    ...(r.problems ? { problems: r.problems } : {}),
  };
}

const statusUrl = (connectorId: string, batchId: string) => `/api/v1/discovery/${connectorId}/batches/${encodeURIComponent(batchId)}`;

/** The connector's current listing generation (plain batches stage into it). */
async function currentGeneration(q: Queryable, orgId: string, connectorId: string): Promise<number> {
  const r = await q.one<{ g: number }>(
    `select greatest(coalesce((select max(seen_generation) from sm_discovery_items where org_id = $1 and connector_id = $2), 0),
                     coalesce((select max(generation) from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'inventory'), 0))::int as g`,
    [orgId, connectorId],
  );
  return Number(r?.g ?? 0);
}

/**
 * Receive a batch: the stored outcome for a batch id seen before, else 202 after the outbox transaction (batch row,
 * staged records and problems, the job).
 */
export async function receiveBatch(caller: ApiCaller, connectorId: string, input: unknown, headerId?: string | null): Promise<{ status: 200 | 202; body: Row }> {
  const conn = await pushConnector(caller, connectorId);
  const parsed = batchBody.safeParse(input);
  if (!parsed.success) throw zodToAppError(parsed.error);
  const b = parsed.data;
  const hid = headerId?.trim() || null;
  if (hid && b.batch_id && hid !== b.batch_id) throw bad(PUSH_MESSAGES.batchIdMismatch);
  const batchId = (hid ?? b.batch_id ?? "").slice(0, 200);
  if (!batchId) throw bad(PUSH_MESSAGES.batchId);
  const org = caller.key.org_id;
  const sys = await systemCtx(caller.ctx.cfg, org);
  await assertWritable(sys.db, org);
  const kind = serverKind(conn.kind);
  const now = new Date();
  // each record checked on its own: a bad one is reported by index, never the batch
  const errors: RowMessage[] = [];
  const warnings: RowMessage[] = [];
  const valid: { index: number; record: DiscoveredRecord }[] = [];
  b.records.forEach((raw, index) => {
    const n = normaliseRecord(raw, { now });
    if (!n.record) {
      errors.push({ index, external_id: raw && typeof raw === "object" ? String((raw as Row).external_id ?? "").slice(0, 200) || null : null, message: n.error ?? "رکورد پذیرفته نشد" });
      return;
    }
    for (const w of n.warnings) warnings.push({ index, external_id: n.record.external_id, message: w });
    valid.push({ index, record: n.record });
  });
  const out = await sys.write(async (tx) => {
    if (b.snapshot) await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`discovery.snapshot:${conn.id}:${b.snapshot.id}`]);
    const row = await tx.one<Row>(
      `insert into sm_discovery_batches (id, org_id, connector_id, batch_id, received_at, key_id, records, state, result, snapshot_id, part, parts, origin)
       values ($1, $2, $3, $4, $5, $6, $7, 'queued', '{}'::jsonb, $8, $9, $10, $11)
       on conflict (org_id, connector_id, batch_id) where deleted_at is null do nothing returning *`,
      [uuidv7(), org, conn.id, batchId, now.toISOString(), caller.key.id, b.records.length, b.snapshot?.id ?? null, b.snapshot?.part ?? null, b.snapshot?.parts ?? null, sys.cfg.origin ?? "cloud"],
    );
    if (!row) {
      const old = await tx.one<Row>(`select * from sm_discovery_batches where org_id = $1 and connector_id = $2 and batch_id = $3 and deleted_at is null`, [org, conn.id, batchId]);
      return { duplicate: old };
    }
    // the generation: a snapshot's parts share one (the first part takes the next), a plain batch stages into the current one
    let generation: number;
    if (b.snapshot) {
      const prior = await tx.one<{ g: string | null }>(
        `select result->>'generation' as g from sm_discovery_batches where org_id = $1 and connector_id = $2 and snapshot_id = $3 and id <> $4 and result ? 'generation'
         order by received_at limit 1`,
        [org, conn.id, b.snapshot.id, row.id],
      );
      generation = prior?.g ? Number(prior.g) : (await currentGeneration(tx, org, conn.id)) + 1;
    } else generation = Math.max(1, await currentGeneration(tx, org, conn.id));
    // newer data already held wins (§12.1 ordering): a record whose last contact is older than the item's is ignored
    const ids = [...new Set(valid.map((v) => v.record.external_id))];
    const held = ids.length
      ? await tx.query<Row>(`select external_id, hash, state, last_contact_at from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and external_id = any($3::text[])`, [org, conn.id, pgArray(ids)])
      : [];
    const heldBy = new Map(held.map((h) => [String(h.external_id), h]));
    const byId = new Map<string, DiscoveredRecord>();
    let older = 0;
    for (const v of valid) {
      const h = heldBy.get(v.record.external_id);
      const mine = v.record.last_contact_at ? Date.parse(v.record.last_contact_at) : NaN;
      const theirs = h?.last_contact_at ? Date.parse(new Date(h.last_contact_at).toISOString()) : NaN;
      if (Number.isFinite(mine) && Number.isFinite(theirs) && mine < theirs) {
        older++;
        warnings.push({ index: v.index, external_id: v.record.external_id, message: PUSH_MESSAGES.older });
        continue;
      }
      byId.set(v.record.external_id, v.record);
    }
    // what each record will be (for the outcome): new, changed, unchanged
    const kindVersion = kind?.version ?? 1;
    const configVersion = Number(conn.config_version ?? 1);
    const fresh: string[] = [];
    const changed: string[] = [];
    let unchanged = 0;
    for (const r of byId.values()) {
      const h = heldBy.get(r.external_id);
      if (!h) fresh.push(r.external_id);
      else if (h.hash !== itemHash(r, configVersion, kindVersion) || h.state === "gone" || h.state === null) changed.push(r.external_id);
      else unchanged++;
    }
    await stagePage(tx, { orgId: org, connectorId: conn.id, generation, configVersion, kindVersion, records: [...byId.values()], link: undefined, origin: sys.cfg.origin ?? "cloud" });
    let problems: Row | undefined;
    if (b.problems) {
      const r = await recordProblems(tx, org, conn.id, b.problems.items.map((p) => ({ ...p, severity: String(p.severity ?? "minor") })), now, sys.cfg.origin ?? "cloud");
      const cleared = b.problems.complete ? await clearVanished(tx, org, conn.id, now) : 0;
      problems = { received: b.problems.items.length, opened: r.opened, cleared, complete: b.problems.complete };
    }
    const result = {
      generation, rejected: errors.length, older, unchanged, staged: { new: fresh.length, changed: changed.length, unchanged },
      errors: errors.slice(0, 50), warnings: warnings.slice(0, 50), ...(problems ? { problems } : {}),
    };
    await tx.query(`update sm_discovery_batches set result = $3::jsonb, updated_at = now() where org_id = $1 and id = $2`, [org, row.id, JSON.stringify(result)]);
    await enqueue(tx, {
      kind: JOB_KINDS.pushBatch, orgId: org, payload: { connector: conn.id, batch: row.id, new: fresh, changed },
      dedupeKey: `${JOB_KINDS.pushBatch}:${row.id}`, maxAttempts: 8,
    });
    return { row: { ...row, result } };
  }, { internal: true });
  if ("duplicate" in out) return { status: 200, body: { ...batchView(out.duplicate ?? {}), duplicate: true, status_url: statusUrl(conn.id, batchId) } };
  return { status: 202, body: { ...batchView(out.row), state: "queued", status_url: statusUrl(conn.id, batchId) } };
}

/** GET …/batches/:batch — the batch's state and counts. */
export async function batchStatus(caller: ApiCaller, connectorId: string, batchId: string): Promise<Row> {
  const conn = await pushConnector(caller, connectorId);
  const b = await caller.ctx.db.one<Row>(`select * from sm_discovery_batches where org_id = $1 and connector_id = $2 and batch_id = $3 and deleted_at is null`, [caller.key.org_id, conn.id, batchId]);
  if (!b) throw notFound(PUSH_MESSAGES.noStatus);
  return batchView(b);
}

/**
 * The job of a batch (`discovery.push_batch`): its items go to the reconciliation engine through a retries-only pass
 * (the pull path's lock budget); once none of them waits, the outcome is written, a snapshot is finalised (or
 * abandoned) and the connector's status upkeep is queued.
 */
export async function pushBatchJob(sys: Ctx, connectorId: string, batchRowId: string, ids: { new: string[]; changed: string[] }, opts: { demo?: boolean } = {}): Promise<JobResult> {
  const db = sys.db;
  const org = sys.org.id;
  const b = await db.one<Row>(`select * from sm_discovery_batches where org_id = $1 and id = $2 and deleted_at is null`, [org, batchRowId]);
  const conn = await loadConnector(db, org, connectorId);
  if (!b || !conn) return;
  const all = [...ids.new, ...ids.changed];
  if (b.state === "queued" || b.state === "staging") {
    await db.query(`update sm_discovery_batches set state = 'reconciling', updated_at = now() where org_id = $1 and id = $2`, [org, b.id]);
    b.state = "reconciling";
  }
  if (b.state === "reconciling") {
    const waiting = all.length
      ? Number((await db.one<{ n: number }>(
          `select count(*)::int as n from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and external_id = any($3::text[])
             and reconciled_at is null and (state is null or state <> 'ignored')`,
          [org, conn.id, pgArray(all)],
        ))?.n ?? 0)
      : 0;
    if (waiting) {
      // the pull path reconciles them (a retries-only pass joins one already running)
      await queuePull(db, org, conn.id, { trigger: "push", retryOnly: true, demo: opts.demo });
      return { again: 10_000 };
    }
    const states = all.length
      ? await db.query<{ external_id: string; state: string | null }>(`select external_id, state from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and external_id = any($3::text[])`, [org, conn.id, pgArray(all)])
      : [];
    const fresh = new Set(ids.new);
    const count = (pred: (s: { external_id: string; state: string | null }) => boolean) => states.filter(pred).length;
    const outcome = {
      created: count((s) => s.state === "linked" && fresh.has(s.external_id)),
      updated: count((s) => s.state === "linked" && !fresh.has(s.external_id)),
      unmatched: count((s) => s.state === "unmatched"),
      duplicates: count((s) => s.state === "duplicate"),
      failed: count((s) => s.state === "error") + Number(b.result?.rejected ?? 0),
    };
    await db.query(`update sm_discovery_batches set state = 'done', result = coalesce(result, '{}'::jsonb) || $3::jsonb, updated_at = now() where org_id = $1 and id = $2`, [org, b.id, JSON.stringify(outcome)]);
    await enqueue(db, { kind: JOB_KINDS.status, orgId: org, payload: { connector: conn.id, ...(opts.demo ? { __demo: true } : {}) }, dedupeKey: `${JOB_KINDS.status}:${conn.id}`, maxAttempts: 5 });
  }
  if (b.snapshot_id) return snapshotStep(sys, conn, String(b.snapshot_id), opts);
}

/** A snapshot's state: finalised once every part arrived, abandoned after 24 h with parts missing, else looked at again then. */
async function snapshotStep(sys: Ctx, conn: Row, snapshotId: string, opts: { demo?: boolean }): Promise<JobResult> {
  const db = sys.db;
  const org = sys.org.id;
  const parts = await db.query<Row>(
    `select id, part, parts, received_at, state, result->>'generation' as generation, result->>'snapshot_state' as snap from sm_discovery_batches
     where org_id = $1 and connector_id = $2 and snapshot_id = $3 and deleted_at is null order by received_at`,
    [org, conn.id, snapshotId],
  );
  if (!parts.length || parts.some((p) => p.snap === "finalised" || p.snap === "abandoned")) return;
  const want = Math.max(...parts.map((p) => Number(p.parts ?? 1)));
  const have = new Set(parts.map((p) => Number(p.part)));
  const complete = Array.from({ length: want }, (_, i) => i + 1).every((n) => have.has(n));
  const first = Date.parse(new Date(parts[0].received_at).toISOString());
  if (complete) {
    // every part's records reconciled first: the outcome of each part says so
    if (parts.some((p) => p.state !== "done")) return { again: 15_000 };
    await finaliseSnapshot(sys, conn, snapshotId, Number(parts[0].generation ?? 0), new Date(first), opts);
    return;
  }
  const left = first + SNAPSHOT_HOURS * 3600_000 - Date.now();
  if (left > 0) return { again: left };
  await db.query(
    `update sm_discovery_batches set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('snapshot_state', 'abandoned',
       'warnings', coalesce(result->'warnings', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('index', -1, 'message', $4::text))), updated_at = now()
     where org_id = $1 and connector_id = $2 and snapshot_id = $3 and deleted_at is null`,
    [org, conn.id, snapshotId, PUSH_MESSAGES.snapshotAbandoned],
  );
}

/** A complete snapshot is a complete pass (§7.3): unlisted items gone unless the mass-drop guard holds it; one run row. */
async function finaliseSnapshot(sys: Ctx, conn: Row, snapshotId: string, generation: number, startedAt: Date, opts: { demo?: boolean }): Promise<void> {
  const org = sys.org.id;
  await sys.write(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`discovery.snapshot:${conn.id}:${snapshotId}`]);
    const done = await tx.one(`select 1 from sm_discovery_runs where org_id = $1 and connector_id = $2 and lane = 'inventory' and cursor->>'snapshot' = $3`, [org, conn.id, snapshotId]);
    if (done) return;
    const listed = Number((await tx.one<{ n: number }>(`select count(*)::int as n from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and seen_generation = $3`, [org, conn.id, generation]))?.n ?? 0);
    const last = await tx.one<{ n: number }>(
      `select items_total as n from sm_discovery_runs r where r.org_id = $1 and r.connector_id = $2 and r.lane = 'inventory' and r.state = 'completed' and r.complete
         and r.deleted_at is null and ${NOT_HELD_SQL("r")} order by r.started_at desc limit 1`,
      [org, conn.id],
    );
    const warnings: Row[] = [];
    let gone = 0;
    const held = massDrop(listed, last?.n ?? null);
    if (held) {
      warnings.push({ code: "mass_drop", message: `${MASS_DROP_WARNING}: ${listed} مورد در برابر ${last?.n} مورد گذر کامل پیشین` });
      await noticeMassDrop(tx, org, conn.id, listed, Number(last?.n ?? 0));
    } else {
      gone = (await tx.query(
        `update sm_discovery_items set state = 'gone', updated_at = now()
         where org_id = $1 and connector_id = $2 and deleted_at is null and seen_generation < $3 and (state is null or state not in ('gone', 'ignored')) returning id`,
        [org, conn.id, generation],
      )).length;
      if (gone) warnings.push({ code: "gone", message: `${gone} مورد دیگر گزارش نمی‌شود` });
    }
    await tx.query(
      `insert into sm_discovery_runs (id, org_id, connector_id, lane, trigger, state, started_at, finished_at, duration_ms, cursor, generation, pages, fetched, staged,
         skipped_unchanged, refreshed, retried, created, updated, unmatched, duplicates, failed, stale_marked, problems_opened, problems_cleared, complete, items_total, warnings, origin)
       values ($1, $2, $3, 'inventory', 'push', 'completed', $4, now(), least(2147483647, (extract(epoch from (now() - $4::timestamptz)) * 1000)::bigint)::int, $5::jsonb, $6,
         0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true, $7, $8::jsonb, $9)`,
      [uuidv7(), org, conn.id, startedAt.toISOString(), JSON.stringify({ phase: "finalise", snapshot: snapshotId }), generation, listed, JSON.stringify(warnings), sys.cfg.origin ?? "cloud"],
    );
    await tx.query(
      `update sm_discovery_batches set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('snapshot_state', 'finalised', 'gone', $4::int), updated_at = now()
       where org_id = $1 and connector_id = $2 and snapshot_id = $3 and deleted_at is null`,
      [org, conn.id, snapshotId, gone],
    );
    if (!held) await enqueue(tx, { kind: JOB_KINDS.stale, orgId: org, payload: { connector: conn.id, ...(opts.demo ? { __demo: true } : {}) }, dedupeKey: `${JOB_KINDS.stale}:${conn.id}`, maxAttempts: 5 });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Status only (§12.2)

export const statusBody = z.object({
  items: z
    .array(
      z.object({
        external_id: z.string().trim().min(1).max(200).nullish(),
        match: z
          .object({ terminal_id: z.string().trim().min(1).max(40).optional(), serial_number: z.string().trim().min(1).max(120).optional(), hostname: z.string().trim().min(1).max(255).optional(), ip: z.string().trim().min(1).max(64).optional() })
          .optional(),
        state: z.enum(STATUS_VALUES as [string, ...string[]]),
        availability: z.boolean().optional(),
        device_status: z.string().trim().max(60).optional(),
        since: z.string().max(60).optional(),
        message: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(PUSH_LIMITS.statusItems),
});
export type StatusBody = z.infer<typeof statusBody>;
type StatusEntry = StatusBody["items"][number];

export interface StatusAnswer {
  index: number;
  result: "updated" | "unmatched";
  target?: { table: string; id: string } | null;
  warnings?: string[];
}

const latin = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();

/** Apply a status request's items (the request's own work when small, its job's when queued). */
export async function applyPushStatus(sys: Ctx, conn: Row, entries: StatusEntry[], receivedAt: Date): Promise<StatusAnswer[]> {
  const db = sys.db;
  const org = sys.org.id;
  const at = receivedAt.toISOString();
  const answers: StatusAnswer[] = [];
  // the connector's items named by their tool id
  const extIds = [...new Set(entries.map((e) => e.external_id).filter((x): x is string => !!x))];
  const items = extIds.length
    ? await db.query<Row>(
        `select i.id, i.external_id, i.kind, i.state, i.ci_id, i.asset_id, coalesce(i.matched_by in ('terminal_id', 'serial_number'), false) as strong,
                (select a.category from sm_assets a where a.org_id = i.org_id and a.id = i.asset_id and a.deleted_at is null) as category
         from sm_discovery_items i where i.org_id = $1 and i.connector_id = $2 and i.deleted_at is null and i.external_id = any($3::text[])`,
        [org, conn.id, pgArray(extIds)],
      )
    : [];
  const itemBy = new Map(items.map((i) => [String(i.external_id), i]));
  const itemStatuses: StatusItem[] = [];
  const signalWrites = new Map<string, { target: Target; asset_id: string | null; signal: Row }>();
  const reports: DeviceReport[] = [];
  const touched: Target[] = [];
  const fleet = FLEET_CATEGORIES as string[];
  for (const [index, e] of entries.entries()) {
    const warnings: string[] = [];
    const state = recordState({ state: e.state as never, availability: e.availability }) ?? "unknown";
    const status = { state: e.state as never, ...(e.availability !== undefined ? { availability: e.availability } : {}), ...(e.since ? { since: e.since } : {}), ...(e.message ? { message: e.message.slice(0, 500) } : {}), ...(e.device_status ? { device_status: e.device_status } : {}) };
    const item = e.external_id ? itemBy.get(e.external_id) : undefined;
    if (item) {
      itemStatuses.push({ external_id: item.external_id, status });
      const target: Target | null = item.ci_id ? { table: "ci", id: String(item.ci_id) } : item.asset_id ? { table: "asset", id: String(item.asset_id) } : null;
      if (target) touched.push(target);
      if (e.device_status) {
        // the external id of a linked item counts as strong only when the item itself was matched to its asset by terminal
        // id or serial (matchAtms), not merely when it carries one
        if (item.state === "linked" && item.asset_id && item.strong && fleet.includes(String(item.category))) {
          reports.push({ target_table: target!.table, target_id: target!.id, asset_id: String(item.asset_id), raw: e.device_status, since: e.since ?? null, at });
        } else warnings.push(STRONG_ONLY_MESSAGE);
      }
      answers.push({ index, result: "updated", target: target ? { table: target.table, id: target.id } : null, ...(warnings.length ? { warnings } : {}) });
      continue;
    }
    const m = e.match ?? {};
    let assetRow: Row | null = null;
    let ciId: string | null = null;
    let strong = false;
    if (m.terminal_id) {
      assetRow = await db.one<Row>(
        `select a.id, a.ci_id, a.category from sm_assets a where a.org_id = $1 and a.deleted_at is null and a.terminal_id = $2
           and not exists (select 1 from sm_demo_rows d where d.org_id = a.org_id and d.row_id = a.id) order by a.created_at limit 1`,
        [org, latin(m.terminal_id)],
      );
      strong = !!assetRow;
    }
    if (!assetRow && m.serial_number) {
      assetRow = await db.one<Row>(
        `select a.id, a.ci_id, a.category from sm_assets a where a.org_id = $1 and a.deleted_at is null and a.serial_number = $2 and a.category = any($3::text[])
           and not exists (select 1 from sm_demo_rows d where d.org_id = a.org_id and d.row_id = a.id) order by a.created_at limit 1`,
        [org, latin(m.serial_number), pgArray(fleet)],
      );
      strong = !!assetRow;
      if (!assetRow) {
        const ci = await db.one<{ id: string }>(
          `select c.id from sm_cis c where c.org_id = $1 and c.deleted_at is null and c.serial_number = $2
             and not exists (select 1 from sm_demo_rows d where d.org_id = c.org_id and d.row_id = c.id) order by c.updated_at desc limit 1`,
          [org, latin(m.serial_number)],
        );
        ciId = ci?.id ?? null;
        strong = !!ci;
      }
    }
    if (!assetRow && !ciId && (m.hostname || m.ip)) {
      const host = m.hostname ? m.hostname.toLowerCase() : null;
      const ci = await db.one<{ id: string }>(
        `select c.id from sm_cis c where c.org_id = $1 and c.deleted_at is null
           and (($2::text is not null and (lower(c.hostname) = $2 or lower(c.fqdn) = $2 or lower(c.name) = $2)) or ($3::text is not null and c.ip_address = $3))
           and not exists (select 1 from sm_demo_rows d where d.org_id = c.org_id and d.row_id = c.id) order by c.updated_at desc limit 1`,
        [org, host, m.ip ?? null],
      );
      ciId = ci?.id ?? null;
    }
    if (assetRow?.ci_id) {
      const live = await db.one(`select 1 from sm_cis where org_id = $1 and id = $2 and deleted_at is null`, [org, assetRow.ci_id]);
      if (live) ciId = String(assetRow.ci_id);
    }
    const target: Target | null = ciId ? { table: "ci", id: ciId } : assetRow ? { table: "asset", id: String(assetRow.id) } : null;
    if (!target) {
      answers.push({ index, result: "unmatched", target: null, warnings: [PUSH_MESSAGES.unmatched] });
      continue;
    }
    if (e.device_status) {
      // a device value only with a terminal id or a serial: an address is reused across a branch network (§9.5)
      if (strong && assetRow && fleet.includes(String(assetRow.category))) reports.push({ target_table: target.table, target_id: target.id, asset_id: String(assetRow.id), raw: e.device_status, since: e.since ?? null, at });
      else warnings.push(STRONG_ONLY_MESSAGE);
    }
    // an item of this connector on the target takes the status; else the target keeps it as the connector's own signal
    const own = await db.one<Row>(
      `select external_id from sm_discovery_items where org_id = $1 and connector_id = $2 and deleted_at is null and (state is null or state not in ('gone', 'ignored'))
         and ${target.table === "ci" ? "ci_id = $3" : "ci_id is null and asset_id = $3"} limit 1`,
      [org, conn.id, target.id],
    );
    if (own) itemStatuses.push({ external_id: String(own.external_id), status });
    else {
      const since = e.since && Number.isFinite(Date.parse(e.since)) && Date.parse(e.since) <= receivedAt.getTime() ? new Date(e.since).toISOString() : at;
      signalWrites.set(`${target.table}:${target.id}`, { target, asset_id: assetRow ? String(assetRow.id) : null, signal: { state, since, message: e.message?.slice(0, 500) ?? null, at } });
    }
    touched.push(target);
    answers.push({ index, result: "updated", target: { table: target.table, id: target.id }, ...(warnings.length ? { warnings } : {}) });
  }
  await sys.write(async (tx) => {
    await applyItemStatuses(tx, org, conn.id, itemStatuses, receivedAt);
    for (const { target, asset_id, signal } of signalWrites.values()) {
      const cur = await tx.one<{ signals: Row | null }>(`select signals from sm_discovery_states where org_id = $1 and deleted_at is null and target_table = $2 and target_id = $3 for update`, [org, target.table, target.id]);
      const key = `c:${conn.id}`;
      const prev = cur?.signals?.[key];
      const next = { ...signal, since: prev?.state === signal.state && prev?.since ? prev.since : signal.since };
      await tx.query(
        `insert into sm_discovery_states as s (id, org_id, target_table, target_id, ci_id, asset_id, signals, origin)
         values ($1, $2, $3, $4, $5, $6, jsonb_build_object($7::text, $8::jsonb), $9)
         on conflict (org_id, target_table, target_id) where deleted_at is null do update set signals = coalesce(s.signals, '{}'::jsonb) || excluded.signals,
           asset_id = coalesce(s.asset_id, excluded.asset_id), updated_at = now()`,
        [uuidv7(), org, target.table, target.id, target.table === "ci" ? target.id : null, asset_id, key, JSON.stringify(next), sys.cfg.origin ?? "cloud"],
      );
    }
  }, { internal: true });
  if (reports.length) await observeDevices(sys, conn, reports);
  if (touched.length) await aggregateTargets(db, sys, touched);
  return answers;
}

/** POST …/status: ≤ 200 items answered now, more queued (202). */
export async function receiveStatus(caller: ApiCaller, connectorId: string, input: unknown): Promise<{ status: 200 | 202; body: Row }> {
  const conn = await pushConnector(caller, connectorId);
  const parsed = statusBody.safeParse(input);
  if (!parsed.success) throw zodToAppError(parsed.error);
  const org = caller.key.org_id;
  const sys = await systemCtx(caller.ctx.cfg, org);
  await assertWritable(sys.db, org);
  const items = parsed.data.items;
  const now = new Date();
  if (items.length > PUSH_LIMITS.syncStatus) {
    await enqueue(sys.db, { kind: PUSH_STATUS_JOB, orgId: org, payload: { connector: conn.id, received_at: now.toISOString(), items }, maxAttempts: 5 });
    return { status: 202, body: { state: "queued", items: items.length } };
  }
  const answers = await applyPushStatus(sys, conn, items, now);
  return { status: 200, body: { state: "done", updated: answers.filter((a) => a.result === "updated").length, unmatched: answers.filter((a) => a.result === "unmatched").length, items: answers } };
}

// ---------------------------------------------------------------------------------------------------------------
// Jobs

let installed = false;

/** The push jobs (once per process, from installDiscoveryModule). */
export function installDiscoveryPush(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(JOB_KINDS.pushBatch, async (job, jctx) => {
    const a = await admittedJob(job, jctx);
    if (!a || !("orgId" in a)) return a ?? undefined;
    const p = job.payload ?? {};
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    if (typeof p.batch !== "string") return;
    return inConnectorScope(jctx.db, a.orgId, a.connector, async (demo) => pushBatchJob(await systemCtx(jctx.cfg, a.orgId), a.connector, p.batch, { new: list(p.new), changed: list(p.changed) }, { demo }));
  });
  registerJobHandler(PUSH_STATUS_JOB, async (job, jctx) => {
    const a = await admittedJob(job, jctx);
    if (!a || !("orgId" in a)) return a ?? undefined;
    const p = job.payload ?? {};
    const parsed = statusBody.safeParse({ items: p.items });
    if (!parsed.success) return;
    return inDemoScope(null, async () => {
      const sys = await systemCtx(jctx.cfg, a.orgId);
      const conn = await loadConnector(sys.db, a.orgId, a.connector);
      if (!conn?.active) return;
      await applyPushStatus(sys, conn, parsed.data.items, new Date(typeof p.received_at === "string" ? p.received_at : Date.now()));
    });
  });
}

