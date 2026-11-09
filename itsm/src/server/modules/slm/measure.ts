// Measuring agreements (SLM-006/033/034/035/040/043): each target of an agreement in its review period — timer
// targets from the SLA service's timers (records that finished in the period in time vs breached, plus timers already
// breached and still running; records beyond the agreement's monthly volume ceiling counted apart), availability from
// the portfolio's daily figures, experience from XLA scores and survey answers, satisfaction from CSAT, indicators from
// analytics — written as one `slm_compliance` row per target and period, rolled up on the target and the agreement
// (overall compliance, worst status, experience, the watermelon flag). A status that turns «در خطر» or «برآورده نشد»
// raises `record.slm.at_risk` for the agreement's owner (a notification rule names it); a closed period whose target
// missed its goal with credit tiers becomes a service credit. Everything is read as the system: only aggregates are
// stored, and they are readable by whoever reads the agreement's targets.
import { zonedMidnight } from "@shared/model/jalali-buckets";
import { AGREEMENT_IN_FORCE } from "@shared/tables/slm";
import {
  complianceStatus, compliancePct, creditPct, experienceOf, num, parseTiers, periodAvailability, periodOf, round, watermelon, weightedMean, worstStatus,
  type ComplianceStatus, type Experience, type Period,
} from "@shared/slm/logic";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, createIn, emitEvent, orgSchema, orgTz, readable, updateIn } from "../../engine";
import { pgArray } from "../../db";
import { scoreItem } from "../analytics";
import { experienceResponses } from "./experience";
import { countRows, isUuid, liveRow, liveRows, slmConfig, sysOf, todayOf, type Row } from "./common";

export interface Window {
  /** ISO instants [from, to) */
  from: string;
  to: string;
}

export const windowOf = (ctx: Ctx, p: { start: string; end: string }): Window => {
  const tz = orgTz(ctx);
  return { from: new Date(zonedMidnight(p.start, tz)).toISOString(), to: new Date(zonedMidnight(p.end, tz)).toISOString() };
};

export interface TimerCounts {
  met: number;
  breached: number;
  excluded: number;
  /** records whose timers started in the window */
  volume: number;
  over_limit: boolean;
}

/** Records (ids) whose first timer of these definitions started in the window after the first `limit` of them. */
async function overLimitRecords(q: Queryable, sys: Ctx, defIds: string[], w: Window, limit: number): Promise<string[]> {
  const schema = await orgSchema(sys, q);
  const def = schema.def("task_sla")!;
  const params: unknown[] = [];
  const where = readable(sys, def, "t", params, await condEnv(sys));
  params.push(pgArray(defIds), w.from, w.to, limit);
  const n = params.length;
  const rows = await q.query<{ record_id: string }>(
    `with recs as (select t.record_id, min(t.start_at) as s from ${def.table} t where ${where} and t.deleted_at is null and t.definition_id = any($${n - 3}::uuid[]) and t.start_at >= $${n - 2}::timestamptz and t.start_at < $${n - 1}::timestamptz group by t.record_id),
     ranked as (select record_id, row_number() over (order by s, record_id) as rn from recs)
     select record_id from ranked where rn > $${n}`,
    params,
  );
  return rows.map((r) => r.record_id);
}

/** Met and breached timers of these definitions in a window (SLM-034), with the volume ceiling applied (SLM-033). */
export async function timerCounts(q: Queryable, ctx: Ctx, defIds: string[], w: Window, volumeLimit: number | null = null): Promise<TimerCounts> {
  const sys = sysOf(ctx);
  if (!defIds.length) return { met: 0, breached: 0, excluded: 0, volume: 0, over_limit: false };
  const scope = { f: "definition_id", op: "in", v: defIds };
  const inWindow = (f: string) => [{ f, op: "gte", v: w.from }, { f, op: "lt", v: w.to }];
  const excluded = volumeLimit !== null && volumeLimit > 0 ? await overLimitRecords(q, sys, defIds, w, volumeLimit) : [];
  const notExcluded = excluded.length ? [{ f: "record_id", op: "nin", v: excluded.slice(0, 500) }] : [];
  const met = await countRows(q, sys, "task_sla", { and: [scope, { f: "stage", op: "eq", v: "achieved" }, ...inWindow("stop_at"), ...notExcluded] } as never);
  const breached = await countRows(q, sys, "task_sla", {
    and: [scope, ...notExcluded, { or: [{ and: [{ f: "stage", op: "eq", v: "breached" }, ...inWindow("stop_at")] }, { and: [{ f: "active", op: "eq", v: true }, { f: "breached", op: "eq", v: true }, ...inWindow("breached_at")] }] }],
  } as never);
  const schema = await orgSchema(sys, q);
  const def = schema.def("task_sla")!;
  const params: unknown[] = [];
  const where = readable(sys, def, "t", params, await condEnv(sys));
  params.push(pgArray(defIds), w.from, w.to);
  const v = await q.one<{ n: string | number }>(
    `select count(distinct t.record_id) as n from ${def.table} t where ${where} and t.deleted_at is null and t.definition_id = any($${params.length - 2}::uuid[]) and t.start_at >= $${params.length - 1}::timestamptz and t.start_at < $${params.length}::timestamptz`,
    params,
  );
  const volume = Number(v?.n ?? 0);
  return { met, breached, excluded: excluded.length, volume, over_limit: volumeLimit !== null && volumeLimit > 0 && volume > volumeLimit };
}

