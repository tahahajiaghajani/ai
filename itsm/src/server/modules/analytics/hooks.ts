// Hooks of the analytics tables (same transaction as the write): definitions are validated against the
// organisation's schema, their derived fields kept (a report's visualization, a layout made safe, an indicator's
// formula version), sharing compiled into the row columns the row rules test (only the owner changes sharing), a
// certification dropped when someone other than a report administrator changes what was certified, schedules'
// next run computed, and the tables the module alone writes (scores, deliveries) refused to everyone else.
import { cleanLayout } from "@shared/analytics/layout";
import { normalizeSpec, specProblem } from "@shared/analytics/model";
import { bindPeriod, indicatorProblem } from "@shared/analytics/kpi";
import type { DashboardFilter, IndicatorPart, ReportSpec } from "@shared/analytics/types";
import { nextOccurrence, scheduleProblem, type ScheduleSpec } from "@shared/flows";
import type { Ctx } from "../../context";
import { bad, forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { checkFilter, orgSchema, orgTz, pathVisible, pushGuard, registerHooks, onRecordEvent, systemCtx, updateIn, type PushArgs, type WriteArgs } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { canAdmin, isUuid, liveRow, sysOf, type Row } from "./common";
import { compileFor, indicatorScoreColumns, ownerReadsScores, restampIndicator, scoreColumns } from "./sharing";
import { ensureTick } from "./jobs";

const isSystem = (ctx: Ctx) => ctx.actor === "system";
const isOwner = (w: WriteArgs) => (w.prev?.owner_id ?? w.next.owner_id) === w.ctx.user.id;

/** Compile `shares` into the row columns (create, or the owner changed them). */
async function sharing(w: WriteArgs, field: "shares" | "score_shares", into: (c: Awaited<ReturnType<typeof compileFor>>["compiled"]) => Row): Promise<void> {
  if (w.op === "delete") return;
  if (w.op !== "create" && !w.changed.has(field)) return;
  if (w.op === "update" && !isSystem(w.ctx) && field === "shares" && !isOwner(w) && !canAdmin(w.ctx)) throw forbidden("فقط مالک (یا مدیر گزارش‌ها) اشتراک را تغییر می‌دهد");
  const { shares, compiled } = await compileFor(w.tx, w.ctx.org.id, w.next[field] ?? []);
  w.next[field] = shares;
  Object.assign(w.next, into(compiled));
}

const definitionColumns = (c: Awaited<ReturnType<typeof compileFor>>["compiled"]): Row => ({ ...c });

/** Trash: stamp when a definition goes to the recycle bin, clear when it comes back. */
function trash(w: WriteArgs): void {
  if (w.op === "delete" || !w.changed.has("trashed")) return;
  w.next.trashed_at = w.next.trashed ? new Date().toISOString() : null;
}

/** What a report administrator certified stops being certified when someone else changes it. */
function uncertify(w: WriteArgs, fields: string[]): void {
  if (w.op !== "update" || !w.prev?.certified || isSystem(w.ctx) || canAdmin(w.ctx)) return;
  if (fields.some((f) => w.changed.has(f))) w.next.certified = false;
}

async function checkSpec(w: WriteArgs, spec: unknown, where = ""): Promise<ReportSpec> {
  const schema = await orgSchema(w.ctx, w.tx);
  const s = spec as ReportSpec;
  if (!s || typeof s !== "object" || typeof s.table !== "string") throw bad(`${where}تعریف گزارش معتبر نیست`);
  const def = schema.def(s.table);
  const problem = specProblem(s, def, schema.lookup);
  if (problem) throw bad(`${where}${problem}`);
  if (!isSystem(w.ctx) && def && !access().canReadTable(w.ctx, def)) throw forbidden(`${where}به «${def.plural}» دسترسی ندارید`);
  return normalizeSpec(s);
}

const FILTER_KEY = /^[a-z0-9_]{1,30}$/;

function checkFilters(input: unknown): DashboardFilter[] {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input) || input.length > 8) throw bad("پالایه‌های داشبورد باید فهرستی تا ۸ مورد باشد");
  const seen = new Set<string>();
  return input.map((f: DashboardFilter) => {
    if (!f || !FILTER_KEY.test(String(f.key ?? "")) || seen.has(f.key)) throw bad("کلید پالایه معتبر یا یکتا نیست");
    seen.add(f.key);
    if (f.kind !== "time" && f.kind !== "field") throw bad("نوع پالایه شناخته نیست");
    if (f.kind === "field" && (typeof f.field !== "string" || !/^[a-z0-9_.]{1,80}$/.test(f.field))) throw bad("پالایه‌ای که روی فیلد است نام فیلد می‌خواهد");
    return { key: f.key, kind: f.kind, field: f.kind === "field" ? f.field : null, label: String(f.label ?? f.key).slice(0, 60) };
  });
}

