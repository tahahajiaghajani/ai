// The services behind the module's routes (design A §4 service.ts, §8.4, §14.5): what the console, the connector page,
// the wizard and the reconciliation queue ask for, each with the caller's rights checked BEFORE anything leaves the
// server — a test, a preview and a run send the connector's stored credentials (§14.5).
//
//   reading       CMDB readers: the console's cards, a connector, its runs and items, the queue (the engine's read
//                 rules: items, runs and problems through their connector, the item's record in field group internal)
//   writing       through the engine and the connector guard (guard.ts) — the same rules as the record API
//   test, run now, cancel     CMDB administrators and the connector's owner
//   preview, reapply, «پذیرش اندازهٔ تازه»     CMDB administrators; the tool's raw JSON for tenant administrators only
//   queue actions «ساخت پیکربندی», «پیوند به…», «نادیده گرفتن»     CMDB administrators and the connector's owner;
//                 mismatches (mismatch.ts) also the asset's managers
//   directory approval (§14.8)     integrations administrators, with re-authentication; journaled
// Every action on a demo connector runs inside its organisation's demo scope (§14.4). The Windows app answers none of
// it (§14.7).
import type { DiscoveredRecord, TestResult } from "@shared/discovery/types";
import { KIND_DESCRIPTORS, offeredKinds } from "@shared/discovery/kinds";
import { CREATE_POLICIES, ITEM_STATES, RUN_LANES, RUN_STATES, STATUS_WORDS } from "@shared/discovery/types";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { isDemoRow } from "../../db/scope";
import { needRecentAuth } from "../../auth/policy";
import { addJournalIn, get, list, loadReadable, condEnv, orgSchema, updateIn } from "../../engine";
import { AppError, bad, conflict, forbidden, notFound } from "../../http/errors";
import { createOrUpdate } from "../cmdb/ire";
import { sysOf } from "../incident/common";
import { intLog } from "../integration/common";
import { rightsOf, ADMIN_ONLY_MESSAGE, type DiscoveryRights } from "./guard";
import { inConnectorScope, MIN_EVERY_MINUTES, MIN_STATUS_EVERY_MINUTES, queuePull } from "./jobs";
import { ConnectorError, CONNECTOR_MESSAGES } from "./kind";
import { ireItem, mayCreate } from "./mapping";
import { applyMismatch, dismissMismatch } from "./mismatch";
import { editionOf, reachProblem } from "./net";
import { serverKind } from "./registry";
import {
  acceptNewSize, cancelRun, connCtx, connectorView, consecutiveFailures, ireCtx, KEYED_AUTH, kindOptions, loadConnector, PREVIEW_BUSY, previewConnector, runningRun,
  writeItemResults, type PreviewDraft,
} from "./runner";

type Row = Record<string, any>;

export const READ_MESSAGE = "منبع‌های داده را خوانندگان پایگاه پیکربندی می‌بینند";
export const OPERATOR_MESSAGE = "این کار با مدیر پیکربندی یا مسئول همین منبع است";
export const DIRECTORY_MESSAGE = "استفاده از این منبع فهرست کاربران با تأیید مدیر یکپارچه‌سازی است";
const WINDOWS_AUTH = new Set(["ntlm", "windows_identity"]);

/** A connector failure as an HTTP answer with its Persian message (never a 500). */
export function httpError(e: unknown): unknown {
  if (!(e instanceof ConnectorError)) return e;
  return new AppError(e.message === PREVIEW_BUSY ? 409 : 400, `connector_${e.code}`, e.message);
}

/** The Windows app neither runs nor shows connectors (§14.7). */
export function refuseDesktop(ctx: Pick<Ctx, "cfg">): void {
  if (editionOf(ctx.cfg) === "desktop") throw new AppError(403, "desktop", CONNECTOR_MESSAGES.desktop);
}

/** The caller reads the module (CMDB readers): their rights. */
export async function needReader(ctx: Ctx): Promise<DiscoveryRights> {
  refuseDesktop(ctx);
  const r = await rightsOf(ctx);
  if (!r.cmdbRead) throw forbidden(READ_MESSAGE);
  return r;
}

interface ConnectorAs {
  /** the stored row (the caller may read it) */
  row: Row;
  rights: DiscoveryRights;
  owner: boolean;
}

