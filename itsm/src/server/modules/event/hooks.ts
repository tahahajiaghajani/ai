// Hooks of the event module's tables (same transaction as the write, every write path):
//   alert          defaults (first/last seen, opened), CI binding when the CI changes (impact from its criticality,
//                  the team from its support group, affected services through the CMDB, the anchors `unit_id` and
//                  `domain_id` copied from the CI so the teams of a company or domain see its alerts), the default
//                  priority from severity × impact (an organisation's priority matrix for `alert` takes over after
//                  this hook), severity history, acknowledgement stamps, the escalation fields on leaving «باز», the
//                  noise label when it clears or closes; after the write: the open pages end when it is no longer
//                  open, and the correlated group is recomputed once before commit
//   event_source   mapping and severity map are objects with known severities
//   event_rule     a valid pattern; the action's fields
//   correlation_rule  «ویژگی‌های یکسان» names its fields
//   on-call        rotations, overrides and levels are checked; one default policy per team
import { noiseLabel, patternProblem, priorityOf, impactOfCriticality } from "@shared/event/logic";
import { rotationProblem } from "@shared/event/oncall";
import { ALERT_OPEN_STATES, SEVERITY_ORDER } from "@shared/tables/event";
import { pushGuard, registerHooks, updateIn, validationError, actorId, type PushArgs, type WriteArgs } from "../../engine";
import { servicesImpactedBy } from "../cmdb/impact";
import { eventConfig, idList, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
import { stopEscalation } from "./escalation";
import { queueRollup, redactGroups } from "./correlate";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

async function alertBefore(w: WriteArgs): Promise<void> {
  const { next, prev, changed, op } = w;
  if (op === "delete") return;
  const sys = sysOf(w.ctx);
  const now = new Date().toISOString();
  if (op === "create") {
    next.first_seen_at = next.first_seen_at ?? now;
    next.last_seen_at = next.last_seen_at ?? next.first_seen_at;
    next.opened_at = next.opened_at ?? now;
    if (!Array.isArray(next.severity_history) || !next.severity_history.length) next.severity_history = [{ at: now, from: null, to: next.severity }];
  }
  // the CI: impact, team, affected services, anchors
  if (changed.has("ci_id") || (op === "create" && isUuid(next.ci_id))) {
    const ci = isUuid(next.ci_id) ? await liveRow(w.tx, sys, "ci", next.ci_id) : null;
    if (ci) {
      if (!w.input?.has("impact")) next.impact = impactOfCriticality(ci.criticality);
      if (!next.assignment_group_id && ci.support_group_id) next.assignment_group_id = ci.support_group_id;
      if (!w.input?.has("affected_services")) {
        const services = await servicesImpactedBy(w.tx, sys, [String(ci.id)], 6).catch(() => [] as string[]);
        next.affected_services = [...new Set([...(isUuid(next.service_id) ? [next.service_id] : []), ...services])].slice(0, 50);
        if (!next.service_id && services[0]) next.service_id = services[0];
      }
      next.unit_id = ci.unit_id ?? null;
      next.domain_id = ci.domain_id ?? null;
    } else if (op !== "create") {
      next.unit_id = null;
      next.domain_id = null;
    }
  }
  if (!SEVERITY_ORDER.includes(next.severity)) throw validationError({ severity: "شدت هشدار معتبر نیست" });
  // default priority from the severity matrix (a stored priority matrix of the organisation replaces it afterwards)
  if ((op === "create" && !w.input?.has("priority")) || ((changed.has("severity") || changed.has("impact")) && !w.input?.has("priority"))) next.priority = priorityOf(next.severity, next.impact ?? "2");
  if (op !== "create" && changed.has("severity")) {
    const h = Array.isArray(next.severity_history) ? next.severity_history : [];
    const last = h[h.length - 1];
    if (!last || last.to !== next.severity) next.severity_history = [...h, { at: now, from: prev?.severity ?? null, to: next.severity }].slice(-50);
  }
  if (!changed.has("state") && op !== "create") return;
  const state = String(next.state);
  const from = prev ? String(prev.state) : null;
  if (state === "acknowledged" && from !== "acknowledged") {
    next.acknowledged_at = next.acknowledged_at && changed.has("acknowledged_at") ? next.acknowledged_at : now;
    next.acknowledged_by = next.acknowledged_by ?? actorId(w.ctx);
  }
  if (state === "open" && from && from !== "open") {
    // back to open: a new round of acknowledgement
    if (from === "cleared" || from === "closed" || from === "suppressed") {
      next.acknowledged_at = null;
      next.acknowledged_by = null;
    }
    next.snoozed_until = null;
  }
  if (state !== "snoozed" && from === "snoozed") next.snoozed_until = state === "open" ? null : next.snoozed_until;
  if (state !== "open" && (prev?.escalation_state === "running" || next.escalation_state === "running")) {
    next.escalation_state = state === "acknowledged" ? "acknowledged" : "stopped";
    next.next_escalation_at = null;
  }
  if (state === "cleared" || state === "closed") {
    const cfg = await eventConfig(w.tx, sys);
    const label = noiseLabel({
      acknowledged: !!next.acknowledged_at,
      incident: isUuid(next.incident_id),
      flapCount: Number(next.flap_count ?? 0),
      reopenCount: Number(next.reopen_count ?? 0),
      openedMs: msOf(next.opened_at ?? next.first_seen_at),
      clearedMs: msOf(next.resolved_at) ?? Date.now(),
      transientSeconds: cfg.transient_seconds,
      closeCode: next.close_code ?? null,
    });
    next.noise_label = label.label;
    next.noise_reason = label.reason;
  }
  if (state === "flapping") {
    next.noise_label = "noise";
    next.noise_reason = `نوسان (${Number(next.flap_count ?? 1).toLocaleString("fa-IR")} بار)`;
  }
}

async function alertAfter(w: WriteArgs): Promise<void> {
  if (w.via === "sync") return;
  const sys = sysOf(w.ctx);
  const row = w.next;
  // no longer waiting for anyone: the open pages end
  if (w.changed.has("state") && w.prev && ["open", "flapping"].includes(String(w.prev.state)) && !["open", "flapping"].includes(String(row.state))) {
    const pages = await liveRows(w.tx, sys, "page", { and: [{ f: "alert_id", op: "eq", v: row.id }, { f: "state", op: "in", v: ["queued", "sent"] }] }, { limit: 1 });
    if (pages.length) await stopEscalation(w.tx, sys, row, row.state === "acknowledged" ? "acknowledged" : "stopped", actorId(w.ctx), "app");
  }
  for (const gid of new Set([w.prev?.group_id, row.group_id].filter(isUuid))) {
    if (w.op === "create" || w.changed.has("group_id") || w.changed.has("state") || w.changed.has("severity") || w.changed.has("priority") || w.changed.has("last_seen_at") || w.op === "delete") queueRollup(w.tx, sys, gid);
  }
}

function sourceBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.mapping !== null && n.mapping !== undefined && !isObj(n.mapping)) throw validationError({ mapping: "نگاشت باید یک شیء JSON باشد" });
  if (isObj(n.mapping)) for (const k of ["subject_regex", "body_regex"]) {
    const p = patternProblem(n.mapping[k]);
    if (p) throw validationError({ mapping: `${k}: ${p}` });
  }
  if (n.severity_map !== null && n.severity_map !== undefined) {
    if (!isObj(n.severity_map)) throw validationError({ severity_map: "نگاشت شدت باید یک شیء JSON باشد" });
    for (const [k, v] of Object.entries(n.severity_map)) if (!SEVERITY_ORDER.includes(v as never)) throw validationError({ severity_map: `«${k}»: شدت باید یکی از ${SEVERITY_ORDER.join("، ")} باشد` });
  }
}

function ruleBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const n = w.next;
  const p = patternProblem(n.pattern);
  if (p) throw validationError({ pattern: p });
  if (n.action === "set" && !n.set_severity && !n.set_group_id && !n.set_service_id && !n.set_ci_id && !(Array.isArray(n.add_tags) && n.add_tags.length) && !n.message_prefix && !n.pattern) {
    throw validationError({ set_severity: "برای «تغییر و غنی‌سازی» دست‌کم یک مقدار تازه یا الگوی استخراج تعیین کنید" });
  }
  if (n.action === "threshold" && !(Number(n.threshold_count) >= 2)) throw validationError({ threshold_count: "آستانه دست‌کم دو رویداد است" });
  // dropping every event by mistake: «نادیده گرفتن» and «سرکوب» need a condition, a pattern or a source
  const empty = !n.condition || (typeof n.condition === "object" && !Object.keys(n.condition as object).length);
  if ((n.action === "ignore" || n.action === "suppress") && empty && !n.pattern && !n.source_id) throw validationError({ condition: "برای نادیده گرفتن یا سرکوب، شرط، الگو یا منبع را تعیین کنید؛ این قاعده همهٔ رویدادها را کنار می‌گذاشت" });
}

function correlationBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  if (w.next.kind === "fields" && !idList(w.next.match_fields).length) throw validationError({ match_fields: "ویژگی‌هایی را که باید یکسان باشند انتخاب کنید" });
}

