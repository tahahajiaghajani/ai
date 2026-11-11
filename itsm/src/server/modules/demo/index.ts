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
import { cloudLink } from "../ai/relay";
import { demoSignInAllowed } from "./signin";
import { BANK_DOMAIN, BANK_NAME, DEMO_SIZES, KNOWN_NAMES, type DemoSize } from "./bank";
import { newMemo, runLoad, STEPS, type LoadMemo } from "./load";
import { clearReferences, computedSince, demoFiles, expandDerived, keepRealTrail, referenceReport, registryCounts, removeAccounts, removeFiles, removeRows, restoreComputed, restoreCounters, revertTouched, saveComputed, tablesInfo, unattributedReport, type PurgeReport, type RefReport } from "./purge";

export { DEMO_SIZES, BANK_NAME, type DemoSize } from "./bank";
export { tablesInfo, COMPUTED_TABLES, type PurgeReport, type RefReport } from "./purge";

export type PackState = "loading" | "loaded" | "purging" | "tombstoned" | "failed";

interface PackRow {
  org_id: string;
  state: PackState;
  size: DemoSize;
  options: { force?: boolean };
  progress: { memo?: LoadMemo; phase?: string; seeds_done?: boolean; saved?: boolean; saved_at?: string; computed?: string[]; purge?: string; files?: string[]; tombstones?: number; report?: PurgeReport };
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
  /** tables whose records a module refused while loading, with its reason */
  refused?: Record<string, string>;
  /** may the personas sign in now (off by default; an administrator turns it on for a presentation) */
  signin?: boolean;
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
    refused: memo?.refused,
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
    out.signin = await demoSignInAllowed(q, orgId);
    // the shared password exists only while demo sign-in is on (signin.ts)
    if (opts.secrets) out.password = out.signin ? (memo?.password ?? null) : null;
  }
  if (pack.state === "tombstoned") out.waiting_devices = await waitingDevices(q, orgId, pack.purge_mark ?? 0);
  return out;
}

