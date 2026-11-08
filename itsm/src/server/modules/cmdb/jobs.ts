// Background work of configuration management. Everything acts once — on the web version, or on a Windows app that is
// not linked to one (`actsHere`): a linked Windows app pushes its writes and the web version reacts. The collector of
// the Windows app itself is the exception: it reads its own machine wherever it runs.
//   cmdb.health_ci      one CI's health after it or one of its relationships changed (debounced per CI)
//   cmdb.health_all     the nightly full pass: every CI's health, findings opened and closed, one fact row per class
//                       and day, each rule's compliance — resumable page by page within the worker budget
//   cmdb.rel_anchors    a CI's owner or support group changed: its relationships copy them again
//   cmdb.rel_labels     a CI was renamed: the labels of its relationships follow
//   cmdb.rel_rules      rule-based relationships for a changed CI
//   cmdb.drift          controlled attributes changed without an authorising change → drift records
//   cmdb.ci_removed     a deleted CI's relationships are ended (never left dangling)
//   cmdb.url_source     an «نشانی وب» source is read (CSV or JSON over HTTPS) and reconciled
//   cmdb.collect        the Windows app's own inventory (desktop only)
//   cmdb.sweep          hourly per organisation: expiry warnings (30/14/7 days by default), URL sources and the
//                       desktop collector when due, and once a night the full health pass, rule-based relationships,
//                       relationship suggestions and the data policies
import { csvObjects, jsonArrayAt, flatten } from "@shared/cmdb/logic";
import { addDays, todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import { createIn, emitEvent, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { safeExternalUrl, fetchText } from "../../net";
import { actsHere } from "../notify";
import { registerTopicHandler } from "../integrations/service";
import { cmdbConfig, eqAll, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { addRules, addSums, computeHealth, storeFacts, type ClassSums } from "./health";
import { applyRelRules, suggestFromIncidents } from "./suggest";
import { recordDrift } from "./baseline";
import { createOrUpdate, mapRow } from "./ire";
import { runLocalCollector } from "./collector";
import { seedCmdbDefaultsIn } from "./seed";

export const SWEEP_EVERY = 60 * 60_000;
const lastSweep = new Map<string, number>();

/** Queue the organisation's sweep (at most once per ten minutes per process; one queued job per organisation). */
export async function ensureCmdbSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "cmdb.sweep", orgId, delayMs: 60_000, dedupeKey: "cmdb.sweep", maxAttempts: 5 });
}

export const resetCmdbSweepThrottle = () => lastSweep.clear();

async function sysFor(job: { org_id: string | null }, jctx: JobContext): Promise<Ctx | null> {
  if (!job.org_id) return null;
  return systemCtx(jctx.cfg, job.org_id);
}

/** The relationships of a CI written again (their hook copies anchors and labels from the CIs). */
async function touchRels(sys: Ctx, ciId: string, side: "parent" | "both"): Promise<number> {
  return sys.write(async (tx) => {
    const cond = side === "parent" ? { f: "parent_id", op: "eq" as const, v: ciId } : { or: [{ f: "parent_id", op: "eq" as const, v: ciId }, { f: "child_id", op: "eq" as const, v: ciId }] };
    const rels = await liveRows(tx, sys, "ci_rel", cond, { limit: 5000 });
    for (const r of rels) await updateIn(tx, sys, "ci_rel", r.id, {}, { trusted: true, keepVersion: true });
    return rels.length;
  });
}

