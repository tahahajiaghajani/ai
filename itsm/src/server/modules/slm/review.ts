// Service review packs (SLM-046/047/048): the numbers of a review's period, computed by code as the system and stored
// on the review — every target's compliance and trend, breaches by definition, group and priority, volume against
// the ceiling, incidents (major ones too), open problems, changes and failed ones of the service, the survey
// experience (suppressed below the minimum number of answers), the watermelon gap, credits and the improvement
// register. The narrative and the improvement suggestions (AI skills with rule-based fallbacks) read only the pack.
import { tableDef } from "@shared/tables";
import { FAILED_CODES } from "@shared/tables/change";
import { addDays } from "@shared/jalali";
import { formatJalali } from "@shared/jalali";
import { compliancePct, complianceStatus, lastPeriods, num, watermelon, weightedMean, worstStatus, type ReviewPack } from "@shared/slm/logic";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { condEnv, orgSchema, readable } from "../../engine";
import { countRows, isUuid, liveRow, liveRows, slmConfig, sysOf, type Row } from "./common";
import { definitionsOf } from "./definitions";
import { agreementPeriod, experienceIn, goalsOf, measureTarget, timerCounts, windowOf, type Window } from "./measure";

/** Breached timers of these definitions in a window, counted by definition and by the record's group and priority. */
export async function breachBreakdown(q: Queryable, ctx: Ctx, defIds: string[], w: Window): Promise<ReviewPack["breaches"]> {
  if (!defIds.length) return [];
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const def = schema.def("task_sla")!;
  const params: unknown[] = [];
  const where = readable(sys, def, "t", params, await condEnv(sys));
  params.push(pgArray(defIds), w.from, w.to);
  const n = params.length;
  const rows = await q.query<{ name: string; table_key: string; record_id: string }>(
    `select t.name, t.table_key, t.record_id from ${def.table} t where ${where} and t.deleted_at is null and t.definition_id = any($${n - 2}::uuid[])
       and t.breached and coalesce(t.breached_at, t.stop_at) >= $${n - 1}::timestamptz and coalesce(t.breached_at, t.stop_at) < $${n}::timestamptz limit 5000`,
    params,
  );
  const out: ReviewPack["breaches"] = [];
  const bump = (by: string, label: string) => {
    const hit = out.find((x) => x.by === by && x.label === label);
    if (hit) hit.count++;
    else out.push({ by, label, count: 1 });
  };
  for (const r of rows) bump("definition", r.name);
  // the records' group and priority, per table (counts only)
  const byTable = new Map<string, string[]>();
  for (const r of rows) byTable.set(r.table_key, [...(byTable.get(r.table_key) ?? []), r.record_id]);
  for (const [table, idsOf] of byTable) {
    const tdef = schema.def(table) ?? tableDef(table);
    if (!tdef || tdef.virtual) continue;
    const group = tdef.scope.group && tdef.fields.some((f) => f.name === tdef.scope.group) ? tdef.scope.group : null;
    const prio = tdef.fields.some((f) => f.name === "priority") ? "priority" : null;
    if (!group && !prio) continue;
    const recs = await liveRows(q, sys, table, { f: "id", op: "in" as const, v: [...new Set(idsOf)].slice(0, 500) }, { limit: 500 });
    const groups = new Map<string, string>();
    if (group) {
      const gids = [...new Set(recs.map((r) => r[group]).filter(isUuid))];
      if (gids.length) for (const g of await liveRows(q, sys, "group", { f: "id", op: "in", v: gids })) groups.set(String(g.id), String(g.name));
    }
    for (const rec of recs) {
      const times = idsOf.filter((x) => x === rec.id).length;
      for (let i = 0; i < times; i++) {
        if (group) bump("group", rec[group] ? groups.get(String(rec[group])) ?? "گروه دیگر" : "بی‌گروه");
        if (prio && rec[prio]) bump("priority", `اولویت ${String(rec[prio])}`);
      }
    }
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 30);
}

/** Records of a task table about a service in a window: created, major, open now. */
async function serviceRecords(q: Queryable, ctx: Ctx, table: string, serviceId: string, w: Window): Promise<{ created: number; open: number; extra: number }> {
  const def = tableDef(table);
  if (!def || !def.fields.some((f) => f.name === "service_id")) return { created: 0, open: 0, extra: 0 };
  const sys = sysOf(ctx);
  const scope = { f: "service_id", op: "eq" as const, v: serviceId };
  const created = await countRows(q, sys, table, { and: [scope, { f: "created_at", op: "gte", v: w.from }, { f: "created_at", op: "lt", v: w.to }] } as never);
  const open = def.fields.some((f) => f.name === "active") ? await countRows(q, sys, table, { and: [scope, { f: "active", op: "eq", v: true }] }) : 0;
  let extra = 0;
  if (table === "incident" && def.fields.some((f) => f.name === "major_state")) {
    extra = await countRows(q, sys, table, { and: [scope, { f: "major_state", op: "in", v: ["accepted", "resolved", "pir_done"] }, { f: "created_at", op: "gte", v: w.from }, { f: "created_at", op: "lt", v: w.to }] } as never);
  }
  if (table === "change_request" && def.fields.some((f) => f.name === "close_code")) {
    extra = await countRows(q, sys, table, { and: [scope, { f: "close_code", op: "in", v: FAILED_CODES }, { f: "updated_at", op: "gte", v: w.from }, { f: "updated_at", op: "lt", v: w.to }] } as never);
  }
  return { created, open, extra };
}