/** Start loading the pack (a job). Refused when one is there, or when real records exist unless `force`. */
export async function startDemoLoad(ctx: Ctx, input: { size: DemoSize; force?: boolean }): Promise<DemoStatus> {
  if (!DEMO_SIZES[input.size]) throw bad("اندازهٔ دادهٔ نمایشی معتبر نیست");
  const orgId = ctx.org.id;
  await refuseLinkedDesktop(ctx.cfg as ServerConfig, ctx.db, orgId);
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

/** Is the purge job of the organisation queued or running? */
async function purgeQueued(q: Queryable, orgId: string): Promise<boolean> {
  return !!(await q.one(`select 1 from sm_jobs where org_id = $1 and kind = 'demo.purge' and status in ('queued', 'running') limit 1`, [orgId]));
}

/**
 * Start the purge (a job; always allowed, also for a failed or still running load — the load stops first). A pack
 * already purged down to tombstones only waits for its finalisation (the purge never looks for demo rows twice); a
 * purge whose job stopped (it failed, or the server restarted) is queued again.
 */
export async function startDemoPurge(ctx: Ctx): Promise<DemoStatus> {
  const orgId = ctx.org.id;
  await refuseLinkedDesktop(ctx.cfg as ServerConfig, ctx.db, orgId);
  const pack = await packOf(ctx.db, orgId);
  const rows = await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1`, [orgId]);
  if (!pack && !rows?.n) throw conflict("این سازمان دادهٔ نمایشی ندارد");
  if (pack?.state === "tombstoned") {
    await inDemoScope(null, () => enqueue(ctx.db, { kind: "demo.finalize", orgId, payload: {}, dedupeKey: "demo.finalize" }));
    return demoStatus(ctx.db, orgId);
  }
  if (pack?.state === "purging") {
    if (!(await purgeQueued(ctx.db, orgId))) await inDemoScope(null, () => enqueue(ctx.db, { kind: "demo.purge", orgId, payload: { by: ctx.user.id }, dedupeKey: "demo.purge", maxAttempts: 20 }));
    return demoStatus(ctx.db, orgId);
  }
  await inDemoScope(null, async () => {
    await ctx.db.tx(async (tx) => {
      // compare-and-set: only from the state read above (a load chunk ending now cannot take 'purging' back)
      if (pack) {
        const moved = await tx.query(
          `update sm_demo_packs set state = 'purging', purge_started_at = now(), progress = progress || '{"purge":"expand"}'::jsonb, updated_at = now() where org_id = $1 and state in ('loading', 'loaded', 'failed') returning org_id`,
          [orgId],
        );
        if (!moved.length) return;
      } else await tx.query(`insert into sm_demo_packs (org_id, state, progress, purge_started_at) values ($1, 'purging', '{"purge":"expand"}'::jsonb, now()) on conflict (org_id) do nothing`, [orgId]);
      // a load still queued stops (its job goes with the registry); a running chunk stops at its next step
      await tx.query(`update sm_jobs set status = 'done', done_at = now() where org_id = $1 and kind = 'demo.load' and status = 'queued'`, [orgId]);
      await enqueue(tx, { kind: "demo.purge", orgId, payload: { by: ctx.user.id }, dedupeKey: "demo.purge", maxAttempts: 20 });
    });
  });
  return demoStatus(ctx.db, orgId);
}

/**
 * Demo data is loaded and purged on the server (or the web version), never in a Windows app linked to one: the app
 * would push the pack to the server as its user's real work, where the purge cannot find it (docs/DEMO_FA.md).
 */
export async function refuseLinkedDesktop(cfg: Pick<ServerConfig, "mode"> & Partial<ServerConfig>, q: Queryable, orgId: string): Promise<void> {
  if (cfg.mode !== "desktop") return;
  const linked = (cfg.db && cloudLink(cfg as ServerConfig)) || (await q.one(`select 1 from sm_kv where key like 'sync.%' limit 1`)) || (await q.one(`select 1 from sm_devices where org_id = $1 limit 1`, [orgId]).catch(() => null));
  if (linked) throw conflict("این برنامهٔ ویندوز به سرور یا نسخهٔ وب پیوند دارد؛ داده‌های نمایشی را روی سرور بارگذاری یا حذف کنید، نه در برنامهٔ ویندوز");
}

/** The pack left 'loading' (a purge started): the running load chunk stops at its next step. */
class PackLeftLoading extends Error {}

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
          const computed = await saveComputed(tx, orgId, info);
          await tx.query(
            `update sm_demo_packs set counters = $2::jsonb, progress = progress || jsonb_build_object('seeds_done', true, 'saved', true, 'saved_at', now(), 'computed', $3::jsonb), updated_at = now() where org_id = $1`,
            [orgId, JSON.stringify(Object.fromEntries(counters.map((c) => [c.table_key, c.last]))), JSON.stringify(computed)],
          );
        }),
      );
      return { again: 0 };
    }
    const memo = pack.progress.memo ?? newMemo(pack.size);
    // every step's memo is saved only while the pack is still loading: a purge that started stops the load here
    const save = async (m: LoadMemo) => {
      const r = await inDemoScope(null, () => db.query(`update sm_demo_packs set progress = jsonb_set(progress, '{memo}', $2::jsonb), updated_at = now() where org_id = $1 and state = 'loading' returning org_id`, [orgId, JSON.stringify(m)]));
      if (!r.length) throw new PackLeftLoading("demo pack is no longer loading");
    };
    const done = await runLoad(cfg as ServerConfig, orgId, memo, Math.min(deadline, Date.now() + 25_000), save);
    if (!done) return { again: 0 };
    await finishLoad(db, orgId, { started_by: pack.started_by, size: pack.size }, memo.counts);
  } catch (e) {
    if (e instanceof PackLeftLoading) return;
    const message = e instanceof Error ? e.message : String(e);
    cfg.log.error("demo load failed", { org: orgId, error: message });
    await failLoad(db, orgId, message);
  }
}

/**
 * The load's last step: 'loading' → 'loaded' (compare-and-set: a purge that started meanwhile keeps 'purging') and its
 * audit line. Returns whether the pack moved.
 */
export async function finishLoad(db: Db | Queryable, orgId: string, pack: { started_by: string | null; size: DemoSize }, counts: Record<string, number>): Promise<boolean> {
  return inDemoScope(null, async () => {
    const run = async (tx: Queryable) => {
      // the personas' password is not kept in clear text: turning demo sign-in on gives them a fresh one (signin.ts)
      const moved = await tx.query(`update sm_demo_packs set state = 'loaded', loaded_at = now(), counts = $2::jsonb, progress = progress #- '{memo,password}', updated_at = now() where org_id = $1 and state = 'loading' returning org_id`, [orgId, JSON.stringify(counts)]);
      if (moved.length) await auditLine(tx, orgId, pack.started_by, "demo_load", "داده‌های نمایشی بارگذاری شد", { size: pack.size, counts });
      return moved.length > 0;
    };
    return "tx" in db ? (db as Db).tx(run) : run(db);
  });
}

