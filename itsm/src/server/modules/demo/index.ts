// Demo data (docs/DEMO_FA.md): one pack per organisation — the fictional «بانک نمونهٔ آفتاب» — loaded with one click
// and removed with one click without a trace. Lifecycle of `sm_demo_packs`:
//   loading → loaded → purging → (tombstoned →) gone        (failed: a load that stopped; purge is always possible)
// The load runs as the job `demo.load` inside the organisation's demo scope (src/server/db/scope.ts), so every row it
// and its consequences write is recorded in `sm_demo_rows`; the purge (`demo.purge`, ./purge.ts) removes exactly that
// plus what derives from it, and `demo.finalize` removes the tombstones Windows apps needed. What remains: one
// content-free audit line per load and purge.
import type { Ctx, ServerConfig } from "../../context";
import type { Db, Queryable } from "../../db";
import { TABLES } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { inDemoScope } from "../../db/scope";
import { conflict, bad } from "../../http/errors";
import { invalidateSchema } from "../../engine/schema";
import { invalidateCmdbCache } from "../cmdb/common";
import { invalidateRules } from "../notify/rules";
import { BANK_DOMAIN, BANK_NAME, DEMO_SIZES, KNOWN_NAMES, type DemoSize } from "./bank";
import { newMemo, runLoad, STEPS, type LoadMemo } from "./load";
import { clearReferences, demoFiles, expandDerived, referenceReport, registryCounts, removeAccounts, removeFiles, removeRows, restoreComputed, restoreCounters, saveComputed, tablesInfo, type PurgeReport, type RefReport } from "./purge";

export { DEMO_SIZES, BANK_NAME, type DemoSize } from "./bank";
export { tablesInfo, COMPUTED_TABLES, type PurgeReport, type RefReport } from "./purge";

export type PackState = "loading" | "loaded" | "purging" | "tombstoned" | "failed";

interface PackRow {
  org_id: string;
  state: PackState;
  size: DemoSize;
  options: { force?: boolean };
  progress: { memo?: LoadMemo; phase?: string; seeds_done?: boolean; saved?: boolean; purge?: string; files?: string[]; tombstones?: number; report?: PurgeReport };
  counts: Record<string, number>;
  counters: Record<string, number>;
  report: PurgeReport | null;
  error: string | null;
  started_by: string | null;
  started_at: string;
  loaded_at: string | null;
  purge_started_at: string | null;
  purge_mark: number | null;
}

export interface DemoAccount {
  persona: string;
  email: string;
  name: string;
  title: string;
}

export interface DemoStatus {
  state: "none" | PackState;
  bank: string;
  size?: DemoSize;
  size_label?: string;
  /** steps done of all (a load), or the purge's phase */
  progress?: { done: number; total: number; label: string };
  counts?: Record<string, number>;
  rows?: number;
  started_at?: string;
  loaded_at?: string | null;
  error?: string | null;
  /** the personas the presenter signs in as (and their shared password, for administrators only) */
  accounts?: DemoAccount[];
  password?: string | null;
  /** Windows apps that have not yet pulled the purge's tombstones */
  waiting_devices?: number;
  /** the last load / purge audit line (counts only) */
  last?: { action: string; at: string; data: Record<string, unknown> | null } | null;
  /** real records already in the organisation (a load is refused unless forced) */
  real_records?: number;
}

/** Tables whose rows are an organisation's own work: a load is refused when real ones exist (unless forced). */
const WORK_TABLES = ["incident", "problem", "change_request", "request", "request_item", "hr_case", "customer_case", "sec_incident", "work_order", "asset", "ci"];

async function packOf(q: Queryable, orgId: string): Promise<PackRow | null> {
  return q.one<PackRow>(`select * from sm_demo_packs where org_id = $1`, [orgId]);
}

/** Real (non-demo) work records of the organisation. */
export async function realRecords(q: Queryable, orgId: string): Promise<number> {
  let n = 0;
  for (const key of WORK_TABLES) {
    const def = TABLES.get(key);
    if (!def) continue;
    const r = await q.one<{ n: number }>(
      `select count(*)::int as n from (select 1 from ${def.table} x where x.org_id = $1 and x.deleted_at is null
         and not exists (select 1 from sm_demo_rows d where d.org_id = $1 and d.row_id = x.id) limit 1000) t`,
      [orgId],
    );
    n += r?.n ?? 0;
  }
  return n;
}

function emailOf(orgId: string, persona: string): string {
  return `${persona}.${orgId.replace(/-/g, "").slice(0, 6)}@${BANK_DOMAIN}`;
}

