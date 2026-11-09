// Routing, escalation and paging (catalogue EVT-035/036/037/039/040):
//   · routing: the first active `alert_route` whose condition (and time: working hours or not, on its calendar) holds
//     names the team and the escalation policy; else the team's default policy, else the organisation's default
//   · escalation: a durable timer per alert and round — `event.escalate` runs level after level (each `delay_minutes`
//     after the previous one; level 1 after the alert opened), repeats the whole policy `repeat_times` times and stops
//     as soon as the alert is acknowledged, cleared, closed, snoozed or put in maintenance. Unanswered after the last
//     level: «بی‌پاسخ» and, when the settings say so, an incident
//   · paging: one `page` per person and level with a one-time acknowledgement link (a random token; only its SHA-256
//     is stored), sent through the notification service — in-app, e-mail, SMS — rendered under the person's access
//     (the paged person becomes a responder of the alert, so they may read it)
//   · acknowledging by link (sign-in-free, /p/ack/<token>): acknowledges the alert on behalf of the paged person and
//     stops the escalation; the other open pages of the alert end as «با تأیید دیگری»
import { createHash, randomBytes } from "node:crypto";
import type { Cond } from "@shared/model/conditions";
import { ALERT_SEVERITIES } from "@shared/tables/event";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { condEnv, createIn, defFor, orgSchema, transitionIn, updateIn, addJournalIn, systemCtx } from "../../engine";
import { enqueue } from "../../jobs";
import { notFound } from "../../http/errors";
import { notifyPeople } from "../notify";
import { groupMembers } from "../notify/recipients";
import { appUrl } from "../notify/common";
import { calendarFor } from "../sla";
import { holds, withWalks } from "../sla/common";
import { officeCalendar } from "../incident/major";
import { isWorking } from "@shared/sla/calendar";
import { eventConfig, idList, isUuid, liveRow, liveRows, msOf, nowIso, sysOf, type Row } from "./common";
import { onCallOfSchedule } from "./oncall";
import { raiseIncident } from "./incidents";
import { acknowledgeIn } from "./actions";

const MIN = 60_000;
export const ESCALATE_JOB = "event.escalate";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sevLabel = (s: unknown) => ALERT_SEVERITIES.find((o) => o.value === s)?.label ?? String(s ?? "");

/** A note of the system on an alert (internal). */
export async function alertNote(tx: Tx, sys: Ctx, alert: Row, body: string, data: Record<string, unknown> | null = null, author: string | null = null): Promise<void> {
  const { def } = await defFor(sys, "alert", tx);
  await addJournalIn(tx, sys, def, alert, { kind: "system", visibility: "internal", body, data }, { trusted: true, author });
}

// ---------------------------------------------------------------------------------------------------------------
// Routing

/** Does a route's time restriction hold now? */
async function routeTimeOk(q: Queryable, sys: Ctx, route: Row, now: number): Promise<boolean> {
  if (!route.time || route.time === "any") return true;
  const cal = isUuid(route.calendar_id) ? await calendarFor(q, sys, route.calendar_id) : await officeCalendar(q, sys);
  if (!cal) return true;
  const working = isWorking(cal, now);
  return route.time === "office" ? working : !working;
}

/** The team and escalation policy of an alert: the first matching route, the team's default policy, the organisation's. */
export async function routeAlert(q: Queryable, sys: Ctx, alert: Row, now = Date.now()): Promise<{ group: string | null; policy: string | null; route: Row | null }> {
  const schema = await orgSchema(sys, q);
  const def = schema.def("alert")!;
  const env = await condEnv(sys);
  const routes = await liveRows(q, sys, "alert_route", { f: "active", op: "eq", v: true }, { order: "t.sort_order, t.name", limit: 200 });
  const row = routes.length ? await withWalks(q, def, sys.org.id, alert, routes.map((r) => r.condition), env, schema.lookup) : alert;
  for (const r of routes) {
    if (!holds(r.condition, row, env, def, schema.lookup, true)) continue;
    if (!(await routeTimeOk(q, sys, r, now))) continue;
    return { group: r.assignment_group_id ?? alert.assignment_group_id ?? null, policy: r.escalation_policy_id ?? null, route: r };
  }
  const group = alert.assignment_group_id ?? null;
  if (isUuid(group)) {
    const [p] = await liveRows(q, sys, "escalation_policy", { and: [{ f: "group_id", op: "eq", v: group }, { f: "active", op: "eq", v: true }, { f: "is_default", op: "eq", v: true }] }, { order: "t.created_at", limit: 1 });
    if (p) return { group, policy: String(p.id), route: null };
  }
  const cfg = await eventConfig(q, sys);
  return { group, policy: cfg.default_policy_id ?? null, route: null };
}