/** A load that stopped: 'loading' → 'failed' only (a purge that started meanwhile keeps 'purging'). */
export async function failLoad(db: Queryable, orgId: string, message: string): Promise<boolean> {
  const r = await inDemoScope(null, () => db.query(`update sm_demo_packs set state = 'failed', error = $2, updated_at = now() where org_id = $1 and state = 'loading' returning org_id`, [orgId, message.slice(0, 500)]));
  return r.length > 0;
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
      // a load chunk still running finishes its step first (it sees 'purging' at its next save and stops)
      if (await db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'demo.load' and status = 'running' and locked_until > now() limit 1`, [orgId])) return { again: 2000 };
      await db.tx(async (tx) => {
        // the computed tables' rows computed meanwhile (put back from the copy saved before the load)
        const made = pack.progress.saved_at ? await computedSince(tx, orgId, info, pack.progress.computed ?? []) : 0;
        // only what demo work wrote and what derives from it through a reference — never «made since the load»
        const derived = made + (await expandDerived(tx, orgId, info));
        // what demo work changed in real rows goes back (only rows still as demo work left them)
        const reverted = await revertTouched(tx, orgId, info);
        // the trail of real records stays, whoever wrote it
        const kept = await keepRealTrail(tx, orgId, info, reverted.ids);
        const tables = await registryCounts(tx, orgId);
        const references = await referenceReport(tx, orgId, info);
        const unattributed = pack.progress.saved_at ? await unattributedReport(tx, orgId, info, pack.progress.saved_at) : [];
        const report: PurgeReport = {
          tables, rows: Object.values(tables).reduce((s, n) => s + n, 0), derived, accounts: { removed: 0, kept: 0 }, references, files: 0, tombstones: 0,
          restored: reverted.restored, left_real: reverted.left, kept_trail: kept, unattributed,
        };
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
        // work demo jobs did meanwhile joins the registry; what derives from it too (the trail of real records stays)
        report.derived += await expandDerived(tx, orgId, info);
        report.kept_trail = (report.kept_trail ?? 0) + (await keepRealTrail(tx, orgId, info, null));
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
        const computed = await restoreComputed(tx, orgId, info, pack.progress.computed ?? []);
        for (const [k, v] of Object.entries(computed)) report.restored[k] = (report.restored[k] ?? 0) + v;
        await restoreCounters(tx, orgId, pack.counters ?? {});
        await setPhase(tx, "finish", { report });
      });
      return { again: 0 };
    }
    // finish: anything a demo job wrote while the purge ran goes too; then the audit line and the end of the pack
    await db.tx(async (tx) => {
      // the job queue ran on after the restore phase: what a computation made or changed since is put back once more
      // (and its numbers freed); what it made joins the registry and goes below with what names it
      const again = await restoreComputed(tx, orgId, info, pack.progress.computed ?? []);
      for (const [k, v] of Object.entries(again)) report.restored[k] = (report.restored[k] ?? 0) + v;
      await restoreCounters(tx, orgId, pack.counters ?? {});
      const late = await expandDerived(tx, orgId, info);
      if (late) report.kept_trail = (report.kept_trail ?? 0) + (await keepRealTrail(tx, orgId, info, null));
      const left = await tx.one<{ n: number }>(`select count(*)::int as n from sm_demo_rows where org_id = $1 and tbl <> 'sm_users'`, [orgId]);
      // with tombstones: every registry row still live becomes one (rows a load chunk wrote after the remove phase too)
      if (late || left?.n) {
        await removeRows(tx, orgId, info, { tombstones: report.tombstones > 0 });
        await removeAccounts(tx, orgId);
      }
      const counts = { rows: report.rows, derived: report.derived, tables: Object.keys(report.tables).length, accounts: report.accounts, files: report.files, references: report.references.reduce((s, r) => s + r.rows, 0), tombstones: report.tombstones,
        // what was left and only reported (content-free: tables and counts)
        left_real: report.left_real ?? [], kept_trail: report.kept_trail ?? 0, unattributed: report.unattributed ?? [] };
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
  await q.query(`delete from sm_demo_touched where org_id = $1`, [orgId]);
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