/** The service's availability over a period (the portfolio's daily figures). */
export async function availabilityOf(q: Queryable, ctx: Ctx, serviceId: unknown, p: { start: string; end: string }): Promise<{ value: number | null; days: number }> {
  if (!isUuid(serviceId)) return { value: null, days: 0 };
  const rows = await liveRows(q, sysOf(ctx), "service_score_fact", { and: [{ f: "service_id", op: "eq", v: serviceId }, { f: "day", op: "gte", v: p.start }, { f: "day", op: "lt", v: p.end }] }, { limit: 400 });
  return periodAvailability(rows.map((r) => ({ day: String(r.day), availability: num(r.availability) })));
}

/** Mean XLA score of the service's records scored in the window (null below `kMin` scores). */
export async function xlaMeanOf(q: Queryable, ctx: Ctx, serviceId: unknown, w: Window, kMin: number): Promise<{ value: number | null; n: number }> {
  const and: Row[] = [{ f: "computed_at", op: "gte", v: w.from }, { f: "computed_at", op: "lt", v: w.to }];
  if (isUuid(serviceId)) and.push({ f: "service_id", op: "eq", v: serviceId });
  const rows = await liveRows(q, sysOf(ctx), "slm_xla_score", { and } as never, { limit: 10_000 });
  const xs = rows.map((r) => num(r.score)).filter((v): v is number => v !== null);
  if (xs.length < kMin) return { value: null, n: xs.length };
  return { value: round(xs.reduce((a, b) => a + b, 0) / xs.length, 1), n: xs.length };
}

/** Survey experience of the service in the window. */
export async function experienceIn(q: Queryable, ctx: Ctx, serviceId: unknown, w: Window, kMin: number): Promise<Experience & { available: boolean }> {
  const { responses, available } = await experienceResponses(q, ctx, { service_id: isUuid(serviceId) ? serviceId : null, from: w.from, to: w.to });
  return { ...experienceOf(responses, kMin), available };
}

export interface TargetMeasure {
  value: number | null;
  goal: number | null;
  at_risk: number | null;
  status: ComplianceStatus;
  total: number;
  met: number;
  breached: number;
  excluded: number;
  volume: number;
  over_limit: boolean;
}

/** The goal and warning level of a target (its own, else the agreement's). */
export function goalsOf(t: Row, a: Row): { goal: number | null; at_risk: number | null } {
  const timerLike = t.kind === "timer";
  const goal = num(t.goal) ?? (timerLike ? num(a.compliance_target) : null);
  let atRisk = num(t.at_risk) ?? (timerLike ? num(a.at_risk_target) : null);
  if (atRisk !== null && goal !== null && atRisk <= goal) atRisk = null;
  return { goal, at_risk: atRisk };
}

