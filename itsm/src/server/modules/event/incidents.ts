// Alerts → incidents (catalogue EVT-010): rules create an incident from an alert — at once or when it is still open
// after a delay — or add the repeat to the open incident of the same key (one incident per correlated group when the
// rule says so); the incident gets the alert's CI, service, team and the severity's impact and urgency through the
// incident module's `createFromAlert`, and a «برآمده از هشدار» link to every alert it covers. When all of an
// incident's alerts clear, the incident is resolved (optional per rule). The other way round: resolving or closing
// an incident acknowledges its still-open alerts (they stop paging) — never loops, since cleared alerts do nothing.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addLinkIn, condEnv, defFor, orgSchema, transitionIn, updateIn } from "../../engine";
import { workNote } from "../incident/major";
import { enqueue } from "../../jobs";
import { createFromAlert, type AlertInput } from "../incident/alerts";
import { holds, withWalks } from "../sla/common";
import { severityRank } from "@shared/event/logic";
import { ALERT_OPEN_STATES } from "@shared/tables/event";
import { isUuid, liveRow, liveRows, lockGroup, type Row } from "./common";
import { alertNote } from "./escalation";
import { acknowledgeIn } from "./actions";

export const INCIDENT_RULE_JOB = "event.incident_rule";

const SEVERITY: Record<string, AlertInput["severity"]> = { critical: "critical", major: "major", minor: "minor", warning: "warning", info: "info" };

/**
 * Raise (or update) the incident of an alert — of its correlated group when `perGroup` — and link every alert it
 * covers. Inside the caller's transaction; `sys` may carry the person who asked (their name goes on the notes).
 */
export async function raiseIncident(tx: Tx, sys: Ctx, alert: Row, o: { rule?: Row | null; perGroup?: boolean; reason?: string; by?: string | null } = {}): Promise<{ incident: Row; created: boolean }> {
  const group = (o.perGroup ?? true) && isUuid(alert.group_id) ? await liveRow(tx, sys, "alert_group", alert.group_id) : null;
  const key = group ? `SIT:${group.number}` : `ALR:${alert.number}`;
  const source = isUuid(alert.source_id) ? await liveRow(tx, sys, "event_source", alert.source_id) : null;
  const members = group ? await liveRows(tx, sys, "alert", { and: [{ f: "group_id", op: "eq", v: group.id }, { f: "state", op: "in", v: ALERT_OPEN_STATES }] }, { limit: 200 }) : [alert];
  const worst = members.reduce((w, a) => (severityRank(a.severity) < severityRank(w) ? a.severity : w), alert.severity);
  const title = group ? String(group.title) : String(alert.short_description);
  const description = [
    alert.description ? String(alert.description) : "",
    group ? `هشدارهای گروه ${group.number}: ${members.map((m) => m.number).filter(Boolean).slice(0, 20).join("، ")}` : `هشدار ${alert.number}${alert.node ? ` روی ${alert.node}` : ""}`,
    o.reason ? `دلیل: ${o.reason}` : "",
  ].filter(Boolean).join("\n\n");
  const { incident, created } = await createFromAlert(tx, sys, {
    key,
    source: source?.name ? `پایش «${source.name}»` : "پایش",
    title,
    description,
    severity: SEVERITY[String(worst)] ?? "minor",
    occurred_at: alert.first_seen_at ?? null,
    ci_id: (group?.ci_id as string | null) ?? alert.ci_id ?? null,
    service_id: (group?.service_id as string | null) ?? alert.service_id ?? null,
    assignment_group_id: o.rule?.assignment_group_id ?? alert.assignment_group_id ?? null,
    category: o.rule?.category ?? null,
  });
  const autoResolve = o.rule ? o.rule.auto_resolve !== false : false;
  for (const a of members) {
    if (a.incident_id === incident.id) continue;
    await updateIn(tx, sys, "alert", String(a.id), { incident_id: incident.id, incident_auto_resolve: autoResolve }, { trusted: true, keepVersion: true, allowLocked: true });
    await addLinkIn(tx, sys, "alert", String(a.id), { kind: "raised", table: "incident", id: String(incident.id) }).catch(() => undefined);
    if (a.id === alert.id || !group) await alertNote(tx, sys, a, created ? `رخداد ${incident.number} از این هشدار ساخته شد.` : `این هشدار به رخداد باز ${incident.number} افزوده شد.`, { incident: incident.id }, o.by ?? null);
  }
  if (group && group.incident_id !== incident.id) {
    await lockGroup(tx, String(group.id));
    await updateIn(tx, sys, "alert_group", String(group.id), { incident_id: incident.id }, { trusted: true, keepVersion: true });
  }
  return { incident, created };
}

/**
 * Alerts that joined a correlated group whose incident exists follow it: they get the incident, its link and the
 * group's auto-resolution, and the incident a note (one incident per situation; member alerts on its timeline).
 */