/** The pack's state for the console (`secrets`: include the personas' password — administrators only). */
export async function demoStatus(q: Queryable, orgId: string, opts: { secrets?: boolean } = {}): Promise<DemoStatus> {
  const pack = await packOf(q, orgId);
  const last = await q.one<{ action: string; at: string; data: Record<string, unknown> | null }>(
    `select action, at, data from sm_audit where org_id = $1 and action in ('demo_load', 'demo_purge') order by at desc limit 1`,
    [orgId],
  );
  if (!pack) return { state: "none", bank: BANK_NAME, last, real_records: await realRecords(q, orgId) };
  const memo = pack.progress.memo;
  const rows = await q.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [orgId]);
  const out: DemoStatus = {
    state: pack.state,
    bank: BANK_NAME,
    size: pack.size,
    size_label: DEMO_SIZES[pack.size]?.label,
    counts: memo?.counts ?? pack.counts,
    rows: rows?.n ?? 0,
    started_at: pack.started_at,
    loaded_at: pack.loaded_at,
    error: pack.error,
    last,
  };
  if (pack.state === "loading" || pack.state === "failed") {
    const step = memo?.step ?? 0;
    out.progress = { done: step, total: STEPS.length, label: STEPS[Math.min(step, STEPS.length - 1)]?.label ?? "" };
    if (!pack.progress.seeds_done) out.progress.label = "آماده‌سازی پیش‌فرض‌های ماژول‌ها";
  }
  if (pack.state === "purging") out.progress = { done: PURGE_PHASES.indexOf(pack.progress.purge ?? "expand"), total: PURGE_PHASES.length, label: PURGE_LABELS[pack.progress.purge ?? "expand"] ?? "" };
  if (pack.state === "loaded" || pack.state === "loading") {
    out.accounts = Object.entries(KNOWN_NAMES).map(([persona, p]) => ({ persona, email: emailOf(orgId, p.email.split("@")[0]), name: p.name, title: p.title }));
    if (opts.secrets) out.password = memo?.password ?? null;
  }
  if (pack.state === "tombstoned") out.waiting_devices = await waitingDevices(q, orgId, pack.purge_mark ?? 0);
  return out;
}

/** Start loading the pack (a job). Refused when one is there, or when real records exist unless `force`. */
export async function startDemoLoad(ctx: Ctx, input: { size: DemoSize; force?: boolean }): Promise<DemoStatus> {
  if (!DEMO_SIZES[input.size]) throw bad("اندازهٔ دادهٔ نمایشی معتبر نیست");
  const orgId = ctx.org.id;
  await ctx.db.tx(async (tx) => {
    const pack = await packOf(tx, orgId);
    if (pack) throw conflict(pack.state === "failed" ? "بارگذاری قبلی ناتمام ماند؛ نخست آن را حذف کنید" : "دادهٔ نمایشی این سازمان از قبل بارگذاری شده است");
    if (!input.force && (await realRecords(tx, orgId)) > 0) throw conflict("این سازمان رکوردهای واقعی دارد؛ دادهٔ نمایشی فقط با تأیید صریح («با وجود دادهٔ واقعی») بارگذاری می‌شود");
    const memo = newMemo(input.size);
    await tx.query(
      `insert into sm_demo_packs (org_id, state, size, options, progress, started_by) values ($1, 'loading', $2, $3::jsonb, $4::jsonb, $5)`,
      [orgId, input.size, JSON.stringify({ force: !!input.force }), JSON.stringify({ memo }), ctx.user.id],
    );
  });
  // the pack's own job: queued inside the demo scope (recorded) and marked, so it runs — and writes — as demo work
  await inDemoScope(orgId, () => enqueue(ctx.db, { kind: "demo.load", orgId, payload: { __demo: true }, dedupeKey: "demo.load", maxAttempts: 3 }));
  return demoStatus(ctx.db, orgId, { secrets: true });
}

/** The pre-purge report: what goes, and the real rows that refer to demo rows. */
export async function purgePreview(ctx: Ctx): Promise<{ tables: Record<string, number>; rows: number; references: RefReport[]; accounts: number }> {
  const info = await tablesInfo(ctx.db);
  const tables = await registryCounts(ctx.db, ctx.org.id);
  const references = await referenceReport(ctx.db, ctx.org.id, info);
  return { tables, rows: Object.values(tables).reduce((s, n) => s + n, 0), references, accounts: tables.sm_users ?? 0 };
}