/** The live levels of a policy, in order. */
export async function policyLevels(q: Queryable, sys: Ctx, policyId: string): Promise<Row[]> {
  return liveRows(q, sys, "escalation_level", { f: "policy_id", op: "eq", v: policyId }, { order: "t.level, t.created_at", limit: 20 });
}

// ---------------------------------------------------------------------------------------------------------------
// Start and stop

/**
 * Start (or restart) the escalation of an open alert: route it, then queue level 1. Inside the caller's transaction.
 * An explicitly set policy on the alert wins over routing.
 */
export async function startEscalation(tx: Tx, sys: Ctx, alertId: string, now = Date.now()): Promise<{ policy: string | null; levels: number }> {
  const alert = await liveRow(tx, sys, "alert", alertId);
  if (!alert || alert.state !== "open") return { policy: null, levels: 0 };
  const routed = await routeAlert(tx, sys, alert, now);
  const policy = (isUuid(alert.escalation_policy_id) ? alert.escalation_policy_id : null) ?? routed.policy;
  const patch: Row = {};
  if (!alert.assignment_group_id && routed.group) patch.assignment_group_id = routed.group;
  if (!policy) {
    if (alert.escalation_state !== "none") patch.escalation_state = "none";
    if (Object.keys(patch).length) await updateIn(tx, sys, "alert", alertId, patch, { trusted: true, keepVersion: true });
    return { policy: null, levels: 0 };
  }
  const levels = await policyLevels(tx, sys, policy);
  const p = await liveRow(tx, sys, "escalation_policy", policy);
  if (!levels.length || !p || p.active === false) {
    await updateIn(tx, sys, "alert", alertId, { ...patch, escalation_policy_id: policy, escalation_state: "none" }, { trusted: true, keepVersion: true });
    return { policy, levels: 0 };
  }
  const round = Number(alert.escalation_round ?? 0) + 1;
  const first = now + Math.max(0, Number(levels[0].delay_minutes) || 0) * MIN;
  await updateIn(tx, sys, "alert", alertId, { ...patch, escalation_policy_id: policy, escalation_state: "running", escalation_level: 0, escalation_round: round, next_escalation_at: new Date(first).toISOString() }, { trusted: true, keepVersion: true });
  await enqueue(tx, { kind: ESCALATE_JOB, orgId: sys.org.id, payload: { alert: alertId, round, rep: 0, index: 0 }, runAt: new Date(first), dedupeKey: `event.esc:${alertId}:${round}`, maxAttempts: 6 });
  return { policy, levels: levels.length };
}

/**
 * Stop the escalation of an alert (acknowledged, cleared, closed, snoozed, in maintenance): its open pages end —
 * the acknowledger's as «تأییدشده», the others as «لغوشده» — and no next level runs.
 */
