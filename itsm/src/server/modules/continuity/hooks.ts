// Hooks of the continuity tables (same transaction as the write, every write path):
//   outage            end after begin; the duration (seconds) and customer-minutes from the times, the impact and the
//                     affected users; an outage's service from its CI or offering when missing
//   capacity_record   utilisation %, status against the thresholds, the samples and the time to exhaustion; crossing
//                     into «نزدیک به آستانه» or «بحرانی» tells the owner (once per crossing)
//   bia               a clean impact matrix, the proposed RTO from it, RTO and RPO within MTPD, approval stamps, the
//                     next review date
//   continuity_plan   the next review from the last one; approval stamps
//   exercise          targets from the plan when empty, start and end stamps, RTO/RPO met; recording the result
//                     marks the plan tested (date and result)
import { addSample, biaProblem, capacityStatus, cleanImpacts, exhaustionAt, exerciseOutcome, proposedRto } from "@shared/continuity/logic";
import { todayISO } from "@shared/jalali";
import { shiftJalaliMonths } from "@shared/change/logic";
import { pushGuard, registerHooks, updateIn, validationError, actorId, orgTz, type WriteArgs } from "../../engine";
import { notifyPeople } from "../notify";
import { continuityConfig, isUuid, liveRow, liveRows, msOf, sysOf } from "./common";

const pct = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function outageBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const begin = msOf(n.begin_at);
  const end = msOf(n.end_at);
  if (begin !== null && end !== null && end < begin) throw validationError({ end_at: "پایان قطعی باید پس از شروع آن باشد" });
  if (begin !== null && begin > Date.now() + 366 * 86_400_000) throw validationError({ begin_at: "شروع قطعی بیش از یک سال بعد است" });
  if (n.outage_type !== "planned" && begin !== null && begin > Date.now() + 5 * 60_000 && w.op === "create" && n.state !== "proposed") throw validationError({ begin_at: "قطعی برنامه‌ریزی‌نشده در آینده شروع نمی‌شود؛ برای آینده نوع «قطعی برنامه‌ریزی‌شده» را بگذارید" });
  const impact = pct(n.impact_pct);
  if (impact !== null && (impact < 0 || impact > 100)) throw validationError({ impact_pct: "درصد اثر میان صفر و صد است" });
  if (!isUuid(n.service_id) && (w.changed.has("offering_id") || w.changed.has("ci_id") || w.op === "create")) {
    const sys = sysOf(w.ctx);
    if (isUuid(n.offering_id)) n.service_id = (await liveRow(w.tx, sys, "service_offering", n.offering_id))?.service_id ?? null;
    if (!isUuid(n.service_id) && isUuid(n.ci_id)) {
      const [svc] = await liveRows(w.tx, sys, "service", { f: "ci_id", op: "eq", v: n.ci_id }, { limit: 1 });
      if (svc) n.service_id = svc.id;
    }
  }
  if (begin !== null && end !== null) {
    n.duration = Math.round((end - begin) / 1000);
    const users = Math.max(0, Number(n.affected_users) || 0);
    const share = (impact ?? (n.outage_type === "degradation" ? (await continuityConfig(w.tx, sysOf(w.ctx))).degradation_weight : 100)) / 100;
    n.customer_minutes = Math.round(((end - begin) / 60_000) * users * share);
  } else {
    n.duration = null;
    n.customer_minutes = null;
  }
}

async function capacityBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const warn = pct(n.warning_pct) ?? 80;
  const crit = pct(n.critical_pct) ?? 90;
  if (warn > crit) throw validationError({ warning_pct: "آستانهٔ اخطار باید کمتر از آستانهٔ بحرانی باشد" });
  if (n.capacity !== null && n.capacity !== undefined && !(Number(n.capacity) > 0)) throw validationError({ capacity: "ظرفیت باید بیشتر از صفر باشد" });
  // «میزبان/سنجه» or «سنجه», matched case-insensitively against monitoring events
  if (typeof n.event_match === "string") n.event_match = n.event_match.trim().toLowerCase() || null;
  const s = capacityStatus(n.utilisation, n.capacity, warn, crit);
  n.utilisation_pct = s.pct === null ? null : String(s.pct);
  n.status = s.status;
  if (w.changed.has("utilisation") && n.utilisation !== null && n.utilisation !== undefined && n.utilisation !== "") {
    const now = Date.now();
    n.measured_at = new Date(now).toISOString();
    n.samples = addSample(n.samples, now, Number(n.utilisation));
  }
  const at = exhaustionAt(Array.isArray(n.samples) ? n.samples : [], Number(n.capacity));
  n.exhaustion_at = at === null ? null : new Date(at).toISOString();
  // a crossing into warning or critical is told once (back to ok resets it)
  if (s.status === "ok") n.notified_status = null;
  else if ((s.status === "warning" || s.status === "critical") && n.notified_status !== s.status) n.notified_status = s.status;
}