/** A connector the caller may read, with their rights over it (404 when they may not read it). */
async function connectorAs(ctx: Ctx, id: string): Promise<ConnectorAs> {
  const rights = await needReader(ctx);
  await get(ctx, "discovery_connector", id);
  const row = await loadConnector(ctx.db, ctx.org.id, id);
  if (!row) throw notFound("منبع داده پیدا نشد");
  return { row, rights, owner: !!row.owner_id && row.owner_id === ctx.user.id };
}

function needOperator(x: ConnectorAs): void {
  if (!x.rights.admin && !x.owner) throw forbidden(OPERATOR_MESSAGE);
}
function needAdmin(x: { rights: DiscoveryRights }): void {
  if (!x.rights.admin) throw forbidden(ADMIN_ONLY_MESSAGE);
}

/** Run `fn` in the connector's scope (a demo connector's inside the demo scope), connector failures as HTTP answers. */
async function scoped<T>(ctx: Ctx, connectorId: string, fn: (demo: boolean) => Promise<T>): Promise<T> {
  try {
    return await inConnectorScope(ctx.db, ctx.org.id, connectorId, fn);
  } catch (e) {
    throw httpError(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The console

/** What the screens need to know once: the edition, the caller's rights, the kinds offered here and the words. */
export async function discoveryMeta(ctx: Ctx) {
  const rights = await needReader(ctx);
  const edition = editionOf(ctx.cfg) === "server" ? "server" : "cloud";
  return {
    edition,
    can: rights,
    kinds: offeredKinds(edition).map(({ kind, runs }) => ({ ...kind, runs })),
    all_kinds: KIND_DESCRIPTORS.filter((d) => !d.hidden).map((d) => ({ kind: d.kind, label: d.label, icon: d.icon, category: d.category, ready: d.ready })),
    min_every_minutes: MIN_EVERY_MINUTES[edition],
    min_status_every_minutes: MIN_STATUS_EVERY_MINUTES[edition],
    words: { status: STATUS_WORDS, item_states: ITEM_STATES, run_lanes: RUN_LANES, run_states: RUN_STATES, create_policies: CREATE_POLICIES },
  };
}

export interface ConnectorCard {
  id: string;
  name: string;
  kind: string;
  label: string;
  icon: string;
  category: string;
  active: boolean;
  owner_id: string | null;
  plain_http: boolean;
  every_minutes: number;
  /** a keyed way in whose key is missing (a backup restore): «کلید منبع را دوباره وارد کنید» */
  needs_key: boolean;
  items: Record<string, number>;
  last_run: Row | null;
  running: Row | null;
  /** a complete pass the mass-drop guard holds until «پذیرش اندازهٔ تازه» */
  held: { run_id: string; listed: number; message: string } | null;
  failures: number;
  can: { edit: boolean; operate: boolean };
}

const RUN_FIELDS = "id, lane, trigger, state, started_at, finished_at, duration_ms, pages, fetched, staged, skipped_unchanged, refreshed, retried, created, updated, unmatched, duplicates, failed, complete, items_total, warnings, error, import_run_id";

/** The console (§15): one card per connector the caller reads, with its items, its last and running pass, a held pass. */
export async function connectorCards(ctx: Ctx): Promise<ConnectorCard[]> {
  const rights = await needReader(ctx);
  const res = await list(ctx, "discovery_connector", { size: 500, total: false, sort: "name", fields: ["name", "kind", "active", "owner_id"] });
  const ids = res.rows.map((r) => String(r.id));
  if (!ids.length) return [];
  const org = ctx.org.id;
  const conns = await ctx.db.query<Row>(`select id, name, kind, active, owner_id, plain_http, every_minutes, auth, secret is not null as has_secret from sm_discovery_connectors where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [org, pgArray(ids)]);
  const counts = await ctx.db.query<{ connector_id: string; state: string | null; n: number; mismatch: number; silent: number }>(
    `select connector_id, state, count(*)::int as n, count(*) filter (where mismatch_state = 'open')::int as mismatch,
       count(*) filter (where last_contact_at < now() - interval '14 days')::int as silent
     from sm_discovery_items where org_id = $1 and connector_id = any($2::uuid[]) and deleted_at is null group by connector_id, state`,
    [org, pgArray(ids)],
  );
  const runs = await ctx.db.query<Row>(
    `select distinct on (connector_id) connector_id, ${RUN_FIELDS} from sm_discovery_runs
     where org_id = $1 and connector_id = any($2::uuid[]) and lane = 'inventory' and deleted_at is null and state <> 'running' order by connector_id, started_at desc`,
    [org, pgArray(ids)],
  );
  const running = await ctx.db.query<Row>(`select connector_id, id, started_at, cursor->>'phase' as phase, fetched, created, updated from sm_discovery_runs where org_id = $1 and connector_id = any($2::uuid[]) and state = 'running' and lane = 'inventory'`, [org, pgArray(ids)]);
  const out: ConnectorCard[] = [];
  for (const c of conns.sort((a, b) => String(a.name).localeCompare(String(b.name), "fa"))) {
    const d = KIND_DESCRIPTORS.find((k) => k.kind === c.kind);
    const items: Record<string, number> = { total: 0, pending: 0, mismatch: 0, silent: 0 };
    for (const r of counts.filter((x) => x.connector_id === c.id)) {
      items.total += r.n;
      items[r.state ?? "pending"] = (items[r.state ?? "pending"] ?? 0) + r.n;
      items.mismatch += r.mismatch;
      items.silent += r.silent;
    }
    const last = runs.find((r) => r.connector_id === c.id) ?? null;
    const massDrop = (last?.warnings as { code?: string; accepted?: boolean; message?: string }[] | null)?.find((w) => w.code === "mass_drop" && !w.accepted);
    const owner = !!c.owner_id && c.owner_id === ctx.user.id;
    out.push({
      id: c.id, name: c.name, kind: c.kind, label: d?.label ?? c.kind, icon: d?.icon ?? "radar", category: d?.category ?? "generic", active: c.active !== false, owner_id: c.owner_id ?? null,
      plain_http: !!c.plain_http, every_minutes: Number(c.every_minutes ?? 0), needs_key: KEYED_AUTH.has(String(c.auth ?? "")) && !c.has_secret, items, last_run: last,
      running: running.find((r) => r.connector_id === c.id) ?? null,
      held: last && massDrop ? { run_id: last.id, listed: Number(last.items_total ?? 0), message: massDrop.message ?? "" } : null,
      failures: await consecutiveFailures(ctx.db, org, c.id),
      can: { edit: rights.admin, operate: rights.admin || owner },
    });
  }
  return out;
}

/** One connector's page: its record (secrets as «کلید ذخیره شده»), card, the caller's rights over it. */
export async function connectorPage(ctx: Ctx, id: string) {
  const x = await connectorAs(ctx, id);
  const record = await get(ctx, "discovery_connector", id);
  const card = (await connectorCards(ctx)).find((c) => c.id === id) ?? null;
  return {
    ...record,
    card,
    can: { edit: x.rights.admin, operate: x.rights.admin || x.owner, preview: x.rights.admin, raw: x.rights.admin && x.rights.tenantAdmin, approve_directory: x.rights.integrationsAdmin },
  };
}

/** A connector's passes, newest first (the engine reads them through their connector). */
export async function connectorRuns(ctx: Ctx, id: string, p: { lane?: string; page?: number; size?: number }) {
  await connectorAs(ctx, id);
  const and: unknown[] = [{ f: "connector_id", op: "eq", v: id }];
  if (p.lane) and.push({ f: "lane", op: "eq", v: p.lane });
  return list(ctx, "discovery_run", { filter: { and } as never, sort: "-started_at", page: p.page, size: p.size ?? 50 });
}

/** A connector's items (the engine's read rules: the normalised record only for callers of field group internal). */
export async function connectorItems(ctx: Ctx, id: string, p: { state?: string; q?: string; page?: number; size?: number }) {
  await connectorAs(ctx, id);
  const and: unknown[] = [{ f: "connector_id", op: "eq", v: id }];
  if (p.state === "pending") and.push({ f: "state", op: "empty" });
  else if (p.state) and.push({ f: "state", op: "eq", v: p.state });
  return list(ctx, "discovery_item", { filter: { and } as never, q: p.q || undefined, sort: "name", page: p.page, size: p.size ?? 50 });
}

/** The reconciliation queue's tabs (§8.4; «بی‌دارایی» and «نرم‌افزار یکسان‌نشده» come with DA7). */
export const QUEUE_TABS = ["unmatched", "duplicate", "error", "mismatch"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

/** «صف آشتی»: the items of one tab across the connectors the caller reads. */
export async function reconcileQueue(ctx: Ctx, p: { tab: QueueTab; connector?: string; q?: string; page?: number; size?: number }) {
  await needReader(ctx);
  const and: unknown[] = [p.tab === "mismatch" ? { f: "mismatch_state", op: "eq", v: "open" } : { f: "state", op: "eq", v: p.tab }];
  if (p.connector) and.push({ f: "connector_id", op: "eq", v: p.connector });
  const counts = await ctx.db.query<{ tab: string; n: number }>(
    `select t.tab, count(*)::int as n from (
       select case when i.mismatch_state = 'open' then 'mismatch' end as m, i.state from sm_discovery_items i
       join sm_discovery_connectors c on c.id = i.connector_id and c.org_id = i.org_id and c.deleted_at is null
       where i.org_id = $1 and i.deleted_at is null and (i.state in ('unmatched', 'duplicate', 'error') or i.mismatch_state = 'open')
     ) x cross join lateral (values (x.state), (x.m)) t(tab) where t.tab is not null group by t.tab`,
    [ctx.org.id],
  );
  const res = await list(ctx, "discovery_item", { filter: { and } as never, q: p.q || undefined, sort: "-updated_at", page: p.page, size: p.size ?? 50 });
  return { ...res, counts: Object.fromEntries(QUEUE_TABS.map((t) => [t, counts.find((c) => c.tab === t)?.n ?? 0])) };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions on a connector

/**
 * «آزمودن اتصال» (§14.1): first whether the connector may reach its hosts at all — the allowlist and the refusals,
 * with what to do — and only then the kind's own test with the stored credentials: the tool's version and identity
 * and the permissions it lacks, or the Persian cause.
 */
export async function testConnection(ctx: Ctx, id: string): Promise<TestResult> {
  const x = await connectorAs(ctx, id);
  needOperator(x);
  return scoped(ctx, id, async () => {
    const conn = x.row;
    const kind = serverKind(conn.kind);
    if (!kind?.ready) return { ok: false, warnings: [], message: CONNECTOR_MESSAGES.notBuilt(kind?.label ?? String(conn.kind)) };
    const edition = editionOf(ctx.cfg);
    if (!kind.editions.includes(edition as "cloud" | "server")) return { ok: false, warnings: [], message: `منبع «${kind.label}» در این نسخهٔ کاریز اجرا نمی‌شود` };
    const parsed = kindOptions(kind, conn.options);
    if ("error" in parsed) return { ok: false, warnings: [], message: parsed.error };
    if (kind.kind !== "demo") {
      const credentialed = conn.secret !== null || conn.secret2 !== null || WINDOWS_AUTH.has(String(conn.auth ?? ""));
      const problem = await reachProblem(ctx.cfg, connectorView(conn, parsed.options), { credentialed });
      if (problem) return { ok: false, warnings: [], message: problem };
    }
    try {
      const cctx = await connCtx(sysOf(ctx), conn, kind, parsed.options, Date.now() + 20_000);
      return await kind.test(cctx);
    } catch (e) {
      if (e instanceof ConnectorError) return { ok: false, warnings: [], message: e.message };
      ctx.cfg.log?.warn?.("discovery connection test failed", { connector: id, error: String((e as Error)?.message ?? e).slice(0, 300) });
      return { ok: false, warnings: [], message: CONNECTOR_MESSAGES.noAnswer(String(conn.name)) };
    }
  });
}

/**
 * «پیش‌نمایش» (§7.5): CMDB administrators only — checked before the tool is contacted, since a preview sends the
 * stored credentials. Mapped fields and the engine's dry-run answer per row; the tool's raw element only for tenant
 * administrators.
 */
export async function previewAs(ctx: Ctx, id: string, draft: PreviewDraft, limit?: number) {
  const x = await connectorAs(ctx, id);
  needAdmin(x);
  const out = await scoped(ctx, id, () => previewConnector(sysOf(ctx), id, draft, limit));
  if (!x.rights.tenantAdmin) for (const r of out.rows) delete r.raw;
  return out;
}

/** «اجرای اکنون»: a pass is queued now (never a second one while one runs: it goes on, and the queued job joins it). */
export async function runNow(ctx: Ctx, id: string, opts: { reapply?: boolean } = {}) {
  const x = await connectorAs(ctx, id);
  if (opts.reapply) needAdmin(x);
  else needOperator(x);
  return scoped(ctx, id, async (demo) => {
    const running = await runningRun(ctx.db, ctx.org.id, id);
    const job = await queuePull(ctx.db, ctx.org.id, id, { trigger: "manual", reapply: !!opts.reapply, demo });
    return { queued: true, job_id: job, running: running ? { id: running.id, started_at: running.started_at } : null, reapply: !!opts.reapply };
  });
}

/** «لغو»: the running pass stops at its next step. */
export async function cancelPass(ctx: Ctx, id: string) {
  const x = await connectorAs(ctx, id);
  needOperator(x);
  const running = await runningRun(ctx.db, ctx.org.id, id);
  if (!running) throw conflict("گذری از این منبع در جریان نیست");
  return { canceled: await cancelRun(ctx.db, ctx.org.id, running.id), run_id: running.id };
}

/** «پذیرش اندازهٔ تازه» (§10.4): the held pass's unlisted items are marked gone, and the contact ladder runs. */
export async function acceptSize(ctx: Ctx, runId: string) {
  const rights = await needReader(ctx);
  const run = await ctx.db.one<Row>(`select id, connector_id from sm_discovery_runs where org_id = $1 and id = $2::uuid and deleted_at is null`, [ctx.org.id, runId]);
  if (!run) throw notFound("گذر پیدا نشد");
  await get(ctx, "discovery_connector", run.connector_id);
  needAdmin({ rights });
  const r = await scoped(ctx, run.connector_id, () => acceptNewSize(sysOf(ctx), runId));
  if (!r) throw conflict("این گذر کاهش ناگهانی نگه‌داشته‌شده‌ای ندارد");
  return r;
}

/**
 * The integrations administrator's approval of a connector's use of a directory source (§14.8), with
 * re-authentication: journaled on the connector and in the integration log. A change of the source clears it
 * (guard.ts).
 */
export async function approveDirectory(ctx: Ctx, id: string) {
  const x = await connectorAs(ctx, id);
  if (!x.rights.integrationsAdmin) throw forbidden(DIRECTORY_MESSAGE);
  needRecentAuth(ctx);
  const sourceId = x.row.directory_source_id;
  if (!sourceId) throw bad("این منبع داده منبع فهرست کاربران ندارد");
  const source = await ctx.db.one<{ name: string }>(`select name from sm_directory_sources where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, sourceId]);
  if (!source) throw notFound("منبع فهرست کاربران پیدا نشد");
  const sys = sysOf(ctx);
  await sys.write(async (tx) => {
    const row = await updateIn(tx, sys, "discovery_connector", id, { directory_approved_by: ctx.user.id, directory_approved_at: new Date().toISOString() }, { trusted: true });
    await addJournalIn(tx, ctx, tableDef("discovery_connector")!, row, { kind: "system", visibility: "internal", body: `استفادهٔ این منبع داده از منبع فهرست کاربران «${source.name}» تأیید شد` }, { trusted: true });
  });
  await intLog(ctx.db, { org_id: ctx.org.id, kind: "directory", ref_id: sourceId, actor: ctx.user.id, ok: true, summary: `تأیید استفادهٔ منبع دادهٔ «${x.row.name}» از این منبع فهرست کاربران` });
  return { approved: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The reconciliation queue's actions (§8.4)

interface ItemAs extends ConnectorAs {
  item: Row;
}

/** An item the caller may read (through its connector), the connector and the caller's rights over it. */
async function itemAs(ctx: Ctx, itemId: string): Promise<ItemAs> {
  const rights = await needReader(ctx);
  await get(ctx, "discovery_item", itemId);
  const item = await ctx.db.one<Row>(`select * from sm_discovery_items where org_id = $1 and id = $2::uuid and deleted_at is null`, [ctx.org.id, itemId]);
  if (!item) throw notFound("مورد منبع داده پیدا نشد");
  const row = await loadConnector(ctx.db, ctx.org.id, item.connector_id);
  if (!row) throw notFound("منبع داده پیدا نشد");
  return { item, row, rights, owner: !!row.owner_id && row.owner_id === ctx.user.id };
}

const QUEUE_STATES = new Set(["unmatched", "duplicate", "error"]);

/**
 * «ساخت پیکربندی»: the item goes to the engine again, this time allowed to create — as the connector's source (its
 * precedence and provenance), its result written to the item in the engine's own transaction. Never an ATM (fleet
 * assets come from the register, §9.5).
 */
export async function createCiFor(ctx: Ctx, itemId: string) {
  const x = await itemAs(ctx, itemId);
  needOperator(x);
  if (!QUEUE_STATES.has(String(x.item.state))) throw bad("فقط برای موردهای «بی‌همتا»، «تکراری» یا «خطا» پیکربندی ساخته می‌شود");
  const record = (x.item.data ?? {}) as DiscoveredRecord;
  if (!mayCreate(record, "create")) throw bad("برای خودپرداز پیکربندی ساخته نمی‌شود؛ آن را از دفتر اموال به دارایی‌اش پیوند بزنید");
  if (!x.row.source_id) throw bad("منبع دادهٔ پیکربندیِ این منبع پیدا نشد");
  return scoped(ctx, x.row.id, async () => {
    const sys = sysOf(ctx);
    const sent = [ireItem({ record, defaultClass: x.row.default_class ?? null, hint: null })];
    const wrapped = ireCtx(sys);
    wrapped.set((tx, out) => writeItemResults(tx, sys, x.row.id, [{ id: x.item.id, data: record }], out, sent, Math.max(1, Number(x.row.retry_hours ?? 24))));
    const out = await createOrUpdate(wrapped.ctx, { source_id: x.row.source_id, items: sent, create: true });
    const r = out.results[0];
    return { action: r?.action ?? "error", ci_id: r?.ci_id ?? null, number: r?.number ?? null, message: r?.message ?? null, dedup_task_id: r?.dedup_task_id ?? null };
  });
}

/**
 * «پیوند به…»: the item is linked to a CI the caller reads; the next pass reconciles it through that CI (the identity
 * hint) and stamps the source's provenance. A demo CI and a real item (or the reverse) are never linked.
 */
export async function linkItem(ctx: Ctx, itemId: string, ciId: string) {
  const x = await itemAs(ctx, itemId);
  needOperator(x);
  if (String(x.item.state) === "ignored" || String(x.item.state) === "gone") throw bad("این مورد در صف آشتی نیست");
  const def = (await orgSchema(ctx)).def("ci")!;
  const ci = await loadReadable(ctx.db, ctx, def, ciId, await condEnv(ctx));
  if (!ci) throw notFound("پیکربندی پیدا نشد");
  // the identity hint ignores such CIs (ire.ts hintedCi); a merged one is followed to the CI it was merged into
  if (["disposed", "canceled"].includes(String(ci.state ?? ""))) throw bad("این پیکربندی کنار گذاشته یا لغو شده است؛ پیکربندی زندهٔ دیگری را برگزینید");
  if ((await isDemoRow(ctx.db, ctx.org.id, ciId)) !== (await isDemoRow(ctx.db, ctx.org.id, x.row.id))) throw bad("داده‌های نمایشی و واقعی به هم پیوند نمی‌خورند");
  return scoped(ctx, x.row.id, async (demo) => {
    await ctx.db.query(
      `update sm_discovery_items set ci_id = $3, state = null, reconciled_at = null, retry_at = null, dedup_task_id = null,
         message = 'پیوند دستی به پیکربندی؛ در گذر بعدی آشتی می‌شود', updated_at = now()
       where org_id = $1 and id = $2`,
      [ctx.org.id, itemId, ciId],
    );
    // a pass of retries reconciles it soon, without listing the tool again (waiting items go first in every phase)
    await queuePull(ctx.db, ctx.org.id, x.row.id, { trigger: "manual", retryOnly: true, demo });
    return { linked: ciId };
  });
}

/** «نادیده گرفتن»: the item leaves the queue and is not offered again until the tool reports it differently. */
export async function ignoreItem(ctx: Ctx, itemId: string) {
  const x = await itemAs(ctx, itemId);
  needOperator(x);
  if (!QUEUE_STATES.has(String(x.item.state))) throw bad("فقط موردهای «بی‌همتا»، «تکراری» یا «خطا» نادیده گرفته می‌شوند");
  return scoped(ctx, x.row.id, async () => {
    await ctx.db.query(`update sm_discovery_items set state = 'ignored', retry_at = null, message = 'نادیده گرفته شد', updated_at = now() where org_id = $1 and id = $2`, [ctx.org.id, itemId]);
    return { state: "ignored" };
  });
}

/** «نادیده گرفتن» of an item's differences with the asset register (mismatch.ts checks who may). */
export async function dismissMismatchAs(ctx: Ctx, itemId: string) {
  const x = await itemAs(ctx, itemId);
  return scoped(ctx, x.row.id, () => dismissMismatch(ctx, itemId));
}

/** «به‌روزرسانی دارایی با مقدار ابزار» (mismatch.ts: a normal asset write as the person, under their rights). */
export async function applyMismatchAs(ctx: Ctx, itemId: string, field: string) {
  const x = await itemAs(ctx, itemId);
  return scoped(ctx, x.row.id, () => applyMismatch(ctx, itemId, field));
}