/** Start the purge (a job; always allowed, also for a failed or still running load). */
export async function startDemoPurge(ctx: Ctx): Promise<DemoStatus> {
  const orgId = ctx.org.id;
  const pack = await packOf(ctx.db, orgId);
  const rows = await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [orgId]);
  if (!pack && !rows?.n) throw conflict("این سازمان دادهٔ نمایشی ندارد");
  if (pack?.state === "purging") return demoStatus(ctx.db, orgId);
  await inDemoScope(null, async () => {
    await ctx.db.tx(async (tx) => {
      if (pack) await tx.query(`update sm_demo_packs set state = 'purging', purge_started_at = now(), progress = progress || '{"purge":"expand"}'::jsonb, updated_at = now() where org_id = $1`, [orgId]);
      else await tx.query(`insert into sm_demo_packs (org_id, state, progress, purge_started_at) values ($1, 'purging', '{"purge":"expand"}'::jsonb, now())`, [orgId]);
      // a load still queued stops (its job goes with the registry)
      await tx.query(`update sm_jobs set status = 'done', done_at = now() where org_id = $1 and kind = 'demo.load' and status = 'queued'`, [orgId]);
      await enqueue(tx, { kind: "demo.purge", orgId, payload: { by: ctx.user.id }, dedupeKey: "demo.purge", maxAttempts: 20 });
    });
  });
  return demoStatus(ctx.db, orgId);
}

// ----- the load job ---------------------------------------------------------------------------------------------------

const SEED_KINDS = `(kind like '%.seed' or kind like '%seed%' or kind like '%install%')`;