async function rotationBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const p = rotationProblem(w.next as never);
  if (p) throw validationError({ members: p });
}

async function overrideBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const s = msOf(w.next.start_at);
  const e = msOf(w.next.end_at);
  if (s === null || e === null || e <= s) throw validationError({ end_at: "پایان جایگزینی باید پس از آغاز آن باشد" });
  if (w.next.replaces_id && w.next.replaces_id === w.next.user_id) throw validationError({ replaces_id: "کسی جای خودش را نمی‌گیرد" });
}

async function levelBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.target === "oncall" && !isUuid(n.schedule_id)) throw validationError({ schedule_id: "برنامهٔ کشیک این سطح را انتخاب کنید" });
  if (n.target === "users" && !idList(n.users).length) throw validationError({ users: "افراد این سطح را انتخاب کنید" });
}

async function policyAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !w.next.is_default || !(w.op === "create" || w.changed.has("is_default") || w.changed.has("group_id"))) return;
  const sys = sysOf(w.ctx);
  const others = await liveRows(w.tx, sys, "escalation_policy", { and: [{ f: "is_default", op: "eq", v: true }, { f: "id", op: "ne", v: w.next.id }, w.next.group_id ? { f: "group_id", op: "eq", v: w.next.group_id } : { f: "group_id", op: "empty" }] }, { limit: 20 });
  for (const o of others) await updateIn(w.tx, sys, "escalation_policy", String(o.id), { is_default: false }, { trusted: true });
}

/** Alerts that are open (not done) — for other modules' checks. */
export const isOpenAlert = (row: Row) => ALERT_OPEN_STATES.includes(String(row.state));

/**
 * A Windows app's pushed alert: its access anchors (`unit_id`, `domain_id` — the teams of a company or domain read
 * their alerts by them) are the CI's, as the cloud reads it, never the push's; an alert whose CI did not change keeps
 * the stored ones.
 */
async function alertAnchorsOnPush(p: PushArgs): Promise<Row> {
  if (p.prev && !p.changed.has("ci_id")) return { unit_id: p.prev.unit_id ?? null, domain_id: p.prev.domain_id ?? null };
  const ci = isUuid(p.next.ci_id) ? await liveRow(p.tx, sysOf(p.ctx), "ci", p.next.ci_id) : null;
  return { unit_id: ci?.unit_id ?? null, domain_id: ci?.domain_id ?? null };
}

export function installEventHooks(): (() => void)[] {
  // a Windows app's push runs no beforeWrite: the definitions' pure checks are asked of the pushed row (pushGuard)
  return [
    registerHooks("alert", { beforeWrite: alertBefore, afterWrite: alertAfter, derivePush: alertAnchorsOnPush }),
    // a group's stored summary and causes name its members and nearby changes: rebuilt for readers who may not read them all
    registerHooks("alert_group", { redactRows: redactGroups }),
    registerHooks("event_source", { beforeWrite: sourceBefore, validatePush: pushGuard(sourceBefore) }),
    registerHooks("event_rule", { beforeWrite: ruleBefore, validatePush: pushGuard(ruleBefore) }),
    registerHooks("correlation_rule", { beforeWrite: correlationBefore, validatePush: pushGuard(correlationBefore) }),
    registerHooks("oncall_rotation", { beforeWrite: rotationBefore, validatePush: pushGuard(rotationBefore) }),
    registerHooks("oncall_override", { beforeWrite: overrideBefore, validatePush: pushGuard(overrideBefore) }),
    registerHooks("escalation_level", { beforeWrite: levelBefore, validatePush: pushGuard(levelBefore) }),
    registerHooks("escalation_policy", { afterWrite: policyAfter }),
  ];
}