/** Read an «نشانی وب» source and reconcile its rows. */
export async function runUrlSource(sys: Ctx, sourceId: string): Promise<{ rows: number; result?: Awaited<ReturnType<typeof createOrUpdate>>; error?: string }> {
  const src = await liveRow(sys.db, sys, "cmdb_data_source", sourceId);
  if (!src || src.kind !== "url" || !src.url) return { rows: 0, error: "منبع نشانی وب نیست" };
  const mark = (status: string) => sys.write((tx) => updateIn(tx, sys, "cmdb_data_source", src.id, { last_run_at: new Date().toISOString(), last_status: status.slice(0, 300) }, { trusted: true, keepVersion: true }));
  const url = sys.cfg.mode === "cloud" ? safeExternalUrl(String(src.url)) : String(src.url);
  if (!url) {
    await mark("نشانی منبع عمومی و امن (https) نیست");
    return { rows: 0, error: "unsafe url" };
  }
  try {
    const text = await fetchText(sys.cfg.fetch, url, `منبع «${src.name}»`, {}, 20_000);
    const rows = src.format === "json" ? jsonArrayAt(JSON.parse(text), src.json_path).map((r) => flatten(r)) : csvObjects(text);
    const mapping = src.mapping && typeof src.mapping === "object" && Object.keys(src.mapping).length ? (src.mapping as Record<string, string>) : Object.fromEntries(Object.keys(rows[0] ?? {}).map((k) => [k, k]));
    const items = rows.slice(0, 1000).map((r) => mapRow(r, mapping, src.default_class ?? null));
    const result = await createOrUpdate(sys, { source_id: src.id, items, default_class: src.default_class ?? null });
    return { rows: rows.length, result };
  } catch (e) {
    await mark(`ناموفق: ${(e as Error).message}`);
    return { rows: 0, error: (e as Error).message };
  }
}

/** Warn owners of CIs that expire (certificates, licences, warranties) at the configured thresholds, once each. */
export async function expiryWarnings(sys: Ctx): Promise<number> {
  const cfg = await cmdbConfig(sys.db, sys);
  const days = [...new Set((cfg.cert_warn_days ?? [30, 14, 7]).filter((d) => Number.isInteger(d) && d >= 0))].sort((a, b) => b - a);
  if (!days.length) return 0;
  const today = todayISO(String(sys.org.settings?.timezone ?? "Asia/Tehran"));
  const until = addDays(today, days[0]);
  const rows = await liveRows(sys.db, sys, "ci", { and: [{ f: "expires_at", op: "between", v: [today, until] }, { f: "state", op: "nin", v: ["retired", "disposed", "canceled"] }] }, { limit: 2000 });
  let n = 0;
  for (const r of rows) {
    const left = Math.round((Date.parse(r.expires_at) - Date.parse(today)) / 86_400_000);
    const threshold = days.filter((d) => left <= d).pop();
    if (threshold === undefined) continue;
    const warned = r.health?.warned as { day: number; for: string } | undefined;
    if (warned && warned.for === r.expires_at && warned.day <= threshold) continue;
    await sys.write(async (tx) => {
      const users = [r.owned_by, r.managed_by].filter(isUuid);
      await emitEvent(tx, sys, { kind: "record.cmdb.expiring", table: "ci", id: r.id, number: r.number ?? null, actor: null, data: { users, days: left, expires_at: r.expires_at } });
      await updateIn(tx, sys, "ci", r.id, { health: { ...(r.health ?? {}), warned: { day: threshold, for: r.expires_at } } }, { trusted: true, keepVersion: true, allowLocked: true });
    });
    n++;
  }
  return n;
}