/** Measure one target over a period (as the system; reads only). */
export async function measureTarget(q: Queryable, ctx: Ctx, a: Row, t: Row, p: { start: string; end: string }, kMin: number): Promise<TargetMeasure> {
  const w = windowOf(ctx, p);
  const { goal, at_risk } = goalsOf(t, a);
  const base: TargetMeasure = { value: null, goal, at_risk, status: "no_data", total: 0, met: 0, breached: 0, excluded: 0, volume: 0, over_limit: false };
  let value: number | null = null;
  if (t.kind === "timer") {
    if (!isUuid(t.definition_id)) return base;
    const c = await timerCounts(q, ctx, [String(t.definition_id)], w, num(a.volume_limit));
    Object.assign(base, { met: c.met, breached: c.breached, total: c.met + c.breached, excluded: c.excluded, volume: c.volume, over_limit: c.over_limit });
    value = compliancePct(c.met, c.breached);
  } else if (t.kind === "availability") {
    const r = await availabilityOf(q, ctx, a.service_id, p);
    value = r.value;
    base.total = r.days;
  } else if (t.kind === "experience") {
    const x = await xlaMeanOf(q, ctx, a.service_id, w, kMin);
    const s = await experienceIn(q, ctx, a.service_id, w, kMin);
    value = s.experience_pct !== null && x.value !== null ? round((s.experience_pct + x.value) / 2, 1) : (x.value ?? s.experience_pct);
    base.total = x.n + s.responses;
  } else if (t.kind === "satisfaction") {
    const s = await experienceIn(q, ctx, a.service_id, w, kMin);
    value = s.csat;
    base.total = s.responses;
  } else if (t.kind === "indicator") {
    if (!isUuid(t.indicator_id)) return base;
    const sys = sysOf(ctx);
    const ind = await liveRow(q, sys, "analytics_indicator", t.indicator_id);
    if (ind) {
      const item = await scoreItem(sys, ind, { trend: 2 }).catch(() => null);
      value = item?.current.value ?? null;
      base.total = item?.current.n ?? 0;
    }
  } else if (t.kind === "manual") {
    const sys = sysOf(ctx);
    const [row] = await liveRows(q, sys, "slm_compliance", { and: [{ f: "target_id", op: "eq", v: t.id }, { f: "period_key", op: "eq", v: periodOf(p.start, "month").key }] }, { limit: 1 });
    value = row ? num(row.value) : null;
    base.total = row ? 1 : 0;
  }
  base.value = value === null ? null : round(value, 2);
  base.status = complianceStatus(base.value, goal, at_risk);
  return base;
}

/** The period of an agreement that holds `date` (its review period: month, quarter or year). */
export const agreementPeriod = (a: Row, date: string): Period => periodOf(date, (a.review_period === "quarter" || a.review_period === "year" ? a.review_period : "month") as "month" | "quarter" | "year");

export interface AgreementMeasure {
  period: Period;
  targets: { target: Row; measure: TargetMeasure }[];
  overall: number | null;
  status: ComplianceStatus;
  experience: (Experience & { available: boolean }) | null;
  watermelon: { gap: number | null; flagged: boolean };
}

/** Measure every active target of an agreement in a period (reads only). */
export async function measureAgreementIn(q: Queryable, ctx: Ctx, a: Row, p: Period): Promise<AgreementMeasure> {
  const sys = sysOf(ctx);
  const cfg = await slmConfig(q, sys);
  const targets = await liveRows(q, sys, "slm_target", { and: [{ f: "agreement_id", op: "eq", v: a.id }, { f: "active", op: "eq", v: true }] }, { order: "t.sort_order, t.name" });
  const out: AgreementMeasure["targets"] = [];
  for (const t of targets) out.push({ target: t, measure: await measureTarget(q, ctx, a, t, p, cfg.k_min) });
  const overall = weightedMean(out.map((x) => ({ value: x.measure.value, weight: num(x.target.weight) })));
  const status = worstStatus(out.map((x) => x.measure.status));
  const w = windowOf(ctx, p);
  const experience = isUuid(a.service_id) ? await experienceIn(q, ctx, a.service_id, w, cfg.k_min) : null;
  const xla = out.find((x) => x.target.kind === "experience")?.measure.value ?? null;
  const expPct = xla ?? experience?.experience_pct ?? null;
  const slaPct = weightedMean(out.filter((x) => x.target.kind === "timer" || x.target.kind === "availability").map((x) => ({ value: x.measure.value, weight: num(x.target.weight) })));
  return { period: p, targets: out, overall, status, experience, watermelon: watermelon(slaPct, expPct, cfg.watermelon_gap, num(a.compliance_target)) };
}

const STATUS_RANK: Record<ComplianceStatus, number> = { no_data: 0, met: 1, at_risk: 2, missed: 3 };

/**
 * Measure an agreement now and store it (inside `tx`, as the system): the current period's rows (and, with `final`,
 * the given closed period's rows, final, with credits), the targets' and the agreement's roll-ups, and the at-risk
 * event when the agreement's status worsened.
 */
