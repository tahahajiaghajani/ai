// What the continuity screens do beyond the generic record API:
//   · exercises (CON-026): «آغاز مانور» copies the plan's steps into the exercise (with their target minutes) and
//     starts the clock; «انجام شد» times a step; «پایان مانور» records the recovery time the steps show
//   · a new BIA from the template (CON-020): the template's matrix, tolerance and guidance on a new draft
//   · the continuity dashboard (CON-037): BIA coverage of critical services, plan currency, plans tested in a year,
//     exercise results, RTO/RPO achievement, capacity risks, open outages — over what the caller may read
import { recoveryFromSteps, stepLog, type StepTiming } from "@shared/continuity/logic";
import { todayISO } from "@shared/jalali";
import { shiftJalaliMonths } from "@shared/change/logic";
import type { Ctx } from "../../context";
import { condEnv, create, defFor, list, requireReadable, transitionIn, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { conflict, forbidden, notFound } from "../../http/errors";
import { isUuid, liveRow, liveRows, orgTz, sysOf, type Row } from "./common";
import { proposeFromIncident } from "./jobs";

async function lockExercise(ctx: Ctx, tx: Parameters<Parameters<Ctx["write"]>[0]>[0], id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound("مانور پیدا نشد");
  const { def } = await defFor(ctx, "exercise", tx);
  const row = await requireReadable(ctx, def, id, await condEnv(ctx), tx, { lock: true });
  delete row.$writable;
  if (!access().canWrite(ctx, def, row)) throw forbidden("اجرای این مانور با هماهنگ‌کننده و تیم آن است");
  return row;
}

/** Start an exercise: the plan's steps become its timing sheet and the clock starts. */
export async function startExercise(ctx: Ctx, id: string): Promise<Row> {
  return ctx.write(async (tx) => {
    const row = await lockExercise(ctx, tx, id);
    if (row.state !== "planned") throw conflict("این مانور آغاز شده یا پایان یافته است");
    const sys = sysOf(ctx, ctx.user.id);
    const steps = await liveRows(tx, sys, "plan_step", { f: "plan_id", op: "eq", v: row.plan_id }, { order: "t.seq", limit: 200 });
    await updateIn(tx, sys, "exercise", id, { step_log: stepLog(steps) }, { trusted: true, keepVersion: true });
    return transitionIn(tx, sys, "exercise", id, "in_progress", {}, { trusted: true });
  });
}

/** Mark (or unmark) a step of a running exercise as done now. */
export async function markStep(ctx: Ctx, id: string, seq: number, done: boolean): Promise<Row> {
  return ctx.write(async (tx) => {
    const row = await lockExercise(ctx, tx, id);
    if (row.state !== "in_progress") throw conflict("گام‌ها فقط در مانورِ در اجرا ثبت می‌شوند");
    const log = (Array.isArray(row.step_log) ? row.step_log : []) as StepTiming[];
    const step = log.find((s) => Number(s.seq) === seq);
    if (!step) throw notFound("این گام در مانور نیست");
    step.done_at = done ? new Date().toISOString() : null;
    step.done_by = done ? ctx.user.id : null;
    return updateIn(tx, sysOf(ctx, ctx.user.id), "exercise", id, { step_log: log }, { trusted: true, keepVersion: true });
  });
}

/** End a running exercise: the recovery time from the steps when every step is done (else as entered). */
export async function finishExercise(ctx: Ctx, id: string, input: { result: string; actual_recovery?: number | null; actual_data_loss?: number | null; findings?: string | null }): Promise<Row> {
  return ctx.write(async (tx) => {
    const row = await lockExercise(ctx, tx, id);
    if (!["in_progress", "planned"].includes(String(row.state))) throw conflict("این مانور پایان یافته است");
    const fromSteps = recoveryFromSteps((Array.isArray(row.step_log) ? row.step_log : []) as StepTiming[], row.started_at ?? null);
    const data: Row = { result: input.result, actual_recovery: input.actual_recovery ?? row.actual_recovery ?? fromSteps, actual_data_loss: input.actual_data_loss ?? row.actual_data_loss ?? null };
    if (input.findings) data.findings = input.findings;
    return transitionIn(tx, sysOf(ctx, ctx.user.id), "exercise", id, "results", data, { trusted: true });
  });
}

/** A new BIA draft from the template (or another BIA): its matrix, tolerance, guidance and MBCO. */
export async function biaFromTemplate(ctx: Ctx, input: { template_id?: string | null; title: string; service_id?: string | null; activity?: string | null }): Promise<Row> {
  const FIELDS = ["title", "impacts", "tolerance", "mbco", "notes"];
  const tpl = input.template_id
    ? (await list(ctx, "bia", { ids: [input.template_id], size: 1, fields: FIELDS, total: false })).rows[0]
    : (await list(ctx, "bia", { filter: { f: "is_template", op: "eq", v: true } as never, size: 1, sort: "created_at", fields: FIELDS, total: false })).rows[0];
  if (!tpl) throw notFound("الگوی تحلیل اثر پیدا نشد");
  const r = await create(ctx, "bia", {
    title: input.title,
    service_id: input.service_id ?? null,
    activity: input.activity ?? null,
    impacts: tpl.impacts ?? {},
    tolerance: tpl.tolerance ?? 3,
    mbco: tpl.mbco ?? null,
    notes: tpl.notes ?? null,
    is_template: false,
  });
  return r.row;
}

export interface ContinuityDashboard {
  critical_services: number;
  bia_coverage: number | null;
  plans: number;
  plans_current: number;
  plan_currency: number | null;
  tested_12m: number;
  tested_share: number | null;
  exercises_12m: number;
  results: { passed: number; partial: number; failed: number };
  rto_achievement: number | null;
  rpo_achievement: number | null;
  capacity: { warning: number; critical: number; exhausting: number };
  open_outages: number;
  reviews_due: number;
}

const share = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** The continuity KPIs over what the caller may read (CON-037). */
export async function continuityDashboard(ctx: Ctx): Promise<ContinuityDashboard> {
  const { def } = await defFor(ctx, "continuity_plan");
  if (!access().canReadTable(ctx, def)) throw forbidden("به تداوم کسب‌وکار دسترسی ندارید");
  const tz = orgTz(ctx);
  const today = todayISO(tz);
  const yearAgo = shiftJalaliMonths(today, -12);
  const q = ctx.db;
  const services = await liveRows(q, ctx, "service", { and: [{ f: "state", op: "in", v: ["live", "transition", "deprecated"] }, { or: [{ f: "criticality", op: "in", v: ["1", "2"] }, { f: "tier", op: "in", v: ["tier_0", "tier_1"] }] }] }, { limit: 2000 }).catch(() => [] as Row[]);
  const bias = await liveRows(q, ctx, "bia", { and: [{ f: "state", op: "eq", v: "approved" }, { f: "is_template", op: "eq", v: false }] }, { limit: 5000 });
  const covered = new Set(bias.map((b) => b.service_id).filter(isUuid));
  const plans = await liveRows(q, ctx, "continuity_plan", { f: "state", op: "in", v: ["draft", "in_review", "approved"] }, { limit: 5000 });
  const current = plans.filter((p) => p.next_review_at && String(p.next_review_at) >= today);
  const tested = plans.filter((p) => p.last_tested_at && String(p.last_tested_at) >= yearAgo);
  const exercises = await liveRows(q, ctx, "exercise", { and: [{ f: "state", op: "in", v: ["results", "closed"] }, { f: "scheduled_at", op: "gte", v: `${yearAgo}T00:00:00Z` }] }, { limit: 5000 });
  const withRto = exercises.filter((e) => e.actual_recovery !== null && e.actual_recovery !== undefined);
  const withRpo = exercises.filter((e) => e.actual_data_loss !== null && e.actual_data_loss !== undefined);
  const capacity = await liveRows(q, ctx, "capacity_record", null, { limit: 5000 });
  const now = Date.now();
  const exhausting = capacity.filter((c) => c.exhaustion_at && Date.parse(String(c.exhaustion_at)) - now < Math.max(1, Number(c.lead_time_days) || 30) * 86_400_000).length;
  const outages = await liveRows(q, ctx, "outage", { f: "state", op: "in", v: ["proposed", "ongoing"] }, { limit: 1000 });
  const due = plans.filter((p) => p.next_review_at && String(p.next_review_at) < today).length + bias.filter((b) => b.review_due && String(b.review_due) < today).length;
  return {
    critical_services: services.length,
    bia_coverage: share(services.filter((s) => covered.has(String(s.id))).length, services.length),
    plans: plans.length,
    plans_current: current.length,
    plan_currency: share(current.length, plans.length),
    tested_12m: tested.length,
    tested_share: share(tested.length, plans.length),
    exercises_12m: exercises.length,
    results: { passed: exercises.filter((e) => e.result === "passed").length, partial: exercises.filter((e) => e.result === "partial").length, failed: exercises.filter((e) => e.result === "failed").length },
    rto_achievement: share(withRto.filter((e) => e.rto_met).length, withRto.length),
    rpo_achievement: share(withRpo.filter((e) => e.rpo_met).length, withRpo.length),
    capacity: { warning: capacity.filter((c) => c.status === "warning").length, critical: capacity.filter((c) => c.status === "critical").length, exhausting },
    open_outages: outages.length,
    reviews_due: due,
  };
}

/** Propose an outage from an incident by hand (the incident page's «ثبت قطعی»). */
export async function outageFromIncident(ctx: Ctx, incidentId: string): Promise<Row> {
  const { def } = await defFor(ctx, "outage");
  if (!access().canCreate(ctx, def, null)) throw forbidden("ثبت قطعی با تیم تداوم و دسترس‌پذیری است");
  return ctx.write(async (tx) => {
    const incident = await liveRow(tx, ctx, "incident", incidentId);
    if (!incident) throw notFound("رخداد پیدا نشد");
    const row = await proposeFromIncident(tx, sysOf(ctx, ctx.user.id), incident, ctx.user.id);
    if (!row) throw conflict("قطعی ساخته نشد");
    return row;
  });
}