/** Apply the active data policies (retire or flag CIs not seen for N days), bounded per policy and run. */
export async function applyPolicies(sys: Ctx): Promise<{ affected: number; skipped: number }> {
  const policies = await liveRows(sys.db, sys, "cmdb_policy", { f: "active", op: "eq", v: true });
  let affected = 0;
  let skipped = 0;
  for (const p of policies) {
    const parts: Row[] = [{ f: "state", op: "nin", v: ["retired", "disposed", "canceled"] }];
    if (p.condition) parts.push(p.condition);
    if (p.after_days > 0) parts.push({ or: [{ f: "last_discovered_at", op: "lt", v: new Date(Date.now() - p.after_days * 86_400_000).toISOString() }, { and: [{ f: "last_discovered_at", op: "empty" }, { f: "updated_at", op: "lt", v: new Date(Date.now() - p.after_days * 86_400_000).toISOString() }] }] });
    const rows = await liveRows(sys.db, sys, "ci", { and: parts as never }, { limit: Math.min(5000, Number(p.max_per_run ?? 200)) });
    let a = 0;
    let s = 0;
    for (const r of rows) {
      try {
        await sys.write(async (tx) => {
          if (p.action === "retire") await transitionIn(tx, sys, "ci", r.id, "retired", {}, { trusted: true });
          else if (p.action === "flag_stale") await updateIn(tx, sys, "ci", r.id, { is_stale: true }, { trusted: true, keepVersion: true });
          else {
            const key = `policy:${p.id}:${r.id}`;
            const [open] = await liveRows(tx, sys, "cmdb_finding", { and: [{ f: "dedupe_key", op: "eq", v: key }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
            if (!open) {
              await createIn(tx, sys, "cmdb_finding", { short_description: `«${r.name}»: ${p.name}`.slice(0, 200), ci_id: r.id, kind: "stale", severity: "low", detail: p.description ?? p.name, dedupe_key: key, auto: true, assigned_to: r.owned_by ?? null, assignment_group_id: r.support_group_id ?? null, workspace_id: r.workspace_id ?? null }, { trusted: true });
            }
          }
        });
        a++;
      } catch {
        s++;
      }
    }
    await sys.write((tx) => updateIn(tx, sys, "cmdb_policy", p.id, { last_run_at: new Date().toISOString(), last_affected: a, last_skipped: s }, { trusted: true, keepVersion: true }));
    affected += a;
    skipped += s;
  }
  return { affected, skipped };
}

/** The full health pass, resumable: pages of CIs until the budget ends (progress kept in the job). */
async function healthAll(sys: Ctx, job: { payload: Record<string, any> }, jctx: JobContext): Promise<{ again: number } | undefined> {
  let after: string | null = job.payload.after ?? null;
  let sums: Record<string, ClassSums> = job.payload.sums ?? {};
  let rules: Record<string, { checked: number; failing: number }> = job.payload.rules ?? {};
  const day: string = job.payload.day ?? todayISO(String(sys.org.settings?.timezone ?? "Asia/Tehran"));
  for (;;) {
    const page = await sys.write((tx) => computeHealth(tx, sys, { after, limit: 200, full: true }));
    sums = addSums(sums, page.sums);
    rules = addRules(rules, page.rules);
    if (!page.last) break;
    after = page.last;
    if (Date.now() > jctx.deadline - 1500) {
      await jctx.save({ ...job.payload, after, sums, rules, day });
      return { again: 1000 };
    }
  }
  await sys.write((tx) => storeFacts(tx, sys, day, sums, rules));
  return undefined;
}

/** Hourly work, and the nightly passes when a day has gone by since the last one. */
export async function cmdbSweep(sys: Ctx, jctx: JobContext): Promise<{ pending: boolean }> {
  const count = await liveRows(sys.db, sys, "ci", null, { limit: 1 });
  if (!count.length) return { pending: false };
  await expiryWarnings(sys).catch((e) => sys.cfg.log?.warn?.("cmdb expiry", { error: (e as Error).message }));
  // URL sources that are due
  const sources = await liveRows(sys.db, sys, "cmdb_data_source", { and: [{ f: "kind", op: "eq", v: "url" }, { f: "active", op: "eq", v: true }, { f: "every_hours", op: "gt", v: 0 }] });
  for (const s of sources) {
    const last = Date.parse(s.last_run_at ?? "") || 0;
    if (Date.now() - last >= s.every_hours * 3600_000) await enqueue(jctx.db, { kind: "cmdb.url_source", orgId: sys.org.id, payload: { source: s.id }, dedupeKey: `cmdb.url_source:${s.id}` });
  }
  // the Windows app's own collector
  if (jctx.cfg.mode === "desktop") {
    for (const c of await liveRows(sys.db, sys, "discovery_collector", { and: [{ f: "kind", op: "eq", v: "desktop" }, { f: "active", op: "eq", v: true }, { f: "every_hours", op: "gt", v: 0 }] })) {
      const last = Date.parse(c.last_run_at ?? "") || 0;
      if (Date.now() - last >= c.every_hours * 3600_000) await enqueue(jctx.db, { kind: "cmdb.collect", orgId: sys.org.id, payload: { collector: c.id }, dedupeKey: "cmdb.collect" });
    }
  }
  // nightly
  const facts = await liveRows(sys.db, sys, "cmdb_health_fact", null, { order: "t.created_at desc", limit: 1 });
  const lastFull = Date.parse(facts[0]?.updated_at ?? facts[0]?.created_at ?? "") || 0;
  if (Date.now() - lastFull > 20 * 3600_000) {
    await enqueue(jctx.db, { kind: "cmdb.health_all", orgId: sys.org.id, payload: {}, dedupeKey: "cmdb.health_all" });
    await sys.write((tx) => applyRelRules(tx, sys)).catch(() => undefined);
    await sys.write((tx) => suggestFromIncidents(tx, sys)).catch(() => undefined);
    await applyPolicies(sys).catch(() => undefined);
  }
  return { pending: true };
}

/** The subscriber and job handlers (installed once by `installCmdbModule`). */
export function installCmdbJobs(): (() => void)[] {
  return [
    registerJobHandler("cmdb.seed", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys) return;
      await sys.write((tx) => seedCmdbDefaultsIn(tx, sys));
      await ensureCmdbSweep(jctx.db, sys.org.id);
    }),
    registerJobHandler("cmdb.health_ci", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.ci)) return;
      await sys.write((tx) => computeHealth(tx, sys, { ids: [job.payload.ci] }));
      await ensureCmdbSweep(jctx.db, sys.org.id);
    }),
    registerJobHandler("cmdb.health_all", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg)) return;
      return healthAll(sys, job as never, jctx);
    }),
    registerJobHandler("cmdb.rel_anchors", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.ci)) return;
      await touchRels(sys, job.payload.ci, "parent");
    }),
    registerJobHandler("cmdb.rel_labels", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.ci)) return;
      await touchRels(sys, job.payload.ci, "both");
    }),
    registerJobHandler("cmdb.rel_rules", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.ci)) return;
      await sys.write((tx) => applyRelRules(tx, sys, [job.payload.ci]));
    }),
    registerJobHandler("cmdb.drift", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.ci)) return;
      await sys.write((tx) => recordDrift(tx, sys, job.payload.ci, Array.isArray(job.payload.changes) ? job.payload.changes : [], String(job.payload.via ?? "manual")));
    }),
    registerJobHandler("cmdb.ci_removed", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.ci)) return;
      await sys.write(async (tx) => {
        const at = new Date().toISOString();
        for (const r of await liveRows(tx, sys, "ci_rel", { and: [{ or: [{ f: "parent_id", op: "eq", v: job.payload.ci }, { f: "child_id", op: "eq", v: job.payload.ci }] }, { f: "valid_to", op: "empty" }] }, { limit: 5000 }).catch(() => [] as Row[])) {
          await updateIn(tx, sys, "ci_rel", r.id, { valid_to: at }, { trusted: true }).catch(() => undefined);
        }
      });
    }),
    registerJobHandler("cmdb.url_source", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg) || !isUuid(job.payload.source)) return;
      await runUrlSource(sys, job.payload.source);
    }),
    registerJobHandler("cmdb.collect", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || jctx.cfg.mode !== "desktop") return;
      const c = isUuid(job.payload.collector) ? await liveRow(sys.db, sys, "discovery_collector", job.payload.collector) : null;
      await runLocalCollector(sys, { software: !!c?.include_software });
    }),
    registerJobHandler("cmdb.sweep", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg)) return;
      const r = await cmdbSweep(sys, jctx);
      return r.pending ? { again: SWEEP_EVERY } : undefined;
    }),
    // other systems report CIs through an inbound webhook (topics «cmdb.items» or «cmdb.ci»), as the organisation
    registerTopicHandler(/^cmdb\./, async (ctx, ev) => {
      const p = (ev.payload ?? {}) as Record<string, any>;
      const items = Array.isArray(p.items) ? p.items : p.item ? [p.item] : p.values ? [p] : [];
      const src = typeof p.source === "string" ? (await liveRows(ctx.db, sysOf(ctx), "cmdb_data_source", eqAll({ name: p.source }), { limit: 1 }))[0] : null;
      const r = await createOrUpdate(ctx, { source_id: (isUuid(p.source_id) ? p.source_id : src?.id) ?? null, items, default_class: p.class ?? null });
      return { created: r.created, updated: r.updated, unchanged: r.unchanged, duplicates: r.duplicates, failed: r.failed };
    }),
  ];
}