export async function stopEscalation(tx: Tx, sys: Ctx, alert: Row, how: "acknowledged" | "stopped", by: string | null = null, via: "app" | "link" | "auto" = "app"): Promise<number> {
  const pages = await liveRows(tx, sys, "page", { and: [{ f: "alert_id", op: "eq", v: alert.id }, { f: "state", op: "in", v: ["queued", "sent"] }] }, { limit: 200 });
  for (const p of pages) {
    if (how === "acknowledged" && by && p.user_id === by) {
      await transitionIn(tx, sys, "page", String(p.id), "acknowledged", { acknowledged_at: nowIso(), ack_via: via }, { trusted: true });
    } else if (how === "acknowledged") {
      await transitionIn(tx, sys, "page", String(p.id), "canceled", { ack_via: "auto", failure_reason: "هشدار را دیگری تأیید کرد" }, { trusted: true });
    } else {
      await transitionIn(tx, sys, "page", String(p.id), "canceled", { failure_reason: "ارتقا متوقف شد" }, { trusted: true });
    }
  }
  if (alert.escalation_state === "running" || alert.next_escalation_at) {
    await updateIn(tx, sys, "alert", String(alert.id), { escalation_state: how, next_escalation_at: null }, { trusted: true, keepVersion: true, allowLocked: true });
  }
  return pages.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Paging

/** The people a level pages now (deduplicated), and a note when a schedule has nobody on call. */
async function levelTargets(q: Queryable, sys: Ctx, level: Row, alert: Row): Promise<{ users: string[]; note: string | null }> {
  const group = isUuid(level.target_group_id) ? level.target_group_id : alert.assignment_group_id;
  switch (level.target) {
    case "oncall": {
      const schedule = isUuid(level.schedule_id) ? await liveRow(q, sys, "oncall_schedule", level.schedule_id) : null;
      if (!schedule) return { users: [], note: "برنامهٔ کشیک این سطح پیدا نشد" };
      const who = await onCallOfSchedule(q, sys, schedule);
      return who.user ? { users: [who.user], note: null } : { users: [], note: `در برنامهٔ «${schedule.name}» اکنون کسی کشیک نیست (خلأ پوشش)` };
    }
    case "users":
      return { users: idList(level.users), note: null };
    case "group":
      return { users: isUuid(group) ? await groupMembers(sys, [group], q) : [], note: isUuid(group) ? null : "گروهی برای این سطح تعیین نشده است" };
    case "manager": {
      const g = isUuid(group) ? await liveRow(q, sys, "group", group) : null;
      return { users: isUuid(g?.manager_id) ? [g!.manager_id] : [], note: g?.manager_id ? null : "گروه مدیر ندارد" };
    }
    default:
      return { users: [], note: null };
  }
}

/** The link a paged person opens to acknowledge (absolute when the web version's address is known). */
export function ackLink(cfg: { publicUrl?: string }, token: string): string {
  const base = (cfg.publicUrl ?? "").replace(/\/+$/, "");
  return `${base}/p/ack/${token}`;
}

/** Page one person for an alert at a level: a `page` row with a one-time link, and the message itself. */
export async function pageUser(tx: Tx, sys: Ctx, alert: Row, user: string, o: { level: number; round: number; policy: string | null; channels: string[]; hours: number }): Promise<{ page: Row; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const sent = Date.now();
  const page = await createIn(tx, sys, "page", {
    summary: `فراخوان ${alert.number ?? ""}: ${String(alert.short_description ?? "").slice(0, 200)}`,
    alert_id: alert.id,
    user_id: user,
    policy_id: o.policy,
    level: o.level,
    round: o.round,
    channels: o.channels,
    state: "sent",
    sent_at: new Date(sent).toISOString(),
    expires_at: new Date(sent + o.hours * 3600_000).toISOString(),
    ack_token_hash: sha256(token),
  }, { trusted: true });
  // the paged person reads the alert from now on (a responder: read, and act through the module)
  const responders = idList(alert.responders);
  if (!responders.includes(user)) {
    responders.push(user);
    await updateIn(tx, sys, "alert", String(alert.id), { responders }, { trusted: true, keepVersion: true });
    alert.responders = responders;
  }
  const link = ackLink(sys.cfg, token);
  await notifyPeople(tx, sys.org.id, {
    table: "alert",
    id: String(alert.id),
    users: [user],
    event: "custom",
    label: "فراخوان هشدار",
    subject: `[فراخوان] ${sevLabel(alert.severity)} — {{record.number}}: {{record.display}}`,
    body: [
      `شما برای هشدار {{record.number}} فراخوان شده‌اید (سطح ${o.level.toLocaleString("fa-IR")}).`,
      "",
      "**{{record.display}}**",
      "",
      "شدت: {{severity}} · میزبان: {{node}}",
      "",
      `[تأیید هشدار](${link}) · [باز کردن هشدار]({{link}})`,
    ].join("\n"),
    short_text: `فراخوان {{record.number}} ({{severity}}): {{record.display}} — تأیید: ${link}`,
    channels: (o.channels.length ? o.channels : ["in_app"]) as never,
    mandatory: true,
    actor: null,
    source: "فراخوان کشیک",
  });
  return { page, token };
}

export interface StepResult {
  done?: boolean;
  /** run again after this many milliseconds, with the next level `index` of repetition `rep` */
  again?: number;
  index?: number;
  rep?: number;
  paged?: number;
  exhausted?: boolean;
}

/**
 * Run one escalation step of an alert's round (the `event.escalate` job): page level `index` (0-based) of
 * repetition `rep`, then say when the next level runs — or end the round when the alert no longer waits for anyone.
 */
export async function escalateStep(sys: Ctx, alertId: string, round: number, rep: number, index: number, now = Date.now()): Promise<StepResult> {
  return sys.write(async (tx) => {
    const alert = await liveRow(tx, sys, "alert", alertId);
    if (!alert || Number(alert.escalation_round ?? 0) !== round || alert.state !== "open" || alert.escalation_state !== "running") return { done: true };
    const due = msOf(alert.next_escalation_at);
    if (due !== null && due > now + 1000) return { again: due - now, index, rep };
    const policyId = String(alert.escalation_policy_id ?? "");
    const policy = isUuid(policyId) ? await liveRow(tx, sys, "escalation_policy", policyId) : null;
    const levels = policy && policy.active !== false ? await policyLevels(tx, sys, policyId) : [];
    if (!policy || !levels.length) {
      await updateIn(tx, sys, "alert", alertId, { escalation_state: "stopped", next_escalation_at: null }, { trusted: true, keepVersion: true });
      return { done: true };
    }
    const cfg = await eventConfig(tx, sys);
    const at = Math.max(0, Math.min(index, levels.length - 1));
    const level = levels[at];
    const levelNo = Number(level.level) || at + 1;
    const { users, note } = await levelTargets(tx, sys, level, alert);
    const channels = (Array.isArray(level.channels) && level.channels.length ? (level.channels as string[]) : ["in_app", "email"]).filter((c) => ["in_app", "email", "sms"].includes(c));
    let paged = 0;
    for (const u of users.slice(0, 50)) {
      await pageUser(tx, sys, alert, u, { level: levelNo, round: rep, policy: policyId, channels, hours: cfg.ack_link_hours });
      paged++;
    }
    const lines = [`ارتقا — سطح ${levelNo.toLocaleString("fa-IR")} از سیاست «${policy.name}»${rep ? ` (تکرار ${rep.toLocaleString("fa-IR")})` : ""}: ${paged ? `${paged.toLocaleString("fa-IR")} نفر فراخوان شدند` : "کسی فراخوان نشد"}.`];
    if (note) lines.push(note);
    await alertNote(tx, sys, alert, lines.join("\n"), { escalation: { level: levelNo, rep, paged } });
    const pagesSent = Number(alert.pages_sent ?? 0) + paged;
    let nextIndex = at + 1;
    let nextRep = rep;
    if (nextIndex >= levels.length) {
      if (rep < Math.max(0, Number(policy.repeat_times) || 0)) {
        nextIndex = 0;
        nextRep = rep + 1;
      } else {
        await updateIn(tx, sys, "alert", alertId, { escalation_level: levelNo, escalation_state: "exhausted", next_escalation_at: null, pages_sent: pagesSent }, { trusted: true, keepVersion: true });
        if (cfg.incident_on_exhausted && !alert.incident_id) {
          const fresh = (await liveRow(tx, sys, "alert", alertId))!;
          await raiseIncident(tx, sys, fresh, { reason: "پس از همهٔ سطح‌های ارتقا کسی هشدار را تأیید نکرد" });
        }
        return { done: true, paged, exhausted: true };
      }
    }
    const delay = Math.max(1, Number(levels[nextIndex].delay_minutes) || 0) * MIN;
    await updateIn(tx, sys, "alert", alertId, { escalation_level: levelNo, next_escalation_at: new Date(now + delay).toISOString(), pages_sent: pagesSent }, { trusted: true, keepVersion: true });
    return { again: delay, paged, rep: nextRep, index: nextIndex };
  });
}

/** Pages still waiting for an answer whose link expired: «بی‌پاسخ». */
export async function expirePages(tx: Tx, sys: Ctx, now = Date.now()): Promise<number> {
  const pages = await liveRows(tx, sys, "page", { and: [{ f: "state", op: "in", v: ["queued", "sent"] }, { f: "expires_at", op: "lt", v: new Date(now).toISOString() }] }, { limit: 200 });
  for (const p of pages) await transitionIn(tx, sys, "page", String(p.id), "expired", { failure_reason: "تا پایان اعتبار پیوند پاسخی نرسید" }, { trusted: true });
  return pages.length;
}

/** A page by its link token (system read across organisations: the token names the page). */
async function pageOfToken(q: Queryable, token: string): Promise<{ org_id: string; id: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const rows = await q.query<{ org_id: string; id: string }>(`select org_id, id from sm_pages where ack_token_hash = $1 and deleted_at is null limit 1`, [sha256(token)]).catch(() => [] as { org_id: string; id: string }[]);
  return rows[0] ?? null;
}

export interface AckView {
  title: string;
  number: string | null;
  severity: string;
  severity_label: string;
  state: string;
  state_label: string;
  page_state: string;
  expired: boolean;
  acknowledged_at: string | null;
}

const STATE_LABEL: Record<string, string> = { open: "باز", acknowledged: "تأییدشده", flapping: "نوسانی", snoozed: "به تعویق", maintenance: "در نگهداری", cleared: "رفع‌شده", closed: "بسته", suppressed: "سرکوب‌شده" };

function viewOf(alert: Row, page: Row): AckView {
  const expired = (msOf(page.expires_at) ?? 0) < Date.now();
  return {
    title: String(alert.short_description ?? ""),
    number: alert.number ?? null,
    severity: String(alert.severity ?? ""),
    severity_label: sevLabel(alert.severity),
    state: String(alert.state ?? ""),
    state_label: STATE_LABEL[String(alert.state)] ?? String(alert.state ?? ""),
    page_state: String(page.state ?? ""),
    expired,
    acknowledged_at: alert.acknowledged_at ?? null,
  };
}

/** What the acknowledgement page shows for a token (no people, no ids). */
export async function ackView(cfg: { db: Queryable } & Record<string, unknown>, token: string): Promise<AckView> {
  const hit = await pageOfToken(cfg.db, token);
  if (!hit) throw notFound("این پیوند فراخوان معتبر نیست");
  const sys = await systemCtx(cfg as never, hit.org_id);
  const page = await liveRow(sys.db, sys, "page", hit.id);
  const alert = page ? await liveRow(sys.db, sys, "alert", page.alert_id) : null;
  if (!page || !alert) throw notFound("این پیوند فراخوان معتبر نیست");
  return viewOf(alert, page);
}

/** Acknowledge the alert of a page by its link, on behalf of the paged person. */
export async function ackByToken(cfg: { db: Queryable } & Record<string, unknown>, token: string): Promise<AckView & { changed: boolean }> {
  const hit = await pageOfToken(cfg.db, token);
  if (!hit) throw notFound("این پیوند فراخوان معتبر نیست");
  const base = await systemCtx(cfg as never, hit.org_id);
  return base.write(async (tx) => {
    const page = await liveRow(tx, base, "page", hit.id);
    const alert = page ? await liveRow(tx, base, "alert", page.alert_id) : null;
    if (!page || !alert) throw notFound("این پیوند فراخوان معتبر نیست");
    const view = viewOf(alert, page);
    if (view.expired) return { ...view, changed: false };
    if (!["open", "flapping", "snoozed", "maintenance"].includes(String(alert.state))) return { ...view, changed: false };
    const sys = sysOf(base, String(page.user_id));
    const next = await acknowledgeIn(tx, sys, alert, { by: String(page.user_id), via: "link" });
    const fresh = (await liveRow(tx, base, "page", hit.id))!;
    return { ...viewOf(next, fresh), changed: true };
  });
}