async function loadJob(cfg: JobConfig, orgId: string, deadline: number): Promise<{ again: number } | void> {
  const db = cfg.db;
  const pack = await packOf(db, orgId);
  if (!pack || pack.state !== "loading") return;
  try {
    // 1. the modules' own defaults come first, as real configuration (outside the demo scope: their jobs are not demo)
    if (!pack.progress.seeds_done) {
      const left = await db.query<{ id: string }>(`update sm_jobs set run_at = now() where org_id = $1 and status in ('queued', 'running') and ${SEED_KINDS} returning id`, [orgId]);
      if (left.length) return { again: 1500 };
      // 2. what the purge puts back: numbering counters and the computed tables as they are now
      const info = await tablesInfo(db);
      await inDemoScope(null, () =>
        db.tx(async (tx) => {
          const counters = await tx.query<{ table_key: string; last: number }>(`select table_key, last from sm_numbers where org_id = $1`, [orgId]);
          await saveComputed(tx, orgId, info);
          await tx.query(`update sm_demo_packs set counters = $2::jsonb, progress = progress || '{"seeds_done":true,"saved":true}'::jsonb, updated_at = now() where org_id = $1`, [orgId, JSON.stringify(Object.fromEntries(counters.map((c) => [c.table_key, c.last])))]);
        }),
      );
      return { again: 0 };
    }
    const memo = pack.progress.memo ?? newMemo(pack.size);
    const save = (m: LoadMemo) => inDemoScope(null, () => db.query(`update sm_demo_packs set progress = jsonb_set(progress, '{memo}', $2::jsonb), updated_at = now() where org_id = $1 and state = 'loading'`, [orgId, JSON.stringify(m)])).then(() => undefined);
    const done = await runLoad(cfg as ServerConfig, orgId, memo, Math.min(deadline, Date.now() + 25_000), save);
    if (!done) return { again: 0 };
    await inDemoScope(null, async () => {
      await db.query(`update sm_demo_packs set state = 'loaded', loaded_at = now(), counts = $2::jsonb, updated_at = now() where org_id = $1`, [orgId, JSON.stringify(memo.counts)]);
      await auditLine(db, orgId, pack.started_by, "demo_load", "داده‌های نمایشی بارگذاری شد", { size: pack.size, counts: memo.counts });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    cfg.log.error("demo load failed", { org: orgId, error: message });
    await inDemoScope(null, () => db.query(`update sm_demo_packs set state = 'failed', error = $2, updated_at = now() where org_id = $1`, [orgId, message.slice(0, 500)]));
  }
}

/** The content-free audit line (counts only), outside any demo scope: it stays after the purge. */
async function auditLine(q: Queryable, orgId: string, userId: string | null, action: string, summary: string, data: Record<string, unknown>): Promise<void> {
  await q.query(`insert into sm_audit (id, org_id, user_id, action, entity, entity_id, summary, data, origin) values ($1, $2, $3, $4, 'demo', null, $5, $6::jsonb, null)`, [uuidv7(), orgId, userId, action, summary, JSON.stringify(data)]);
}

// ----- the purge job --------------------------------------------------------------------------------------------------

const PURGE_PHASES = ["expand", "clear", "remove", "accounts", "restore", "finish"];
const PURGE_LABELS: Record<string, string> = {
  expand: "یافتن همهٔ ردیف‌های نمایشی و وابسته",
  clear: "پاک کردن ارجاع‌های رکوردهای واقعی",
  remove: "حذف ردیف‌ها، پیوست‌ها و پرونده‌ها",
  accounts: "حذف حساب‌های نمایشی",
  restore: "بازگرداندن شمارنده‌ها و محاسبه‌ها",
  finish: "پایان",
};

async function hasDevices(q: Queryable, orgId: string): Promise<boolean> {
  const r = await q.one(`select 1 from sm_devices where org_id = $1 and revoked_at is null and coalesce(last_pull_at, created_at) > now() - interval '30 days' limit 1`, [orgId]);
  return !!r;
}

async function waitingDevices(q: Queryable, orgId: string, mark: number): Promise<number> {
  const r = await q.one<{ n: number }>(
    `select count(*)::int as n from sm_devices where org_id = $1 and revoked_at is null and coalesce(cursor, 0) < $2 and coalesce(last_pull_at, created_at) > now() - interval '30 days'`,
    [orgId, mark],
  );
  return r?.n ?? 0;
}

function forgetCaches(orgId: string): void {
  invalidateSchema(orgId);
  invalidateCmdbCache(orgId);
  invalidateRules(orgId);
}

/** Run the purge from its current phase. Exported for karizctl and the tests (they run it to the end). */
export async function purgeStep(cfg: JobConfig, orgId: string, by: string | null = null): Promise<{ again: number } | void> {
  const db = cfg.db as Db;
  return inDemoScope(null, async () => {
    const pack = await packOf(db, orgId);
    if (!pack || pack.state !== "purging") return;
    const phase = pack.progress.purge ?? "expand";
    const info = await tablesInfo(db);
    const setPhase = (q: Queryable, next: string, extra: Record<string, unknown> = {}) =>
      q.query(`update sm_demo_packs set progress = progress || $2::jsonb, updated_at = now() where org_id = $1`, [orgId, JSON.stringify({ purge: next, ...extra })]);
    if (phase === "expand") {
      await db.tx(async (tx) => {
        const derived = await expandDerived(tx, orgId, info);
        const tables = await registryCounts(tx, orgId);
        const references = await referenceReport(tx, orgId, info);
        const report: PurgeReport = { tables, rows: Object.values(tables).reduce((s, n) => s + n, 0), derived, accounts: { removed: 0, kept: 0 }, references, files: 0, tombstones: 0, restored: {} };
        await setPhase(tx, "clear", { report });
      });
      return { again: 0 };
    }
    const report = pack.progress.report!;
    if (phase === "clear") {
      await db.tx(async (tx) => {
        report.references = await clearReferences(tx, orgId, info);
        await setPhase(tx, "remove", { report });
      });
      return { again: 0 };
    }
    if (phase === "remove") {
      await db.tx(async (tx) => {
        // work demo jobs did meanwhile joins the registry; what derives from it too
        report.derived += await expandDerived(tx, orgId, info);
        const files = await demoFiles(tx, orgId);
        const tombstones = await hasDevices(tx, orgId);
        const r = await removeRows(tx, orgId, info, { tombstones });
        report.tombstones = r.tombstones;
        report.files = await removeFiles(tx, orgId, files, (cfg as ServerConfig).blobs ? (cfg as ServerConfig).blobs! : undefined);
        await setPhase(tx, "accounts", { report, files });
      });
      return { again: 0 };
    }
    if (phase === "accounts") {
      await db.tx(async (tx) => {
        report.accounts = await removeAccounts(tx, orgId);
        await setPhase(tx, "restore", { report });
      });
      return { again: 0 };
    }
    if (phase === "restore") {
      await db.tx(async (tx) => {
        report.restored = await restoreComputed(tx, orgId, info);
        await restoreCounters(tx, orgId, pack.counters ?? {});
        await setPhase(tx, "finish", { report });
      });
      return { again: 0 };
    }
    // finish: anything a demo job wrote while the purge ran goes too; then the audit line and the end of the pack
    await db.tx(async (tx) => {
      const late = await expandDerived(tx, orgId, info);
      const left = await tx.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1 and tbl <> 'sm_users'`, [orgId]);
      if (late || (left?.n && !report.tombstones)) {
        await removeRows(tx, orgId, info, { tombstones: report.tombstones > 0 });
        await removeAccounts(tx, orgId);
      }
      const counts = { rows: report.rows, derived: report.derived, tables: Object.keys(report.tables).length, accounts: report.accounts, files: report.files, references: report.references.reduce((s, r) => s + r.rows, 0), tombstones: report.tombstones };
      await auditLine(tx, orgId, by, "demo_purge", "داده‌های نمایشی حذف شد", counts);
      if (report.tombstones > 0) {
        const mark = await tx.one<{ rev: number }>(`select rev from sm_org_sync where org_id = $1`, [orgId]);
        await tx.query(`update sm_demo_packs set state = 'tombstoned', purge_mark = $2, report = $3::jsonb, updated_at = now() where org_id = $1`, [orgId, mark?.rev ?? 0, JSON.stringify(report)]);
        await enqueue(tx, { kind: "demo.finalize", orgId, payload: {}, dedupeKey: "demo.finalize", delayMs: 10 * 60_000 });
      } else {
        await finalRemove(tx, orgId);
      }
    });
    forgetCaches(orgId);
  });
}

/** The pack's own bookkeeping goes last. */
async function finalRemove(q: Queryable, orgId: string): Promise<void> {
  await q.query(`delete from sm_demo_rows where org_id = $1`, [orgId]);
  await q.query(`delete from sm_demo_saved where org_id = $1`, [orgId]);
  await q.query(`delete from sm_demo_packs where org_id = $1`, [orgId]);
}

/**
 * Remove the tombstones for good once every Windows app of the organisation has pulled past them (or has not synced
 * for 30 days); `force`: now (an administrator's decision — an app that never synced again keeps its copies).
 */
export async function finalizeDemo(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<{ done: boolean; waiting: number }> {
  const db = cfg.db as Db;
  return inDemoScope(null, async () => {
    const pack = await packOf(db, orgId);
    if (!pack || pack.state !== "tombstoned") return { done: !pack, waiting: 0 };
    const waiting = await waitingDevices(db, orgId, pack.purge_mark ?? 0);
    if (waiting && !opts.force) return { done: false, waiting };
    const info = await tablesInfo(db);
    await db.tx(async (tx) => {
      const files = (pack.progress.files ?? []) as string[];
      await removeRows(tx, orgId, info, { tombstones: false });
      await removeAccounts(tx, orgId);
      await removeFiles(tx, orgId, files, (cfg as ServerConfig).blobs ?? undefined);
      await finalRemove(tx, orgId);
    });
    forgetCaches(orgId);
    return { done: true, waiting };
  });
}

let installed = false;

export function installDemoModule(): void {
  if (installed) return;
  installed = true;
  registerJobHandler("demo.load", async (job, jctx) => {
    if (!job.org_id) return;
    return loadJob(jctx.cfg, job.org_id, jctx.deadline);
  });
  registerJobHandler("demo.purge", async (job, jctx) => {
    if (!job.org_id) return;
    return purgeStep(jctx.cfg, job.org_id, (job.payload.by as string | undefined) ?? null);
  });
  registerJobHandler("demo.finalize", async (job, jctx) => {
    if (!job.org_id) return;
    const r = await finalizeDemo(jctx.cfg, job.org_id);
    if (!r.done) return { again: 60 * 60_000 };
  });
}

/**
 * Run a load or purge to its end in this process (karizctl, the desktop app's local API, tests): the job queue runs
 * until the pack leaves the state (the modules' seed jobs and the jobs demo work queues run with it).
 */
export async function runToEnd(cfg: JobConfig, orgId: string, kind: "load" | "purge", opts: { budgetMs?: number } = {}): Promise<void> {
  const until = Date.now() + (opts.budgetMs ?? 60 * 60_000);
  const { tick } = await import("../../jobs");
  for (;;) {
    const pack = await packOf(cfg.db, orgId);
    if (!pack) return;
    if (kind === "load" && pack.state !== "loading") return;
    if (kind === "purge" && pack.state !== "purging") return;
    if (Date.now() > until) throw new Error("demo: time budget exhausted");
    await tick(cfg, { budgetMs: 30_000 });
  }
}

export const DEMO_PERSONAS = KNOWN_NAMES;
export function demoEmail(orgId: string, persona: keyof typeof KNOWN_NAMES): string {
  return emailOf(orgId, KNOWN_NAMES[persona].email.split("@")[0]);
}