async function capacityAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || w.via === "sync" || !w.changed.has("notified_status") || !w.next.notified_status) return;
  const owner = w.next.owner_id;
  if (!isUuid(owner)) return;
  const critical = w.next.notified_status === "critical";
  await notifyPeople(w.tx, w.ctx.org.id, {
    table: "capacity_record",
    id: String(w.next.id),
    users: [owner],
    event: "custom",
    label: critical ? "ظرفیت بحرانی" : "ظرفیت نزدیک به آستانه",
    subject: `${critical ? "ظرفیت بحرانی" : "ظرفیت نزدیک به آستانه"}: {{record.display}}`,
    body: "مصرف «{{record.display}}» به {{utilisation_pct}}٪ رسیده است ({{status}}).\n\n[دیدن رکورد ظرفیت]({{link}})",
    channels: critical ? ["in_app", "email"] : ["in_app"],
    actor: actorId(w.ctx),
    source: "مدیریت ظرفیت",
  });
}

async function biaBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const impacts = cleanImpacts(n.impacts);
  n.impacts = impacts;
  const tol = Math.max(1, Math.min(4, Number(n.tolerance) || 3));
  n.proposed_rto = proposedRto(impacts, tol);
  if (n.is_template) return;
  const p = biaProblem(n);
  if (p) throw validationError({ rto: p });
  if (w.changed.has("state") && n.state === "approved") {
    n.approved_at = new Date().toISOString();
    n.approved_by = actorId(w.ctx);
    const months = (await continuityConfig(w.tx, sysOf(w.ctx))).bia_review_months;
    if (!w.input?.has("review_due")) n.review_due = shiftJalaliMonths(todayISO(orgTz(w.ctx)), months);
  }
}

async function planBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const months = Math.max(1, Number(n.review_months) || 12);
  if (n.last_reviewed_at) n.next_review_at = shiftJalaliMonths(String(n.last_reviewed_at).slice(0, 10), months);
  else if (w.op === "create") n.next_review_at = shiftJalaliMonths(todayISO(orgTz(w.ctx)), months);
  if (w.changed.has("state") && n.state === "approved") {
    n.approved_at = new Date().toISOString();
    if (!n.last_reviewed_at) {
      n.last_reviewed_at = todayISO(orgTz(w.ctx));
      n.next_review_at = shiftJalaliMonths(String(n.last_reviewed_at), months);
    }
  }
}

async function exerciseBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if ((w.op === "create" || w.changed.has("plan_id")) && isUuid(n.plan_id)) {
    const plan = await liveRow(w.tx, sysOf(w.ctx), "continuity_plan", n.plan_id);
    if (plan) {
      if (n.rto_target === null || n.rto_target === undefined) n.rto_target = plan.rto ?? null;
      if (n.rpo_target === null || n.rpo_target === undefined) n.rpo_target = plan.rpo ?? null;
      if (!n.assignment_group_id) n.assignment_group_id = plan.assignment_group_id ?? null;
    }
  }
  if (w.changed.has("state") && n.state === "in_progress" && !n.started_at) n.started_at = new Date().toISOString();
  if (w.changed.has("state") && n.state === "results" && !n.ended_at) n.ended_at = new Date().toISOString();
  const o = exerciseOutcome(n);
  n.rto_met = o.rto_met;
  n.rpo_met = o.rpo_met;
}

async function exerciseAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || w.via === "sync" || !w.changed.has("state") || w.next.state !== "results" || !isUuid(w.next.plan_id)) return;
  // the organisation's calendar day of the end (an exercise ending after midnight UTC is still «today» in Tehran)
  const ended = msOf(w.next.ended_at) ?? Date.now();
  let day: string;
  try {
    day = new Intl.DateTimeFormat("en-CA", { timeZone: orgTz(w.ctx), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ended));
  } catch {
    day = new Date(ended).toISOString().slice(0, 10);
  }
  await updateIn(w.tx, sysOf(w.ctx), "continuity_plan", String(w.next.plan_id), { last_tested_at: day, last_test_result: w.next.result ?? null }, { trusted: true, keepVersion: true, allowLocked: true });
}

export function installContinuityHooks(): (() => void)[] {
  return [
    // a Windows app's push runs no beforeWrite: the same checks are asked of the pushed row (pushGuard: the hooks only
    // read, their derived values on the copy are dropped — the Windows app computed them with the same code)
    registerHooks("outage", { beforeWrite: outageBefore, validatePush: pushGuard(outageBefore) }),
    registerHooks("capacity_record", { beforeWrite: capacityBefore, afterWrite: capacityAfter, validatePush: pushGuard(capacityBefore) }),
    registerHooks("bia", { beforeWrite: biaBefore, validatePush: pushGuard(biaBefore) }),
    registerHooks("continuity_plan", { beforeWrite: planBefore, validatePush: pushGuard(planBefore) }),
    registerHooks("exercise", { beforeWrite: exerciseBefore, afterWrite: exerciseAfter, validatePush: pushGuard(exerciseBefore) }),
  ];
}
