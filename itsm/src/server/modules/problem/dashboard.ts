// The problem dashboard (catalogue PRB-031, PRB-013 and the KPIs of «Module: problem»): open problems by state,
// priority and age, root-cause and fix times, how many incidents and major incidents have a problem, the KEDB, CAPA,
// candidates, the top problems by risk and the Pareto of recurring incidents (by category and CI). Every figure is an
// engine aggregate with the caller's context.
import type { Cond } from "@shared/model/conditions";
import { ACTIVE_KE_STATES } from "@shared/problem/logic";
import type { Ctx } from "../../context";
import { aggregate, list, type AggregateResult } from "../../engine";

export interface Bucket {
  key: string;
  label: string;
  count: number;
}

export interface ProblemDashboard {
  days: number;
  from: string;
  open: { total: number; with_known_error: number; proactive: number; by_state: Bucket[]; by_priority: Bucket[] };
  ageing: Bucket[];
  times: { rca_median: number | null; fix_median: number | null };
  coverage: { incidents: number; linked: number; rate: number | null; majors: number; majors_with_problem: number; major_rate: number | null };
  known_errors: { active: number; published: number; by_effectiveness: Bucket[] };
  capa: { open: number; overdue: number; done: number } | null;
  candidates: number | null;
  top: { id: string; number: string | null; short_description: string; state: string; risk_score: number; incident_count: number }[];
  pareto: { categories: Bucket[]; cis: Bucket[] };
  display: Record<string, string>;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const count = (r: AggregateResult | null): number => num(r?.totals.count) ?? 0;
const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const buckets = (r: AggregateResult | null): Bucket[] => (r?.rows ?? []).map((x) => ({ key: String(x.keys[0] ?? ""), label: x.labels[0] ?? "", count: num(x.values.count) ?? 0 }));
const DAY = 86_400_000;

export async function problemDashboard(ctx: Ctx, days = 90): Promise<ProblemDashboard> {
  const d = Math.max(7, Math.min(730, Math.floor(days)));
  const now = Date.now();
  const from = new Date(now - d * DAY).toISOString();
  const today = new Date(now).toISOString();
  const p = (filter: Cond | null, groupBy: string[] = [], metrics: { fn: "count" | "median"; field?: string }[] = [{ fn: "count" }], limit?: number) => aggregate(ctx, "problem", { filter, groupBy, metrics, limit });
  const safe = <T>(x: Promise<T>) => x.catch(() => null);
  const open: Cond = { f: "active", op: "eq", v: true };
  const ages: [string, string, number, number | null][] = [
    ["0-30", "کمتر از ۳۰ روز", 0, 30],
    ["30-90", "۳۰ تا ۹۰ روز", 30, 90],
    ["90-180", "۹۰ تا ۱۸۰ روز", 90, 180],
    ["180+", "بیش از ۱۸۰ روز", 180, null],
  ];
  const age = (lo: number, hi: number | null): Cond => ({
    and: [open, { f: "opened_at", op: "lte", v: new Date(now - lo * DAY).toISOString() }, ...(hi === null ? [] : [{ f: "opened_at", op: "gt" as const, v: new Date(now - hi * DAY).toISOString() }])],
  });
  const incidentsIn: Cond = { f: "opened_at", op: "gte", v: from };
  const [byState, byPriority, withKe, proactive, rca, fix, incidents, linked, majors, majorsLinked, keActive, kePublished, keEff, capaOpen, capaOverdue, capaDone, candidates, cats, cis, top, ...ageing] = await Promise.all([
    p(open, ["state"]),
    p(open, ["priority"]),
    p({ and: [open, { f: "known_error", op: "eq", v: true }] }),
    p({ and: [open, { f: "proactive", op: "eq", v: true }] }),
    p({ f: "rca_at", op: "gte", v: from }, [], [{ fn: "count" }, { fn: "median", field: "time_to_rca" }]),
    p({ f: "fix_at", op: "gte", v: from }, [], [{ fn: "count" }, { fn: "median", field: "time_to_fix" }]),
    safe(aggregate(ctx, "incident", { filter: incidentsIn, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "incident", { filter: { and: [incidentsIn, { f: "problem_id", op: "nempty" }] }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "incident", { filter: { f: "mi_declared_at", op: "gte", v: from }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "incident", { filter: { and: [{ f: "mi_declared_at", op: "gte", v: from }, { f: "problem_id", op: "nempty" }] }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "known_error", { filter: { f: "state", op: "in", v: ACTIVE_KE_STATES }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "known_error", { filter: { f: "published_at", op: "gte", v: from }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "known_error", { filter: { f: "state", op: "in", v: ACTIVE_KE_STATES }, groupBy: ["effectiveness"], metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "corrective_action", { filter: open, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "corrective_action", { filter: { and: [open, { f: "due_at", op: "lt", v: today }] }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "corrective_action", { filter: { and: [{ f: "state", op: "eq", v: "done" }, { f: "closed_at", op: "gte", v: from }] }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "problem_candidate", { filter: { f: "state", op: "in", v: ["new", "reviewing"] }, metrics: [{ fn: "count" }] })),
    safe(aggregate(ctx, "incident", { filter: incidentsIn, groupBy: ["category"], metrics: [{ fn: "count" }], limit: 10 })),
    safe(aggregate(ctx, "incident", { filter: { and: [incidentsIn, { f: "ci_id", op: "nempty" }] }, groupBy: ["ci_id"], metrics: [{ fn: "count" }], limit: 10 })),
    list(ctx, "problem", { filter: open, sort: "-risk_score,-incident_count", size: 5, total: false, fields: ["number", "short_description", "state", "risk_score", "incident_count"] }),
    ...ages.map(([, , lo, hi]) => p(age(lo, hi))),
  ]);
  return {
    days: d,
    from,
    open: { total: count(byState), with_known_error: count(withKe), proactive: count(proactive), by_state: buckets(byState), by_priority: buckets(byPriority) },
    ageing: ages.map(([key, label], i) => ({ key, label, count: count(ageing[i]) })),
    times: { rca_median: num(rca.totals["median:time_to_rca"]), fix_median: num(fix.totals["median:time_to_fix"]) },
    coverage: {
      incidents: count(incidents),
      linked: count(linked),
      rate: ratio(count(linked), count(incidents)),
      majors: count(majors),
      majors_with_problem: count(majorsLinked),
      major_rate: ratio(count(majorsLinked), count(majors)),
    },
    known_errors: { active: count(keActive), published: count(kePublished), by_effectiveness: buckets(keEff) },
    capa: capaOpen ? { open: count(capaOpen), overdue: count(capaOverdue), done: count(capaDone) } : null,
    candidates: candidates ? count(candidates) : null,
    top: top.rows.map((r) => ({ id: r.id, number: r.number ?? null, short_description: String(r.short_description ?? ""), state: String(r.state ?? ""), risk_score: Number(r.risk_score ?? 0), incident_count: Number(r.incident_count ?? 0) })),
    pareto: { categories: buckets(cats), cis: buckets(cis) },
    display: { ...top.display, ...(cis?.display ?? {}) },
  };
}