export async function attachToIncident(tx: Tx, sys: Ctx, incidentId: string, alerts: Row[], autoResolve: boolean): Promise<number> {
  const incident = await liveRow(tx, sys, "incident", incidentId);
  if (!incident) return 0;
  let n = 0;
  const added: string[] = [];
  for (const a of alerts) {
    if (a.incident_id === incidentId) continue;
    await updateIn(tx, sys, "alert", String(a.id), { incident_id: incidentId, incident_auto_resolve: autoResolve }, { trusted: true, keepVersion: true, allowLocked: true });
    await addLinkIn(tx, sys, "alert", String(a.id), { kind: "raised", table: "incident", id: incidentId }).catch(() => undefined);
    a.incident_id = incidentId;
    added.push(String(a.number ?? a.id));
    n++;
  }
  if (added.length) {
    const { def } = await defFor(sys, "incident", tx);
    await workNote(tx, sys, def, incident, `هشدارهای هم‌بستهٔ تازه به این رخداد افزوده شد: ${added.join("، ")}`, { alerts: added });
  }
  return n;
}

/** The first active alert→incident rule that holds for the alert (severity at least the rule's, its condition). */
export async function matchingIncidentRule(tx: Tx, sys: Ctx, alert: Row): Promise<Row | null> {
  const rules = await liveRows(tx, sys, "alert_incident_rule", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.name", limit: 100 });
  if (!rules.length) return null;
  const schema = await orgSchema(sys, tx);
  const def = schema.def("alert")!;
  const env = await condEnv(sys);
  const row = await withWalks(tx, def, sys.org.id, alert, rules.map((r) => r.condition), env, schema.lookup);
  for (const r of rules) {
    if (severityRank(alert.severity) > severityRank(r.min_severity ?? "major")) continue;
    if (holds(r.condition, row, env, def, schema.lookup, true)) return r;
  }
  return null;
}

/** Apply the incident rules to an alert that opened or got worse: raise now, or queue the delayed check. */
export async function applyIncidentRules(tx: Tx, sys: Ctx, alert: Row): Promise<"raised" | "scheduled" | null> {
  if (alert.incident_id || !["open", "acknowledged", "flapping"].includes(String(alert.state))) return null;
  const rule = await matchingIncidentRule(tx, sys, alert);
  if (!rule) return null;
  const delay = Math.max(0, Number(rule.delay_minutes) || 0);
  if (!delay) {
    await raiseIncident(tx, sys, alert, { rule, perGroup: rule.per_group !== false, reason: `قاعدهٔ «${rule.name}»` });
    return "raised";
  }
  await enqueue(tx, { kind: INCIDENT_RULE_JOB, orgId: sys.org.id, payload: { alert: alert.id, rule: rule.id }, delayMs: delay * 60_000, dedupeKey: `event.inc:${alert.id}:${rule.id}`, maxAttempts: 5 });
  return "scheduled";
}

/** The delayed check of a rule: the alert is still open and unacknowledged → its incident. */
export async function delayedIncident(sys: Ctx, alertId: string, ruleId: string): Promise<boolean> {
  return sys.write(async (tx) => {
    const alert = await liveRow(tx, sys, "alert", alertId);
    const rule = await liveRow(tx, sys, "alert_incident_rule", ruleId);
    if (!alert || !rule || rule.active === false || alert.incident_id) return false;
    if (!["open", "flapping"].includes(String(alert.state))) return false;
    await raiseIncident(tx, sys, alert, { rule, perGroup: rule.per_group !== false, reason: `قاعدهٔ «${rule.name}» پس از ${Number(rule.delay_minutes).toLocaleString("fa-IR")} دقیقه بی‌پاسخ` });
    return true;
  });
}

/** An alert cleared: resolve its incident when every alert of it cleared and the rule asked for it. */
export async function maybeResolveIncident(tx: Tx, sys: Ctx, alert: Row): Promise<boolean> {
  if (!isUuid(alert.incident_id) || !alert.incident_auto_resolve) return false;
  const open = await liveRows(tx, sys, "alert", { and: [{ f: "incident_id", op: "eq", v: alert.incident_id }, { f: "state", op: "in", v: ALERT_OPEN_STATES }] }, { limit: 1 });
  if (open.length) return false;
  const incident = await liveRow(tx, sys, "incident", alert.incident_id);
  if (!incident || !["new", "in_progress", "on_hold"].includes(String(incident.state))) return false;
  try {
    await transitionIn(tx, sys, "incident", String(incident.id), "resolved", { close_code: "solved", close_notes: "همهٔ هشدارهای پایش این رخداد رفع شدند؛ رخداد خودکار حل شد." }, { trusted: true });
    return true;
  } catch {
    return false;
  }
}

/** An incident was resolved or closed: its open alerts are acknowledged (paging stops) with a note. */
export async function incidentDone(tx: Tx, sys: Ctx, incident: Row): Promise<number> {
  const alerts = await liveRows(tx, sys, "alert", { and: [{ f: "incident_id", op: "eq", v: incident.id }, { f: "state", op: "in", v: ["open", "flapping"] }] }, { limit: 200 });
  for (const a of alerts) {
    await acknowledgeIn(tx, sys, a, { by: null, via: "auto", note: `رخداد ${incident.number} حل شد؛ هشدار تأیید شد تا فراخوان نشود.` });
  }
  return alerts.length;
}