/** A period a part's filter placeholders are checked with. */
const SAMPLE_PERIOD = { start: "2026-03-21T00:00:00.000Z", end: "2026-04-21T00:00:00.000Z" };
const READERS_ONLY_ADMIN = "خوانندگان امتیازهای ذخیره‌شده (عدد کل سازمان) را مدیر گزارش‌ها تعیین می‌کند";
const OWNER_ONLY_ADMIN = "مالک شاخص را مدیر گزارش‌ها تغییر می‌دهد";
const COLLECT_ONLY_ADMIN = "عکس روزانهٔ شاخص (امتیازهای کل سازمان) را مدیر گزارش‌ها روشن می‌کند";

/**
 * An indicator as its writer may define it (the API's and a Windows app's push alike): a valid formula over tables the
 * writer reads, every measured, dated and broken-down field and every filter checked against the writer's visible
 * fields; who reads its stored scores (organisation-wide numbers), who owns it and whether it is collected daily are a
 * report administrator's. The system and trusted server code (the library, the seed) define any.
 */
async function indicatorRules(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const writer = !isSystem(w.ctx) && !w.trusted;
  if (w.op === "update" && w.changed.has("key")) throw bad("کلید شاخص پس از ساخت تغییر نمی‌کند");
  if (w.op === "create" || ["formula", "parts", "breakdowns"].some((f) => w.changed.has(f))) {
    const schema = await orgSchema(w.ctx, w.tx);
    const problem = indicatorProblem({ formula: String(w.next.formula ?? ""), parts: w.next.parts, breakdowns: w.next.breakdowns ?? [] }, schema.lookup);
    if (problem) throw bad(problem);
    if (writer) {
      for (const p of w.next.parts as IndicatorPart[]) {
        const def = schema.def(p.table);
        if (!def) continue;
        if (!access().canReadTable(w.ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
        for (const path of [p.field, p.from, p.date_field, ...((w.next.breakdowns ?? []) as string[])]) {
          if (path && !pathVisible(w.ctx, def, String(path), schema)) throw forbidden(`فیلد «${path}» در «${def.label}» در دسترس شما نیست`);
        }
        if (p.filter) checkFilter(w.ctx, def, schema, bindPeriod(p.filter, SAMPLE_PERIOD));
      }
    }
  }
  if (!writer || canAdmin(w.ctx)) return;
  if (w.op === "create") {
    if (Array.isArray(w.next.score_shares) && w.next.score_shares.length) throw forbidden(READERS_ONLY_ADMIN);
    if (isUuid(w.next.owner_id) && w.next.owner_id !== w.ctx.user.id) throw forbidden(OWNER_ONLY_ADMIN);
    // nobody but report administrators reads organisation-wide scores of it: nothing to collect
    w.next.collect = false;
    return;
  }
  if (w.changed.has("score_shares")) throw forbidden(READERS_ONLY_ADMIN);
  if (w.changed.has("owner_id")) throw forbidden(OWNER_ONLY_ADMIN);
  if (w.changed.has("collect") && w.next.collect) throw forbidden(COLLECT_ONLY_ADMIN);
}

/** Does the indicator's (new) owner read its stored scores (a report administrator)? */
async function ownerReads(w: { tx: WriteArgs["tx"]; ctx: Ctx }, ownerId: unknown): Promise<boolean> {
  if (!isSystem(w.ctx) && ownerId === w.ctx.user.id) return canAdmin(w.ctx);
  return ownerReadsScores(w.tx, w.ctx.org.id, ownerId);
}

/**
 * A Windows app's push runs no beforeWrite. Its sharing is compiled here, in the push's transaction, from the pushed
 * `shares` (the row columns the row rules test are never taken from the push), and what only a report administrator
 * sets (certification) or the cloud counts (versions) keeps the stored value. The guards run as `validatePush`.
 */
async function derivedOnPush(p: PushArgs): Promise<Row> {
  const field = p.def.key === "analytics_indicator" ? "score_shares" : "shares";
  const { shares, compiled } = await compileFor(p.tx, p.ctx.org.id, p.next[field] ?? [], { check: false }).catch(() => compileFor(p.tx, p.ctx.org.id, p.prev?.[field] ?? [], { check: false }));
  const out: Row = { [field]: shares, ...(field === "score_shares" ? await indicatorScoreColumns(p.tx, p.ctx.org.id, p.next, compiled, await ownerReads(p, p.next.owner_id)) : compiled) };
  if (!canAdmin(p.ctx)) out.certified = p.prev ? !!p.prev.certified && !["spec", "table_key", "layout", "filters", "formula", "parts", "grain", "target", "warn", "crit", "score_shares", "owner_id"].some((f) => p.changed.has(f)) : false;
  // a new indicator of someone who does not administer reports is not collected (nobody else reads its scores)
  if (p.def.key === "analytics_indicator" && !p.prev && !canAdmin(p.ctx)) out.collect = false;
  if (p.def.key === "analytics_report") out.spec_version = p.prev ? Number(p.prev.spec_version ?? 1) + (p.changed.has("spec") ? 1 : 0) : 1;
  if (p.def.key === "analytics_indicator") out.formula_version = p.prev ? Number(p.prev.formula_version ?? 1) + (["formula", "parts", "grain"].some((f) => p.changed.has(f)) ? 1 : 0) : 1;
  return out;
}

/** The pushed twin of the definition rules: the spec checked against the schema and the pusher's access, only the
 * owner (or a report administrator) changes sharing, every share target exists. */
async function definitionOnPush(w: WriteArgs): Promise<void> {
  const field = w.def.key === "analytics_indicator" ? "score_shares" : "shares";
  if (w.def.key === "analytics_report" && (!w.prev || w.changed.has("spec") || w.changed.has("table_key"))) await checkSpec(w, w.next.spec);
  // an indicator pushed from a Windows app is held to the same rules as one saved here
  if (w.def.key === "analytics_indicator") await indicatorRules(w);
  if (!w.prev || w.changed.has(field)) {
    if (w.prev && field === "shares" && !isOwner(w) && !canAdmin(w.ctx)) throw forbidden("فقط مالک (یا مدیر گزارش‌ها) اشتراک را تغییر می‌دهد");
    await compileFor(w.tx, w.ctx.org.id, w.next[field] ?? []);
  }
}

export function installAnalyticsHooks(): void {
  for (const t of ["analytics_report", "analytics_dashboard", "analytics_indicator"]) {
    registerHooks(t, { derivePush: derivedOnPush, validatePush: pushGuard(definitionOnPush) });
  }
  registerHooks("analytics_config", { validatePush: pushGuard((w) => { if (!canAdmin(w.ctx)) throw forbidden("تنظیمات گزارش‌ها با مدیر گزارش‌هاست"); }) });
  for (const t of ["analytics_score", "analytics_delivery"]) registerHooks(t, { validatePush: () => "این ردیف را فقط سامانه ثبت می‌کند" });

  registerHooks("analytics_report", {
    async beforeWrite(w) {
      if (w.op === "delete") return;
      if (w.op === "create" || w.changed.has("spec") || w.changed.has("table_key")) {
        const spec = await checkSpec(w, w.next.spec);
        w.next.spec = spec;
        w.next.table_key = spec.table;
        w.next.viz = spec.viz;
        if (w.op === "update" && w.changed.has("spec")) w.next.spec_version = Number(w.prev?.spec_version ?? 1) + 1;
      }
      trash(w);
      uncertify(w, ["spec", "table_key"]);
      await sharing(w, "shares", definitionColumns);
    },
  });

  registerHooks("analytics_dashboard", {
    async beforeWrite(w) {
      if (w.op === "delete") return;
      if (w.op === "create" || w.changed.has("layout")) {
        const layout = cleanLayout(w.next.layout);
        for (const wd of layout.widgets) {
          const title = wd.title ? `«${wd.title}»: ` : "";
          if (wd.kind === "report") {
            if (wd.spec) wd.spec = await checkSpec(w, wd.spec, title);
            else if (!isUuid(wd.report_id)) throw bad(`${title}ابزارک گزارش، گزارش یا تعریف می‌خواهد`);
          }
          if (wd.kind === "indicator" && !isUuid(wd.indicator_id) && !wd.indicator_key) throw bad(`${title}ابزارک شاخص، شاخص می‌خواهد`);
          if (wd.report_id && !isUuid(wd.report_id)) wd.report_id = null;
          if (wd.indicator_ids) wd.indicator_ids = wd.indicator_ids.filter(isUuid).slice(0, 30);
        }
        w.next.layout = layout;
      }
      if (w.op === "create" || w.changed.has("filters")) w.next.filters = checkFilters(w.next.filters);
      trash(w);
      uncertify(w, ["layout", "filters"]);
      await sharing(w, "shares", definitionColumns);
    },
  });

  registerHooks("analytics_indicator", {
    async beforeWrite(w) {
      if (w.op === "delete") return;
      await indicatorRules(w);
      // a new formula is a new series: stored scores of the old one stay as they were (lineage)
      if (w.op === "update" && ["formula", "parts", "grain"].some((f) => w.changed.has(f))) w.next.formula_version = Number(w.prev?.formula_version ?? 1) + 1;
      uncertify(w, ["formula", "parts", "grain", "target", "warn", "crit", "score_shares", "owner_id"]);
      if (w.op === "create" || w.changed.has("score_shares")) {
        const reads = await ownerReads(w, w.next.owner_id);
        await sharing(w, "score_shares", (c) => scoreColumns(c, w.next.owner_id, reads));
      }
      // an owner who administers reports reads the scores of what they own: a new owner is a new reader (or none);
      // the scores of an indicator made of guarded fields (amounts in «مالی») go only to holders of those groups
      if (w.op === "create" || ["score_shares", "owner_id", "parts", "breakdowns"].some((f) => w.changed.has(f))) {
        const { compiled } = await compileFor(w.tx, w.ctx.org.id, w.next.score_shares ?? [], { check: false });
        Object.assign(w.next, await indicatorScoreColumns(w.tx, w.ctx.org.id, w.next, compiled, await ownerReads(w, w.next.owner_id)));
      }
      if (w.next.active && w.next.collect && (w.op === "create" || w.changed.has("collect") || w.changed.has("active"))) await ensureTick(w.tx, w.ctx.org.id);
    },
    async afterWrite(w) {
      // the stored scores carry their readers: follow a change of the indicator's score readers — inside this write's
      // transaction, with a system context that runs no query of its own (PGlite has one connection: a query outside
      // the open transaction would wait for it forever)
      if (w.op === "update" && ["score_shares", "owner_id", "parts", "breakdowns"].some((f) => w.changed.has(f))) {
        await restampIndicator(w.tx, sysOf(w.ctx), w.next, { s_users: w.next.s_users ?? [], s_groups: w.next.s_groups ?? [], s_all: !!w.next.s_all, s_roles: w.next.s_roles ?? [] });
      }
    },
  });

  const systemOnly = (what: string) => ({
    beforeWrite(w: WriteArgs) {
      if (!isSystem(w.ctx) && !w.trusted) throw forbidden(`${what} را فقط سامانه ثبت می‌کند`);
    },
  });
  registerHooks("analytics_score", systemOnly("امتیاز شاخص"));
  registerHooks("analytics_delivery", systemOnly("گزارش تحویل‌شده"));

  registerHooks("analytics_schedule", {
    async beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next;
      if (!!n.report_id === !!n.dashboard_id) throw bad("یکی از «گزارش» یا «داشبورد» را برگزینید");
      const p = scheduleProblem(n.schedule);
      if (p) throw bad(p);
      if (!Array.isArray(n.channels) || !n.channels.length) throw bad("دست‌کم یک کانال برگزینید");
      if (!Array.isArray(n.formats) || !n.formats.length) throw bad("دست‌کم یک قالب برگزینید");
      if ((n.recipients?.length ?? 0) > 200 || (n.recipient_groups?.length ?? 0) > 20) throw bad("گیرندگان بیش از اندازه‌اند (۲۰۰ نفر و ۲۰ گروه)");
      if (!isSystem(w.ctx) && (w.op === "create" || w.changed.has("report_id") || w.changed.has("dashboard_id"))) {
        const table = n.report_id ? "analytics_report" : "analytics_dashboard";
        if (!(await liveRow(w.tx, w.ctx, table, n.report_id ?? n.dashboard_id))) throw bad("این گزارش یا داشبورد برای شما در دسترس نیست");
      }
      if (w.op === "create" || ["schedule", "active"].some((f) => w.changed.has(f))) {
        const at = n.active ? nextOccurrence(n.schedule as ScheduleSpec, Date.now(), orgTz(w.ctx)) : null;
        n.next_run_at = at ? new Date(at).toISOString() : null;
        // the organisation's tick delivers it (queued once; it reschedules itself)
        if (at) await ensureTick(w.tx, w.ctx.org.id);
      }
    },
  });

  registerHooks("analytics_config", {
    beforeWrite(w) {
      if (!isSystem(w.ctx) && !canAdmin(w.ctx)) throw forbidden("تنظیمات گزارش‌ها با مدیر گزارش‌هاست");
    },
  });

  // a Windows app's push compiles its sharing in the push (derivePush above); compile it again in the background with
  // fresh role holders, as a safety net
  registerJobHandler("analytics.recompile", async (job, jctx) => {
    if (!job.org_id) return;
    const { table, id } = job.payload as { table: string; id: string };
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const row = await liveRow(jctx.db, sys, table, id);
    if (!row) return;
    const field = table === "analytics_indicator" ? "score_shares" : "shares";
    const { compiled } = await compileFor(jctx.db, job.org_id, row[field] ?? [], { check: false });
    if (table === "analytics_indicator") await sys.write(async (tx) => restampIndicator(tx, sys, row, scoreColumns(compiled, row.owner_id, await ownerReadsScores(tx, job.org_id!, row.owner_id))));
    else await sys.write((tx) => updateIn(tx, sys, table, id, { ...compiled }, { trusted: true, keepVersion: true }));
  });
  onRecordEvent(
    "analytics.pushed",
    async (e, jctx) => {
      if (e.via !== "sync" || !e.org_id) return;
      const field = e.table === "analytics_indicator" ? "score_shares" : "shares";
      if (e.kind === "record.updated" && !(e.changed ?? []).includes(field)) return;
      await enqueue(jctx.db, { kind: "analytics.recompile", orgId: e.org_id, payload: { table: e.table, id: e.id }, dedupeKey: `analytics.recompile:${e.id}`, maxAttempts: 5 });
    },
    { tables: ["analytics_report", "analytics_dashboard", "analytics_indicator"], kinds: ["record.created", "record.updated"] },
  );
}