/** Build the pack of a review (as the system; reads only). */
export async function buildPack(q: Queryable, ctx: Ctx, review: Row): Promise<ReviewPack> {
  const sys = sysOf(ctx);
  const cfg = await slmConfig(q, sys);
  const a = isUuid(review.agreement_id) ? await liveRow(q, sys, "service_agreement", review.agreement_id) : null;
  const serviceId = (isUuid(review.service_id) ? review.service_id : null) ?? (a && isUuid(a.service_id) ? a.service_id : null);
  const from = String(review.period_from).slice(0, 10);
  const to = String(review.period_to).slice(0, 10);
  const p = { start: from, end: addDays(to, 1) };
  const w = windowOf(sys, p);
  const targets: ReviewPack["targets"] = [];
  let defIds: string[] = [];
  let volume = { created: 0, resolved: 0, limit: null as number | null, over_limit: false };
  if (a) {
    const defs = await definitionsOf(q, sys, String(a.id));
    defIds = defs.map((d) => d.definition_id);
    const trendPeriods = lastPeriods(to, agreementPeriod(a, to).unit, 4);
    for (const t of await liveRows(q, sys, "slm_target", { and: [{ f: "agreement_id", op: "eq", v: a.id }, { f: "active", op: "eq", v: true }] }, { order: "t.sort_order, t.name" })) {
      const m = await measureTarget(q, sys, a, t, p, cfg.k_min);
      const stored = await liveRows(q, sys, "slm_compliance", { and: [{ f: "target_id", op: "eq", v: t.id }, { f: "period_key", op: "in", v: trendPeriods.map((x) => x.key) }] });
      targets.push({
        id: String(t.id), name: String(t.name), kind: String(t.kind), metric_category: String(t.metric_category ?? "warranty"), goal: m.goal, value: m.value, status: m.status, total: m.total, breached: m.breached,
        trend: trendPeriods.map((x) => ({ label: x.label, value: num(stored.find((s) => s.period_key === x.key)?.value) })),
      });
    }
    const c = await timerCounts(q, sys, defIds, w, num(a.volume_limit));
    volume = { created: c.volume, resolved: c.met + c.breached, limit: num(a.volume_limit), over_limit: c.over_limit };
  }
  const overallValue = weightedMean(targets.map((t) => ({ value: t.value })));
  const status = worstStatus(targets.map((t) => t.status));
  const incidents = serviceId ? await serviceRecords(q, sys, "incident", serviceId, w) : { created: 0, open: 0, extra: 0 };
  const problems = serviceId ? await serviceRecords(q, sys, "problem", serviceId, w) : { created: 0, open: 0, extra: 0 };
  const changes = serviceId ? await serviceRecords(q, sys, "change_request", serviceId, w) : { created: 0, open: 0, extra: 0 };
  const exp = serviceId ? await experienceIn(q, sys, serviceId, w, cfg.k_min) : null;
  const expTarget = targets.find((t) => t.kind === "experience")?.value ?? null;
  const slaPct = weightedMean(targets.filter((t) => t.kind === "timer" || t.kind === "availability").map((t) => ({ value: t.value })));
  const credits = a ? await liveRows(q, sys, "slm_credit", { and: [{ f: "agreement_id", op: "eq", v: a.id }, { f: "created_at", op: "gte", v: w.from }, { f: "created_at", op: "lt", v: w.to }] } as never) : [];
  const improvements = a ? await liveRows(q, sys, "slm_improvement", { f: "agreement_id", op: "eq", v: a.id }, { limit: 2000 }) : [];
  const nowIso = new Date().toISOString();
  const openImp = improvements.filter((i) => ["proposed", "approved", "in_progress"].includes(String(i.state)));
  const names = a
    ? {
        service: isUuid(a.service_id) ? String((await liveRow(q, sys, "service", a.service_id))?.name ?? "") || null : null,
        customer: isUuid(a.customer_unit_id) ? String((await liveRow(q, sys, "org_unit", a.customer_unit_id))?.name ?? "") || null : null,
      }
    : { service: serviceId ? String((await liveRow(q, sys, "service", serviceId))?.name ?? "") || null : null, customer: null };
  const goal = a ? num(a.compliance_target) : null;
  return {
    title: String(review.title ?? ""),
    period: { from, to, label: `${formatJalali(from)} تا ${formatJalali(to)}` },
    agreement: a ? { id: String(a.id), number: a.number ?? null, name: String(a.name ?? ""), kind: String(a.kind ?? "sla"), service: names.service, customer: names.customer } : null,
    overall: { value: overallValue, status: targets.length ? status : complianceStatus(null, goal, null), goal },
    targets,
    breaches: await breachBreakdown(q, sys, defIds, w),
    volume,
    incidents: { total: incidents.created, major: incidents.extra, open: incidents.open },
    problems: { open: problems.open },
    changes: { total: changes.created, failed: changes.extra },
    experience: exp,
    watermelon: watermelon(slaPct, expTarget ?? exp?.experience_pct ?? null, cfg.watermelon_gap, goal),
    credits: { count: credits.length, pct_total: credits.reduce((s, c) => s + (num(c.credit_pct) ?? 0), 0) },
    improvements: {
      open: openImp.length,
      overdue: openImp.filter((i) => i.due_at && String(i.due_at) < nowIso).length,
      done: improvements.filter((i) => ["done", "closed"].includes(String(i.state)) && String(i.resolved_at ?? i.updated_at ?? "") >= w.from && String(i.resolved_at ?? i.updated_at ?? "") < w.to).length,
    },
    generated_at: nowIso,
  };
}

/** A review's stored pack, or a fresh one (the caller must be able to read the review). */
export async function packOf(q: Queryable, ctx: Ctx, review: Row): Promise<ReviewPack> {
  if (review.pack && typeof review.pack === "object" && Array.isArray((review.pack as ReviewPack).targets)) return review.pack as ReviewPack;
  return buildPack(q, ctx, review);
}

export { compliancePct, goalsOf };