export async function storeMeasures(tx: Tx, ctx: Ctx, agreementId: string, opts: { period?: Period; final?: boolean; now?: number } = {}): Promise<AgreementMeasure | null> {
  const sys = sysOf(ctx);
  const a = await liveRow(tx, sys, "service_agreement", agreementId);
  if (!a) return null;
  const p = opts.period ?? agreementPeriod(a, todayOf(sys, opts.now));
  const m = await measureAgreementIn(tx, sys, a, p);
  const at = new Date(opts.now ?? Date.now()).toISOString();
  for (const { target: t, measure: x } of m.targets) {
    if (t.kind === "manual" && x.value === null) continue;
    const values = {
      agreement_id: a.id, target_id: t.id, period_key: p.key, period_label: p.label, period_start: p.start, period_end: p.end,
      total: x.total, met: x.met, breached: x.breached, excluded: x.excluded, value: x.value, goal: x.goal, status: x.status,
      final: !!opts.final, volume: x.volume, over_limit: x.over_limit, computed_at: at,
    };
    const [row] = await liveRows(tx, sys, "slm_compliance", { and: [{ f: "target_id", op: "eq", v: t.id }, { f: "period_key", op: "eq", v: p.key }] }, { limit: 1 });
    let compliance: Row;
    if (row) {
      if (row.final && !opts.final) compliance = row;
      else compliance = await updateIn(tx, sys, "slm_compliance", row.id, values, { trusted: true });
    } else compliance = await createIn(tx, sys, "slm_compliance", values, { trusted: true });
    if (opts.final) await creditFor(tx, sys, a, t, compliance, x);
    if (!opts.final) await updateIn(tx, sys, "slm_target", t.id, { current_value: x.value, current_status: x.status, current_n: x.total, measured_at: at }, { trusted: true, keepVersion: true });
  }
  if (!opts.final) {
    const prev = (a.compliance_status ?? "no_data") as ComplianceStatus;
    const expPct = m.targets.find((x) => x.target.kind === "experience")?.measure.value ?? m.experience?.experience_pct ?? null;
    await updateIn(tx, sys, "service_agreement", a.id, {
      compliance_pct: m.overall, compliance_status: m.status, experience_pct: expPct, watermelon: m.watermelon.flagged, measured_at: at,
    }, { trusted: true, keepVersion: true, allowLocked: true });
    if (AGREEMENT_IN_FORCE.includes(String(a.state)) && STATUS_RANK[m.status] >= 2 && STATUS_RANK[m.status] > STATUS_RANK[prev]) {
      const users = [a.manager_id].filter(isUuid);
      await emitEvent(tx, sys, {
        kind: "record.slm.at_risk", table: "service_agreement", id: String(a.id), number: a.number ?? null,
        data: { users, status: m.status, compliance: m.overall, period: p.label },
      });
    }
  }
  return m;
}

/** A service credit for a closed period's missed target with credit tiers (once per target and period). */
async function creditFor(tx: Tx, sys: Ctx, a: Row, t: Row, compliance: Row, x: TargetMeasure): Promise<void> {
  if (x.status !== "missed") return;
  const tiers = parseTiers(t.credit_tiers);
  if (!tiers.length) return;
  const pct = creditPct(x.value, tiers, num(t.credit_cap_pct));
  if (pct <= 0) return;
  const [exists] = await liveRows(tx, sys, "slm_credit", { and: [{ f: "target_id", op: "eq", v: t.id }, { f: "period_key", op: "eq", v: compliance.period_key }] }, { limit: 1 });
  if (exists) return;
  const fee = num(a.monthly_fee);
  const months = a.review_period === "quarter" ? 3 : a.review_period === "year" ? 12 : 1;
  await createIn(tx, sys, "slm_credit", {
    agreement_id: a.id, target_id: t.id, compliance_id: compliance.id, period_label: compliance.period_label, period_key: compliance.period_key,
    value: x.value, goal: x.goal, credit_pct: pct, amount: fee === null ? null : String(round((fee * months * pct) / 100, 0)), manager_id: a.manager_id ?? null,
  }, { trusted: true });
}

/** The agreements a sweep measures: in force, or ended within the last period. */
export async function agreementsToMeasure(q: Queryable, ctx: Ctx): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "service_agreement", { f: "state", op: "in", v: AGREEMENT_IN_FORCE }, { order: "t.id", limit: 5000 });
}

export type { ComplianceStatus };
